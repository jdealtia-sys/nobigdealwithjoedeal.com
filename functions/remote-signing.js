/**
 * functions/remote-signing.js — Signatures PR4/5: canvas remote signing
 *
 * Lets a rep email a homeowner a link to sign a generated document
 * remotely (no login). Mirrors the audited portal.js token model:
 *   - doc_sign_tokens/{token} is admin-SDK only (firestore.rules)
 *   - token = 24 chars over a 32-char no-confusable alphabet (~120 bits),
 *     infeasible to brute-force against the per-IP rate limit
 *   - 7-day server-checked expiry; SINGLE-USE (burned atomically on submit)
 *
 * Exports:
 *   createSignRequest (onCall)    — rep mints a token for a persisted doc
 *                                   + emails the homeowner the sign link (PR5)
 *   getSignDocument   (onRequest) — homeowner POSTs token → doc HTML to sign
 *   submitSignature   (onRequest) — homeowner POSTs token + signed HTML →
 *                                   burns the token, stores the signed doc,
 *                                   notifies the rep
 *
 * The doc HTML is the one the generator already uploaded to Storage at
 * leads/{leadId}/documents/{docId}.htmlPath (interactive, with the
 * data-nbd-sig widget blocks). getSignDocument serves it; the public
 * /pro/sign.html renders it in a sandboxed iframe + runs signature-widget.js.
 *
 * Security exception: the two homeowner endpoints are NOT App-Check or
 * Firebase-auth gated — that's the whole point of a no-login signing link.
 * Compensating controls: unguessable token + 7-day expiry + single-use burn
 * + per-IP rate limit + CORS lockdown + signed-HTML size cap.
 */
'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { httpRateLimit } = require('./integrations/upstash-ratelimit');
const { callableRateLimit } = require('./shared');

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const EMAIL_FROM = defineSecret('EMAIL_FROM');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];
const SIGN_URL_BASE = 'https://nobigdealwithjoedeal.com/pro/sign.html?token=';

// 32-char no-confusable alphabet (no 0/O, 1/I/L) — same as portal.js.
const SIGN_TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function mintSignToken() {
  const bytes = require('crypto').randomBytes(24);
  let s = '';
  for (const b of bytes) s += SIGN_TOKEN_ALPHABET[b % SIGN_TOKEN_ALPHABET.length];
  return s;
}

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ═══════════════════════════════════════════════════════════════
// createSignRequest — rep mints a token + emails the sign link.
// ═══════════════════════════════════════════════════════════════
exports.createSignRequest = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    secrets: [RESEND_API_KEY, EMAIL_FROM],
    timeoutSeconds: 20,
    memory: '256MiB',
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    // A compromised rep session could otherwise mint tokens / send mail
    // in a loop. 20/min/uid is far above any real workflow.
    await callableRateLimit(request, 'createSignRequest', 20, 60_000);

    const d = request.data || {};
    const leadId = typeof d.leadId === 'string' ? d.leadId : null;
    const docId = typeof d.docId === 'string' ? d.docId : null;
    const signerEmail = typeof d.signerEmail === 'string' ? d.signerEmail.trim() : '';
    const signerName = typeof d.signerName === 'string' ? d.signerName.trim().slice(0, 120) : '';
    if (!leadId || !docId) throw new HttpsError('invalid-argument', 'leadId and docId required');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(signerEmail)) {
      throw new HttpsError('invalid-argument', 'A valid signer email is required');
    }

    const db = admin.firestore();
    // Owner-scope: the rep must own the lead (or be platform admin).
    const leadSnap = await db.doc(`leads/${leadId}`).get();
    if (!leadSnap.exists) throw new HttpsError('not-found', 'Lead not found');
    const lead = leadSnap.data();
    const isAdmin = request.auth.token.role === 'admin';
    if (lead.userId !== uid && !isAdmin) throw new HttpsError('permission-denied', 'Not your lead');

    // The document must already be persisted (the generator uploaded its
    // interactive HTML to Storage). We sign THAT doc, not arbitrary HTML.
    const docSnap = await db.doc(`leads/${leadId}/documents/${docId}`).get();
    if (!docSnap.exists) throw new HttpsError('not-found', 'Document not found');
    const docMeta = docSnap.data();
    const htmlPath = docMeta.htmlPath || null;
    if (!htmlPath) throw new HttpsError('failed-precondition', 'This document has no signable HTML on file');

    const now = Date.now();
    const ttlDays = 7;
    const expiresAt = admin.firestore.Timestamp.fromMillis(now + ttlDays * 86_400_000);
    const token = mintSignToken();

    await db.doc(`doc_sign_tokens/${token}`).set({
      leadId,
      docId,
      ownerUid: lead.userId,
      mintedBy: uid,
      htmlPath,
      docTypeName: docMeta.typeName || docMeta.type || 'Document',
      signerName: signerName || (lead.firstName ? `${lead.firstName} ${lead.lastName || ''}`.trim() : ''),
      signerEmail,
      status: 'pending',
      mintedAt: FieldValue.serverTimestamp(),
      expiresAt,
    });

    // PR5: email the homeowner the signing link via Resend (same provider
    // as email-functions.js). Best-effort — the token is already minted,
    // so a transient mail failure surfaces to the rep without losing it.
    let emailed = false;
    try {
      const { Resend } = require('resend');
      const resend = new Resend(RESEND_API_KEY.value());
      const fromEmail = EMAIL_FROM.value() || 'noreply@nobigdealwithjoedeal.com';
      const link = SIGN_URL_BASE + token;
      const docName = escHtml(docMeta.typeName || docMeta.type || 'document');
      const repName = escHtml(lead.repName || 'No Big Deal Home Solutions');
      await resend.emails.send({
        from: fromEmail,
        to: signerEmail,
        subject: `Please sign your ${docName}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e;">
          <p>Hi ${escHtml(signerName || lead.firstName || 'there')},</p>
          <p>${repName} has a <strong>${docName}</strong> ready for your signature. It only takes a minute — just tap the button, sign on your phone, and you're done.</p>
          <p style="text-align:center;margin:28px 0;">
            <a href="${escHtml(link)}" style="background:#e8720c;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:700;display:inline-block;">Review &amp; Sign</a>
          </p>
          <p style="font-size:12px;color:#666;">This secure link expires in 7 days and can only be used once. If you didn't expect this, you can ignore the email.</p>
        </div>`,
      });
      emailed = true;
    } catch (e) {
      logger.warn('[createSignRequest] email send failed', { leadId, docId, err: e.message });
    }

    logger.info('[createSignRequest] minted', { leadId, docId, emailed });
    return { token, expiresAt: expiresAt.toMillis(), emailed, signLink: SIGN_URL_BASE + token };
  }
);

// ═══════════════════════════════════════════════════════════════
// getSignDocument — homeowner POSTs token → the doc HTML to sign.
// ═══════════════════════════════════════════════════════════════
exports.getSignDocument = onRequest(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    maxInstances: 40,
    concurrency: 40,
    timeoutSeconds: 15,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    // Per-IP rate limit — stops token brute-forcing.
    if (!(await httpRateLimit(req, res, 'docsign-get:ip', 30, 60_000))) return;

    const token = (req.body && req.body.token) || '';
    if (typeof token !== 'string' || token.length < 10 || token.length > 64) {
      res.status(400).json({ error: 'Invalid link' }); return;
    }

    const db = admin.firestore();
    const tokSnap = await db.doc(`doc_sign_tokens/${token}`).get();
    if (!tokSnap.exists) { res.status(404).json({ error: 'Invalid link' }); return; }
    const tok = tokSnap.data();
    if (tok.expiresAt && tok.expiresAt.toMillis && tok.expiresAt.toMillis() < Date.now()) {
      res.status(410).json({ error: 'This signing link has expired. Contact your rep for a new one.' }); return;
    }
    if (tok.status !== 'pending') {
      res.status(410).json({ error: 'This document has already been signed.' }); return;
    }

    // Serve the interactive doc HTML the generator uploaded to Storage.
    let html = '';
    try {
      const file = admin.storage().bucket().file(tok.htmlPath);
      const [buf] = await file.download();
      html = buf.toString('utf8');
    } catch (e) {
      logger.error('[getSignDocument] html fetch failed', { token: token.slice(0, 6), err: e.message });
      res.status(500).json({ error: 'Could not load the document. Try again shortly.' }); return;
    }

    // Fire-and-forget viewed stamp (does not gate the response).
    db.doc(`doc_sign_tokens/${token}`).update({
      viewedAt: FieldValue.serverTimestamp(),
    }).catch(() => {});

    // Only the minimum the sign page needs — no lead internals.
    res.status(200).json({
      html,
      docTypeName: tok.docTypeName || 'Document',
      signerName: tok.signerName || '',
    });
  }
);

// ═══════════════════════════════════════════════════════════════
// submitSignature — homeowner POSTs token + signed HTML → burn + store.
// ═══════════════════════════════════════════════════════════════
exports.submitSignature = onRequest(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    maxInstances: 40,
    concurrency: 40,
    timeoutSeconds: 30,
    memory: '512MiB', // signed HTML can carry embedded PNG dataURLs
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    if (!(await httpRateLimit(req, res, 'docsign-submit:ip', 20, 60_000))) return;

    const { token, signedHtml } = req.body || {};
    if (typeof token !== 'string' || token.length < 10 || token.length > 64) {
      res.status(400).json({ error: 'Invalid link' }); return;
    }
    if (typeof signedHtml !== 'string' || signedHtml.length < 50) {
      res.status(400).json({ error: 'Signed document missing' }); return;
    }
    // Hard cap — a signed doc with a few embedded signature PNGs is well
    // under this; anything larger is abuse.
    if (signedHtml.length > 6 * 1024 * 1024) {
      res.status(413).json({ error: 'Signed document too large' }); return;
    }

    const db = admin.firestore();
    const tokRef = db.doc(`doc_sign_tokens/${token}`);

    // ATOMIC single-use burn: flip pending → signed inside a transaction
    // so two concurrent submits can't both sign (TOCTOU). Mirrors the
    // portal.js write-once pattern.
    let info;
    try {
      info = await db.runTransaction(async (tx) => {
        const snap = await tx.get(tokRef);
        if (!snap.exists) { const e = new Error('nf'); e._http = 404; e._msg = 'Invalid link'; throw e; }
        const t = snap.data();
        if (t.expiresAt && t.expiresAt.toMillis && t.expiresAt.toMillis() < Date.now()) {
          const e = new Error('exp'); e._http = 410; e._msg = 'This signing link has expired.'; throw e;
        }
        if (t.status !== 'pending') {
          const e = new Error('done'); e._http = 409; e._msg = 'This document has already been signed.'; throw e;
        }
        tx.update(tokRef, { status: 'signed', signedAt: FieldValue.serverTimestamp() });
        return { leadId: t.leadId, docId: t.docId, ownerUid: t.ownerUid, htmlPath: t.htmlPath, signerName: t.signerName || '' };
      });
    } catch (err) {
      if (err && err._http) { res.status(err._http).json({ error: err._msg }); return; }
      logger.error('[submitSignature] burn txn failed', { msg: err.message });
      res.status(500).json({ error: 'Could not record your signature. Try again.' }); return;
    }

    // Token is now burned. Persist the signed HTML + notify the rep.
    // A failure here can't double-sign (status already flipped); we log
    // and still return success so the homeowner isn't asked to re-sign.
    try {
      // Overwrite the doc's Storage object with the signed version so the
      // rep re-opens the signed copy from the documents tab.
      const file = admin.storage().bucket().file(info.htmlPath);
      await file.save(Buffer.from(signedHtml, 'utf8'), { contentType: 'text/html', resumable: false });
    } catch (e) {
      logger.warn('[submitSignature] signed html upload failed', { msg: e.message });
    }
    try {
      await db.doc(`leads/${info.leadId}/documents/${info.docId}`).set({
        signedAt: FieldValue.serverTimestamp(),
        signedRemotely: true,
        remoteSignerName: info.signerName || null,
      }, { merge: true });
    } catch (e) { logger.warn('[submitSignature] doc meta stamp failed', { msg: e.message }); }
    try {
      await db.collection('notifications').add({
        userId: info.ownerUid,
        type: 'remote_signature',
        leadId: info.leadId,
        title: 'Document signed',
        message: (info.signerName ? info.signerName + ' ' : 'A homeowner ') + 'signed a document remotely.',
        priority: 'high',
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) { logger.warn('[submitSignature] notify failed', { msg: e.message }); }

    res.status(200).json({ ok: true });
  }
);
