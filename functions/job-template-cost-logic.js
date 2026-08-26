/**
 * functions/job-template-cost-logic.js — the public/private split for the JOB
 * TEMPLATE library. Pure functions, no Firebase imports, so the extract
 * script, the rotate script, the import script, the strip codemod and the Node
 * tests all key on ONE definition of "which fields are cost data" and ONE
 * definition of the entry key.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS. This is the same leak as the product catalog's, in a second
 * subsystem, found 2026-08-18. docs/pro/js/job-templates-data.js shipped 84
 * `custom` line items each carrying `materialCost` AND `laborCost` — 146
 * non-zero contractor cost values across 49 of its 179 lines — at
 * https://nobigdealwithjoedeal.com/pro/js/job-templates-data.js (200, ~188 KB,
 * unauthenticated) and from raw.githubusercontent.com. Its own header said so
 * plainly ("custom items carry explicit contractor costs"); it was documented
 * behaviour that nobody had checked against the publishing invariant.
 *
 * The second half is what made it exploitable: docs/pro/js/
 * estimate-logic-engine.js is public alongside it and carries the markup math
 * (materialMarkupPct 0.25, overheadPct 0.10, profitPct 0.10). Cost basis AND
 * margin model were both readable, so the quote for any of these items could
 * be reconstructed and the margin on a delivered estimate computed.
 *
 * Measured leak + root cause:
 *   documentation/audit/JOB-TEMPLATE-COST-LEAK-2026-08-18.md
 * Plan (3 designs, all killed by an adversarial pass, corrected synthesis):
 *   documentation/projects/JOB-TEMPLATE-COST-MIGRATION-PLAN-2026-08-18.md
 *
 * THE SPLIT.
 *   PUBLIC  (stays in docs/pro/js/job-templates-data.js):
 *           the whole scope of work — name, desc, unit, qty, category, plus
 *           every template's metadata, coded items and measurements. A
 *           homeowner already sees all of it on their estimate; publishing it
 *           costs nothing and it is what makes the template library useful
 *           to a tenant who has entered no costs yet.
 *   PRIVATE (this overlay → catalogCosts/{companyId}.jtCosts → that tenant's
 *           own signed-in browsers):
 *           materialCost and laborCost. Nothing else — a JT custom item is
 *           `tier: 'any'` and carries no labor policy.
 *
 * NO `defaults` BLOCK, AND THAT IS A DECISION. buildCostOverlay() (the product
 * precedent) derives a company-wide overheadMultiplier / profitMarginPct as
 * the modal value across the catalog, because the Add-Product form needs a
 * prefill. Job-template custom items carry no labor policy at all, so there is
 * no company-wide mode to derive and nothing to prefill. An empty `defaults`
 * here would be an invitation to put something in it later.
 *
 * THE KEY. jtKey(templateId, index) — 'jt-<slug(templateId)>-<index>' — is the
 * key job-templates.js:registerCustomItems has ALREADY been computing for the
 * EstimateBuilderV2.CATALOG bridge since the library shipped. Reusing it means
 * the strip is a pure DELETION diff: no new identifier is minted anywhere, and
 * a saved estimate's 'JT *' code still derives identically in every session.
 * slugify() below is copied verbatim from docs/pro/js/job-templates.js and is
 * pinned character-for-character by tests/job-template-cost-seed.test.js — if
 * the two ever drift, every tenant's book silently stops resolving.
 *
 * WHY NOT A RETAIL PRICE IN THE PUBLIC FILE. Baking a static retail number and
 * deleting the costs looks cheaper and is wrong: markup is per-tenant
 * configurable (settings.materialMarkupPct / overheadPct / profitPct), so a
 * baked retail freezes ONE company's markup into every other tenant's pricing
 * — which is precisely the second problem the product-data.js split was
 * written to solve.
 *
 * This module is also the MIGRATION path: it reconstructs one tenant's job
 * template cost book from the pre-strip data file in git history, so the owner
 * does not lose the figures they had been quoting off. Every OTHER tenant gets
 * nothing, on purpose.
 */

'use strict';

// Cost keys that must NEVER appear inside a `custom` block in a file under
// docs/. The leak guard (tests/catalog-cost-privacy.test.js) and the strip
// codemod (scripts/strip-job-template-costs.js) both read this list — extend
// it here and everything tightens at once.
const JT_PRIVATE_KEYS = ['materialCost', 'laborCost'];

const SEED_VERSION = 1;

function isFiniteNum(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * VERBATIM COPY of slugify() in docs/pro/js/job-templates.js. The client
 * cannot require() this file (it is a plain <script> under a strict CSP), so
 * the duplication is unavoidable; what is avoidable is the drift, which
 * tests/job-template-cost-seed.test.js pins by hashing jtKey() across all 84
 * live custom items AND by asserting the two function sources match.
 */
function slugify(name) {
  return String(name || '').toLowerCase().trim()
    .replace(/\s+/g, '-').replace(/[^a-z0-9\-]/g, '').replace(/\-+/g, '-');
}

/**
 * The ONE definition of a job-template cost-book key.
 * Mirrors job-templates.js:registerCustomItems, which has computed
 * `'jt-' + slugify(tpl.id) + '-' + i` for the V2 catalog bridge since v1.
 */
function jtKey(templateId, index) {
  return 'jt-' + slugify(templateId) + '-' + index;
}

/**
 * Pull the cost half OUT of one FULL (pre-strip) template.
 * Returns { [key]: { materialCost, laborCost } }, or null when the template
 * carries no cost data at all — the no-invented-zeroes rule extractProductCosts
 * established. A template whose costs the tenant has never set must never be
 * persisted as a row of zeroes; "unset" and "zero" are different states and
 * the client renders them differently.
 */
function extractJtCosts(tpl) {
  if (!tpl || typeof tpl !== 'object' || !tpl.id || !Array.isArray(tpl.items)) return null;
  const out = {};
  tpl.items.forEach((item, i) => {
    const c = item && item.custom;
    if (!c || typeof c !== 'object') return;
    const mat = Number(c.materialCost);
    const lab = Number(c.laborCost);
    const sawMat = c.materialCost != null && isFiniteNum(mat);
    const sawLab = c.laborCost != null && isFiniteNum(lab);
    if (!sawMat && !sawLab) return;
    out[jtKey(tpl.id, i)] = {
      materialCost: sawMat ? mat : 0,
      laborCost: sawLab ? lab : 0,
    };
  });
  return Object.keys(out).length ? out : null;
}

/**
 * Return a copy of `tpl` with every private cost field removed — the shape the
 * published data file must have. The one-shot codemod that rewrote
 * job-templates-data.js did this textually (to keep the diff one line per
 * template and reviewable); this is the executable definition the tests assert
 * the published file against.
 *
 * Key ORDER is preserved, because tests/job-template-cost-seed.test.js asserts
 * the split is lossless by JSON.stringify equality in both directions.
 */
function stripJtCosts(tpl) {
  if (!tpl || typeof tpl !== 'object') return tpl;
  const out = {};
  Object.keys(tpl).forEach((k) => {
    if (k !== 'items' || !Array.isArray(tpl.items)) { out[k] = tpl[k]; return; }
    out.items = tpl.items.map((item) => {
      if (!item || typeof item !== 'object' || !item.custom || typeof item.custom !== 'object') return item;
      const nextItem = {};
      Object.keys(item).forEach((ik) => {
        if (ik !== 'custom') { nextItem[ik] = item[ik]; return; }
        const custom = {};
        Object.keys(item.custom).forEach((ck) => {
          if (JT_PRIVATE_KEYS.includes(ck)) return;
          custom[ck] = item.custom[ck];
        });
        nextItem.custom = custom;
      });
      return nextItem;
    });
  });
  return out;
}

/** True if this template still carries any private cost field. Used by the guard. */
function hasJtPrivateFields(tpl) {
  if (!tpl || typeof tpl !== 'object' || !Array.isArray(tpl.items)) return false;
  return tpl.items.some((item) => {
    const c = item && item.custom;
    return !!c && typeof c === 'object' && JT_PRIVATE_KEYS.some((k) => k in c);
  });
}

/**
 * Build the private overlay from a FULL (pre-strip) template array.
 * Returns { version, jtCosts } — the fields written into the tenant's EXISTING
 * catalogCosts/{companyId} document beside `costs` / `defaults`.
 *
 * Reusing that document rather than minting a parallel collection is the whole
 * blast-radius argument: firestore.rules:1061-1066 already governs every field
 * of it, so this migration needs ZERO rules changes — and a rules typo is the
 * failure mode that locks live tenants out of their own money data.
 */
function buildJtCostOverlay(templates) {
  const jtCosts = {};
  (templates || []).forEach((t) => {
    const entry = extractJtCosts(t);
    if (!entry) return;
    Object.keys(entry).forEach((k) => { jtCosts[k] = entry[k]; });
  });
  return { version: SEED_VERSION, jtCosts };
}

/**
 * Validate an overlay against the PUBLIC template set it will be merged into.
 *
 * This is where the assertion that used to live in tests/job-templates.test.js
 * lands — "custom items carry costs >= 0 with at least one > 0". That test
 * REQUIRED the numbers to be present in the published file, i.e. it required
 * the leak. The invariant is still worth enforcing, so it moved here, where it
 * runs at extract time AND again at import time against the real book.
 *
 * `publicTemplates` is OPTIONAL. Pass it (extract/rotate/import scripts, tests)
 * for the full check: every value finite and >= 0, at least one > 0 per key,
 * and every live custom item covered. Omit it for a shape-only check — so a
 * corrupted seed doc is refused rather than imported as a book of zeroes.
 *
 * An overlay key that matches no live custom item is a WARNING, not an error
 * (same call as validateCostOverlay): a tenant's book legitimately outlives a
 * template that was renamed or retired, and refusing the whole import over it
 * would strand the other 83 entries.
 *
 * Returns { ok, errors, warnings }.
 */
function validateJtCostOverlay(overlay, publicTemplates, opts) {
  const errors = [];
  const warnings = [];
  const shapeOnly = publicTemplates == null;
  const requireComplete = !shapeOnly && (!opts || opts.requireComplete !== false);

  if (!overlay || typeof overlay !== 'object') {
    return { ok: false, errors: ['overlay is not an object'], warnings };
  }
  if (overlay.version !== SEED_VERSION) {
    errors.push('version = ' + JSON.stringify(overlay.version) + ' (expected ' + SEED_VERSION + ')');
  }
  const jtCosts = overlay.jtCosts;
  if (!jtCosts || typeof jtCosts !== 'object') {
    return { ok: false, errors: errors.concat(['jtCosts is not an object']), warnings };
  }

  // Live custom items, keyed the same way the client keys them.
  const live = new Map();
  (publicTemplates || []).forEach((t) => {
    if (!t || !t.id || !Array.isArray(t.items)) return;
    t.items.forEach((item, i) => {
      const c = item && item.custom;
      if (c && typeof c === 'object' && c.name) live.set(jtKey(t.id, i), c);
    });
  });

  Object.keys(jtCosts).forEach((key) => {
    const entry = jtCosts[key];
    if (!shapeOnly && !live.has(key)) {
      warnings.push(key + ': overlay entry for a custom item not in the template library');
      return;
    }
    if (!entry || typeof entry !== 'object') { errors.push(key + ': entry is not an object'); return; }

    Object.keys(entry).forEach((k) => {
      if (!JT_PRIVATE_KEYS.includes(k)) errors.push(key + ': unknown key ' + k);
    });

    let sawPositive = false;
    JT_PRIVATE_KEYS.forEach((k) => {
      const v = entry[k];
      if (!isFiniteNum(v)) { errors.push(key + '.' + k + ' = ' + JSON.stringify(v) + ' (expected a finite number)'); return; }
      if (v < 0) { errors.push(key + '.' + k + ' = ' + v + ' (expected >= 0)'); return; }
      if (v > 0) sawPositive = true;
    });
    // The invariant that used to live in the public data file's test.
    if (!sawPositive && !errors.some((e) => e.startsWith(key + '.'))) {
      errors.push(key + ': materialCost and laborCost are both 0 (at least one must be > 0)');
    }
  });

  if (requireComplete) {
    live.forEach((_c, key) => {
      if (!(key in jtCosts)) errors.push(key + ': no overlay entry (this item would price at 0 with no cost basis)');
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = {
  JT_PRIVATE_KEYS,
  SEED_VERSION,
  slugify,
  jtKey,
  extractJtCosts,
  stripJtCosts,
  hasJtPrivateFields,
  buildJtCostOverlay,
  validateJtCostOverlay,
};
