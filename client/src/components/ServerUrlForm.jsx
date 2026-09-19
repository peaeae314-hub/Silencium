import React, { useState } from 'react';
import {
  getSavedServerUrl,
  saveServerUrl,
  clearServerUrl,
  normalizeBaseUrl,
  browserDefaultUrl,
  isNativeApp,
} from '../utils/serverUrl';
import { useI18n } from '../i18n/context';
import { renderWithCode } from '../i18n/richText';

const HEALTH_TIMEOUT_MS = 8000;

/**
 * Shared relay-URL editor. Used full-screen for first launch on native and from
 * the `/settings` route afterwards.
 */
export default function ServerUrlForm({
  onSaved,
  onCancel,
  showCancel = false,
  showReset = false,
}) {
  const { t } = useI18n();
  const [value, setValue] = useState(getSavedServerUrl() || '');
  // Validation errors are stored as i18n keys so they follow language switches.
  const [errorKey, setErrorKey] = useState('');
  const [testResult, setTestResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const result = normalizeBaseUrl(value);
    if (result.error) {
      setErrorKey(result.errorKey);
      setTestResult(null);
      return;
    }

    setBusy(true);
    try {
      const saved = await saveServerUrl(result.url);
      if (saved.error) {
        setErrorKey(saved.errorKey);
        return;
      }
      setErrorKey('');
      onSaved?.(saved.url);
    } catch {
      setErrorKey('settings.errorSave');
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    const result = normalizeBaseUrl(value);
    if (result.error) {
      setErrorKey(result.errorKey);
      setTestResult(null);
      return;
    }

    setErrorKey('');
    setTesting(true);
    setTestResult(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const response = await fetch(`${result.url}/health`, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json().catch(() => ({}));
      setTestResult({
        ok: true,
        key: 'settings.reachable',
        vars: { status: body.status || 'ok' },
      });
    } catch (err) {
      const reasonKey =
        err?.name === 'AbortError'
          ? 'settings.reasonTimeout'
          : 'settings.reasonUnreachable';
      setTestResult({
        ok: false,
        key: 'settings.unreachable',
        vars: { url: result.url, reason: t(reasonKey) },
      });
    } finally {
      clearTimeout(timer);
      setTesting(false);
    }
  };

  const handleReset = async () => {
    await clearServerUrl();
    // Re-run the boot resolution (native with no URL returns to first-launch).
    window.location.reload();
  };

  return (
    <form className="server-form" noValidate onSubmit={handleSubmit}>
      <label className="server-label" htmlFor="server-url">
        {t('settings.relayLabel')}
      </label>
      <input
        id="server-url"
        className="server-input"
        type="url"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setErrorKey('');
          setTestResult(null);
        }}
        placeholder={t('settings.placeholder')}
      />
      <p className="server-hint">{renderWithCode(t('settings.hint'))}</p>

      {errorKey && <p className="server-error">⚠ {t(errorKey)}</p>}
      {testResult && (
        <p className={testResult.ok ? 'server-ok' : 'server-error'}>
          {testResult.ok ? '✓' : '✕'} {t(testResult.key, testResult.vars)}
        </p>
      )}

      <div className="server-actions">
        <button type="submit" disabled={busy || testing}>
          {busy ? t('settings.saving') : t('settings.save')}
        </button>
        <button type="button" onClick={handleTest} disabled={testing || busy}>
          {testing ? t('settings.testing') : t('settings.testConnection')}
        </button>
        {showCancel && (
          <button type="button" onClick={onCancel}>
            {t('settings.cancel')}
          </button>
        )}
        {showReset && (
          <button type="button" className="server-reset" onClick={handleReset}>
            {isNativeApp()
              ? t('settings.clear')
              : t('settings.useDefault', { url: browserDefaultUrl() })}
          </button>
        )}
      </div>
    </form>
  );
}
