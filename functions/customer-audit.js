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
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions/v2');
const { getFirestore } = require('firebase-admin/firestore');
const { FieldValue } = require('firebase-admin/firestore');

const { httpRateLimit } = require('./integrations/upstash-ratelimit');
const { freshViewNotifId, shouldNotify, buildFreshViewNotif } = require('./fresh-view-logic');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
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

  if (typeof token !== 'string' || !/^[A-Za-z0-9]{10,64}$/.test(token)) {
    res.status(400).json({ error: 'Invalid token' });
    return;
  }
  if (!ALLOWED_TYPES.has(type)) {
    res.status(400).json({ error: 'Invalid event type' });
    return;
  }

  const db = getFirestore();
  const tokSnap = await db.doc(`portal_tokens/${token}`).get();
  if (!tokSnap.exists) { res.status(404).json({ error: 'Invalid link' }); return; }
  const tok = tokSnap.data();
  if (tok.expiresAt && tok.expiresAt.toMillis && tok.expiresAt.toMillis() < Date.now()) {
    res.status(410).json({ error: 'Token expired' });
    return;
  }
  // Honor the replay cap like the other token endpoints (QA finding).
  if (typeof tok.maxUses === 'number' && (tok.uses || 0) >= tok.maxUses) {
    res.status(410).json({ error: 'Link exhausted' });
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
      createdAt:  FieldValue.serverTimestamp(),
    });
  } catch (e) {
    logger.warn('customerAudit.write_failed', { err: e.message, type });
    // Don't fail the response — telemetry, not load-bearing.
  }

  res.status(204).end();
});

// ── idea #3 Phase 2: real-time buying-intent strike ──────────────────────
// When a homeowner opens their estimate, recordCustomerEvent writes a
// customerAuditEvents doc of type 'estimate_view'. This trigger turns that into
// a real-time push: it writes a notification onto the owner's live feed (the
// same `notifications` collection the dashboard onSnapshot-subscribes to via
// crm-snooze.js), so the top-center strike card and the notif bell fire the
// MOMENT they open — instead of waiting for the client's next refresh cadence.
//
// Idempotent + de-spammed: a deterministic per-owner+lead doc id means a
// re-open UPDATES the same feed entry, and a 30-minute cooldown suppresses the
// burst of estimate_view events a single page refresh emits.
//
// Literal `exports.x = onDocumentCreated(...)` on one line — the deploy
// workflow's function-enumeration grep requires this form.
const FRESH_VIEW_COOLDOWN_MS = 30 * 60 * 1000;

exports.onEstimateViewedStrike = onDocumentCreated('customerAuditEvents/{eventId}', async (event) => {
  const ev = event.data && event.data.data();
  if (!ev || ev.type !== 'estimate_view') return;
  const ownerUid = ev.ownerUid;
  const leadId = ev.leadId || null;
  if (!ownerUid || !leadId) return;
  const estimateId = ev.resourceId || null;

  const db = getFirestore();
  const notifRef = db.collection('notifications').doc(freshViewNotifId(ownerUid, leadId));

  try {
    // Cooldown check against the last strike for this lead.
    const prev = await notifRef.get();
    if (prev.exists) {
      const p = prev.data() || {};
      const prevMs = p.createdAt && typeof p.createdAt.toMillis === 'function' ? p.createdAt.toMillis() : 0;
      if (!shouldNotify(prevMs, Date.now(), FRESH_VIEW_COOLDOWN_MS)) return;
    }

    // Best-effort enrichment for the message (name + estimate amount). A failed
    // lookup just yields a generic "A customer is viewing…" message.
    let customerName = null;
    let customerPhone = null;
    let amount = 0;
    try {
      const leadSnap = await db.collection('leads').doc(leadId).get();
      if (leadSnap.exists) {
        const L = leadSnap.data() || {};
        customerName = ((L.firstName || '') + ' ' + (L.lastName || '')).trim() || null;
        customerPhone = L.phone || null;
      }
    } catch (_) { /* generic message */ }
    if (estimateId) {
      try {
        const estSnap = await db.collection('estimates').doc(estimateId).get();
        if (estSnap.exists) {
          const E = estSnap.data() || {};
          amount = Number(E.total || E.grandTotal || E.amount || 0) || 0;
        }
      } catch (_) { /* no amount in message */ }
    }

    const notif = buildFreshViewNotif({ ownerUid, leadId, estimateId, customerName, customerPhone, amount });
    // set (no merge) with a fresh serverTimestamp so a re-view bumps the entry
    // to the top of the feed and re-marks it unread.
    await notifRef.set(Object.assign({}, notif, { createdAt: FieldValue.serverTimestamp() }));
    logger.info('[onEstimateViewedStrike] strike pushed', { ownerUid, leadId, estimateId: estimateId || null });
  } catch (e) {
    logger.warn('[onEstimateViewedStrike] failed', { leadId, err: e && e.message });
  }
});

// Test-only export for unit checks.
exports._test = { ALLOWED_TYPES };
