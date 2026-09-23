// workerWrapper.js
export class CryptoWorker {
  constructor() {
    this.worker = new Worker(
      new URL('./crypto.worker.js', import.meta.url),
      { type: 'module' }
    );
    this.callbacks = new Map();
    this.nextId = 0;

    this.worker.onmessage = (e) => {
      const { id, result, error } = e.data;
      const callback = this.callbacks.get(id);
      if (callback) {
        if (error) callback.reject(error);
        else callback.resolve(result);
        this.callbacks.delete(id);
      }
    };
  }

  async execute(type, data) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.callbacks.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, data });
    });
  }

  async generateKeyPair() {
    const result = await this.execute('generateKeyPair');
    return {
      publicKey: new Uint8Array(result.publicKey),
      privateKey: new Uint8Array(result.privateKey)
    };
  }

  async deriveSharedKey(myPublicKey, myPrivateKey, theirPublicKey, isClient) {
    const result = await this.execute('deriveSharedKey', {
      myPublicKey: Array.from(myPublicKey),
      myPrivateKey: Array.from(myPrivateKey),
      theirPublicKey: Array.from(theirPublicKey),
      isClient
    });
    return new Uint8Array(result);
  }

  async deriveAuthKey(passphrase, roomId) {
    const result = await this.execute('deriveAuthKey', { passphrase, roomId });
    return new Uint8Array(result);
  }

  async bindSessionKey(kxKey, authKey) {
    const result = await this.execute('bindSessionKey', {
      kxKey: Array.from(kxKey),
      authKey: Array.from(authKey)
    });
    return new Uint8Array(result);
  }

  async computeAuthProof(authKey, roomId, myPublicKey, theirPublicKey) {
    const result = await this.execute('computeAuthProof', {
      authKey: Array.from(authKey),
      roomId,
      myPublicKey: Array.from(myPublicKey),
      theirPublicKey: Array.from(theirPublicKey)
    });
    return new Uint8Array(result);
  }

  async verifyAuthProof(authKey, proof, roomId, myPublicKey, theirPublicKey) {
    return this.execute('verifyAuthProof', {
      authKey: Array.from(authKey),
      proof: Array.from(proof),
      roomId,
      myPublicKey: Array.from(myPublicKey),
      theirPublicKey: Array.from(theirPublicKey)
    });
  }

  async computeFingerprint(authKey, roomId, myPublicKey, theirPublicKey) {
    return this.execute('computeFingerprint', {
      authKey: Array.from(authKey),
      roomId,
      myPublicKey: Array.from(myPublicKey),
      theirPublicKey: Array.from(theirPublicKey)
    });
  }

  async encrypt(message, key, nonce = null) {
    const result = await this.execute('encrypt', {
      message: Array.from(message),
      key: Array.from(key),
      nonce: nonce ? Array.from(nonce) : null
    });
    return {
      ciphertext: new Uint8Array(result.ciphertext),
      nonce: new Uint8Array(result.nonce)
    };
  }

  async decrypt(ciphertext, nonce, key) {
    return this.execute('decrypt', {
      ciphertext: Array.from(ciphertext),
      nonce: Array.from(nonce),
      key: Array.from(key)
    });
  }

  terminate() {
    this.worker.terminate();
  }
}
