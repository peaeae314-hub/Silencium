// One-shot "this page instance is creating a brand-new room" marker.
//
// `CreateRoom` arms the marker right before navigating to `/chat?room=<id>`;
// `ChatRoom` claims (read + delete) it exactly once, for its FIRST `join-room`.
// Every later emit — reconnect, foreground resume, React remount, or a page
// refresh — finds no marker and therefore sends `intent: 'join'`, so a refresh
// can never be mistaken for a create. sessionStorage is per-tab, so two tabs
// each get their own marker.
const CREATE_INTENT_PREFIX = 'silencium.createIntent.';

/** Arm the one-shot create marker for `roomId`. */
export function markCreateIntent(roomId) {
  if (!roomId || typeof roomId !== 'string') return;
  try {
    window.sessionStorage.setItem(CREATE_INTENT_PREFIX + roomId, '1');
  } catch {
    /* storage unavailable — ChatRoom falls back to plain join */
  }
}

/** Read + clear the create marker. Returns true once, false thereafter. */
export function claimCreateIntent(roomId) {
  if (!roomId || typeof roomId !== 'string') return false;
  try {
    const key = CREATE_INTENT_PREFIX + roomId;
    const armed = window.sessionStorage.getItem(key) === '1';
    if (armed) window.sessionStorage.removeItem(key);
    return armed;
  } catch {
    return false;
  }
}
