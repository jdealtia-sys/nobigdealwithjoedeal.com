/**
 * tests/esign-autodetect.test.js — field proposals from a PDF's text layer.
 *
 * docs/pro/js/esign-autodetect.js reads the text runs pdf.js reports and
 * proposes where the signature, initials, date and name fields belong, so a
 * rep does not hand-place a box on every ruled line of a six-page insurance
 * form.
 *
 * It is tuned to UNDER-propose on purpose: a missed field costs one drag,
 * while a spurious field on a live contract asks a homeowner to fill in
 * something that does not exist. The negative cases below are therefore the
 * important half of this file — if you loosen a heuristic, they are what
 * stops it going feral on ordinary prose.
 *
 * Run: node tests/esign-autodetect.test.js   (no browser, no dependencies)
 */
'use strict';

const path = require('path');
const A = require(path.join(__dirname, '..', 'docs', 'pro', 'js', 'esign-autodetect.js'));

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

/** Build a pdf.js-shaped text item. y is the BASELINE, PDF origin bottom-left. */
const mk = (str, x, y, w, h) => ({ str, width: w, height: h || 10, transform: [1, 0, 0, h || 10, x, y] });
const PAGE = { w: 612, h: 792 };
const run = (items, opts) => A.detectFields(items, PAGE, Object.assign({ pageIndex: 0 }, opts || {}));
const typesOf = (f) => f.map((x) => x.type).sort();

console.log('\nesign-autodetect\n');

// ── ruled lines ─────────────────────────────────────────────────────────
console.log('  ruled lines');
{
  const f = run([
    mk('__________________________', 72, 200, 220, 10),
    mk('Homeowner Signature', 72, 186, 96, 8),
  ]);
  ok('an underscore rule captioned "Homeowner Signature" yields ONE signature field',
    f.length === 1 && f[0].type === 'signature', JSON.stringify(typesOf(f)));
  ok('the field sits on the rule, not on the caption',
    f[0].y >= 200 && f[0].y <= 206, `y=${f[0] && f[0].y}`);
  ok('the field inherits the rule width the form author intended',
    f[0].w > 150 && f[0].w <= 220, `w=${f[0] && f[0].w}`);
}
{
  const f = run([
    mk('____________', 320, 200, 90, 10),
    mk('Initials', 320, 186, 34, 8),
  ]);
  ok('an initials rule is typed as initials', f.length === 1 && f[0].type === 'initials');
}
{
  const f = run([
    mk('____________________', 72, 300, 160, 10),
    mk('Date:', 240, 300, 26, 8),
  ]);
  ok('a caption to the RIGHT of a rule types that rule',
    f.length === 1 && f[0].type === 'date', JSON.stringify(typesOf(f)));
}
{
  const f = run([mk('________________________', 72, 400, 200, 10)]);
  ok('an uncaptioned rule defaults to signature (the common case)',
    f.length === 1 && f[0].type === 'signature');
}
{
  const f = run([mk('____', 72, 400, 18, 10)]);
  ok('a short rule is ignored — it is a blank in prose, not a signing line',
    f.length === 0, JSON.stringify(f));
}

// ── captions with no rule ───────────────────────────────────────────────
console.log('\n  captions without a rule');
{
  const f = run([mk('Date', 460, 186, 24, 8)]);
  ok('a bare "Date" caption proposes a date box ABOVE it',
    f.length === 1 && f[0].type === 'date' && f[0].y > 186, JSON.stringify(f[0]));
}
{
  const f = run([mk('Print Name', 72, 150, 52, 8)]);
  ok('"Print Name" proposes a text field', f.length === 1 && f[0].type === 'text');
  ok('a name field is not marked required', f[0].required === false);
}
{
  const f = run([mk('X', 72, 150, 8, 10)]);
  ok('a lone X proposes a signature', f.length === 1 && f[0].type === 'signature');
}

// ── negative cases: the half that matters ───────────────────────────────
console.log('\n  does NOT propose on ordinary prose');
{
  const f = run([mk('This agreement is dated as of the date of last signature below.', 72, 400, 330, 9)]);
  ok('a long sentence containing "date" and "signature" proposes nothing',
    f.length === 0, JSON.stringify(typesOf(f)));
}
{
  const f = run([mk('Payment is due on completion.', 72, 400, 150, 9)]);
  ok('unrelated prose proposes nothing', f.length === 0);
}
{
  const f = run([mk('', 72, 400, 100, 9), mk('   ', 80, 380, 50, 9)]);
  ok('empty and whitespace runs are skipped', f.length === 0);
}
{
  ok('no items at all is handled', run([]).length === 0);
  ok('null items is handled', A.detectFields(null, PAGE, {}).length === 0);
}

// ── one field per line, not two ─────────────────────────────────────────
console.log('\n  no duplicate boxes');
{
  const f = run([
    mk('_______________________', 72, 200, 220, 10),
    mk('Signature', 72, 186, 48, 8),
    mk('_______________________', 72, 260, 220, 10),
    mk('Date', 72, 246, 24, 8),
  ]);
  ok('two captioned rules yield exactly two fields', f.length === 2, JSON.stringify(typesOf(f)));
  ok('and they are typed independently',
    JSON.stringify(typesOf(f)) === JSON.stringify(['date', 'signature']), JSON.stringify(typesOf(f)));
  ok('every proposed id is unique', new Set(f.map((x) => x.id)).size === f.length);
}

// ── output shape must satisfy the stamper ───────────────────────────────
console.log('\n  proposals are valid stamper input');
{
  const f = run([
    mk('_______________________', 72, 200, 220, 10),
    mk('Homeowner Signature', 72, 186, 96, 8),
    mk('Initials', 320, 186, 34, 8),
    mk('Date', 460, 186, 24, 8),
  ]);
  ok('proposals were made', f.length >= 3, `${f.length}`);

  const stamp = require(path.join(__dirname, '..', 'functions', 'esign-stamp.js'));
  let err = null;
  try { stamp.validateFields(f.map((x) => { const c = Object.assign({}, x); delete c.source; return c; }), 1); }
  catch (e) { err = e.message; }
  ok('every proposal passes the stamper\'s own validateFields', err === null, err || '');

  ok('all boxes are inside the page',
    f.every((x) => x.x >= 0 && x.y >= 0 && x.x + x.w <= PAGE.w + 1 && x.y + x.h <= PAGE.h + 1),
    JSON.stringify(f.map((x) => [x.x, x.y, x.w, x.h])));
  ok('signature boxes are big enough to sign into on a phone',
    f.filter((x) => x.type === 'signature').every((x) => x.w >= 100 && x.h >= 30));
}

// ── vector rules (lines drawn, not typed as underscores) ────────────────
console.log('\n  vector rules');
{
  const f = run([mk('Signature', 72, 186, 48, 8)], { lines: [{ x: 72, y: 200, w: 220 }] });
  ok('a drawn horizontal rule is treated like an underscore run',
    f.length === 1 && f[0].type === 'signature' && f[0].y >= 200, JSON.stringify(f[0]));
}
{
  const f = run([], { lines: [{ x: 72, y: 200, w: 12 }] });
  ok('a short drawn line is ignored', f.length === 0);
}

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
process.exit(0);
