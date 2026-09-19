import sodium from 'libsodium-wrappers';

let myKeyPair = null;
let sodiumReady = false;
let keyPairPromise = null;

export const initSodium = async () => {
  if (!sodiumReady) {
    await sodium.ready;
    sodiumReady = true;
  }
};

export const generateKeyPair = async () => {
  if (!keyPairPromise) {
    keyPairPromise = (async () => {
      await sodium.ready;
      myKeyPair = sodium.crypto_kx_keypair();
      return myKeyPair;
    })();
  }
  return keyPairPromise;
};

export const getMyKeyPair = () => myKeyPair;
