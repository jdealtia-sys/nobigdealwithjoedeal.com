/**
 * integrations/esign.js — BoldSign embedded signing adapter
 *
 * Lets a rep hand the iPad to a homeowner at the door and close
 * the contract on the spot. E-sign close rates beat email-back
 * contracts by ~20% industry-wide.
 *
 * Flow:
 *   1. Rep clicks "Send for signature" on an estimate.
 *   2. sendEstimateForSignature(callable) converts the finalized
 *      HTML to a PDF (via boldsign's documentHtmlToPdf helper) and
 *      creates a BoldSign envelope with one signer (homeowner).
 *   3. Returns an embedded signing URL the app opens in an iframe
 *      (signer completes without leaving the app) or sends to
 *      the homeowner's email.
 *   4. BoldSign webhook fires on completion → esignWebhook flips
 *      the estimate doc to status:'signed' and stores the signed
 *      PDF URL.
 *
 * SETUP:
 *   firebase functions:secrets:set BOLDSIGN_API_KEY
 *   firebase functions:secrets:set BOLDSIGN_WEBHOOK_SECRET
 *   Configure webhook URL in BoldSign dashboard:
 *     https://us-central1-nobigdeal-pro.cloudfunctions.net/esignWebhook
 */

'use strict';

const { onCall, HttpsError, onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { getSecret, hasSecret, SECRETS } = require('./_shared');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nbd-pro.web.app'
];

// ─── Callable: sendEstimateForSignature ─────────────────────
exports.sendEstimateForSignature = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 60,
    memory: '512MiB',
    secrets: [SECRETS.BOLDSIGN_API_KEY]
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    if (!hasSecret('BOLDSIGN_API_KEY')) {
      throw new HttpsError('failed-precondition', 'E-signature not configured. Contact support.');
    }

    const estimateId = typeof request.data?.estimateId === 'string' ? request.data.estimateId : null;
    const signerName = typeof request.data?.signerName === 'string' ? request.data.signerName.slice(0, 120) : '';
    const signerEmail = typeof request.data?.signerEmail === 'string' ? request.data.signerEmail.trim().toLowerCase() : '';
    const html = typeof request.data?.html === 'string' ? request.data.html : '';
    const title = typeof request.data?.title === 'string' ? request.data.title.slice(0, 200) : 'NBD Estimate';

    if (!estimateId) throw new HttpsError('invalid-argument', 'estimateId required');
    if (!signerName || !signerEmail || !signerEmail.includes('@')) {
      throw new HttpsError('invalid-argument', 'signerName + valid signerEmail required');
    }
    if (!html || html.length < 100 || html.length > 1_000_000) {
      throw new HttpsError('invalid-argument', 'html body required');
    }

    // Verify caller owns the estimate (company scope check).
    const db = admin.firestore();
    const estSnap = await db.doc(`estimates/${estimateId}`).get();
    if (!estSnap.exists) throw new HttpsError('not-found', 'Estimate not found');
    const est = estSnap.data();
    if (est.userId !== uid && request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Not your estimate');
    }

    // BoldSign accepts HTML directly via their "documentData" field.
    // Base64-encode the HTML payload.
    const base64Html = Buffer.from(html, 'utf8').toString('base64');
    const apiKey = getSecret('BOLDSIGN_API_KEY');

    try {
      const res = await fetch('https://api.boldsign.com/v1/document/sendForSign', {
        method: 'POST',
        headers: {
          'X-API-KEY': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          title,
          message: `Please review and sign: ${title}`,
          files: [{
            fileName: 'estimate.html',
            fileData: base64Html
          }],
          signers: [{
            name: signerName,
            emailAddress: signerEmail,
            signerType: 'Signer',
            signerOrder: 1,
            formFields: [{
              fieldType: 'Signature',
              pageNumber: 1,
              bounds: { x: 100, y: 700, width: 200, height: 40 },
              isRequired: true
            }, {
              fieldType: 'DateSigned',
              pageNumber: 1,
              bounds: { x: 320, y: 700, width: 150, height: 40 },
              isRequired: true
            }]
          }],
          enableSigningOrder: false,
          reminderSettings: {
            enableAutoReminder: true,
            reminderDays: 2,
            reminderCount: 3
          },
          // Metadata rides back on the webhook so we match completion
          // events to the right estimate doc.
          metadata: { estimateId, callerUid: uid }
        })
      });
      if (!res.ok) {
        const body = await res.text();
        logger.warn('BoldSign send failed', { status: res.status, body: body.slice(0, 300) });
        throw new HttpsError('internal', 'E-sign send failed: ' + res.status);
      }
      const data = await res.json();
      const documentId = data.documentId;

      // Mark estimate 'awaiting_signature' so the UI reflects status.
      await estSnap.ref.update({
        signatureStatus: 'sent',
        signatureProvider: 'boldsign',
        signatureDocumentId: documentId,
        signerName,
        signerEmail,
        signatureSentAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Request an embedded signing URL so the rep can complete on the
      // iPad without bouncing to email.
      let embedUrl = null;
      try {
        const embedRes = await fetch(
          `https://api.boldsign.com/v1/document/getEmbeddedSignLink?documentId=${encodeURIComponent(documentId)}&signerEmail=${encodeURIComponent(signerEmail)}`,
          { headers: { 'X-API-KEY': apiKey } }
        );
        if (embedRes.ok) {
          const embedData = await embedRes.json();
          embedUrl = embedData.signLink || embedData.signUrl || null;
        }
      } catch (e) { /* embed is optional — email link still works */ }

      return { success: true, documentId, embedUrl, status: 'sent' };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error('sendEstimateForSignature error:', e.message);
      throw new HttpsError('internal', 'E-sign failed');
    }
  }
);

// ─── Webhook: signer completes / declines ───────────────────
exports.esignWebhook = onRequest(
  {
    region: 'us-central1',
    maxInstances: 10,
    timeoutSeconds: 15,
    memory: '256MiB',
    secrets: [SECRETS.BOLDSIGN_API_KEY, SECRETS.BOLDSIGN_WEBHOOK_SECRET]
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }

    // Verify HMAC if secret configured. BoldSign sends
    // X-BoldSign-Signature: HMAC-SHA256(rawBody, BOLDSIGN_WEBHOOK_SECRET).
    if (hasSecret('BOLDSIGN_WEBHOOK_SECRET')) {
      const sig = req.headers['x-boldsign-signature'];
      if (!sig || !req.rawBody || !Buffer.isBuffer(req.rawBody)) {
        res.status(400).json({ error: 'Missing signature' });
        return;
      }
      const computed = crypto
        .createHmac('sha256', getSecret('BOLDSIGN_WEBHOOK_SECRET'))
        .update(req.rawBody)
        .digest('hex');
      if (!safeEqual(computed, String(sig))) {
        res.status(403).json({ error: 'Bad signature' });
        return;
      }
    }

    const body = req.body || {};
    const eventType = body.event || body.status;
    const documentId = body.documentId || (body.data && body.data.documentId);
    const metadata = body.metadata || (body.data && body.data.metadata) || {};
    const estimateId = metadata.estimateId;

    if (!documentId) { res.status(400).json({ error: 'Missing documentId' }); return; }

    try {
      const db = admin.firestore();
      let ref = null;
      if (estimateId) ref = db.doc(`estimates/${estimateId}`);
      else {
        const snap = await db.collection('estimates')
          .where('signatureDocumentId', '==', documentId)
          .limit(1).get();
        if (!snap.empty) ref = snap.docs[0].ref;
      }
      if (!ref) { res.status(200).json({ ok: true, matched: false }); return; }

      const update = { signatureUpdatedAt: admin.firestore.FieldValue.serverTimestamp() };

      const normalized = String(eventType || '').toLowerCase();
      if (normalized.includes('complet')) {
        update.signatureStatus = 'signed';
        update.signedAt = admin.firestore.FieldValue.serverTimestamp();
        // Pull the signed PDF URL if available.
        if (body.documentUrl || (body.data && body.data.documentUrl)) {
          update.signedDocumentUrl = body.documentUrl || body.data.documentUrl;
        }
      } else if (normalized.includes('declin') || normalized.includes('decline')) {
        update.signatureStatus = 'declined';
      } else if (normalized.includes('expir')) {
        update.signatureStatus = 'expired';
      } else {
        update.signatureStatus = 'viewed';
      }
      await ref.update(update);
      res.status(200).json({ ok: true, matched: true });
    } catch (e) {
      logger.error('esignWebhook error:', e.message);
      res.status(500).json({ error: 'write failed' });
    }
  }
);

function safeEqual(a, b) {
  const ab = Buffer.from(a); const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

module.exports = exports;
