/**
 * integrations/upstash-ratelimit.js — drop-in adapter for rate-limit.js
 *
 * The current rate limiter stores counters in Firestore under
 * rate_limits/{hash}. Firestore caps around 500 writes/sec/doc — at
 * 10k users/hour with busy keys (claudeProxy:uid, publicLead:ip),
 * that's the next bottleneck. Upstash Redis over REST has no
 * per-key throughput ceiling that matters at our scale and response
 * latency is sub-20ms from us-central1 to the closest edge.
 *
 * This adapter exposes the SAME signatures as rate-limit.js's
 * enforceRateLimit + httpRateLimit, so index.js requires this
 * module instead when NBD_RATE_LIMIT_PROVIDER=upstash is set.
 *
 * SETUP:
 *   1. console.upstash.com → create Redis DB (global, regional near us-central1).
 *   2. Copy UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
 *   3. firebase functions:secrets:set UPSTASH_REDIS_REST_URL
 *      firebase functions:secrets:set UPSTASH_REDIS_REST_TOKEN
 *   4. Set env var NBD_RATE_LIMIT_PROVIDER=upstash on the functions.
 *
 * If any secret is missing we FALL BACK to the Firestore limiter —
 * never crash, never silently let traffic through.
 */

'use strict';

const crypto = require('crypto');
const { getSecret, hasSecret, PROVIDERS } = require('./_shared');
const firestoreLimiter = require('../rate-limit'); // existing Firestore-backed limiter

function hashKey(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex').slice(0, 40);
}

function upstashConfigured() {
  return hasSecret('UPSTASH_REDIS_REST_URL') && hasSecret('UPSTASH_REDIS_REST_TOKEN');
}

// Upstash supports fixed-window limiting via atomic INCR + EXPIRE.
// We do them as a single Lua-ish pipeline:
//   MULTI; INCR key; EXPIRE key windowSec NX; EXEC
// Upstash REST accepts array-of-commands as a pipeline.
async function upstashIncr(key, windowSec) {
  const url = getSecret('UPSTASH_REDIS_REST_URL');
  const token = getSecret('UPSTASH_REDIS_REST_TOKEN');
  const res = await fetch(url + '/pipeline', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, String(windowSec), 'NX']
    ])
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error('Upstash ' + res.status + ': ' + body.slice(0, 200));
  }
  const data = await res.json();
  // data = [{result: <count>}, {result: 0|1}]
  const count = Array.isArray(data) && data[0] && typeof data[0].result === 'number'
    ? data[0].result : 0;
  return count;
}

/**
 * Count + enforce semantics match rate-limit.js:
 *   - resolve: under limit
 *   - reject:  { rateLimited: true }
 * Caller is expected to wrap with try/catch just like today.
 */
async function enforceRateLimit(namespace, keyRaw, limit, windowMs) {
  if (PROVIDERS.rateLimit !== 'upstash' || !upstashConfigured()) {
    return firestoreLimiter.enforceRateLimit(namespace, keyRaw, limit, windowMs);
  }
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
  const key = 'rl:' + namespace + ':' + hashKey(keyRaw);
  try {
    const count = await upstashIncr(key, windowSec);
    if (count > limit) {
      const err = new Error('Rate limit exceeded');
      err.rateLimited = true;
      throw err;
    }
    return { count, limit, windowMs };
  } catch (e) {
    if (e.rateLimited) throw e;
    // On Upstash error, fail OPEN to Firestore limiter rather than
    // locking all callers out. The Firestore limiter is slower but
    // gives a correct answer.
    return firestoreLimiter.enforceRateLimit(namespace, keyRaw, limit, windowMs);
  }
}

/**
 * HTTP helper signature matches rate-limit.js — sets 429 + returns
 * false when over limit, returns true otherwise.
 */
async function httpRateLimit(req, res, namespace, limit, windowMs) {
  if (PROVIDERS.rateLimit !== 'upstash' || !upstashConfigured()) {
    return firestoreLimiter.httpRateLimit(req, res, namespace, limit, windowMs);
  }
  const ip = firestoreLimiter.clientIp(req);
  try {
    await enforceRateLimit(namespace, ip, limit, windowMs);
    return true;
  } catch (e) {
    if (e.rateLimited) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      res.status(429).json({ error: 'Rate limit exceeded' });
      return false;
    }
    // Unknown error — fail open to Firestore limiter.
    return firestoreLimiter.httpRateLimit(req, res, namespace, limit, windowMs);
  }
}

module.exports = {
  enforceRateLimit,
  httpRateLimit,
  clientIp: firestoreLimiter.clientIp,
  hashKey,
  _upstashConfigured: upstashConfigured
};
