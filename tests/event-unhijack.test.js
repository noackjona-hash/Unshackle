'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isEditableTarget,
  isProtectedNavigationKeyEvent,
  installEventUnhijacker,
  collectOpenShadowRoots,
  traverseWithShadowDOM
} = require('../src/event-unhijack.js');

function createMockEventTarget(tagName = '') {
  const listeners = new Map();
  return {
    tagName,
    listeners,
    addEventListener(type, fn, options) {
      if (!listeners.has(type)) {
        listeners.set(type, []);
      }
      listeners.get(type).push({ fn, options });
    },
    removeEventListener(type, fn) {
      if (!listeners.has(type)) {
        return;
      }
      const list = listeners.get(type).filter((entry) => entry.fn !== fn);
      listeners.set(type, list);
    },
    dispatchEvent(type, event) {
      const list = listeners.get(type) || [];
      for (const entry of list) {
        entry.fn.call(this, event);
        if (event._immediateStopped) {
          break;
        }
      }
    }
  };
}

describe('Step 4: Event De-hijacking & Shadow DOM Traversal (src/event-unhijack.js)', () => {
  it('neutralizes preventDefault and forces passive:true on wheel, touchmove, and scroll', () => {
    const mockWin = createMockEventTarget();
    const mockDoc = createMockEventTarget();
    mockDoc.documentElement = createMockEventTarget('HTML');
    mockDoc.body = createMockEventTarget('BODY');

    installEventUnhijacker(mockWin, mockDoc);

    // Site script tries to register active scroll-blocking listeners
    let defaultPrevented = false;
    mockWin.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
      },
      { passive: false }
    );

    mockDoc.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
      },
      false
    );

    // Verify passive: true was enforced on the site listener
    const wheelListeners = mockWin.listeners.get('wheel');
    const siteWheelEntry = wheelListeners[wheelListeners.length - 1];
    assert.equal(siteWheelEntry.options.passive, true);

    // Dispatch wheel event and verify preventDefault() was disarmed
    const wheelEvent = {
      type: 'wheel',
      preventDefault() {
        defaultPrevented = true;
      }
    };
    mockWin.dispatchEvent('wheel', wheelEvent);
    assert.equal(defaultPrevented, false);

    // Dispatch touchmove event and verify preventDefault() was disarmed
    const touchEvent = {
      type: 'touchmove',
      preventDefault() {
        defaultPrevented = true;
      }
    };
    mockDoc.dispatchEvent('touchmove', touchEvent);
    assert.equal(defaultPrevented, false);
  });

  it('prevents cancellation of Space, PageDown, and ArrowDown while sparing editable inputs', () => {
    const mockWin = createMockEventTarget();
    const mockDoc = createMockEventTarget();

    installEventUnhijacker(mockWin, mockDoc);

    let siteKeyHandlerRan = false;
    let keyDefaultPrevented = false;

    mockWin.addEventListener('keydown', (e) => {
      siteKeyHandlerRan = true;
      e.preventDefault();
    });

    for (const key of [' ', 'PageDown', 'ArrowDown']) {
      siteKeyHandlerRan = false;
      keyDefaultPrevented = false;

      const keyEvent = {
        type: 'keydown',
        key,
        target: { tagName: 'BODY' },
        preventDefault() {
          keyDefaultPrevented = true;
        },
        stopImmediatePropagation() {
          this._immediateStopped = true;
        }
      };

      assert.equal(isProtectedNavigationKeyEvent(keyEvent), true);
      mockWin.dispatchEvent('keydown', keyEvent);
      assert.equal(keyDefaultPrevented, false);
      assert.equal(siteKeyHandlerRan, false);
    }

    // Editable input targets (<input>, <textarea>, contenteditable) must NOT be intercepted
    const inputTarget = { tagName: 'INPUT', getAttribute: () => null };
    assert.equal(isEditableTarget(inputTarget), true);

    const inputKeyEvent = {
      type: 'keydown',
      key: ' ',
      target: inputTarget,
      preventDefault() {
        keyDefaultPrevented = true;
      },
      stopImmediatePropagation() {
        this._immediateStopped = true;
      }
    };
    assert.equal(isProtectedNavigationKeyEvent(inputKeyEvent), false);
  });

  it('recursively traverses nested open shadowRoot trees', () => {
    const nestedShadowRoot2 = {
      id: 'shadow-level-2',
      querySelectorAll() {
        return [];
      }
    };

    const nestedHost = {
      tagName: 'CUSTOM-MODAL',
      shadowRoot: nestedShadowRoot2
    };

    const shadowRoot1 = {
      id: 'shadow-level-1',
      querySelectorAll() {
        return [nestedHost];
      }
    };

    const topHost = {
      tagName: 'PAYWALL-WIDGET',
      shadowRoot: shadowRoot1
    };

    const rootDoc = {
      id: 'root-doc',
      querySelectorAll() {
        return [topHost, { tagName: 'DIV' }];
      }
    };

    const roots = collectOpenShadowRoots(rootDoc);
    assert.equal(roots.length, 2);
    assert.equal(roots[0], shadowRoot1);
    assert.equal(roots[1], nestedShadowRoot2);

    const visitedScopes = [];
    const shadowCount = traverseWithShadowDOM(rootDoc, (scope) => {
      visitedScopes.push(scope.id);
    });
    assert.equal(shadowCount, 2);
    assert.deepEqual(visitedScopes, [
      'root-doc',
      'shadow-level-1',
      'shadow-level-2'
    ]);
  });
});
