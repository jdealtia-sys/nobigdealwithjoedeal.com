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
  EAGLEVIEW_API_KEY:     defineSecret('EAGLEVIEW_API_KEY'),
  NEARMAP_API_KEY:       defineSecret('NEARMAP_API_KEY'),
  BOLDSIGN_API_KEY:      defineSecret('BOLDSIGN_API_KEY'),
  BOLDSIGN_WEBHOOK_SECRET: defineSecret('BOLDSIGN_WEBHOOK_SECRET'),
  REGRID_API_TOKEN:      defineSecret('REGRID_API_TOKEN'),
  HAILTRACE_API_KEY:     defineSecret('HAILTRACE_API_KEY'),
  CALCOM_WEBHOOK_SECRET: defineSecret('CALCOM_WEBHOOK_SECRET')
};

// Provider preference for swappable categories. Set via env (not
// secret) so it's visible in logs and easy to rotate mid-flight.
// Defaults chosen for biggest-bang-for-buck in roofing CRM context.
const PROVIDERS = {
  measurement: (process.env.NBD_MEASUREMENT_PROVIDER || 'hover').toLowerCase(),
  esign:       (process.env.NBD_ESIGN_PROVIDER       || 'boldsign').toLowerCase(),
  parcel:      (process.env.NBD_PARCEL_PROVIDER      || 'regrid').toLowerCase(),
  hail:        (process.env.NBD_HAIL_PROVIDER        || 'noaa').toLowerCase(),
  rateLimit:   (process.env.NBD_RATE_LIMIT_PROVIDER  || 'firestore').toLowerCase()
};

function hasSecret(name) {
  try {
    const v = SECRETS[name] && SECRETS[name].value();
    return typeof v === 'string' && v.length > 0;
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
