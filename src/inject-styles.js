/**
 * @file src/inject-styles.js
 * @description Global CSS Invalidation Engine for DOM-Unshackle.
 * Injects a high-priority stylesheet at document_start and scrubs inline
 * !important locks on <html>, <body>, and text containers to neutralize
 * scroll locks, CSS blur filters, and selection blockers.
 */
'use strict';

(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  const namespace = (root.DOMUnshackle = root.DOMUnshackle || {});

  const STYLE_ELEMENT_ID = 'dom-unshackle-global-styles';

  const TEXT_CONTAINER_TAGS = new Set([
    'ARTICLE',
    'MAIN',
    'SECTION',
    'P',
    'DIV',
    'SPAN',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'UL',
    'OL',
    'LI',
    'BLOCKQUOTE',
    'PRE',
    'CODE',
    'TD',
    'TH',
    'DD',
    'DT',
    'FIGCAPTION'
  ]);

  /**
   * Prioritized stylesheet injected at document_start.
   * Targets root scroll locks, blur/backdrop filters, and selection locks.
   */
  const GLOBAL_OVERRIDE_CSS = `
/* 1. Root & Body Scroll Lock Neutralization */
html,
body,
html[class],
body[class],
html[style],
body[style] {
  overflow: auto !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
  position: static !important;
  max-height: none !important;
  height: auto !important;
  touch-action: auto !important;
  overscroll-behavior: auto !important;
  pointer-events: auto !important;
  user-select: auto !important;
  -webkit-user-select: auto !important;
}

/* 2. Blur & Backdrop-Filter Neutralization on Text Containers */
article,
main,
section,
p,
div,
span,
h1, h2, h3, h4, h5, h6,
ul, ol, li,
blockquote,
pre,
code,
[style*="blur("],
[class*="blur"],
[data-unshackle-unblurred="true"] {
  filter: none !important;
  -webkit-filter: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* Strip backdrop-filter globally across all elements and pseudo-elements */
*,
*::before,
*::after {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  user-select: auto !important;
  -webkit-user-select: auto !important;
  -moz-user-select: auto !important;
  -ms-user-select: auto !important;
}

/* 3. Restore Text Selection & Pointer Events on Content Elements */
article,
main,
section,
p,
span,
h1, h2, h3, h4, h5, h6,
ul, ol, li,
blockquote,
pre,
code,
a {
  user-select: auto !important;
  -webkit-user-select: auto !important;
  pointer-events: auto !important;
}

/* 4. Unclamped Container Helper Rules */
[data-unshackle-unlocked="true"] {
  overflow: visible !important;
  max-height: none !important;
  height: auto !important;
  mask-image: none !important;
  -webkit-mask-image: none !important;
  filter: none !important;
  -webkit-filter: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  pointer-events: auto !important;
  user-select: auto !important;
}
`.trim();

  /**
   * Injects or re-attaches the prioritized override <style> element into a document or ShadowRoot.
   * Safe to invoke at document_start before <head> or <body> exist.
   *
   * @param {Document|ShadowRoot} [targetRoot=document]
   * @returns {HTMLStyleElement|null}
   */
  function injectGlobalStyles(targetRoot) {
    const doc =
      targetRoot || (typeof document !== 'undefined' ? document : null);
    if (!doc) {
      return null;
    }

    const ownerDoc = doc.nodeType === 9 ? doc : doc.ownerDocument || document;
    if (!ownerDoc || typeof ownerDoc.createElement !== 'function') {
      return null;
    }

    // Check if already injected in this root
    const existing =
      typeof doc.getElementById === 'function'
        ? doc.getElementById(STYLE_ELEMENT_ID)
        : typeof doc.querySelector === 'function'
          ? doc.querySelector(`#${STYLE_ELEMENT_ID}`)
          : null;

    if (existing) {
      if (existing.textContent !== GLOBAL_OVERRIDE_CSS) {
        existing.textContent = GLOBAL_OVERRIDE_CSS;
      }
      return existing;
    }

    const styleEl = ownerDoc.createElement('style');
    styleEl.id = STYLE_ELEMENT_ID;
    styleEl.setAttribute('data-dom-unshackle', 'true');
    styleEl.textContent = GLOBAL_OVERRIDE_CSS;

    // Determine best mount target available at document_start
    const mountTarget =
      doc.nodeType === 11 // ShadowRoot / DocumentFragment
        ? doc
        : doc.head || doc.documentElement || doc.body || null;

    if (mountTarget && typeof mountTarget.appendChild === 'function') {
      mountTarget.appendChild(styleEl);
      return styleEl;
    }

    return null;
  }

  /**
   * Scrubs inline !important scroll locks from <html> and <body>.
   * Inline !important declarations outrank author/user-script <style> !important rules
   * in standard CSS cascade unless explicitly overridden or removed on element.style.
   *
   * @param {Document} [doc=document]
   * @returns {number} Count of root elements whose inline locks were cleared.
   */
  function unlockRootScroll(doc) {
    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc) {
      return 0;
    }

    let modifiedCount = 0;
    const view =
      targetDoc.defaultView || (typeof window !== 'undefined' ? window : null);
    const roots = [targetDoc.documentElement, targetDoc.body].filter(Boolean);

    for (const el of roots) {
      if (!el.style) {
        continue;
      }

      const inlineStyle = el.getAttribute
        ? el.getAttribute('style') || ''
        : '';

      let hasComputedLock = false;
      if (view && typeof view.getComputedStyle === 'function') {
        try {
          const computed = view.getComputedStyle(el);
          if (
            computed &&
            (computed.overflow === 'hidden' ||
              computed.overflowY === 'hidden' ||
              computed.position === 'fixed')
          ) {
            hasComputedLock = true;
          }
        } catch (_err) {
          hasComputedLock = false;
        }
      }

      const hasInlineLock =
        /overflow\s*:\s*(hidden|clip)|position\s*:\s*(fixed|sticky)|max-height\s*:\s*(?!none)|touch-action\s*:\s*none|pointer-events\s*:\s*none|user-select\s*:\s*none|blur\s*\(/i.test(
          inlineStyle
        );

      if (hasInlineLock || hasComputedLock) {
        el.style.setProperty('overflow', 'auto', 'important');
        el.style.setProperty('overflow-y', 'auto', 'important');
        el.style.setProperty('position', 'static', 'important');
        el.style.setProperty('max-height', 'none', 'important');
        el.style.setProperty('touch-action', 'auto', 'important');
        el.style.setProperty('pointer-events', 'auto', 'important');
        el.style.setProperty('user-select', 'auto', 'important');
        el.style.setProperty('-webkit-user-select', 'auto', 'important');
        el.style.setProperty('filter', 'none', 'important');
        el.style.setProperty('backdrop-filter', 'none', 'important');
        el.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
        modifiedCount++;
      }
    }

    return modifiedCount;
  }

  /**
   * Strips inline and computed blur/backdrop-filter effects and selection locks
   * from text containers within the given root.
   *
   * @param {Document|ShadowRoot|Element} [scopeRoot=document]
   * @param {Window} [win=window]
   * @returns {number} Number of text containers neutralized.
   */
  function stripContainerBlurAndLocks(scopeRoot, win) {
    const rootNode =
      scopeRoot || (typeof document !== 'undefined' ? document : null);
    const view =
      win ||
      (rootNode && rootNode.ownerDocument && rootNode.ownerDocument.defaultView) ||
      (typeof window !== 'undefined' ? window : null);

    if (!rootNode || typeof rootNode.querySelectorAll !== 'function') {
      return 0;
    }

    let neutralized = 0;
    const elements = rootNode.querySelectorAll('*');

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (!el || !el.tagName) {
        continue;
      }

      const tag = el.tagName.toUpperCase();
      if (!TEXT_CONTAINER_TAGS.has(tag)) {
        continue;
      }

      let modified = false;
      const styleAttr =
        typeof el.getAttribute === 'function'
          ? el.getAttribute('style') || ''
          : '';

      // 1. Check inline styles for blur, backdrop-filter, user-select, pointer-events
      if (styleAttr && el.style) {
        if (/blur\s*\(|backdrop-filter/i.test(styleAttr)) {
          el.style.setProperty('filter', 'none', 'important');
          el.style.setProperty('-webkit-filter', 'none', 'important');
          el.style.setProperty('backdrop-filter', 'none', 'important');
          el.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
          modified = true;
        }
        if (/user-select\s*:\s*none/i.test(styleAttr)) {
          el.style.setProperty('user-select', 'auto', 'important');
          el.style.setProperty('-webkit-user-select', 'auto', 'important');
          modified = true;
        }
        if (/pointer-events\s*:\s*none/i.test(styleAttr)) {
          el.style.setProperty('pointer-events', 'auto', 'important');
          modified = true;
        }
      }

      // 2. Check computed styles for stylesheet-applied blur or transparent text-shadow obfuscation
      if (view && typeof view.getComputedStyle === 'function' && el.style) {
        const computed = view.getComputedStyle(el);
        if (computed) {
          const filterVal = computed.filter || computed.webkitFilter || '';
          const backdropVal =
            computed.backdropFilter || computed.webkitBackdropFilter || '';

          if (
            /blur\s*\(/i.test(filterVal) ||
            (backdropVal && backdropVal !== 'none')
          ) {
            el.style.setProperty('filter', 'none', 'important');
            el.style.setProperty('-webkit-filter', 'none', 'important');
            el.style.setProperty('backdrop-filter', 'none', 'important');
            el.style.setProperty('-webkit-backdrop-filter', 'none', 'important');
            modified = true;
          }

          // Detect transparent color + text-shadow pseudo-blur technique on text containers
          if (
            (computed.color === 'rgba(0, 0, 0, 0)' ||
              computed.color === 'transparent') &&
            computed.textShadow &&
            computed.textShadow !== 'none'
          ) {
            el.style.setProperty('color', 'inherit', 'important');
            el.style.setProperty('text-shadow', 'none', 'important');
            modified = true;
          }
        }
      }

      if (modified) {
        if (typeof el.setAttribute === 'function') {
          el.setAttribute('data-unshackle-unblurred', 'true');
        }
        neutralized++;
      }
    }

    return neutralized;
  }

  /**
   * Removes the injected global stylesheet from a document or ShadowRoot when disabled via GUI.
   *
   * @param {Document|ShadowRoot} [targetRoot=document]
   * @returns {boolean}
   */
  function removeGlobalStyles(targetRoot) {
    const doc =
      targetRoot || (typeof document !== 'undefined' ? document : null);
    if (!doc) {
      return false;
    }

    const existing =
      typeof doc.getElementById === 'function'
        ? doc.getElementById(STYLE_ELEMENT_ID)
        : typeof doc.querySelector === 'function'
          ? doc.querySelector(`#${STYLE_ELEMENT_ID}`)
          : null;

    if (existing) {
      if (typeof existing.remove === 'function') {
        existing.remove();
      } else if (
        existing.parentNode &&
        typeof existing.parentNode.removeChild === 'function'
      ) {
        existing.parentNode.removeChild(existing);
      }
      return true;
    }

    return false;
  }

  /**
   * Executes the full CSS invalidation pass: ensures the prioritized stylesheet
   * is mounted, unlocks <html>/<body> scroll properties, and strips blur filters.
   *
   * @param {Document} [doc=document]
   * @returns {{ styleInjected: boolean, rootsUnlocked: number, containersUnblurred: number }}
   */
  function applyGlobalStyleOverrides(doc) {
    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    const styleEl = injectGlobalStyles(targetDoc);
    const rootsUnlocked = unlockRootScroll(targetDoc);
    const containersUnblurred = stripContainerBlurAndLocks(targetDoc);

    return {
      styleInjected: Boolean(styleEl),
      rootsUnlocked,
      containersUnblurred
    };
  }

  // Bootstrap immediately at document_start when running in browser context
  if (typeof document !== 'undefined') {
    injectGlobalStyles(document);
    unlockRootScroll(document);

    if (
      document.readyState === 'loading' &&
      typeof document.addEventListener === 'function'
    ) {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          applyGlobalStyleOverrides(document);
        },
        { once: true, passive: true }
      );
    }
  }

  const api = {
    STYLE_ELEMENT_ID,
    GLOBAL_OVERRIDE_CSS,
    TEXT_CONTAINER_TAGS,
    injectGlobalStyles,
    removeGlobalStyles,
    unlockRootScroll,
    stripContainerBlurAndLocks,
    applyGlobalStyleOverrides
  };

  Object.assign(namespace, api);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
