// Lightweight i18n core — no framework, no runtime fetch.
//
// `en` is the source of truth; `zh-Hans` / `zh-Hant` mirror its keys. A missing
// key falls back to English and finally to the key itself, so a half-translated
// build still renders something readable instead of blanks.
import en from './locales/en';
import zhHans from './locales/zh-Hans';
import zhHant from './locales/zh-Hant';

export const DEFAULT_LOCALE = 'en';

/** Locales offered by the home-screen switcher, in display order. */
export const SUPPORTED_LOCALES = ['en', 'zh-Hans', 'zh-Hant'];

/** Endonyms — each language is always shown in its own script. */
export const LOCALE_LABELS = {
  en: 'English',
  'zh-Hans': '简体中文',
  'zh-Hant': '繁體中文',
};

const DICTS = {
  en,
  'zh-Hans': zhHans,
  'zh-Hant': zhHant,
};

/**
 * Map any BCP-47-ish tag onto one of `SUPPORTED_LOCALES`.
 * `zh`, `zh-CN`, `zh-Hans-CN` → `zh-Hans`; `zh-TW`, `zh-HK`, `zh-Hant` →
 * `zh-Hant`; everything unrecognised → English.
 */
export function normalizeLocale(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return DEFAULT_LOCALE;
  const lower = raw.trim().replace(/_/g, '-').toLowerCase();

  if (lower === 'en' || lower.startsWith('en-')) return 'en';
  if (lower === 'zh' || lower.startsWith('zh-')) {
    return /(hant|tw|hk|mo)/.test(lower) ? 'zh-Hant' : 'zh-Hans';
  }
  return DEFAULT_LOCALE;
}

/** Device locale if it is one of the three we ship, else `en`. */
export function detectDeviceLocale() {
  try {
    const candidates =
      Array.isArray(navigator.languages) && navigator.languages.length
        ? navigator.languages
        : [navigator.language];
    for (const candidate of candidates) {
      const lower = String(candidate || '').toLowerCase();
      if (lower.startsWith('en') || lower.startsWith('zh')) {
        return normalizeLocale(candidate);
      }
    }
  } catch {
    /* no navigator (non-browser) — fall through */
  }
  return DEFAULT_LOCALE;
}

/** Look up `key`, with `{name}` interpolation from `vars`. */
export function translate(locale, key, vars) {
  const dict = DICTS[normalizeLocale(locale)] || DICTS[DEFAULT_LOCALE];
  let template = dict[key];
  if (template === undefined) template = DICTS[DEFAULT_LOCALE][key];
  if (template === undefined) return key;
  if (!vars) return template;

  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : match
  );
}

/** The full dictionary for `locale` — used by tooling/tests. */
export const getDictionary = (locale) => DICTS[normalizeLocale(locale)];

export const DICTIONARIES = DICTS;
