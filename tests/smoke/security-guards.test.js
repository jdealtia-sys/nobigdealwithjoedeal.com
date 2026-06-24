/**
 * tests/smoke/security-guards.test.js — Audit #2 (Phase 8.3)
 *
 * Structural regression guards for the security controls that protect
 * money + customer data. These are SOURCE assertions (zero deps, no
 * emulator): they fail CI the moment a refactor silently drops a
 * webhook signature check, the AI billing gate, or the SMS opt-out.
 *
 * They don't replace behavioral tests — they're a cheap tripwire that
 * the *guard still exists*, which is the realistic regression (someone
 * restructures incomingSMS / a webhook handler and the verify/reject
 * branch quietly disappears). Pairs with firestore-rules.cross-tenant
 * .test.js (tenant isolation) + the emulator rules suite.
 */
'use strict';

const path = require('path');
const { read, FUNCTIONS } = require('./_shared');

function run(ctx) {
  const { assert, section } = ctx;

  const stripe      = read(path.join(FUNCTIONS, 'stripe.js'));
  const esign       = read(path.join(FUNCTIONS, 'integrations/esign.js'));
  const calcom      = read(path.join(FUNCTIONS, 'integrations/calcom.js'));
  const measurement = read(path.join(FUNCTIONS, 'integrations/measurement.js'));
  const sms         = read(path.join(FUNCTIONS, 'sms-functions.js'));
  const ai          = read(path.join(FUNCTIONS, 'handlers/ai.js'));

  // ── Webhook signature verification (forged/unsigned POST must be rejected) ──
  section('SECURITY GUARDS — webhook signature verification');
  assert('stripeWebhook + invoiceWebhook verify via constructEvent',
    (stripe.match(/constructEvent/g) || []).length >= 2);
  assert('stripe webhooks require rawBody (block reparse-forgery)',
    /rawBody/.test(stripe) && /Invalid request body/.test(stripe));
  assert('stripe webhooks reject a bad signature',
    /signature verification failed/i.test(stripe) || /Invalid signature/.test(stripe));
  assert('esignWebhook HMAC-verifies (x-boldsign-signature + timingSafeEqual)',
    /x-boldsign-signature/.test(esign) && /timingSafeEqual/.test(esign));
  assert('esignWebhook fails closed when its secret is unset',
    /BOLDSIGN_WEBHOOK_SECRET/.test(esign) && /rejecting unsigned request/i.test(esign));
  assert('calcomWebhook HMAC-verifies (+ timingSafeEqual)',
    /CALCOM_WEBHOOK_SECRET/.test(calcom) && /timingSafeEqual/.test(calcom));
  assert('calcomWebhook fails closed when its secret is unset',
    /rejecting unsigned request/i.test(calcom));
  assert('measurementWebhook HMAC-verifies (verifyWebhookHmac + timingSafeEqual)',
    /verifyWebhookHmac/.test(measurement) && /timingSafeEqual/.test(measurement));
  assert('measurementWebhook rejects on signature mismatch',
    /signature rejected/i.test(measurement) && /sigResult\.ok/.test(measurement));
  assert('incomingSMS verifies the Twilio signature (validateRequest)',
    /validateRequest\(/.test(sms));
  assert('incomingSMS rejects an invalid Twilio signature',
    /signature verification failed/i.test(sms) && /403/.test(sms));

  // ── AI billing entitlement (claudeProxy must be paid + budgeted) ──
  section('SECURITY GUARDS — AI billing entitlement');
  assert('claudeProxy requires an active paid subscription (server-side)',
    /hasPaidPlan/.test(ai) && /require an active paid subscription/i.test(ai));
  assert('claudeProxy enforces a per-uid/company token budget',
    /reserveClaudeBudget/.test(ai));
  assert('claudeProxy requires a verified email before billable AI',
    /email_verified/.test(ai));

  // ── SMS opt-out / TCPA ──
  section('SECURITY GUARDS — SMS opt-out (TCPA)');
  assert('incomingSMS honors STOP-family keywords',
    /STOP_WORDS/.test(sms) && /UNSUBSCRIBE/.test(sms));
  assert('incomingSMS records opt-outs to sms_opt_outs',
    /sms_opt_outs/.test(sms));
  assert('outbound senders gate on sms_opt_outs before sending',
    // sendSMS / sendD2DSMS live in the same module and must consult the list.
    (sms.match(/sms_opt_outs/g) || []).length >= 2);

  // ── Claim-escalation remediation script: safety invariants ──
  // scripts/audit-claim-escalation.js mutates prod Auth claims under --apply.
  // These guards ensure it can't regress to auto-applying or running on import.
  section('SECURITY GUARDS — claim-escalation audit script');
  const audit = read(path.join(FUNCTIONS, '..', 'scripts', 'audit-claim-escalation.js'));
  assert('audit script defaults to DRY RUN (report only)',
    /DRY RUN \(report only\)/.test(audit));
  assert('audit script mutates only with BOTH --apply and --yes',
    /const APPLY = process\.argv\.includes\('--apply'\)/.test(audit)
    && /const CONFIRMED = process\.argv\.includes\('--yes'\)/.test(audit)
    && /if \(!APPLY \|\| !CONFIRMED\)/.test(audit));
  assert('audit script is import-safe (guards main on require.main)',
    /require\.main === module/.test(audit));
  assert('audit remediation is scoped to access-code CRITICAL only',
    /critical\.filter\(c => c\.isAccessCode\)/.test(audit));
  assert('audit script revokes sessions after a claim reset',
    /revokeRefreshTokens/.test(audit));
  assert('audit script exports classifyClaims (unit-tested)',
    /module\.exports = \{ classifyClaims \}/.test(audit));
}

module.exports = { run };
