'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  isRelevantMutation,
  runSanitationSweep,
  createObserverController,
  isEmergencyHotkey,
  registerEmergencyHotkey
} = require('../src/content.js');

function createMockSweepEnvironment() {
  const debugLogs = [];
  const logger = {
    debug(msg, payload) {
      debugLogs.push({ msg, payload });
    }
  };

  const barrierNode = {
    tagName: 'DIV',
    id: 'paywall-overlay',
    className: 'interstitial-backdrop',
    _computedStyle: {
      position: 'fixed',
      zIndex: '9999',
      backgroundColor: 'rgba(0,0,0,0.8)'
    },
    _attrs: new Map(),
    style: {
      _props: new Map(),
      setProperty(k, v) {
        this._props.set(k, v);
      },
      getPropertyValue(k) {
        return this._props.get(k) || '';
      }
    },
    getAttribute(k) {
      return this._attrs.get(k) || null;
    },
    setAttribute(k, v) {
      this._attrs.set(k, String(v));
    },
    getBoundingClientRect() {
      return { width: 1920, height: 1080 };
    },
    querySelector() {
      return null;
    }
  };

  const doc = {
    nodeType: 9,
    documentElement: {
      tagName: 'HTML',
      style: {
        setProperty() {}
      },
      getAttribute() {
        return 'overflow: hidden';
      },
      appendChild() {}
    },
    head: {
      appendChild() {}
    },
    body: {
      tagName: 'BODY',
      style: {
        setProperty() {}
      },
      getAttribute() {
        return '';
      }
    },
    createElement() {
      return {
        id: '',
        textContent: '',
        setAttribute() {}
      };
    },
    getElementById() {
      return null;
    },
    querySelectorAll() {
      return [barrierNode];
    }
  };

  const win = {
    innerWidth: 1920,
    innerHeight: 1080,
    getComputedStyle(el) {
      return el._computedStyle || {};
    },
    _keydownHandlers: [],
    addEventListener(type, fn) {
      if (type === 'keydown') {
        this._keydownHandlers.push(fn);
      }
    },
    removeEventListener(type, fn) {
      if (type === 'keydown') {
        this._keydownHandlers = this._keydownHandlers.filter((h) => h !== fn);
      }
    }
  };

  return { doc, win, barrierNode, logger, debugLogs };
}

describe('Step 5: Debounced MutationObserver & Emergency Hotkey Integration (src/content.js)', () => {
  it('filters out self-mutations and tracks relevant DOM mutations', () => {
    const selfMutation = {
      type: 'attributes',
      target: {
        id: 'dom-unshackle-global-styles',
        getAttribute(k) {
          return k === 'data-dom-unshackle' ? 'true' : null;
        }
      }
    };
    assert.equal(isRelevantMutation(selfMutation), false);

    const externalMutation = {
      type: 'childList',
      target: {
        id: 'app',
        getAttribute() {
          return null;
        }
      },
      addedNodes: [{ nodeType: 1, id: 'modal-gate', getAttribute: () => null }]
    };
    assert.equal(isRelevantMutation(externalMutation), true);
  });

  it('disconnects and reconnects MutationObserver during sanitation sweeps and logs structured telemetry', () => {
    const { doc, win, barrierNode, logger, debugLogs } =
      createMockSweepEnvironment();

    const lifecycleEvents = [];

    class MockMutationObserver {
      constructor(cb) {
        this.cb = cb;
      }
      observe() {
        lifecycleEvents.push('observe');
      }
      disconnect() {
        lifecycleEvents.push('disconnect');
      }
    }

    const controller = createObserverController({
      doc,
      win,
      MutationObserverImpl: MockMutationObserver,
      logger
    });

    controller.start();
    assert.equal(controller.isObserving(), true);
    assert.deepEqual(lifecycleEvents, ['observe']);

    const telemetry = runSanitationSweep({
      doc,
      win,
      observerController: controller,
      trigger: 'initial',
      logger
    });

    // Verify disconnect happened before sweep and observe reconnected after sweep
    assert.deepEqual(lifecycleEvents, ['observe', 'disconnect', 'observe']);
    assert.equal(controller.isObserving(), true);

    // Verify barrier was neutralized and structured telemetry logged via console.debug
    assert.equal(telemetry.neutralizedBarriers, 1);
    assert.equal(typeof telemetry.durationMs, 'number');
    assert.equal(barrierNode.getAttribute('data-unshackle-neutralized'), 'true');
    assert.equal(debugLogs.length, 1);
    assert.equal(debugLogs[0].payload.trigger, 'initial');
    assert.equal(debugLogs[0].payload.neutralizedBarriers, 1);
  });

  it('debounces rapid bursts of mutations into a single sanitation sweep', async () => {
    const { doc, win, logger, debugLogs } = createMockSweepEnvironment();
    let capturedCallback = null;

    class MockMutationObserver {
      constructor(cb) {
        capturedCallback = cb;
      }
      observe() {}
      disconnect() {}
    }

    const controller = createObserverController({
      doc,
      win,
      debounceMs: 25,
      MutationObserverImpl: MockMutationObserver,
      logger
    });

    controller.start();

    const sampleMutation = {
      type: 'attributes',
      target: { id: 'body', getAttribute: () => null }
    };

    // Fire 5 rapid mutation batches
    capturedCallback([sampleMutation]);
    capturedCallback([sampleMutation]);
    capturedCallback([sampleMutation]);
    capturedCallback([sampleMutation]);
    capturedCallback([sampleMutation]);

    await new Promise((resolve) => setTimeout(resolve, 60));

    // Only 1 sweep should have executed
    assert.equal(debugLogs.length, 1);
    assert.equal(debugLogs[0].payload.trigger, 'mutation');
    controller.stop();
  });

  it('triggers an emergency manual sweep when Alt + B hotkey is pressed', () => {
    const { doc, win, logger, debugLogs } = createMockSweepEnvironment();

    assert.equal(
      isEmergencyHotkey({ altKey: true, ctrlKey: false, metaKey: false, code: 'KeyB', key: 'b' }),
      true
    );
    assert.equal(
      isEmergencyHotkey({ altKey: false, ctrlKey: true, metaKey: false, code: 'KeyB', key: 'b' }),
      false
    );

    const unregister = registerEmergencyHotkey({
      win,
      doc,
      logger
    });

    let prevented = false;
    win._keydownHandlers[0]({
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      code: 'KeyB',
      key: 'b',
      preventDefault() {
        prevented = true;
      }
    });

    assert.equal(prevented, true);
    assert.equal(debugLogs.length, 1);
    assert.equal(debugLogs[0].payload.trigger, 'hotkey');

    unregister();
    assert.equal(win._keydownHandlers.length, 0);
  });
});
