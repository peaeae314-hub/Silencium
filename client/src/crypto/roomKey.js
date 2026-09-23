/**
 * Room passphrase / shared secret helpers (plan ②).
 *
 * Strength rule (enforced client-side; the raw passphrase NEVER goes to the
 * relay — server-side "validation" is limited to rejecting accidental
 * passphrase fields on join and rate-limiting handshake events):
 *   • Manual entry: ≥ 12 characters after trim.
 *   • Generated keys: 16 CSPRNG bytes (128 bits) encoded as base64url (~22
 *     chars), which also satisfies the length floor.
 *
 * Auth material is derived with Web Crypto PBKDF2-SHA256 (210k iters) over
 * passphrase + a salt bound to roomId. That key authenticates the X25519
 * transcript (B8) and is mixed into the session encryption key.
 */

export const MIN_ROOM_KEY_LENGTH = 12;
export const GENERATED_KEY_BYTES = 16; // 128 bits ≥ 64-bit floor

const ROOM_KEY_STORAGE_PREFIX = 'silencium.roomKey.';

function toBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** CSPRNG room passphrase (≥128 bits). Share out-of-band with the peer. */
export function generateRoomKey() {
  const bytes = new Uint8Array(GENERATED_KEY_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/**
 * @returns {{ ok: true, key: string } | { ok: false, errorKey: string }}
 */
export function validateRoomKey(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, errorKey: 'home.keyRequired' };
  }
  const key = raw.trim();
  if (!key) {
    return { ok: false, errorKey: 'home.keyRequired' };
  }
  // Reject whitespace-only / control-heavy secrets that look empty on screen.
  if (key.length < MIN_ROOM_KEY_LENGTH) {
    return { ok: false, errorKey: 'home.keyTooWeak' };
  }
  return { ok: true, key };
}

export function storeRoomKey(roomId, key) {
  try {
    window.sessionStorage.setItem(ROOM_KEY_STORAGE_PREFIX + roomId, key);
  } catch {
    /* private mode / quota — ChatRoom will re-prompt */
  }
}

export function loadRoomKey(roomId) {
  try {
    return window.sessionStorage.getItem(ROOM_KEY_STORAGE_PREFIX + roomId) || '';
  } catch {
    return '';
  }
}

export function clearRoomKey(roomId) {
  try {
    window.sessionStorage.removeItem(ROOM_KEY_STORAGE_PREFIX + roomId);
  } catch {
    /* ignore */
  }
}
