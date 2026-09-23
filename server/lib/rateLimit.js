/**
 * Simple in-memory rate limiter for join / handshake / message floods (B11).
 * Per-IP and per-room buckets. Not durable across processes — fine for the
 * single-process MVP relay.
 */

function makeBucket() {
  return { hits: [], // timestamps (ms)
  };
}

function prune(bucket, windowMs, now) {
  const cutoff = now - windowMs;
  while (bucket.hits.length && bucket.hits[0] < cutoff) {
    bucket.hits.shift();
  }
}

/**
 * @param {{ windowMs: number, max: number }} opts
 */
function createLimiter({ windowMs, max }) {
  const byKey = new Map();

  return {
    /**
     * @returns {{ ok: true } | { ok: false, retryAfterMs: number }}
     */
    check(key) {
      if (!key) return { ok: true };
      const now = Date.now();
      let bucket = byKey.get(key);
      if (!bucket) {
        bucket = makeBucket();
        byKey.set(key, bucket);
      }
      prune(bucket, windowMs, now);
      if (bucket.hits.length >= max) {
        const retryAfterMs = Math.max(0, bucket.hits[0] + windowMs - now);
        return { ok: false, retryAfterMs };
      }
      bucket.hits.push(now);
      return { ok: true };
    },
    // Periodic GC so abandoned rooms/IPs do not grow forever.
    sweep() {
      const now = Date.now();
      for (const [key, bucket] of byKey) {
        prune(bucket, windowMs, now);
        if (bucket.hits.length === 0) byKey.delete(key);
      }
    },
  };
}

// Join + public-key + auth-proof: tight, because floods create rooms / MITM noise.
const joinLimiterIp = createLimiter({ windowMs: 60_000, max: 20 });
const joinLimiterRoom = createLimiter({ windowMs: 60_000, max: 30 });
const handshakeLimiterIp = createLimiter({ windowMs: 60_000, max: 40 });
const handshakeLimiterRoom = createLimiter({ windowMs: 60_000, max: 60 });
// Ciphertext messages: looser but still capped.
const messageLimiterIp = createLimiter({ windowMs: 10_000, max: 60 });
const messageLimiterRoom = createLimiter({ windowMs: 10_000, max: 120 });

setInterval(() => {
  joinLimiterIp.sweep();
  joinLimiterRoom.sweep();
  handshakeLimiterIp.sweep();
  handshakeLimiterRoom.sweep();
  messageLimiterIp.sweep();
  messageLimiterRoom.sweep();
}, 60_000).unref?.();

function clientIp(socket) {
  const forwarded = socket.handshake?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake?.address || socket.conn?.remoteAddress || 'unknown';
}

function allow(ipLimiter, roomLimiter, socket, roomId) {
  const ip = clientIp(socket);
  const ipResult = ipLimiter.check(ip);
  if (!ipResult.ok) return { ok: false, scope: 'ip', ...ipResult };
  if (roomId) {
    const roomResult = roomLimiter.check(roomId);
    if (!roomResult.ok) return { ok: false, scope: 'room', ...roomResult };
  }
  return { ok: true };
}

module.exports = {
  allowJoin: (socket, roomId) => allow(joinLimiterIp, joinLimiterRoom, socket, roomId),
  allowHandshake: (socket, roomId) =>
    allow(handshakeLimiterIp, handshakeLimiterRoom, socket, roomId),
  allowMessage: (socket, roomId) =>
    allow(messageLimiterIp, messageLimiterRoom, socket, roomId),
  clientIp,
};
