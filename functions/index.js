/**
 * Firebase Cloud Functions — NBD Pro API Proxy
 *
 * Keeps the Anthropic API key server-side (in Firebase secrets).
 * Client calls this function instead of hitting Anthropic directly.
 *
 * SETUP:
 *   1. cd functions && npm install
 *   2. firebase functions:secrets:set ANTHROPIC_API_KEY
 *      (paste your sk-ant-... key when prompted)
 *   3. firebase deploy --only functions
 *
 * CLIENT USAGE:
 *   const result = await fetch('https://us-central1-nobigdeal-pro.cloudfunctions.net/claudeProxy', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer <firebase-id-token>' },
 *     body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, messages: [...] })
 *   });
 */

const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { beforeUserCreated, beforeUserSignedIn } = require('firebase-functions/v2/identity');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const Stripe = require('stripe');

admin.initializeApp();

// Rate limiter: adapter module picks Upstash vs Firestore at call time
// based on NBD_RATE_LIMIT_PROVIDER + whether Upstash secrets are set.
// Falls back to the Firestore limiter automatically.
const { enforceRateLimit, httpRateLimit, clientIp } = require('./integrations/upstash-ratelimit');
const { withSentry } = require('./integrations/sentry');

// B2: callableRateLimit + requirePaidSubscription + requireAuth
// live in functions/shared.js so every module gets the same
// implementation. Inlined copies across this file + portal.js +
// sms-functions.js have been removed.
const {
  callableRateLimit,
  requirePaidSubscription,
  requireAuth,
} = require('./shared');

// Secrets stored in Firebase Secret Manager
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');
const STRIPE_PRICE_FOUNDATION = defineSecret('STRIPE_PRICE_FOUNDATION');
const STRIPE_PRICE_PROFESSIONAL = defineSecret('STRIPE_PRICE_PROFESSIONAL');
// Google Geocoding API key — optional. If not set, backfillAnalytics
// runs in degraded mode (derives hour/day from timestamps only,
// skips reverse-geocoding). To enable full geocoding:
//   firebase functions:secrets:set GOOGLE_GEOCODING_API_KEY
const GOOGLE_GEOCODING_API_KEY = defineSecret('GOOGLE_GEOCODING_API_KEY');

// CORS origins — exact match, no startsWith, no wildcards.
const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];

// requireAuth moved to functions/shared.js (B2). Imported at the
// top of this file alongside callableRateLimit + requirePaidSubscription.

// Anthropic model allowlist — Opus removed; too expensive to expose to end users.
const ALLOWED_CLAUDE_MODELS = new Set([
  'claude-haiku-4-5-20251001',
  'claude-sonnet-4-20250514',
]);
const CLAUDE_MAX_TOKENS_CAP = 1024;
// H-5: per-uid budget stays as a per-seat fairness floor, but we now
// also enforce a per-COMPANY budget. Previously, with free signups
// (pre-C-2) and no company cap, an attacker could spray 10 burner
// accounts on NBD-2026 and multiply the per-uid limit by 10x.
// Per-plan caps:
//   lite        →  10k tokens/day/company
//   foundation  →  50k tokens/day/company
//   growth      → 250k tokens/day/company
//   professional→ 1M  tokens/day/company
const CLAUDE_DAILY_TOKEN_BUDGET = 200000; // per uid per calendar day
const CLAUDE_PER_MIN_LIMIT = 20;
// M-03: `starter` is the canonical plan name new checkouts normalize
// to (createCheckoutSession maps legacy `foundation` → `starter` at
// line ~343). Without an entry here, every new paid signup silently
// fell through to CLAUDE_COMPANY_BUDGET_DEFAULT (10k/day) instead of
// the intended 50k/day. `blueprint` is a mid-tier placeholder tracked
// in docs/pro/js/nbd-auth.js:PLAN_LEVELS — add a conservative entry so
// future rollouts don't repeat the drift.
const CLAUDE_COMPANY_BUDGET = {
  lite:          10_000,
  foundation:    50_000,
  starter:       50_000,
  blueprint:    120_000,
  growth:       250_000,
  professional: 1_000_000
};
const CLAUDE_COMPANY_BUDGET_DEFAULT = 10_000;

// ═════════════════════════════════════════════════════════════
// C-03: transactional Claude budget reservation.
//
// The previous read-then-fire-then-increment flow had a TOCTOU race:
// N concurrent callers would all see the same pre-call counter, all
// pass the budget check, all fire to Anthropic, and the counter
// would only catch up after the fact — effectively N× the daily cap
// in one burst. With concurrency:80 and a per-min rate limit of 20,
// a single user could burn 20× their reservation before step ④ ran.
// Company-level the burst is even worse (multiple users × 20 each).
//
// Fix: reserve the anticipated spend inside a Firestore transaction
// BEFORE calling Anthropic. On success, reconcile actual - reservation
// (can be negative). On failure, refund the full reservation.
//
// Reservation is bounded at 4×CLAUDE_MAX_TOKENS_CAP so a bad estimate
// (huge input) can't lock out the user's entire day on a single call.
// The heuristic is 1 token ≈ 4 chars, which is the Anthropic tokenizer
// rule of thumb — close enough for reservation bounding.
// ═════════════════════════════════════════════════════════════
const CLAUDE_RESERVATION_MAX = 4 * CLAUDE_MAX_TOKENS_CAP;
// H-07: input-size guardrails. A client that smuggles a 200k-message
// payload (huge base64 image set, runaway prompt) can drive up input-
// token cost even with max_tokens capped at 1024. Reject payloads
// that are definitely not a human-scale CRM interaction before they
// ever touch Anthropic.
const CLAUDE_MAX_MESSAGES      = 40;
const CLAUDE_MAX_PAYLOAD_BYTES = 200_000;

function estimateInputTokens(messages, system) {
  let chars = 0;
  try { chars += JSON.stringify(messages || []).length; } catch (_) {}
  if (typeof system === 'string') chars += system.length;
  return Math.ceil(chars / 4);
}

async function reserveClaudeBudget(db, uidRef, coRef, reservation, caps) {
  return db.runTransaction(async (tx) => {
    const [u, c] = await Promise.all([tx.get(uidRef), tx.get(coRef)]);
    const uConsumed = (u.exists && u.data().tokens) || 0;
    const cConsumed = (c.exists && c.data().tokens) || 0;
    if (!caps.isAdmin && uConsumed + reservation > caps.uidCap) {
      return { ok: false, scope: 'uid', consumed: uConsumed, cap: caps.uidCap };
    }
    if (!caps.isAdmin && cConsumed + reservation > caps.coCap) {
      return { ok: false, scope: 'company', consumed: cConsumed, cap: caps.coCap };
    }
    const srv = admin.firestore.FieldValue.serverTimestamp();
    const inc = admin.firestore.FieldValue.increment(reservation);
    tx.set(uidRef, {
      tokens: inc, updatedAt: srv,
      uid: caps.uid, dayKey: caps.dayKey, scope: 'uid'
    }, { merge: true });
    tx.set(coRef, {
      tokens: inc, updatedAt: srv,
      companyId: caps.companyId, dayKey: caps.dayKey, scope: 'company'
    }, { merge: true });
    return { ok: true };
  });
}

async function adjustClaudeBudget(uidRef, coRef, delta) {
  if (!delta) return;
  const inc = admin.firestore.FieldValue.increment(delta);
  await Promise.all([
    uidRef.set({ tokens: inc }, { merge: true }),
    coRef.set({ tokens: inc }, { merge: true })
  ]);
}

exports.claudeProxy = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: true,
    // R-05 sizing: 10k-concurrent-user spike × each user firing
    // ≤1 AI call/min + 30-60s tail latency → ~10k concurrent
    // in-flight. Capped at 200 (not 300) because the us-central1
    // project quota is 200,000 mCPU and each instance uses 1 vCPU
    // (1000 mCPU) — 300×1000 = 300k > 200k quota → deploy fails.
    // 200×80 = 16k ceiling, 2× headroom over the old 100×80 = 8k.
    // To exceed 200 instances, request a quota increase in Cloud
    // Console before bumping this number.
    maxInstances: 200,
    concurrency: 80,
    minInstances: 3,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

    const authResult = await requireAuth(req);
    if (authResult.error) { res.status(authResult.error.status).json(authResult.error.body); return; }
    const { decoded } = authResult;

    try {
      // M-1: email-verification gate. An unverified email can be
      // anything — squatters can burn legitimate emails by signing
      // up first. Block unverified accounts from touching billable
      // surfaces (AI proxy). Platform admin exempt for support.
      const isAdmin = decoded.role === 'admin';
      if (!isAdmin && decoded.email_verified !== true) {
        res.status(403).json({ error: 'Verify your email before using AI features.' });
        return;
      }

      // Subscription gate — server-trusted Firestore doc written only by Stripe webhook.
      const subSnap = await admin.firestore().doc(`subscriptions/${decoded.uid}`).get();
      const sub = subSnap.exists ? subSnap.data() : null;
      const hasPaidPlan = sub && sub.plan && sub.plan !== 'free' && sub.status === 'active';
      if (!isAdmin && !hasPaidPlan) {
        res.status(403).json({ error: 'AI features require an active paid subscription.' });
        return;
      }

      // Per-uid rate limit (admin-SDK-only Firestore doc so clients cannot reset it).
      try {
        await enforceRateLimit('claudeProxy:uid', decoded.uid, CLAUDE_PER_MIN_LIMIT, 60_000);
      } catch (e) {
        if (e.rateLimited) { res.status(429).json({ error: 'Rate limit exceeded. Try again in a minute.' }); return; }
        throw e;
      }

      // M2: per-day token budget via materialized counters rather
      // than a range scan of api_usage.
      //
      // The previous implementation issued two parallel .where()
      // queries scanning every api_usage doc for the last 24h on
      // every single request. At 10K concurrent users × 1k
      // calls/day each, that was 20k reads/sec against a cold
      // collection — fragile under load and billing-expensive.
      //
      // Replacement: two counter docs, each a single read, keyed
      // by the UTC calendar day:
      //   api_usage_daily/{YYYY-MM-DD}__uid__{uid}
      //   api_usage_daily/{YYYY-MM-DD}__co__{companyId}
      // updated via FieldValue.increment() atomically on every
      // successful call. Rules lock the collection to admin-SDK
      // only (clients can neither read nor write — clients see
      // budget headroom only via the 429 response).
      //
      // The original api_usage collection is still dual-written
      // below, preserving per-lead cost attribution (C6) and
      // analytics drill-downs; only the HOT-PATH budget check
      // moved to the counter.
      // ── Input validation + H-07 size caps ──
      // Run BEFORE any Firestore write so a 400/413 path is free
      // of side effects.
      const { model, max_tokens, messages, system, temperature } = req.body || {};
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: 'messages array required' });
        return;
      }
      if (messages.length > CLAUDE_MAX_MESSAGES) {
        res.status(400).json({ error: 'Too many messages (max ' + CLAUDE_MAX_MESSAGES + ')' });
        return;
      }
      let serializedMessages;
      try { serializedMessages = JSON.stringify(messages); }
      catch (_) {
        res.status(400).json({ error: 'Invalid messages structure' });
        return;
      }
      if (serializedMessages.length > CLAUDE_MAX_PAYLOAD_BYTES) {
        res.status(413).json({ error: 'Messages payload too large (max 200KB)' });
        return;
      }
      const safeModel = ALLOWED_CLAUDE_MODELS.has(model) ? model : 'claude-haiku-4-5-20251001';
      const safeMaxTokens = Math.min(Number(max_tokens) || 500, CLAUDE_MAX_TOKENS_CAP);
      const safeSystem = (typeof system === 'string') ? system.slice(0, 4000) : undefined;
      const safeTemperature = (typeof temperature === 'number')
        ? Math.max(0, Math.min(1, temperature))
        : undefined;

      // ── C-03: transactional budget reservation ──
      // Pre-reserve up to CLAUDE_RESERVATION_MAX tokens inside a
      // Firestore transaction. Concurrent callers are serialized
      // through the counter doc, so 20 parallel reqs can no longer
      // each see the same pre-call value and collectively burst
      // past the cap.
      const callerCompanyId = decoded.companyId || decoded.uid; // solo op = own company
      const dayKey = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
      const uidCounterRef = admin.firestore()
        .doc(`api_usage_daily/${dayKey}__uid__${decoded.uid}`);
      const coCounterRef  = admin.firestore()
        .doc(`api_usage_daily/${dayKey}__co__${callerCompanyId}`);
      const plan = (sub && sub.plan) || 'lite';
      const companyCap = CLAUDE_COMPANY_BUDGET[plan] ?? CLAUDE_COMPANY_BUDGET_DEFAULT;

      const reservation = Math.min(
        safeMaxTokens + estimateInputTokens(messages, safeSystem),
        CLAUDE_RESERVATION_MAX
      );
      const reserveResult = await reserveClaudeBudget(
        admin.firestore(), uidCounterRef, coCounterRef, reservation,
        {
          isAdmin,
          uidCap: CLAUDE_DAILY_TOKEN_BUDGET,
          coCap: companyCap,
          uid: decoded.uid,
          companyId: callerCompanyId,
          dayKey,
        }
      );
      if (!reserveResult.ok) {
        if (reserveResult.scope === 'uid') {
          res.status(429).json({
            error: 'Daily AI budget exceeded for your account. Resets in 24 hours.'
          });
        } else {
          res.status(429).json({
            error: 'Company AI budget exceeded for today. Upgrade plan or try again in 24 hours.',
            plan, capacity: companyCap
          });
        }
        return;
      }

      // Budget reserved. Any error path below MUST refund or the
      // caller loses tokens to a failed upstream.
      const anthropicBody = { model: safeModel, max_tokens: safeMaxTokens, messages };
      if (safeSystem !== undefined) anthropicBody.system = safeSystem;
      if (safeTemperature !== undefined) anthropicBody.temperature = safeTemperature;

      let response, data;
      try {
        response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
            'x-api-key': ANTHROPIC_API_KEY.value(),
          },
          body: JSON.stringify(anthropicBody),
        });
        data = await response.json();
      } catch (e) {
        // Network/parse error reaching Anthropic — refund full reservation.
        await adjustClaudeBudget(uidCounterRef, coCounterRef, -reservation).catch(() => {});
        logger.error('claudeProxy upstream fetch error', { err: e.message });
        res.status(502).json({ error: 'Upstream AI error' });
        return;
      }
      if (!response.ok) {
        // Anthropic returned an error — refund and forward the status.
        await adjustClaudeBudget(uidCounterRef, coCounterRef, -reservation).catch(() => {});
        res.status(response.status).json(data);
        return;
      }

      try {
        // C6: stamp leadId + feature on every api_usage row so we
        // can attribute cost per-deal. Client passes them in the
        // body; trust but bound (120 char max on feature, plain
        // string on leadId).
        const leadId  = typeof req.body?.leadId  === 'string' ? req.body.leadId.slice(0, 80)  : null;
        const feature = typeof req.body?.feature === 'string' ? req.body.feature.slice(0, 60) : null;
        const inTok  = Number(data.usage?.input_tokens)  || 0;
        const outTok = Number(data.usage?.output_tokens) || 0;
        const total  = inTok + outTok;
        // C-03: reconcile actual vs reservation. Positive delta =
        // we undershot and owe the counter more tokens; negative =
        // we overshot and refund. Net effect: the counter converges
        // on true usage while the transactional reservation kept
        // concurrent callers honest.
        const delta  = total - reservation;
        const srv = admin.firestore.FieldValue.serverTimestamp();
        await Promise.all([
          admin.firestore().collection('api_usage').add({
            uid: decoded.uid,
            companyId: callerCompanyId,   // H-5: per-company budget query
            leadId,                        // C6: per-lead cost attribution
            feature,                       // e.g. 'ask-joe', 'decision-engine', 'rep-report'
            plan,
            model: anthropicBody.model,
            inputTokens: inTok,
            outputTokens: outTok,
            reservation,                   // C-03: audit for over/undershoot trending
            timestamp: srv,
          }),
          adjustClaudeBudget(uidCounterRef, coCounterRef, delta),
        ]);
      } catch (e) {
        logger.warn('api_usage logging failed', { err: e.message });
      }

      res.json(data);
    } catch (e) {
      logger.error('claudeProxy error', { uid: decoded?.uid, err: e.message });
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

/**
 * Creates a Stripe Checkout Session for subscription
 * POST /createCheckoutSession
 * Body: { plan: 'foundation' | 'professional' }
 * Headers: Authorization: Bearer <firebase-id-token>
 */

/**
 * Handles Stripe webhook events
 * POST /stripeWebhook
 * No auth required (verifies Stripe signature instead)
 */

/**
 * Creates a Stripe billing portal session for customer to manage subscription
 * POST /createCustomerPortalSession
 * Headers: Authorization: Bearer <firebase-id-token>
 */

/**
 * Retrieves current subscription status for a user
 * GET /getSubscriptionStatus
 * Headers: Authorization: Bearer <firebase-id-token>
 */

// ═══════════════════════════════════════════════════════════════
// STORAGE CORS + SIGNED IMAGE URLS
// ═══════════════════════════════════════════════════════════════

/**
 * One-time function to set CORS on the Firebase Storage bucket.
 * Call once via: POST /setStorageCors with Authorization header
 */
exports.setStorageCors = onRequest(
  {
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    maxInstances: 1,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (req, res) => {
    // Admin-only — uses custom claims, not a self-owned Firestore role doc.
    const authResult = await requireAuth(req, { adminOnly: true });
    if (authResult.error) { res.status(authResult.error.status).json(authResult.error.body); return; }
    try {
      const bucket = admin.storage().bucket();
      await bucket.setCorsConfiguration([
        {
          origin: [
            'https://nobigdealwithjoedeal.com',
            'https://www.nobigdealwithjoedeal.com',
            'https://nobigdeal-pro.web.app',
          ],
          method: ['GET', 'HEAD', 'OPTIONS'],
          maxAgeSeconds: 3600,
          responseHeader: ['Content-Type', 'Authorization', 'Content-Length', 'User-Agent'],
        },
      ]);
      logger.info('storage_cors_updated');
      res.json({ success: true, message: 'CORS configuration applied to storage bucket' });
    } catch (e) {
      logger.error('setStorageCors error', { err: e.message });
      res.status(500).json({ error: e.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// signImageUrl — serves Storage reads to authorized clients.
//
// Returns a short-lived (15 min) v4-signed Storage URL after
// authorizing the caller. Same auth/ACL matrix as the Firestore
// owner/manager/platform-admin rules: owner uid match OR same-
// company manager OR platform admin. Clients POST {path} and fetch
// the returned url directly from storage.googleapis.com — we never
// proxy bytes through the function (R-03 lesson; imageProxy did,
// and it double-egressed + starved the instance pool under load).
//
// Endpoint: POST /signImageUrl  { path: 'photos/<uid>/<file>' }
// Returns:  { url: 'https://storage.googleapis.com/...<query>' }
// ═══════════════════════════════════════════════════════════════
exports.signImageUrl = onRequest(
  {
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    // R-05 sizing: every photo render on every page fires one sign
    // call (the 14-minute client cache at signed-image-url.js:23
    // prevents re-signs within a session, but fresh loads all hit).
    // At 10k users × ~10 photos visible on first render =
    // ~100k signs/min peak. Per-instance: 80 concurrent × (signing
    // latency ~150ms) = ~500/sec. 200 instances × 500 = 100k/sec
    // headroom. minInstances:2 absorbs cold-start when a dashboard
    // load spikes right after a quiet window.
    maxInstances: 200,
    concurrency: 80,
    minInstances: 2,
    timeoutSeconds: 15,
    memory: '256MiB'
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

    const authResult = await requireAuth(req);
    if (authResult.error) { res.status(authResult.error.status).json(authResult.error.body); return; }
    const { decoded } = authResult;

    if (!(await httpRateLimit(req, res, 'signImageUrl:ip', 300, 60_000))) return;
    try {
      await enforceRateLimit('signImageUrl:uid', decoded.uid, 300, 60_000);
    } catch (e) {
      if (e.rateLimited) { res.status(429).json({ error: 'Rate limit exceeded' }); return; }
      throw e;
    }

    let filePath = (req.body && req.body.path) || '';
    if (typeof filePath !== 'string' || filePath.length > 500) {
      res.status(400).json({ error: 'Invalid path' }); return;
    }
    if (/%2e|\0|\\|;|\.\./.test(filePath) || filePath.includes('//')) {
      res.status(400).json({ error: 'Invalid path' }); return;
    }
    // H-01: `portals/` intentionally excluded. Storage rules allow
    // HTML uploads under portals/{uid}/ for the legacy customer-
    // portal flow, but HTML served through this signed URL would
    // execute in the storage.googleapis.com origin. Customer-facing
    // portal HTML is served by Firebase Hosting (see storage.rules:78
    // comment). Nobody should be signing portal URLs here.
    const match = filePath.match(/^(photos|galleries|reports|docs)\/([^/]+)\/(.+)$/);
    if (!match) { res.status(400).json({ error: 'Invalid path shape' }); return; }
    const [, , ownerUid] = match;

    const isOwner = ownerUid === decoded.uid;
    const isPlatformAdmin = decoded.role === 'admin';
    let allowed = isOwner || isPlatformAdmin;
    if (!allowed) {
      const callerCompanyId = decoded.companyId || null;
      const callerRole = decoded.role || '';
      if (callerCompanyId && ['manager', 'company_admin'].includes(callerRole)) {
        try {
          const db = admin.firestore();
          const [userDoc, repDoc] = await Promise.all([
            db.doc(`users/${ownerUid}`).get(),
            db.doc(`reps/${ownerUid}`).get()
          ]);
          const ownerCompanyId = (userDoc.exists && userDoc.data().companyId)
            || (repDoc.exists  && repDoc.data().companyId)
            || null;
          if (ownerCompanyId && ownerCompanyId === callerCompanyId) allowed = true;
        } catch (e) { /* fall through */ }
      }
    }
    if (!allowed) { res.status(403).json({ error: 'Forbidden' }); return; }

    try {
      const bucket = admin.storage().bucket();
      const file = bucket.file(filePath);
      const [exists] = await file.exists();
      if (!exists) { res.status(404).json({ error: 'File not found' }); return; }

      // 15-minute signed URL. Short enough that a stolen URL can't
      // be re-used indefinitely; long enough that a page render +
      // photo grid scroll doesn't force re-signing on every image.
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 15 * 60_000,
        version: 'v4'
      });
      res.set('Cache-Control', 'private, max-age=300');
      res.status(200).json({ url, expiresIn: 900 });
    } catch (e) {
      logger.error('signImageUrl error', { err: e.message });
      res.status(500).json({ error: 'Signing failed' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// R-03: imageProxy is RETIRED.
//
// The old handler streamed Storage bytes through the function, which
// means every image egressed twice (Storage → Function → Client). At
// 10k users × 20 photos × 500KB that's ~100GB/hr through 256Mi
// function instances — the instance bandwidth ceiling (~1 Gbps per)
// starves the pool before the workload ever reaches maxInstances.
// It was also a stored-XSS vector (H-01) because it echoed whatever
// Content-Type the Storage metadata carried.
//
// Every caller migrated to signImageUrl + the NBDSignedUrl helper
// (docs/pro/js/signed-image-url.js). The stub below exists only to
// fail loudly for any stale client (cached service worker, open tab,
// third-party integration, uncached CDN edge) that still calls the
// old URL. It holds NO auth, NO Firestore touches, NO Storage reads
// — just a cheap 410 response that carries the RFC 8594 Deprecation
// + Sunset headers pointing to the successor.
//
// Safe to delete outright after 7+ days of zero calls in Cloud Logs.
// Retaining it short-term matches the pattern used for the retired
// Cloudflare Worker at workers/nbd-ai-proxy.js.
// ═══════════════════════════════════════════════════════════════
exports.imageProxy = onRequest(
  {
    cors: CORS_ORIGINS,
    maxInstances: 2,
    concurrency: 20,
    timeoutSeconds: 5,
    memory: '128MiB',
  },
  (req, res) => {
    res.set('Deprecation', 'true');
    res.set('Sunset', 'Wed, 01 Oct 2026 00:00:00 GMT');
    res.set('Link', '</signImageUrl>; rel="successor-version"');
    res.set('Cache-Control', 'public, max-age=3600');
    res.status(410).json({
      error: 'gone',
      message: 'imageProxy has been retired. Use POST /signImageUrl { path } to obtain a 15-minute v4-signed Storage URL, then fetch it directly from storage.googleapis.com.',
      successor: '/signImageUrl'
    });
  }
);

// ═══════════════════════════════════════════════════════════════
// PUSH NOTIFICATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════
const pushFunctions = require('./push-functions');
Object.assign(exports, pushFunctions);

// ═══════════════════════════════════════════════════════════════
// EMAIL FUNCTIONS
// ═══════════════════════════════════════════════════════════════
const emailFunctions = require('./email-functions');
Object.assign(exports, emailFunctions);

// ═══════════════════════════════════════════════════════════════
// SMS FUNCTIONS
// ═══════════════════════════════════════════════════════════════
const smsFunctions = require('./sms-functions');
Object.assign(exports, smsFunctions);

// ═══════════════════════════════════════════════════════════════
// AUDIT LOG TRIGGERS (H-4)
// Loaded from a sibling module to keep index.js tractable.
// ═══════════════════════════════════════════════════════════════
const auditTriggers = require('./audit-triggers');
Object.assign(exports, auditTriggers);

// ═══════════════════════════════════════════════════════════════
// INTEGRATIONS — every adapter is a no-op when its secret is unset.
// Add more to functions/integrations/ and register them here.
// ═══════════════════════════════════════════════════════════════
const slackIntegration       = require('./integrations/slack');
const measurementIntegration = require('./integrations/measurement');
const esignIntegration       = require('./integrations/esign');
const parcelIntegration      = require('./integrations/parcel');
const hailIntegration        = require('./integrations/hail');
const calcomIntegration      = require('./integrations/calcom');
const hailCron               = require('./integrations/hail-cron');
const complianceIntegration  = require('./integrations/compliance');
const deviceAlertIntegration = require('./integrations/device-alert');
const emailQueueWorker       = require('./integrations/email-queue-worker');
const voiceMemoIntegration   = require('./integrations/voice-memo');
const voiceIntelligenceIntegration = require('./integrations/voice-intelligence');
Object.assign(exports, slackIntegration);
Object.assign(exports, measurementIntegration);
Object.assign(exports, esignIntegration);
Object.assign(exports, parcelIntegration);
Object.assign(exports, hailIntegration);
Object.assign(exports, calcomIntegration);
Object.assign(exports, hailCron);
Object.assign(exports, complianceIntegration);
Object.assign(exports, deviceAlertIntegration);
Object.assign(exports, emailQueueWorker);
Object.assign(exports, voiceMemoIntegration);
Object.assign(exports, voiceIntelligenceIntegration);

// ═══════════════════════════════════════════════════════════════
// integrationStatus — client-facing readout of which adapters are
// configured in this deploy. Lets the UI disable a button for an
// unconfigured provider instead of showing a cryptic error.
// ═══════════════════════════════════════════════════════════════
const {
  hasSecret: _hasInt,
  getSecret: _getInt,
  PROVIDERS: _intProviders,
  SECRETS: _intSecrets
} = require('./integrations/_shared');
exports.integrationStatus = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 10,
    memory: '128MiB',
    secrets: Object.values(_intSecrets)
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    // H-06: gate to admin / company_admin. The previous "any authed
    // user" rule let a free-tier caller enumerate the full security
    // posture — specifically, whether Turnstile, Upstash, Sentry, and
    // Slack were configured. That's a reconnaissance amplifier: a
    // `turnstile:false` response turns submitPublicLead into an
    // IP-rate-limit-only surface. Keep the enumeration restricted
    // to people who already have a legitimate business-integration
    // UI to grey-out buttons on.
    const callerRole = (request.auth.token && request.auth.token.role) || '';
    if (!['admin', 'company_admin'].includes(callerRole)) {
      throw new HttpsError('permission-denied', 'Admin access required');
    }
    // R-01: the RUNTIME-active rate-limit provider. Derived from
    // both NBD_RATE_LIMIT_PROVIDER env AND whether the Upstash secrets
    // are populated. 'firestore' means the hot-doc path is live —
    // under 10k-user carrier-NAT load this is the documented R-01
    // throughput ceiling. Admin-visible so post-deploy verification
    // doesn't require grepping Cloud Logging.
    const { provider: rateLimitProvider } = require('./integrations/upstash-ratelimit');
    return {
      providers: _intProviders,
      configured: {
        sentry:      _hasInt('SENTRY_DSN_FUNCTIONS'),
        slack:       _hasInt('SLACK_WEBHOOK_URL'),
        turnstile:   _hasInt('TURNSTILE_SECRET'),
        upstash:     _hasInt('UPSTASH_REDIS_REST_URL') && _hasInt('UPSTASH_REDIS_REST_TOKEN'),
        hover:       _hasInt('HOVER_API_KEY'),
        eagleview:   _hasInt('EAGLEVIEW_API_KEY'),
        nearmap:     _hasInt('NEARMAP_API_KEY'),
        boldsign:    _hasInt('BOLDSIGN_API_KEY'),
        regrid:      _hasInt('REGRID_API_TOKEN'),
        hailtrace:   _hasInt('HAILTRACE_API_KEY'),
        calcom:      _hasInt('CALCOM_WEBHOOK_SECRET'),
        deepgram:    _hasInt('DEEPGRAM_API_KEY')
      },
      rateLimitProvider: rateLimitProvider()
    };
  }
);

// ═══════════════════════════════════════════════════════════════
// HOMEOWNER PORTAL (createPortalToken, revokePortalToken,
// getHomeownerPortalView) — extracted to functions/portal.js
// (L-03). portal.js is self-contained: it imports admin, secrets,
// and the rate-limit adapter directly. Loading + Object.assign here
// preserves the existing Firebase-deploy export shape, so no CI
// workflow change is needed.
// ═══════════════════════════════════════════════════════════════
const portalFunctions = require('./portal');
Object.assign(exports, portalFunctions);

// L-03 cont.: Stripe handlers (createCheckoutSession, stripeWebhook,
// createCustomerPortalSession, getSubscriptionStatus,
// createStripePaymentLink, invoiceWebhook) live in functions/stripe.js.
// Extracted verbatim; see `git log --follow functions/stripe.js`.
const stripeFunctions = require('./stripe');
Object.assign(exports, stripeFunctions);

// Automated Firestore daily backup + retention. No deploy infra
// required beyond a one-time bucket + IAM setup documented in
// functions/firestore-backup.js. Both functions are scheduled-only.
const firestoreBackup = require('./firestore-backup');
Object.assign(exports, firestoreBackup);

// ═══════════════════════════════════════════════════════════════
// getAdminAnalytics — C3: ops dashboard numbers for the Team Manager.
//
// Returns:
//   signatures:   { sent30d, signed30d, avgHoursToSign }
//   measurements: { requested30d, ready30d, passThruRevenueEst }
//   portal:       { linksMinted30d, portalViews30d }
//   claude:       { tokens30d, costEstimate }
//   leads:        { created30d, signed30d, winRatePct }
//
// Platform admin OR company_admin of the target company. company_admin
// gets scoped to their own companyId; platform admin gets the union
// across the platform when called without a company filter.
// ═══════════════════════════════════════════════════════════════
exports.getAdminAnalytics = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '512MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const isPlatformAdmin = request.auth.token.role === 'admin';
    const isCompanyAdmin  = request.auth.token.role === 'company_admin';
    // H-04: a previous "solo-owner fallback" branch let every
    // authenticated user without a companyId claim (i.e. every
    // free-tier signup) through this callable. Each call runs three
    // 30-day collection scans — a cheap DoS vector and a
    // reconnaissance gift. Require an actual admin claim.
    if (!isPlatformAdmin && !isCompanyAdmin) {
      throw new HttpsError('permission-denied', 'Admin access required');
    }
    // Per-uid rate limit — admins still shouldn't be calling this in
    // a loop. 30/hour is generous for a dashboard refresh.
    await callableRateLimit(request, 'getAdminAnalytics', 30, 3_600_000);

    const companyId = isPlatformAdmin
      ? (request.data?.companyId || request.auth.token.companyId || null)
      : request.auth.token.companyId;

    const db = admin.firestore();
    const since = admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 86_400_000);

    // Helper — for a rep-owned collection, restrict to the caller's
    // company when not platform admin. Platform admin with no company
    // filter gets unfiltered.
    async function companyUids() {
      if (!companyId) return null; // platform admin, global
      const membersSnap = await db.collection('companies/' + companyId + '/members').get();
      const uids = membersSnap.docs.map(d => d.data().uid).filter(Boolean);
      // Always include the owner.
      const coSnap = await db.doc('companies/' + companyId).get();
      if (coSnap.exists && coSnap.data().ownerId) uids.push(coSnap.data().ownerId);
      return [...new Set(uids)];
    }

    const repUids = await companyUids();

    // Signatures — walk estimates created in last 30d that have a
    // signatureStatus of sent/viewed/signed/declined/expired.
    let estQuery = db.collection('estimates').where('createdAt', '>=', since);
    const estSnap = await estQuery.get();
    const ests = estSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(e => !repUids || repUids.includes(e.userId));
    const sent = ests.filter(e => e.signatureStatus && e.signatureStatus !== 'none');
    const signed = ests.filter(e => e.signatureStatus === 'signed');
    const hours = signed
      .map(e => {
        const sent_t = e.signatureSentAt?.toMillis?.();
        const signed_t = e.signedAt?.toMillis?.();
        return (sent_t && signed_t) ? (signed_t - sent_t) / 3_600_000 : null;
      })
      .filter(h => h != null && h > 0);
    const avgHoursToSign = hours.length
      ? Math.round(hours.reduce((a, b) => a + b, 0) / hours.length * 10) / 10
      : null;

    // Measurements — rollup of count + estimated revenue from the
    // pass-through line. We count only 'ready' jobs in the window.
    let msQuery = db.collection('measurements').where('createdAt', '>=', since);
    const msSnap = await msQuery.get();
    const measurements = msSnap.docs.map(d => d.data())
      .filter(m => !repUids || repUids.includes(m.ownerId));
    const readyMeas = measurements.filter(m => m.status === 'ready');
    const passThruPrice = Number(process.env.NBD_MEASUREMENT_PASSTHRU_PRICE) || 75;
    const passThruRevenueEst = readyMeas.length * passThruPrice;

    // Portal links
    let linksMinted30d = 0, portalViews30d = 0;
    try {
      const tokSnap = await db.collection('portal_tokens')
        .where('mintedAt', '>=', since).get();
      const tokens = tokSnap.docs.map(d => d.data())
        .filter(t => !repUids || repUids.includes(t.ownerUid));
      linksMinted30d = tokens.length;
      portalViews30d = tokens.reduce((s, t) => s + (t.uses || 0), 0);
    } catch (e) { /* index may not exist yet */ }

    // Claude tokens — we already stamp companyId on api_usage.
    let claudeTokens30d = 0;
    try {
      const q = companyId
        ? db.collection('api_usage').where('companyId', '==', companyId).where('timestamp', '>=', since)
        : db.collection('api_usage').where('timestamp', '>=', since);
      const s = await q.get();
      s.forEach(d => {
        const r = d.data();
        claudeTokens30d += (r.inputTokens || 0) + (r.outputTokens || 0);
      });
    } catch (e) { /* fall through */ }
    // Sonnet pricing: $3/M input, $15/M output. Approx with ratio
    // input:output = 3:1 which is our typical.
    const claudeCostEstimate = (claudeTokens30d / 1_000_000) * 6.0;

    // Leads
    let leadQuery = db.collection('leads').where('createdAt', '>=', since);
    const leadSnap = await leadQuery.get();
    const leads = leadSnap.docs.map(d => d.data())
      .filter(l => !repUids || repUids.includes(l.userId));
    const createdCount = leads.length;
    const signedCount = leads.filter(l => /sign|won|closed/i.test(l.stage || '')).length;

    return {
      range: 'last 30 days',
      companyId: companyId || 'all',
      generatedAt: new Date().toISOString(),
      signatures: {
        sent30d: sent.length,
        signed30d: signed.length,
        avgHoursToSign: avgHoursToSign
      },
      measurements: {
        requested30d: measurements.length,
        ready30d: readyMeas.length,
        passThruRevenueEst: passThruRevenueEst,
        passThruPrice
      },
      portal: {
        linksMinted30d,
        portalViews30d
      },
      claude: {
        tokens30d: claudeTokens30d,
        costEstimateUSD: Math.round(claudeCostEstimate * 100) / 100
      },
      leads: {
        created30d: createdCount,
        won30d: signedCount,
        winRatePct: createdCount > 0 ? Math.round(signedCount / createdCount * 100) : 0
      }
    };
  }
);

// L-03: revokePortalToken + getHomeownerPortalView moved to
// functions/portal.js alongside createPortalToken (loaded near the
// top of this file via `Object.assign(exports, portalFunctions)`).
// Full history: `git log --follow functions/portal.js`.

// ═══════════════════════════════════════════════════════════════
// INVOICE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Creates a Stripe Payment Link for an invoice
 * POST /createStripePaymentLink
 * Body: { invoiceId: string }
 * Headers: Authorization: Bearer <firebase-id-token>
 * Returns: { url: string, paymentLinkId: string }
 */

/**
 * Handles Stripe webhook events for invoice payments
 * POST /invoiceWebhook
 * No auth required (verifies Stripe signature instead)
 * Handles: payment_intent.succeeded → marks invoice as paid
 */


// ── Verification Functions (SMS OTP + Lead Notifications) ──
const verifyFunctions = require('./verify-functions');
Object.assign(exports, verifyFunctions);

// ── Audit log triggers ──
const auditLog = require('./audit-log');
Object.assign(exports, auditLog);

// ═══════════════════════════════════════════════════════════════════════════
// publicVisualizerAI — Public homeowner visualizer endpoint.
//
// The marketing-site visualizer.html calls this to get an AI-generated
// assessment of a home photo. Homeowners are NOT authenticated, so we
// cannot use the claudeProxy subscription gate. Instead:
//   - enforceAppCheck: true (blocks curl/bot replay of the reCAPTCHA token)
//   - per-IP rolling-window rate limit: 5 requests / hour
//   - model locked to Haiku (cheapest tier)
//   - max_tokens hard-capped at 800
//   - system prompt is server-owned, client cannot inject one
//   - image payload must be a base64-encoded JPEG/PNG under 1.5 MB
// ═══════════════════════════════════════════════════════════════════════════
const VISUALIZER_MAX_B64_BYTES = Math.round(1.5 * 1024 * 1024 * 4 / 3); // ~2 MB base64
const VISUALIZER_SYSTEM_PROMPT = "You are Joe Deal, owner of No Big Deal Home Solutions in Greater Cincinnati, OH — a roofing and exterior contractor. A homeowner has uploaded a photo of their house AND has already picked the exterior materials/colors they want to see (their selections are in the user message). Your job is to write a warm, 150-200 word assessment that MAKES THEIR SELECTION SOUND GOOD.\n\nPRODUCT DICTIONARY (use these terms correctly — never confuse them):\n- \"architectural asphalt shingles\" = dimensional laminated asphalt shingles (NOT flat, NOT 3-tab)\n- \"3-tab asphalt shingles\" = flat traditional asphalt shingles\n- \"luxury designer asphalt shingles\" = premium heavyweight asphalt shingles (NOT metal, NOT slate)\n- \"standing-seam metal roofing panels\" = flat metal panels with raised seams. This is NOT \"metal shingles\" (a different product). If the user selected metal, it is standing seam — refer to it as a \"standing-seam metal roof\" or \"metal panels\" — NEVER \"metal shingles.\"\n- \"natural slate tile\" = real stone slate tiles\n- \"dutch-lap vinyl siding\", \"board-and-batten vertical siding\", \"cedar-shake siding\", \"horizontal lap siding\", \"James Hardie fiber-cement\" — use these exact product names when referring to siding\n\nSTRUCTURE:\n(1) Briefly acknowledge what the home currently has (roof age, siding condition, anything you can see from the photo).\n(2) Explain specifically why the selections they made will look good on THIS house — cite real reasons (material durability, how the color complements brick/trim/landscaping, curb appeal).\n(3) Mention one practical install consideration so you sound like a real contractor, not a salesman.\n\nBe encouraging and on-their-side — they've ALREADY chosen; don't second-guess them or pitch alternatives. Do NOT say things like 'I'd recommend instead' or 'consider a different color.'\n\nAfter the 150-200 word assessment, append a short visual description prefixed with 'CANVAS:' that describes colors and materials as hex values (this line is machine-parsed and not shown to the user).";

exports.publicVisualizerAI = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [ANTHROPIC_API_KEY],
    enforceAppCheck: true,
    maxInstances: 10,
    concurrency: 20,
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Per-IP cap — 5 visualizer calls / hour from a single IP. Each call is
    // a ~$0.01 Haiku request; 5/hour caps cost per IP at ~$0.05/hour worst case.
    if (!(await httpRateLimit(req, res, 'publicVisualizerAI:ip', 5, 3_600_000))) return;

    try {
      const { imageBase64, mediaType, selectionsText, notes } = req.body || {};

      if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
        res.status(400).json({ error: 'imageBase64 required' });
        return;
      }
      if (imageBase64.length > VISUALIZER_MAX_B64_BYTES) {
        res.status(413).json({ error: 'Image too large (max 1.5 MB)' });
        return;
      }
      const allowedMedia = new Set(['image/jpeg', 'image/png', 'image/webp']);
      const safeMediaType = allowedMedia.has(mediaType) ? mediaType : 'image/jpeg';
      const safeSelections = String(selectionsText || '').slice(0, 400);
      const safeNotes = String(notes || '').slice(0, 400);

      const anthropicBody = {
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: VISUALIZER_SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: safeMediaType, data: imageBase64 } },
            { type: 'text', text: `Selections: ${safeSelections}.${safeNotes ? ' Notes: ' + safeNotes : ''}` },
          ],
        }],
      };

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': ANTHROPIC_API_KEY.value(),
        },
        body: JSON.stringify(anthropicBody),
      });

      const data = await response.json();
      if (!response.ok) {
        logger.warn('publicVisualizerAI: upstream error', { status: response.status });
        res.status(response.status).json({ error: 'Upstream AI error' });
        return;
      }

      // Return only the text content, never the full upstream payload.
      const text = Array.isArray(data.content)
        ? data.content.map(c => (c && c.type === 'text' ? c.text : '')).join('')
        : '';
      res.json({ text });
    } catch (e) {
      logger.error('publicVisualizerAI error', { err: e.message });
      res.status(500).json({ error: 'Internal error' });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// seedDemoData — REMOVED.
// Previously this was an unauthenticated POST that ran the full demo
// seeder. It's a destructive cost-DoS vector. Demo data is now seeded
// manually via the Firebase Admin CLI against a local emulator, not
// via a deployed Cloud Function.
// ═══════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════
// validateAccessCode — hardened.
//
// Security notes:
// - Codes live in Firestore (`access_codes/{CODE}`) and are writable only
//   via admin SDK. Clients cannot enumerate or read this collection.
// - Never returns a password. Instead mints a Firebase custom token that
//   the client exchanges via `signInWithCustomToken`.
// - The `admin` role is NEVER granted via access code. Admin access is
//   provisioned by a Joe-only CLI script that calls setCustomUserClaims.
// - Per-IP rate limit (5 requests / 5 minutes). Failed attempts logged.
// - Requires App Check so random curl/script callers are blocked.
// ═══════════════════════════════════════════════════════════════════
exports.validateAccessCode = onCall(
  {
    enforceAppCheck: true,
    maxInstances: 5,
    concurrency: 10,
    timeoutSeconds: 15,
    memory: '256MiB',
  },
  async (request) => {
    const ip = clientIp(request.rawRequest || {});

    // Per-IP rate limit — tight. 5 attempts / 5 minutes.
    try {
      await enforceRateLimit('validateAccessCode:ip', ip, 5, 5 * 60_000);
    } catch (e) {
      if (e.rateLimited) {
        throw new HttpsError('resource-exhausted', 'Too many attempts. Try again in a few minutes.');
      }
      throw e;
    }

    const rawCode = (request.data && request.data.code) || '';
    if (typeof rawCode !== 'string' || rawCode.length < 3 || rawCode.length > 40) {
      throw new HttpsError('invalid-argument', 'Code not recognized');
    }
    const normalized = rawCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!normalized) {
      throw new HttpsError('invalid-argument', 'Code not recognized');
    }

    const db = admin.firestore();
    const codeRef = db.collection('access_codes').doc(normalized);
    const codeSnap = await codeRef.get();
    if (!codeSnap.exists) {
      logger.warn('access_code_invalid', { ip, normalized });
      throw new HttpsError('not-found', 'Code not recognized');
    }
    const code = codeSnap.data();
    if (code.active !== true) {
      logger.warn('access_code_inactive', { ip, normalized });
      throw new HttpsError('permission-denied', 'Code not recognized');
    }
    if (code.expiresAt && code.expiresAt.toMillis && code.expiresAt.toMillis() < Date.now()) {
      throw new HttpsError('permission-denied', 'Code expired');
    }
    if (typeof code.maxUses === 'number' && typeof code.useCount === 'number' && code.useCount >= code.maxUses) {
      throw new HttpsError('resource-exhausted', 'Code fully redeemed');
    }
    // Hard rule: access codes NEVER grant admin.
    const role = code.role === 'manager' ? 'manager' : 'member';
    const email = typeof code.email === 'string' && code.email.includes('@') ? code.email : null;
    if (!email) {
      logger.error('access_code_missing_email', { normalized });
      throw new HttpsError('failed-precondition', 'Code misconfigured. Contact support.');
    }

    try {
      // Look up or create the user — but do not overwrite passwords.
      let userRecord;
      try {
        userRecord = await admin.auth().getUserByEmail(email);
      } catch (e) {
        if (e.code === 'auth/user-not-found') {
          userRecord = await admin.auth().createUser({
            email,
            emailVerified: false,
            displayName: code.displayName || 'NBD Member',
          });
        } else {
          throw e;
        }
      }

      // Set role claim (never admin).
      await admin.auth().setCustomUserClaims(userRecord.uid, { role });

      // Create subscription doc via admin SDK. Trust only the fields from the
      // Firestore-stored access code record.
      const planFromCode = code.plan === 'professional' ? 'professional' : 'foundation';
      const subData = {
        plan: planFromCode,
        status: 'active',
        source: 'access_code',
        accessCode: normalized,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (typeof code.trialDays === 'number' && code.trialDays > 0) {
        const trialEnd = new Date(Date.now() + code.trialDays * 86_400_000);
        subData.trialEndsAt = admin.firestore.Timestamp.fromDate(trialEnd);
      }
      const subRef = db.doc(`subscriptions/${userRecord.uid}`);
      if (!(await subRef.get()).exists) {
        subData.createdAt = admin.firestore.FieldValue.serverTimestamp();
      }
      await subRef.set(subData, { merge: true });

      // Create user profile doc if missing. Role is set via claim, not via the
      // users/<uid>.role field (which clients can write).
      const userDocRef = db.doc(`users/${userRecord.uid}`);
      const userDocSnap = await userDocRef.get();
      if (!userDocSnap.exists) {
        await userDocRef.set({
          email,
          displayName: userRecord.displayName || 'NBD Member',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Increment usage counter.
      await codeRef.update({
        useCount: admin.firestore.FieldValue.increment(1),
        lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Mint a short-lived custom token. Client exchanges via signInWithCustomToken.
      const customToken = await admin.auth().createCustomToken(userRecord.uid, { role });
      logger.info('access_code_redeemed', { normalized, uid: userRecord.uid, role });
      return { success: true, customToken, role };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      logger.error('validateAccessCode error', { normalized, err: e.message });
      throw new HttpsError('internal', 'Authentication error. Please try again.');
    }
  }
);

// ═════════════════════════════════════════════════════════════
// backfillAnalytics — one-time enrichment of existing knocks + leads
//
// Derives analytics fields from the data that's already stored:
//   - hourOfDay, dayOfWeek (from timestamp) — for time-of-day heatmaps
//   - city, zip, state (via Google Geocoding if API key set + lat/lng)
//
// Scope: owner-only. Runs against the calling user's own docs. Never
// touches another user's data.
//
// Degraded mode: if GOOGLE_GEOCODING_API_KEY isn't set, the function
// still processes timestamp-based fields (hourOfDay, dayOfWeek) so
// the Rep Report Generator's heatmaps work. Reverse-geocoding is
// skipped with a warning in the response.
//
// Idempotent: re-running the function only enriches docs that are
// missing the fields. Existing enriched docs are skipped.
// ═════════════════════════════════════════════════════════════
exports.backfillAnalytics = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    secrets: [GOOGLE_GEOCODING_API_KEY],
    timeoutSeconds: 540, // 9 minutes — enough for ~5k docs
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');

    // Rate-limit: max 1 call per 10 minutes per user. Backfill is
    // expensive (hits Google Geocoding + writes to Firestore), so
    // we don't want someone spamming the button.
    try {
      await enforceRateLimit({
        key: 'backfill:' + uid,
        windowSec: 600,
        maxCalls: 1
      });
    } catch (e) {
      throw new HttpsError('resource-exhausted', 'Please wait 10 minutes between backfill runs.');
    }

    const geocodingKey = GOOGLE_GEOCODING_API_KEY.value();
    const hasGeocoding = !!(geocodingKey && geocodingKey.startsWith('AIza'));

    const summary = {
      knocksProcessed: 0,
      knocksEnriched: 0,
      knocksGeocoded: 0,
      leadsProcessed: 0,
      leadsEnriched: 0,
      leadsGeocoded: 0,
      geocodingEnabled: hasGeocoding,
      warnings: []
    };

    // ─ Knocks enrichment ─
    // Path: leads/{uid}/knocks/* (if the app stores knocks under user
    // subcollections) OR leads/{uid}/leads/{leadId}/knocks/*. We check
    // both paths. For safety this backfill only reads, writes, and
    // deletes from within the caller's uid namespace.
    const db = admin.firestore();

    // Fetch knocks collection — assumes top-level 'knocks' with userId field
    const knocksSnap = await db.collection('knocks').where('userId', '==', uid).limit(5000).get();
    logger.info('backfillAnalytics: knocks fetched', { uid, count: knocksSnap.size });

    // Process in batches of 400 writes (Firestore batch limit is 500)
    const geocodeCache = new Map();
    let batch = db.batch();
    let batchCount = 0;

    for (const doc of knocksSnap.docs) {
      summary.knocksProcessed++;
      const data = doc.data();
      const updates = {};

      // Time-of-day fields
      const ts = data.timestamp || data.createdAt;
      let d = null;
      if (ts && typeof ts.toDate === 'function') d = ts.toDate();
      else if (ts && ts.seconds) d = new Date(ts.seconds * 1000);
      else if (ts) d = new Date(ts);

      if (d && !isNaN(d.getTime())) {
        if (data.hourOfDay == null) updates.hourOfDay = d.getHours();
        if (data.dayOfWeek == null) updates.dayOfWeek = d.getDay();
      }

      // Reverse geocode if we have lat/lng and missing city
      if (hasGeocoding && data.location && data.location.lat && data.location.lng && !data.city) {
        try {
          const key = data.location.lat.toFixed(3) + ',' + data.location.lng.toFixed(3);
          let geo = geocodeCache.get(key);
          if (!geo) {
            geo = await reverseGeocode(data.location.lat, data.location.lng, geocodingKey);
            geocodeCache.set(key, geo);
          }
          if (geo) {
            if (geo.city) updates.city = geo.city;
            if (geo.zip) updates.zip = geo.zip;
            if (geo.state) updates.state = geo.state;
            summary.knocksGeocoded++;
          }
        } catch (e) {
          summary.warnings.push('Geocoding failed for knock ' + doc.id + ': ' + e.message);
        }
      }

      if (Object.keys(updates).length > 0) {
        batch.update(doc.ref, updates);
        batchCount++;
        summary.knocksEnriched++;
        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    // ─ Leads enrichment ─
    // Top-level 'leads' collection with userId == uid. Parse address
    // text into city/zip if those fields are missing.
    const leadsSnap = await db.collection('leads').where('userId', '==', uid).limit(5000).get();
    logger.info('backfillAnalytics: leads fetched', { uid, count: leadsSnap.size });

    for (const doc of leadsSnap.docs) {
      summary.leadsProcessed++;
      const data = doc.data();
      const updates = {};

      // Parse city/zip from address string if missing
      if (data.address && !data.city) {
        const parsed = parseAddress(data.address);
        if (parsed.city) updates.city = parsed.city;
        if (parsed.zip) updates.zip = parsed.zip;
        if (parsed.state) updates.state = parsed.state;
      }

      // Stage transition: if a lead is won/lost and has no closedAt,
      // use updatedAt as a proxy so velocity calcs have a signal.
      const stage = (data.stage || '').toString().toLowerCase();
      if (['closed','install_complete','final_payment','complete','lost'].includes(stage) && !data.closedAt) {
        updates.closedAt = data.updatedAt || data.createdAt || admin.firestore.FieldValue.serverTimestamp();
      }

      if (Object.keys(updates).length > 0) {
        batch.update(doc.ref, updates);
        batchCount++;
        summary.leadsEnriched++;
        if (updates.city) summary.leadsGeocoded++;
        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    // Final batch commit
    if (batchCount > 0) await batch.commit();

    if (!hasGeocoding) {
      summary.warnings.push('GOOGLE_GEOCODING_API_KEY not set — reverse geocoding skipped. Set the secret and re-run for full enrichment.');
    }

    logger.info('backfillAnalytics: done', { uid, ...summary });
    return summary;
  }
);

// Google Geocoding reverse lookup. Returns { city, zip, state } or null.
async function reverseGeocode(lat, lng, apiKey) {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' + lat + ',' + lng + '&key=' + apiKey;
  const response = await fetch(url);
  if (!response.ok) return null;
  const data = await response.json();
  if (data.status !== 'OK' || !data.results || !data.results.length) return null;
  const components = data.results[0].address_components || [];
  const result = {};
  for (const c of components) {
    if (c.types.includes('locality')) result.city = c.long_name;
    else if (c.types.includes('administrative_area_level_1')) result.state = c.short_name;
    else if (c.types.includes('postal_code')) result.zip = c.long_name;
  }
  return result;
}

// Cheap address parser — pulls city/state/zip from typical US format.
// Format: "123 Main St, Cincinnati, OH 45202" → { city, state, zip }
// Not perfect but covers the 80% case without an API call.
function parseAddress(addr) {
  if (!addr || typeof addr !== 'string') return {};
  const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return {};
  const result = {};
  // Last part: "OH 45202" or "45202"
  const last = parts[parts.length - 1];
  const zipMatch = last.match(/\b(\d{5}(?:-\d{4})?)\b/);
  if (zipMatch) result.zip = zipMatch[1];
  const stateMatch = last.match(/\b([A-Z]{2})\b/);
  if (stateMatch) result.state = stateMatch[1];
  // Second-to-last: city
  if (parts.length >= 2) {
    result.city = parts[parts.length - 2];
  }
  return result;
}

// ═════════════════════════════════════════════════════════════
// migratePinsToKnocks — one-time migration of the old 'pins'
// collection into 'knocks' so the Maps retirement is complete.
//
// Pin status → knock disposition mapping:
//   Signed       → appointment
//   Interested   → interested
//   Not Home     → not_home
//   Not Interested → not_interested
//   Callback     → interested  (closest match)
//   Do Not Knock → do_not_knock
//   Left Material → interested
//   Follow Up    → interested
//
// Scope: owner-only. Migrates only the calling user's pins.
// Idempotent: pins with migrated:true are skipped on re-runs.
// ═════════════════════════════════════════════════════════════
exports.migratePinsToKnocks = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 300,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');

    const db = admin.firestore();
    const STATUS_TO_DISPO = {
      'Signed':         'appointment',
      'Interested':     'interested',
      'Not Home':       'not_home',
      'Not Interested': 'not_interested',
      'Callback':       'interested',
      'Do Not Knock':   'do_not_knock',
      'Left Material':  'interested',
      'Follow Up':      'interested'
    };

    // Load all non-migrated pins for this user
    const pinsSnap = await db.collection('pins')
      .where('userId', '==', uid)
      .limit(5000)
      .get();

    let migrated = 0;
    let skipped = 0;
    let batch = db.batch();
    let batchCount = 0;

    for (const pinDoc of pinsSnap.docs) {
      const pin = pinDoc.data();
      if (pin.migrated) { skipped++; continue; }

      const disposition = STATUS_TO_DISPO[pin.status] || 'not_home';
      const knockDoc = {
        userId: uid,
        repId: uid,
        companyId: pin.companyId || 'default',
        address: pin.notes || pin.address || '',
        lat: pin.lat || null,
        lng: pin.lng || null,
        homeowner: '',
        phone: '',
        email: '',
        disposition: disposition,
        notes: 'Migrated from Maps pin: ' + (pin.status || 'unknown'),
        stage: disposition === 'appointment' ? 'appointment' : 'knock',
        attemptNumber: 1,
        createdAt: pin.createdAt || admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        convertedToLead: false,
        estimateValue: 0,
        closedDealValue: 0,
        insCarrier: '',
        claimNumber: '',
        photoUrls: [],
        voiceUrl: '',
        followUpTime: '',
        _migratedFromPin: pinDoc.id
      };

      // Create knock
      const knockRef = db.collection('knocks').doc();
      batch.set(knockRef, knockDoc);

      // Mark pin as migrated (don't delete — keep for audit)
      batch.update(pinDoc.ref, { migrated: true, migratedAt: admin.firestore.FieldValue.serverTimestamp() });

      batchCount += 2;
      migrated++;

      if (batchCount >= 400) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0) await batch.commit();

    logger.info('migratePinsToKnocks: done', { uid, migrated, skipped, total: pinsSnap.size });
    return { migrated, skipped, total: pinsSnap.size };
  }
);

// ═════════════════════════════════════════════════════════════
// auditCustomerDataIntegrity (Rock 3 PR 2)
//
// Read-only inventory of the caller's leads. Reports counts of
// leads missing companyId or customerId, plus 5 sample doc IDs of
// each so Joe can spot-check before running backfill. Caller-scoped
// — only sees their own leads (filtered by userId == request.auth.uid),
// so a rep can't audit somebody else's tenant.
//
// Returns:
//   {
//     total: <int>,
//     missingCompanyId: <int>, sampleMissingCompanyId: [docId, ...],
//     missingCustomerId: <int>, sampleMissingCustomerId: [docId, ...]
//   }
//
// Counterpart write fn: backfillCustomerData (next).
// ═════════════════════════════════════════════════════════════
exports.auditCustomerDataIntegrity = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 120,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');

    const db = admin.firestore();
    const snap = await db.collection('leads').where('userId', '==', uid).limit(10000).get();

    let missingCompanyId = 0;
    let missingCustomerId = 0;
    const sampleMissingCompanyId = [];
    const sampleMissingCustomerId = [];

    for (const doc of snap.docs) {
      const d = doc.data();
      if (!d.companyId) {
        missingCompanyId++;
        if (sampleMissingCompanyId.length < 5) sampleMissingCompanyId.push(doc.id);
      }
      if (!d.customerId) {
        missingCustomerId++;
        if (sampleMissingCustomerId.length < 5) sampleMissingCustomerId.push(doc.id);
      }
    }

    logger.info('auditCustomerDataIntegrity', {
      uid, total: snap.size, missingCompanyId, missingCustomerId
    });

    return {
      total: snap.size,
      missingCompanyId,
      sampleMissingCompanyId,
      missingCustomerId,
      sampleMissingCustomerId
    };
  }
);

// ═════════════════════════════════════════════════════════════
// backfillCustomerData (Rock 3 PR 2)
//
// Idempotent migration: scans the caller's leads and patches any
// doc missing `companyId` or `customerId`. Companies default to
// the caller's existing companyId claim, falling back to their uid
// (matches the solo-operator convention used in _saveLead and the
// `callerCompanyId = decoded.companyId || decoded.uid` pattern in
// the analytics callables). customerIds are allocated via the
// existing counters/customerIds transaction so we don't reuse
// numbers from the live counter.
//
// Safe to run multiple times — re-runs no-op on docs already fixed.
//
// Returns:
//   {
//     scanned: <int>,
//     fixedCompanyId: <int>,
//     fixedCustomerId: <int>,
//     stillMissing: <int>   // any doc the function couldn't safely patch
//   }
// ═════════════════════════════════════════════════════════════
exports.backfillCustomerData = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 540,
    memory: '512MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');

    const db = admin.firestore();
    const callerCompanyId = (request.auth.token && request.auth.token.companyId) || uid;

    const snap = await db.collection('leads').where('userId', '==', uid).limit(10000).get();

    let fixedCompanyId = 0;
    let fixedCustomerId = 0;
    let stillMissing = 0;
    let batch = db.batch();
    let batchCount = 0;

    const counterRef = db.collection('counters').doc('customerIds');

    for (const doc of snap.docs) {
      const d = doc.data();
      const updates = {};

      if (!d.companyId) {
        updates.companyId = callerCompanyId;
        fixedCompanyId++;
      }

      if (!d.customerId) {
        // Allocate a new NBD-#### transactionally, OUTSIDE the batch,
        // because the counter increment is global and the batch must
        // not race with a concurrent _saveLead client write.
        try {
          const newCid = await db.runTransaction(async (tx) => {
            const cs = await tx.get(counterRef);
            const next = cs.exists ? (cs.data().next || 0) + 1 : 1;
            tx.set(counterRef, { next }, { merge: true });
            return 'NBD-' + String(next).padStart(4, '0');
          });
          updates.customerId = newCid;
          fixedCustomerId++;
        } catch (cidErr) {
          logger.warn('backfillCustomerData: customerId alloc failed', { docId: doc.id, err: cidErr && cidErr.message });
          stillMissing++;
        }
      }

      if (Object.keys(updates).length > 0) {
        updates.backfilledAt = admin.firestore.FieldValue.serverTimestamp();
        batch.update(doc.ref, updates);
        batchCount++;

        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    if (batchCount > 0) await batch.commit();

    logger.info('backfillCustomerData: done', {
      uid, scanned: snap.size, fixedCompanyId, fixedCustomerId, stillMissing
    });

    return {
      scanned: snap.size,
      fixedCompanyId,
      fixedCustomerId,
      stillMissing
    };
  }
);

// ═════════════════════════════════════════════════════════════
// provisionE2ETestUser (Rock 3 PR 3)
//
// One-shot owner-only callable that provisions the Playwright E2E
// test user. Idempotent: if the user already exists it rotates the
// password and re-stamps the e2eTestAccount flag. Returns the new
// password ONCE in the response — caller's responsibility to capture
// and store it (GitHub Secrets etc.).
//
// Owner-only because creating a Firebase Auth account directly via
// Admin SDK is a privileged op. Mirrors the OWNER_EMAILS allowlist
// in docs/pro/js/nbd-auth.js so behaviour stays consistent.
//
// The created user is tagged so leaderboards and analytics can
// filter it out:
//   users/{uid}: { e2eTestAccount: true, companyId: <uid>, plan: 'free' }
//
// Returns:
//   {
//     email:    'playwright-e2e@nobigdealwithjoedeal.com',
//     password: <16-char strong random>,
//     uid:      <firebase auth uid>,
//     action:   'created' | 'rotated'
//   }
// ═════════════════════════════════════════════════════════════
const E2E_TEST_USER_EMAIL = 'playwright-e2e@nobigdealwithjoedeal.com';
const PROVISION_OWNER_EMAILS = new Set([
  'jd@nobigdealwithjoedeal.com',
  'jonathandeal459@gmail.com'
]);

function _generateE2EPassword() {
  // 16 chars, mix of upper/lower/digit/symbol. crypto.randomBytes is
  // CSPRNG-grade. Avoids ambiguous chars (0/O/1/l) so manual paste
  // into a secrets dialog isn't error-prone.
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@$%';
  const crypto = require('crypto');
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

exports.provisionE2ETestUser = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 60,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');

    const callerEmail = (request.auth.token && request.auth.token.email || '').toLowerCase();
    const callerRole  = request.auth.token && request.auth.token.role;
    const isOwner = PROVISION_OWNER_EMAILS.has(callerEmail);
    const isPlatformAdmin = callerRole === 'admin';
    if (!isOwner && !isPlatformAdmin) {
      logger.warn('provisionE2ETestUser: rejected non-owner', { uid, callerEmail });
      throw new HttpsError('permission-denied', 'Owner-only');
    }

    const auth = admin.auth();
    const db = admin.firestore();
    const password = _generateE2EPassword();

    let userRecord, action;
    try {
      userRecord = await auth.getUserByEmail(E2E_TEST_USER_EMAIL);
      // Already exists — rotate password.
      await auth.updateUser(userRecord.uid, { password, emailVerified: true });
      action = 'rotated';
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
      // Create from scratch.
      userRecord = await auth.createUser({
        email: E2E_TEST_USER_EMAIL,
        password,
        emailVerified: true,
        displayName: 'Playwright E2E Test User'
      });
      action = 'created';
    }

    // Stamp Firestore user doc so leaderboards/analytics can filter
    // and so the dashboard's plan-tier check doesn't lock us out.
    await db.collection('users').doc(userRecord.uid).set({
      email: E2E_TEST_USER_EMAIL,
      e2eTestAccount: true,
      companyId: userRecord.uid,                  // solo-op convention
      plan: 'free',                                // lowest tier; tests should run on the cheapest path
      provisionedBy: uid,
      provisionedAt: admin.firestore.FieldValue.serverTimestamp(),
      provisionAction: action
    }, { merge: true });

    logger.info('provisionE2ETestUser: ' + action, {
      provisionerUid: uid, testUid: userRecord.uid, email: E2E_TEST_USER_EMAIL
    });

    return {
      email: E2E_TEST_USER_EMAIL,
      password,
      uid: userRecord.uid,
      action
    };
  }
);

// ═════════════════════════════════════════════════════════════
// onRepSignup — Blocking auth trigger (beforeUserCreated)
//
// Fires when ANY user creates an account. Checks if their email
// is in any company's members subcollection. If found:
//   1. Sets custom claims: { companyId, role, plan }
//   2. Updates the member doc status from 'invited' → 'active'
//   3. Creates a Firestore user profile with company scoping
//
// If the email isn't in any company's members list, this is a
// solo operator signup — they get no company claims (default).
//
// This is a BLOCKING trigger — it runs before the user's
// account is finalized, so the claims are available immediately
// on their first login (no token refresh delay).
// ═════════════════════════════════════════════════════════════
// Role taxonomy — platform-wide allowlist. The `admin` role is PLATFORM
// admin and is reserved for support/ops — it grants cross-tenant reads via
// Firestore rules. Tenant-scoped admins use `company_admin`, which is
// bounded to their own `companyId` claim. Nothing below platform admin
// should ever be settable through the invite flow.
const INVITE_ALLOWED_ROLES = new Set(['company_admin', 'manager', 'sales_rep', 'viewer']);

exports.onRepSignup = beforeUserCreated(
  { region: 'us-central1' },
  async (event) => {
    const user = event.data;
    const email = (user.email || '').toLowerCase().trim();
    if (!email) return; // No email = nothing to match

    const db = admin.firestore();

    let companyId, role;
    try {
      // Search all companies' member lists for this email
      // This is a collectionGroup query on 'members' subcollections.
      const memberSnap = await db.collectionGroup('members')
        .where('email', '==', email)
        .where('status', '==', 'invited')
        .limit(1)
        .get();

      if (memberSnap.empty) {
        // Not an invited rep — solo operator signup. No claims to set.
        logger.info('onRepSignup: no matching invite');
        return;
      }

      const memberDoc = memberSnap.docs[0];
      const memberData = memberDoc.data();
      // The parent path is companies/{companyId}/members/{email}
      companyId = memberDoc.ref.parent.parent.id;

      // CRITICAL: hard allowlist. A malicious/compromised company owner
      // could have written `role: 'admin'` into the invite doc in an
      // attempt to mint platform-admin claims. Reject anything outside
      // the invite allowlist and fall back to the lowest-privilege role.
      const requested = typeof memberData.role === 'string' ? memberData.role : '';
      if (!INVITE_ALLOWED_ROLES.has(requested)) {
        logger.warn('onRepSignup: invite role outside allowlist', { companyId, requested });
        role = 'sales_rep';
      } else {
        role = requested;
      }

      logger.info('onRepSignup: matched invite', { companyId, role });
    } catch (e) {
      // Fail CLOSED. Previously we returned no claims and let signup
      // succeed "so claims can be set later" — but that created a
      // window where the user could read any doc missing a companyId
      // field, since myCompanyId() was null. Block signup on error.
      logger.error('onRepSignup error — blocking signup', { err: e.message });
      throw new HttpsError('internal', 'Signup temporarily unavailable. Try again shortly.');
    }

    return {
      customClaims: {
        companyId: companyId,
        role: role,
        plan: 'growth' // invited reps inherit the company's plan
      }
    };
  }
);

// ═════════════════════════════════════════════════════════════
// Q3: beforeAdminSignIn — TEMPORARILY DISABLED.
//
// The trigger code below is functionally correct; the problem is
// deploy-time registration. This project has only ever used
// beforeUserCreated as a blocking trigger. Adding a brand-new
// trigger TYPE (beforeUserSignedIn) requires a one-time Identity
// Platform config update, which the GitHub Actions deploy SA
// lacks the role for. Result: batch function-update rolls back
// and 32 unrelated functions can't redeploy.
//
// Re-enablement runbook (must land before uncommenting `exports.`
// below):
//   1. Firebase Console → Authentication → Settings → Blocking
//      functions → confirm "Enabled" for the `beforeUserSignedIn`
//      event. If disabled, enable it (sends you to Identity
//      Platform upgrade if the project hasn't been upgraded yet).
//   2. Grant the GitHub Actions deploy SA
//      `roles/identityplatform.admin` on the project (or the
//      narrower blocking-function-config role once GCP ships it).
//   3. Uncomment the `exports.beforeAdminSignIn = ...` line below.
//   4. Deploy. On first deploy the CLI may still emit a one-time
//      "blocking function configured" notice — expected.
//
// Until then: the feature-flag + mfa-enroll.html + login.js
// guidance still ship. Admins can self-enroll, and the runtime
// enforcement at the blocking-trigger layer is the only piece
// that's deferred.
//
// Threat model context (same as the active version would apply):
// admin email is findable via OSINT; password is guessable via
// credential stuffing; SMS MFA is bypassable via SIM-swap. TOTP
// (enrolment UI already shipped at /admin/mfa-enroll.html) closes
// all three.
//
// Trigger body preserved below as a plain function so the
// re-enablement step is a one-line change. NOT exported.
// ═════════════════════════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
const _beforeAdminSignInHandler = beforeUserSignedIn(
  { region: 'us-central1' },
  async (event) => {
    const user = event.data;
    if (!user || !user.uid) return;

    // Fast-path: only enforce on accounts with the platform-admin
    // claim. Custom claims ride on the ID token the trigger receives.
    // Firebase Auth sets `user.customClaims` OR `user.tokenClaims`
    // depending on blocking-trigger flavor — probe both.
    const claims = (user.customClaims || user.tokenClaims || {});
    if (claims.role !== 'admin') return;

    // Check the runtime flag. If Firestore is unreachable or the
    // flag doc is missing, fail SAFE (allow) — we don't want a
    // Firestore outage to lock Joe out of his own admin panel.
    let mfaRequired = false;
    try {
      const flagSnap = await admin.firestore().doc('feature_flags/_default').get();
      mfaRequired = !!(flagSnap.exists && flagSnap.data()?.admin_mfa_required === true);
    } catch (e) {
      logger.warn('beforeAdminSignIn: feature-flag read failed — allowing', { err: e.message });
      return;
    }
    if (!mfaRequired) return;

    // `multiFactor.enrolledFactors` is an array of MFA info objects.
    // Empty array or missing field = no enrolled factor.
    const factors = (user.multiFactor && user.multiFactor.enrolledFactors) || [];
    if (factors.length > 0) {
      logger.info('beforeAdminSignIn: admin signed in with MFA', {
        uid: user.uid,
        factorCount: factors.length,
        factorTypes: factors.map(f => f && f.factorId).filter(Boolean)
      });
      return;
    }

    // Hard block. The error code + message surface to the client
    // via Firebase Auth's signIn error; the admin-login UI reads
    // this and routes the user to the enrolment flow.
    logger.warn('beforeAdminSignIn: admin blocked — no MFA factor enrolled', { uid: user.uid });
    throw new HttpsError(
      'permission-denied',
      'Admin access requires a second factor. Enroll a TOTP authenticator (e.g., 1Password, Authy) or a hardware key before signing in again.'
    );
  }
);

// ═════════════════════════════════════════════════════════════
// activateInvitedRep — Callable function that reps call after
// their first login to mark their invite as active + create
// their user profile. The beforeUserCreated trigger sets claims
// but can't write to Firestore (blocking triggers are limited).
// This function does the Firestore writes.
// ═════════════════════════════════════════════════════════════
exports.activateInvitedRep = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');

    const companyId = request.auth.token.companyId;
    const role = request.auth.token.role;
    const email = request.auth.token.email || '';

    if (!companyId) {
      // Not an invited rep — nothing to activate
      return { activated: false, reason: 'no_company_claim' };
    }

    const db = admin.firestore();

    try {
      // Update the member doc: invited → active
      const memberRef = db.doc(`companies/${companyId}/members/${email.toLowerCase()}`);
      const memberSnap = await memberRef.get();
      if (memberSnap.exists) {
        await memberRef.update({
          status: 'active',
          uid: uid,
          activatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      // Create user profile with company scoping
      await db.doc(`users/${uid}`).set({
        email: email,
        role: role,
        companyId: companyId,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        displayName: request.auth.token.name || email.split('@')[0]
      }, { merge: true });

      logger.info('activateInvitedRep: success');
      return { activated: true, companyId, role };

    } catch (e) {
      logger.error('activateInvitedRep error', { uid, err: e.message });
      throw new HttpsError('internal', 'Activation failed');
    }
  }
);

// ═════════════════════════════════════════════════════════════
// submitPublicLead — C-3 gated write path for the four public forms
// (guide, contact, estimate, storm_alert). Replaces the previous
// unauthenticated direct-Firestore-create, which had no rate limit
// and could be mass-fired at Firestore's list price for ~$2/M writes.
//
// Defenses:
//   - enforceAppCheck: rejects calls without a valid App Check token
//     (curl/bot without the attestation token fails immediately).
//   - httpRateLimit: per-IP 20/min — plenty for a human on a form,
//     enough to stop a single-box 1000 rps attack cold.
//   - Origin allowlist via CORS_ORIGINS matches only the two public
//     domains. Browsers refuse to send the request otherwise.
//   - Honeypot field 'website': bots fill every field; real forms
//     leave it empty. Non-empty → silent 200 with no Firestore write.
//   - Per-shape validation + hard size caps.
//   - Generic 200 response with opaque id so enumerating invalid
//     payloads gives no side-channel.
// ═════════════════════════════════════════════════════════════
// M-04: explicit per-kind allowlist for optional fields. The previous
// pass-through loop accepted ANY string field ≤500 chars from the
// request body and wrote it into Firestore under that key, which
// let an attacker stuff arbitrary keys (e.g. `leadScore`, `qualified`,
// `assignedTo`) into a guide_leads doc. Default posture is strict —
// only marketing-attribution UTMs + HTTP referrer pass through; add
// to the allowlist deliberately when a real need appears.
const PUBLIC_LEAD_OPTIONAL_DEFAULTS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'referrer'
];

const PUBLIC_LEAD_KINDS = {
  guide: {
    collection: 'guide_leads',
    required: ['name', 'email', 'source'],
    maxLen:   { name: 200, email: 200, source: 200 },
    optional: [...PUBLIC_LEAD_OPTIONAL_DEFAULTS]
  },
  contact: {
    collection: 'contact_leads',
    required: ['firstName', 'phone', 'source'],
    maxLen:   { firstName: 200, phone: 30, source: 200 },
    optional: [...PUBLIC_LEAD_OPTIONAL_DEFAULTS]
  },
  estimate: {
    collection: 'estimate_leads',
    required: ['address', 'source'],
    maxLen:   { address: 500, source: 200 },
    optional: [...PUBLIC_LEAD_OPTIONAL_DEFAULTS]
  },
  storm: {
    collection: 'storm_alert_subscribers',
    required: ['name', 'phone', 'zip', 'source'],
    maxLen:   { name: 200, phone: 30, zip: 10, source: 200 },
    exact:    { zip: 5 },
    optional: [...PUBLIC_LEAD_OPTIONAL_DEFAULTS]
  },
  // "One Free Roof a Year" giveaway entries. Nominator can be the
  // homeowner themselves or a neighbor / family member. Story is the
  // free-text pitch for why this homeowner should win.
  free_roof: {
    collection: 'free_roof_entries',
    required: ['nomineeName', 'phone', 'address', 'story', 'source'],
    maxLen:   {
      nomineeName: 200, phone: 30, email: 200, address: 500,
      story: 1500, source: 200, nominatorName: 200, nominatorRelation: 100,
      category: 50
    },
    optional: [...PUBLIC_LEAD_OPTIONAL_DEFAULTS, 'email', 'nominatorName', 'nominatorRelation', 'category']
  }
};

const { verifyTurnstile } = require('./integrations/turnstile');
const { SECRETS: INT_SECRETS } = require('./integrations/_shared');

exports.submitPublicLead = onRequest(
  {
    cors: CORS_ORIGINS,        // same origin allowlist used by claudeProxy
    enforceAppCheck: true,     // required; App Check sits in front
    secrets: [INT_SECRETS.TURNSTILE_SECRET],
    maxInstances: 20,
    concurrency: 80,
    timeoutSeconds: 15,
    memory: '256MiB'
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

    // Per-IP rate limit — the single most important gate. 20/min/IP.
    // A human filling a form takes >10s; a spam script fires faster.
    if (!(await httpRateLimit(req, res, 'publicLead:ip', 20, 60_000))) return;

    // Turnstile verification (if configured). Fail closed on verifier
    // error. No-op passthrough when TURNSTILE_SECRET is unset so dev
    // environments still work.
    const turnstile = await verifyTurnstile(
      (req.body && req.body.turnstileToken) || '',
      clientIp(req)
    );
    if (!turnstile.ok) {
      res.status(403).json({ error: 'Verification failed', reason: turnstile.reason });
      return;
    }

    const body = req.body || {};
    const kind = typeof body.kind === 'string' ? body.kind : '';
    const spec = PUBLIC_LEAD_KINDS[kind];
    if (!spec) {
      // Opaque error: same shape as success so an attacker can't
      // enumerate valid kinds without also fetching a real response.
      res.status(400).json({ error: 'Invalid submission' });
      return;
    }

    // Honeypot — real humans never fill this. Pretend success.
    if (typeof body.website === 'string' && body.website.length > 0) {
      logger.info('submitPublicLead: honeypot tripped', { kind, ip: clientIp(req) });
      res.status(200).json({ success: true });
      return;
    }

    // Per-shape validation.
    const data = {};
    for (const key of spec.required) {
      const val = body[key];
      if (typeof val !== 'string') { res.status(400).json({ error: 'Invalid submission' }); return; }
      const max = spec.maxLen[key] || 200;
      if (val.length === 0 || val.length > max) { res.status(400).json({ error: 'Invalid submission' }); return; }
      if (spec.exact && spec.exact[key] != null && val.length !== spec.exact[key]) {
        res.status(400).json({ error: 'Invalid submission' }); return;
      }
      data[key] = val;
    }

    // M-04: optional fields are a per-kind allowlist (UTMs + referrer
    // today). Keys outside the allowlist are silently dropped — we
    // do NOT 400 on extras because benign callers paste the whole
    // query string from a landing page.
    for (const key of (spec.optional || [])) {
      const v = body[key];
      if (typeof v !== 'string') continue;
      if (v.length === 0 || v.length > 500) continue;
      data[key] = v;
    }

    // Trust-but-tag: server-only fields the client can't spoof.
    data.ip = clientIp(req);
    data.userAgent = String(req.headers['user-agent'] || '').slice(0, 200);
    data.createdAt = admin.firestore.FieldValue.serverTimestamp();

    try {
      const ref = await admin.firestore().collection(spec.collection).add(data);
      logger.info('submitPublicLead', { kind, id: ref.id });
      res.status(200).json({ success: true, id: ref.id });
    } catch (e) {
      logger.error('submitPublicLead error', { kind, err: e.message });
      res.status(500).json({ error: 'Submission failed' });
    }
  }
);

// ═════════════════════════════════════════════════════════════
// rotateAccessCodes — platform-admin-only kill switch for legacy
// hardcoded access codes (C-2).
//
// Until this runs, NBD-2026 and the other pre-rotation codes are
// still live in Firestore because the old seed script wrote them.
// Calling this deactivates them server-side. After this, the seed
// script is the only way to mint new codes — and it prints them
// to stdout only.
//
// Platform admin only. Intentionally very loud in logs — every
// call creates an audit_log entry.
// ═════════════════════════════════════════════════════════════
const LEGACY_ACCESS_CODES = [
  'NBD-2026', 'NBD-DEMO', 'DEMO', 'TRYIT',
  'DEAL-2026', 'ROOFCON26', 'NBD-STORM'
];

exports.rotateAccessCodes = onCall(
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
    if (request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Platform admin required');
    }

    const db = admin.firestore();
    const deactivated = [];
    for (const codeId of LEGACY_ACCESS_CODES) {
      const ref = db.doc(`access_codes/${codeId}`);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const cur = snap.data();
      if (cur.active === false) continue;
      await ref.update({
        active: false,
        rotatedAt: admin.firestore.FieldValue.serverTimestamp(),
        rotatedBy: uid,
        rotatedReason: 'legacy hardcoded code auto-disabled'
      });
      deactivated.push(codeId);
    }
    logger.warn('rotateAccessCodes: legacy codes disabled', { by: uid, deactivated });
    // Write an audit_log entry explicitly — this predates the audit
    // triggers, so we record it here too.
    await db.collection('audit_log').add({
      type: 'rotate_access_codes',
      actorUid: uid,
      deactivated,
      ts: admin.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, deactivated };
  }
);

// ═════════════════════════════════════════════════════════════
// ADMIN ACCOUNT MANAGER — Team lifecycle Cloud Functions
//
// These callables back the "Team" admin view. Only a global admin
// OR the company owner can invoke them. All writes go through the
// Admin SDK so they bypass Firestore rules — meaning the auth check
// below is the ONLY thing standing between the caller and the data.
// Treat every guard as load-bearing.
//
// Roles: admin | manager | sales_rep | viewer
// ═════════════════════════════════════════════════════════════

// Tenant-scoped roles. `admin` (platform-global) is deliberately NOT in
// this list — granting it requires manual admin SDK script, never a UI
// path. Tenant admins use `company_admin`, which owns the company but
// cannot read other tenants' data.
const TEAM_ROLES = ['company_admin', 'manager', 'sales_rep', 'viewer'];

// Resolve the caller's company and confirm they can manage it.
// Returns { uid, companyId, isOwner, isGlobalAdmin } or throws HttpsError.
async function requireTeamAdmin(request, targetCompanyId = null) {
  const uid = request.auth && request.auth.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

  const claims = request.auth.token || {};
  const isGlobalAdmin = claims.role === 'admin';
  // Solo operators own a company keyed by their uid. Team members carry a
  // companyId claim set by onRepSignup. Fall back to uid for solo owners.
  const callerCompanyId = claims.companyId || uid;
  const companyId = targetCompanyId || callerCompanyId;

  // Cross-company ops are admin-only.
  if (!isGlobalAdmin && companyId !== callerCompanyId) {
    throw new HttpsError('permission-denied', 'Cannot manage another company');
  }

  // Verify ownership against the company doc if one exists.
  const db = admin.firestore();
  const companyRef = db.doc(`companies/${companyId}`);
  const companySnap = await companyRef.get();
  const ownerId = companySnap.exists ? (companySnap.data().ownerId || null) : null;
  const isOwner = ownerId === uid || (!companySnap.exists && companyId === uid);

  if (!isGlobalAdmin && !isOwner) {
    // Managers can list their team but not mutate — the caller gates mutations.
    throw new HttpsError('permission-denied', 'Owner or admin access required');
  }

  return { uid, companyId, isOwner, isGlobalAdmin, companyRef };
}

// Platform admin role is NEVER grantable through this function — not
// even by another platform admin. It is a manual admin-SDK script
// operation so it leaves a clear paper trail and cannot be triggered
// through a compromised browser session. The UI picker only offers
// the four tenant-scoped roles.
function normalizeRole(role) {
  if (typeof role !== 'string') return null;
  const r = role.trim().toLowerCase();
  if (r === 'admin') return null;  // platform admin — blocked here
  if (!TEAM_ROLES.includes(r)) return null;
  return r;
}

function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  if (!e.includes('@') || e.length < 5 || e.length > 200) return null;
  return e;
}

// ── createTeamMember ─────────────────────────────────────────
// Creates (or adopts) a Firebase Auth user, stamps role + companyId
// claims, and records the member in companies/{companyId}/members.
// The target's default status is 'active' if we created them fresh,
// 'invited' if they don't have a password set yet.
exports.createTeamMember = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const { uid: callerUid, companyId, companyRef } = await requireTeamAdmin(request);
    await callableRateLimit(request, 'createTeamMember', 20, 60_000);

    const email = normalizeEmail(request.data && request.data.email);
    if (!email) throw new HttpsError('invalid-argument', 'Valid email required');

    // Global admin can grant admin; company owners cannot.
    const role = normalizeRole(request.data && request.data.role);
    if (!role) throw new HttpsError('invalid-argument', 'Invalid role');

    const displayName = typeof request.data?.displayName === 'string'
      ? request.data.displayName.trim().slice(0, 120)
      : '';

    const db = admin.firestore();

    // Make sure the company doc exists so security rules for members work.
    const companySnap = await companyRef.get();
    if (!companySnap.exists) {
      await companyRef.set({
        ownerId: callerUid,
        name: (request.auth.token.name || 'My Company'),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    let userRecord;
    let created = false;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        userRecord = await admin.auth().createUser({
          email,
          emailVerified: false,
          displayName: displayName || email.split('@')[0],
          disabled: false
        });
        created = true;
      } else {
        throw e;
      }
    }

    // Block cross-company poaching: if the target already has a different
    // companyId claim, require global admin to reassign.
    const existingClaims = userRecord.customClaims || {};
    if (existingClaims.companyId && existingClaims.companyId !== companyId && request.auth.token.role !== 'admin') {
      throw new HttpsError('already-exists', 'User is already a member of another company');
    }

    // Merge claims — preserve plan/subscriptionStatus if present.
    const newClaims = {
      ...existingClaims,
      companyId,
      role
    };
    await admin.auth().setCustomUserClaims(userRecord.uid, newClaims);

    const memberRef = db.doc(`companies/${companyId}/members/${email}`);
    await memberRef.set({
      email,
      role,
      displayName: displayName || userRecord.displayName || email.split('@')[0],
      uid: userRecord.uid,
      status: created ? 'invited' : 'active',
      invitedAt: admin.firestore.FieldValue.serverTimestamp(),
      invitedBy: callerUid,
      active: true
    }, { merge: true });

    // Seed user profile doc so the user list query has a name to show.
    await db.doc(`users/${userRecord.uid}`).set({
      email,
      displayName: displayName || userRecord.displayName || email.split('@')[0],
      companyId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // M-5: hash email before logging so Cloud Logging retention can't
    // leak PII. Log the first 16 hex chars — enough for correlation
    // between admins and audit_log entries, not enough for reversal.
    const emailHash = require('crypto').createHash('sha256').update(email).digest('hex').slice(0, 16);
    logger.info('createTeamMember', { companyId, emailHash, role, created });
    return {
      success: true,
      uid: userRecord.uid,
      email,
      role,
      status: created ? 'invited' : 'active',
      created
    };
  }
);

// ── updateUserRole ───────────────────────────────────────────
// Change an existing team member's role. Rewrites custom claims
// and the member doc. Won't let a non-admin promote to admin or
// demote the company owner.
exports.updateUserRole = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const { uid: callerUid, companyId, companyRef } = await requireTeamAdmin(request);
    await callableRateLimit(request, 'updateUserRole', 30, 60_000);

    const targetUid = typeof request.data?.uid === 'string' ? request.data.uid : null;
    const targetEmail = normalizeEmail(request.data && request.data.email);
    if (!targetUid && !targetEmail) {
      throw new HttpsError('invalid-argument', 'Target uid or email required');
    }

    const role = normalizeRole(request.data && request.data.role);
    if (!role) throw new HttpsError('invalid-argument', 'Invalid role');

    const isGlobalAdmin = request.auth.token.role === 'admin';

    // Resolve the target user.
    let userRecord;
    try {
      userRecord = targetUid
        ? await admin.auth().getUser(targetUid)
        : await admin.auth().getUserByEmail(targetEmail);
    } catch (e) {
      throw new HttpsError('not-found', 'User not found');
    }

    const existingClaims = userRecord.customClaims || {};
    // Block changing a user from a different company unless platform admin.
    if (existingClaims.companyId && existingClaims.companyId !== companyId && !isGlobalAdmin) {
      throw new HttpsError('permission-denied', 'User belongs to another company');
    }

    // Prevent demoting the company owner through this path. The owner
    // must keep at least company_admin privileges; downgrade requires
    // transferring ownership first.
    const companySnap = await companyRef.get();
    const ownerId = companySnap.exists ? companySnap.data().ownerId : null;
    if (ownerId && userRecord.uid === ownerId && role !== 'company_admin' && !isGlobalAdmin) {
      throw new HttpsError('failed-precondition', 'Cannot demote the company owner');
    }

    await admin.auth().setCustomUserClaims(userRecord.uid, {
      ...existingClaims,
      companyId,
      role
    });

    const emailKey = (userRecord.email || targetEmail || '').toLowerCase();
    if (emailKey) {
      await admin.firestore().doc(`companies/${companyId}/members/${emailKey}`).set({
        role,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: callerUid
      }, { merge: true });
    }

    logger.info('updateUserRole', { companyId, targetUid: userRecord.uid, role });
    return { success: true, uid: userRecord.uid, role };
  }
);

// ── deactivateUser ───────────────────────────────────────────
// Disable the Firebase Auth account and mark the member doc
// deactivated. Data is preserved; toggle `reactivate: true` to
// re-enable. Won't let anyone deactivate the company owner.
exports.deactivateUser = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const { uid: callerUid, companyId, companyRef } = await requireTeamAdmin(request);
    await callableRateLimit(request, 'deactivateUser', 20, 60_000);

    const targetUid = typeof request.data?.uid === 'string' ? request.data.uid : null;
    const targetEmail = normalizeEmail(request.data && request.data.email);
    if (!targetUid && !targetEmail) {
      throw new HttpsError('invalid-argument', 'Target uid or email required');
    }
    const reactivate = request.data?.reactivate === true;

    let userRecord;
    try {
      userRecord = targetUid
        ? await admin.auth().getUser(targetUid)
        : await admin.auth().getUserByEmail(targetEmail);
    } catch (e) {
      throw new HttpsError('not-found', 'User not found');
    }

    const existingClaims = userRecord.customClaims || {};
    const isGlobalAdmin = request.auth.token.role === 'admin';
    if (existingClaims.companyId && existingClaims.companyId !== companyId && !isGlobalAdmin) {
      throw new HttpsError('permission-denied', 'User belongs to another company');
    }

    // Safety: never kill the owner's login from this path.
    const companySnap = await companyRef.get();
    const ownerId = companySnap.exists ? companySnap.data().ownerId : null;
    if (ownerId && userRecord.uid === ownerId) {
      throw new HttpsError('failed-precondition', 'Cannot deactivate the company owner');
    }
    // Don't let the caller lock themselves out.
    if (userRecord.uid === callerUid) {
      throw new HttpsError('failed-precondition', 'Cannot deactivate your own account');
    }

    await admin.auth().updateUser(userRecord.uid, { disabled: !reactivate });
    // Revoke tokens when deactivating so existing sessions die.
    if (!reactivate) {
      await admin.auth().revokeRefreshTokens(userRecord.uid);
    }

    const emailKey = (userRecord.email || targetEmail || '').toLowerCase();
    if (emailKey) {
      await admin.firestore().doc(`companies/${companyId}/members/${emailKey}`).set({
        status: reactivate ? 'active' : 'deactivated',
        active: !!reactivate,
        deactivatedAt: reactivate ? null : admin.firestore.FieldValue.serverTimestamp(),
        deactivatedBy: reactivate ? null : callerUid
      }, { merge: true });
    }

    logger.info(reactivate ? 'reactivateUser' : 'deactivateUser', {
      companyId, targetUid: userRecord.uid
    });
    return { success: true, uid: userRecord.uid, disabled: !reactivate };
  }
);

// ── listTeamMembers ──────────────────────────────────────────
// Returns the team roster enriched with Auth data (lastSignInTime,
// disabled) and a lead count per member. The member doc by itself
// has email/role/status; the extras come from Auth + a cheap
// collectionGroup count on leads.
exports.listTeamMembers = onCall(
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

    const claims = request.auth.token || {};
    const isGlobalAdmin = claims.role === 'admin';
    const isManager = claims.role === 'manager';
    const callerCompanyId = claims.companyId || uid;
    const companyId = (request.data && request.data.companyId) || callerCompanyId;

    // Managers and owners can list their own team. Admins can list any.
    if (!isGlobalAdmin && companyId !== callerCompanyId) {
      throw new HttpsError('permission-denied', 'Cannot view another company');
    }

    const db = admin.firestore();
    const companySnap = await db.doc(`companies/${companyId}`).get();
    // Solo-operator fallback: if the company doc hasn't been created
    // yet AND the caller is acting on their own workspace
    // (companyId === uid), treat them as the owner. Otherwise a solo
    // operator who clicks "Team" before ever creating a company doc
    // gets permission-denied and an empty roster they can't escape.
    const isSelfWorkspace = companyId === uid;
    const ownerId = companySnap.exists
      ? companySnap.data().ownerId
      : (isSelfWorkspace ? uid : null);
    if (!isGlobalAdmin && !isManager && ownerId !== uid) {
      throw new HttpsError('permission-denied', 'Owner, manager, or admin required');
    }

    const membersSnap = await db.collection(`companies/${companyId}/members`).get();
    const members = [];

    // Always include the owner card first.
    if (ownerId) {
      try {
        const ownerRecord = await admin.auth().getUser(ownerId);
        members.push({
          uid: ownerId,
          email: (ownerRecord.email || '').toLowerCase(),
          displayName: ownerRecord.displayName || 'Owner',
          role: 'company_admin',
          status: ownerRecord.disabled ? 'deactivated' : 'active',
          isOwner: true,
          disabled: !!ownerRecord.disabled,
          lastSignInTime: ownerRecord.metadata?.lastSignInTime || null,
          creationTime: ownerRecord.metadata?.creationTime || null,
          leadCount: 0
        });
      } catch (e) {
        logger.warn('listTeamMembers: owner lookup failed', { ownerId, err: e.message });
      }
    }

    for (const doc of membersSnap.docs) {
      const m = doc.data() || {};
      if (!m.email) continue;
      if (m.uid && m.uid === ownerId) continue; // owner already listed

      let authMeta = null;
      try {
        const u = m.uid
          ? await admin.auth().getUser(m.uid)
          : await admin.auth().getUserByEmail(m.email);
        authMeta = {
          uid: u.uid,
          disabled: !!u.disabled,
          lastSignInTime: u.metadata?.lastSignInTime || null,
          creationTime: u.metadata?.creationTime || null
        };
      } catch (e) { /* invited but not signed up yet */ }

      // Lead count — skip if member never activated (no uid to match).
      let leadCount = 0;
      if (authMeta?.uid) {
        try {
          const leadsSnap = await db.collection('leads')
            .where('userId', '==', authMeta.uid)
            .count()
            .get();
          leadCount = leadsSnap.data().count || 0;
        } catch (e) { /* counts may fail on missing index; leave 0 */ }
      }

      members.push({
        uid: authMeta?.uid || m.uid || null,
        email: m.email,
        displayName: m.displayName || m.email.split('@')[0],
        role: m.role || 'sales_rep',
        status: authMeta?.disabled
          ? 'deactivated'
          : (m.status || (authMeta ? 'active' : 'invited')),
        isOwner: false,
        disabled: !!authMeta?.disabled,
        lastSignInTime: authMeta?.lastSignInTime || null,
        creationTime: authMeta?.creationTime || m.invitedAt?.toDate?.()?.toISOString() || null,
        leadCount
      });
    }

    return { success: true, companyId, members, count: members.length };
  }
);

// ═════════════════════════════════════════════════════════════
// F-09: CSP violation report receiver.
//
// The Report-Only CSP in firebase.json is currently a no-op because
// violations have nowhere to go. This endpoint accepts both the
// classic `application/csp-report` body shape (report-uri) and the
// newer `application/reports+json` array shape (Reporting API /
// report-to) and logs a bounded subset of fields.
//
// We accept unauthenticated POSTs — the browser fires these without
// credentials. Per-IP rate limit and hard size cap protect against
// log-flooding. Firestore is intentionally NOT written; logs are
// enough and cheaper.
// ═════════════════════════════════════════════════════════════
exports.cspReport = onRequest(
  {
    region: 'us-central1',
    cors: false,
    maxInstances: 5,
    concurrency: 80,
    timeoutSeconds: 5,
    memory: '128MiB'
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    try {
      // Hard size cap — bounded-budget log ingestion.
      const raw = req.rawBody;
      if (raw && Buffer.isBuffer(raw) && raw.length > 8192) {
        res.status(413).end(); return;
      }
      // Per-IP rate limit — 60/min/IP. Normal reporting is well below
      // this; a page stuck in a CSP loop could exceed. Soft fail OK.
      try {
        await httpRateLimit(req, res, 'cspReport:ip', 60, 60_000);
      } catch (_) { /* ignore rate-limit errors; log pipeline */ }

      const body = req.body || {};
      // `report-uri` shape: { "csp-report": { ... } }
      // `report-to` shape: [ { type: 'csp-violation', body: { ... } } ]
      const reports = Array.isArray(body)
        ? body.map(r => r && r.body).filter(Boolean)
        : body['csp-report']
          ? [body['csp-report']]
          : [body];
      for (const r of reports) {
        logger.warn('csp_violation', {
          documentURI:        String(r['document-uri']       || r.documentURL || '').slice(0, 400),
          blockedURI:         String(r['blocked-uri']        || r.blockedURL  || '').slice(0, 400),
          violatedDirective:  String(r['violated-directive'] || r.effectiveDirective || '').slice(0, 200),
          originalPolicy:     String(r['original-policy']    || r.originalPolicy     || '').slice(0, 500),
          disposition:        String(r.disposition || '').slice(0, 20),
          sourceFile:         String(r['source-file']        || r.sourceFile || '').slice(0, 400),
          lineNumber:         Number(r['line-number']        || r.lineNumber || 0) || null,
          statusCode:         Number(r['status-code']        || r.statusCode || 0) || null,
          userAgent:          String(req.headers['user-agent'] || '').slice(0, 200)
        });
      }
      res.status(204).end();
    } catch (e) {
      logger.warn('cspReport error', { err: e.message });
      res.status(204).end();  // Never signal failure to the browser — it'll retry.
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// ABANDONED FUNNEL RECOVERY — /estimate partial-state + hourly sender
// ═══════════════════════════════════════════════════════════════
//
// Re-exports from functions/funnel-recovery.js:
//   - saveFunnelProgress (onRequest) — client saves partial state
//   - runAbandonRecovery (onSchedule) — hourly recovery email sender
//
// Ships DRY-RUN by default. Set FUNNEL_RECOVERY_ENABLED=true on the
// runAbandonRecovery Cloud Run revision to go live.
const funnelRecovery = require('./funnel-recovery');
exports.saveFunnelProgress = funnelRecovery.saveFunnelProgress;
exports.runAbandonRecovery = funnelRecovery.runAbandonRecovery;

// ═══════════════════════════════════════════════════════════════
// VISUALIZER IMAGE GENERATION — Gemini 2.5 Flash Image
// ═══════════════════════════════════════════════════════════════
//
// Real AI-edited image of the user's home (replaces the old canvas
// color-filter fake "visualization"). ~$0.02-$0.04 per call.
//
// Ships DISABLED by default. Set VISUALIZER_IMAGEGEN_ENABLED=true on
// the visualizerImageGen Cloud Run revision to go live (requires the
// GOOGLE_AI_API_KEY secret populated first).
const visualizerImageGen = require('./visualizer-image-gen');
exports.visualizerImageGen = visualizerImageGen.visualizerImageGen;

// ═══════════════════════════════════════════════════════════════
// GOOGLE REVIEWS — Places API proxy with 6-hour Firestore cache
// ═══════════════════════════════════════════════════════════════
//
// Public onRequest endpoint. Keeps the Places API key server-side,
// serves cached review data to /review and any embedded widgets.
// See functions/google-reviews.README.md for setup.
const googleReviews = require('./google-reviews');
exports.getGoogleReviews = googleReviews.getGoogleReviews;