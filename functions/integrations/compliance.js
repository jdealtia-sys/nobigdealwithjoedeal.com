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
    // collectionGroup exports — subcollection rows that key on
    // userId (e.g. recordings under leads/{leadId}/recordings/).
    const OWNED_GROUPS = ['recordings'];
    for (const group of OWNED_GROUPS) {
      try {
        const snap = await db.collectionGroup(group).where('userId', '==', uid).get();
        out.collections[group] = snap.docs.map(d => ({
          path: d.ref.path, ...d.data()
        }));
      } catch (e) {
        out.collections[group] = { error: e.message };
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

// F-01: GET no longer triggers deletion.
//
// The previous implementation accepted GET with (uid, token) in the query
// string and ran the full cascade-delete. Enterprise mail scanners
// (Microsoft Defender SafeLinks, Gmail image proxy, Slack unfurler,
// Mimecast / Proofpoint URL Defense, corporate AV gateways) pre-fetch
// every link in inbound email to check for phishing — which silently
// fired erasure against legit users the moment the confirmation email
// arrived. No recovery path.
//
// New flow:
//   GET  → renders a static HTML confirmation page. Zero state change.
//          Scanners can pre-fetch all they want.
//   POST → verifies token, runs cascade delete. Per-IP + per-uid rate
//          limited; token lives only in request body, not URL.
//
// The email link still contains (uid, token) in the URL because the
// landing page needs them to render the confirm button. The token
// being in logs is accepted — exploitation still requires the human
// POST that only a real click can produce.
exports.confirmAccountErasure = onRequest(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    timeoutSeconds: 540,
    memory: '512MiB'
  },
  async (req, res) => {
    // Block indexing of the landing page in all paths.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');

    if (req.method === 'GET') {
      // Show confirmation page. NO state change — safe for scanner pre-fetch.
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
      res.setHeader('Referrer-Policy', 'no-referrer');
      // CSP hardens the inline script we ship below.
      res.setHeader('Content-Security-Policy',
        "default-src 'self'; base-uri 'none'; object-src 'none'; " +
        "frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; connect-src 'self';");
      // Light sanity check — we do NOT validate the token itself on GET.
      const uidQ   = String(req.query.uid   || '');
      const tokenQ = String(req.query.token || '');
      const safeUid   = uidQ.slice(0, 128).replace(/[^A-Za-z0-9:_-]/g, '');
      const safeToken = tokenQ.slice(0, 256).replace(/[^A-Za-z0-9_-]/g, '');
      res.status(200).send(
        '<!doctype html><html lang="en"><head>' +
        '<meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<meta name="robots" content="noindex,nofollow">' +
        '<title>Confirm account deletion — NBD Pro</title>' +
        '<style>' +
        'body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#e8eaf0;background:#0d1117;}' +
        'h1{color:#ff4e4e;margin-bottom:8px}' +
        'p{line-height:1.5;color:#cfd3dc}' +
        'button{background:#ff4e4e;color:#fff;border:0;padding:14px 22px;font-size:16px;border-radius:6px;cursor:pointer;font-weight:600}' +
        'button:disabled{background:#555;cursor:wait}' +
        '.cancel{display:inline-block;margin-left:12px;color:#9aa3b2;text-decoration:none}' +
        '#status{margin-top:20px;padding:12px;border-radius:6px;display:none}' +
        '.ok{background:rgba(46,204,138,.15);color:#2ecc8a;display:block!important}' +
        '.err{background:rgba(255,78,78,.15);color:#ff6b6b;display:block!important}' +
        '</style></head><body>' +
        '<h1>Permanently delete your NBD Pro account?</h1>' +
        '<p>This removes all your leads, estimates, photos, pins, tasks, documents, training sessions, profile, and subscription record. ' +
        'Your Auth account is disabled. This cannot be undone.</p>' +
        '<p>If you did not request this, simply close this tab — nothing will happen.</p>' +
        '<form id="f"><button id="b" type="submit">Yes, delete my account</button>' +
        '<a class="cancel" href="/pro/dashboard.html">Cancel</a></form>' +
        '<div id="status"></div>' +
        '<script>(function(){' +
        'var uid=' + JSON.stringify(safeUid) + ';' +
        'var token=' + JSON.stringify(safeToken) + ';' +
        'var f=document.getElementById("f");var b=document.getElementById("b");var s=document.getElementById("status");' +
        'f.addEventListener("submit",function(ev){ev.preventDefault();b.disabled=true;b.textContent="Deleting...";' +
        'fetch(window.location.pathname,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({uid:uid,token:token})})' +
        '.then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d}});})' +
        '.then(function(x){if(x.ok){s.className="ok";s.textContent="Account deleted. You can close this tab.";f.style.display="none";}' +
        'else{s.className="err";s.textContent=(x.d&&x.d.error)||"Deletion failed.";b.disabled=false;b.textContent="Yes, delete my account";}})' +
        '.catch(function(){s.className="err";s.textContent="Network error.";b.disabled=false;b.textContent="Yes, delete my account";});' +
        '});' +
        '})();</script></body></html>'
      );
      return;
    }

    if (req.method !== 'POST') { res.status(405).end(); return; }

    // Per-IP rate limit — soft (XFF is spoofable in Cloud Run, see
    // rate-limit.js:37). Defence in depth. Per-uid check below is the
    // real gate.
    const rl = require('./upstash-ratelimit');
    try {
      if (!(await rl.httpRateLimit(req, res, 'confirmErasure:ip', 10, 3_600_000))) return;
    } catch (e) {
      logger.error('confirmAccountErasure rate-limit error', { err: e.message });
      res.status(500).json({ error: 'Rate limiter error' });
      return;
    }

    const uid   = (req.body && req.body.uid)   || '';
    const token = (req.body && req.body.token) || '';
    if (typeof uid !== 'string' || typeof token !== 'string' || !uid || token.length < 32) {
      res.status(400).json({ error: 'Invalid request' }); return;
    }

    // Per-uid rate limit — a single target can't be pounded even if the
    // attacker rotates IPs. 5 attempts / hour / uid is well above human
    // need (normally a single click) and below any reasonable brute.
    try {
      await rl.enforceRateLimit('confirmErasure:uid', uid, 5, 3_600_000);
    } catch (e) {
      if (e.rateLimited) {
        res.status(429).json({ error: 'Too many attempts for this account.' });
        return;
      }
      logger.error('confirmAccountErasure per-uid rl error', { err: e.message });
      res.status(500).json({ error: 'Rate limiter error' });
      return;
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

    // Cascade: delete all docs owned by this uid. Covers three
    // classes of data the pre-2026-04 implementation missed:
    //
    //   1. Flat-path userId-keyed collections (the original scope).
    //   2. collectionGroup for subcollection rows that carry a
    //      userId field — e.g. recordings live at
    //      leads/{leadId}/recordings/{id} with userId stamped on
    //      each. A flat collection() query against the parent path
    //      never reaches them.
    //   3. Owner-keyed Storage prefixes — audio, photos, docs,
    //      portals, galleries, reports, shared_docs, deal_rooms.
    //      Right-to-be-forgotten is not satisfied by deleting the
    //      Firestore doc while the binary payload stays in the
    //      bucket.
    const OWNED_COLLECTIONS = [
      'leads', 'estimates', 'photos', 'pins', 'tasks',
      'documents', 'training_sessions'
    ];
    // collectionGroup names we sweep for userId == uid. These are
    // subcollections that don't surface on flat-path queries.
    const OWNED_COLLECTION_GROUPS = [
      'recordings'   // leads/{leadId}/recordings/{id} — Voice Intelligence
    ];
    // Owner-keyed Storage prefixes. Every path here matches a rule
    // in storage.rules that keys on /{uid}/ in the second segment.
    const OWNED_STORAGE_PREFIXES = [
      'audio', 'photos', 'docs', 'portals', 'galleries',
      'reports', 'shared_docs', 'deal_rooms'
    ];

    // ── (1) flat-path collections ──
    for (const coll of OWNED_COLLECTIONS) {
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

    // ── (2) collectionGroup sweeps (subcollections with userId) ──
    for (const groupName of OWNED_COLLECTION_GROUPS) {
      try {
        while (true) {
          const snap = await db.collectionGroup(groupName)
            .where('userId', '==', uid)
            .limit(500)
            .get();
          if (snap.empty) break;
          const batch = db.batch();
          snap.docs.forEach(d => batch.delete(d.ref));
          await batch.commit();
          if (snap.size < 500) break;
        }
      } catch (e) {
        logger.warn('erasure: collectionGroup cascade failed for ' + groupName,
          { err: e.message });
      }
    }

    // ── (3) Storage prefix sweeps ──
    try {
      const bucket = admin.storage().bucket();
      for (const prefix of OWNED_STORAGE_PREFIXES) {
        try {
          await bucket.deleteFiles({ prefix: prefix + '/' + uid + '/', force: true });
        } catch (e) {
          logger.warn('erasure: storage sweep failed for ' + prefix, { err: e.message });
        }
      }
    } catch (e) {
      logger.warn('erasure: storage bucket unavailable', { err: e.message });
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

    // POST response: JSON. The GET landing page's inline JS uses this
    // to flip the UI into the success state. A direct POST from curl
    // gets a machine-readable acknowledgement.
    res.status(200).json({ success: true });
  }
);

module.exports = exports;
