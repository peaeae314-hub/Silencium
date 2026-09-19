import React, { useEffect, useState, useRef } from 'react';
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
  const [mySocketId, setMySocketId] = useState('');
  // `null` = reachable; `{ message }` = show the red banner (message may be '').
  const [connectionError, setConnectionError] = useState(null);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [myPublicKey, setMyPublicKey] = useState(null);
  const [hasSharedKey, setHasSharedKey] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [encryptionStatus, setEncryptionStatus] = useState('initializing'); // Used for debugging
  const messagesEndRef = useRef(null);

  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const roomId = params.get('room');
  const fileInputRef = useRef(null);
  const imageHandlersRegistered = useRef(false);

      useEffect(() => {
        // Prevent multiple registrations
        if (imageHandlersRegistered.current) return;
        imageHandlersRegistered.current = true;

        const handleReceiveEncryptedImage = async ({ encrypted, nonce, name, type }) => {
          if (!hasSharedKeyRef.current || !sharedKeyRef.current || !cryptoWorkerRef.current) return;
          
          try {
            if (import.meta.env.DEV) {
              console.log('Decrypting image:', { name, type, encryptedLength: encrypted.length });
            }
            
            const decryptedBytes = await cryptoWorkerRef.current.decrypt(
              new Uint8Array(encrypted),
              new Uint8Array(nonce),
              sharedKeyRef.current
            );
            
            if (import.meta.env.DEV) {
              console.log('Decrypted bytes length:', decryptedBytes.length);
              console.log('Decrypted bytes type:', typeof decryptedBytes, decryptedBytes.constructor.name);
              console.log('Decrypted bytes buffer:', decryptedBytes.buffer);
            }
            
            // Handle the decrypted data - it might be a string or binary data
            let imageData;
            if (typeof decryptedBytes === 'string') {
              // If it's already a string, use it directly
              imageData = decryptedBytes;
            } else if (decryptedBytes instanceof Uint8Array) {
              imageData = new TextDecoder().decode(decryptedBytes);
            } else if (decryptedBytes instanceof ArrayBuffer) {
              imageData = new TextDecoder().decode(decryptedBytes);
            } else {
              // Convert to Uint8Array first
              const uint8Array = new Uint8Array(decryptedBytes);
              imageData = new TextDecoder().decode(uint8Array);
            }
            
            if (import.meta.env.DEV) {
              console.log('Reconstructed image data preview:', imageData.substring(0, 100) + '...');
            }
            
            setMessages((prev) => {
              // Check for duplicates based on image data hash or timestamp
              const exists = prev.some(
                (msg) => msg.image === imageData && msg.sender === "them" && msg.name === name
              );
              if (exists) return prev;
              
              return [...prev, {
                id: crypto.randomUUID(),
                image: imageData,
                name,
                type,
                sender: "them",
                timestamp: new Date().toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })
              }];
            });
          } catch (err) {
            console.error('Failed to decrypt image:', err);
          }
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
      }, []);


  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Check if encryption is ready
    if (!hasSharedKeyRef.current || !cryptoWorkerRef.current) {
      alert(t('chat.alertWaitEncryption'));
      return;
    }

    // Check if socket is connected
    if (!socket.connected) {
      alert(t('chat.alertConnectionLost'));
      return;
    }

    // Check if already uploading
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
      
      if (import.meta.env.DEV) {
      console.log('Original image data preview:', imageData.substring(0, 100) + '...');
    }
      
      try {
        // Always compress images for better stability
        let processedImageData = await compressImage(imageData, file.type);
        if (import.meta.env.DEV) {
          console.log('Image compressed to reduce size');
        }

        // Use a simpler approach - encrypt the base64 string directly
        const imageBytes = new TextEncoder().encode(processedImageData);
        
        if (import.meta.env.DEV) {
          console.log('Image bytes length for encryption:', imageBytes.length);
        }

        // Limit the encrypted payload to what the relay will accept.
        if (imageBytes.length > MAX_ENCRYPTED_IMAGE_BYTES) {
          alert(t('chat.alertImageTooLarge'));
          setIsUploadingImage(false);
          return;
        }

        // Add timeout for encryption
        const encryptionPromise = cryptoWorkerRef.current.encrypt(
          imageBytes,
          sharedKeyRef.current
        );

        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Encryption timeout')), 30000)
        );

        const { ciphertext, nonce } = await Promise.race([encryptionPromise, timeoutPromise]);

        if (import.meta.env.DEV) {
          console.log('Encrypted data length:', ciphertext.length);
        }

        // Send encrypted image as binary frames (no Array.from JSON inflation).
        socket.emit('send-encrypted-image', {
          roomId,
          encrypted: ciphertext,
          nonce,
          name: file.name,
          type: file.type,
        });

        // Add to local messages
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
              minute: '2-digit'
            })
          }
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

  // Improved image compression function
  const compressImage = (imageData, type) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // More aggressive size reduction (max 1280x720)
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
        
        // Draw and compress
        ctx.drawImage(img, 0, 0, width, height);
        
        // More aggressive compression
        const quality = type === 'image/jpeg' ? 0.6 : 0.7;
        const compressedData = canvas.toDataURL(type, quality);
        
        if (import.meta.env.DEV) {
          console.log(`Compressed image from ${img.width}x${img.height} to ${width}x${height}`);
        }
        resolve(compressedData);
      };
      img.src = imageData;
    });
  };

  useAutoScroll(messagesEndRef, messages);

  // Surface an unreachable relay instead of sitting on "Establishing Encryption…".
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
    };
  }, []);

  // B14 — recover the room when the app returns to the foreground. An Android
  // WebView drops the Socket.IO transport while backgrounded; the relay holds
  // our seat for the 60 s grace window, so re-connect, re-join the same room,
  // and re-emit our public key on resume. `visibilitychange` covers the web and
  // older shells, `appStateChange` the native Capacitor shell.
  useEffect(() => {
    if (!roomId) return;

    const resume = () => {
      if (!socket.connected) socket.connect();
      socket.emit('join-room', { roomId, participantId: participantIdRef.current });
      const publicKey = myPublicKeyRef.current;
      if (publicKey) {
        socket.emit('send-public-key', { roomId, publicKey: Array.from(publicKey) });
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
  }, [roomId]);

  // Reset image handlers when room changes
  useEffect(() => {
    return () => {
      imageHandlersRegistered.current = false;
    };
  }, [roomId]);

  useEffect(() => {
    const handleConnect = () => {
      setMySocketId(socket.id);
      socket.emit("join-room", { roomId, participantId: participantIdRef.current });
      setEncryptionStatus("socket-connected");

      if (myPublicKey) {
        socket.emit("send-public-key", {
          roomId,
          publicKey: Array.from(myPublicKey),
        });
      }

      setTimeout(() => {
        if (!hasSharedKeyRef.current && myPublicKey) {
          socket.emit("send-public-key", {
            roomId,
            publicKey: Array.from(myPublicKey),
          });
        }
      }, 1500);
    };

    const handleDisconnect = (reason) => {
      if (import.meta.env.DEV) {
        console.log('Socket disconnected:', reason);
      }
      if (reason === 'io server disconnect') {
        // Server disconnected us, try to reconnect
        if (import.meta.env.DEV) {
          console.log('Attempting to reconnect...');
        }
        socket.connect();
      } else if (reason === 'transport close' || reason === 'ping timeout') {
        // Network issues, try to reconnect
        if (import.meta.env.DEV) {
          console.log('Network issue detected, attempting to reconnect...');
        }
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

    const handleReconnect = (attemptNumber) => {
      if (import.meta.env.DEV) {
        console.log('Socket reconnected on attempt:', attemptNumber);
      }
      // Re-join the room after reconnection
      if (roomId) {
        socket.emit("join-room", { roomId, participantId: participantIdRef.current });
      }
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("error", handleError);
    socket.on("reconnect", handleReconnect);
    
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("error", handleError);
      socket.off("reconnect", handleReconnect);
    };
  }, [myPublicKey, roomId]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    if (!hasSharedKeyRef.current || !cryptoWorkerRef.current) return;

    const { ciphertext, nonce } = await cryptoWorkerRef.current.encrypt(
      new TextEncoder().encode(input),
      sharedKeyRef.current
    );
    // Binary frames, matching the image path (B6) — no number-array inflation.
    socket.emit("send-message", {
      roomId,
      encrypted: ciphertext,
      nonce
    });
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setMessages(prev => [...prev, { id: crypto.randomUUID(), text: input, sender: socket.id, timestamp: time }]);
    setInput('');
  };

  const handleKeyExchange = async (theirPublicKey, isClient) => {
    const myKeyPair = await getMyKeyPair();
    const sharedKey = await cryptoWorkerRef.current.deriveSharedKey(
      myKeyPair.publicKey,
      myKeyPair.privateKey,
      theirPublicKey,
      isClient
    );
    sharedKeyRef.current = sharedKey;
    hasSharedKeyRef.current = true;
    setHasSharedKey(true);
  };

  useEffect(() => {
    if (!roomId || joinedRef.current) return;
    joinedRef.current = true;

    const setup = async () => {
      if (!socket.connected) socket.connect();

      // The socket may already be connected (e.g. the room screen was opened
      // after the home screen dialled the relay), in which case no `connect`
      // event fires and the join would otherwise be skipped. Re-joining is
      // idempotent server-side, and it lets the relay reclaim a B14 seat.
      if (socket.connected) {
        socket.emit("join-room", { roomId, participantId: participantIdRef.current });
      }

      socket.on("room-destroyed", ({ message }) => {
        setMessages(prev => [
          ...prev,
          {
            id: crypto.randomUUID(),
            text: `⚠️ ${message}`,
            sender: "system",
            timestamp: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit'
            })
          }
        ]);
        
        // Show notification and redirect after a short delay
        setTimeout(() => {
          alert(message);
          socket.disconnect();
          navigate("/");
        }, 1000);
      });

      socket.on("receive-public-key", async ({ publicKey, theirSocketId }) => {
        if (receivedKey.current === theirSocketId) return;
        receivedKey.current = theirSocketId;

        const isClient = socket.id === [socket.id, theirSocketId].sort()[1];

        try {
          const decodedKey = new Uint8Array(publicKey);
          await handleKeyExchange(decodedKey, isClient);
          setEncryptionStatus("ready");
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              text: tRef.current('chat.encryptionNowActive'),
              sender: "system",
              timestamp: new Date().toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })
            },
          ]);
        } catch (err) {
          console.error("❌ Key derivation failed:", err);
        }

        if (myPublicKey) {
          socket.emit("send-public-key", {
            roomId,
            publicKey: Array.from(myPublicKey),
          });
        }
      });

      socket.on("receive-message", async ({ encrypted, nonce }) => {
        if (!hasSharedKeyRef.current || !sharedKeyRef.current || !cryptoWorkerRef.current) return;
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
            sender: "them",
            timestamp: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })

          },
        ]);
      });

      socket.on("system-message", (msg) => {
        setMessages((prev) => {
          const alreadyExists = prev.some(
            (m) => m.text === msg && m.sender === "system"
          );
          if (alreadyExists) return prev;
          return [
            ...prev,
            {
              id: crypto.randomUUID(),
              text: msg,
              sender: "system",
              timestamp: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })

            },
          ];
        });
      });

      socket.on("join-error", (msg) => {
        alert(`❌ ${msg}`);
        navigate("/");
      });
    };

    setup();

    return () => {
      socket.off("receive-message");
      socket.off("receive-public-key");
      socket.off("system-message");
      socket.off("join-error");
      socket.off("room-destroyed");

      if (socket.connected) socket.disconnect();
      joinedRef.current = false;
    };
  }, [roomId, navigate, myPublicKey]);

  const handleLeaveRoom = () => {
    setMessages([]);
    // Emit a leave event before disconnecting
    socket.emit('leave-room', { roomId });
    socket.disconnect();
    navigate('/');
  };

  // On native, window.location.origin is the WebView's `https://localhost`, so
  // invite links must use the configured relay origin instead.
  const shareUrl = `${getShareOrigin()}/chat?room=${roomId}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setConnectionError(null);
    } catch {
      // Clipboard API can be unavailable in a WebView without focus/permission.
      window.prompt(t('chat.copyInvitePrompt'), shareUrl);
    }
  };

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

        <div className="encryption-status" style={{ 
          textAlign: 'center', 
          padding: '8px',
          margin: '8px 0',
          borderRadius: '4px',
          backgroundColor: hasSharedKey ? '#1a4d1a' : '#4d1a1a',
          color: '#00ff00',
          fontSize: '12px'
        }}>
          {hasSharedKey ? t('chat.encryptionActive') : t('chat.encryptionEstablishing')}
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
              <div className={`message-bubble ${msg.sender === 'system' ? 'system-msg' : 'user-msg'}`}>
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
            placeholder={t('chat.typeMessage')}
            disabled={!hasSharedKey}
          />
          <button 
            onClick={() => fileInputRef.current.click()} 
            disabled={!hasSharedKey || isUploadingImage}
            title={!hasSharedKey ? t('chat.waitForEncryption') : isUploadingImage ? t('chat.uploadingImage') : t('chat.attachImage')}
          >
            {isUploadingImage ? '⏳' : '📎'}
          </button>
          <button onClick={sendMessage} disabled={!hasSharedKey}>
            {t('chat.send')}
          </button>
        </div>
      </div>
    </div>
  );
}