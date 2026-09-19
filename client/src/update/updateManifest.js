// Remote release manifest (`version.json`) — same schema as pokemon-handbook,
// plus the two extra changelog translations Silencium ships:
//   versionCode, versionName, apkUrl, force,
//   changelogZh / changelogEn / changelogZhHant

function asString(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function asVersionCode(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  const parsed = Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** True for a usable absolute HTTPS/HTTP URL. */
export function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Parse a decoded `version.json` object.
 * Returns `null` for anything unusable (bad JSON shape, no versionCode, no
 * apkUrl) so the caller can move on to the next manifest source.
 */
export function parseUpdateManifest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const versionCode = asVersionCode(raw.versionCode);
  const apkUrl = asString(raw.apkUrl).trim();
  if (versionCode <= 0 || !isHttpUrl(apkUrl)) return null;

  return {
    versionCode,
    versionName: asString(raw.versionName).trim(),
    apkUrl,
    force: raw.force === true,
    changelogZh: asString(raw.changelogZh).trim(),
    changelogEn: asString(raw.changelogEn).trim(),
    changelogZhHant: asString(raw.changelogZhHant).trim(),
  };
}
