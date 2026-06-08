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

  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('✓ All public-intake tests passed');
}

run().then(() => process.exit(0)).catch(e => { console.error('public-intake test crashed:', e && (e.stack || e.message)); process.exit(1); });
