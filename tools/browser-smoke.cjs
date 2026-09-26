#!/usr/bin/env node
/**
 * Two-tab browser smoke for custom room ids (headless Chrome via CDP).
 *
 * Requires:
 *   • a production relay serving `client/dist` at SMOKE_URL (default
 *     http://localhost:3001),
 *   • a Chrome started with --remote-debugging-port=9222.
 *
 * Drives tabs through the real UI and writes screenshots to
 * `screens/custom-room-id/`. No extra npm dependencies — talks raw CDP over the
 * built-in WebSocket.
 *
 * Run:  node tools/browser-smoke.cjs
 */
const fs = require('fs');
const path = require('path');

const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9222';
const SMOKE_URL = process.env.SMOKE_URL || 'http://localhost:3001';
const OUT_DIR = path.resolve(
  process.env.SMOKE_OUT_DIR || path.join(__dirname, '..', 'screens', 'custom-room-id')
);

const ROOM_ID = process.env.SMOKE_ROOM || 'team-alpha-2026';
const ROOM_KEY = 'correct horse battery staple';
const MSG_B = 'hello-from-B-42';
const MSG_A = 'hello-from-A-42';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        const handlers = this.listeners.get(msg.method) || [];
        handlers.forEach((h) => h(msg.params));
      }
    });
  }

  static connect(wsUrl) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.addEventListener('open', () => resolve(new CDP(ws)));
      ws.addEventListener('error', (e) => reject(new Error(`ws error: ${e.message || e.type}`)));
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  on(method, handler) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(handler);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function closeAllPages() {
  try {
    const res = await fetch(`${CDP_HTTP}/json/list`);
    const list = await res.json();
    await Promise.all(
      list
        .filter((t) => t.type === 'page')
        .map((t) => fetch(`${CDP_HTTP}/json/close/${t.id}`).catch(() => {}))
    );
  } catch {
    /* no CDP yet */
  }
}

async function newPage({ locale, width = 390, height = 844 }) {  const res = await fetch(`${CDP_HTTP}/json/new?about:blank`, { method: 'PUT' });
  if (!res.ok) throw new Error(`/json/new failed: ${res.status}`);
  const info = await res.json();
  const page = await CDP.connect(info.webSocketDebuggerUrl);
  page.targetId = info.id;
  page.logs = [];
  page.on('Runtime.consoleAPICalled', (p) => {
    const text = (p.args || [])
      .map((a) => (a.value !== undefined ? a.value : a.description || ''))
      .join(' ');
    if (process.env.SMOKE_DEBUG === '1' || p.type === 'error' || p.type === 'warning') {
      page.logs.push(`[${p.type}] ${text}`);
    }
  });
  page.on('Runtime.exceptionThrown', (p) => {
    page.logs.push(
      `[exception] ${p.exceptionDetails?.exception?.description || p.exceptionDetails?.text}`
    );
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  // Never let a native alert() freeze the renderer/CDP session.
  page.on('Page.javascriptDialogOpening', () => {
    page.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  });
  const wsProbe =
    process.env.SMOKE_DEBUG === '1'
      ? `
      window.__wslog = [];
      (() => {
        const OrigWS = window.WebSocket;
        window.WebSocket = new Proxy(OrigWS, {
          construct(target, args) {
            const ws = new target(...args);
            const origSend = ws.send.bind(ws);
            ws.send = (data) => {
              try { window.__wslog.push('OUT|' + (typeof data === 'string' ? data.slice(0, 400) : '[bin]')); } catch (e) {}
              return origSend(data);
            };
            ws.addEventListener('message', (ev) => {
              try { window.__wslog.push('IN|' + (typeof ev.data === 'string' ? ev.data.slice(0, 400) : '[bin]')); } catch (e) {}
            });
            return ws;
          },
        });
      })();
    `
      : '';
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      try {
        Object.keys(localStorage)
          .filter((k) => k.endsWith('silencium.locale'))
          .forEach((k) => localStorage.removeItem(k));
        localStorage.setItem('silencium.locale', ${JSON.stringify(locale)});
      } catch (e) {}
      ${wsProbe}
    `,
  });
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await page.send('Page.navigate', { url: SMOKE_URL });
  await sleep(1200);
  return page;
}

async function evaluate(page, expression) {
  const res = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(
      `evaluate failed: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`
    );
  }
  return res.result.value;
}

async function waitFor(page, expression, { timeout = 15000, label = expression } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(page, `!!(${expression})`)) return true;
    } catch {
      /* retry */
    }
    await sleep(200);
  }
  throw new Error(`timeout waiting for ${label}`);
}

const jsStr = (s) => JSON.stringify(s);

const setValue = (selector, value) => `(() => {
  const el = document.querySelector(${jsStr(selector)});
  if (!el) return false;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, ${jsStr(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

const clickSelector = (selector) => `(() => {
  const el = document.querySelector(${jsStr(selector)});
  if (!el) return false;
  el.click();
  return true;
})()`;

const clickButtonByText = (text) =>
  `(() => {
    const el = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === ${jsStr(
      text
    )});
    if (!el) return false;
    el.click();
    return true;
  })()`;

const scrollIntoView = (selector) => `(() => {
  const el = document.querySelector(${jsStr(selector)});
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  return true;
})()`;

async function screenshot(page, name) {
  await sleep(250);
  const res = await page.send('Page.captureScreenshot', { format: 'png' });
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, Buffer.from(res.data, 'base64'));
  const size = fs.statSync(file).size;
  console.log(`  📸 ${name} (${size} bytes)`);
  return file;
}

async function fillCreateForm(page, roomId, key) {
  await page.send('Page.bringToFront');
  await waitFor(page, `document.querySelector('#create-room-id')`, { label: 'create form' });
  await evaluate(page, setValue('#create-room-key', key));
  await evaluate(page, setValue('#create-room-id', roomId));
  await sleep(250);
}

async function fillJoinForm(page, roomId, key) {
  await page.send('Page.bringToFront');
  await waitFor(page, `document.querySelector('#join-room-id')`, { label: 'join form' });
  await evaluate(page, setValue('#join-room-id', roomId));
  await evaluate(page, setValue('#join-room-key', key));
  await sleep(250);
}

async function expectChat(page, label) {
  try {
    await waitFor(page, `location.pathname === '/chat' && document.querySelector('.chat-container')`, {
      timeout: 15000,
      label,
    });
  } catch (e) {
    const body = await evaluate(page, `(document.body.innerText || '').slice(0, 400)`);
    throw new Error(`${e.message} | body=${JSON.stringify(body)}`);
  }
}

async function switchToJoin(page) {
  await evaluate(page, clickButtonByText('加入'));
  await waitFor(page, `document.querySelector('#join-room-id')`, { label: 'join tab' });
}

async function switchToCreate(page) {
  await evaluate(page, clickButtonByText('创建'));
  await waitFor(page, `document.querySelector('#create-room-id')`, { label: 'create tab' });
}

async function sendChat(page, text) {
  await page.send('Page.bringToFront');
  try {
    await waitFor(
      page,
      `document.querySelector('.chat-input input[type="text"]') && !document.querySelector('.chat-input input[type="text"]').disabled`,
      { timeout: 30000, label: 'chat input enabled (verified)' }
    );
  } catch (e) {
    const status = await evaluate(
      page,
      `(document.querySelector('.encryption-status') || {}).innerText || 'no-status'`
    );
    throw new Error(`${e.message} | status=${JSON.stringify(status)}`);
  }
  await evaluate(page, setValue('.chat-input input[type="text"]', text));
  await evaluate(page, clickSelector('.chat-input button:last-of-type'));
  await sleep(300);
}

const results = [];
const record = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
  console.log(`${ok ? '✅' : '❌'}  ${name}${detail ? ' :: ' + detail : ''}`);
};

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Fail fast if the ops tunnel (port 8090) host is somehow in play.
  for (const p of ['8090']) {
    if (SMOKE_URL.includes(`:${p}`)) throw new Error(`refusing to use reserved port ${p}`);
  }

  const pages = [];
  try {
    // Close any tabs a previous (possibly crashed) run left behind — a live
    // tab keeps its socket in the room and would poison the next run.
    await closeAllPages();
    await sleep(300);

    // ---- 01: A creates a custom room -----------------------------------
    const A = await newPage({ locale: 'zh-Hans' });
    pages.push(A);
    await fillCreateForm(A, ROOM_ID, ROOM_KEY);
    await evaluate(A, clickSelector('.room-key-submit'));
    await expectChat(A, 'A entered the chat');
    const aUrl = await evaluate(A, `location.href`);
    record('01 A creates team-alpha-2026 and enters the room', aUrl.includes(`room=${ROOM_ID}`), aUrl);
    await screenshot(A, '01-create-custom-ok.png');

    // ---- 02: B create on the occupied id is inline-rejected ------------
    const B = await newPage({ locale: 'zh-Hans' });
    pages.push(B);
    await fillCreateForm(B, ROOM_ID, ROOM_KEY);
    await evaluate(B, clickSelector('.room-key-submit'));
    await waitFor(
      B,
      `location.pathname === '/' && document.body.innerText.includes('房间号已被占用')`,
      { timeout: 15000, label: 'occupied inline error' }
    );
    record('02 B create same id → inline 房间号已被占用, stays home', (await evaluate(B, `location.pathname`)) === '/');
    await evaluate(B, scrollIntoView('#create-room-id'));
    await screenshot(B, '02-create-occupied.png');

    // ---- 03: B joins with the same id + key, both exchange a message ---
    await switchToJoin(B);
    await fillJoinForm(B, ROOM_ID, ROOM_KEY);
    await evaluate(B, clickSelector('.room-key-submit'));
    await expectChat(B, 'B joined the chat');
    record('03 B joins the same id with intent=join', true, await evaluate(B, `location.href`));

    await sendChat(B, MSG_B);
    await waitFor(A, `document.querySelector('.chat-messages') && document.querySelector('.chat-messages').innerText.includes(${jsStr(MSG_B)})`, {
      timeout: 20000,
      label: 'A received B message',
    });
    await sendChat(A, MSG_A);
    await waitFor(B, `document.querySelector('.chat-messages') && document.querySelector('.chat-messages').innerText.includes(${jsStr(MSG_A)})`, {
      timeout: 20000,
      label: 'B received A message',
    });
    record('03b both directions of encrypted chat delivered', true);
    await evaluate(B, scrollIntoView('.chat-messages'));
    await screenshot(B, '03-join-same-id-ok.png');

    // ---- 04-06: validation states (fresh home tab) ----------------------
    const D = await newPage({ locale: 'zh-Hans' });
    pages.push(D);

    await fillCreateForm(D, 'abc12', ROOM_KEY);
    await waitFor(D, `document.body.innerText.includes('房间号太短，容易被别人猜中')`, {
      timeout: 5000,
      label: 'short-id warning',
    });
    await evaluate(D, scrollIntoView('#create-room-id'));
    await screenshot(D, '04-short-id-warning.png');
    record('04 5-char id warns but stays submittable', true);

    await evaluate(D, setValue('#create-room-id', 'bad id'));
    await waitFor(D, `document.body.innerText.includes('房间号只能包含字母、数字')`, {
      timeout: 5000,
      label: 'create format error',
    });
    await evaluate(D, scrollIntoView('#create-room-id'));
    await screenshot(D, '05-invalid-id-create.png');
    record('05 invalid create id shows inline format error', true);

    await switchToJoin(D);
    await fillJoinForm(D, 'a b', ROOM_KEY);
    await evaluate(D, clickSelector('.room-key-submit'));
    await waitFor(D, `location.pathname === '/' && document.body.innerText.includes('房间号格式不正确')`, {
      timeout: 5000,
      label: 'join format error',
    });
    await evaluate(D, scrollIntoView('#join-room-id'));
    await screenshot(D, '06-invalid-id-join.png');
    record('06 invalid join id shows inline format error', true);

    // ---- 07: zh-Hant create page ---------------------------------------
    const E = await newPage({ locale: 'zh-Hant' });
    pages.push(E);
    await fillCreateForm(E, 'abc12', ROOM_KEY);
    await waitFor(E, `document.body.innerText.includes('自訂房間號')`, {
      timeout: 5000,
      label: 'zh-Hant create label',
    });
    await evaluate(E, scrollIntoView('#create-room-id'));
    await screenshot(E, '07-zh-Hant.png');
    record('07 zh-Hant custom-id strings render', true);

    // ---- 08: en create page --------------------------------------------
    const F = await newPage({ locale: 'en' });
    pages.push(F);
    await fillCreateForm(F, 'abc12', ROOM_KEY);
    await waitFor(F, `document.body.innerText.includes('Custom room id')`, {
      timeout: 5000,
      label: 'en create label',
    });
    await evaluate(F, scrollIntoView('#create-room-id'));
    await screenshot(F, '08-en.png');
    record('08 en custom-id strings render', true);
  } finally {
    for (const p of pages) {
      try {
        await p.send('Page.close');
      } catch {
        /* already closed */
      }
      p.close();
    }
  }

  console.log('\n--- browser smoke ---');
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('BROWSER SMOKE ERROR:', e);
  process.exit(2);
});
