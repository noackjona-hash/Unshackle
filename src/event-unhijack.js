/**
 * @file src/event-unhijack.js
 * @description Event De-hijacking & Shadow DOM Traversal Engine for DOM-Unshackle.
 * Neutralizes passive/active scroll & navigation event suppression on window/document
 * and recursively traverses open shadowRoot trees to neutralize nested barriers.
 */
'use strict';

(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  const namespace = (root.DOMUnshackle = root.DOMUnshackle || {});

  /**
   * Scroll and touch events targeted by page-level scroll-lock scripts.
   */
  const PROTECTED_SCROLL_EVENTS = new Set(['wheel', 'touchmove', 'scroll']);

  /**
   * Keyboard navigation keys targeted by page-level scroll-lock scripts.
   */
  const PROTECTED_NAVIGATION_KEYS = new Set([
    ' ',
    'Space',
    'Spacebar',
    'PageDown',
    'ArrowDown',
    'PageUp',
    'ArrowUp',
    'Home',
    'End'
  ]);

  /**
   * Interactive/editable tags where keyboard events must never be intercepted.
   */
  const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);

  /**
   * Checks whether an event target is an interactive text input or editable element.
   *
   * @param {EventTarget|Element|null} target
   * @returns {boolean}
   */
  function isEditableTarget(target) {
    if (!target || typeof target !== 'object') {
      return false;
    }

    const tag = target.tagName ? String(target.tagName).toUpperCase() : '';
    if (EDITABLE_TAGS.has(tag)) {
      return true;
    }

    if (target.isContentEditable === true) {
      return true;
    }

    if (typeof target.getAttribute === 'function') {
      const contentEditable = target.getAttribute('contenteditable');
      if (contentEditable === '' || contentEditable === 'true') {
        return true;
      }
      const role = (target.getAttribute('role') || '').toLowerCase();
      if (role === 'textbox' || role === 'searchbox' || role === 'combobox') {
        return true;
      }
    }

    return false;
  }

  /**
   * Determines whether a KeyboardEvent corresponds to a protected scroll navigation key.
   *
   * @param {KeyboardEvent|Object} event
   * @returns {boolean}
   */
  function isProtectedNavigationKeyEvent(event) {
    if (!event) {
      return false;
    }

    // Ignore modified shortcuts (Ctrl, Alt, Meta)
    if (event.ctrlKey || event.altKey || event.metaKey) {
      return false;
    }

    if (isEditableTarget(event.target)) {
      return false;
    }

    const key = event.key || '';
    const code = event.code || '';

    return (
      PROTECTED_NAVIGATION_KEYS.has(key) || PROTECTED_NAVIGATION_KEYS.has(code)
    );
  }

  /**
   * Neutralizes preventDefault() on an event object so downstream listeners cannot cancel
   * native browser scrolling or navigation key actions.
   *
   * @param {Event|Object} event
   * @returns {Event|Object}
   */
  function disarmEventPreventDefault(event) {
    if (!event || typeof event !== 'object') {
      return event;
    }

    try {
      Object.defineProperty(event, 'preventDefault', {
        value: function noopPreventDefault() {},
        writable: true,
        configurable: true
      });
    } catch (_) {
      try {
        event.preventDefault = function noopPreventDefault() {};
      } catch (_ignored) {
        // Event property is non-configurable in this environment
      }
    }

    return event;
  }

  /**
   * Determines if an EventTarget is a global root target (window, document, <html>, <body>).
   *
   * @param {EventTarget} target
   * @param {Window} [win=window]
   * @param {Document} [doc=document]
   * @returns {boolean}
   */
  function isRootScrollTarget(target, win, doc) {
    if (!target) {
      return false;
    }
    const view = win || (typeof window !== 'undefined' ? window : null);
    const documentObj =
      doc || (typeof document !== 'undefined' ? document : null);

    if (target === view || target === documentObj) {
      return true;
    }

    if (
      documentObj &&
      (target === documentObj.documentElement || target === documentObj.body)
    ) {
      return true;
    }

    const tag = target.tagName ? String(target.tagName).toUpperCase() : '';
    return tag === 'HTML' || tag === 'BODY';
  }

  /**
   * Normalizes addEventListener options to force `{ passive: true }` on scroll-related events.
   *
   * @param {boolean|AddEventListenerOptions|undefined} options
   * @returns {AddEventListenerOptions}
   */
  function enforcePassiveOption(options) {
    if (typeof options === 'boolean') {
      return { capture: options, passive: true };
    }
    if (options && typeof options === 'object') {
      return Object.assign({}, options, { passive: true });
    }
    return { passive: true };
  }

  /**
   * Wraps a site-provided event listener to prevent it from canceling protected scroll
   * or keyboard navigation events.
   *
   * @param {string} type
   * @param {Function|EventListenerObject} listener
   * @returns {Function}
   */
  function createUnhijackedListenerWrapper(type, listener) {
    const normalizedType = String(type || '').toLowerCase();

    return function unhijackedEventHandler(event) {
      if (
        PROTECTED_SCROLL_EVENTS.has(normalizedType) ||
        (normalizedType === 'keydown' && isProtectedNavigationKeyEvent(event))
      ) {
        disarmEventPreventDefault(event);
      }

      if (typeof listener === 'function') {
        return listener.call(this, event);
      }
      if (listener && typeof listener.handleEvent === 'function') {
        return listener.handleEvent(event);
      }
    };
  }

  /**
   * Patches addEventListener on a target or prototype to intercept scroll-locking listeners
   * on window, document, <html>, and <body>.
   *
   * @param {Object} targetObj - EventTarget prototype, window, or document
   * @param {Window} [win=window]
   * @param {Document} [doc=document]
   * @returns {boolean} True if patched successfully
   */
  function patchAddEventListener(targetObj, win, doc) {
    if (
      !targetObj ||
      typeof targetObj.addEventListener !== 'function' ||
      targetObj.addEventListener._unshacklePatched
    ) {
      return false;
    }

    const originalAddEventListener = targetObj.addEventListener;
    const originalRemoveEventListener = targetObj.removeEventListener;
    const wrapperMap = new WeakMap();

    function patchedAddEventListener(type, listener, options) {
      const normalizedType = String(type || '').toLowerCase();

      if (
        listener &&
        (typeof listener === 'function' ||
          typeof listener.handleEvent === 'function') &&
        isRootScrollTarget(this, win, doc) &&
        (PROTECTED_SCROLL_EVENTS.has(normalizedType) ||
          normalizedType === 'keydown')
      ) {
        let typeMap = wrapperMap.get(listener);
        if (!typeMap) {
          typeMap = new Map();
          wrapperMap.set(listener, typeMap);
        }

        let wrapped = typeMap.get(normalizedType);
        if (!wrapped) {
          wrapped = createUnhijackedListenerWrapper(normalizedType, listener);
          typeMap.set(normalizedType, wrapped);
        }

        const safeOptions = PROTECTED_SCROLL_EVENTS.has(normalizedType)
          ? enforcePassiveOption(options)
          : options;

        return originalAddEventListener.call(
          this,
          type,
          wrapped,
          safeOptions
        );
      }

      return originalAddEventListener.call(this, type, listener, options);
    }

    patchedAddEventListener._unshacklePatched = true;
    patchedAddEventListener._original = originalAddEventListener;
    targetObj.addEventListener = patchedAddEventListener;

    if (typeof originalRemoveEventListener === 'function') {
      function patchedRemoveEventListener(type, listener, options) {
        const normalizedType = String(type || '').toLowerCase();
        if (listener && (typeof listener === 'function' || typeof listener === 'object')) {
          const typeMap = wrapperMap.get(listener);
          const wrapped = typeMap ? typeMap.get(normalizedType) : null;
          if (wrapped) {
            return originalRemoveEventListener.call(
              this,
              type,
              wrapped,
              options
            );
          }
        }
        return originalRemoveEventListener.call(this, type, listener, options);
      }
      patchedRemoveEventListener._unshacklePatched = true;
      targetObj.removeEventListener = patchedRemoveEventListener;
    }

    return true;
  }

  /**
   * Installs preemptive capture-phase listeners at document_start on window and document
   * to disarm preventDefault() and stop hostile scroll-lock suppression.
   *
   * @param {Window} [win=window]
   * @param {Document} [doc=document]
   * @returns {{ installed: boolean }}
   */
  function installEventUnhijacker(win, doc) {
    const view = win || (typeof window !== 'undefined' ? window : null);
    const documentObj =
      doc || (typeof document !== 'undefined' ? document : null);

    if (!view && !documentObj) {
      return { installed: false };
    }

    const targets = [view, documentObj].filter(Boolean);

    // 1. Patch addEventListener on EventTarget.prototype or individual root targets
    if (
      view &&
      view.EventTarget &&
      view.EventTarget.prototype &&
      typeof view.EventTarget.prototype.addEventListener === 'function'
    ) {
      patchAddEventListener(view.EventTarget.prototype, view, documentObj);
    } else {
      for (const t of targets) {
        patchAddEventListener(t, view, documentObj);
      }
    }

    // 2. Register capture-phase guards on window and document
    const scrollCaptureGuard = (event) => {
      disarmEventPreventDefault(event);
    };

    const keydownCaptureGuard = (event) => {
      if (isProtectedNavigationKeyEvent(event)) {
        disarmEventPreventDefault(event);
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
      }
    };

    for (const target of targets) {
      if (
        !target ||
        typeof target.addEventListener !== 'function' ||
        target._unshackleCaptureInstalled
      ) {
        continue;
      }

      const addRaw =
        target.addEventListener._original || target.addEventListener;

      for (const evtName of PROTECTED_SCROLL_EVENTS) {
        addRaw.call(target, evtName, scrollCaptureGuard, {
          capture: true,
          passive: true
        });
      }

      addRaw.call(target, 'keydown', keydownCaptureGuard, {
        capture: true,
        passive: true
      });

      target._unshackleCaptureInstalled = true;
    }

    return { installed: true };
  }

  /**
   * Recursively discovers all open ShadowRoot instances within a root DOM tree.
   *
   * @param {Document|ShadowRoot|Element} [rootNode=document]
   * @param {number} [maxDepth=15]
   * @returns {ShadowRoot[]}
   */
  function collectOpenShadowRoots(rootNode, maxDepth = 15) {
    const startNode =
      rootNode || (typeof document !== 'undefined' ? document : null);
    if (!startNode) {
      return [];
    }

    const discovered = [];
    const visited = new Set();

    function walk(scope, depth) {
      if (!scope || depth > maxDepth || visited.has(scope)) {
        return;
      }
      visited.add(scope);

      if (typeof scope.querySelectorAll !== 'function') {
        return;
      }

      const elements = scope.querySelectorAll('*');
      for (let i = 0; i < elements.length; i++) {
        const el = elements[i];
        if (el && el.shadowRoot && !visited.has(el.shadowRoot)) {
          discovered.push(el.shadowRoot);
          walk(el.shadowRoot, depth + 1);
        }
      }
    }

    walk(startNode, 0);
    return discovered;
  }

  /**
   * Executes a callback across the main root and every nested open ShadowRoot.
   *
   * @param {Document|ShadowRoot|Element} rootNode
   * @param {(scope: Document|ShadowRoot|Element) => void} callback
   * @returns {number} Number of shadow roots traversed
   */
  function traverseWithShadowDOM(rootNode, callback) {
    const startNode =
      rootNode || (typeof document !== 'undefined' ? document : null);
    if (!startNode || typeof callback !== 'function') {
      return 0;
    }

    callback(startNode);

    const shadowRoots = collectOpenShadowRoots(startNode);
    for (let i = 0; i < shadowRoots.length; i++) {
      callback(shadowRoots[i]);
    }

    return shadowRoots.length;
  }

  // Bootstrap event de-hijacking immediately at document_start in browser context
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    installEventUnhijacker(window, document);
  }

  const api = {
    PROTECTED_SCROLL_EVENTS,
    PROTECTED_NAVIGATION_KEYS,
    isEditableTarget,
    isProtectedNavigationKeyEvent,
    disarmEventPreventDefault,
    enforcePassiveOption,
    createUnhijackedListenerWrapper,
    patchAddEventListener,
    installEventUnhijacker,
    collectOpenShadowRoots,
    traverseWithShadowDOM
  };

  Object.assign(namespace, api);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
