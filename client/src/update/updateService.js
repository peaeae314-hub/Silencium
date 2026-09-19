// In-app update service: multi-source manifest fetch, installed-version
// lookup, skip/snooze persistence, opening the APK link.
//
// Mirrors pokemon-handbook's `features/update/update_service.dart`, adapted to
// the Capacitor client:
//   * `CapacitorHttp` (a core plugin, always registered) is used for the
//     manifest GET so the WebView is not blocked by CORS — GitHub release
//     assets do not send `Access-Control-Allow-Origin`. On the web build the
//     plugin falls back to plain `fetch`, and the jsDelivr / raw fallbacks
//     (which do send `access-control-allow-origin: *`) carry the check.
//   * Preferences on device / localStorage on web, same pattern as
//     `utils/serverUrl.js` and `i18n/locale.js`.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';

import { APP_VERSION_CODE, APP_VERSION_NAME } from './appVersion';
import {
  ENV_MANIFEST_URL,
  MANIFEST_CONNECT_TIMEOUT_MS,
  MANIFEST_READ_TIMEOUT_MS,
  UPDATE_MANIFEST_FALLBACKS,
  UPDATE_MANIFEST_URL,
} from './updateConfig';
import {
  IGNORED_VERSION_CODE_KEY,
  SNOOZE_KEY,
  SNOOZE_MS,
  isNewer,
  manifestCandidateUrls,
  preferHighestVersionCode,
  shouldPrompt,
} from './updateLogic';
import { parseUpdateManifest } from './updateManifest';

export { SNOOZE_MS };

export const checkStatus = {
  fetchFailed: 'fetchFailed',
  upToDate: 'upToDate',
  updateAvailable: 'updateAvailable',
};

/** True inside the Capacitor shell (Android/iOS), false in a plain browser. */
export const isNativeApp = () => Capacitor.isNativePlatform();

/** True on the Android Capacitor build — the only platform we ship. */
export const isAndroidApp = () => Capacitor.getPlatform() === 'android';

/**
 * The launch check is native-only (the web build is always the latest
 * served bundle). An explicit `VITE_UPDATE_MANIFEST_URL` also enables it,
 * which is how the headless end-to-end test drives the real code path.
 */
export const shouldAutoCheck = () => isNativeApp() || Boolean(ENV_MANIFEST_URL);

// --- storage ------------------------------------------------------------

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
    /* storage unavailable — this session only */
  }
}

// --- installed version --------------------------------------------------

/**
 * Installed app version. On device `@capacitor/app` reports the real
 * `versionName` / `versionCode` from the APK; everywhere else (and if the
 * plugin is unavailable) we fall back to the values baked in at build time
 * from `android/app/build.gradle`.
 */
export async function getInstalledVersion() {
  if (isNativeApp()) {
    try {
      const info = await App.getInfo();
      const code = Number.parseInt(info?.build, 10);
      return {
        versionCode: Number.isFinite(code) && code > 0 ? code : APP_VERSION_CODE,
        versionName: (info?.version || '').trim() || APP_VERSION_NAME,
      };
    } catch {
      /* plugin unavailable — use baked values */
    }
  }
  return { versionCode: APP_VERSION_CODE, versionName: APP_VERSION_NAME };
}

// --- skip / snooze preferences -----------------------------------------

/** Permanently skipped remote versionCode, or null. */
export async function loadIgnoredVersionCode() {
  const raw = await storageGet(IGNORED_VERSION_CODE_KEY);
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** "Skip this version" — never prompt again for this (or an older) code. */
export async function ignoreVersion(versionCode) {
  await storageSet(IGNORED_VERSION_CODE_KEY, String(versionCode));
}

/** Stored "Later" snooze (`{ versionCode, until }`), or null. */
export async function loadSnooze() {
  const raw = await storageGet(SNOOZE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const versionCode = Number(parsed?.versionCode);
    const until = Number(parsed?.until);
    if (Number.isFinite(versionCode) && Number.isFinite(until)) {
      return { versionCode, until };
    }
  } catch {
    /* corrupt value — treat as absent */
  }
  return null;
}

/** "Later" — stay quiet for [ms] so cold starts do not nag. */
export async function snoozeVersion(versionCode, ms = SNOOZE_MS) {
  await storageSet(
    SNOOZE_KEY,
    JSON.stringify({ versionCode, until: Date.now() + ms })
  );
}

// --- manifest fetching --------------------------------------------------

async function fetchManifestFrom(url) {
  const res = await CapacitorHttp.get({
    url,
    headers: { Accept: 'application/json,text/plain,*/*' },
    connectTimeout: MANIFEST_CONNECT_TIMEOUT_MS,
    readTimeout: MANIFEST_READ_TIMEOUT_MS,
  });

  const status = Number(res?.status);
  if (Number.isFinite(status) && (status < 200 || status >= 400)) return null;

  // Native returns a string for `responseType: 'text'`; the web shim parses
  // `application/json` bodies itself, so accept either shape.
  let data = res?.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return parseUpdateManifest(data);
}

/**
 * Try every manifest source and keep the valid one with the highest
 * `versionCode` (a stale jsDelivr `@main` must not hide a newer release).
 * Returns null when all sources fail.
 */
export async function fetchManifest() {
  const candidates = manifestCandidateUrls({
    primary: UPDATE_MANIFEST_URL,
    fallbacks: UPDATE_MANIFEST_FALLBACKS,
  });

  const found = [];
  for (const url of candidates) {
    try {
      const manifest = await fetchManifestFrom(url);
      if (manifest) found.push(manifest);
    } catch {
      /* try the next source */
    }
  }

  const best = preferHighestVersionCode(found);
  if (!best) {
    console.warn(`update: all ${candidates.length} manifest sources failed`);
  }
  return best;
}

/**
 * Full check for the UI.
 *
 * [forceManual] (Settings → Check for updates) ignores skip/snooze so the user
 * can always reach the update after dismissing it.
 *
 * Returns `{ status, manifest, installed }` where status is one of
 * `checkStatus.*`. `fetchFailed` is deliberately distinct from `upToDate` so a
 * manual check never claims "up to date" when the network failed.
 */
export async function checkForPrompt({ forceManual = false } = {}) {
  const installed = await getInstalledVersion();
  const remote = await fetchManifest();

  if (!remote) {
    return { status: checkStatus.fetchFailed, manifest: null, installed };
  }

  const newer = isNewer({
    currentVersionCode: installed.versionCode,
    remoteVersionCode: remote.versionCode,
  });

  if (forceManual) {
    return {
      status: newer ? checkStatus.updateAvailable : checkStatus.upToDate,
      manifest: remote,
      installed,
    };
  }

  const [ignoredVersionCode, snooze] = await Promise.all([
    loadIgnoredVersionCode(),
    loadSnooze(),
  ]);

  const prompt = shouldPrompt({
    currentVersionCode: installed.versionCode,
    remote,
    ignoredVersionCode,
    snooze,
  });

  return {
    status: prompt ? checkStatus.updateAvailable : checkStatus.upToDate,
    manifest: remote,
    installed,
  };
}

// --- acting on the update ----------------------------------------------

/** Fallback for when the Browser plugin is unavailable. */
function openWithAnchor(url) {
  try {
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener noreferrer';
    // A same-tab navigation is intercepted by Capacitor and handed to the
    // system browser; `target="_blank"` is dropped by the Android WebView.
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch {
    return false;
  }
}

/**
 * Hand the APK URL to the system browser (Custom Tab on Android), where the
 * download + sideload install flow works. Never navigates the app itself away
 * from the bundled SPA.
 */
export async function openApkUrl(rawUrl) {
  let url;
  try {
    const parsed = new URL(String(rawUrl));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    url = parsed.toString();
  } catch {
    return false;
  }

  try {
    await Browser.open({ url, presentationStyle: 'fullscreen' });
    return true;
  } catch {
    return openWithAnchor(url);
  }
}

/** Leave the app (forced update on Android); false when not possible. */
export async function exitApp() {
  if (!isAndroidApp()) return false;
  try {
    await App.exitApp();
    return true;
  } catch {
    return false;
  }
}
