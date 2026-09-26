# Silencium → MVP: Cut Progress

Companion to [`CUT-LIST.md`](./CUT-LIST.md). Records what has been executed from
**§2 REMOVE/DISABLE** and **§4 blockers/defects**, and what is still open.

- **Session scope:** CUT-LIST §3 steps **1–10** (through B5, B12, and the
  R3/R20/R21 docs honesty pass), plus **B14** (60 s reconnect grace, mobile
  app-switch fix). Step 11 not started.
- **Product lock honored:** no accounts; ephemeral rooms; E2EE text+images only;
  existing Libsodium crypto untouched; ciphertext-only relay.
- **Verification:**
  - `npx eslint src` exit 0 · `npm run build` exit 0.
  - `tools/smoke-test.cjs` **18 passed / 0 failed** against the **production**
    server with `SILENCIUM_EXPECT_SPA=1` (sockets + HTTP/SPA checks).
  - `tools/b14-grace-test.cjs` **8 passed / 0 failed** — grace hold, re-join
    cancel, post-grace room still 2-person, true-abandon destroy, immediate
    manual leave, and 60 s default asserted against source. See §9.
  - Production `GET /` and `/chat?room=…` → **200 `text/html`**; `/health` →
    **200**; built JS asset → 200. Headless Chrome renders the production SPA,
    and clicking **Create Chat Room** navigates to a 22-char base64url room id
    with no page exceptions.
  - Vite dev server returns 200 for `/`, `ChatRoom.jsx`, `CreateRoom.jsx`,
    `CanvasImageRenderer.jsx`, `hacker-theme.css`.
- **Diff size:** Phase 1 was −1097 / +172 across 17 tracked files; Phase 2 adds
  edits to `server/app.js`, `client/src/pages/CreateRoom.jsx`, `README.md`,
  `FEATURES.md`, `screenshots/README.md`, `tools/smoke-test.cjs`. B14 adds
  `server/app.js`, `server/rooms/roomManager.js`,
  `client/src/pages/ChatRoom.jsx`, `client/android/app/build.gradle` and
  `tools/b14-grace-test.cjs` (untracked: `CUT-LIST.md`, `CUT-PROGRESS.md`,
  `tools/`).

---

## 0. At a glance — done vs. left

**Cut items (R1–R22), from CUT-LIST §2**

| Status | IDs |
|---|---|
| ✅ **Done** | R1–R21 (all actionable items) |
| ➖ N/A by design | R22 (standing "never build" exclusion) |

**Blockers / defects (B1–B15), from CUT-LIST §4**

| Status | IDs |
|---|---|
| ✅ **Resolved** | B1, B2 (environment), B4, B5, B6, B7, B9, B12, **B14** |
| ⬜ **Left / deferred** | B3, B8, B10, B11, B13, B15 |

**Totals:** 21 of 21 actionable R items done (R22 excluded by design) ·
9 of 15 B items resolved. Every R# (R1–R22) and B# (B1–B15) is accounted for below.

---

## 1. Cut items — DONE

### §2A Security-critical

| # | Item | Where | Status |
|---|---|---|---|
| R1 | Plaintext image relay `image-message` → `receive-image` | `server/app.js`; `ChatRoom.jsx` | ✅ Server handler deleted, client `receive-image` listener + `handleReceiveImage` deleted. Smoke check now *asserts the path is closed*. |
| R2 | Image download button | `CanvasImageRenderer.jsx` | ✅ `handleDownload` + button removed (component later reduced to inline-only in R17/R18). |
| R3 | Screenshot-detection claims | `README.md`, `FEATURES.md` | ✅ Claim stripped (Phase 2). No such code exists and none was built; both docs now list screenshot detection under "not included / never". |

### §2B Dead code / orphaned UI

| # | Item | Status |
|---|---|---|
| R4 | `TestCrypto.jsx` | ✅ File deleted. |
| R5 | `crypto/sodium.js` | ✅ File deleted (second, divergent XChaCha20 path gone; single worker path remains). |
| R6 | `JoinRoom.jsx` + `/join` route | ✅ File deleted, import + route removed from `App.jsx`. |
| R7 | `utils/constants.js` | ✅ File deleted (was unimported). |
| R8 | `utils/animations.js` | ✅ File deleted, side-effect import removed from `ChatRoom.jsx`. |
| R9 | Unused `libs.js` helpers | ✅ Trimmed to `initSodium` / `generateKeyPair` / `getMyKeyPair`; `deriveSharedKey` / `encryptMessage` / `decryptMessage` and the module-level `sharedKey` removed. |
| R10 | Vite template leftovers | ✅ `App.css`, `assets/react.svg`, `public/vite.svg` deleted; favicon inlined as a data-URI SVG in `index.html`. |
| R11 | Dead CSS | ✅ `.typing-indicator` + `@keyframes blink`, legacy WhatsApp `.message-me`/`.bubble`/`.arrow*`, and duplicated `.system-msg`/`.timestamp`/`.message-row`/`.message-bubble` blocks consolidated (effective values preserved). CSS 5.05 → 3.63 kB. |
| R12 | Duplicate `.chat-border-wrapper` | ✅ Inline `<style>` block removed from `index.html`; single definition kept in `hacker-theme.css`. |
| R13 | Server noise events `room-update`, `start-chat` | ✅ All emits removed from `server/app.js` (both join and disconnect paths). |
| R14 | Client listener `user-left` | ✅ Listener + `off` removed from `ChatRoom.jsx`. |
| R15 | `myPublicKeySent` ref | ✅ Ref and its write removed. |

### §2C Features cut for MVP

| # | Item | Status |
|---|---|---|
| R16 | Inactivity auto-destruct subsystem | ✅ Fully removed. **Server:** `roomCountdowns`, `startInactivityCountdown`, `cancelInactivityCountdown`, and all countdown cleanup. **Client:** idle timers, 4 window activity listeners, `roomDestructed` + start/cancel countdown listeners, `timeLeft` state, countdown/expired UI. Room lifetime is now solely leave/disconnect (K7). |
| R17 | Fullscreen image viewer (zoom/pan/wheel) | ✅ Removed; `CanvasImageRenderer.jsx` is 328 → 52 lines, inline canvas only. |
| R18 | Right-click / context-menu "protection" | ✅ Both `onContextMenu` handlers removed. |
| R19 | External font CDNs | ✅ Google Fonts + cdnfonts `<link>`s removed from `index.html`; all `Orbitron` inline styles removed from `ChatRoom.jsx` / `CreateRoom.jsx`; `--mono` is now a system monospace stack. Build scans clean of external font/CDN requests. |

### §2D Docs honesty (Phase 2)

| # | Item | Where | Status |
|---|---|---|---|
| R3 | Screenshot-detection claims | `README.md`, `FEATURES.md` | ✅ Removed from the feature list and roadmap; both now state screenshot detection/prevention is **not** included and that a recipient can always save/screenshot what they can see. |
| R20 | README/FAQ overclaims + broken production instructions | `README.md`, `FEATURES.md` | ✅ Rewritten. Dropped one-view images, download blocking, "server is completely blind", and "cannot modify". Added an honest **Security Model**: server sees ciphertext + metadata; **B8** documented (unauthenticated key exchange → malicious relay can MITM); no TLS in-repo; no inactivity timer; no identity verification. Added a "Not included (and not claimed)" section. Production instructions now match the working B5 path. |
| R21 | Duplicated Troubleshooting section | `README.md` | ✅ Two sections (which contradicted each other on image limits) merged into one. Image limits now match the code: 6 MB upload, re-encode ≤1280×720, 3 MB encrypted client cap, 4 MB relay cap, 5 MB socket frame. |
| — | Local-dev IPv4 guidance | `README.md` | ✅ Every dev instruction now uses `npm run dev -- --host 127.0.0.1` and points at `http://127.0.0.1:5173` (B3 workaround). |
| — | `FEATURES.md` was a stray shell command | `FEATURES.md` | ✅ File previously contained a literal `echo "…" > FEATURES.md` string; rewritten as valid markdown with honest implemented/planned/never lists. |
| — | `screenshots/README.md` | `screenshots/README.md` | ✅ Dropped the nonexistent fullscreen-viewer screenshot and screenshot-prevention language; notes no screenshots are committed. |

### §4 Defects fixed

| # | Item | Status |
|---|---|---|
| B5 | Production mode broken as documented | ✅ **Fixed (Phase 2).** `server/app.js` now serves `client/dist` via `express.static` with an SPA fallback to `index.html` when `NODE_ENV=production`, on the same HTTP server as Socket.IO. Missing build → warning + HTTP 503 on `/` instead of a crash. `/health` added for liveness. README production commands corrected to `cd client && npm run build` then `cd server && NODE_ENV=production node app.js` → open `http://localhost:3001`. |
| B6 | Image sends silently fail (JSON inflation vs. transport cap) | ✅ `send-encrypted-image` **and** `send-message` now emit `Uint8Array` binary frames (no `Array.from` on either path); limits aligned client 3 MB < relay 4 MB < 5 MB socket frame (`MAX_IMAGE_BYTES` / `MAX_SOCKET_FRAME_BYTES` in `server/app.js`, mirrored in `ChatRoom.jsx`); relay emits `image-error` on oversize/malformed and the client surfaces it. Smoke verifies binary delivery + oversize rejection. |
| B7 | Plaintext image relay live | ✅ Resolved by R1 (confirmed by smoke test). |
| B9 | `rooms` ReferenceError in `join-room` | ✅ Previous-room cleanup routed through `roomManager.leaveRoom()`; `app.js` no longer touches the module-private map. Smoke exercises a room switch. |
| B12 | Weak room ids | ✅ **Fixed (Phase 2).** `CreateRoom.jsx` now generates 16 bytes (128 bits) with `crypto.getRandomValues` and base64url-encodes them (22 URL-safe chars, no padding); `Math.random().toString(36)` is gone (grep-clean; `getRandomValues` confirmed in the built bundle). Smoke uses the same 128-bit scheme and the headless-browser click test produced `RWSwkLskLy_06FBuGFV7GQ`. |

---

## 2. Cut items — OPEN

None. All actionable R items (R1–R21) are done; **R22** is the standing
never-build exclusion (accounts, groups, calls, read receipts, cloud history,
multi-device sync, screenshot detection) and is not a task.

**KEEP surface (K1–K11)** is intact. `K4` crypto is unchanged: same
`crypto_kx_keypair` / `crypto_kx_client|server_session_keys` /
`crypto_secretbox_easy|open_easy`, same client/server role split and nonce handling,
same `libsodium-wrappers` dependency. The only crypto-adjacent change is B6's
transport encoding (binary frames instead of number arrays) — same ciphertext, same
worker path. `K3` now rides the binary transport. `K9` theme kept, trimmed per R11/R12/R19.

---

## 3. Blockers / defects — status

### Fixed or resolved

| # | Status |
|---|---|
| B5 | ✅ Fixed — production `express.static` + SPA fallback, docs corrected. |
| B6 | ✅ Fixed — binary transport, aligned limits, user-visible errors. |
| B7 | ✅ Fixed by R1. |
| B9 | ✅ Fixed — room cleanup via `roomManager`. |
| B12 | ✅ Fixed — 128-bit CSPRNG room ids (base64url). |
| B14 | ✅ **Fixed (B14 phase).** Disconnect grace is now **60 s** and the pending destroy is **cancelled when the same participant re-joins** the same room (Android app-switch). Manual leave still tears down immediately. See §9. |
| B4 | ✅ **Fixed (Mobile phase).** Hardcoded relay URL replaced by runtime resolution: saved user URL → `VITE_SERVER_URL` → browser default (`window.location.origin` prod / `http://localhost:3001` dev) → native settings gate. See §8. |
| B1 | Resolved by environment (policy is `danger-full-access` this session); no repo change. |
| B2 | Satisfied (Node v22.19.0, npm 10.9.3); no repo change. |

### Open — unscheduled or deferred

| # | Item | Status / note |
|---|---|---|
| B3 | Vite binds IPv6 loopback only | Open; documented workaround `npm run dev -- --host 127.0.0.1` (now used throughout the README). No code change. |
| B8 | Unauthenticated key exchange (MITM possible) | **Open, out of MVP scope by design.** Now documented honestly in README (§Security Model → "Known limitation: unauthenticated key exchange") and `FEATURES.md`. Do not hand-roll a fix. |
| B10 | libsodium `crypto` externalized warning | Expected, cosmetic; build succeeds. |
| B11 | Robustness gaps | **Open — step 11.** No rate limiting / text-size cap; client `receive-message` has no `try/catch` around `crypto_secretbox_open_easy`; `join-error` surfaced only via `alert()`. |
| B13 | Bundle size | **Open — step 11.** Build emits `index-*.js` ~1.03 MB (336 KB gzip) + `crypto.worker` ~750 KB. Consider lazy-loading the crypto worker. |
| B15 | Stale tooling warnings | Non-blocking: browserslist/caniuse-lite ~15 months old; `tailwind.config.js` is v3-style with Tailwind v4. |

---

## 4. Deleted files (R4–R8, R10)

```
client/src/pages/TestCrypto.jsx
client/src/crypto/sodium.js
client/src/pages/JoinRoom.jsx
client/src/utils/constants.js
client/src/utils/animations.js
client/src/App.css
client/src/assets/react.svg
client/public/vite.svg
```

---

## 5. Verification harness

`tools/smoke-test.cjs` previously **asserted the defects existed** (plaintext
relay reachable, `Array.from` inflation). It now regresses the cuts and the
Phase-2 fixes.

Phase 1 checks (kept):

- `legacy plaintext "image-message" path is closed` (was: reachable — security risk)
- `encrypted text round-trip decrypts correctly (binary)` — mirrors the client's
  binary `send-message`
- `legacy number-array text still relays` — relay tolerates the old array form
- `image ciphertext is relayed as binary, not an inflated number array (B6)`
- `oversized encrypted image is rejected with image-error (B6)`
- `switching rooms frees the old room without crashing the relay (B9)`
- `removed server events (room-update/start-chat/receive-image/inactivity) are not emitted`

Phase 2 checks (added):

- `room id is 128-bit URL-safe base64url (B12)` — the run's own room id matches
  `/^smoke-[A-Za-z0-9_-]{22}$/`.
- `relay answers HTTP 200 on /` — always.
- `GET / serves the built SPA as HTML (B5)` — only with `SILENCIUM_EXPECT_SPA=1`.
- `SPA fallback serves index.html for a room path (B5)` — only with
  `SILENCIUM_EXPECT_SPA=1`.
- `GET /health answers 200`.

Run against the production server (relay must be up; cwd-independent):

```bash
cd /workspace/Silencium/server && NODE_ENV=production node app.js   # terminal 1
NODE_PATH=/workspace/Silencium/client/node_modules SILENCIUM_EXPECT_SPA=1 \
  node /workspace/Silencium/tools/smoke-test.cjs                    # terminal 2
```

Result: **18 passed, 0 failed**.

### Entry points

- **Authoritative suite:** `/workspace/Silencium/tools/smoke-test.cjs`.
- **DSH-created path:** `/workspace/deepseek-harness/silencium-smoke.cjs` is a thin
  runner that `require`s the repo suite. It previously held a second, stale copy of
  the pre-cut suite which asserted the plaintext relay was *reachable*; after R1
  closed that path it reported a false regression (`8 passed, 1 failed`). It now
  delegates, so both paths agree.

### Browser render checks (headless Chrome)

`tools/smoke-test.cjs` exercises the socket protocol and HTTP surface, so the
React/CSS build is additionally rendered in headless Chrome.

Phase 1 (dev server):

```bash
google-chrome --headless=old --no-sandbox --disable-gpu --disable-dev-shm-usage \
  --virtual-time-budget=7000 --window-size=1280,900 --screenshot=/tmp/x.png <url>
```

- `/` (CreateRoom): terminal theme, system-monospace text, feature list, button render.
- `/chat?room=…` (ChatRoom): header, share link + Copy Link, encryption-status bar,
  message pane, input + attach + Send all render. DOM contains none of
  `inactivity` / `Session expires` / `receive-image` / `Download` / `View Full Screen`.

Phase 2 (production server, `--dump-dom`):

- `http://localhost:3001/` renders the built SPA (Create Chat Room button and
  feature list present), with no filtered Chrome errors.
- A CDP-driven click on **Create Chat Room** navigated to
  `/chat?room=RWSwkLskLy_06FBuGFV7GQ` — a 22-char base64url id — with zero page
  exceptions, confirming B12 end-to-end in a real browser.

### Gotcha: restart the dev server after file deletions

The long-running Vite dev server (started before R4–R10) kept stale module-graph
state and served **HTTP 500** for `/src/index.css` with
`ENOENT: … src/assets/react.svg` — a deleted file — even though no source file
referenced it. A fresh `npm run dev -- --host 127.0.0.1` returns **200** and renders
correctly. After deleting files (R4–R10), restart the dev server; this is not a
source regression.

### Gotcha: production mode reads `client/dist` at startup

`NODE_ENV=production node app.js` decides between static serving and the dev text
route when the process starts. Rebuild the client **before** starting the server;
after a rebuild, restart it so it picks up the new hashed asset names in
`index.html`.

---

## 6. Remaining recommended slice

Per CUT-LIST §3, only **step 11** remains (deferred/optional):

- **B11** — relay rate limiting / text-size cap; client `try/catch` around
  `crypto_secretbox_open_easy`; replace `alert()` with in-UI errors.
- **B13** — lazy-load the crypto worker / bundle splitting.

Nothing in step 11 blocks the MVP. **B4** is now done (Mobile phase, §8) and
**B14** is now done (§9).

---

## 7. Restarting the services

Dependencies are already installed (`node_modules` present in both `client/` and
`server/`), so no `npm install` is needed.

### Production — one process (B5)

```bash
# 1) Build the SPA
cd /workspace/Silencium/client
npm run build

# 2) Serve SPA + Socket.IO from one process  ->  http://localhost:3001
cd /workspace/Silencium/server
NODE_ENV=production node app.js          # PORT env var overrides 3001
```

Open `http://localhost:3001/`. The room path `http://localhost:3001/chat?room=…`
also returns the SPA (hard-refresh safe).

### Development — two processes

```bash
# 1) Ciphertext relay  ->  http://localhost:3001
cd /workspace/Silencium/server
node app.js

# 2) React/Vite client  ->  http://127.0.0.1:5173
cd /workspace/Silencium/client
npm run dev -- --host 127.0.0.1          # --host 127.0.0.1 avoids IPv6-only [::1] bind (B3)
```

Health checks:

```bash
curl -s http://localhost:3001/health                          # -> {"status":"ok",...}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/   # -> 200
```

Notes:

- In development `/` returns the text `Silencium server running`; in production
  it returns the built `index.html`.
- Restart the **dev server** after any file deletions, or it may keep stale
  module-graph state and serve HTTP 500 (see §5).
- Restart the **production server** after `npm run build`.

---

## 8. Mobile — Android APK (Capacitor) + runtime relay URL

Deliverable: an installable **debug APK** wrapping the existing web client.
Full instructions: [`MOBILE-ANDROID.md`](./MOBILE-ANDROID.md).

**Done**

- **Capacitor shell (B4 groundwork).** `client/` is now a Capacitor app:
  `capacitor.config.json` (`appId: app.silencium.chat`, `appName: Silencium`,
  `webDir: dist`, `server.androidScheme: https`, `android.allowMixedContent:
  true`), `client/android/` Gradle project, deps `@capacitor/core|android|cli`
  and `@capacitor/preferences` (7.6.9 / 7.0.4). No UI, crypto, or relay code
  rewritten — the APK loads the same Vite `dist`.
- **Runtime server URL (B4 closed).** New `client/src/utils/serverUrl.js`
  resolves the relay URL as: saved user URL → `VITE_SERVER_URL` → browser
  default (`window.location.origin` prod / `http://localhost:3001` dev) →
  native with nothing saved returns `null`. `socket.js` creates the Socket.IO
  instance from that URL and `applyServerUrl()` rewires it. The old
  `localhost:3001` constant survives only as an `autoConnect:false` placeholder.
- **Settings UI.** `ServerUrlForm` + `/settings` route + gear on home/chat.
  Light validation (http/https, host required, no path/query/fragment), a
  `/health` **Test connection** button, Preferences persistence, and a
  first-launch gate on native that blocks chat until a URL is set.
- **Clear failure.** Chat shows a red `Cannot reach the relay at <url>` banner
  (with a Server settings button) on `connect_error`.
- **Mobile join path.** Home gained "Paste invite link or room id to join"; the
  invite link is built from the configured relay origin, not the WebView's
  `https://localhost`.
- **Cleartext.** `android:usesCleartextTraffic="true"` + allowMixedContent for
  LAN HTTP testing; production relays should be HTTPS.
- **APK.** `dist-mobile/Silencium-debug.apk` — `app.silencium.chat`, label
  **Silencium**, minSdk 23 / targetSdk 35, **4,760,640 bytes (≈4.6 MB)**,
  SHA-256 `356924d6…b11993b`. Built here with the local SDK (platform 35,
  build-tools 35.0.0, JDK 21, Gradle 8.12).

**Verification (Mobile phase)**

- `npx eslint src` exit 0 · `npm run build` exit 0 (93 modules).
- `npx cap sync android` succeeds (1 plugin: `@capacitor/preferences`).
- `./gradlew assembleDebug` → `BUILD SUCCESSFUL`; APK copied to
  `dist-mobile/Silencium-debug.apk`. `aapt2` confirms package/label/INTERNET/
  `usesCleartextTraffic=true`; the APK bundles the current `index-DFwwgqLb.js`.
- `tools/smoke-test.cjs` **18 passed / 0 failed** against the production server
  with `SILENCIUM_EXPECT_SPA=1` (web path unchanged).
- Headless-Chrome CDP checks against the production SPA: Settings save/persist/
  reload/reset and URL validation **10/10**; unreachable-relay banner +
  settings escape hatch **4/4**; home/chat/settings routes render.

**Skipped / out of scope**

- **PWA: skipped** (explicitly out of this task).
- **iOS: out of scope** — no `ios/` platform added.
- Multi-user rooms, E2EE changes, Play Store signing: untouched/out of scope.

### Home UI: bottom relay bar + i18n (en / zh-Hans / zh-Hant)

Follow-up to the Mobile phase: the home screen's relay bar moved to the bottom
and the app became multilingual.

**Done**

- **Relay bar relocated to the bottom.** `CreateRoom.jsx`'s `home-topbar`
  (`relay: <url>` + ⚙) became a sticky `.home-relaybar` pinned to the bottom of
  the home screen, with `env(safe-area-inset-bottom)` padding. It stays in
  normal flow (`margin-top: auto`), so **Create Chat Room** / **Join** are never
  covered. Behaviour is unchanged: URL truncated with an ellipsis, gear opens
  `/settings`. Chat-header gear untouched.
- **Language switcher on home** (top, where the relay bar was) and on the
  Settings / first-launch cards: **English / 简体中文 / 繁體中文**, rendered as a
  segmented control (`components/LanguageSwitcher.jsx`).
- **Lightweight i18n, no framework.** `client/src/i18n/`:
  `locales/{en,zh-Hans,zh-Hant}.js` (identical key sets),
  `translations.js` (normalisation, device detection, `{var}` interpolation,
  English fallback), `locale.js` (Capacitor Preferences → `silencium.locale`,
  `localStorage` on web), `I18nProvider.jsx` + `context.js` (`useI18n()` →
  `{ locale, setLocale, t, locales }`), `richText.jsx` for the small
  `<code>…</code>` snippets in the settings copy.
- **Default locale:** device locale when it maps to one of the three
  (`zh-TW`/`zh-HK`/`zh-Hant` → 繁體中文, other `zh-*` → 简体中文, `en-*` → en),
  else **en**. The choice persists across relaunch.
- **Translated surfaces:** the whole home screen, App boot / first-launch copy,
  `Settings`, `ServerUrlForm` (labels, buttons, `/health` result, and every
  `normalizeBaseUrl` validation error — errors are now returned as i18n keys
  plus an English fallback in `utils/serverUrl.js`), and ChatRoom chrome/alerts
  (Leave, Share/Copy Link, Encryption Active / Establishing…, message
  placeholder, Send, attach-image tooltips, image errors). Server-generated
  system messages stay as sent.
- **APK rebuilt** at `dist-mobile/Silencium-debug.apk` — 5,099,365 bytes
  (≈4.9 MB), SHA-256 `e22263cf…428df6`, same `app.silencium.chat` / label /
  minSdk 23 / targetSdk 35, bundles `index-nK0pr4PE.js`.

**Verification (home UI + i18n)**

- `npx eslint src` exit 0 · `npm run build` exit 0 (102 modules).
- `npx cap sync android` + `./gradlew assembleDebug` → `BUILD SUCCESSFUL`; APK
  `aapt2` badging unchanged (package `app.silencium.chat`, label **Silencium**,
  INTERNET, targetSdk 35); the APK bundles the new `index-nK0pr4PE.js`.
- Headless-Chrome CDP checks on a 390×844 viewport, **29/29**: relay bar sticky
  at the bottom and after `.home-main`; old top bar gone; 3 endonym options;
  en → 简体中文 → 繁體中文 flip the home CTAs, headline, placeholder and join
  validation error immediately; `silencium.locale` + `document.documentElement.lang`
  update; locale survives a reload; chat + settings chrome translated too.
- `tools/smoke-test.cjs` **18 passed / 0 failed** with `SILENCIUM_EXPECT_SPA=1`
  (relay/E2EE/room-cap path untouched; no PWA/iOS work, tunnel not reopened).

### In-app update — same protocol as pokemon-handbook (silencium-releases)

Follow-up: the Capacitor Android client now self-updates from
[`silencium-releases`](https://github.com/peaeae314-hub/silencium-releases)
instead of requiring a manual reinstall. Protocol copied from the
pokemon-handbook Flutter client (`lib/features/update/*`) and its
`应用内更新-托管说明.md`; **no new protocol was invented**.

**Done**

- **`client/src/update/`** — `updateLogic.js` (pure: `isNewer`, `shouldPrompt`,
  candidate URLs + CDN cache-bust, `preferHighestVersionCode`, changelog pick),
  `updateManifest.js` (`version.json` parser: `versionCode`, `versionName`,
  `apkUrl`, `force`, `changelogZh`/`En`/`ZhHant`), `updateService.js`
  (multi-source GET, installed version, skip/snooze, opening the APK link),
  `updateConfig.js`, `updateContext.js`, `UpdateProvider.jsx`,
  `UpdatePromptDialog.jsx`, generated `appVersion.js`. Styled in
  `src/src/styles/hacker-theme.css` (`.update-*`).
- **Multi-URL fallback, highest `versionCode` wins:** GitHub Releases
  `latest/download/version.json` → `cdn.jsdelivr.net` → `fastly.jsdelivr.net` →
  `raw.githubusercontent.com`, deduped, jsDelivr entries cache-busted with
  `?t=<epochMs>`. A `VITE_UPDATE_MANIFEST_URL` build-time override replaces the
  primary. The GET uses Capacitor's core **`CapacitorHttp`** so the WebView is
  not CORS-blocked (GitHub release assets send no `Access-Control-Allow-Origin`);
  on web it degrades to `fetch` and the CORS-friendly CDNs carry the check.
- **Installed version:** `@capacitor/app` `App.getInfo()` on device, with the
  `client/android/app/build.gradle` numbers baked in at build time as the
  fallback (`npm run version:sync` → `src/update/appVersion.js`, wired into
  `prebuild`). `versionCode 1 / "1.0"` → **`versionCode 2 / "1.1.0"`**.
- **Launch check** runs once per cold start after locale + relay-URL boot
  (native only; the web build skips it, or a "sideload Android only" note is
  shown). Prompt: **Update** (opens `apkUrl` via `@capacitor/browser`, i.e. the
  system browser/Custom Tab — never navigates the app away), **Later**
  (12 h snooze, `silencium.update-snooze`) and **Skip this version**
  (`silencium.update-ignored-version-code`, until a larger code appears).
  `force: true` → not dismissible, no Later/Skip, plus **Exit** on Android.
- **i18n:** 24 new keys in all three dictionaries (en / zh-Hans / zh-Hant) for
  the dialog, the buttons and the Settings section; the changelog is picked per
  locale with cross-language fallback.
- **Settings → App updates:** installed version, manual **Check for updates**
  (ignores skip/snooze; separates *fetch failed* from *up to date*), and the web
  sideload note. New Capacitor plugins `@capacitor/app` 7.1.2 and
  `@capacitor/browser` 7.0.5 (synced into `capacitor.settings.gradle` /
  `capacitor.build.gradle`).
- **Docs:** `MOBILE-ANDROID.md § In-app update (应用内更新)` — manifest schema +
  sources, client behaviour, and the **publish steps** (bump `versionCode` →
  build APK → upload Release → update `version.json` on `main` **and** attach it
  to the Release → verify with `UPDATE_LIVE=1`). `FEATURES.md` updated.
- **APK rebuilt** at `dist-mobile/Silencium-debug.apk` — 4,839,839 bytes
  (≈4.6 MB), SHA-256 `7fe1412944826544a338ea0dd65596818742dade70b85b3a8f442b7db134a0dd`,
  `aapt2` badging `versionCode='2' versionName='1.1.0'`, minSdk 23 / targetSdk 35,
  plugins App/Browser/Preferences registered, bundles `index-BlypCdGY.js` (the
  production build with the default GitHub manifest URL — the e2e-only local
  override is **not** in the APK).

**Verification (in-app update)**

- `node tools/update-logic-test.mjs` — **36 passed / 0 failed** (compare, skip,
  snooze incl. force overrides, candidate dedupe/cache-bust/order, highest-code
  win, changelog fallback, parser rejects, installed-label, generated version).
  `UPDATE_LIVE=1` adds the four live manifests — **41 passed / 0 failed**
  (all four parse and agree on `versionCode`).
- `node tools/update-e2e-test.mjs` — **39 passed / 0 failed** in headless Chrome
  against the real built SPA (test build with the manifest override): launch
  dialog (en/zh-Hans/zh-Hant copy + changelog), Later snooze survives a reload,
  Skip persists and a larger code still prompts, `force` drops Later/Skip and is
  not dismissible, Update hands the exact `apkUrl` to `window.open`, up-to-date →
  no dialog, Settings manual check says "latest version", primary source down →
  CDN fallbacks still answer, **all sources blocked → the distinct "could not
  check" message** (not "up to date").
- `npx eslint src` exit 0 · `npm run build` exit 0.
- `npx cap sync android` (3 plugins) + `./gradlew assembleDebug` →
  `BUILD SUCCESSFUL`.
- `tools/smoke-test.cjs` **18 passed / 0 failed** with `SILENCIUM_EXPECT_SPA=1`
  — relay / E2EE / 2-person room cap / relay settings untouched.

**Skipped / out of scope**

- **Play Store, iOS, crypto changes, reopening the tunnel: untouched.**
- Android was **not** launched on a device or emulator here; the native path is
  covered by the unit + headless tests plus APK static verification, with the
  device checklist in `MOBILE-ANDROID.md § Manual check list (APK)` (items
  13–16 are the new update steps).

---

## 9. B14 — 60 s reconnect grace (mobile app-switch fix)

**Problem.** On Android, backgrounding the app (e.g. switching away to paste the
invite link) makes the WebView drop the Socket.IO transport. The server saw
`disconnect` and, after a **5 s** grace, destroyed the room even though the
participant was coming right back. The timer was also never cancelled when the
participant reconnected with a new socket id — by then the room was gone, or the
re-join hit **Room is full** because the stale socket id still occupied the
second seat.

**Server** (`server/app.js`, `server/rooms/roomManager.js`)

- `DISCONNECT_GRACE_MS = 60 * 1000` (overridable via
  `SILENCIUM_DISCONNECT_GRACE_MS` for tests only).
- On `disconnect`, the participant's seat is **kept** in `roomManager` and a
  pending timer is stored in `pendingDisconnects` (keyed by the **old**
  socket id, carrying `roomId` + the client's `participantId`). No `leaveRoom`
  happens yet, so the room is still "alive" and still counts as 2-person.
- On `join-room`, **before** the capacity check, `reclaimPendingDisconnect()`
  looks for a pending seat in the same room. A match (exact `participantId`
  when the client sends one, otherwise the pending seat itself) **clears the
  timer** and swaps the stale socket id for the new one via
  `roomManager.replaceUser()` — no destroy, no leaked seat, no "Room is full".
- Only if the grace expires without a re-join does `finalizeDisconnect()` call
  `leaveRoom()` and, when another participant remains, emit `room-destroyed`
  (the destroy-on-leave product rule for **true** abandons is unchanged).
- **Manual `leave-room` is still immediate**: it cancels any pending timer for
  that socket and calls `destroyRoom()` for the remaining peer right away.
- `roomManager.joinRoom` is now idempotent for an already-present socket id, so
  a repeated join (connect handler + resume re-join) cannot double-book a seat.

**Client** (`client/src/pages/ChatRoom.jsx`)

- A `participantId` (session-scoped, `sessionStorage`-backed, no key material)
  is sent with every `join-room`, so the relay can reclaim the right seat even
  when the WebView reloads the page. Purely a B14 identity — **no new key-cache
  protocol and no crypto change**.
- A new effect listens for Capacitor `appStateChange` → `isActive` (native
  shell) and `visibilitychange` → `visible` (web/older shells). On resume it
  ensures `socket.connect()`, re-emits `join-room` for the same `roomId`, and
  re-emits the public key if one already exists.
- The room setup also re-joins if the socket is already connected on mount, and
  the `connect`/`reconnect` handlers now include the `participantId`.
- Encryption UI copy, late-joiner key relay, room capacity (2), and ciphertext
  relay are untouched.

**Verification**

- `tools/b14-grace-test.cjs` (new) spawns a relay with a 2 s test grace and
  asserts: seat held on disconnect; re-join accepted with a new socket id;
  pending destroy cancelled (no `room-destroyed` after the original deadline);
  reclaimed room still rejects a third peer; no re-join → destroyed after the
  grace; manual leave → destroyed for the peer in < 600 ms; and the shipped
  default is 60 s. **8 passed / 0 failed.**
- `tools/smoke-test.cjs` **18 passed / 0 failed** with `SILENCIUM_EXPECT_SPA=1`.
- `npx eslint src` exit 0 · `npm run build` exit 0.
- APK rebuilt to `dist-mobile/Silencium-debug.apk` with `versionCode 3`.

> Out of scope for B14 (unchanged): the "Establishing Encryption…" hang when
> alone / lost public-key races, room capacity, crypto, and the update system.

---

## 10. v1.5.0 — optional custom room ids + occupied-create guard

Follow-up to B12/B14. A room id is still a join capability, but the create form
now accepts an optional human-chosen id.

- **Format:** `^[A-Za-z0-9_-]{4,64}$`, enforced by the relay
  (`server/rooms/roomManager.js`) and the join/create forms
  (`client/src/utils/roomId.js`, deliberately duplicated with cross-comments).
- **Create intent:** `CreateRoom` arms a one-shot `sessionStorage` marker; the
  first `join-room` of a `ChatRoom` instance sends `intent: 'create'` and the
  marker is consumed. Reconnects, foreground resumes, duplicate joins, and page
  refreshes send plain joins.
- **Occupied:** `roomManager.joinRoom(roomId, socketId, { intent })` returns
  `{ error, code: 'ROOM_OCCUPIED' }` when a create targets a room that already
  holds another socket (including a B14 grace-held seat). Reclaims and
  same-socket repeats stay idempotent, so the creator's own reconnect is never
  refused. `join-error` now carries a second `{ code }` argument
  (`ROOM_OCCUPIED` / `INVALID_ROOM_ID` / `ROOM_FULL` / `RATE_LIMITED` /
  `SECRET_FIELD`) while the first English message keeps old clients working.
- **Client UX:** `ROOM_OCCUPIED` / `INVALID_ROOM_ID` return to the form with an
  inline translated error (no `alert`), preserving the typed id and key.
- **Incidental crypto races fixed (surfaced by the reject→rejoin flow):** the
  crypto worker now installs `onmessage` synchronously before `await
  sodium.ready` (a fast re-join could post before the replacement worker was
  ready and lose the message), the public-key retry reads the live ref, and a
  queued auth proof calls `markVerified` directly instead of relying on an
  effect that may already have run.
- **Verification:** `tools/room-id-unit-test.cjs` **34/0**;
  `tools/custom-room-id-test.cjs` **36/0**; existing smoke **16/0**, b14 **8/0**,
  update-logic **36/0**, update-e2e **39/0** (stale hard-coded installed-version
  expectations replaced); browser smoke **9/0** with screenshots in
  `screens/custom-room-id/`; `npx eslint src scripts` exit 0; web build exit 0;
  APK `versionCode 6` / `1.5.0`.

