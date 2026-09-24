import React, { useState } from 'react';
import {
  getSavedIceJson,
  getSavedTurnUrls,
  getSavedTurnUsername,
  getSavedTurnCredential,
  saveIceServersJson,
  saveTurnOverride,
  clearIceOverrides,
  OPEN_RELAY_DEMO,
} from '../webrtc/iceServers';
import { useI18n } from '../i18n/context';
import { renderWithCode } from '../i18n/richText';

/**
 * Optional TURN / ICE override editor for Settings.
 * Clears back to the built-in Open Relay demo defaults.
 */
export default function IceConfigForm() {
  const { t } = useI18n();
  const [turnUrls, setTurnUrls] = useState(getSavedTurnUrls() || '');
  const [turnUser, setTurnUser] = useState(getSavedTurnUsername() || '');
  const [turnCred, setTurnCred] = useState(getSavedTurnCredential() || '');
  const [iceJson, setIceJson] = useState(getSavedIceJson() || '');
  const [mode, setMode] = useState(getSavedIceJson() ? 'json' : 'turn');
  const [errorKey, setErrorKey] = useState('');
  const [okKey, setOkKey] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSaveTurn = async (event) => {
    event.preventDefault();
    setBusy(true);
    setOkKey('');
    try {
      const result = await saveTurnOverride({
        urls: turnUrls,
        username: turnUser,
        credential: turnCred,
      });
      if (result.error) {
        setErrorKey(result.errorKey || 'settings.errorSave');
        return;
      }
      setErrorKey('');
      setIceJson('');
      setMode('turn');
      setOkKey('settings.iceSaved');
    } catch {
      setErrorKey('settings.errorSave');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveJson = async (event) => {
    event.preventDefault();
    setBusy(true);
    setOkKey('');
    try {
      const result = await saveIceServersJson(iceJson);
      if (result.error) {
        setErrorKey(result.errorKey || 'settings.errorSave');
        return;
      }
      setErrorKey('');
      setTurnUrls('');
      setTurnUser('');
      setTurnCred('');
      setMode('json');
      setOkKey('settings.iceSaved');
    } catch {
      setErrorKey('settings.errorSave');
    } finally {
      setBusy(false);
    }
  };

  const handleClear = async () => {
    setBusy(true);
    setOkKey('');
    try {
      await clearIceOverrides();
      setTurnUrls('');
      setTurnUser('');
      setTurnCred('');
      setIceJson('');
      setErrorKey('');
      setOkKey('settings.iceCleared');
    } catch {
      setErrorKey('settings.errorSave');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ice-section" data-testid="ice-section">
      <h2 className="update-heading">{t('settings.iceTitle')}</h2>
      <p className="settings-copy">{renderWithCode(t('settings.iceCopy'))}</p>
      <p className="server-hint">{renderWithCode(t('settings.iceDefaultHint', { user: OPEN_RELAY_DEMO.username }))}</p>

      <div className="server-actions ice-mode-row">
        <button
          type="button"
          className={mode === 'turn' ? 'ice-mode-active' : undefined}
          onClick={() => setMode('turn')}
          disabled={busy}
        >
          {t('settings.iceModeTurn')}
        </button>
        <button
          type="button"
          className={mode === 'json' ? 'ice-mode-active' : undefined}
          onClick={() => setMode('json')}
          disabled={busy}
        >
          {t('settings.iceModeJson')}
        </button>
      </div>

      {mode === 'turn' ? (
        <form className="server-form" noValidate onSubmit={handleSaveTurn}>
          <label className="server-label" htmlFor="turn-urls">
            {t('settings.turnUrlsLabel')}
          </label>
          <textarea
            id="turn-urls"
            className="server-input ice-textarea"
            rows={3}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            value={turnUrls}
            onChange={(e) => {
              setTurnUrls(e.target.value);
              setErrorKey('');
              setOkKey('');
            }}
            placeholder={t('settings.turnUrlsPlaceholder')}
          />
          <label className="server-label" htmlFor="turn-user">
            {t('settings.turnUsernameLabel')}
          </label>
          <input
            id="turn-user"
            className="server-input"
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={turnUser}
            onChange={(e) => {
              setTurnUser(e.target.value);
              setErrorKey('');
              setOkKey('');
            }}
            placeholder={t('settings.turnUsernamePlaceholder')}
          />
          <label className="server-label" htmlFor="turn-cred">
            {t('settings.turnCredentialLabel')}
          </label>
          <input
            id="turn-cred"
            className="server-input"
            type="password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={turnCred}
            onChange={(e) => {
              setTurnCred(e.target.value);
              setErrorKey('');
              setOkKey('');
            }}
            placeholder={t('settings.turnCredentialPlaceholder')}
          />
          <p className="server-hint">{renderWithCode(t('settings.turnHint'))}</p>
          <div className="server-actions">
            <button type="submit" disabled={busy}>
              {busy ? t('settings.saving') : t('settings.saveTurn')}
            </button>
            <button type="button" className="server-reset" onClick={handleClear} disabled={busy}>
              {t('settings.clearIce')}
            </button>
          </div>
        </form>
      ) : (
        <form className="server-form" noValidate onSubmit={handleSaveJson}>
          <label className="server-label" htmlFor="ice-json">
            {t('settings.iceJsonLabel')}
          </label>
          <textarea
            id="ice-json"
            className="server-input ice-textarea"
            rows={8}
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            value={iceJson}
            onChange={(e) => {
              setIceJson(e.target.value);
              setErrorKey('');
              setOkKey('');
            }}
            placeholder={t('settings.iceJsonPlaceholder')}
          />
          <p className="server-hint">{renderWithCode(t('settings.iceJsonHint'))}</p>
          <div className="server-actions">
            <button type="submit" disabled={busy}>
              {busy ? t('settings.saving') : t('settings.saveIceJson')}
            </button>
            <button type="button" className="server-reset" onClick={handleClear} disabled={busy}>
              {t('settings.clearIce')}
            </button>
          </div>
        </form>
      )}

      {errorKey && <p className="server-error">⚠ {t(errorKey)}</p>}
      {okKey && <p className="server-ok">✓ {t(okKey)}</p>}
    </section>
  );
}
