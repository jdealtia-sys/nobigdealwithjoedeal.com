/**
 * tests/pdf-render-retention.test.js
 *
 * Guards functions/pdf-render-retention.js (added 2026-09-08).
 *
 * WHY THIS EXISTS
 * ───────────────
 * `pdf-renders/{uid}/` accumulated every server-rendered customer document
 * forever — invoices, contracts, change orders, warranties, inspection and
 * photo reports — with no storage.rules block and no reaper. Worse, until the
 * companion change in render-pdf.js the uploader stamped a
 * `firebaseStorageDownloadTokens` value on EVERY object, and a download token
 * bypasses storage.rules completely: no auth, no expiry, no revocation. A prod
 * survey on 2026-09-08 found 19 of 21 objects carrying one, and an
 * unauthenticated HEAD on a customer roofing contract returned 200 OK
 * (403 with the token stripped — the token was exactly what granted access).
 *
 * Deleting the object is the ONLY working revocation for a token, which makes
 * this reaper a security control, not housekeeping.
 *
 * The things worth pinning are the safety properties, not the happy path:
 *
 *   • CONFINEMENT. This job deletes from the MAIN application bucket — the one
 *     holding photos/, docs/, esign/ and every other customer artifact. The
 *     listing is prefix-scoped, but if a future edit widens it (or a prefix
 *     is accidentally ''), only isReapablePath() stands between this loop and
 *     the whole bucket.
 *   • FAIL-CLOSED DATING. An object whose creation time cannot be read must be
 *     KEPT. Deleting on the strength of an unreadable date is how a reaper
 *     turns into an eraser.
 *   • The reaper must not put test scaffolding on the deployed function
 *     surface — index.js mounts it by name for exactly this reason.
 *
 * Pure-Node, no emulator. Run: node tests/pdf-render-retention.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODULE_PATH = path.join(ROOT, 'functions', 'pdf-render-retention.js');
const SRC = fs.readFileSync(MODULE_PATH, 'utf8');
const { _internal } = require(MODULE_PATH);
const { isReapablePath, ageMsOf, PREFIX, RETENTION_DAYS, MAX_DELETES_PER_RUN } = _internal;

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; fails.push(label); }
}

const DAY = 24 * 60 * 60 * 1000;
const UID = 'kQ3nR8vTzWxYb2mLpJ7c';

console.log('\npdf-render-retention — confinement');
{
  ok('reaps a normal render path',
    isReapablePath(`pdf-renders/${UID}/1781053546220-NBD-Roofing-Contract.pdf`));
  ok('reaps a nested path under a uid',
    isReapablePath(`pdf-renders/${UID}/sub/1781053546220-x.pdf`));

  // Every sibling prefix in storage.rules. If the listing is ever widened,
  // these are the paths that would be destroyed — each holds customer data
  // that is a system of record, unlike a re-renderable PDF.
  for (const other of ['photos', 'docs', 'portals', 'documents', 'esign',
                       'deal_rooms', 'galleries', 'reports', 'shared_docs',
                       'audio', 'receipts']) {
    ok('refuses sibling prefix ' + other + '/',
      !isReapablePath(`${other}/${UID}/file.pdf`));
  }

  // A prefix that merely STARTS with the same letters must not match — this is
  // the classic startsWith() trap, and it is why PREFIX carries its trailing
  // slash. `pdf-renders-archive/` is not `pdf-renders/`.
  ok('refuses a look-alike sibling prefix (pdf-renders-archive/)',
    !isReapablePath(`pdf-renders-archive/${UID}/file.pdf`));

  ok('refuses a bare object with no uid segment',
    !isReapablePath('pdf-renders/loose.pdf'));
  ok('refuses the directory marker itself',
    !isReapablePath('pdf-renders/'));
  ok('refuses traversal shapes',
    !isReapablePath(`pdf-renders/${UID}/../../photos/victim.jpg`));
  ok('refuses empty string', !isReapablePath(''));
  ok('refuses null / non-string', !isReapablePath(null) && !isReapablePath(undefined)
    && !isReapablePath(42) && !isReapablePath({}));
}

console.log('\npdf-render-retention — fail-closed dating');
{
  // ageMsOf returns null for anything it cannot read, and the caller keeps the
  // object on null. Both halves matter: a null that the loop treated as 0 or
  // Infinity would delete everything undated.
  ok('missing timeCreated → null (kept)', ageMsOf({ metadata: {} }) === null);
  ok('absent metadata → null (kept)', ageMsOf({}) === null);
  ok('null file → null (kept)', ageMsOf(null) === null);
  ok('unparseable timeCreated → null (kept)',
    ageMsOf({ metadata: { timeCreated: 'not-a-date' } }) === null);
  ok('empty timeCreated → null (kept)',
    ageMsOf({ metadata: { timeCreated: '' } }) === null);

  const age40 = ageMsOf({ metadata: { timeCreated: new Date(Date.now() - 40 * DAY).toISOString() } });
  ok('40-day-old object reports ~40 days', Math.round(age40 / DAY) === 40);
  const age1 = ageMsOf({ metadata: { timeCreated: new Date(Date.now() - 1 * DAY).toISOString() } });
  ok('1-day-old object reports ~1 day', Math.round(age1 / DAY) === 1);
  ok('a fresh object is inside the retention window', age1 <= RETENTION_DAYS * DAY);
  ok('a 40-day object is outside the retention window', age40 > RETENTION_DAYS * DAY);

  // The loop keeps on `age === null`, so the guard must be an explicit null
  // check — `if (!age)` would also swallow a legitimate age of 0.
  ok('source keeps undated objects via an explicit null check',
    /if \(age === null\)/.test(SRC));
}

console.log('\npdf-render-retention — shape + deployed surface');
{
  ok('retention window is 30 days', RETENTION_DAYS === 30);
  ok('prefix carries its trailing slash', PREFIX === 'pdf-renders/');
  ok('per-run delete cap is set', Number.isFinite(MAX_DELETES_PER_RUN) && MAX_DELETES_PER_RUN > 0);

  // The signed URL the callable hands back lives 7 days. Retention shorter than
  // that would delete documents while their only link still works.
  ok('retention outlives the 7-day signed URL', RETENTION_DAYS > 7);

  ok('deletes with ignoreNotFound (a racing delete must not abort the sweep)',
    /ignoreNotFound: true/.test(SRC));
  ok('paginates rather than materialising the whole prefix',
    /autoPaginate: false/.test(SRC) && /pageToken/.test(SRC));
  ok('re-checks the prefix at the point of deletion',
    /isReapablePath\(file\.name\)/.test(SRC));
  ok('always logs a completion line, including the zero run',
    /pdfRenderRetention\.done/.test(SRC));

  // index.js mounts this by explicit name, NOT Object.assign — so `_internal`
  // stays off the deployed surface and out of FUNCTIONS_INDEX.md. If that ever
  // changes to Object.assign, the smoke tripwire will demand a row for
  // `_internal`, which is the wrong fix.
  const indexSrc = fs.readFileSync(path.join(ROOT, 'functions', 'index.js'), 'utf8');
  ok('index.js mounts the scheduler by explicit name (not Object.assign)',
    /exports\.pdfRenderRetention = pdfRenderRetention\.pdfRenderRetention;/.test(indexSrc)
    && !/Object\.assign\(exports, pdfRenderRetention\)/.test(indexSrc));
  ok('FUNCTIONS_INDEX.md documents the scheduled job',
    /`pdfRenderRetention`/.test(
      fs.readFileSync(path.join(ROOT, 'functions', 'FUNCTIONS_INDEX.md'), 'utf8')));
}

console.log('\npdf-render-retention — the renderer no longer stamps tokens');
{
  // The reaper bounds how long a leaked token URL lives; NOT minting the token
  // in the first place is what keeps the storage.rules block meaningful. Pin
  // both, because either one alone leaves the exposure open.
  const renderSrc = fs.readFileSync(path.join(ROOT, 'functions', 'render-pdf.js'), 'utf8');

  // The upload call must not carry a token. Match the save() options block
  // specifically rather than the whole file, which legitimately mentions the
  // token in the fallback path and in comments.
  const saveBlock = (renderSrc.match(/await file\.save\(pdfBuffer, \{[\s\S]*?\n      \}\);/) || [''])[0];
  ok('found the upload block to inspect', saveBlock.length > 0);
  ok('upload does NOT stamp firebaseStorageDownloadTokens',
    !/firebaseStorageDownloadTokens/.test(saveBlock));
  ok('upload does not mint a token at all',
    !/randomUUID/.test(saveBlock));
  ok('customer documents are not cached by shared proxies',
    /cacheControl: 'private,/.test(saveBlock));

  // The token is minted lazily, inside the signing-failure handler only.
  const fallback = (renderSrc.match(/\} catch \(signErr\) \{[\s\S]*?urlMode = 'download-token';/) || [''])[0];
  ok('token is minted in the signing-failure path', /randomUUID\(\)/.test(fallback));
  ok('token is attached via setMetadata there', /setMetadata/.test(fallback));
}

console.log('\n──────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
