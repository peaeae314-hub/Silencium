import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ServerUrlForm from '../components/ServerUrlForm';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { applyServerUrl } from '../utils/socket';
import { useI18n } from '../i18n/context';
import { useUpdate } from '../update/updateContext';
import { checkStatus, isAndroidApp } from '../update/updateService';
import { installedLabel } from '../update/updateLogic';
import '../src/styles/hacker-theme.css';

export default function Settings() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { installed, checkManually } = useUpdate();

  const [checking, setChecking] = useState(false);
  // `null` | 'upToDate' | 'fetchFailed' — drives the inline message below.
  const [checkResult, setCheckResult] = useState(null);

  const handleSaved = (url) => {
    // Swap the Socket.IO instance before returning to the chat screens.
    applyServerUrl(url);
    navigate('/', { replace: true });
  };

  const handleCheckUpdates = async () => {
    setChecking(true);
    setCheckResult(null);
    const result = await checkManually();
    setChecking(false);
    // "Update available" opens the prompt (handled by UpdateProvider); only
    // the two terminal outcomes need inline feedback here.
    if (result.status === checkStatus.updateAvailable) return;
    setCheckResult(result.status);
  };

  const versionLabel = installedLabel(installed) || '—';

  return (
    <div className="settings-screen">
      <div className="settings-card">
        <div className="settings-langrow">
          <LanguageSwitcher />
        </div>
        <h1 className="settings-title">{t('settings.title')}</h1>
        <p className="settings-copy">{t('settings.copy')}</p>
        <ServerUrlForm onSaved={handleSaved} onCancel={() => navigate('/')} showCancel showReset />

        <section className="update-section" data-testid="update-section">
          <h2 className="update-heading">{t('update.sectionTitle')}</h2>
          <p className="settings-copy">{t('update.sectionCopy')}</p>
          <p className="update-installed">
            {t('update.installedLabel')}: <strong>{versionLabel}</strong>
          </p>
          <div className="server-actions">
            <button
              type="button"
              data-testid="update-check"
              onClick={handleCheckUpdates}
              disabled={checking}
            >
              {checking ? t('update.checking') : t('update.checkButton')}
            </button>
          </div>
          {checkResult === checkStatus.upToDate && (
            <p className="server-ok" data-testid="update-result">
              {t('update.upToDate', { version: versionLabel })}
            </p>
          )}
          {checkResult === checkStatus.fetchFailed && (
            <p className="server-error" data-testid="update-result">
              {t('update.checkFailed')}
            </p>
          )}
          {!isAndroidApp() && (
            <p className="server-hint" data-testid="update-web-note">
              {t('update.webNote')}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
