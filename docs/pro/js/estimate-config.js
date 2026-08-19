// ============================================================
// NBD Pro — Estimate Pricing Config (single source of truth)
// Phase 3 of BIG_ROCKS Rock 2 (estimate engine consolidation).
//
// Both estimates.js (classic) and estimate-builder-v2.js (EBv2)
// previously kept their own copies of these constants. A change
// in one engine could quietly diverge from the other. This file
// is the canonical home so a single edit propagates to both.
//
// ─── WHAT'S UNIFIED HERE ─────────────────────────────────────
// Tables/values where both engines used identical SHAPES with
// identical SEMANTIC values, and only the literals were duplicated:
//
//   • TIER_RATES                   (good/better/best per-SQ)
//   • JOB_MINIMUM_DOLLARS / _CENTS (the 100x unit-mismatch trap)
//   • ROUND_TO_DOLLARS / _CENTS    (same)
//   • DEFAULT_DUMP_FEE
//   • CUT_UP_ROOF_WASTE_BONUS
//   • TEAR_OFF_EXTRA_PER_SQ_DOLLARS / _CENTS
//
// Both engines read these as `window.NBD_ESTIMATE_CONFIG.<name>`
// with an inline fallback to the historical literal — so if this
// file fails to load, pricing still works on stale-but-correct
// values and a console.warn surfaces the misload to Sentry.
//
// ─── WHAT'S NOT UNIFIED YET (drift risks remaining) ──────────
// ─── SHAPE-RECONCILED TABLES (PR 3b) ─────────────────────────
// COUNTY_TAX and the permit tables are canonically keyed here by
// county-state slug (V2's shape). Each engine derives the shape
// it historically used:
//   • V2 reads COUNTY_TAX rates / PERMIT_COSTS_BY_COUNTY directly.
//   • Classic derives its bare-county-name tax map via each
//     entry's `name`, and its city-keyed permit map via
//     PERMIT_CITY_TO_COUNTY (the D-1 unify basis, Joe 2026-06-09:
//     every city's default is its primary county's cost).
// The waste-for-pitch divergence is already resolved in code:
// classic's recommendedWasteForPitch delegates to V2's
// wasteFactorForPitch (D-2 unify), converting factor → ratio.
//
// Migration tracker: docs/dev/estimate-engines-audit.md
// ============================================================

(function () {
  'use strict';

  const CFG = Object.freeze({
    // Per-SQ flat tier rates (locked spec, 2026-04-10).
    // Customer price = SQ × TIER_RATE + add-ons + tax (cash mode).
    TIER_RATES: Object.freeze({
      good:   545,   // Standard system + standard accessories
      better: 595,   // Upgraded materials + system warranty
      best:   660    // Impact-rated + 50yr warranty package
    }),

    // Job minimum: kicks in below ~4.5 SQ. Both unit forms exposed
    // so each engine reads the unit it already uses without the
    // 100x bug risk that came from one file storing 250000 (cents)
    // and the other storing 2500 (dollars).
    JOB_MINIMUM_DOLLARS: 2500,
    JOB_MINIMUM_CENTS:   250000,

    // Grand-total rounding step.
    ROUND_TO_DOLLARS: 25,
    ROUND_TO_CENTS:   2500,

    // Per-SQ extra layer charge (tear-off layers > 1).
    TEAR_OFF_EXTRA_PER_SQ_DOLLARS: 50,
    TEAR_OFF_EXTRA_PER_SQ_CENTS:   5000,

    // Editable per-estimate, this is the default.
    DEFAULT_DUMP_FEE: 550,

    // +3% waste added on top of pitch-based waste when the
    // "cut-up roof" checkbox is on.
    CUT_UP_ROOF_WASTE_BONUS: 0.03,

    // ── County sales tax (PR 3b) ─────────────────────────────
    // Canonical key: county-state slug (V2's shape). `name` is the
    // bare county name classic keys by — estimates.js derives its
    // COUNTY_TAX_RATES map from it, estimate-builder-v2.js reads
    // the rates directly. Edit a rate HERE and both engines move.
    // Rates validated 2026-04 (OH DOT / KY DOR).
    COUNTY_TAX: Object.freeze({
      'hamilton-oh': Object.freeze({ name: 'Hamilton', rate: 0.0780 }),
      'butler-oh':   Object.freeze({ name: 'Butler',   rate: 0.0725 }),
      'warren-oh':   Object.freeze({ name: 'Warren',   rate: 0.0675 }),
      'clermont-oh': Object.freeze({ name: 'Clermont', rate: 0.0725 }),
      'kenton-ky':   Object.freeze({ name: 'Kenton',   rate: 0.0600 }),
      'boone-ky':    Object.freeze({ name: 'Boone',    rate: 0.0600 }),
      'campbell-ky': Object.freeze({ name: 'Campbell', rate: 0.0600 })
    }),
    DEFAULT_TAX_RATE: 0.07,

    // ── Permit costs (PR 3b) ─────────────────────────────────
    // Canonical key: county-state slug with {name, cost} (V2's
    // shape). Classic keys by CITY — PERMIT_CITY_TO_COUNTY maps
    // each city to its primary county (D-1 unify, Joe 2026-06-09;
    // Loveland spans 3 counties → Hamilton primary, rep-overridable
    // per estimate). estimates.js derives its city→cost map from
    // these two tables.
    PERMIT_COSTS_BY_COUNTY: Object.freeze({
      'hamilton-oh': Object.freeze({ name: 'Hamilton County, OH', cost: 185 }),
      'butler-oh':   Object.freeze({ name: 'Butler County, OH',   cost: 150 }),
      'warren-oh':   Object.freeze({ name: 'Warren County, OH',   cost: 165 }),
      'clermont-oh': Object.freeze({ name: 'Clermont County, OH', cost: 170 }),
      'kenton-ky':   Object.freeze({ name: 'Kenton County, KY',   cost: 125 }),
      'boone-ky':    Object.freeze({ name: 'Boone County, KY',    cost: 135 }),
      'campbell-ky': Object.freeze({ name: 'Campbell County, KY', cost: 130 })
    }),
    PERMIT_CITY_TO_COUNTY: Object.freeze({
      Cincinnati: 'hamilton-oh', Loveland: 'hamilton-oh',
      Hamilton: 'butler-oh', Fairfield: 'butler-oh', 'West Chester': 'butler-oh',
      Mason: 'warren-oh',
      Milford: 'clermont-oh',
      Covington: 'kenton-ky',
      Florence: 'boone-ky',
      'Fort Thomas': 'campbell-ky', Newport: 'campbell-ky'
    }),
    DEFAULT_PERMIT_COST: 150,

    // Add-on flat charges (Rock 2 PR 4b — Joe-confirmed prices).
    // Classic and V2 had divergent values for these:
    //   chimney: classic $425, V2 $285 → unified at $425 (Joe pick)
    //   skylight: classic $275, V2 $350 → unified at $350 (Joe pick)
    //   extra pipe boot: classic $45, V2 $85 → unified at $85 (D-4, Joe 2026-06-09)
    ADDON_CHIMNEY_FLASH:  425,
    ADDON_SKYLIGHT_FLASH: 350,
    // Extra pipe boot beyond 4 ($/EA). D-4 unify: classic now reads this instead
    // of its legacy $45 (window.R.pipe fallback), matching V2's $85.
    ADDON_EXTRA_PIPE_BOOT: 85,
    // Material delivery + fuel surcharge — FLAT PER JOB (no _PER_SQ suffix:
    // the suffix is the unit contract in this file). Per-SQ mode's twin of
    // line-item catalog line 'MAT DEL' (estimate-catalog-xactimate.js, unit
    // JOB). This is a RETAIL CHARGE, not a cost: it is that line's published
    // baseline carried through the same chain calculateLineItem applies —
    // material markup 25%, then overhead 10% + profit 10% — so a homeowner is
    // quoted the same delivery money whichever mode the rep opened.
    // Parity holds at the DEFAULT markup ladder; a shop that edits OH&P moves
    // line-item's figure and not this one.
    ADDON_MAT_DELIVERY: 412.50,

    // Per-SQ complexity add-ons (Phase 1, Joe-confirmed 2026-06-08).
    // Surfaced into the per-SQ engine (calculatePerSq) so cash/retail
    // Good-Better-Best pricing reflects the same complexity the line-item
    // labor adders (LAB ADR-SS/VS/2S/CU) already catch.
    //   PITCH tiers STACK: 8/12 → +steep, 12/12 → +very-steep, 16/12 → +extreme.
    //   STORY + ACCESS tiers REPLACE (a 3-story job pays the 3-story rate only).
    //   Cut-up adds cutting LABOR on top of the +3% material waste (separate).
    ADDON_STEEP_PER_SQ:            25,   // pitch 8/12+
    ADDON_VERY_STEEP_PER_SQ:       45,   // pitch 12/12+ (stacks → $70/SQ at 12/12)
    ADDON_EXTREME_STEEP_PER_SQ:    75,   // pitch 16/12+ (stacks → $145/SQ at 16/12)
    ADDON_TWO_STORY_PER_SQ:        15,   // exactly 2 stories
    ADDON_THREE_STORY_PER_SQ:      30,   // 3+ stories (replaces 2-story rate)
    ADDON_CUTUP_PER_SQ:            15,   // cutting labor (material waste +3% is separate)
    ADDON_ACCESS_MODERATE_PER_SQ:  15,   // tight lot / longer carry / protect landscaping
    ADDON_ACCESS_DIFFICULT_PER_SQ: 35,   // no driveway / hillside (crane/boom = equipment lines)

    // Source-of-truth marker — engines log this to Sentry on
    // load so we can correlate "classic engine ran but V2 config
    // didn't load" cases if they ever happen.
    _version: '2026-06-08',
    _loadedFrom: 'estimate-config.js'
  });

  if (typeof window !== 'undefined') {
    window.NBD_ESTIMATE_CONFIG = CFG;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CFG;
  }
})();
