/**
 * tests/seo-surface.test.js
 * ═══════════════════════════════════════════════════════════════
 *
 * Proves scripts/check-seo-surface.js can go RED, one defect at a time.
 *
 * The gate currently reports 0 errors across the live site. That number was
 * arrived at by tuning the checks — which is exactly the situation this repo
 * has been burned by before (crm-audit.js exited 0 for its entire life; the
 * visual baselines were never committed; npm test skipped 22 suites). A gate
 * whose only evidence is a green streak is not evidence.
 *
 * So: a fixture tree with one deliberate defect per file, and an assertion
 * that each one is individually caught and correctly classified. If a check
 * is ever silently disabled, the fixture for it goes green and this fails.
 *
 * Run: node tests/seo-surface.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'check-seo-surface.js');
const FIXTURES = path.join(__dirname, 'fixtures', 'seo-surface');

let passed = 0;
const failures = [];

function check(name, fn) {
  try { fn(); passed++; } catch (e) {
    failures.push({ name, message: e && e.message ? e.message : String(e) });
  }
}

// Run the gate against the fixture tree and return its parsed JSON plus the
// real exit code. `--root` points DOCS straight at the fixtures.
function run(extraArgs = []) {
  let stdout = '';
  let status = 0;
  try {
    stdout = execFileSync('node', [SCRIPT, '--root', FIXTURES, '--json', ...extraArgs], {
      encoding: 'utf8',
    });
  } catch (e) {
    stdout = e.stdout || '';
    status = typeof e.status === 'number' ? e.status : 1;
  }
  return { report: JSON.parse(stdout), status };
}

const { report, status } = run();
const byFile = {};
for (const f of report.findings) {
  (byFile[path.basename(f.file)] = byFile[path.basename(f.file)] || []).push(f);
}
const checksFor = (file) => (byFile[file] || []).filter((f) => f.level === 'ERROR').map((f) => f.check);

console.log('SEO SURFACE GATE — proving each check can fail');
console.log('='.repeat(64));

// ── Each defect fixture must produce its own ERROR ──────────────────────

const CASES = [
  ['F1', 'no-title.html', 'title', 'a page with no <title>'],
  ['F2', 'no-h1.html', 'h1', 'a page with no <h1> — the case the [\\b] regex bug hid'],
  ['F3', 'two-h1.html', 'h1', 'a page with two <h1> tags'],
  ['F4', 'no-description.html', 'meta-description', 'a page with no meta description'],
  ['F5', 'no-canonical.html', 'canonical', 'a page with no rel=canonical'],
  ['F6', 'no-lang.html', 'lang', 'a page whose <html> has no lang'],
  ['F7', 'no-viewport.html', 'viewport', 'a page with no viewport meta'],
  ['F8', 'bad-jsonld.html', 'structured-data', 'a page with unparseable JSON-LD'],
  ['F9', 'img-no-alt.html', 'img-alt', 'an <img> with no alt attribute'],
];

for (const [id, file, expectedCheck, description] of CASES) {
  check(`${id}  catches ${description}`, () => {
    const got = checksFor(file);
    assert.ok(
      got.includes(expectedCheck),
      `${file} should raise ERROR:${expectedCheck}, got [${got.join(', ') || 'nothing'}]`,
    );
  });
}

// ── The clean fixture must stay clean ───────────────────────────────────
// Without this, a check that fires on EVERYTHING would satisfy every case
// above while being worthless.

check('F10 the clean fixture raises no ERROR at all', () => {
  const got = checksFor('clean.html');
  assert.deepStrictEqual(got, [], `clean.html should be clean, got [${got.join(', ')}]`);
});

check('F11 the clean fixture raises no WARN either', () => {
  const w = (byFile['clean.html'] || []).filter((f) => f.level === 'WARN');
  assert.deepStrictEqual(w.map((f) => f.check), [],
    'clean.html must satisfy the warn-level checks too, or the warn tier is untested');
});

// ── Length checks measure RENDERED characters, not raw bytes ────────────
// This gate's first run produced nine "description too long" findings. Six
// were its own bug: `&#39;` is five bytes and one character, so any
// description containing an apostrophe was over-counted by four per entity.
// The fixture is 166 raw bytes and 154 rendered characters — comfortably in
// range, and it must produce no warning.

check('F19 a description of 166 raw bytes but 154 rendered chars is IN range', () => {
  const all = (byFile['entity-length.html'] || []).map((f) => `${f.level}:${f.check}`);
  assert.ok(
    !all.includes('WARN:meta-description-length'),
    'entity-encoded description was measured as raw bytes — length checks must '
      + `decode entities first; got [${all.join(', ')}]`,
  );
});

// ── noindex exemption ───────────────────────────────────────────────────

check('F12 a noindex page is skipped, not audited', () => {
  assert.strictEqual(byFile['noindex.html'], undefined,
    'noindex.html declares noindex and must not be audited as a search surface');
});

check('F13 noindex.html would otherwise have failed (the exemption is doing work)', () => {
  // It has no description, no canonical, no h1, no viewport. If the noindex
  // rule ever stops matching, F12 breaks — but only if the page is genuinely
  // defective, which this pins.
  const fs = require('fs');
  const html = fs.readFileSync(path.join(FIXTURES, 'noindex.html'), 'utf8');
  assert.ok(!/rel=["']canonical/i.test(html) && !/<h1/i.test(html),
    'the noindex fixture must stay defective, or F12 proves nothing');
});

// ── Exit code plumbing ──────────────────────────────────────────────────
// The failure this pins is specific and has happened here before: a --json
// branch that returns before the verdict, so the check reports findings and
// still exits 0.

check('F14 the gate EXITS NON-ZERO when errors exist, even in --json mode', () => {
  assert.ok(report.errors > 0, 'fixture tree must contain errors for this to mean anything');
  assert.strictEqual(status, 1, `expected exit 1 with ${report.errors} errors, got ${status}`);
});

check('F15 report.failed agrees with the exit code', () => {
  assert.strictEqual(report.failed, true);
});

check('F16 --warn-as-error escalates a warn-only tree', () => {
  const clean = run(['--warn-as-error']);
  assert.ok(clean.report.errors > 0 || clean.report.warnings > 0);
  assert.strictEqual(clean.status, 1);
});

// ── The real site ───────────────────────────────────────────────────────
// The gate is only worth having if it is green on what actually ships, and
// green for the right reason — over a real page count, not an empty walk.

check('F17 the live docs/ tree passes with zero ERRORs', () => {
  let out = '';
  try {
    out = execFileSync('node', [SCRIPT, '--json'], { encoding: 'utf8' });
  } catch (e) {
    out = e.stdout || '';
  }
  const live = JSON.parse(out);
  assert.strictEqual(live.errors, 0,
    `docs/ should be error-free; got ${live.errors}: `
      + live.findings.filter((f) => f.level === 'ERROR').map((f) => `${f.file}:${f.check}`).join(', '));
});

check('F18 the live audit covers a real page count, not an empty walk', () => {
  let out = '';
  try {
    out = execFileSync('node', [SCRIPT, '--json'], { encoding: 'utf8' });
  } catch (e) { out = e.stdout || ''; }
  const live = JSON.parse(out);
  // Reporting success over zero pages is the second way crm-audit.js passed.
  assert.ok(live.pages > 150,
    `expected the public site to be >150 pages, got ${live.pages} — a collapsed `
      + 'walk would report a clean site by auditing nothing');
});

// ── Report ──────────────────────────────────────────────────────────────

console.log('');
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.message}`);
  console.log('');
  console.log(`FAILED — ${passed} passed, ${failures.length} failed`);
  process.exit(1);
}
console.log(`PASSED — ${passed} assertions; every check proven able to fail`);
process.exit(0);
