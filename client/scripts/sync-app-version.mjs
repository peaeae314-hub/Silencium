#!/usr/bin/env node
/**
 * Regenerate `client/src/update/appVersion.js` from the Android Gradle config.
 *
 * `android/app/build.gradle` is the single source of truth for the shipped
 * versionCode / versionName (the APK manifest is built from it). Baking the
 * same numbers into the web bundle gives the update check a reliable
 * "installed build" fallback for every platform, including when the
 * `@capacitor/app` plugin cannot report it.
 *
 * Runs automatically via the `prebuild` npm script; can also be run by hand:
 *   node scripts/sync-app-version.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const gradlePath = path.resolve(here, '../android/app/build.gradle');
const outPath = path.resolve(here, '../src/update/appVersion.js');

const gradle = readFileSync(gradlePath, 'utf8');

const codeMatch = /(^|\n)\s*versionCode\s+(\d+)/.exec(gradle);
const nameMatch = /(^|\n)\s*versionName\s+["']([^"']+)["']/.exec(gradle);

if (!codeMatch || !nameMatch) {
  console.error(
    `sync-app-version: could not read versionCode/versionName from ${gradlePath}`
  );
  process.exit(1);
}

const versionCode = Number.parseInt(codeMatch[2], 10);
const versionName = nameMatch[2];

const contents = `// GENERATED FILE — do not edit by hand.
// Run \`npm run version:sync\` (also part of \`npm run build\`) to refresh it
// from client/android/app/build.gradle, which is the source of truth for the
// versionCode/versionName baked into the Android APK.
export const APP_VERSION_CODE = ${versionCode};
export const APP_VERSION_NAME = ${JSON.stringify(versionName)};
`;

writeFileSync(outPath, contents, 'utf8');
console.log(
  `sync-app-version: wrote appVersion.js (versionName ${versionName}, versionCode ${versionCode})`
);
