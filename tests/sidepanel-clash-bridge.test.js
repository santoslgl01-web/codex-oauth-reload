const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sidepanelHtml = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
const sidepanelSource = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

test('sidepanel html exposes local Clash bridge controls', () => {
  assert.match(sidepanelHtml, /id="row-clash-bridge"/);
  assert.match(sidepanelHtml, /id="input-clash-bridge-enabled"/);
  assert.match(sidepanelHtml, /id="input-clash-bridge-controller-url"/);
  assert.match(sidepanelHtml, /id="input-clash-bridge-proxy-group"/);
  assert.match(sidepanelHtml, /id="input-clash-bridge-secret"/);
});

test('sidepanel source persists Clash bridge settings', () => {
  assert.match(sidepanelSource, /clashBridgeEnabled/);
  assert.match(sidepanelSource, /clashBridgeControllerUrl/);
  assert.match(sidepanelSource, /clashBridgeProxyGroup/);
  assert.match(sidepanelSource, /clashBridgeSecret/);
});
