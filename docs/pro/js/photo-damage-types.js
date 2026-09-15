/**
 * photo-damage-types.js — the ONE vocabulary for /photos.damageType.
 *
 * Why this file exists
 * ────────────────────
 * Four surfaces wrote `damageType` onto the same /photos docs, each with
 * its own spelling of the same perils (verified 2026-09-08):
 *
 *   1. photo-editor.js DAMAGE_TYPES     Title Case, 13 values
 *      'Hail' 'Wind' 'Leak' 'Missing Shingle' 'Cracked Tile'
 *      'Flashing Damage' 'Gutter Damage' 'Soffit/Fascia' 'Tree Damage'
 *      'Algae/Moss' 'Ice Dam' 'Ponding Water' 'Other'
 *   2. customer-tasks-ui.js quick-edit  Title Case, 10 values — same list
 *      MINUS Algae/Moss, Ice Dam, Ponding Water, and with 'Flashing' /
 *      'Gutter' instead of 'Flashing Damage' / 'Gutter Damage'.
 *   3. customer.html bulk bar           kebab-case, 7 values
 *      'hail' 'wind' 'missing-shingles' 'leak' 'granule-loss'
 *      'lifted-shingles' 'other'
 *   4. pages/photo-review.js + functions/photo-vision.js   snake_case, 7
 *      'hail' 'wind' 'wear' 'granular_loss' 'leak' 'none' 'other'
 *
 * What that cost
 * ──────────────
 * photo-report.js `_buildPairs` tier 2 groups before/after candidates by
 * damageType. Its `normKey` already lowercases, so 'Hail'/'hail' DID pair
 * — the breakage was SEPARATOR and WORDING drift, which lowercasing does
 * not touch:
 *
 *   'granule-loss'   (bulk bar) vs 'granular_loss'   (AI)      → no pair
 *   'Missing Shingle'(editor)   vs 'missing-shingles'(bulk bar)→ no pair
 *   'Flashing Damage'(editor)   vs 'Flashing'  (quick-edit)    → no pair
 *   'Gutter Damage'  (editor)   vs 'Gutter'    (quick-edit)    → no pair
 *
 * And a missed tier-2 pair is worse than "one fewer pair": when tiers 1+2
 * find NOTHING, tier 3 fires and emits a chronological pair labeled
 * "Project overview" — so two photos of the same peril get shown to an
 * adjuster under a generic label instead of "Damage: granular loss".
 *
 * photo-review.js `chipState` has the same class of bug: it compares
 * `photo.damageType === aiSuggestion.damageType` to decide accepted vs
 * overridden, so a rep who picked 'Hail' in the editor over an AI 'hail'
 * suggestion saw an "overridden" chip they never overrode.
 *
 * The canon
 * ─────────
 * lowercase snake_case — the form the AI classifier already emits and the
 * form photo-report.js `_damageLabel` already humanizes. CANONICAL below
 * is the UNION of all four lists, so adopting it loses no value that any
 * surface could previously record.
 *
 * Contract: normalize() on every WRITE, and again on every READ, so
 * existing docs behave correctly with no backfill. The backfill
 * (scripts/backfill-photos-damageType.js) is tidiness, not a dependency.
 *
 * Classic script on purpose — not an ES module. photo-report.js is loaded
 * into a Node `vm` sandbox by tests/smoke/photo-report-pairs.test.js with
 * a bare `{ window: {} }` context; `export` syntax would not run there.
 * Consumers read window.NBD_PHOTO_DAMAGE, and the module-type consumer
 * (pages/photo-review.js) reads the same global.
 */
(function () {
  'use strict';

  // Canonical id → display label. Sentence case for multi-word: the
  // labels for the seven values photo-report.js already knew are
  // reproduced EXACTLY ('Granular loss', 'No damage', …) so adopting this
  // table changes no existing report output for the common case.
  var CANONICAL = [
    ['hail',            'Hail'],
    ['wind',            'Wind'],
    ['wear',            'Wear'],
    ['granular_loss',   'Granular loss'],
    ['leak',            'Leak'],
    ['missing_shingle', 'Missing shingle'],
    ['lifted_shingle',  'Lifted shingle'],
    ['cracked_tile',    'Cracked tile'],
    ['flashing',        'Flashing damage'],
    ['gutter',          'Gutter damage'],
    ['soffit_fascia',   'Soffit / fascia'],
    ['tree',            'Tree damage'],
    ['algae_moss',      'Algae / moss'],
    ['ice_dam',         'Ice dam'],
    ['ponding_water',   'Ponding water'],
    ['none',            'No damage'],
    ['other',           'Other']
  ];

  var LABELS = {};
  for (var i = 0; i < CANONICAL.length; i++) LABELS[CANONICAL[i][0]] = CANONICAL[i][1];

  // Slugs that mean an existing canonical id under another name. Keyed by
  // the POST-slugify form, so 'Flashing Damage', 'flashing-damage' and
  // 'flashing_damage' all arrive here as 'flashing_damage'.
  //
  // 'none' is deliberately NOT mapped to '' — the AI returns it to mean
  // "I looked, there is no damage", which is a different claim from an
  // untagged photo, and chipState() must keep telling them apart.
  var ALIASES = {
    granule_loss:      'granular_loss',
    granular_loss:     'granular_loss',
    granule_lost:      'granular_loss',
    missing_shingles:  'missing_shingle',
    lifted_shingles:   'lifted_shingle',
    creased_shingle:   'lifted_shingle',
    creased_shingles:  'lifted_shingle',
    cracked_tiles:     'cracked_tile',
    flashing_damage:   'flashing',
    gutter_damage:     'gutter',
    gutters:           'gutter',
    tree_damage:       'tree',
    soffit:            'soffit_fascia',
    fascia:            'soffit_fascia',
    ice_dams:          'ice_dam',
    algae:             'algae_moss',
    moss:              'algae_moss',
    wear_and_tear:     'wear',
    normal_wear:       'wear',
    no_damage:         'none'
  };

  /**
   * Fold any historical spelling to its canonical id.
   *
   * Unknown values are slugified and PASSED THROUGH rather than collapsed
   * to 'other'. Two reasons: a rep's free-text peril still pairs with
   * itself in tier 2, and no information is destroyed on write — a value
   * we do not recognize today can be aliased later without a re-backfill.
   *
   * @param {*} v raw field value from any surface or era
   * @returns {string} canonical id, or '' when there is no value
   */
  function normalize(v) {
    var slug = String(v == null ? '' : v)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (!slug) return '';
    return ALIASES[slug] || slug;
  }

  /**
   * Human-readable label for any spelling, canonical or not.
   * Unknown slugs are humanized ('roof_hail' → 'Roof hail') rather than
   * leaked raw, which is what let the kebab-case bulk-bar values render
   * as a literal "granule-loss" in the adjuster report.
   */
  function label(v) {
    var id = normalize(v);
    if (!id) return '';
    if (LABELS[id]) return LABELS[id];
    var words = id.replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  /** True when two values name the same peril despite different spelling. */
  function same(a, b) {
    var x = normalize(a);
    return !!x && x === normalize(b);
  }

  /** [[id, label], …] for building a <select> / picker. */
  function options() {
    return CANONICAL.map(function (row) { return [row[0], row[1]]; });
  }

  window.NBD_PHOTO_DAMAGE = {
    normalize: normalize,
    label: label,
    same: same,
    options: options,
    CANONICAL: CANONICAL
  };
})();
