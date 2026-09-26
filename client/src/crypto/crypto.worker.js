import sodium from 'libsodium-wrappers';

// libsodium's WASM/asm.js init is asynchronous. Install the message handler
// SYNCHRONOUSLY, before waiting on it, so a request that arrives while the
// worker is still initializing is not dropped (e.g. a fast re-join posts a
// deriveAuthKey before the previous worker's replacement is ready).
const sodiumReady = sodium.ready;

const AUTH_CONTEXT = 'silencium-v1-auth';
// Standard `libsodium-wrappers` (non-sumo) does not ship crypto_pwhash.
// Use Web Crypto PBKDF2-SHA256 (OWASP ~210k iters) over passphrase + roomId
// salt — still a proper KDF; the raw passphrase never leaves the client.
const PBKDF2_ITERATIONS = 210_000;

async function deriveAuthKey(passphrase, roomId) {
  const enc = new TextEncoder();
  const saltHash = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(`silencium-room-key-v1|${roomId || ''}`)
  );
  const salt = new Uint8Array(saltHash).slice(0, 16);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    256
  );
  return new Uint8Array(bits);
}

function compareBytes(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return a.length - b.length;
}

function buildTranscript(roomId, pkA, pkB) {
  const a = new Uint8Array(pkA);
  const b = new Uint8Array(pkB);
  const ordered = compareBytes(a, b) <= 0 ? [a, b] : [b, a];
  const roomBytes = sodium.from_string(String(roomId || ''));
  const ctx = sodium.from_string(AUTH_CONTEXT);
  const out = new Uint8Array(
    ctx.length + roomBytes.length + ordered[0].length + ordered[1].length
  );
  let offset = 0;
  out.set(ctx, offset); offset += ctx.length;
  out.set(roomBytes, offset); offset += roomBytes.length;
  out.set(ordered[0], offset); offset += ordered[0].length;
  out.set(ordered[1], offset);
  return out;
}

self.onmessage = async (e) => {
  const { id, type, data } = e.data;

  try {
    await sodiumReady;
    switch (type) {
      case 'generateKeyPair': {
        const keyPair = sodium.crypto_kx_keypair();
        self.postMessage({
          id,
          result: {
            publicKey: Array.from(keyPair.publicKey),
            privateKey: Array.from(keyPair.privateKey)
          }
        });
        break;
      }

      case 'deriveSharedKey': {
        const myPublicKey = new Uint8Array(data.myPublicKey);
        const myPrivateKey = new Uint8Array(data.myPrivateKey);
        const theirPublicKey = new Uint8Array(data.theirPublicKey);

        const keys = data.isClient
          ? sodium.crypto_kx_client_session_keys(myPublicKey, myPrivateKey, theirPublicKey)
          : sodium.crypto_kx_server_session_keys(myPublicKey, myPrivateKey, theirPublicKey);

        // crypto_kx gives directional keys; we keep the historical single-key
        // usage (client sharedTx / server sharedRx) then bind passphrase below.
        const kxKey = data.isClient ? keys.sharedTx : keys.sharedRx;
        self.postMessage({
          id,
          result: Array.from(kxKey)
        });
        break;
      }

      case 'deriveAuthKey': {
        const authKey = await deriveAuthKey(data.passphrase, data.roomId);
        self.postMessage({ id, result: Array.from(authKey) });
        break;
      }

      case 'bindSessionKey': {
        // Mix passphrase-derived auth key into the kx session key so a MITM
        // that only swaps X25519 pubkeys cannot decrypt even if UI were bypassed.
        const kxKey = new Uint8Array(data.kxKey);
        const authKey = new Uint8Array(data.authKey);
        const combined = new Uint8Array(kxKey.length + authKey.length);
        combined.set(kxKey, 0);
        combined.set(authKey, kxKey.length);
        const bound = sodium.crypto_generichash(32, combined);
        self.postMessage({ id, result: Array.from(bound) });
        break;
      }

      case 'computeAuthProof': {
        const authKey = new Uint8Array(data.authKey);
        const transcript = buildTranscript(data.roomId, data.myPublicKey, data.theirPublicKey);
        const proof = sodium.crypto_auth(transcript, authKey);
        self.postMessage({ id, result: Array.from(proof) });
        break;
      }

      case 'verifyAuthProof': {
        const authKey = new Uint8Array(data.authKey);
        const proof = new Uint8Array(data.proof);
        const transcript = buildTranscript(data.roomId, data.myPublicKey, data.theirPublicKey);
        const ok = sodium.crypto_auth_verify(proof, transcript, authKey);
        self.postMessage({ id, result: ok });
        break;
      }

      case 'computeFingerprint': {
        // Short SAS both users can compare. Bound to passphrase + both pubkeys.
        const authKey = new Uint8Array(data.authKey);
        const transcript = buildTranscript(data.roomId, data.myPublicKey, data.theirPublicKey);
        const material = new Uint8Array(authKey.length + transcript.length);
        material.set(authKey, 0);
        material.set(transcript, authKey.length);
        const digest = sodium.crypto_generichash(8, material);
        const hex = Array.from(digest)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        const fingerprint = `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`.toUpperCase();
        self.postMessage({ id, result: fingerprint });
        break;
      }

      case 'encrypt': {
        const nonce = data.nonce
          ? new Uint8Array(data.nonce)
          : sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);

        const message = new Uint8Array(data.message);
        const key = new Uint8Array(data.key);

        const ciphertext = sodium.crypto_secretbox_easy(message, nonce, key);

        self.postMessage({
          id,
          result: {
            ciphertext: Array.from(ciphertext),
            nonce: Array.from(nonce)
          }
        });
        break;
      }

      case 'decrypt': {
        const ciphertext = new Uint8Array(data.ciphertext);
        const nonce = new Uint8Array(data.nonce);
        const key = new Uint8Array(data.key);

        const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key);

        self.postMessage({
          id,
          result: new TextDecoder().decode(plaintext)
        });
        break;
      }

      default:
        self.postMessage({ id, error: 'Unknown operation type' });
    }
  } catch (error) {
    self.postMessage({ id, error: error.message });
  }
};
