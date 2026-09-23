# 🔒 Silencium — Secure Private Chat

A real-time, end-to-end encrypted chat app for two people. Rooms are created by
link, live in memory only, and are destroyed when a participant leaves. Messages
and images are encrypted in the browser with Libsodium and relayed as ciphertext.

This is a small MVP, not a hardened product. The [security model](#-security-model)
below says exactly what it does and does not protect against — please read it
before trusting it with anything sensitive.

## ✨ Features

- **🔐 End-to-end encryption** — messages and images are encrypted in the browser
  (Libsodium, X25519 key exchange + ChaCha20-Poly1305) and only decrypted on the
  receiving device.
- **🚪 Ephemeral rooms** — a room exists in server memory only, holds at most two
  participants, and is destroyed when someone leaves or disconnects.
- **📎 Encrypted image sharing** — images are compressed, encrypted, and sent as
  binary ciphertext, then rendered inline.
- **👥 No accounts** — anonymous, no registration, no login.
- **🗑️ No database** — the relay keeps room membership in memory and stores
  nothing; there is no message or image history.
- **⚡ Real-time** — Socket.IO over WebSocket, with a same-process production
  server that also serves the built UI.
- **🎨 Terminal-inspired UI** — responsive layout for desktop and mobile.

## 🚫 Not included (and not claimed)

Silencium deliberately does **not** have, and does not pretend to have:

- Screenshot detection or screenshot prevention.
- One-view / self-destructing images, or download blocking. A recipient can
  always save or screenshot an image they can see.
- Accounts, groups, admin roles, voice/video calls, read receipts, cloud
  history, or multi-device sync.
- Perfect Forward Secrecy or “no metadata”. Session keys are per-room (not a
  ratchet); the relay still sees membership, timing, and sizes.
- Accounts, identity provider, or long-term user keys. Verification is via a
  shared room passphrase (see [Security Model](#-security-model)), not TOFU
  against a directory.
- TLS. The server speaks plain HTTP; put it behind a TLS reverse proxy for any
  real deployment.

## 🚀 Quick Start

### Prerequisites

- Node.js v16 or newer (developed and tested on Node v22)
- npm (no pnpm/yarn required)

### 1. Install dependencies

```bash
# From the repository root
cd client && npm install
cd ../server && npm install
```

### 2. Run in development (two processes)

Terminal 1 — ciphertext relay (`http://localhost:3001`):

```bash
cd server
node app.js
```

Terminal 2 — Vite dev server with hot reload:

```bash
cd client
npm run dev -- --host 127.0.0.1
```

> **Use `--host 127.0.0.1`.** Plain `npm run dev` binds IPv6 loopback only
> (`[::1]`), so `http://127.0.0.1:5173` returns nothing. The flag makes the dev
> server reachable over IPv4.

### 3. Open the app

Open **http://127.0.0.1:5173**, click **Create Chat Room**, and share the link
with the other participant (it looks like `/chat?room=<id>`).

In development the browser connects to the relay at `http://localhost:3001`
by default. The effective URL is resolved as: a URL saved in **Settings** (the
⚙ button on the home screen) → `VITE_SERVER_URL` → browser default
(`window.location.origin` in a production build, `http://localhost:3001` in
dev). To point the app somewhere else, open the gear and save it — no rebuild
needed.

## 📦 Production (single process)

Build the client once, then run the relay in production mode. It serves the built
SPA from `client/dist` **and** hosts Socket.IO on the same origin, so no second
process is needed.

```bash
# 1. Build the client
cd client
npm run build

# 2. Start the production server (from server/)
cd ../server
NODE_ENV=production node app.js
```

Then open **http://localhost:3001** — the SPA, its assets, and the WebSocket all
come from that one process. Hard refreshes on routes such as
`/chat?room=<id>` fall back to `index.html`.

- `PORT=8080 NODE_ENV=production node app.js` changes the port.
- `GET /health` returns `{"status":"ok","mode":"production"}`.
- With no saved override, the client's production socket URL is
  `window.location.origin`, so open the server URL itself (not a separate dev
  server).
- If `client/dist` is missing, the server logs a warning and returns HTTP 503 on
  `/` instead of crashing.

## 📱 Android APK

The same web client also ships as a sideloadable Android app via Capacitor:
`dist-mobile/Silencium-debug.apk` (app id `app.silencium.chat`, name
**Silencium**, ≈4.6 MB, debug-signed). Because a Capacitor WebView serves the
app from `https://localhost`, the relay URL is **runtime configuration** entered
on first launch (or later via the ⚙ button) and persisted with Capacitor
Preferences; invite links are built from that configured relay origin. A build
is not Play-Store signed, image sharing rides the WebView file chooser, and
rooms stay two-person. See [`MOBILE-ANDROID.md`](./MOBILE-ANDROID.md) for
install steps, the tunnel (`开隧道`) workflow, LAN/cleartext notes, rebuild
commands, and a manual check list.

## 🏗️ Project Structure

```
Silencium/
├── client/                      # React + Vite frontend (also the Capacitor app)
│   ├── src/
│   │   ├── components/          # CanvasImageRenderer, ServerUrlForm
│   │   ├── crypto/              # libsodium wrapper, crypto worker
│   │   ├── pages/               # CreateRoom, ChatRoom, Settings
│   │   ├── src/hooks/           # useAutoScroll
│   │   ├── src/styles/          # hacker-theme.css
│   │   └── utils/               # socket.js, serverUrl.js (runtime relay URL)
│   ├── capacitor.config.json    # appId app.silencium.chat, webDir dist
│   ├── android/                 # generated Gradle project (assembleDebug)
│   └── dist/                    # built SPA (generated by `npm run build`)
├── dist-mobile/                 # Silencium-debug.apk (generated, sideload)
├── MOBILE-ANDROID.md            # APK install + relay-URL + rebuild guide
├── server/
│   ├── app.js                   # Express + Socket.IO relay, static serving
│   └── rooms/roomManager.js     # in-memory 2-person rooms
└── tools/smoke-test.cjs         # end-to-end socket + HTTP smoke test
```

## 🔧 Technology Stack

**Frontend:** React 19, React Router, Socket.IO client, `libsodium-wrappers`
(in a Web Worker), Vite, Tailwind CSS (minimal).

**Backend:** Node.js, Express 5, Socket.IO, CORS. In-memory only — no database.

## 🔐 Security Model

### Encryption

- **X25519** key agreement (`crypto_kx_keypair`,
  `crypto_kx_client_session_keys` / `crypto_kx_server_session_keys`).
- **ChaCha20-Poly1305** authenticated encryption (`crypto_secretbox_easy` /
  `crypto_secretbox_open_easy`).
- Keys are generated per browser session, held in memory, and never sent
  anywhere. Only public keys are exchanged.
- Message and image payloads are encrypted before they leave the device. The
  relay receives `{ ciphertext, nonce }` and forwards it unchanged.

### What the server can and cannot see

The relay **cannot read or decrypt** message/image content: it has no private
keys and no database, and it forwards ciphertext only. It does, however, see
**metadata**: socket ids, room ids, which sockets are in a room, connection and
disconnection timing, message sizes, and (because key exchange is relayed) the
public keys.

It is therefore accurate to say the server relays ciphertext it cannot decrypt —
not that it is "completely blind". A compromised or malicious relay can also
interfere with key exchange, as noted next.

### Passphrase-authenticated key exchange (B8)

Public keys are still relayed through the server, but both peers prove knowledge
of a **shared room key / passphrase** that never leaves the clients:

1. Each side derives an auth key with Web Crypto `PBKDF2-SHA256` (210k iterations; room-id salt),
   salted by the room id.
2. After X25519 `crypto_kx`, each side MACs a canonical transcript
   (room id + both public keys) with that auth key and relays the proof.
3. On success, chat unlocks and a short verification code is shown. On failure
   (wrong passphrase or substituted pubkeys), chat stays blocked.
4. The session encryption key is bound to the auth key, so a MITM cannot decrypt
   even if the UI gate were bypassed.

**Strength rule:** manual keys must be ≥12 characters; the Generate button
produces 128 bits of CSPRNG material (base64url). The relay rejects join
payloads that accidentally include passphrase fields and rate-limits handshake
events (B11); it never receives the raw secret.

This is **not** Perfect Forward Secrecy and **not** a claim of “no metadata”.

### Room ids + room keys

Room ids are 128 bits from the browser CSPRNG (`crypto.getRandomValues`),
base64url-encoded (22 URL-safe characters). A room id is a join capability.
The **room key** is a separate shared secret: invite links encode the room id
only; share the key out-of-band. Anyone with the link can still occupy the
second seat, but without the matching key they cannot pass verification.

### Retained plaintext (ops)

`ops/retained/` is **not** enabled by the normal relay. It exists only for
explicit ops/recorder workflows. Default is off — do not wire automatic
plaintext retention into `server/app.js`.

### Images

- Accepted uploads: JPG, PNG, GIF up to **6 MB**.
- The client always re-encodes images to at most **1280×720** (JPEG quality 0.6,
  other types 0.7) before encryption.
- If the compressed image is still larger than **3 MB** after encryption, the
  client refuses to send and tells you.
- The relay rejects encrypted images over **4 MB** and the socket frame limit is
  **5 MB**.
- Images render inline in the chat. There is no fullscreen/zoom viewer, no
  download button, and no screenshot detection — a recipient can save what they
  can see.

## 🚪 Room Management

### Creating a room

1. On the home page, open **Create**, enter or **Generate** a room key (≥12
   chars / 128-bit generated), then create the room.
2. A 128-bit random room id is put in the URL; the key stays in session storage.
3. Share the invite link **and** the room key (separately) with your contact.
4. You do not need to paste a tunnel/relay URL for normal browser use (same
   origin in production). Settings still allow an advanced override.

### Joining a room

Paste the invite link or room id, enter the same room key, and join — or open
`/chat?room=<id>` and enter the key when prompted. The first two sockets in a
room are accepted; a third connection is rejected with **Room is full**.

### Room destruction

- Rooms are destroyed when a participant leaves or disconnects (a disconnect
  gets a 60-second grace period for reconnection (B14)).
- All remaining participants are notified and redirected to the home page.
- No orphaned rooms: membership lives only in server memory.
- There is no inactivity timer — a room stays open while its participants are
  connected.

## 🐛 Troubleshooting

**Connection failed / stuck on "Establishing Encryption…"**

- Make sure the relay is running on port 3001 (`node app.js`) and that
  `curl http://localhost:3001/health` answers.
- In development the client connects to `http://localhost:3001`; if you changed
  the relay port, open the ⚙ **Settings** screen and save the new URL, or set
  `VITE_SERVER_URL` at build time.
- On the Android app the URL is not hardcoded at all — set it on first launch
  (see [`MOBILE-ANDROID.md`](./MOBILE-ANDROID.md)). The chat screen shows a red
  "Cannot reach the relay" banner when the URL is wrong.
- If the room was destroyed (someone left), everyone is sent back to the home
  page and must create a new room.

**`http://127.0.0.1:5173` does not respond in development**

- Start Vite with `npm run dev -- --host 127.0.0.1`. Plain `npm run dev` binds
  IPv6 loopback only; use `http://localhost:5173` in that case.

**Production URL shows the SPA but sockets fail**

- Open the server origin itself (`http://localhost:3001`), not the Vite dev
  server. With no saved override, the production client uses
  `window.location.origin` for Socket.IO.
- Rebuild after client changes: `cd client && npm run build`, then restart the
  server.

**`Client build missing` / HTTP 503 in production**

- You ran `NODE_ENV=production node app.js` before building. Run
  `cd client && npm run build` and restart the server.

**Image upload rejected or never arrives**

- Allowed: JPG/PNG/GIF up to 6 MB. Everything is re-compressed to at most
  1280×720; if the encrypted result still exceeds 3 MB the client refuses it
  (the relay would reject anything over 4 MB anyway).
- Wait for **🔒 Encryption Active** before attaching — the attach button is
  disabled until key exchange finishes.

**Encryption issues / decryption errors after a reconnect**

- Hard-refresh both tabs so both sides redo the key exchange in the same room.
- A room that lost a participant is destroyed; create a new room instead of
  reusing the old tab.

## 🤝 Contributing

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/amazing-feature`).
3. Commit your changes.
4. Push the branch and open a Pull Request.

## 📝 License

ISC.

## ⚠️ Disclaimer

- This is a demonstration project for end-to-end encrypted messaging concepts,
  not an audited secure messenger.
- The relay cannot decrypt content, but it can see metadata. Room-key
  authentication (B8) detects a relay that substitutes public keys when both
  peers share the same passphrase; it is not a full identity system or PFS.
- There is no screenshot or download protection: anything displayed can be
  captured.
- There is no TLS in this repo. Terminate TLS in front of the relay before
  exposing it to a network.

## ❓ FAQ

### Security & privacy

**Q: Is my data saved during transfer?**
A: The relay has no database and does not persist message content. It keeps room
membership in memory and forwards ciphertext to the other participant. The app
itself stores no history; refreshing the page clears the conversation.

**Q: What encryption is used?**
A: Libsodium's X25519 key agreement plus ChaCha20-Poly1305 authenticated
encryption, running in a Web Worker in the browser. These are the same
well-reviewed primitives used by many messengers; that does not by itself make
Silencium's protocol equivalent to Signal's.

**Q: How do you prevent man-in-the-middle attacks?**
A: Both peers share a room key / passphrase out-of-band. After X25519 key
exchange, each side proves knowledge of that key over the pubkey transcript
(B8). Matching keys auto-verify and show a short verification code; wrong keys
or substituted pubkeys fail closed. This is not Perfect Forward Secrecy and not
a long-term identity directory — see
[Passphrase-authenticated key exchange](#passphrase-authenticated-key-exchange-b8).

**Q: Can the server read my messages?**
A: It receives only ciphertext and nonces and holds no private keys, so it
cannot decrypt normal traffic. It is not "completely blind" though: it sees
metadata such as room ids, connection timing, and message sizes. Public keys
are relayed in the clear but authenticated by the room-key MAC (B8).

**Q: What if someone intercepts the connection?**
A: Message and image payloads appear as ciphertext. Because the relay speaks
plain HTTP in this repo, metadata, room ids, and traffic timing are visible to
anyone on the network path — deploy behind HTTPS. An active attacker who
controls the relay could also attempt the MITM described above.

### Rooms

**Q: How do rooms work?**
A: Up to two participants per room, joined by link. When either participant
leaves or disconnects (after a 60-second grace (B14)), the room is destroyed and any
remaining participant is returned to the home page.

**Q: How long do rooms last?**
A: As long as both participants stay connected. There is no inactivity timer;
leaving or disconnecting ends the room.

**Q: Can more than two people join?**
A: No. The third connection is rejected with "Room is full".

**Q: What if someone gets my room link?**
A: The room id is only a join capability and there is no password, so anyone
with the link can take the open second seat while the room exists. Share links
only over channels you trust.

### Images

**Q: Are images stored on the server?**
A: No. Images are compressed, encrypted in the browser, relayed as ciphertext,
and never written to disk or a database.

**Q: What are the image limits?**
A: JPG/PNG/GIF up to 6 MB on upload; re-encoded to at most 1280×720; max 3 MB
encrypted from the client; 4 MB relay cap; 5 MB socket frame limit.

**Q: Can I stop someone from screenshotting or saving an image?**
A: No, and Silencium does not claim to. Anything rendered on screen can be
captured or saved by the recipient.

### Technical

**Q: What happens if I lose connection?**
A: The client attempts to reconnect. A disconnect gives the room a 60-second
grace period (B14); if reconnection does not happen in time, the room is
destroyed for both participants.

**Q: Does it work on mobile?**
A: Yes, the layout is responsive. Mobile browsers still allow screenshots.

**Q: Which browsers are supported?**
A: Modern browsers with WebSocket and Web Crypto support (current Chrome,
Firefox, Safari, Edge).

**Q: Is it open source?**
A: Yes, all code is in this repository.

**Q: What metadata does the server know?**
A: Socket ids, room ids, room membership, connect/disconnect timing, and message
sizes. Message and image contents are ciphertext. There is no analytics or
tracking in the app.

**Q: Can I verify who the other person is?**
A: Yes — both sides enter the same shared room key. Matching keys auto-verify
and show a short verification code; a malicious relay substituting pubkeys
fails closed. There is still no account-based identity directory or TOFU —
confirm out-of-band if it matters.
