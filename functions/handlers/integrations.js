/**
 * functions/handlers/integrations.js — integration-facing endpoints.
 *
 * Step 4c extraction. Moved verbatim from functions/index.js:
 *   - integrationStatus (onCall, admin-visible secret + provider readout)
 *   - submitPublicLead  (onRequest, C-3 gated public form ingest)
 *
 * No behavioral changes; pure structural move. The integrationStatus
 * + submitPublicLead helpers still live in functions/integrations/*.js
 * (turnstile, _shared) and are imported here verbatim.
 */

'use strict';

const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');

const { httpRateLimit, clientIp } = require('../integrations/upstash-ratelimit');
const { CORS_ORIGINS } = require('./_shared');

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
} = require('../integrations/_shared');

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
    const { provider: rateLimitProvider } = require('../integrations/upstash-ratelimit');
    return {
      providers: _intProviders,
      configured: {
        sentry:             _hasInt('SENTRY_DSN_FUNCTIONS'),
        slack:              _hasInt('SLACK_WEBHOOK_URL'),
        turnstile:          _hasInt('TURNSTILE_SECRET'),
        upstash:            _hasInt('UPSTASH_REDIS_REST_URL') && _hasInt('UPSTASH_REDIS_REST_TOKEN'),
        hover:              _hasInt('HOVER_API_KEY'),
        // Webhook secrets are tracked separately so admin can see when
        // the inbound webhook auth is missing without conflating it
        // with the API-key state.
        hoverWebhook:       _hasInt('HOVER_WEBHOOK_SECRET'),
        eagleview:          _hasInt('EAGLEVIEW_API_KEY'),
        eagleviewWebhook:   _hasInt('EAGLEVIEW_WEBHOOK_SECRET'),
        nearmap:            _hasInt('NEARMAP_API_KEY'),
        boldsign:           _hasInt('BOLDSIGN_API_KEY'),
        boldsignWebhook:    _hasInt('BOLDSIGN_WEBHOOK_SECRET'),
        regrid:             _hasInt('REGRID_API_TOKEN'),
        hailtrace:          _hasInt('HAILTRACE_API_KEY'),
        calcom:             _hasInt('CALCOM_WEBHOOK_SECRET'),
        // Voice transcription pair — Phase 1 uses Groq, Phase 2 may
        // add Deepgram for native diarization on Pro+.
        deepgram:           _hasInt('DEEPGRAM_API_KEY'),
        groq:               _hasInt('GROQ_API_KEY')
      },
      rateLimitProvider: rateLimitProvider(),
      // D.3 — runbook reference so the admin readout points at the
      // rotation procedure instead of requiring the rep to dig through
      // the repo.
      rotationRunbook: 'https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/blob/main/documentation/runbooks/SECRET_ROTATION.md'
    };
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
  },
  // /inspect public form (printed QR pieces → free inspection request).
  // Photos themselves aren't uploaded through this gateway — the form
  // submits photo metadata (count + filenames) so Joe knows to ask the
  // homeowner for them at the call.
  inspect: {
    collection: 'inspect_leads',
    required: ['name', 'phone', 'address', 'source'],
    maxLen:   {
      name: 200, phone: 30, address: 500, email: 200,
      story: 1500, source: 200, photoNames: 2000
    },
    optional: [...PUBLIC_LEAD_OPTIONAL_DEFAULTS, 'email', 'story', 'photoCount', 'photoNames']
  }
};

const { verifyTurnstile } = require('../integrations/turnstile');
const { SECRETS: INT_SECRETS } = require('../integrations/_shared');

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
