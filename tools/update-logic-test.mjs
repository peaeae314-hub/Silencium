/**
 * Unit tests for the pure in-app update logic (no browser, no Capacitor).
 *
 * Covers the version compare / skip / snooze decisions, the multi-source
 * manifest URL list (dedupe + CDN cache-bust) and the `version.json` parser —
 * the parts the headless end-to-end test cannot pin down precisely.
 *
 * Run:  node tools/update-logic-test.mjs
 */
import {
  builtInManifestFallbacks,
  installedLabel,
  isNewer,
  manifestCandidateUrls,
  manifestUrlKey,
  pickChangelog,
  preferHighestVersionCode,
  shouldPrompt,
  withCacheBust,
} from '../client/src/update/updateLogic.js';
import { parseUpdateManifest } from '../client/src/update/updateManifest.js';
import {
  APP_VERSION_CODE,
  APP_VERSION_NAME,
} from '../client/src/update/appVersion.js';

const pass = [];
const fail = [];
const check = (name, ok, extra = '') =>
  (ok ? pass : fail).push(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`);

const manifest = (over = {}) => ({
  versionCode: 1,
  versionName: '1.0.0',
  apkUrl: 'https://example.com/app.apk',
  force: false,
  changelogZh: '',
  changelogEn: '',
  changelogZhHant: '',
  ...over,
});

// --- isNewer -----------------------------------------------------------
check('isNewer: 3 > 2', isNewer({ currentVersionCode: 2, remoteVersionCode: 3 }) === true);
check('isNewer: 2 vs 2 is not newer', isNewer({ currentVersionCode: 2, remoteVersionCode: 2 }) === false);
check('isNewer: 1 < 2 is not newer', isNewer({ currentVersionCode: 2, remoteVersionCode: 1 }) === false);

// --- shouldPrompt ------------------------------------------------------
check(
  'shouldPrompt: same code never prompts',
  shouldPrompt({ currentVersionCode: 2, remote: manifest({ versionCode: 2 }) }) === false
);
check(
  'shouldPrompt: newer soft version prompts',
  shouldPrompt({ currentVersionCode: 2, remote: manifest({ versionCode: 3 }) }) === true
);
check(
  'shouldPrompt: skipped version stays quiet',
  shouldPrompt({
    currentVersionCode: 2,
    remote: manifest({ versionCode: 3 }),
    ignoredVersionCode: 3,
  }) === false
);
check(
  'shouldPrompt: a newer code after a skip prompts again',
  shouldPrompt({
    currentVersionCode: 2,
    remote: manifest({ versionCode: 4 }),
    ignoredVersionCode: 3,
  }) === true
);
check(
  'shouldPrompt: force wins over a permanent skip',
  shouldPrompt({
    currentVersionCode: 2,
    remote: manifest({ versionCode: 3, force: true }),
    ignoredVersionCode: 99,
  }) === true
);
const now = 1_000_000;
check(
  'shouldPrompt: "Later" snooze suppresses the same code inside the window',
  shouldPrompt({
    currentVersionCode: 2,
    remote: manifest({ versionCode: 3 }),
    snooze: { versionCode: 3, until: now + 1 },
    now,
  }) === false
);
check(
  'shouldPrompt: an expired snooze prompts again',
  shouldPrompt({
    currentVersionCode: 2,
    remote: manifest({ versionCode: 3 }),
    snooze: { versionCode: 3, until: now - 1 },
    now,
  }) === true
);
check(
  'shouldPrompt: a code above the snoozed one prompts immediately',
  shouldPrompt({
    currentVersionCode: 2,
    remote: manifest({ versionCode: 5 }),
    snooze: { versionCode: 3, until: now + 10_000 },
    now,
  }) === true
);
check(
  'shouldPrompt: force ignores an active snooze',
  shouldPrompt({
    currentVersionCode: 2,
    remote: manifest({ versionCode: 3, force: true }),
    snooze: { versionCode: 3, until: now + 10_000 },
    now,
  }) === true
);

// --- manifest URL list -------------------------------------------------
check(
  'fallbacks are the four silencium-releases sources',
  builtInManifestFallbacks.length === 4 &&
    builtInManifestFallbacks[0].includes(
      'github.com/peaeae314-hub/silencium-releases/releases/latest/download/version.json'
    ) &&
    builtInManifestFallbacks[1].includes('cdn.jsdelivr.net/gh/peaeae314-hub/silencium-releases@main') &&
    builtInManifestFallbacks[2].includes('fastly.jsdelivr.net/gh/peaeae314-hub/silencium-releases@main') &&
    builtInManifestFallbacks[3].includes(
      'raw.githubusercontent.com/peaeae314-hub/silencium-releases/main'
    ),
  builtInManifestFallbacks.join('\n          ')
);
check(
  'fallbacks are ordered GitHub Releases → jsDelivr → fastly → raw',
  builtInManifestFallbacks.map((u) => new URL(u).host).join(',') ===
    'github.com,cdn.jsdelivr.net,fastly.jsdelivr.net,raw.githubusercontent.com'
);

const dedupedCandidates = manifestCandidateUrls({
  primary: builtInManifestFallbacks[0],
  cacheBustMs: 1234,
});
check(
  'candidate list dedupes a primary equal to the first fallback',
  dedupedCandidates.length === 4,
  `len=${dedupedCandidates.length}`
);
check(
  'candidate list keeps the primary first',
  dedupedCandidates[0].startsWith('https://github.com/peaeae314-hub/silencium-releases/releases/latest'),
  dedupedCandidates[0]
);
check(
  'CDN candidates get a cache-buster, GitHub/raw do not',
  dedupedCandidates[1].includes('t=1234') &&
    dedupedCandidates[2].includes('t=1234') &&
    !dedupedCandidates[0].includes('t=1234') &&
    !dedupedCandidates[3].includes('t=1234')
);
check(
  'cache-bust replaces an existing t= instead of duplicating it',
  withCacheBust('https://cdn.jsdelivr.net/gh/x@main/version.json?t=1', 7).includes('t=7') &&
    (withCacheBust('https://cdn.jsdelivr.net/gh/x@main/version.json?t=1', 7).match(/t=/g) || [])
      .length === 1
);
check(
  'url key ignores query and host case',
  manifestUrlKey('https://CDN.jsdelivr.net/a/b?t=9') === manifestUrlKey('https://cdn.jsdelivr.net/a/b')
);

// --- preferHighestVersionCode -----------------------------------------
const picked = preferHighestVersionCode([
  manifest({ versionCode: 3, versionName: 'from-github' }),
  manifest({ versionCode: 5, versionName: 'from-jsdelivr' }),
  manifest({ versionCode: 4 }),
]);
check('highest versionCode wins across sources', picked?.versionName === 'from-jsdelivr', picked?.versionName);
check(
  'entries with versionCode 0 or empty apkUrl are ignored',
  preferHighestVersionCode([manifest({ versionCode: 0 }), manifest({ apkUrl: '' })]) === null
);
check('empty input → null', preferHighestVersionCode([]) === null);

// --- changelog selection ----------------------------------------------
const multi = manifest({
  changelogZh: '中文',
  changelogEn: 'english',
  changelogZhHant: '繁體',
});
check('changelog: zh-Hans', pickChangelog(multi, 'zh-Hans') === '中文');
check('changelog: zh-Hant', pickChangelog(multi, 'zh-Hant') === '繁體');
check('changelog: en', pickChangelog(multi, 'en') === 'english');
check(
  'changelog: en falls back to changelogZh when changelogEn is missing',
  pickChangelog(manifest({ changelogZh: '中文' }), 'en') === '中文'
);
check(
  'changelog: zh-Hant falls back to changelogZh',
  pickChangelog(manifest({ changelogZh: '中文' }), 'zh-Hant') === '中文'
);

// --- version.json parser ----------------------------------------------
const parsed = parseUpdateManifest({
  versionCode: 7,
  versionName: '1.2.0',
  apkUrl: 'https://github.com/peaeae314-hub/silencium-releases/releases/download/v1.2.0/Silencium-debug.apk',
  force: true,
  changelogZh: '修复',
  changelogEn: 'fix',
  changelogZhHant: '修復',
});
check(
  'parser reads every field',
  parsed?.versionCode === 7 &&
    parsed.versionName === '1.2.0' &&
    parsed.force === true &&
    parsed.changelogZh === '修复' &&
    parsed.changelogEn === 'fix' &&
    parsed.changelogZhHant === '修復',
  JSON.stringify(parsed)
);
check(
  'parser coerces a string versionCode (JSON from a CDN)',
  parseUpdateManifest({ versionCode: '12', versionName: '2.0', apkUrl: 'https://a/b.apk' })
    ?.versionCode === 12
);
check(
  'parser rejects a missing/invalid apkUrl',
  parseUpdateManifest({ versionCode: 3, apkUrl: '' }) === null &&
    parseUpdateManifest({ versionCode: 3 }) === null &&
    parseUpdateManifest({ versionCode: 3, apkUrl: 'not a url' }) === null
);
check(
  'parser rejects a missing/zero versionCode',
  parseUpdateManifest({ apkUrl: 'https://a/b.apk' }) === null &&
    parseUpdateManifest({ versionCode: 0, apkUrl: 'https://a/b.apk' }) === null
);
check('parser rejects non-objects', parseUpdateManifest(null) === null && parseUpdateManifest('x') === null);
check(
  'parser defaults force/changelogs safely',
  JSON.stringify(parseUpdateManifest({ versionCode: 1, apkUrl: 'https://a/b.apk' })) ===
    JSON.stringify({
      versionCode: 1,
      versionName: '',
      apkUrl: 'https://a/b.apk',
      force: false,
      changelogZh: '',
      changelogEn: '',
      changelogZhHant: '',
    })
);

// --- installed label / baked build version ----------------------------
check('installedLabel formats name + code', installedLabel({ versionName: '1.1.0', versionCode: 2 }) === '1.1.0 (2)');
check('installedLabel is empty without a code', installedLabel(null) === '');
check(
  'appVersion.js was generated with a sane code/name',
  Number.isInteger(APP_VERSION_CODE) &&
    APP_VERSION_CODE > 0 &&
    /^\d+(\.\d+)*$/.test(APP_VERSION_NAME),
  `${APP_VERSION_NAME} (${APP_VERSION_CODE})`
);

// --- optional: parse the live manifests (UPDATE_LIVE=1) ---------------
if (process.env.UPDATE_LIVE === '1') {
  const urls = builtInManifestFallbacks;
  const seen = [];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const body = await res.text();
      const m = parseUpdateManifest(JSON.parse(body));
      seen.push({ url, status: res.status, code: m?.versionCode ?? null });
      check(
        `live manifest parses: ${new URL(url).host}${new URL(url).pathname.slice(0, 24)}…`,
        !!m,
        `status=${res.status} versionCode=${m?.versionCode}`
      );
    } catch (e) {
      check(`live manifest reachable: ${url}`, false, e.message);
    }
  }
  const best = preferHighestVersionCode(
    seen.filter((s) => s.code).map((s) => manifest({ versionCode: s.code }))
  );
  check('live sources agree on a highest versionCode', !!best, JSON.stringify(seen));
}

console.log('\n--- Silencium update logic tests ---');
console.log([...pass, ...fail].join('\n'));
console.log(`\n${pass.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
