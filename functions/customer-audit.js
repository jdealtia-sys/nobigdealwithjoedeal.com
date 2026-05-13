/**
 * customer-audit.js — server-side capture of customer-side activity.
 *
 * The audit flagged "no customer-side audit log" as a real gap: rep
 * needs to know which photos a homeowner viewed and when, especially
 * at adjuster-dispute time ("the homeowner saw these 12 photos before
 * signing the supplement").
 *
 * Architecture:
 *   - portal.html POSTs to /recordCustomerEvent with { token, type,
 *     resourceId? } whenever something audit-worthy happens (page open,
 *     photo view, estimate view, document view).
 *   - This function validates the portal token (same shape as
 *     getHomeownerPortalView), then writes a row to
 *     customerAuditEvents/{eventId} stamped with the lead, owner,
 *     resource, IP, user-agent, and timestamp.
 *   - The rep reads them from customer.html via the standard owner-
 *     scoped Firestore query (lead doc page).
 *
 * Privacy:
 *   - We capture IP + UA for evidence value but TRUNCATE the UA at 200
 *     chars and never store anything beyond what we already have via
 *     portal_tokens.uses anyway.
 *   - Per the GDPR registry, customerAuditEvents/{id} carries ownerUid
 *     so erasure cascade reaches it.
 */

'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');

const { httpRateLimit } = require('./integrations/upstash-ratelimit');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nbd-pro.web.app',
];

const ALLOWED_TYPES = new Set([
  'portal_open',
  'photo_view',
  'estimate_view',
  'document_view',
  'photo_upload',  // homeowner-uploaded photo (paired with the existing uploadHomeownerPhoto event log)
]);

exports.recordCustomerEvent = onRequest({
  region: 'us-central1',
  cors: CORS_ORIGINS,
  maxInstances: 40,
  concurrency: 80,
  timeoutSeconds: 10,
  memory: '256MiB',
}, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).end(); return; }

  // Per-IP cap. Homeowner page bursts a portal_open + a few photo_views
  // on first paint; 60/min/IP swallows that and blocks pathological loops.
  if (!(await httpRateLimit(req, res, 'customerAudit:ip', 60, 60_000))) return;

  const body = req.body || {};
  const token = typeof body.token === 'string' ? body.token : '';
  const type  = typeof body.type === 'string' ? body.type : '';
  const resourceId = typeof body.resourceId === 'string'
    ? body.resourceId.slice(0, 200)
    : null;

  if (!token || token.length < 10 || token.length > 64) {
    res.status(400).json({ error: 'Invalid token' });
    return;
  }
  if (!ALLOWED_TYPES.has(type)) {
    res.status(400).json({ error: 'Invalid event type' });
    return;
  }

  const db = admin.firestore();
  const tokSnap = await db.doc(`portal_tokens/${token}`).get();
  if (!tokSnap.exists) { res.status(404).json({ error: 'Invalid link' }); return; }
  const tok = tokSnap.data();
  if (tok.expiresAt && tok.expiresAt.toMillis && tok.expiresAt.toMillis() < Date.now()) {
    res.status(410).json({ error: 'Token expired' });
    return;
  }

  const ua = String(req.headers['user-agent'] || '').slice(0, 200);
  // IP — best-effort. Cloud Run forwards via x-forwarded-for; first
  // hop in the chain is the real client. Truncate to be safe.
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || (req.connection && req.connection.remoteAddress) || '';

  try {
    await db.collection('customerAuditEvents').add({
      leadId:     tok.leadId,
      ownerUid:   tok.ownerUid,
      tokenId:    token,
      type:       type,
      resourceId: resourceId,
      ip:         ip.slice(0, 64),
      userAgent:  ua,
      createdAt:  admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    logger.warn('customerAudit.write_failed', { err: e.message, type });
    // Don't fail the response — telemetry, not load-bearing.
  }

  res.status(204).end();
});

// Test-only export for unit checks.
exports._test = { ALLOWED_TYPES };
