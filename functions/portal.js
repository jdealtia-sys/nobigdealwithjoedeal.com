/**
 * functions/portal.js — homeowner-portal Cloud Functions
 *
 * L-03: extracted from functions/index.js as the first step in
 * breaking that 2900-line monolith up. The three exports here plus
 * the token-mint helpers are fully self-contained; nothing else in
 * the codebase reaches into portal state.
 *
 * Exports:
 *   createPortalToken       (onCall)   — rep mints a per-lead share token
 *   revokePortalToken       (onCall)   — rep or admin kills tokens
 *   getHomeownerPortalView  (onRequest) — homeowner POSTs token → redacted view
 *
 * Storage shape: `portal_tokens/{token}` admin-SDK only (firestore.rules:459).
 * Tokens are 24 chars from a 32-char no-confusable alphabet → 32^24
 * possibilities, infeasible to brute-force against the per-IP rate limit.
 *
 * Flow:
 *   1. Rep calls createPortalToken({leadId}) — mints token, stores
 *      { leadId, ownerUid, expiresAt, uses:0, maxUses:100 }.
 *   2. Rep SMS/emails the URL `/pro/portal.html?token=<tok>` to the
 *      homeowner.
 *   3. Homeowner opens portal.html → client POSTs to
 *      getHomeownerPortalView({token}) → redacted view of lead + rep
 *      + latest estimate + optional BoldSign signing URL.
 *
 * Redaction: homeowner never sees claim details, internal notes,
 * rep commission, or other leads.
 */

'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');

const {
  SECRETS: INT_SECRETS,
  hasSecret: hasInt,
  getSecret: getInt,
} = require('./integrations/_shared');

// R-01 rate-limit adapter (Upstash → Firestore fallback) for the
// per-IP gate on getHomeownerPortalView.
const { httpRateLimit } = require('./integrations/upstash-ratelimit');

// B2: shared authz helper — callableRateLimit lives in shared.js
// alongside other cross-module primitives. portal.js was where the
// duplicated copy was first flagged.
const { callableRateLimit } = require('./shared');

// CORS origins — identical to the list in functions/index.js. The
// duplication is deliberate: portal.js is meant to be importable on
// its own, and the origin allowlist is short and rarely changes.
// If/when more modules peel off, this goes into shared.js.
const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];

// ─── Token minting ──────────────────────────────────────────
// 32-char no-confusable alphabet (no 0/O, 1/I/L). 24 bytes of
// crypto.randomBytes → 24 chars of token → ~120 bits of entropy.
const PORTAL_TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function mintPortalToken() {
  const bytes = require('crypto').randomBytes(24);
  let s = '';
  for (const b of bytes) s += PORTAL_TOKEN_ALPHABET[b % PORTAL_TOKEN_ALPHABET.length];
  return s;
}

// ═══════════════════════════════════════════════════════════════
// createPortalToken
// ═══════════════════════════════════════════════════════════════
exports.createPortalToken = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 15,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    // D1: a compromised rep session could otherwise mint millions of
    // tokens. 30/min/uid is way more than a human ever needs.
    await callableRateLimit(request, 'createPortalToken', 30, 60_000);
    const leadId = typeof request.data?.leadId === 'string' ? request.data.leadId : null;
    if (!leadId) throw new HttpsError('invalid-argument', 'leadId required');

    const db = admin.firestore();
    const leadSnap = await db.doc(`leads/${leadId}`).get();
    if (!leadSnap.exists) throw new HttpsError('not-found', 'Lead not found');
    const lead = leadSnap.data();
    // Owner-scope: rep who owns the lead OR platform admin.
    const isAdmin = request.auth.token.role === 'admin';
    if (lead.userId !== uid && !isAdmin) {
      throw new HttpsError('permission-denied', 'Not your lead');
    }

    // 30-day default TTL — rep can force re-mint anytime.
    const ttlDays = Math.min(90, Math.max(1, Number(request.data?.ttlDays) || 30));
    const now = Date.now();
    const expiresAt = admin.firestore.Timestamp.fromMillis(now + ttlDays * 86_400_000);

    const token = mintPortalToken();
    await db.doc(`portal_tokens/${token}`).set({
      leadId,
      ownerUid: lead.userId,
      mintedBy: uid,
      mintedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt,
      uses: 0,
      maxUses: 100  // generous — homeowner may reload across days
    });
    return { token, expiresAt: expiresAt.toMillis() };
  }
);

// ═══════════════════════════════════════════════════════════════
// revokePortalToken
// Flips tokens to an expired timestamp rather than deleting so the
// audit trail survives. Owner-scoped; platform admin unrestricted.
// ═══════════════════════════════════════════════════════════════
exports.revokePortalToken = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 15,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    await callableRateLimit(request, 'revokePortalToken', 30, 60_000);
    const leadId = typeof request.data?.leadId === 'string' ? request.data.leadId : null;
    const tokenId = typeof request.data?.token === 'string' ? request.data.token : null;
    if (!leadId && !tokenId) {
      throw new HttpsError('invalid-argument', 'leadId or token required');
    }

    const db = admin.firestore();
    const isAdmin = request.auth.token.role === 'admin';
    let revoked = [];

    if (tokenId) {
      const ref = db.doc(`portal_tokens/${tokenId}`);
      const snap = await ref.get();
      if (!snap.exists) throw new HttpsError('not-found', 'Token not found');
      if (!isAdmin && snap.data().ownerUid !== uid) {
        throw new HttpsError('permission-denied', 'Not your token');
      }
      await ref.update({
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1),
        revokedAt: admin.firestore.FieldValue.serverTimestamp(),
        revokedBy: uid
      });
      revoked = [tokenId];
    } else {
      // Revoke every token for this lead owned by the caller.
      const q = await db.collection('portal_tokens')
        .where('leadId', '==', leadId)
        .get();
      const batch = db.batch();
      q.forEach(d => {
        const data = d.data();
        if (!isAdmin && data.ownerUid !== uid) return;
        batch.update(d.ref, {
          expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1),
          revokedAt: admin.firestore.FieldValue.serverTimestamp(),
          revokedBy: uid
        });
        revoked.push(d.id);
      });
      if (revoked.length) await batch.commit();
    }
    logger.info('revokePortalToken', { leadId, count: revoked.length });
    return { success: true, revoked: revoked.length };
  }
);

// ═══════════════════════════════════════════════════════════════
// getHomeownerPortalView — homeowner-facing POST → redacted view.
// ═══════════════════════════════════════════════════════════════
exports.getHomeownerPortalView = onRequest(
  {
    region: 'us-central1',
    cors: true, // intentionally open — this is the homeowner-facing endpoint
    // R-05 sizing: homeowner-facing (not a rep path), so volume is
    // bounded by "number of active portal links × opens". At 10k
    // signed homeowners with an avg 3 opens/week during a storm
    // spike that's ~500/hour sustained, burst to maybe 2000 concurrent
    // during an email blast. 80×80 = 6.4k ceiling gives 3× headroom.
    maxInstances: 80,
    concurrency: 80,
    timeoutSeconds: 15,
    memory: '256MiB',
    secrets: [INT_SECRETS.BOLDSIGN_API_KEY]
  },
  async (req, res) => {
    // F-06: POST only. Previously accepted GET with the token in the
    // query string, which leaked via access logs / Referer / browser
    // history on every homeowner pageload. portal.html now POSTs.
    if (req.method !== 'POST') { res.status(405).end(); return; }

    // Rate-limit per IP — 30/min is plenty for a homeowner on the
    // page and stops an attacker from brute-forcing tokens.
    if (!(await httpRateLimit(req, res, 'portal:ip', 30, 60_000))) return;

    const token = (req.body && req.body.token) || '';
    if (typeof token !== 'string' || token.length < 10 || token.length > 64) {
      res.status(400).json({ error: 'Invalid token' });
      return;
    }

    const db = admin.firestore();
    const tokRef = db.doc(`portal_tokens/${token}`);
    const tokSnap = await tokRef.get();
    if (!tokSnap.exists) { res.status(404).json({ error: 'Invalid link' }); return; }
    const tok = tokSnap.data();

    if (tok.expiresAt && tok.expiresAt.toMillis && tok.expiresAt.toMillis() < Date.now()) {
      res.status(410).json({ error: 'This link has expired. Contact your rep for a new one.' });
      return;
    }
    if (typeof tok.maxUses === 'number' && (tok.uses || 0) >= tok.maxUses) {
      res.status(429).json({ error: 'This link has been opened too many times.' });
      return;
    }

    // Load the lead, rep, and latest estimate in parallel.
    const [leadSnap, repSnap, estSnap] = await Promise.all([
      db.doc(`leads/${tok.leadId}`).get(),
      db.doc(`users/${tok.ownerUid}`).get(),
      db.collection('estimates')
        .where('leadId', '==', tok.leadId)
        .limit(10)
        .get()
    ]);

    if (!leadSnap.exists) { res.status(404).json({ error: 'Project not found' }); return; }
    const lead = leadSnap.data();
    const rep = repSnap.exists ? repSnap.data() : {};

    // Pick the latest estimate (createdAt desc). In-memory sort to
    // avoid a composite-index requirement for this rarely-hit path.
    const estimates = estSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    estimates.sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() || 0;
      const tb = b.createdAt?.toMillis?.() || 0;
      return tb - ta;
    });
    const latest = estimates[0] || null;

    // REDACTION: only non-sensitive fields reach the homeowner.
    // No claim details, no internal notes, no rep commission, no
    // other leads.

    // If the estimate is awaiting signature AND BoldSign is
    // configured AND the signer email on file matches the one
    // stored on the estimate, request a fresh embed signing URL.
    let signEmbedUrl = null;
    if (latest
        && (latest.signatureStatus === 'sent' || latest.signatureStatus === 'viewed')
        && latest.signatureProvider === 'boldsign'
        && latest.signatureDocumentId
        && latest.signerEmail
        && hasInt('BOLDSIGN_API_KEY')) {
      try {
        const apiKey = getInt('BOLDSIGN_API_KEY');
        const embedRes = await fetch(
          `https://api.boldsign.com/v1/document/getEmbeddedSignLink?documentId=${encodeURIComponent(latest.signatureDocumentId)}&signerEmail=${encodeURIComponent(latest.signerEmail)}`,
          { headers: { 'X-API-KEY': apiKey } }
        );
        if (embedRes.ok) {
          const d = await embedRes.json();
          signEmbedUrl = d.signLink || d.signUrl || null;
        }
      } catch (e) {
        logger.warn('portal embed link fetch failed', { err: e.message });
      }
    }

    const view = {
      homeowner: {
        firstName: lead.firstName || '',
        lastName:  lead.lastName || '',
        address:   lead.address || ''
      },
      rep: {
        displayName:    rep.displayName || lead.repName || 'Your Rep',
        calcomUsername: rep.calcomUsername || null,
        calcomEventSlug: rep.calcomEventSlug || 'roof-inspection',
        phone: rep.phone || null
      },
      company: {
        name: rep.companyName || 'No Big Deal Home Solutions'
      },
      estimate: latest ? {
        id:              latest.id,
        builder:         latest.builder || 'classic',
        grandTotal:      latest.grandTotal || latest.total || null,
        tierName:        latest.tierName || null,
        signatureStatus: latest.signatureStatus || 'none',
        signedAt:        latest.signedAt?.toDate?.()?.toISOString() || null,
        signedDocumentUrl: latest.signedDocumentUrl || null,
        signEmbedUrl:    signEmbedUrl,
        lineCount: Array.isArray(latest.lines) ? latest.lines.length : null,
        createdAt: latest.createdAt?.toDate?.()?.toISOString() || null
      } : null,
      bookingUrl: rep.calcomUsername
        ? ('https://cal.com/' + rep.calcomUsername + '/' + (rep.calcomEventSlug || 'roof-inspection'))
        : null,
      tokenInfo: {
        daysRemaining: tok.expiresAt
          ? Math.max(0, Math.ceil((tok.expiresAt.toMillis() - Date.now()) / 86_400_000))
          : null
      }
    };

    // Bump use counter (fire-and-forget; don't fail the response).
    tokRef.update({
      uses: admin.firestore.FieldValue.increment(1),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});

    res.status(200).json(view);
  }
);
