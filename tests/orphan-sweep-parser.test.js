/**
 * tests/orphan-sweep-parser.test.js
 *
 * Guards the path parser in scripts/sweep-orphan-lead-artifacts.js.
 *
 * That parser decides which Storage objects are eligible for deletion: it
 * recovers a leadId from an object path, and the sweep deletes the object when
 * Firestore says that lead is gone. The two failure modes are not symmetric:
 *
 *   • FALSE NEGATIVE — a real orphan whose shape isn't recognised. Costs a
 *     manual review. This is how the original leak hid: two objects sat at a
 *     path shape purge-legacy-storage-portals.js didn't match.
 *   • FALSE POSITIVE — a filename parsed AS a leadId. `docs/{uid}/{file}` is a
 *     real flat shape, so `docs/UID/1700_contract.pdf` would yield leadId
 *     "1700_contract.pdf", find no such lead, and delete a customer's signed
 *     contract as an "orphan".
 *
 * So the parser refuses anything ambiguous: flat shapes are accepted only for
 * the prefixes that actually had one, and a leadId candidate must look like a
 * Firestore auto-ID. Everything else is reported for human review, never acted
 * on. These cases pin both directions.
 *
 * Pure-Node, no emulator. Run: node tests/orphan-sweep-parser.test.js
 */
'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');
const { parseObjectPath, LEAD_KEYED_PREFIXES } =
  require(path.join(ROOT, 'scripts', 'sweep-orphan-lead-artifacts.js'));

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; fails.push(label); }
}

// Real ids from the 2026-08-18 prod sweep — 20-char Firestore auto-IDs.
const GONE_A = 'HWfAcHhMJ03iZPKabVHi';
const GONE_B = 'W5VbLJAeFXoGPCku93yf';
const GONE_C = 'JoKt4d0yJeF51MTmjaJh';
const GONE_D = 'pptQX1KZWSXYBs7oTTMO';

console.log('\nRESOLVES — real lead-keyed shapes must be sweepable');
[
  ['documents dir (docgen)', `documents/UID1/${GONE_A}/d-1755000000-a1b2c3.html`, GONE_A],
  ['documents dir (signed archive)', `documents/UID1/${GONE_A}/d-1.original-1755.html`, GONE_A],
  ['portals versioned dir', `portals/UID1/${GONE_B}/v-1755000000.html`, GONE_B],
  ['portals flat legacy', `portals/UID1/${GONE_C}.html`, GONE_C],
  ['portals flat photo portal', `portals/UID1/${GONE_C}-photos.html`, GONE_C],
  ['galleries flat legacy', `galleries/UID1/${GONE_C}.html`, GONE_C],
  ['audio recording', `audio/UID1/${GONE_D}/rec-1.webm`, GONE_D],
  ['docs lead-scoped upload', `docs/UID1/${GONE_D}/1755_signed.pdf`, GONE_D],
  // photos/ joined the map 2026-09-03. The leadId-keyed shape carries the id
  // in a whole path segment, so originals, thumbs and variants all parse.
  ['photos original', `photos/UID1/${GONE_A}/1755000000_IMG_0001.jpg`, GONE_A],
  ['photos thumb', `photos/UID1/${GONE_A}/thumbs/abc_thumb.jpg`, GONE_A],
  ['photos variant', `photos/UID1/${GONE_A}/_variants/IMG_0001_full.webp`, GONE_A],
  ['deeply nested under a lead', `documents/UID1/${GONE_A}/sub/dir/x.html`, GONE_A],
].forEach(([label, p, want]) => {
  const got = parseObjectPath(p);
  ok(label + ' → ' + want, !!got && got.leadId === want);
});

console.log('\nREFUSES — anything that would delete a live file must not parse');
[
  // The exact false positive: docs/ is legitimately {uid}/{file}.
  ['flat docs/ upload is not a leadId', 'docs/UID1/1755000000_signed_contract.pdf'],
  ['flat docs/ short name', 'docs/UID1/scope.pdf'],
  ['flat docs/ html is still a filename', 'docs/UID1/notes.html'],
  // portals/ HAS a flat shape, but only for things shaped like an id.
  ['portals flat with a filename, not an id', 'portals/UID1/summary.html'],
  ['portals flat with a short token', 'portals/UID1/abc.html'],
  // Prefixes outside the map must never be swept.
  // photos/ IS in the map now, but only its directory shape. These three are
  // the ways a photo path can look lead-keyed without being it — each would
  // delete a live file if the parser guessed.
  ['photos flat legacy shape is a filename, not a leadId', 'photos/UID1/1755_IMG_0001.jpg'],
  ['photos d2d knock is knockId-keyed, not leadId-keyed', 'photos/UID1/d2d/KNOCK1234567890AB/1755_x.jpg'],
  ['photos uid-wide _variants dir is not a leadId', 'photos/UID1/_variants/IMG_0001_full.webp'],
  ['reports/ is not lead-keyed', 'reports/UID1/inspection.pdf'],
  ['receipts/ is not in the map', `receipts/UID1/${GONE_A}/r.jpg`],
  ['deal_rooms/ is dealId-keyed', 'deal_rooms/UID1/DEALID1234567890AB.html'],
  // Structurally incomplete.
  ['prefix + uid only', 'documents/UID1'],
  ['prefix only', 'documents'],
  ['empty uid segment', `documents//${GONE_A}/x.html`],
  // Implausible id in directory position.
  ['too-short dir segment', 'documents/UID1/tmp/x.html'],
].forEach(([label, p]) => {
  ok(label, parseObjectPath(p) === null);
});

console.log('\nLOCKSTEP — sweep prefixes must match the delete trigger');
{
  // If a new leadId-keyed prefix is added to the trigger but not here, the
  // trigger reaps it going forward while the sweep stays blind to the backlog
  // — which is precisely how these orphans accumulated unnoticed.
  const fs = require('fs');
  const trigSrc = fs.readFileSync(
    path.join(ROOT, 'functions', 'lead-artifact-cleanup.js'), 'utf8');
  const block = trigSrc.match(/const LEAD_KEYED_PREFIXES = \[([\s\S]*?)\n\];/);
  ok('trigger declares LEAD_KEYED_PREFIXES', !!block);
  const trigPrefixes = block
    ? [...block[1].matchAll(/prefix:\s*'([^']+)'/g)].map((m) => m[1])
    : [];
  ok('trigger prefixes are non-empty', trigPrefixes.length > 0);
  const sweepPrefixes = Object.keys(LEAD_KEYED_PREFIXES);
  const missing = trigPrefixes.filter((p) => !sweepPrefixes.includes(p));
  ok('every trigger prefix is also swept (missing: ' + (missing.join(', ') || 'none') + ')',
     missing.length === 0);

  // ...and the REVERSE. This assertion is here because its absence let a real
  // drift sit unnoticed: `docs` was swept but never reaped, so from the day it
  // was added every hard delete quietly handed the sweep script a fresh
  // backlog instead of cleaning up after itself. One-directional lockstep is
  // half a gate — it only catches the drift you thought of first.
  const unreaped = sweepPrefixes.filter((p) => !trigPrefixes.includes(p));
  ok('every swept prefix is also reaped by the trigger (unreaped: '
     + (unreaped.join(', ') || 'none') + ')', unreaped.length === 0);
}

console.log('\nNO SIDE EFFECTS — requiring the script must not start a sweep');
ok('module export is the parser, not a running sweep', typeof parseObjectPath === 'function');

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
