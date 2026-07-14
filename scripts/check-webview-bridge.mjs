import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../App.js', import.meta.url), 'utf8');
const firebaseSyncSource = await readFile(new URL('../src/firebaseSync.js', import.meta.url), 'utf8');
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

localStorage.setItem('cleanQuestPreview', JSON.stringify({
  avatars: { diana: 'old-avatar' },
  avatarUpdatedAt: { diana: '2026-07-13T12:00:00.000Z' },
  completed: [{ id: 1, title: 'stale local task' }],
}));
let deferRemoteState = true;
context.window.shouldDeferFamilySyncApply = () => deferRemoteState;
listeners.document.message({
  data: JSON.stringify({
    type: 'remoteFamilyState',
    replace: true,
    value: {
      avatars: { diana: 'new-avatar' },
      avatarUpdatedAt: { diana: '2026-07-13T11:00:00.000Z' },
      completed: [],
    },
  }),
});
const deferredState = JSON.parse(localStorage.getItem('cleanQuestPreview'));
assert.equal(deferredState.avatars.diana, 'old-avatar');
deferRemoteState = false;
context.window.__flushPendingFamilyState();
const mergedState = JSON.parse(localStorage.getItem('cleanQuestPreview'));
assert.equal(mergedState.avatars.diana, 'new-avatar');
assert.equal(mergedState.avatarUpdatedAt.diana, '2026-07-13T11:00:00.000Z');
assert.deepEqual(mergedState.completed, []);
assert.match(source, /serialized === lastAppliedRemoteSerializedRef\.current/);
assert.match(firebaseSyncSource, /firebase\/firestore\/lite/);
assert.match(firebaseSyncSource, /experimentalAutoDetectLongPolling: true/);
assert.doesNotMatch(firebaseSyncSource, /experimentalForceLongPolling: true/);
assert.match(firebaseSyncSource, /retryTimer = setTimeout\(connect, delay\)/);
assert.match(firebaseSyncSource, /let publishQueue = Promise\.resolve\(\)/);
assert.match(firebaseSyncSource, /message\.includes\('stored version'\)/);
assert.match(firebaseSyncSource, /\{ maxAttempts: 8 \}/);

console.log('WebView bridge applies authoritative state; Firestore retries reads, listeners, and contended writes.');
