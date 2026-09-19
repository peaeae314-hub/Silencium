import React, { useEffect, useState } from 'react';
import { useI18n } from '../i18n/context';
import { pickChangelog } from './updateLogic';
import { exitApp, isAndroidApp, openApkUrl } from './updateService';

/**
 * Rounded, themed update prompt — the React counterpart of pokemon-handbook's
 * `UpdatePromptDialog`.
 *
 * - soft update: **Update** / **Later** / **Skip this version**
 * - `force: true`: **Update** (plus **Exit** on Android); not dismissible
 * - every string comes from the i18n dictionaries (en / zh-Hans / zh-Hant)
 */
export default function UpdatePromptDialog({
  manifest,
  installed,
  onLater,
  onSkip,
  onDismiss,
}) {
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const force = manifest.force === true;
  const changelog = pickChangelog(manifest, locale);
  const onAndroid = isAndroidApp();

  // Esc dismisses a soft prompt only; a forced update must be acted on.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !force && !busy) onLater();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [force, busy, onLater]);

  const handleUpdate = async () => {
    setBusy(true);
    setError(null);
    const opened = await openApkUrl(manifest.apkUrl);
    setBusy(false);
    if (!opened) {
      setError(t('update.openFailed', { url: manifest.apkUrl }));
      return;
    }
    // Soft prompt closes once the browser/download is handed off; forced stays
    // so the user can retry or leave.
    if (!force) onDismiss();
  };

  const handleExit = async () => {
    const exited = await exitApp();
    if (!exited) setError(t('update.exitFailed'));
  };

  return (
    <div
      className="update-overlay"
      data-testid="update-dialog"
      onClick={force ? undefined : onLater}
    >
      <div
        className="update-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="update-dialog-title" className="update-title">
          {force ? t('update.forceTitle') : t('update.title')}
        </h2>

        <p className="update-version">
          {t('update.newVersion', {
            version: manifest.versionName || String(manifest.versionCode),
            code: manifest.versionCode,
          })}
        </p>
        <p className="update-current">
          {t('update.installedVersion', {
            version: installed?.versionName || '—',
            code: installed?.versionCode ?? '—',
          })}
        </p>

        {force && <p className="update-force">{t('update.forceCopy')}</p>}

        {changelog && (
          <>
            <h3 className="update-subtitle">{t('update.changelog')}</h3>
            <p className="update-changelog">{changelog}</p>
          </>
        )}

        {!onAndroid && <p className="update-note">{t('update.webNote')}</p>}

        {error && <p className="update-error">{error}</p>}

        <div className="update-actions">
          {force ? (
            onAndroid && (
              <button
                type="button"
                className="update-secondary"
                onClick={handleExit}
                disabled={busy}
              >
                {t('update.exit')}
              </button>
            )
          ) : (
            <>
              <button
                type="button"
                className="update-secondary update-skip"
                data-testid="update-skip"
                onClick={onSkip}
                disabled={busy}
              >
                {t('update.skip')}
              </button>
              <button
                type="button"
                className="update-secondary"
                data-testid="update-later"
                onClick={onLater}
                disabled={busy}
              >
                {t('update.later')}
              </button>
            </>
          )}
          <button
            type="button"
            className="update-primary"
            data-testid="update-update"
            onClick={handleUpdate}
            disabled={busy}
          >
            {busy ? t('update.opening') : t('update.updateNow')}
          </button>
        </div>
      </div>
    </div>
  );
}
