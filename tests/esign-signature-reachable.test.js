/**
 * tests/esign-signature-reachable.test.js
 *
 * Remote signing was impossible to complete, for anyone, on any screen.
 *
 * `.document-container` was `height: 11in` + `overflow: hidden`, and its
 * flex child `.document-content` was `overflow: hidden` too. The signature
 * block is the LAST thing renderContract emits, so on a real contract it
 * landed several hundred pixels BELOW the container's fixed bottom edge and
 * was clipped away — with no scroll container anywhere, so the homeowner
 * could not reach it by scrolling either. `@media print` overrode the height
 * with `auto`, so print and PDF output were complete, which is exactly why
 * this survived: every artifact a rep ever looked at was fine.
 *
 * The second half of the same failure: only ONE of the 27 document types
 * (`contract`) ever emitted a signature canvas. `proposal` and
 * `inspectionHomeowner` seed defaultSigners — so the "Send for Signature"
 * button appears — but passed hardcoded STRING arrays to
 * renderSignatureBlock, whose interactive branch only triggers when an entry
 * is an object. Both produced a document with nothing to sign.
 *
 * This test measures the real rendered document in a real browser rather
 * than asserting on CSS text, because the bug was a layout outcome, not a
 * string. Assertions:
 *   - a contract renders at least one [data-nbd-sig] canvas block
 *   - that block sits INSIDE the container's box at 375px and at 1280px
 *   - proposal and inspectionHomeowner also emit canvases when given
 *     object signers (the "1 of 27" regression)
 *
 * PROVEN ABLE TO FAIL: re-introducing `height: 11in; overflow: hidden` on
 * .document-container fails the geometry assertions at both widths; reverting
 * either render call site to a string array fails the emission assertions.
 *
 * Run: node tests/esign-signature-reachable.test.js
 *      (needs tests/node_modules — playwright + chromium)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else {
    failed++; fails.push(name);
    console.log('  ✗ ' + name + (extra ? '\n      ' + extra : ''));
  }
}

const DG_DIR = path.join(__dirname, '..', 'docs/pro/js');
const SRC_DOCGEN    = fs.readFileSync(path.join(DG_DIR, 'document-generator.js'), 'utf8');
const SRC_TEMPLATES = fs.readFileSync(path.join(DG_DIR, 'document-generator-templates.js'), 'utf8');

const BRAND = {
  companyName: 'No Big Deal Home Solutions',
  legalName: 'No Big Deal Home Solutions LLC',
  primary: '#1e3a6e', accent: '#e8720c',
  phone: '513-555-0100', email: 'info@nobigdealwithjoedeal.com',
};

function loadDocGen() {
  const win = { _brand: () => BRAND };
  win.window = win;
  const noop = () => ({ style: {}, appendChild() {}, setAttribute() {}, addEventListener() {} });
  const sandbox = {
    window: win,
    document: {
      addEventListener() {}, getElementById() { return null; },
      querySelector() { return null; }, createElement: noop, body: noop(),
    },
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date, Math, JSON,
  };
  vm.runInNewContext(SRC_DOCGEN, sandbox, { filename: 'document-generator.js' });
  vm.runInNewContext(SRC_TEMPLATES, sandbox, { filename: 'document-generator-templates.js' });
  return win.NBDDocGen;
}

// Object signers are what makes renderSignatureBlock emit the interactive
// canvas branch (document-generator.js: `signers.some(s => typeof s === 'object')`).
const SIGNERS = [
  { role: 'homeowner', label: 'Homeowner', required: true },
  { role: 'contractor', label: 'Contractor', required: true },
];

// Enough merge data for a contract to render a realistically LONG document.
// A short one would fit inside 11in and hide the very bug under test.
const DATA = {
  signers: SIGNERS,
  customerName: 'Pat Homeowner',
  firstName: 'Pat', lastName: 'Homeowner',
  address: '123 Shingle Lane', city: 'Loveland', state: 'OH', zip: '45140',
  propertyAddress: '123 Shingle Lane, Loveland, OH 45140',
  scopeOfWork: Array.from({ length: 12 }, (_, i) =>
    `Line item ${i + 1}: tear off existing layers, install synthetic underlayment, ` +
    `ice and water shield at all valleys and penetrations, and replace decking as needed.`
  ).join(' '),
  lineItems: Array.from({ length: 10 }, (_, i) => ({
    description: `Scope line ${i + 1} — architectural shingles, ridge vent, pipe boots`,
    quantity: i + 1, unitPrice: 100 + i, total: (i + 1) * (100 + i),
  })),
  totalAmount: 18500, total: 18500, contractPrice: 18500,
  deductible: 1000, date: 'September 5, 2026',
};

function countSigBlocks(html) {
  return (String(html).match(/<div\b[^>]*\bdata-nbd-sig\s*=/gi) || []).length;
}
function countCanvases(html) {
  return (String(html).match(/<canvas\b[^>]*class="[^"]*nbd-sig-canvas/gi) || []).length;
}

(async () => {
  console.log('\nesign-signature-reachable\n');

  const dg = loadDocGen();

  // ── 1. Emission: the "1 of 27" regression ─────────────────────────────
  console.log('  signature field emission');
  const contractHtml = dg.renderContract(Object.assign({}, DATA));
  ok('contract emits a signature canvas', countCanvases(contractHtml) >= 1,
    `canvases=${countCanvases(contractHtml)} sigBlocks=${countSigBlocks(contractHtml)}`);

  const proposalHtml = dg.renderProposal(Object.assign({}, DATA));
  ok('proposal emits a signature canvas when given object signers',
    countCanvases(proposalHtml) >= 1,
    `canvases=${countCanvases(proposalHtml)} — renderProposal must pass data.signers through, not a hardcoded string array`);

  const inspHtml = dg.renderInspectionHomeowner(Object.assign({}, DATA));
  ok('inspectionHomeowner emits a signature canvas when given object signers',
    countCanvases(inspHtml) >= 1,
    `canvases=${countCanvases(inspHtml)} — renderInspectionHomeowner must pass data.signers through`);

  // A string-array caller must still render the legacy static ink lines, so
  // the fix cannot have broken the 24 doc types that rely on that branch.
  const legacyHtml = dg.renderSignatureBlock(['Homeowner', 'Contractor']);
  ok('string signers still render static ink lines (no canvas)',
    countCanvases(legacyHtml) === 0 && /signature-line|sig-underline/i.test(legacyHtml),
    'the legacy branch must be untouched');

  // ── 2. Geometry: is the block actually reachable on screen? ────────────
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (e) {
    console.log('\n  ! playwright not resolvable — geometry assertions SKIPPED');
    console.log('    run from tests/ with node_modules installed to measure layout');
    report(); return;
  }

  const browser = await chromium.launch();
  try {
    for (const vp of [{ w: 375, h: 812, name: '375px (phone)' }, { w: 1280, h: 900, name: '1280px (desktop)' }]) {
      const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
      await page.setContent(contractHtml, { waitUntil: 'load' });

      const m = await page.evaluate(() => {
        const c = document.querySelector('.document-container');
        const s = document.querySelector('[data-nbd-sig]');
        if (!c || !s) return { found: false, hasContainer: !!c, hasSig: !!s };
        const cr = c.getBoundingClientRect();
        const sr = s.getBoundingClientRect();
        // Clipped-away content reports a zero-height rect or sits past the
        // container's bottom edge with nothing scrollable to reach it.
        return {
          found: true,
          containerBottom: Math.round(cr.bottom),
          sigTop: Math.round(sr.top),
          sigBottom: Math.round(sr.bottom),
          sigHeight: Math.round(sr.height),
          docScrollHeight: document.documentElement.scrollHeight,
          contentClips: (() => {
            const cc = document.querySelector('.document-content');
            if (!cc) return null;
            const cs = getComputedStyle(cc);
            return cs.overflow === 'hidden' || cs.overflowY === 'hidden';
          })(),
        };
      });

      ok(`[${vp.name}] container and signature block both present`, m.found,
        JSON.stringify(m));

      if (m.found) {
        ok(`[${vp.name}] signature block is INSIDE the container box`,
          m.sigBottom <= m.containerBottom + 2,
          `sigBottom=${m.sigBottom} containerBottom=${m.containerBottom} — the block is clipped below the container's fixed height`);

        ok(`[${vp.name}] signature block has real height (not collapsed)`,
          m.sigHeight > 20, `sigHeight=${m.sigHeight}`);

        ok(`[${vp.name}] .document-content does not clip its overflow`,
          m.contentClips === false,
          `overflow:hidden on the flex child re-creates the clip`);

        // The whole point: the signer can actually get to it.
        ok(`[${vp.name}] signature block is reachable within the page scroll`,
          m.sigBottom <= m.docScrollHeight + 2,
          `sigBottom=${m.sigBottom} docScrollHeight=${m.docScrollHeight}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  report();
})().catch((e) => {
  console.error('\nFATAL', e && e.stack || e);
  process.exit(1);
});

function report() {
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\n  failures:');
    for (const f of fails) console.log('    - ' + f);
    process.exit(1);
  }
  process.exit(0);
}
