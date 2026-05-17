/**
 * tests/smoke/photo-vision-sanitizer.test.js — §3.2 unit tests for
 * photo-vision.js's sanitizeSuggestion.
 *
 * Most photo smoke tests are static regex-over-source — they check
 * that *patterns* exist in the file. This file is different: it
 * `require`s functions/photo-vision.js, calls the actual
 * sanitizeSuggestion function via its `_test` export, and asserts
 * on the returned object.
 *
 * sanitizeSuggestion is the boundary between Claude's free-form
 * vision output and the photo doc — every field flows through it
 * before getting written to Firestore. A drift in the model or a
 * pathological response that bypasses the allowlist would poison
 * downstream UI. The function is pure (no I/O, no globals), trivial
 * to unit-test, and was *already* exported for testing via
 * `exports._test = { sanitizeSuggestion }` — only the test itself
 * was missing.
 */

'use strict';

const path = require('path');
const { FUNCTIONS } = require('./_shared');

// Load once at module scope so any require() side effect (e.g.
// defineSecret warnings from firebase-functions) surfaces in the
// smoke output rather than at first assert.
let sanitize;
let loadError;
try {
  const mod = require(path.join(FUNCTIONS, 'photo-vision.js'));
  sanitize = mod && mod._test && mod._test.sanitizeSuggestion;
} catch (e) {
  loadError = e;
}

module.exports.run = function run(ctx) {
  const { assert, section } = ctx;

  section('§3.2.a photo-vision sanitizer — real function calls (not regex)');
  {
    assert('photo-vision.js loads without throwing',
      !loadError,
      loadError ? loadError.message : '');
    assert('_test.sanitizeSuggestion is exported',
      typeof sanitize === 'function',
      'expected exports._test.sanitizeSuggestion to be a function');

    if (typeof sanitize !== 'function') return; // can't run the rest

    // ── Happy path: every field set, all values in their allowlists ──
    {
      const out = sanitize({
        phase: 'Before',
        damageType: 'hail',
        severity: 'moderate',
        caption: 'Hail bruising visible on the north slope.',
        confidence: 0.85,
      });
      assert('happy path: phase passes through',         out.phase === 'Before');
      assert('happy path: damageType passes through',    out.damageType === 'hail');
      assert('happy path: severity passes through',      out.severity === 'moderate');
      assert('happy path: caption passes through',       out.caption === 'Hail bruising visible on the north slope.');
      assert('happy path: confidence passes through',    out.confidence === 0.85);
    }

    // ── phase allowlist: only Before/During/After accepted ──
    {
      assert('phase: "Before" accepted',  sanitize({ phase: 'Before' }).phase  === 'Before');
      assert('phase: "During" accepted',  sanitize({ phase: 'During' }).phase  === 'During');
      assert('phase: "After"  accepted',  sanitize({ phase: 'After'  }).phase  === 'After');
      // Anything else gets nulled out. Model occasionally returns
      // "Repair" or lowercase variants — both should reject.
      assert('phase: "repair" rejected → null', sanitize({ phase: 'repair' }).phase === null);
      assert('phase: "before" (lowercase) rejected → null', sanitize({ phase: 'before' }).phase === null);
      assert('phase: numeric rejected → null',  sanitize({ phase: 42 }).phase === null);
      assert('phase: missing → null default',   sanitize({}).phase === null);
    }

    // ── damageType allowlist ──
    {
      const allowed = ['hail', 'wind', 'wear', 'granular_loss', 'leak', 'none', 'other'];
      let ok = true;
      for (const v of allowed) {
        if (sanitize({ damageType: v }).damageType !== v) { ok = false; break; }
      }
      assert('damageType: all 7 allowlist values pass through', ok);
      // Out-of-allowlist values fall back to "other" (the safe default).
      assert('damageType: "ROOF_DAMAGE" rejected → "other"',
        sanitize({ damageType: 'ROOF_DAMAGE' }).damageType === 'other');
      assert('damageType: missing → "other" default',
        sanitize({}).damageType === 'other');
    }

    // ── severity allowlist ──
    {
      assert('severity: "minor" accepted',    sanitize({ severity: 'minor'    }).severity === 'minor');
      assert('severity: "moderate" accepted', sanitize({ severity: 'moderate' }).severity === 'moderate');
      assert('severity: "severe" accepted',   sanitize({ severity: 'severe'   }).severity === 'severe');
      // "none" is NOT a severity — it's a damageType. Don't accept it here.
      assert('severity: "none" rejected → null (none is a damageType)',
        sanitize({ severity: 'none' }).severity === null);
      assert('severity: missing → null default', sanitize({}).severity === null);
    }

    // ── caption: ≤200 chars + trimmed ──
    {
      assert('caption: short string passes through',
        sanitize({ caption: 'hail bruise' }).caption === 'hail bruise');
      assert('caption: surrounding whitespace trimmed',
        sanitize({ caption: '   spaced out   ' }).caption === 'spaced out');
      const long = 'x'.repeat(500);
      const out = sanitize({ caption: long });
      assert('caption: 500-char string truncated to ≤200',
        out.caption.length <= 200 && out.caption.length > 0);
      assert('caption: non-string defaults to empty',
        sanitize({ caption: { malicious: 'object' } }).caption === '');
      assert('caption: missing → empty string', sanitize({}).caption === '');
    }

    // ── confidence: clamped to [0, 1] ──
    {
      assert('confidence: 0.5 passes through',  sanitize({ confidence: 0.5 }).confidence === 0.5);
      assert('confidence: 0 passes through',    sanitize({ confidence: 0   }).confidence === 0);
      assert('confidence: 1 passes through',    sanitize({ confidence: 1   }).confidence === 1);
      assert('confidence: 1.5 clamps to 1',     sanitize({ confidence: 1.5 }).confidence === 1);
      assert('confidence: -0.3 clamps to 0',    sanitize({ confidence: -0.3 }).confidence === 0);
      assert('confidence: NaN → 0.5 default',   sanitize({ confidence: NaN }).confidence === 0.5);
      assert('confidence: string rejected → 0.5 default',
        sanitize({ confidence: '0.9' }).confidence === 0.5);
      assert('confidence: missing → 0.5 default', sanitize({}).confidence === 0.5);
    }

    // ── Null safety ──
    {
      // Defensive: model could return null, string, or array instead of object.
      assert('null input → safe defaults',  (() => {
        const o = sanitize(null);
        return o.phase === null && o.damageType === 'other'
            && o.severity === null && o.caption === '' && o.confidence === 0.5;
      })());
      assert('undefined input → safe defaults', (() => {
        const o = sanitize(undefined);
        return o.phase === null && o.damageType === 'other';
      })());
      assert('string input → safe defaults', (() => {
        const o = sanitize('not an object');
        return o.damageType === 'other';
      })());
      assert('array input → safe defaults', (() => {
        const o = sanitize([1, 2, 3]);
        // Arrays are typeof 'object' so the function reads its properties
        // (which are mostly undefined) → safe defaults.
        return o.phase === null && o.damageType === 'other';
      })());
    }
  }
};
