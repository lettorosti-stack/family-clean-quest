import Constants from 'expo-constants';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import { doc, getFirestore, onSnapshot, setDoc } from 'firebase/firestore';

const extra = Constants.expoConfig?.extra ?? {};
const DEFAULT_FAMILY_ID = 'family-clean-quest-home';

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

export function getSyncFamilyId() {
  const value = extra.familyId ?? DEFAULT_FAMILY_ID;
  return String(value).trim().replace(/[^a-zA-Z0-9_-]/g, '-') || DEFAULT_FAMILY_ID;
}

function getFamilyDoc() {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return doc(getFirestore(app), 'families', getSyncFamilyId());
}

async function ensureAnonymousAuth() {
  if (!isFirebaseConfigured()) return null;
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  if (auth.currentUser) return auth.currentUser;
  const credential = await signInAnonymously(auth);
  return credential.user;
}

const toArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);
const recordTime = (record) => Date.parse(record?.updatedAt ?? record?.createdAt ?? record?.date ?? '') || 0;

function mergeRecords(localRecords, remoteRecords) {
  const byId = new Map();
  [...toArray(remoteRecords), ...toArray(localRecords)].forEach((record) => {
    if (!record?.id) return;
    const existing = byId.get(record.id);
    if (!existing || recordTime(record) >= recordTime(existing)) {
      byId.set(record.id, record);
    }
  });
  return Array.from(byId.values()).sort((a, b) => recordTime(b) - recordTime(a));
}

export function toSharedFamilyState(state) {
  return {
    schemaVersion: 2,
    familyId: getSyncFamilyId(),
    avatars: state?.avatars && typeof state.avatars === 'object' ? state.avatars : {},
    completed: toArray(state?.completed),
    purchases: toArray(state?.purchases),
    customTasks: toArray(state?.customTasks),
    passwords: state?.passwords && typeof state.passwords === 'object' ? state.passwords : {},
    passwordResetRequests: toArray(state?.passwordResetRequests),
    cloudFolderUrl: typeof state?.cloudFolderUrl === 'string' ? state.cloudFolderUrl : '',
    recoveryWord: typeof state?.recoveryWord === 'string' ? state.recoveryWord : '',
  };
}

export function mergeFamilyState(localState, remoteState) {
  const remote = remoteState?.state && typeof remoteState.state === 'object' ? remoteState.state : remoteState;
  if (!remote || typeof remote !== 'object') return localState;
  return {
    ...localState,
    avatars: {
      ...(localState?.avatars ?? {}),
      ...(remote.avatars ?? {}),
    },
    completed: mergeRecords(localState?.completed, remote.completed),
    purchases: mergeRecords(localState?.purchases, remote.purchases),
    customTasks: mergeRecords(localState?.customTasks, remote.customTasks),
    passwords: {
      ...(localState?.passwords ?? {}),
      ...(remote.passwords ?? {}),
    },
    passwordResetRequests: mergeRecords(localState?.passwordResetRequests, remote.passwordResetRequests),
    cloudFolderUrl: localState?.cloudFolderUrl ?? remote.cloudFolderUrl ?? '',
    recoveryWord: localState?.recoveryWord ?? remote.recoveryWord ?? '',
    activeMemberId: localState?.activeMemberId ?? null,
  };
}

export function subscribeFamilyState(onChange, onError) {
  if (!isFirebaseConfigured()) return () => {};
  let unsubscribe = () => {};
  let closed = false;
  ensureAnonymousAuth()
    .then(() => {
      if (closed) return;
      unsubscribe = onSnapshot(getFamilyDoc(), (snapshot) => {
        if (snapshot.exists()) onChange(snapshot.data());
      }, onError);
    })
    .catch((error) => {
      if (onError) onError(error);
    });
  return () => {
    closed = true;
    unsubscribe();
  };
}

export async function publishFamilyState(state, meta = {}) {
  if (!isFirebaseConfigured()) return;
  await ensureAnonymousAuth();
  await setDoc(getFamilyDoc(), {
    ...toSharedFamilyState(state),
    updatedAt: new Date().toISOString(),
    updatedBy: meta.memberId ?? 'unknown',
  }, { merge: true });
}
