const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function createChromeMock() {
  const calls = [];
  let value = { mode: 'direct' };

  const chrome = {
    runtime: { lastError: null },
    proxy: {
      settings: {
        get(_details, callback) {
          callback({ value, levelOfControl: 'controlled_by_this_extension' });
        },
        set(payload, callback) {
          calls.push({ type: 'set', payload });
          value = payload.value;
          callback();
        },
        clear(payload, callback) {
          calls.push({ type: 'clear', payload });
          value = { mode: 'direct' };
          callback();
        },
      },
    },
    alarms: {
      async get() { return null; },
      async create() { return undefined; },
      async clear() { return true; },
    },
  };

  return { chrome, calls };
}

function createResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
    async json() {
      return typeof body === 'string' ? JSON.parse(body) : body;
    },
  };
}

function loadModule() {
  const source = fs.readFileSync('background/proxy-node-manager.js', 'utf8');
  const globalScope = {};
  return new Function('self', `${source}; return self.MultiPageBackgroundProxyNodeManager;`)(globalScope);
}

test('background imports proxy node manager module', () => {
  const source = fs.readFileSync('background.js', 'utf8');
  assert.match(source, /background\/proxy-node-manager\.js/);
});

test('proxy node manager parses clash proxy lists', () => {
  const api = loadModule();
  const { chrome } = createChromeMock();
  const manager = api.createProxyNodeManager({
    chrome,
    fetchImpl: async () => createResponse(''),
  });

  const proxies = manager.parseClashProxyFile(`
port: 7890
proxies:
  - {name: US-HTTP, server: 1.1.1.1, port: 8080, type: http}
  - name: SG-SOCKS
    server: 2.2.2.2
    port: 1080
    type: socks5
proxy-groups: []
`);

  assert.equal(proxies.length, 2);
  assert.equal(proxies[0].name, 'US-HTTP');
  assert.equal(proxies[1].type, 'socks5');
});

test('proxy node manager falls back to raw GitHub sources when API listing fails', async () => {
  const api = loadModule();
  const { chrome } = createChromeMock();
  const requestedUrls = [];
  const manager = api.createProxyNodeManager({
    addLog: async () => {},
    chrome,
    fetchImpl: async (url) => {
      const target = String(url);
      requestedUrls.push(target);
      if (target.includes('/repos/free-nodes/clashfree/contents')) {
        return createResponse({ message: 'rate limit' }, 403);
      }
      if (target.includes('raw.githubusercontent.com') && /clash\d{8}\.yml/.test(target)) {
        return createResponse(`
port: 7890
proxies:
  - {name: US-HTTP, server: 1.1.1.1, port: 8080, type: http}
`);
      }
      return createResponse('not found', 404);
    },
    getState: async () => ({ proxyBackend: 'browser', proxyMode: 'off' }),
    setPersistentSettings: async () => {},
    setState: async () => {},
  });

  const result = await manager.refreshProxyNodes({
    trigger: 'manual',
    probeLimit: 1,
    timeoutMs: 1,
  });

  assert.equal(result.ok, true);
  assert.match(result.sourceFile, /^clash\d{8}\.yml$/);
  assert.ok(requestedUrls.some((url) => url.includes('/repos/free-nodes/clashfree/contents')));
  assert.ok(requestedUrls.some((url) => url.includes('raw.githubusercontent.com')));
});

test('proxy node manager applies rule PAC for ChatGPT/OpenAI domains', async () => {
  const api = loadModule();
  const { chrome, calls } = createChromeMock();
  const manager = api.createProxyNodeManager({
    addLog: async () => {},
    chrome,
    fetchImpl: async () => createResponse(''),
  });

  const result = await manager.applyProxySettingsFromState({
    proxyMode: 'rule',
    proxySelectedNodeId: 'node-1',
    proxyRuleDomains: ['chatgpt.com', 'openai.com'],
    proxyNodes: [
      {
        id: 'node-1',
        name: 'US HTTP',
        server: '1.1.1.1',
        port: 8080,
        type: 'http',
        usable: true,
      },
    ],
  }, { reason: 'test_rule' });

  assert.equal(result.applied, true);
  const setCall = calls.find((item) => item.type === 'set');
  assert.ok(setCall);
  assert.equal(setCall.payload.value.mode, 'pac_script');
  assert.match(setCall.payload.value.pacScript.data, /chatgpt\.com/);
  assert.match(setCall.payload.value.pacScript.data, /openai\.com/);
});
