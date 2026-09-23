/**
 * WebRTC DataChannel transport for ciphertext (plan ③).
 * Socket.IO remains the signaling + membership path and the automatic fallback
 * when ICE/NAT fails. Public STUN only — no TURN hard dependency.
 */

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const DC_LABEL = 'silencium';
const CONNECT_TIMEOUT_MS = 10_000;

/**
 * @param {object} opts
 * @param {boolean} opts.isInitiator
 * @param {(signal: object) => void} opts.onSignal - send SDP/ICE via Socket.IO
 * @param {(payload: object) => void} opts.onMessage - decrypted-ready ciphertext frame
 * @param {(state: 'connecting'|'open'|'closed'|'failed') => void} [opts.onState]
 */
export function createPeerTransport({ isInitiator, onSignal, onMessage, onState }) {
  let pc = null;
  let dc = null;
  let closed = false;
  let connectTimer = null;
  const pendingIce = [];
  let started = false;
  const pendingSignals = [];

  const setState = (state) => {
    try {
      onState?.(state);
    } catch {
      /* ignore UI errors */
    }
  };

  const cleanup = () => {
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = null;
    }
    try {
      dc?.close();
    } catch {
      /* ignore */
    }
    try {
      pc?.close();
    } catch {
      /* ignore */
    }
    dc = null;
    pc = null;
  };

  const fail = () => {
    if (closed) return;
    setState('failed');
    cleanup();
  };

  const wireChannel = (channel) => {
    dc = channel;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      setState('open');
    };
    dc.onclose = () => {
      if (!closed) setState('closed');
    };
    dc.onerror = () => fail();
    dc.onmessage = (event) => {
      try {
        const text =
          typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data);
        const payload = JSON.parse(text);
        onMessage(payload);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.warn('WebRTC message parse failed', err);
        }
      }
    };
  };

  const start = async () => {
    setState('connecting');
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        onSignal({ type: 'ice', candidate: event.candidate.toJSON() });
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc?.connectionState;
      if (state === 'failed' || state === 'disconnected') {
        // disconnected can recover; only fail hard on failed
        if (state === 'failed') fail();
      }
    };

    if (isInitiator) {
      wireChannel(pc.createDataChannel(DC_LABEL, { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      onSignal({ type: 'offer', sdp: pc.localDescription });
    } else {
      pc.ondatachannel = (event) => {
        if (event.channel?.label === DC_LABEL) wireChannel(event.channel);
      };
    }

    connectTimer = setTimeout(() => {
      if (dc?.readyState !== 'open') fail();
    }, CONNECT_TIMEOUT_MS);

    started = true;
    const queued = pendingSignals.splice(0);
    for (const signal of queued) {
      await handleSignal(signal);
    }
  };

  const handleSignal = async (signal) => {
    if (closed || !signal) return;
    if (!started || !pc) {
      pendingSignals.push(signal);
      return;
    }
    try {
      if (signal.type === 'offer') {
        await pc.setRemoteDescription(signal.sdp);
        for (const c of pendingIce.splice(0)) {
          await pc.addIceCandidate(c);
        }
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        onSignal({ type: 'answer', sdp: pc.localDescription });
      } else if (signal.type === 'answer') {
        await pc.setRemoteDescription(signal.sdp);
        for (const c of pendingIce.splice(0)) {
          await pc.addIceCandidate(c);
        }
      } else if (signal.type === 'ice' && signal.candidate) {
        if (pc.remoteDescription) {
          await pc.addIceCandidate(signal.candidate);
        } else {
          pendingIce.push(signal.candidate);
        }
      }
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('WebRTC signal error', err);
      }
      fail();
    }
  };

  /**
   * Send a JSON-serializable ciphertext frame. Returns false if DC is down
   * (caller should fall back to Socket.IO).
   */
  const send = (payload) => {
    if (!dc || dc.readyState !== 'open') return false;
    try {
      // Encode Uint8Arrays as number arrays for JSON.
      const wire = JSON.stringify(payload, (_key, value) => {
        if (value instanceof Uint8Array) return Array.from(value);
        if (value instanceof ArrayBuffer) return Array.from(new Uint8Array(value));
        return value;
      });
      dc.send(wire);
      return true;
    } catch {
      return false;
    }
  };

  const close = () => {
    closed = true;
    setState('closed');
    cleanup();
  };

  const isOpen = () => dc?.readyState === 'open';

  return {
    start,
    handleSignal,
    send,
    close,
    isOpen,
  };
}
