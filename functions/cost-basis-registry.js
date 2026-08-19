/**
 * functions/cost-basis-registry.js — one description of every cost catalog
 * this codebase publishes, so the rotation toolchain does not need four
 * near-copies of itself.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS. Four separate catalogs have carried a contractor cost basis
 * into the published tree, each found separately, each spelled differently:
 *
 *   product-data.js        cost/labor per SKU        migrated 2026-07-30
 *   job-templates-data.js  materialCost/laborCost    migrated 2026-08-18 (PR-B)
 *   estimate-builder-v2.js cost/labor                still published
 *   estimate-catalog-xactimate.js  mat/lab           still published
 *   estimate-labor-catalog.js      rate/hoursPerUnit still published
 *
 * The pattern of the fix is identical every time — enumerate entries, key them
 * stably, pull the private fields, validate, hand one tenant their own book —
 * and it has now been hand-written twice. This registry is that pattern stated
 * once, as data, so the third and fourth times are a config entry rather than
 * a new script.
 *
 * ── WHAT ROTATION IS FOR, since it is counter-intuitive ────────────────────
 *
 * These figures are readable forever at their pre-strip commits: in this repo,
 * in every clone, in every fork. Removing them from HEAD stops NEW exposure and
 * nothing else. A `git filter-repo` rewrite was assessed and declined (one
 * commit, 235 to rewrite, 10 live worktrees, incomplete against forks).
 *
 * The measurement that settled the design (2026-08-18): **de-identifying a
 * published baseline by transforming the leaked figures is theatre.** A coarse
 * per-magnitude rounding grid moved 67% of the 66 labor rates at a 3.4% median
 * drift — fine as a baseline, useless as concealment, because the
 * pre-transform values are one `git show` away. Any deterministic transform is
 * invertible by anyone holding a clone.
 *
 * So the published baseline does not need to be SECRET. It needs to be STALE.
 * The historical figures stay published as a labelled starter price book —
 * they are already public and cannot be recalled, so publishing them costs
 * nothing — and the tenant's ROTATED, current figures live in
 * catalogCosts/{companyId}, where they win. The leak closes because the
 * actuals are no longer the published ones, not because the published ones
 * are obscured.
 *
 * That makes rotation a hard PREREQUISITE for the remaining migrations rather
 * than a parallel nicety, and it is why this file's job is to make supplying
 * real figures cheap rather than to invent plausible ones. It will not
 * generate a number. A blanket "scale everything by 7%" would devalue the
 * leaked copies and put the shop on fabricated money for live quoting — a
 * worse failure than the leak.
 *
 * ── THE BOOK ───────────────────────────────────────────────────────────────
 *
 * Every catalog writes to its own map on the tenant's EXISTING
 * catalogCosts/{companyId} document. firestore.rules already governs every
 * field of it, so none of this needs a rules change — and a rules typo is the
 * failure mode that locks a live tenant out of their own money data.
 *
 * Pure CommonJS, no Firebase imports, no filesystem: the scripts and the tests
 * all key on one definition.
 */

'use strict';

const SEED_VERSION = 1;

function isFiniteNum(n) { return typeof n === 'number' && Number.isFinite(n); }

/**
 * Each catalog declares:
 *   id         short name used on the command line
 *   label      human description
 *   files      docs/-relative sources, in load order (a bare window sandbox)
 *   bookField  the map on catalogCosts/{companyId} it owns
 *   fields     the private numeric fields, in worksheet column order
 *   entries    (win) => [{ key, name, unit, values: {field: number} }]
 *
 * `entries` reads the LOADED catalog rather than parsing source, so a change
 * to how a file is authored cannot silently drop rows.
 */
const CATALOGS = {
  labor: {
    id: 'labor',
    label: 'NBD_LABOR — labor actions (rate + crew productivity)',
    files: ['pro/js/estimate-labor-catalog.js'],
    bookField: 'laborOps',
    fields: ['rate', 'hoursPerUnit', 'crewSize'],
    entries(win) {
      const items = (win.NBD_LABOR && win.NBD_LABOR.items) || {};
      return Object.keys(items).map((id) => {
        const e = items[id];
        return {
          key: id,
          name: e.name || id,
          unit: e.unit || '',
          values: { rate: Number(e.rate), hoursPerUnit: Number(e.hoursPerUnit), crewSize: Number(e.crewSize) },
        };
      });
    },
  },

  xact: {
    id: 'xact',
    label: 'NBD_XACT_CATALOG — Xactimate-style line items (material + labor)',
    files: [
      'pro/js/estimate-labor-catalog.js',
      'pro/js/estimate-builder-v2.js',
      'pro/js/estimate-catalog-xactimate.js',
    ],
    bookField: 'xactCosts',
    fields: ['materialCost', 'laborCost'],
    entries(win) {
      const items = (win.NBD_XACT_CATALOG && win.NBD_XACT_CATALOG.items) || [];
      return items.map((e) => ({
        key: e.code,
        name: e.name || e.code,
        unit: e.unit || '',
        values: { materialCost: Number(e.materialCost), laborCost: Number(e.laborCost) },
      }));
    },
  },

  v2: {
    id: 'v2',
    label: 'EstimateBuilderV2.CATALOG — the native per-tier package catalog',
    files: ['pro/js/estimate-config.js', 'pro/js/estimate-builder-v2.js'],
    bookField: 'v2Costs',
    fields: ['cost', 'labor'],
    entries(win) {
      const cat = (win.EstimateBuilderV2 && win.EstimateBuilderV2.CATALOG) || {};
      // Native keys only. The xact and job-template bridges write into this
      // same object at load, and those rows belong to their own catalogs —
      // rotating them here would double-count and produce two books that
      // disagree about the same line.
      return Object.keys(cat)
        .filter((k) => !/^xact-|^jt-/.test(k))
        .map((k) => {
          const e = cat[k];
          return {
            key: k,
            name: e.name || k,
            unit: e.unit || '',
            values: { cost: Number(e.cost), labor: Number(e.labor) },
          };
        });
    },
  },
};

function get(id) {
  const c = CATALOGS[id];
  if (!c) throw new Error('unknown catalog "' + id + '" (expected one of: ' + Object.keys(CATALOGS).join(', ') + ')');
  return c;
}

/** Every entry that carries at least one non-zero private value. */
function pricedEntries(catalog, win) {
  return catalog.entries(win).filter((e) =>
    catalog.fields.some((f) => isFiniteNum(e.values[f]) && e.values[f] > 0));
}

/**
 * Build the worksheet rows for one catalog: current figures plus an empty
 * column per field. A bare key is unfillable, so the item's name and unit ride
 * along — this is the difference between data entry and archaeology.
 */
function buildWorksheet(catalog, win) {
  return pricedEntries(catalog, win).map((e) => {
    const row = { key: e.key, item: e.name, unit: e.unit };
    catalog.fields.forEach((f) => { row['current_' + f] = isFiniteNum(e.values[f]) ? e.values[f] : null; });
    catalog.fields.forEach((f) => { row[f] = null; });   // ← fill these in
    return row;
  });
}

/**
 * Apply a filled worksheet over the current figures.
 * A blank / null / '' cell KEEPS the current value and is counted, so "I only
 * revised half of them" is a reported number rather than a silent outcome.
 *
 * Returns { seed, changed, total, unknownKeys, badValues }.
 */
function applyRotation(catalog, win, rows) {
  const current = {};
  pricedEntries(catalog, win).forEach((e) => {
    current[e.key] = {};
    catalog.fields.forEach((f) => { if (isFiniteNum(e.values[f])) current[e.key][f] = e.values[f]; });
  });

  const unknownKeys = [];
  const badValues = [];
  let changed = 0;
  let total = 0;
  Object.keys(current).forEach((k) => { total += Object.keys(current[k]).length; });

  (rows || []).forEach((r, i) => {
    const k = r && r.key;
    if (!k) return;
    if (!(k in current)) { unknownKeys.push(k); return; }
    catalog.fields.forEach((f) => {
      const raw = r[f];
      if (raw === null || raw === undefined || raw === '') return;   // keep current
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) {
        badValues.push('row ' + i + ' (' + k + '): ' + f + ' = ' + JSON.stringify(raw));
        return;
      }
      if (!(f in current[k])) return;   // this entry never had that field
      if (v !== current[k][f]) changed++;
      current[k][f] = v;
    });
  });

  return {
    seed: { version: SEED_VERSION, catalog: catalog.id, [catalog.bookField]: current },
    changed, total, unknownKeys, badValues,
  };
}

/**
 * Validate a rotated seed against the catalog it will be merged into.
 * `win` optional: omit for a shape-only check, so a corrupted seed is refused
 * rather than imported as a book of zeroes.
 */
function validateSeed(catalog, seed, win) {
  const errors = [];
  const warnings = [];
  if (!seed || typeof seed !== 'object') return { ok: false, errors: ['seed is not an object'], warnings };
  if (seed.version !== SEED_VERSION) errors.push('version = ' + JSON.stringify(seed.version) + ' (expected ' + SEED_VERSION + ')');
  if (seed.catalog !== catalog.id) errors.push('catalog = ' + JSON.stringify(seed.catalog) + ' (expected "' + catalog.id + '")');

  const map = seed[catalog.bookField];
  if (!map || typeof map !== 'object') {
    return { ok: false, errors: errors.concat([catalog.bookField + ' is not an object']), warnings };
  }

  const live = win ? new Set(pricedEntries(catalog, win).map((e) => e.key)) : null;

  Object.keys(map).forEach((k) => {
    if (live && !live.has(k)) {
      // A tenant's book legitimately outlives a retired line item; refusing
      // the whole import over one would strand every other entry.
      warnings.push(k + ': seed entry for a line item not in the live catalog');
      return;
    }
    const entry = map[k];
    if (!entry || typeof entry !== 'object') { errors.push(k + ': entry is not an object'); return; }
    let sawPositive = false;
    Object.keys(entry).forEach((f) => {
      if (!catalog.fields.includes(f)) { errors.push(k + ': unknown field ' + f); return; }
      const v = entry[f];
      if (!isFiniteNum(v)) { errors.push(k + '.' + f + ' = ' + JSON.stringify(v) + ' (expected a finite number)'); return; }
      if (v < 0) { errors.push(k + '.' + f + ' = ' + v + ' (expected >= 0)'); return; }
      if (v > 0) sawPositive = true;
    });
    if (!sawPositive && !errors.some((e) => e.startsWith(k + '.'))) {
      errors.push(k + ': every field is 0 (at least one must be > 0)');
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = {
  SEED_VERSION,
  CATALOGS,
  get,
  pricedEntries,
  buildWorksheet,
  applyRotation,
  validateSeed,
};
