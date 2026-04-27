const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('background/runtime-update.js', 'utf8');

function loadModule() {
  const scope = {};
  return new Function('self', `${source}; return self.MultiPageRuntimeUpdate;`)(scope);
}

function createManager(options = {}) {
  const timers = [];
  let reloaded = false;
  const listeners = [];
  const storageWrites = [];
  const runtime = {
    id: options.id || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    lastError: null,
    getManifest() {
      return options.manifest || {
        name: 'test-extension',
        version: '1.4',
        version_name: 'Ultra1.4',
        update_url: 'https://example.com/updates.xml',
      };
    },
    requestUpdateCheck(callback) {
      if (options.updateError) {
        runtime.lastError = { message: options.updateError };
        callback('no_update');
        runtime.lastError = null;
        return undefined;
      }
      const result = options.updateResult || ['no_update', {}];
      if (Array.isArray(result)) {
        callback(result[0], result[1]);
      } else {
        callback(result);
      }
      return undefined;
    },
    reload() {
      reloaded = true;
    },
    sendMessage: async () => {},
    onUpdateAvailable: {
      addListener(listener) {
        listeners.push(listener);
      },
    },
  };

  const moduleApi = loadModule();
  const manager = moduleApi.createRuntimeUpdateManager({
    chrome: {
      runtime,
      storage: {
        local: {
          async set(payload) {
            storageWrites.push(payload);
          },
        },
      },
    },
    setTimeout(fn, delayMs) {
      timers.push({ fn, delayMs });
      return timers.length;
    },
    clearTimeout() {},
    now: () => 123456,
  });

  return {
    manager,
    timers,
    listeners,
    storageWrites,
    getReloaded: () => reloaded,
  };
}

test('requestImmediateUpdate schedules runtime reload when browser reports update_available', async () => {
  const { manager, timers, storageWrites, getReloaded } = createManager({
    updateResult: ['update_available', { version: '1.5' }],
  });

  const result = await manager.requestImmediateUpdate({ reason: 'test' });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'update_available');
  assert.equal(result.version, '1.5');
  assert.equal(result.willReload, true);
  assert.equal(timers.length, 1);
  assert.equal(storageWrites.length, 1);

  timers[0].fn();
  assert.equal(getReloaded(), true);
});

test('requestImmediateUpdate returns manual guidance when update channel is unavailable', async () => {
  const { manager, timers } = createManager({
    manifest: {
      name: 'test-extension',
      version: '1.4',
      version_name: 'Ultra1.4',
    },
    updateError: 'Update check failed',
  });

  const result = await manager.requestImmediateUpdate({ reason: 'test' });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'manual_required');
  assert.equal(result.willReload, false);
  assert.match(result.message, /加载已解压的扩展程序|update_url/);
  assert.equal(timers.length, 0);
});
