# 🔐 Silencium — Feature Roadmap

Scope: a minimal, ephemeral, two-person E2EE chat with ciphertext-only relay.
No accounts, groups, calls, or stored history.

## ✅ Implemented

- End-to-end encrypted text (Libsodium X25519 `crypto_kx` + ChaCha20-Poly1305
  `crypto_secretbox`, in a Web Worker).
- End-to-end encrypted image sharing: client-side compression → encryption →
  binary transport → inline canvas render.
- Ephemeral rooms: in-memory, max 2 participants, destroyed on leave or
  disconnect (5 s reconnect grace).
- Room ids from the browser CSPRNG (`crypto.getRandomValues`, 128 bits,
  base64url) — see B12 in `CUT-PROGRESS.md`.
- System messages for room created / joined / key ready / room destroyed.
- Terminal-style dark UI, mobile-responsive layout, autoscroll.
- Production single-process serving: `NODE_ENV=production node app.js` serves
  `client/dist` with SPA fallback and hosts Socket.IO (B5).
- Runtime-configurable relay URL (B4): a Settings screen / first-launch gate
  saves the base URL (Capacitor Preferences on device); resolution is saved URL
  → `VITE_SERVER_URL` → browser default → native settings gate.
- Android debug APK via Capacitor (`client/android/`,
  `dist-mobile/Silencium-debug.apk`, app id `app.silencium.chat`) wrapping the
  same web client — see `MOBILE-ANDROID.md`.
- **In-app update (Android, same protocol as pokemon-handbook):** on launch the
  app reads a self-hosted `version.json` from
  [`silencium-releases`](https://github.com/peaeae314-hub/silencium-releases)
  (GitHub Releases → jsDelivr → fastly → raw fallback, highest `versionCode`
  wins), compares it with the installed `versionCode`, and offers a localized
  (en / zh-Hans / zh-Hant) soft or forced dialog that opens the `apkUrl` for a
  sideload install; "Later" snoozes and "Skip this version" persists. Web builds
  skip the check — see `MOBILE-ANDROID.md § In-app update`.
- Ciphertext-only relay with no plaintext image path and no database.

## 🛠️ Planned / in progress

- Rate limiting and flood control on the relay, plus a text-size cap (B11).
- `try/catch` around client-side `crypto_secretbox_open_easy` for malformed or
  tampered frames (B11).
- Key fingerprint / TOFU verification to authenticate key exchange (B8) — the
  current handshake is unauthenticated and a malicious relay could MITM.
- Lazy-loading the crypto worker / bundle splitting (B13).
- Reconnect-aware room teardown instead of the fixed 5 s grace (B14).
- Honest production/auth story: TLS termination guidance.

## 🚫 Explicitly never (MVP exclusion)

- Screenshot detection or screenshot prevention.
- One-view images, download blocking, or any "cannot be saved" claim.
- Accounts, groups/admin, voice/video calls, read receipts, cloud history,
  multi-device sync.

## 📌 Notes

- Images: JPG/PNG/GIF up to 6 MB upload, re-encoded to at most 1280×720, max
  3 MB encrypted from the client, 4 MB relay cap, 5 MB socket frame limit.
- Screenshot prevention is not possible for content rendered in a browser; a
  recipient can always capture what they can see.
- No images or messages are stored. Every asset is ephemeral and encrypted, and
  the relay holds only in-memory room membership.
- The relay cannot decrypt content, but it sees metadata and relays public keys
  without authentication (see B8 above).
