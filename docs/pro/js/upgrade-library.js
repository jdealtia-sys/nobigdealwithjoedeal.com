/**
 * upgrade-library.js — window.NBD_UPGRADE_LIBRARY
 *
 * The public, RETAIL-ONLY catalog of homeowner Upgrades & Add-ons. Gutters
 * first; the other trades follow the build order in the design note.
 *
 * WHY THIS EXISTS (2026-09-25). Every one of the 107 default Job Templates
 * prices identically at good, better and best: tier only reaches price through
 * EstimateLogic.resolveMaterial(materialId, tier), and no template line carries
 * a materialId. Meanwhile the real extras a homeowner can choose (leaf
 * protection, underground drains, gutter apron) were either silent pre-ticks
 * (seedChoices includes every `optional` line) or rep-only "Upsell:" notes
 * with no price. Jo's call: Upgrades & Add-ons is its OWN feature, never the
 * Good/Better/Best buttons. Decision + verified code facts:
 * documentation/projects/UPGRADES-ADDONS-DESIGN-2026-09-25.md.
 *
 * RULES THIS FILE KEEPS
 *  - RETAIL ONLY, integer cents. docs/ is the hosting root of a PUBLIC repo;
 *    a supplier or sub price written here is published to every reader and
 *    every tenant (tests/catalog-cost-privacy.test.js sweeps this file).
 *  - A price is either Jo-approved (priceStatus 'approved', retailCents set)
 *    or 'needs_price' with retailCents null. upgrade-pricing.js never prices
 *    a needs_price item for a homeowner; only a tenant's OWN saved price
 *    (Settings, stage 2) makes one quotable. No research-guess figure lives
 *    here, not even in a comment — a guessed number printed on a homeowner's
 *    paper is the exact failure the design note forbids.
 *  - Warranty wording is what the manufacturer actually warrants, and no
 *    more. LeafBlaster PRO is a limited PARTS warranty with no clog coverage,
 *    so its copy may never say lifetime or no-clog; Amerimax Lock-In carries
 *    its own 10-year limited warranty, stated as that and nothing else.
 *    tests/upgrade-pricing.test.js pins the banned words per item.
 *  - Tenant neutral. The certified installer's business name is tenant data
 *    (ctx.tenant.certifiedInstallerName); with none set the copy says "an
 *    independent certified installer". Installers are independent subs —
 *    copy never claims an in-house crew.
 *  - Dealer-locked guard systems are never offered, and a dropped product
 *    stays dropped: only the four leaf-protection lines below exist.
 *
 * Pure data, deep-frozen. Nothing loads this file yet — stage 2 wires the
 * Upgrades card into the Job Templates build screen.
 */
(function (root) {
  'use strict';

  function deepFreeze(o) {
    if (o && typeof o === 'object' && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.keys(o).forEach(function (k) { deepFreeze(o[k]); });
    }
    return o;
  }

  // Gutter guards are listed for 5" and 6" aluminum K-style. Any line whose
  // name says it is already a guard means a guard is in the BASE scope, and
  // a second one would bill the homeowner twice for the same gutter.
  var GUARD_SCOPE = {
    codes: ['GTR GG-MESH', 'GTR GG-MIC', 'GTR GG-REV'],
    names: ['gutter guard', 'leaf guard', 'micromesh', 'micro-mesh']
  };

  var LIBRARY = {
    // Bump on ANY change a saved quote could depend on (a price, a name, a
    // warranty sentence). Rows stamp it as upgradeVersion, so a signed paper
    // can always be traced to the wording it was quoted under.
    version: '2026-09-25.1',
    trade: 'gutters',
    currency: 'USD',

    groups: {
      leaf_protection: {
        label: 'Leaf protection',
        // Pick exactly one or none. Two guards on one gutter is not an
        // upgrade, it is a double charge.
        pick: 'one'
      }
    },

    items: [
      // ── Leaf protection (pick one) ─────────────────────────────────────
      // Prices: Jo, 2026-09-25. Alu-Rex was set at three times the Amerimax
      // screen rate.
      {
        id: 'amerimax_lockin_mesh',
        code: 'UPG LG-AMX',
        group: 'leaf_protection',
        name: 'Amerimax Lock-In steel mesh gutter guard',
        benefit: 'A steel mesh screen that locks onto the gutter and keeps leaves out.',
        unit: 'LF',
        priceStatus: 'approved',
        retailCents: 600,
        priceApproved: '2026-09-25',
        warrantyLine: 'Amerimax 10-year limited manufacturer warranty.',
        notCovered: null,
        installer: 'company',
        qtySource: 'gutter_lf',
        eligibility: 'kstyle_aluminum',
        requires: [],
        inScope: GUARD_SCOPE
      },
      {
        id: 'leafblaster_pro_micromesh',
        code: 'UPG LG-LBP',
        group: 'leaf_protection',
        name: 'LeafBlaster PRO stainless micromesh gutter guard',
        benefit: 'A fine stainless-steel mesh that screens out leaves and small debris.',
        unit: 'LF',
        priceStatus: 'approved',
        retailCents: 1200,
        priceApproved: '2026-09-25',
        warrantyLine: '40-year limited parts warranty.',
        notCovered: 'Parts only. The warranty does not cover clogging.',
        installer: 'company',
        qtySource: 'gutter_lf',
        eligibility: 'kstyle_aluminum',
        requires: [],
        inScope: GUARD_SCOPE
      },
      {
        id: 'leafblaster_pro_reinforced',
        code: 'UPG LG-LBR',
        group: 'leaf_protection',
        name: 'LeafBlaster PRO Frame-Reinforced micromesh gutter guard',
        benefit: 'The same stainless micromesh on a reinforced frame for added stiffness.',
        unit: 'LF',
        priceStatus: 'approved',
        retailCents: 1500,
        priceApproved: '2026-09-25',
        warrantyLine: '40-year limited parts warranty.',
        notCovered: 'Parts only. The warranty does not cover clogging, and it excludes excessive-snowfall events.',
        installer: 'company',
        qtySource: 'gutter_lf',
        eligibility: 'kstyle_aluminum',
        requires: [],
        inScope: GUARD_SCOPE
      },
      {
        id: 'alurex',
        code: 'UPG LG-ARX',
        group: 'leaf_protection',
        // The product depends on the gutter: Gutter Clean Pro fits EXISTING
        // gutters, DoublePro goes on with NEW gutters. upgrade-pricing.js
        // picks the variant from the template family (or ctx.newGutters).
        name: 'Alu-Rex gutter guard',
        benefit: 'An aluminum gutter guard system from Alu-Rex.',
        variants: {
          existing: {
            name: 'Alu-Rex Gutter Clean Pro gutter guard',
            benefit: 'An aluminum guard made to fit your existing gutters and keep leaves out.',
            warrantyLine: 'Alu-Rex lifetime clog-free limited warranty, transferable once.',
            notCovered: 'Pine-needle coverage comes with the new-gutter models (DoublePro, HoverPro), not Gutter Clean Pro.'
          },
          'new': {
            name: 'Alu-Rex DoublePro gutter guard',
            benefit: 'An aluminum guard installed with your new gutters.',
            warrantyLine: 'Alu-Rex lifetime clog-free limited warranty, transferable once; covers pine-needle areas.',
            notCovered: null
          }
        },
        unit: 'LF',
        priceStatus: 'approved',
        retailCents: 1800,
        priceApproved: '2026-09-25',
        warrantyLine: 'Alu-Rex lifetime clog-free limited warranty, transferable once.',
        notCovered: null,
        installer: 'certified_sub',
        certification: 'Alu-Rex',
        qtySource: 'gutter_lf',
        eligibility: 'kstyle_aluminum',
        requires: [],
        inScope: GUARD_SCOPE
      },

      // ── Other gutter upgrades: NO Jo-approved price yet ────────────────
      // retailCents stays null until a tenant saves its own price. The helper
      // refuses to put any of these on a homeowner quote before then.
      {
        id: 'gutter_apron',
        code: 'UPG GAPR',
        group: null,
        name: 'Gutter apron',
        benefit: 'Metal flashing under the shingle edge that sends water into the gutter, not behind it.',
        unit: 'LF',
        priceStatus: 'needs_price',
        retailCents: null,
        priceApproved: null,
        warrantyLine: null,
        notCovered: null,
        installer: 'company',
        qtySource: 'gutter_lf',
        eligibility: null,
        requires: [],
        // The K5 / K6 templates carry RFG GAPR as a silently pre-ticked
        // `optional` line. While that line is in scope the upgrade hides, so
        // the two can never bill the same apron twice.
        inScope: { codes: ['RFG GAPR'], names: ['gutter apron'] }
      },
      {
        id: 'downspout_3x4_step_up',
        code: 'UPG DSP34',
        group: null,
        name: 'Oversize 3x4 downspouts',
        benefit: 'Larger downspouts with twice the opening of standard 2x3.',
        unit: 'LF',
        priceStatus: 'needs_price',
        retailCents: null,
        priceApproved: null,
        warrantyLine: null,
        notCovered: null,
        installer: 'company',
        // Priced as the step-up ON TOP of the 2x3 already in the base, per
        // foot of 2x3 downspout being replaced.
        qtySource: 'downspout_2x3_lf',
        eligibility: 'has_2x3_downspouts',
        requires: [],
        inScope: { codes: [], names: [] }
      },
      {
        id: 'underground_drain',
        code: 'UPG UND-DR',
        group: null,
        name: 'Underground downspout drain',
        benefit: 'Buried pipe that carries roof water away from the foundation.',
        unit: 'LF',
        priceStatus: 'needs_price',
        retailCents: null,
        priceApproved: null,
        warrantyLine: null,
        notCovered: null,
        installer: 'company',
        qtySource: 'rep_entered',
        eligibility: null,
        requires: [],
        // The Guards Package and New Construction templates pre-tick GTR
        // UND-DR; same double-bill guard as the apron.
        inScope: { codes: ['GTR UND-DR'], names: ['underground drain'] }
      },
      {
        id: 'popup_emitter',
        code: 'UPG POPUP',
        group: null,
        name: 'Pop-up drain emitter',
        benefit: 'Opens at the end of the underground drain to let water out onto the lawn, then closes.',
        unit: 'EA',
        priceStatus: 'needs_price',
        retailCents: null,
        priceApproved: null,
        warrantyLine: null,
        notCovered: null,
        installer: 'company',
        qtySource: 'rep_entered',
        eligibility: null,
        // An emitter with no drain to sit on is not a sellable item.
        requires: ['underground_drain'],
        inScope: { codes: [], names: ['pop-up emitter', 'popup emitter'] }
      },
      {
        id: 'flip_up_extension',
        code: 'UPG FLIPUP',
        group: null,
        name: 'Flip-up downspout extension',
        benefit: 'A hinged extension that carries water away from the house and flips up for mowing.',
        unit: 'EA',
        priceStatus: 'needs_price',
        retailCents: null,
        priceApproved: null,
        warrantyLine: null,
        notCovered: null,
        installer: 'company',
        qtySource: 'downspout_count',
        eligibility: null,
        requires: [],
        // jt_gr_downspout_ext_4ea already ships "Hinged flip-up extension
        // kit" as a custom base line.
        inScope: { codes: [], names: ['flip-up'] }
      },
      {
        id: 'fascia_wrap',
        code: 'UPG FASC-W',
        group: null,
        name: 'Aluminum fascia wrap',
        benefit: 'Wraps the wood fascia board behind the gutter in painted aluminum.',
        unit: 'LF',
        priceStatus: 'needs_price',
        retailCents: null,
        priceApproved: null,
        warrantyLine: null,
        notCovered: null,
        installer: 'company',
        qtySource: 'gutter_lf',
        eligibility: null,
        requires: [],
        inScope: { codes: [], names: ['fascia wrap'] }
      }
    ],

    // ── Template families ────────────────────────────────────────────────
    // `offers` lists group or item ids, at most 5 per family (a pick-one
    // group counts once). `hide` names what a family must NOT offer, with
    // the rep-facing reason. `newGutters` picks the Alu-Rex variant.
    // `eaveLfIsWholeHouse` says the template's measurements.eaveLf is the
    // whole house's gutter footage; only then may a guard quantity fall back
    // to it (a hanger re-secure's 40 LF is the repaired run, not the house).
    families: {
      new_gutters: {
        label: 'New K-style gutter system',
        newGutters: true,
        eaveLfIsWholeHouse: false,
        offers: ['leaf_protection', 'gutter_apron', 'downspout_3x4_step_up', 'underground_drain', 'popup_emitter'],
        hide: {}
      },
      guards_package: {
        label: 'Gutters + guards package',
        newGutters: true,
        eaveLfIsWholeHouse: false,
        offers: ['gutter_apron', 'downspout_3x4_step_up', 'underground_drain', 'popup_emitter', 'fascia_wrap'],
        hide: {
          leaf_protection: 'The guard is already this package\'s base scope. Change it on the template\'s guard line.'
        }
      },
      premium_metal: {
        label: 'Half-round and copper gutters',
        newGutters: true,
        eaveLfIsWholeHouse: false,
        offers: ['underground_drain', 'popup_emitter'],
        hide: {
          leaf_protection: 'No guard on half-round or copper gutters: the guards are listed for 5" or 6" aluminum K-style, and an aluminum guard must not touch copper (LeafBlaster voids its warranty on copper contact).'
        }
      },
      downspout_only: {
        label: 'Downspouts only',
        newGutters: false,
        eaveLfIsWholeHouse: false,
        offers: ['downspout_3x4_step_up', 'underground_drain', 'popup_emitter', 'flip_up_extension'],
        hide: {
          leaf_protection: 'Downspout-only job: there is no gutter run in this scope to guard.'
        }
      },
      existing_service: {
        label: 'Cleaning and tune-up (existing gutters)',
        newGutters: false,
        eaveLfIsWholeHouse: true,
        offers: ['leaf_protection', 'flip_up_extension', 'underground_drain', 'popup_emitter'],
        hide: {}
      },
      existing_repair: {
        label: 'Gutter repair (existing gutters)',
        newGutters: false,
        eaveLfIsWholeHouse: false,
        offers: ['leaf_protection', 'fascia_wrap', 'flip_up_extension'],
        hide: {}
      },
      downspout_repair: {
        label: 'Downspout repair',
        newGutters: false,
        eaveLfIsWholeHouse: false,
        offers: ['underground_drain', 'popup_emitter', 'flip_up_extension'],
        hide: {
          leaf_protection: 'Downspout job: there is no gutter run in this scope to guard.'
        }
      },
      guard_install: {
        label: 'Gutter guard install',
        newGutters: false,
        eaveLfIsWholeHouse: false,
        offers: [],
        hide: {
          leaf_protection: 'The guard is this job\'s base scope. Choose the product on the template\'s guard line.'
        }
      }
    },

    // Every gutters_install / gutters_repair template id in
    // job-templates-data.js → its family. The test fails if a gutter template
    // is added without a row here, so a new template can never silently
    // offer nothing.
    templates: {
      jt_gi_k5_seamless_full: 'new_gutters',
      jt_gi_k6_oversize: 'new_gutters',
      jt_gi_partial_run_60: 'new_gutters',
      jt_gi_new_construction: 'new_gutters',
      jt_gi_gutters_guards_package: 'guards_package',
      jt_gi_half_round: 'premium_metal',
      jt_gi_copper_accent: 'premium_metal',
      jt_gi_downspout_only: 'downspout_only',
      jt_gr_clean_1story: 'existing_service',
      jt_gr_clean_2story: 'existing_service',
      jt_gr_tuneup_package: 'existing_service',
      jt_gr_hanger_resecure: 'existing_repair',
      jt_gr_reseal: 'existing_repair',
      jt_gr_slope_correction: 'existing_repair',
      jt_gr_section_replace_20lf: 'existing_repair',
      jt_gr_downspout_replace_2ea: 'downspout_repair',
      jt_gr_downspout_ext_4ea: 'downspout_repair',
      jt_gr_guard_install_50lf: 'guard_install'
    }
  };

  root.NBD_UPGRADE_LIBRARY = deepFreeze(LIBRARY);
})(typeof window !== 'undefined' ? window : this);
