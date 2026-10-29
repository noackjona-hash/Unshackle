/**
 * @file src/popup.js
 * @description Extension Popup GUI Controller for DOM-Unshackle.
 * Manages global settings, per-domain whitelisting, heuristic threshold tuning,
 * live telemetry display, and manual sanitation sweeps.
 */
'use strict';

(() => {
  const STORAGE_KEY = 'domUnshackleSettings';

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    cssUnlock: true,
    heuristicSweep: true,
    eventUnhijack: true,
    threshold: 60,
    disabledHosts: []
  });

  /**
   * Formats a numeric heuristic threshold into a human-readable German label.
   *
   * @param {number} value
   * @returns {string}
   */
  function formatThresholdLabel(value) {
    const num = Number(value) || 60;
    if (num <= 50) {
      return `${num} (Aggressiv)`;
    }
    if (num >= 70) {
      return `${num} (Vorsichtig)`;
    }
    return `${num} (Standard)`;
  }

  /**
   * Updates the disabledHosts list when toggling a domain on or off.
   *
   * @param {string[]} disabledHosts
   * @param {string} hostname
   * @param {boolean} enabledOnHost
   * @returns {string[]}
   */
  function toggleHostInList(disabledHosts, hostname, enabledOnHost) {
    const cleanHost = String(hostname || '')
      .trim()
      .toLowerCase();
    const list = Array.isArray(disabledHosts)
      ? disabledHosts.map((h) => String(h).trim().toLowerCase()).filter(Boolean)
      : [];

    if (!cleanHost) {
      return list;
    }

    const filtered = list.filter((h) => h !== cleanHost);
    if (!enabledOnHost) {
      filtered.push(cleanHost);
    }
    return filtered;
  }

  /**
   * Extracts hostname from a tab URL string.
   *
   * @param {string} urlStr
   * @returns {string}
   */
  function extractHostname(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') {
      return '';
    }
    try {
      const parsed = new URL(urlStr);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.hostname.toLowerCase();
      }
      return '';
    } catch (_err) {
      return '';
    }
  }

  /**
   * Initializes the Popup UI in the browser window.
   */
  function initPopupUI() {
    if (typeof document === 'undefined') {
      return;
    }

    const elToggleEnabled = document.getElementById('toggle-enabled');
    const elToggleHost = document.getElementById('toggle-host');
    const elToggleCss = document.getElementById('toggle-css-unlock');
    const elToggleHeuristic = document.getElementById('toggle-heuristic');
    const elToggleEvents = document.getElementById('toggle-events');
    const elRangeThreshold = document.getElementById('range-threshold');
    const elThresholdDisplay = document.getElementById('threshold-display');
    const elStatusBadge = document.getElementById('status-badge');
    const elHostname = document.getElementById('current-hostname');
    const elStatBarriers = document.getElementById('stat-barriers');
    const elStatBlurs = document.getElementById('stat-blurs');
    const elStatRoots = document.getElementById('stat-roots');
    const elStatDuration = document.getElementById('stat-duration');
    const elBtnSweep = document.getElementById('btn-sweep');
    const elBtnReset = document.getElementById('btn-reset');

    if (!elToggleEnabled) {
      return;
    }

    let activeTabId = null;
    let activeHostname = '';
    let currentSettings = Object.assign({}, DEFAULT_SETTINGS, {
      disabledHosts: []
    });

    function renderStats(stats) {
      if (!stats) {
        return;
      }
      if (elStatBarriers) {
        elStatBarriers.textContent = String(stats.neutralizedBarriers || 0);
      }
      if (elStatBlurs) {
        elStatBlurs.textContent = String(stats.unblurredContainers || 0);
      }
      if (elStatRoots) {
        elStatRoots.textContent = String(stats.rootsUnlocked || 0);
      }
      if (elStatDuration) {
        const ms =
          typeof stats.lastDurationMs === 'number' ? stats.lastDurationMs : 0;
        elStatDuration.textContent = `${ms} ms`;
      }
    }

    function renderSettings() {
      elToggleEnabled.checked = Boolean(currentSettings.enabled);
      elToggleCss.checked = Boolean(currentSettings.cssUnlock);
      elToggleHeuristic.checked = Boolean(currentSettings.heuristicSweep);
      elToggleEvents.checked = Boolean(currentSettings.eventUnhijack);
      elRangeThreshold.value = String(currentSettings.threshold || 60);
      elThresholdDisplay.textContent = formatThresholdLabel(
        currentSettings.threshold
      );

      const isHostDisabled =
        activeHostname &&
        currentSettings.disabledHosts.includes(activeHostname);
      const isEffectivelyActive =
        currentSettings.enabled && !isHostDisabled;

      if (activeHostname) {
        elHostname.textContent = activeHostname;
        elToggleHost.disabled = false;
        elToggleHost.checked = !isHostDisabled;
      } else {
        elHostname.textContent = 'System- / Browser-Tab';
        elToggleHost.disabled = true;
        elToggleHost.checked = false;
      }

      if (isEffectivelyActive) {
        elStatusBadge.textContent = 'AKTIV';
        elStatusBadge.className = 'status-badge active';
      } else {
        elStatusBadge.textContent = 'PAUSIERT';
        elStatusBadge.className = 'status-badge paused';
      }
    }

    function saveAndBroadcastSettings() {
      renderSettings();
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [STORAGE_KEY]: currentSettings });
      }
      if (
        activeTabId !== null &&
        typeof chrome !== 'undefined' &&
        chrome.tabs &&
        typeof chrome.tabs.sendMessage === 'function'
      ) {
        chrome.tabs.sendMessage(
          activeTabId,
          {
            type: 'DOM_UNSHACKLE_UPDATE_SETTINGS',
            settings: currentSettings
          },
          (response) => {
            if (chrome.runtime && chrome.runtime.lastError) {
              return;
            }
            if (response && response.stats) {
              renderStats(response.stats);
            }
          }
        );
      }
    }

    // Load stored settings & query active tab
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STORAGE_KEY], (res) => {
        if (res && res[STORAGE_KEY]) {
          currentSettings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            res[STORAGE_KEY]
          );
          if (!Array.isArray(currentSettings.disabledHosts)) {
            currentSettings.disabledHosts = [];
          }
        }
        renderSettings();
      });
    }

    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab) {
          return;
        }
        activeTabId = typeof tab.id === 'number' ? tab.id : null;
        activeHostname = extractHostname(tab.url || '');
        renderSettings();

        if (activeTabId !== null && typeof chrome.tabs.sendMessage === 'function') {
          chrome.tabs.sendMessage(
            activeTabId,
            { type: 'DOM_UNSHACKLE_GET_STATUS' },
            (response) => {
              if (chrome.runtime && chrome.runtime.lastError) {
                return;
              }
              if (response && response.ok) {
                if (response.hostname) {
                  activeHostname = response.hostname;
                }
                if (response.stats) {
                  renderStats(response.stats);
                }
                renderSettings();
              }
            }
          );
        }
      });
    }

    // Event bindings
    elToggleEnabled.addEventListener('change', () => {
      currentSettings.enabled = elToggleEnabled.checked;
      saveAndBroadcastSettings();
    });

    elToggleHost.addEventListener('change', () => {
      if (!activeHostname) {
        return;
      }
      currentSettings.disabledHosts = toggleHostInList(
        currentSettings.disabledHosts,
        activeHostname,
        elToggleHost.checked
      );
      saveAndBroadcastSettings();
    });

    elToggleCss.addEventListener('change', () => {
      currentSettings.cssUnlock = elToggleCss.checked;
      saveAndBroadcastSettings();
    });

    elToggleHeuristic.addEventListener('change', () => {
      currentSettings.heuristicSweep = elToggleHeuristic.checked;
      saveAndBroadcastSettings();
    });

    elToggleEvents.addEventListener('change', () => {
      currentSettings.eventUnhijack = elToggleEvents.checked;
      saveAndBroadcastSettings();
    });

    elRangeThreshold.addEventListener('input', () => {
      const val = Number(elRangeThreshold.value) || 60;
      elThresholdDisplay.textContent = formatThresholdLabel(val);
    });

    elRangeThreshold.addEventListener('change', () => {
      currentSettings.threshold = Number(elRangeThreshold.value) || 60;
      saveAndBroadcastSettings();
    });

    elBtnSweep.addEventListener('click', () => {
      if (
        activeTabId !== null &&
        typeof chrome !== 'undefined' &&
        chrome.tabs &&
        typeof chrome.tabs.sendMessage === 'function'
      ) {
        chrome.tabs.sendMessage(
          activeTabId,
          { type: 'DOM_UNSHACKLE_RUN_SWEEP' },
          (response) => {
            if (chrome.runtime && chrome.runtime.lastError) {
              return;
            }
            if (response && response.stats) {
              renderStats(response.stats);
            }
          }
        );
      }
    });

    elBtnReset.addEventListener('click', () => {
      currentSettings = Object.assign({}, DEFAULT_SETTINGS, {
        disabledHosts: []
      });
      saveAndBroadcastSettings();
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initPopupUI, {
        once: true
      });
    } else {
      initPopupUI();
    }
  }

  const api = {
    STORAGE_KEY,
    DEFAULT_SETTINGS,
    formatThresholdLabel,
    toggleHostInList,
    extractHostname,
    initPopupUI
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
