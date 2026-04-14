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

// ─── Transcription (C1b) ─────────────────────────────────────────
//
// Single public entry point: transcribeAudio({ bucket, path, mimeType,
// provider }) → { text, segments, durationSec, providerJobId }.
//
// Dispatches to the provider-specific implementation based on
// PROVIDERS.voiceTranscription. Each adapter is responsible for
// its own auth + request shape. Unified return contract so the
// state machine never has to know which provider ran.
async function transcribeAudio({ bucket, path, mimeType, provider }) {
  const p = (provider || PROVIDERS.voiceTranscription || 'groq').toLowerCase();
  switch (p) {
    case 'groq':     return transcribeGroq({ bucket, path, mimeType });
    case 'deepgram': return transcribeDeepgram({ bucket, path, mimeType });
    default:
      throw new VoiceError('transcription-provider-unknown',
        'PROVIDERS.voiceTranscription="' + p + '" not implemented');
  }
}

// Provider-specific adapters throw VoiceError with a stable `code`
// the state machine maps to Firestore statusError, so the UI can
// show actionable messages without peeking at stack traces.
class VoiceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.isVoiceError = true;
  }
}

// Groq Whisper-large-v3-turbo. Expects multipart/form-data with the
// audio file. Returns verbose_json including segments + duration.
// Docs: https://console.groq.com/docs/speech-text
async function transcribeGroq({ bucket, path, mimeType }) {
  if (!hasSecret('GROQ_API_KEY')) {
    throw new VoiceError('groq-not-configured',
      'GROQ_API_KEY secret is unset. Set via firebase functions:secrets:set GROQ_API_KEY.');
  }
  const file = bucket.file(path);
  const [exists] = await file.exists();
  if (!exists) throw new VoiceError('audio-missing', 'Storage object ' + path + ' not found');
  const [meta] = await file.getMetadata();
  const size = Number(meta.size) || 0;
  if (size === 0) throw new VoiceError('audio-empty', 'Storage object is 0 bytes');
  if (size > MAX_AUDIO_BYTES) {
    throw new VoiceError('audio-too-large',
      'Audio is ' + Math.round(size / 1024 / 1024) + 'MB; cap is ' +
      Math.round(MAX_AUDIO_BYTES / 1024 / 1024) + 'MB');
  }

  // Stream the audio bytes into memory. 200MB cap fits a 256MiB
  // function instance; for larger files we'd stream directly to
  // Groq via signed URL, but Groq requires multipart so buffering
  // is the simpler path at current budget.
  const [buffer] = await file.download();
  const blob = new Blob([buffer], { type: mimeType || 'audio/webm' });
  const form = new FormData();
  form.append('file', blob, 'audio.' + (path.split('.').pop() || 'webm'));
  form.append('model', 'whisper-large-v3-turbo');
  form.append('response_format', 'verbose_json');
  form.append('timestamp_granularities[]', 'segment');
  form.append('language', 'en');

  let res;
  try {
    res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + getSecret('GROQ_API_KEY') },
      body: form,
      signal: AbortSignal.timeout(480_000)
    });
  } catch (e) {
    throw new VoiceError('groq-network',
      'Groq request failed: ' + (e && e.message ? e.message : String(e)));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
    throw new VoiceError('groq-api-error', 'Groq rejected: ' + String(msg).slice(0, 300));
  }
  if (!data || typeof data.text !== 'string') {
    throw new VoiceError('groq-empty-response', 'Groq returned no transcript text');
  }
  return {
    text: data.text,
    segments: Array.isArray(data.segments) ? data.segments.map(s => ({
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || '')
    })) : [],
    durationSec: Number(data.duration) || 0,
    providerJobId: null   // Groq is synchronous; no job id to track
  };
}

// Deepgram Nova-2 stub for Phase 2. Kept as a not-implemented
// throw so the provider dispatch table above reads cleanly today.
// Full adapter lands with the Pro-tier launch.
async function transcribeDeepgram(/* { bucket, path, mimeType } */) {
  throw new VoiceError('deepgram-not-implemented',
    'Deepgram adapter ships with Phase 2. Set NBD_VOICE_TRANSCRIPTION_PROVIDER=groq in the meantime.');
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
  _transcribeAudio: transcribeAudio,
  _VoiceError: VoiceError,
  _constants: {
    VOICE_COMPANY_BUDGET_SEC,
    VOICE_COMPANY_BUDGET_DEFAULT,
    MAX_AUDIO_BYTES,
    PIPELINE_TIMEOUT_MS,
    ANTHROPIC_API_KEY_FOR_VOICE
  }
};
