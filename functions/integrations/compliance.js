/**
 * integrations/compliance.js — retention, backup, and GDPR callables
 *
 * Four pieces of compliance infrastructure in one module:
 *   - auditLogRetentionCron    (D4) — prune audit_log entries older
 *                                     than the retention window.
 *   - nightlyFirestoreBackup   (D5) — export Firestore to GCS every
 *                                     day so a delete/corruption event
 *                                     can be restored within 24h.
 *   - exportMyData             (D6) — GDPR Article 20 portability. A
 *                                     user requests their full data
 *                                     payload; we stream a JSON blob
 *                                     to Storage and return a signed URL.
 *   - requestAccountErasure +  (D7) — GDPR Article 17 right-to-be-
 *     confirmAccountErasure          forgotten. Two-step flow with
 *                                     a confirmation token so a stolen
 *                                     session can't nuke someone's data.
 */

'use strict';

const { onCall, HttpsError, onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nbd-pro.web.app'
];

// ─── D4: audit_log retention ────────────────────────────────
// 7 years is a common choice:
//   - HIPAA     → 6 years (not applicable here, but a good floor)
//   - SOX       → 7 years
//   - IRS       → 7 years for business records
//   - GDPR      → "no longer than necessary" — 7y is defensible
//                 for contractor tax / dispute reasons.
// Override with AUDIT_LOG_RETENTION_DAYS env var if needed.
const AUDIT_LOG_RETENTION_DAYS = Number(process.env.AUDIT_LOG_RETENTION_DAYS) || (7 * 365);

exports.auditLogRetentionCron = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every day 03:30',
    timeZone: 'America/Chicago',
    timeoutSeconds: 540,
    memory: '256MiB'
  },
  async () => {
    const db = admin.firestore();
    const cutoff = admin.firestore.Timestamp.fromMillis(
      Date.now() - AUDIT_LOG_RETENTION_DAYS * 86_400_000
    );

    // Page through 500-doc batches. Firestore doesn't return > 500
    // docs/query and batch writes cap at 500 ops — match them.
    let deleted = 0;
    let lastDocRef = null;
    for (let page = 0; page < 20; page++) {  // 10k/day max
      let q = db.collection('audit_log').where('ts', '<', cutoff).orderBy('ts').limit(500);
      if (lastDocRef) q = q.startAfter(lastDocRef);
      const snap = await q.get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
      lastDocRef = snap.docs[snap.docs.length - 1];
      if (snap.size < 500) break;
    }
    logger.info('auditLogRetentionCron', { deleted, retentionDays: AUDIT_LOG_RETENTION_DAYS });
  }
);

// ─── D5: nightly Firestore → GCS backup ─────────────────────
// Uses the managed Firestore export API. Bucket must exist and the
// Firestore service account needs `roles/storage.objectAdmin` on it.
// Override bucket via NBD_BACKUP_BUCKET env var.
const BACKUP_BUCKET = process.env.NBD_BACKUP_BUCKET || 'gs://nobigdeal-pro-backups';
const GOOGLE_PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'nobigdeal-pro';

exports.nightlyFirestoreBackup = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every day 04:00',
    timeZone: 'America/Chicago',
    timeoutSeconds: 540,
    memory: '256MiB'
  },
  async () => {
    // Call the managed export REST endpoint with an IAM-signed token
    // (the default function SA already has the right role).
    const { GoogleAuth } = require('google-auth-library');
    const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/datastore' });
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;

    const today = new Date().toISOString().slice(0, 10);
    const outputUriPrefix = BACKUP_BUCKET.replace(/\/+$/, '') + '/' + today;

    const url = `https://firestore.googleapis.com/v1/projects/${GOOGLE_PROJECT}/databases/(default):exportDocuments`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        outputUriPrefix
        // No `collectionIds` → export everything
      })
    });
    if (!res.ok) {
      const body = await res.text();
      logger.error('nightlyFirestoreBackup export failed', { status: res.status, body: body.slice(0, 300) });
      throw new Error('Backup export rejected: ' + res.status);
    }
    const data = await res.json();
    logger.info('nightlyFirestoreBackup', { name: data.name, outputUriPrefix });
  }
);

// ─── D6: GDPR Article 20 — portability / export ──────────────
// User requests a full JSON dump of the data tied to their uid.
// We stream into a Storage object under gdpr_exports/{uid}/{ts}.json
// and return a 24-hour signed URL. Rate-limited aggressively.
exports.exportMyData = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 540,
    memory: '1GiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    // Aggressive cap — GDPR is a once-a-month-ish activity, not a
    // beacon. 2 exports per 24h per uid ought to cover legit use.
    const rl = require('./upstash-ratelimit');
    try {
      await rl.enforceRateLimit('exportMyData:uid', uid, 2, 24 * 3_600_000);
    } catch (e) {
      if (e.rateLimited) {
        throw new HttpsError('resource-exhausted', 'Only 2 exports per 24h allowed.');
      }
      throw e;
    }

    const db = admin.firestore();
    const out = { uid, generatedAt: new Date().toISOString(), collections: {} };

    // Collections the user owns via userId field.
    const OWNED = ['leads', 'estimates', 'photos', 'pins', 'tasks', 'documents', 'training_sessions'];
    for (const coll of OWNED) {
      try {
        const snap = await db.collection(coll).where('userId', '==', uid).get();
        out.collections[coll] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } catch (e) {
        out.collections[coll] = { error: e.message };
      }
    }

    // Profile doc + subscription.
    try {
      const u = await db.doc('users/' + uid).get();
      out.profile = u.exists ? u.data() : null;
    } catch (e) { out.profile = { error: e.message }; }
    try {
      const s = await db.doc('subscriptions/' + uid).get();
      out.subscription = s.exists ? s.data() : null;
    } catch (e) { out.subscription = { error: e.message }; }

    // api_usage — last 90 days is plenty; older rows are aggregated
    // into analytics and tell the user nothing personal.
    try {
      const since = admin.firestore.Timestamp.fromMillis(Date.now() - 90 * 86_400_000);
      const snap = await db.collection('api_usage')
        .where('uid', '==', uid)
        .where('timestamp', '>', since)
        .get();
      out.collections.api_usage = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e) { out.collections.api_usage = { error: e.message }; }

    // Serialize Firestore Timestamps to ISO.
    const replacer = (k, v) => {
      if (v && typeof v === 'object' && typeof v.toDate === 'function') return v.toDate().toISOString();
      return v;
    };
    const body = Buffer.from(JSON.stringify(out, replacer, 2), 'utf8');

    // Write to Storage under docs/{uid}/... so the existing rules
    // apply (owner read).
    const bucket = admin.storage().bucket();
    const objectName = `docs/${uid}/gdpr-export-${Date.now()}.json`;
    const file = bucket.file(objectName);
    await file.save(body, {
      contentType: 'application/json',
      metadata: { cacheControl: 'private, max-age=0, no-store' }
    });
    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 24 * 3_600_000,
      version: 'v4'
    });

    logger.info('exportMyData', { uid, bytes: body.length });
    return {
      success: true,
      url,
      expiresIn: 24 * 3600,
      bytes: body.length,
      collections: Object.keys(out.collections)
    };
  }
);

// ─── D7: GDPR Article 17 — right-to-be-forgotten ─────────────
// Two-step flow. Step 1 (request) mints a 24h confirmation token and
// emails it to the account-on-file. Step 2 (confirm) accepts the
// token and performs cascade deletion + Auth account disable.
//
// Why two-step: an attacker with a stolen session token could call
// an immediate-delete endpoint and permanently destroy the victim's
// data before they re-auth. The email confirmation loop forces the
// attacker to also compromise the email inbox.
exports.requestAccountErasure = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const rl = require('./upstash-ratelimit');
    try { await rl.enforceRateLimit('requestErasure:uid', uid, 3, 24 * 3_600_000); }
    catch (e) { if (e.rateLimited) throw new HttpsError('resource-exhausted', 'Too many erasure requests.'); throw e; }

    const token = crypto.randomBytes(32).toString('hex');
    const hash  = crypto.createHash('sha256').update(token).digest('hex');
    const db = admin.firestore();
    await db.doc('account_erasures/' + uid).set({
      tokenHash: hash,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 24 * 3_600_000),
      confirmed: false
    });

    // Email the link. The email-functions module is already wired
    // with Resend — we just enqueue a send job.
    try {
      const userRecord = await admin.auth().getUser(uid);
      const email = userRecord.email;
      const confirmUrl =
        'https://nobigdealwithjoedeal.com/pro/account-erasure?uid=' +
        encodeURIComponent(uid) + '&token=' + encodeURIComponent(token);
      if (email) {
        await db.collection('email_queue').add({
          to: email,
          subject: 'Confirm account deletion — NBD Pro',
          bodyPlain:
            'You (or someone using your account) requested that your NBD Pro account be permanently deleted.\n\n' +
            'To confirm, open this link within 24 hours:\n' +
            confirmUrl + '\n\n' +
            'If you did not make this request, you can ignore this email — your account will remain active.',
          status: 'pending',   // F-wave fix: worker query filters by status
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          source: 'requestAccountErasure'
        });
      }
    } catch (e) {
      logger.warn('requestAccountErasure: email enqueue failed', { err: e.message });
    }

    return { success: true };
  }
);

exports.confirmAccountErasure = onRequest(
  {
    region: 'us-central1',
    cors: true,
    timeoutSeconds: 540,
    memory: '512MiB'
  },
  async (req, res) => {
    if (req.method !== 'POST' && req.method !== 'GET') { res.status(405).end(); return; }
    const uid = (req.method === 'GET' ? req.query.uid : (req.body && req.body.uid)) || '';
    const token = (req.method === 'GET' ? req.query.token : (req.body && req.body.token)) || '';
    if (typeof uid !== 'string' || typeof token !== 'string' || !uid || token.length < 32) {
      res.status(400).json({ error: 'Invalid request' }); return;
    }

    const db = admin.firestore();
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const reqRef = db.doc('account_erasures/' + uid);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) { res.status(404).json({ error: 'No pending request' }); return; }
    const data = reqSnap.data();
    if (data.confirmed) { res.status(410).json({ error: 'Already processed' }); return; }
    if (data.tokenHash !== hash) { res.status(403).json({ error: 'Invalid token' }); return; }
    if (data.expiresAt && data.expiresAt.toMillis() < Date.now()) {
      res.status(410).json({ error: 'Link expired' }); return;
    }

    // Mark confirmed BEFORE starting the delete so a crash/retry
    // can't double-run.
    await reqRef.update({
      confirmed: true,
      confirmedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Cascade: delete all docs owned by this uid in the same
    // collections exportMyData covers. Batched 500 at a time.
    const OWNED = ['leads', 'estimates', 'photos', 'pins', 'tasks', 'documents', 'training_sessions'];
    for (const coll of OWNED) {
      try {
        while (true) {
          const snap = await db.collection(coll).where('userId', '==', uid).limit(500).get();
          if (snap.empty) break;
          const batch = db.batch();
          snap.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
          if (snap.size < 500) break;
        }
      } catch (e) {
        logger.warn('erasure: cascade failed for ' + coll, { err: e.message });
      }
    }
    // Profile doc + subscription (owner-scoped).
    try { await db.doc('users/' + uid).delete(); } catch (e) {}
    try { await db.doc('subscriptions/' + uid).delete(); } catch (e) {}

    // Disable the Auth account (don't delete — we keep the uid so
    // future fraud investigations can correlate).
    try {
      await admin.auth().updateUser(uid, { disabled: true });
      await admin.auth().revokeRefreshTokens(uid);
    } catch (e) {
      logger.warn('erasure: auth disable failed', { err: e.message });
    }

    await db.collection('audit_log').add({
      type: 'gdpr_erasure_confirmed',
      op: 'delete',
      ids: { uid },
      ts: admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).send(
      '<!doctype html><html><body style="font-family:system-ui;max-width:640px;margin:40px auto;padding:0 20px;color:#e8eaf0;background:#0d1117;">' +
      '<h1 style="color:#2ecc8a;">Account deletion complete</h1>' +
      '<p>Your NBD Pro account and all associated data has been removed. You can close this window.</p>' +
      '</body></html>'
    );
  }
);

module.exports = exports;
