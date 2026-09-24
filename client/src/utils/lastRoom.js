// Persist last-used room id/link + room key for home-form prefill.
// Capacitor Preferences on native, localStorage on web (same pattern as
// serverUrl.js / locale.js). Local only — never put the key in a URL.
import { Preferences } from '@capacitor/preferences';

export const LAST_ROOM_ID_OR_LINK_KEY = 'silencium.lastRoomIdOrLink';
export const LAST_ROOM_KEY_KEY = 'silencium.lastRoomKey';

async function storageGet(key) {
  try {
    const { value } = await Preferences.get({ key });
    if (typeof value === 'string' && value) return value;
  } catch {
    /* fall through to localStorage */
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

async function storageSet(key, value) {
  try {
    await Preferences.set({ key, value });
  } catch {
    /* fall through to localStorage */
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** Load last room id/link and key for home-form prefill. */
export async function loadLastRoom() {
  const [lastRoomIdOrLink, lastRoomKey] = await Promise.all([
    storageGet(LAST_ROOM_ID_OR_LINK_KEY),
    storageGet(LAST_ROOM_KEY_KEY),
  ]);
  return {
    lastRoomIdOrLink: lastRoomIdOrLink || '',
    lastRoomKey: lastRoomKey || '',
  };
}

/** Persist last-used join room id/link and shared key after successful create/join. */
export async function saveLastRoom({ lastRoomIdOrLink, lastRoomKey }) {
  const idOrLink =
    typeof lastRoomIdOrLink === 'string' ? lastRoomIdOrLink.trim() : '';
  const key = typeof lastRoomKey === 'string' ? lastRoomKey.trim() : '';
  if (idOrLink) await storageSet(LAST_ROOM_ID_OR_LINK_KEY, idOrLink);
  if (key) await storageSet(LAST_ROOM_KEY_KEY, key);
}
