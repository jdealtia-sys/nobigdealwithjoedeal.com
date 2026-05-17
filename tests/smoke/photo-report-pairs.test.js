/**
 * tests/smoke/photo-report-pairs.test.js — §3.2 unit tests for the
 * three-tier pairing heuristic in photo-report.js.
 *
 * photo-report.js is a frontend IIFE: defines helpers, exposes
 * `_buildPhotoReportPairs` on `window`. It uses no DOM and no
 * Firebase at module-load time, so we can load the source into a
 * Node `vm` context with a minimal `window` shim, grab the
 * exposed pure function, and run fixtures against it.
 *
 * Coverage matrix:
 *   - Tier 1 (location)   — exact, case-insensitive, comma-segment
 *   - Tier 2 (damageType) — fallback when location empty / nonmatch
 *   - Tier 3 (chronological "Project overview") — last-ditch fallback
 *   - Within-tier picking: BEFORE = earliest createdAt, AFTER = latest
 *   - used-Set dedupe across tiers
 *   - 8-pair cap
 *   - Edge cases: empty input, no befores, no afters, missing URLs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { ROOT } = require('./_shared');

// ── Load photo-report.js in a sandboxed vm context ────────────────
// The IIFE inside the file defines all its helpers, then assigns
// `window._buildPhotoReportPairs = _buildPairs`. With `window: {}`
// in the sandbox, the assignment lands there and we can grab it.
let buildPairs;
let loadError;
try {
  const src = fs.readFileSync(
    path.join(ROOT, 'docs/pro/js/photo-report.js'),
    'utf8'
  );
  const sandbox = { window: {}, console: console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'photo-report.js' });
  buildPairs = sandbox.window._buildPhotoReportPairs;
} catch (e) {
  loadError = e;
}

// ── Fixture helpers ───────────────────────────────────────────────
// Photos in production have a `createdAt` field that's either a
// Firestore Timestamp (with .toMillis()) or a {seconds, nanoseconds}
// object. _buildPairs accepts both shapes. Tests use a tiny
// .toMillis()-style fixture.
let _id = 0;
function ts(ms) { return { toMillis: () => ms }; }
function photo(opts) {
  return {
    id: 'p' + (++_id),
    url: 'https://storage.example/' + (opts.url || ('img' + _id + '.jpg')),
    phase: opts.phase,
    location: opts.location || '',
    damageType: opts.damageType || '',
    createdAt: ts(opts.ms != null ? opts.ms : 0),
  };
}

module.exports.run = function run(ctx) {
  const { assert, section } = ctx;

  section('§3.2.b photo-report _buildPairs — real function calls');
  {
    assert('photo-report.js loads in vm without throwing',
      !loadError,
      loadError ? loadError.message : '');
    assert('window._buildPhotoReportPairs is a function',
      typeof buildPairs === 'function');

    if (typeof buildPairs !== 'function') return;

    // ── Edge cases ──
    {
      assert('empty input → []',
        Array.isArray(buildPairs([])) && buildPairs([]).length === 0);
      assert('null input → []',
        Array.isArray(buildPairs(null)) && buildPairs(null).length === 0);
      assert('undefined input → []',
        Array.isArray(buildPairs(undefined)) && buildPairs(undefined).length === 0);
      // Only befores → no pairs (need both phases).
      const b = photo({ phase: 'Before', location: 'Ridge', ms: 1 });
      assert('only befores → []',
        buildPairs([b]).length === 0);
      // Only afters → no pairs.
      const a = photo({ phase: 'After',  location: 'Ridge', ms: 1 });
      assert('only afters → []',
        buildPairs([a]).length === 0);
    }

    // ── Tier 1: location match (strict) ──
    {
      _id = 0;
      const b = photo({ phase: 'Before', location: 'North slope', ms: 100 });
      const a = photo({ phase: 'After',  location: 'North slope', ms: 200 });
      const out = buildPairs([b, a]);
      assert('Tier 1: exact location match → 1 pair',
        out.length === 1 && out[0].location === 'North slope');
      assert('Tier 1: pair carries before/after urls',
        out[0].before && out[0].after && out[0].before.url && out[0].after.url);
    }

    // ── Tier 1: case-insensitive ──
    {
      _id = 0;
      const b = photo({ phase: 'Before', location: 'NORTH SLOPE', ms: 1 });
      const a = photo({ phase: 'After',  location: 'north slope', ms: 2 });
      const out = buildPairs([b, a]);
      assert('Tier 1: case-insensitive match works',
        out.length === 1, 'expected 1 pair from differing case');
    }

    // ── Tier 1: comma-segment normalization ──
    {
      _id = 0;
      const b = photo({ phase: 'Before', location: 'North slope, ridge', ms: 1 });
      const a = photo({ phase: 'After',  location: 'North slope',         ms: 2 });
      const out = buildPairs([b, a]);
      assert('Tier 1: "X, Y" pairs with "X" (first comma-segment)',
        out.length === 1, 'expected 1 pair from comma-segment normalization');
    }

    // ── Within-tier picking: BEFORE = earliest, AFTER = latest ──
    {
      _id = 0;
      const bEarly = photo({ phase: 'Before', location: 'Ridge', ms: 100 });
      const bLate  = photo({ phase: 'Before', location: 'Ridge', ms: 999 });
      const aEarly = photo({ phase: 'After',  location: 'Ridge', ms: 200 });
      const aLate  = photo({ phase: 'After',  location: 'Ridge', ms: 999 });
      const out = buildPairs([bEarly, bLate, aEarly, aLate]);
      assert('one pair emitted per location even with multiple candidates',
        out.length === 1);
      assert('BEFORE picks earliest createdAt (worst pre-state)',
        out[0].before.url === bEarly.url,
        'expected before url to match bEarly (ms=100), got ' + out[0].before.url);
      assert('AFTER picks latest createdAt (completed state)',
        out[0].after.url === aLate.url,
        'expected after url to match aLate (ms=999), got ' + out[0].after.url);
    }

    // ── Tier 2: damageType fallback when no location ──
    {
      _id = 0;
      const b = photo({ phase: 'Before', damageType: 'hail', ms: 1 });
      const a = photo({ phase: 'After',  damageType: 'hail', ms: 2 });
      const out = buildPairs([b, a]);
      assert('Tier 2: damageType match → 1 pair (no location needed)',
        out.length === 1);
      assert('Tier 2: pair label is "Damage: <type>"',
        /^Damage:\s*hail/.test(out[0].location),
        'expected "Damage: hail", got ' + out[0].location);
    }

    // ── Tier 3: chronological "Project overview" fallback ──
    {
      _id = 0;
      // No location, no damageType, but we have one before + one after.
      const b = photo({ phase: 'Before', ms: 1 });
      const a = photo({ phase: 'After',  ms: 2 });
      const out = buildPairs([b, a]);
      assert('Tier 3: untagged before+after → 1 "Project overview" pair',
        out.length === 1 && out[0].location === 'Project overview');
    }

    // ── Tier 3 does NOT fire when tiers 1+2 already produced ≥2 pairs ──
    {
      _id = 0;
      const p1 = photo({ phase: 'Before', location: 'Ridge', ms: 1 });
      const p2 = photo({ phase: 'After',  location: 'Ridge', ms: 2 });
      const p3 = photo({ phase: 'Before', location: 'Valley', ms: 3 });
      const p4 = photo({ phase: 'After',  location: 'Valley', ms: 4 });
      const orphanBefore = photo({ phase: 'Before', ms: 5 });
      const orphanAfter  = photo({ phase: 'After',  ms: 6 });
      const out = buildPairs([p1, p2, p3, p4, orphanBefore, orphanAfter]);
      assert('Tier 3: skipped when tiers 1+2 produced ≥2 pairs',
        out.length === 2 && !out.some(p => p.location === 'Project overview'),
        'expected exactly 2 location pairs and no Project overview pair');
    }

    // ── used-Set dedupe across tiers ──
    {
      _id = 0;
      // One photo pair-able by both location AND damageType. After
      // tier 1 consumes it, tier 2 should NOT re-pair it.
      const b = photo({ phase: 'Before', location: 'Ridge', damageType: 'hail', ms: 1 });
      const a = photo({ phase: 'After',  location: 'Ridge', damageType: 'hail', ms: 2 });
      const out = buildPairs([b, a]);
      assert('used-Set: tier-1 winner not re-paired by tier-2',
        out.length === 1, 'expected exactly 1 pair, got ' + out.length);
      assert('used-Set: that pair is the location one (Tier 1 ran first)',
        out[0].location === 'Ridge');
    }

    // ── 8-pair cap ──
    {
      _id = 0;
      const photos = [];
      // Build 10 location-matched pairs.
      for (let i = 0; i < 10; i++) {
        photos.push(photo({ phase: 'Before', location: 'loc' + i, ms: i }));
        photos.push(photo({ phase: 'After',  location: 'loc' + i, ms: i + 100 }));
      }
      const out = buildPairs(photos);
      assert('8-pair cap enforced',
        out.length === 8, 'expected 8 pairs (cap), got ' + out.length);
    }

    // ── Missing URL → skip the pair, don't include broken {before,after} ──
    {
      _id = 0;
      const b = photo({ phase: 'Before', location: 'Ridge', ms: 1 });
      const a = photo({ phase: 'After',  location: 'Ridge', ms: 2 });
      a.url = ''; // simulate missing URL
      const out = buildPairs([b, a]);
      assert('pair with missing URL is skipped',
        out.length === 0, 'expected pair to be skipped when after has no url');
    }
  }
};
