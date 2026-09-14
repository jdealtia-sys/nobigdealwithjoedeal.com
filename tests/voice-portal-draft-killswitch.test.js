/**
 * tests/voice-portal-draft-killswitch.test.js — the unattended metered
 * triggers SPEND_KILLSWITCH.md flagged as having NO feature_flags/global
 * read anywhere: onAudioUploaded (Groq + Anthropic voice-memo
 * transcription/analysis) and generateAIDraft (one Anthropic call per
 * AI-suggested reply — inbound SMS, inbound homeowner portal messages, and
 * admin unmatched-SMS convert all share it). Before this suite existed, the
 * only lever for either was destroying a shared secret, which also takes
 * down claudeProxy and photo-vision.
 *
 * Pins:
 *   1. each spend surface checks its OWN dedicated flag (not the shared
 *      aiDisabled one — an operator must be able to stop either without
 *      darkening claudeProxy/photo-vision/the other surface);
 *   2. killswitch.js actually defines and exports both checks;
 *   3. onAudioUploaded, when disabled, still resolves the recording doc as
 *      'failed' rather than silently doing nothing — the customer page
 *      listens via onSnapshot and must not spin forever waiting on a doc
 *      that will never arrive;
 *   4. generateAIDraft's gate is checked ONCE, inside the shared function
 *      (handlers/ai-texting.js) — not duplicated (or, worse, missing) at
 *      each of its three call sites. This is the actual bug this suite
 *      caught mid-session: the first cut of this fix gated only
 *      onPortalMessageDraft and missed that incomingSMS calls the exact
 *      same generateAIDraft() with zero flag check of its own.
 *
 * Pure-Node, source-pattern checks — no network, no emulator, same
 * convention as tests/public-measure.test.js. Run:
 *   node tests/voice-portal-draft-killswitch.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const FUNCTIONS = path.join(ROOT, 'functions');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/mg, '').replace(/\s\/\/[^\n]*$/mg, '');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

section('module loads (the CI "require every integration module" gate)');
let K = null, loadErr = null;
try { K = require(path.join(FUNCTIONS, 'integrations', 'killswitch.js')); } catch (e) { loadErr = e; }
ok('killswitch.js still requires cleanly', !loadErr, loadErr && loadErr.message);

const killswitchSrc = codeOnly(read('functions/integrations/killswitch.js'));
const killswitchRaw = read('functions/integrations/killswitch.js');
const voiceSrc = codeOnly(read('functions/integrations/voice-intelligence.js'));
const smsSrc = codeOnly(read('functions/sms-functions.js'));
const aiTextingSrc = codeOnly(read('functions/handlers/ai-texting.js'));
const convertSrc = codeOnly(read('functions/handlers/inbound-sms-convert.js'));

section('killswitch.js defines and exports both new flags');
{
  ok('voiceIntelDisabled flag exists', /voiceIntelDisabled/.test(killswitchSrc));
  ok('aiDraftDisabled flag exists', /aiDraftDisabled/.test(killswitchSrc));
  ok('isVoiceIntelDisabled is exported', /isVoiceIntelDisabled/.test(killswitchRaw)
    && /module\.exports = \{[\s\S]*isVoiceIntelDisabled[\s\S]*\}/.test(killswitchRaw));
  ok('isAiDraftDisabled is exported', /isAiDraftDisabled/.test(killswitchRaw)
    && /module\.exports = \{[\s\S]*isAiDraftDisabled[\s\S]*\}/.test(killswitchRaw));
  ok('killswitch still exports its original surface (no regression)', !!K
    && typeof K.isAiDisabled === 'function'
    && typeof K.isWebLeadMeasureDisabled === 'function'
    && typeof K.isVoiceIntelDisabled === 'function'
    && typeof K.isAiDraftDisabled === 'function'
    && typeof K._resetCache === 'function');
  ok('the two new flags are distinct from each other and from aiDisabled/webLeadMeasureDisabled', (() => {
    const names = ['aiDisabled', 'webLeadMeasureDisabled', 'voiceIntelDisabled', 'aiDraftDisabled'];
    return new Set(names).size === names.length;
  })());
}

section('onAudioUploaded (voice-intelligence.js) checks its own flag before spending');
{
  ok('imports isVoiceIntelDisabled from the shared killswitch module',
    /require\('\.\/killswitch'\)/.test(voiceSrc) && /isVoiceIntelDisabled/.test(voiceSrc));
  ok('the check runs inside processRecording, before transcription is attempted',
    voiceSrc.indexOf('isVoiceIntelDisabled()') > 0
    && voiceSrc.indexOf('isVoiceIntelDisabled()') < voiceSrc.indexOf('await transcribeAudio({'));
  ok('a disabled pipeline still resolves the recording doc (status: failed), not a silent no-op',
    /isVoiceIntelDisabled\(\)[\s\S]{0,400}status: 'failed'/.test(voiceSrc));
  ok('the failed doc carries a statusError naming the flag (so the UI can explain it, not just spin)',
    /statusError: 'voice intelligence temporarily disabled/.test(voiceSrc));
  ok('does NOT reuse the shared aiDisabled flag for this (must be independently flippable)',
    !/isVoiceIntelDisabled\(\)[\s\S]{0,200}aiDisabled/.test(voiceSrc));
}

section('generateAIDraft (handlers/ai-texting.js) is the ONE gated choke point for AI-drafted replies');
{
  ok('imports isAiDraftDisabled from integrations/killswitch',
    /require\('\.\.\/integrations\/killswitch'\)/.test(aiTextingSrc) && /isAiDraftDisabled/.test(aiTextingSrc));
  ok('the check runs inside generateAIDraft, after the secret check and before the Claude call', (() => {
    const fnStart = aiTextingSrc.indexOf('async function generateAIDraft(');
    const fnBody = aiTextingSrc.slice(fnStart, fnStart + 2500);
    const secretAt = fnBody.indexOf('ANTHROPIC_API_KEY unset');
    const gateAt = fnBody.indexOf('isAiDraftDisabled()');
    const claudeAt = fnBody.indexOf('callClaudeForDraft(');
    return secretAt > -1 && gateAt > secretAt && claudeAt > gateAt;
  })());
  ok('a disabled draft is a clean early return (null), matching the existing missing-secret no-op shape', (() => {
    const fnStart = aiTextingSrc.indexOf('async function generateAIDraft(');
    const fnBody = aiTextingSrc.slice(fnStart, fnStart + 2500);
    return /if \(await isAiDraftDisabled\(\)\) \{[\s\S]{0,200}return null;\s*\}/.test(fnBody);
  })());
}

section('all three generateAIDraft() callers inherit the gate — none checks (or needs to check) it directly');
{
  ok('sms-functions.js (incomingSMS + onPortalMessageDraft) calls generateAIDraft at least twice',
    (smsSrc.match(/generateAIDraft\(\{/g) || []).length >= 2);
  ok('sms-functions.js does NOT import or reference a portal-only flag anymore (centralized, not duplicated)',
    !/isPortalDraftDisabled/.test(smsSrc) && !/portalDraftDisabled/.test(smsSrc));
  ok('handlers/inbound-sms-convert.js (convertUnmatchedSms) also calls generateAIDraft',
    /generateAIDraft\(\{/.test(convertSrc));
  ok('none of the three callers re-checks isAiDraftDisabled themselves (single point of truth)',
    !/isAiDraftDisabled/.test(smsSrc) && !/isAiDraftDisabled/.test(convertSrc));
}

section('runbook documents both levers (SPEND_KILLSWITCH.md must not go stale the day this ships)');
{
  const runbook = read('documentation/runbooks/SPEND_KILLSWITCH.md');
  ok('voiceIntelDisabled is documented', /voiceIntelDisabled/.test(runbook));
  ok('aiDraftDisabled is documented', /aiDraftDisabled/.test(runbook));
  ok('the doc names all three callers, not just the portal one',
    /incomingSMS/.test(runbook) && /onPortalMessageDraft/.test(runbook) && /convertUnmatchedSms/.test(runbook));
  ok('the doc no longer claims onAudioUploaded has no feature_flags/global read',
    !/No\s*`feature_flags\/global`\s*read anywhere in the file/.test(runbook));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.log('\nFAILED:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
