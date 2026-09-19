import { io } from 'socket.io-client';
import { resolveServerUrl } from './serverUrl';

// Placeholder used only until the saved URL is applied at boot. `autoConnect` is
// false, so this never dials localhost from a native shell — App.jsx resolves the
// URL (and blocks on Settings when none is set) before any screen connects.
const PLACEHOLDER_URL = 'http://localhost:3001';

const SOCKET_OPTIONS = {
  autoConnect: false,
  transports: ['websocket'], // Force WebSocket only
  forceBase64: false, // Allow binary data
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
};

const attachLogging = (instance) => {
  if (!import.meta.env.DEV) return;
  instance.on('connect', () => {
    console.log('🟢 Connected to server with ID:', instance.id);
  });
  instance.on('disconnect', () => {
    console.log('🔴 Disconnected from server');
  });
  instance.on('connect_error', (err) => {
    console.error('Connection error:', err.message);
  });
};

let currentUrl = resolveServerUrl() || PLACEHOLDER_URL;
let socket = io(currentUrl, SOCKET_OPTIONS);
attachLogging(socket);

/** The relay URL the current socket instance was created with. */
export const getSocketUrl = () => currentUrl;

/**
 * Point the client at a relay base URL. Recreates the Socket.IO instance when the
 * URL actually changes and tears the old one down; the `socket` export is a live
 * ESM binding, so importers pick up the new instance.
 */
export function applyServerUrl(url) {
  if (!url || url === currentUrl) return socket;

  const previous = socket;
  currentUrl = url;
  socket = io(url, SOCKET_OPTIONS);
  attachLogging(socket);

  try {
    previous.removeAllListeners();
    previous.disconnect();
  } catch {
    /* best effort — the old manager is discarded either way */
  }

  return socket;
}

export { socket };
