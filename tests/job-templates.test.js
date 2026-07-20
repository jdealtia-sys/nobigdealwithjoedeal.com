/**
 * tests/job-templates.test.js — JOB TEMPLATES harness (data + engine).
 *
 * Validates the two files being authored in parallel:
 *   docs/pro/js/job-templates-data.js  → window.NBD_JOB_TEMPLATES (~107
 *     templates) + window.NBD_JOB_TEMPLATE_CATEGORIES
 *   docs/pro/js/job-templates.js       → window.JobTemplates engine
 *     (resolveSelection / buildEstimatePayload per the v1 spec)
 *
 * Four sections:
 *   1. DATA VALIDATION  — schema rules over every template (ids, taxonomy,
 *      jobType enum, tags, item shapes, catalog code resolution incl.
 *      brandOptions, custom-item cost sanity, measurement-key whitelist,
 *      repair-family conventions, total count ≥ 100).
 *   2. RESOLUTION SMOKE — resolveSelection per template at tier 'better':
 *      no throw, finite positive totals.total, finite non-negative line
 *      quantities, retailTotal stamped ≥ 0 on every line.
 *   3. PAYLOAD CONTRACT — buildEstimatePayload for 3 representative
 *      selections (repair, full roof, multi-select repair pair):
 *      builder 'template', grandTotal === totals.total, classic row shape
 *      (code/desc/qty-string/'$'-rate/total===retailTotal) + the B-8
 *      reconstruction fields, and the cost-leak trap: with markup > 0 a
 *      material-bearing row's customer total must EXCEED its cost basis
 *      (money-math sweep 2026-07-18 — rows[].rate/total = RETAIL).
 *   4. OVERHEAD DEDUPE  — a two-repair selection merges shared overhead
 *      codes (LAB MOB / LAB DEMOB / LAB CLN-M / DSP HAUL / PRM RES-OH)
 *      down to at most one each; exactly one LAB MOB.
 *
 * SOFT-SKIP: while either job-templates file is missing (parallel
 * buildout), prints 'SKIP (files not present yet)' and exits 0 so CI
 * never hard-crashes mid-buildout. Once both files exist, every failure
 * is real and exits non-zero.
 *
 * Run: node tests/job-templates.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PRO_JS = path.join(ROOT, 'docs', 'pro', 'js');

const JT_DATA_PATH = path.join(PRO_JS, 'job-templates-data.js');
const JT_ENGINE_PATH = path.join(PRO_JS, 'job-templates.js');

// ── Soft-skip while the parallel authors haven't landed the files ──
if (!fs.existsSync(JT_DATA_PATH) || !fs.existsSync(JT_ENGINE_PATH)) {
  console.log('SKIP (files not present yet)');
  process.exit(0);
}

// ════════════════════════════════════════════════════════════════════
// Load the whole browser stack into ONE shared vm context (same window,
// same order the estimates bundle uses) so cross-file references
// (NBD_PRODUCTS → NBD_LABOR → EstimateBuilderV2.CATALOG → xact bridge →
// EstimateLogic → JobTemplates) all resolve exactly like in the app.
// ════════════════════════════════════════════════════════════════════
function makeSandbox() {
  const win = {};
  win.window = win;
  const store = {};
  const localStorageStub = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; },
    clear: function () { Object.keys(store).forEach(function (k) { delete store[k]; }); },
  };
  win.localStorage = localStorageStub;
  const sandbox = {
    window: win,
    localStorage: localStorageStub,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    document: {
      createElement: function () { return { style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, addEventListener() {}, setAttribute() {} }; },
      addEventListener() {}, removeEventListener() {},
      getElementById: function () { return null; },
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
    },
    navigator: {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, JSON,
  };
  vm.createContext(sandbox);
  return { win, sandbox };
}

const { win, sandbox } = makeSandbox();

// estimate-config.js is loaded first when present — it's what the browser
// does (estimate-builder-v2.js reads window.NBD_ESTIMATE_CONFIG, falling
// back to inline constants otherwise). Guarded: absence is non-fatal.
const CONFIG_PATH = path.join(PRO_JS, 'estimate-config.js');
const LOAD_ORDER = [
  CONFIG_PATH,
  path.join(PRO_JS, 'product-data.js'),
  path.join(PRO_JS, 'roofivent-catalog.js'),
  path.join(PRO_JS, 'estimate-labor-catalog.js'),
  path.join(PRO_JS, 'estimate-builder-v2.js'),
  path.join(PRO_JS, 'estimate-catalog-xactimate.js'),
  path.join(PRO_JS, 'estimate-logic-engine.js'),
  JT_DATA_PATH,
  JT_ENGINE_PATH,
];

for (const file of LOAD_ORDER) {
  if (file === CONFIG_PATH && !fs.existsSync(file)) continue; // optional
  let src;
  try { src = fs.readFileSync(file, 'utf8'); }
  catch (e) {
    console.log('FATAL: cannot read ' + path.basename(file) + ' — ' + e.message);
    process.exit(1);
  }
  try { vm.runInContext(src, sandbox, { filename: path.basename(file) }); }
  catch (e) {
    // A file that EXISTS but throws at load is a real defect (a missing
    // file already soft-skipped above) — surface it loudly.
    console.log('FATAL: ' + path.basename(file) + ' threw during load — ' + e.message);
    process.exit(1);
  }
}

// ── Contract globals ──
const TPLS = win.NBD_JOB_TEMPLATES;
const CATS = win.NBD_JOB_TEMPLATE_CATEGORIES;
const JT = win.JobTemplates;
const EL = win.EstimateLogic;
const XACT = win.NBD_XACT_CATALOG;
const LABOR = win.NBD_LABOR;
const V2 = win.EstimateBuilderV2;

// ════════════════════════════════════════════════════════════════════
// Test scaffold — ✗ lines only + per-section counts + grand summary.
// ════════════════════════════════════════════════════════════════════
let passed = 0, failed = 0; const fails = [];
let curSection = null, secPassed = 0, secFailed = 0;
const sectionResults = [];
function flushSection() {
  if (curSection !== null) {
    sectionResults.push({ name: curSection, passed: secPassed, failed: secFailed });
    console.log('  → ' + secPassed + ' passed, ' + secFailed + ' failed');
  }
}
function section(name) {
  flushSection();
  curSection = name; secPassed = 0; secFailed = 0;
  console.log('\n' + name);
}
function ok(name, cond, detail) {
  if (cond) { passed++; secPassed++; }
  else {
    failed++; secFailed++; fails.push(name);
    console.log('  ✗ ' + name + (detail ? ' — ' + detail : ''));
  }
}
function listOffenders(arr, max) {
  arr.slice(0, max || 12).forEach(function (m) { console.log('      - ' + m); });
  if (arr.length > (max || 12)) console.log('      … and ' + (arr.length - (max || 12)) + ' more');
}

// ── Bootstrap sanity: the contract globals must exist before anything
//    else is worth checking. ──
section('BOOTSTRAP — contract globals');
ok('window.NBD_JOB_TEMPLATES is a non-empty array', Array.isArray(TPLS) && TPLS.length > 0);
ok('window.NBD_JOB_TEMPLATE_CATEGORIES is an object', CATS && typeof CATS === 'object' && !Array.isArray(CATS));
ok('window.JobTemplates exposes resolveSelection()', JT && typeof JT.resolveSelection === 'function');
ok('window.JobTemplates exposes buildEstimatePayload()', JT && typeof JT.buildEstimatePayload === 'function');
ok('supporting stack loaded (EstimateLogic / NBD_XACT_CATALOG / NBD_LABOR / EstimateBuilderV2)',
  !!(EL && XACT && LABOR && V2));
if (!Array.isArray(TPLS) || !JT || typeof JT.resolveSelection !== 'function' || !EL) {
  flushSection();
  console.log('\n──────────────────────────────────────────────────');
  console.log(passed + ' passed, ' + failed + ' failed (aborted — contract globals missing)');
  process.exit(1);
}

// ════════════════════════════════════════════════════════════════════
// 1. DATA VALIDATION
// ════════════════════════════════════════════════════════════════════
section('DATA VALIDATION — ' + TPLS.length + ' templates');

const SPEC_CATEGORIES = [
  'roof_repair', 'leak_flashing', 'gutters_repair', 'gutters_install',
  'soffit_fascia', 'ventilation', 'roof_replacement', 'specialty_roofing',
  'storm_emergency', 'exterior', 'maintenance',
];
const JOB_TYPES = ['repair', 'replacement', 'install', 'maintenance', 'inspection', 'emergency'];
// Read the whitelist straight off the engine export (estimate-logic-engine.js).
const MEASUREMENT_VARS = EL.MEASUREMENT_VARS || [];
ok('engine exports MEASUREMENT_VARS whitelist', Array.isArray(MEASUREMENT_VARS) && MEASUREMENT_VARS.length > 0);

// Merged-catalog code resolver: xactimate index (find), labor catalog
// (get), or any EstimateBuilderV2.CATALOG entry carrying that .code
// (the xact bridge also lands there; native V2 keys count too).
const V2_CODES = new Set(
  Object.keys(V2.CATALOG || {})
    .map(function (k) { return V2.CATALOG[k] && V2.CATALOG[k].code; })
    .filter(Boolean)
);
function codeResolves(code) {
  if (typeof code !== 'string' || !code) return false;
  if (XACT && typeof XACT.find === 'function' && XACT.find(code)) return true;
  if (LABOR && typeof LABOR.get === 'function' && LABOR.get(code)) return true;
  if (V2_CODES.has(code)) return true;
  return false;
}

const eId = [], eDupId = [], eCat = [], eJobType = [], eText = [], eTags = [],
      eItemsMin = [], eItemShape = [], eCode = [], eBrand = [], eBrandFirst = [],
      eCustom = [], eMeas = [], eConvention = [];
const seenIds = new Set();

TPLS.forEach(function (t, idx) {
  const id = (t && t.id) ? t.id : '<template #' + idx + '>';

  // id: unique + /^jt_[a-z0-9_]+$/
  if (!t || typeof t.id !== 'string' || !/^jt_[a-z0-9_]+$/.test(t.id)) eId.push(id);
  if (t && t.id) {
    if (seenIds.has(t.id)) eDupId.push(t.id);
    seenIds.add(t.id);
  }
  if (!t) return;

  // category: must exist in BOTH the data file's categories object and
  // the spec taxonomy ("one of the taxonomy keys below (exact)").
  if (!CATS || !Object.prototype.hasOwnProperty.call(CATS, t.category) ||
      SPEC_CATEGORIES.indexOf(t.category) === -1) {
    eCat.push(id + ' (category=' + t.category + ')');
  }

  // jobType enum
  if (JOB_TYPES.indexOf(t.jobType) === -1) eJobType.push(id + ' (jobType=' + t.jobType + ')');

  // description + scopeNotes non-empty
  if (typeof t.description !== 'string' || !t.description.trim() ||
      typeof t.scopeNotes !== 'string' || !t.scopeNotes.trim()) eText.push(id);

  // tags: 1–8 lowercase non-empty strings
  if (!Array.isArray(t.tags) || t.tags.length < 1 || t.tags.length > 8 ||
      !t.tags.every(function (tag) { return typeof tag === 'string' && tag.length > 0 && tag === tag.toLowerCase(); })) {
    eTags.push(id);
  }

  // items: array with >= 2 entries
  const items = t.items;
  if (!Array.isArray(items) || items.length < 2) { eItemsMin.push(id); return; }

  items.forEach(function (it, i) {
    const label = id + ' items[' + i + ']';
    if (!it || typeof it !== 'object') { eItemShape.push(label + ' (not an object)'); return; }
    const isCoded = typeof it.code === 'string' && it.code.length > 0;
    const isCustom = it.custom && typeof it.custom === 'object';
    if (isCoded === isCustom) { // neither, or both
      eItemShape.push(label + ' (must be exactly one of {code} / {custom})');
      return;
    }
    if (isCoded) {
      if (!codeResolves(it.code)) eCode.push(label + ' code "' + it.code + '" not in merged catalog');
      // qty when present must at least be a finite non-negative number
      if (it.qty != null && (!Number.isFinite(Number(it.qty)) || Number(it.qty) < 0)) {
        eItemShape.push(label + ' qty "' + it.qty + '" not a finite number >= 0');
      }
      if (it.brandOptions != null) {
        if (!Array.isArray(it.brandOptions) || it.brandOptions.length < 1) {
          eBrand.push(label + ' brandOptions not a non-empty array');
        } else {
          it.brandOptions.forEach(function (b, bi) {
            if (!b || typeof b.code !== 'string' || !codeResolves(b.code)) {
              eBrand.push(label + ' brandOptions[' + bi + '] code "' + (b && b.code) + '" not in merged catalog');
            }
          });
          if (!it.brandOptions[0] || it.brandOptions[0].code !== it.code) {
            eBrandFirst.push(label + ' (first brandOption ' + (it.brandOptions[0] && it.brandOptions[0].code) + ' != item code ' + it.code + ')');
          }
        }
      }
    } else { // custom
      const c = it.custom;
      const qty = Number(c.qty);
      const mat = Number(c.materialCost);
      const lab = Number(c.laborCost);
      if (typeof c.name !== 'string' || !c.name.trim()) eCustom.push(label + ' custom name empty');
      if (typeof c.unit !== 'string' || !c.unit.trim()) eCustom.push(label + ' custom unit empty');
      if (!Number.isFinite(qty) || qty <= 0) eCustom.push(label + ' custom qty must be > 0 (got ' + c.qty + ')');
      if (!Number.isFinite(mat) || mat < 0) eCustom.push(label + ' custom materialCost must be >= 0 (got ' + c.materialCost + ')');
      if (!Number.isFinite(lab) || lab < 0) eCustom.push(label + ' custom laborCost must be >= 0 (got ' + c.laborCost + ')');
      if (Number.isFinite(mat) && Number.isFinite(lab) && !(mat > 0 || lab > 0)) {
        eCustom.push(label + ' custom material+labor both 0 (at least one must be > 0)');
      }
    }
  });

  // measurements: null (or absent = measurement-driven) OR an object whose
  // keys all sit inside the engine's MEASUREMENT_VARS whitelist.
  if (t.measurements != null) {
    if (typeof t.measurements !== 'object' || Array.isArray(t.measurements)) {
      eMeas.push(id + ' (measurements is not an object/null)');
    } else {
      const bad = Object.keys(t.measurements).filter(function (k) { return MEASUREMENT_VARS.indexOf(k) === -1; });
      if (bad.length) eMeas.push(id + ' (off-whitelist keys: ' + bad.join(', ') + ')');
    }
  }

  // Spec convention: fixed-scope jobTypes carry baked measurements + a
  // trip-charge floor (repairs/installs 350–1500 typical).
  if (['repair', 'maintenance', 'inspection', 'emergency'].indexOf(t.jobType) !== -1) {
    if (t.measurements == null) eConvention.push(id + ' (' + t.jobType + ' needs measurements != null)');
    if (!Number.isFinite(Number(t.minJobCharge)) || Number(t.minJobCharge) <= 0) {
      eConvention.push(id + ' (' + t.jobType + ' needs minJobCharge set, got ' + t.minJobCharge + ')');
    }
  }
});

ok('total template count >= 100 (got ' + TPLS.length + ')', TPLS.length >= 100);
ok('every id matches /^jt_[a-z0-9_]+$/', eId.length === 0); listOffenders(eId);
ok('ids are globally unique', eDupId.length === 0); listOffenders(eDupId);
ok('every category is a spec taxonomy key present in NBD_JOB_TEMPLATE_CATEGORIES', eCat.length === 0); listOffenders(eCat);
ok('every jobType is in the spec enum', eJobType.length === 0); listOffenders(eJobType);
ok('description + scopeNotes non-empty on every template', eText.length === 0); listOffenders(eText);
ok('tags: 1-8 lowercase non-empty strings on every template', eTags.length === 0); listOffenders(eTags);
ok('every template has >= 2 items', eItemsMin.length === 0); listOffenders(eItemsMin);
ok('every item is exactly one of coded {code} / {custom} with sane qty', eItemShape.length === 0); listOffenders(eItemShape);
ok('every coded item resolves in the merged catalog (xact.find / NBD_LABOR.get / V2 CATALOG codes)', eCode.length === 0); listOffenders(eCode);
ok('every brandOption code resolves in the merged catalog', eBrand.length === 0); listOffenders(eBrand);
ok('first brandOption equals the item\'s own code (the default)', eBrandFirst.length === 0); listOffenders(eBrandFirst);
ok('custom items: name/unit non-empty, qty > 0, costs >= 0, at least one > 0', eCustom.length === 0); listOffenders(eCustom);
ok('measurements: null or keys ⊆ engine MEASUREMENT_VARS whitelist', eMeas.length === 0); listOffenders(eMeas);
ok('repair/maintenance/inspection/emergency templates bake measurements + minJobCharge', eConvention.length === 0); listOffenders(eConvention);

// ════════════════════════════════════════════════════════════════════
// 2. RESOLUTION SMOKE — every template, tier 'better'
// ════════════════════════════════════════════════════════════════════
section('RESOLUTION SMOKE — resolveSelection per template (tier better)');

// Measurements handed to measurement-driven templates (reroofs etc. that
// author measurements: null and expect the rep to type real numbers).
const SMOKE_MEASUREMENTS = {
  rawSqft: 2400, pitch: 6, ridgeLf: 40, eaveLf: 120, rakeLf: 60,
  valleyLf: 20, pipes: 3, stories: 1, tearOffLayers: 1,
};

const smokeErrs = [];
const smokeWarnings = [];
let smokeRan = 0;
TPLS.forEach(function (t) {
  if (!t || typeof t.id !== 'string') return; // already flagged in DATA
  smokeRan++;
  let res;
  try {
    const opts = { tier: 'better' };
    if (t.measurements == null) opts.measurements = SMOKE_MEASUREMENTS;
    res = JT.resolveSelection([{ templateId: t.id }], opts);
  } catch (e) {
    smokeErrs.push(t.id + ': resolveSelection THREW — ' + e.message);
    return;
  }
  if (!res || typeof res !== 'object') { smokeErrs.push(t.id + ': resolveSelection returned ' + res); return; }
  // warnings: empty or explained. 'Unknown catalog code' / 'Unknown
  // template' mean the engine DROPPED a line (understated totals — the
  // silent-money-bug class) → hard failure. Anything else is printed as
  // info so a benign bridge notice doesn't redline the whole catalog.
  if (Array.isArray(res.warnings) && res.warnings.length) {
    res.warnings.forEach(function (w) {
      if (/^Unknown (catalog code|template)/.test(String(w))) {
        smokeErrs.push(t.id + ': DROPPED LINE — ' + w);
      } else {
        smokeWarnings.push(t.id + ': ' + w);
      }
    });
  }
  const totals = res.totals;
  if (!totals || typeof totals !== 'object') { smokeErrs.push(t.id + ': no totals object on result'); return; }
  const total = Number(totals.total);
  if (!Number.isFinite(total) || total <= 0) {
    smokeErrs.push(t.id + ': totals.total not finite/positive (got ' + totals.total + ')');
  }
  const lines = res.lines;
  if (!Array.isArray(lines) || lines.length === 0) { smokeErrs.push(t.id + ': no lines[] on result'); return; }
  lines.forEach(function (ln, i) {
    const q = Number(ln && ln.quantity);
    if (!Number.isFinite(q) || q < 0) {
      smokeErrs.push(t.id + ' lines[' + i + '] (' + (ln && ln.code) + '): quantity not finite >= 0 (got ' + (ln && ln.quantity) + ')');
    }
    const rt = Number(ln && ln.retailTotal);
    if (!Number.isFinite(rt) || rt < 0) {
      smokeErrs.push(t.id + ' lines[' + i + '] (' + (ln && ln.code) + '): retailTotal not stamped >= 0 (got ' + (ln && ln.retailTotal) + ')');
    }
  });
});
ok('resolveSelection clean for all ' + smokeRan + ' templates (no throw, finite totals.total > 0, line qty finite >= 0, retailTotal stamped >= 0)',
  smokeErrs.length === 0, smokeErrs.length + ' failure(s)');
listOffenders(smokeErrs, 25);
if (smokeWarnings.length) {
  console.log('  (info) ' + smokeWarnings.length + ' template(s) resolved with warnings:');
  listOffenders(smokeWarnings, 15);
}

// ════════════════════════════════════════════════════════════════════
// 3. PAYLOAD CONTRACT — 3 representative selections
// ════════════════════════════════════════════════════════════════════
section('PAYLOAD CONTRACT — buildEstimatePayload (repair / full roof / multi-select)');

function resolveAndBuild(label, selection, opts) {
  try {
    const res = JT.resolveSelection(selection, opts);
    const payload = JT.buildEstimatePayload(res, {
      name: 'Harness ' + label,
      customer: { name: 'Test Customer', address: '1 Test St' },
    });
    ok(label + ': resolve + buildEstimatePayload does not throw', true);
    return { res: res, payload: payload };
  } catch (e) {
    ok(label + ': resolve + buildEstimatePayload does not throw', false, e.message);
    return null;
  }
}

function checkPayload(label, built) {
  if (!built || !built.payload) { ok(label + ': payload produced', false); return; }
  const p = built.payload;
  const totals = (built.res && built.res.totals) || {};
  ok(label + ": builder === 'template'", p.builder === 'template', 'got ' + p.builder);
  ok(label + ': grandTotal === totals retail total (' + totals.total + ')',
    Number.isFinite(Number(p.grandTotal)) && Math.abs(Number(p.grandTotal) - Number(totals.total)) < 0.01,
    'grandTotal=' + p.grandTotal + ' totals.total=' + totals.total);
  const rows = p.rows;
  ok(label + ': rows[] present and non-empty', Array.isArray(rows) && rows.length > 0);
  if (!Array.isArray(rows)) return;

  const markup = Number(totals.materialMarkupPct != null ? totals.materialMarkupPct : 0.25);
  const rowErrs = [];
  rows.forEach(function (r, i) {
    const rid = 'row[' + i + '] ' + ((r && r.code) || '?');
    if (!r || typeof r !== 'object') { rowErrs.push(rid + ': not an object'); return; }
    if (typeof r.code !== 'string' || !r.code) rowErrs.push(rid + ': code missing');
    if (typeof r.desc !== 'string' || !r.desc) rowErrs.push(rid + ': desc missing');
    if (typeof r.qty !== 'string') rowErrs.push(rid + ': qty must be a string (got ' + typeof r.qty + ')');
    if (typeof r.rate !== 'string' || r.rate.charAt(0) !== '$') rowErrs.push(rid + ": rate must be a string starting '$' (got " + r.rate + ')');
    if (typeof r.total !== 'number' || !Number.isFinite(r.total)) rowErrs.push(rid + ': total must be a finite number (got ' + r.total + ')');
    if (!Number.isFinite(Number(r.retailTotal)) || Number(r.retailTotal) < 0) rowErrs.push(rid + ': retailTotal must be stamped >= 0 (got ' + r.retailTotal + ')');
    if (Number.isFinite(r.total) && Number.isFinite(Number(r.retailTotal)) && Math.abs(r.total - Number(r.retailTotal)) > 0.01) {
      rowErrs.push(rid + ': total (' + r.total + ') !== retailTotal (' + r.retailTotal + ')');
    }
    // B-8 reconstruction fields (estimate-v2-ui.js save contract)
    if (typeof r.quantity !== 'number' || !Number.isFinite(r.quantity)) rowErrs.push(rid + ': B-8 quantity (number) missing');
    if (typeof r.unit !== 'string' || !r.unit) rowErrs.push(rid + ': B-8 unit missing');
    ['materialTotal', 'laborTotal', 'materialCostPerUnit', 'laborCostPerUnit'].forEach(function (f) {
      if (typeof r[f] !== 'number' || !Number.isFinite(r[f])) rowErrs.push(rid + ': B-8 ' + f + ' missing/non-numeric (got ' + r[f] + ')');
    });
    // THE cost-leak trap: rows[].total is CUSTOMER retail. With material
    // markup > 0, any material-bearing row priced at exactly
    // materialTotal + laborTotal is leaking the internal cost basis.
    if (markup > 0 &&
        Number.isFinite(r.materialTotal) && r.materialTotal > 0 &&
        Number.isFinite(r.laborTotal) && Number.isFinite(r.total)) {
      if (!(r.total > r.materialTotal + r.laborTotal + 0.005)) {
        rowErrs.push(rid + ': COST LEAK — total ' + r.total + ' does not exceed cost basis ' +
          (r.materialTotal + r.laborTotal) + ' despite markup ' + markup);
      }
    }
  });
  ok(label + ': every row satisfies classic shape + B-8 fields + retail/cost-leak rules (' + rows.length + ' rows)',
    rowErrs.length === 0, rowErrs.length + ' row error(s)');
  listOffenders(rowErrs, 20);
}

// Representative picks.
const repairA = TPLS.find(function (t) { return t && t.jobType === 'repair'; });
const fullRoof = TPLS.find(function (t) { return t && t.category === 'roof_replacement'; }) ||
                 TPLS.find(function (t) { return t && t.jobType === 'replacement'; });
// For the pair, prefer two repairs that EACH carry LAB MOB so the dedupe
// assertion ("exactly one") is well-posed.
const repairsWithMob = TPLS.filter(function (t) {
  return t && t.jobType === 'repair' && Array.isArray(t.items) &&
    t.items.some(function (it) { return it && it.code === 'LAB MOB'; });
});

ok('found a repair template', !!repairA, 'no jobType "repair" template in the data');
ok('found a full-roof template', !!fullRoof, 'no roof_replacement/replacement template in the data');
ok('found two repair templates carrying LAB MOB (for the dedupe check)', repairsWithMob.length >= 2,
  'got ' + repairsWithMob.length);

if (repairA) {
  const built = resolveAndBuild('repair (' + repairA.id + ')', [{ templateId: repairA.id }], { tier: 'better' });
  checkPayload('repair (' + repairA.id + ')', built);
}
if (fullRoof) {
  const opts = { tier: 'better' };
  if (fullRoof.measurements == null) opts.measurements = SMOKE_MEASUREMENTS;
  const built = resolveAndBuild('full roof (' + fullRoof.id + ')', [{ templateId: fullRoof.id }], opts);
  checkPayload('full roof (' + fullRoof.id + ')', built);
}

// ════════════════════════════════════════════════════════════════════
// 4. MULTI-SELECT — shared-overhead dedupe on a two-repair selection
// ════════════════════════════════════════════════════════════════════
section('MULTI-SELECT — overhead dedupe (two repair templates)');
const DEDUPE_CODES = ['LAB MOB', 'LAB DEMOB', 'LAB CLN-M', 'DSP HAUL', 'PRM RES-OH'];
if (repairsWithMob.length >= 2) {
  const a = repairsWithMob[0], b = repairsWithMob[1];
  const pairLabel = 'pair (' + a.id + ' + ' + b.id + ')';
  const built = resolveAndBuild(pairLabel, [{ templateId: a.id }, { templateId: b.id }], { tier: 'better' });
  if (built) {
    checkPayload(pairLabel, built);
    const countIn = function (arr, code) {
      return (arr || []).filter(function (x) { return x && x.code === code; }).length;
    };
    ok(pairLabel + ': exactly one LAB MOB line in resolved lines',
      countIn(built.res.lines, 'LAB MOB') === 1,
      'got ' + countIn(built.res.lines, 'LAB MOB'));
    ok(pairLabel + ': exactly one LAB MOB row in the payload',
      countIn(built.payload.rows, 'LAB MOB') === 1,
      'got ' + countIn(built.payload.rows, 'LAB MOB'));
    const dupes = DEDUPE_CODES.filter(function (c) { return countIn(built.res.lines, c) > 1; });
    ok(pairLabel + ': no shared overhead code appears more than once (' + DEDUPE_CODES.join(', ') + ')',
      dupes.length === 0, 'duplicated: ' + dupes.join(', '));
  }
} else {
  ok('multi-select dedupe exercised', false, 'fewer than 2 repair templates with LAB MOB — cannot pose the check');
}

// ════════════════════════════════════════════════════════════════════
// Summary — per-section counts + grand total; non-zero exit on failure.
// ════════════════════════════════════════════════════════════════════
flushSection();
console.log('\n──────────────────────────────────────────────────');
sectionResults.forEach(function (s) {
  console.log((s.failed ? 'FAIL' : 'PASS') + '  ' + s.name + '  (' + s.passed + ' passed, ' + s.failed + ' failed)');
});
console.log('──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
process.exit(0);
