// Room-id format + generation (shared by the create/join form).
//
// The relay keeps its own copy of the pattern in
// `server/rooms/roomManager.js` (ROOM_ID_PATTERN / isValidRoomId) because it is
// CommonJS and cannot import this ESM module. KEEP THE TWO IN SYNC: the server
// rejects any join whose roomId does not match this exact pattern.

export const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;
export const ROOM_ID_MIN_LENGTH = 4;
export const ROOM_ID_MAX_LENGTH = 64;

// A room id IS the join capability (B12): anyone who knows it can try to join.
// Human-chosen ids below this length are easy to guess; the create form warns
// about them but still allows the create.
export const SHORT_ROOM_ID_WARN_LEN = 8;

// 16 bytes (128 bits) from the CSPRNG, base64url-encoded (22 URL/query-safe
// characters, no padding). Do not fall back to Math.random().
const ROOM_ID_BYTES = 16;

/** True when `raw`, after trimming, matches the room-id format. */
export function isValidRoomId(raw) {
  if (typeof raw !== 'string') return false;
  return ROOM_ID_PATTERN.test(raw.trim());
}

/** True when a non-empty id is valid but shorter than SHORT_ROOM_ID_WARN_LEN. */
export function isShortRoomId(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value.length > 0 && value.length < SHORT_ROOM_ID_WARN_LEN;
}

/** Random 128-bit room id, base64url (22 chars). */
export function generateRoomId() {
  const bytes = new Uint8Array(ROOM_ID_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
