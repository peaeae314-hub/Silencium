# 🔐 Silencium — Feature Roadmap

Scope: a minimal, ephemeral, two-person E2EE chat with ciphertext-only relay.
No accounts, groups, calls, or stored history.

## ✅ Implemented

- End-to-end encrypted text (Libsodium X25519 `crypto_kx` + ChaCha20-Poly1305
  `crypto_secretbox`, in a Web Worker). Session keys are bound to a
  passphrase-derived auth key (see B8).
- End-to-end encrypted image sharing: client-side compression → encryption →
  binary transport → inline canvas render.
- **Passphrase / room key (plan ②):** create and join require a shared secret
  (≥12 characters, or a 128-bit generated key). The raw passphrase is never
  sent to the relay; auth material is derived with `PBKDF2-SHA256` (Web Crypto; 210k iterations)
  salted by room id.
- **Authenticated key exchange (B8):** after X25519 pubkey relay, both peers
  MAC the canonical transcript with the passphrase-derived key. Matching
  passphrases auto-verify; mismatches or MITM’d pubkeys fail closed (chat
  blocked). A short verification code is shown for optional out-of-band compare.
- **Rate limiting + text cap (B11):** join / public-key / auth-proof / message
  events are limited per IP and per room; encrypted text frames capped at 64 KiB;
  client decrypt paths use `try/catch`.
- **WebRTC DataChannel (plan ③)** for message/image ciphertext when ICE
  succeeds. Prefers P2P (Google STUN + demo Open Relay TURN by default);
  optional custom TURN / full ICE JSON in Settings or `VITE_ICE_SERVERS_JSON`.
  Socket.IO stays for signaling + membership and is the automatic fallback when
  the data channel fails. TURN operators see connection metadata only — payloads
  remain E2EE; room keys never go on the wire.
- Ephemeral rooms: in-memory, max 2 participants, destroyed on leave or
  disconnect (**60 s** reconnect grace, B14).
- Room ids from the browser CSPRNG (`crypto.getRandomValues`, 128 bits,
  base64url) — see B12 in `CUT-PROGRESS.md`.
- **Optional custom room ids (v1.5.0):** the create form accepts a human-chosen
  id (`^[A-Za-z0-9_-]{4,64}$`), enforced on both the client and the relay. The
  first join from the create page carries a one-shot `intent: 'create'`; if the
  id is already occupied — including a seat held by the B14 reconnect grace —
  the create is refused with a machine-readable `ROOM_OCCUPIED` code and the
  form shows an inline message, while ordinary joins are unchanged. A creator's
  own reconnect / foreground resume / refresh / duplicate join is never treated
  as a new create. Ids under 8 characters warn as easy to guess.
- System messages for room created / joined / key ready / room destroyed.
- Terminal-style dark UI, mobile-responsive layout, autoscroll.
- Production single-process serving: `NODE_ENV=production node app.js` serves
  `client/dist` with SPA fallback and hosts Socket.IO (B5).
- Runtime-configurable relay URL (B4): **normal UX does not require typing a
  tunnel URL** — browser production uses same-origin; Capacitor uses
  `VITE_SERVER_URL` or Settings. Advanced override remains under Settings /
  “Show relay” on the home screen.
- Invite links encode **room id only**; the room key is shared out-of-band.
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
- **`ops/retained/` plaintext capture is OFF by default** and is not wired into
  the normal server. Ops-only explicit opt-in if used at all.

## 🛠️ Planned / in progress

- Lazy-loading the crypto worker / bundle splitting (B13).
- Honest production/auth story: TLS termination guidance (ops docs).
- **Plan ④ deferred:** SimpleX-like rewrite (no shared room id / different
  transport model) is explicitly out of scope for this ship.

## 🚫 Explicitly never (MVP exclusion)

- Screenshot detection or screenshot prevention.
- One-view images, download blocking, or any "cannot be saved" claim.
- Accounts, groups/admin, voice/video calls, read receipts, cloud history,
  multi-device sync.
- Perfect Forward Secrecy (session keys are per-room, not ratcheted).
- “No metadata” claims — the relay still sees membership, timing, and sizes.

## 📌 Notes

- Images: JPG/PNG/GIF up to 6 MB upload, re-encoded to at most 1280×720, max
  3 MB encrypted from the client, 4 MB relay cap, 5 MB socket frame limit.
- Screenshot prevention is not possible for content rendered in a browser; a
  recipient can always capture what they can see.
- No images or messages are stored by the relay. Every asset is ephemeral and
  encrypted, and the relay holds only in-memory room membership.
- The relay cannot decrypt content. With a matching room key, a malicious relay
  that substitutes pubkeys fails verification (B8). Metadata is still visible.
