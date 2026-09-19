import React from 'react';
import { useI18n } from '../i18n/context';

/**
 * Compact segmented control: English / 简体中文 / 繁體中文.
 * Each option is always labelled in its own script (endonym), so it stays
 * legible no matter which language is currently active.
 */
export default function LanguageSwitcher({ className = '' }) {
  const { locale, setLocale, locales, t } = useI18n();

  return (
    <div
      className={`lang-switch ${className}`.trim()}
      role="group"
      aria-label={t('home.languageLabel')}
    >
      {locales.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          className={`lang-option${code === locale ? ' is-active' : ''}`}
          aria-pressed={code === locale}
          title={t(`language.${code}`)}
          onClick={() => setLocale(code)}
        >
          {t(`language.${code}`)}
        </button>
      ))}
    </div>
  );
}
