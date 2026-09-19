# Silencium → MVP Cut List

**Target:** minimal web app — no accounts, ephemeral 2-person rooms created/joined by link, E2EE text + image, ciphertext-only relay.
**Rule:** keep Silencium's existing Libsodium E2EE as-is (X25519 `crypto_kx` + ChaCha20-Poly1305 `crypto_secretbox`). Do not invent crypto.
**Status of this document:** produced after a verified local run of upstream `main` (`af66217`, 2025-08-02). No rewrite was started.

---

## 0. Verified local run (success criterion 1–3)

Repo cloned to `/workspace/Silencium`. Both processes run and were smoke-tested.

```bash
# Terminal 1 — ciphertext relay (Express + Socket.IO), port 3001
cd /workspace/Silencium/server
npm install
node app.js

# Terminal 2 — React/Vite frontend, port 5173
cd /workspace/Silencium/client
npm install
npm run dev -- --host 127.0.0.1
```

Open **http://localhost:5173** → **Create Chat Room** → copy the share link → open it in a second tab/device (e.g. `http://localhost:5173/chat?room=<id>`).
Plain `npm run dev` also works but binds IPv6-only (`[::1]`); then use `http://localhost:5173` — **`http://127.0.0.1:5173` returns nothing**. The `--host 127.0.0.1` flag fixes that.

**Environment that worked:** Node `v22.19.0`, npm `10.9.3` (Debian 13). `pnpm`/`yarn` are not installed — use npm.

**End-to-end verification** (`tools/smoke-test.cjs`, run with the server up):

```bash
NODE_PATH=/workspace/Silencium/client/node_modules node tools/smoke-test.cjs
```

Result: **9/9 passed** — two peers connect, derive a matching X25519 session key, decrypt a text message and an encrypted image relayed through the server, third peer rejected (`Room is full`), room destroyed on leave. The same run also *proves* two defects listed in §4.

---

## 1. KEEP — core MVP surface

| # | Feature / area | Files |
|---|---|---|
| K1 | **Create room + share link** (room id in query string, copy link) | `client/src/pages/CreateRoom.jsx`, `ChatRoom.jsx` header/share block, `App.jsx` route `/` and `/chat` |
| K2 | **E2EE text chat** — encrypt on device, relay ciphertext, decrypt on peer | `client/src/crypto/crypto.worker.js`, `workerWrapper.js`, `ChatRoom.jsx` `sendMessage` / `receive-message`, `server/app.js` `send-message` → `receive-message` |
| K3 | **E2EE image send** — client compress → encrypt → relay → decrypt → render | `ChatRoom.jsx` `handleImageUpload` / `compressImage` / `receive-encrypted-image`, `server/app.js` `send-encrypted-image`, `CanvasImageRenderer.jsx` (**inline render only**, see C4) |
| K4 | **Libsodium crypto primitives — frozen, do not touch** | `crypto_kx_keypair`, `crypto_kx_client/server_session_keys`, `crypto_secretbox_easy/open_easy`; `libsodium-wrappers` dependency. Keep the existing client/server-role split and nonce handling exactly. |
| K5 | **Public-key exchange + shared-key derivation** (worker path) | `server/app.js` `send-public-key` → `receive-public-key`; `ChatRoom.jsx` `handleKeyExchange` |
| K6 | **Ciphertext-only relay server, no DB** | `server/app.js` (Express + Socket.IO, in-memory only), `package.json` deps `express`/`socket.io`/`cors` |
| K7 | **Temporary rooms destroyed on leave/disconnect, 2-person cap** | `server/rooms/roomManager.js` (max 2, in-memory `rooms` map), `server/app.js` `leave-room` + `disconnect` |
| K8 | **No accounts / anonymous socket identity** | `client/src/utils/socket.js`, `server/app.js` `socket.id` usage |
| K9 | **Terminal/hacker theme, mobile-responsive layout, autoscroll** | `client/src/src/styles/hacker-theme.css` (trim duplicates), `client/src/index.css`, `client/src/src/hooks/useAutoScroll.js` |
| K10 | **“Encryption Active” status indicator** and system messages (room created / joined / key ready / room destroyed) | `ChatRoom.jsx` `encryption-status` block + `system-message`, `room-destroyed`, `join-error` handlers |
| K11 | **Client-side image compression before encryption** (keeps payloads sane) | `ChatRoom.jsx` `compressImage` (max 1280×720, JPEG q0.6) |

## 2. REMOVE / DISABLE

### 2A. Security-critical (remove first)

| # | Item | Where | Why |
|---|---|---|---|
| R1 | **Plaintext image relay** `image-message` → `receive-image` | `server/app.js:79–104`; client listener `ChatRoom.jsx:47–55, 120–125` | Relays unencrypted `data:image/...` base64 with **no crypto at all**. Violates “ciphertext relay only, no plaintext”. Verified reachable: smoke test relays an unencrypted image through the live server. Delete server handler + client `receive-image` handler. |
| R2 | **Image download button** | `CanvasImageRenderer.jsx:51–56, 156–174` | Directly contradicts ephemeral/one-view intent; out of scope. |
| R3 | **Screenshot-detection claims** | README:12, 196–199; `FEATURES.md` | **No such code exists anywhere** (grep: only `onContextMenu` blocks on images). Do not build it — explicitly out of scope. Strip the claim from docs. |

### 2B. Dead code / orphaned UI (no behavior change)

| # | Item | Where | Note |
|---|---|---|---|
| R4 | `TestCrypto.jsx` page | `client/src/pages/TestCrypto.jsx` | Never imported or routed. |
| R5 | `crypto/sodium.js` | `client/src/crypto/sodium.js` | Only consumer is R4. Second, divergent crypto path (XChaCha20 + `sharedRx`) — a correctness trap. Keep **one** crypto path (the worker). |
| R6 | `JoinRoom.jsx` + `/join` route | `client/src/pages/JoinRoom.jsx`, `App.jsx:18` | Orphan: no link/button points to `/join`; on mount it emits `join-room` with `null` roomId. Link-join already works via `/chat?room=…`. |
| R7 | `utils/constants.js` | `client/src/utils/constants.js` | Not imported anywhere (`MESSAGE_TYPES`/`SOCKET_EVENTS`/`CRYPTO` unused). |
| R8 | `utils/animations.js` | `client/src/utils/animations.js` | Imported for side effect only (`ChatRoom.jsx:12`); all 3 exports unused. |
| R9 | Unused crypto helpers in `libs.js` | `client/src/crypto/libs.js:28–81` | `deriveSharedKey`, `encryptMessage`, `decryptMessage` unused; chat uses the worker. Keep only `initSodium`/`generateKeyPair`/`getMyKeyPair` (or fold into the worker and delete the file). |
| R10 | Vite template leftovers | `client/src/App.css`, `client/src/assets/react.svg`, `client/public/vite.svg` | `App.css` never imported; SVGs unused (favicon can be inlined). |
| R11 | Dead CSS | `hacker-theme.css` | `.typing-indicator` + `@keyframes blink` (no typing indicator exists), legacy WhatsApp palettes `.message-me/.bubble/.arrow*`, duplicated `.system-msg`/`.timestamp`/`.message-row` rule blocks (some overridden twice). |
| R12 | Duplicate border wrapper | `client/index.html:17–28, 32–35` vs `hacker-theme.css:11–21` | Same `.chat-border-wrapper` defined twice, wrapping `#root`. |
| R13 | Server noise events | `server/app.js:70–76` (`room-update`, `start-chat`) | No client listener for either. Remove until needed. |
| R14 | Client listener `user-left` | `ChatRoom.jsx:575–579` | Server never emits `user-left` (it emits `room-destroyed`). |
| R15 | `myPublicKeySent` ref | `ChatRoom.jsx:20, 318` | Written, never read. |

### 2C. Features to cut for MVP (present upstream, out of scope)

| # | Item | Where | Recommendation |
|---|---|---|---|
| R16 | **Inactivity auto-destruct subsystem** (15 s idle detect → 10 min countdown → destroy) | server `app.js:27, 149–177`; client `ChatRoom.jsx:16–17, 412–490, 584–586, 675–685` | **Cut.** Requirement is “destroy when participants leave / chat ends”, already covered by R22/K7. Removing kills `roomCountdowns`, 2 socket events, 4 window listeners, and the countdown UI. Re-add later only if the product wants idle expiry. |
| R17 | Fullscreen image viewer (zoom, pan, wheel) | `CanvasImageRenderer.jsx:5–9, 39–105, 111–252` | **Cut for MVP.** Inline canvas render only. Re-add zoom later if needed. |
| R18 | Right-click / context-menu “protection” on images | `CanvasImageRenderer.jsx:247, 280` | Cut — cosmetic, trivially bypassed, belongs to the screenshot-deterrent work that is out of scope. |
| R19 | External font CDNs (Google Fonts, `cdnfonts.com`) | `client/index.html:6–11`; `Orbitron`/`Share Tech Mono` inline styles | **Replace** with a system monospace stack. Third-party requests leak visitors to Google/CDNFonts — wrong for a privacy product — and break offline. |
| R20 | README/FAQ overclaims | `README.md` (FAQ 242–315), `FEATURES.md` | Rewrite: drop screenshot detection, one-view images, “server is completely blind”, and the broken production instructions (see §4 B5). |
| R21 | `README.md` duplicated Troubleshooting section | `README.md:165–219` and `203–219` | Two troubleshooting headings; also contradict each other on image limits (3 MB vs 5 MB). |
| R22 | — (explicitly never build) | — | Accounts, groups/admin, calls, read receipts, cloud history, multi-device sync, screenshot detection. |

## 3. Suggested order of cuts

Each step should leave `npm run dev` + `tools/smoke-test.cjs` green.

1. **R1 + R2** — remove the plaintext image path and the download button. Highest security value, zero MVP loss.
2. **R4–R10** — delete dead files (`TestCrypto`, `sodium.js`, `JoinRoom`+route, `constants.js`, `animations.js`, `App.css`, SVGs) and trim `libs.js`. Pure deletion; build stays green.
3. **R15, R14, R13** — delete unused refs, dead listener, dead server events.
4. **R16** — remove the inactivity subsystem (server then client). Biggest line-count reduction left.
5. **R17 + R18** — reduce `CanvasImageRenderer` to an inline renderer.
6. **R11 + R12** — de-duplicate CSS and `index.html`; **R19** swap fonts to system monospace.
7. **Fix image transport** (B6) — see §4: send ciphertext as binary (`Uint8Array`/`ArrayBuffer`) instead of `Array.from(...)`, raise `maxHttpBufferSize`, give the user a real failure message. Without this the K3 feature is unreliable.
8. **Fix `rooms` ReferenceError** (B9) or delete the broken previous-room block.
9. **Production path** (B5): either add `express.static(client/dist)` + SPA fallback to `server/app.js`, or keep the documented two-process dev setup and drop the false production instructions.
10. **Docs** (R20, R21) and **room-id hardening** (B12): generate room ids with `crypto.getRandomValues` (≥128 bits), not `Math.random().toString(36).slice(2,10)`.
11. Deferred / optional: rate limiting, decrypt-error handling (B11), bundle splitting (B13), longer reconnect grace (B14).

## 4. Blockers, defects, and gotchas found while running

**Environment / running**

- **B1 — Sandbox blocks writes outside the session workspace.** Under the initial `workspace-write` policy, `git clone` into `/workspace/Silencium`, `npm install`, and `vite` (config/dep cache) all failed with `EACCES`/`operation rejected`. Every one needed a wider file mode. If a future session starts in `workspace-write`, clone/install *inside* `/workspace/deepseek-harness` or grant `danger-full-access` up front. (Policy was switched to `danger-full-access` mid-session, after which everything ran clean.)
- **B2 — Node/npm:** Node `v22.19.0` satisfies README's “v16+”. No `.nvmrc`/`engines` field. npm only; no `pnpm`/`yarn` on this machine.
- **B3 — Vite binds IPv6 loopback only.** Default `vite` listens on `[::1]:5173`, so `http://127.0.0.1:5173` fails while `http://localhost:5173` works. Fix: `npm run dev -- --host 127.0.0.1` (or `--host` for LAN/phone testing). Documented in §0.
- **B4 — Ports and hardcoded URL.** Server defaults to `3001` (`PORT` env overridable). Client hardcodes `http://localhost:3001` in dev (`client/src/utils/socket.js:3–5`) with **no env var** — changing the server port breaks the client unless this file is edited. Move to `import.meta.env.VITE_SERVER_URL`.
- **B5 — Production mode is broken as documented.** `README.md:154–163` says `npm run build` then `NODE_ENV=production node app.js`, but `server/app.js` contains **no `express.static`, `sendFile`, or `dist` reference** — production start serves only the text `Silencium server running`. Meanwhile the client's production socket URL is `window.location.origin` (`socket.js:3`), so it expects same-origin serving that does not exist. `npm run build` itself succeeds (88 modules, `dist/` produced, **exit 0**), so this is purely a wiring gap, not a build failure.
- **B6 — Image sends can silently fail (transport bug).** Ciphertext is shipped as a JS number array: `Array.from(ciphertext)` (`ChatRoom.jsx:215`, `server` payload), i.e. JSON. Measured: **1 MiB of ciphertext → 3.57 MiB of JSON**, while the server's `maxHttpBufferSize` is **3 MiB** (`server/app.js:20`) and violations are only `console.warn`-ed away (`app.js:82–85`). The client permits up to **2 MiB** encrypted bytes (`ChatRoom.jsx:190`), i.e. ~7 MiB on the wire. Net effect: photos above roughly 0.8 MiB of compressed data vanish with no user feedback. Send binary frames instead of number arrays and align the limits; surface failures in the UI.
- **B7 — Plaintext image relay is live** (R1) — confirmed by smoke test, not just code reading.
- **B8 — Key exchange is unauthenticated.** The server relays raw X25519 public keys (`send-public-key`/`receive-public-key`), so a malicious or compromised relay can substitute keys and MITM. Silencium's README overclaims that the server “cannot read, modify, or access” anything. This is inherent to the design (`crypto_kx` without authentication) and fixing it needs a fingerprint/TOFU step — **out of MVP scope**, but it must be documented honestly rather than advertised as solved. Do not hand-roll a fix.
- **B9 — `ReferenceError` bug in `join-room`.** `server/app.js:48` does `delete rooms[prevRoomId]`, but `rooms` is module-private to `roomManager.js`, not defined in `app.js`. The whole “leave previous room” block (`app.js:40–51`) throws if a socket joins a second room while already in one. Either route this through a `roomManager.leaveRoom(socket.id)` call or delete the block.
- **B10 — libsodium build warning.** Vite reports `Module "crypto" has been externalized for browser compatibility` from `libsodium-wrappers`. Build still succeeds and the worker bundle works; cosmetic, but expect it.
- **B11 — Robustness gaps.** No rate limiting or text-size cap on the relay; client `receive-message` has no `try/catch` around `crypto_secretbox_open_easy`, so a malformed/tampered frame throws unhandled (`ChatRoom.jsx:526–546`); `join-error` is only surfaced via `alert()`.
- **B12 — Weak room ids.** `CreateRoom.jsx:8` uses `Math.random().toString(36).substring(2, 10)` (~41 bits, non-CSPRNG). Room id is a join capability, not the E2EE key, but it is guessable. Use `crypto.getRandomValues`.
- **B13 — Bundle size.** Production build emits `index-*.js` 1.04 MB (338 KB gzip) + `crypto.worker-*.js` 750 KB. Acceptable for MVP; consider lazy-loading the crypto worker.
- **B14 — Aggressive teardown may be wrong for mobile.** Any `disconnect` destroys the room after a 5 s grace (`server/app.js:222–257`), and any explicit leave destroys it immediately. On flaky mobile networks a brief drop ends the chat for everyone. Product decision: keep the “participants leave → destroy” rule (it matches the requirement) but consider a longer/reconnect-aware grace for the MVP.
- **B15 — Stale tooling warnings:** Browserslist/caniuse-lite data is ~15 months old (`npx update-browserslist-db@latest`); `tailwind.config.js` still uses the v3-style config with Tailwind v4. Both non-blocking.

### Structural notes (not cuts, just cleanup for the rewrite)

- Awkward nesting: `client/src/src/hooks/`, `client/src/src/styles/` — flatten to `src/hooks`, `src/styles`.
- Tailwind is configured (`index.css` `@tailwind` directives, `@tailwindcss/postcss`, `tailwind.config.js`) but almost all real styling is hand-written in `hacker-theme.css` and inline styles. For a minimal MVP, pick one: either use Tailwind or drop it.
- `ChatRoom.jsx` is a 718-line god-component mixing socket lifecycle, crypto setup, image pipeline, inactivity timers, and view. When the rewrite happens, split into `useRoomSocket` / `useKeyExchange` / `useImageMessage` hooks — but **do not start the rewrite yet**.
