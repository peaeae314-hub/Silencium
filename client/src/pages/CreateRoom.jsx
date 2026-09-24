import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocketUrl } from '../utils/socket';
import { loadLastRoom, saveLastRoom } from '../utils/lastRoom';
import { useI18n } from '../i18n/context';
import LanguageSwitcher from '../components/LanguageSwitcher';
import {
  generateRoomKey,
  validateRoomKey,
  storeRoomKey,
  MIN_ROOM_KEY_LENGTH,
} from '../crypto/roomKey';

// B12 — room ids are join capabilities, so they must be unguessable.
// 16 bytes (128 bits) from the CSPRNG, base64url-encoded (22 URL/query-safe
// characters, no padding). Do not fall back to Math.random().
const ROOM_ID_BYTES = 16;

// Feature bullets, in display order. Kept as i18n keys so the list re-renders
// in the active language when the switcher changes.
const FEATURE_KEYS = [
  'home.feature.noAccounts',
  'home.feature.noLogs',
  'home.feature.selfDestruct',
  'home.feature.e2ee',
  'home.feature.images',
  'home.feature.roomKey',
];

const generateRoomId = () => {
  const bytes = new Uint8Array(ROOM_ID_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// Accepts a full invite link (`…/chat?room=<id>`), a bare `?room=<id>` or a
// room id. A native app has no address bar, so pasting the link is the join path.
// The room key/passphrase is NEVER taken from the URL — share it out-of-band.
const extractRoomId = (raw) => {
  const value = (raw || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    const fromUrl = parsed.searchParams.get('room');
    if (fromUrl) return fromUrl.trim();
  } catch {
    /* not an absolute URL — fall through to query/id parsing */
  }
  const match = value.match(/[?&]room=([^&\s]+)/);
  if (match) return decodeURIComponent(match[1]).trim();
  return value;
};

export default function CreateRoom() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [mode, setMode] = useState('create'); // 'create' | 'join'
  const [roomIdInput, setRoomIdInput] = useState('');
  const [roomKey, setRoomKey] = useState('');
  // Store the i18n key (not the rendered string) so a later language switch
  // re-translates the visible error instead of freezing it.
  const [errorKey, setErrorKey] = useState('');
  const [showAdvancedRelay, setShowAdvancedRelay] = useState(false);

  // Prefill last-used room id/link + key (local only; key never in URL).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { lastRoomIdOrLink, lastRoomKey } = await loadLastRoom();
      if (cancelled) return;
      if (lastRoomKey) setRoomKey(lastRoomKey);
      if (lastRoomIdOrLink) setRoomIdInput(lastRoomIdOrLink);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const goToRoom = (roomId, key, idOrLink = roomId) => {
    storeRoomKey(roomId, key);
    // Fire-and-forget; navigation should not wait on Preferences.
    void saveLastRoom({ lastRoomIdOrLink: idOrLink, lastRoomKey: key });
    navigate(`/chat?room=${encodeURIComponent(roomId)}`);
  };

  const handleCreateRoom = (event) => {
    event.preventDefault();
    const check = validateRoomKey(roomKey);
    if (!check.ok) {
      setErrorKey(check.errorKey);
      return;
    }
    setErrorKey('');
    const roomId = generateRoomId();
    goToRoom(roomId, check.key);
  };

  const handleJoinRoom = (event) => {
    event.preventDefault();
    const roomId = extractRoomId(roomIdInput);
    if (!roomId) {
      setErrorKey('home.joinError');
      return;
    }
    const check = validateRoomKey(roomKey);
    if (!check.ok) {
      setErrorKey(check.errorKey);
      return;
    }
    setErrorKey('');
    // Prefer the pasted link/id so join-mode prefill restores what they typed.
    goToRoom(roomId, check.key, roomIdInput.trim() || roomId);
  };

  const handleGenerateKey = () => {
    setRoomKey(generateRoomKey());
    setErrorKey('');
  };

  return (
    <div className="home-screen">
      {/* Language switcher sits where the relay bar used to be — obvious on
          first open, and out of the way of the primary CTAs. */}
      <header className="home-langbar">
        <span className="home-langbar-label">{t('home.languageLabel')}</span>
        <LanguageSwitcher />
      </header>

      <main className="home-main">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-green-500 mb-2">
            🔒 Silencium
          </h1>
        </div>

        <h2 className="text-2xl font-semibold text-green-500 mb-6">
          {t('home.tagline')}
        </h2>

        <div className="home-mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'create'}
            className={mode === 'create' ? 'active' : ''}
            onClick={() => {
              setMode('create');
              setErrorKey('');
            }}
          >
            {t('home.createTab')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'join'}
            className={mode === 'join' ? 'active' : ''}
            onClick={() => {
              setMode('join');
              setErrorKey('');
            }}
          >
            {t('home.joinTab')}
          </button>
        </div>

        {mode === 'create' ? (
          <form className="room-key-form" onSubmit={handleCreateRoom}>
            <label className="room-key-label" htmlFor="create-room-key">
              {t('home.keyLabel')}
            </label>
            <p className="room-key-hint">{t('home.keyHint', { min: MIN_ROOM_KEY_LENGTH })}</p>
            <div className="room-key-row">
              <input
                id="create-room-key"
                className="join-input"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={roomKey}
                onChange={(event) => {
                  setRoomKey(event.target.value);
                  setErrorKey('');
                }}
                placeholder={t('home.keyPlaceholder')}
                aria-label={t('home.keyLabel')}
              />
              <button type="button" onClick={handleGenerateKey}>
                {t('home.generateKey')}
              </button>
            </div>
            <button type="submit" className="room-key-submit">
              {t('home.createRoom')}
            </button>
          </form>
        ) : (
          <form className="room-key-form" onSubmit={handleJoinRoom}>
            <label className="room-key-label" htmlFor="join-room-id">
              {t('home.roomIdLabel')}
            </label>
            <input
              id="join-room-id"
              className="join-input room-key-full"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={roomIdInput}
              onChange={(event) => {
                setRoomIdInput(event.target.value);
                setErrorKey('');
              }}
              placeholder={t('home.joinPlaceholder')}
              aria-label={t('home.joinAria')}
            />
            <label className="room-key-label" htmlFor="join-room-key">
              {t('home.keyLabel')}
            </label>
            <p className="room-key-hint">{t('home.keyHint', { min: MIN_ROOM_KEY_LENGTH })}</p>
            <input
              id="join-room-key"
              className="join-input room-key-full"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={roomKey}
              onChange={(event) => {
                setRoomKey(event.target.value);
                setErrorKey('');
              }}
              placeholder={t('home.keyPlaceholder')}
              aria-label={t('home.keyLabel')}
            />
            <button type="submit" className="room-key-submit">
              {t('home.joinButton')}
            </button>
          </form>
        )}

        {errorKey && <p className="server-error">⚠ {t(errorKey)}</p>}

        <div className="home-features text-green-500 text-left max-w-md">
          {FEATURE_KEYS.map((key) => (
            <div className="home-feature" key={key}>
              <span className="text-green-500">→</span> {t(key)}
            </div>
          ))}
        </div>
      </main>

      {/* Relay URL demoted: gear always available; URL shown only if expanded. */}
      <footer className="home-relaybar">
        <button
          type="button"
          className="home-relay-toggle"
          onClick={() => setShowAdvancedRelay((v) => !v)}
          aria-expanded={showAdvancedRelay}
        >
          {showAdvancedRelay ? t('home.hideRelay') : t('home.showRelay')}
        </button>
        {showAdvancedRelay && (
          <span className="home-server" title={t('home.relayTitle')}>
            {t('home.relayPrefix')}: {getSocketUrl()}
          </span>
        )}
        <button
          type="button"
          className="home-gear"
          title={t('home.serverSettings')}
          aria-label={t('home.serverSettings')}
          onClick={() => navigate('/settings')}
        >
          ⚙️
        </button>
      </footer>
    </div>
  );
}
