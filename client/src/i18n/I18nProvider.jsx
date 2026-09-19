import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { I18nContext } from './context';
import { saveLocale } from './locale';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  normalizeLocale,
  translate,
} from './translations';

/**
 * Holds the active locale for the whole app. `initialLocale` comes from
 * `initLocale()` during boot, so the first paint is already in the right
 * language (no flash of English on a Chinese device).
 */
export default function I18nProvider({
  initialLocale = DEFAULT_LOCALE,
  children,
}) {
  const [locale, setLocaleState] = useState(() => normalizeLocale(initialLocale));

  useEffect(() => {
    try {
      document.documentElement.lang = locale;
    } catch {
      /* no DOM (tests) */
    }
  }, [locale]);

  const setLocale = useCallback((next) => {
    const value = normalizeLocale(next);
    setLocaleState(value);
    // Fire-and-forget: the UI switches immediately, storage catches up.
    saveLocale(value);
  }, []);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      locales: SUPPORTED_LOCALES,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, setLocale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
