const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sidepanelHtml = fs.readFileSync('sidepanel/sidepanel.html', 'utf8');
const sidepanelSource = fs.readFileSync('sidepanel/sidepanel.js', 'utf8');

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers
    .map((marker) => sidepanelSource.indexOf(marker))
    .find((index) => index >= 0);
  if (start < 0) {
    throw new Error(`missing function ${name}`);
  }

  let parenDepth = 0;
  let signatureEnded = false;
  let braceStart = -1;
  for (let i = start; i < sidepanelSource.length; i += 1) {
    const ch = sidepanelSource[i];
    if (ch === '(') {
      parenDepth += 1;
    } else if (ch === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        signatureEnded = true;
      }
    } else if (ch === '{' && signatureEnded) {
      braceStart = i;
      break;
    }
  }

  let depth = 0;
  let end = braceStart;
  for (; end < sidepanelSource.length; end += 1) {
    const ch = sidepanelSource[end];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end += 1;
        break;
      }
    }
  }

  return sidepanelSource.slice(start, end);
}

test('sidepanel html exposes local Clash bridge controls', () => {
  assert.match(sidepanelHtml, /id="row-clash-bridge"/);
  assert.match(sidepanelHtml, /id="input-clash-bridge-enabled"/);
  assert.match(sidepanelHtml, /id="input-clash-bridge-controller-url"/);
  assert.match(sidepanelHtml, /id="input-clash-bridge-proxy-group"/);
  assert.match(sidepanelHtml, /id="input-clash-bridge-secret"/);
  assert.match(sidepanelHtml, /placeholder="http:\/\/127\.0\.0\.1:62754"/);
  assert.match(sidepanelHtml, /placeholder="NODE-SELECT"/);
});

test('sidepanel source persists Clash bridge settings', () => {
  assert.match(sidepanelSource, /clashBridgeEnabled/);
  assert.match(sidepanelSource, /clashBridgeControllerUrl/);
  assert.match(sidepanelSource, /clashBridgeProxyGroup/);
  assert.match(sidepanelSource, /clashBridgeSecret/);
  assert.match(sidepanelSource, /http:\/\/127\.0\.0\.1:62754/);
  assert.match(sidepanelSource, /NODE-SELECT/);
});

test('Clash bridge settings remain editable before enabling the bridge', () => {
  const api = new Function(`
let locked = false;
const inputClashBridgeEnabled = { checked: false, disabled: true };
const inputClashBridgeControllerUrl = { disabled: true };
const inputClashBridgeProxyGroup = { disabled: true };
const inputClashBridgeSecret = { disabled: true };
const rowClashBridgeProxyGroup = {
  toggles: [],
  classList: {
    toggle(name, value) {
      rowClashBridgeProxyGroup.toggles.push([name, value]);
    },
  },
};
function isAutoRunLockedPhase() { return locked; }
${extractFunction('updateClashBridgeInputState')}
return {
  inputClashBridgeEnabled,
  inputClashBridgeControllerUrl,
  inputClashBridgeProxyGroup,
  inputClashBridgeSecret,
  rowClashBridgeProxyGroup,
  setLocked(value) { locked = Boolean(value); },
  updateClashBridgeInputState,
};
`)();

  api.updateClashBridgeInputState();

  assert.equal(api.inputClashBridgeEnabled.disabled, false);
  assert.equal(api.inputClashBridgeControllerUrl.disabled, false);
  assert.equal(api.inputClashBridgeProxyGroup.disabled, false);
  assert.equal(api.inputClashBridgeSecret.disabled, false);
  assert.deepEqual(api.rowClashBridgeProxyGroup.toggles.at(-1), ['is-disabled', true]);

  api.setLocked(true);
  api.updateClashBridgeInputState();

  assert.equal(api.inputClashBridgeEnabled.disabled, true);
  assert.equal(api.inputClashBridgeControllerUrl.disabled, true);
  assert.equal(api.inputClashBridgeProxyGroup.disabled, true);
  assert.equal(api.inputClashBridgeSecret.disabled, true);
});

test('scheduled auto-run does not inert the settings card', () => {
  assert.equal(sidepanelSource.includes('const settingsCardLocked = scheduled || locked;'), false);
  assert.equal(sidepanelSource.includes('const settingsCardLocked = locked;'), true);
});
