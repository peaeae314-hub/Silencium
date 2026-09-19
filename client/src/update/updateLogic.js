// Pure helpers for the in-app update check — version compare, "skip"/snooze
// decisions, multi-source manifest URLs and changelog selection.
//
// Deliberately dependency-free (no Vite env, no Capacitor, no DOM) so it can be
// unit-tested from plain Node — mirror of pokemon-handbook's
// `lib/features/update/update_logic.dart`.

/** Skip-this-version preference key (remote `versionCode`). */
export const IGNORED_VERSION_CODE_KEY = 'silencium.update-ignored-version-code';

/** "Later" snooze preference key (`{ versionCode, until }` JSON). */
export const SNOOZE_KEY = 'silencium.update-snooze';

/** How long "Later" stays quiet before the prompt may appear again. */
export const SNOOZE_MS = 12 * 60 * 60 * 1000;

/**
 * Built-in fallbacks tried after the configured primary URL. Order matters:
 * the GitHub Release asset is authoritative, then jsDelivr (fast + CORS *),
 * then raw.githubusercontent (CORS *). Same list as pokemon-handbook.
 */
export const builtInManifestFallbacks = [
  'https://github.com/peaeae314-hub/silencium-releases/releases/latest/download/version.json',
  'https://cdn.jsdelivr.net/gh/peaeae314-hub/silencium-releases@main/version.json',
  'https://fastly.jsdelivr.net/gh/peaeae314-hub/silencium-releases@main/version.json',
  'https://raw.githubusercontent.com/peaeae314-hub/silencium-releases/main/version.json',
];

/** Whether [remoteVersionCode] is newer than the installed [currentVersionCode]. */
export function isNewer({ currentVersionCode, remoteVersionCode }) {
  return remoteVersionCode > currentVersionCode;
}

/**
 * Whether the UI should show an update prompt.
 *
 * - not newer → never prompt
 * - `force: true` → always prompt (skips/snoozes ignored)
 * - permanently skipped that (or an older) remote code → stay quiet
 * - "Later" within the snooze window for that code → stay quiet
 */
export function shouldPrompt({
  currentVersionCode,
  remote,
  ignoredVersionCode = null,
  snooze = null,
  now = Date.now(),
}) {
  if (
    !isNewer({
      currentVersionCode,
      remoteVersionCode: remote.versionCode,
    })
  ) {
    return false;
  }
  if (remote.force) return true;

  // `Number.isFinite(null)` is false, so a missing pref is handled here too.
  if (Number.isFinite(ignoredVersionCode) && remote.versionCode <= ignoredVersionCode) {
    return false;
  }

  if (
    snooze &&
    Number.isFinite(snooze.versionCode) &&
    Number.isFinite(snooze.until) &&
    remote.versionCode <= snooze.versionCode &&
    now < snooze.until
  ) {
    return false;
  }

  return true;
}

/** True for jsDelivr hosts that often serve a stale `@main` blob from cache. */
export function isCdnManifestUrl(url) {
  try {
    const host = new URL(url).host.toLowerCase();
    return host === 'cdn.jsdelivr.net' || host === 'fastly.jsdelivr.net';
  } catch {
    return false;
  }
}

/** Stable dedupe key (scheme + host + path, query ignored). */
export function manifestUrlKey(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return String(url).trim();
  }
}

/** Append/replace `?t=<epochMs>` on CDN URLs to defeat the `@main` cache. */
export function withCacheBust(url, epochMs) {
  if (!isCdnManifestUrl(url)) return url;
  try {
    const u = new URL(url);
    u.searchParams.set('t', String(epochMs));
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Ordered unique candidate URLs: primary first, then the built-in fallbacks.
 * CDN entries get a `?t=` cache-buster.
 */
export function manifestCandidateUrls({
  primary = '',
  fallbacks = builtInManifestFallbacks,
  cacheBustMs,
} = {}) {
  const t = cacheBustMs ?? Date.now();
  const raw = [
    ...(typeof primary === 'string' && primary.trim() ? [primary.trim()] : []),
    ...fallbacks,
  ];
  const seen = new Set();
  const out = [];
  for (const url of raw) {
    const key = manifestUrlKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(withCacheBust(url, t));
  }
  return out;
}

/**
 * Among successfully parsed manifests, prefer the highest `versionCode`
 * (ties → the earlier entry, i.e. the more authoritative source).
 */
export function preferHighestVersionCode(manifests) {
  let best = null;
  for (const m of manifests || []) {
    if (!m || m.versionCode <= 0 || !m.apkUrl) continue;
    if (!best || m.versionCode > best.versionCode) best = m;
  }
  return best;
}

/**
 * Changelog for the active locale, falling back to the other shipped
 * languages before giving up (`en` → `changelogEn` → `changelogZh`).
 */
export function pickChangelog(manifest, locale) {
  if (!manifest) return '';
  const zhHans = (manifest.changelogZh || '').trim();
  const zhHant = (manifest.changelogZhHant || '').trim();
  const en = (manifest.changelogEn || '').trim();

  if (locale === 'zh-Hans') return zhHans || en || zhHant;
  if (locale === 'zh-Hant') return zhHant || zhHans || en;
  return en || zhHans || zhHant;
}

/** Human label for the installed version, e.g. `1.1.0 (2)`. */
export function installedLabel(installed) {
  if (!installed || !installed.versionCode) return '';
  const name = (installed.versionName || '').trim();
  return name ? `${name} (${installed.versionCode})` : `(${installed.versionCode})`;
}
