/**
 * @file src/inject-styles.js
 * @description Global CSS Invalidation Engine for DOM-Unshackle.
 * Initialized at document_start to neutralize scroll locks and blur filters.
 */
'use strict';

(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.DOMUnshackle = root.DOMUnshackle || {};
})();
