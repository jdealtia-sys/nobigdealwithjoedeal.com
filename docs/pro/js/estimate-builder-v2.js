// ============================================================
// NBD Pro — Estimate Builder v2 Pricing Engine
// Locked spec: memory/site_wide_spec_20260410.md
//
// Two pricing modes, both locked to the same spec:
//   1. PER-SQ MODE:    Flat per-SQ rates ($545/$595/$660) +
//                      smart add-ons. Fastest for cash jobs.
//   2. LINE-ITEM MODE: Full material + labor breakdown with
//                      overhead + profit (OH&P) markup.
//                      Matches Xactimate-style insurance
//                      supplements.
//
// User picks mode per estimate. Pure JS — no DOM, no Firebase.
// Safe to import anywhere.
// ============================================================

(function () {
  'use strict';

  // ═════════════════════════════════════════════════════════
  // SECTION 1 — Locked Spec Constants (Per-SQ mode)
  // ═════════════════════════════════════════════════════════
  //
  // Source of truth: estimate-config.js (Rock 2 PR 3).
  // Browser path uses window.NBD_ESTIMATE_CONFIG; Node tests
  // require('./estimate-config') — module.exports is the same
  // frozen object. Inline fallbacks preserve historical values
  // if the config module isn't reachable (e.g., a partial
  // deploy). Engine still prices on stale-but-correct numbers
  // and surfaces a Sentry breadcrumb so we know.

  let _NBD_CFG = (typeof window !== 'undefined' && window.NBD_ESTIMATE_CONFIG) || null;
  if (!_NBD_CFG && typeof require === 'function') {
    try { _NBD_CFG = require('./estimate-config'); } catch (_) { _NBD_CFG = null; }
  }
  if (!_NBD_CFG && typeof console !== 'undefined') {
    try { console.warn('[EstimateBuilderV2] NBD_ESTIMATE_CONFIG missing — using inline fallbacks. Check that estimate-config.js loaded first.'); } catch (_) {}
  }

  // Per-SQ flat rates (Joe's contractor pricing)
  const TIER_RATES = (_NBD_CFG && _NBD_CFG.TIER_RATES) || {
    good:   545,   // Standard system + standard accessories
    better: 595,   // Upgraded materials + system warranty
    best:   660    // Impact-rated + 50yr warranty package
  };

  // Cost basis per SQ (Internal view margin calc)
  // Not yet unified — V2-only; classic has no equivalent.
  const DEFAULT_COST_BASIS = {
    good:   340,
    better: 385,
    best:   430
  };

  const MIN_JOB_CHARGE          = (_NBD_CFG && _NBD_CFG.JOB_MINIMUM_DOLLARS)            || 2500;  // Kicks in below ~4.5 SQ
  const ROUND_TO                = (_NBD_CFG && _NBD_CFG.ROUND_TO_DOLLARS)               || 25;    // Round grand total to nearest $25
  const TEAR_OFF_EXTRA_PER_SQ   = (_NBD_CFG && _NBD_CFG.TEAR_OFF_EXTRA_PER_SQ_DOLLARS)  || 50;    // $50/SQ per extra layer
  const DEFAULT_DUMP_FEE        = (_NBD_CFG && _NBD_CFG.DEFAULT_DUMP_FEE)               || 550;   // Flat default
  const CUT_UP_ROOF_WASTE_BONUS = (_NBD_CFG && _NBD_CFG.CUT_UP_ROOF_WASTE_BONUS)        || 0.03;  // +3% waste for cut-up roofs

  // Permit costs by city/county (7 jurisdictions from the spec)
  const PERMIT_COSTS = {
    'hamilton-oh': { name: 'Hamilton County, OH', cost: 185 },
    'butler-oh':   { name: 'Butler County, OH',   cost: 150 },
    'warren-oh':   { name: 'Warren County, OH',   cost: 165 },
    'clermont-oh': { name: 'Clermont County, OH', cost: 170 },
    'kenton-ky':   { name: 'Kenton County, KY',   cost: 125 },
    'boone-ky':    { name: 'Boone County, KY',    cost: 135 },
    'campbell-ky': { name: 'Campbell County, KY', cost: 130 }
  };

  // Sales tax by county
  const COUNTY_TAX = {
    'hamilton-oh': 0.0780,
    'butler-oh':   0.0725,
    'warren-oh':   0.0675,
    'clermont-oh': 0.0725,
    'kenton-ky':   0.0600,
    'boone-ky':    0.0600,
    'campbell-ky': 0.0600
  };
  const FALLBACK_TAX_RATE = 0.07;

  // Per-SQ mode add-on unit prices
  const ADDON_PRICES = {
    chimneyFlash:   285,
    skylightFlash:  350,
    valleyMetalLf:  8.50,
    guttersLf:      8.50,
    extraPipeBoot:  85      // When pipe count > 4
  };

  // ═════════════════════════════════════════════════════════
  // SECTION 2 — Line-Item Material Catalog
  // ═════════════════════════════════════════════════════════
  // Each entry defines material cost + install labor cost.
  // Tier variants let the engine swap shingles/underlayment
  // when the user toggles Good/Better/Best.
  //
  // cost       = unit material cost (what Joe pays supplier)
  // labor      = install labor per unit
  // unit       = 'SQ' | 'LF' | 'EA' | 'JOB' | 'SF'
  // category   = for grouping in the line-item view
  // ═════════════════════════════════════════════════════════

  const CATALOG = {
    // ── SHINGLES (tier-dependent) ──
    'shingle-good': {
      code: 'RFG-SHNG', name: 'Architectural Shingles 30yr',
      category: 'shingles', unit: 'SQ',
      cost: 115.00, labor: 65.00
    },
    'shingle-better': {
      code: 'RFG-SHNG', name: 'Architectural Shingles Lifetime',
      category: 'shingles', unit: 'SQ',
      cost: 135.00, labor: 65.00
    },
    'shingle-best': {
      code: 'RFG-IMPCT', name: 'Impact-Rated Shingles Class 4 · 50yr',
      category: 'shingles', unit: 'SQ',
      cost: 175.00, labor: 75.00
    },

    // ── UNDERLAYMENT (tier-dependent) ──
    'underlayment-good': {
      code: 'RFG-FELT', name: 'Synthetic Underlayment',
      category: 'underlayment', unit: 'SQ',
      cost: 22.00, labor: 12.00
    },
    'underlayment-better': {
      code: 'RFG-FELT', name: 'Premium Synthetic Underlayment',
      category: 'underlayment', unit: 'SQ',
      cost: 28.00, labor: 12.00
    },
    'underlayment-best': {
      code: 'RFG-FELT', name: 'High-Temp Synthetic Underlayment',
      category: 'underlayment', unit: 'SQ',
      cost: 38.00, labor: 12.00
    },

    // ── ICE & WATER SHIELD ──
    'ice-water': {
      code: 'RFG-IWS', name: 'Ice & Water Shield',
      category: 'underlayment', unit: 'SQ',
      cost: 85.00, labor: 22.00
    },

    // ── STARTER STRIP ──
    'starter-strip': {
      code: 'RFG-STRT', name: 'Starter Strip Shingles',
      category: 'accessories', unit: 'LF',
      cost: 1.85, labor: 0.80
    },

    // ── DRIP EDGE ──
    'drip-edge': {
      code: 'RFG-DRPE', name: 'Drip Edge Aluminum',
      category: 'metal', unit: 'LF',
      cost: 1.95, labor: 0.65
    },

    // ── RIDGE / HIP CAP ──
    'ridge-cap-good': {
      code: 'RFG-RIDG', name: 'Ridge Cap Shingles',
      category: 'accessories', unit: 'LF',
      cost: 4.25, labor: 1.85
    },
    'ridge-cap-best': {
      code: 'RFG-RIDG', name: 'Premium Ridge Cap (Impact-Rated)',
      category: 'accessories', unit: 'LF',
      cost: 5.85, labor: 1.85
    },

    // ── RIDGE VENT ──
    'ridge-vent': {
      code: 'RFG-VENT', name: 'Ridge Vent — Continuous',
      category: 'ventilation', unit: 'LF',
      cost: 3.25, labor: 1.50
    },
    'ridge-vent-premium': {
      code: 'RFG-VENT', name: 'RoofIVents 50yr Ridge Vent',
      category: 'ventilation', unit: 'LF',
      cost: 6.50, labor: 1.50
    },

    // ── PIPE BOOTS ──
    'pipe-boot-standard': {
      code: 'RFG-PIPE', name: 'Pipe Boot / Plumbing Flashing',
      category: 'flashing', unit: 'EA',
      cost: 18.00, labor: 28.00
    },
    'pipe-boot-premium': {
      code: 'RFG-PIPE', name: 'GAF Masterflow Pivot Boot 50yr',
      category: 'flashing', unit: 'EA',
      cost: 42.00, labor: 28.00
    },

    // ── FLASHING ──
    'chimney-flashing': {
      code: 'RFG-CHIM', name: 'Chimney Flashing Kit',
      category: 'flashing', unit: 'EA',
      cost: 125.00, labor: 160.00
    },
    'skylight-flashing': {
      code: 'RFG-SKY', name: 'Skylight Flashing Kit',
      category: 'flashing', unit: 'EA',
      cost: 165.00, labor: 185.00
    },
    'valley-metal': {
      code: 'RFG-VLY', name: 'Valley Metal W-Profile',
      category: 'metal', unit: 'LF',
      cost: 3.85, labor: 4.65
    },
    'step-flashing': {
      code: 'RFG-STPF', name: 'Step Flashing',
      category: 'flashing', unit: 'LF',
      cost: 2.25, labor: 2.50
    },

    // ── DECKING ──
    'osb-decking': {
      code: 'RFG-DECK', name: 'OSB Decking 7/16" — Replacement',
      category: 'decking', unit: 'SF',
      cost: 0.85, labor: 0.85
    },

    // ── NAILS / FASTENERS ──
    'nails-standard': {
      code: 'RFG-NAIL', name: 'Coil Roofing Nails',
      category: 'fasteners', unit: 'SQ',
      cost: 4.50, labor: 0
    },
    'nails-lumanail': {
      code: 'RFG-NAIL-LUMA', name: 'LumaNails Ring-Shank Fasteners',
      category: 'fasteners', unit: 'SQ',
      cost: 7.50, labor: 0,
      packaging: { unit: 'Box', coverage: 10, costPerBox: 75 }
    },

    // ── LABOR-ONLY LINES ──
    'tear-off': {
      code: 'RFG-TEAR', name: 'Tear Off Existing Roof Covering',
      category: 'labor', unit: 'SQ',
      cost: 0, labor: 65.00
    },
    'tear-off-extra-layer': {
      code: 'RFG-TEAR', name: 'Tear Off Additional Layer',
      category: 'labor', unit: 'SQ',
      cost: 0, labor: 50.00
    },

    // ── DISPOSAL / DUMP ──
    'dump-fee': {
      code: 'HAUL-DUMP', name: 'Dumpster & Haul-Away',
      category: 'disposal', unit: 'JOB',
      cost: 550.00, labor: 0
    },

    // ── PERMIT ──
    'permit-fee': {
      code: 'PERMIT', name: 'Building Permit',
      category: 'permit', unit: 'JOB',
      cost: 185.00, labor: 0
    },

    // ── GUTTERS ──
    'gutters-5in': {
      code: 'GUT-5IN', name: 'Seamless Aluminum Gutters 5"',
      category: 'gutters', unit: 'LF',
      cost: 4.85, labor: 3.65
    },
    'gutters-6in': {
      code: 'GUT-6IN', name: 'Seamless Aluminum Gutters 6"',
      category: 'gutters', unit: 'LF',
      cost: 5.45, labor: 4.05
    }
  };

  // Tier → material variant picker
  const TIER_MATERIAL_MAP = {
    good: {
      shingle:     'shingle-good',
      underlayment:'underlayment-good',
      ridgeCap:    'ridge-cap-good',
      ridgeVent:   'ridge-vent',
      pipeBoot:    'pipe-boot-standard',
      nails:       'nails-standard'
    },
    better: {
      shingle:     'shingle-better',
      underlayment:'underlayment-better',
      ridgeCap:    'ridge-cap-good',
      ridgeVent:   'ridge-vent',
      pipeBoot:    'pipe-boot-standard',
      nails:       'nails-standard'
    },
    best: {
      shingle:     'shingle-best',
      underlayment:'underlayment-best',
      ridgeCap:    'ridge-cap-best',
      ridgeVent:   'ridge-vent-premium',
      pipeBoot:    'pipe-boot-premium',
      nails:       'nails-lumanail'
    }
  };

  // ═════════════════════════════════════════════════════════
  // SECTION 3 — OH&P Markup Defaults
  // ═════════════════════════════════════════════════════════
  const DEFAULT_OVERHEAD_PCT = 0.10;  // 10% overhead
  const DEFAULT_PROFIT_PCT   = 0.10;  // 10% profit
  const DEFAULT_MATERIAL_MARKUP_PCT = 0.25; // 25% baked into materials

  // ═════════════════════════════════════════════════════════
  // SECTION 4 — Pure Helpers
  // ═════════════════════════════════════════════════════════

  function parsePitch(pitch) {
    if (pitch == null || pitch === '') return 0.667;
    if (typeof pitch === 'number') return pitch;
    const parts = String(pitch).split('/');
    if (parts.length === 2) {
      const rise = parseFloat(parts[0]);
      const run  = parseFloat(parts[1]) || 12;
      return run > 0 ? rise / run : 0.667;
    }
    const n = parseFloat(pitch);
    return isNaN(n) ? 0.667 : n;
  }

  function wasteFactorForPitch(pitchRatio) {
    if (pitchRatio <= 0.33) return 1.12;
    if (pitchRatio <= 0.50) return 1.15;
    if (pitchRatio <= 0.75) return 1.17;
    if (pitchRatio <= 1.00) return 1.20;
    return 1.25;
  }

  function extraPipeBootCharge(pipeCount, unitPrice) {
    const rate = unitPrice != null ? Number(unitPrice) : ADDON_PRICES.extraPipeBoot;
    return pipeCount > 4 ? (pipeCount - 4) * rate : 0;
  }

  function roundToNearest(value, step) {
    const s = step || ROUND_TO;
    return Math.round(value / s) * s;
  }

  // Deposit math per spec (Rock 2 PR 4 — ported from classic estimates.js):
  //   • Cash mode default = 50% deposit at signing, 50% at completion
  //   • Insurance mode default = $0 down (ACV check covers the first half)
  //   • User can override the percent per-estimate (0–100 inclusive)
  //   • Amount is rounded to the nearest roundTo step ($25 by default) so
  //     it matches the rounding the customer sees on the grand total
  //   • Remainder = total − amount (so amount + remainder === total)
  // Returns the same shape as classic's calcDeposit so callers can swap.
  function calcDeposit(total, mode, opts) {
    const o = opts || {};
    const roundTo = Number(o.roundTo) || ROUND_TO;
    if (!total || total <= 0) return { pct: 0, amount: 0, remainder: 0 };
    const defaultPct = mode === 'insurance' ? 0 : 50;
    const overrideOk = (o.overridePct != null
                       && Number.isFinite(Number(o.overridePct))
                       && Number(o.overridePct) >= 0
                       && Number(o.overridePct) <= 100);
    const pct = overrideOk ? Number(o.overridePct) : defaultPct;
    const rawAmount = total * (pct / 100);
    const amount = roundToNearest(rawAmount, roundTo);
    const remainder = Math.round((total - amount) * 100) / 100;
    return { pct, amount, remainder };
  }

  // ═════════════════════════════════════════════════════════
  // SECTION 5 — Settings (localStorage, immutable updates)
  // ═════════════════════════════════════════════════════════

  const SETTINGS_KEY = 'nbd_est_settings_v2';

  function getDefaultSettings() {
    return {
      // Shared
      mode: 'per-sq',                  // default mode
      minJobCharge: MIN_JOB_CHARGE,
      dumpFee: DEFAULT_DUMP_FEE,
      permits: JSON.parse(JSON.stringify(PERMIT_COSTS)),
      countyTax: Object.assign({}, COUNTY_TAX),
      fallbackTaxRate: FALLBACK_TAX_RATE,
      internalView: false,
      roundTo: ROUND_TO,

      // Per-SQ mode
      tierRates:  Object.assign({}, TIER_RATES),
      costBasis:  Object.assign({}, DEFAULT_COST_BASIS),
      tearOffExtraPerSq: TEAR_OFF_EXTRA_PER_SQ,
      addonPrices: Object.assign({}, ADDON_PRICES),

      // Line-item mode
      overheadPct: DEFAULT_OVERHEAD_PCT,
      profitPct: DEFAULT_PROFIT_PCT,
      materialMarkupPct: DEFAULT_MATERIAL_MARKUP_PCT,
      catalog: JSON.parse(JSON.stringify(CATALOG))   // Copy so per-user edits don't mutate constants
    };
  }

  function loadSettings() {
    try {
      const raw = typeof localStorage !== 'undefined'
        ? localStorage.getItem(SETTINGS_KEY)
        : null;
      if (!raw) return getDefaultSettings();
      const saved = JSON.parse(raw);
      const defaults = getDefaultSettings();
      // Merge conservatively so any new fields always exist
      return Object.assign({}, defaults, saved, {
        tierRates:   Object.assign({}, defaults.tierRates, saved.tierRates || {}),
        costBasis:   Object.assign({}, defaults.costBasis, saved.costBasis || {}),
        permits:     Object.assign({}, defaults.permits, saved.permits || {}),
        countyTax:   Object.assign({}, defaults.countyTax, saved.countyTax || {}),
        addonPrices: Object.assign({}, defaults.addonPrices, saved.addonPrices || {}),
        catalog:     Object.assign({}, defaults.catalog, saved.catalog || {})
      });
    } catch (e) {
      console.warn('Failed to load estimate settings, using defaults:', e);
      return getDefaultSettings();
    }
  }

  function saveSettings(next) {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      return true;
    } catch (e) {
      console.warn('Failed to save estimate settings:', e);
      return false;
    }
  }

  function updateSettings(patch) {
    const current = loadSettings();
    const next = Object.assign({}, current, patch);
    saveSettings(next);
    return next;
  }

  // ═════════════════════════════════════════════════════════
  // SECTION 6 — Shared prep step (measurements → geometry)
  // ═════════════════════════════════════════════════════════

  function prepGeometry(input, settings) {
    const rawSqft = Math.max(0, Number(input.rawSqft) || 0);
    const pitchRatio = parsePitch(input.pitch);

    let waste = (input.wasteFactorOverride != null)
      ? Number(input.wasteFactorOverride)
      : wasteFactorForPitch(pitchRatio);
    if (input.cutUpRoof) waste += CUT_UP_ROOF_WASTE_BONUS;

    const adjustedSqft = rawSqft * waste;
    const sq = adjustedSqft / 100;

    return { rawSqft, pitchRatio, waste, adjustedSqft, sq };
  }

  // ═════════════════════════════════════════════════════════
  // SECTION 7 — PER-SQ MODE calculation
  // ═════════════════════════════════════════════════════════

  function calculatePerSq(input) {
    const s = input.settingsOverride || loadSettings();
    const tier = input.tier || 'better';
    const mode = input.mode || 'cash';
    const g = prepGeometry(input, s);
    const sq = g.sq;

    // Base from per-SQ flat rate
    const rate = Number(s.tierRates[tier]) || TIER_RATES[tier];
    const baseTotal = sq * rate;

    // Add-ons
    const addOns = {
      permit: 0, dumpFee: 0, tearOffExtra: 0, extraPipeBoots: 0,
      valleyMetal: 0, chimneyFlash: 0, skylightFlash: 0, gutters: 0
    };

    const permitKey = input.city || input.county || '';
    const permitInfo = s.permits[permitKey];
    addOns.permit = permitInfo ? Number(permitInfo.cost) : 0;
    addOns.dumpFee = Number(input.dumpFeeOverride != null ? input.dumpFeeOverride : s.dumpFee);

    const layers = Math.max(1, Number(input.tearOffLayers) || 1);
    if (layers > 1) {
      addOns.tearOffExtra = (layers - 1) * sq * Number(s.tearOffExtraPerSq);
    }

    addOns.extraPipeBoots = extraPipeBootCharge(
      Number(input.pipes) || 0,
      s.addonPrices.extraPipeBoot
    );

    if (input.hasChimneyFlash)  addOns.chimneyFlash  = Number(s.addonPrices.chimneyFlash);
    if (input.hasSkylightFlash) addOns.skylightFlash = Number(s.addonPrices.skylightFlash);

    if (input.valleyMetalLf) {
      addOns.valleyMetal = Number(input.valleyMetalLf) * Number(s.addonPrices.valleyMetalLf);
    }

    if (input.guttersLf) {
      const gRate = (input.guttersRatePerLf != null)
        ? Number(input.guttersRatePerLf)
        : Number(s.addonPrices.guttersLf);
      addOns.gutters = Number(input.guttersLf) * gRate;
    }

    const addOnsTotal = Object.keys(addOns).reduce((sum, k) => sum + (Number(addOns[k]) || 0), 0);

    // Subtotal + tax (insurance hides tax)
    const subtotal = baseTotal + addOnsTotal;
    const taxRate = (mode === 'insurance')
      ? 0
      : (s.countyTax[input.county || ''] != null
          ? Number(s.countyTax[input.county])
          : Number(s.fallbackTaxRate));
    const tax = subtotal * taxRate;

    // Grand total
    let total = subtotal + tax;
    total = roundToNearest(total, s.roundTo || ROUND_TO);

    // Minimum job
    let minJobApplied = false;
    const minJob = Number(s.minJobCharge) || MIN_JOB_CHARGE;
    if (total < minJob) {
      total = minJob;
      minJobApplied = true;
    }

    // Internal margin view
    const costPerSq = Number(s.costBasis[tier]) || DEFAULT_COST_BASIS[tier];
    const materialLaborCost = sq * costPerSq;
    const addOnCost = addOnsTotal * 0.4;
    const totalCost = materialLaborCost + addOnCost;
    const margin = total - totalCost;
    const marginPct = total > 0 ? (margin / total) * 100 : 0;

    // Deposit (Rock 2 PR 4 — shared calcDeposit replaces inline math)
    const depositInfo = calcDeposit(total, mode, {
      overridePct: input.depositOverridePct,
      roundTo: s.roundTo
    });
    const deposit = depositInfo.amount;

    return {
      method: 'per-sq',
      rawSqft: g.rawSqft,
      pitchRatio: g.pitchRatio,
      waste: g.waste,
      adjustedSqft: g.adjustedSqft,
      sq,
      tier, mode, rate,
      baseTotal,
      addOns,
      addOnsTotal,
      subtotal,
      depositPct: depositInfo.pct,
      depositRemainder: depositInfo.remainder,
      taxRate,
      tax,
      total,
      minJobApplied,
      deposit,
      internal: {
        costPerSq,
        materialLaborCost,
        addOnCost,
        totalCost,
        margin,
        marginPct
      }
    };
  }

  // ═════════════════════════════════════════════════════════
  // SECTION 8 — LINE-ITEM MODE calculation
  // ═════════════════════════════════════════════════════════

  /**
   * Auto-build a line-item list from measurements + tier.
   * User can edit, add, or remove items before final calc.
   */
  function generateLineItemsFromMeasurements(input, settings) {
    const s = settings || loadSettings();
    const g = prepGeometry(input, s);
    const tier = input.tier || 'better';
    const map = TIER_MATERIAL_MAP[tier] || TIER_MATERIAL_MAP.better;
    const cat = s.catalog || CATALOG;

    const items = [];

    // Helper to push an item from the catalog
    function addFromCatalog(catKey, qty, descOverride) {
      if (qty == null || qty <= 0) return;
      const spec = cat[catKey];
      if (!spec) return;
      items.push({
        catalogKey: catKey,
        code: spec.code,
        name: descOverride || spec.name,
        category: spec.category,
        unit: spec.unit,
        qty: Number(qty),
        materialCost: Number(spec.cost),
        laborCost: Number(spec.labor)
      });
    }

    // Shingles — by SQ
    addFromCatalog(map.shingle, g.sq);

    // Underlayment — by SQ
    addFromCatalog(map.underlayment, g.sq);

    // Ice & water shield — 5 SQ standard (eave + valleys)
    addFromCatalog('ice-water', 5);

    // Tear-off — always 1 layer by SQ
    addFromCatalog('tear-off', g.sq);
    // Extra layers
    const layers = Math.max(1, Number(input.tearOffLayers) || 1);
    if (layers > 1) {
      items.push({
        catalogKey: 'tear-off-extra-layer',
        code: 'RFG-TEAR',
        name: `Tear Off Additional Layer(s) × ${layers - 1}`,
        category: 'labor',
        unit: 'SQ',
        qty: g.sq * (layers - 1),
        materialCost: 0,
        laborCost: Number(cat['tear-off-extra-layer']?.labor || 50)
      });
    }

    // Starter strip — eave LF
    if (input.eaveLf) addFromCatalog('starter-strip', Number(input.eaveLf));

    // Drip edge — eave LF
    if (input.eaveLf) addFromCatalog('drip-edge', Number(input.eaveLf));

    // Ridge cap — ridge LF
    if (input.ridgeLf) addFromCatalog(map.ridgeCap, Number(input.ridgeLf));

    // Hip cap — hip LF (uses same material as ridge)
    if (input.hipLf) addFromCatalog(map.ridgeCap, Number(input.hipLf), 'Hip Cap Shingles');

    // Ridge vent — if ridge LF and vented
    if (input.ridgeLf && input.hasRidgeVent !== false) {
      addFromCatalog(map.ridgeVent, Number(input.ridgeLf));
    }

    // Pipe boots — 1 per pipe
    const pipes = Math.max(0, Number(input.pipes) || 0);
    for (let i = 0; i < pipes; i++) {
      addFromCatalog(map.pipeBoot, 1, `${cat[map.pipeBoot]?.name || 'Pipe Boot'} #${i + 1}`);
    }

    // Valley metal
    if (input.valleyMetalLf) addFromCatalog('valley-metal', Number(input.valleyMetalLf));

    // Chimney / skylight flashing
    if (input.hasChimneyFlash) addFromCatalog('chimney-flashing', 1);
    if (input.hasSkylightFlash) addFromCatalog('skylight-flashing', 1);

    // Decking — 15% default partial replacement
    const deckPct = input.deckReplacePct != null ? Number(input.deckReplacePct) : 0.15;
    if (deckPct > 0) {
      addFromCatalog('osb-decking', g.adjustedSqft * deckPct, `OSB Decking — ${Math.round(deckPct * 100)}% Replacement`);
    }

    // Nails / fasteners
    addFromCatalog(map.nails, g.sq);

    // Dump fee (once per job)
    addFromCatalog('dump-fee', 1);

    // Permit (from city lookup if available)
    const permitKey = input.city || input.county || '';
    const permitInfo = s.permits[permitKey];
    if (permitInfo) {
      items.push({
        catalogKey: 'permit-fee',
        code: 'PERMIT',
        name: `Building Permit — ${permitInfo.name}`,
        category: 'permit',
        unit: 'JOB',
        qty: 1,
        materialCost: Number(permitInfo.cost),
        laborCost: 0
      });
    }

    // Gutters — optional add-on
    if (input.guttersLf) {
      addFromCatalog('gutters-6in', Number(input.guttersLf));
    }

    return items;
  }

  /**
   * Calculate a line-item estimate.
   * Input can pass explicit `lineItems` OR measurements (which
   * will auto-generate them).
   */
  function calculateLineItem(input) {
    const s = input.settingsOverride || loadSettings();
    const tier = input.tier || 'better';
    const mode = input.mode || 'cash';
    const g = prepGeometry(input, s);

    // Build line items if not provided
    const items = (input.lineItems && input.lineItems.length)
      ? input.lineItems
      : generateLineItemsFromMeasurements(input, s);

    // Markup controls (allow per-estimate override)
    const overheadPct = Number(
      input.overheadPct != null ? input.overheadPct : s.overheadPct
    );
    const profitPct = Number(
      input.profitPct != null ? input.profitPct : s.profitPct
    );
    const materialMarkupPct = Number(
      input.materialMarkupPct != null ? input.materialMarkupPct : s.materialMarkupPct
    );

    // Roll up item totals
    let materialCost = 0;
    let laborCost = 0;
    const itemsWithTotals = items.map(it => {
      const qty = Number(it.qty) || 0;
      const matUnit = Number(it.materialCost) || 0;
      const labUnit = Number(it.laborCost) || 0;
      const matTotal = qty * matUnit;
      const labTotal = qty * labUnit;
      materialCost += matTotal;
      laborCost += labTotal;
      return Object.assign({}, it, {
        materialTotal: matTotal,
        laborTotal: labTotal,
        lineTotal: matTotal + labTotal
      });
    });

    // Material markup (bakes into retail)
    const materialRetail = materialCost * (1 + materialMarkupPct);
    const hardCost = materialCost + laborCost;
    const retailBeforeOHP = materialRetail + laborCost;

    // Overhead + profit (OH&P) — calculated on retail before OH&P
    const overhead = retailBeforeOHP * overheadPct;
    const profit = retailBeforeOHP * profitPct;

    // Subtotal
    const subtotal = retailBeforeOHP + overhead + profit;

    // Tax (insurance hides tax)
    const taxRate = (mode === 'insurance')
      ? 0
      : (s.countyTax[input.county || ''] != null
          ? Number(s.countyTax[input.county])
          : Number(s.fallbackTaxRate));
    const tax = subtotal * taxRate;

    // Grand total
    let total = subtotal + tax;
    total = roundToNearest(total, s.roundTo || ROUND_TO);

    // Minimum job
    let minJobApplied = false;
    const minJob = Number(s.minJobCharge) || MIN_JOB_CHARGE;
    if (total < minJob) {
      total = minJob;
      minJobApplied = true;
    }

    // Margin view (internal)
    const margin = total - hardCost;
    const marginPct = total > 0 ? (margin / total) * 100 : 0;

    // Deposit (Rock 2 PR 4 — shared calcDeposit replaces inline math)
    const depositInfo = calcDeposit(total, mode, {
      overridePct: input.depositOverridePct,
      roundTo: s.roundTo
    });
    const deposit = depositInfo.amount;

    return {
      method: 'line-item',
      rawSqft: g.rawSqft,
      pitchRatio: g.pitchRatio,
      waste: g.waste,
      adjustedSqft: g.adjustedSqft,
      sq: g.sq,
      tier, mode,

      items: itemsWithTotals,
      materialCost,
      materialRetail,
      laborCost,
      hardCost,
      retailBeforeOHP,

      overheadPct,
      overhead,
      profitPct,
      profit,
      materialMarkupPct,

      subtotal,
      depositPct: depositInfo.pct,
      depositRemainder: depositInfo.remainder,
      taxRate,
      tax,
      total,
      minJobApplied,
      deposit,

      internal: {
        materialCost,
        laborCost,
        hardCost,
        margin,
        marginPct
      }
    };
  }

  // ═════════════════════════════════════════════════════════
  // SECTION 9 — Unified dispatcher
  // ═════════════════════════════════════════════════════════

  /**
   * Main entry point — picks the right calculation path.
   *
   * input.method = 'per-sq' | 'line-item'  (default 'per-sq')
   */
  function calculateEstimate(input) {
    input = input || {};
    const method = input.method || 'per-sq';
    if (method === 'line-item') return calculateLineItem(input);
    return calculatePerSq(input);
  }

  /**
   * Calculate all three tiers at once for the tier card view.
   * Works with either method.
   */
  function calculateAllTiers(input) {
    return {
      good:   calculateEstimate(Object.assign({}, input, { tier: 'good' })),
      better: calculateEstimate(Object.assign({}, input, { tier: 'better' })),
      best:   calculateEstimate(Object.assign({}, input, { tier: 'best' }))
    };
  }

  // ═════════════════════════════════════════════════════════
  // SECTION 10 — Presets
  // ═════════════════════════════════════════════════════════
  const PRESETS = {
    'standard-reroof': {
      name: 'Standard Reroof',
      description: 'Tear-off + architectural shingles, cash job',
      defaults: { method: 'per-sq', tier: 'better', mode: 'cash', tearOffLayers: 1, cutUpRoof: false }
    },
    'storm-claim': {
      name: 'Storm Claim',
      description: 'Insurance claim, full line-item scope',
      defaults: { method: 'line-item', tier: 'better', mode: 'insurance', tearOffLayers: 1, hasChimneyFlash: true }
    },
    'small-repair': {
      name: 'Small Repair',
      description: 'Minor repair — min job charge applies',
      defaults: { method: 'per-sq', tier: 'good', mode: 'cash', tearOffLayers: 1 }
    },
    'full-redeck': {
      name: 'Full Redeck',
      description: 'Full decking replacement + best tier',
      defaults: { method: 'line-item', tier: 'best', mode: 'cash', tearOffLayers: 1, deckReplacePct: 1.0 }
    },
    'hail-damage-insurance': {
      name: 'Hail Damage Insurance',
      description: 'Impact shingles + full warranty package',
      defaults: {
        method: 'line-item', tier: 'best', mode: 'insurance', tearOffLayers: 1,
        hasChimneyFlash: true, hasSkylightFlash: true
      }
    }
  };

  // ── Custom presets (save-your-own) ──
  // Spec gap closed: users can capture their current estimate config
  // as a named preset. Stored in localStorage under a stable key so
  // they survive reloads. Built-ins above always take priority on key
  // collision — custom presets cannot overwrite the spec'd ones.
  const CUSTOM_PRESETS_KEY = 'nbd_est_custom_presets_v1';

  function loadCustomPresets() {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CUSTOM_PRESETS_KEY) : null;
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { return {}; }
  }

  function saveCustomPreset(name, defaults) {
    if (!name || typeof name !== 'string') throw new Error('preset name required');
    const trimmed = name.trim();
    if (!trimmed) throw new Error('preset name required');
    // Slugify for the key. Built-in keys can't be overwritten.
    const key = 'custom-' + trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (PRESETS[key]) throw new Error('that name conflicts with a built-in preset');
    const presets = loadCustomPresets();
    presets[key] = {
      name: trimmed,
      description: 'Custom preset',
      defaults: Object.assign({}, defaults || {}),
      savedAt: new Date().toISOString()
    };
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
      }
    } catch (_) {}
    return key;
  }

  function deleteCustomPreset(key) {
    const presets = loadCustomPresets();
    if (!presets[key]) return false;
    delete presets[key];
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
      }
    } catch (_) {}
    return true;
  }

  function getAllPresets() {
    // Built-ins first; customs cannot collide thanks to the 'custom-' prefix.
    return Object.assign({}, PRESETS, loadCustomPresets());
  }

  // ═════════════════════════════════════════════════════════
  // SECTION 11 — Public API
  // ═════════════════════════════════════════════════════════
  const EstimateBuilderV2 = {
    // Constants
    TIER_RATES,
    DEFAULT_COST_BASIS,
    MIN_JOB_CHARGE,
    PERMIT_COSTS,
    COUNTY_TAX,
    ADDON_PRICES,
    CATALOG,
    TIER_MATERIAL_MAP,
    PRESETS,
    // Custom-preset API (spec: "save your own preset")
    loadCustomPresets,
    saveCustomPreset,
    deleteCustomPreset,
    getAllPresets,
    DEFAULT_OVERHEAD_PCT,
    DEFAULT_PROFIT_PCT,
    DEFAULT_MATERIAL_MARKUP_PCT,

    // Settings
    getDefaultSettings,
    loadSettings,
    saveSettings,
    updateSettings,

    // Calculation
    calcDeposit,
    calculateEstimate,
    calculateAllTiers,
    calculatePerSq,
    calculateLineItem,
    generateLineItemsFromMeasurements,

    // Helpers
    parsePitch,
    wasteFactorForPitch,
    extraPipeBootCharge,
    roundToNearest,
    prepGeometry
  };

  if (typeof window !== 'undefined') {
    window.EstimateBuilderV2 = EstimateBuilderV2;
    window.calculateEstimateV2 = calculateEstimate;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = EstimateBuilderV2;
  }
})();
