import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSocketUrl } from '../utils/socket';
import { useI18n } from '../i18n/context';
import LanguageSwitcher from '../components/LanguageSwitcher';

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
  const [joinValue, setJoinValue] = useState('');
  // Store the i18n key (not the rendered string) so a later language switch
  // re-translates the visible error instead of freezing it.
  const [joinErrorKey, setJoinErrorKey] = useState('');

  const handleCreateRoom = () => {
    const roomId = generateRoomId();
    navigate(`/chat?room=${roomId}`);
  };

  const handleJoinRoom = (event) => {
    event.preventDefault();
    const roomId = extractRoomId(joinValue);
    if (!roomId) {
      setJoinErrorKey('home.joinError');
      return;
    }
    setJoinErrorKey('');
    navigate(`/chat?room=${encodeURIComponent(roomId)}`);
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
        {/* Logo with orange padlock */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-green-500 mb-2">
            🔒 Silencium
          </h1>
        </div>

        {/* Main headline */}
        <h2 className="text-2xl font-semibold text-green-500 mb-8">
          {t('home.tagline')}
        </h2>

        {/* Create Chat Room Button */}
        <button
          onClick={handleCreateRoom}
          className="px-8 py-4 border-2 border-green-500 text-green-500 rounded-lg font-semibold hover:bg-green-500 hover:text-black transition-colors duration-300 mb-6"
        >
          {t('home.createRoom')}
        </button>

        {/* Join an existing room — the only path on a phone without an address bar */}
        <form className="join-form" onSubmit={handleJoinRoom}>
          <input
            className="join-input"
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={joinValue}
            onChange={(event) => {
              setJoinValue(event.target.value);
              setJoinErrorKey('');
            }}
            placeholder={t('home.joinPlaceholder')}
            aria-label={t('home.joinAria')}
          />
          <button type="submit">{t('home.joinButton')}</button>
        </form>
        {joinErrorKey && <p className="server-error">⚠ {t(joinErrorKey)}</p>}

        {/* Features List */}
        <div className="home-features text-green-500 text-left max-w-md">
          {FEATURE_KEYS.map((key) => (
            <div className="home-feature" key={key}>
              <span className="text-green-500">→</span> {t(key)}
            </div>
          ))}
        </div>
      </main>

      {/* Relay indicator + settings gear moved to the bottom of the screen.
          Sticky, but it still occupies layout space, so it never covers the
          Create/Join controls. */}
      <footer className="home-relaybar">
        <span className="home-server" title={t('home.relayTitle')}>
          {t('home.relayPrefix')}: {getSocketUrl()}
        </span>
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
