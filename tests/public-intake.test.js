/**
 * tests/public-intake.test.js — Phase 7 public lead capture & intake.
 *
 * Drives the REAL submitPublicLead HTTP function (functions+firestore emulator)
 * to verify the public-form validation gateway — the guards that return before
 * the admin-SDK write (so they're unaffected by the emulator FieldValue gap):
 *   - GET → 405 (POST-only)
 *   - unknown/missing kind → 400
 *   - missing required field → 400
 *   - field over maxLen → 400
 *   - exact-length violation (storm zip != 5) → 400
 *   - honeypot ('website' filled) → 200 silent success, no write
 *   - a fully valid submission passes validation (reaches the write)
 *   - estimate optional allowlist (M-04 bounded expansion): the estimator
 *     funnel's own fields persist; over-cap optionals and unknown keys are
 *     silently dropped without failing the submission
 *
 * App Check is not enforced by the emulator, so these are drivable here.
 *
 * RUN:
 *   firebase emulators:exec --only functions,firestore --project demo-nbd-pl \
 *     'node tests/public-intake.test.js'
 */
'use strict';

const PROJECT = process.env.GCLOUD_PROJECT || 'demo-nbd-pl';
const FN_HOST = process.env.FUNCTIONS_EMULATOR_HOST || '127.0.0.1:5001';
const URL = `http://${FN_HOST}/${PROJECT}/us-central1/submitPublicLead`;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('✗ emulator env not set — run via emulators:exec --only functions,firestore');
  process.exit(1);
}

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

async function post(payload) {
  const res = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
}

// Read a written doc straight off the Firestore emulator REST surface so the
// optional-field assertions need no admin SDK. `Bearer owner` is the
// emulator's documented admin bypass — without it the REST read is subject
// to security rules, which (correctly) deny public reads of lead docs.
// Returns the `fields` map ({ key: { stringValue } }) or null when missing.
async function fetchDoc(collection, id) {
  const res = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${id}`,
    { headers: { Authorization: 'Bearer owner' } }
  );
  if (!res.ok) return null;
  const json = await res.json();
  return (json && json.fields) || null;
}
function str(fields, key) { return fields && fields[key] && fields[key].stringValue; }

async function run() {
  console.log('PUBLIC LEAD INTAKE — submitPublicLead validation gateway');

  // method
  const get = await fetch(URL, { method: 'GET' });
  ok('GET → 405 (POST only)', get.status === 405);

  // kind enumeration
  ok('missing kind → 400', (await post({ name: 'x' })).status === 400);
  ok('unknown kind → 400', (await post({ kind: 'totally-not-a-kind', name: 'x' })).status === 400);

  // required-field enforcement (guide requires name, email, source)
  ok('guide missing email → 400', (await post({ kind: 'guide', name: 'Jane', source: 'website' })).status === 400);
  ok('guide missing source → 400', (await post({ kind: 'guide', name: 'Jane', email: 'j@x.com' })).status === 400);

  // maxLen enforcement (guide name maxLen 200)
  ok('guide name over maxLen(200) → 400',
    (await post({ kind: 'guide', name: 'x'.repeat(201), email: 'j@x.com', source: 'website' })).status === 400);
  // contact phone maxLen 30
  ok('contact phone over maxLen(30) → 400',
    (await post({ kind: 'contact', firstName: 'Jo', phone: '1'.repeat(31), source: 'web' })).status === 400);

  // exact-length enforcement (storm zip must be exactly 5)
  ok('storm zip != 5 chars → 400',
    (await post({ kind: 'storm', name: 'Jo', phone: '5550100', zip: '1234', source: 'web' })).status === 400);

  // honeypot — 'website' filled → silent 200, no lead written
  {
    const r = await post({ kind: 'guide', name: 'Bot', email: 'b@x.com', source: 'web', website: 'http://spam.example' });
    ok('honeypot tripped → 200 silent success', r.status === 200 && r.body && r.body.success === true);
  }

  // a fully valid submission passes every validation guard and reaches the write
  // (now 200 — the write uses the modular FieldValue import so it succeeds under
  // the emulator; the signal here is that it is NOT rejected by validation).
  {
    const r = await post({ kind: 'guide', name: 'Jane Real', email: 'jane@example.com', source: 'website' });
    ok(`valid submission passes validation (not 4xx; got ${r.status})`, ![400, 405].includes(r.status));
  }
  // valid storm with exact 5-digit zip also passes validation
  {
    const r = await post({ kind: 'storm', name: 'Jo', phone: '5550100', zip: '78704', source: 'web' });
    ok(`valid storm (zip 5) passes validation (not 4xx; got ${r.status})`, ![400, 405].includes(r.status));
  }

  // ── estimate optional allowlist (M-04 bounded expansion) ──
  // The /estimate funnel posts its own contact + selection fields, event tags
  // (type/requestType), and the preformatted estimateSummary alongside the
  // required [address, source]. Allowlisted optionals persist on the written
  // doc; keys outside the allowlist are still silently dropped.
  {
    const r = await post({
      kind: 'estimate', address: '123 Main St, Union KY', source: '/estimate',
      firstName: 'Jane', lastName: 'Doe', phone: '8595550100', email: 'jane@example.com',
      service: 'Roof Replacement', roofType: 'asphalt', timeline: 'asap',
      type: 'email_estimate_request', requestType: 'instant_estimate',
      estimateSummary: 'Roof Replacement — Asphalt\nEstimated range: $12,400 – $15,800',
      leadScore: '100', assignedTo: 'attacker' // NOT allowlisted → must be dropped
    });
    ok(`estimate with funnel optionals passes validation (not 4xx; got ${r.status})`, ![400, 405].includes(r.status));
    const fields = (r.body && r.body.id) ? await fetchDoc('estimate_leads', r.body.id) : null;
    ok('estimate doc written + readable from emulator', !!fields);
    ok('estimate optional firstName persisted', str(fields, 'firstName') === 'Jane');
    ok('estimate optional lastName persisted', str(fields, 'lastName') === 'Doe');
    ok('estimate optional phone persisted', str(fields, 'phone') === '8595550100');
    ok('estimate optional email persisted', str(fields, 'email') === 'jane@example.com');
    ok('estimate optional service persisted', str(fields, 'service') === 'Roof Replacement');
    ok('estimate optional roofType persisted', str(fields, 'roofType') === 'asphalt');
    ok('estimate optional timeline persisted', str(fields, 'timeline') === 'asap');
    ok('estimate optional type persisted', str(fields, 'type') === 'email_estimate_request');
    ok('estimate optional requestType persisted', str(fields, 'requestType') === 'instant_estimate');
    ok('estimate optional estimateSummary persisted', (str(fields, 'estimateSummary') || '').startsWith('Roof Replacement'));
    ok('unknown key leadScore still dropped', !(fields && fields.leadScore));
    ok('unknown key assignedTo still dropped', !(fields && fields.assignedTo));
  }
  // over-cap optionals are dropped, NOT 400 — an optional field must never
  // fail an otherwise-valid submission. In-cap optionals on the same submit
  // still persist.
  {
    const r = await post({
      kind: 'estimate', address: '456 Oak Ave', source: '/estimate',
      roofType: 'x'.repeat(51),          // maxLen 50 → dropped
      estimateSummary: 'y'.repeat(2001), // maxLen 2000 → dropped
      phone: '1'.repeat(31),             // maxLen 30 → dropped
      email: 'still-ok@example.com'
    });
    ok(`estimate with over-cap optionals still succeeds (not 4xx; got ${r.status})`, ![400, 405].includes(r.status));
    const fields = (r.body && r.body.id) ? await fetchDoc('estimate_leads', r.body.id) : null;
    ok('over-cap roofType (51) dropped', !!fields && !fields.roofType);
    ok('over-cap estimateSummary (2001) dropped', !!fields && !fields.estimateSummary);
    ok('over-cap phone (31) dropped', !!fields && !fields.phone);
    ok('in-cap email kept alongside dropped over-caps', str(fields, 'email') === 'still-ok@example.com');
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('✓ All public-intake tests passed');
}

run().then(() => process.exit(0)).catch(e => { console.error('public-intake test crashed:', e && (e.stack || e.message)); process.exit(1); });
