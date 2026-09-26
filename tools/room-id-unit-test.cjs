#!/usr/bin/env node
/**
 * Pure room-id / intent tests — no relay process required.
 *
 * Covers:
 *   • the shared format rule on BOTH sides (`client/src/utils/roomId.js` and
 *     `server/rooms/roomManager.js`) stay in sync over a valid/invalid matrix;
 *   • `generateRoomId()` produces a 22-char base64url id that validates;
 *   • `roomManager.joinRoom` create/join/full/idempotent intent semantics and
 *     `roomExists`.
 *
 * Run:  node tools/room-id-unit-test.cjs
 */
const path = require('path');
const { pathToFileURL } = require('url');
const roomManager = require(path.resolve(
  __dirname,
  '..',
  'server',
  'rooms',
  'roomManager'
));

const pass = [];
const fail = [];
const check = (name, ok, extra = '') =>
  (ok ? pass : fail).push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);

const INVALID = [
  '',
  'abc',
  'ab',
  'a'.repeat(65),
  'ab cd',
  '中文房间',
  'a/b',
  'a.b',
  'a?b',
  'a#b',
];
const VALID = ['abcd', 'a'.repeat(64), 'team-alpha-2026', 'A_b-9', 'ABCD1234'];

(async () => {
  // ---- format parity -----------------------------------------------------
  const client = await import(
    pathToFileURL(
      path.resolve(__dirname, '..', 'client', 'src', 'utils', 'roomId.js')
    ).href
  );

  for (const id of INVALID) {
    const serverOk = roomManager.isValidRoomId(id);
    const clientOk = client.isValidRoomId(id);
    check(`both reject ${JSON.stringify(id)}`, !serverOk && !clientOk, `server=${serverOk} client=${clientOk}`);
  }
  for (const id of VALID) {
    const serverOk = roomManager.isValidRoomId(id);
    const clientOk = client.isValidRoomId(id);
    check(`both accept ${JSON.stringify(id)}`, serverOk && clientOk, `server=${serverOk} client=${clientOk}`);
  }

  check('isValidRoomId trims client-side whitespace', client.isValidRoomId('  team-alpha  '));
  check('isShortRoomId flags "abc12"', client.isShortRoomId('abc12'));
  check('isShortRoomId flags 4 chars', client.isShortRoomId('abcd'));
  check('isShortRoomId clears 8 chars', !client.isShortRoomId('abcd1234'));
  check('isShortRoomId ignores empty', !client.isShortRoomId(''));

  const generated = client.generateRoomId();
  check(
    'generateRoomId is 22-char base64url and validates',
    /^[A-Za-z0-9_-]{22}$/.test(generated) && client.isValidRoomId(generated) && roomManager.isValidRoomId(generated),
    generated
  );

  // ---- roomManager intent semantics -------------------------------------
  const tag = Math.random().toString(36).slice(2, 8);
  const R = (n) => `unit-${n}-${tag}`;

  const r1 = R('create');
  check('create opens a new room', !roomManager.joinRoom(r1, 's1', { intent: 'create' }).error);
  check('roomExists finds it', roomManager.roomExists(r1));
  check(
    'duplicate create from the same socket is idempotent',
    !roomManager.joinRoom(r1, 's1', { intent: 'create' }).error
  );

  const occupied = roomManager.joinRoom(r1, 's2', { intent: 'create' });
  check(
    'create over an occupied room is refused',
    occupied.error === 'Room ID is already taken' && occupied.code === 'ROOM_OCCUPIED',
    `error=${occupied.error} code=${occupied.code}`
  );
  check(
    'refused create left membership untouched',
    roomManager.getUsers(r1).join(',') === 's1',
    roomManager.getUsers(r1).join(',')
  );

  const joined = roomManager.joinRoom(r1, 's2', { intent: 'join' });
  check('join with a free seat succeeds', !joined.error && joined.users.length === 2);
  const fullJoin = roomManager.joinRoom(r1, 's3', { intent: 'join' });
  check(
    'join a full room is refused with ROOM_FULL',
    fullJoin.error === 'Room is full' && fullJoin.code === 'ROOM_FULL',
    `error=${fullJoin.error} code=${fullJoin.code}`
  );
  const fullCreate = roomManager.joinRoom(r1, 's3', { intent: 'create' });
  check('create a full room is refused with ROOM_OCCUPIED', fullCreate.code === 'ROOM_OCCUPIED');
  roomManager.deleteRoom(r1);
  check('roomExists is false after delete', !roomManager.roomExists(r1));

  const r2 = R('recreate');
  check('create succeeds after the room was deleted', !roomManager.joinRoom(r2, 's9', { intent: 'create' }).error);
  roomManager.deleteRoom(r2);

  const r3 = R('default');
  check('missing intent still auto-creates (legacy join)', !roomManager.joinRoom(r3, 's1').error);
  check('missing intent still joins a second peer', !roomManager.joinRoom(r3, 's2').error);
  check('missing intent still enforces capacity', roomManager.joinRoom(r3, 's3').code === 'ROOM_FULL');
  roomManager.deleteRoom(r3);

  console.log('\n--- room-id unit test ---');
  console.log([...pass, ...fail].join('\n'));
  console.log(`\n${pass.length} passed, ${fail.length} failed`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => {
  console.error('ROOM-ID UNIT TEST ERROR:', e);
  process.exit(2);
});
