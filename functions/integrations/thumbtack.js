/**
 * functions/integrations/thumbtack.js — Thumbtack webhook receiver.
 *
 * Thumbtack ships a free, native webhook to every pro (Apps → Webhooks →
 * Manage webhooks). It pushes three event kinds at a URL you nominate:
 *   • Lead details — new leads received, job details, status updates
 *   • Messages     — new messages from customers
 *   • Reviews      — new reviews from customers
 *
 * WHY THIS EXISTS
 * The Aug 2026 lead-channel audit found every Thumbtack loss traced to speed
 * or silence, never to price or lead quality. Replies inside ~2 minutes won
 * ($250 off a $23.38 lead; $140 off a $9.40 lead; $2,500 off a $20.78 lead);
 * replies at 1h44m, 7h58m and 11h06m lost — including leads where NBD was the
 * ONLY pro who responded at all. Separately, 15 of 38 people were owed
 * something Joe said he'd send. This endpoint attacks both: a lead lands in
 * the CRM and pages Joe within seconds of Thumbtack creating it, and a
 * customer reply raises a visible record instead of sitting in an app.
 *
 * WHAT IT CANNOT DO
 * Thumbtack webhooks are explicitly ONE-WAY. We receive; we cannot send. There
 * is no auto-reply here and there cannot be — replies still happen inside
 * Thumbtack. This buys notification speed and automatic capture, nothing more.
 * Do not add an "auto-respond" feature on top of this and expect it to reach
 * the customer.
 *
 * SETUP (endpoint FIRST, webhook second — per Thumbtack's own guidance)
 *   1. Generate a long random token (32+ bytes):
 *        node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *   2. firebase functions:secrets:set THUMBTACK_WEBHOOK_SECRET
 *   3. Deploy, then confirm the URL responds:
 *        https://us-central1-nobigdeal-pro.cloudfunctions.net/thumbtackWebhook
 *   4. Thumbtack → Apps → Webhooks → Manage webhooks → Create webhook
 *        Endpoint URL:       <the URL above>
 *        Authorization type: Custom Header
 *          Header name:      X-NBD-Webhook-Token   (or set THUMBTACK_WEBHOOK_HEADER)
 *          Header value:     <the token from step 1>
 *        Profile:            No Big Deal Home Solutions
 *        Receive:            Lead details, Messages, Reviews
 *   5. Use "Test this webhook", then check the Recent deliveries tab for a 200.
 *      Test payloads are stored but deliberately NOT bridged into the pipeline.
 *
 * SECURITY POSTURE
 *   • Fails CLOSED when the secret is unset (503) — an unauthenticated writer
 *     who knows the URL could otherwise stuff the CRM pipeline.
 *   • Constant-time token compare (no early-exit timing oracle).
 *   • Body size capped before any parsing work.
 *   • Logs carry ids and classification only — never customer name or phone.
 *
 * IDEMPOTENCY
 * Thumbtack retries failed deliveries and exposes a manual resend. Every doc
 * uses a deterministic id derived from Thumbtack's own event id (content hash
 * when absent) and is written with create(), so a re-delivery is a logged
 * no-op rather than a duplicate lead. Duplicates still answer 2xx — a non-2xx
 * would make Thumbtack retry the same already-stored event forever.
 */

'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const crypto = require('crypto');

const { getSecret, hasSecret, SECRETS } = require('./_shared');
const T = require('./thumbtack-logic');

// Header name Thumbtack will send the shared token in. Configurable by env so
// it can be rotated/renamed without a code change; the DEFAULT is what the
// setup notes above tell you to type into the Thumbtack form.
const TOKEN_HEADER = (process.env.THUMBTACK_WEBHOOK_HEADER || 'x-nbd-webhook-token').toLowerCase();

// Thumbtack lead payloads are small (a name, a phone, a job description).
// Anything past 256 KB is not a lead we sent for.
const MAX_BODY_BYTES = 256 * 1024;

// Constant-time compare that doesn't leak length via an early return.
// crypto.timingSafeEqual throws on length mismatch, so hash both sides first —
// equal-length digests, one comparison, no oracle.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a == null ? '' : a)).digest();
  const hb = crypto.createHash('sha256').update(String(b == null ? '' : b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Pull the presented token from either auth style Thumbtack offers.
// Custom Header is what we recommend and document; Basic is accepted so the
// webhook can be re-pointed without a redeploy if that's ever easier.
function presentedToken(req) {
  const custom = req.headers[TOKEN_HEADER];
  if (custom) return String(custom);

  const auth = String(req.headers['authorization'] || '');
  if (/^Basic\s+/i.test(auth)) {
    try {
      const decoded = Buffer.from(auth.replace(/^Basic\s+/i, ''), 'base64').toString('utf8');
      // "user:pass" — the token may be either half depending on how it was
      // entered. Prefer the password half, fall back to the whole string.
      const idx = decoded.indexOf(':');
      return idx === -1 ? decoded : decoded.slice(idx + 1);
    } catch (_) { return ''; }
  }
  return '';
}

// Firestore doc ids may not contain '/' and are capped at 1500 bytes. Thumbtack
// ids are opaque, so sanitize rather than trust.
function safeDocId(prefix, raw) {
  const cleaned = String(raw).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 200);
  return prefix + '_' + cleaned;
}

exports.thumbtackWebhook = onRequest(
  {
    region: 'us-central1',
    maxInstances: 10,
    timeoutSeconds: 15,
    memory: '256MiB',
    secrets: [SECRETS.THUMBTACK_WEBHOOK_SECRET],
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }

    // Fail closed. Same posture as calcomWebhook: accepting unauthenticated
    // calls means anyone who learns the URL can write leads into the pipeline.
    if (!hasSecret('THUMBTACK_WEBHOOK_SECRET')) {
      logger.error('thumbtackWebhook: THUMBTACK_WEBHOOK_SECRET not set — rejecting');
      res.status(503).json({ error: 'Webhook not configured' });
      return;
    }

    const token = presentedToken(req);
    if (!token || !safeEqual(token, getSecret('THUMBTACK_WEBHOOK_SECRET'))) {
      // 401 (not 403): the credential is missing or wrong, and Thumbtack's
      // delivery log surfaces the status code so this is diagnosable.
      logger.warn('thumbtackWebhook: bad or missing token');
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (req.rawBody && Buffer.isBuffer(req.rawBody) && req.rawBody.length > MAX_BODY_BYTES) {
      res.status(413).json({ error: 'Payload too large' });
      return;
    }

    // onRequest parses JSON bodies for us, but never assume: a text/plain or
    // form-encoded delivery arrives as a string.
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (_) { body = { _unparsed: String(req.body).slice(0, 10000) }; }
    }
    if (!body || typeof body !== 'object') body = {};

    const event = T.classifyEvent(body);
    const isTest = T.isTestPayload(body);
    const collection = T.COLLECTION_BY_EVENT[event] || T.COLLECTION_BY_EVENT[T.EVENT.UNKNOWN];

    // Deterministic id: Thumbtack's own id when present, else a hash of the
    // payload so an identical re-delivery still collides instead of duplicating.
    const eventId = T.extractEventId(body);
    const idBasis = eventId || crypto
      .createHash('sha256')
      .update(JSON.stringify(body))
      .digest('hex')
      .slice(0, 32);
    const docId = safeDocId(event, idBasis);

    const doc = {
      // Provenance — how this arrived, so the CRM card and any later audit can
      // tell a Thumbtack push from a website form or a hand-typed lead.
      source: 'Thumbtack',
      thumbtackEvent: event,
      thumbtackEventId: eventId || '',
      isTest,
      // The COMPLETE payload, verbatim. Thumbtack does not publish a schema;
      // this is what lets us tighten thumbtack-logic's field mapping after the
      // first real delivery instead of having thrown the evidence away.
      raw: body,
      receivedAt: FieldValue.serverTimestamp(),
    };

    // Leads get normalized up front so the bridge (and the pipeline card) has
    // real fields to work with. Messages/reviews keep their raw shape — they
    // are activity records, not leads.
    if (event === T.EVENT.LEAD) {
      Object.assign(doc, T.normalizeLead(body));
      doc.notes = T.leadNotes(doc);
    }

    try {
      // create() (not set()) so a re-delivery hits ALREADY_EXISTS rather than
      // overwriting a record a rep may already have worked.
      await getFirestore().collection(collection).doc(docId).create(doc);
      logger.info('thumbtackWebhook: stored', { collection, docId, event, isTest });
    } catch (e) {
      if (e && (e.code === 6 || /already exists/i.test(e.message || ''))) {
        // 2xx on purpose — see the IDEMPOTENCY note in the header.
        logger.info('thumbtackWebhook: duplicate delivery — idempotent skip', { collection, docId, event });
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }
      logger.error('thumbtackWebhook: write failed', { collection, docId, event, err: e && e.message });
      // 5xx so Thumbtack retries a genuinely failed write.
      res.status(500).json({ error: 'Store failed' });
      return;
    }

    res.status(200).json({ ok: true, event, test: isTest });
  }
);
