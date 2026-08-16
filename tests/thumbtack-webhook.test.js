/**
 * tests/thumbtack-webhook.test.js — Thumbtack webhook payload logic.
 *
 * Pure unit test of functions/integrations/thumbtack-logic.js plus the
 * lead-bridge mapping it feeds. Zero deps (no emulator) — the HTTP/Firestore
 * I/O lives in functions/integrations/thumbtack.js; everything tested here is
 * pure.
 *
 * WHY THE SHAPE-TOLERANCE TESTS MATTER: Thumbtack documents which events it
 * sends but NOT the JSON schema, and advises pointing the webhook at Zapier
 * (schema-agnostic). So the parser has to survive several plausible spellings
 * of the same field. These tests pin that tolerance so a future "cleanup" that
 * narrows the accepted paths fails loudly instead of silently dropping leads.
 *
 * Run: node tests/thumbtack-webhook.test.js
 */
'use strict';

const path = require('path');
const T = require(path.join(__dirname, '..', 'functions', 'integrations', 'thumbtack-logic.js'));
const L = require(path.join(__dirname, '..', 'functions', 'lead-bridge-logic.js'));

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const NBD = '1phDvAVXHSg82wDLegAbQFq14Ci1';

console.log('THUMBTACK — event classification');
ok('explicit lead type', T.classifyEvent({ eventType: 'lead.created' }) === T.EVENT.LEAD);
ok('explicit message type', T.classifyEvent({ eventType: 'message.created' }) === T.EVENT.MESSAGE);
ok('explicit review type', T.classifyEvent({ eventType: 'review.created' }) === T.EVENT.REVIEW);
ok('alt key `event`', T.classifyEvent({ event: 'NEW_REVIEW' }) === T.EVENT.REVIEW);
ok('request/job wording → lead', T.classifyEvent({ type: 'new_request' }) === T.EVENT.LEAD);
ok('sniff lead by customer block', T.classifyEvent({ customer: { name: 'A' } }) === T.EVENT.LEAD);
ok('sniff message by messageBody', T.classifyEvent({ messageBody: 'hi' }) === T.EVENT.MESSAGE);
ok('sniff review by rating', T.classifyEvent({ rating: 5 }) === T.EVENT.REVIEW);
ok('review wins over message-ish text', T.classifyEvent({ review: { text: 'great' }, message: 'x' }) === T.EVENT.REVIEW);
ok('unrecognised → unknown (never guessed)', T.classifyEvent({ wat: 1 }) === T.EVENT.UNKNOWN);
ok('null-safe', T.classifyEvent(null) === T.EVENT.UNKNOWN);

console.log('\nTHUMBTACK — unknown payloads still land somewhere');
ok('unknown routes to thumbtack_events', T.COLLECTION_BY_EVENT[T.EVENT.UNKNOWN] === 'thumbtack_events');
ok('lead routes to thumbtack_leads', T.COLLECTION_BY_EVENT[T.EVENT.LEAD] === 'thumbtack_leads');
ok('messages do NOT share the lead collection', T.COLLECTION_BY_EVENT[T.EVENT.MESSAGE] !== 'thumbtack_leads');
ok('reviews do NOT share the lead collection', T.COLLECTION_BY_EVENT[T.EVENT.REVIEW] !== 'thumbtack_leads');

console.log('\nTHUMBTACK — test-delivery detection (must never reach the pipeline)');
ok('isTest boolean', T.isTestPayload({ isTest: true }) === true);
ok('is_test snake', T.isTestPayload({ is_test: true }) === true);
ok('string "true"', T.isTestPayload({ testLead: 'true' }) === true);
ok('type carries test', T.isTestPayload({ eventType: 'test_lead' }) === true);
ok('real lead is not test', T.isTestPayload({ eventType: 'lead.created', customer: { name: 'A' } }) === false);
ok('null-safe', T.isTestPayload(null) === false);

console.log('\nTHUMBTACK — idempotency id extraction');
ok('leadID (Thumbtack-style caps)', T.extractEventId({ leadID: 'abc123' }) === 'abc123');
ok('leadId camel', T.extractEventId({ leadId: 'abc123' }) === 'abc123');
ok('nested lead.id', T.extractEventId({ lead: { id: 'nested1' } }) === 'nested1');
ok('reviewId', T.extractEventId({ reviewId: 'r9' }) === 'r9');
ok('bare id fallback', T.extractEventId({ id: 'plain' }) === 'plain');
ok('absent → empty (caller hashes)', T.extractEventId({ foo: 1 }) === '');
ok('objects are not stringified into an id', T.extractEventId({ id: { nope: 1 } }) === '');

console.log('\nTHUMBTACK — lead normalization across plausible shapes');
{
  const flat = T.normalizeLead({
    customerName: 'Loletha Neal', phone: '(513) 555-0142',
    address: '123 Elm St, Cincinnati, OH 45225', service: 'Roof Install',
  });
  ok('flat: first name', flat.firstName === 'Loletha');
  ok('flat: last name', flat.lastName === 'Neal');
  ok('flat: phone kept verbatim', flat.phone === '(513) 555-0142');
  ok('flat: phoneDigits normalized', flat.phoneDigits === '5135550142');
  ok('flat: service', flat.service === 'Roof Install');
}
{
  const nested = T.normalizeLead({
    customer: { firstName: 'Cat', lastName: 'Gaines', phone: '+1 513 555 0199' },
    request: { category: 'Roof Repair' },
  });
  ok('nested: firstName hint wins', nested.firstName === 'Cat');
  ok('nested: lastName', nested.lastName === 'Gaines');
  ok('nested: E.164 → 10 digits', nested.phoneDigits === '5135550199');
  ok('nested: service from request.category', nested.service === 'Roof Repair');
}
{
  const snake = T.normalizeLead({ first_name: 'Diane', last_name: 'Garrity', phone_number: '513-243-2995' });
  ok('snake_case: names', snake.firstName === 'Diane' && snake.lastName === 'Garrity');
  ok('snake_case: phone', snake.phoneDigits === '5132432995');
}
{
  const bare = T.normalizeLead({});
  ok('empty payload does not throw', !!bare);
  ok('empty payload gets a placeholder name', bare.firstName === '(Thumbtack lead)');
  ok('empty payload phoneDigits is empty string', bare.phoneDigits === '');
}
{
  // Thumbtack states it never sends email. Assert we tolerate that and say so.
  const noEmail = T.normalizeLead({ customerName: 'James Hutsell', phone: '5135550111' });
  ok('email absent → empty string, not undefined', noEmail.email === '');
  const notes = T.leadNotes(noEmail);
  ok('notes explain the missing email', /does not provide customer email/i.test(notes));
}
{
  const withSvc = T.leadNotes({ service: 'Gutter Repair', details: 'Downspout pulled off', email: 'x@y.com' });
  ok('notes lead with the channel + service', withSvc.indexOf('Thumbtack — Gutter Repair') === 0);
  ok('notes carry job details', /Downspout pulled off/.test(withSvc));
  ok('no email caveat when an email exists', !/does not provide/i.test(withSvc));
}

console.log('\nTHUMBTACK — CRM bridge mapping (channel attribution)');
ok('thumbtack_leads has a bridge mapping', !!L.BRIDGE_KINDS.thumbtack_leads);
ok('registered as an external source', L.EXTERNAL_SOURCE_COLLECTIONS.indexOf('thumbtack_leads') !== -1);
{
  const norm = T.normalizeLead({ customerName: 'Adam Moore', phone: '5135550188', service: 'Gutter Cleaning' });
  norm.notes = T.leadNotes(norm);
  const lead = L.mapPublicLeadToLead({
    collection: 'thumbtack_leads', sourceId: 'tt-1',
    ownerUid: NBD, companyId: NBD, data: norm,
  });
  // The audit's whole point: paid-marketplace spend must not be credited to the
  // website. "Website — Thumbtack" would do exactly that in the scorecard.
  ok('source reads as the channel, not the website', lead.source === 'Thumbtack');
  ok('source is NOT prefixed "Website — "', !/^Website/.test(lead.source));
  ok('webLead false (came from a marketplace)', lead.webLead === false);
  ok('precomputed notes preserved', /Thumbtack — Gutter Cleaning/.test(lead.notes));
  ok('phoneDigits carried onto the CRM lead', lead.phoneDigits === '5135550188');
  ok('tenant stamped', lead.companyId === NBD && lead.userId === NBD);
  ok('lands in the New stage', lead.stage === 'New');
  ok('provenance kind', lead.publicLeadKind === 'thumbtack');
}
{
  // Website kinds must be untouched by the external-source change.
  const web = L.mapPublicLeadToLead({
    collection: 'contact_leads', sourceId: 'c1',
    ownerUid: NBD, companyId: NBD, data: { firstName: 'Web', phone: '5135550100' },
  });
  ok('contact form still reads "Website — Contact form"', web.source === 'Website — Contact form');
  ok('contact form still webLead true', web.webLead === true);
}

console.log('\nTHUMBTACK — deterministic idempotency id');
ok('same source+id → same doc id', L.bridgeDocId('thumbtack_leads', 'tt-1') === L.bridgeDocId('thumbtack_leads', 'tt-1'));
ok('different id → different doc id', L.bridgeDocId('thumbtack_leads', 'tt-1') !== L.bridgeDocId('thumbtack_leads', 'tt-2'));

console.log('\n' + (failed === 0
  ? `PASS — ${passed} assertions`
  : `FAIL — ${failed} of ${passed + failed} failed:\n  - ` + fails.join('\n  - ')));
process.exit(failed === 0 ? 0 : 1);
