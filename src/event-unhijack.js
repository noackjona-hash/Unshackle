/**
 * @file src/event-unhijack.js
 * @description Event De-hijacking & Shadow DOM Traversal Engine for DOM-Unshackle.
 * Prevents scroll/navigation event suppression and traverses open Shadow DOM roots.
 */
'use strict';

(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  root.DOMUnshackle = root.DOMUnshackle || {};
})();
