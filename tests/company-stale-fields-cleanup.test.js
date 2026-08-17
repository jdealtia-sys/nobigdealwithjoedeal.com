/**
 * tests/company-stale-fields-cleanup.test.js — companies/{id} stale-field cleanup.
 *
 * Unit-tests the pure core of scripts/cleanup-company-stale-fields.js: which docs
 * get picked up (planCleanup) and what patch is built for them (buildPatch). The
 * Firestore I/O around it is a thin loop; the DANGEROUS part — "exactly which
 * fields can ever appear in a write against a live company doc" — is here.
 *
 * Why this file exists: the script this replaces (functions/seed-companies.js,
 * deleted in #1236) wrote companies/{id} with a whole-doc set() and no
 * {merge:true}, which silently stripped ownerId — disabling the owner-demotion
 * guards in handlers/admin.js — and siteSlug, orphaning the siteSlugs/{slug}
 * claim doc. These assertions pin the replacement to a field-level patch so that
 * failure mode cannot come back.
 *
 * Zero deps (pure functions + a source-shape guard).
 * Run: node tests/company-stale-fields-cleanup.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  STALE_FIELDS, planCleanup, buildPatch, parseOnly,
} = require('../scripts/cleanup-company-stale-fields');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name); }
}

const DEL = Symbol('FieldValue.delete()');

// A legacy seeded doc (both stale fields) alongside the modern fields that must
// survive, plus a doc that predates siteSlug, plus a fully clean modern doc.
const DOCS = [
  { id: 'nbd', data: {
    name: 'No Big Deal Home Solutions', siteUrl: '/sites/nbd.html',
    subscription: { plan: 'growth', status: 'active' },
    ownerId: 'uid-joe', status: 'active', siteSlug: 'nbd-roofing',
    siteSlugUpdatedAt: 'TS', plan: 'growth', colors: { primary: '#0066cc' },
  } },
  { id: 'oaks', data: {
    name: 'Oaks Roofing & Construction', siteUrl: '/sites/oaks.html',
    subscription: { plan: 'growth', status: 'active' }, ownerId: 'uid-scott',
  } },
  { id: 'partial', data: { name: 'Only siteUrl', siteUrl: '/sites/x.html', ownerId: 'uid-p' } },
  { id: 'modern', data: { name: 'Clean', ownerId: 'uid-x', status: 'active', siteSlug: 'clean' } },
];

console.log('STALE_FIELDS — the allowlist itself');
ok('is exactly [siteUrl, subscription]', STALE_FIELDS.join(',') === 'siteUrl,subscription');

console.log('\nplanCleanup — selection');
{
  const { planned, skipped } = planCleanup(DOCS, null);
  ok('picks up only docs carrying a stale field', planned.map((p) => p.id).sort().join(',') === 'nbd,oaks,partial');
  ok('counts the clean doc as skipped', skipped === 1);
  ok('a clean doc is never planned', !planned.some((p) => p.id === 'modern'));
  const nbd = planned.find((p) => p.id === 'nbd');
  ok('records both stale fields when both present', nbd.present.sort().join(',') === 'siteUrl,subscription');
  const partial = planned.find((p) => p.id === 'partial');
  ok('records only the field actually present', partial.present.join(',') === 'siteUrl');
  ok('carries a display name through', nbd.name === 'No Big Deal Home Solutions');
}

console.log('\nplanCleanup — idempotency (the re-run case)');
{
  // Simulate the post-cleanup world: fields already gone.
  const after = DOCS.map((d) => {
    const data = { ...d.data };
    for (const f of STALE_FIELDS) delete data[f];
    return { id: d.id, data };
  });
  const { planned, skipped } = planCleanup(after, null);
  ok('second run plans nothing', planned.length === 0);
  ok('second run skips every doc', skipped === after.length);
}

console.log('\nplanCleanup — --only filter');
{
  const { planned } = planCleanup(DOCS, new Set(['oaks']));
  ok('restricts to the named id', planned.length === 1 && planned[0].id === 'oaks');
  const none = planCleanup(DOCS, new Set(['does-not-exist']));
  ok('unknown id plans nothing', none.planned.length === 0);
}

console.log('\nbuildPatch — THE safety property');
{
  const patch = buildPatch(['siteUrl', 'subscription'], DEL);
  ok('patch keys are exactly the stale fields', Object.keys(patch).sort().join(',') === 'siteUrl,subscription');
  ok('every value is the delete sentinel', Object.values(patch).every((v) => v === DEL));
  const partial = buildPatch(['siteUrl'], DEL);
  ok('absent field is not in the patch', !('subscription' in partial));
  ok('patch for one field has exactly one key', Object.keys(partial).length === 1);
}
{
  // Belt-and-braces: even if a caller passed a field outside the allowlist,
  // it must never reach the patch — this is what stops the write widening
  // into ownerId/siteSlug territory.
  const patch = buildPatch(['siteUrl', 'ownerId', 'siteSlug', 'status'], DEL);
  ok('non-allowlisted fields are dropped from the patch',
    Object.keys(patch).join(',') === 'siteUrl');
  ok('ownerId can never be patched', !('ownerId' in patch));
  ok('siteSlug can never be patched', !('siteSlug' in patch));
}

console.log('\nparseOnly — argv');
ok('absent flag → null (all docs)', parseOnly(['node', 'x', '--write']) === null);
ok('parses a single id', [...parseOnly(['--only=oaks'])].join(',') === 'oaks');
ok('parses a comma list + trims', [...parseOnly(['--only=a, b ,c'])].join(',') === 'a,b,c');
ok('empty value → null, not an empty allowlist', parseOnly(['--only=']) === null);

console.log('\nsource shape — update(), never set()');
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'cleanup-company-stale-fields.js'), 'utf8');
  const code = src.replace(/^\s*\*.*$/gm, '').replace(/\/\/.*$/gm, ''); // strip comments
  ok('calls .update( on the company doc', /\.doc\([^)]*\)\.update\(/.test(code));
  ok('never calls .set( anywhere in code', !/\.set\(/.test(code));
  ok('uses FieldValue.delete() as the sentinel', /FieldValue\.delete\(\)/.test(code));
  ok('pins an explicit projectId (no ambient-project write)', /initializeApp\(\{\s*projectId/.test(code));
  ok('dry run is the default (write is opt-in via --write)', /includes\('--write'\)/.test(code));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
