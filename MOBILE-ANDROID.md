# Silencium — Android APK (Capacitor)

A thin [Capacitor](https://capacitorjs.com/) shell around the existing web
client. No UI, crypto, or relay code was rewritten: the Android app loads the
same Vite build and talks to a **relay URL you enter in the app**.

| | |
|---|---|
| **APK** | `dist-mobile/Silencium-debug.apk` |
| **Size** | 5,099,365 bytes (≈ 4.9 MB) |
| **SHA-256** | `e22263cfc0f62ac29d3d5f1cd23dd1c91b315074f4feabee02af48ae25428df6` |
| **App id** | `app.silencium.chat` |
| **App name** | Silencium |
| **Version** | 1.0 (versionCode 1) |
| **min / target SDK** | 23 / 35 (Android 6.0+) |
| **Build type** | `debug` (debug-signed, sideload only) |

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
- **Debug build, no auto-update.** Rebuild and reinstall to update; not
  Play-Store signed. `client/android/` holds the Gradle project.
- Gradle wrapper pinned to **8.12** (the template asks for 8.11.1) to reuse the
  Gradle distribution already cached on the build machine. Any Gradle ≥ 8.9
  works with the AGP 8.7.2 template.

## Rebuilding the APK

```bash
export ANDROID_HOME=/home/box/sdk/android          # platform 35 + build-tools 35.0.0
export PATH="$ANDROID_HOME/platform-tools:$PATH"

cd /workspace/Silencium/client
npm run build                                       # Vite -> client/dist
npx cap sync android                                # copy web assets into android/
cd android && ./gradlew assembleDebug               # -> app/build/outputs/apk/debug/app-debug.apk
cp app/build/outputs/apk/debug/app-debug.apk /workspace/Silencium/dist-mobile/Silencium-debug.apk
```

Environment used: JDK 21, Android SDK platform 35 (build-tools 35.0.0), Gradle
8.12, Node 22, Capacitor 7.6.9, `@capacitor/preferences` 7.0.4.

Configuration lives in `client/capacitor.config.json`
(`appId`, `appName: "Silencium"`, `webDir: "dist"`, `server.androidScheme:
"https"`, `android.allowMixedContent: true`).

## Manual check list (APK)

The APK was built and statically verified in this environment (package id,
label, `INTERNET`, `usesCleartextTraffic=true`, bundled web assets), and the
same JS bundle was exercised in headless Chrome over CDP (settings
save/persist/reset, validation, unreachable-relay banner). It was **not**
launched on a device here — no working Android emulator was available — so treat
this list as the acceptance path.

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
13. On the web build (`http://localhost:3001`), confirm `npm run build` output
    still renders and `tools/smoke-test.cjs` is still green.
