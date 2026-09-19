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
