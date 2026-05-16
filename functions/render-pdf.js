/**
 * functions/render-pdf.js — server-side PDF rendering
 * ─────────────────────────────────────────────────────────────────
 *
 * THE document-quality overhaul (D-1). Replaces the html2canvas +
 * jsPDF rasterization pipeline with real Chromium-rendered PDFs:
 *   - Vector text (no canvas anti-aliasing)
 *   - Real PDF fonts (Barlow + Barlow Condensed embedded)
 *   - Native page breaks (@page CSS works correctly)
 *   - Multi-page running headers / footers
 *   - Tabular numerals, ligatures, kerning
 *
 * Architecture:
 *   1. Client calls `renderPdf({template, data, filename})` callable
 *   2. We load templates/<name>.hbs + design-system.css + partials
 *   3. Handlebars renders the body, embeds it into _layout.hbs
 *   4. Puppeteer launches Chromium, sets content, waits for fonts +
 *      images, calls page.pdf() with the precise sizing options
 *   5. We upload the PDF to Storage at pdf-renders/{uid}/{ts}-{slug}.pdf
 *      with a Cache-Control header (renders are immutable)
 *   6. Return a signed read URL good for 7 days
 *
 * Why a Cloud Function (not a Cloud Run service):
 *   - Already in our infra, single deploy target
 *   - 2GB memory + minInstances:1 keep Chromium warm; ~1.5s warm renders
 *   - @sparticuz/chromium ships a pruned Chromium binary that fits the
 *     function size limit (would not fit with full puppeteer)
 *
 * Cost: minInstances:1 keeps one warm (~$5-10/mo at us-central1
 * pricing). Per-render compute is bounded by the 30s timeout and
 * scales to zero outside the warm instance.
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];

// ─── Template registry ─────────────────────────────────────────
// Lock the allowed template names server-side so a client can't
// arbitrarily render anything off disk. Each entry maps a template
// key to a Handlebars file in print/templates/. As D-2..D-5 land,
// they add lines here — that's the only API surface change.
const TEMPLATES = {
  warranty:   { file: 'warranty.hbs',   docType: 'Warranty Certificate', seal: 'Lifetime Pledge' },
  inspection: { file: 'inspection.hbs', docType: 'Inspection Report',    seal: 'Inspection' },
  estimate:   { file: 'estimate.hbs',   docType: 'Project Estimate',     seal: 'Estimate' },
  // invoice:    { file: 'invoice.hbs',    docType: 'Invoice',          seal: 'Invoice' },
  // contract:   { file: 'contract.hbs',   docType: 'Project Contract', seal: 'Contract' },
  // changeOrder:{ file: 'changeOrder.hbs',docType: 'Change Order',     seal: 'CO' },
  // receipt:    { file: 'receipt.hbs',    docType: 'Receipt',          seal: 'Receipt' },
  // photoReport:{ file: 'photoReport.hbs',docType: 'Photo Report',     seal: 'Photo Report' },
};

// ─── Cached loaders ────────────────────────────────────────────
// Templates + CSS + partials are read once per function instance.
// With minInstances:1 that's effectively at deploy time. We register
// partials here as well so {{> brandBandTop}} resolves at render time.
let _designCss = null;
const _tmplCache = new Map();

function loadDesignSystemCss() {
  if (_designCss) return _designCss;
  _designCss = fs.readFileSync(path.join(__dirname, 'print', 'design-system.css'), 'utf8');
  return _designCss;
}

function registerPartialsOnce() {
  if (Handlebars.partials.brandBandTop) return;
  const partialsDir = path.join(__dirname, 'print', 'partials');
  for (const f of fs.readdirSync(partialsDir)) {
    if (!f.endsWith('.hbs') || f.startsWith('_')) continue;
    const name = f.replace(/\.hbs$/, '');
    Handlebars.registerPartial(name, fs.readFileSync(path.join(partialsDir, f), 'utf8'));
  }
}

// ─── Handlebars helpers ───────────────────────────────────────
// Registered once per cold-start. Templates that need additional
// helpers add them here so the renderer stays the one place that
// knows about template internals.
function registerHelpersOnce() {
  if (Handlebars.helpers.severityClass) return;

  // Map a condition string to the badge CSS class — used by
  // the inspection template's component findings table.
  Handlebars.registerHelper('severityClass', (cond) => {
    const c = String(cond || '').toLowerCase();
    if (c === 'critical')        return 'sev-critical';
    if (c === 'poor')            return 'sev-poor';
    if (c === 'fair')            return 'sev-fair';
    if (c === 'good')            return 'sev-good';
    return 'sev-neutral';
  });

  // Inline math for column counts, photo grids, etc.
  Handlebars.registerHelper('inc', (n) => Number(n) + 1);
  Handlebars.registerHelper('gt',  (a, b) => Number(a) > Number(b));
  Handlebars.registerHelper('eq',  (a, b) => a === b);

  // Format a Date | ISO | timestamp into "Month D, YYYY" in en-US.
  // Templates pass raw values from the lead; we don't trust them
  // to pre-format.
  Handlebars.registerHelper('fmtDate', (v) => {
    if (!v) return '';
    let d;
    if (v instanceof Date) d = v;
    else if (typeof v === 'number') d = new Date(v);
    else if (typeof v === 'string') d = new Date(v);
    else if (v && typeof v.toMillis === 'function') d = new Date(v.toMillis());
    else return String(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  });

  // Tabular-num money formatter. We do the formatting in the
  // template (not CSS) so cells line up regardless of font fallback.
  Handlebars.registerHelper('money', (v) => {
    const n = Number(v);
    if (!isFinite(n)) return '—';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  });

  // Counter for {{photoCount}} and similar.
  Handlebars.registerHelper('len', (v) => Array.isArray(v) ? v.length : 0);
}

function loadTemplate(file) {
  if (_tmplCache.has(file)) return _tmplCache.get(file);
  const src = fs.readFileSync(path.join(__dirname, 'print', 'templates', file), 'utf8');
  const compiled = Handlebars.compile(src);
  _tmplCache.set(file, compiled);
  return compiled;
}

function loadLayout() {
  if (_tmplCache.has('_layout')) return _tmplCache.get('_layout');
  const src = fs.readFileSync(path.join(__dirname, 'print', 'partials', '_layout.hbs'), 'utf8');
  const compiled = Handlebars.compile(src);
  _tmplCache.set('_layout', compiled);
  return compiled;
}

// ─── Puppeteer / Chromium boot (lazy + single instance) ────────
// Holding a single browser across invocations is the standard
// pattern for serverless Puppeteer — boot time is ~1.5s cold,
// ~50ms with the browser still attached.
let _browser = null;
async function getBrowser() {
  if (_browser && _browser.isConnected && _browser.isConnected()) {
    return _browser;
  }
  const chromium = require('@sparticuz/chromium');
  const puppeteer = require('puppeteer-core');
  _browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1280, height: 1696, deviceScaleFactor: 2 },
    executablePath: await chromium.executablePath(),
    headless: 'shell',
  });
  return _browser;
}

// ─── Main callable ─────────────────────────────────────────────
exports.renderPdf = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 60,
    // Chromium needs real memory. 1GB is borderline; 2GB is the
    // sweet spot for a single render plus future inspection reports
    // with 30+ photos. Keep one warm so the rep doesn't see a cold
    // start when generating a cert at end-of-job.
    memory: '2GiB',
    minInstances: 1,
    maxInstances: 10,
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    // ── input validation ──
    const data = request.data || {};
    const templateKey = String(data.template || '').trim();
    if (!templateKey || !TEMPLATES[templateKey]) {
      throw new HttpsError('invalid-argument', 'Unknown template');
    }
    const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};
    const filename = (typeof data.filename === 'string' ? data.filename : '')
      .trim()
      .replace(/[^A-Za-z0-9_\-\.]/g, '_')
      .slice(0, 120) || (templateKey + '.pdf');

    const tmplCfg = TEMPLATES[templateKey];
    const t0 = Date.now();

    // ── render the HTML body via Handlebars ──
    registerPartialsOnce();
    registerHelpersOnce();
    const bodyCompiled = loadTemplate(tmplCfg.file);
    const layoutCompiled = loadLayout();

    const bodyHtml = bodyCompiled(payload);
    const html = layoutCompiled({
      title:           tmplCfg.docType,
      docType:         tmplCfg.docType,
      seal:            tmplCfg.seal,
      docNumber:       payload.certNumber || payload.docNumber || '',
      designSystemCss: loadDesignSystemCss(),
      templateCss:     '', // reserved for per-template overrides in later D-PRs
      body:            bodyHtml,
    });
    const buildMs = Date.now() - t0;

    // ── render the PDF via Chromium ──
    const browser = await getBrowser();
    const page = await browser.newPage();
    let pdfBuffer;
    try {
      await page.setContent(html, { waitUntil: ['load', 'networkidle0'] });
      // Wait for the Google Fonts to actually be ready — networkidle0
      // alone is occasionally too aggressive when the font-face is
      // already requested but not yet decoded.
      await page.evaluateHandle('document.fonts.ready');
      pdfBuffer = await page.pdf({
        format: 'Letter',
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: '0', bottom: '0', left: '0', right: '0' }, // controlled by @page
        displayHeaderFooter: false,
      });
    } finally {
      await page.close().catch(() => {});
    }
    const renderMs = Date.now() - t0 - buildMs;

    // ── upload to Storage with a deterministic-ish key ──
    const bucket = admin.storage().bucket();
    const ts = Date.now();
    const objectPath = `pdf-renders/${uid}/${ts}-${filename}`;
    const file = bucket.file(objectPath);
    await file.save(pdfBuffer, {
      metadata: {
        contentType: 'application/pdf',
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: { template: templateKey, renderedBy: uid, renderedAtMs: String(ts) },
      },
      resumable: false,
    });

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      // 7 days — same envelope as portal share tokens; long enough
      // for the rep to email/download but not "forever public".
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });

    const totalMs = Date.now() - t0;
    logger.info('[renderPdf] ok', { template: templateKey, uid, buildMs, renderMs, totalMs, bytes: pdfBuffer.length });

    return {
      ok: true,
      url: signedUrl,
      path: objectPath,
      filename,
      bytes: pdfBuffer.length,
      timing: { buildMs, renderMs, totalMs },
    };
  }
);
