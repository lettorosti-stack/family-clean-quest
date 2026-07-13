import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../App.js', import.meta.url), 'utf8');
const match = source.match(/const bridgeScript = `([\s\S]*?)`;\s*const diagnosticsScript/);
assert.ok(match, 'bridgeScript was not found in App.js');

const listeners = { window: {}, document: {} };
const storage = new Map();
const localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
const context = {
  localStorage,
  setTimeout: (callback) => callback(),
  window: {
    addEventListener: (type, callback) => { listeners.window[type] = callback; },
  },
  document: {
    addEventListener: (type, callback) => { listeners.document[type] = callback; },
  },
};

vm.runInNewContext(match[1], context);
assert.equal(typeof listeners.window.message, 'function', 'window message listener is missing');
assert.equal(typeof listeners.document.message, 'function', 'document message listener is missing');

let receivedConfig = null;
context.window.setFamilySyncConfig = (value) => { receivedConfig = value; };
listeners.document.message({
  data: JSON.stringify({ type: 'syncConfig', value: { configured: true } }),
});
assert.equal(receivedConfig?.configured, true);
assert.equal(context.window.__familySyncConfig.configured, true);

console.log('WebView bridge accepts Android document messages.');
