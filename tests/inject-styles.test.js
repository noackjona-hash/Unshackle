'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  STYLE_ELEMENT_ID,
  GLOBAL_OVERRIDE_CSS,
  injectGlobalStyles,
  unlockRootScroll,
  stripContainerBlurAndLocks,
  applyGlobalStyleOverrides
} = require('../src/inject-styles.js');

function createMockElement(tagName, initialStyle = '') {
  const attributes = new Map();
  if (initialStyle) {
    attributes.set('style', initialStyle);
  }
  const styleProps = new Map();
  const children = [];

  const style = {
    setProperty(prop, value, priority) {
      styleProps.set(prop, { value, priority: priority || '' });
      const serialized = Array.from(styleProps.entries())
        .map(([k, v]) => `${k}: ${v.value}${v.priority ? ' !' + v.priority : ''}`)
        .join('; ');
      attributes.set('style', serialized);
    },
    getPropertyValue(prop) {
      return styleProps.has(prop) ? styleProps.get(prop).value : '';
    },
    getPropertyPriority(prop) {
      return styleProps.has(prop) ? styleProps.get(prop).priority : '';
    }
  };

  return {
    tagName: tagName.toUpperCase(),
    id: '',
    textContent: '',
    style,
    children,
    setAttribute(name, val) {
      attributes.set(name, String(val));
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    appendChild(child) {
      children.push(child);
      return child;
    }
  };
}

function createMockDocument({ withHead = true, elements = [] } = {}) {
  const head = withHead ? createMockElement('HEAD') : null;
  const documentElement = createMockElement(
    'HTML',
    'overflow: hidden !important; position: fixed !important;'
  );
  const body = createMockElement(
    'BODY',
    'overflow: hidden; max-height: 100vh; touch-action: none; user-select: none; pointer-events: none;'
  );

  const createdStyles = [];

  const doc = {
    nodeType: 9,
    head,
    documentElement,
    body,
    createElement(tag) {
      const el = createMockElement(tag);
      if (tag.toLowerCase() === 'style') {
        createdStyles.push(el);
      }
      return el;
    },
    getElementById(id) {
      return createdStyles.find((el) => el.id === id) || null;
    },
    querySelectorAll() {
      return elements;
    }
  };

  doc.defaultView = {
    getComputedStyle(el) {
      return el._computedStyle || {};
    }
  };
  documentElement.ownerDocument = doc;
  body.ownerDocument = doc;

  return doc;
}

describe('Step 2: Global CSS Invalidation Engine (src/inject-styles.js)', () => {
  it('defines prioritized CSS overriding scroll locks, blur filters, and selection locks', () => {
    assert.match(GLOBAL_OVERRIDE_CSS, /overflow:\s*auto\s*!important/);
    assert.match(GLOBAL_OVERRIDE_CSS, /position:\s*static\s*!important/);
    assert.match(GLOBAL_OVERRIDE_CSS, /max-height:\s*none\s*!important/);
    assert.match(GLOBAL_OVERRIDE_CSS, /touch-action:\s*auto\s*!important/);
    assert.match(GLOBAL_OVERRIDE_CSS, /filter:\s*none\s*!important/);
    assert.match(GLOBAL_OVERRIDE_CSS, /backdrop-filter:\s*none\s*!important/);
    assert.match(GLOBAL_OVERRIDE_CSS, /-webkit-backdrop-filter:\s*none\s*!important/);
    assert.match(GLOBAL_OVERRIDE_CSS, /user-select:\s*auto\s*!important/);
    assert.match(GLOBAL_OVERRIDE_CSS, /pointer-events:\s*auto\s*!important/);
  });

  it('injects stylesheet into <head> or falls back to <html> at document_start', () => {
    const docWithHead = createMockDocument({ withHead: true });
    const styleEl1 = injectGlobalStyles(docWithHead);
    assert.ok(styleEl1);
    assert.equal(styleEl1.id, STYLE_ELEMENT_ID);
    assert.equal(docWithHead.head.children.length, 1);

    // Idempotent on second call
    const styleEl1Again = injectGlobalStyles(docWithHead);
    assert.equal(styleEl1Again, styleEl1);
    assert.equal(docWithHead.head.children.length, 1);

    // Fallback to documentElement when head is null at document_start
    const docWithoutHead = createMockDocument({ withHead: false });
    const styleEl2 = injectGlobalStyles(docWithoutHead);
    assert.ok(styleEl2);
    assert.equal(docWithoutHead.documentElement.children.length, 1);
  });

  it('unlocks inline !important scroll locks on <html> and <body>', () => {
    const doc = createMockDocument();
    const count = unlockRootScroll(doc);
    assert.equal(count, 2);

    assert.equal(doc.documentElement.style.getPropertyValue('overflow'), 'auto');
    assert.equal(doc.documentElement.style.getPropertyPriority('overflow'), 'important');
    assert.equal(doc.documentElement.style.getPropertyValue('position'), 'static');
    assert.equal(doc.body.style.getPropertyValue('max-height'), 'none');
    assert.equal(doc.body.style.getPropertyValue('touch-action'), 'auto');
    assert.equal(doc.body.style.getPropertyValue('user-select'), 'auto');
    assert.equal(doc.body.style.getPropertyValue('pointer-events'), 'auto');
  });

  it('strips inline and computed blur/backdrop-filter from text containers', () => {
    const article = createMockElement(
      'ARTICLE',
      'filter: blur(8px) !important; user-select: none; pointer-events: none;'
    );
    const paragraph = createMockElement('P');
    paragraph._computedStyle = {
      filter: 'blur(5px)',
      backdropFilter: 'blur(10px)',
      color: 'transparent',
      textShadow: '0 0 8px #000'
    };

    const doc = createMockDocument({ elements: [article, paragraph] });
    const count = stripContainerBlurAndLocks(doc, doc.defaultView);
    assert.equal(count, 2);

    assert.equal(article.style.getPropertyValue('filter'), 'none');
    assert.equal(article.style.getPropertyPriority('filter'), 'important');
    assert.equal(article.style.getPropertyValue('user-select'), 'auto');
    assert.equal(article.style.getPropertyValue('pointer-events'), 'auto');

    assert.equal(paragraph.style.getPropertyValue('filter'), 'none');
    assert.equal(paragraph.style.getPropertyValue('backdrop-filter'), 'none');
    assert.equal(paragraph.style.getPropertyValue('-webkit-backdrop-filter'), 'none');
    assert.equal(paragraph.style.getPropertyValue('color'), 'inherit');
    assert.equal(paragraph.style.getPropertyValue('text-shadow'), 'none');

    const summary = applyGlobalStyleOverrides(doc);
    assert.equal(summary.styleInjected, true);
  });
});

