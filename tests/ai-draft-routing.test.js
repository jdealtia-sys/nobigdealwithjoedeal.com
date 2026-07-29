/**
 * tests/ai-draft-routing.test.js — the channel fork behind portal AI replies
 * (functions/ai-draft-routing.js, shared verbatim by onAiDraftApproved).
 *
 * The one invariant that MUST hold: an inbound_sms draft is NEVER treated as a
 * portal draft (so the live Twilio send path is untouched), and only the
 * explicit portal trigger types route to the portal thread. A false positive
 * here would silently divert a customer SMS into the portal (never sent); a
 * false negative would text a homeowner-portal reply to a phone.
 *
 * Zero deps (no firebase in the routing module).
 * Run: node tests/ai-draft-routing.test.js
 */
'use strict';

const path = require('path');
const R = require(path.join('..', 'functions', 'ai-draft-routing.js'));

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('AI DRAFT ROUTING — channel fork');

// isPortalDraft — the SMS path must stay SMS
{
  ok('portal_message_in → portal', R.isPortalDraft({ triggerType: 'portal_message_in' }) === true);
  ok('inbound_sms → NOT portal (Twilio path untouched)', R.isPortalDraft({ triggerType: 'inbound_sms' }) === false);
  ok('missing triggerType → NOT portal', R.isPortalDraft({}) === false);
  ok('null / undefined draft → NOT portal', R.isPortalDraft(null) === false && R.isPortalDraft(undefined) === false);
  ok('non-string triggerType → NOT portal', R.isPortalDraft({ triggerType: 123 }) === false);
  ok('an unknown/new triggerType does NOT accidentally route to portal',
    R.isPortalDraft({ triggerType: 'no_reply_5d' }) === false);
  ok('only the explicit portal set counts', R.PORTAL_TRIGGER_TYPES.has('portal_message_in') && !R.PORTAL_TRIGGER_TYPES.has('inbound_sms'));
}

// channel — defense in depth (emulator QA 2026-07-29). A portal draft carries
// the homeowner's customerPhone, so triggerType was the ONLY thing keeping a
// web-portal reply from being TEXTED. Either signal must route to the portal.
{
  ok('channel:portal alone → portal (triggerType lost)',
    R.isPortalDraft({ channel: 'portal' }) === true);
  ok('channel:portal + missing triggerType → portal (the QA F2 hole)',
    R.isPortalDraft({ channel: 'portal', customerPhone: '+15135550142' }) === true);
  ok('channel:sms + portal triggerType still → portal (trigger wins, never silently texts)',
    R.isPortalDraft({ channel: 'sms', triggerType: 'portal_message_in' }) === true);
  ok('channel:sms → NOT portal', R.isPortalDraft({ channel: 'sms', triggerType: 'inbound_sms' }) === false);
  ok('unknown channel value falls back to triggerType',
    R.isPortalDraft({ channel: 'carrier-pigeon', triggerType: 'inbound_sms' }) === false
    && R.isPortalDraft({ channel: 'carrier-pigeon', triggerType: 'portal_message_in' }) === true);
  ok('legacy draft (neither field) keeps the documented SMS default',
    R.isPortalDraft({ draftText: 'hi', customerPhone: '+15135550142' }) === false);
  ok('channelForTriggerType stamps portal for portal triggers, sms otherwise',
    R.channelForTriggerType('portal_message_in') === 'portal'
    && R.channelForTriggerType('inbound_sms') === 'sms'
    && R.channelForTriggerType(undefined) === 'sms'
    && R.channelForTriggerType(123) === 'sms');
  ok('a stamped channel round-trips through isPortalDraft for BOTH kinds',
    R.isPortalDraft({ channel: R.channelForTriggerType('portal_message_in') }) === true
    && R.isPortalDraft({ channel: R.channelForTriggerType('inbound_sms') }) === false);
}

// clampPortalText
{
  ok('trims whitespace', R.clampPortalText('  hi there  ') === 'hi there');
  ok('empty / non-string → "" (no body → do not deliver)',
    R.clampPortalText('') === '' && R.clampPortalText('   ') === '' && R.clampPortalText(null) === '' && R.clampPortalText(42) === '');
  ok('clamps to 2000 by default', R.clampPortalText('x'.repeat(5000)).length === 2000);
  ok('honors a custom max', R.clampPortalText('x'.repeat(50), 10).length === 10);
  ok('bad max falls back to 2000', R.clampPortalText('x'.repeat(3000), 0).length === 2000);
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
