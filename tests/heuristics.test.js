'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  BARRIER_SCORE_THRESHOLD,
  isProtectedElement,
  evaluateViewportCoverage,
  evaluateStackingContext,
  evaluateSemanticSignals,
  scoreElement,
  sweepBarriers
} = require('../src/heuristics.js');

function createMockNode({
  tagName = 'DIV',
  id = '',
  className = '',
  attrs = {},
  rect = { width: 0, height: 0, top: 0, left: 0 },
  computedStyle = { position: 'static', zIndex: 'auto' },
  hasProtectedDescendant = false
} = {}) {
  const attributeMap = new Map(Object.entries(attrs));
  const styleMap = new Map();

  return {
    tagName: tagName.toUpperCase(),
    id,
    className,
    _computedStyle: computedStyle,
    style: {
      setProperty(k, v, p) {
        styleMap.set(k, { value: v, priority: p || '' });
      },
      getPropertyValue(k) {
        return styleMap.has(k) ? styleMap.get(k).value : '';
      }
    },
    getAttribute(name) {
      return attributeMap.has(name) ? attributeMap.get(name) : null;
    },
    setAttribute(name, val) {
      attributeMap.set(name, String(val));
    },
    getBoundingClientRect() {
      return rect;
    },
    querySelector(selector) {
      if (hasProtectedDescendant && /article|main|nav/.test(selector)) {
        return { tagName: 'ARTICLE' };
      }
      return null;
    }
  };
}

const mockWin = {
  innerWidth: 1920,
  innerHeight: 1080,
  getComputedStyle(el) {
    return el._computedStyle || {};
  }
};

describe('Step 3: Heuristic Overlay & Barrier Detection (src/heuristics.js)', () => {
  it('detects >= 90vw x >= 90vh full-viewport coverage', () => {
    const fullOverlay = createMockNode({
      rect: { width: 1920, height: 1080 }
    });
    const cov = evaluateViewportCoverage(fullOverlay, mockWin);
    assert.equal(cov.coversViewport, true);
    assert.ok(cov.score >= 35);

    const smallBox = createMockNode({
      rect: { width: 300, height: 200 }
    });
    const smallCov = evaluateViewportCoverage(smallBox, mockWin);
    assert.equal(smallCov.coversViewport, false);
    assert.equal(smallCov.score, 0);
  });

  it('inspects stacking context for fixed/absolute position and z-index >= 1000', () => {
    const highZ = evaluateStackingContext({
      position: 'fixed',
      zIndex: '9999'
    });
    assert.equal(highZ.isPositioned, true);
    assert.equal(highZ.hasHighZIndex, true);
    assert.equal(highZ.score, 55);

    const staticEl = evaluateStackingContext({
      position: 'static',
      zIndex: '5000'
    });
    assert.equal(staticEl.isPositioned, false);
    assert.equal(staticEl.score, 0);
  });

  it('scores semantic keywords across className, id, and ARIA attributes', () => {
    const paywallEl = createMockNode({
      id: ' reader-paywall-gate ',
      className: 'modal-backdrop interstitial-overlay',
      attrs: { role: 'dialog', 'aria-modal': 'true' }
    });
    const sem = evaluateSemanticSignals(paywallEl);
    assert.ok(sem.matchedKeywords.includes('paywall'));
    assert.ok(sem.matchedKeywords.includes('overlay'));
    assert.ok(sem.matchedKeywords.includes('backdrop'));
    assert.ok(sem.matchedKeywords.includes('gate'));
    assert.ok(sem.matchedKeywords.includes('interstitial'));
    assert.ok(sem.score >= 60);
  });

  it('protects legitimate structural, form, and multimedia elements', () => {
    const protectedTags = ['ARTICLE', 'MAIN', 'NAV', 'FORM', 'VIDEO', 'AUDIO', 'CANVAS', 'IMG'];
    for (const tag of protectedTags) {
      const node = createMockNode({
        tagName: tag,
        id: 'paywall-overlay',
        rect: { width: 1920, height: 1080 },
        computedStyle: { position: 'fixed', zIndex: '9999' }
      });
      assert.equal(isProtectedElement(node), true);
      const res = scoreElement(node, mockWin);
      assert.equal(res.isBarrier, false);
      assert.equal(res.protected, true);
    }

    // Also protects wrapper DIV that contains <article> or <main>
    const appWrapper = createMockNode({
      tagName: 'DIV',
      id: 'app-root',
      rect: { width: 1920, height: 1080 },
      computedStyle: { position: 'fixed', zIndex: '9999' },
      hasProtectedDescendant: true
    });
    assert.equal(isProtectedElement(appWrapper), true);
    assert.equal(scoreElement(appWrapper, mockWin).isBarrier, false);
  });

  it('accurately flags obfuscated and semantic barriers while sparing normal headers', () => {
    // 1. Obfuscated class name barrier (relying purely on geometry + stacking context)
    const obfuscatedBarrier = createMockNode({
      tagName: 'DIV',
      className: 'css-19x8z2a',
      rect: { width: 1900, height: 1050 }, // > 90vw x 90vh
      computedStyle: {
        position: 'fixed',
        zIndex: '2500',
        backgroundColor: 'rgba(0, 0, 0, 0.7)'
      }
    });
    const res1 = scoreElement(obfuscatedBarrier, mockWin);
    assert.equal(res1.isBarrier, true);
    assert.ok(res1.score >= BARRIER_SCORE_THRESHOLD);

    // 2. Normal thin sticky top bar (width 100vw, height 60px, no barrier keywords)
    const normalTopBar = createMockNode({
      tagName: 'DIV',
      className: 'site-utility-bar',
      rect: { width: 1920, height: 60 },
      computedStyle: { position: 'fixed', zIndex: '1000' }
    });
    const res2 = scoreElement(normalTopBar, mockWin);
    assert.equal(res2.isBarrier, false);

    // 3. Sweep neutralizes only barriers
    const mockScope = {
      querySelectorAll() {
        return [obfuscatedBarrier, normalTopBar];
      }
    };
    const sweepResult = sweepBarriers(mockScope, mockWin);
    assert.equal(sweepResult.neutralizedCount, 1);
    assert.equal(obfuscatedBarrier.style.getPropertyValue('display'), 'none');
    assert.equal(obfuscatedBarrier.getAttribute('data-unshackle-neutralized'), 'true');
    assert.equal(normalTopBar.style.getPropertyValue('display'), '');
  });
});

