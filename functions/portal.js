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
    // Wave 87: CORS lockdown. Was `cors: true` (any origin), which
    // let any page on the web POST to this endpoint and harvest the
    // redacted portal view if they could guess/intercept a token.
    // The actual call site is portal.html on our own domain — the
    // statically-generated portal HTML in Firebase Storage doesn't
    // hit this endpoint (its data is baked in at generation time).
    // So the allowlist is exactly the same as the rep-facing
    // endpoints above. If/when we serve portal HTML from a custom
    // sub-domain, add it here explicitly.
    cors: CORS_ORIGINS,
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

    // Load lead, rep, latest estimate, and any photos the rep has
    // explicitly shared with the homeowner. Photos are gated by
    // `sharedWithHomeowner: true` — the rep flips the flag from
    // customer.html. We deliberately don't return EVERY photo
    // (homeowner doesn't need to see internal damage workups or
    // photos uploaded for a different lead by mistake).
    //
    // limit(50) caps the gallery — generous for a real project,
    // tight enough that a misclick can't dump 500 photos to the
    // homeowner page in one fetch.
    const [leadSnap, repSnap, estSnap, photoSnap] = await Promise.all([
      db.doc(`leads/${tok.leadId}`).get(),
      db.doc(`users/${tok.ownerUid}`).get(),
      db.collection('estimates')
        .where('leadId', '==', tok.leadId)
        .limit(10)
        .get(),
      db.collection('photos')
        .where('leadId', '==', tok.leadId)
        .where('userId', '==', tok.ownerUid)
        .where('sharedWithHomeowner', '==', true)
        .limit(50)
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
          // Wave 87: validate the URL points at app.boldsign.com
          // BEFORE we hand it to portal.html for iframe embedding.
          // BoldSign's API normally returns a https://app.boldsign.com/...
          // URL, but a future API change or a redirect-style response
          // could return an attacker-controlled origin. The portal
          // page iframes whatever URL we hand back — if that's
          // anywhere other than BoldSign, we just embedded a third
          // party site for the homeowner.
          const candidate = d.signLink || d.signUrl || null;
          if (candidate && /^https:\/\/app\.boldsign\.com\//i.test(candidate)) {
            signEmbedUrl = candidate;
          } else if (candidate) {
            logger.warn('portal embed url rejected — wrong origin', { candidate });
          }
        }
      } catch (e) {
        logger.warn('portal embed link fetch failed', { err: e.message });
      }
    }

    // ── Project progress (homeowner-facing milestones) ────────────────
    // Map the rep-side stage key to one of 5 user-friendly milestones
    // homeowners actually understand. Internal stages like
    // "supplement_requested" or "adjuster_inspection_done" don't matter
    // to them — they want to know "are we still inspecting" vs "is
    // someone coming to install."
    const HOMEOWNER_PROGRESS = [
      { key: 'inspected',        label: 'Inspection',     blurb: 'We\'ve looked at your property.' },
      { key: 'estimate_sent',    label: 'Estimate',       blurb: 'You have a written quote.' },
      { key: 'contract_signed',  label: 'Contract',       blurb: 'Signed and ready to schedule.' },
      { key: 'install',          label: 'Installation',   blurb: 'The crew is on the job.' },
      { key: 'complete',         label: 'Complete',       blurb: 'Project finished — final walkthrough done.' }
    ];
    const STAGE_TO_PROGRESS = {
      // Pre-inspection / contact-only — show "Inspection" as upcoming
      'new': 'inspected', 'contacted': 'inspected',
      // Inspection done
      'inspected': 'inspected',
      // Insurance pipeline — collapse to "Estimate" once a number is on the table
      'claim_filed': 'inspected', 'adjuster_meeting_scheduled': 'inspected',
      'adjuster_inspection_done': 'estimate_sent', 'scope_received': 'estimate_sent',
      'estimate_submitted': 'estimate_sent', 'supplement_requested': 'estimate_sent',
      'supplement_approved': 'estimate_sent',
      // Cash / finance — same idea
      'estimate_sent_cash': 'estimate_sent', 'negotiating': 'estimate_sent',
      'prequal_sent': 'estimate_sent', 'loan_approved': 'estimate_sent',
      // Contract signed
      'contract_signed': 'contract_signed',
      // Job phase
      'job_created': 'contract_signed', 'permit_pulled': 'contract_signed',
      'materials_ordered': 'contract_signed', 'materials_delivered': 'install',
      'crew_scheduled': 'install', 'install_in_progress': 'install',
      'install_complete': 'install',
      'final_photos': 'complete', 'deductible_collected': 'complete',
      'final_payment': 'complete', 'closed': 'complete'
    };
    const stageKey = lead._stageKey || lead.stage || 'new';
    const progressKey = STAGE_TO_PROGRESS[stageKey] || 'inspected';
    const currentIdx = HOMEOWNER_PROGRESS.findIndex(p => p.key === progressKey);
    const nextStep = currentIdx >= 0 && currentIdx < HOMEOWNER_PROGRESS.length - 1
      ? HOMEOWNER_PROGRESS[currentIdx + 1] : null;
    const progress = {
      milestones: HOMEOWNER_PROGRESS,
      currentKey:    progressKey,
      currentIndex:  currentIdx,
      currentLabel:  HOMEOWNER_PROGRESS[currentIdx]?.label || 'In Progress',
      nextLabel:     nextStep?.label || null,
      nextBlurb:     nextStep?.blurb || null,
    };

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
      progress,
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
      // Project photos the rep flipped to sharedWithHomeowner.
      // We only emit the responsive variant URLs (`urls`) so the
      // homeowner page renders 200/600/1600 px WebP via <img
      // srcset> instead of pulling 3-5 MB iPhone originals over
      // their phone connection. Photos without `urls` (legacy,
      // pre-image-pipeline) fall back to the original `url`. The
      // redaction here matches the rest of this view: NO internal
      // notes, damageType, severity, location, tags — homeowner
      // only sees the picture, the phase, and an optional
      // homeowner-facing caption.
      photos: photoSnap.docs.map(d => {
        const p = d.data();
        return {
          id: d.id,
          urls: p.urls || null,
          url:  p.url || null,
          phase: p.phase || 'During',
          caption: p.homeownerCaption || ''
        };
      }),
      tokenInfo: {
        daysRemaining: tok.expiresAt
          ? Math.max(0, Math.ceil((tok.expiresAt.toMillis() - Date.now()) / 86_400_000))
          : null
      },
      // Wave 121: rating gate — surface to the portal whether the
      // homeowner can rate the job and whether they already have.
      // The rating card only shows when:
      //   1. progressKey === 'complete'
      //   2. lead.customerRating is unset (not already rated)
      // We emit both bits so the client can render correctly without
      // a second round-trip. If rep.googleReviewUrl is set on the
      // user doc, we also surface it so 4-5★ raters get nudged to
      // leave a public review on Google.
      rating: {
        canRate: progressKey === 'complete',
        submitted: typeof lead.customerRating === 'number' && lead.customerRating > 0,
        stars: typeof lead.customerRating === 'number' ? lead.customerRating : null,
        googleReviewUrl: rep.googleReviewUrl || null,
      },
    };

    // Bump use counter (fire-and-forget; don't fail the response).
    tokRef.update({
      uses: admin.firestore.FieldValue.increment(1),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch(() => {});

    res.status(200).json(view);
  }
);

// ═══════════════════════════════════════════════════════════════
// Wave 118: uploadHomeownerPhoto — homeowner uploads photos via portal
// ═══════════════════════════════════════════════════════════════
//
// The portal's biggest close-the-loop opportunity: let the homeowner
// upload photos of damage they spotted (storm, mid-job concerns,
// finished work) without waiting for an inspection.
//
// Auth: portal token only (no Firebase user — this is the
// homeowner-facing path). Validated via the same portal_tokens
// collection as getHomeownerPortalView.
//
// Storage: data URL → Firebase Storage at
//   homeowner-uploads/{ownerUid}/{leadId}/{timestamp}.jpg
//
// Firestore: photo doc in `photos` collection with:
//   leadId, userId (rep — for visibility), source: 'homeowner',
//   uploadedAt, url, caption, sharedWithHomeowner: true
//
// Limits:
//   - 10 photos per lead per day (per-token rate limit)
//   - 8 MB per photo (resized client-side; this is the hard server cap)
//   - jpeg/png/webp data URLs only
//
// Notifies the rep via the existing notifications collection so
// the homeowner upload appears in the W48 bell with the W92 high-
// engagement signal it deserves.
exports.uploadHomeownerPhoto = onRequest(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    maxInstances: 50,
    concurrency: 40,
    timeoutSeconds: 30,
    memory: '512MiB', // base64-decode + storage upload
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }

    // Rate limit per IP — defends against bots churning uploads.
    if (!(await httpRateLimit(req, res, 'portal-upload:ip', 20, 60_000))) return;

    const { token, dataUrl, caption } = req.body || {};
    if (typeof token !== 'string' || token.length < 10 || token.length > 64) {
      res.status(400).json({ error: 'Invalid token' });
      return;
    }
    if (typeof dataUrl !== 'string') {
      res.status(400).json({ error: 'dataUrl required' });
      return;
    }
    // Parse the data URL: expect data:image/jpeg;base64,XXXX
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) {
      res.status(400).json({ error: 'Invalid image format. Use JPEG/PNG/WebP.' });
      return;
    }
    const mimeType = m[1];
    const b64 = m[2];
    // 8MB hard cap on the encoded payload (~6MB binary).
    if (b64.length > 8 * 1024 * 1024) {
      res.status(413).json({ error: 'Photo too large. Max 8MB.' });
      return;
    }
    const safeCaption = (typeof caption === 'string') ? caption.slice(0, 280) : '';

    const db = admin.firestore();
    const tokRef = db.doc(`portal_tokens/${token}`);
    const tokSnap = await tokRef.get();
    if (!tokSnap.exists) { res.status(404).json({ error: 'Invalid link' }); return; }
    const tok = tokSnap.data();
    if (tok.expiresAt && tok.expiresAt.toMillis && tok.expiresAt.toMillis() < Date.now()) {
      res.status(410).json({ error: 'This link has expired.' });
      return;
    }

    // Per-token daily quota (10 photos / 24h). Stored on the token
    // doc itself as a small counter — no extra collection needed.
    const todayKey = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
    const uploadsField = `uploadsByDay.${todayKey}`;
    const todayUploads = (tok.uploadsByDay && tok.uploadsByDay[todayKey]) || 0;
    if (todayUploads >= 10) {
      res.status(429).json({ error: 'Daily upload limit reached (10). Try again tomorrow.' });
      return;
    }

    try {
      // Storage upload
      const buffer = Buffer.from(b64, 'base64');
      const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
      const ts = Date.now();
      const path = `homeowner-uploads/${tok.ownerUid}/${tok.leadId}/${ts}.${ext}`;
      const file = admin.storage().bucket().file(path);
      await file.save(buffer, { contentType: mimeType, resumable: false });
      // Make the file readable by the rep via signed URL or via
      // Storage rules (rep reads their own homeowner-uploads). For
      // simplicity here we use a long-lived signed URL — the rep's
      // dashboard fetches it directly without auth handshake.
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '03-09-2491', // far future — practically permanent
      });

      // Photo doc — rep owns it (userId = ownerUid) so the existing
      // photo queries on the rep dashboard surface it.
      const photoRef = await db.collection('photos').add({
        leadId: tok.leadId,
        userId: tok.ownerUid,
        source: 'homeowner',
        url,
        path,
        mimeType,
        caption: safeCaption,
        phase: 'During', // homeowner uploads typically mid-project
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        sharedWithHomeowner: true, // visible back to them in the gallery
      });

      // Bump token counter atomically.
      await tokRef.update({
        [uploadsField]: admin.firestore.FieldValue.increment(1),
        lastUploadAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Notification to the rep — surfaces in the W48 bell as a
      // high-priority "homeowner uploaded a photo" signal.
      try {
        await db.collection('notifications').add({
          userId: tok.ownerUid,
          type: 'homeowner_upload',
          leadId: tok.leadId,
          photoId: photoRef.id,
          title: 'Homeowner uploaded a photo',
          message: safeCaption ? `"${safeCaption.slice(0, 60)}"` : 'New photo from the homeowner — review on the customer page.',
          priority: 'high',
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (notifErr) {
        logger.warn('[uploadHomeownerPhoto] notification create failed', { msg: notifErr.message });
      }

      res.status(200).json({
        ok: true,
        photoId: photoRef.id,
        url,
        remainingToday: 10 - (todayUploads + 1),
      });
    } catch (err) {
      logger.error('[uploadHomeownerPhoto] failed', { msg: err.message });
      res.status(500).json({ error: 'Upload failed. Try again.' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// Wave 119: requestCallback — homeowner picks a time-window,
// rep sees a task on the lead.
// ═══════════════════════════════════════════════════════════════
//
// Companion to the call-now button. The customer taps a time-slot
// chip ("today", "tomorrow morning", "this weekend", etc.) plus an
// optional note, and we drop a real task on the lead so the rep
// sees it in their bell + customer page activity log without any
// extra rep-side wiring.
//
// Time-slot resolution is server-side and uses Eastern time — same
// timezone fix W104 applied to the scheduled push functions. We
// resolve the slot to a concrete `dueDate` (YYYY-MM-DD) so the
// existing notif-bell `task-today` / `overdue-task` branches pick
// it up identically to a manually-created task.
//
// Limits:
//   - 3 callback requests per token per day (defends against
//     a stuck homeowner spamming "call me now")
//   - 280-char note cap, slot whitelist
//   - Per-IP rate limit shared with portal upload
exports.requestCallback = onRequest(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    maxInstances: 50,
    concurrency: 60,
    timeoutSeconds: 15,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }

    if (!(await httpRateLimit(req, res, 'portal-callback:ip', 30, 60_000))) return;

    const { token, slot, note } = req.body || {};
    if (typeof token !== 'string' || token.length < 10 || token.length > 64) {
      res.status(400).json({ error: 'Invalid token' });
      return;
    }
    const ALLOWED_SLOTS = new Set([
      'today',
      'tomorrow-morning',
      'tomorrow-afternoon',
      'tomorrow-evening',
      'weekend',
      'anytime',
    ]);
    if (typeof slot !== 'string' || !ALLOWED_SLOTS.has(slot)) {
      res.status(400).json({ error: 'Invalid time slot' });
      return;
    }
    const safeNote = (typeof note === 'string') ? note.trim().slice(0, 280) : '';

    const db = admin.firestore();
    const tokRef = db.doc(`portal_tokens/${token}`);
    const tokSnap = await tokRef.get();
    if (!tokSnap.exists) { res.status(404).json({ error: 'Invalid link' }); return; }
    const tok = tokSnap.data();
    if (tok.expiresAt && tok.expiresAt.toMillis && tok.expiresAt.toMillis() < Date.now()) {
      res.status(410).json({ error: 'This link has expired.' });
      return;
    }

    // Per-token daily quota — small cap so a confused homeowner
    // doesn't accidentally spam 30 requests in one tap-fest.
    const todayKey = new Date().toISOString().slice(0, 10);
    const callbacksField = `callbacksByDay.${todayKey}`;
    const todayCount = (tok.callbacksByDay && tok.callbacksByDay[todayKey]) || 0;
    if (todayCount >= 3) {
      res.status(429).json({ error: 'You\'ve sent a few requests already today — your rep will be in touch.' });
      return;
    }

    // Resolve the slot to a concrete due date in Eastern time.
    // We work with the raw YYYY-MM-DD from Intl so it doesn't drift
    // off the date locally vs server-side.
    const easternDate = (offset) => {
      // offset = 0 today, 1 tomorrow, 2 day-after, etc.
      const d = new Date(Date.now() + offset * 86_400_000);
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit',
      });
      return fmt.format(d); // 'YYYY-MM-DD'
    };
    // Saturday lookahead — find the next Saturday in Eastern time.
    const nextSaturday = () => {
      for (let i = 0; i <= 7; i++) {
        const d = new Date(Date.now() + i * 86_400_000);
        const wd = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York', weekday: 'short',
        }).format(d);
        if (wd === 'Sat') return easternDate(i);
      }
      return easternDate(6); // fallback
    };

    let dueDate;
    let label;
    switch (slot) {
      case 'today':
        dueDate = easternDate(0);
        label = 'today';
        break;
      case 'tomorrow-morning':
        dueDate = easternDate(1);
        label = 'tomorrow morning';
        break;
      case 'tomorrow-afternoon':
        dueDate = easternDate(1);
        label = 'tomorrow afternoon';
        break;
      case 'tomorrow-evening':
        dueDate = easternDate(1);
        label = 'tomorrow evening';
        break;
      case 'weekend':
        dueDate = nextSaturday();
        label = 'this weekend';
        break;
      case 'anytime':
      default:
        dueDate = easternDate(2); // 2 days out so it stays in active queue
        label = 'anytime this week';
        break;
    }

    const taskText = '📞 CALLBACK REQUESTED — ' + label
      + (safeNote ? ' — "' + safeNote + '"' : '');

    try {
      // Drop a task on the lead — surfaces in the rep's notif-bell
      // via the existing task-today / overdue-task branches.
      const taskRef = await db.collection(`leads/${tok.leadId}/tasks`).add({
        text: taskText,
        done: false,
        dueDate,
        // Marker fields so downstream surfaces (customer page, rep
        // bell) can recognize this isn't a self-created task.
        source: 'homeowner_callback',
        slot,
        slotLabel: label,
        homeownerNote: safeNote || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Activity log entry — surfaces on the customer page timeline.
      try {
        await db.collection(`leads/${tok.leadId}/activity`).add({
          userId: tok.ownerUid,
          type: 'callback_request',
          label: 'Callback requested',
          slot,
          slotLabel: label,
          note: safeNote || null,
          dueDate,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (actErr) {
        logger.warn('[requestCallback] activity create failed', { msg: actErr.message });
      }

      // Bump the lead's updatedAt so stale-lead bell branches don't
      // fire on a lead that just had a fresh customer signal.
      try {
        await db.doc(`leads/${tok.leadId}`).set({
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (_) { /* non-critical */ }

      // Bump token counter atomically.
      await tokRef.update({
        [callbacksField]: admin.firestore.FieldValue.increment(1),
        lastCallbackAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Server-side notification doc (future bell-stream wiring).
      try {
        await db.collection('notifications').add({
          userId: tok.ownerUid,
          type: 'homeowner_callback',
          leadId: tok.leadId,
          taskId: taskRef.id,
          title: 'Homeowner requested a callback',
          message: 'Best time: ' + label + (safeNote ? ' — "' + safeNote.slice(0, 60) + '"' : ''),
          priority: 'high',
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (notifErr) {
        logger.warn('[requestCallback] notification create failed', { msg: notifErr.message });
      }

      res.status(200).json({
        ok: true,
        taskId: taskRef.id,
        dueDate,
        slotLabel: label,
        remainingToday: 3 - (todayCount + 1),
      });
    } catch (err) {
      logger.error('[requestCallback] failed', { msg: err.message });
      res.status(500).json({ error: 'Could not save request. Try again.' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// Wave 121: submitCustomerRating — homeowner rates the completed
// job, optional comment, smart routing on outcome.
// ═══════════════════════════════════════════════════════════════
//
// The post-completion feedback loop. When a lead has hit the
// 'complete' homeowner-progress milestone, we show a 1-5 star
// rating card on the portal. Customer picks stars + optional
// comment, server stamps the lead with `customerRating` +
// `customerRatingComment` + `customerRatingAt`, and routes
// downstream surfaces:
//
//   - Always: activity log entry on leads/{id}/activity
//   - Always: notification doc for the rep (high priority)
//   - 4-5 stars: response includes googleReviewUrl so the portal
//                can nudge the homeowner to leave a public review
//   - 1-3 stars: drop a "RECOVERY CALL NEEDED" task on the lead
//                with priority dueDate=today so the rep sees it
//                in their bell IMMEDIATELY. A negative rating
//                without recovery is the worst of both worlds:
//                disappointed customer + rep unaware.
//
// Idempotency: ratings are write-once. If lead.customerRating is
// already set, we reject with 409. The portal already gates this
// via the `rating.submitted` flag in the view, but the server is
// authoritative.
//
// Limits:
//   - One rating per lead lifetime (write-once)
//   - 500-char comment cap
//   - Star whitelist: 1, 2, 3, 4, 5 only
exports.submitCustomerRating = onRequest(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    maxInstances: 50,
    concurrency: 60,
    timeoutSeconds: 15,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }

    if (!(await httpRateLimit(req, res, 'portal-rating:ip', 30, 60_000))) return;

    const { token, stars, comment } = req.body || {};
    if (typeof token !== 'string' || token.length < 10 || token.length > 64) {
      res.status(400).json({ error: 'Invalid token' });
      return;
    }
    const starsNum = Number(stars);
    if (!Number.isInteger(starsNum) || starsNum < 1 || starsNum > 5) {
      res.status(400).json({ error: 'Stars must be 1-5' });
      return;
    }
    const safeComment = (typeof comment === 'string') ? comment.trim().slice(0, 500) : '';

    const db = admin.firestore();
    const tokRef = db.doc(`portal_tokens/${token}`);
    const tokSnap = await tokRef.get();
    if (!tokSnap.exists) { res.status(404).json({ error: 'Invalid link' }); return; }
    const tok = tokSnap.data();
    if (tok.expiresAt && tok.expiresAt.toMillis && tok.expiresAt.toMillis() < Date.now()) {
      res.status(410).json({ error: 'This link has expired.' });
      return;
    }

    const leadRef = db.doc(`leads/${tok.leadId}`);
    const leadSnap = await leadRef.get();
    if (!leadSnap.exists) { res.status(404).json({ error: 'Lead not found' }); return; }
    const lead = leadSnap.data();

    // Write-once: a rating is permanent. The portal client should
    // never let this through, but server is authoritative.
    if (typeof lead.customerRating === 'number' && lead.customerRating > 0) {
      res.status(409).json({ error: 'You\'ve already rated this job. Thank you!' });
      return;
    }

    try {
      // Stamp the lead with the rating.
      await leadRef.update({
        customerRating: starsNum,
        customerRatingComment: safeComment || null,
        customerRatingAt: admin.firestore.FieldValue.serverTimestamp(),
        // Keep updatedAt fresh so stale-lead bell signals don't fire.
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Activity log for the customer page timeline.
      try {
        await db.collection(`leads/${tok.leadId}/activity`).add({
          userId: tok.ownerUid,
          type: 'customer_rating',
          label: starsNum + '-star rating from homeowner',
          stars: starsNum,
          comment: safeComment || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (actErr) {
        logger.warn('[submitCustomerRating] activity create failed', { msg: actErr.message });
      }

      // Low-rating recovery: drop a high-priority task on the lead
      // so the rep gets it in their bell as task-today / overdue.
      if (starsNum <= 3) {
        try {
          const today = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/New_York',
            year: 'numeric', month: '2-digit', day: '2-digit',
          }).format(new Date());
          await db.collection(`leads/${tok.leadId}/tasks`).add({
            text: '⚠️ RECOVERY CALL — homeowner gave ' + starsNum + '★'
              + (safeComment ? ' — "' + safeComment.slice(0, 100) + '"' : ''),
            done: false,
            dueDate: today, // today in Eastern → bell shows it RIGHT NOW
            source: 'rating_recovery',
            stars: starsNum,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        } catch (taskErr) {
          logger.warn('[submitCustomerRating] recovery task failed', { msg: taskErr.message });
        }
      }

      // Notification doc for the rep (server-side bell stream).
      try {
        const notifTitle = starsNum >= 4
          ? `⭐ ${starsNum}-star rating from homeowner`
          : `⚠️ ${starsNum}-star rating — recovery needed`;
        await db.collection('notifications').add({
          userId: tok.ownerUid,
          type: 'customer_rating',
          leadId: tok.leadId,
          title: notifTitle,
          message: safeComment ? '"' + safeComment.slice(0, 80) + '"' : 'No comment provided.',
          priority: starsNum <= 3 ? 'high' : 'medium',
          stars: starsNum,
          read: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (notifErr) {
        logger.warn('[submitCustomerRating] notification create failed', { msg: notifErr.message });
      }

      // For 4-5 star raters, return the Google review URL so the
      // portal can nudge them to leave a public review. Resolve
      // from the rep's user doc — same field surfaced in the view.
      let googleReviewUrl = null;
      if (starsNum >= 4) {
        try {
          const repSnap = await db.doc(`users/${tok.ownerUid}`).get();
          if (repSnap.exists) {
            googleReviewUrl = repSnap.data().googleReviewUrl || null;
          }
        } catch (_) { /* non-critical */ }
      }

      res.status(200).json({
        ok: true,
        stars: starsNum,
        googleReviewUrl,
        // Hint for the portal copy — high vs low determines which
        // post-submit message the user sees.
        tier: starsNum >= 4 ? 'high' : 'low',
      });
    } catch (err) {
      logger.error('[submitCustomerRating] failed', { msg: err.message });
      res.status(500).json({ error: 'Could not save rating. Try again.' });
    }
  }
);
