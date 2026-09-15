/**
 * tests/smoke/photo-damage-canon.test.js — the /photos.damageType canon.
 *
 * docs/pro/js/photo-damage-types.js folds the four vocabularies that were
 * simultaneously written to /photos.damageType (verified 2026-09-08):
 *
 *   photo-editor.js            Title Case, 13 values
 *   customer-tasks-ui.js       Title Case, 10 values (shorter wording)
 *   customer.html bulk bar     kebab-case, 7 values
 *   photo-review.js + AI       snake_case, 7 values
 *
 * Like photo-report-pairs.test.js this loads the real file into a `vm`
 * sandbox and CALLS the exported functions — the module is a classic
 * script (no `export` syntax) specifically so this works.
 *
 * The pairing consequence is covered in photo-report-pairs.test.js, which
 * drives window._buildPhotoReportPairs with mixed-vocabulary photo objects.
 * This file covers the fold itself, and the cross-file contract with the
 * AI classifier's allowlist in functions/photo-vision.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT, FUNCTIONS } = require('./_shared');

let canon;
let loadError;
try {
  const src = fs.readFileSync(
    path.join(ROOT, 'docs/pro/js/photo-damage-types.js'),
    'utf8'
  );
  const sandbox = { window: {}, console: console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'photo-damage-types.js' });
  canon = sandbox.window.NBD_PHOTO_DAMAGE;
} catch (e) {
  loadError = e;
}

// The real AI sanitizer, so the allowlist contract is checked against
// running code rather than against a copy of the enum.
let sanitize;
try {
  const mod = require(path.join(FUNCTIONS, 'photo-vision.js'));
  sanitize = mod && mod._test && mod._test.sanitizeSuggestion;
} catch (e) { /* asserted below */ }

module.exports.run = function run(ctx) {
  const { assert, section } = ctx;

  section('/photos.damageType canon — real function calls');
  {
    assert('photo-damage-types.js loads in vm without throwing',
      !loadError, loadError ? loadError.message : '');
    assert('window.NBD_PHOTO_DAMAGE is exposed',
      !!canon && typeof canon.normalize === 'function');
    if (!canon || typeof canon.normalize !== 'function') return;

    // ── Every historical spelling folds to one canonical id ──
    // Grouped by peril. Each row is [canonical id, ...spellings seen in
    // the wild across the four surfaces].
    const folds = [
      ['hail',            'hail', 'Hail', 'HAIL', '  Hail  '],
      ['wind',            'wind', 'Wind'],
      ['wear',            'wear', 'Wear', 'wear_and_tear', 'Normal Wear'],
      ['granular_loss',   'granular_loss', 'granule-loss', 'Granular Loss', 'Granule Loss'],
      ['leak',            'leak', 'Leak'],
      ['missing_shingle', 'missing_shingle', 'missing-shingles', 'Missing Shingle', 'MISSING SHINGLES'],
      ['lifted_shingle',  'lifted_shingle', 'lifted-shingles', 'Lifted Shingle', 'Creased Shingles'],
      ['cracked_tile',    'cracked_tile', 'Cracked Tile', 'cracked tiles'],
      ['flashing',        'flashing', 'Flashing', 'Flashing Damage', 'flashing-damage'],
      ['gutter',          'gutter', 'Gutter', 'Gutter Damage', 'Gutters'],
      ['soffit_fascia',   'soffit_fascia', 'Soffit/Fascia', 'soffit', 'Fascia'],
      ['tree',            'tree', 'Tree Damage', 'tree-damage'],
      ['algae_moss',      'algae_moss', 'Algae/Moss', 'Moss'],
      ['ice_dam',         'ice_dam', 'Ice Dam', 'ice-dams'],
      ['ponding_water',   'ponding_water', 'Ponding Water'],
      ['none',            'none', 'None', 'No Damage'],
      ['other',           'other', 'Other'],
    ];
    for (const row of folds) {
      const id = row[0];
      for (let i = 1; i < row.length; i++) {
        assert('normalize(' + JSON.stringify(row[i]) + ') -> ' + id,
          canon.normalize(row[i]) === id,
          'got ' + JSON.stringify(canon.normalize(row[i])));
      }
    }

    // ── Perils stay DISTINCT ──
    // Without this, a normalizer that folded everything to 'other' would
    // satisfy every assertion above and every pairing fixture.
    {
      const ids = folds.map((r) => r[0]);
      const uniq = new Set(ids);
      assert('every canonical id is distinct (no over-eager folding)',
        uniq.size === ids.length,
        'expected ' + ids.length + ' distinct ids, got ' + uniq.size);
      assert('hail and wind do not fold together',
        !canon.same('Hail', 'wind'));
      assert('missing_shingle and lifted_shingle stay apart',
        !canon.same('missing-shingles', 'Lifted Shingle'));
      assert('granular_loss and wear stay apart',
        !canon.same('granule-loss', 'Wear'));
    }

    // ── Empty vs 'none' ──
    // 'none' is the AI saying "I looked, there is no damage"; '' is an
    // untagged photo. photo-review.js chipState must keep telling them
    // apart, so the fold must NOT collapse one into the other.
    {
      assert('empty string normalizes to empty', canon.normalize('') === '');
      assert('null normalizes to empty', canon.normalize(null) === '');
      assert('undefined normalizes to empty', canon.normalize(undefined) === '');
      assert('whitespace-only normalizes to empty', canon.normalize('   ') === '');
      assert("'none' does NOT collapse to empty", canon.normalize('none') === 'none');
      assert("'none' and '' are not the same value", !canon.same('none', ''));
    }

    // ── Unknown values survive instead of collapsing to 'other' ──
    // A rep's free text must still group with itself in the report's
    // tier-2 pairing, and folding it to 'other' would silently merge
    // unrelated perils into one pair.
    {
      assert('an unrecognized peril keeps its identity',
        canon.normalize('Ridge Cap Blowoff') === 'ridge_cap_blowoff',
        'got ' + canon.normalize('Ridge Cap Blowoff'));
      assert('an unrecognized peril is NOT folded to other',
        canon.normalize('Ridge Cap Blowoff') !== 'other');
      assert('two spellings of the same unknown peril still match',
        canon.same('Ridge Cap Blowoff', 'ridge-cap-blowoff'));
      assert('two DIFFERENT unknown perils do not match',
        !canon.same('Ridge Cap Blowoff', 'Skylight Seal'));
    }

    // ── Idempotence — normalize(normalize(x)) === normalize(x) ──
    // Values are normalized on write AND again on read, so a second pass
    // over an already-folded value must be a no-op.
    {
      let allIdempotent = true;
      let firstBad = '';
      for (const row of folds) {
        for (let i = 1; i < row.length; i++) {
          const once = canon.normalize(row[i]);
          if (canon.normalize(once) !== once) { allIdempotent = false; firstBad = row[i]; }
        }
      }
      assert('normalize is idempotent across every known spelling',
        allIdempotent, 'first non-idempotent input: ' + firstBad);
    }

    // ── Labels ──
    {
      assert("label('granule-loss') humanizes the kebab bulk-bar value",
        canon.label('granule-loss') === 'Granular loss',
        'got ' + canon.label('granule-loss'));
      assert("label('none') reads 'No damage', not 'None'",
        canon.label('none') === 'No damage');
      assert('label of an unknown peril is humanized, not leaked raw',
        canon.label('ridge-cap-blowoff') === 'Ridge cap blowoff',
        'got ' + canon.label('ridge-cap-blowoff'));
      assert('label of empty is empty', canon.label('') === '');
      // The seven labels photo-report.js _damageLabel carried inline
      // before the canon existed. If these drift, existing reports change
      // wording without anyone asking for it.
      const inherited = [
        ['hail', 'Hail'], ['wind', 'Wind'], ['wear', 'Wear'],
        ['granular_loss', 'Granular loss'], ['leak', 'Leak'],
        ['none', 'No damage'], ['other', 'Other'],
      ];
      for (const [id, want] of inherited) {
        assert('inherited report label preserved: ' + id + ' -> ' + want,
          canon.label(id) === want, 'got ' + canon.label(id));
      }
    }

    // ── options() feeds the pickers ──
    {
      const opts = canon.options();
      assert('options() returns [id, label] rows', Array.isArray(opts) && opts.length > 0);
      const allCanonical = opts.every(([id]) => canon.normalize(id) === id);
      assert('every option VALUE is already canonical (writes need no fixing)',
        allCanonical);
      const ids = opts.map(([id]) => id);
      assert('options() has no duplicate ids', new Set(ids).size === ids.length);
      assert('options() is a copy — mutating it does not corrupt the canon',
        (function () { canon.options().push(['junk', 'Junk']); return canon.options().length === opts.length; })());
    }

    // ── Cross-file contract: the AI classifier's allowlist ──
    // functions/photo-vision.js clamps Claude's output to its own enum and
    // writes the result to aiSuggestion.damageType, which photo-report.js
    // and photo-review.js read. Anything it can emit must already be
    // canonical, or those readers would re-spell values on every read.
    {
      assert('photo-vision _test.sanitizeSuggestion is available',
        typeof sanitize === 'function');
      if (typeof sanitize === 'function') {
        const aiEnum = ['hail', 'wind', 'wear', 'granular_loss', 'leak', 'none', 'other'];
        for (const v of aiEnum) {
          const out = sanitize({ damageType: v });
          assert('AI allowlist value survives its own sanitizer: ' + v,
            out.damageType === v, 'sanitizer returned ' + out.damageType);
          assert('AI-emitted ' + v + ' is already canonical',
            canon.normalize(v) === v,
            'canon would rewrite it to ' + canon.normalize(v));
        }
        // A rejected value falls back to 'other' — also canonical.
        const rejected = sanitize({ damageType: 'Roof - Hail' });
        assert('a rejected AI value falls back to a canonical id',
          canon.normalize(rejected.damageType) === rejected.damageType,
          'fallback ' + rejected.damageType + ' is not canonical');
      }
    }
  }

  // ── Load order ──
  // Every consumer resolves window.NBD_PHOTO_DAMAGE per call with a literal
  // fallback, so a bad order degrades labels rather than breaking a page —
  // except pages/photo-review.js, which builds FIELD_OPTIONS.damageType at
  // MODULE SCOPE. Classic scripts run before module scripts and deferred
  // scripts run in document order, so position in the file is the contract.
  section('/photos.damageType canon — page load order');
  {
    const pages = [
      // [page, consumers that must come after the canon]
      ['docs/pro/customer.html',
        ['js/customer-tasks-ui.js', 'js/photo-editor.js']],
      ['docs/pro/photo-review.html',
        ['js/pages/photo-review.js']],
    ];
    for (const [page, consumers] of pages) {
      const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
      const canonAt = html.indexOf('js/photo-damage-types.js');
      assert(page + ' loads photo-damage-types.js', canonAt !== -1);
      for (const c of consumers) {
        const at = html.indexOf('src="' + c);
        assert(page + ' loads the canon before ' + c,
          canonAt !== -1 && at !== -1 && canonAt < at,
          'canon at ' + canonAt + ', consumer at ' + at);
      }
    }
    // dashboard.html's photo-engine.js arrives via the lazy ScriptLoader
    // 'photos' bundle rather than a tag, so only presence is checkable.
    const dash = fs.readFileSync(path.join(ROOT, 'docs/pro/dashboard.html'), 'utf8');
    assert('docs/pro/dashboard.html loads photo-damage-types.js (photo-engine.js reads it)',
      dash.indexOf('js/photo-damage-types.js') !== -1);
  }

  section('backfill — photos.damageType one-off');
  {
    const p = path.join(ROOT, 'scripts/backfill-photos-damageType.js');
    assert('scripts/backfill-photos-damageType.js exists', fs.existsSync(p));
    if (fs.existsSync(p)) {
      const bf = fs.readFileSync(p, 'utf8');
      // The fold must come FROM the shared canon, not a second copy of the
      // alias table — two copies of this mapping is what caused the bug.
      assert('backfill loads the shared canon (no drift vs the client fold)',
        /photo-damage-types\.js/.test(bf) && /NBD_PHOTO_DAMAGE/.test(bf));
      assert('backfill is dry-run-by-default + --apply needs --yes',
        /APPLY && !YES/.test(bf) && /--apply --yes/.test(bf));
      // Only rewrite docs that actually differ, so re-running is a no-op.
      assert('backfill is idempotent (skips already-canonical docs)',
        /next === raw/.test(bf));
      // A blank damageType is an untagged photo, not a value to invent.
      assert('backfill never clears or invents a value',
        /raw == null \|\| raw === ''/.test(bf));
      assert('backfill registers with the run-once migration guard',
        /assertNotCompleted/.test(bf) && /recordCompletion/.test(bf));
    }
  }
};
