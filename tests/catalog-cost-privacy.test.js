/**
 * tests/catalog-cost-privacy.test.js
 *
 * THE GUARD. docs/ is firebase.json hosting.public, so every file under it is
 * served unauthenticated at the site root — and this is a PUBLIC repo, so the
 * same bytes are readable from raw.githubusercontent.com whether hosting
 * serves them or not. docs/pro/js/product-data.js shipped wholesale COST beside
 * retail SELL for 187 SKUs (GAF Timberline HDZ: sell 240 / cost 82 → a 66%
 * margin), plus overheadMultiplier x176 and profitMarginPct x173, and
 * roofivent-catalog.js shipped a supplier's confidential contractor price list.
 * Worse, those were ONE company's supplier terms, handed to every other tenant
 * as their seed defaults. Cost data is now tenant-owned — it lives in
 * catalogCosts/{companyId} and is never distributed. This file is what stops
 * it coming back into the published tree.
 *
 * Three layers, because "don't publish costs" fails in more than one shape:
 *
 *   1. STRUCTURAL — load the real catalogs and assert no product object carries
 *      a private field. Catches any reintroduction that actually parses.
 *   2. SIGNATURE (every published file) — the retail-beside-wholesale pattern,
 *      `sell: N` and `cost: N` in the same object literal. Deliberately narrow
 *      so it can run over the whole hosting tree without false positives.
 *   3. STRICT (catalog + catalog-adjacent files only) — any numeric cost /
 *      contractor / overheadMultiplier / profitMarginPct literal at all, in a
 *      file whose job is data. Catches a cost table that never reaches a
 *      product object, and the two margin-policy constants that used to sit in
 *      product-library.js as `|| 1.35` / `|| 25`.
 *
 * Every layer is MUTATION-TESTED below: the scanner is fed a source that
 * reintroduces the leak and must flag it, and fed legitimate non-catalog code
 * and must not. A guard nobody has watched fail is not a guard.
 *
 * Pure-Node, no emulator. Run: node tests/catalog-cost-privacy.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const { hasPrivateFields } = require(path.join(ROOT, 'functions', 'catalog-cost-logic.js'));

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label); failed++; fails.push(label); }
}

/* ── scanners (pure: (rel, src) → string[] findings) ───────────────────── */

// Layer 2. `"sell":240,"cost":82` and `sell: 240, cost: 82`, either order,
// within a short window so it only matches the same object literal.
const SIGNATURE_RES = [
  /["']?sell["']?\s*:\s*-?\d[\d._]*\s*,\s*["']?cost["']?\s*:\s*-?\d/,
  /["']?cost["']?\s*:\s*-?\d[\d._]*\s*,\s*["']?sell["']?\s*:\s*-?\d/,
];

function scanSignature(rel, src) {
  const out = [];
  src.split(/\r?\n/).forEach((line, i) => {
    SIGNATURE_RES.forEach((re) => {
      const m = line.match(re);
      if (m) out.push(rel + ':' + (i + 1) + ': retail-beside-wholesale — ' + m[0].slice(0, 60));
    });
  });
  return out;
}

// Layer 3. Numeric-literal assignments to the private keys, in data files.
// The key must be in OBJECT-KEY position: the `(?<![.\w])` lookbehind rejects
// a property read, so `const cost = compute(x)`, `p.pricing[t].cost` and the
// ternary `costKnown ? p.pricing[t].cost : 0` don't trip it, while `cost: 82`
// and `"cost":82` do. An object key is never preceded by a dot, so this
// costs the guard nothing.
const STRICT_RES = [
  [/(?<![.\w])["']?cost["']?\s*:\s*-?\d/, 'numeric cost literal'],
  [/(?<![.\w])["']?contractor["']?\s*:\s*-?\d/, 'numeric contractor (supplier buy) literal'],
  [/(?<![.\w])["']?overheadMultiplier["']?\s*:\s*-?\d/, 'overheadMultiplier literal'],
  [/(?<![.\w])["']?profitMarginPct["']?\s*:\s*-?\d/, 'profitMarginPct literal'],
  [/overheadMultiplier\s*(?:\|\||\?\?)\s*-?\d/, 'overheadMultiplier fallback literal'],
  [/profitMarginPct\s*(?:\|\||\?\?)\s*-?\d/, 'profitMarginPct fallback literal'],
];

function stripComments(src) {
  // Prose in a header comment ("the 1.35 multiplier") is documentation, not a
  // published figure — and this file's own explanatory comments must not trip
  // the scanner it defines. Only executable text is scanned.
  //
  // Block comments are replaced by their OWN newlines, not by '', so the line
  // numbers in findings stay true to the source file. Collapsing them shifted
  // every reported line by the number of comment lines above it, which sends
  // whoever has to fix a leak to the wrong place.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .split(/\r?\n/)
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

// Layer 5. PROSE. The structural layers only look at typed fields, so they all
// missed 4 SKUs whose `notes` string carried confirmed supplier-portal buy
// prices ("cost $41.33/bundle CONFIRMED via portal") plus the branch account
// number, sitting on the very same line the codemod had just stripped
// `"cost":N` out of. A free-text field on a public page is exactly as readable
// as a typed one.
const PROSE_FIELDS = ['notes', 'description', 'warranty'];
const PROSE_RES = [
  [/\$\s?\d/, 'a dollar figure in prose'],
  [/\b(?:ABC|SRS|Beacon|Allied|ProBuild)\s*#\s?\d{2,}/i, 'a supplier branch-account number'],
  [/\bcost\s*\$?\s?\d/i, 'a stated cost in prose'],
];

function scanProse(products) {
  const out = [];
  (products || []).forEach((p) => {
    PROSE_FIELDS.forEach((k) => {
      const v = p && p[k];
      if (typeof v !== 'string') return;
      PROSE_RES.forEach(([re, what]) => {
        const m = v.match(re);
        if (m) out.push(p.id + '.' + k + ': ' + what + ' — "' + v.slice(Math.max(0, v.indexOf(m[0]) - 20), v.indexOf(m[0]) + 40) + '"');
      });
    });
  });
  return out;
}

function scanStrict(rel, src) {
  const out = [];
  stripComments(src).split(/\r?\n/).forEach((line, i) => {
    STRICT_RES.forEach(([re, what]) => {
      const m = line.match(re);
      if (m) out.push(rel + ':' + (i + 1) + ': ' + what + ' — ' + m[0].slice(0, 60));
    });
  });
  return out;
}

// Files whose entire job is catalog/pricing data or its client. A cost literal
// in ANY of these is a leak, not a coincidence.
const STRICT_FILES = [
  'pro/js/product-data.js',
  'pro/js/roofivent-catalog.js',
  'pro/js/catalog-costs.js',
  'pro/js/product-library.js',
];

// Layer 4. THE COST-BASIS SWEEP — the whole published tree, not a fixed list.
//
// Added after the product-data.js migration, because that migration was not
// the whole leak. docs/pro/js/estimate-builder-v2.js holds a SECOND, parallel
// cost catalog (`cost: 115.00, labor: 65.00` per SKU) that layers 1-3 all
// missed: it has no `sell` key for the signature scan to pair against, and it
// was not on the STRICT_FILES list. It is also the catalog that actually
// prices homeowner estimates — `materialCost: Number(spec.cost)` marked up by
// DEFAULT_MATERIAL_MARKUP_PCT, with an "Internal margin view" computing
// `margin = total - totalCost`.
//
// So this layer keys on the SHAPE (an internal cost basis paired with a labor
// cost in one object literal) and sweeps every published file, so the next
// pricing catalog somebody adds cannot hide the same way.
const COST_BASIS_RE = /(?<![.\w])cost\s*:\s*-?\d[\d.]*\s*,\s*(?<![.\w])labor\s*:\s*-?\d/;
// Abbreviated spelling of the same shape (2026-08-10): the xactimate catalog
// ships 276 unit-cost pairs as `mat: N, lab: N` — semantically identical to
// cost/labor but invisible to COST_BASIS_RE, which is exactly how a 1,300-line
// cost book sat unswept next to the guard for a month.
const COST_BASIS_ABBREV_RE = /(?<![.\w])mat\s*:\s*-?\d[\d.]*\s*,\s*(?<![.\w])lab\s*:\s*-?\d/;

function scanCostBasis(rel, src) {
  const out = [];
  stripComments(src).split(/\r?\n/).forEach((line, i) => {
    const m = line.match(COST_BASIS_RE) || line.match(COST_BASIS_ABBREV_RE);
    if (m) out.push(rel + ':' + (i + 1) + ': internal cost basis — ' + m[0].slice(0, 60));
  });
  return out;
}

// KNOWN, UNCLOSED leaks. Each entry is debt recorded in code rather than in a
// commit message, and each is asserted to STILL be leaking below — so when one
// is migrated the guard fails and tells you to delete the line, and the list
// can never quietly rot into a permanent exemption.
const KNOWN_UNMIGRATED = {
  'pro/js/estimate-builder-v2.js':
    'Phase 2 (2026-07-30): 28 CATALOG entries carry cost + labor, plus ' +
    'DEFAULT_MATERIAL_MARKUP_PCT. Same class as the product-data.js leak, ' +
    'different subsystem (EstimateBuilderV2.CATALOG, not NBD_PRODUCTS) — it ' +
    'needs its own tenant-owned book and hydration path. NOT closed by the ' +
    'catalogCosts migration. (2026-08-10: the hardcoded DEFAULT_COST_BASIS ' +
    'per-SQ figures WERE closed — zeroed, tenant-config only — but the ' +
    'CATALOG entries remain.)',
  'pro/js/estimate-catalog-xactimate.js':
    'Found 2026-08-10 audit: 276 mat/lab unit-cost line items (Cincinnati ' +
    'regional supplier pricing + in-house productivity data, per its own ' +
    'header) served unauthenticated. Evaded the sweep via abbreviated keys ' +
    '(mat:/lab: — now caught by COST_BASIS_ABBREV_RE). Belongs to the same ' +
    'Phase-2 tenant-owned cost-book migration as estimate-builder-v2.js ' +
    'CATALOG; migrate both together, then delete both entries here.',
};

/* ── the published tree (firebase.json hosting.ignore aware) ───────────── */

const fb = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
const ignore = fb.hosting.ignore || [];

function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:[^/]+/)*'; i += 2; } else { re += '.*'; i += 1; }
      } else { re += '[^/]*'; }
    } else if ('.+?^${}()|[]\\/'.includes(c)) {
      re += (c === '/' ? '/' : '\\' + c);
    } else { re += c; }
  }
  return new RegExp('^' + re + '$');
}
const ignoreRes = ignore.map(globToRe);
const isIgnored = (rel) => ignoreRes.some((r) => r.test(rel));

const HOSTING_ROOT = path.join(ROOT, fb.hosting.public);
function walk(dir, rel, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out); else out.push(r);
  }
  return out;
}
const published = walk(HOSTING_ROOT, '', []).filter((f) => !isIgnored(f));
const scannable = published.filter((f) => /\.(js|mjs|json|html)$/i.test(f));

/* ── 1. structural: the live catalog carries no private fields ─────────── */

console.log('\ncatalog cost privacy — structural');
console.log('──────────────────────────────────────────────────');

const win = {};
win.window = win;
const sandbox = { window: win, Date, Math, JSON, Set, Object, console: { log() {} } };
['product-data.js', 'roofivent-catalog.js'].forEach((f) => {
  vm.runInNewContext(fs.readFileSync(path.join(HOSTING_ROOT, 'pro', 'js', f), 'utf8'), sandbox, { filename: f });
});
const PRODUCTS = win.NBD_PRODUCTS || [];

ok('catalog loaded (' + PRODUCTS.length + ' SKUs) — guard is not vacuous', PRODUCTS.length >= 260);
const structuralLeaks = PRODUCTS.filter(hasPrivateFields);
ok('no published product object carries cost/labor (leaking: ' +
   (structuralLeaks.map((p) => p.id).slice(0, 5).join(',') || 'none') + ')',
   structuralLeaks.length === 0);
ok('every product still carries retail sell on all three tiers',
   PRODUCTS.every((p) => ['good', 'better', 'best'].every((t) =>
     p.pricing && p.pricing[t] && typeof p.pricing[t].sell === 'number')));

const proseLeaks = scanProse(PRODUCTS);
ok('no product\'s prose fields carry a price or supplier account (' +
   (proseLeaks.slice(0, 2).join(' | ') || 'clean') + ')', proseLeaks.length === 0);

/* ── 2. signature scan across the whole published tree ─────────────────── */

console.log('\ncatalog cost privacy — published tree');
console.log('──────────────────────────────────────────────────');

const sigFindings = [];
scannable.forEach((rel) => {
  sigFindings.push(...scanSignature(rel, fs.readFileSync(path.join(HOSTING_ROOT, rel), 'utf8')));
});
ok('scanned a real tree (' + scannable.length + ' published js/json/html files)', scannable.length > 50);
ok('no published file pairs sell with cost (' + (sigFindings.slice(0, 3).join(' | ') || 'clean') + ')',
   sigFindings.length === 0);

const strictFindings = [];
STRICT_FILES.forEach((rel) => {
  const abs = path.join(HOSTING_ROOT, rel);
  if (!fs.existsSync(abs)) { strictFindings.push(rel + ': MISSING — strict list is stale'); return; }
  strictFindings.push(...scanStrict(rel, fs.readFileSync(abs, 'utf8')));
});
ok('catalog files carry no cost/contractor/margin literals (' +
   (strictFindings.slice(0, 3).join(' | ') || 'clean') + ')',
   strictFindings.length === 0);
ok('all ' + STRICT_FILES.length + ' strict-scanned files are actually published',
   STRICT_FILES.every((f) => published.includes(f)));

// ── layer 4: cost-basis sweep over the whole published tree ──────────────
const basisByFile = new Map();
scannable.forEach((rel) => {
  const hits = scanCostBasis(rel, fs.readFileSync(path.join(HOSTING_ROOT, rel), 'utf8'));
  if (hits.length) basisByFile.set(rel, hits);
});

const unexpected = Array.from(basisByFile.keys()).filter((f) => !(f in KNOWN_UNMIGRATED));
ok('no UNKNOWN published file carries an internal cost basis (' +
   (unexpected.join(', ') || 'none') + ')', unexpected.length === 0);

// Non-vacuity, both directions. The sweep must actually be finding the known
// leak (otherwise the regex is broken and the guard is theatre), and a known
// entry that has stopped leaking must be deleted from the list.
Object.keys(KNOWN_UNMIGRATED).forEach((f) => {
  ok('KNOWN UNMIGRATED still leaking, keep tracking it: ' + f +
     ' (' + ((basisByFile.get(f) || []).length) + ' entries)',
     (basisByFile.get(f) || []).length > 0);
});

ok('the migrated catalogs are NOT in the known-unmigrated list',
   !('pro/js/product-data.js' in KNOWN_UNMIGRATED) &&
   !('pro/js/roofivent-catalog.js' in KNOWN_UNMIGRATED));

/* ── 3. the extracted cost book must never be committed ────────────────── */

console.log('\ncatalog cost privacy — seed stays out of the repo');
console.log('──────────────────────────────────────────────────');

ok('.gitignore excludes .local/ (where the extracted seed lands)',
   /^\.local\/$/m.test(fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')));

// Match the EXTRACTED ARTEFACT, not every file with "cost-seed" in its name —
// tests/catalog-cost-seed.test.js is supposed to be tracked.
let tracked = '';
try {
  tracked = execFileSync('git', ['ls-files', '--', '*catalog-cost*.json', '.local'], { cwd: ROOT, encoding: 'utf8' }).trim();
} catch (e) { tracked = ''; }
ok('no extracted cost book is tracked by git (' + (tracked || 'none') + ')', tracked === '');

/* ── 4. MUTATION TESTS — prove each layer actually fires ───────────────── */

console.log('\ncatalog cost privacy — mutation tests (the guard must FAIL on a leak)');
console.log('──────────────────────────────────────────────────');

// 4a. structural
{
  const clone = JSON.parse(JSON.stringify(PRODUCTS.find((p) => p.id === 'shingle_001')));
  ok('control: the real shingle_001 is clean', !hasPrivateFields(clone));
  clone.pricing.good.cost = 82;
  ok('MUTANT killed: pricing.good.cost reintroduced → flagged', hasPrivateFields(clone));

  const clone2 = JSON.parse(JSON.stringify(clone));
  delete clone2.pricing.good.cost;
  clone2.labor = { perUnit: 75, ratePerManHour: 35 };
  ok('MUTANT killed: a labor block reintroduced → flagged', hasPrivateFields(clone2));
}

// 4b. signature scan
{
  const jsonShape = '{"id":"shingle_001","pricing":{"good":{"sell":240,"cost":82}}}';
  ok('MUTANT killed: JSON sell-then-cost (product-data.js shape)',
     scanSignature('x.js', jsonShape).length > 0);

  const jsShape = 'return { good: { sell: msrp, cost: contractor }, better: { sell: 1, cost: 2 } };';
  ok('MUTANT killed: JS sell:/cost: pair (roofivent makePricing shape)',
     scanSignature('x.js', jsShape).length > 0);

  ok('MUTANT killed: reversed key order (cost before sell)',
     scanSignature('x.js', '{"cost":82,"sell":240}').length > 0);

  // Negative controls — the scan must be usable across 200+ unrelated files.
  ok('control: a cost READ is not flagged',
     scanSignature('x.js', 'const matCost = p.pricing?.[t]?.cost || 0;').length === 0);
  ok('control: sell-only (the shipped shape) is not flagged',
     scanSignature('x.js', '{"pricing":{"good":{"sell":240},"better":{"sell":275}}}').length === 0);
  ok('control: unrelated cost words are not flagged',
     scanSignature('x.js', 'leadCostMeter.set({ costUsd: 8.4 }); // cost tracking').length === 0);
}

// 4c. strict scan
{
  ok('MUTANT killed: a bare contractor price table in a catalog file',
     scanStrict('pro/js/roofivent-catalog.js', "sizes: { '4': { contractor: 76, msrp: 95 } }").length > 0);
  ok('MUTANT killed: overheadMultiplier literal restored',
     scanStrict('pro/js/product-data.js', '"labor":{"overheadMultiplier":1.35}').length > 0);
  ok('MUTANT killed: profitMarginPct restored as a `|| 25` form fallback',
     scanStrict('pro/js/product-library.js', "value: p?.labor?.profitMarginPct || 25").length > 0);
  ok('MUTANT killed: a cost lookup table that never reaches a product object',
     scanStrict('pro/js/product-data.js', 'const COSTS = { shingle_001: { cost: 82 } };').length > 0);

  ok('control: comments explaining the split are not flagged',
     scanStrict('pro/js/catalog-costs.js', '// the old defaults were overheadMultiplier: 1.35 and profitMarginPct: 25').length === 0);
  ok('control: reading the key off an object is not flagged',
     scanStrict('pro/js/product-library.js', 'const om = p.labor.overheadMultiplier;').length === 0);

  // The `(?<![.\w])` lookbehind exists for these two. They are property READS
  // in a ternary — the real code shape that "cost not set" introduced. Both
  // must stay unflagged, and the object-key forms just above must stay
  // flagged, or the narrowing has quietly disarmed the guard.
  ok('control: a ternary falling back to 0 on a cost READ is not flagged',
     scanStrict('pro/js/product-library.js', 'const matCost = costKnown ? p.pricing[tierForMargin].cost : 0;').length === 0);
  ok('control: a ternary on the margin policy is not flagged',
     scanStrict('pro/js/product-library.js', 'const om = has ? p.labor.overheadMultiplier : 1;').length === 0);
  ok('MUTANT still killed after the ternary carve-out: a real object key',
     scanStrict('pro/js/product-data.js', 'pricing: { good: { sell: 240, cost: 82 } }').length > 0);
  ok('MUTANT still killed after the ternary carve-out: a quoted JSON key',
     scanStrict('pro/js/product-data.js', '{"pricing":{"good":{"cost":82}}}').length > 0);
}

// 4d. cost-basis sweep
{
  ok('MUTANT killed: the estimate-builder CATALOG shape in a NEW file',
     scanCostBasis('pro/js/some-new-pricing.js', "  'shingle-good': { code: 'RFG', cost: 115.00, labor: 65.00 }").length > 0);
  ok('MUTANT killed: same shape with integer literals',
     scanCostBasis('pro/js/x.js', 'a: { cost: 115, labor: 65 }').length > 0);
  ok('MUTANT killed: the abbreviated mat/lab spelling (xactimate-catalog class)',
     scanCostBasis('pro/js/x.js', "{ code: 'RFG 240', mat: 165, lab: 72 }").length > 0);
  ok('control: matte/label prose is not swept by the abbreviated pattern',
     scanCostBasis('pro/js/x.js', 'format: 1, label: 2').length === 0);

  ok('control: a cost with no paired labor is not swept (county permit fees are public)',
     scanCostBasis('pro/js/x.js', "'hamilton-oh': { name: 'Hamilton County, OH', cost: 185 }").length === 0);
  ok('control: property READS are not swept',
     scanCostBasis('pro/js/x.js', 'materialCost: Number(spec.cost), laborCost: Number(spec.labor)').length === 0);
}

// 4e. prose scan — the layer that the 4 leaking `notes` strings needed
{
  const mut = (notes) => [{ id: 'x', notes }];
  ok('MUTANT killed: a confirmed supplier price in notes (the real 2026-07-30 leak)',
     scanProse(mut('ABC #332 SKU 02TKTXT* per color; cost $41.33/bundle CONFIRMED via portal 2026-06-24.')).length > 0);
  ok('MUTANT killed: a bare dollar figure in notes',
     scanProse(mut('We buy these at $83.25 a bundle.')).length > 0);
  ok('MUTANT killed: a supplier branch account with no price',
     scanProse(mut('Order per-color SKU at ABC #332 (Team pricing).')).length > 0);
  ok('MUTANT killed: a price hidden in description rather than notes',
     scanProse([{ id: 'x', description: 'Premium shingle, our cost $110/sq.' }]).length > 0);

  ok('control: the customer PORTAL is not a supplier portal',
     scanProse(mut('Includes a photo report to the customer portal.')).length === 0);
  ok('control: ordinary product prose is not flagged',
     scanProse(mut('Required for the 160 mph wind warranty. 33.3 LF per bundle.')).length === 0);
}

// 4f. per-SQ cost basis stays out of the published tree (2026-08-10).
// estimate-builder-v2.js shipped DEFAULT_COST_BASIS = {340, 385, 430} — the
// shop's REAL per-SQ costs beside the public tier rates (545/595/660), i.e.
// the margin was readable by anyone who fetched the file. Same class as the
// 187-SKU catalog leak this suite was built for, but it slipped the strict
// layer because EBv2 isn't a catalog file. The defaults are zeros now
// ("not configured" — the engine nulls the margin fields); real cost basis
// is tenant data entered in Estimate Settings. These pins stop the real
// numbers being reintroduced as published defaults.
{
  const ebv2 = fs.readFileSync(path.join(ROOT, 'docs/pro/js/estimate-builder-v2.js'), 'utf8');
  const m = ebv2.match(/DEFAULT_COST_BASIS\s*=\s*\{([\s\S]{0,200}?)\}/);
  ok('EBv2 has a DEFAULT_COST_BASIS object (pin target present)', !!m);
  const nums = m ? (m[1].match(/-?\d+(\.\d+)?/g) || []).map(Number) : [1];
  ok('EBv2 DEFAULT_COST_BASIS ships all-zero values (real cost basis is tenant data)',
     nums.length > 0 && nums.every((n) => n === 0));

  const boot = fs.readFileSync(path.join(ROOT, 'docs/pro/js/dashboard-bootstrap.module.js'), 'utf8');
  const fallbacks = [...boot.matchAll(/v2cost(?:Good|Better|Best)'\)?,?\s*(?:\.value\s*=\s*s\.costBasis\?\.\w+\s*\?\?\s*|)(\d+)/g)].map((x) => Number(x[1]));
  ok('dashboard-bootstrap v2cost* fallbacks are all zero (6 sites: form fill + save)',
     fallbacks.length >= 6 && fallbacks.every((n) => n === 0));
}

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
