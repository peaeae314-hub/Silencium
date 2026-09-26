/**
 * Headless end-to-end test for the in-app update flow.
 *
 * Serves the *real built* SPA (with `VITE_UPDATE_MANIFEST_URL` pointed at this
 * test server) and drives it in headless Chrome over raw CDP:
 *
 *   1. launch check finds a newer manifest → soft dialog (en)
 *   2. "Later" snoozes the versionCode (no dialog on the next cold start)
 *   3. "Skip this version" persists → no dialog until a *newer* code appears
 *   4. force:true → "Update required", no Later/Skip, Update hands the apkUrl
 *      to the browser (window.open) and the dialog stays put
 *   5. remote == installed → no dialog; Settings → Check for updates says
 *      "latest version"
 *   6. zh-Hans / zh-Hant dialog copy + changelog
 *   7. primary source down → the CDN fallbacks carry the check
 *   8. every source blocked → the distinct "could not check" message
 *
 * Build first (the env override is what enables the silent launch check on web):
 *   cd client && VITE_UPDATE_MANIFEST_URL=http://127.0.0.1:3210/__test/version.json npm run build
 * Then:
 *   node tools/update-e2e-test.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// The installed version is whatever `npm run build` baked into the bundle;
// derive the expected label instead of hardcoding an old release number.
import { APP_VERSION_NAME, APP_VERSION_CODE } from '../client/src/update/appVersion.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALLED_LABEL = `${APP_VERSION_NAME} (${APP_VERSION_CODE})`;
const DIST = path.join(ROOT, 'client', 'dist');
const PORT = Number(process.env.E2E_PORT || 3210);
const CDP_PORT = Number(process.env.E2E_CDP_PORT || 9222);
const MANIFEST_PATH = '/__test/version.json';
const APP_URL = `http://127.0.0.1:${PORT}/`;
const MANIFEST_URL = `http://127.0.0.1:${PORT}${MANIFEST_PATH}`;
const APK_URL = `http://127.0.0.1:${PORT}/__test/app.apk`;

const pass = [];
const fail = [];
const check = (name, ok, extra = '') => {
  (ok ? pass : fail).push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);
  if (!ok) console.log(`FAIL  ${name}${extra ? ' :: ' + extra : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- test manifest state (swapped between phases) -----------------------
const state = {
  manifest: {
    versionCode: 999,
    versionName: '9.9.9',
    apkUrl: APK_URL,
    force: false,
    changelogEn: 'E2E english changelog',
    changelogZh: 'E2E 中文更新说明',
    changelogZhHant: 'E2E 繁體更新說明',
  },
  broken: false,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.worker-': 'text/javascript',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

    if (url.pathname === MANIFEST_PATH) {
      if (state.broken) {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('boom');
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      });
      res.end(JSON.stringify(state.manifest));
      return;
    }
    if (url.pathname === '/__test/app.apk') {
      res.writeHead(200, { 'content-type': 'application/vnd.android.package-archive' });
      res.end('not-a-real-apk');
      return;
    }

    // Static SPA + history fallback (mirrors server/app.js in production).
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    let file = path.join(DIST, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DIST, 'index.html');
    }
    const ext = path.extname(file);
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

// --- minimal CDP client (Node 22 has a global WebSocket) ----------------
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.waiters = [];
    ws.addEventListener('message', (event) => this._onMessage(String(event.data)));
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error(`cannot connect to ${wsUrl}`)), {
        once: true,
      });
    });
    return new CDP(ws);
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
      else resolve(msg.result);
      return;
    }
    if (msg.method) {
      this.waiters = this.waiters.filter((w) => {
        if (w.method !== msg.method) return true;
        w.resolve(msg.params);
        return false;
      });
    }
  }

  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), timeoutMs);
      this.waiters.push({
        method,
        resolve: (params) => {
          clearTimeout(timer);
          resolve(params);
        },
      });
    });
  }

  async eval(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'evaluate failed');
    }
    return result.result.value;
  }

  async waitFor(expression, { timeoutMs = 15000, intervalMs = 150 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      let value = false;
      try {
        value = await this.eval(expression);
      } catch {
        value = false;
      }
      if (value) return true;
      if (Date.now() > deadline) return false;
      await sleep(intervalMs);
    }
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function launchChrome() {
  const profile = fs.mkdtempSync('/tmp/silencium-e2e-');
  const child = spawn(
    'google-chrome',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--disable-extensions',
      '--disable-background-networking',
      '--window-size=420,900',
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${CDP_PORT}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  child.stderr.on('data', () => {});
  child.stdout.on('data', () => {});

  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) return { child, profile, version: await res.json() };
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error('headless Chrome did not expose CDP in time');
    await sleep(250);
  }
}

async function newPageTarget() {
  // Chrome ≥ 111 requires PUT for /json/new.
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?about:blank`, { method: 'PUT' });
  if (!res.ok) throw new Error(`/json/new failed: ${res.status}`);
  return res.json();
}

/** Open the app fresh, optionally seeding storage first. */
async function openApp(cdp, { locale = 'en', clearUpdatePrefs = true, path: route = '/' } = {}) {
  // Land on the origin once so we can touch localStorage, then reload clean.
  await cdp.send('Page.navigate', { url: APP_URL });
  await cdp.waitFor(`!!document.getElementById('root')`, { timeoutMs: 15000 });

  await cdp.eval(
    seedStorage
      .replace('{LOCALE}', JSON.stringify(locale))
      .replace('{APP_ORIGIN}', JSON.stringify(APP_URL.replace(/\/$/, '')))
      .replace(
        '{CLEAR_PREFS}',
        clearUpdatePrefs
          ? UPDATE_PREF_KEYS.map((k) => `drop('${k}');`).join(' ')
          : ''
      )
  );

  await cdp.send('Page.navigate', { url: `${APP_URL.replace(/\/$/, '')}${route}` });
  await cdp.waitFor(`!!document.getElementById('root')`, { timeoutMs: 15000 });
}

const DIALOG = `document.querySelector('[data-testid="update-dialog"]')`;
const dialogText = `(${DIALOG}?.innerText || '')`;
const hasButton = (id) => `!!document.querySelector('[data-testid="update-${id}"]')`;
const clickButton = (id) =>
  `(() => { const b = document.querySelector('[data-testid="update-${id}"]'); if (!b) return false; b.click(); return true; })()`;

// Capacitor Preferences (web) stores under a `CapacitorStorage.` prefix and
// `utils/*` mirrors every write to the plain key as well, so touch both.
const PREF_PREFIX = 'CapacitorStorage.';
const UPDATE_PREF_KEYS = ['silencium.update-ignored-version-code', 'silencium.update-snooze'];
const readPref = (key) =>
  `(window.localStorage.getItem(${JSON.stringify(key)}) || window.localStorage.getItem(${JSON.stringify(
    PREF_PREFIX + key
  )}))`;
const seedStorage = `(() => {
  const ls = window.localStorage;
  const dual = (k, v) => { ls.setItem(k, v); ls.setItem(${JSON.stringify(PREF_PREFIX)} + k, v); };
  const drop = (k) => { ls.removeItem(k); ls.removeItem(${JSON.stringify(PREF_PREFIX)} + k); };
  dual('silencium.locale', {LOCALE});
  dual('silencium.server-url', {APP_ORIGIN});
  {CLEAR_PREFS}
  return true;
})()`;

(async () => {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('client/dist is missing — build the client first.');
    process.exit(2);
  }

  const builtBundle = fs
    .readdirSync(path.join(DIST, 'assets'))
    .filter((f) => f.startsWith('index-') && f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(DIST, 'assets', f), 'utf8'))
    .join('\n');
  if (!builtBundle.includes(MANIFEST_URL)) {
    console.error(
      [
        'client/dist was not built for this test — the silent launch check only',
        'runs on web when a manifest URL is configured explicitly.',
        '',
        'Build it first, then re-run:',
        `  cd client && VITE_UPDATE_MANIFEST_URL="${MANIFEST_URL}" npm run build`,
        '  node tools/update-e2e-test.mjs',
        '',
        'Rebuild without the env var afterwards so the APK keeps the default',
        'GitHub Releases manifest URL.',
      ].join('\n')
    );
    process.exit(2);
  }
  check('test build points the manifest at the local test server', true, MANIFEST_URL);

  const server = await startServer();
  const chrome = await launchChrome();
  let cdp;
  try {
    const target = await newPageTarget();
    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    // ---- 1. soft launch prompt (en) ----------------------------------
    state.manifest = {
      versionCode: 999,
      versionName: '9.9.9',
      apkUrl: APK_URL,
      force: false,
      changelogEn: 'E2E english changelog',
      changelogZh: 'E2E 中文更新说明',
      changelogZhHant: 'E2E 繁體更新說明',
    };
    state.broken = false;
    await openApp(cdp, { locale: 'en' });
    const shown = await cdp.waitFor(`!!${DIALOG}`, { timeoutMs: 20000 });
    check('launch check shows the update dialog on web (env-configured manifest)', shown);
    if (shown) {
      const text = await cdp.eval(dialogText);
      check('dialog shows the remote versionName + versionCode', text.includes('9.9.9') && text.includes('999'), text);
      check('dialog shows the installed version', text.includes(APP_VERSION_NAME) && text.includes(`(${APP_VERSION_CODE})`), text);
      check('dialog shows the English changelog', text.includes('E2E english changelog'));
      check('dialog title is translated (en)', text.includes('Update available'));
      check('dialog offers Update / Later / Skip', (await cdp.eval(hasButton('update'))) && (await cdp.eval(hasButton('later'))) && (await cdp.eval(hasButton('skip'))));
      check('web gets the sideload note', await cdp.eval(`!!document.querySelector('.update-note')`));

      // ---- 2. Later → snoozed ---------------------------------------
      await cdp.eval(clickButton('later'));
      check('Later closes the dialog', (await cdp.waitFor(`!${DIALOG}`, { timeoutMs: 4000 })) === true);
      const snooze = await cdp.eval(readPref('silencium.update-snooze'));
      let snoozeOk = false;
      try {
        const parsed = JSON.parse(snooze);
        snoozeOk = parsed.versionCode === 999 && parsed.until > Date.now();
      } catch {
        snoozeOk = false;
      }
      check('Later persists a snooze for that versionCode', snoozeOk, String(snooze));

      await cdp.send('Page.reload');
      await cdp.waitFor(`!!document.getElementById('root')`, { timeoutMs: 15000 });
      await sleep(2500);
      check('snoozed code does not prompt on the next cold start', !(await cdp.eval(`!!${DIALOG}`)));

      // ---- 3. Skip → persisted --------------------------------------
      await cdp.eval(
        UPDATE_PREF_KEYS.map(
          (k) =>
            `(window.localStorage.removeItem('${k}'), window.localStorage.removeItem('${PREF_PREFIX}${k}'))`
        ).join(', ')
      );
      await cdp.send('Page.reload');
      await cdp.waitFor(`!!document.getElementById('root')`, { timeoutMs: 15000 });
      check('dialog returns after the snooze is cleared', await cdp.waitFor(`!!${DIALOG}`, { timeoutMs: 20000 }));
      await cdp.eval(clickButton('skip'));
      check('Skip closes the dialog', (await cdp.waitFor(`!${DIALOG}`, { timeoutMs: 4000 })) === true);
      const ignored = await cdp.eval(readPref('silencium.update-ignored-version-code'));
      check('Skip persists the ignored versionCode', ignored === '999', String(ignored));

      await cdp.send('Page.reload');
      await cdp.waitFor(`!!document.getElementById('root')`, { timeoutMs: 15000 });
      await sleep(2500);
      check('skipped version does not prompt again', !(await cdp.eval(`!!${DIALOG}`)));

      // ---- 4. a newer code beats the skip ---------------------------
      state.manifest = { ...state.manifest, versionCode: 1200, versionName: '9.9.10' };
      await cdp.send('Page.reload');
      await cdp.waitFor(`!!document.getElementById('root')`, { timeoutMs: 15000 });
      check('a newer versionCode prompts again after a skip', await cdp.waitFor(`!!${DIALOG}`, { timeoutMs: 20000 }));
    }

    // ---- 5. forced update ------------------------------------------
    state.manifest = {
      versionCode: 1000,
      versionName: '9.9.9',
      apkUrl: APK_URL,
      force: true,
      changelogZh: 'E2E 强制更新',
      changelogEn: 'E2E forced changelog',
    };
    await openApp(cdp, { locale: 'en' });
    check('forced manifest shows the dialog', await cdp.waitFor(`!!${DIALOG}`, { timeoutMs: 20000 }));
    const forceText = await cdp.eval(dialogText);
    check('forced dialog uses the "required" title', forceText.includes('Update required'), forceText);
    check('forced dialog drops Later and Skip', !(await cdp.eval(hasButton('later'))) && !(await cdp.eval(hasButton('skip'))));
    check('forced dialog keeps Update', await cdp.eval(hasButton('update')));

    // Stub window.open, then click Update: the apkUrl must be handed off.
    await cdp.eval(`(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; return true; })()`);
    await cdp.eval(clickButton('update'));
    await sleep(800);
    const opened = await cdp.eval(`JSON.stringify(window.__opened || [])`);
    check('Update hands the apkUrl to the system browser', opened.includes(APK_URL), opened);
    check('forced dialog is not dismissed by Update', await cdp.eval(`!!${DIALOG}`));

    // Esc / backdrop must not close a forced prompt either.
    await cdp.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await sleep(300);
    check('forced dialog cannot be escaped', await cdp.eval(`!!${DIALOG}`));

    // ---- 6. up to date: no prompt, manual check says latest --------
    state.manifest = { versionCode: 1, versionName: '1.0.0', apkUrl: APK_URL, force: false };
    await openApp(cdp, { locale: 'en', path: '/settings' });
    await cdp.waitFor(`!!document.querySelector('[data-testid="update-section"]')`, { timeoutMs: 15000 });
    await sleep(2000);
    check('remote == installed → no launch prompt', !(await cdp.eval(`!!${DIALOG}`)));
    check('Settings shows the installed version', (await cdp.eval(`document.querySelector('.update-installed')?.innerText || ''`)).includes(INSTALLED_LABEL));
    check('web build gets the "sideload only" note in Settings', await cdp.eval(`!!document.querySelector('[data-testid="update-web-note"]')`));
    await cdp.eval(`document.querySelector('[data-testid="update-check"]').click()`);
    const resultShown = await cdp.waitFor(
      `(document.querySelector('[data-testid="update-result"]')?.innerText || '').length > 0`,
      { timeoutMs: 20000 }
    );
    const resultText = await cdp.eval(`document.querySelector('[data-testid="update-result"]')?.innerText || ''`);
    check('manual check reports "latest version"', resultShown && resultText.includes('latest version'), resultText);
    check('no dialog when already up to date', !(await cdp.eval(`!!${DIALOG}`)));

    // ---- 7. zh-Hans / zh-Hant dialog copy --------------------------
    state.manifest = {
      versionCode: 999,
      versionName: '9.9.9',
      apkUrl: APK_URL,
      force: false,
      changelogEn: 'E2E english changelog',
      changelogZh: 'E2E 中文更新说明',
      changelogZhHant: 'E2E 繁體更新說明',
    };
    await openApp(cdp, { locale: 'zh-Hans' });
    check('zh-Hans: dialog appears', await cdp.waitFor(`!!${DIALOG}`, { timeoutMs: 20000 }));
    const hans = await cdp.eval(dialogText);
    check('zh-Hans: translated title', hans.includes('发现新版本'), hans);
    check('zh-Hans: translated buttons + zh changelog', hans.includes('稍后') && hans.includes('忽略此版本') && hans.includes('立即更新') && hans.includes('E2E 中文更新说明'));
    check('zh-Hans: installed version line', hans.includes('当前版本'));
    check('zh-Hans: web sideload note translated', hans.includes('侧载'));

    await openApp(cdp, { locale: 'zh-Hant' });
    check('zh-Hant: dialog appears', await cdp.waitFor(`!!${DIALOG}`, { timeoutMs: 20000 }));
    const hant = await cdp.eval(dialogText);
    check('zh-Hant: translated title', hant.includes('發現新版本'), hant);
    check('zh-Hant: translated buttons + zh-Hant changelog', hant.includes('稍後') && hant.includes('忽略此版本') && hant.includes('立即更新') && hant.includes('E2E 繁體更新說明'));

    // ---- 8. multi-source fallback ---------------------------------
    // Primary source down (500) → jsDelivr / fastly / raw still carry the
    // check (they serve versionCode 1, so the result is "up to date").
    state.broken = true;
    await openApp(cdp, { locale: 'en', path: '/settings' });
    await cdp.waitFor(`!!document.querySelector('[data-testid="update-check"]')`, { timeoutMs: 15000 });
    await sleep(1500);
    check('primary source down → no bogus prompt', !(await cdp.eval(`!!${DIALOG}`)));
    await cdp.eval(`document.querySelector('[data-testid="update-check"]').click()`);
    const fallbackShown = await cdp.waitFor(
      `(document.querySelector('[data-testid="update-result"]')?.innerText || '').length > 0`,
      { timeoutMs: 30000 }
    );
    const fallbackText = await cdp.eval(`document.querySelector('[data-testid="update-result"]')?.innerText || ''`);
    check(
      'CDN fallbacks carry the check when the primary URL fails',
      fallbackShown && fallbackText.includes('latest version'),
      fallbackText
    );

    // ---- 9. every source blocked → distinct failure message -------
    await cdp.send('Network.setBlockedURLs', { urls: ['*version.json*'] });
    await cdp.eval(`document.querySelector('[data-testid="update-check"]').click()`);
    // React owns the result node — wait for the text to *change* to the
    // failure copy instead of poking the DOM ourselves.
    const failShown = await cdp.waitFor(
      `(document.querySelector('[data-testid="update-result"]')?.innerText || '').includes('Could not check')`,
      { timeoutMs: 30000 }
    );
    const failText = await cdp.eval(`document.querySelector('[data-testid="update-result"]')?.innerText || ''`);
    check(
      'all sources blocked → "could not check" (not "up to date")',
      failShown,
      failText
    );
    await cdp.send('Network.setBlockedURLs', { urls: [] });
  } finally {
    cdp?.close();
    chrome.child.kill('SIGKILL');
    server.close();
    try {
      fs.rmSync(chrome.profile, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }

  console.log('\n--- Silencium update e2e (headless Chrome) ---');
  console.log([...pass, ...fail].join('\n'));
  console.log(`\n${pass.length} passed, ${fail.length} failed`);
  process.exit(fail.length ? 1 : 0);
})().catch((e) => {
  console.error('E2E ERROR:', e);
  process.exit(2);
});
