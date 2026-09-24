// English is the source-of-truth dictionary. Every other locale must define
// exactly the same keys (see `client/src/i18n/translations.js`).
export default {
  'common.appName': 'Silencium',

  'language.label': 'Language',
  'language.en': 'English',
  'language.zh-Hans': '简体中文',
  'language.zh-Hant': '繁體中文',

  'app.starting': 'Starting…',

  // --- Home -------------------------------------------------------------
  'home.tagline': 'Start a Private & Encrypted Conversation',
  'home.createRoom': 'Create Chat Room',
  'home.joinPlaceholder': 'Paste invite link or room id to join',
  'home.joinAria': 'Invite link or room id',
  'home.joinButton': 'Join',
  'home.joinError': 'Paste an invite link or a room id.',
  'home.feature.noAccounts': 'No Accounts, Ever',
  'home.feature.noLogs': 'No Logs/Data Storage',
  'home.feature.selfDestruct': 'Self-Destructing Chats',
  'home.feature.e2ee': 'End-to-End Encryption',
  'home.feature.images': 'Secure Image Sharing',
  'home.relayTitle': 'Relay server',
  'home.relayPrefix': 'relay',
  'home.serverSettings': 'Server settings',
  'home.languageLabel': 'Language',

  'home.createTab': 'Create',
  'home.joinTab': 'Join',
  'home.roomIdLabel': 'Room id or invite link',
  'home.keyLabel': 'Shared room key',
  'home.keyPlaceholder': 'Passphrase (≥12 chars) or generate',
  'home.keyHint':
    'Minimum {min} characters. Generated keys use 128 bits of randomness. Never sent to the server — share out-of-band with your contact.',
  'home.keyRequired': 'Enter a shared room key.',
  'home.keyTooWeak': 'Room key is too weak — use at least 12 characters, or Generate.',
  'home.generateKey': 'Generate',
  'home.feature.roomKey': 'Passphrase-authenticated key exchange',
  'home.showRelay': 'Show relay',
  'home.hideRelay': 'Hide relay',

  // --- Settings / relay URL form ---------------------------------------
  'settings.title': '⚙️ Server Settings',
  'settings.copy':
    'Silencium connects to a relay you choose. Point it at the server (or tunnel) that is running the Silencium relay — the same URL serves the web client and hosts Socket.IO.',
  'settings.firstLaunch':
    'Choose the relay server this device should connect to. Paste the HTTPS base URL of a Silencium server or tunnel — for example <code>https://your-tunnel.trycloudflare.com</code>.',
  'settings.relayLabel': 'Relay server URL',
  'settings.placeholder': 'https://your-tunnel.trycloudflare.com',
  'settings.hint':
    'Scheme + host only, no trailing path. Use <code>https://…</code> for a tunnel or <code>http://192.168.x.x:3001</code> for LAN testing.',
  'settings.save': 'Save',
  'settings.saving': 'Saving…',
  'settings.testConnection': 'Test connection',
  'settings.testing': 'Testing…',
  'settings.cancel': 'Cancel',
  'settings.clear': 'Clear',
  'settings.useDefault': 'Use default ({url})',
  'settings.errorSave': 'Could not save the URL on this device.',
  'settings.reachable': 'Reachable — /health says "{status}"',
  'settings.unreachable':
    'Cannot reach {url} ({reason}). Check the tunnel/relay and the URL.',
  'settings.reasonTimeout': 'timed out',
  'settings.reasonUnreachable': 'unreachable',
  'settings.errEnter':
    'Enter the relay URL, e.g. https://your-tunnel.trycloudflare.com',
  'settings.errScheme': 'URL must start with http:// or https://',
  'settings.errInvalid': 'That is not a valid URL.',
  'settings.errProtocol': 'Only http:// and https:// are supported.',
  'settings.errHost': 'The URL is missing a host.',
  'settings.errPath': 'Use only scheme + host (no path), e.g. https://host:3001',
  'settings.errQuery': 'Remove the query string and #fragment from the URL.',

  'settings.iceTitle': '📡 WebRTC ICE / TURN',
  'settings.iceCopy':
    'Direct peer channels use WebRTC. A TURN server helps when peers are behind incompatible NATs. Ciphertext stays end-to-end encrypted — TURN only sees opaque packets and connection metadata. Leave blank to use the built-in Open Relay demo TURN, or paste your own (e.g. a free Metered credential).',
  'settings.iceDefaultHint':
    'Default demo TURN: <code>openrelay.metered.ca</code> with public username <code>{user}</code>. Self-hosters should override — the demo operator sees metadata.',
  'settings.iceModeTurn': 'Custom TURN',
  'settings.iceModeJson': 'ICE JSON',
  'settings.turnUrlsLabel': 'TURN / STUN URLs',
  'settings.turnUrlsPlaceholder': 'turn:turn.example.com:3478\nturns:turn.example.com:443?transport=tcp',
  'settings.turnUsernameLabel': 'TURN username',
  'settings.turnUsernamePlaceholder': 'username',
  'settings.turnCredentialLabel': 'TURN credential',
  'settings.turnCredentialPlaceholder': 'credential',
  'settings.turnHint':
    'One URL per line (or comma-separated). Google STUNs stay included. Saved values replace the demo TURN until cleared.',
  'settings.saveTurn': 'Save TURN',
  'settings.iceJsonLabel': 'ICE servers JSON',
  'settings.iceJsonPlaceholder':
    '[{ "urls": "stun:stun.l.google.com:19302" }, { "urls": "turn:…", "username": "…", "credential": "…" }]',
  'settings.iceJsonHint':
    'Paste a full <code>RTCIceServer[]</code> array (as from a Metered dashboard). Also supported at build time via <code>VITE_ICE_SERVERS_JSON</code>.',
  'settings.saveIceJson': 'Save ICE JSON',
  'settings.clearIce': 'Use demo defaults',
  'settings.iceSaved': 'ICE / TURN settings saved. Rejoin a room for them to take effect.',
  'settings.iceCleared': 'Cleared — using built-in Open Relay demo TURN.',
  'settings.iceErrEmpty': 'Paste an ICE servers JSON array.',
  'settings.iceErrJson': 'ICE JSON is not valid JSON.',
  'settings.iceErrArray': 'ICE servers must be a non-empty JSON array.',
  'settings.iceErrEntry': 'Each ICE entry must be an object.',
  'settings.iceErrUrls': 'Each ICE entry needs a urls string or string array.',
  'settings.turnErrEnter': 'Enter at least one TURN URL.',
  'settings.turnErrScheme': 'URLs must start with turn:, turns:, stun:, or stuns:.',
  'settings.turnErrAuth': 'TURN username and credential are required.',

  // --- Chat -------------------------------------------------------------
  'chat.title': '🔐 Silencium',
  'chat.leave': 'Leave Chat',
  'chat.shareLabel': 'Share Link For Invitation:',
  'chat.copyLink': 'Copy Link',
  'chat.copyInvitePrompt': 'Copy this invite link:',
  'chat.connectionError': 'Cannot reach the relay at <code>{url}</code> — {message}',
  'chat.serverSettings': 'Server settings',
  'chat.encryptionActive': '🔒 Encryption Active',
  'chat.encryptionEstablishing': '⏳ Establishing Encryption...',
  'chat.waitingForPeer': '⏳ Waiting for the other party…',
  'chat.waitingForPeerPlaceholder': '> Waiting for the other party…',
  'chat.typeMessage': '> Type a message...',
  'chat.send': 'Send',
  'chat.attachImage': 'Attach image',
  'chat.waitForEncryption': 'Wait for encryption to be established',
  'chat.uploadingImage': 'Uploading image...',
  'chat.noText': '[no text]',
  'chat.encryptionNowActive': '🔒 End-to-end encryption is now active',
  'chat.relayUnreachable': 'Could not reach the relay server.',
  'chat.alertWaitEncryption':
    'Please wait for encryption to be established before sending images.',
  'chat.alertConnectionLost': 'Connection lost. Please refresh the page.',
  'chat.alertUploadInProgress': 'Please wait for the current upload to complete.',
  'chat.alertOnlyTypes': 'Only JPG/PNG/GIF under 6MB allowed',
  'chat.alertImageTooLarge':
    'Image too large after compression. Please use a smaller image.',
  'chat.alertEncryptFailed': 'Failed to encrypt image. Please try again.',
  'chat.alertImageSendFailed': 'Image could not be sent. Please try again.',

  'chat.keyGateCopy':
    'This invite has a room id but needs the shared room key (shared out-of-band).',
  'chat.keyGateContinue': 'Enter room',
  'chat.shareKeyHint':
    'Share the room key separately (not in the link). Both of you must use the same key.',
  'chat.authVerifying': '⏳ Verifying shared room key…',
  'chat.authFailed':
    '⚠️ Room key verification failed. Wrong key, or the relay tried to MITM — chat blocked.',
  'chat.authFailedBanner': '❌ Verification failed — leave and retry with the correct key',
  'chat.fingerprintLabel': 'Verification code',
  'chat.fingerprintReady': '🔏 Verification code: {code} (compare with your contact)',
  'chat.decryptFailed': '⚠️ Could not decrypt a message (tampered or wrong key).',
  'chat.alertTextTooLong': 'Message is too long.',
  'chat.webrtcActive': '📡 Direct peer channel connected (WebRTC)',
  'chat.webrtcFallback': '📡 Direct channel unavailable — using encrypted relay',
  'chat.transportLabel': 'Transport',
  'chat.transportWebrtc': 'WebRTC',
  'chat.transportConnecting': 'WebRTC…',
  'chat.transportSocket': 'Encrypted relay',

  // --- In-app update ----------------------------------------------------
  'update.sectionTitle': 'App updates',
  'update.sectionCopy':
    'The Android app checks for a new build when it starts. You can also check on demand — new builds are published on GitHub Releases.',
  'update.installedLabel': 'Installed version',
  'update.checkButton': 'Check for updates',
  'update.checking': 'Checking…',
  'update.upToDate': 'You are on the latest version ({version}).',
  'update.checkFailed':
    'Could not check for updates. Try again later or open the GitHub Releases page.',
  'update.title': 'Update available',
  'update.forceTitle': 'Update required',
  'update.newVersion': 'New version {version} ({code})',
  'update.installedVersion': 'Installed: {version} ({code})',
  'update.forceCopy':
    'This update is required. Please install it to keep using Silencium.',
  'update.changelog': "What's new",
  'update.updateNow': 'Update',
  'update.opening': 'Opening…',
  'update.later': 'Later',
  'update.skip': 'Skip this version',
  'update.exit': 'Exit',
  'update.exitFailed': 'Could not close the app. Close it manually.',
  'update.openFailed':
    'Could not open the download link. Open it manually: {url}',
  'update.webNote':
    'In-app updates are for the Android sideload build. On the web you already run the latest build.',
};
