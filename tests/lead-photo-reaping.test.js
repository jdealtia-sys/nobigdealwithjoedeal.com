/**
 * tests/lead-photo-reaping.test.js
 *
 * Guards the photo half of functions/lead-artifact-cleanup.js (added 2026-09-03).
 *
 * WHY THIS EXISTS
 * ───────────────
 * Until 2026-09-03 the trigger skipped `photos/` entirely, on a docblock
 * premise that was wrong twice over: photos were said to be flat per-uid (the
 * dominant shape is `photos/{uid}/{leadId}/...`, which reaps by prefix) and to
 * carry no permanent download token (image-pipeline.js stamps a fresh
 * `firebaseStorageDownloadTokens` on every variant it writes). The result was
 * that hard-deleting a lead left its whole photo set publicly fetchable, with
 * the only record of it gone.
 *
 * The two things worth pinning are not the happy path:
 *
 *   • CONFINEMENT is the security boundary. Photo paths come off /photos docs,
 *     which are CLIENT-WRITTEN. If the trigger trusted a photo doc's own
 *     userId, anyone could plant a doc naming a victim's object, hard-delete
 *     their own lead, and have the trigger delete someone else's file with
 *     admin credentials. The uid set must come from the LEAD.
 *   • VARIANT DERIVATION is the only way flat-shape variants can be reached.
 *     They live in `photos/{uid}/_variants/`, shared across every lead of that
 *     uid, so the directory can never be prefix-deleted — each name has to be
 *     derived, and a wrong derivation silently leaves the leak open.
 *
 * Pure-Node, no emulator. Run: node tests/lead-photo-reaping.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// The pure helpers come from lead-artifact-paths.js, NOT the trigger: the
// trigger is mounted into functions/index.js with Object.assign, so exporting
// test helpers from it would put scaffolding on the deployed function surface
// (a smoke assertion enforces that, and caught exactly this).
const {
  variantPathsFor,
  isReapablePhotoPath,
  VARIANT_SUFFIXES,
} = require(path.join(ROOT, 'functions', 'lead-artifact-paths.js'));

// The prefix list stays inside the trigger (orphan-sweep-parser.test.js pins it
// there by source too), so read it the same way rather than exporting it.
const TRIGGER_SRC = fs.readFileSync(
  path.join(ROOT, 'functions', 'lead-artifact-cleanup.js'), 'utf8');
const LEAD_KEYED_PREFIXES = (() => {
  const block = TRIGGER_SRC.match(/const LEAD_KEYED_PREFIXES = \[([\s\S]*?)\n\];/);
  if (!block) return [];
  return [...block[1].matchAll(/prefix:\s*'([^']+)'/g)].map((m) => ({
    prefix: m[1],
    // `flat: []` vs `flat: ['.html', ...]` — an empty array is the safe shape
    // for a prefix whose third segment can be a filename.
    flat: (block[1].match(
      new RegExp("prefix:\\s*'" + m[1] + "',\\s*flat:\\s*\\[([^\\]]*)\\]")) || [, ''])[1]
      .split(',').map((s) => s.trim()).filter(Boolean),
  }));
})();

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; fails.push(label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Realistic ids: 20-char Firestore auto-IDs and Firebase-shaped uids.
const UID = 'kQ3nR8vTzWxYb2mLpJ7c';
const OTHER_UID = 'zZ9aB1cD2eF3gH4iJ5kL';
const LEAD = 'HWfAcHhMJ03iZPKabVHi';

console.log('\nDRIFT — the copied variant names must match image-pipeline.js');
{
  // VARIANT_SUFFIXES is deliberately duplicated rather than imported:
  // requiring image-pipeline.js evaluates its onObjectFinalized registration
  // at module scope, which throws without FIREBASE_CONFIG. So the copy is
  // pinned against that file's SOURCE instead. If someone adds an 'xl'
  // variant, the reaper would leave one orphan per photo behind forever —
  // this is the assertion that stops that.
  const src = fs.readFileSync(path.join(ROOT, 'functions', 'image-pipeline.js'), 'utf8');
  const block = src.match(/const VARIANTS = \[([\s\S]*?)\n\];/);
  ok('image-pipeline declares VARIANTS', !!block);
  const names = block ? [...block[1].matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]) : [];
  ok('parsed some variant names from source', names.length > 0);
  ok('VARIANT_SUFFIXES matches image-pipeline VARIANTS (' + names.join(',') + ')',
     eq([...VARIANT_SUFFIXES].sort(), [...names].sort()));
}

console.log('\nPREFIXES — photos/ and docs/ must be reaped by prefix');
{
  const prefixes = LEAD_KEYED_PREFIXES.map((p) => p.prefix);
  ok('photos is a reaped prefix', prefixes.includes('photos'));
  ok('docs is a reaped prefix', prefixes.includes('docs'));
  // A `flat` suffix on photos would make the trigger delete
  // `photos/{uid}/{leadId}<suffix>` — but the flat photo shape is
  // `photos/{uid}/{filename}`, so any flat entry here would be parsing a
  // filename as a leadId. It must stay empty.
  const photos = LEAD_KEYED_PREFIXES.find((p) => p.prefix === 'photos');
  ok('photos has no flat suffixes (a filename is never a leadId)',
     Array.isArray(photos.flat) && photos.flat.length === 0);
  const docs = LEAD_KEYED_PREFIXES.find((p) => p.prefix === 'docs');
  ok('docs has no flat suffixes', Array.isArray(docs.flat) && docs.flat.length === 0);
  // Vacuity guard: the two assertions above are only meaningful if the parser
  // above can actually SEE a flat list. portals has one, so if this goes red
  // the "no flat suffixes" checks are passing on a parse failure, not on fact.
  const portals = LEAD_KEYED_PREFIXES.find((p) => p.prefix === 'portals');
  ok('portals DOES parse its flat suffixes (proves the parse works)',
     !!portals && portals.flat.length === 2);
}

console.log('\nVARIANTS — derived names must match where the pipeline writes them');
{
  // Flat shape: the shared uid-wide _variants dir.
  ok('flat photo derives all three variants', eq(
    variantPathsFor(`photos/${UID}/1755000000_IMG_0001.jpg`),
    [
      `photos/${UID}/_variants/1755000000_IMG_0001_thumb.webp`,
      `photos/${UID}/_variants/1755000000_IMG_0001_med.webp`,
      `photos/${UID}/_variants/1755000000_IMG_0001_full.webp`,
    ]));
  // Nested shape: variants sit under the leadId dir, so the prefix sweep also
  // covers them — deriving them anyway is harmless and keeps the two paths
  // consistent.
  ok('nested photo derives variants under the leadId dir', eq(
    variantPathsFor(`photos/${UID}/${LEAD}/1755_a.jpg`),
    [
      `photos/${UID}/${LEAD}/_variants/1755_a_thumb.webp`,
      `photos/${UID}/${LEAD}/_variants/1755_a_med.webp`,
      `photos/${UID}/${LEAD}/_variants/1755_a_full.webp`,
    ]));
  ok('extension is stripped, not just .jpg', eq(
    variantPathsFor(`photos/${UID}/x.HEIC`)[0],
    `photos/${UID}/_variants/x_thumb.webp`));
  ok('a name with dots keeps everything but the last segment', eq(
    variantPathsFor(`photos/${UID}/roof.front.left.jpg`)[0],
    `photos/${UID}/_variants/roof.front.left_thumb.webp`));

  console.log('  -- refusals (a wrong derivation deletes the wrong object) --');
  ok('no directory -> no guesses', eq(variantPathsFor('IMG_0001.jpg'), []));
  ok('empty string -> no guesses', eq(variantPathsFor(''), []));
  ok('non-string -> no guesses', eq(variantPathsFor(null), []));
  ok('dotfile with no base -> no guesses', eq(variantPathsFor(`photos/${UID}/.jpg`), []));
  ok('trailing slash has no base -> no guesses', eq(variantPathsFor(`photos/${UID}/`), []));
}

console.log('\nCONFINEMENT — the security boundary of the whole trigger');
{
  const owners = new Set([UID]);

  ok('own flat photo is reapable', isReapablePhotoPath(`photos/${UID}/a.jpg`, owners));
  ok('own nested photo is reapable', isReapablePhotoPath(`photos/${UID}/${LEAD}/a.jpg`, owners));
  ok('own thumb is reapable', isReapablePhotoPath(`photos/${UID}/${LEAD}/thumbs/a_thumb.jpg`, owners));
  ok('own variant is reapable', isReapablePhotoPath(`photos/${UID}/_variants/a_full.webp`, owners));
  ok('accepts an array of uids as well as a Set',
     isReapablePhotoPath(`photos/${UID}/a.jpg`, [UID]));
  ok('reaps under any one of several owner uids',
     isReapablePhotoPath(`photos/${OTHER_UID}/a.jpg`, new Set([UID, OTHER_UID])));

  console.log('  -- refusals --');
  // THE ATTACK: a /photos doc is client-written, so its storagePath can name
  // any object in the bucket. Only the lead's own uid may be reaped.
  ok('ANOTHER USER\'S photo is refused (the planted-storagePath attack)',
     !isReapablePhotoPath(`photos/${OTHER_UID}/private.jpg`, owners));
  // Prefix confusion: uid 'kQ3n...' must not authorise 'kQ3n...evil'.
  ok('a uid that merely PREFIXES the owner is refused',
     !isReapablePhotoPath(`photos/${UID}evil/x.jpg`, owners));
  ok('the uid segment must be complete (no bare concatenation)',
     !isReapablePhotoPath(`photos/${UID}x/${LEAD}/a.jpg`, owners));
  // D2D knocks outlive the leads they convert into.
  ok('a d2d knock object is refused even under the owner uid',
     !isReapablePhotoPath(`photos/${UID}/d2d/KNOCK1234567890AB/1755_x.jpg`, owners));
  ok('a d2d variant is refused too',
     !isReapablePhotoPath(`photos/${UID}/d2d/K1/_variants/x_full.webp`, owners));
  // Other prefixes are not this loop's business — they have their own sweeps,
  // and widening here would re-open the arbitrary-delete hole the documents
  // loop's confinement was written to close.
  ok('a non-photos prefix is refused', !isReapablePhotoPath(`documents/${UID}/${LEAD}/d.html`, owners));
  ok('an absolute-looking path is refused', !isReapablePhotoPath(`/photos/${UID}/a.jpg`, owners));
  ok('a traversal attempt is refused', !isReapablePhotoPath(`photos/../photos/${OTHER_UID}/a.jpg`, owners));
  ok('empty string is refused', !isReapablePhotoPath('', owners));
  ok('non-string is refused', !isReapablePhotoPath(null, owners));
  // No resolvable owner => reap NOTHING. Failing closed is the whole point:
  // an un-reaped orphan costs a sweep, a wrongly-reaped object costs a
  // customer's photos.
  ok('no owner uids -> nothing is reapable', !isReapablePhotoPath(`photos/${UID}/a.jpg`, new Set()));
  ok('a falsy uid in the set authorises nothing',
     !isReapablePhotoPath('photos//a.jpg', new Set([''])));
}

console.log('\nSOURCE — the helpers must stay firebase-free and off the deploy index');
{
  const pureSrc = fs.readFileSync(
    path.join(ROOT, 'functions', 'lead-artifact-paths.js'), 'utf8');
  // Importing image-pipeline.js for its VARIANTS would evaluate an
  // onObjectFinalized registration at module scope and throw without
  // FIREBASE_CONFIG — which is exactly why this file can unit-test the
  // helpers at all. Pin it so a future "de-duplication" does not undo that.
  ok('paths module does not require image-pipeline.js',
     !/require\([^)]*image-pipeline/.test(pureSrc));
  // Zero requires at all: the moment this module needs a bucket or a Firestore
  // handle, the confinement check stops being testable without mocking.
  ok('paths module requires nothing', !/\brequire\s*\(/.test(pureSrc));
  ok('exports the confinement helper', typeof isReapablePhotoPath === 'function');
  ok('exports the variant helper', typeof variantPathsFor === 'function');

  // functions/index.js does `Object.assign(exports, leadArtifactCleanup)`, so
  // every export of the trigger becomes a deployed-surface name that
  // FUNCTIONS_INDEX.md must document. Only the trigger itself belongs there.
  const trigExports = [...TRIGGER_SRC.matchAll(/^exports\.(\w+)\s*=/gm)].map((m) => m[1]);
  ok('trigger exports only onLeadDeleted (' + trigExports.join(',') + ')',
     eq(trigExports, ['onLeadDeleted']));
  ok('trigger uses the shared path helpers',
     /require\('\.\/lead-artifact-paths'\)/.test(TRIGGER_SRC));
}

console.log('\n──────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
