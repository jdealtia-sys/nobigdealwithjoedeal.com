/**
 * integrations/killswitch.js — global feature kill-switches (Audit #4 Phase 4)
 *
 * A single Firestore doc `feature_flags/global` holds emergency switches that
 * take effect WITHOUT a deploy or secret rotation — one write to flip them.
 * The hot path (claudeProxy, analyzePhotoVision, visualizerImageGen) reads
 * this via a 60-second in-memory cache, so the cost is ~1 Firestore read per
 * minute per warm instance, not one per request.
 *
 * Flags:
 *   aiDisabled: true   → all billable AI endpoints fail closed (503 / unavailable)
 *
 * To pull the switch in an emergency (see SPEND_KILLSWITCH.md runbook):
 *   firebase firestore:... or in console: set feature_flags/global.aiDisabled = true
 *
 * FAIL-OPEN BY DESIGN: if the flag read throws (Firestore blip), we treat it
 * as "not disabled" and reuse the last-known value. A transient Firestore
 * error must not take down all AI — the switch is for deliberate emergencies,
 * where the operator can confirm it took effect.
 */
'use strict';

const admin = require('firebase-admin');

const TTL_MS = 60_000;
let _cache = { at: 0, flags: {} };

async function getFlags() {
  const now = Date.now();
  if (now - _cache.at < TTL_MS) return _cache.flags;
  try {
    const snap = await admin.firestore().doc('feature_flags/global').get();
    _cache = { at: now, flags: (snap.exists && snap.data()) || {} };
  } catch (e) {
    // Fail open: keep serving with the last-known flags, but advance the
    // timestamp so a Firestore outage doesn't hammer reads every request.
    _cache.at = now;
  }
  return _cache.flags;
}

async function isAiDisabled() {
  const f = await getFlags();
  return f.aiDisabled === true;
}

// Test hook — clears the cache so unit tests can assert fresh reads.
function _resetCache() { _cache = { at: 0, flags: {} }; }

module.exports = { getFlags, isAiDisabled, _resetCache };
