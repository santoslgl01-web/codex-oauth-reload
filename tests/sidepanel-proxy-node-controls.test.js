const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sidepanelHtml = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
const sidepanelSource = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

test('sidepanel exposes proxy node sync and one-click reload controls', () => {
  assert.match(sidepanelHtml, /id="btn-reload-extension"/);
  assert.match(sidepanelHtml, /id="input-proxy-node-source-repo"/);
  assert.match(sidepanelHtml, /id="btn-refresh-proxy-nodes"/);
  assert.match(sidepanelHtml, /id="select-proxy-node"/);
  assert.match(sidepanelHtml, /id="display-proxy-node-status"/);
});

test('sidepanel persists Clash-backed proxy node settings', () => {
  assert.match(sidepanelSource, /proxyNodeSourceRepo/);
  assert.match(sidepanelSource, /proxySelectedNodeId/);
  assert.match(sidepanelSource, /proxyBackend:\s*'clash'/);
  assert.match(sidepanelSource, /proxyMode:\s*clashBridgeEnabled \? 'rule' : 'off'/);
  assert.match(sidepanelSource, /proxyRuleDomains:\s*\[\.\.\.defaultProxyRuleDomains\]/);
  assert.match(sidepanelSource, /clashControlUrl:\s*clashBridgeControllerUrl/);
  assert.match(sidepanelSource, /clashSelectorGroup:\s*clashBridgeProxyGroup/);
});

test('sidepanel sends refresh and reload messages to background', () => {
  assert.match(sidepanelSource, /type:\s*'REFRESH_PROXY_NODES'/);
  assert.match(sidepanelSource, /type:\s*'REQUEST_EXTENSION_RELOAD'/);
  assert.match(sidepanelSource, /chrome\.runtime\.reload\(\)/);
  assert.match(sidepanelSource, /requestProxyNodeRefresh/);
  assert.match(sidepanelSource, /requestExtensionReloadFromSidepanel/);
});
