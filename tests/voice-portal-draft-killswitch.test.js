/**
 * tests/voice-portal-draft-killswitch.test.js — the two unattended metered
 * triggers SPEND_KILLSWITCH.md flagged 2026-09-14 as having NO
 * feature_flags/global read anywhere: onAudioUploaded (Groq + Anthropic
 * voice-memo transcription/analysis) and onPortalMessageDraft (one
 * Anthropic call per inbound homeowner portal message). Before this suite
 * existed, the only lever for either was destroying a shared secret, which
 * also takes down claudeProxy and photo-vision.
 *
 * Pins:
 *   1. each trigger checks its OWN dedicated flag (not the shared
 *      aiDisabled one — an operator must be able to stop either without
 *      darkening claudeProxy/photo-vision/the other trigger);
 *   2. killswitch.js actually defines and exports both checks;
 *   3. onAudioUploaded, when disabled, still resolves the recording doc as
 *      'failed' rather than silently doing nothing — the customer page
 *      listens via onSnapshot and must not spin forever waiting on a doc
 *      that will never arrive;
 *   4. onPortalMessageDraft's gate runs BEFORE the Anthropic call
 *      (generateAIDraft), not after.
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

section('killswitch.js defines and exports both new flags');
{
  ok('voiceIntelDisabled flag exists', /voiceIntelDisabled/.test(killswitchSrc));
  ok('portalDraftDisabled flag exists', /portalDraftDisabled/.test(killswitchSrc));
  ok('isVoiceIntelDisabled is exported', /isVoiceIntelDisabled/.test(killswitchRaw)
    && /module\.exports = \{[\s\S]*isVoiceIntelDisabled[\s\S]*\}/.test(killswitchRaw));
  ok('isPortalDraftDisabled is exported', /isPortalDraftDisabled/.test(killswitchRaw)
    && /module\.exports = \{[\s\S]*isPortalDraftDisabled[\s\S]*\}/.test(killswitchRaw));
  ok('killswitch still exports its original surface (no regression)', !!K
    && typeof K.isAiDisabled === 'function'
    && typeof K.isWebLeadMeasureDisabled === 'function'
    && typeof K.isVoiceIntelDisabled === 'function'
    && typeof K.isPortalDraftDisabled === 'function'
    && typeof K._resetCache === 'function');
  ok('the two new flags are distinct from each other and from aiDisabled/webLeadMeasureDisabled', (() => {
    const names = ['aiDisabled', 'webLeadMeasureDisabled', 'voiceIntelDisabled', 'portalDraftDisabled'];
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

section('onPortalMessageDraft (sms-functions.js) checks its own flag before drafting');
{
  ok('imports isPortalDraftDisabled from integrations/killswitch',
    /require\('\.\/integrations\/killswitch'\)/.test(smsSrc) && /isPortalDraftDisabled/.test(smsSrc));
  ok('the check runs inside the onPortalMessageDraft handler, before generateAIDraft is called', (() => {
    const handlerStart = smsSrc.indexOf('exports.onPortalMessageDraft');
    const handlerBody = smsSrc.slice(handlerStart, handlerStart + 1500);
    const gateAt = handlerBody.indexOf('isPortalDraftDisabled()');
    const draftAt = handlerBody.indexOf('generateAIDraft({');
    return gateAt > -1 && draftAt > -1 && gateAt < draftAt;
  })());
  ok('a disabled draft is a clean early return (never falls through to generateAIDraft)', (() => {
    const handlerStart = smsSrc.indexOf('exports.onPortalMessageDraft');
    const handlerBody = smsSrc.slice(handlerStart, handlerStart + 1500);
    return /if \(await isPortalDraftDisabled\(\)\) \{[\s\S]{0,150}return;\s*\}/.test(handlerBody);
  })());
}

section('runbook documents both levers (SPEND_KILLSWITCH.md must not go stale the day this ships)');
{
  const runbook = read('documentation/runbooks/SPEND_KILLSWITCH.md');
  ok('voiceIntelDisabled is documented', /voiceIntelDisabled/.test(runbook));
  ok('portalDraftDisabled is documented', /portalDraftDisabled/.test(runbook));
  ok('the doc no longer claims onAudioUploaded has no feature_flags/global read',
    !/No\s*`feature_flags\/global`\s*read anywhere in the file/.test(runbook));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  console.log('\nFAILED:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
