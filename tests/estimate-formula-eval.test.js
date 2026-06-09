/**
 * tests/estimate-formula-eval.test.js — CSP-safe formula evaluator parity.
 *
 * V2-5 (estimate-qa-2026-06-08) replaced the formula path in
 * docs/pro/js/estimate-logic-engine.js's calcQuantity. Prod CSP ships
 * script-src WITHOUT 'unsafe-eval', so the old `new Function(...)` compile
 * THREW at runtime — every formula-based line quantity (drip-edge, ventilation,
 * decking, dumpster sizing, hurricane clips, …) silently resolved to 0. That
 * understated the line-item scope total, which is also the persisted CRM
 * grandTotal. The fix is `safeEvalFormula` — a recursive-descent evaluator over
 * the SAME bounded grammar validateFormula already enforces.
 *
 * This is a DIFFERENTIAL test: for every formula in the live catalog
 * (QTY_BY_CODE + QTY_BY_SUB) plus a battery of hand-written grammar stressors,
 * across many measurement contexts, it asserts the NEW evaluator (via
 * EstimateLogic.calcQuantity) returns the EXACT same number the OLD
 * `new Function` path would have. The old path is reconstructed here with the
 * identical signature the engine used (Math + 8 bare math helpers + every
 * MEASUREMENT_VAR), so "reference" == "what prod computed before CSP killed it".
 *
 * A failure means the CSP-safe parser diverges from JS arithmetic semantics on
 * some real catalog formula — a silent money bug. Parity here is the proof the
 * swap is safe to ship.
 *
 * Run: node tests/estimate-formula-eval.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/estimate-logic-engine.js'), 'utf8');

// Load estimate-logic-engine.js into a fresh vm with a window shim (the engine
// early-returns when window is undefined). Returns window.EstimateLogic.
function loadEngine() {
  const win = {};
  win.window = win;
  const sandbox = {
    window: win,
    console: { log() {}, warn() {}, error() {} },
    Math, JSON, Set, Date, Number, Object, parseFloat, isNaN,
  };
  vm.runInNewContext(SRC, sandbox, { filename: 'estimate-logic-engine.js' });
  return win.EstimateLogic;
}

const EL = loadEngine();
const MV = EL.MEASUREMENT_VARS;

// ── Reference evaluator: the EXACT old new Function() path. This is the trusted
//    oracle — what prod computed before CSP made new Function throw. Signature
//    and arg order mirror estimate-logic-engine.js pre-V2-5 byte-for-byte. ──
function refEval(formula, context) {
  const trimmed = String(formula).trim();
  let fn;
  try {
    fn = new Function(
      'Math', 'max', 'min', 'ceil', 'floor', 'round', 'abs', 'pow', 'sqrt',
      ...MV,
      `"use strict"; return (${trimmed});`
    );
  } catch (e) { return 0; }
  try {
    const args = MV.map(v => Number(context[v]) || 0);
    const result = fn(
      Math, Math.max, Math.min, Math.ceil, Math.floor, Math.round, Math.abs, Math.pow, Math.sqrt,
      ...args
    );
    return Number(result) || 0;
  } catch (e) { return 0; }
}

// ── Measurement contexts: built through the engine's own buildContext so the
//    derived vars (sq, adjustedSqft, pitchRatio) are computed exactly as prod
//    does. Coverage spans the boundaries the catalog formulas branch on:
//    pitch 7/8/12 (steep tiers), stories 1/2/3, sq 15/25/40 (dumpster sizing),
//    cutUp 0/1, plus an all-zero and a large roof. ──
const RAW_INPUTS = [
  { label: 'empty', raw: {} },
  { label: 'small-flat', raw: { rawSqft: 1200, pitch: 4, stories: 1, eaveLf: 80, rakeLf: 60, ridgeLf: 40, hipLf: 0, valleyLf: 0, wallLf: 10, pipes: 2, chimneys: 0, skylights: 0, structures: 1, tearOffLayers: 1 } },
  { label: 'mid-7pitch', raw: { rawSqft: 2400, pitch: 7, stories: 1, eaveLf: 120, rakeLf: 90, ridgeLf: 70, hipLf: 30, valleyLf: 24, wallLf: 35, pipes: 3, chimneys: 1, skylights: 1, structures: 1, tearOffLayers: 1 } },
  { label: 'steep-8pitch-2story', raw: { rawSqft: 3000, pitch: 8, stories: 2, eaveLf: 140, rakeLf: 110, ridgeLf: 80, hipLf: 40, valleyLf: 36, wallLf: 50, pipes: 4, chimneys: 1, skylights: 2, structures: 2, tearOffLayers: 2, cutUpRoof: 1 } },
  { label: 'verysteep-12pitch-3story', raw: { rawSqft: 4200, pitch: 12, stories: 3, eaveLf: 180, rakeLf: 150, ridgeLf: 100, hipLf: 60, valleyLf: 50, wallLf: 70, pipes: 6, chimneys: 2, skylights: 3, structures: 2, tearOffLayers: 3, cutUpRoof: 1, deckReplacePct: 0.25 } },
  { label: 'dumpster-15sq', raw: { rawSqft: 1500, pitch: 6, eaveLf: 100, rakeLf: 70, ridgeLf: 55 } },
  { label: 'dumpster-25sq', raw: { rawSqft: 2500, pitch: 6, eaveLf: 130, rakeLf: 95, ridgeLf: 75 } },
  { label: 'dumpster-40sq', raw: { rawSqft: 4000, pitch: 6, eaveLf: 175, rakeLf: 140, ridgeLf: 95 } },
  { label: 'huge', raw: { rawSqft: 9000, pitch: 10, stories: 2, eaveLf: 300, rakeLf: 240, ridgeLf: 160, hipLf: 90, valleyLf: 80, wallLf: 120, pipes: 8, chimneys: 3, skylights: 4, structures: 3, tearOffLayers: 2 } },
];
const CONTEXTS = RAW_INPUTS.map(r => ({ label: r.label, ctx: EL.buildContext(r.raw) }));

// ── Formula corpus: every live catalog formula + hand-written stressors that
//    exercise grammar paths the catalog may not (chained ternary, && / ||,
//    every comparison operator, unary ! and -, %, nested parens, Math.* member
//    vs bare helper, float literals). ──
const catalogFormulas = []
  .concat(Object.values(EL.QTY_BY_SUB))
  .concat(Object.values(EL.QTY_BY_CODE));

const STRESSORS = [
  '2 + 3 * 4',
  '(2 + 3) * 4',
  '10 % 3',
  '10 / 4',
  '-sq + 5',
  '!cutUpRoof ? 1 : 0',
  'pitch >= 8 && pitch < 12 ? sq : 0',
  'stories > 1 || cutUpRoof ? sq : 0',
  'pitch === 12 ? 1 : 0',
  'pitch !== 12 ? 1 : 0',
  'sq <= 15 ? 1 : (sq <= 25 ? 2 : 3)',
  'Math.max(1, Math.ceil(adjustedSqft / 300))',
  'max(min(sq, 40), 10)',
  'Math.floor(sq) + Math.round(pitchRatio)',
  'Math.pow(2, 3) + Math.sqrt(16)',
  'abs(0 - sq)',
  '1.5 * sq + 0.25',
  'eaveLf + rakeLf - hipLf',
  'sq > 0 ? adjustedSqft / sq : 0',
  'deckReplacePct * adjustedSqft',
];

const ALL_FORMULAS = Array.from(new Set(catalogFormulas.concat(STRESSORS)));

// ════════════════════════════════════════════════════════════════════
// Differential parity — every formula × every context: new == old.
// ════════════════════════════════════════════════════════════════════
console.log('\nFORMULA EVAL — differential parity (calcQuantity vs reference new Function)');
console.log('  ' + ALL_FORMULAS.length + ' unique formulas × ' + CONTEXTS.length + ' contexts = ' +
            (ALL_FORMULAS.length * CONTEXTS.length) + ' comparisons');

let mismatches = 0;
for (const formula of ALL_FORMULAS) {
  for (const { label, ctx } of CONTEXTS) {
    const got = EL.calcQuantity(formula, ctx);
    const want = refEval(formula, ctx);
    const same = (got === want) || (Number.isNaN(got) && Number.isNaN(want));
    if (!same) {
      mismatches++;
      console.log('  ✗ MISMATCH  [' + label + ']  `' + formula + '`  →  new=' + got + '  old=' + want);
    }
  }
}
ok('all catalog + stressor formulas match the old engine in every context', mismatches === 0);

// ════════════════════════════════════════════════════════════════════
// Explicit value checks — pin a few results so a parity bug that happens
// to agree-while-both-wrong still gets caught against hand-computed truth.
// ════════════════════════════════════════════════════════════════════
console.log('\nFORMULA EVAL — explicit hand-computed values');
const C0 = EL.buildContext({ rawSqft: 2400, pitch: 8, stories: 2, eaveLf: 120, rakeLf: 80, ridgeLf: 70, hipLf: 30, cutUpRoof: 1 });
// sq = rawSqft × waste(1.17) ÷ 100 = 2400 × 1.17 / 100 = 28.08
ok('sq derives to 28.08', Math.abs(C0.sq - 28.08) < 1e-9);
ok('2 + 3 * 4 === 14', EL.calcQuantity('2 + 3 * 4', C0) === 14);
ok('(2 + 3) * 4 === 20', EL.calcQuantity('(2 + 3) * 4', C0) === 20);
ok('10 % 3 === 1', EL.calcQuantity('10 % 3', C0) === 1);
ok('eaveLf + rakeLf === 200', EL.calcQuantity('eaveLf + rakeLf', C0) === 200);
ok('pitch >= 8 ? sq : 0 === sq (28.08)', EL.calcQuantity('pitch >= 8 ? sq : 0', C0) === 28.08);
ok('pitch >= 12 ? sq : 0 === 0 (pitch 8)', EL.calcQuantity('pitch >= 12 ? sq : 0', C0) === 0);
ok('stories > 1 ? sq : 0 === sq', EL.calcQuantity('stories > 1 ? sq : 0', C0) === 28.08);
ok('cutUpRoof ? sq : 0 === sq', EL.calcQuantity('cutUpRoof ? sq : 0', C0) === 28.08);
ok('max(1, Math.ceil(28.08*1.17... )) ventilation > 0', EL.calcQuantity('max(1, Math.ceil(adjustedSqft / 300))', C0) >= 1);
// dumpster bracket: sq 28.08 → 30YD bucket (sq>25 && sq<=40) = 1, others 0
ok('DSP 10YD (sq<=15) === 0', EL.calcQuantity('sq <= 15 ? 1 : 0', C0) === 0);
ok('DSP 30YD (sq>25 && sq<=40) === 1', EL.calcQuantity('sq > 25 && sq <= 40 ? 1 : 0', C0) === 1);
ok('DSP 40YD (sq>40) === 0', EL.calcQuantity('sq > 40 ? 1 : 0', C0) === 0);

// ════════════════════════════════════════════════════════════════════
// Security parity — the whitelist still rejects escapes (returns 0), and
// the evaluator never reaches into objects/strings.
// ════════════════════════════════════════════════════════════════════
console.log('\nFORMULA EVAL — sandbox still rejects escapes');
ok('blocks constructor escape', EL.calcQuantity('sq.constructor', C0) === 0);
ok('blocks window access', EL.calcQuantity('window', C0) === 0);
ok('blocks process access', EL.calcQuantity('process.exit(1)', C0) === 0);
ok('blocks string literal', EL.calcQuantity('"x"', C0) === 0);
ok('blocks bracket access', EL.calcQuantity('sq[0]', C0) === 0);
ok('unknown identifier resolves to 0', EL.calcQuantity('notAVar * 2', C0) === 0);

console.log('\n──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
process.exit(0);
