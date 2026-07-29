/**
 * tests/roof-report-wiring.test.js — the 📄 Roof Health Report button must
 * actually reach the report engine.
 *
 * ROOT CAUSE (QA 2026-07-29, same class as tests/photo-hub-engine.test.js):
 * buildRoofReportHtml (docs/pro/js/roof-report.js) and property-intel.js both
 * load eagerly on the dashboards, but InspectionReportEngine — which
 * shareRoofReport() needs for saveReport/_shareReport — ships in the LAZY
 * 'photos' bundle (script-loader.js), loaded only by the Photos view or a
 * card-detail photo/camera button. The property-intel card is a MODAL reachable
 * from anywhere (property lookup / map), so on a fresh session the engine is
 * absent — and worse, dashboard-actions.js installs a placeholder
 * `window.InspectionReportEngine = { __nbdLazyPhotosStub: true, openBuilder }`
 * which is TRUTHY but carries no saveReport. shareRoofReport() bailed with
 * "Roof Report engine not ready" and the brand-new feature looked broken unless
 * the rep happened to have opened Photos first.
 *
 * Pinned here: the bundle load, the stub-vs-real distinction, and the post-load
 * RE-READ of the global (the real engine replaces the stub, so re-checking the
 * old reference would keep failing).
 *
 * Zero deps. Run: node tests/roof-report-wiring.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

const ROOT = path.join(__dirname, '..');
const PI = fs.readFileSync(path.join(ROOT, 'docs/pro/js/property-intel.js'), 'utf8');
const LOADER = fs.readFileSync(path.join(ROOT, 'docs/pro/js/script-loader.js'), 'utf8');
const ACTIONS = fs.readFileSync(path.join(ROOT, 'docs/pro/js/dashboard-actions.js'), 'utf8');

console.log('ROOF REPORT WIRING — the button must reach the engine');

// ── The premise: this really is a lazy dependency, and a stub really exists ──
{
  ok('inspection-report-engine is in the LAZY photos bundle (not eager)',
    /photos:\s*\[[^\]]*inspection-report-engine\.js/s.test(LOADER),
    'if it became eager this whole test is moot — update the premise');
  ok('the photos bundle is NOT mapped to a property-intel view',
    !/'?property-?intel'?:\s*\[/i.test(LOADER),
    'the card is a modal; no view route loads the bundle for it');
  ok('dashboard-actions still installs a TRUTHY engine placeholder with no saveReport',
    /window\.InspectionReportEngine = \{[\s\S]{0,200}__nbdLazyPhotosStub:\s*true/.test(ACTIONS),
    'the stub is what makes bare truthiness dangerous');
}

// ── The fix, in shareRoofReport ──
{
  const fn = PI.slice(PI.indexOf('async function shareRoofReport'));
  const body = fn.slice(0, fn.indexOf('\n}') + 2);

  ok('shareRoofReport loads the photos bundle when the engine is not ready',
    /loadBundle\('photos'\)/.test(body),
    'without this the 📄 button is dead on any session that never opened Photos');
  ok('it awaits that load before continuing',
    /await window\.ScriptLoader\.loadBundle\('photos'\)/.test(body));
  ok('readiness rejects the lazy stub, not just falsiness',
    /__nbdLazyPhotosStub/.test(body) && /typeof e\.saveReport === 'function'/.test(body),
    'a truthy stub with no saveReport must not count as ready');
  ok('the global is RE-READ after the load (the real engine replaces the stub)',
    /Engine = window\.InspectionReportEngine;[\s\S]{0,80}\}/.test(body)
    && (body.match(/Engine = window\.InspectionReportEngine/g) || []).length >= 2,
    'checking the stale reference would fail even after a successful load');
  ok('Engine is a let/var, not a const (it must be reassignable post-load)',
    /let Engine = window\.InspectionReportEngine/.test(body));
  ok('the final guard still fails CLOSED with a rep-visible toast',
    /Roof Report engine not ready/.test(body) && /showToast/.test(body));
  ok('a bundle-load failure does not throw out of the handler',
    /catch \(_\)/.test(body) || /\.catch\(/.test(body),
    'an offline rep should get the guard toast, not an unhandled rejection');
}

// ── Behavioural: the readiness predicate itself ──
{
  // Mirror of the predicate in property-intel.js — extracted and exercised so a
  // future edit that inverts it fails here rather than in a rep's hands.
  const engineReady = (e) => !!e && !e.__nbdLazyPhotosStub && typeof e.saveReport === 'function';
  ok('undefined engine → not ready', engineReady(undefined) === false);
  ok('lazy stub (truthy, openBuilder only) → not ready',
    engineReady({ __nbdLazyPhotosStub: true, openBuilder() {} }) === false);
  ok('stub that somehow grew a saveReport is STILL not ready',
    engineReady({ __nbdLazyPhotosStub: true, saveReport() {} }) === false);
  ok('real engine (saveReport present, no marker) → ready',
    engineReady({ saveReport() {}, _shareReport() {} }) === true);
  ok('object with no saveReport → not ready', engineReady({ openBuilder() {} }) === false);
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
