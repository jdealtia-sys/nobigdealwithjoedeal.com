/**
 * tests/health-digest-render-pdf-signal.test.js — the daily digest must shout
 * when the server PDF renderer is down.
 *
 * WHY THIS EXISTS. renderPdf failed 100% of the time from the @sparticuz/
 * chromium 148->149 bump (#712, 2026-06-24) until 2026-09-08 and nothing
 * alerted for eleven weeks. It was invisible on purpose-built silence: the
 * client catches the HttpsError and falls back to html2canvas, so customers
 * still received *a* document and no error ever reached a human. The fix for
 * the interop bug is in render-pdf.js; this file guards the reason nobody knew.
 *
 * THE SIGNAL IS A MISSING SUCCESS, NOT A RISING FAILURE COUNT. That choice is
 * what the tests below pin. This path is low-volume — 22 calls in three weeks —
 * so any "N failures in 24h" threshold either sleeps through a total outage or
 * cries wolf constantly. "Renders were attempted and not one succeeded" trips
 * on the first digest after the break, at any volume.
 *
 * Case A replays the real production state: failCount climbing, okCount zero,
 * stage 'launch', "chromium.executablePath is not a function". If that state
 * does not produce a warning in both the subject-line predicate and the body,
 * this whole exercise bought nothing.
 *
 * health-digest.js imports firebase-functions/firebase-admin at module scope
 * and a worktree has no functions/node_modules, so the module cannot be
 * require()d. The real gatherRenderPdf/renderPdfBroken/renderPdfSection are
 * lifted out of the source and run in a vm against a fake Firestore, so these
 * assertions run the shipped code rather than matching strings in it.
 *
 * Zero deps.  Run: node tests/health-digest-render-pdf-signal.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'functions/health-digest.js'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; fails.push(`${name}${detail ? ' — ' + detail : ''}`); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

function extractFn(src, name) {
  const decl = src.includes(`async function ${name}(`) ? `async function ${name}(` : `function ${name}(`;
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(`extractFn: ${name} not found in health-digest.js`);
  const open = src.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  if (depth !== 0) throw new Error(`extractFn: unbalanced braces reading ${name}`);
  return src.slice(start, i);
}

// Lift the four real functions plus the two formatters they lean on.
const sandbox = { console, Object, Array, String, Number, Math, Date, Promise, Error };
vm.createContext(sandbox);
vm.runInContext(
  ['fmtNum', 'escHtml', 'gatherRenderPdf', 'renderPdfBroken', 'renderPdfSection']
    .map((n) => extractFn(SRC, n)).join('\n') +
  '\nglobalThis.API = { gatherRenderPdf, renderPdfBroken, renderPdfSection };',
  sandbox
);
const { gatherRenderPdf, renderPdfBroken, renderPdfSection } = sandbox.API;

// Fake Firestore: db.doc(path).get() -> { exists, data() }.
function fakeDb(doc) {
  return {
    doc: (p) => ({
      get: async () => {
        if (p !== 'metrics/renderPdf') throw new Error('unexpected doc path: ' + p);
        return doc === null
          ? { exists: false, data: () => ({}) }
          : { exists: true, data: () => doc };
      },
    }),
  };
}
const ts = (d) => ({ toDate: () => d });

(async () => {
  console.log('\nhealth digest — renderPdf signal\n');

  const NOW = Date.UTC(2026, 8, 8, 14, 0, 0);
  const CUTOFF = NOW - 24 * 60 * 60 * 1000;
  const inWindow = new Date(NOW - 2 * 60 * 60 * 1000);
  const beforeWindow = new Date(NOW - 40 * 24 * 60 * 60 * 1000);

  // ── A. The real outage: failures climbing, not one success ever. ──
  console.log('A. Production state on 2026-09-08 (100% failing, never succeeded)');
  const outage = await gatherRenderPdf(fakeDb({
    failCount: 22, okCount: 0,
    lastFailAt: ts(inWindow),
    lastFailStage: 'launch',
    lastFailErr: 'chromium.executablePath is not a function',
  }), CUTOFF);

  ok('A1 recognised as attempted', outage.attempted === true);
  ok('A2 failure seen inside the window', outage.failRecent === true);
  ok('A3 no success inside the window', outage.okRecent === false);
  ok('A4 neverOk set — no success on record at all', outage.neverOk === true);
  ok('A5 renderPdfBroken() is TRUE (drives the subject-line warning)',
    renderPdfBroken(outage) === true);
  const bodyA = renderPdfSection(outage);
  ok('A6 body carries the warning marker', /⚠/.test(bodyA), bodyA.slice(0, 160));
  ok('A7 body names the failing stage', /launch/.test(bodyA));
  ok('A8 body surfaces the real error text', /executablePath is not a function/.test(bodyA));
  ok('A9 body says the failure is masked by the html2canvas fallback',
    /html2canvas/.test(bodyA));
  ok('A10 body renders in the alert colour, not the neutral style',
    /#c0392b/.test(bodyA));

  // ── B. Healthy: renders succeeding, no recent failures. Must stay quiet. ──
  console.log('\nB. Healthy renderer stays quiet');
  const healthy = await gatherRenderPdf(fakeDb({
    okCount: 140, failCount: 3,
    lastOkAt: ts(inWindow),
    lastFailAt: ts(beforeWindow),
    lastFailStage: 'pdf',
  }), CUTOFF);
  ok('B1 failRecent false (last failure predates the window)', healthy.failRecent === false);
  ok('B2 okRecent true', healthy.okRecent === true);
  ok('B3 renderPdfBroken() FALSE — no subject warning', renderPdfBroken(healthy) === false);
  const bodyB = renderPdfSection(healthy);
  ok('B4 body reports no failures', /No PDF render failures/.test(bodyB), bodyB.slice(0, 140));
  ok('B5 body carries no warning marker', !/⚠/.test(bodyB));

  // ── C. Intermittent: some failures but renders still land. Warn, don't alarm. ──
  console.log('\nC. Intermittent failures warn without claiming an outage');
  const flaky = await gatherRenderPdf(fakeDb({
    okCount: 90, failCount: 7,
    lastOkAt: ts(inWindow), lastFailAt: ts(inWindow), lastFailStage: 'pdf',
  }), CUTOFF);
  ok('C1 both recent', flaky.failRecent === true && flaky.okRecent === true);
  ok('C2 renderPdfBroken() FALSE — an outage claim would be wrong',
    renderPdfBroken(flaky) === false);
  const bodyC = renderPdfSection(flaky);
  ok('C3 body still mentions the failures', /Some PDF renders failed/.test(bodyC), bodyC.slice(0, 140));
  ok('C4 body does not claim every render failed', !/Every PDF render failed/.test(bodyC));

  // ── D. Never used: absence is silence, not an alarm. ──
  console.log('\nD. No renders ever attempted — silence, not a false alarm');
  const idle = await gatherRenderPdf(fakeDb(null), CUTOFF);
  ok('D1 attempted false when the doc does not exist', idle.attempted === false);
  ok('D2 renderPdfBroken() FALSE', renderPdfBroken(idle) === false);
  ok('D3 body says nothing to report', /No PDF renders attempted/.test(renderPdfSection(idle)));

  // ── E. The error text reaches an HTML email body, so it must be escaped. ──
  console.log('\nE. Failure text is HTML-escaped into the email');
  const injected = await gatherRenderPdf(fakeDb({
    failCount: 1, okCount: 0,
    lastFailAt: ts(inWindow),
    lastFailStage: '<img src=x onerror=alert(1)>',
    lastFailErr: '<script>alert(2)</script>',
  }), CUTOFF);
  const bodyE = renderPdfSection(injected);
  // Both values land as ELEMENT TEXT inside <code>, never in an attribute, so
  // escaping the angle brackets is what makes them inert. `onerror=` still
  // appears as literal characters and that is fine — it is the surviving tag
  // that would matter, not the substring.
  ok('E1 no raw <script> tag survives', !/<script/i.test(bodyE), bodyE.slice(0, 200));
  ok('E2 no raw <img> tag survives', !/<img/i.test(bodyE), bodyE.slice(0, 200));
  ok('E3 both values are present, escaped',
    /&lt;script&gt;/.test(bodyE) && /&lt;img/.test(bodyE));
  // The only tags in the section are the ones the digest itself writes.
  const tags = (bodyE.match(/<[a-zA-Z/][^>]*>/g) || []).map((t) => t.replace(/\s.*/, '').replace(/>$/, ''));
  ok('E4 only digest-authored tags in the output',
    tags.every((t) => ['<div', '</div', '<strong', '</strong', '<code', '</code', '<em', '</em'].includes(t)),
    tags.join(' '));

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})().catch((e) => { console.error('harness error:', e); process.exit(1); });
