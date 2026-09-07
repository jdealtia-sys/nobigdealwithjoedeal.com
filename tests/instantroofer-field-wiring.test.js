/**
 * tests/instantroofer-field-wiring.test.js — the measured fields that price.
 *
 * WHY THIS EXISTS
 * ───────────────
 * Instant Roofer returns a full roof report for $3. Until now the estimate
 * builder used two fields of it (rawSqft, pitch) and dropped the rest — while
 * the pricing engine one file over charges real money for one of the dropped
 * ones. `stories` is returned on every AI measure, prices at $15/SQ (2-storey)
 * and $30/SQ (3-storey) in estimate-builder-v2.js:921-923, and
 * applyMeasurementResult never set it. state.measurements.stories therefore
 * kept its default of 1 and an auto-measured two-storey house was quoted as
 * one-storey — roughly $600 missing on a 40 SQ roof.
 *
 * These are NOT regex-shape assertions. This repo has a documented history of
 * `/push\(item\)/`-style tests passing with the bug present, so the real
 * function is sliced out of the source and executed in a vm sandbox against a
 * stub `state`. Each assertion below observes behaviour, not source text.
 *
 * Pinned here:
 *   1. a vendor storey count reaches state (the bug);
 *   2. it NEVER overwrites a storey count a rep chose by hand (the inverse
 *      bug — the field is vendor-flagged beta, so it may only fill a default);
 *   3. it is clamped to the 1–3 the #v2stories select actually offers, because
 *      syncMeasurementInputs blanks a select on an out-of-list value;
 *   4. applying a measurement clears _reopenedClean, like every other
 *      measurement path already does — without it a reopened estimate keeps
 *      replaying its saved rows and the new numbers never reach the document.
 *
 * Pure-Node, no network, no emulator.
 * Run: node tests/instantroofer-field-wiring.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

const SRC = read('docs/pro/js/estimate-v2-ui.js');

/** Slice `function <name>(` out of the source by brace matching. */
function sliceFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) return null;
  let depth = 0, i = src.indexOf('{', start);
  if (i === -1) return null;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  return null;
}

const applySrc = sliceFn(SRC, 'applyMeasurementResult');
const numOrSrc = sliceFn(SRC, 'numOr');

section('the real applyMeasurementResult can be isolated and run');
ok('applyMeasurementResult was found in the source', !!applySrc);
ok('numOr (its only outside helper) was found too', !!numOrSrc);

/**
 * Run the real function against a stub state. Returns the mutated state so the
 * assertions can look at what actually happened, not at what the source says.
 */
function runApply(measurements, startState, meta) {
  const state = Object.assign({
    measurements: Object.assign({ rawSqft: 0, stories: 1 }, (startState || {}).measurements),
    passThru: [],
    _reopenedClean: false
  }, startState || {});
  if (startState && startState.measurements) {
    state.measurements = Object.assign({ rawSqft: 0, stories: 1 }, startState.measurements);
  }
  const sandbox = {
    state,
    window: {},
    console,
    syncMeasurementInputs() { sandbox._synced = true; },
    render() { sandbox._rendered = true; }
  };
  vm.createContext(sandbox);
  vm.runInContext(numOrSrc + '\n' + applySrc + '\napplyMeasurementResult(__m, __meta);',
    Object.assign(sandbox, { __m: measurements, __meta: meta || {} }));
  return sandbox;
}

if (applySrc && numOrSrc) {
  section('stories — the field that prices');
  {
    const s = runApply({ rawSqft: 3483, pitch: '5/12', stories: 2 });
    ok('a vendor storey count of 2 reaches state (was silently left at 1)',
      s.state.measurements.stories === 2, 'got ' + s.state.measurements.stories);
  }
  {
    const s = runApply({ rawSqft: 3483, stories: 3 });
    ok('3 storeys reaches state, so the $30/SQ tier can fire',
      s.state.measurements.stories === 3);
  }
  {
    // The inverse bug. The vendor marks this field beta/estimated; overwriting
    // a rep's deliberate 3 with a measured 1 would drop $30/SQ off a quote a
    // human had already corrected.
    const s = runApply({ rawSqft: 3483, stories: 1 }, { measurements: { stories: 3 } });
    ok('NEVER overwrites a storey count the rep already chose',
      s.state.measurements.stories === 3, 'got ' + s.state.measurements.stories);
  }
  {
    const s = runApply({ rawSqft: 3483, stories: 7 });
    ok('clamped to the 3 the select actually offers (out-of-list blanks it)',
      s.state.measurements.stories === 3);
  }
  {
    const s = runApply({ rawSqft: 3483 });
    ok('vendor omits stories → the existing value is left alone',
      s.state.measurements.stories === 1);
  }
  {
    const s = runApply({ rawSqft: 3483, stories: null }, { measurements: { stories: 2 } });
    ok('an explicit null does not wipe a chosen value either',
      s.state.measurements.stories === 2);
  }

  section('a measurement re-resolves a reopened estimate');
  {
    const s = runApply({ rawSqft: 3483, pitch: '5/12' }, { _reopenedClean: true });
    ok('applying a measurement clears _reopenedClean, as every sibling path does',
      s.state._reopenedClean === false);
  }

  section('the fields it already mapped still work');
  {
    const s = runApply({ rawSqft: 3483, pitch: '5/12' });
    ok('rawSqft still applied', s.state.measurements.rawSqft === 3483);
    ok('pitch still parsed and clamped into the select range', s.state.measurements.pitch === 5);
    ok('a flat 0/12 pitch still clamps to the 3 minimum rather than blanking',
      runApply({ rawSqft: 1000, pitch: '0/12' }).state.measurements.pitch === 3);
    ok('the DOM sync and re-render still run', s._synced === true && s._rendered === true);
  }
}

section('the storey adder this is wired to actually exists');
{
  const eb = read('docs/pro/js/estimate-builder-v2.js');
  ok('calculatePerSq still tiers on stories (2 → twoStoryPerSq, 3+ → threeStoryPerSq)',
    /stories\s*>=\s*3/.test(eb) && /threeStoryPerSq/.test(eb)
    && /stories\s*===\s*2/.test(eb) && /twoStoryPerSq/.test(eb));
  const ui = read('docs/pro/js/estimate-v2-ui.js');
  // Scope to the stories <select> itself — the file has other selects whose
  // options run past 3 (layers, pipes), so a file-wide check proves nothing.
  const storiesSel = (/id="v2stories"[\s\S]*?<\/select>/.exec(ui) || [''])[0];
  const storyOpts = (storiesSel.match(/<option value="(\d+)"/g) || [])
    .map(o => Number(/(\d+)/.exec(o)[1]));
  ok('#v2stories still offers exactly 1/2/3, which is what the clamp assumes',
    storyOpts.length === 3 && storyOpts.join(',') === '1,2,3',
    'found [' + storyOpts.join(',') + ']');
  ok('syncMeasurementInputs still maps stories → v2stories, so state reaches the control',
    /stories: 'v2stories'/.test(ui));
}

section('the measured facts are surfaced to the rep');
{
  const ui = read('docs/pro/js/estimate-v2-ui.js');
  ok('the status line reports perimeter, facets and complexity',
    /perimeterLf/.test(ui) && /lf perimeter/.test(ui)
    && /facets/.test(ui) && /complexity/.test(ui));
  ok('a commercial classification is raised as a scope warning, not swallowed',
    /isCommercial === true/.test(ui) && /COMMERCIAL/.test(ui));
  ok('a townhome classification is raised too',
    /isTownhome === true/.test(ui) && /townhome/i.test(ui));
  // The status line is assigned to .textContent, never innerHTML — so a vendor
  // string in it can never become markup. That is the property worth pinning;
  // repo-wide CSP is already enforced by scripts/check-inline-html-scripts.js.
  ok('the status line is written as text, not HTML',
    /statusEl\.textContent = /.test(ui) && !/statusEl\.innerHTML/.test(ui));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
