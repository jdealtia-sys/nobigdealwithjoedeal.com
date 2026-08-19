/**
 * tests/microsite-publication-gate.test.js — tenant microsites are PRIVATE
 * until deliberately released (Jo, 2026-08-17).
 *
 * getPublicSiteConfig used to treat an absent `companies/{id}.status` as
 * "serve", so /sites/t/<id> answered 200 with a partner's name, phone, email
 * and address to anyone who guessed the id — and the ids are short words
 * ('oaks', 'nbd'), not the unguessable auth uids the handler's header assumes.
 * X-Robots-Tag noindex kept those pages out of search results but never made
 * them private. The gate now fails CLOSED: only status:'active' is published.
 *
 * The second half of this file is the one that actually matters long-term.
 * The publication gate is deliberately NOT inside resolveCompanyByKey, because
 * that resolver is shared with submitPublicLead's lead tagging
 * (functions/handlers/integrations.js). Folding the two together would untag a
 * real-but-unpublished tenant's inbound leads and misroute them to the default
 * pipeline — the exact P1 HIGH bug the 2026-07 tenant-lifecycle audit fixed.
 * These tests fail if someone "simplifies" them back into one check.
 *
 * Pure string/vm tests — no emulator, no firebase-admin. Run:
 *   node tests/microsite-publication-gate.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'functions/handlers/public-site.js'), 'utf8');

// ── extract the pure gate without loading firebase deps ──
const gateSrc = SRC.match(/function isPublishedCompany\s*\([\s\S]*?\n\}/);
ok('isPublishedCompany exists in public-site.js', !!gateSrc);
if (!gateSrc) { console.log('\n  FATAL: gate function not found\n'); process.exit(1); }

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(gateSrc[0] + '\nthis.isPublishedCompany = isPublishedCompany;', sandbox);
const isPublished = sandbox.isPublishedCompany;

console.log('\nPublication gate — only an explicit active publishes');
ok("status 'active' → published", isPublished({ status: 'active' }) === true);

console.log('\nFail CLOSED — anything else is unpublished');
ok('status ABSENT → NOT published (the whole point)', isPublished({ name: 'Some Co' }) === false);
ok('empty doc → NOT published', isPublished({}) === false);
ok('undefined doc → NOT published', isPublished(undefined) === false);
ok('null doc → NOT published', isPublished(null) === false);
ok("status '' → NOT published", isPublished({ status: '' }) === false);
ok("status null → NOT published", isPublished({ status: null }) === false);
ok("'superseded-by-invite' → NOT published", isPublished({ status: 'superseded-by-invite' }) === false);
ok("'deactivated' → NOT published", isPublished({ status: 'deactivated' }) === false);
ok("'suspended' → NOT published", isPublished({ status: 'suspended' }) === false);
// Case/whitespace must not sneak past: 'Active' is not a release.
ok("'Active' (wrong case) → NOT published", isPublished({ status: 'Active' }) === false);
ok("' active ' (padded) → NOT published", isPublished({ status: ' active ' }) === false);
ok('truthy non-string status → NOT published', isPublished({ status: 1 }) === false);

console.log('\nThe endpoint actually applies the gate');
const endpoint = SRC.slice(SRC.indexOf('exports.getPublicSiteConfig'));
ok('getPublicSiteConfig calls isPublishedCompany', /isPublishedCompany\s*\(/.test(endpoint));
ok('gate 404s rather than serving',
  /if\s*\(\s*!isPublishedCompany\([\s\S]{0,200}?res\.status\(404\)/.test(endpoint));
// An unreleased partner's EXISTENCE must not leak through the error channel:
// the gate's 404 has to be indistinguishable from an unknown-key 404.
const gateReason = endpoint.match(/if\s*\(\s*!isPublishedCompany\([\s\S]{0,240}?reason:\s*'([a-z_]+)'/);
ok("gate 404 reuses the opaque 'not_found' reason (no exists-but-unreleased tell)",
  !!gateReason && gateReason[1] === 'not_found');

console.log('\nLead tagging stays UNGATED — resolveCompanyByKey must not fail closed');
const resolver = SRC.slice(
  SRC.indexOf('async function resolveCompanyByKey'),
  SRC.indexOf('function isPublishedCompany'));
ok('resolveCompanyByKey found', resolver.length > 0);
// Permissive form: only a status that is SET and not active rejects. An absent
// status must still resolve, so a real tenant's leads keep routing to them.
ok('resolver keeps the permissive absent-status-still-resolves form',
  /co\.status\s*&&\s*co\.status\s*!==\s*'active'/.test(resolver));
ok('resolver does NOT call the publication gate (would misroute tenant leads)',
  !/isPublishedCompany/.test(resolver));

console.log('\nContract surface');
ok('isPublishedCompany exported for reuse', /exports\.isPublishedCompany\s*=/.test(SRC));
ok('isPublishedCompany exposed on _test', /_test\s*=\s*\{[^}]*isPublishedCompany/.test(SRC));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log('Failures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
