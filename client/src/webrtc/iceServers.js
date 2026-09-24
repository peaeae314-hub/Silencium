/**
 * ICE server resolution for WebRTC DataChannel (plan ③).
 *
 * Default list = Google public STUNs + Metered Open Relay demo TURN
 * (historically documented username/credential `openrelayproject` /
 * `openrelayproject` on openrelay.metered.ca — UDP + TCP/443 + TURNS).
 *
 * This is a **public demo TURN**: the operator sees connection metadata
 * (IPs, timing, sizes) but packets remain DTLS-encrypted / E2EE ciphertext.
 * Self-hosters and production demos should override via Settings or
 * `VITE_ICE_SERVERS_JSON` (e.g. free Metered account ICE array).
 *
 * Metered may rotate / rate-limit the open credentials; when Allocate fails
 * peerTransport falls back to the encrypted Socket.IO relay automatically.
 */
import { Preferences } from '@capacitor/preferences';

export const ICE_JSON_KEY = 'silencium.ice-servers-json';
export const TURN_URLS_KEY = 'silencium.turn-urls';
export const TURN_USERNAME_KEY = 'silencium.turn-username';
export const TURN_CREDENTIAL_KEY = 'silencium.turn-credential';

/** Google public STUN — always kept as a baseline for host/srflx. */
export const GOOGLE_STUN_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Documented Open Relay / Metered public demo TURN.
 * @see https://www.metered.ca/tools/openrelay/
 * @see https://dev.to/aprogrammer22/list-of-free-stun-and-turn-servers-open-relay-project-3a70
 */
export const OPEN_RELAY_DEMO = {
  username: 'openrelayproject',
  credential: 'openrelayproject',
  urls: [
    'stun:openrelay.metered.ca:80',
    'turn:openrelay.metered.ca:80',
    'turn:openrelay.metered.ca:80?transport=tcp',
    'turn:openrelay.metered.ca:443',
    'turn:openrelay.metered.ca:443?transport=tcp',
    'turns:openrelay.metered.ca:443?transport=tcp',
  ],
};

/** Built-in demo ICE list (STUN + TURN). */
export function defaultIceServers() {
  return [
    ...GOOGLE_STUN_SERVERS,
    {
      urls: OPEN_RELAY_DEMO.urls,
      username: OPEN_RELAY_DEMO.username,
      credential: OPEN_RELAY_DEMO.credential,
    },
  ];
}

/** True when the list includes at least one turn:/turns: URL. */
export function iceServersHaveTurn(servers) {
  if (!Array.isArray(servers)) return false;
  for (const entry of servers) {
    const urls = entry?.urls;
    const list = Array.isArray(urls) ? urls : urls ? [urls] : [];
    if (list.some((u) => typeof u === 'string' && /^turns?:/i.test(u))) {
      return true;
    }
  }
  return false;
}

/**
 * Validate / normalise an RTCIceServer[]-shaped JSON value.
 * Returns `{ servers }` or `{ error, errorKey }`.
 */
export function normalizeIceServersJson(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) {
      return { error: 'Paste an ICE servers JSON array.', errorKey: 'settings.iceErrEmpty' };
    }
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: 'ICE JSON is not valid JSON.', errorKey: 'settings.iceErrJson' };
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return {
      error: 'ICE servers must be a non-empty JSON array.',
      errorKey: 'settings.iceErrArray',
    };
  }
  const servers = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      return { error: 'Each ICE entry must be an object.', errorKey: 'settings.iceErrEntry' };
    }
    const urls = entry.urls;
    const urlList = Array.isArray(urls) ? urls : urls ? [urls] : [];
    if (!urlList.length || !urlList.every((u) => typeof u === 'string' && u.trim())) {
      return {
        error: 'Each ICE entry needs a urls string or string array.',
        errorKey: 'settings.iceErrUrls',
      };
    }
    const normalised = {
      urls: urlList.length === 1 ? urlList[0].trim() : urlList.map((u) => u.trim()),
    };
    if (typeof entry.username === 'string' && entry.username) {
      normalised.username = entry.username;
    }
    if (typeof entry.credential === 'string' && entry.credential) {
      normalised.credential = entry.credential;
    }
    servers.push(normalised);
  }
  return { servers };
}

/**
 * Parse TURN URL field (one per line or comma-separated).
 * Accepts turn:/turns:/stun: URIs.
 */
export function parseTurnUrls(raw) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { error: 'Enter at least one TURN URL.', errorKey: 'settings.turnErrEnter' };
  }
  const parts = raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) {
    return { error: 'Enter at least one TURN URL.', errorKey: 'settings.turnErrEnter' };
  }
  for (const u of parts) {
    if (!/^(turns?|stuns?):/i.test(u)) {
      return {
        error: 'URLs must start with turn:, turns:, stun:, or stuns:.',
        errorKey: 'settings.turnErrScheme',
      };
    }
  }
  return { urls: parts };
}

async function storageGet(key) {
  try {
    const { value } = await Preferences.get({ key });
    if (typeof value === 'string' && value) return value;
  } catch {
    /* fall through */
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
    /* fall through */
  }
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

async function storageRemove(key) {
  try {
    await Preferences.remove({ key });
  } catch {
    /* ignore */
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// Sync caches (populated by initIceConfig).
let cachedIceJson = null; // string | null
let cachedTurnUrls = null;
let cachedTurnUsername = null;
let cachedTurnCredential = null;

export function getSavedIceJson() {
  return cachedIceJson;
}
export function getSavedTurnUrls() {
  return cachedTurnUrls;
}
export function getSavedTurnUsername() {
  return cachedTurnUsername;
}
export function getSavedTurnCredential() {
  return cachedTurnCredential;
}

/** Load Preferences / localStorage into the sync cache. Call once at boot. */
export async function initIceConfig() {
  const [iceJson, turnUrls, turnUser, turnCred] = await Promise.all([
    storageGet(ICE_JSON_KEY),
    storageGet(TURN_URLS_KEY),
    storageGet(TURN_USERNAME_KEY),
    storageGet(TURN_CREDENTIAL_KEY),
  ]);
  cachedIceJson = iceJson || null;
  cachedTurnUrls = turnUrls || null;
  cachedTurnUsername = turnUser || null;
  cachedTurnCredential = turnCred || null;
}

export async function saveIceServersJson(raw) {
  const result = normalizeIceServersJson(raw);
  if (result.error) return result;
  const text = typeof raw === 'string' ? raw.trim() : JSON.stringify(result.servers, null, 2);
  await storageSet(ICE_JSON_KEY, text);
  cachedIceJson = text;
  // Full JSON overrides TURN fields — clear them to avoid confusion.
  await storageRemove(TURN_URLS_KEY);
  await storageRemove(TURN_USERNAME_KEY);
  await storageRemove(TURN_CREDENTIAL_KEY);
  cachedTurnUrls = null;
  cachedTurnUsername = null;
  cachedTurnCredential = null;
  return { servers: result.servers };
}

export async function saveTurnOverride({ urls, username, credential }) {
  const parsed = parseTurnUrls(urls);
  if (parsed.error) return parsed;
  const user = typeof username === 'string' ? username.trim() : '';
  const cred = typeof credential === 'string' ? credential.trim() : '';
  if (!user || !cred) {
    return {
      error: 'TURN username and credential are required.',
      errorKey: 'settings.turnErrAuth',
    };
  }
  const urlsText = parsed.urls.join('\n');
  await storageSet(TURN_URLS_KEY, urlsText);
  await storageSet(TURN_USERNAME_KEY, user);
  await storageSet(TURN_CREDENTIAL_KEY, cred);
  // TURN fields override full JSON — clear it.
  await storageRemove(ICE_JSON_KEY);
  cachedIceJson = null;
  cachedTurnUrls = urlsText;
  cachedTurnUsername = user;
  cachedTurnCredential = cred;
  return { urls: parsed.urls, username: user, credential: cred };
}

export async function clearIceOverrides() {
  await Promise.all([
    storageRemove(ICE_JSON_KEY),
    storageRemove(TURN_URLS_KEY),
    storageRemove(TURN_USERNAME_KEY),
    storageRemove(TURN_CREDENTIAL_KEY),
  ]);
  cachedIceJson = null;
  cachedTurnUrls = null;
  cachedTurnUsername = null;
  cachedTurnCredential = null;
}

function parseEnvIceServers() {
  const env = import.meta.env.VITE_ICE_SERVERS_JSON;
  if (typeof env !== 'string' || !env.trim()) return null;
  const result = normalizeIceServersJson(env);
  return result.servers || null;
}

/**
 * Effective RTCIceServer list for this session.
 * Order: saved ICE JSON → saved TURN override (+ Google STUN) →
 * `VITE_ICE_SERVERS_JSON` → built-in Open Relay demo defaults.
 * Sync — call `initIceConfig()` at boot first.
 */
export function resolveIceServers() {
  if (cachedIceJson) {
    const result = normalizeIceServersJson(cachedIceJson);
    if (result.servers) return result.servers;
  }

  if (cachedTurnUrls) {
    const parsed = parseTurnUrls(cachedTurnUrls);
    if (parsed.urls) {
      return [
        ...GOOGLE_STUN_SERVERS,
        {
          urls: parsed.urls.length === 1 ? parsed.urls[0] : parsed.urls,
          username: cachedTurnUsername || undefined,
          credential: cachedTurnCredential || undefined,
        },
      ];
    }
  }

  const fromEnv = parseEnvIceServers();
  if (fromEnv) return fromEnv;

  return defaultIceServers();
}
