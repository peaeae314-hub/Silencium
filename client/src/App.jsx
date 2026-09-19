import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import CreateRoom from './pages/CreateRoom';
import ChatRoom from './pages/ChatRoom';
import Settings from './pages/Settings';
import ServerUrlForm from './components/ServerUrlForm';
import LanguageSwitcher from './components/LanguageSwitcher';
import './src/styles/hacker-theme.css';
import { initSodium } from './crypto/libs'; // ✅ Import sodium initializer
import { initServerUrl, resolveServerUrl } from './utils/serverUrl';
import { applyServerUrl } from './utils/socket';
import I18nProvider from './i18n/I18nProvider';
import { useI18n } from './i18n/context';
import { getLocale, initLocale } from './i18n/locale';
import { renderWithCode } from './i18n/richText';

/**
 * Everything that can use `t()`. Split out so the i18n provider can wrap it
 * while the boot screens themselves stay translated too.
 */
function AppShell({ booted, serverReady, onServerSaved }) {
  const { t } = useI18n();

  if (!booted) {
    return (
      <div className="settings-screen">
        <div className="settings-card">
          <h1 className="settings-title">🔒 Silencium</h1>
          <p className="settings-copy">{t('app.starting')}</p>
        </div>
      </div>
    );
  }

  if (!serverReady) {
    return (
      <div className="settings-screen">
        <div className="settings-card">
          <div className="settings-langrow">
            <LanguageSwitcher />
          </div>
          <h1 className="settings-title">🔒 Silencium</h1>
          <p className="settings-copy">
            {renderWithCode(t('settings.firstLaunch'))}
          </p>
          <ServerUrlForm onSaved={onServerSaved} />
        </div>
      </div>
    );
  }

  return (
    <Router>
      <Routes>
        <Route path="/" element={<CreateRoom />} />
        <Route path="/chat" element={<ChatRoom />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Router>
  );
}

function App() {
  const [booted, setBooted] = useState(false);
  const [serverReady, setServerReady] = useState(false);
  // null until storage has been read, so the provider mounts with the real
  // locale (no flash of English on a zh device).
  const [locale, setLocale] = useState(null);

  useEffect(() => {
    initSodium(); // ✅ Preload sodium on app load
  }, []);

  // Resolve the locale and the relay URL before any screen can open a socket.
  // Native builds with nothing saved stay on Settings instead of silently
  // dialing localhost.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([initServerUrl(), initLocale()]);
      if (cancelled) return;
      setLocale(getLocale());
      const url = resolveServerUrl();
      if (url) {
        applyServerUrl(url);
        setServerReady(true);
      }
      setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Language-neutral splash while device storage is read (a few ms).
  if (locale === null) {
    return (
      <div className="settings-screen">
        <div className="settings-card">
          <h1 className="settings-title">🔒 Silencium</h1>
        </div>
      </div>
    );
  }

  return (
    <I18nProvider initialLocale={locale}>
      <AppShell
        booted={booted}
        serverReady={serverReady}
        onServerSaved={(url) => {
          applyServerUrl(url);
          setServerReady(true);
        }}
      />
    </I18nProvider>
  );
}

export default App;
