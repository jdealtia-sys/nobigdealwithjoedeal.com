/**
 * tests/roof-report.test.js — the rep-side Roof Report generator
 * (docs/pro/js/roof-report.js).
 *
 * The output is a homeowner-facing HTML page served at /report/<token> to a
 * logged-out homeowner, built from public-record + tenant-brand fields — so
 * the two things that MUST hold are (1) every dynamic field is escaped
 * (stored-XSS / brand-injection source) and (2) it never leaks the rep's
 * internal data (project value, owner market value, cost/margin) or issues a
 * damage "verdict". Plus the score→advisory mapping.
 *
 * Zero deps. Run: node tests/roof-report.test.js
 */
'use strict';

const path = require('path');
const RR = require(path.join('..', 'docs', 'pro', 'js', 'roof-report.js'));

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('ROOF REPORT GENERATOR');

// score → advisory narrative bands
{
  ok('score ≤30 → inspection strongly recommended', RR.scoreNarrative(20, 28).band === 'Inspection strongly recommended');
  ok('score 31-60 → worth a closer look', RR.scoreNarrative(50, 18).band === 'Worth a closer look');
  ok('score 61-80 → good shape', RR.scoreNarrative(70, 12).band.startsWith('Good shape'));
  ok('score >80 → healthy', RR.scoreNarrative(92, 4).band === 'Looking healthy');
  ok('narrative is advisory, never a damage verdict',
    !/damaged|failing|must replace|guarantee/i.test(RR.scoreNarrative(15, 35).body));
  ok('roof age is woven in when present', /about 28 years/.test(RR.scoreNarrative(20, 28).body));
}

// XSS / injection escaping
{
  const html = RR.buildRoofReportHtml(
    { roofScore: 45, roofAge: 22, address: '<script>alert(1)</script>', yearBuilt: '"><img src=x onerror=alert(2)>', roofMaterial: 'asphalt & tile' },
    { name: '<b>Evil</b> Roofing', accent: 'red;}body{display:none', logoUrl: 'javascript:alert(3)', repName: '<i>Rep</i>', repPhone: '(513) 555-0199' },
    { dateStr: 'Jul 22, 2026' }
  );
  ok('address script tag is escaped (no raw <script>)', !/<script>/.test(html) && html.includes('&lt;script&gt;'));
  // The onerror= text survives as INERT escaped text; what matters is there is
  // no live <img ...onerror> tag — the angle brackets are entity-encoded.
  ok('year-built breakout attempt is escaped (no live tag)',
    !/<img[^>]*onerror/i.test(html) && html.includes('&quot;&gt;&lt;img'));
  ok('brand name tags escaped', html.includes('&lt;b&gt;Evil'));
  ok('rep name tags escaped', html.includes('&lt;i&gt;Rep'));
  ok('malicious accent rejected → falls back to safe hex', html.includes('#e8720c') && !html.includes('red;}body'));
  ok('javascript: logo url is dropped (never rendered as src)', !/javascript:/.test(html));
  ok('roof material ampersand escaped', html.includes('asphalt &amp; tile'));
}

// homeowner-safety: internal rep data must NOT appear
{
  const html = RR.buildRoofReportHtml(
    { roofScore: 55, roofAge: 19, address: '12 Oak St', yearBuilt: 1998,
      marketValue: 425000, projectValue: '$18,500', ownerName: 'Jane Homeowner', cost: 9200, margin: 0.42 },
    { name: 'Acme Roofing', accent: '#0047ab', repName: 'Sam', repPhone: '5135550100' }, {}
  );
  ok('internal market value NOT leaked', !html.includes('425000') && !html.includes('425,000'));
  ok('internal project value NOT leaked', !html.includes('18,500') && !html.includes('18500'));
  ok('owner name from county record NOT leaked', !html.includes('Jane Homeowner'));
  ok('cost / margin NOT leaked', !html.includes('9200') && !html.includes('0.42'));
  ok('valid tenant accent is honored', html.includes('#0047ab'));
  ok('tel: link uses digits only', html.includes('tel:5135550100'));
  ok('carries the not-a-substitute-for-inspection disclaimer', /not a substitute for a professional/i.test(html));
  ok('is a self-contained HTML document', /^<!doctype html>/i.test(html) && html.includes('</html>'));
}

// score clamping + degenerate input
{
  ok('score clamps to 100', RR.buildRoofReportHtml({ roofScore: 150, address: 'x' }, {}, {}).includes('>100<'));
  ok('score clamps to 0 / missing', RR.buildRoofReportHtml({ roofScore: -5, address: 'x' }, {}, {}).includes('>0<'));
  let threw = false;
  try { RR.buildRoofReportHtml(null, null, null); RR.buildRoofReportHtml(); } catch (e) { threw = true; }
  ok('null / missing args never throw', !threw);
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
