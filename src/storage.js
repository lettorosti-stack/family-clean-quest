import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialState } from './data';

const STORAGE_KEY = 'family-clean-quest-state-v1';
const BACKUP_KEY = 'family-clean-quest-state-backup-v1';
const CURRENT_SCHEMA_VERSION = 5;
const RECORD_GROUPS = [
  'completed',
  'purchases',
  'customTasks',
  'passwordResetRequests',
  'taskAssignments',
  'taskReviews',
  'notifications',
];

const asArray = (value) => (Array.isArray(value) ? value : []);
const asObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});

export function migrateLocalState(value) {
  const source = asObject(value);
  const tombstones = { ...asObject(initialState.syncTombstones), ...asObject(source.syncTombstones) };
  RECORD_GROUPS.forEach((group) => {
    tombstones[group] = { ...asObject(tombstones[group]) };
  });
  return {
    ...initialState,
    ...source,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    avatars: { ...asObject(source.avatars) },
    avatarUpdatedAt: { ...asObject(source.avatarUpdatedAt) },
    completed: asArray(source.completed),
    purchases: asArray(source.purchases),
    customTasks: asArray(source.customTasks),
    passwordResetRequests: asArray(source.passwordResetRequests),
    taskAssignments: asArray(source.taskAssignments),
    taskReviews: asArray(source.taskReviews),
    notifications: asArray(source.notifications),
    syncTombstones: tombstones,
  };
}

export async function loadLocalState() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return migrateLocalState(initialState);
  try {
    const parsed = JSON.parse(raw);
    const migrated = migrateLocalState(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
      await AsyncStorage.setItem(BACKUP_KEY, raw);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    }
    return migrated;
  } catch {
    await AsyncStorage.setItem(BACKUP_KEY, raw);
    return migrateLocalState(initialState);
  }
}

export async function saveLocalState(state) {
  const migrated = migrateLocalState(state);
  const previous = await AsyncStorage.getItem(STORAGE_KEY);
  if (previous) await AsyncStorage.setItem(BACKUP_KEY, previous);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
}

export async function loadBackupState() {
  const raw = await AsyncStorage.getItem(BACKUP_KEY);
  return raw ? migrateLocalState(JSON.parse(raw)) : null;
}
