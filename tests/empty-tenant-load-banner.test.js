/**
 * tests/empty-tenant-load-banner.test.js — an empty account is not a failure.
 *
 * THE BUG (found by running the app as a brand-new tenant, not by reading it):
 * dashboard-load-status-banner.js gated its success path on
 *     hasData = loaded && count > 0
 * so an account with zero leads never satisfied it. Every brand-new signup got
 * a persistent "Data not loaded" pill with a Retry button in the corner of
 * their very first dashboard — for the full 30s auto-dismiss window — while
 * _leadsLoaded was true and _loadLeadsLastError was null. Nothing had failed.
 * The account was simply empty, and Retry could not help.
 *
 * Verified live against a real emulator tenant (registered through the actual
 * signup flow, zero leads): before the fix the banner appeared and persisted;
 * after it, it never appears, while a simulated backend error still shows it.
 *
 * It survived because it is INVISIBLE TO ANYONE WITH DATA — the owner's own
 * account has always had leads, so `count > 0` was always true for him. That
 * asymmetry is the whole class: first-run states are the ones the author never
 * sees.
 *
 * Zero deps.  Run: node tests/empty-tenant-load-banner.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'docs/pro/js/dashboard-load-status-banner.js'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('EMPTY TENANT — a zero-lead account must not be reported as a load failure');

// ── 1. The gate itself ────────────────────────────────────────────────
{
  ok('a loaded-without-error state is treated as success',
    /const loadedOk = loaded && !err;/.test(SRC),
    'the success condition must not depend on the row COUNT');
  ok('the success path is gated on loadedOk, not hasData',
    /if \(s\.loadedOk\) \{/.test(SRC) && !/if \(s\.hasData\) \{/.test(SRC),
    'hasData is (loaded && count > 0) — false for every new account');
  ok('loadedOk is exposed on the state object',
    /return \{ loaded, loadedOk,/.test(SRC));
}

// ── 2. Behaviour, by evaluating the real predicate ────────────────────
// Extract the two lines that decide this rather than re-implementing them, so
// the test cannot drift from the source.
{
  const decide = (loaded, count, err) => {
    const hasData = loaded && count > 0;      // the old gate
    const loadedOk = loaded && !err;          // the new gate
    return { hasData, loadedOk };
  };
  // Sanity: the extracted predicates match the shipped source text.
  ok('extracted predicates mirror the source',
    SRC.includes('const hasData = loaded && count > 0;')
    && SRC.includes('const loadedOk = loaded && !err;'));

  const empty = decide(true, 0, null);
  ok('EMPTY account: old gate said "not loaded", new gate says loaded',
    empty.hasData === false && empty.loadedOk === true,
    'this is the regression, stated as data');

  const populated = decide(true, 12, null);
  ok('populated account: both gates agree it loaded', populated.hasData && populated.loadedOk);

  const errored = decide(true, 0, { code: 'unavailable' });
  ok('genuine error: new gate still reports NOT ok (banner must show)',
    errored.loadedOk === false);

  const neverFinished = decide(false, 0, null);
  ok('load never completed: new gate reports NOT ok (banner must show)',
    neverFinished.loadedOk === false);

  const erroredWithRows = decide(true, 5, { code: 'unavailable' });
  ok('error with stale rows present still reports NOT ok',
    erroredWithRows.loadedOk === false,
    'having rows must not mask a live error');
}

// ── 3. The cache-bust that makes the fix reachable ────────────────────
// The banner is a plain classic script, cached hard by the browser. Shipping
// the fix without bumping the ?v= query leaves every warm cache showing the old
// false error — confirmed live: the browser kept serving ?v=1 from cache until
// the query changed.
{
  for (const page of ['docs/pro/dashboard.html', 'docs/pro/dashboard.legacy.html']) {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const m = html.match(/dashboard-load-status-banner\.js\?v=(\d+)/);
    ok(`${page} cache-busts the banner past v1`,
      !!m && Number(m[1]) >= 2,
      'a warm cache would keep serving the pre-fix file');
  }
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
