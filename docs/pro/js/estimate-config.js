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
// These exist in both engines but with different SHAPES, not
// just different values, so a PR 3b will need to reconcile the
// data model before they can share a source:
//
//   • COUNTY_TAX_RATES (classic)  vs COUNTY_TAX (V2)
//       Classic keys are bare county names ("Hamilton")
//       V2 keys are county-state slugs ("hamilton-oh")
//   • PERMIT_COSTS (classic)      vs PERMIT_COSTS (V2)
//       Classic keys are city names + bare numeric values
//       V2 keys are county-state slugs + {name, cost} objects
//   • recommendedWasteForPitch (classic) vs wasteFactorForPitch (V2)
//       Classic input is pitch FACTOR (1.054, 1.118, ...)
//       V2 input is pitch RATIO (0.33, 0.50, ...)
//       Different bucket cutoffs AND different output values.
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

    // Add-on flat charges (Rock 2 PR 4b — Joe-confirmed prices).
    // Classic and V2 had divergent values for these:
    //   chimney: classic $425, V2 $285 → unified at $425 (Joe pick)
    //   skylight: classic $275, V2 $350 → unified at $350 (Joe pick)
    // Valley LF and extra-pipe-boot stay engine-specific for now —
    // both Joe-flagged "low margin", revisit later if it matters.
    ADDON_CHIMNEY_FLASH:  425,
    ADDON_SKYLIGHT_FLASH: 350,

    // Source-of-truth marker — engines log this to Sentry on
    // load so we can correlate "classic engine ran but V2 config
    // didn't load" cases if they ever happen.
    _version: '2026-04-25',
    _loadedFrom: 'estimate-config.js'
  });

  if (typeof window !== 'undefined') {
    window.NBD_ESTIMATE_CONFIG = CFG;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CFG;
  }
})();
