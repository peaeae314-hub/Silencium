import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { getSocketUrl } from '../utils/socket';
import { loadLastRoom, saveLastRoom, restoreLastRoom } from '../utils/lastRoom';
import { useI18n } from '../i18n/context';
import LanguageSwitcher from '../components/LanguageSwitcher';
import {
  generateRoomKey,
  validateRoomKey,
  storeRoomKey,
  loadRoomKey,
  MIN_ROOM_KEY_LENGTH,
} from '../crypto/roomKey';
import { generateRoomId, isValidRoomId, isShortRoomId } from '../utils/roomId';
import { markCreateIntent } from '../utils/roomIntent';

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
  const location = useLocation();
  const { t } = useI18n();
  const [mode, setMode] = useState('create'); // 'create' | 'join'
  const [customRoomId, setCustomRoomId] = useState('');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [roomKey, setRoomKey] = useState('');
  // Store the i18n key (not the rendered string) so a later language switch
  // re-translates the visible error instead of freezing it.
  const [errorKey, setErrorKey] = useState('');
  const [showAdvancedRelay, setShowAdvancedRelay] = useState(false);
  // Last-used room captured at mount, so a refused create can restore it.
  const prevLastRoomRef = useRef({ lastRoomIdOrLink: '', lastRoomKey: '' });

  // Prefill last-used room id/link + key (local only; key never in URL). Also
  // consumes a rejected-create handoff from ChatRoom and restores the form.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rejected = location.state?.rejectedCreate;
      if (rejected) {
        // The relay refused the create (occupied/invalid). Roll the "last room"
        // back to its pre-create value so the refused id is not remembered, then
        // refill the form so the user can retry without retyping.
        await restoreLastRoom(location.state?.revertedLastRoom || null);
        const storedKey = loadRoomKey(rejected.roomId);
        const { lastRoomKey } = await loadLastRoom();
        if (cancelled) return;
        if (rejected.mode === 'join') {
          setMode('join');
          setRoomIdInput(rejected.roomId || '');
        } else {
          setMode('create');
          setCustomRoomId(rejected.roomId || '');
        }
        setErrorKey(
          rejected.code === 'ROOM_OCCUPIED'
            ? 'home.roomIdOccupied'
            : 'home.invalidRoomId'
        );
        setRoomKey(storedKey || lastRoomKey || '');
        // Clear the one-shot navigation state so a refresh starts clean.
        navigate('/', { replace: true, state: null });
        return;
      }

      const { lastRoomIdOrLink, lastRoomKey } = await loadLastRoom();
      if (cancelled) return;
      prevLastRoomRef.current = {
        lastRoomIdOrLink: lastRoomIdOrLink || '',
        lastRoomKey: lastRoomKey || '',
      };
      if (lastRoomKey) setRoomKey(lastRoomKey);
      if (lastRoomIdOrLink) setRoomIdInput(lastRoomIdOrLink);
    })();
    return () => {
      cancelled = true;
    };
    // Mount-only: router state is consumed once, then cleared above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToRoom = (roomId, key, idOrLink = roomId, opts = {}) => {
    storeRoomKey(roomId, key);
    // Fire-and-forget; navigation should not wait on Preferences.
    void saveLastRoom({ lastRoomIdOrLink: idOrLink, lastRoomKey: key });
    const state = { intent: opts.intent || 'join' };
    if (opts.intent === 'create') {
      // Hand ChatRoom the pre-create last-room snapshot so a refusal can restore it.
      state.revertedLastRoom = prevLastRoomRef.current;
    }
    navigate(`/chat?room=${encodeURIComponent(roomId)}`, { state });
  };

  const handleCreateRoom = (event) => {
    event.preventDefault();
    const trimmedId = customRoomId.trim();
    if (trimmedId && !isValidRoomId(trimmedId)) {
      setErrorKey('home.customRoomIdInvalid');
      return;
    }
    const check = validateRoomKey(roomKey);
    if (!check.ok) {
      setErrorKey(check.errorKey);
      return;
    }
    setErrorKey('');
    const roomId = trimmedId || generateRoomId();
    // Arm the one-shot create intent so ChatRoom's first join-room is a create.
    markCreateIntent(roomId);
    goToRoom(roomId, check.key, trimmedId || roomId, { intent: 'create' });
  };

  const handleJoinRoom = (event) => {
    event.preventDefault();
    const roomId = extractRoomId(roomIdInput);
    if (!roomId) {
      setErrorKey('home.joinError');
      return;
    }
    if (!isValidRoomId(roomId)) {
      setErrorKey('home.invalidRoomId');
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

  // Live validation of the optional custom room id (shown as the user types).
  const trimmedCustomRoomId = customRoomId.trim();
  const customRoomIdInvalid =
    trimmedCustomRoomId.length > 0 && !isValidRoomId(trimmedCustomRoomId);
  const customRoomIdShort =
    !customRoomIdInvalid && isShortRoomId(trimmedCustomRoomId);
  // ROOM_OCCUPIED renders inline under the custom-id field; everything else
  // (key errors, join errors) keeps the existing slot below the form.
  const occupiedError = errorKey === 'home.roomIdOccupied';
  const formErrorKey = occupiedError ? '' : errorKey;

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

            {/* Optional custom room id — secondary to the key, so it stays
                below it and does not disturb the existing layout. */}
            <label className="room-key-label" htmlFor="create-room-id">
              {t('home.customRoomIdLabel')}
            </label>
            <p className="room-key-hint">{t('home.customRoomIdHint')}</p>
            <input
              id="create-room-id"
              className="join-input room-key-full"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={customRoomId}
              onChange={(event) => {
                setCustomRoomId(event.target.value);
                setErrorKey('');
              }}
              placeholder={t('home.customRoomIdPlaceholder')}
              aria-label={t('home.customRoomIdLabel')}
            />
            {(customRoomIdInvalid ||
              errorKey === 'home.customRoomIdInvalid') && (
              <p className="server-error" role="alert">
                ⚠ {t('home.customRoomIdInvalid')}
              </p>
            )}
            {occupiedError && (
              <p className="server-error" role="alert">
                ⚠ {t('home.roomIdOccupied')}
              </p>
            )}
            {customRoomIdShort && (
              <p className="room-id-warning" role="status">
                ⚠ {t('home.customRoomIdShortWarn')}
              </p>
            )}

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

        {formErrorKey && (
          <p className="server-error" role="alert">
            ⚠ {t(formErrorKey)}
          </p>
        )}

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
