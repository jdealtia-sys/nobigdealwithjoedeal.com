/**
 * integrations/device-alert.js — new-device sign-in detection (D9)
 *
 * Callable `registerDeviceFingerprint` — the client invokes on every
 * auth-state-changed callback with a cheap device fingerprint
 * (userAgent + a salted hash of IP + screen size). We hash it again
 * server-side (so the raw fingerprint never leaves the device plain)
 * and store under user_devices/{uid}/seen/{hash}. If this is the
 * first time we've seen the hash for the uid, we log an audit event
 * and — when Slack is configured — post a #security alert.
 *
 * Not a replacement for real MFA, but it's a tripwire. A stolen
 * session token used from an attacker's laptop immediately surfaces
 * as a new-device event on the owner's account.
 *
 * Rate limited to 10/min/uid so a misbehaving client can't spam
 * Firestore writes.
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { SECRETS, hasSecret, getSecret } = require('./_shared');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nbd-pro.web.app'
];

function hashFingerprint(uid, raw) {
  // Salt with uid so the same device seen by two different users
  // produces two different hashes — can't correlate device owners.
  return crypto.createHash('sha256')
    .update(uid + '::' + String(raw || ''))
    .digest('hex').slice(0, 32);
}

async function postSlack(msg) {
  if (!hasSecret('SLACK_WEBHOOK_URL')) return;
  try {
    await fetch(getSecret('SLACK_WEBHOOK_URL'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg)
    });
  } catch (e) { /* swallow */ }
}

exports.registerDeviceFingerprint = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 10,
    memory: '128MiB',
    secrets: [SECRETS.SLACK_WEBHOOK_URL]
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    const rl = require('./upstash-ratelimit');
    try { await rl.enforceRateLimit('registerDevice:uid', uid, 10, 60_000); }
    catch (e) { if (e.rateLimited) throw new HttpsError('resource-exhausted', 'Too fast'); throw e; }

    const raw = typeof request.data?.fingerprint === 'string'
      ? request.data.fingerprint.slice(0, 500) : '';
    const userAgent = typeof request.data?.userAgent === 'string'
      ? request.data.userAgent.slice(0, 400) : '';
    // IP is rawRequest-scoped; we hash it (never store plaintext).
    const ip = (request.rawRequest && (
      request.rawRequest.headers['x-forwarded-for'] || request.rawRequest.ip
    ) || '').toString().split(',')[0].trim();

    const composite = raw + '|' + userAgent + '|' + ip;
    const fp = hashFingerprint(uid, composite);

    const db = admin.firestore();
    const ref = db.doc('user_devices/' + uid + '/seen/' + fp);
    const snap = await ref.get();
    const seen = snap.exists;

    await ref.set({
      fingerprint: fp,
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      firstSeenAt: seen ? (snap.data().firstSeenAt || admin.firestore.FieldValue.serverTimestamp())
                        : admin.firestore.FieldValue.serverTimestamp(),
      // Non-PII summary for debugging — actual IP/UA are already
      // baked into the hash, never stored cleartext.
      uaBrowserFamily: extractBrowserFamily(userAgent)
    }, { merge: true });

    if (!seen) {
      logger.warn('new device sign-in', { uid: '[hashed:' + hashFingerprint('global', uid).slice(0, 8) + ']', fp: fp.slice(0, 12) });
      await db.collection('audit_log').add({
        type: 'new_device_sign_in',
        op: 'create',
        ids: { uidHash: hashFingerprint('global', uid).slice(0, 16), fpHash: fp.slice(0, 16) },
        ts: admin.firestore.FieldValue.serverTimestamp()
      });
      await postSlack({
        text: '🔐 New device sign-in',
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              '*🔐 New device sign-in*\n' +
              'User: `' + hashFingerprint('global', uid).slice(0, 16) + '` (uid hash)\n' +
              'Browser: *' + (extractBrowserFamily(userAgent) || 'unknown') + '*\n' +
              'If this was not you, rotate the user\'s password + revoke their sessions.'
          }
        }]
      });
    }

    return { success: true, newDevice: !seen };
  }
);

function extractBrowserFamily(ua) {
  if (!ua) return null;
  if (/Edg\//.test(ua))     return 'Edge';
  if (/Chrome\//.test(ua))  return 'Chrome';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Safari\//.test(ua))  return 'Safari';
  if (/OPR\//.test(ua))     return 'Opera';
  return 'Other';
}

module.exports = exports;
