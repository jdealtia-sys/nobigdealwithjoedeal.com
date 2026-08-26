/**
 * tests/cost-basis-ledger.js — the ROTATION LEDGER, plus the catalog loader the
 * guard and the rotation scripts share.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Replaces KNOWN_UNMIGRATED (2026-08-19). That map asked ONE question of TWO
 * different things, and only one of them is answerable from this repo:
 *
 *   (a) does this file publish a contractor cost basis?
 *       OBSERVABLE, and for these files PERMANENT. The baseline is the
 *       product: strip it and the estimator does not degrade, it turns OFF
 *       (measured — a full reroof drops from $12,425 to the $2,500 minimum-job
 *       floor with every line at 0, because these values ARE the pricing and
 *       there is no public retail half to fall back on).
 *
 *   (b) is that published basis still the shop's ACTUAL cost?
 *       NOT OBSERVABLE. It stops being true when the figures are rotated, and
 *       rotation writes catalogCosts/{companyId} in Firestore. Not one byte of
 *       this repo moves. NO TEST CAN SEE IT, and any mechanism that claims to
 *       detect it automatically is lying about what it can do.
 *
 * The non-vacuity assertion only ever checked (a) — `basisByFile.get(f).length
 * > 0` — while its label claimed (b): "KNOWN UNMIGRATED still leaking, keep
 * tracking it". The day rotation lands, the file is byte-identical, the sweep
 * still finds 276 pairs, the assertion still passes, and the guard goes on
 * printing a sentence that has become false. Nothing prompts a revisit. That
 * is a list rotting into a permanent carve-out by a route non-vacuity
 * structurally cannot see: the file still matches and the REASON changed.
 *
 * ── SO: (a) IS ASSERTED, (b) IS SIGNED ─────────────────────────────────────
 *
 * `rotation: null` is the honest default, and it is what the guard PRINTS on a
 * green run: "these published figures ARE the shop's cost basis today".
 * Nothing in the tree may say otherwise while it is null — not this file, not
 * the guard, and not the published file's own header (all three said otherwise
 * on 2026-08-19, which is what prompted this rewrite).
 *
 * A rotation record is a dated, named, PER-TENANT claim by a human, pasted
 * from what scripts/import-cost-rotation.js prints AFTER a successful write —
 * the one moment anybody in the universe knows the rotation happened, with the
 * person who did it standing there. Nothing is auto-detected, nothing reads
 * Firestore, and nothing here can prove a rotation occurred. That limit is
 * real and is stated in the guard's own output rather than papered over.
 *
 * ── WHAT KEEPS A SIGNED CLAIM FROM AGEING INTO FICTION ─────────────────────
 *
 * `basisAt` is the COMMIT the claim was made against, not a digest. The guard
 * loads the catalog at that commit and at the worktree and compares the
 * published figures PER KEY. A rotation claim covers the numbers it was made
 * about; if an existing line item is later REPRICED, the claim no longer
 * covers what is published, and the guard says so.
 *
 * A commit sha rather than a hash because THERE IS NOTHING TO PASTE. The
 * cheapest response to a hash mismatch is to paste the hash the failure just
 * printed — a one-line diff that reads like housekeeping and silently
 * re-certifies whatever just changed. There is no equivalent move here: to
 * clear a repricing you revert it, or you record a NEW rotation, dated and
 * signed, against a new commit. Re-pointing `basisAt` at HEAD without moving
 * `at` fails the consistency check below (`at` may not precede `basisAt`'s
 * commit date), so the evasion is not a hex edit — it is a fabricated,
 * attributable claim about live money.
 *
 * REPRICING ONLY, never composition. Measured over the entire history of all
 * three catalogs (24 commits: two refactors, a security strip, the TAMKO
 * preset, two warranty-accuracy corrections, the county-permit unification,
 * the globals tranche, the crew-productivity migration): line items were added
 * 9 times and removed 3 times, and an existing key's published cost value was
 * REPRICED exactly ZERO times. A whole-multiset digest fires on 3 of those and
 * every one is a false positive; the per-key repricing check fires on none of
 * them. This repo has already had a guard loosened after it fired on a CORRECT
 * change, so the precision is not fastidiousness — it is the difference
 * between a mechanism that survives and one the next person turns off.
 *
 * The published FIELDS are DERIVED (`fields` minus `unpublished` in
 * functions/cost-basis-registry.js), never listed here. That is what makes the
 * crew-productivity migration a no-op for this check instead of 66 phantom
 * repricings, and it is why a future field migration cannot fire it either.
 *
 * NO FIGURE APPEARS IN THIS FILE, and none may. It records WHEN, WHO, WHICH
 * TENANT and WHICH COMMIT — never a number. Layer 2b of the guard enforces
 * that: a real published cost pair quoted anywhere outside docs/ fails.
 *
 * Pure CommonJS, Node builtins + git. No dependencies, no side effects.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REG = require(path.join(ROOT, 'functions', 'cost-basis-registry.js'));

/**
 * THE LEDGER. One row per catalog that still publishes a cost basis, keyed by
 * the registry's catalog id so there is no second list of files, fields or
 * entry shapes anywhere.
 *
 *   publishedIn   the file this row is about. Asserted published, and asserted
 *                 to load > 0 priced entries — a STRUCTURAL count via the
 *                 registry, so a blinded regex can never make the row vacuous.
 *                 That is the exact failure that took the labor catalog off
 *                 the old list.
 *   sweptByShape  does layer 4's shape sweep see this file? Asserted in BOTH
 *                 directions, because each is a silent failure: declared true
 *                 and finding nothing means a pattern broke; declared false
 *                 and finding something means a migrated field came back.
 *   minEntries    a FLOOR with slack, not a count (66/276/28 today), in the
 *                 house shape of `rateCount >= 60` and `REAL_PAIRS.size >= 100`.
 *                 It asserts the baseline is still PRESENT — strip it and a
 *                 tenant with no cost book can no longer price anything, which
 *                 is the failure the baseline exists to prevent. Known limit,
 *                 stated so nobody over-trusts it: a floor does not catch a
 *                 PARTIAL strip. Nothing here does, pre-rotation.
 *   overrideMarker / overrideWhat
 *                 the tripwire that the tenant book still wins at pricing.
 *                 Every "deliberately published baseline" argument in this
 *                 codebase is downstream of it: remove the override path and
 *                 the baseline is not a starting point any more, it is simply
 *                 the price — the leak restored with a reassuring comment on
 *                 top. Two independent tokens, no proximity window (measured:
 *                 _withTenantCosts sits 15.5k chars from NBDCatalogCosts
 *                 because it is the helper, not the read — a proximity pin
 *                 here would be exactly the kind of syntax-pinning that got a
 *                 guard loosened on 2026-08-19).
 *   rotation      null, or a signed record. NOTHING INFERS IT.
 */
const LEDGER = {
  xact: {
    publishedIn: 'pro/js/estimate-catalog-xactimate.js',
    opened: '2026-08-10',
    sweptByShape: true,
    minEntries: 250,
    overrideMarker: /xactCost\s*\(/,
    overrideWhat: 'NBD_XACT_CATALOG.find → xactCosts',
    why:
      '276 mat/lab unit-cost line items (the file\'s own header names regional ' +
      'supplier pricing and in-house productivity as the source) served ' +
      'unauthenticated. Evaded the sweep for a month via abbreviated keys — now ' +
      'caught by COST_BASIS_ABBREV_RE. NOTHING CAN BE STRIPPED: mat/lab IS the ' +
      'pricing and there is no public retail half. The override path shipped ' +
      '2026-08-19 (NBD_XACT_CATALOG.find → xactCosts), so what is published is ' +
      'now a BASELINE a tenant outranks. It closes by ROTATION, not deletion.',
    rotation: null,
  },

  v2: {
    publishedIn: 'pro/js/estimate-builder-v2.js',
    opened: '2026-07-30',
    sweptByShape: true,
    minEntries: 25,
    overrideMarker: /_withTenantCosts\s*\(/,
    overrideWhat: 'EstimateBuilderV2 settings.catalog → v2Costs',
    why:
      '28 native CATALOG entries carrying cost + labor. Same class as the ' +
      'product-data.js leak, different subsystem (EstimateBuilderV2.CATALOG, ' +
      'not NBD_PRODUCTS). The hardcoded DEFAULT_COST_BASIS per-SQ figures WERE ' +
      'closed 2026-08-10 — zeroed, tenant-config only, still pinned at layer 4f ' +
      '— but the CATALOG entries remain and, like xact, cannot leave. Override ' +
      'path shipped 2026-08-19 (_withTenantCosts → v2Costs). Closes by rotation.',
    rotation: null,
  },

  labor: {
    publishedIn: 'pro/js/estimate-labor-catalog.js',
    opened: '2026-08-18',
    minEntries: 60,
    overrideMarker: /laborOp\s*\(/,
    overrideWhat: 'NBD_LABOR.get → laborOps',
    // FALSE, and that is the bug that killed the old list rather than an
    // oversight. COST_BASIS_LABOR_RE matches `rate:` PAIRED with
    // `hoursPerUnit:`; the productivity half migrated out on 2026-08-19 and
    // the pattern went blind on 66 still-published rates. Pairing is what
    // makes these patterns precise enough to run over 600 files; going blind
    // when one half leaves is its known price. This row exists so a
    // half-migrated file is tracked STRUCTURALLY, through the registry's entry
    // loader, instead of falling off a shape list into a bespoke section.
    sweptByShape: false,
    why:
      'Half migrated. Crew productivity (hoursPerUnit / crewSize / ' +
      'ratePerManHour — 198 values) LEFT on 2026-08-19 and is asserted absent, ' +
      'structurally and textually, in the guard\'s labor-catalog section. The 66 ' +
      '`rate` values deliberately stayed as the starter baseline, and they are ' +
      'open for exactly the same reason as the two above: they are NBD\'s real ' +
      'rates until rotation lands. Override path: NBD_LABOR.get → laborOps.',
    rotation: null,
  },
};

/* ── the loader, defined once and shared ────────────────────────────────── */

/** A bare browser-ish sandbox — the same one the rotation scripts use. */
function bareWindow() {
  const win = {};
  win.window = win;
  const sandbox = {
    window: win,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: {
      addEventListener() {}, removeEventListener() {},
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, addEventListener() {}, setAttribute() {} }),
      body: { appendChild() {} },
    },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    navigator: {},
    Date, Math, JSON, Set, Map, Object, isFinite, setTimeout, clearTimeout, setInterval, clearInterval,
  };
  vm.createContext(sandbox);
  return { win, sandbox };
}

/** One docs/-relative file, from the worktree or from a git ref. null if absent. */
function readAt(rel, ref) {
  if (!ref || ref === 'worktree') {
    const p = path.join(ROOT, 'docs', rel);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }
  try {
    return execFileSync('git', ['show', ref + ':docs/' + rel],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { return null; }
}

/** Load one catalog's files at `ref`. null if any file is unreadable or throws. */
function loadCatalog(catalog, ref) {
  const { win, sandbox } = bareWindow();
  for (const rel of catalog.files) {
    const src = readAt(rel, ref);
    if (src === null) return null;
    try { vm.runInContext(src, sandbox, { filename: path.basename(rel) }); }
    catch (e) { return null; }
  }
  return win;
}

/**
 * The fields a catalog still PUBLISHES: everything it can rotate, minus what
 * the registry says must leave the tree outright. DERIVED, never listed —
 * pinning the raw `fields` list would have reported all 66 labor entries as
 * "repriced" by the commit that MIGRATED their productivity out, which is the
 * opposite of what this check is for.
 */
function publishedFields(catalog) {
  const gone = catalog.unpublished || [];
  return catalog.fields.filter((f) => !gone.includes(f));
}

/** { key → { publishedField: number } } for one catalog at one ref. */
function publishedFigures(catalog, ref) {
  const win = loadCatalog(catalog, ref);
  if (!win) return null;
  const F = publishedFields(catalog);
  const out = {};
  REG.pricedEntries(catalog, win).forEach((e) => {
    const row = {};
    F.forEach((f) => {
      const v = e.values[f];
      if (typeof v === 'number' && Number.isFinite(v)) row[f] = v;
    });
    out[e.key] = row;
  });
  return out;
}

/**
 * (then, now) → { added, removed, repriced } — arrays of KEYS.
 *
 * `repriced` is the only one that matters and the only one asserted on: an
 * existing line item whose published cost value CHANGED. Adding or removing a
 * line item is ordinary catalog work — measured, it is 100% of what has ever
 * moved these files — and a mechanism that reds on it gets loosened by the
 * third PR.
 *
 * Returns KEYS ONLY, never a value. CI logs on a public repo are public, and a
 * guard against republishing figures that prints the figures in order to fail
 * is precisely the mistake layer 2b exists to catch.
 */
function comparePublished(then, now) {
  const added = Object.keys(now).filter((k) => !(k in then));
  const removed = Object.keys(then).filter((k) => !(k in now));
  const repriced = Object.keys(now).filter((k) =>
    (k in then) && JSON.stringify(then[k]) !== JSON.stringify(now[k]));
  return { added, removed, repriced };
}

/** ISO-8601 committer date of a ref, or null if git cannot resolve it. */
function commitDate(ref) {
  try {
    return execFileSync('git', ['show', '-s', '--format=%cI', ref + '^{commit}'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch (e) { return null; }
}

/**
 * PURE: (id, row, ctx) → string[] findings. Touches no file, no git, no
 * network and no clock, so every branch is mutation-testable on a synthetic
 * row — see section 4g of the guard. The caller does the measuring and hands
 * the results in as `ctx`.
 *
 * ctx = { basisDate, drift } for a rotated row; {} otherwise.
 */
function rotationFindings(id, row, ctx) {
  const out = [];
  const bad = (m) => out.push('"' + id + '" — ' + m);
  const c = ctx || {};
  const r = row && row.rotation;

  // NOT ROTATED is a legal, honest, indefinitely-green state. There is no
  // clock here on purpose: see the guard's section 2c header.
  if (r === null || r === undefined) return out;

  if (typeof r !== 'object' || Array.isArray(r)) {
    bad('rotation must be null or a record { at, by, company, coverage, basisAt } — ' +
        'a bare truthy value is a claim nobody signed');
    return out;
  }
  if (typeof r.by !== 'string' || !r.by.trim()) {
    bad('rotation.by is empty — a rotation is a person saying they did it');
  }
  if (typeof r.company !== 'string' || !/^[A-Za-z0-9_-]{1,1500}$/.test(r.company || '')) {
    bad('rotation.company is not a companyId — rotation is PER TENANT ' +
        '(catalogCosts/{companyId}), and a book with no tenant is not a rotation');
  }
  if (typeof r.coverage !== 'number' || !(r.coverage > 0) || r.coverage > 1) {
    bad('rotation.coverage must be the 0..1 fraction cost-rotation.js stamped as ' +
        'seed.rotationCoverage');
  } else if (r.coverage < 0.5) {
    bad('rotation.coverage ' + Math.round(r.coverage * 100) + '% is below the 50% floor ' +
        'scripts/cost-rotation.js refuses at — a rotation that leaves most figures at their ' +
        'leaked values has devalued nothing. Rotate more, or lower the floor there with ' +
        '--min-coverage and record that decision in the audit note');
  }
  if (!Number.isFinite(Date.parse(r.at || ''))) {
    bad('rotation.at is not a date — paste seed.rotatedAt verbatim');
  }
  if (typeof r.basisAt !== 'string' || !/^[0-9a-f]{7,40}$/.test(r.basisAt || '')) {
    bad('rotation.basisAt must be the commit sha this claim was made against');
    return out;
  }
  if (c.basisDate === null) {
    bad('rotation.basisAt ' + r.basisAt + ' is not a commit in this repo');
    return out;
  }
  if (c.basisDate && Number.isFinite(Date.parse(r.at || '')) &&
      Date.parse(r.at) < Date.parse(c.basisDate)) {
    bad('rotation.at (' + r.at + ') precedes basisAt ' + r.basisAt + ' (' + c.basisDate + ') — ' +
        'a rotation cannot have been signed against a commit that did not exist yet. If you ' +
        're-pointed basisAt to clear a repricing, record the new rotation instead');
  }
  if (c.drift === null) {
    bad('the published figures at basisAt ' + r.basisAt + ' cannot be read, so this claim is ' +
        'unverifiable — which is the same as unmade');
  } else if (c.drift && c.drift.repriced.length) {
    bad(c.drift.repriced.length + ' line item(s) REPRICED since ' + r.basisAt + ' (' +
        c.drift.repriced.slice(0, 6).join(', ') + (c.drift.repriced.length > 6 ? ', …' : '') + ')' +
        '\n      → This rotation claim was made about different numbers. Either these are the' +
        '\n        shop\'s CURRENT costs, in which case the exposure is re-opened and they must be' +
        '\n        reverted — or you rotated again, in which case record it:' +
        '\n          node scripts/cost-rotation.js --catalog ' + id + ' --worksheet' +
        '\n          node scripts/import-cost-rotation.js --catalog ' + id + ' --company ' +
        (r.company || '<companyId>') + ' --yes' +
        '\n        and paste the block it prints on success. Setting rotation back to null is' +
        '\n        also an honest answer, and it is the right one if you are not sure.');
  }
  return out;
}

module.exports = {
  LEDGER,
  bareWindow,
  readAt,
  loadCatalog,
  publishedFields,
  publishedFigures,
  comparePublished,
  commitDate,
  rotationFindings,
};
