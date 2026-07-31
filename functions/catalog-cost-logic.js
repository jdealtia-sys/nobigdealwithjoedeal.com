/**
 * functions/catalog-cost-logic.js — the public/private split for the product
 * catalog. Pure functions, no Firebase imports, so the extract script, the
 * import script and the Node tests all key on ONE definition of "which fields
 * are cost data".
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS. docs/ is hosting.public — every file under it is served
 * unauthenticated at the site root — AND this is a public GitHub repo. Until
 * this split, docs/pro/js/product-data.js shipped wholesale COST beside retail
 * SELL for every SKU (GAF Timberline HDZ: sell 240 / cost 82 — a 66% margin
 * anyone could compute), plus overheadMultiplier and profitMarginPct on every
 * labor block. Both surfaces leaked it: https://nobigdealwithjoedeal.com/pro/
 * js/product-data.js returned 200 to anyone, and raw.githubusercontent.com
 * served the same bytes. That is the same two-surface shape as the ops-runbook
 * leak (#1147 hosting → #1149 repo): unpublishing alone is NOT a fix, the data
 * has to leave the tree.
 *
 * It was also a second, quieter problem: those figures were one company's
 * supplier terms, and every OTHER tenant was seeded with them as their
 * "defaults". Cost data is now TENANT-OWNED (catalogCosts/{companyId}, see
 * firestore.rules) and is never distributed — there is no platform-wide copy
 * to leak or to hand out.
 *
 * THE SPLIT.
 *   PUBLIC  (stays in docs/pro/js/product-data.js + roofivent-catalog.js):
 *           id, name, description, category, unit, coverage, colors, styles,
 *           sizes, warranty, sku, manufacturer, tags, notes, sortOrder, and
 *           pricing[tier].sell — the retail number that is already printed on
 *           every homeowner estimate. Publishing it costs nothing.
 *   PRIVATE (this overlay → the owning tenant's catalogCosts doc → that
 *           tenant's own signed-in browsers):
 *           pricing[tier].cost and the WHOLE labor block. labor.perUnit and
 *           labor.ratePerManHour are money (grossMargin() spends them as
 *           `myCost = matCost + laborCost`), and overheadMultiplier /
 *           profitMarginPct are the margin policy itself. Splitting labor
 *           wholesale also makes the leak guard a flat, un-foolable rule —
 *           "no `cost` key, no `labor` key under docs/" — instead of a
 *           per-field allowlist somebody has to remember to extend.
 *
 * hoursPerUnit and crewSize ride the private half for that reason alone; they
 * are scheduling data, not price, and nothing public-facing reads them.
 *
 * This module is the MIGRATION path: it reconstructs one tenant's cost book
 * from the pre-strip catalog in git history so the owner does not lose the
 * figures they had been quoting off. Ongoing edits go through the Product
 * Library UI (product-library.saveProduct → catalog-costs.recordProduct), not
 * through here.
 */

'use strict';

const TIERS = ['good', 'better', 'best'];

// Labor keys carried on the overlay. Anything a product actually has is
// copied; this list is what validation accepts and what the client restores.
const LABOR_KEYS = [
  'perUnit',
  'ratePerManHour',
  'crewSize',
  'hoursPerUnit',
  'overheadMultiplier',
  'profitMarginPct',
];

// Product keys that must NEVER appear in a file under docs/. The leak guard
// (tests/catalog-cost-privacy.test.js) reads this list — extend it here and
// the guard tightens everywhere at once.
const PRIVATE_PRODUCT_KEYS = ['labor'];
const PRIVATE_TIER_KEYS = ['cost'];

// Pre-existing intentional zero-cost SKUs (owned equipment / a free warranty
// certificate). Everything else must carry cost > 0 on all three tiers. Kept
// in sync with tests/product-data.test.js ZERO_COST_OK.
const ZERO_COST_OK = new Set(['acc_023', 'riv_warranty_cert']);

const SEED_VERSION = 1;

function isFiniteNum(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Split one full (pre-strip) product into its private half.
 * Returns null when the product carries no cost data at all.
 */
function extractProductCosts(product) {
  if (!product || typeof product !== 'object') return null;
  const entry = {};

  const cost = {};
  let sawCost = false;
  TIERS.forEach((t) => {
    const tier = product.pricing && product.pricing[t];
    if (tier && isFiniteNum(tier.cost)) { cost[t] = tier.cost; sawCost = true; }
  });
  if (sawCost) entry.cost = cost;

  if (product.labor && typeof product.labor === 'object') {
    const labor = {};
    let sawLabor = false;
    LABOR_KEYS.forEach((k) => {
      if (isFiniteNum(product.labor[k])) { labor[k] = product.labor[k]; sawLabor = true; }
    });
    if (sawLabor) entry.labor = labor;
  }

  return Object.keys(entry).length ? entry : null;
}

/**
 * Return a copy of `product` with every private field removed — the shape the
 * published catalog must have. The one-shot codemod that rewrote
 * product-data.js did this textually (to keep the diff line-per-SKU and
 * reviewable); this is the executable definition the tests assert against.
 */
function stripProductCosts(product) {
  if (!product || typeof product !== 'object') return product;
  const out = {};
  Object.keys(product).forEach((k) => {
    if (PRIVATE_PRODUCT_KEYS.includes(k)) return;
    if (k === 'pricing' && product.pricing && typeof product.pricing === 'object') {
      const pricing = {};
      Object.keys(product.pricing).forEach((t) => {
        const tier = product.pricing[t];
        if (!tier || typeof tier !== 'object') { pricing[t] = tier; return; }
        const kept = {};
        Object.keys(tier).forEach((tk) => { if (!PRIVATE_TIER_KEYS.includes(tk)) kept[tk] = tier[tk]; });
        pricing[t] = kept;
      });
      out.pricing = pricing;
      return;
    }
    out[k] = product[k];
  });
  return out;
}

/** True if this product still carries any private field. Used by the guard. */
function hasPrivateFields(product) {
  if (!product || typeof product !== 'object') return false;
  if (PRIVATE_PRODUCT_KEYS.some((k) => k in product)) return true;
  const pricing = product.pricing;
  if (!pricing || typeof pricing !== 'object') return false;
  return Object.keys(pricing).some((t) => {
    const tier = pricing[t];
    return !!tier && typeof tier === 'object' && PRIVATE_TIER_KEYS.some((tk) => tk in tier);
  });
}

/**
 * Build the private overlay from a FULL (pre-strip) catalog.
 * Returns { version, defaults, costs } — the exact document body stored at
 * the tenant's catalogCosts/{companyId} document.
 *
 * `defaults` carries the modal overheadMultiplier / profitMarginPct so the
 * Add-Product form can prefill them without those two numbers living in a
 * public file (they appeared 176 / 173 times in the leaked catalog).
 */
function buildCostOverlay(products) {
  const costs = {};
  const overheadTally = new Map();
  const marginTally = new Map();

  (products || []).forEach((p) => {
    if (!p || !p.id) return;
    const entry = extractProductCosts(p);
    if (!entry) return;
    costs[p.id] = entry;
    if (entry.labor) {
      if (isFiniteNum(entry.labor.overheadMultiplier)) {
        overheadTally.set(entry.labor.overheadMultiplier, (overheadTally.get(entry.labor.overheadMultiplier) || 0) + 1);
      }
      if (isFiniteNum(entry.labor.profitMarginPct)) {
        marginTally.set(entry.labor.profitMarginPct, (marginTally.get(entry.labor.profitMarginPct) || 0) + 1);
      }
    }
  });

  const modal = (tally, fallback) => {
    let best = fallback; let bestN = 0;
    tally.forEach((n, v) => { if (n > bestN) { best = v; bestN = n; } });
    return best;
  };

  return {
    version: SEED_VERSION,
    defaults: {
      overheadMultiplier: modal(overheadTally, 1),
      profitMarginPct: modal(marginTally, 0),
    },
    costs,
  };
}

/**
 * Validate an overlay against the PUBLIC catalog it will be merged into.
 * This is the assertion that used to live in tests/product-data.test.js as
 * "sell >= cost > 0 on all three tiers" — it moved here so it runs at publish
 * time and again on every callable read, not just in CI against a file that
 * no longer holds the numbers.
 *
 * `publicProducts` is OPTIONAL. Pass it (extract/publish scripts, tests) for
 * the full check: sell >= cost per tier, plus every live SKU has an entry.
 * Omit it (any caller with no copy of the browser catalog) for a shape-only check — numerics and structure — so a corrupted
 * seed doc is refused instead of being served as a catalog of zeroes.
 *
 * Returns { ok, errors, warnings }.
 */
function validateCostOverlay(overlay, publicProducts, opts) {
  const errors = [];
  const warnings = [];
  const shapeOnly = publicProducts == null;
  const requireComplete = !shapeOnly && (!opts || opts.requireComplete !== false);

  if (!overlay || typeof overlay !== 'object') {
    return { ok: false, errors: ['overlay is not an object'], warnings };
  }
  if (overlay.version !== SEED_VERSION) {
    errors.push('version = ' + JSON.stringify(overlay.version) + ' (expected ' + SEED_VERSION + ')');
  }
  const costs = overlay.costs;
  if (!costs || typeof costs !== 'object') {
    return { ok: false, errors: errors.concat(['costs is not an object']), warnings };
  }

  const byId = new Map();
  (publicProducts || []).forEach((p) => { if (p && p.id) byId.set(p.id, p); });

  Object.keys(costs).forEach((id) => {
    const entry = costs[id];
    const product = byId.get(id);
    if (!shapeOnly && !product) { warnings.push(id + ': overlay entry for a SKU not in the catalog'); return; }
    if (!entry || typeof entry !== 'object') { errors.push(id + ': entry is not an object'); return; }

    TIERS.forEach((t) => {
      const c = entry.cost && entry.cost[t];
      if (!isFiniteNum(c)) { errors.push(id + ':' + t + ': cost is not a finite number'); return; }
      if (ZERO_COST_OK.has(id) ? !(c >= 0) : !(c > 0)) {
        errors.push(id + ':' + t + ': cost ' + c + ' must be ' + (ZERO_COST_OK.has(id) ? '>= 0' : '> 0'));
      }
      if (shapeOnly) return;
      const sell = product.pricing && product.pricing[t] && product.pricing[t].sell;
      if (!isFiniteNum(sell)) { errors.push(id + ':' + t + ': public sell is not a finite number'); return; }
      if (!(sell >= c)) errors.push(id + ':' + t + ': sell ' + sell + ' < cost ' + c);
    });

    if (entry.labor != null) {
      if (typeof entry.labor !== 'object') { errors.push(id + ': labor is not an object'); return; }
      Object.keys(entry.labor).forEach((k) => {
        if (!LABOR_KEYS.includes(k)) { errors.push(id + ': unknown labor key ' + k); return; }
        if (!isFiniteNum(entry.labor[k]) || entry.labor[k] < 0) {
          errors.push(id + ': labor.' + k + ' = ' + entry.labor[k] + ' (expected a number >= 0)');
        }
      });
    }
  });

  if (requireComplete) {
    byId.forEach((_p, id) => { if (!(id in costs)) errors.push(id + ': no overlay entry (SKU would seed at cost 0 / 100% margin)'); });
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = {
  TIERS,
  LABOR_KEYS,
  PRIVATE_PRODUCT_KEYS,
  PRIVATE_TIER_KEYS,
  ZERO_COST_OK,
  SEED_VERSION,
  extractProductCosts,
  stripProductCosts,
  hasPrivateFields,
  buildCostOverlay,
  validateCostOverlay,
};
