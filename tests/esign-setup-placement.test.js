/**
 * tests/esign-setup-placement.test.js — the rep's field-placement page, driven for real.
 *
 * Loads /pro/esign-setup.html in Chromium with the Firebase SDK modules
 * stubbed (so no auth, network or App Check is involved) and exercises the
 * part that actually has to be right: placing fields.
 *
 * THE PROPERTY THAT MATTERS is the coordinate round trip. The page captures
 * boxes through `viewport.convertToPdfPoint` and the server draws them with
 * no transform, so a box drawn at 100% and the SAME box drawn at 250% zoom
 * must persist to the same PDF coordinates. If that ever stops holding,
 * signatures land in the wrong place on exactly the documents that matter
 * most — and no unit test of either side alone would notice.
 *
 * Also pinned: auto-detect finds a form's own signature lines, a tap (rather
 * than a drag) drops a usable default box, delete works, and what the page
 * would persist passes the stamper's own validateFields.
 *
 * Run from tests/: node esign-setup-placement.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'functions');
module.paths.unshift(path.join(FN, 'node_modules'));

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

const { PDFDocument, StandardFonts, rgb } = require(path.join(FN, 'node_modules', 'pdf-lib'));
const stamp = require(path.join(FN, 'esign-stamp.js'));

/* Minimal ES-module stubs standing in for the gstatic Firebase SDK. */
const STUBS = {
  'firebase-app.js': `export function initializeApp(){return {name:'stub'}} export function getApps(){return []}`,
  'firebase-app-check.js': `export function initializeAppCheck(){return {}} export class ReCaptchaEnterpriseProvider{}`,
  'firebase-auth.js': `export function getAuth(){return {}}
    export function onAuthStateChanged(a,cb){ setTimeout(()=>cb({uid:'REPUID'}),0); }`,
  'firebase-storage.js': `export function getStorage(){return {}}
    export function ref(){return {}}
    export async function uploadBytes(){ globalThis.__uploads=(globalThis.__uploads||0)+1; return {}; }`,
  'firebase-functions.js': `export function getFunctions(){return {}}
    export function httpsCallable(_f,name){
      return async (payload)=>{ (globalThis.__calls=globalThis.__calls||[]).push({name,payload});
        if(name==='createEsignEnvelope') return {data:{envelopeId:payload.envelopeId,pageCount:1}};
        return {data:{ok:true, link:'https://example.test/pro/esign.html?t=TOK'}}; };
    }`,
  'nbd-emulator-connect.js': `export async function connectEmulatorsIfLocal(){return false}
    export function isLocalEmulatorEnv(){return false}`,
};

function serve(dir) {
  const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' };
  const s = http.createServer((req, res) => {
    const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(fs.readFileSync(p));
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s)));
}

/** A form with two real ruled signature lines, for auto-detect to find. */
async function buildForm() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const T = (t, x, y, s) => page.drawText(t, { x, y, size: s || 11, font: helv, color: rgb(0.1, 0.1, 0.18) });
  T('MATERIAL ORDER AUTHORIZATION', 62, 720, 16);
  T('Supplier form — sign and return.', 62, 700, 10);
  T('_________________________________', 62, 200, 12);
  T('Homeowner Signature', 62, 186, 8);
  T('_______________', 400, 200, 12);
  T('Date', 400, 186, 8);
  return doc.save();
}

(async () => {
  console.log('\nesign-setup-placement — the rep places the fields\n');

  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (_) { console.log('  ! playwright unavailable — SKIPPED'); return report(); }

  const bytes = await buildForm();
  const tmp = path.join(os.tmpdir(), `nbd-esign-form-${process.pid}.pdf`);
  fs.writeFileSync(tmp, Buffer.from(bytes));

  const server = await serve(path.join(ROOT, 'docs'));
  const port = server.address().port;
  const browser = await chromium.launch();

  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    // "Clear all" is guarded by window.confirm. Playwright DISMISSES dialogs
    // by default, so without this the guard silently wins and the assertion
    // below would be testing the dialog, not the page.
    page.on('dialog', (d) => d.accept());

    for (const [file, body] of Object.entries(STUBS)) {
      await page.route(`**/${file}`, (route) => route.fulfill({
        status: 200, contentType: 'text/javascript', body,
      }));
    }

    await page.goto(`http://127.0.0.1:${port}/pro/esign-setup.html?lead=LEAD1`);
    await page.waitForSelector('#suDrop', { state: 'visible', timeout: 20000 });
    ok('page boots with no JS error', errs.length === 0, errs.join(' | '));

    await page.setInputFiles('#suFile', tmp);
    await page.waitForSelector('.es-page canvas', { timeout: 25000 });
    ok('choosing a PDF renders it for placement', true);
    // The page renders from the LOCAL file first and uploads after, so this
    // has to wait for the upload rather than sample straight after render.
    let uploaded = true;
    try {
      await page.waitForFunction(
        '(globalThis.__uploads || 0) > 0 && (globalThis.__calls || []).some(c => c.name === "createEsignEnvelope")',
        null, { timeout: 15000});
    } catch (_) { uploaded = false; }
    ok('the file was uploaded and an envelope created', uploaded,
      await page.evaluate(() => JSON.stringify({
        uploads: globalThis.__uploads || 0,
        calls: (globalThis.__calls || []).map((c) => c.name),
      })));

    // ── auto-detect ───────────────────────────────────────────────────────
    await page.click('#suAuto');
    await page.waitForFunction('document.querySelectorAll(".su-field").length > 0', null, { timeout: 20000 });
    const autoCount = await page.locator('.su-field').count();
    ok('auto-detect finds the form\'s own signature lines', autoCount >= 2, `found ${autoCount}`);
    ok('auto-proposed fields are visually distinguished',
      (await page.locator('.su-field.is-auto').count()) === autoCount);

    const autoTypes = await page.evaluate(() =>
      [...document.querySelectorAll('.su-field .su-lbl')].map((n) => n.textContent).sort());
    ok('it types them, not just boxes them',
      autoTypes.includes('Signature') && autoTypes.includes('Date'), JSON.stringify(autoTypes));

    await page.click('#suClear');   // window.confirm auto-accepts in Playwright
    await page.waitForFunction('document.querySelectorAll(".su-field").length === 0', null, { timeout: 10000 });
    ok('clear all removes every field', true);

    // ── THE ROUND TRIP: same box, two zoom levels ────────────────────────
    /**
     * Drag a box `offX/offY` points into the PAGE (scaled by the current
     * zoom), so the same PDF region is targeted at any zoom level. Scrolls to
     * the top-left first: at high zoom the canvas is far taller than the
     * stage, and a fraction-of-canvas point lands underneath the footer.
     */
    async function dragBox(offX, offY, w, h) {
      await page.evaluate(() => { const s = document.getElementById('suScroll'); s.scrollTop = 0; s.scrollLeft = 0; });
      await page.waitForTimeout(60);
      const z = await zoomFactor(page);
      const c = await page.locator('.es-page canvas').first().boundingBox();
      const x = c.x + offX * z;
      const y = c.y + offY * z;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + w * z, y + h * z, { steps: 6 });
      await page.mouse.up();
    }
    const readFields = () => page.evaluate(() =>
      [...document.querySelectorAll('.su-field')].map((n) => ({
        id: n.dataset.id,
        left: Math.round(n.getBoundingClientRect().left),
      })));

    await dragBox(90, 150, 180, 46);
    await page.waitForFunction('document.querySelectorAll(".su-field").length === 1', null, { timeout: 8000 });
    ok('dragging on the page places a field', (await readFields()).length === 1);

    const peek = () => page.evaluate(() => (window.__peekFields && window.__peekFields()) || null);
    const at100 = await peek();
    if (!at100) {
      ok('page exposes its field list for verification', false,
        'esign-setup.js must expose window.__peekFields()');
    }

    // Remove it before redrawing: a field already sitting on that region
    // would capture the pointerdown and be MOVED instead of a new box drawn.
    await page.locator('.su-field .su-del').first().click();
    await page.waitForFunction('document.querySelectorAll(".su-field").length === 0', null, { timeout: 8000 });
    ok('the × removes a field', true);

    // Same region of the same page, at ~156% zoom.
    await page.click('#suZoomIn');
    await page.click('#suZoomIn');
    await page.waitForTimeout(800);
    const z = await zoomFactor(page);
    await dragBox(90, 150, 180, 46);
    await page.waitForFunction('document.querySelectorAll(".su-field").length === 1', null, { timeout: 8000 });
    const atZoom = await peek();

    if (at100 && atZoom && at100.length === 1 && atZoom.length === 1) {
      const a = at100[0], b = atZoom[0];
      const near = (p, q, tol) => Math.abs(p - q) <= tol;
      ok(`the same box drawn at 100% and at ~${Math.round(z * 100)}% persists to the same PDF coordinates`,
        near(a.x, b.x, 6) && near(a.y, b.y, 8) && near(a.w, b.w, 8) && near(a.h, b.h, 8),
        `100%:   ${JSON.stringify(a)}\n      zoomed: ${JSON.stringify(b)}`);

      let err = null;
      try { stamp.validateFields(atZoom, 1); } catch (e) { err = e.message; }
      ok('what the page would persist passes the stamper\'s validateFields', err === null, err || '');
    }

    // ── a tap, not a drag, still gives a usable box ───────────────────────
    await page.click('#suZoomFit');
    await page.waitForTimeout(700);
    await dragBox(300, 300, 2, 2);   // sub-threshold: treated as a tap
    await page.waitForFunction('document.querySelectorAll(".su-field").length === 2', null, { timeout: 8000 });
    const tapped = (await peek())[1];
    ok('a tap drops a default-sized box rather than a 2pt sliver',
      tapped && tapped.w > 40 && tapped.h > 15, JSON.stringify(tapped));

    ok('no JS errors across the whole session', errs.length === 0, errs.join(' | '));
  } finally {
    await browser.close();
    server.close();
    try { fs.unlinkSync(tmp); } catch (_) {}
  }

  report();
})().catch((e) => { console.error('\nFATAL', (e && e.stack) || e); process.exit(1); });

async function zoomFactor(page) {
  const pct = await page.locator('#suZoomPct').textContent();
  const n = parseInt(String(pct).replace('%', ''), 10);
  return (Number.isFinite(n) ? n : 100) / 100;
}

function report() {
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
  process.exit(0);
}
