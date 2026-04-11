/**
 * Shared rate limiter for Cloud Functions.
 *
 * Uses a dedicated Firestore collection `_rate_limits_ip/{hashedKey}` that is
 * locked down in firestore.rules (allow read, write: if false — admin SDK only).
 * Replaces the prior user-writable `rate_limits/{uid}` collection that users
 * could reset at will.
 *
 * Keys are sha256-hashed so we never store raw IPs.
 */

const crypto = require('crypto');
const admin = require('firebase-admin');

function hashKey(raw) {
  return crypto.createHash('sha256').update(String(raw || 'unknown')).digest('hex').substring(0, 32);
}

function clientIp(req) {
  // Firebase Functions v2 uses Google LB — x-forwarded-for first entry is the real client.
  const xff = req?.headers?.['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req?.ip || req?.rawRequest?.ip || 'unknown';
}

/**
 * Enforce a rolling window per (namespace, key). Throws if over limit.
 *
 * @param {string} namespace e.g. 'validateAccessCode' | 'claudeProxy:ip'
 * @param {string} key raw key (IP or uid)
 * @param {number} limit max requests per window
 * @param {number} windowMs window duration in ms
 */
async function enforceRateLimit(namespace, key, limit, windowMs) {
  const db = admin.firestore();
  const docId = `${namespace}__${hashKey(key)}`;
  const ref = db.collection('_rate_limits_ip').doc(docId);
  const now = Date.now();

  // Transactional increment — protects against burst races.
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    if (!data || now - (data.windowStart || 0) >= windowMs) {
      tx.set(ref, { windowStart: now, count: 1, lastSeenAt: now }, { merge: true });
      return { allowed: true, count: 1, remaining: limit - 1 };
    }
    if ((data.count || 0) >= limit) {
      return { allowed: false, count: data.count, remaining: 0, retryAfterMs: windowMs - (now - data.windowStart) };
    }
    tx.update(ref, { count: (data.count || 0) + 1, lastSeenAt: now });
    return { allowed: true, count: (data.count || 0) + 1, remaining: limit - 1 - (data.count || 0) };
  });

  if (!result.allowed) {
    const e = new Error('rate_limited');
    e.rateLimited = true;
    e.retryAfterMs = result.retryAfterMs;
    throw e;
  }
  return result;
}

/**
 * Convenience wrapper for HTTP handlers that responds with 429 on limit.
 */
async function httpRateLimit(req, res, namespace, limit, windowMs) {
  try {
    await enforceRateLimit(namespace, clientIp(req), limit, windowMs);
    return true;
  } catch (e) {
    if (e.rateLimited) {
      res.set('Retry-After', Math.ceil((e.retryAfterMs || windowMs) / 1000));
      res.status(429).json({ error: 'Too many requests' });
      return false;
    }
    throw e;
  }
}

module.exports = { enforceRateLimit, httpRateLimit, clientIp, hashKey };
