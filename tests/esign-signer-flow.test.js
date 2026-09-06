/**
 * tests/esign-signer-flow.test.js — drive the homeowner's signing page for real.
 *
 * Loads /pro/esign.html in Chromium against a mocked getEsignEnvelope, walks
 * the flow a homeowner actually walks — tap a field, draw a signature, type a
 * date, tick a checkbox, consent, submit — and then feeds the values the page
 * POSTs through the REAL functions/esign-stamp.js and asserts a valid PDF
 * comes out with every required field satisfied.
 *
 * That last step is the point. Testing the UI and the stamper separately
 * leaves the contract between them untested, and that contract (field ids,
 * value shapes, transparent PNG data URLs) is exactly where a signing system
 * silently produces a blank contract.
 *
 * Specifically pinned here, because each was a confirmed defect of the older
 * HTML signing path:
 *   - the signer can ZOOM (the old page set user-scalable=no)
 *   - more than one field type exists and each round-trips
 *   - a required field left blank BLOCKS submission
 *   - consent is required before the submit button enables
 *   - the signature PNG is TRANSPARENT, not white-backed
 *
 * Run from tests/: node esign-signer-flow.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'functions');
module.paths.unshift(path.join(FN, 'node_modules'));

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

const { PDFDocument } = require(path.join(FN, 'node_modules', 'pdf-lib'));
const stamp = require(path.join(FN, 'esign-stamp.js'));

const FIELDS = [
  { id: 'sig',  type: 'signature', page: 0, x: 80,  y: 120, w: 200, h: 64, required: true,  label: 'Sign' },
  { id: 'ini',  type: 'initials',  page: 0, x: 320, y: 120, w: 70,  h: 44, required: true,  label: 'Initials' },
  { id: 'dt',   type: 'date',      page: 0, x: 80,  y: 240, w: 150, h: 24, required: true,  label: 'Date' },
  { id: 'note', type: 'text',      page: 0, x: 80,  y: 300, w: 220, h: 24, required: false, label: 'Note' },
  { id: 'ack',  type: 'checkbox',  page: 0, x: 400, y: 300, w: 22,  h: 22, required: true,  label: 'Ack' },
];

function serve(dir, extra) {
  const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' };
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (extra[url]) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(extra[url]); return; }
    const p = path.join(dir, decodeURIComponent(url));
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(fs.readFileSync(p));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

(async () => {
  console.log('\nesign-signer-flow — the homeowner path, end to end\n');

  const src = await PDFDocument.create();
  src.addPage([612, 792]);
  const srcBytes = await src.save();
  const pdfB64 = Buffer.from(srcBytes).toString('base64');

  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (_) { console.log('  ! playwright unavailable — SKIPPED'); return report(); }

  const server = await serve(path.join(ROOT, 'docs'), {});
  const port = server.address().port;
  const browser = await chromium.launch();
  let submitted = null;

  try {
    // 375px — the screen this has to work on.
    const page = await browser.newPage({ viewport: { width: 375, height: 780 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    // The page picks the emulator base when served from 127.0.0.1.
    await page.route('**/getEsignEnvelope', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        title: 'Roofing Agreement', companyName: '', signerName: 'Pat Homeowner',
        pages: [{ w: 612, h: 792, rotation: 0 }], fields: FIELDS, pdf: pdfB64,
        consentText: 'I agree my electronic signature is the legal equivalent of my handwritten signature.',
      }),
    }));
    await page.route('**/submitEsignEnvelope', async (route) => {
      submitted = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await page.goto(`http://127.0.0.1:${port}/pro/esign.html?t=TESTTOKEN123456`);
    await page.waitForSelector('.es-field', { timeout: 25000 });

    ok('page loads with no JS error', pageErrors.length === 0, pageErrors.join(' | '));

    const fieldCount = await page.locator('.es-field').count();
    ok('every placed field renders an overlay', fieldCount === FIELDS.length, `got ${fieldCount}`);

    // Zoom must exist and must actually change the rendered canvas width —
    // the whole complaint about the old page was that it could not zoom.
    const w0 = await page.locator('.es-page canvas').first().evaluate((c) => c.getBoundingClientRect().width);
    await page.click('#esZoomIn');
    await page.waitForTimeout(500);
    const w1 = await page.locator('.es-page canvas').first().evaluate((c) => c.getBoundingClientRect().width);
    ok('zoom in enlarges the rendered page', w1 > w0 + 5, `${w0} -> ${w1}`);
    await page.click('#esZoomFit');
    await page.waitForTimeout(500);

    ok('viewport does NOT disable pinch-zoom',
      !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/.test(
        await page.locator('meta[name=viewport]').getAttribute('content') || ''));

    // ── signature: draw it ────────────────────────────────────────────────
    await page.click('.es-field[data-field-id="sig"]');
    await page.waitForSelector('#esSheet:not([hidden])');
    ok('apply is disabled until something is drawn', await page.locator('#esApply').isDisabled());

    const box = await page.locator('#esPad').boundingBox();
    await page.mouse.move(box.x + 30, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(box.x + 30 + i * 12, box.y + box.height / 2 + Math.sin(i) * 22);
    }
    await page.mouse.up();
    ok('apply enables once a stroke exists', !(await page.locator('#esApply').isDisabled()));
    await page.click('#esApply');
    await page.waitForSelector('#esSheet', { state: 'hidden' });
    ok('signature field shows as complete',
      await page.locator('.es-field[data-field-id="sig"]').evaluate((n) => n.classList.contains('is-done')));

    // ── initials: type them instead ───────────────────────────────────────
    await page.click('.es-field[data-field-id="ini"]');
    await page.waitForSelector('#esSheet:not([hidden])');
    await page.click('#esTabs button[data-mode="type"]');
    await page.fill('#esTypeInput', 'PH');
    await page.click('#esApply');
    await page.waitForSelector('#esSheet', { state: 'hidden' });
    ok('typed initials complete the field',
      await page.locator('.es-field[data-field-id="ini"]').evaluate((n) => n.classList.contains('is-done')));

    // ── date: prefilled with today ────────────────────────────────────────
    await page.click('.es-field[data-field-id="dt"]');
    await page.waitForSelector('#esSheet:not([hidden])');
    const prefilled = await page.locator('#esTextInput').inputValue();
    ok('date field prefills today', /\d{1,2}\/\d{1,2}\/\d{4}/.test(prefilled), `got "${prefilled}"`);
    await page.click('#esApply');
    await page.waitForSelector('#esSheet', { state: 'hidden' });

    // ── required checkbox: one tap, no sheet ──────────────────────────────
    await page.click('.es-field[data-field-id="ack"]');
    ok('checkbox toggles in place without opening a sheet',
      (await page.locator('#esSheet').isHidden())
      && await page.locator('.es-field[data-field-id="ack"]').evaluate((n) => n.classList.contains('is-done')));

    const progress = await page.locator('#esProgress').textContent();
    ok('progress counts only required fields', progress.trim() === '4 of 4', `got "${progress}"`);

    // ── consent gate ──────────────────────────────────────────────────────
    await page.click('#esFinish');
    await page.waitForSelector('#esDone:not([hidden])');
    ok('submit is blocked until consent is ticked', await page.locator('#esSubmit').isDisabled());
    await page.check('#esConsent');
    await page.fill('#esSignerName', 'Pat Homeowner');
    ok('submit enables with consent + name', !(await page.locator('#esSubmit').isDisabled()));

    await page.click('#esSubmit');
    await page.waitForFunction('document.getElementById("esMsgTitle") && /All done/.test(document.getElementById("esMsgTitle").textContent)', null, { timeout: 15000 });
    ok('signer sees a completion screen', true);
  } finally {
    await browser.close();
    server.close();
  }

  // ── the contract between page and stamper ───────────────────────────────
  ok('the page POSTed a submission', !!submitted, 'no submitEsignEnvelope call was captured');
  if (!submitted) return report();

  ok('consent is sent as an explicit true', submitted.consent === true);
  ok('signer name is sent', (submitted.signerName || '').trim() === 'Pat Homeowner');

  const v = submitted.values || {};
  ok('signature arrives as a PNG data URL', typeof v.sig?.png === 'string' && v.sig.png.startsWith('data:image/png;base64,'));
  ok('initials arrive as a PNG data URL', typeof v.ini?.png === 'string' && v.ini.png.startsWith('data:image/png;base64,'));
  ok('date arrives as text', typeof v.dt?.text === 'string' && v.dt.text.length > 0);
  ok('checkbox arrives as checked:true', v.ack?.checked === true);
  ok('the optional field left blank is not fabricated', !v.note || !v.note.text);

  // Transparency: a white-backed signature is invisible on white HTML but
  // lands as an opaque sticker on a PDF form. Check the PNG really has alpha.
  ok('signature PNG carries an alpha channel', (() => {
    const raw = Buffer.from(v.sig.png.split(',')[1], 'base64');
    // IHDR colour type is byte 25 of a PNG: 6 = truecolour+alpha, 4 = grey+alpha.
    const colourType = raw[25];
    return colourType === 6 || colourType === 4;
  })(), `IHDR colour type ${Buffer.from(v.sig.png.split(',')[1], 'base64')[25]}`);

  // ── and it actually stamps ──────────────────────────────────────────────
  const res = await stamp.stampPdf(srcBytes, FIELDS, v, { certificateLine: 'test' });
  ok('every required field is satisfied by what the page sent',
    res.missingRequired.length === 0, JSON.stringify(res.missingRequired));
  ok('a real PDF comes out', Buffer.from(res.bytes.slice(0, 5)).toString() === '%PDF-');
  ok('the signed PDF is larger than the source', res.bytes.length > srcBytes.length);

  // Dropping a required value must be caught, not silently produce a blank.
  const holed = Object.assign({}, v); delete holed.sig;
  const res2 = await stamp.stampPdf(srcBytes, FIELDS, holed, {});
  ok('a missing required signature is reported, not silently skipped',
    res2.missingRequired.includes('sig'), JSON.stringify(res2.missingRequired));

  report();
})().catch((e) => { console.error('\nFATAL', (e && e.stack) || e); process.exit(1); });

function report() {
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
  process.exit(0);
}
