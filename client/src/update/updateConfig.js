// In-app update configuration (see MOBILE-ANDROID.md § 应用内更新).
//
// The manifest URL follows the same self-hosted HTTPS scheme as
// pokemon-handbook: a `version.json` next to the APK in the release repo.
// `VITE_UPDATE_MANIFEST_URL` overrides the primary source at build time
// (handy for staging, or for exercising the flow against a local manifest).
import { builtInManifestFallbacks } from './updateLogic';

/** GitHub Releases primary source — authoritative, refreshed on every publish. */
export const DEFAULT_MANIFEST_URL =
  'https://github.com/peaeae314-hub/silencium-releases/releases/latest/download/version.json';

/** Build-time override (`npm run build` with `VITE_UPDATE_MANIFEST_URL=…`). */
export const ENV_MANIFEST_URL =
  typeof import.meta.env?.VITE_UPDATE_MANIFEST_URL === 'string'
    ? import.meta.env.VITE_UPDATE_MANIFEST_URL.trim()
    : '';

/** Primary manifest URL (env override wins). */
export const UPDATE_MANIFEST_URL = ENV_MANIFEST_URL || DEFAULT_MANIFEST_URL;

/** Ordered fallbacks, tried after the primary URL. */
export const UPDATE_MANIFEST_FALLBACKS = builtInManifestFallbacks;

/** Where to send users when every manifest source fails. */
export const RELEASES_PAGE_URL =
  'https://github.com/peaeae314-hub/silencium-releases/releases/latest';

/** Socket timeouts for the manifest GET (ms). */
export const MANIFEST_CONNECT_TIMEOUT_MS = 10000;
export const MANIFEST_READ_TIMEOUT_MS = 15000;
