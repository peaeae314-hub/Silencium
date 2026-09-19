# Silencium — Android APK (Capacitor)

A thin [Capacitor](https://capacitorjs.com/) shell around the existing web
client. No UI, crypto, or relay code was rewritten: the Android app loads the
same Vite build and talks to a **relay URL you enter in the app**.

| | |
|---|---|
| **APK** | `dist-mobile/Silencium-debug.apk` |
| **Size** | 4,840,040 bytes (≈ 4.6 MB) |
| **SHA-256** | `e13ce3a95fccf85f16cc1d5f5eab5c326936fd2807f585985b4c21e34d3bb2da` |
| **App id** | `app.silencium.chat` |
| **App name** | Silencium |
| **Version** | 1.1.0 (versionCode 3) — `client/android/app/build.gradle` |
| **min / target SDK** | 23 / 35 (Android 6.0+) |
| **Build type** | `debug` (debug-signed, sideload only) |
| **Plugins** | `@capacitor/app` 7.1.2, `@capacitor/browser` 7.0.5, `@capacitor/preferences` 7.0.4 |

## Install (sideload)

The APK is a **debug** build signed with the Android debug key — it is for
sideloading, not for Play Store upload.

1. Copy `Silencium-debug.apk` to the phone (USB, download, or
   `adb install -r dist-mobile/Silencium-debug.apk`).
2. On the phone open the file. Android asks to allow installs from this source:
   enable **Settings → Apps → Special access → Install unknown apps** for the
   app you are opening it from (Files/Chrome), then confirm.
3. Launch **Silencium**.
4. If you use `adb`: `adb install -r /workspace/Silencium/dist-mobile/Silencium-debug.apk`.

The debug APK is marked `usesCleartextTraffic="true"` and allows mixed content
so **HTTP LAN relays work**; production relays should still be HTTPS (see
[Known limits](#known-limits)).

## Set the relay URL

A Capacitor WebView is served from `https://localhost`, so the app cannot use
`window.location.origin` the way the browser client does. The relay URL is
runtime configuration:

- **First launch (native, nothing saved):** the app shows the **Settings**
  screen before any chat screen. Paste the relay base URL and press **Save**.
  Nothing connects to `localhost` in the meantime.
- **Later:** press the **⚙** button in the **bottom relay bar** of the home
  screen (or the same gear in the chat header) to change the URL.
- **Test connection** hits `<url>/health` and reports reachable / error before
  you commit.
- The URL is stored with **Capacitor Preferences** (SharedPreferences on
  Android, `localStorage` on web) and survives restarts. On the web build the
  same form is reachable at `/settings`.

Accepted input is **scheme + host only**, e.g.
`https://your-tunnel.trycloudflare.com` or `http://192.168.1.20:3001`.
Paths, query strings, and fragments are rejected with a clear message, as is a
missing `http://` / `https://`.

Resolution order (in `client/src/utils/serverUrl.js`):

1. URL saved in Settings
2. `VITE_SERVER_URL` build-time override (if set)
3. Browser only: previous behaviour — `window.location.origin` in a production
   build, `http://localhost:3001` in dev
4. Native with nothing configured: **no URL** → Settings is shown

If the relay cannot be reached, the chat screen shows a red banner naming the
URL (`Cannot reach the relay at …`) with a **Server settings** button, instead
of sitting on "Establishing Encryption…".

## Home screen: bottom relay bar + language {#home-ui}

The home screen (`client/src/pages/CreateRoom.jsx`) was reorganised:

- **Relay bar moved to the bottom.** The `relay: <url>` indicator and the **⚙**
  settings button now live in a sticky bar pinned to the **bottom** edge (with
  `env(safe-area-inset-bottom)` padding for gesture navigation). It stays in
  normal flow, so it never covers the **Create Chat Room** / **Join** controls.
  Behaviour is unchanged: the URL is truncated with an ellipsis when long, and
  the gear opens `/settings`.
- **Language switcher at the top** (where the relay bar used to be): a compact
  segmented control — **English / 简体中文 / 繁體中文**. It is also shown on the
  Settings and first-launch cards, so the language can be changed before a relay
  URL exists.

### Languages (i18n)

Three locales ship in `client/src/i18n/locales/` — `en.js`, `zh-Hans.js`,
`zh-Hant.js` — with identical keys. The runtime is a tiny provider + hook
(`client/src/i18n/`) — no i18n framework:

| Piece | Purpose |
|---|---|
| `i18n/translations.js` | locale normalisation, device detection, `{var}` interpolation, English fallback |
| `i18n/locale.js` | Capacitor **Preferences** (device) / `localStorage` (web) persistence under `silencium.locale` |
| `i18n/I18nProvider.jsx` + `i18n/context.js` | `useI18n()` → `{ locale, setLocale, t }` |
| `components/LanguageSwitcher.jsx` | the segmented control |

- **Default:** the device locale when it maps to one of the three
  (`zh-TW`/`zh-HK`/`zh-Hant` → 繁體中文, other `zh-*` → 简体中文, `en-*` → English),
  otherwise **English**.
- **Persists across relaunch** via Preferences/localStorage.
- Translated surfaces: the whole home screen, the Settings / first-launch copy
  and relay-URL validation errors, and the chat chrome users hit right after
  home (Leave, Share Link / Copy Link, Encryption Active / Establishing…, the
  message placeholder, Send, image-attach tooltips and image alerts).
  Server-generated system messages (e.g. `Room is full`) stay as the server
  sent them.

## Tunnel workflow (开隧道)

1. Build and run the production server on the machine that has the client build
   (serves the SPA and hosts Socket.IO on `:3001`):

   ```bash
   cd client && npm run build
   cd ../server && NODE_ENV=production node app.js
   ```

2. Start a tunnel to it, e.g. Cloudflare quick tunnel:

   ```bash
   cloudflared tunnel --url http://localhost:3001
   # -> https://<random>.trycloudflare.com
   ```

3. In the app: **⚙ → paste the `https://….trycloudflare.com` base → Test
   connection → Save**.
4. **Create Chat Room** on phone A.
5. Phone B joins:
   - in the app, paste the invite link (or the room id) into **"Paste invite
     link or room id to join"** on the home screen, or
   - in a browser, open the invite link directly.

The invite link is built from the **configured relay origin** (not the WebView
origin), so it looks like `https://<tunnel>/chat?room=<id>` and works for the
other participant. A quick-tunnel hostname changes on every restart: if it
changes, update the URL in Settings and share the new link.

## LAN testing (no tunnel)

Phone and computer on the same Wi-Fi: use
`http://<computer-LAN-IP>:3001` (e.g. `http://192.168.1.20:3001`). The relay
must listen on all interfaces — the default `server.listen(PORT)` does — and the
OS firewall must allow the port. Cleartext HTTP is enabled in the APK for this
case only. **Use HTTPS for anything beyond a trusted LAN.**

## Images

Image send uses the existing `<input type="file" accept="image/*">`, which the
Capacitor WebView services with the Android file chooser (no storage permission
is requested). The image is compressed, encrypted with libsodium, and sent as a
binary frame exactly as on the web — the relay still sees ciphertext only. If a
particular device/OEM refuses the chooser, text chat continues to work.

## Known limits

- **2-person rooms only.** `roomManager` caps a room at two participants; a
  third joiner gets `Room is full`. Do not add group chat.
- **Cleartext HTTP is enabled** (`usesCleartextTraffic` + allowMixedContent) to
  make LAN testing possible. Production relays should be HTTPS tunnels.
- **Unauthenticated key exchange (B8) stays as-is.** A malicious relay can MITM;
  this is unchanged from the web client and is not fixed by the APK.
- **The relay URL is device-local, plaintext config**, not a secret. Changing it
  invalidates the current room (the key exchange is per-connection).
- **No PWA work** was done, and **iOS is out of scope**.
- **Debug build, sideload only.** Not Play-Store signed; `client/android/` holds
  the Gradle project. Updates ship **in-app** (see
  [In-app update](#in-app-update-应用内更新) below) but the APK itself is still
  debug-signed, so every build must keep the same signing key to overlay-install.
- Gradle wrapper pinned to **8.12** (the template asks for 8.11.1) to reuse the
  Gradle distribution already cached on the build machine. Any Gradle ≥ 8.9
  works with the AGP 8.7.2 template.

## In-app update (应用内更新)

The Android app checks a self-hosted `version.json` on launch and offers to
install a newer build. This is the **same protocol as the pokemon-handbook
client** (Flutter `lib/features/update/*`): remote `versionCode` vs the
installed Android `versionCode`, a soft/forced dialog, and "skip this version"
persistence. No Play Store, no iOS.

| | |
|---|---|
| **Manifest** | `https://github.com/peaeae314-hub/silencium-releases/releases/latest/download/version.json` |
| **Hosting repo** | <https://github.com/peaeae314-hub/silencium-releases> |
| **Manifest schema** | `versionCode`, `versionName`, `apkUrl`, `force`, `changelogZh` (+ `changelogEn`, `changelogZhHant`) |
| **Client code** | `client/src/update/` |
| **Unit tests** | `node tools/update-logic-test.mjs` (+ `UPDATE_LIVE=1` parses the real manifests) |
| **E2E test** | `node tools/update-e2e-test.mjs` (headless Chrome, 39 checks) |

### Manifest sources (multi-URL fallback)

`UpdateService` tries the URLs in order, deduped, and keeps the valid manifest
with the **highest `versionCode`** — a stale jsDelivr `@main` blob therefore
never hides a newer release. jsDelivr URLs get a `?t=<epochMs>` cache-buster.

1. `VITE_UPDATE_MANIFEST_URL` build-time override, else the GitHub Releases
   `latest/download/version.json` primary
2. `https://cdn.jsdelivr.net/gh/peaeae314-hub/silencium-releases@main/version.json`
3. `https://fastly.jsdelivr.net/gh/peaeae314-hub/silencium-releases@main/version.json`
4. `https://raw.githubusercontent.com/peaeae314-hub/silencium-releases/main/version.json`

The GET goes through Capacitor's core **`CapacitorHttp`** plugin, so the WebView
is not blocked by CORS (GitHub release assets do not send
`Access-Control-Allow-Origin`; jsDelivr/raw do). On the web build the plugin
falls back to `fetch`, and the CDN fallbacks carry the check.

### Client behaviour

1. **After boot** (locale + relay URL resolved) the native app runs one silent
   check per cold start. Web builds skip it — an explicitly configured
   `VITE_UPDATE_MANIFEST_URL` also enables it on web (that is how the e2e test
   drives the real path).
2. Installed version: `@capacitor/app` `App.getInfo()` (`versionName` /
   `versionCode` from the APK), falling back to the numbers baked into
   `client/src/update/appVersion.js` — generated from
   `client/android/app/build.gradle` by `npm run version:sync` (part of
   `npm run build`).
3. `remote.versionCode > installed` → a themed dialog (en / zh-Hans / zh-Hant)
   with the changelog for the active locale (falling back to the other
   languages): **Update**, **Later**, **Skip this version**.
   - **Update** hands `apkUrl` to the system browser via `@capacitor/browser`
     (Custom Tab), where the download + sideload install flow works; the app
     itself never navigates away.
   - **Later** snoozes that `versionCode` for 12 h (`silencium.update-snooze`),
     so cold starts do not nag.
   - **Skip this version** persists the skip (`silencium.update-ignored-version-code`);
     only a **larger** `versionCode` prompts again.
   - `force: true` → **Update required**: no Later/Skip, not dismissible
     (backdrop/Esc ignored), plus **Exit** on Android.
4. Preferences use Capacitor **Preferences** on device and `localStorage` on
   web — the same dual-storage pattern as the relay URL and locale.
5. **Settings → App updates**: installed version, manual **Check for updates**
   (ignores skip/snooze), and distinct copy for *fetch failed* vs *up to date*.
   On the web it also shows the "in-app updates are for the Android sideload
   build" note.

### Publishing a release (发版步骤)

1. **Bump** `versionCode` (must increase) and `versionName` in
   `client/android/app/build.gradle` — e.g. `versionCode 3` / `versionName
   "1.1.1"`. This is the single source of truth; `npm run build` regenerates
   `client/src/update/appVersion.js` from it.
2. **Build the APK** (the web build is copied in by `cap sync`, so the bundle
   always matches the APK):
   ```bash
   cd /workspace/Silencium/client
   npm run build          # runs version:sync first, then Vite -> client/dist
   npx cap sync android   # copy dist -> android/app/src/main/assets/public
   cd android && ./gradlew assembleDebug
   cp app/build/outputs/apk/debug/app-debug.apk /workspace/Silencium/dist-mobile/Silencium-debug.apk
   ```
3. **Upload the APK to a new GitHub Release** in `silencium-releases`
   (tag `v<versionName>`, attach `Silencium-debug.apk`).
4. **Update `version.json` on `main`** in `silencium-releases` **and attach the
   same `version.json` to the Release** (the Release asset is what the primary
   `latest/download/version.json` URL serves):
   ```json
   {
     "versionCode": 3,
     "versionName": "1.1.1",
     "apkUrl": "https://github.com/peaeae314-hub/silencium-releases/releases/download/v1.1.1/Silencium-debug.apk",
     "force": false,
     "changelogZh": "修复……",
     "changelogEn": "Fix …",
     "changelogZhHant": "修復……"
   }
   ```
   `versionCode` must be **greater** than the installed build or nothing is
   prompted. `apkUrl` must be the HTTPS download URL of the APK attached in
   step 3. Set `force: true` only for a breaking release.
5. Verify: `cd /workspace/Silencium && UPDATE_LIVE=1 node tools/update-logic-test.mjs`
   (all four sources must parse and agree).
6. **Signing:** overlay-install requires the **same applicationId + same signing
   key**. Switching keystores forces an uninstall/reinstall. The debug APK is
   debug-signed; keep using that key (or adopt one fixed release keystore for
   both the APK and its updates).

> jsDelivr/raw read the repo's `main` branch, so step 4 keeps them fresh; the
> primary GitHub Release URL stays correct as long as `version.json` is attached
> to the newest Release. Trust the *highest* `versionCode` across sources, which
> the client already does.

## Rebuilding the APK

```bash
export ANDROID_HOME=/home/box/sdk/android          # platform 35 + build-tools 35.0.0
export PATH="$ANDROID_HOME/platform-tools:$PATH"

cd /workspace/Silencium/client
npm run build                                       # version:sync + Vite -> client/dist
npx cap sync android                                # copy web assets into android/
cd android && ./gradlew assembleDebug               # -> app/build/outputs/apk/debug/app-debug.apk
cp app/build/outputs/apk/debug/app-debug.apk /workspace/Silencium/dist-mobile/Silencium-debug.apk
```

Environment used: JDK 21, Android SDK platform 35 (build-tools 35.0.0), Gradle
8.12, Node 22, Capacitor 7.6.9, `@capacitor/app` 7.1.2,
`@capacitor/browser` 7.0.5, `@capacitor/preferences` 7.0.4.

Configuration lives in `client/capacitor.config.json`
(`appId`, `appName: "Silencium"`, `webDir: "dist"`, `server.androidScheme:
"https"`, `android.allowMixedContent: true`). The update check needs no extra
config there: `CapacitorHttp` is a core plugin that is always registered, and
`@capacitor/browser` needs no plugin options.

## Manual check list (APK)

The APK was built and statically verified in this environment (package id,
label, `INTERNET`, `usesCleartextTraffic=true`, bundled web assets, versionCode
2 / versionName 1.1.0, the three plugins registered), and the same JS bundle was
exercised in headless Chrome over CDP (settings save/persist/reset, validation,
unreachable-relay banner, and the full update flow — see `tools/update-e2e-test.mjs`).
It was **not** launched on a device here — no working Android emulator was
available — so treat this list as the acceptance path.

1. Launch the app with no saved URL → the Settings screen is shown (no silent
   `localhost`).
2. Enter a bare host (`foo.com`) → clear error; enter a URL with a path → clear
   error; **Save** stays disabled until valid.
3. Start the relay (+ optional tunnel), paste the base URL, **Test connection**
   → "Reachable".
4. Save, **Create Chat Room** → the chat screen opens; the invite link shown
   starts with the configured relay origin.
5. On a second device, join via the pasted link/room id → encryption becomes
   active, text round-trips.
6. Send an image → it is received and rendered inline.
7. Stop the relay, reopen a room → the red "Cannot reach the relay" banner
   appears and **Server settings** opens the form.
8. **Leave Chat** → the other participant sees the room destroyed.
9. Press **⚙** in the **bottom relay bar**, change the URL, Save → the home
   screen's `relay:` indicator updates and the new URL survives an app restart.
10. Confirm the home screen's relay bar sits at the **bottom** and does not
    cover **Create Chat Room** / **Join** at any scroll position.
11. Tap **简体中文** → the whole home screen switches immediately; relaunch the
    app → it is still 简体中文. Repeat for **繁體中文**, then **English**.
12. Enter a bad join value with 简体中文 selected → the validation error is in
    Chinese.
13. **Update prompt:** publish a `version.json` whose `versionCode` is greater
    than the installed one, then cold-start the APK → the dialog appears with
    the changelog in the device language; **Update** opens the APK URL in the
    browser/Custom Tab; **Later** hides it until the 12 h snooze expires;
    **Skip this version** keeps it hidden until a larger `versionCode` is
    published.
14. **Forced update:** set `"force": true` with a higher `versionCode` →
    restart → "Update required" with no Later/Skip; Esc/backdrop do not dismiss
    it; **Exit** leaves the app.
15. **Manual check:** Settings → **App updates** shows `1.1.0 (2)`; the button
    reports "latest version" when the published code is not newer, and the
    distinct "could not check" message when every source fails (airplane mode).
16. On the web build (`http://localhost:3001`), confirm `npm run build` output
    still renders, the update section shows the "Android sideload" note, and
    `tools/smoke-test.cjs` is still green.
