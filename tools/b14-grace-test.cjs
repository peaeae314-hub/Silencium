#!/usr/bin/env node
/**
 * B14 — reconnect grace regression test.
 *
 * Proves, against a real relay process:
 *   1. `disconnect` does NOT destroy the room immediately (seat is held).
 *   2. A re-join for the same room within the grace window cancels the pending
 *      destroy, even though the socket id changed (no "Room is full").
 *   3. The room is still alive after the grace window would have elapsed.
 *   4. A true abandon (no re-join) still destroys the room after the grace.
 *   5. A manual `leave-room` still destroys the room for the peer immediately.
 *   6. The shipped default grace is 60 s (source assertion).
 *
 * The grace window is shortened via SILENCIUM_DISCONNECT_GRACE_MS so the test
 * runs in seconds; the production default is checked against the source.
 *
 * Run:  NODE_PATH=/workspace/Silencium/client/node_modules node tools/b14-grace-test.cjs
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = Number(process.env.B14_TEST_PORT || 3999);
const URL = `http://localhost:${PORT}`;
const GRACE_MS = 2000;
const SERVER_DIR = path.resolve(__dirname, '..', 'server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const roomId = (name) => `b14-${name}-${Date.now().toString(36)}`;
const mk = () =>
  io(URL, { transports: ['websocket'], forceNew: true, autoConnect: false, reconnection: false });

const pass = [];
const fail = [];
const check = (name, ok, extra = '') =>
  (ok ? pass : fail).push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);

const connect = (s) =>
  new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    s.connect();
  });

const join = (s, room, extra = {}) =>
  new Promise((resolve) => {
    s.on('join-error', (msg) => resolve({ error: msg }));
    s.emit('join-room', { roomId: room, ...extra });
    setTimeout(() => resolve({ error: null }), 400);
  });

(async () => {
  // ---- 6. production default is 60 s --------------------------------------
  const serverSrc = fs.readFileSync(path.join(SERVER_DIR, 'app.js'), 'utf8');
  check(
    'default disconnect grace is 60s (source)',
    /60\s*\*\s*1000/.test(serverSrc) && /DISCONNECT_GRACE_MS/.test(serverSrc),
    'server/app.js'
  );

  const child = spawn(process.execPath, ['app.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), SILENCIUM_DISCONNECT_GRACE_MS: String(GRACE_MS) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[relay] ${d}`));
  child.stdout.on('data', () => {});

  try {
    // wait for /health
    let up = false;
    for (let i = 0; i < 50 && !up; i += 1) {
      try {
        const res = await fetch(`${URL}/health`);
        up = res.ok;
      } catch {
        await wait(100);
      }
    }
    check('relay process started', up);
    if (!up) throw new Error('relay did not start');

    // ---- 1+2+3. background drop is recoverable ----------------------------
    const room = roomId('resume');
    const a = mk();
    const b = mk();
    await connect(a);
    await connect(b);
    await join(a, room);
    await join(b, room);

    let destroyedA = null;
    a.on('room-destroyed', (payload) => {
      destroyedA = payload;
    });
    let destroyedB = null;
    b.on('room-destroyed', (payload) => {
      destroyedB = payload;
    });

    b.disconnect();
    await wait(GRACE_MS / 2);
    check('room is not destroyed immediately on disconnect (seat held)', destroyedA === null);

    // Re-join with a *new* socket id, exactly like an Android app resume.
    const b2 = mk();
    await connect(b2);
    const b2join = await join(b2, room);
    check('re-join within grace is accepted (no "Room is full")', b2join.error === null, `error=${b2join.error}`);

    // Wait past the original grace deadline; the cancelled timer must stay dead.
    await wait(GRACE_MS + 700);
    check('pending destroy was cancelled on re-join', destroyedA === null && destroyedB === null);

    // Room still holds exactly the two participants → third peer is rejected.
    const intruder = mk();
    await connect(intruder);
    const intruderJoin = await join(intruder, room);
    check(
      'reclaimed room still holds 2 participants',
      intruderJoin.error === 'Room is full',
      `error=${intruderJoin.error}`
    );
    intruder.disconnect();

    a.disconnect();
    b2.disconnect();

    // ---- 4. true abandon still destroys after the grace --------------------
    const room2 = roomId('abandon');
    const c = mk();
    const d = mk();
    await connect(c);
    await connect(d);
    await join(c, room2);
    await join(d, room2);
    const destroyed = new Promise((resolve) => {
      c.on('room-destroyed', resolve);
      setTimeout(() => resolve(null), GRACE_MS + 1500);
    });
    d.disconnect();
    const gone = await destroyed;
    check('no re-join → room destroyed after the grace expires', !!gone && !!gone.message);
    c.disconnect();

    // ---- 5. manual leave is still immediate (no grace wait) ----------------
    const room3 = roomId('leave');
    const e = mk();
    const f = mk();
    await connect(e);
    await connect(f);
    await join(e, room3);
    await join(f, room3);
    const leftDestroyed = new Promise((resolve) => {
      f.on('room-destroyed', resolve);
      setTimeout(() => resolve(null), 600); // well under the 2 s grace
    });
    e.emit('leave-room', { roomId: room3 });
    const manualGone = await leftDestroyed;
    check(
      'manual leave destroys for the peer immediately',
      !!manualGone && !!manualGone.message,
      `waited<${GRACE_MS}ms`
    );
    e.disconnect();
    f.disconnect();
  } finally {
    child.kill('SIGKILL');
  }

  console.log('\n--- B14 reconnect-grace test ---');
  console.log([...pass, ...fail].join('\n'));
  console.log(`\n${pass.length} passed, ${fail.length} failed`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => {
  console.error('B14 TEST ERROR:', e);
  process.exit(2);
});
