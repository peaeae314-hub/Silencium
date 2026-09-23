// Runtime-configurable relay URL (B4).
//
// A Capacitor WebView serves the app from `https://localhost`, so
// `window.location.origin` is useless there. The relay base URL therefore has
// to come from the user (or a build-time fallback), not the page origin.
//
// Resolution order (see `resolveServerUrl`):
//   1. URL the user saved in Settings (Capacitor Preferences / localStorage)
//   2. `VITE_SERVER_URL` build-time override, if provided
//   3. Browser only: current behaviour — `window.location.origin` in a
//      production build, `http://localhost:3001` in dev
//   4. Native with nothing configured: `null` — the app must show Settings
//      before it touches Socket.IO (never silently dial localhost).
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';

export const SERVER_URL_KEY = 'silencium.server-url';

/**
 * Optional baked-in Capacitor default when Settings has nothing saved and
 * `VITE_SERVER_URL` was not set at build time. Leave null so first launch
 * still opens Settings (normal UX). Ship builds should prefer VITE_SERVER_URL.
 * Normal browser users never type a tunnel URL — production uses same-origin.
 */
export const BUILTIN_NATIVE_DEFAULT_URL = null;


/** True when running inside the Capacitor Android/iOS shell, false in a browser. */
export const isNativeApp = () => Capacitor.isNativePlatform();

/** The URL a plain browser would use today (unchanged for the web path). */
export const browserDefaultUrl = () =>
  import.meta.env.MODE === 'production'
    ? window.location.origin
    : 'http://localhost:3001';

/**
 * Light validation/normalisation for a relay base URL.
 * Accepts `http(s)://host[:port]` with no path/query/fragment.
 * Returns `{ url }` on success or `{ error, errorKey }` on failure, where
 * `error` is the English fallback and `errorKey` an i18n key (see
 * `client/src/i18n/locales/en.js`). The UI prefers the translated key.
 */
export function normalizeBaseUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return {
      error: 'Enter the relay URL, e.g. https://your-tunnel.trycloudflare.com',
      errorKey: 'settings.errEnter',
    };
  }

  const value = raw.trim();

  if (!/^https?:\/\//i.test(value)) {
    return {
      error: 'URL must start with http:// or https://',
      errorKey: 'settings.errScheme',
    };
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { error: 'That is not a valid URL.', errorKey: 'settings.errInvalid' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      error: 'Only http:// and https:// are supported.',
      errorKey: 'settings.errProtocol',
    };
  }
  if (!parsed.hostname) {
    return { error: 'The URL is missing a host.', errorKey: 'settings.errHost' };
  }
  if (parsed.pathname && parsed.pathname !== '/') {
    return {
      error: 'Use only scheme + host (no path), e.g. https://host:3001',
      errorKey: 'settings.errPath',
    };
  }
  if (parsed.search || parsed.hash) {
    return {
      error: 'Remove the query string and #fragment from the URL.',
      errorKey: 'settings.errQuery',
    };
  }

  return { url: `${parsed.protocol}//${parsed.host}` };
}

async function storageGet() {
  try {
    const { value } = await Preferences.get({ key: SERVER_URL_KEY });
    if (typeof value === 'string' && value) return value;
  } catch {
    /* fall through to localStorage */
  }
  try {
    return window.localStorage.getItem(SERVER_URL_KEY);
  } catch {
    return null;
  }
}

async function storageSet(value) {
  try {
    await Preferences.set({ key: SERVER_URL_KEY, value });
  } catch {
    /* fall through to localStorage */
  }
  try {
    window.localStorage.setItem(SERVER_URL_KEY, value);
  } catch {
    /* storage unavailable — in-memory cache still applies for this session */
  }
}

async function storageRemove() {
  try {
    await Preferences.remove({ key: SERVER_URL_KEY });
  } catch {
    /* ignore */
  }
  try {
    window.localStorage.removeItem(SERVER_URL_KEY);
  } catch {
    /* ignore */
  }
}

// Synchronous cache so `socket.js` can resolve a URL at import time.
let cachedSavedUrl = null;

/** Persist a base URL (already normalised) and update the in-memory cache. */
export async function saveServerUrl(url) {
  const result = normalizeBaseUrl(url);
  if (result.error) return result;
  await storageSet(result.url);
  cachedSavedUrl = result.url;
  return result;
}

/** Forget the saved URL; the next resolve falls back to browser/default. */
export async function clearServerUrl() {
  await storageRemove();
  cachedSavedUrl = null;
}

/** Read the saved URL from device storage into the sync cache. */
export async function initServerUrl() {
  const stored = await storageGet();
  if (stored) {
    const result = normalizeBaseUrl(stored);
    cachedSavedUrl = result.url || null;
  } else {
    cachedSavedUrl = null;
  }
  return cachedSavedUrl;
}

/** The currently saved (normalised) URL, or null. Sync. */
export const getSavedServerUrl = () => cachedSavedUrl;

/**
 * Effective relay URL for this session, or `null` when native and unconfigured.
 * Sync — call `initServerUrl()` once at boot first.
 */
export function resolveServerUrl() {
  if (cachedSavedUrl) return cachedSavedUrl;

  const envUrl = import.meta.env.VITE_SERVER_URL;
  if (typeof envUrl === 'string' && envUrl.trim()) {
    const result = normalizeBaseUrl(envUrl);
    if (result.url) return result.url;
  }

  if (!isNativeApp()) return browserDefaultUrl();

  if (BUILTIN_NATIVE_DEFAULT_URL) {
    const result = normalizeBaseUrl(BUILTIN_NATIVE_DEFAULT_URL);
    if (result.url) return result.url;
  }
  return null;
}

/**
 * Origin to put in invite links.
 * Native: the configured relay (the other person opens the SPA served there).
 * Browser: the page origin, exactly as before.
 */
export function getShareOrigin() {
  if (isNativeApp()) return resolveServerUrl();
  return window.location.origin;
}
