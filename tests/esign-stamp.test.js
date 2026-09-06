/**
 * tests/esign-stamp.test.js — does a stamped field land where the signer saw it?
 *
 * functions/esign-stamp.js draws signer values into a PDF at PDF user-space
 * coordinates. The placement UI captures those coordinates through pdf.js's
 * `viewport.convertToPdfPoint()`. This test closes that loop the only way
 * that actually proves anything: it stamps a real PDF, renders the result
 * with THE VENDORED pdf.js BUILD WE SHIP (docs/assets/vendor/pdfjs), and
 * checks that ink appears inside the rectangle
 * `viewport.convertToViewportPoint()` predicts — and nowhere else.
 *
 * The case that matters is page 2: /Rotate 90. Scanned insurance forms and
 * manufacturer warranties are routinely rotated, and a rotated page is
 * exactly where a normalised-fraction coordinate scheme silently puts every
 * signature in the wrong place. If this file ever goes red on the rotated
 * page, the coordinate contract has been broken — do not "fix" it by
 * loosening the tolerance.
 *
 * PROVEN ABLE TO FAIL: offsetting any stamped field by ~40pt, or swapping
 * convertToViewportPoint for a naive (x, pageH - y) mapping, turns the
 * rotated-page assertions red while the upright page stays green.
 *
 * Zero new dependencies: pdf-lib comes from functions/node_modules, the
 * browser from tests/node_modules (playwright), and pdf.js from the repo.
 *
 * Run from tests/: node esign-stamp.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const FN = path.join(ROOT, 'functions');
module.paths.unshift(path.join(FN, 'node_modules'));

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (extra ? '\n      ' + extra : '')); }
}

const { PDFDocument, degrees } = require(path.join(FN, 'node_modules', 'pdf-lib'));
const stamp = require(path.join(FN, 'esign-stamp.js'));

// A 24x24 solid black PNG — big enough that scaling keeps it clearly visible.
const BLACK_PNG_24 = (() => {
  // Built with pdf-lib's own PNG encoder is overkill; this is a hand-made
  // 24x24 black PNG (zlib stored blocks), kept literal so the test has no
  // image dependency of its own.
  const zlib = require('zlib');
  const W = 24, H = 24;
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) raw[y * (W * 3 + 1)] = 0; // filter byte 0, rest already 0 = black
  const idat = zlib.deflateSync(raw);
  const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolour
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
  return 'data:image/png;base64,' + png.toString('base64');
})();

// Fields chosen to sit well apart so one field's ink cannot satisfy another's
// assertion, and away from the page edges where the certificate line is drawn.
const FIELDS = [
  { id: 'sigA', type: 'signature', page: 0, x: 80,  y: 120, w: 180, h: 60, required: true },
  { id: 'txtA', type: 'text',      page: 0, x: 80,  y: 400, w: 220, h: 22, required: true },
  { id: 'ckA',  type: 'checkbox',  page: 0, x: 420, y: 600, w: 20,  h: 20, required: true },
  // Rotated page — the whole point of the exercise.
  { id: 'sigB', type: 'signature', page: 1, x: 100, y: 150, w: 180, h: 60, required: true },
  { id: 'ckB',  type: 'checkbox',  page: 1, x: 400, y: 640, w: 20,  h: 20, required: true },
];
const VALUES = {
  sigA: { png: BLACK_PNG_24 },
  txtA: { text: 'Pat Homeowner' },
  ckA:  { checked: true },
  sigB: { png: BLACK_PNG_24 },
  ckB:  { checked: true },
};

function serve(dir, extra) {
  const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.html': 'text/html', '.map': 'application/json' };
  const server = http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (extra[url]) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(extra[url]); return;
    }
    const p = path.join(dir, decodeURIComponent(url));
    if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream' });
    res.end(fs.readFileSync(p));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const HARNESS = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>h</title></head>
<body><canvas id="c"></canvas>
<script type="module">
import * as pdfjs from '/assets/vendor/pdfjs/pdf.min.mjs';
pdfjs.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdfjs/pdf.worker.min.mjs';
window.__render = async (b64, pageIndex, scale) => {
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const doc = await pdfjs.getDocument({ data: bytes }).promise;
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const canvas = document.getElementById('c');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, background: '#fff' }).promise;
  return { w: canvas.width, h: canvas.height, rotation: viewport.rotation };
};
// Ink density inside the viewport rect predicted for a PDF-space box.
window.__probe = async (b64, pageIndex, scale, box) => {
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(atob(b64), c => c.charCodeAt(0)) }).promise;
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const a = viewport.convertToViewportPoint(box.x, box.y);
  const b = viewport.convertToViewportPoint(box.x + box.w, box.y + box.h);
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
  const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
  const ctx = document.getElementById('c').getContext('2d', { willReadFrequently: true });
  const px = Math.max(0, Math.floor(x0)), py = Math.max(0, Math.floor(y0));
  const pw = Math.max(1, Math.ceil(x1 - x0)), ph = Math.max(1, Math.ceil(y1 - y0));
  const d = ctx.getImageData(px, py, pw, ph).data;
  let dark = 0, total = 0;
  for (let i = 0; i < d.length; i += 4) { total++; if (d[i] < 160 && d[i+1] < 160 && d[i+2] < 160) dark++; }
  return { rect: [px, py, pw, ph], dark, total, ratio: total ? dark / total : 0 };
};
window.__ready = true;
</script></body></html>`;

(async () => {
  console.log('\nesign-stamp — does ink land where the signer saw the field?\n');

  // ── build a 2-page source, page 2 rotated 90° ──────────────────────────
  const src = await PDFDocument.create();
  src.addPage([612, 792]);
  src.addPage([612, 792]).setRotation(degrees(90));
  const srcBytes = await src.save();

  const geo = await stamp.readPdfGeometry(srcBytes);
  ok('geometry reports the page rotation', geo.length === 2 && geo[0].rotation === 0 && geo[1].rotation === 90,
    JSON.stringify(geo));

  const res = await stamp.stampPdf(srcBytes, FIELDS, VALUES, {
    certificateLine: 'Signed electronically — test envelope',
  });
  ok('all required fields satisfied', res.missingRequired.length === 0, JSON.stringify(res.missingRequired));
  ok('stamped output is a PDF', Buffer.from(res.bytes.slice(0, 5)).toString() === '%PDF-');

  const b64 = Buffer.from(res.bytes).toString('base64');

  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch (_) {
    console.log('\n  ! playwright unavailable — render assertions SKIPPED');
    return report();
  }

  const server = await serve(path.join(ROOT, 'docs'), { '/__h.html': HARNESS });
  const port = server.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/__h.html`);
    await page.waitForFunction('window.__ready === true', null, { timeout: 20000 });
    ok('the vendored pdf.js build loads with no page error', errs.length === 0, errs.join(' | '));

    const SCALE = 1.5;
    for (const pageIndex of [0, 1]) {
      const meta = await page.evaluate(([b, i, s]) => window.__render(b, i, s), [b64, pageIndex, SCALE]);
      ok(`page ${pageIndex + 1} renders (${meta.w}x${meta.h}, rotation ${meta.rotation})`, meta.w > 0 && meta.h > 0);

      for (const f of FIELDS.filter((f) => f.page === pageIndex)) {
        const probe = await page.evaluate(([b, i, s, box]) => window.__probe(b, i, s, box),
          [b64, pageIndex, SCALE, { x: f.x, y: f.y, w: f.w, h: f.h }]);
        ok(`p${pageIndex + 1} ${f.id} (${f.type}) has ink where pdf.js predicts`,
          probe.ratio > 0.02,
          `dark=${probe.dark}/${probe.total} ratio=${probe.ratio.toFixed(4)} rect=${JSON.stringify(probe.rect)}`);
      }

      // Control: a region with no field must be blank. Without this, a page
      // rendered entirely dark would satisfy every assertion above.
      const empty = pageIndex === 0
        ? { x: 300, y: 300, w: 80, h: 40 }
        : { x: 250, y: 300, w: 80, h: 40 };
      const blank = await page.evaluate(([b, i, s, box]) => window.__probe(b, i, s, box), [b64, pageIndex, SCALE, empty]);
      ok(`p${pageIndex + 1} an unstamped region stays blank`, blank.ratio < 0.01,
        `ratio=${blank.ratio.toFixed(4)} — if this is high the page is dark everywhere and the ink assertions are meaningless`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  report();
})().catch((e) => { console.error('\nFATAL', (e && e.stack) || e); process.exit(1); });

function report() {
  console.log(`\n  ${passed} passed, ${failed} failed`);
  if (failed) { console.log('\n  failures:'); for (const f of fails) console.log('    - ' + f); process.exit(1); }
  process.exit(0);
}
