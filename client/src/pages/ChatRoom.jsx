import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { socket, getSocketUrl } from '../utils/socket';
import { getShareOrigin } from '../utils/serverUrl';
import {
  initSodium,
  generateKeyPair,
  getMyKeyPair
} from '../crypto/libs';
import { CryptoWorker } from '../crypto/workerWrapper';
import {
  validateRoomKey,
  loadRoomKey,
  storeRoomKey,
  clearRoomKey,
  MIN_ROOM_KEY_LENGTH,
} from '../crypto/roomKey';
import { createPeerTransport } from '../webrtc/peerTransport';
import { resolveIceServers } from '../webrtc/iceServers';
import CanvasImageRenderer from '../components/CanvasImageRenderer';
import '../src/styles/hacker-theme.css';
import useAutoScroll from '../src/hooks/useAutoScroll';
import { useI18n } from '../i18n/context';
import { renderWithCode } from '../i18n/richText';

// Payload limits — kept aligned with server/app.js (MAX_IMAGE_BYTES /
// MAX_SOCKET_FRAME_BYTES). Images are compressed below, encrypted, then sent
// as binary frames, so these limits describe the actual bytes on the wire.
const MAX_IMAGE_FILE_BYTES = 6 * 1024 * 1024;
const MAX_ENCRYPTED_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_TEXT_CHARS = 8000;

// B14 — a stable, session-scoped id for "this participant". The relay uses it
// to reclaim a held seat when the Android WebView drops the socket while the
// app is backgrounded and the client re-joins the same room on resume. It is
// kept in sessionStorage so recovery still works if the WebView reloads the
// page instead of just resuming it. Not a key cache — no key material here.
const PARTICIPANT_ID_KEY = 'silencium.participantId';
const newParticipantId = () => {
  try {
    const existing = window.sessionStorage.getItem(PARTICIPANT_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    window.sessionStorage.setItem(PARTICIPANT_ID_KEY, id);
    return id;
  } catch {
    // Storage can be unavailable in some WebView privacy modes.
    return crypto.randomUUID();
  }
};


/** Constant-time-ish equality for X25519 pubkey bytes (length is fixed/small). */
const pubkeysEqual = (a, b) => {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
};

export default function ChatRoom() {
  const { t } = useI18n();
  // Socket listeners are registered once per room; `tRef` lets those long-lived
  // callbacks translate without re-running the setup effect on every locale
  // change (which would re-register listeners mid-conversation).
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const cryptoWorkerRef = useRef(null);
  const joinedRef = useRef(false);
  // B14 — identity the relay uses to reclaim our seat across a background drop.
  const participantIdRef = useRef(null);
  if (participantIdRef.current === null) participantIdRef.current = newParticipantId();
  // Mirror of the public-key state so the app-resume handler can re-emit it
  // without re-subscribing every time a key is generated.
  const myPublicKeyRef = useRef(null);
  const receivedKey = useRef(null);
  const sharedKeyRef = useRef(null);
  const hasSharedKeyRef = useRef(false);
  const verifiedRef = useRef(false);
  const authKeyRef = useRef(null);
  const theirPublicKeyRef = useRef(null);
  const fingerprintRef = useRef('');
  const pendingAuthProofRef = useRef(null);
  const pendingVerifyRef = useRef(false);
  const markVerifiedRef = useRef(() => {});
  const completeVerifiedSessionRef = useRef(null);
  const reemitAuthProofRef = useRef(null);
  // Debounce same-pubkey help so verified↔stuck peers do not ping-pong proofs.
  const lastProofHelpRef = useRef({ socketId: null, at: 0 });
  const startWebRtcIfNeededRef = useRef(null);
  const ingestCiphertextMessageRef = useRef(null);
  const ingestCiphertextImageRef = useRef(null);
  const peerTransportRef = useRef(null);
  const roomKeyRef = useRef('');
  const [mySocketId, setMySocketId] = useState('');
  // `null` = reachable; `{ message }` = show the red banner (message may be '').
  const [connectionError, setConnectionError] = useState(null);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [myPublicKey, setMyPublicKey] = useState(null);
  const [hasSharedKey, setHasSharedKey] = useState(false);
  const [verified, setVerified] = useState(false);
  const [fingerprint, setFingerprint] = useState('');
  const [authFailed, setAuthFailed] = useState(false);
  const [transport, setTransport] = useState('socket'); // 'socket' | 'webrtc' | 'connecting'
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [encryptionStatus, setEncryptionStatus] = useState('initializing');
  const messagesEndRef = useRef(null);

  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room');
  const fileInputRef = useRef(null);
  const imageHandlersRegistered = useRef(false);

  // Room key gate — passphrase stays in sessionStorage, never in the URL.
  const [keyGateValue, setKeyGateValue] = useState('');
  const [keyGateError, setKeyGateError] = useState('');
  const [roomKeyReady, setRoomKeyReady] = useState(false);

  useEffect(() => {
    if (!roomId) return;
    const existing = loadRoomKey(roomId);
    if (existing && validateRoomKey(existing).ok) {
      roomKeyRef.current = existing.trim();
      setRoomKeyReady(true);
    } else {
      setRoomKeyReady(false);
    }
  }, [roomId]);

  const pushSystem = useCallback((text) => {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        text,
        sender: 'system',
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      },
    ]);
  }, []);

  const handleKeyGateSubmit = (event) => {
    event.preventDefault();
    const check = validateRoomKey(keyGateValue);
    if (!check.ok) {
      setKeyGateError(check.errorKey);
      return;
    }
    storeRoomKey(roomId, check.key);
    roomKeyRef.current = check.key;
    setKeyGateError('');
    setRoomKeyReady(true);
  };

  const ingestCiphertextMessage = useCallback(async ({ encrypted, nonce }) => {
    if (!verifiedRef.current || !sharedKeyRef.current || !cryptoWorkerRef.current) return;
    try {
      const plain = await cryptoWorkerRef.current.decrypt(
        new Uint8Array(encrypted),
        new Uint8Array(nonce),
        sharedKeyRef.current
      );
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          text: plain,
          sender: 'them',
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        },
      ]);
    } catch (err) {
      console.error('Failed to decrypt message:', err);
      pushSystem(tRef.current('chat.decryptFailed'));
    }
  }, [pushSystem]);

  const ingestCiphertextImage = useCallback(async ({ encrypted, nonce, name, type }) => {
    if (!verifiedRef.current || !sharedKeyRef.current || !cryptoWorkerRef.current) return;
    try {
      const decryptedBytes = await cryptoWorkerRef.current.decrypt(
        new Uint8Array(encrypted),
        new Uint8Array(nonce),
        sharedKeyRef.current
      );

      let imageData;
      if (typeof decryptedBytes === 'string') {
        imageData = decryptedBytes;
      } else if (decryptedBytes instanceof Uint8Array) {
        imageData = new TextDecoder().decode(decryptedBytes);
      } else if (decryptedBytes instanceof ArrayBuffer) {
        imageData = new TextDecoder().decode(decryptedBytes);
      } else {
        const uint8Array = new Uint8Array(decryptedBytes);
        imageData = new TextDecoder().decode(uint8Array);
      }

      setMessages((prev) => {
        const exists = prev.some(
          (msg) => msg.image === imageData && msg.sender === 'them' && msg.name === name
        );
        if (exists) return prev;
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            image: imageData,
            name,
            type,
            sender: 'them',
            timestamp: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
          },
        ];
      });
    } catch (err) {
      console.error('Failed to decrypt image:', err);
      pushSystem(tRef.current('chat.decryptFailed'));
    }
  }, [pushSystem]);

  const sendCipherPayload = useCallback((kind, payload) => {
    const peer = peerTransportRef.current;
    if (peer?.isOpen()) {
      const ok = peer.send({ kind, ...payload });
      if (ok) return 'webrtc';
    }
    if (kind === 'message') {
      socket.emit('send-message', { roomId, ...payload });
    } else if (kind === 'image') {
      socket.emit('send-encrypted-image', { roomId, ...payload });
    }
    return 'socket';
  }, [roomId]);

  const startWebRtcIfNeeded = useCallback(() => {
    if (peerTransportRef.current || !verifiedRef.current || !socket.id) return;

    const isInitiator = socket.id === [socket.id, receivedKey.current].sort()[1];
    const transport = createPeerTransport({
      isInitiator,
      iceServers: resolveIceServers(),
      onSignal: (signal) => {
        socket.emit('webrtc-signal', { roomId, signal });
      },
      onMessage: (frame) => {
        if (!frame || typeof frame !== 'object') return;
        if (frame.kind === 'message') {
          ingestCiphertextMessage(frame);
        } else if (frame.kind === 'image') {
          ingestCiphertextImage(frame);
        }
      },
      onState: (state) => {
        if (state === 'connecting') setTransport('connecting');
        else if (state === 'open') {
          setTransport('webrtc');
          pushSystem(tRef.current('chat.webrtcActive'));
        } else if (state === 'failed' || state === 'closed') {
          setTransport('socket');
          if (state === 'failed') {
            pushSystem(tRef.current('chat.webrtcFallback'));
          }
          peerTransportRef.current?.close();
          peerTransportRef.current = null;
        }
      },
    });
    peerTransportRef.current = transport;
    transport.start().catch(() => {
      setTransport('socket');
      peerTransportRef.current = null;
      pushSystem(tRef.current('chat.webrtcFallback'));
    });
  }, [roomId, ingestCiphertextMessage, ingestCiphertextImage, pushSystem]);

  useEffect(() => {
    // Prevent multiple registrations
    if (imageHandlersRegistered.current) return;
    imageHandlersRegistered.current = true;

    const handleReceiveEncryptedImage = (payload) => {
      ingestCiphertextImage(payload);
    };

    socket.on('receive-encrypted-image', handleReceiveEncryptedImage);

    const handleImageError = (message) => {
      setIsUploadingImage(false);
      alert(`❌ ${message || tRef.current('chat.alertImageSendFailed')}`);
    };

    socket.on('image-error', handleImageError);

    return () => {
      socket.off('receive-encrypted-image', handleReceiveEncryptedImage);
      socket.off('image-error', handleImageError);
      imageHandlersRegistered.current = false;
    };
  }, [ingestCiphertextImage]);

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!verifiedRef.current || !cryptoWorkerRef.current) {
      alert(t('chat.alertWaitEncryption'));
      return;
    }

    if (!socket.connected) {
      alert(t('chat.alertConnectionLost'));
      return;
    }

    if (isUploadingImage) {
      alert(t('chat.alertUploadInProgress'));
      return;
    }

    const validTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!validTypes.includes(file.type) || file.size > MAX_IMAGE_FILE_BYTES) {
      alert(t('chat.alertOnlyTypes'));
      return;
    }

    setIsUploadingImage(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const imageData = reader.result;

      try {
        let processedImageData = await compressImage(imageData, file.type);
        const imageBytes = new TextEncoder().encode(processedImageData);

        if (imageBytes.length > MAX_ENCRYPTED_IMAGE_BYTES) {
          alert(t('chat.alertImageTooLarge'));
          setIsUploadingImage(false);
          return;
        }

        const encryptionPromise = cryptoWorkerRef.current.encrypt(
          imageBytes,
          sharedKeyRef.current
        );

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Encryption timeout')), 30000)
        );

        const { ciphertext, nonce } = await Promise.race([encryptionPromise, timeoutPromise]);

        sendCipherPayload('image', {
          encrypted: ciphertext,
          nonce,
          name: file.name,
          type: file.type,
        });

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            image: processedImageData,
            name: file.name,
            type: file.type,
            sender: socket.id,
            timestamp: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
          },
        ]);
      } catch (err) {
        console.error('Failed to encrypt image:', err);
        alert(t('chat.alertEncryptFailed'));
      } finally {
        setIsUploadingImage(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const compressImage = (imageData, type) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        let { width, height } = img;
        const maxWidth = 1280;
        const maxHeight = 720;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width *= ratio;
          height *= ratio;
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        const quality = type === 'image/jpeg' ? 0.6 : 0.7;
        const compressedData = canvas.toDataURL(type, quality);
        resolve(compressedData);
      };
      img.src = imageData;
    });
  };

  useAutoScroll(messagesEndRef, messages);

  useEffect(() => {
    const handleConnectError = (err) => {
      setConnectionError({ message: err?.message || '' });
    };
    const handleConnect = () => setConnectionError(null);

    socket.on('connect_error', handleConnectError);
    socket.on('connect', handleConnect);
    return () => {
      socket.off('connect_error', handleConnectError);
      socket.off('connect', handleConnect);
    };
  }, []);

  useEffect(() => {
    cryptoWorkerRef.current = new CryptoWorker();
    initSodium().then(async () => {
      const keyPair = await generateKeyPair();
      myPublicKeyRef.current = keyPair.publicKey;
      setMyPublicKey(keyPair.publicKey);
    });
    return () => {
      cryptoWorkerRef.current?.terminate();
      peerTransportRef.current?.close();
      peerTransportRef.current = null;
    };
  }, []);

  // B14 — recover the room when the app returns to the foreground.
  useEffect(() => {
    if (!roomId || !roomKeyReady) return;

    const resume = () => {
      if (!socket.connected) socket.connect();
      socket.emit('join-room', { roomId, participantId: participantIdRef.current });
      const publicKey = myPublicKeyRef.current;
      if (publicKey) {
        socket.emit('send-public-key', { roomId, publicKey: Array.from(publicKey) });
      }
      // Peer may have missed our proof across a background drop; re-emit if we
      // already hold session auth material (does not put the room key on the wire).
      if (authKeyRef.current && theirPublicKeyRef.current && myPublicKeyRef.current) {
        reemitAuthProofRef.current?.();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') resume();
    };
    document.addEventListener('visibilitychange', handleVisibility);

    let appStateListener = null;
    let disposed = false;

    if (Capacitor.isNativePlatform()) {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) resume();
      })
        .then((listener) => {
          if (disposed) listener.remove();
          else appStateListener = listener;
        })
        .catch(() => {
          /* plugin unavailable — visibilitychange already covers us */
        });
    }

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      appStateListener?.remove?.();
    };
  }, [roomId, roomKeyReady]);

  useEffect(() => {
    return () => {
      imageHandlersRegistered.current = false;
    };
  }, [roomId]);

  useEffect(() => {
    if (!roomKeyReady) return undefined;

    const handleConnect = () => {
      setMySocketId(socket.id);
      socket.emit('join-room', { roomId, participantId: participantIdRef.current });
      setEncryptionStatus('socket-connected');

      if (myPublicKey) {
        socket.emit('send-public-key', {
          roomId,
          publicKey: Array.from(myPublicKey),
        });
      }

      // Same as resume: if we already derived auth material, re-emit proof so a
      // peer that reconnects after us is not stuck on verifying forever.
      if (authKeyRef.current && theirPublicKeyRef.current && myPublicKeyRef.current) {
        reemitAuthProofRef.current?.();
      }

      setTimeout(() => {
        if (!hasSharedKeyRef.current && myPublicKey) {
          socket.emit('send-public-key', {
            roomId,
            publicKey: Array.from(myPublicKey),
          });
        }
      }, 1500);
    };

    const handleDisconnect = (reason) => {
      if (reason === 'io server disconnect') {
        socket.connect();
      } else if (reason === 'transport close' || reason === 'ping timeout') {
        setTimeout(() => {
          if (!socket.connected) {
            socket.connect();
          }
        }, 1000);
      }
    };

    const handleError = (error) => {
      console.error('Socket error:', error);
    };

    const handleReconnect = () => {
      if (!roomId) return;
      socket.emit('join-room', { roomId, participantId: participantIdRef.current });
      const publicKey = myPublicKeyRef.current;
      if (publicKey) {
        socket.emit('send-public-key', {
          roomId,
          publicKey: Array.from(publicKey),
        });
      }
      if (authKeyRef.current && theirPublicKeyRef.current && myPublicKeyRef.current) {
        reemitAuthProofRef.current?.();
      }
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('error', handleError);
    socket.on('reconnect', handleReconnect);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('error', handleError);
      socket.off('reconnect', handleReconnect);
    };
  }, [myPublicKey, roomId, roomKeyReady]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    if (!verifiedRef.current || !cryptoWorkerRef.current) return;
    if (input.length > MAX_TEXT_CHARS) {
      alert(t('chat.alertTextTooLong'));
      return;
    }

    const { ciphertext, nonce } = await cryptoWorkerRef.current.encrypt(
      new TextEncoder().encode(input),
      sharedKeyRef.current
    );
    sendCipherPayload('message', {
      encrypted: ciphertext,
      nonce,
    });
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text: input, sender: socket.id, timestamp: time },
    ]);
    setInput('');
  };

  const completeVerifiedSession = useCallback(
    async (theirPublicKey, isClient) => {
      const worker = cryptoWorkerRef.current;
      const myKeyPair = await getMyKeyPair();
      if (!worker || !myKeyPair || !roomKeyRef.current) return;

      const authKey = await worker.deriveAuthKey(roomKeyRef.current, roomId);
      authKeyRef.current = authKey;

      const kxKey = await worker.deriveSharedKey(
        myKeyPair.publicKey,
        myKeyPair.privateKey,
        theirPublicKey,
        isClient
      );
      const boundKey = await worker.bindSessionKey(kxKey, authKey);
      sharedKeyRef.current = boundKey;
      hasSharedKeyRef.current = true;
      setHasSharedKey(true);

      const fp = await worker.computeFingerprint(
        authKey,
        roomId,
        myKeyPair.publicKey,
        theirPublicKey
      );
      fingerprintRef.current = fp;
      setFingerprint(fp);

      const proof = await worker.computeAuthProof(
        authKey,
        roomId,
        myKeyPair.publicKey,
        theirPublicKey
      );
      socket.emit('send-auth-proof', {
        roomId,
        proof: Array.from(proof),
      });

      // Peer may have sent their proof before we finished deriving — verify now.
      if (pendingAuthProofRef.current) {
        const queued = pendingAuthProofRef.current;
        pendingAuthProofRef.current = null;
        const ok = await worker.verifyAuthProof(
          authKey,
          new Uint8Array(queued),
          roomId,
          myKeyPair.publicKey,
          theirPublicKey
        );
        if (!ok) {
          setAuthFailed(true);
          verifiedRef.current = false;
          setVerified(false);
          sharedKeyRef.current = null;
          hasSharedKeyRef.current = false;
          setHasSharedKey(false);
          pushSystem(tRef.current('chat.authFailed'));
        } else {
          // markVerified is defined below; call via verified path after render.
          // Use a microtask so the callback identity is available.
          pendingVerifyRef.current = true;
        }
      }
    },
    [roomId, pushSystem]
  );

  // Re-send auth proof without re-deriving. Needed when a peer reconnects or
  // late-joins after we are already verified — they may have missed our proof.
  const reemitAuthProof = useCallback(async () => {
    const worker = cryptoWorkerRef.current;
    const authKey = authKeyRef.current;
    const theirPk = theirPublicKeyRef.current;
    const myPk = myPublicKeyRef.current;
    if (!worker || !authKey || !theirPk || !myPk || !roomId) return;
    try {
      const proof = await worker.computeAuthProof(authKey, roomId, myPk, theirPk);
      socket.emit('send-auth-proof', {
        roomId,
        proof: Array.from(proof),
      });
    } catch (err) {
      console.error('Failed to re-emit auth proof:', err);
    }
  }, [roomId]);


  const markVerified = useCallback(() => {
    if (verifiedRef.current) return;
    verifiedRef.current = true;
    setVerified(true);
    setEncryptionStatus('ready');
    pushSystem(tRef.current('chat.encryptionNowActive'));
    pushSystem(
      tRef.current('chat.fingerprintReady', {
        code: fingerprintRef.current || '…',
      })
    );
    startWebRtcIfNeeded();
  }, [pushSystem, startWebRtcIfNeeded]);

  useEffect(() => {
    markVerifiedRef.current = markVerified;
  }, [markVerified]);

  useEffect(() => {
    if (pendingVerifyRef.current) {
      pendingVerifyRef.current = false;
      markVerified();
    }
  }, [markVerified, hasSharedKey, fingerprint]);

  // When fingerprint arrives after verify race, update the system line — the
  // banner below always shows the live fingerprint value.


  useEffect(() => {
    completeVerifiedSessionRef.current = completeVerifiedSession;
  }, [completeVerifiedSession]);

  useEffect(() => {
    reemitAuthProofRef.current = reemitAuthProof;
  }, [reemitAuthProof]);

  useEffect(() => {
    startWebRtcIfNeededRef.current = startWebRtcIfNeeded;
  }, [startWebRtcIfNeeded]);

  useEffect(() => {
    ingestCiphertextMessageRef.current = ingestCiphertextMessage;
  }, [ingestCiphertextMessage]);

  useEffect(() => {
    ingestCiphertextImageRef.current = ingestCiphertextImage;
  }, [ingestCiphertextImage]);

  useEffect(() => {
    if (!roomId || !roomKeyReady || joinedRef.current) return undefined;
    joinedRef.current = true;

    const setup = async () => {
      if (!socket.connected) socket.connect();

      if (socket.connected) {
        socket.emit('join-room', { roomId, participantId: participantIdRef.current });
      }

      socket.on('room-destroyed', ({ message }) => {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            text: `⚠️ ${message}`,
            sender: 'system',
            timestamp: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
          },
        ]);

        setTimeout(() => {
          alert(message);
          clearRoomKey(roomId);
          socket.disconnect();
          navigate('/');
        }, 1000);
      });

      socket.on('receive-public-key', async ({ publicKey, theirSocketId }) => {
        const decodedKey = new Uint8Array(publicKey);
        const samePk = pubkeysEqual(theirPublicKeyRef.current, decodedKey);

        // Always track the peer's current socket id (reconnect may change it).
        receivedKey.current = theirSocketId;

        if (samePk) {
          // Same peer identity. If we already hold auth material, the peer may
          // be stuck after a reconnect — re-send our pubkey + auth proof so
          // they can finish. Do not re-derive (socket-id order / isClient may
          // have flipped and would desync the session key).
          if (authKeyRef.current && myPublicKeyRef.current) {
            const now = Date.now();
            const last = lastProofHelpRef.current;
            if (last.socketId === theirSocketId && now - last.at < 3000) {
              return;
            }
            lastProofHelpRef.current = { socketId: theirSocketId, at: now };
            if (myPublicKeyRef.current) {
              socket.emit('send-public-key', {
                roomId,
                publicKey: Array.from(myPublicKeyRef.current),
              });
            }
            // Re-emit proof so a late/reconnecting peer is not left hanging.
            await reemitAuthProofRef.current?.();
            return;
          }
          // Stored their pubkey but never finished deriving — retry below.
        } else if (theirPublicKeyRef.current) {
          // Peer pubkey changed — reset local session and re-handshake.
          verifiedRef.current = false;
          setVerified(false);
          hasSharedKeyRef.current = false;
          setHasSharedKey(false);
          sharedKeyRef.current = null;
          authKeyRef.current = null;
          fingerprintRef.current = '';
          setFingerprint('');
          pendingAuthProofRef.current = null;
          pendingVerifyRef.current = false;
          setAuthFailed(false);
          peerTransportRef.current?.close();
          peerTransportRef.current = null;
          setTransport('socket');
        }

        const isClient = socket.id === [socket.id, theirSocketId].sort()[1];

        try {
          theirPublicKeyRef.current = decodedKey;
          await completeVerifiedSessionRef.current(decodedKey, isClient);
        } catch (err) {
          console.error('❌ Key derivation failed:', err);
          setAuthFailed(true);
          pushSystem(tRef.current('chat.authFailed'));
        }

        if (myPublicKeyRef.current) {
          socket.emit('send-public-key', {
            roomId,
            publicKey: Array.from(myPublicKeyRef.current),
          });
        }
      });

      socket.on('receive-auth-proof', async ({ proof }) => {
        if (!authKeyRef.current || !theirPublicKeyRef.current || !myPublicKeyRef.current) {
          pendingAuthProofRef.current = proof;
          return;
        }
        try {
          const ok = await cryptoWorkerRef.current.verifyAuthProof(
            authKeyRef.current,
            new Uint8Array(proof),
            roomId,
            myPublicKeyRef.current,
            theirPublicKeyRef.current
          );
          if (!ok) {
            setAuthFailed(true);
            verifiedRef.current = false;
            setVerified(false);
            sharedKeyRef.current = null;
            hasSharedKeyRef.current = false;
            setHasSharedKey(false);
            pushSystem(tRef.current('chat.authFailed'));
            return;
          }
          markVerifiedRef.current();
        } catch (err) {
          console.error('Auth proof verify failed:', err);
          setAuthFailed(true);
          pushSystem(tRef.current('chat.authFailed'));
        }
      });

      socket.on('receive-message', (payload) => {
        ingestCiphertextMessageRef.current?.(payload);
      });

      socket.on('webrtc-signal', async ({ signal }) => {
        if (!peerTransportRef.current) {
          // Peer started first — spin up our side as non-initiator if needed.
          if (verifiedRef.current) startWebRtcIfNeededRef.current?.();
        }
        await peerTransportRef.current?.handleSignal(signal);
      });

      socket.on('system-message', (msg) => {
        setMessages((prev) => {
          const alreadyExists = prev.some(
            (m) => m.text === msg && m.sender === 'system'
          );
          if (alreadyExists) return prev;
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              text: msg,
              sender: 'system',
              timestamp: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              }),
            },
          ];
        });
      });

      socket.on('join-error', (msg) => {
        alert(`❌ ${msg}`);
        navigate('/');
      });
    };

    setup();

    return () => {
      socket.off('receive-message');
      socket.off('receive-public-key');
      socket.off('receive-auth-proof');
      socket.off('webrtc-signal');
      socket.off('system-message');
      socket.off('join-error');
      socket.off('room-destroyed');

      peerTransportRef.current?.close();
      peerTransportRef.current = null;

      if (socket.connected) socket.disconnect();
      joinedRef.current = false;
    };
  }, [roomId, navigate, roomKeyReady, pushSystem]);

  // Re-run markVerified fingerprint line once fingerprint state is set.
  useEffect(() => {
    if (verified && fingerprint) {
      // no-op: banner shows fingerprint; keep effect for future hooks
    }
  }, [verified, fingerprint]);

  const handleLeaveRoom = () => {
    setMessages([]);
    clearRoomKey(roomId);
    peerTransportRef.current?.close();
    peerTransportRef.current = null;
    socket.emit('leave-room', { roomId });
    socket.disconnect();
    navigate('/');
  };

  // On native, window.location.origin is the WebView's `https://localhost`, so
  // invite links must use the configured relay origin instead.
  // Invite encodes room id only — the secret is shared out-of-band.
  const shareUrl = `${getShareOrigin()}/chat?room=${roomId}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setConnectionError(null);
    } catch {
      window.prompt(t('chat.copyInvitePrompt'), shareUrl);
    }
  };

  if (!roomId) {
    return (
      <div className="settings-screen">
        <div className="settings-card">
          <h1 className="settings-title">🔒 Silencium</h1>
          <p className="settings-copy">{t('home.joinError')}</p>
          <button type="button" onClick={() => navigate('/')}>
            {t('chat.leave')}
          </button>
        </div>
      </div>
    );
  }

  if (!roomKeyReady) {
    return (
      <div className="settings-screen">
        <div className="settings-card">
          <h1 className="settings-title">🔒 Silencium</h1>
          <p className="settings-copy">{t('chat.keyGateCopy')}</p>
          <form className="room-key-form" onSubmit={handleKeyGateSubmit}>
            <label className="room-key-label" htmlFor="gate-room-key">
              {t('home.keyLabel')}
            </label>
            <p className="room-key-hint">
              {t('home.keyHint', { min: MIN_ROOM_KEY_LENGTH })}
            </p>
            <input
              id="gate-room-key"
              className="join-input room-key-full"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={keyGateValue}
              onChange={(event) => {
                setKeyGateValue(event.target.value);
                setKeyGateError('');
              }}
              placeholder={t('home.keyPlaceholder')}
            />
            {keyGateError && (
              <p className="server-error">⚠ {t(keyGateError)}</p>
            )}
            <button type="submit" className="room-key-submit">
              {t('chat.keyGateContinue')}
            </button>
            <button type="button" onClick={() => navigate('/')}>
              {t('chat.leave')}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const canChat = verified && !authFailed;

  return (
    <div className="chat-outer">
      <div className="chat-container">
        <div className="chat-header">
          <h1>{t('chat.title')}</h1>
          <div className="chat-header-actions">
            <button
              type="button"
              className="chat-gear"
              title={t('chat.serverSettings')}
              aria-label={t('chat.serverSettings')}
              onClick={() => navigate('/settings')}
            >
              ⚙️
            </button>
            <button onClick={handleLeaveRoom}>{t('chat.leave')}</button>
          </div>
        </div>

        <div className="chat-link">
          <span>{t('chat.shareLabel')}</span> &nbsp;
          <button onClick={handleCopyLink}>{t('chat.copyLink')}</button>
          <div className="chat-link-value" title={shareUrl}>
            {shareUrl}
          </div>
          <p className="chat-share-hint">{t('chat.shareKeyHint')}</p>
        </div>

        {connectionError && (
          <div className="conn-error" role="alert">
            ⚠{' '}
            {renderWithCode(
              t('chat.connectionError', {
                url: getSocketUrl(),
                message: connectionError.message || t('chat.relayUnreachable'),
              })
            )}
            <button type="button" onClick={() => navigate('/settings')}>
              {t('chat.serverSettings')}
            </button>
          </div>
        )}

        <div
          className="encryption-status"
          style={{
            textAlign: 'center',
            padding: '8px',
            margin: '8px 0',
            borderRadius: '4px',
            backgroundColor: authFailed
              ? '#4d1a1a'
              : canChat
                ? '#1a4d1a'
                : '#4d3a1a',
            color: '#00ff00',
            fontSize: '12px',
          }}
        >
          {authFailed
            ? t('chat.authFailedBanner')
            : canChat
              ? t('chat.encryptionActive')
              : hasSharedKey
                ? t('chat.authVerifying')
                : t('chat.waitingForPeer')}
          {fingerprint && (
            <div className="fingerprint-code">
              {t('chat.fingerprintLabel')}: <strong>{fingerprint}</strong>
            </div>
          )}
          <div className="transport-label">
            {t('chat.transportLabel')}:{' '}
            {transport === 'webrtc'
              ? t('chat.transportWebrtc')
              : transport === 'connecting'
                ? t('chat.transportConnecting')
                : t('chat.transportSocket')}
          </div>
        </div>

        <div className="chat-messages">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`message-row ${
                msg.sender === mySocketId
                  ? 'align-right'
                  : msg.sender && msg.sender !== 'system'
                    ? 'align-left'
                    : 'align-center'
              }`}
            >
              <div
                className={`message-bubble ${
                  msg.sender === 'system' ? 'system-msg' : 'user-msg'
                }`}
              >
                {msg.type?.startsWith('image') ? (
                  <CanvasImageRenderer imageData={msg.image} imageName={msg.name} />
                ) : (
                  <div>{msg.text ?? t('chat.noText')}</div>
                )}

                {msg.timestamp && (msg.text || msg.image) && (
                  <div className="timestamp">{msg.timestamp}</div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input">
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            style={{ display: 'none' }}
            ref={fileInputRef}
          />

          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder={
              canChat
                ? t('chat.typeMessage')
                : hasSharedKey
                  ? t('chat.waitForEncryption')
                  : t('chat.waitingForPeerPlaceholder')
            }
            disabled={!canChat}
          />
          <button
            onClick={() => fileInputRef.current.click()}
            disabled={!canChat || isUploadingImage}
            title={
              !canChat
                ? t('chat.waitForEncryption')
                : isUploadingImage
                  ? t('chat.uploadingImage')
                  : t('chat.attachImage')
            }
          >
            {isUploadingImage ? '⏳' : '📎'}
          </button>
          <button onClick={sendMessage} disabled={!canChat}>
            {t('chat.send')}
          </button>
        </div>
      </div>
    </div>
  );
}
