// Context + hook live apart from the provider component so react-refresh keeps
// working (a file that exports both a component and a hook cannot hot-reload).
import { createContext, useContext } from 'react';

export const I18nContext = createContext(null);

/** `{ locale, setLocale, t, locales }` for the nearest `<I18nProvider>`. */
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n() must be used inside <I18nProvider>');
  }
  return ctx;
}
