/**
 * tests/estimate-render.test.js — full estimate-output render integration test.
 *
 * Loads docs/pro/js/estimate-finalization.js into a vm (with a window stub +
 * window._brand()) and renders the three customer-facing estimate exports —
 * Insurance Scope, Retail Quote, Internal View — for NBD and for a tenant
 * (Oaks). Asserts the active tenant's brand actually lands in the output HTML.
 * This is the render-verify that proves estimate-finalization.js is tenant-aware
 * the same way docgen-render.test.js proves it for the doc generator.
 *
 * Contract (mirrors brand-sweep-2026-06-07 + docgen-render):
 *   - NBD shows 'No Big Deal' + orange #e8720c.
 *   - Oaks shows 'Oaks Roofing & Construction' + accent #C2410C, uses its
 *     docPrefix (OAK-) on the estimate number, its seal (ORC) on signatures,
 *     and does NOT leak 'No Big Deal' / '#e8720c' / 'Joe Deal' / 'Joe's'.
 * An Oaks failure is a real tenant-brand leak — an export hardcoding an NBD
 * literal instead of resolving it from window._brand().
 *
 * NBD byte-identical is enforced separately (HEAD-vs-worktree diff at build
 * time); here we additionally assert NBD's exact literals are still present.
 *
 * Run: node tests/estimate-render.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/estimate-finalization.js'), 'utf8');

// Load estimate-finalization.js into a fresh vm with window._brand() returning
// `brand` (or omit the resolver entirely when brand === undefined → NBD path).
function loadFin(brand) {
  const win = {};
  win.window = win;
  if (brand !== undefined) win._brand = () => brand;
  const sandbox = {
    window: win,
    console: { log() {}, warn() {}, error() {} },
    Date, Math, JSON, Set,
  };
  vm.runInNewContext(SRC, sandbox, { filename: 'estimate-finalization.js' });
  return win.EstimateFinalization;
}

// Fixed date so fmtDate() is deterministic. Estimate number is pinned so the
// Date.now() fallback never fires (it is the only source of non-determinism).
const FIXED = new Date('2026-06-07T12:00:00Z');

function fixture() {
  return {
    estimate: {
      total: 18500, subtotal: 17000, materialRetail: 9000, laborCost: 6000,
      materialCost: 7000, hardCost: 15000, overhead: 1000, profit: 1000,
      overheadPct: 0.10, profitPct: 0.10, taxRate: 0.0675, tax: 1147,
      tier: 'best', mode: 'retail', minJobApplied: false, deposit: 9250,
      internal: { margin: 3500, marginPct: 18.9 },
      lines: [
        { code: 'RFG-01', name: 'Architectural Shingles', category: 'roofing', quantity: 32, unit: 'SQ',
          materialCostPerUnit: 120, laborCostPerUnit: 80, lineTotal: 6400,
          reason: 'Full replacement required', codeRefs: { oh: '1507.2', irc: 'R905' },
          requiresPhoto: true, matSource: 'catalog', labSource: 'crew-rate' },
        { code: 'LBR-01', name: 'Tear-off & Disposal', category: 'labor', quantity: 32, unit: 'SQ',
          materialCostPerUnit: 0, laborCostPerUnit: 45, lineTotal: 1440, codeRefs: {} },
        { code: 'WAR-01', name: 'System Warranty Registration', category: 'warranty', quantity: 1, unit: 'EA',
          materialCostPerUnit: 0, laborCostPerUnit: 0, lineTotal: 0, codeRefs: {} }
      ]
    },
    meta: {
      customer: { name: 'Jane Homeowner', address: '123 Main St, Goshen OH', phone: '513-555-0100', email: 'jane@example.com' },
      claim: { carrier: 'State Farm', number: 'CLM-99', adjuster: 'Bob A.', dateOfLoss: '2026-04-01',
               deductible: 1000, acv: 14000, recoverableDepreciation: 4500 },
      estimate: { date: FIXED, number: null, preparedBy: null, revision: 'A', inspectionDate: FIXED },
      tiers: { good: { total: 15000 }, better: { total: 16500 }, best: { total: 18500 } }
    }
  };
}

// Render one export for a brand. Wrapped so a render throwing in the vm
// surfaces as a readable assertion failure rather than crashing the run.
function renderFmt(brand, fmt) {
  const fin = loadFin(brand);
  try {
    const f = fixture();
    const res = fin.formatEstimate(f.estimate, fmt, f.meta);
    return (res && res.html) || 'RENDER_ERROR: no html';
  } catch (e) {
    return 'RENDER_ERROR: ' + (e && e.message);
  }
}

const NBD_BRAND = { legalName: 'No Big Deal Home Solutions', colors: {}, contact: {} };
const OAKS_BRAND = {
  legalName: 'Oaks Roofing & Construction',
  displayName: 'Oaks Roofing & Construction',
  seal: 'ORC',
  docPrefix: 'OAK',
  tagline: 'Roofing, Siding, Gutters',
  logoUrl: 'https://nobigdealwithjoedeal.com/sites/oaks/logo-orange.svg',
  colors: { primary: '#333333', secondary: '#1A1A1A', accent: '#C2410C', ink: '#222222' },
  contact: { phone: '(513) 827-5297', email: 'joe@oaksrfc.com', website: 'oaksroofingandconstruction.com', address: 'Goshen, OH' }
};

// The three customer-facing estimate exports. `nbdName` is the exact NBD name
// literal each export must keep; every export themes the orange accent and
// carries the doc-number prefix + signature seal.
const FORMATS = [
  { label: 'insurance-scope', fmt: 'insurance-scope' },
  { label: 'retail-quote',    fmt: 'retail-quote' },
  { label: 'single-quote',    fmt: 'single-quote' },
  { label: 'internal-view',   fmt: 'internal-view' },
];

for (const t of FORMATS) {
  console.log('\nESTIMATE RENDER — ' + t.label + ' (full render, both tenants)');

  // ── NBD: exact orange + the NBD name present, byte-identical literals ──
  const n = renderFmt(NBD_BRAND, t.fmt);
  const nOk = typeof n === 'string' && n.indexOf('RENDER_ERROR') !== 0 && n.length > 500;
  ok(t.label + ' / NBD: renders HTML (no error)', nOk);
  ok(t.label + ' / NBD: shows "No Big Deal"', /No Big Deal/.test(n));
  ok(t.label + ' / NBD: orange #e8720c accent present', /#e8720c/i.test(n));

  // ── Oaks: tenant name + accent present; NBD identity fully absent ──
  const o = renderFmt(OAKS_BRAND, t.fmt);
  const oOk = typeof o === 'string' && o.indexOf('RENDER_ERROR') !== 0 && o.length > 500;
  ok(t.label + ' / Oaks: renders HTML (no error)', oOk);
  // Name is HTML-escaped on output ('&' → '&amp;'), which is correct/safe —
  // a browser renders it as "Oaks Roofing & Construction". Match either form.
  ok(t.label + ' / Oaks: shows "Oaks Roofing & Construction"', /Oaks Roofing &(amp;)? Construction/.test(o));
  ok(t.label + ' / Oaks: burnt-orange #C2410C (tenant accent)', /#c2410c/i.test(o));
  ok(t.label + ' / Oaks: does NOT leak orange #e8720c', !/#e8720c/i.test(o));
  ok(t.label + ' / Oaks: does NOT leak "No Big Deal"', !/No Big Deal/.test(o));
  ok(t.label + ' / Oaks: does NOT leak "Joe Deal"', !/Joe Deal/.test(o));
  ok(t.label + ' / Oaks: does NOT leak "Joe\'s"', !/Joe's/.test(o));
}

// ════════════════════════════════════════════════════════════════════
// Per-export specifics — doc-number prefix (docPrefix) and signature seal.
// The estimate number on these two exports falls back to `<prefix>-<ts>`
// only when meta.estimate.number is null; the fixture leaves it null so the
// prefix is observable. Oaks must use OAK- and its seal ORC, NBD keeps NBD-.
// (internal-view has no estimate number, so it is covered by the leak checks
//  above only.)
// ════════════════════════════════════════════════════════════════════
console.log('\nESTIMATE RENDER — doc-number prefix + signature seal');

const insNbd  = renderFmt(NBD_BRAND, 'insurance-scope');
const insOak  = renderFmt(OAKS_BRAND, 'insurance-scope');
ok('insurance-scope / NBD: estimate # uses NBD- prefix', /Estimate #NBD-/.test(insNbd));
ok('insurance-scope / Oaks: estimate # uses OAK- prefix (docPrefix)', /Estimate #OAK-/.test(insOak));
ok('insurance-scope / NBD: "Prepared By" shows Joe Deal — NBD', /Joe Deal — NBD/.test(insNbd));
ok('insurance-scope / Oaks: "Prepared By" shows ORC seal', /class="v">ORC</.test(insOak));

const retNbd  = renderFmt(NBD_BRAND, 'retail-quote');
const retOak  = renderFmt(OAKS_BRAND, 'retail-quote');
ok('retail-quote / NBD: estimate # uses NBD- prefix', /Estimate #NBD-/.test(retNbd));
ok('retail-quote / Oaks: estimate # uses OAK- prefix (docPrefix)', /Estimate #OAK-/.test(retOak));
ok('retail-quote / NBD: workmanship line says "10-year NBD labor warranty"', /10-year NBD labor warranty/.test(retNbd));
ok('retail-quote / Oaks: workmanship line says "10-year ORC labor warranty"', /10-year ORC labor warranty/.test(retOak));

// single-quote = retail quote WITHOUT the Good/Better/Best cards. The fixture's
// meta.tiers has a Better card at $16,500; retail-quote renders it, single-quote
// strips it (only the one "Your Investment" headline = estimate.total $18,500).
const sglNbd = renderFmt(NBD_BRAND, 'single-quote');
ok('retail-quote SHOWS the Better-tier card ($16,500)', /16,?500/.test(retNbd));
ok('single-quote OMITS the tier cards (no $16,500 Better card)', !/16,?500/.test(sglNbd));
ok('single-quote keeps the single "Your Investment" headline', /Your Investment/.test(sglNbd));
ok('single-quote estimate # uses NBD- prefix', /Estimate #NBD-/.test(sglNbd));

const intNbd  = renderFmt(NBD_BRAND, 'internal-view');
const intOak  = renderFmt(OAKS_BRAND, 'internal-view');
ok('internal-view / NBD: banner shows "Joe\'s Eyes Only"', /Joe's Eyes Only/.test(intNbd));
ok('internal-view / Oaks: banner shows "Internal Use Only" (no Joe)', /Internal Use Only/.test(intOak) && !/Joe's Eyes Only/.test(intOak));

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
process.exit(0);
