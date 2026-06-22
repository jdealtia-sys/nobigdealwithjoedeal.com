/**
 * functions/deal-acceptance.js — Close Board deal acceptance (1a)
 *
 * Lets a rep share a Close Board deal room with a homeowner who can pick a
 * tier, sign, and ACCEPT remotely (no login) — and have that acceptance
 * actually recorded. Previously the deal-room's ACCEPT button was a
 * console.log stub (the success overlay showed but nothing persisted).
 *
 * Mirrors the audited remote-signing.js / portal.js token model:
 *   - deal_accept_tokens/{token} is admin-SDK only (firestore.rules)
 *   - token = 24 chars over a 32-char no-confusable alphabet (~120 bits),
 *     infeasible to brute-force against the per-IP rate limit
 *   - 14-day server-checked expiry; SINGLE-USE (burned atomically on accept)
 *
 * Exports:
 *   createDealAcceptToken (onCall)    — rep mints a token for a deal they own
 *                                       (the deal-room HTML must already be in
 *                                       Storage at deal_rooms/<uid>/<id>.html)
 *   getDealRoom           (onRequest) — /deal/<token> → serves that HTML,
 *                                       same-origin, with the token injected
 *   submitDealAcceptance  (onRequest) — homeowner POSTs token + tier + signature
 *                                       → burns the token, records the acceptance
 *                                       on the deal, notifies the rep
 *
 * Served first-party via hosting rewrites (/deal/** + /api/deal-accept) so the
 * accept POST is same-origin — NOT cross-origin from a raw Storage URL (which
 * would be CORS-blocked). Mirrors the /share/** → shareSSR pattern.
 *
 * Security exception: getDealRoom + submitDealAcceptance are NOT App-Check or
 * Firebase-auth gated — that's the whole point of a no-login accept link.
 * Compensating controls: unguessable token + 14-day expiry + single-use burn
 * + per-IP rate limit + server-side tier-price snapshot + signature size cap.
 */
'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { httpRateLimit } = require('./integrations/upstash-ratelimit');
const { callableRateLimit } = require('./shared');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nbd-pro.web.app',
];
const DEAL_URL_BASE = 'https://nobigdealwithjoedeal.com/deal/';
const SUBMIT_PATH = '/api/deal-accept'; // same-origin hosting rewrite → submitDealAcceptance

const VALID_TIERS = ['good', 'better', 'best'];

// 32-char no-confusable alphabet (no 0/O, 1/I/L) — same as portal.js / remote-signing.js.
const TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function mintToken() {
  const bytes = require('crypto').randomBytes(24);
  let s = '';
  for (const b of bytes) s += TOKEN_ALPHABET[b % TOKEN_ALPHABET.length];
  return s;
}
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ═══════════════════════════════════════════════════════════════
// createDealAcceptToken — rep mints a single-use accept token.
// ═══════════════════════════════════════════════════════════════
exports.createDealAcceptToken = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 20,
    memory: '256MiB',
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    // A compromised rep session could otherwise mint tokens in a loop.
    await callableRateLimit(request, 'createDealAcceptToken', 30, 60_000);

    const d = request.data || {};
    const dealId = typeof d.dealId === 'string' ? d.dealId : null;
    if (!dealId || !/^[A-Za-z0-9_-]{6,64}$/.test(dealId)) {
      throw new HttpsError('invalid-argument', 'A valid dealId is required');
    }

    const db = admin.firestore();
    // Owner-scope: the rep must own the deal (or be platform admin).
    const dealSnap = await db.doc(`deal_rooms/${dealId}`).get();
    if (!dealSnap.exists) throw new HttpsError('not-found', 'Deal not found');
    const deal = dealSnap.data();
    const isAdmin = request.auth.token.role === 'admin';
    if (deal.userId !== uid && !isAdmin) throw new HttpsError('permission-denied', 'Not your deal');

    // The interactive deal-room HTML must already be uploaded to Storage by
    // the client (uploadDealPage → deal_rooms/<uid>/<dealId>.html). We serve
    // THAT, not arbitrary HTML.
    const htmlPath = `deal_rooms/${deal.userId}/${dealId}.html`;

    // Snapshot the tier prices server-side so the recorded acceptance price
    // can't be tampered with via the (unauthenticated) accept payload.
    const tiers = deal.tiers || {};
    const tierPrices = {
      good: Number(tiers.good && tiers.good.price) || 0,
      better: Number(tiers.better && tiers.better.price) || 0,
      best: Number(tiers.best && tiers.best.price) || 0,
    };

    const now = Date.now();
    const ttlDays = 14;
    const expiresAt = admin.firestore.Timestamp.fromMillis(now + ttlDays * 86_400_000);
    const token = mintToken();

    await db.doc(`deal_accept_tokens/${token}`).set({
      dealId,
      ownerUid: deal.userId,
      companyId: deal.companyId || deal.userId,
      leadId: deal.leadId || null,
      customerName: String(deal.customerName || '').slice(0, 120),
      htmlPath,
      tierPrices,
      status: 'pending',
      mintedBy: uid,
      mintedAt: FieldValue.serverTimestamp(),
      expiresAt,
    });

    logger.info('[createDealAcceptToken] minted', { dealId });
    return { token, acceptUrl: DEAL_URL_BASE + token, expiresAt: expiresAt.toMillis() };
  }
);

// ═══════════════════════════════════════════════════════════════
// getDealRoom — /deal/<token> → serve the interactive deal-room HTML.
// ═══════════════════════════════════════════════════════════════
exports.getDealRoom = onRequest(
  {
    region: 'us-central1',
    maxInstances: 40,
    concurrency: 40,
    timeoutSeconds: 15,
    memory: '256MiB',
  },
  async (req, res) => {
    const errPage = (code, msg) => {
      res.status(code).set('Content-Type', 'text/html; charset=utf-8').set('X-Robots-Tag', 'noindex, nofollow')
        .send(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>No Big Deal</title><body style="font-family:system-ui,-apple-system,sans-serif;background:#0f1115;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px"><div><div style="font-size:44px">🤝</div><p style="max-width:420px;line-height:1.6;font-size:16px">${escHtml(msg)}</p></div></body>`);
    };
    // token is the last path segment: /deal/<token>
    const m = (req.path || '').match(/\/deal\/([A-Za-z0-9]{10,64})\/?$/);
    const token = m ? m[1] : '';
    if (!token) { errPage(400, 'This deal link is invalid.'); return; }
    // Per-IP rate limit — stops token brute-forcing.
    if (!(await httpRateLimit(req, res, 'dealroom-get:ip', 30, 60_000))) return;

    const db = admin.firestore();
    const tokSnap = await db.doc(`deal_accept_tokens/${token}`).get();
    if (!tokSnap.exists) { errPage(404, 'This deal link is invalid.'); return; }
    const tok = tokSnap.data();
    if (tok.expiresAt && tok.expiresAt.toMillis && tok.expiresAt.toMillis() < Date.now()) {
      errPage(410, 'This deal link has expired. Ask your rep for a fresh one.'); return;
    }
    if (tok.status !== 'pending') {
      errPage(410, 'This deal has already been accepted — your rep will reach out to confirm your installation.'); return;
    }

    // Fire-and-forget viewed stamps (do not gate the response).
    db.doc(`deal_accept_tokens/${token}`).update({ viewedAt: FieldValue.serverTimestamp() }).catch(() => {});
    db.doc(`deal_rooms/${tok.dealId}`).set({ status: 'viewed', viewedAt: FieldValue.serverTimestamp() }, { merge: true }).catch(() => {});

    let html = '';
    try {
      const [buf] = await admin.storage().bucket().file(tok.htmlPath).download();
      html = buf.toString('utf8');
    } catch (e) {
      logger.error('[getDealRoom] html fetch failed', { token: token.slice(0, 6), err: e.message });
      errPage(500, 'We could not load this deal right now. Please try again shortly.'); return;
    }

    // Inject the token + same-origin submit endpoint so the page's ACCEPT
    // button can record the acceptance. The deal-room's submitDeal() reads
    // window.__NBD_DEAL_TOKEN / __NBD_DEAL_SUBMIT_URL. Injected before </head>.
    const inject = `<script>window.__NBD_DEAL_TOKEN=${JSON.stringify(token)};window.__NBD_DEAL_SUBMIT_URL=${JSON.stringify(SUBMIT_PATH)};</script>`;
    html = html.includes('</head>') ? html.replace('</head>', inject + '</head>') : inject + html;

    res.status(200)
      .set('Content-Type', 'text/html; charset=utf-8')
      .set('X-Robots-Tag', 'noindex, nofollow')
      .set('Cache-Control', 'no-store')
      .send(html);
  }
);

// ═══════════════════════════════════════════════════════════════
// submitDealAcceptance — homeowner accepts → burn token + record.
// ═══════════════════════════════════════════════════════════════
exports.submitDealAcceptance = onRequest(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    maxInstances: 40,
    concurrency: 40,
    timeoutSeconds: 20,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    if (!(await httpRateLimit(req, res, 'dealaccept-submit:ip', 20, 60_000))) return;

    const b = req.body || {};
    const token = typeof b.token === 'string' ? b.token : '';
    const tier = typeof b.tier === 'string' ? b.tier : '';
    const signature = typeof b.signature === 'string' ? b.signature : '';
    const financing = (b.financing == null) ? null : String(b.financing).slice(0, 80);
    const scheduledDate = typeof b.scheduledDate === 'string' ? b.scheduledDate.slice(0, 40) : '';

    if (token.length < 10 || token.length > 64) { res.status(400).json({ error: 'Invalid link' }); return; }
    if (!VALID_TIERS.includes(tier)) { res.status(400).json({ error: 'Please choose a package first' }); return; }
    // Signature is a canvas PNG dataURL. Require it; cap the size (a typed
    // signature is a few tens of KB — anything huge is abuse).
    if (!/^data:image\/png;base64,/.test(signature) || signature.length < 200) {
      res.status(400).json({ error: 'A signature is required' }); return;
    }
    if (signature.length > 600 * 1024) { res.status(413).json({ error: 'Signature too large' }); return; }

    const db = admin.firestore();
    const tokRef = db.doc(`deal_accept_tokens/${token}`);

    // ATOMIC single-use burn: flip pending → accepted inside a transaction so
    // two concurrent accepts can't both record (TOCTOU). Mirrors portal.js.
    let info;
    try {
      info = await db.runTransaction(async (tx) => {
        const snap = await tx.get(tokRef);
        if (!snap.exists) { const e = new Error('nf'); e._http = 404; e._msg = 'Invalid link'; throw e; }
        const t = snap.data();
        if (t.expiresAt && t.expiresAt.toMillis && t.expiresAt.toMillis() < Date.now()) {
          const e = new Error('exp'); e._http = 410; e._msg = 'This deal link has expired.'; throw e;
        }
        if (t.status !== 'pending') {
          const e = new Error('done'); e._http = 409; e._msg = 'This deal has already been accepted.'; throw e;
        }
        tx.update(tokRef, { status: 'accepted', acceptedAt: FieldValue.serverTimestamp() });
        return {
          dealId: t.dealId, ownerUid: t.ownerUid, leadId: t.leadId || null,
          customerName: t.customerName || '', price: (t.tierPrices && t.tierPrices[tier]) || 0,
        };
      });
    } catch (err) {
      if (err && err._http) { res.status(err._http).json({ error: err._msg }); return; }
      logger.error('[submitDealAcceptance] burn txn failed', { msg: err.message });
      res.status(500).json({ error: 'Could not record your acceptance. Try again.' }); return;
    }

    // Token is burned. Record the acceptance + notify the rep. A failure here
    // can't double-accept (status already flipped); log and still return ok so
    // the homeowner isn't asked to re-accept.
    try {
      await db.doc(`deal_rooms/${info.dealId}`).set({
        status: 'accepted',
        acceptedTier: tier,
        acceptedPrice: info.price,
        acceptedFinancing: financing,
        acceptedSignature: signature,
        scheduledInstallDate: scheduledDate || null,
        acceptedAt: FieldValue.serverTimestamp(),
        acceptedVia: 'remote',
      }, { merge: true });
    } catch (e) { logger.warn('[submitDealAcceptance] deal update failed', { msg: e.message }); }

    try {
      await db.collection('notifications').add({
        userId: info.ownerUid,
        type: 'deal_accepted',
        leadId: info.leadId,
        title: 'Deal accepted! 🎉',
        message: (info.customerName || 'A customer') + ' accepted the ' + tier.toUpperCase() + ' package'
          + (info.price ? ' ($' + Number(info.price).toLocaleString('en-US') + ')' : '') + '.',
        priority: 'high',
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) { logger.warn('[submitDealAcceptance] notify failed', { msg: e.message }); }

    logger.info('[submitDealAcceptance] accepted', { dealId: info.dealId, tier });
    res.status(200).json({ ok: true });
  }
);

module.exports = exports;
