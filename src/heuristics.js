/**
 * @file src/heuristics.js
 * @description Heuristic Overlay & Barrier Detection Engine for DOM-Unshackle.
 * Implements zero-blacklist multi-signal DOM scoring based on:
 *  1. Viewport coverage geometry (>= 90vw and >= 90vh, or curtain geometry)
 *  2. Stacking context inspection (position fixed/absolute + z-index >= 1000)
 *  3. Semantic keyword scoring across class names, IDs, and ARIA attributes
 *  4. Structural safe-guards protecting <article>, <main>, <nav>, forms, and media
 */
'use strict';

(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  const namespace = (root.DOMUnshackle = root.DOMUnshackle || {});

  const BARRIER_SCORE_THRESHOLD = 60;
  const VIEWPORT_COVERAGE_RATIO = 0.9;
  const HIGH_Z_INDEX_THRESHOLD = 1000;

  /**
   * Explicitly protected structural, form, and multimedia tags.
   */
  const PROTECTED_TAGS = new Set([
    'HTML',
    'HEAD',
    'BODY',
    'STYLE',
    'SCRIPT',
    'LINK',
    'META',
    'TITLE',
    'NOSCRIPT',
    'ARTICLE',
    'MAIN',
    'NAV',
    'HEADER',
    'FOOTER',
    'FORM',
    'INPUT',
    'TEXTAREA',
    'SELECT',
    'OPTION',
    'BUTTON',
    'LABEL',
    'FIELDSET',
    'LEGEND',
    'VIDEO',
    'AUDIO',
    'CANVAS',
    'SVG',
    'PATH',
    'IMG',
    'PICTURE',
    'SOURCE',
    'TRACK',
    'TABLE',
    'THEAD',
    'TBODY',
    'TR',
    'TD',
    'TH'
  ]);

  /**
   * Explicitly protected ARIA roles representing legitimate page landmarks.
   */
  const PROTECTED_ROLES = new Set([
    'main',
    'article',
    'navigation',
    'banner',
    'contentinfo',
    'search',
    'form',
    'region'
  ]);

  /**
   * Primary semantic tokens indicative of paywalls, overlays, and interstitial gates.
   */
  const SEMANTIC_BARRIER_KEYWORDS = [
    'paywall',
    'overlay',
    'backdrop',
    'barrier',
    'gate',
    'interstitial',
    'regwall',
    'hardwall',
    'meterwall',
    'scrolllock',
    'scroll-lock',
    'modal-backdrop',
    'subscribe-wall'
  ];

  /**
   * Secondary semantic tokens that reinforce barrier classification.
   */
  const SECONDARY_MODAL_KEYWORDS = [
    'modal',
    'dialog',
    'popup',
    'blocker',
    'curtain',
    'obfuscate',
    ' wall ',
    '-wall',
    '_wall'
  ];

  /**
   * Extracts normalized string value from an element's className, ID, and ARIA attributes.
   *
   * @param {Element} el
   * @returns {string}
   */
  function extractSemanticText(el) {
    if (!el) {
      return '';
    }

    const parts = [];

    if (typeof el.id === 'string' && el.id) {
      parts.push(el.id);
    }

    if (el.className) {
      if (typeof el.className === 'string') {
        parts.push(el.className);
      } else if (typeof el.className.baseVal === 'string') {
        parts.push(el.className.baseVal);
      }
    }

    if (typeof el.getAttribute === 'function') {
      const attrs = [
        'role',
        'aria-label',
        'aria-labelledby',
        'aria-describedby',
        'data-testid',
        'data-component',
        'data-overlay',
        'data-paywall'
      ];
      for (const attr of attrs) {
        const val = el.getAttribute(attr);
        if (val) {
          parts.push(val);
        }
      }
    }

    return parts.join(' ').toLowerCase();
  }

  /**
   * Safe-guard mechanism: determines whether an element is a protected structural,
   * form, or multimedia node, or an ancestor of core page landmarks (<article>, <main>, <nav>).
   *
   * @param {Element} el
   * @returns {boolean}
   */
  function isProtectedElement(el) {
    if (!el || !el.tagName) {
      return true;
    }

    const tag = el.tagName.toUpperCase();
    if (PROTECTED_TAGS.has(tag)) {
      return true;
    }

    if (typeof el.getAttribute === 'function') {
      if (
        el.getAttribute('data-dom-unshackle') === 'true' ||
        el.getAttribute('data-unshackle-ignore') === 'true'
      ) {
        return true;
      }

      const role = (el.getAttribute('role') || '').trim().toLowerCase();
      if (role && PROTECTED_ROLES.has(role)) {
        return true;
      }
    }

    // Never neutralize an ancestor container that wraps the page's <article>, <main>, or <nav>
    if (typeof el.querySelector === 'function') {
      const landmarkChild = el.querySelector(
        'article, main, nav, [role="main"], [role="article"], [role="navigation"], video, audio, canvas'
      );
      if (landmarkChild) {
        return true;
      }
    }

    return false;
  }

  /**
   * Evaluates viewport coverage geometry of an element's bounding client rect.
   *
   * @param {Element} el
   * @param {Window} [win=window]
   * @returns {{ coversViewport: boolean, isCurtain: boolean, widthRatio: number, heightRatio: number, score: number, reason: string|null }}
   */
  function evaluateViewportCoverage(el, win) {
    const view = win || (typeof window !== 'undefined' ? window : null);
    const vw =
      (view && Number(view.innerWidth)) ||
      (view &&
        view.document &&
        view.document.documentElement &&
        view.document.documentElement.clientWidth) ||
      0;
    const vh =
      (view && Number(view.innerHeight)) ||
      (view &&
        view.document &&
        view.document.documentElement &&
        view.document.documentElement.clientHeight) ||
      0;

    if (
      !el ||
      typeof el.getBoundingClientRect !== 'function' ||
      vw <= 0 ||
      vh <= 0
    ) {
      return {
        coversViewport: false,
        isCurtain: false,
        widthRatio: 0,
        heightRatio: 0,
        score: 0,
        reason: null
      };
    }

    let rect = null;
    try {
      rect = el.getBoundingClientRect();
    } catch (_err) {
      rect = null;
    }
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return {
        coversViewport: false,
        isCurtain: false,
        widthRatio: 0,
        heightRatio: 0,
        score: 0,
        reason: null
      };
    }

    const widthRatio = rect.width / vw;
    const heightRatio = rect.height / vh;

    // Primary Check: >= 90vw and >= 90vh
    if (
      widthRatio >= VIEWPORT_COVERAGE_RATIO &&
      heightRatio >= VIEWPORT_COVERAGE_RATIO
    ) {
      return {
        coversViewport: true,
        isCurtain: false,
        widthRatio,
        heightRatio,
        score: 35,
        reason: 'viewport-coverage>=90vwx90vh'
      };
    }

    // Secondary Check: Wide curtain/banner overlay spanning >= 85vw and >= 35vh
    if (widthRatio >= 0.85 && heightRatio >= 0.35) {
      return {
        coversViewport: false,
        isCurtain: true,
        widthRatio,
        heightRatio,
        score: 15,
        reason: 'viewport-curtain-coverage'
      };
    }

    return {
      coversViewport: false,
      isCurtain: false,
      widthRatio,
      heightRatio,
      score: 0,
      reason: null
    };
  }

  /**
   * Inspects computed stacking context (position fixed/absolute and z-index >= 1000).
   *
   * @param {CSSStyleDeclaration|null} computedStyle
   * @returns {{ isPositioned: boolean, position: string, zIndex: number, hasHighZIndex: boolean, score: number, reasons: string[] }}
   */
  function evaluateStackingContext(computedStyle) {
    if (!computedStyle) {
      return {
        isPositioned: false,
        position: 'static',
        zIndex: 0,
        hasHighZIndex: false,
        score: 0,
        reasons: []
      };
    }

    const position = (computedStyle.position || 'static').toLowerCase();
    const isFixed = position === 'fixed';
    const isAbsolute = position === 'absolute';
    const isPositioned = isFixed || isAbsolute;

    const rawZ = parseInt(computedStyle.zIndex, 10);
    const zIndex = Number.isFinite(rawZ) ? rawZ : 0;
    const hasHighZIndex = zIndex >= HIGH_Z_INDEX_THRESHOLD;

    let score = 0;
    const reasons = [];

    if (isFixed) {
      score += 25;
      reasons.push('position:fixed');
    } else if (isAbsolute) {
      score += 20;
      reasons.push('position:absolute');
    }

    if (isPositioned && hasHighZIndex) {
      score += 30;
      reasons.push(`z-index:${zIndex}>=1000`);
    } else if (isPositioned && zIndex >= 100) {
      score += 15;
      reasons.push(`z-index:${zIndex}>=100`);
    }

    return {
      isPositioned,
      position,
      zIndex,
      hasHighZIndex,
      score,
      reasons
    };
  }

  /**
   * Scores semantic indicators across class names, IDs, and ARIA roles/attributes.
   *
   * @param {Element} el
   * @returns {{ matchedKeywords: string[], score: number, reasons: string[] }}
   */
  function evaluateSemanticSignals(el) {
    if (!el) {
      return { matchedKeywords: [], score: 0, reasons: [] };
    }

    const text = extractSemanticText(el);
    const matchedKeywords = [];
    const reasons = [];
    let score = 0;

    for (const kw of SEMANTIC_BARRIER_KEYWORDS) {
      if (text.includes(kw)) {
        matchedKeywords.push(kw);
      }
    }

    if (matchedKeywords.length > 0) {
      // +30 for the first primary semantic match, +10 for each additional match (max +50)
      score += Math.min(50, 30 + (matchedKeywords.length - 1) * 10);
      reasons.push(`semantic:${matchedKeywords.join(',')}`);
    } else {
      for (const secondaryKw of SECONDARY_MODAL_KEYWORDS) {
        if (text.includes(secondaryKw)) {
          matchedKeywords.push(secondaryKw.trim());
          score += 15;
          reasons.push(`semantic-secondary:${secondaryKw.trim()}`);
          break;
        }
      }
    }

    if (typeof el.getAttribute === 'function') {
      const role = (el.getAttribute('role') || '').trim().toLowerCase();
      const ariaModal = (el.getAttribute('aria-modal') || '')
        .trim()
        .toLowerCase();

      if (
        ariaModal === 'true' ||
        role === 'dialog' ||
        role === 'alertdialog'
      ) {
        score += 15;
        reasons.push(`aria:${role || 'aria-modal'}`);
      }
    }

    return {
      matchedKeywords,
      score,
      reasons
    };
  }

  /**
   * Computes the composite heuristic barrier score for a DOM element.
   *
   * @param {Element} el
   * @param {Window} [win=window]
   * @returns {{
   *   score: number,
   *   threshold: number,
   *   isBarrier: boolean,
   *   protected: boolean,
   *   reasons: string[],
   *   metrics: {
   *     coverage: ReturnType<typeof evaluateViewportCoverage>,
   *     stacking: ReturnType<typeof evaluateStackingContext>,
   *     semantics: ReturnType<typeof evaluateSemanticSignals>
   *   } | null
   * }}
   */
  function scoreElement(el, win) {
    if (!el || isProtectedElement(el)) {
      return {
        score: 0,
        threshold: BARRIER_SCORE_THRESHOLD,
        isBarrier: false,
        protected: true,
        reasons: ['protected-element'],
        metrics: null
      };
    }

    if (
      typeof el.getAttribute === 'function' &&
      el.getAttribute('data-unshackle-neutralized') === 'true'
    ) {
      return {
        score: 0,
        threshold: BARRIER_SCORE_THRESHOLD,
        isBarrier: false,
        protected: false,
        reasons: ['already-neutralized'],
        metrics: null
      };
    }

    const view =
      win ||
      (el.ownerDocument && el.ownerDocument.defaultView) ||
      (typeof window !== 'undefined' ? window : null);

    const computedStyle =
      view && typeof view.getComputedStyle === 'function'
        ? view.getComputedStyle(el)
        : el._computedStyle || null;

    if (
      computedStyle &&
      (computedStyle.display === 'none' ||
        computedStyle.visibility === 'hidden')
    ) {
      return {
        score: 0,
        threshold: BARRIER_SCORE_THRESHOLD,
        isBarrier: false,
        protected: false,
        reasons: ['already-hidden'],
        metrics: null
      };
    }

    const coverage = evaluateViewportCoverage(el, view);
    const stacking = evaluateStackingContext(computedStyle);
    const semantics = evaluateSemanticSignals(el);

    let totalScore = coverage.score + stacking.score + semantics.score;
    const reasons = [];

    if (coverage.reason) {
      reasons.push(coverage.reason);
    }
    reasons.push(...stacking.reasons, ...semantics.reasons);

    // Additional signal: semi-transparent dimmer or backdrop-filter on positioned layer
    if (stacking.isPositioned && computedStyle) {
      const bg = computedStyle.backgroundColor || '';
      const bgImage = computedStyle.backgroundImage || '';
      const backdrop =
        computedStyle.backdropFilter || computedStyle.webkitBackdropFilter || '';

      if (
        /rgba\s*\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*(0\.[1-9]|1(\.0)?)/i.test(
          bg
        ) ||
        /linear-gradient/i.test(bgImage) ||
        (backdrop && backdrop !== 'none')
      ) {
        totalScore += 15;
        reasons.push('visual-backdrop-dimmer');
      }
    }

    // Require at least an elevated stacking context OR strong semantic barrier match + coverage
    const isBarrier =
      totalScore >= BARRIER_SCORE_THRESHOLD &&
      (stacking.isPositioned ||
        (coverage.coversViewport && semantics.matchedKeywords.length > 0));

    return {
      score: totalScore,
      threshold: BARRIER_SCORE_THRESHOLD,
      isBarrier,
      protected: false,
      reasons,
      metrics: {
        coverage,
        stacking,
        semantics
      }
    };
  }

  /**
   * Neutralizes a detected barrier element without breaking SPA virtual DOM trees.
   * Uses inline !important hiding declarations so React/Next.js/Vue reconciliation
   * never throws NotFoundError on detached nodes.
   *
   * @param {Element} el
   * @returns {boolean}
   */
  function neutralizeBarrier(el) {
    if (!el || isProtectedElement(el) || !el.style) {
      return false;
    }

    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('visibility', 'hidden', 'important');
    el.style.setProperty('opacity', '0', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
    el.style.setProperty('z-index', '-9999', 'important');
    el.style.setProperty('width', '0', 'important');
    el.style.setProperty('height', '0', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');

    if (typeof el.setAttribute === 'function') {
      el.setAttribute('data-unshackle-neutralized', 'true');
      el.setAttribute('aria-hidden', 'true');
    }

    return true;
  }

  /**
   * Scans a root node (Document, ShadowRoot, or Element) for barriers and neutralizes them.
   *
   * @param {Document|ShadowRoot|Element} [rootNode=document]
   * @param {Window} [win=window]
   * @returns {{ neutralizedCount: number, neutralizedElements: Array<{ element: Element, score: number, reasons: string[] }> }}
   */
  function sweepBarriers(rootNode, win) {
    const scope =
      rootNode || (typeof document !== 'undefined' ? document : null);
    if (!scope || typeof scope.querySelectorAll !== 'function') {
      return { neutralizedCount: 0, neutralizedElements: [] };
    }

    const candidates = scope.querySelectorAll('*');
    const neutralizedElements = [];

    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      const evaluation = scoreElement(el, win);

      if (evaluation.isBarrier) {
        if (neutralizeBarrier(el)) {
          neutralizedElements.push({
            element: el,
            score: evaluation.score,
            reasons: evaluation.reasons
          });
        }
      }
    }

    return {
      neutralizedCount: neutralizedElements.length,
      neutralizedElements
    };
  }

  const api = {
    BARRIER_SCORE_THRESHOLD,
    VIEWPORT_COVERAGE_RATIO,
    HIGH_Z_INDEX_THRESHOLD,
    PROTECTED_TAGS,
    PROTECTED_ROLES,
    SEMANTIC_BARRIER_KEYWORDS,
    isProtectedElement,
    evaluateViewportCoverage,
    evaluateStackingContext,
    evaluateSemanticSignals,
    scoreElement,
    neutralizeBarrier,
    sweepBarriers
  };

  Object.assign(namespace, api);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
