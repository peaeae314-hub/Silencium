/**
 * Silencium end-to-end smoke test (no browser required).
 * Verifies: join room, X25519 key exchange, ChaCha20-Poly1305 text + image
 * relay through the server, room-full rejection, and room destruction on leave.
 *
 * Run:  NODE_PATH=/workspace/Silencium/client/node_modules node tools/smoke-test.cjs
 */
const crypto = require('crypto');
const sodium = require('libsodium-wrappers');
const { io } = require('socket.io-client');

const URL = process.env.SILENCIUM_URL || 'http://localhost:3001';

// B12 — mirror the client's room-id scheme: 128 bits from the CSPRNG,
// base64url-encoded (no padding). Exercise the `-`/`_` alphabet too.
const newRoomId = (prefix = 'smoke') =>
  `${prefix}-${crypto.randomBytes(16).toString('base64url')}`;
const ROOM = newRoomId();

const mk = () =>
  io(URL, { transports: ['websocket'], forceNew: true, autoConnect: false, reconnection: false });

const enc = (key, bytes) => {
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  return { ciphertext: sodium.crypto_secretbox_easy(bytes, nonce, key), nonce };
};

const sessionKey = (kp, theirPub, isClient) => {
  const k = isClient
    ? sodium.crypto_kx_client_session_keys(kp.publicKey, kp.privateKey, theirPub)
    : sodium.crypto_kx_server_session_keys(kp.publicKey, kp.privateKey, theirPub);
  return isClient ? k.sharedTx : k.sharedRx; // mirrors crypto.worker.js
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = [];
const fail = [];
const check = (name, ok, extra = '') => (ok ? pass : fail).push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);

(async () => {
  await sodium.ready;

  // B12 — the room id the rest of the run uses is 128-bit, URL-safe.
  check(
    'room id is 128-bit URL-safe base64url (B12)',
    /^smoke-[A-Za-z0-9_-]{22}$/.test(ROOM),
    ROOM
  );

  const A = mk();
  const B = mk();
  const kpA = sodium.crypto_kx_keypair();
  const kpB = sodium.crypto_kx_keypair();
  let keyA = null;
  let keyB = null;
  const textsSeen = [];
  let imageSeen = null;

  // Server events the MVP cuts removed; any of these firing is a failure.
  const REMOVED_EVENTS = [
    'room-update',
    'start-chat',
    'user-left',
    'receive-image',
    'roomDestructed',
    'start-inactivity-countdown',
    'cancel-inactivity-countdown',
  ];
  const removedEvents = [];

  B.on('receive-public-key', ({ publicKey, theirSocketId }) => {
    const isClient = B.id === [B.id, theirSocketId].sort()[1];
    keyB = sessionKey(kpB, new Uint8Array(publicKey), isClient);
    B.emit('send-public-key', { roomId: ROOM, publicKey: Array.from(kpB.publicKey) });
  });
  A.on('receive-public-key', ({ publicKey, theirSocketId }) => {
    const isClient = A.id === [A.id, theirSocketId].sort()[1];
    keyA = sessionKey(kpA, new Uint8Array(publicKey), isClient);
  });
  B.on('receive-message', ({ encrypted, nonce }) => {
    textsSeen.push(
      sodium.to_string(
        sodium.crypto_secretbox_open_easy(new Uint8Array(encrypted), new Uint8Array(nonce), keyB)
      )
    );
  });
  B.on('receive-encrypted-image', ({ encrypted, nonce, name }) => {
    imageSeen = {
      name,
      binary:
        encrypted instanceof Uint8Array ||
        encrypted instanceof ArrayBuffer ||
        Buffer.isBuffer(encrypted),
      data: sodium.to_string(
        sodium.crypto_secretbox_open_easy(new Uint8Array(encrypted), new Uint8Array(nonce), keyB)
      ),
    };
  });

  [A, B].forEach((peer) =>
    REMOVED_EVENTS.forEach((ev) => peer.on(ev, () => removedEvents.push(ev)))
  );

  A.connect();
  B.connect();
  await Promise.all([
    new Promise((r) => A.on('connect', r)),
    new Promise((r) => B.on('connect', r)),
  ]);
  check('both peers connected to relay', !!A.id && !!B.id, `A=${A.id} B=${B.id}`);

  A.emit('join-room', { roomId: ROOM });
  await wait(300);
  B.emit('join-room', { roomId: ROOM });
  await wait(500);

  // trigger key exchange both ways
  A.emit('send-public-key', { roomId: ROOM, publicKey: Array.from(kpA.publicKey) });
  B.emit('send-public-key', { roomId: ROOM, publicKey: Array.from(kpB.publicKey) });
  await wait(600);

  check('shared key derived on both peers', !!keyA && !!keyB);
  check(
    'peers agree on the same session key',
    !!keyA && !!keyB && sodium.to_hex(keyA) === sodium.to_hex(keyB)
  );

  // ---- text message (binary frames, mirrors the client) ----
  const msg = 'hello silencium 🔐 ' + ROOM;
  const t = enc(keyA, sodium.from_string(msg));
  A.emit('send-message', {
    roomId: ROOM,
    encrypted: t.ciphertext, // Uint8Array -> Socket.IO binary frame
    nonce: t.nonce,
  });
  await wait(500);
  check(
    'encrypted text round-trip decrypts correctly (binary)',
    textsSeen.includes(msg),
    `got=${JSON.stringify(textsSeen)}`
  );

  // ---- legacy number-array text form still relays (backward compatible) ----
  const msgLegacy = 'legacy-array ' + ROOM;
  const tl = enc(keyA, sodium.from_string(msgLegacy));
  A.emit('send-message', {
    roomId: ROOM,
    encrypted: Array.from(tl.ciphertext),
    nonce: Array.from(tl.nonce),
  });
  await wait(500);
  check(
    'legacy number-array text still relays',
    textsSeen.includes(msgLegacy),
    `got=${JSON.stringify(textsSeen)}`
  );

  // ---- encrypted image (binary transport, B6) ----
  const fakePng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
  const i = enc(keyA, sodium.from_string(fakePng));
  A.emit('send-encrypted-image', {
    roomId: ROOM,
    encrypted: i.ciphertext, // Uint8Array -> Socket.IO binary frame
    nonce: i.nonce,
    name: 'smoke.png',
    type: 'image/png',
  });
  await wait(500);
  check(
    'encrypted image round-trip decrypts correctly',
    !!imageSeen && imageSeen.data === fakePng && imageSeen.name === 'smoke.png'
  );
  check(
    'image ciphertext is relayed as binary, not an inflated number array (B6)',
    !!imageSeen && imageSeen.binary === true
  );

  // ---- legacy PLAINTEXT image relay must be dead (R1 cut) ----
  const plainSeen = new Promise((resolve) => {
    B.on('receive-image', resolve);
    setTimeout(() => resolve(null), 1200);
  });
  const plainPng = 'data:image/png;base64,PLAINTEXT_NOT_ENCRYPTED';
  A.emit('image-message', { roomId: ROOM, image: plainPng, name: 'plain.png', type: 'image/png' });
  const gotPlain = await plainSeen;
  check(
    'legacy plaintext "image-message" path is closed',
    gotPlain === null,
    gotPlain ? 'server relayed unencrypted base64 image' : 'no plaintext image relayed'
  );

  // ---- aligned limits (B6): oversized ciphertext is rejected with image-error ----
  const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // mirrors server/app.js
  const oversizedSeen = new Promise((resolve) => {
    A.on('image-error', resolve);
    setTimeout(() => resolve(null), 1500);
  });
  A.emit('send-encrypted-image', {
    roomId: ROOM,
    encrypted: new Uint8Array(MAX_IMAGE_BYTES + 1),
    nonce: new Uint8Array(sodium.crypto_secretbox_NONCEBYTES),
    name: 'too-big.png',
    type: 'image/png',
  });
  const oversizedErr = await oversizedSeen;
  check(
    'oversized encrypted image is rejected with image-error (B6)',
    typeof oversizedErr === 'string' && oversizedErr.length > 0,
    `got=${JSON.stringify(oversizedErr)}`
  );

  // ---- room capacity ----
  const C = mk();
  const joinErr = await new Promise((resolve) => {
    C.on('join-error', resolve);
    C.connect();
    C.on('connect', () => C.emit('join-room', { roomId: ROOM }));
    setTimeout(() => resolve(null), 1500);
  });
  check('third peer is rejected with room-full', joinErr === 'Room is full', `got=${joinErr}`);
  C.disconnect();

  // ---- B9: switching rooms must not crash the relay / leak the old room ----
  const D = mk();
  const E = mk();
  const R2 = ROOM + '-a';
  const R3 = ROOM + '-b';
  D.connect();
  await new Promise((r) => D.on('connect', r));
  D.emit('join-room', { roomId: R2 });
  await wait(300);
  D.emit('join-room', { roomId: R3 }); // exercises previous-room cleanup
  await wait(300);
  E.connect();
  await new Promise((r) => E.on('connect', r));
  const eJoinErr = new Promise((resolve) => {
    E.on('join-error', resolve);
    setTimeout(() => resolve('__no_error__'), 1500);
  });
  E.emit('join-room', { roomId: R3 });
  const eErr = await eJoinErr;
  check(
    'switching rooms frees the old room without crashing the relay (B9)',
    eErr === '__no_error__',
    `E join-error=${JSON.stringify(eErr)}`
  );
  D.disconnect();
  E.disconnect();

  // ---- destruction on leave ----
  const destroyed = new Promise((resolve) => {
    B.on('room-destroyed', resolve);
    setTimeout(() => resolve(null), 2000);
  });
  A.emit('leave-room', { roomId: ROOM });
  const d = await destroyed;
  check('room destroyed when a participant leaves', !!d && !!d.message, d && d.message);

  // ---- MVP cuts: removed server events stay silent ----
  check(
    'removed server events (room-update/start-chat/receive-image/inactivity) are not emitted',
    removedEvents.length === 0,
    removedEvents.join(', ') || 'none observed'
  );

  A.disconnect();
  B.disconnect();

  // ---- B5: HTTP surface ----
  // `/` always answers 200 (dev: plain text, production: built SPA).
  // With SILENCIUM_EXPECT_SPA=1 also assert the production static + SPA
  // fallback wiring, since that is the whole point of the B5 fix.
  const base = URL.replace(/\/+$/, '');
  try {
    const root = await fetch(base + '/');
    const rootType = root.headers.get('content-type') || '';
    const rootBody = await root.text();
    check('relay answers HTTP 200 on /', root.status === 200, `status=${root.status}`);

    if (process.env.SILENCIUM_EXPECT_SPA === '1') {
      check(
        'GET / serves the built SPA as HTML (B5)',
        root.status === 200 && rootType.includes('text/html') && rootBody.includes('<div id="root">'),
        `status=${root.status} type=${rootType}`
      );
      const roomPath = await fetch(`${base}/chat?room=${ROOM}`);
      const roomBody = await roomPath.text();
      check(
        'SPA fallback serves index.html for a room path (B5)',
        roomPath.status === 200 &&
          (roomPath.headers.get('content-type') || '').includes('text/html') &&
          roomBody.includes('<div id="root">'),
        `status=${roomPath.status}`
      );
    }

    const health = await fetch(base + '/health');
    check('GET /health answers 200', health.status === 200, `status=${health.status}`);
  } catch (e) {
    check('relay HTTP surface reachable', false, e.message);
  }

  console.log('\n--- Silencium smoke test: room ' + ROOM + ' ---');
  console.log([...pass, ...fail].join('\n'));
  console.log(`\n${pass.length} passed, ${fail.length} failed`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => {
  console.error('SMOKE TEST ERROR:', e);
  process.exit(2);
});
