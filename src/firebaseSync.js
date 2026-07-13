import Constants from 'expo-constants';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import appConfig from '../app.json';

const extra = {
  ...(appConfig.expo?.extra ?? {}),
  ...(Constants.expoConfig?.extra ?? {}),
};
const FAMILY_CODE_LENGTH = 12;
const FAMILY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const RECORD_GROUPS = ['completed', 'purchases', 'customTasks', 'passwordResetRequests'];

const firebaseConfig = {
  apiKey: extra.firebaseApiKey,
  authDomain: extra.firebaseAuthDomain,
  projectId: extra.firebaseProjectId,
  storageBucket: extra.firebaseStorageBucket,
  messagingSenderId: extra.firebaseMessagingSenderId,
  appId: extra.firebaseAppId,
};

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && !String(firebaseConfig.apiKey).startsWith('YOUR_'));
}

export function normalizeFamilyCode(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, FAMILY_CODE_LENGTH);
}

export function isValidFamilyCode(value) {
  return normalizeFamilyCode(value).length === FAMILY_CODE_LENGTH;
}

export function generateFamilyCode() {
  let result = '';
  for (let index = 0; index < FAMILY_CODE_LENGTH; index += 1) {
    result += FAMILY_CODE_ALPHABET[Math.floor(Math.random() * FAMILY_CODE_ALPHABET.length)];
  }
  return result;
}

function getFirebaseApp() {
  return getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
}

function getFamilyDoc(familyCode) {
  const normalized = normalizeFamilyCode(familyCode);
  if (!isValidFamilyCode(normalized)) throw new Error('Некорректный код семьи');
  return doc(getFirestore(getFirebaseApp()), 'families', normalized);
}

async function ensureAnonymousAuth() {
  if (!isFirebaseConfigured()) return null;
  const auth = getAuth(getFirebaseApp());
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

const toArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
const toObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const recordTime = (record) => Date.parse(record?.updatedAt ?? record?.createdAt ?? record?.date ?? '') || 0;
const tombstoneTime = (value) => Date.parse(value ?? '') || 0;

function mergeTombstones(localValue, remoteValue) {
  const local = toObject(localValue);
  const remote = toObject(remoteValue);
  const merged = {};
  RECORD_GROUPS.forEach((group) => {
    merged[group] = { ...toObject(remote[group]) };
    Object.entries(toObject(local[group])).forEach(([id, timestamp]) => {
      if (tombstoneTime(timestamp) >= tombstoneTime(merged[group][id])) {
        merged[group][id] = timestamp;
      }
    });
  });
  return merged;
}

function mergeRecords(localRecords, remoteRecords, tombstones = {}) {
  const byId = new Map();
  [...toArray(remoteRecords), ...toArray(localRecords)].forEach((record) => {
    if (record?.id == null) return;
    const id = String(record.id);
    const existing = byId.get(id);
    if (!existing || recordTime(record) >= recordTime(existing)) byId.set(id, record);
  });
  return Array.from(byId.entries())
    .filter(([id, record]) => recordTime(record) > tombstoneTime(tombstones[id]))
    .map(([, record]) => record)
    .sort((a, b) => recordTime(b) - recordTime(a));
}

export function toSharedFamilyState(state, familyCode) {
  const normalized = normalizeFamilyCode(familyCode ?? state?.familyId);
  const tombstones = mergeTombstones(state?.syncTombstones, {});
  return {
    schemaVersion: 3,
    familyId: normalized,
    avatars: toObject(state?.avatars),
    completed: mergeRecords(state?.completed, [], tombstones.completed),
    purchases: mergeRecords(state?.purchases, [], tombstones.purchases),
    customTasks: mergeRecords(state?.customTasks, [], tombstones.customTasks),
    passwordResetRequests: mergeRecords(
      state?.passwordResetRequests,
      [],
      tombstones.passwordResetRequests,
    ),
    syncTombstones: tombstones,
    cloudFolderUrl: typeof state?.cloudFolderUrl === 'string' ? state.cloudFolderUrl : '',
  };
}

export function mergeFamilyState(localState, remoteState) {
  const remote = remoteState?.state && typeof remoteState.state === 'object'
    ? remoteState.state
    : remoteState;
  if (!remote || typeof remote !== 'object') return localState;
  const familyId = normalizeFamilyCode(remote.familyId ?? localState?.familyId);
  const tombstones = mergeTombstones(localState?.syncTombstones, remote.syncTombstones);
  return {
    ...localState,
    schemaVersion: 3,
    familyId,
    avatars: { ...toObject(localState?.avatars), ...toObject(remote.avatars) },
    completed: mergeRecords(localState?.completed, remote.completed, tombstones.completed),
    purchases: mergeRecords(localState?.purchases, remote.purchases, tombstones.purchases),
    customTasks: mergeRecords(localState?.customTasks, remote.customTasks, tombstones.customTasks),
    passwordResetRequests: mergeRecords(
      localState?.passwordResetRequests,
      remote.passwordResetRequests,
      tombstones.passwordResetRequests,
    ),
    syncTombstones: tombstones,
    cloudFolderUrl: remote.cloudFolderUrl || localState?.cloudFolderUrl || '',
  };
}

export async function familyExists(familyCode) {
  if (!isFirebaseConfigured()) return false;
  await ensureAnonymousAuth();
  return (await getDoc(getFamilyDoc(familyCode))).exists();
}

export function subscribeFamilyState(familyCode, onChange, onError) {
  if (!isFirebaseConfigured() || !isValidFamilyCode(familyCode)) return () => {};
  let unsubscribe = () => {};
  let closed = false;
  ensureAnonymousAuth()
    .then(() => {
      if (closed) return;
      unsubscribe = onSnapshot(
        getFamilyDoc(familyCode),
        (snapshot) => onChange(snapshot.exists() ? snapshot.data() : null),
        onError,
      );
    })
    .catch((error) => onError?.(error));
  return () => {
    closed = true;
    unsubscribe();
  };
}

export async function publishFamilyState(familyCode, state, meta = {}) {
  if (!isFirebaseConfigured()) throw new Error('Firebase не настроен');
  const normalized = normalizeFamilyCode(familyCode);
  if (!isValidFamilyCode(normalized)) throw new Error('Некорректный код семьи');
  const user = await ensureAnonymousAuth();
  const reference = getFamilyDoc(normalized);
  await runTransaction(getFirestore(getFirebaseApp()), async (transaction) => {
    const snapshot = await transaction.get(reference);
    const remote = snapshot.exists() ? snapshot.data() : {};
    const merged = mergeFamilyState(remote, toSharedFamilyState(state, normalized));
    transaction.set(reference, {
      ...toSharedFamilyState(merged, normalized),
      createdAt: remote.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: meta.memberId ?? 'unknown',
      updatedByDevice: meta.deviceId ?? user?.uid ?? 'unknown',
    });
  });
}
