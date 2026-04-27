#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function readArg(name) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  const inline = process.argv.find((item) => item.startsWith(`${flag}=`));
  return inline ? inline.slice(flag.length + 1) : '';
}

function xmlEscape(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function requireValue(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`Missing ${label}. Use --${label} or environment variable ${label.toUpperCase().replace(/-/g, '_')}.`);
  }
  return normalized;
}

const repoRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(repoRoot, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const version = requireValue(readArg('version') || manifest.version, 'version');
const extensionId = requireValue(readArg('extension-id') || process.env.EXTENSION_ID, 'extension-id');
const crxUrl = requireValue(readArg('crx-url') || process.env.CRX_URL, 'crx-url');
const outputPath = path.resolve(
  repoRoot,
  readArg('output') || process.env.UPDATE_XML_PATH || path.join('dist', 'updates.xml')
);
const minBrowserVersion = String(readArg('min-browser-version') || process.env.MIN_BROWSER_VERSION || '').trim();

if (!/^[a-p]{32}$/.test(extensionId)) {
  throw new Error('extension-id must be a 32-character Chrome extension id using letters a-p.');
}

let updateCheckAttrs = `codebase="${xmlEscape(crxUrl)}" version="${xmlEscape(version)}"`;
if (minBrowserVersion) {
  updateCheckAttrs += ` prodversionmin="${xmlEscape(minBrowserVersion)}"`;
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${xmlEscape(extensionId)}">
    <updatecheck ${updateCheckAttrs} />
  </app>
</gupdate>
`;

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, xml, 'utf8');
console.log(`Wrote ${path.relative(repoRoot, outputPath)} for ${extensionId} -> ${crxUrl}`);
