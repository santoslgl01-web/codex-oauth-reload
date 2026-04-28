const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('background imports auto-run controller module', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/auto-run-controller\.js/);
  assert.match(source, /background\/clash-bridge\.js/);
  assert.match(source, /rotateClashProxyAfterRound/);
});

test('auto-run controller module exposes a factory', () => {
  const source = fs.readFileSync('background/auto-run-controller.js', 'utf8');
  const globalScope = {};

  const api = new Function('self', `${source}; return self.MultiPageBackgroundAutoRunController;`)(globalScope);

  assert.equal(typeof api?.createAutoRunController, 'function');
});
