const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/clash-bridge.js', 'utf8');

function loadModule() {
  const scope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundClashBridge;`)(scope);
}

test('clash bridge picks next non-HK proxy and skips meta groups', () => {
  const api = loadModule();
  const next = api.pickNextProxyName(
    ['DIRECT', '香港 01', '🔁 非港轮询', 'US 01', 'JP 01'],
    'US 01',
    '',
    api.DEFAULT_EXCLUDE_PATTERN
  );

  assert.equal(next, 'JP 01');
});

test('clash bridge rotates the configured selector group through local API', async () => {
  const api = loadModule();
  const calls = [];
  const logs = [];
  let state = {
    clashBridgeEnabled: true,
    clashBridgeControllerUrl: '127.0.0.1:9090',
    clashBridgeSecret: 'secret',
    clashBridgeProxyGroup: '节点选择',
    clashBridgeExcludePattern: api.DEFAULT_EXCLUDE_PATTERN,
    clashBridgeSetRuleMode: true,
    clashBridgeLastProxyName: '',
  };

  const bridge = api.createClashBridge({
    async addLog(message, level = 'info') {
      logs.push({ message, level });
    },
    async getState() {
      return state;
    },
    async setState(updates) {
      state = { ...state, ...updates };
    },
    setTimeout(fn) {
      return 1;
    },
    clearTimeout() {},
    AbortController,
    async fetch(url, options = {}) {
      calls.push({ url, options });
      if (url.endsWith('/configs')) {
        assert.equal(options.method, 'PATCH');
        assert.equal(options.headers.Authorization, 'Bearer secret');
        return { ok: true, status: 204, async json() { return null; } };
      }
      if (url.endsWith('/proxies/%E8%8A%82%E7%82%B9%E9%80%89%E6%8B%A9') && options.method === 'GET') {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              name: '节点选择',
              type: 'Selector',
              now: 'US 01',
              all: ['DIRECT', 'US 01', 'JP 01'],
            };
          },
        };
      }
      if (url.endsWith('/proxies/%E8%8A%82%E7%82%B9%E9%80%89%E6%8B%A9') && options.method === 'PUT') {
        assert.deepEqual(JSON.parse(options.body), { name: 'JP 01' });
        return { ok: true, status: 204, async json() { return null; } };
      }
      throw new Error(`unexpected fetch ${options.method || 'GET'} ${url}`);
    },
  });

  const result = await bridge.rotateAfterRound(1, 2);

  assert.equal(result.ok, true);
  assert.equal(result.from, 'US 01');
  assert.equal(result.to, 'JP 01');
  assert.equal(state.clashBridgeLastProxyName, 'JP 01');
  assert.equal(calls.length, 3);
  assert.equal(logs.some((entry) => /已从“US 01”切换到“JP 01”/.test(entry.message)), true);
});
