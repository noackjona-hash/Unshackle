'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  formatThresholdLabel,
  toggleHostInList,
  extractHostname
} = require('../src/popup.js');
const {
  normalizeSettings,
  isActiveForHost
} = require('../src/content.js');

describe('Popup GUI & Settings Management (src/popup.js & src/content.js)', () => {
  it('formats heuristic threshold labels accurately', () => {
    assert.equal(formatThresholdLabel(45), '45 (Aggressiv)');
    assert.equal(formatThresholdLabel(60), '60 (Standard)');
    assert.equal(formatThresholdLabel(75), '75 (Vorsichtig)');
  });

  it('adds and removes hostnames from disabledHosts whitelist', () => {
    let hosts = [];
    hosts = toggleHostInList(hosts, 'Example.com', false);
    assert.deepEqual(hosts, ['example.com']);

    hosts = toggleHostInList(hosts, 'example.com', true);
    assert.deepEqual(hosts, []);
  });

  it('extracts valid HTTP/HTTPS hostnames and ignores chrome:// URLs', () => {
    assert.equal(
      extractHostname('https://www.spiegel.de/artikel/test'),
      'www.spiegel.de'
    );
    assert.equal(extractHostname('chrome://extensions'), '');
  });

  it('normalizes settings and checks host activation state', () => {
    const cfg = normalizeSettings({
      enabled: true,
      threshold: 50,
      disabledHosts: ['news.example.org']
    });
    assert.equal(cfg.threshold, 50);
    assert.equal(isActiveForHost(cfg, 'news.example.org'), false);
    assert.equal(isActiveForHost(cfg, 'other.example.org'), true);
  });
});

