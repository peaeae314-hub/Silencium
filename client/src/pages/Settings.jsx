import React from 'react';
import { useNavigate } from 'react-router-dom';
import ServerUrlForm from '../components/ServerUrlForm';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { applyServerUrl } from '../utils/socket';
import { useI18n } from '../i18n/context';
import '../src/styles/hacker-theme.css';

export default function Settings() {
  const navigate = useNavigate();
  const { t } = useI18n();

  const handleSaved = (url) => {
    // Swap the Socket.IO instance before returning to the chat screens.
    applyServerUrl(url);
    navigate('/', { replace: true });
  };

  return (
    <div className="settings-screen">
      <div className="settings-card">
        <div className="settings-langrow">
          <LanguageSwitcher />
        </div>
        <h1 className="settings-title">{t('settings.title')}</h1>
        <p className="settings-copy">{t('settings.copy')}</p>
        <ServerUrlForm onSaved={handleSaved} onCancel={() => navigate('/')} showCancel showReset />
      </div>
    </div>
  );
}
