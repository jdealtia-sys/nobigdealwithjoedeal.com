/**
 * integrations/voice-intelligence.js — Voice Intel pipeline (C1).
 *
 * Flow:
 *   Client uploads audio to audio/{uid}/{leadId}/{recordingId}.{ext}.
 *   onAudioUploaded Storage trigger fires → creates Firestore doc
 *   leads/{leadId}/recordings/{recordingId} → runs transcription →
 *   runs analysis → marks status:'complete'. Client listens via
 *   onSnapshot. No polling, no held connections.
 *
 * Secrets:
 *   GROQ_API_KEY           — required for transcription when
 *                            PROVIDERS.voiceTranscription === 'groq'
 *   ANTHROPIC_API_KEY      — required for analysis + optional
 *                            consent-check prompt (two_party_verbal)
 *
 * Fail-closed: missing secret → status:'failed' with a clear
 * statusError so the UI can surface it. Never throws into the
 * bucket trigger — Storage triggers that throw get retried
 * indefinitely by Firebase.
 *
 * Shipped in 4 commits: C1a helpers, C1b transcription, C1c
 * analysis + consent, C1d wire-up.
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onObjectFinalized } = require('firebase-functions/v2/storage');
const { logger } = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { getSecret, hasSecret, PROVIDERS, SECRETS } = require('./_shared');
const prompts = require('../voice-prompts');

// Claude analysis + consent check reuse the existing Anthropic key.
const ANTHROPIC_API_KEY_FOR_VOICE = defineSecret('ANTHROPIC_API_KEY');

// Per-tier daily cap on recorded seconds. Mirrors CLAUDE_COMPANY_BUDGET
// in functions/index.js. Starter = 20 hr/month ≈ 2400s/day soft cap
// (burstable — budget is per-day, users can backload).
const VOICE_COMPANY_BUDGET_SEC = {
  lite:         3600,      // 1 hr/mo ≈ 120s/day
  foundation:   72000,     // 20 hr/mo ≈ 2400s/day
  starter:      72000,
  growth:      180000,     // 50 hr/mo ≈ 6000s/day
  professional:600000      // 166 hr/mo ≈ 20000s/day
};
const VOICE_COMPANY_BUDGET_DEFAULT = 3600;

// Max audio file size the pipeline will accept. Matches storage.rules
// upper bound so a client that slipped past the rule still gets
// rejected at processing time.
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;

// Hard timeout guard for the whole pipeline. Cloud Function timeout
// is 540s for the handler; we reserve ~20s for Firestore writes.
const PIPELINE_TIMEOUT_MS = 520_000;

// ─── Helpers ────────────────────────────────────────────────────
//
// parseAudioPath: audio/{uid}/{leadId}/{recordingId}.{ext}
// Returns null on any shape mismatch. Storage triggers fire on ALL
// finalizations in the bucket; we ignore non-audio paths silently.
function parseAudioPath(fullPath) {
  if (typeof fullPath !== 'string') return null;
  const m = fullPath.match(
    /^audio\/([^/]+)\/([^/]+)\/([^/]+)\.(webm|mp3|mp4|m4a|ogg|wav|aac)$/i
  );
  if (!m) return null;
  return { uid: m[1], leadId: m[2], recordingId: m[3], ext: m[4].toLowerCase() };
}

// getCompanyContext: resolve the caller's companyId + plan tier +
// consent mode. Used by the pipeline to gate processing.
async function getCompanyContext(db, uid) {
  const out = {
    companyId: uid,           // solo-op default: own uid == own company
    plan: 'lite',
    consentMode: 'two_party_attested'  // safest default
  };
  try {
    const userSnap = await db.doc('users/' + uid).get();
    if (userSnap.exists) {
      const u = userSnap.data();
      if (u.companyId) out.companyId = u.companyId;
    }
  } catch (_) {}
  try {
    const subSnap = await db.doc('subscriptions/' + uid).get();
    if (subSnap.exists) out.plan = subSnap.data().plan || 'lite';
  } catch (_) {}
  try {
    const coSnap = await db.doc('companies/' + out.companyId).get();
    if (coSnap.exists) {
      const c = coSnap.data();
      if (typeof c.recordingConsentMode === 'string') {
        out.consentMode = c.recordingConsentMode;
      }
    }
  } catch (_) {}
  return out;
}

// Daily budget check. Reads the materialized counter from M2
// (api_usage_daily/{date}__co__{companyId}) and compares against
// the per-plan cap.
async function checkBudget(db, companyId, plan) {
  const dayKey = new Date().toISOString().slice(0, 10);
  const ref = db.doc('api_usage_daily/' + dayKey + '__co__' + companyId);
  let consumed = 0;
  try {
    const snap = await ref.get();
    if (snap.exists) consumed = Number(snap.data().voice_audioSec) || 0;
  } catch (_) {}
  const cap = VOICE_COMPANY_BUDGET_SEC[plan] || VOICE_COMPANY_BUDGET_DEFAULT;
  return { consumed, cap, overBudget: consumed >= cap };
}

// Stamp per-company + per-uid voice usage counters. Uses the same
// materialized-counter docs that M2 introduced for claudeProxy, so
// "AI usage today" dashboards get voice minutes for free.
async function incrementVoiceUsage(db, {
  uid, companyId, audioSec, analysisTokens, costCents
}) {
  const dayKey = new Date().toISOString().slice(0, 10);
  const srv = admin.firestore.FieldValue.serverTimestamp();
  const incSec    = admin.firestore.FieldValue.increment(Math.max(0, audioSec|0));
  const incTok    = admin.firestore.FieldValue.increment(Math.max(0, analysisTokens|0));
  const incCost   = admin.firestore.FieldValue.increment(Math.max(0, costCents|0));
  await Promise.all([
    db.doc('api_usage_daily/' + dayKey + '__uid__' + uid).set({
      uid, dayKey, scope: 'uid', updatedAt: srv,
      voice_audioSec: incSec,
      voice_analysisTokens: incTok,
      voice_costCents: incCost
    }, { merge: true }),
    db.doc('api_usage_daily/' + dayKey + '__co__' + companyId).set({
      companyId, dayKey, scope: 'company', updatedAt: srv,
      voice_audioSec: incSec,
      voice_analysisTokens: incTok,
      voice_costCents: incCost
    }, { merge: true })
  ]);
}

module.exports = {
  // Handlers wired in C1d:
  //   onAudioUploaded, triggerProcessRecording, reprocessRecording
  // are attached to this exports object by subsequent commits.
  //
  // Helpers exported for unit testing:
  _parseAudioPath: parseAudioPath,
  _getCompanyContext: getCompanyContext,
  _checkBudget: checkBudget,
  _incrementVoiceUsage: incrementVoiceUsage,
  _constants: {
    VOICE_COMPANY_BUDGET_SEC,
    VOICE_COMPANY_BUDGET_DEFAULT,
    MAX_AUDIO_BYTES,
    PIPELINE_TIMEOUT_MS
  }
};
