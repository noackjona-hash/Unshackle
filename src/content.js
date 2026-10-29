/**
 * @file src/content.js
 * @description Main Content Script Orchestrator for DOM-Unshackle.
 * Coordinates global CSS overrides, heuristic barrier sweeps across DOM & Shadow DOM,
 * a debounced MutationObserver with disconnect/reconnect cycles, emergency manual
 * sweep hotkey (Alt + B), and structured console.debug telemetry.
 */
'use strict';

(() => {
  const root = typeof globalThis !== 'undefined' ? globalThis : window;
  const namespace = (root.DOMUnshackle = root.DOMUnshackle || {});

  // Resolve sibling modules in both browser content_scripts and Node/CommonJS test environments
  const stylesModule =
    namespace.injectGlobalStyles
      ? namespace
      : typeof require === 'function'
        ? require('./inject-styles.js')
        : {};

  const heuristicsModule =
    namespace.sweepBarriers
      ? namespace
      : typeof require === 'function'
        ? require('./heuristics.js')
        : {};

  const unhijackModule =
    namespace.traverseWithShadowDOM
      ? namespace
      : typeof require === 'function'
        ? require('./event-unhijack.js')
        : {};

  const DEFAULT_DEBOUNCE_MS = 120;

  const OBSERVER_CONFIG = {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      'style',
      'class',
      'id',
      'role',
      'aria-modal',
      'aria-hidden',
      'hidden'
    ]
  };

  /**
   * High-resolution timestamp helper (in milliseconds).
   *
   * @returns {number}
   */
  function nowMs() {
    if (
      typeof performance !== 'undefined' &&
      typeof performance.now === 'function'
    ) {
      return performance.now();
    }
    return Date.now();
  }

  /**
   * Determines whether a MutationRecord is relevant and not caused by DOM-Unshackle itself.
   *
   * @param {MutationRecord} mutation
   * @returns {boolean}
   */
  function isRelevantMutation(mutation) {
    if (!mutation) {
      return false;
    }

    const target = mutation.target;
    if (target && typeof target.getAttribute === 'function') {
      if (
        target.id === stylesModule.STYLE_ELEMENT_ID ||
        target.getAttribute('data-dom-unshackle') === 'true' ||
        target.getAttribute('data-unshackle-neutralized') === 'true'
      ) {
        return false;
      }
    }

    if (mutation.type === 'childList') {
      const added = mutation.addedNodes;
      if (!added || added.length === 0) {
        return false;
      }
      for (let i = 0; i < added.length; i++) {
        const node = added[i];
        if (
          node &&
          node.nodeType === 1 &&
          node.id !== stylesModule.STYLE_ELEMENT_ID &&
          (!node.getAttribute ||
            node.getAttribute('data-dom-unshackle') !== 'true')
        ) {
          return true;
        }
      }
      return false;
    }

    if (mutation.type === 'attributes') {
      return true;
    }

    return false;
  }

  /**
   * Executes a full sanitation sweep across the document and all open ShadowRoot trees.
   * Disconnects the active MutationObserver before mutating the DOM and reconnects
   * in a finally block to guarantee zero infinite mutation loops.
   *
   * @param {Object} [options]
   * @param {Document} [options.doc=document]
   * @param {Window} [options.win=window]
   * @param {Object} [options.observerController=null]
   * @param {string} [options.trigger='manual']
   * @param {Console} [options.logger=console]
   * @returns {{
   *   trigger: string,
   *   durationMs: number,
   *   neutralizedBarriers: number,
   *   unblurredContainers: number,
   *   rootsUnlocked: number,
   *   shadowRootsScanned: number
   * }}
   */
  function runSanitationSweep(options = {}) {
    const doc =
      options.doc || (typeof document !== 'undefined' ? document : null);
    const win = options.win || (typeof window !== 'undefined' ? window : null);
    const observerController = options.observerController || null;
    const trigger = options.trigger || 'manual';
    const logger = options.logger || (typeof console !== 'undefined' ? console : null);

    if (observerController && typeof observerController.pause === 'function') {
      observerController.pause();
    }

    const startTime = nowMs();
    let neutralizedBarriers = 0;
    let unblurredContainers = 0;
    let rootsUnlocked = 0;
    let shadowRootsScanned = 0;

    try {
      if (doc) {
        if (typeof stylesModule.injectGlobalStyles === 'function') {
          stylesModule.injectGlobalStyles(doc);
        }
        if (typeof stylesModule.unlockRootScroll === 'function') {
          rootsUnlocked += stylesModule.unlockRootScroll(doc);
        }

        const sweepScope = (scope) => {
          // Inject stylesheet into nested ShadowRoots
          if (
            scope &&
            scope.nodeType === 11 &&
            typeof stylesModule.injectGlobalStyles === 'function'
          ) {
            stylesModule.injectGlobalStyles(scope);
          }

          if (typeof stylesModule.stripContainerBlurAndLocks === 'function') {
            unblurredContainers += stylesModule.stripContainerBlurAndLocks(
              scope,
              win
            );
          }

          if (typeof heuristicsModule.sweepBarriers === 'function') {
            const sweepResult = heuristicsModule.sweepBarriers(scope, win);
            neutralizedBarriers += sweepResult.neutralizedCount;
          }
        };

        if (typeof unhijackModule.traverseWithShadowDOM === 'function') {
          shadowRootsScanned = unhijackModule.traverseWithShadowDOM(
            doc,
            sweepScope
          );
        } else {
          sweepScope(doc);
        }
      }
    } finally {
      if (
        observerController &&
        typeof observerController.resume === 'function'
      ) {
        observerController.resume();
      }
    }

    const durationMs = Number((nowMs() - startTime).toFixed(2));
    const telemetry = {
      trigger,
      durationMs,
      neutralizedBarriers,
      unblurredContainers,
      rootsUnlocked,
      shadowRootsScanned
    };

    const hasActivity =
      neutralizedBarriers > 0 ||
      unblurredContainers > 0 ||
      rootsUnlocked > 0 ||
      trigger !== 'mutation';

    if (logger && typeof logger.debug === 'function' && hasActivity) {
      logger.debug('[DOM-Unshackle] Sanitation sweep completed:', telemetry);
    }

    return telemetry;
  }

  /**
   * Creates a debounced MutationObserver controller with explicit pause (disconnect)
   * and resume (observe) lifecycle methods.
   *
   * @param {Object} [options]
   * @param {Document} [options.doc=document]
   * @param {Window} [options.win=window]
   * @param {number} [options.debounceMs=120]
   * @param {typeof MutationObserver} [options.MutationObserverImpl]
   * @param {Console} [options.logger=console]
   * @returns {{
   *   start: () => boolean,
   *   pause: () => void,
   *   resume: () => boolean,
   *   stop: () => void,
   *   isObserving: () => boolean,
   *   flush: () => Object|null
   * }}
   */
  function createObserverController(options = {}) {
    const doc =
      options.doc || (typeof document !== 'undefined' ? document : null);
    const win = options.win || (typeof window !== 'undefined' ? window : null);
    const debounceMs =
      typeof options.debounceMs === 'number'
        ? options.debounceMs
        : DEFAULT_DEBOUNCE_MS;
    const ObserverClass =
      options.MutationObserverImpl ||
      (win && win.MutationObserver) ||
      (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
    const logger = options.logger || (typeof console !== 'undefined' ? console : null);

    let observer = null;
    let debounceTimer = null;
    let observing = false;

    const controller = {
      start() {
        if (!ObserverClass || !doc) {
          return false;
        }
        if (!observer) {
          observer = new ObserverClass((mutations) => {
            let hasRelevant = false;
            for (let i = 0; i < mutations.length; i++) {
              if (isRelevantMutation(mutations[i])) {
                hasRelevant = true;
                break;
              }
            }

            if (!hasRelevant) {
              return;
            }

            if (debounceTimer !== null) {
              clearTimeout(debounceTimer);
            }

            debounceTimer = setTimeout(() => {
              debounceTimer = null;
              runSanitationSweep({
                doc,
                win,
                observerController: controller,
                trigger: 'mutation',
                logger
              });
            }, debounceMs);
          });
        }
        return controller.resume();
      },

      pause() {
        if (observer && observing) {
          observer.disconnect();
          observing = false;
        }
      },

      resume() {
        if (!observer || !doc) {
          return false;
        }
        const target = doc.documentElement || doc.body || doc;
        if (!target) {
          return false;
        }
        if (!observing) {
          observer.observe(target, OBSERVER_CONFIG);
          observing = true;
        }
        return true;
      },

      stop() {
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        controller.pause();
      },

      isObserving() {
        return observing;
      },

      flush() {
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
          return runSanitationSweep({
            doc,
            win,
            observerController: controller,
            trigger: 'mutation-flush',
            logger
          });
        }
        return null;
      }
    };

    return controller;
  }

  /**
   * Checks whether a KeyboardEvent matches the emergency manual sweep hotkey (Alt + B).
   *
   * @param {KeyboardEvent|Object} event
   * @returns {boolean}
   */
  function isEmergencyHotkey(event) {
    if (!event || !event.altKey || event.ctrlKey || event.metaKey) {
      return false;
    }

    const code = event.code || '';
    const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';

    return code === 'KeyB' || key === 'b';
  }

  /**
   * Registers the Alt + B emergency manual sweep hotkey on window.
   *
   * @param {Object} [options]
   * @param {Window} [options.win=window]
   * @param {Document} [options.doc=document]
   * @param {Object} [options.observerController=null]
   * @param {Console} [options.logger=console]
   * @returns {Function} Unregister function
   */
  function registerEmergencyHotkey(options = {}) {
    const win = options.win || (typeof window !== 'undefined' ? window : null);
    const doc =
      options.doc || (typeof document !== 'undefined' ? document : null);
    const observerController = options.observerController || null;
    const logger = options.logger || (typeof console !== 'undefined' ? console : null);

    if (!win || typeof win.addEventListener !== 'function') {
      return () => {};
    }

    const handler = (event) => {
      if (!isEmergencyHotkey(event)) {
        return;
      }

      if (typeof event.preventDefault === 'function') {
        event.preventDefault();
      }

      runSanitationSweep({
        doc,
        win,
        observerController,
        trigger: 'hotkey',
        logger
      });
    };

    win.addEventListener('keydown', handler, true);

    return () => {
      if (typeof win.removeEventListener === 'function') {
        win.removeEventListener('keydown', handler, true);
      }
    };
  }

  /**
   * Initializes the full DOM-Unshackle lifecycle on the current page.
   *
   * @param {Window} [win=window]
   * @param {Document} [doc=document]
   * @returns {{ observerController: ReturnType<typeof createObserverController>, unregisterHotkey: Function }}
   */
  function initializeContentScript(win, doc) {
    const view = win || (typeof window !== 'undefined' ? window : null);
    const documentObj =
      doc || (typeof document !== 'undefined' ? document : null);

    const observerController = createObserverController({
      doc: documentObj,
      win: view
    });

    const unregisterHotkey = registerEmergencyHotkey({
      win: view,
      doc: documentObj,
      observerController
    });

    const bootSweep = (triggerName) => {
      runSanitationSweep({
        doc: documentObj,
        win: view,
        observerController,
        trigger: triggerName
      });
      observerController.start();
    };

    if (documentObj) {
      if (documentObj.documentElement) {
        bootSweep('initial');
      }

      if (
        documentObj.readyState === 'loading' &&
        typeof documentObj.addEventListener === 'function'
      ) {
        documentObj.addEventListener(
          'DOMContentLoaded',
          () => bootSweep('dom-content-loaded'),
          { once: true, passive: true }
        );
      }
    }

    if (view && typeof view.addEventListener === 'function') {
      view.addEventListener('load', () => bootSweep('window-load'), {
        once: true,
        passive: true
      });
    }

    return {
      observerController,
      unregisterHotkey
    };
  }

  // Auto-initialize in browser content script context
  if (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    !namespace._initialized
  ) {
    namespace._initialized = true;
    initializeContentScript(window, document);
  }

  const api = {
    DEFAULT_DEBOUNCE_MS,
    OBSERVER_CONFIG,
    isRelevantMutation,
    runSanitationSweep,
    createObserverController,
    isEmergencyHotkey,
    registerEmergencyHotkey,
    initializeContentScript
  };

  Object.assign(namespace, api);

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
