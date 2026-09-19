// Locale persistence — Capacitor Preferences on device, localStorage on web
// (same dual-storage pattern as `utils/serverUrl.js`).
import { Preferences } from '@capacitor/preferences';
import {
  DEFAULT_LOCALE,
  detectDeviceLocale,
  normalizeLocale,
} from './translations';

export const LOCALE_KEY = 'silencium.locale';

// Synchronous cache so the first render after boot already has the right locale.
let cachedLocale = null;

async function storageGet() {
  try {
    const { value } = await Preferences.get({ key: LOCALE_KEY });
    if (typeof value === 'string' && value) return value;
  } catch {
    /* fall through to localStorage */
  }
  try {
    return window.localStorage.getItem(LOCALE_KEY);
  } catch {
    return null;
  }
}

/** Load the saved locale, or derive it from the device locale on first run. */
export async function initLocale() {
  const stored = await storageGet();
  cachedLocale = stored ? normalizeLocale(stored) : detectDeviceLocale();
  return cachedLocale;
}

/** Current locale (saved or detected). Sync; `initLocale()` first at boot. */
export const getLocale = () => cachedLocale || DEFAULT_LOCALE;

/** Persist a locale choice and update the sync cache. */
export async function saveLocale(locale) {
  const value = normalizeLocale(locale);
  cachedLocale = value;
  try {
    await Preferences.set({ key: LOCALE_KEY, value });
  } catch {
    /* fall through to localStorage */
  }
  try {
    window.localStorage.setItem(LOCALE_KEY, value);
  } catch {
    /* storage unavailable — the in-memory cache still applies this session */
  }
  return value;
}
