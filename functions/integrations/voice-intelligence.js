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

// ─── Analysis + consent (C1c) ────────────────────────────────────
//
// Two Claude calls share one Anthropic endpoint + shape. Both use
// haiku for cost (analysis averages ~2k input / ~600 output tokens,
// consent ~300 in / ~60 out). Never Opus — too expensive to run on
// every call and the quality bump isn't worth the price.
//
// Model pinned explicitly rather than read from env, so a config
// change can't quietly promote every user's voice analysis onto
// an Opus-tier bill.
const VOICE_ANALYSIS_MODEL = 'claude-haiku-4-5-20251001';
const VOICE_ANALYSIS_MAX_TOKENS = 1200;
const VOICE_CONSENT_MAX_TOKENS = 120;

// Call Anthropic, return the parsed JSON object. Strips common
// wrapper patterns (```json ... ``` fences, leading/trailing prose)
// before JSON.parse so minor prompt compliance drift doesn't cause
// a hard fail. Throws VoiceError on actual failures.
async function callClaudeJson({ systemPrompt, userPrompt, maxTokens, purpose }) {
  if (!hasSecret('ANTHROPIC_API_KEY')) {
    throw new VoiceError('anthropic-not-configured',
      'ANTHROPIC_API_KEY secret is unset');
  }
  const body = {
    model: VOICE_ANALYSIS_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: userPrompt }]
  };
  if (systemPrompt) body.system = systemPrompt;

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': getSecret('ANTHROPIC_API_KEY')
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000)
    });
  } catch (e) {
    throw new VoiceError('analysis-network',
      purpose + ' network error: ' + (e && e.message ? e.message : String(e)));
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || ('HTTP ' + res.status);
    throw new VoiceError('analysis-api-error',
      purpose + ' rejected: ' + String(msg).slice(0, 300));
  }
  const text = data && data.content && Array.isArray(data.content)
    ? data.content.map(c => (c && c.type === 'text' ? c.text : '')).join('')
    : '';
  if (!text) {
    throw new VoiceError('analysis-empty-response',
      purpose + ' returned no text');
  }

  // Strip ```json ... ``` fences + any leading/trailing prose.
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();
  // If the response still has prose before the first { or [, chop it.
  const firstBrace = cleaned.search(/[{\[]/);
  if (firstBrace > 0) cleaned = cleaned.slice(firstBrace);

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    throw new VoiceError('analysis-parse-error',
      purpose + ' returned non-JSON: ' + text.slice(0, 200));
  }

  const usage = data.usage || {};
  return {
    parsed,
    rawText: text,
    inputTokens: Number(usage.input_tokens) || 0,
    outputTokens: Number(usage.output_tokens) || 0
  };
}

// analyzeTranscript: runs the roofing-specific structured-summary
// prompt and returns {summary, speakers, tokens}. Caller stamps
// tokens onto the recording doc for per-lead cost attribution.
async function analyzeTranscript({ transcript, segments, leadName, callType }) {
  const userPrompt = prompts.buildAnalyzePrompt({
    leadName, callType, transcript, segments
  });
  const result = await callClaudeJson({
    userPrompt,
    maxTokens: VOICE_ANALYSIS_MAX_TOKENS,
    purpose: 'analysis'
  });

  const p = result.parsed || {};
  const speakers = Array.isArray(p.speakers) ? p.speakers.map(s => ({
    label: String(s.label || '').slice(0, 32),
    role:  String(s.role  || 'other').slice(0, 32),
    confidence: Number(s.confidence) || 0
  })) : [];

  const rawSummary = p.summary || {};
  const asStrArr = v => Array.isArray(v)
    ? v.filter(x => typeof x === 'string' && x).map(x => x.slice(0, 600))
    : [];

  const summary = {
    overview:     String(rawSummary.overview || '').slice(0, 2000),
    damageNoted:  asStrArr(rawSummary.damageNoted),
    objections:   asStrArr(rawSummary.objections),
    commitments:  Array.isArray(rawSummary.commitments)
      ? rawSummary.commitments.slice(0, 20).map(c => ({
          who:  String((c && c.who) || '').slice(0, 32),
          what: String((c && c.what) || '').slice(0, 500),
          when: c && c.when ? String(c.when).slice(0, 80) : null
        }))
      : [],
    nextActions:  asStrArr(rawSummary.nextActions),
    insuranceDetails: {
      carrier:     (rawSummary.insuranceDetails && rawSummary.insuranceDetails.carrier)     || null,
      claimNumber: (rawSummary.insuranceDetails && rawSummary.insuranceDetails.claimNumber) || null,
      adjuster:    (rawSummary.insuranceDetails && rawSummary.insuranceDetails.adjuster)    || null,
      deductible:  (rawSummary.insuranceDetails && rawSummary.insuranceDetails.deductible)  || null
    },
    redFlags:     asStrArr(rawSummary.redFlags)
  };

  return {
    speakers,
    summary,
    inputTokens:  result.inputTokens,
    outputTokens: result.outputTokens
  };
}

// checkVerbalConsent: scans the first ~20 seconds of transcript for
// affirmative consent. Returns { consented, evidence, tokens }.
// Only invoked when company.recordingConsentMode === 'two_party_verbal'.
// Fails CLOSED — any error on this step quarantines the recording.
async function checkVerbalConsent({ transcript, segments }) {
  // Pick the opening window — prefer segments so we get a clean
  // 20-second cut; fall back to the first 2000 chars of raw text.
  let opening = '';
  if (Array.isArray(segments) && segments.length > 0) {
    opening = segments
      .filter(s => s.start < 25)
      .map(s => s.text)
      .join(' ');
  }
  if (!opening) opening = String(transcript || '').slice(0, 2000);

  const userPrompt = prompts.buildConsentPrompt({ openingTranscript: opening });
  const result = await callClaudeJson({
    userPrompt,
    maxTokens: VOICE_CONSENT_MAX_TOKENS,
    purpose: 'consent-check'
  });

  const p = result.parsed || {};
  return {
    consented: p.consented === true,
    evidence:  typeof p.evidence === 'string' ? p.evidence.slice(0, 400) : null,
    inputTokens:  result.inputTokens,
    outputTokens: result.outputTokens
  };
}

// ─── State machine (C1d) ─────────────────────────────────────────
//
// One entry point: processRecording({ uid, leadId, recordingId, path,
// contentType, size, forceReanalyze }). Idempotent — a retry on the
// same recordingId detects the existing Firestore doc and either:
//   - resumes from the last status short of 'complete' (crash recovery)
//   - no-ops if status is 'complete' (safe to call again)
//   - runs analysis-only when forceReanalyze=true (prompt iteration)
//
// Wired to three Firebase hooks:
//   1. exports.onAudioUploaded  → Storage onObjectFinalized trigger
//   2. exports.triggerProcessRecording → admin-only callable (curl test)
//   3. exports.reprocessRecording      → admin-only callable (reanalyze)
//
// Never throws out of the Storage trigger — Firebase retries 7 times
// on uncaught errors and indefinitely at provider-API rate-limit
// boundaries. We write status:'failed' + statusError and return OK.
async function processRecording({
  uid, leadId, recordingId, path, contentType, size, forceReanalyze
}) {
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const recordingRef = db.doc('leads/' + leadId + '/recordings/' + recordingId);

  // ── Idempotency ──
  // If the doc exists and is 'complete', no-op unless the caller
  // explicitly asked to reanalyze (admin reprocess flow).
  const existingSnap = await recordingRef.get();
  const existing = existingSnap.exists ? existingSnap.data() : null;
  if (existing && existing.status === 'complete' && !forceReanalyze) {
    logger.info('voice: recording already complete', { leadId, recordingId });
    return { ok: true, skipped: 'already_complete' };
  }
  if (existing && existing.status === 'quarantined_consent' && !forceReanalyze) {
    logger.info('voice: recording quarantined on consent', { leadId, recordingId });
    return { ok: true, skipped: 'quarantined_consent' };
  }

  // ── Resolve caller context ──
  const ctx = await getCompanyContext(db, uid);

  // ── Budget gate ──
  // Over-budget recordings get flagged but NOT dropped — retention
  // of the raw audio + ability to reprocess next cycle is the
  // expected behaviour. Admin can manually reprocess after cycle reset.
  const budget = await checkBudget(db, ctx.companyId, ctx.plan);
  if (budget.overBudget) {
    await recordingRef.set({
      userId: uid, companyId: ctx.companyId, leadId, recordingId,
      audioPath: path, contentType: contentType || null,
      audioBytes: Number(size) || 0,
      status: 'failed',
      statusError: 'voice budget exhausted for company this cycle (' +
        budget.consumed + 's / ' + budget.cap + 's cap on plan=' + ctx.plan + ')',
      recordedAt: existing?.recordedAt || admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { ok: true, skipped: 'over_budget' };
  }

  // ── Doc init (or reuse existing row for reprocess) ──
  const now = admin.firestore.FieldValue.serverTimestamp();
  const baseDoc = {
    userId: uid,
    companyId: ctx.companyId,
    leadId,
    recordingId,
    audioPath: path,
    audioBytes: Number(size) || 0,
    contentType: contentType || null,
    recordedAt: existing?.recordedAt || now,
    callType: existing?.callType || 'other',
    consent: existing?.consent || { mode: ctx.consentMode, attestedAt: now, verbalPhrase: null },
    provider: PROVIDERS.voiceTranscription || 'groq',
    promptVersion: prompts.CURRENT_VERSION,
    status: 'transcribing',
    statusError: null,
    updatedAt: now
  };
  await recordingRef.set(baseDoc, { merge: true });

  // Everything from here runs inside a try so any failure writes
  // status:'failed' to Firestore instead of bubbling out of the
  // Storage trigger (which would trigger infinite retries).
  let transcriptResult = null;
  let analysis = null;
  let tokensUsed = 0;

  try {
    // ── (1) Transcription ── skip when reprocessing a doc that
    // already has transcript text. Saves Groq cost on every prompt
    // iteration.
    if (forceReanalyze && existing && existing.transcript) {
      transcriptResult = {
        text: existing.transcript,
        segments: existing.segments || [],
        durationSec: existing.audioDurationSec || 0,
        providerJobId: null
      };
    } else {
      transcriptResult = await transcribeAudio({
        bucket, path, mimeType: contentType,
        provider: PROVIDERS.voiceTranscription
      });
      await recordingRef.set({
        transcript: transcriptResult.text,
        segments: transcriptResult.segments,
        audioDurationSec: Math.round(transcriptResult.durationSec),
        status: 'analyzing',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    // ── (2) Verbal-consent check ── only for two_party_verbal mode
    // and only on fresh recordings. Reprocessing skips this so
    // iteration doesn't re-quarantine established records.
    if (ctx.consentMode === 'two_party_verbal' && !forceReanalyze) {
      let consentResult;
      try {
        consentResult = await checkVerbalConsent({
          transcript: transcriptResult.text,
          segments: transcriptResult.segments
        });
        tokensUsed += consentResult.inputTokens + consentResult.outputTokens;
      } catch (e) {
        // Fail CLOSED on consent check. The audio + transcript
        // stay in the doc; status moves to quarantined_consent
        // and analysis is NOT run. Admin can manually review +
        // reprocess.
        logger.warn('voice: consent check errored — quarantining', {
          leadId, recordingId, err: e.message
        });
        await recordingRef.set({
          status: 'quarantined_consent',
          statusError: 'consent check failed: ' + e.message,
          consent: { ...baseDoc.consent, verbalPhrase: null, checkFailed: true },
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return { ok: true, quarantined: true };
      }
      if (!consentResult.consented) {
        await recordingRef.set({
          status: 'quarantined_consent',
          statusError: 'no verbal consent detected in opening 25 seconds',
          consent: {
            ...baseDoc.consent,
            verbalPhrase: consentResult.evidence || null,
            consented: false
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return { ok: true, quarantined: true };
      }
      // Stamp the evidence for audit.
      await recordingRef.set({
        consent: {
          ...baseDoc.consent,
          verbalPhrase: consentResult.evidence,
          consented: true
        }
      }, { merge: true });
    }

    // ── (3) Analysis ──
    // Load the lead doc so the prompt can reference the homeowner
    // by name. If the lead is gone (deleted mid-process), fall back
    // to an empty name — the prompt handles that case.
    let leadName = '';
    try {
      const leadSnap = await db.doc('leads/' + leadId).get();
      if (leadSnap.exists) {
        const l = leadSnap.data();
        leadName = [l.firstName, l.lastName].filter(Boolean).join(' ').trim()
                 || l.name || '';
      }
    } catch (_) {}

    analysis = await analyzeTranscript({
      transcript: transcriptResult.text,
      segments:   transcriptResult.segments,
      leadName,
      callType:   baseDoc.callType
    });
    tokensUsed += analysis.inputTokens + analysis.outputTokens;

    // ── (4) Complete ──
    // Cost model: Groq Whisper ≈ $0.04/hr → $0.000011/sec.
    // Claude haiku input ≈ $1/1M, output ≈ $5/1M → ~$0.00001/token blend.
    const audioSec = Math.round(transcriptResult.durationSec);
    const costCents = Math.ceil(
      (audioSec * 0.000011 + tokensUsed * 0.00001) * 100
    );

    await recordingRef.set({
      speakers:  analysis.speakers,
      summary:   analysis.summary,
      tokensUsed,
      costCents,
      status: 'complete',
      statusError: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Stamp usage counters AFTER the doc lands — better to have
    // a recording without a counter increment than a counter
    // increment without a recording if the write race goes sideways.
    try {
      await incrementVoiceUsage(db, {
        uid, companyId: ctx.companyId,
        audioSec,
        analysisTokens: tokensUsed,
        costCents
      });
    } catch (e) {
      logger.warn('voice: usage-counter update failed', { err: e.message });
    }

    logger.info('voice: recording complete', {
      leadId, recordingId, audioSec, tokensUsed, costCents
    });
    return { ok: true, recordingId, audioSec, costCents };

  } catch (e) {
    const code = (e && e.isVoiceError) ? e.code : 'pipeline-error';
    const msg  = (e && e.message) || String(e);
    logger.error('voice: pipeline failed', { leadId, recordingId, code, msg });
    try {
      await recordingRef.set({
        status: 'failed',
        statusError: '[' + code + '] ' + msg.slice(0, 400),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (_) {}
    return { ok: false, code, error: msg };
  }
}

// ─── Handlers ────────────────────────────────────────────────────

// Storage trigger — fires on every finalization in the default
// bucket. We ignore non-audio paths silently. Firebase retries the
// trigger automatically on uncaught errors, so every failure path
// must be caught here or inside processRecording().
// Bucket is explicit so module-load succeeds outside the Firebase
// runtime (smoke tests, local require()). Default Firebase Storage
// bucket for the nobigdeal-pro project.
const VOICE_STORAGE_BUCKET = process.env.VOICE_STORAGE_BUCKET
  || 'nobigdeal-pro.firebasestorage.app';

exports.onAudioUploaded = onObjectFinalized(
  {
    region: 'us-central1',
    bucket: VOICE_STORAGE_BUCKET,
    secrets: [SECRETS.GROQ_API_KEY, ANTHROPIC_API_KEY_FOR_VOICE],
    memory: '512MiB',
    timeoutSeconds: 540,
    concurrency: 1,
    cpu: 1
  },
  async (event) => {
    const obj = event.data;
    if (!obj || !obj.name) return;
    const parsed = parseAudioPath(obj.name);
    if (!parsed) return; // not our audio prefix — silent ignore

    try {
      await processRecording({
        uid:          parsed.uid,
        leadId:       parsed.leadId,
        recordingId:  parsed.recordingId,
        path:         obj.name,
        contentType:  obj.contentType || null,
        size:         obj.size || 0,
        forceReanalyze: false
      });
    } catch (e) {
      // Belt + suspenders: processRecording already handles its own
      // failures, but an uncaught error here would cause Firebase to
      // retry the trigger, which re-charges Groq. Never let that
      // happen.
      logger.error('onAudioUploaded: unhandled error — swallowing to prevent retry storm', {
        path: obj.name,
        err: (e && e.message) || String(e)
      });
    }
  }
);

// Admin-only callable. Takes an existing Storage audio path + the
// lead/recording IDs and runs the pipeline. Used for curl-testing
// C1 end-to-end before the UI lands. Rejects non-admin callers and
// refuses paths outside the audio/ prefix.
exports.triggerProcessRecording = onCall(
  {
    region: 'us-central1',
    secrets: [SECRETS.GROQ_API_KEY, ANTHROPIC_API_KEY_FOR_VOICE],
    enforceAppCheck: true,
    memory: '512MiB',
    timeoutSeconds: 540
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    if (request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Platform admin required');
    }

    const path = String((request.data && request.data.path) || '');
    const parsed = parseAudioPath(path);
    if (!parsed) {
      throw new HttpsError('invalid-argument',
        'path must match audio/{uid}/{leadId}/{recordingId}.{ext}');
    }

    const result = await processRecording({
      uid:           parsed.uid,
      leadId:        parsed.leadId,
      recordingId:   parsed.recordingId,
      path,
      contentType:   String((request.data && request.data.contentType) || 'audio/webm'),
      size:          Number((request.data && request.data.size) || 0),
      forceReanalyze: Boolean(request.data && request.data.forceReanalyze)
    });
    return result;
  }
);

// Admin-only reanalyze: re-runs the Claude analysis against the
// existing transcript without re-downloading or re-transcribing the
// audio. Cheap. Used when iterating on the prompt in
// functions/voice-prompts.js — bump CURRENT_VERSION, deploy, then
// batch-call this to rewrite summaries.
exports.reprocessRecording = onCall(
  {
    region: 'us-central1',
    secrets: [ANTHROPIC_API_KEY_FOR_VOICE],
    enforceAppCheck: true,
    memory: '512MiB',
    timeoutSeconds: 120
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    if (request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Platform admin required');
    }

    const leadId      = String((request.data && request.data.leadId) || '');
    const recordingId = String((request.data && request.data.recordingId) || '');
    if (!leadId || !recordingId) {
      throw new HttpsError('invalid-argument', 'leadId + recordingId required');
    }

    const db = admin.firestore();
    const snap = await db.doc('leads/' + leadId + '/recordings/' + recordingId).get();
    if (!snap.exists) throw new HttpsError('not-found', 'recording not found');
    const rec = snap.data();
    if (!rec.transcript) {
      throw new HttpsError('failed-precondition',
        'recording has no transcript to reanalyze');
    }

    return processRecording({
      uid:           rec.userId || uid,
      leadId,
      recordingId,
      path:          rec.audioPath,
      contentType:   rec.contentType,
      size:          rec.audioBytes || 0,
      forceReanalyze: true
    });
  }
);

module.exports = Object.assign(module.exports, {
  // Helpers exported for unit testing:
  _parseAudioPath: parseAudioPath,
  _getCompanyContext: getCompanyContext,
  _checkBudget: checkBudget,
  _incrementVoiceUsage: incrementVoiceUsage,
  _transcribeAudio: transcribeAudio,
  _analyzeTranscript: analyzeTranscript,
  _checkVerbalConsent: checkVerbalConsent,
  _processRecording: processRecording,
  _VoiceError: VoiceError,
  _constants: {
    VOICE_COMPANY_BUDGET_SEC,
    VOICE_COMPANY_BUDGET_DEFAULT,
    MAX_AUDIO_BYTES,
    PIPELINE_TIMEOUT_MS,
    ANTHROPIC_API_KEY_FOR_VOICE,
    VOICE_ANALYSIS_MODEL,
    VOICE_ANALYSIS_MAX_TOKENS,
    VOICE_CONSENT_MAX_TOKENS
  }
});
