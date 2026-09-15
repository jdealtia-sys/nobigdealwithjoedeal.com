/**
 * tests/sign-image-url-allowlist-2026-09-14.test.js
 *
 * functions/handlers/photo.js's signImageUrl mints a 15-minute v4 signed
 * Storage URL for an authorized client — but only for a path whose prefix
 * is on its own allowlist regex. functions/portal.js's homeowner-upload
 * write comment claimed "the rep's dashboard re-signs on demand via the
 * existing signImageUrl function" once the 7-day baked-in URL expires, but
 * the allowlist never actually included homeowner-uploads/ — every such
 * call 400'd "Invalid path shape" and the photo was unreachable from the
 * rep gallery after 7 days. storage.rules had no read rule for the prefix
 * either (see tests/storage-rules.test.js's new block 28).
 *
 * signImageUrl is an onRequest Cloud Function (deep Storage/getAuth
 * dependency), so this extracts the actual allowlist regex LITERAL from the
 * source and exercises it directly as a real RegExp — a genuine behavioral
 * check on the real pattern object, not a substring guess at its shape.
 *
 * Pure-Node, zero-dep. Run: node tests/sign-image-url-allowlist-2026-09-14.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { failed++; fails.push(label); console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); }
}

const src = fs.readFileSync(path.join(ROOT, 'functions', 'handlers', 'photo.js'), 'utf8');

// Extract the real regex literal so the test exercises the actual pattern,
// not a hand-copied guess at it.
const m = src.match(/const match = filePath\.match\((\/\^[^\n]+\/)\);/);
ok('the allowlist regex literal is found in the source', !!m, 'anchor text may have moved — re-grep');
const RE = m ? new RegExp(m[1].slice(1, m[1].lastIndexOf('/')), m[1].slice(m[1].lastIndexOf('/') + 1)) : null;

if (RE) {
  console.log('\nAllowlist regex behavior');
  ok('photos/<uid>/<file> — still allowed (pre-existing)', RE.test('photos/alice/1.jpg'));
  ok('galleries/<uid>/<file> — still allowed (pre-existing)', RE.test('galleries/alice/1.jpg'));
  ok('reports/<uid>/<file> — still allowed (pre-existing)', RE.test('reports/alice/1.pdf'));
  ok('docs/<uid>/<file> — still allowed (pre-existing)', RE.test('docs/alice/1.pdf'));
  ok('homeowner-uploads/<uid>/<file> — NOW allowed (the fix)', RE.test('homeowner-uploads/alice/lead42/1781053546220.jpg'));
  ok('portals/<uid>/<file> — still explicitly EXCLUDED (H-01: portal HTML must never get a signed Storage URL — it would execute at the storage.googleapis.com origin)',
    !RE.test('portals/alice/lead42/page.html'));
  ok('pdf-renders/<uid>/<file> — still excluded (admin-SDK-only prefix, no client re-sign path)',
    !RE.test('pdf-renders/alice/invoice.pdf'));
  ok('a bare top-level file with no uid segment is rejected', !RE.test('homeowner-uploads/onlyonepart.jpg'));
}

console.log('\nportal.js comment matches reality');
{
  const portalSrc = fs.readFileSync(path.join(ROOT, 'functions', 'portal.js'), 'utf8');
  const idx = portalSrc.indexOf("homeowner-uploads/${tok.ownerUid}/${tok.leadId}/${ts}.${ext}");
  ok('the homeowner-upload write site is found', idx >= 0);
  const nearby = idx >= 0 ? portalSrc.slice(idx, idx + 1400) : '';
  ok('the comment no longer states the re-sign claim as unqualified fact without the 2026-09-14 correction',
    /2026-09-14/.test(nearby) && /never included homeowner-uploads/.test(nearby));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }
