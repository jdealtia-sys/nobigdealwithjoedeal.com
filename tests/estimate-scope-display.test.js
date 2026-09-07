/**
 * tests/estimate-scope-display.test.js
 *
 * Three defects Joe hit on the same estimate, all of which made correct
 * arithmetic look broken, plus the Settings control that was supposed to
 * govern the first of them and never reached the engine.
 *
 *   1. QUANTITY WAS ROUNDED IN THE LABEL, NOT THE MATH.
 *      renderScope formatted quantity with one decimal for SQ and LF and
 *      ZERO decimals for everything else. A 1.5-hour detail line therefore
 *      rendered as "2 HR" beside its correct $127.50 total — and $85/hr x
 *      2 HR is $170, so the line read as arithmetic that was 25% short.
 *      Nothing was wrong with the money. The label was lying about the
 *      quantity. A quantity label must never round a fraction away.
 *
 *   2. THE BUILDER PRINTED COST WHERE EVERY DOCUMENT PRINTS RETAIL.
 *      resolveEstimate stamps lineTotal (contractor COST) and retailTotal
 *      (what the customer pays: material at markup, labor as-is) on every
 *      line. The customer documents print retailTotal. Both scope panels in
 *      the builder printed lineTotal, so 20 LF of drip edge read $52 on
 *      screen and $61.75 on the PDF, and the per-line numbers never footed
 *      to the headline the rep was quoting.
 *
 *   3. NET CLAIM PRINTED AS A NEGATIVE.
 *      formatInsuranceScope printed rcv - deductible raw. A loss under the
 *      deductible produced "NET CLAIM ($1,300.00)" on paper going to a
 *      homeowner and an adjuster, which reads as though the carrier is owed
 *      money. Below the deductible there is no claim — the figure is zero
 *      and the document has to say why.
 *
 *   4. THE MINIMUM-CHARGE CONTROL DID NOT REACH THE LINE-ITEM ENGINE.
 *      #1470 removed the hidden $2,500 default that quoted a $555 pipe-boot
 *      repair at $2,500 — correctly, because a floor should be opt-in. But
 *      the only Settings field that looked like the opt-in was the PER-SQ
 *      minimum, which the line-item path never read. There is now a separate
 *      Repair Minimum that defaults to 0 (no floor) and IS forwarded, with
 *      a template's or preset's own floor still winning over it.
 *
 * Run: node tests/estimate-scope-display.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (extra ? '  — ' + extra : '')); }
}

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── loaders ───────────────────────────────────────────────────────────
function loadV2UI(settings) {
  const win = {}; win.window = win;
  win.EstimateLogic = { resolveEstimate: () => ({}), buildContext: (x) => x, MEASUREMENT_VARS: [] };
  win.EstimateBuilderV2 = {
    loadSettings: () => Object.assign({ countyTax: {} }, settings || {}),
    calculateAllTiers: () => ({}), calculatePerSq: () => ({}),
  };
  const sandbox = {
    window: win,
    console: { log() {}, warn() {}, error() {} },
    document: {
      createElement: () => ({ style: {}, appendChild() {}, addEventListener() {} }),
      addEventListener() {}, getElementById: () => null, querySelector: () => null,
    },
    Date, Math, JSON, Set, setTimeout, navigator: {}, localStorage: { getItem: () => null, setItem() {} },
  };
  vm.runInNewContext(read('docs/pro/js/estimate-v2-ui.js'), sandbox, { filename: 'estimate-v2-ui.js' });
  return win.EstimateV2UI._test;
}

function loadEngineStack() {
  const win = {}; win.window = win;
  const sandbox = {
    window: win, console: { log() {}, warn() {}, error() {} },
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] },
    Date, Math, JSON, Set, Map, localStorage: { getItem: () => null, setItem() {} },
  };
  ['docs/pro/js/product-data.js',
   'docs/pro/js/estimate-labor-catalog.js',
   'docs/pro/js/estimate-catalog-xactimate.js',
   'docs/pro/js/estimate-logic-engine.js'].forEach((f) => {
    vm.runInNewContext(read(f), sandbox, { filename: f });
  });
  return win;
}

function loadFin() {
  const win = {}; win.window = win;
  vm.runInNewContext(read('docs/pro/js/estimate-finalization.js'),
    { window: win, console: { log() {}, warn() {}, error() {} }, Date, Math, JSON, Set },
    { filename: 'estimate-finalization.js' });
  return win.EstimateFinalization;
}

const T = loadV2UI();
const ENV = loadEngineStack();
const EL = ENV.EstimateLogic;
const CAT = ENV.NBD_XACT_CATALOG;
const FIN = loadFin();

// ════════════════════════════════════════════════════════════════════
// 1 — a quantity label never rounds a fraction to a whole number
// ════════════════════════════════════════════════════════════════════
console.log('\nSCOPE DISPLAY — quantity labels');

ok('the exact regression: 1.5 HR does not render as "2"', T.fmtQty(1.5, 'HR') === '1.5',
   'got ' + JSON.stringify(T.fmtQty(1.5, 'HR')));
ok('1.5 HR is not rendered as "2" under any casing', T.fmtQty(1.5, 'hr') === '1.5');
ok('a whole hour stays whole', T.fmtQty(2, 'HR') === '2');
ok('quarter hours survive', T.fmtQty(0.25, 'HR') === '0.25');
ok('EA fractions survive', T.fmtQty(2.5, 'EA') === '2.5');
ok('whole EA has no decimal tail', T.fmtQty(3, 'EA') === '3');
ok('SQ keeps the one-decimal house format', T.fmtQty(23, 'SQ') === '23.0');
ok('LF keeps the one-decimal house format', T.fmtQty(160, 'LF') === '160.0');
ok('LF fraction is not rounded away', T.fmtQty(160.5, 'LF') === '160.5');
// Job templates ship sub-square scopes (0.35 SQ, 0.7 SQ). One decimal would
// print 0.35 SQ as "0.4 SQ" — the same lie in a different unit.
ok('a 0.35 SQ template scope is not shown as 0.4', T.fmtQty(0.35, 'SQ') === '0.35');
ok('a 0.7 SQ template scope keeps the house format', T.fmtQty(0.7, 'SQ') === '0.7');
ok('1.5 SQ keeps the house format', T.fmtQty(1.5, 'SQ') === '1.5');
ok('missing quantity reads 0, never NaN', T.fmtQty(undefined, 'HR') === '0');
ok('a missing unit still refuses to round', T.fmtQty(1.5, '') === '1.5');
ok('DAY fractions survive (half-day crews)', T.fmtQty(0.5, 'DAY') === '0.5');

// No unit may round a fraction to an integer. This is the property the old
// code violated; assert it across every unit the catalogs actually use.
const UNITS = ['SQ', 'LF', 'EA', 'HR', 'JOB', 'DAY', 'SF'];
let roundedAway = [];
UNITS.forEach((u) => {
  [0.25, 0.5, 1.5, 2.75, 3.4].forEach((q) => {
    if (Number(T.fmtQty(q, u)) !== q) roundedAway.push(u + ':' + q + '→' + T.fmtQty(q, u));
  });
});
ok('no unit rounds a fractional quantity to a different number', roundedAway.length === 0,
   roundedAway.join(', '));

// ════════════════════════════════════════════════════════════════════
// 2 — the builder shows the same number the document shows
// ════════════════════════════════════════════════════════════════════
console.log('SCOPE DISPLAY — cost vs retail');

// Synthetic costs and codes: catalog-cost-seed.test.js forbids quoting a real
// published cost pair outside docs/, and this suite is about which of the two
// stamped figures gets displayed, not about any particular price.
const LINE = {
  code: 'TST LF-A', name: 'Linear trim (synthetic)', unit: 'LF', quantity: 20,
  materialCostPerUnit: 2.00, laborCostPerUnit: 0.50,
  materialTotal: 40, laborTotal: 10, lineTotal: 50,
  retailTotal: 60, retailPerUnit: 3.00,
};

ok('a line with retailTotal displays retail, not cost', T.lineRetail(LINE, 0.25) === 60);
ok('cost and retail are genuinely different here', LINE.lineTotal !== LINE.retailTotal);

// Docs saved before retailTotal existed: derive it from the material/labor
// split at the persisted markup rather than falling back to cost.
const LEGACY = { materialTotal: 40, laborTotal: 10, lineTotal: 50 };
ok('a pre-retailTotal line derives retail from the split', T.lineRetail(LEGACY, 0.25) === 60);
ok('a pre-retailTotal line honors a non-default markup', T.lineRetail(LEGACY, 0.50) === 70);
ok('a pre-retailTotal line falls back to 25% when markup is absent',
   T.lineRetail(LEGACY, undefined) === 60);

// Pass-through fees (measurement report, e-sign) carry no cost basis and are
// charged at face — retail must equal face, never zero.
const PASSTHRU = { code: 'SVC CUSTOM', quantity: 1, unitPrice: 75, lineTotal: 75, retailTotal: 75 };
ok('a pass-through fee displays at face', T.lineRetail(PASSTHRU, 0.25) === 75);
const PASSTHRU_LEGACY = { code: 'SVC CUSTOM', quantity: 1, unitPrice: 75, lineTotal: 75 };
ok('a pass-through with no retailTotal still displays at face',
   T.lineRetail(PASSTHRU_LEGACY, 0.25) === 75);
ok('a null line is 0, not a crash', T.lineRetail(null, 0.25) === 0);

// The real engine, end to end: the figure the builder now shows is the figure
// the document shows, and Σ retail == retailBeforeOHP by identity.
const MEAS = { rawSqft: 2000, pitch: 6, waste: 1.17, eaveLf: 100, rakeLf: 60, ridgeLf: 40,
               hipLf: 0, valleyLf: 0, wallLf: 0, pipes: 2, chimneys: 0, skylights: 0,
               stories: 1, tearOffLayers: 1, deckReplacePct: 0 };
function resolveOne(code, qty, settings) {
  const base = CAT.find(code);
  if (!base) return null;
  const item = Object.assign({}, base, qty != null ? { _qtyOverride: qty } : {});
  return EL.resolveEstimate([item], MEAS, Object.assign({ tier: 'better', mode: 'cash', county: '' }, settings || {}));
}
const de = resolveOne('RFG DRPE-AL', 20);
ok('engine stamps both figures on a drip-edge line',
   !!de && de.lines[0].lineTotal > 0 && de.lines[0].retailTotal > 0);
ok('engine cost and retail differ on a material line',
   !!de && de.lines[0].retailTotal > de.lines[0].lineTotal);
ok('the displayed figure IS the engine retail figure',
   !!de && T.lineRetail(de.lines[0], de.materialMarkupPct) === de.lines[0].retailTotal);
ok('Σ displayed line totals == retailBeforeOHP',
   !!de && Math.abs(de.lines.reduce((s, l) => s + T.lineRetail(l, de.materialMarkupPct), 0)
                    - de.retailBeforeOHP) < 0.005);

// An hourly line carries no material, so cost and retail coincide — the money
// was never the problem on those lines, which is the whole point of test 1.
const hr = resolveOne('LAB DTL-HR', 2);
ok('a labor-only hourly line prices the same at cost and retail',
   !!hr && hr.lines[0].lineTotal === hr.lines[0].retailTotal);
ok('2 hours of detail work is 2 x the hourly rate',
   !!hr && hr.lines[0].lineTotal === 2 * hr.lines[0].laborCostPerUnit);
ok('and it is displayed as 2 hours, not rounded from something else',
   !!hr && T.fmtQty(hr.lines[0].quantity, hr.lines[0].unit) === '2');

// ════════════════════════════════════════════════════════════════════
// 3 — NET CLAIM is floored at zero and explained
// ════════════════════════════════════════════════════════════════════
console.log('SCOPE DISPLAY — NET CLAIM below the deductible');

function insuranceDoc(total, deductible) {
  const est = {
    method: 'line-item', tier: 'better', mode: 'insurance',
    context: { rawSqft: 400, adjustedSqft: 440, sq: 4.4, waste: 1.1, eaveLf: 40, ridgeLf: 0, hipLf: 0, pipes: 1 },
    lines: [{ code: 'TST JOB-A', name: 'Repair (synthetic)', category: 'labor', quantity: 1, unit: 'JOB',
              materialCostPerUnit: 0, laborCostPerUnit: total, materialTotal: 0, laborTotal: total,
              lineTotal: total, retailTotal: total, codeRefs: {} }],
    materialCost: 0, laborCost: total, materialRetail: 0, materialMarkupPct: 0.25,
    retailBeforeOHP: total, overhead: 0, overheadPct: 0.10, profit: 0, profitPct: 0.10,
    subtotal: total, tax: 0, taxRate: 0, total: total, minJobApplied: false,
    internal: { margin: 0, marginPct: 0 },
  };
  return FIN.formatEstimate(est, 'insurance-scope', {
    customer: { name: 'Test Homeowner', address: '1 Main St' },
    claim: { carrier: 'Test Mutual', number: 'CLM-1', deductible: deductible, dateOfLoss: '2026-04-01' },
  });
}

const under = insuranceDoc(1200, 2500);
const rendered = !!(under && under.html && under.html.length > 500);
ok('the below-deductible document renders at all', rendered,
   under && under.html ? ('html len ' + under.html.length) : 'no html');
ok('netClaim is floored at zero, not -1300', rendered && under.netClaim === 0,
   rendered ? String(under.netClaim) : 'not rendered');
ok('the document flags it as below the deductible', rendered && under.belowDeductible === true);
ok('NET CLAIM appears on the page', rendered && /NET CLAIM/.test(under.html));
ok('no parenthesised negative claim is printed',
   rendered && !/NET CLAIM[\s\S]{0,200}?\(\$1,300/.test(under.html));
ok('no minus-signed claim is printed',
   rendered && !/NET CLAIM[\s\S]{0,200}?-\$/.test(under.html));
ok('the page explains that there is no recoverable claim',
   rendered && /no recoverable claim/i.test(under.html));
ok('the explanation names the deductible', rendered && /below the \$2,500/.test(under.html));
ok('the RCV is still stated as the price of the work',
   rendered && /REPLACEMENT COST VALUE/.test(under.html));

// Exactly at the deductible is still no claim.
const at = insuranceDoc(2500, 2500);
ok('a loss exactly at the deductible nets zero', at && at.netClaim === 0);
ok('a loss exactly at the deductible is flagged', at && at.belowDeductible === true);

// Above the deductible is unchanged — the ordinary case must not regress.
const over = insuranceDoc(9000, 2500);
ok('a normal claim still nets rcv - deductible', over && over.netClaim === 6500);
ok('a normal claim is not flagged below-deductible', over && over.belowDeductible === false);
ok('a normal claim prints no below-deductible note',
   over && !/no recoverable claim/i.test(over.html));
ok('a normal claim prints its net figure', over && /\$6,500/.test(over.html));

// No deductible on file: netClaim is the RCV, as before.
const noDed = insuranceDoc(9000, 0);
ok('with no deductible the net claim is the RCV', noDed && noDed.netClaim === 9000);
ok('with no deductible nothing is flagged', noDed && noDed.belowDeductible === false);

// ════════════════════════════════════════════════════════════════════
// 4 — the repair minimum is opt-in, reaches the engine, and yields
// ════════════════════════════════════════════════════════════════════
console.log('SCOPE DISPLAY — repair minimum');

const T_NOSET  = loadV2UI({});
const T_ZERO   = loadV2UI({ minRepairCharge: 0 });
const T_BLANK  = loadV2UI({ minRepairCharge: '' });
const T_SET    = loadV2UI({ minRepairCharge: 450 });
const T_PERSQ  = loadV2UI({ minJobCharge: 2500 });
const T_JUNK   = loadV2UI({ minRepairCharge: 'not a number' });
const T_NEG    = loadV2UI({ minRepairCharge: -100 });

ok('unset means no floor', T_NOSET.shopRepairMinimum() === 0);
ok('an explicit 0 means no floor', T_ZERO.shopRepairMinimum() === 0);
ok('a blank field means no floor', T_BLANK.shopRepairMinimum() === 0);
ok('a set floor is read back', T_SET.shopRepairMinimum() === 450);
ok('junk in the field is no floor, not NaN', T_JUNK.shopRepairMinimum() === 0);
ok('a negative can never become a floor', T_NEG.shopRepairMinimum() === 0);
ok('THE REGRESSION GUARD: the per-SQ minimum is not the repair minimum',
   T_PERSQ.shopRepairMinimum() === 0,
   'a $2,500 per-SQ roof-replacement floor must never reach a hand-built repair');

// The line-item rates the same panel promises "apply to every line-item
// estimate" must actually be forwarded.
const T_RATES = loadV2UI({ materialMarkupPct: 0.40, overheadPct: 0.15, profitPct: 0.12 });
const rates = T_RATES.shopLineItemRates();
ok('material markup is forwarded', rates.materialMarkupPct === 0.40);
ok('overhead is forwarded', rates.overheadPct === 0.15);
ok('profit is forwarded', rates.profitPct === 0.12);
const ratesBad = loadV2UI({ materialMarkupPct: 'x', overheadPct: null, profitPct: -1 }).shopLineItemRates();
ok('a non-numeric rate is dropped, not forwarded as NaN', !('materialMarkupPct' in ratesBad));
ok('a null rate is dropped', !('overheadPct' in ratesBad));
ok('a negative rate is dropped', !('profitPct' in ratesBad));
ok('an empty settings object forwards nothing', Object.keys(T_NOSET.shopLineItemRates()).length === 0);

// And the engine honours a floor when one is genuinely passed — while a
// small repair with no floor stays priced at what it is worth.
const small = resolveOne('LAB DTL-HR', 2, {});
ok('a small hand-built scope with no floor is not inflated',
   !!small && small.total < 500 && small.minJobApplied === false,
   small ? ('total ' + small.total) : 'unresolved');
const floored = resolveOne('LAB DTL-HR', 2, { minJobCharge: 450 });
ok('a floor that IS passed still applies', !!floored && floored.total === 450 && floored.minJobApplied === true);
ok('the engine reports the floor it used, so documents can name it',
   !!floored && floored.minJobCharge === 450);
ok('an unfloored estimate reports a zero floor', !!small && small.minJobCharge === 0);

// ── report ──
console.log('\n' + (failed === 0 ? 'PASS' : 'FAIL') + ' — ' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('Failures:\n  - ' + fails.join('\n  - ')); process.exit(1); }
