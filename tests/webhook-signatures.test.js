/**
 * tests/webhook-signatures.test.js — Phase 12 integration webhook security.
 *
 * Webhooks are unauthenticated entry points; their only guard is signature
 * verification. This unit-tests the exact mechanisms the functions use, with the
 * real SDKs (functions/node_modules), against valid + tampered payloads:
 *   - Stripe  : stripe.webhooks.constructEvent (stripeWebhook + invoiceWebhook)
 *   - Twilio  : validateRequest / getExpectedTwilioSignature (incomingSMS)
 *
 * Plain node, no emulator (unaffected by E-1). Run:
 *   node tests/webhook-signatures.test.js
 */
'use strict';

const path = require('path');
const FN = path.join(__dirname, '..', 'functions', 'node_modules');
const stripe = require(path.join(FN, 'stripe'))('sk_test_dummy');
const twilio = require(path.join(FN, 'twilio'));

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }
function throws(name, fn) { try { fn(); ok(name + ' (expected throw)', false); } catch { ok(name, true); } }

// ── Stripe (constructEvent) ──────────────────────────────────
{
  console.log('STRIPE WEBHOOK — constructEvent signature verification');
  const secret = 'whsec_unittestsecret';
  const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });

  const ev = stripe.webhooks.constructEvent(payload, header, secret);
  ok('valid signature → event accepted', ev && ev.type === 'checkout.session.completed');

  throws('tampered payload → rejected', () =>
    stripe.webhooks.constructEvent(payload + ' ', header, secret));
  throws('wrong webhook secret → rejected', () =>
    stripe.webhooks.constructEvent(payload, header, 'whsec_wrongsecret'));
  throws('garbage signature header → rejected', () =>
    stripe.webhooks.constructEvent(payload, 't=1,v1=deadbeef', secret));
  throws('missing signature → rejected', () =>
    stripe.webhooks.constructEvent(payload, '', secret));

  // replay/expiry: a timestamp older than the tolerance window is rejected
  const oldHeader = stripe.webhooks.generateTestHeaderString({
    payload, secret, timestamp: Math.floor(Date.now() / 1000) - 1000,
  });
  throws('stale timestamp beyond 300s tolerance → rejected (replay guard)', () =>
    stripe.webhooks.constructEvent(payload, oldHeader, secret, 300));
  // ...but accepted within a generous tolerance (proves it's the timestamp, not the sig)
  {
    const ev2 = stripe.webhooks.constructEvent(payload, oldHeader, secret, 100000);
    ok('same stale event accepted within a wide tolerance (sig itself valid)', ev2.id === 'evt_1');
  }
}

// ── Twilio (validateRequest) ─────────────────────────────────
{
  console.log('\nTWILIO WEBHOOK — validateRequest signature verification');
  const authToken = 'unit_test_auth_token';
  const url = 'https://us-central1-nobigdeal-pro.cloudfunctions.net/incomingSMS';
  const params = { From: '+15125550100', To: '+15125559999', Body: 'Send my estimate' };
  const sig = twilio.getExpectedTwilioSignature(authToken, url, params);

  ok('valid signature → accepted', twilio.validateRequest(authToken, sig, url, params) === true);
  ok('tampered body param → rejected',
    twilio.validateRequest(authToken, sig, url, { ...params, Body: 'evil payload' }) === false);
  ok('tampered From param → rejected',
    twilio.validateRequest(authToken, sig, url, { ...params, From: '+10000000000' }) === false);
  ok('wrong auth token → rejected',
    twilio.validateRequest('attacker_token', sig, url, params) === false);
  ok('different URL → rejected',
    twilio.validateRequest(authToken, sig, 'https://evil.example/incomingSMS', params) === false);
  ok('empty signature → rejected',
    twilio.validateRequest(authToken, '', url, params) === false);
}

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
