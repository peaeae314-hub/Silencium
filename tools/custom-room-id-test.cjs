#!/usr/bin/env node
/**
 * Custom room id + intent='create' relay test (real relay process).
 *
 * Proves, against the shipped relay:
 *   1. malformed room ids are refused with code INVALID_ROOM_ID for create AND
 *      join; the 4/64-char boundaries are accepted;
 *   2. a second intent='create' on an occupied id returns ROOM_OCCUPIED and
 *      leaves the room and its occupant completely untouched;
 *   3. a normal intent='join' still fills the second seat, and a third join
 *      still gets ROOM_FULL;
 *   4. a held B14 grace seat counts as occupied for a *stranger's* create, but
 *      the SAME participant reclaims it with intent='create' or intent='join'
 *      (so the creator's own reconnect never sees ROOM_OCCUPIED);
 *   5. two intent='create' emits from one socket are idempotent;
 *   6. create succeeds again after the room is gone.
 *
 * This uses intent='create' and B14 grace, but the code is NOT the client — it
 * mirrors what `client/src/pages/ChatRoom.jsx` sends.
 *
 * Run:  NODE_PATH=/workspace/Silencium/client/node_modules node tools/custom-room-id-test.cjs
 */
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = Number(process.env.CUSTOM_ROOM_ID_TEST_PORT || 3998);
const URL = `http://localhost:${PORT}`;
const GRACE_MS = 1500;
const SERVER_DIR = path.resolve(__dirname, '..', 'server');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pass = [];
const fail = [];
const check = (name, ok, extra = '') =>
  (ok ? pass : fail).push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);
const mk = () =>
  io(URL, { transports: ['websocket'], forceNew: true, autoConnect: false, reconnection: false });

const connect = (s) =>
  new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    s.connect();
  });

/** Emit one join-room; resolve on join-error or after `timeout` (success). */
const joinOnce = (s, room, extra = {}, timeout = 400) =>
  new Promise((resolve) => {
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.off('join-error', onError);
      resolve(value);
    };
    const onError = (msg, meta) => finish({ error: msg, code: meta && meta.code });
    const timer = setTimeout(() => finish({ error: null, code: null }), timeout);
    s.on('join-error', onError);
    s.emit('join-room', { roomId: room, ...extra });
  });

const randId = (len) => {
  let out = '';
  while (out.length < len) out += Math.random().toString(36).slice(2);
  return out.slice(0, len);
};

(async () => {
  const child = spawn(process.execPath, ['app.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT), SILENCIUM_DISCONNECT_GRACE_MS: String(GRACE_MS) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[relay] ${d}`));
  child.stdout.on('data', () => {});

  const tag = randId(6);
  const sockets = [];
  const open = async () => {
    const s = mk();
    await connect(s);
    sockets.push(s);
    return s;
  };

  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i += 1) {
      try {
        up = (await fetch(`${URL}/health`)).ok;
      } catch {
        await wait(100);
      }
    }
    check('relay process started', up);
    if (!up) throw new Error('relay did not start');

    // ---- 1. format validation (create and join) --------------------------
    const badIds = ['abc', 'ab', 'a b', '中文房间', 'a/b', 'x'.repeat(65), ''];
    for (const intent of ['create', 'join']) {
      for (const bad of badIds) {
        const s = await open();
        const r = await joinOnce(s, bad, { intent });
        check(
          `invalid id ${JSON.stringify(bad)} rejected (intent=${intent})`,
          r.code === 'INVALID_ROOM_ID',
          `error=${r.error} code=${r.code}`
        );
        s.disconnect();
      }
    }

    const fourChar = await open();
    const r4 = await joinOnce(fourChar, randId(4), { intent: 'create' });
    check('4-char room id accepted', r4.error === null, r4.error || '');
    fourChar.disconnect();

    const longChar = await open();
    const r64 = await joinOnce(longChar, 'A'.repeat(60) + randId(4), { intent: 'join' });
    check('64-char room id accepted', r64.error === null, r64.error || '');
    longChar.disconnect();

    // ---- 2+3. occupied create, then join / full --------------------------
    const room = `my-room-xyz-${tag}`;
    const A = await open();
    const B = await open();
    const aCreate = await joinOnce(A, room, { intent: 'create' });
    check('A creates a custom room with intent=create', aCreate.error === null, aCreate.error || '');
    await wait(300); // let A's "created the room" system-message flush

    const aSystem = [];
    const aDestroyed = [];
    const bSystem = [];
    A.on('system-message', (m) => aSystem.push(m));
    A.on('room-destroyed', (p) => aDestroyed.push(p));
    B.on('system-message', (m) => bSystem.push(m));

    const bCreate = await joinOnce(B, room, { intent: 'create' });
    check(
      'B create on the occupied id → ROOM_OCCUPIED',
      bCreate.code === 'ROOM_OCCUPIED',
      `error=${bCreate.error} code=${bCreate.code}`
    );
    check(
      'occupied refusal still carries an English message (old-client compatible)',
      typeof bCreate.error === 'string' && bCreate.error.length > 0,
      bCreate.error || ''
    );
    await wait(350);
    check('occupied create sent A no system-message', aSystem.length === 0, JSON.stringify(aSystem));
    check('occupied create did not destroy the room', aDestroyed.length === 0);
    check('occupied create sent B no system-message', bSystem.length === 0, JSON.stringify(bSystem));

    const bJoin = await joinOnce(B, room, { intent: 'join' });
    check('B joins the same id with intent=join', bJoin.error === null, bJoin.error || '');

    const C = await open();
    const cJoin = await joinOnce(C, room, { intent: 'join' });
    check(
      'third peer still gets ROOM_FULL',
      cJoin.error === 'Room is full' && cJoin.code === 'ROOM_FULL',
      `error=${cJoin.error} code=${cJoin.code}`
    );
    C.disconnect();

    // ---- grace seat counts as occupied for a stranger --------------------
    const graceRoom = `grace-held-${tag}`;
    const G = await open();
    const gCreate = await joinOnce(G, graceRoom, { intent: 'create', participantId: 'pid-G' });
    check('grace: A creates the room', gCreate.error === null, gCreate.error || '');
    G.disconnect();
    await wait(GRACE_MS / 3);

    const G2 = await open();
    const g2Create = await joinOnce(G2, graceRoom, { intent: 'create', participantId: 'pid-other' });
    check(
      'grace: stranger create while the seat is held → ROOM_OCCUPIED',
      g2Create.code === 'ROOM_OCCUPIED',
      `error=${g2Create.error} code=${g2Create.code}`
    );
    G2.disconnect();

    // ---- 4a. same participant reclaims with intent=create ---------------
    const reclaimRoom = `reclaim-create-${tag}`;
    const RA = await open();
    const raCreate = await joinOnce(RA, reclaimRoom, { intent: 'create', participantId: 'pid-A' });
    check('reclaim: initial create', raCreate.error === null, raCreate.error || '');
    RA.disconnect();
    await wait(GRACE_MS / 3);

    const RA2 = await open();
    const raReclaim = await joinOnce(RA2, reclaimRoom, { intent: 'create', participantId: 'pid-A' });
    check(
      'reclaim with intent=create in the grace window succeeds',
      raReclaim.error === null,
      `error=${raReclaim.error} code=${raReclaim.code}`
    );
    RA2.disconnect();

    // ---- 4b. same participant reclaims with intent=join ------------------
    const rejoinRoom = `reclaim-join-${tag}`;
    const JA = await open();
    const jaCreate = await joinOnce(JA, rejoinRoom, { intent: 'create', participantId: 'pid-J' });
    check('reconnect: initial create', jaCreate.error === null, jaCreate.error || '');
    JA.disconnect();
    await wait(GRACE_MS / 3);

    const JA2 = await open();
    const jaRejoin = await joinOnce(JA2, rejoinRoom, { intent: 'join', participantId: 'pid-J' });
    check(
      'reconnect with intent=join in the grace window succeeds',
      jaRejoin.error === null,
      `error=${jaRejoin.error} code=${jaRejoin.code}`
    );
    JA2.disconnect();

    // ---- 5. repeated create from the same socket is idempotent -----------
    const idemRoom = `idem-${tag}`;
    const I = await open();
    const i1 = await joinOnce(I, idemRoom, { intent: 'create' });
    const i2 = await joinOnce(I, idemRoom, { intent: 'create' });
    check('same-socket repeated create #1 succeeds', i1.error === null, i1.error || '');
    check('same-socket repeated create #2 is idempotent', i2.error === null, i2.error || '');

    const I2 = await open();
    const i3 = await joinOnce(I2, idemRoom, { intent: 'join' });
    check('repeated create consumed only one seat', i3.error === null, i3.error || '');
    I.disconnect();
    I2.disconnect();

    // ---- 6. create works again once the room is gone ---------------------
    const destroyRoom = `recreate-${tag}`;
    const D = await open();
    const dCreate = await joinOnce(D, destroyRoom, { intent: 'create' });
    check('recreate: first create', dCreate.error === null, dCreate.error || '');
    D.emit('leave-room', { roomId: destroyRoom });
    await wait(300);

    const D2 = await open();
    const d2Create = await joinOnce(D2, destroyRoom, { intent: 'create' });
    check(
      'create succeeds again after the room was destroyed',
      d2Create.error === null,
      `error=${d2Create.error} code=${d2Create.code}`
    );
    D2.disconnect();

    A.disconnect();
    B.disconnect();
  } finally {
    for (const s of sockets) {
      try {
        s.disconnect();
      } catch {
        /* ignore */
      }
    }
    child.kill('SIGKILL');
  }

  console.log('\n--- custom room id (intent=create / format) relay test ---');
  console.log([...pass, ...fail].join('\n'));
  console.log(`\n${pass.length} passed, ${fail.length} failed`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => {
  console.error('CUSTOM ROOM ID TEST ERROR:', e);
  process.exit(2);
});
