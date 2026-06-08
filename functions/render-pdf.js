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
const { callableRateLimit } = require('./shared');
const { withSentry } = require('./integrations/sentry');
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
  photoReport:{ file: 'photoReport.hbs',docType: 'Photo Report',         seal: 'Photo Report' },
  invoice:    { file: 'invoice.hbs',    docType: 'Invoice',              seal: 'Invoice' },
  contract:   { file: 'contract.hbs',   docType: 'Project Contract',     seal: 'Contract' },
  changeOrder:{ file: 'changeOrder.hbs',docType: 'Change Order',         seal: 'Change Order' },
  receipt:    { file: 'receipt.hbs',    docType: 'Payment Receipt',      seal: 'Receipt' },
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
  Handlebars.registerHelper('add', (a, b) => Number(a) + Number(b));
  Handlebars.registerHelper('sub', (a, b) => Number(a) - Number(b));
  Handlebars.registerHelper('mul', (a, b) => Number(a) * Number(b));

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

// ─── Tenant brand for document chrome (Phase B-4) ──────────────
// Resolve the caller's tenant brand server-side from their companyId claim.
// NBD — and any tenant without a distinct companyProfile.brand — renders the
// canonical NBD chrome, byte-identical. The .hbs partials consume these fields.
const NBD_DOC_COMPANY = {
  logoUrl: 'https://nobigdealwithjoedeal.com/assets/images/nbd-logo.png',
  nameHtml: 'No Big <span class="accent">Deal</span> Home Solutions',
  footerName: 'No Big Deal Home Solutions',
  brandTag: 'Insurance Restoration Specialists · Greater Cincinnati',
  brandContact: '(859) 420-7382 · jd@nobigdealwithjoedeal.com',
  footerContact: '(859) 420-7382 · jd@nobigdealwithjoedeal.com · Greater Cincinnati, OH',
  // Individual contact pieces the invoice/receipt body templates reference
  // (they used to hardcode these). NBD keeps the exact literals → byte-identical.
  email: 'jd@nobigdealwithjoedeal.com',
  phone: '(859) 420-7382',
  contactName: 'Joe',
  seal: 'NBD',
  colors: null,
};
function hbsEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
// Phase B-4b: inject the tenant's brand colours as a :root override appended
// AFTER the static design-system :root (equal specificity → later rule wins).
// NBD → '' (byte-identical render). Only the dominant brand tokens are mapped.
function hexToRgb(hex) {
  const s = String(hex || '');
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(s);
  if (m) return parseInt(m[1], 16) + ', ' + parseInt(m[2], 16) + ', ' + parseInt(m[3], 16);
  // 3-digit shorthand (#fc0) — a tenant accent written short would otherwise
  // fail to parse and the soft/line tints would fall back to NBD orange (L5).
  const s3 = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(s);
  if (s3) return parseInt(s3[1] + s3[1], 16) + ', ' + parseInt(s3[2] + s3[2], 16) + ', ' + parseInt(s3[3] + s3[3], 16);
  return null;
}
// Darken a hex by `f` (0..1) for the *-dark accent token, so the tenant gets a
// real darker shade instead of the accent repeated (L4). Falls back to the
// input if it can't be parsed.
function darken(hex, f) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const parts = rgb.split(',').map(function (n) {
    const v = Math.max(0, Math.min(255, Math.round(parseInt(n, 10) * (1 - f))));
    return ('0' + v.toString(16)).slice(-2);
  });
  return '#' + parts.join('');
}
function buildBrandVars(colors) {
  if (!colors) return '';
  const v = [];
  if (colors.accent) {
    v.push('--nbd-orange:' + colors.accent);
    v.push('--nbd-orange-dark:' + darken(colors.accent, 0.15));
    const rgb = hexToRgb(colors.accent);
    if (rgb) {
      v.push('--nbd-orange-soft:rgba(' + rgb + ',0.08)');
      v.push('--nbd-orange-line:rgba(' + rgb + ',0.35)');
    }
  }
  const charcoal = colors.charcoal || colors.primary;
  if (charcoal) {
    v.push('--nbd-charcoal:' + charcoal);
    v.push('--nbd-ink:' + (colors.ink || charcoal));
  }
  return v.length ? ':root{' + v.join(';') + ';}' : '';
}
async function resolveDocCompany(companyId) {
  if (!companyId) return NBD_DOC_COMPANY;
  try {
    const snap = await admin.firestore().collection('companyProfile').doc(String(companyId)).get();
    if (snap.exists) {
      const b = (snap.data() || {}).brand || {};
      if (b.legalName && b.legalName !== NBD_DOC_COMPANY.footerName) {
        const c = b.contact || {};
        // logo/seal fall back to BLANK, never NBD's — a non-NBD tenant that
        // didn't set its own must not stamp NBD's logo or 'NBD' seal on its
        // PDF (review M1). `b` is the raw, un-merged override, so c.* is already
        // the tenant's own value or undefined.
        return {
          logoUrl: b.logoUrl || '',
          nameHtml: hbsEsc(b.legalName),
          footerName: b.legalName,
          brandTag: b.tagline || '',
          brandContact: [c.phone, c.email].filter(Boolean).join(' · '),
          footerContact: [c.phone, c.email, c.address].filter(Boolean).join(' · '),
          email: c.email || '',
          phone: c.phone || '',
          contactName: '', // tenants have no per-person first name; never 'Joe'
          seal: b.seal || '',
          colors: b.colors || null,
        };
      }
    }
  } catch (e) {
    logger.error('[renderPdf] tenant resolve failed', { companyId, err: e && e.message });
  }
  return NBD_DOC_COMPANY;
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
  withSentry('renderPdf', async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    // Phase-3.2: rate-limit the expensive Puppeteer render (2GiB,
    // minInstances:1). Auth + App Check gate WHO can call it, but nothing
    // capped HOW OFTEN — a loop could rack up Chromium compute cost.
    // 30/min/uid is generous for a rep generating end-of-job docs
    // (contract + warranty + invoice + photo report in a burst), tight
    // against an abuse loop.
    await callableRateLimit(request, 'renderPdf', 30, 60_000);

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

    // Resolve the active tenant's brand from the caller's companyId claim
    // (solo-op convention: companyId == uid). NBD → byte-identical chrome.
    const companyId = (request.auth.token && request.auth.token.companyId) || uid;
    const company = await resolveDocCompany(companyId);
    const brandVars = buildBrandVars(company.colors);

    const bodyHtml = bodyCompiled(Object.assign({}, payload, { company }));
    const html = layoutCompiled({
      title:           tmplCfg.docType,
      docType:         tmplCfg.docType,
      seal:            tmplCfg.seal,
      docNumber:       payload.certNumber || payload.docNumber || '',
      designSystemCss: loadDesignSystemCss(),
      brandVars:       brandVars,
      templateCss:     '', // reserved for per-template overrides in later D-PRs
      company:         company,
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
  })
);
