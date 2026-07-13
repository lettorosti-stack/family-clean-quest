import AsyncStorage from '@react-native-async-storage/async-storage';
import { initialState } from './data';

const STORAGE_KEY = 'family-clean-quest-state-v1';

export async function loadLocalState() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : initialState;
}

export async function saveLocalState(state) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
