const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports message router module', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/message-router\.js/);
});

test('message router module exposes a factory', () => {
  const source = fs.readFileSync('background/message-router.js', 'utf8');
  const globalScope = {};

  const api = new Function('self', `${source}; return self.MultiPageBackgroundMessageRouter;`)(globalScope);

  assert.equal(typeof api?.createMessageRouter, 'function');
});

test('message router exposes proxy refresh and extension reload actions', () => {
  const source = fs.readFileSync('background/message-router.js', 'utf8');

  assert.match(source, /case 'REFRESH_PROXY_NODES'/);
  assert.match(source, /case 'REQUEST_EXTENSION_RELOAD'/);
  assert.match(source, /refreshProxyNodes/);
  assert.match(source, /requestExtensionReload/);
});
