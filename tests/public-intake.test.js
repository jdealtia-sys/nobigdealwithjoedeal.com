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
 *   - honeypot ('nbd_hp' or legacy 'website' filled) → 200 silent success, no write
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

// Seed a doc through the same REST surface (same `Bearer owner` bypass) so
// the siteKey-resolution cases can plant companies/{uid} fixtures without
// the admin SDK.
async function seedDoc(collection, id, fields) {
  const body = { fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, { stringValue: String(v) }])) };
  const res = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${collection}/${id}`,
    { method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`seed ${collection}/${id} failed: ${res.status}`);
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

  // honeypot — legacy 'website' key filled → silent 200, no lead written
  // (old cached pages / bots replaying the pre-2026-08-05 form shape)
  {
    const r = await post({ kind: 'guide', name: 'Bot', email: 'b@x.com', source: 'web', website: 'http://spam.example' });
    ok('legacy honeypot (website) tripped → 200 silent success', r.status === 200 && r.body && r.body.success === true);
  }

  // honeypot — live 'nbd_hp' key filled → same silent 200. Renamed from
  // 'website' (audit P6): that name matches browser URL-autofill heuristics,
  // so autofill could fill the honeypot on a REAL form and silently drop the
  // lead. Naive bots still fill every field, so the trap keeps working.
  {
    const r = await post({ kind: 'guide', name: 'Bot2', email: 'b2@x.com', source: 'web', nbd_hp: 'anything' });
    ok('live honeypot (nbd_hp) tripped → 200 silent success', r.status === 200 && r.body && r.body.success === true);
  }
  // non-string truthy nbd_hp trips too (same class the website check hardened against)
  {
    const r = await post({ kind: 'guide', name: 'Bot3', email: 'b3@x.com', source: 'web', nbd_hp: true });
    ok('live honeypot (nbd_hp non-string) tripped → 200 silent success', r.status === 200 && r.body && r.body.success === true);
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
      referralCode: 'JANE-CD34', // shared optional (self-redemption) — must persist
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
    ok('estimate optional referralCode persisted (self-redemption)', str(fields, 'referralCode') === 'JANE-CD34');
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

  // ── siteKey tenant tagging (P5 indirection, 2026-08-06) ──
  // The tenant microsite tags leads with its public siteKey (slug when
  // configured); the gateway resolves it server-side via the SAME resolver
  // as /api/site-config and persists the RESOLVED id — never the client
  // string. Legacy client-supplied companyId keeps working (cached pages),
  // but a resolved siteKey wins when both arrive.
  {
    const TENANT = 'T3stTenantUidAA1';
    const OTHER = 'Oth3rTenantUidB2';
    const GONE = 'Susp3ndedUidCC3';
    await seedDoc('companies', TENANT, { name: 'Sunny Roofing', siteSlug: 'sunny-roofing', status: 'active' });
    await seedDoc('companies', OTHER, { name: 'Other Roofing', status: 'active' });
    await seedDoc('companies', GONE, { name: 'Gone Roofing', siteSlug: 'gone-roofing', status: 'suspended' });

    const lead = (extra) => Object.assign(
      { kind: 'contact', firstName: 'Pat', phone: '5550166', source: 'tenant-site:test' }, extra);

    // slug resolves → lead tagged with the RESOLVED uid; siteKey never persists raw
    {
      const r = await post(lead({ siteKey: 'sunny-roofing' }));
      const fields = (r.body && r.body.id) ? await fetchDoc('contact_leads', r.body.id) : null;
      ok('siteKey slug resolves → lead tagged with resolved uid', str(fields, 'companyId') === TENANT);
      ok('siteKey itself never persisted on the lead doc', !!fields && !fields.siteKey);
    }
    // uid-as-key still resolves (slug-less tenants are reachable only by uid URL)
    {
      const r = await post(lead({ siteKey: OTHER }));
      const fields = (r.body && r.body.id) ? await fetchDoc('contact_leads', r.body.id) : null;
      ok('siteKey uid form resolves for a slug-less tenant', str(fields, 'companyId') === OTHER);
    }
    // unknown key → tag dropped, lead still lands (tagging must never lose a lead)
    {
      const r = await post(lead({ siteKey: 'no-such-tenant' }));
      ok(`unknown siteKey still succeeds (not 4xx; got ${r.status})`, ![400, 405].includes(r.status));
      const fields = (r.body && r.body.id) ? await fetchDoc('contact_leads', r.body.id) : null;
      ok('unknown siteKey → untagged (no companyId)', !!fields && !fields.companyId);
    }
    // suspended tenant stops resolving — strictly harder than the legacy
    // companyId path, which only checks existence
    {
      const r = await post(lead({ siteKey: 'gone-roofing' }));
      const fields = (r.body && r.body.id) ? await fetchDoc('contact_leads', r.body.id) : null;
      ok('suspended tenant siteKey → untagged', !!fields && !fields.companyId);
    }
    // both keys (cache-skew window): the server-resolved siteKey wins
    {
      const r = await post(lead({ siteKey: 'sunny-roofing', companyId: OTHER }));
      const fields = (r.body && r.body.id) ? await fetchDoc('contact_leads', r.body.id) : null;
      ok('siteKey wins over legacy client companyId when both arrive', str(fields, 'companyId') === TENANT);
    }
    // legacy companyId-only path unchanged (cached pre-P5 pages)
    {
      const r = await post(lead({ companyId: TENANT }));
      const fields = (r.body && r.body.id) ? await fetchDoc('contact_leads', r.body.id) : null;
      ok('legacy companyId-only tagging still works (compat pin)', str(fields, 'companyId') === TENANT);
    }
  }

  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('✓ All public-intake tests passed');
}

run().then(() => process.exit(0)).catch(e => { console.error('public-intake test crashed:', e && (e.stack || e.message)); process.exit(1); });
