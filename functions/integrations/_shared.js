/**
 * functions/integrations/_shared.js
 *
 * Helpers every integration adapter uses: secret registry, config
 * check, and a shared `integrationStatus` endpoint that tells the
 * client which connectors are wired so the UI can grey-out buttons
 * for unconfigured providers.
 *
 * Design rule: every adapter checks for its own secret at call time
 * and returns a structured { configured: false, provider } response
 * when the key is missing. Nothing ever throws just because an
 * integration isn't set up — a non-configured provider behaves like
 * the feature doesn't exist.
 */

'use strict';

const { defineSecret } = require('firebase-functions/params');

// ── Secret registry ─────────────────────────────────────────
// Every integration secret lives here so we can iterate them for
// the status endpoint without duplicating the list. Adding a new
// integration? Register its secret here AND in the adapter file.
const SECRETS = {
  // Observability
  SENTRY_DSN_FUNCTIONS:  defineSecret('SENTRY_DSN_FUNCTIONS'),
  SLACK_WEBHOOK_URL:     defineSecret('SLACK_WEBHOOK_URL'),

  // Human verification
  TURNSTILE_SECRET:      defineSecret('TURNSTILE_SECRET'),

  // Rate limiting
  UPSTASH_REDIS_REST_URL:   defineSecret('UPSTASH_REDIS_REST_URL'),
  UPSTASH_REDIS_REST_TOKEN: defineSecret('UPSTASH_REDIS_REST_TOKEN'),

  // Business integrations
  HOVER_API_KEY:         defineSecret('HOVER_API_KEY'),
  HOVER_WEBHOOK_SECRET:  defineSecret('HOVER_WEBHOOK_SECRET'),
  EAGLEVIEW_API_KEY:     defineSecret('EAGLEVIEW_API_KEY'),
  EAGLEVIEW_WEBHOOK_SECRET: defineSecret('EAGLEVIEW_WEBHOOK_SECRET'),
  NEARMAP_API_KEY:       defineSecret('NEARMAP_API_KEY'),
  BOLDSIGN_API_KEY:      defineSecret('BOLDSIGN_API_KEY'),
  BOLDSIGN_WEBHOOK_SECRET: defineSecret('BOLDSIGN_WEBHOOK_SECRET'),
  REGRID_API_TOKEN:      defineSecret('REGRID_API_TOKEN'),
  HAILTRACE_API_KEY:     defineSecret('HAILTRACE_API_KEY'),
  CALCOM_WEBHOOK_SECRET: defineSecret('CALCOM_WEBHOOK_SECRET'),

  // Voice transcription (F8)
  DEEPGRAM_API_KEY:      defineSecret('DEEPGRAM_API_KEY'),

  // Voice Intelligence (Voice Intel — C1)
  // Phase 1 transcription = Groq Whisper-large-v3-turbo ($0.04/hr).
  // Phase 2 may add Deepgram for native diarization on Pro+ tiers.
  GROQ_API_KEY:          defineSecret('GROQ_API_KEY')
};

// Provider preference for swappable categories. Set via env (not
// secret) so it's visible in logs and easy to rotate mid-flight.
// Defaults chosen for biggest-bang-for-buck in roofing CRM context.
const PROVIDERS = {
  measurement:       (process.env.NBD_MEASUREMENT_PROVIDER  || 'hover').toLowerCase(),
  esign:             (process.env.NBD_ESIGN_PROVIDER        || 'boldsign').toLowerCase(),
  parcel:            (process.env.NBD_PARCEL_PROVIDER       || 'regrid').toLowerCase(),
  hail:              (process.env.NBD_HAIL_PROVIDER         || 'noaa').toLowerCase(),
  rateLimit:         (process.env.NBD_RATE_LIMIT_PROVIDER   || 'firestore').toLowerCase(),
  // Voice transcription for the Voice Intelligence pipeline.
  //   'groq'     → Groq Whisper-large-v3-turbo ($0.04/hr, no speakers)
  //   'deepgram' → Deepgram Nova-2 ($0.26/hr, native diarization)
  // Flip via env var — no code deploy needed when switching tiers.
  voiceTranscription:(process.env.NBD_VOICE_TRANSCRIPTION_PROVIDER || 'groq').toLowerCase()
};

// A secret is considered "configured" only if it has a non-empty
// value AFTER trimming whitespace AND isn't the placeholder we use
// to stub-create missing secrets during deploy (see the
// "Ensure integration secrets exist" step in firebase-deploy.yml).
// Firebase CLI requires each secret to have a "latest version" with
// at least 1 byte, so the stub value can't be empty — but it still
// needs to be recognizable as "not configured" at runtime.
const SECRET_STUB_VALUE = '__unset__';
function hasSecret(name) {
  try {
    const v = SECRETS[name] && SECRETS[name].value();
    if (typeof v !== 'string') return false;
    const trimmed = v.trim();
    return trimmed.length > 0 && trimmed !== SECRET_STUB_VALUE;
  } catch (e) { return false; }
}

function getSecret(name) {
  try { return SECRETS[name].value(); } catch (e) { return null; }
}

// Structured "integration not configured" response. Adapters return
// this instead of throwing so the caller can gracefully fall back
// (e.g., manual entry if HOVER isn't wired).
function notConfigured(provider, reason) {
  return { configured: false, provider, reason: reason || 'Missing API key' };
}

module.exports = {
  SECRETS,
  PROVIDERS,
  hasSecret,
  getSecret,
  notConfigured
};
