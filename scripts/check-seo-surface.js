#!/usr/bin/env node
/**
 * scripts/check-seo-surface.js — the whole public surface, on the same
 * criteria a paid one-page audit uses.
 * ═══════════════════════════════════════════════════════════════
 *
 * WHY THIS EXISTS (2026-09-04)
 *
 * An agency ran an automated SEO audit on nobigdealwithjoedeal.com and sold
 * it as "a full, third-party audit". It graded exactly ONE url — the
 * homepage — out of 242 public pages, then priced the remediation. Several
 * of its findings were already false on the page it did scan: it recommended
 * "Add FAQ / Q&A Content" to a page carrying FAQPage JSON-LD with six
 * questions, and "Add Business Address and Phone Number" to a page that
 * states the phone nineteen times and twice in schema.
 *
 * The lesson is not that the tool was bad. It is that nobody here could
 * answer "is that true of the other 241 pages?" without checking by hand.
 * This script answers it, deterministically, for free, on every page.
 *
 * WHAT IT CHECKS
 *
 * Only things that are mechanically decidable from the shipped HTML. It does
 * NOT score, rank, or guess at keyword strategy — a number like "93/100" is
 * a vendor's opinion dressed as a measurement, and reproducing that here
 * would be inventing authority we do not have.
 *
 *   ERROR — objectively broken, blocks CI
 *     missing/empty <title>; missing meta description; zero or multiple <h1>;
 *     missing canonical; malformed JSON-LD (unparseable); missing lang;
 *     missing viewport; an <img> with no alt attribute at all.
 *
 *   WARN — a real weakness, reported but does not block
 *     title outside 50-60 chars; description outside 120-160; no JSON-LD;
 *     no Open Graph title/description/image; empty alt on a non-decorative
 *     image; a raster hero with no WebP sibling; no freshness signal on a
 *     page type that should carry one.
 *
 * Excludes docs/pro/ (the CRM — private, noindex, not a search surface) and
 * generator-owned fragments.
 *
 * USAGE
 *   node scripts/check-seo-surface.js            # human report, exit 1 on ERROR
 *   node scripts/check-seo-surface.js --quiet    # summary + errors only
 *   node scripts/check-seo-surface.js --json     # machine-readable
 *   node scripts/check-seo-surface.js --warn-as-error   # strict
 *
 * The exit code is computed ONCE at the end, from the collected findings,
 * and every output mode falls through to it — the --json branch does not get
 * its own early return. That exact shape (a --json path returning before the
 * verdict) is why crm-audit.js silently exited 0 for its whole life.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const QUIET = args.includes('--quiet');
const JSON_OUT = args.includes('--json');
const WARN_AS_ERROR = args.includes('--warn-as-error');

// --root lets the suite point this at a fixture tree. Without it there is no
// way to prove the gate can go red except by damaging the real site, which
// means in practice nobody proves it — and an unproven gate is how this repo
// shipped a check that exited 0 for its entire life.
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag >= 0 && args[rootFlag + 1]
  ? path.resolve(args[rootFlag + 1])
  : path.join(__dirname, '..');
const DOCS = rootFlag >= 0 ? ROOT : path.join(ROOT, 'docs');

// ── Page discovery ──────────────────────────────────────────────────────
// docs/ IS the hosting root, so what is on disk is what ships. docs/pro is
// the CRM: private, behind auth, deliberately not a search surface.
const SKIP_DIRS = new Set(['pro', 'sites', 'admin', 'tools', 'dev']);

// A page that declares `noindex` is not a search surface, so search criteria
// do not apply to it. This is a rule rather than a filename list on purpose:
// a list is where a real finding goes to hide, and it needs hand-maintenance
// every time a page is added. The page must SAY it is not indexed — which
// means the exemption is visible in the page itself, and a page that wants
// out of this audit has to actually tell Google the same thing.
function isNoIndex(html) {
  const tag = (html.match(/<meta\b[^>]*name\s*=\s*["']robots["'][^>]*>/i) || [])[0];
  return !!tag && /noindex/i.test(tag);
}

// Google Search Console verification stubs are a fixed payload Google
// specifies byte-for-byte. Adding a title or viewport would break
// verification, so they are exempt by shape rather than by name.
const RX_VERIFICATION_STUB = /^docs\/google[0-9a-f]{16}\.html$/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (dir === DOCS && SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

// ── Tiny, dependency-free HTML probes ───────────────────────────────────
// Deliberately regex, not a DOM parser: this repo ships hand-authored HTML
// with a strict CSP and no build step, and adding a parser dependency to a
// pre-push gate is a cost the gate does not earn.
const rxTitle = /<title[^>]*>([\s\S]*?)<\/title>/i;
// `<h1>` or `<h1 ...>` — and NOT <h1x. Written as an optional whitespace-led
// attribute group because the obvious `[\b]` spelling is a character class
// containing BACKSPACE, not a word boundary: it silently matched nothing and
// reported "no <h1>" on pages that plainly have one. Caught by fixture F2.
const rxH1 = /<h1(?:\s[^>]*)?>[\s\S]*?<\/h1>/gi;
const rxLdJson = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const rxImg = /<img\b[^>]*>/gi;
const rxLinkStylesheet = /<link\b[^>]*>/gi;

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i'))
    || tag.match(new RegExp(name + "\\s*=\\s*'([^']*)'", 'i'));
  return m ? m[1] : null;
}

function metaContent(html, nameOrProp, value) {
  const re = new RegExp(
    '<meta\\b[^>]*' + nameOrProp + '\\s*=\\s*["\']' + value + '["\'][^>]*>',
    'i',
  );
  const tag = (html.match(re) || [])[0];
  return tag ? attr(tag, 'content') : null;
}

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

// Length checks must count what a SEARCHER sees, not what the file stores.
// A description written with an apostrophe carries `&#39;` — five bytes for
// one rendered character — so measuring the raw attribute over-counts by four
// per entity and invents truncation warnings for descriptions that are
// comfortably in range. Six of this gate's first nine "too long" findings
// were this bug, not real. (Fixture F19.)
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”',
};
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (NAMED_ENTITIES[n.toLowerCase()] !== undefined
      ? NAMED_ENTITIES[n.toLowerCase()] : m));
}

// ── The audit ───────────────────────────────────────────────────────────
const findings = [];
function add(level, file, check, detail) {
  findings.push({ level, file, check, detail });
}

let skippedNoIndex = 0;
const pages = walk(DOCS).sort().filter((abs) => {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  if (RX_VERIFICATION_STUB.test(rel)) return false;
  if (isNoIndex(fs.readFileSync(abs, 'utf8'))) { skippedNoIndex++; return false; }
  return true;
});

// Hero-format findings are collected per IMAGE, not per page: the site logo
// is eager on all 227 pages, and reporting it 227 times buries everything
// else. Only images big enough to matter at LCP are worth a warning at all —
// a 3.6 KB badge converted to WebP saves nothing anyone can measure.
const HERO_MIN_BYTES = 30 * 1024;
const heroRasters = new Map(); // src -> { bytes, pages:Set }
const misnamedImages = new Map(); // src -> { real, pages:Set }

// Read the actual encoded format from the file's magic bytes rather than
// trusting the extension. docs/assets/gaf-pivot-boot/pivot-boot-hero.jpg is
// a real WebP carrying a .jpg name — an extension-only check calls that an
// unoptimised hero and demands a conversion that would make it BIGGER. It is
// also the exact mistake the vendor audit made in the other direction, so
// this gate should not repeat it.
function sniffImageFormat(abs) {
  let fd;
  try {
    fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(12);
    fs.readSync(fd, buf, 0, 12, 0);
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'webp';
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (buf.slice(0, 6).toString('ascii').startsWith('GIF8')) return 'gif';
    return 'unknown';
  } catch (e) {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* ignore */ }
  }
}

for (const abs of pages) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
  const raw = fs.readFileSync(abs, 'utf8');
  const html = stripComments(raw);

  // -- title ------------------------------------------------------------
  const titleRaw = (html.match(rxTitle) || [])[1];
  const title = titleRaw ? decodeEntities(titleRaw).replace(/\s+/g, ' ').trim() : '';
  // The 50-60 band audit tools score against is Google's SERP pixel-width
  // guidance, not a rule — and 148 pages here sit outside it while reading
  // perfectly well in a result. Warn only where it actually costs something:
  // a title long enough to be truncated mid-phrase, or short enough to be
  // carrying no information. Anything between is the author's call.
  if (!title) add('ERROR', rel, 'title', 'no <title> tag, or it is empty');
  else if (title.length > 65) {
    add('WARN', rel, 'title-length', `${title.length} chars — will truncate in results: "${title}"`);
  } else if (title.length < 25) {
    add('WARN', rel, 'title-length', `${title.length} chars — too thin to rank: "${title}"`);
  }

  // -- meta description --------------------------------------------------
  const descRaw = metaContent(html, 'name', 'description');
  const desc = descRaw === null ? null : decodeEntities(descRaw);
  if (!desc || !desc.trim()) add('ERROR', rel, 'meta-description', 'missing meta description');
  else if (desc.length < 120 || desc.length > 160) {
    add('WARN', rel, 'meta-description-length', `${desc.length} chars (want 120-160)`);
  }

  // -- h1 ----------------------------------------------------------------
  const h1s = html.match(rxH1) || [];
  if (h1s.length === 0) add('ERROR', rel, 'h1', 'no <h1> on the page');
  else if (h1s.length > 1) add('ERROR', rel, 'h1', `${h1s.length} <h1> tags (want exactly 1)`);

  // -- canonical ---------------------------------------------------------
  const links = html.match(rxLinkStylesheet) || [];
  const canonical = links.find((l) => /rel\s*=\s*["']canonical["']/i.test(l));
  if (!canonical) add('ERROR', rel, 'canonical', 'no rel=canonical');
  else if (!attr(canonical, 'href')) add('ERROR', rel, 'canonical', 'rel=canonical has no href');

  // -- lang + viewport ---------------------------------------------------
  if (!/<html\b[^>]*\blang\s*=/i.test(html)) add('ERROR', rel, 'lang', '<html> has no lang attribute');
  if (!metaContent(html, 'name', 'viewport')) add('ERROR', rel, 'viewport', 'no viewport meta');

  // -- structured data ---------------------------------------------------
  // Parse every block. An unparseable block is an ERROR: search engines and
  // LLMs silently discard it, so a typo here is invisible damage — exactly
  // the failure mode this whole file exists to catch.
  const blocks = [...html.matchAll(rxLdJson)].map((m) => m[1]);
  if (blocks.length === 0) {
    add('WARN', rel, 'structured-data', 'no JSON-LD on the page');
  } else {
    blocks.forEach((b, i) => {
      try {
        JSON.parse(b);
      } catch (e) {
        add('ERROR', rel, 'structured-data', `JSON-LD block ${i + 1} does not parse: ${e.message}`);
      }
    });
  }

  // -- Open Graph --------------------------------------------------------
  for (const p of ['og:title', 'og:description', 'og:image']) {
    if (!metaContent(html, 'property', p)) add('WARN', rel, 'open-graph', `missing ${p}`);
  }

  // -- images ------------------------------------------------------------
  const imgs = html.match(rxImg) || [];
  imgs.forEach((tag) => {
    const src = attr(tag, 'src') || attr(tag, 'data-src') || '(no src)';
    if (!/\balt\s*=/i.test(tag)) {
      add('ERROR', rel, 'img-alt', `<img> with no alt attribute: ${src}`);
    }
  });

  // -- hero raster with no WebP sibling ----------------------------------
  // Only eager (non-lazy) images matter here: those are the render-path
  // candidates. A lazy below-the-fold JPG costs nothing at LCP.
  imgs.forEach((tag) => {
    if (/loading\s*=\s*["']lazy["']/i.test(tag)) return;
    const src = attr(tag, 'src');
    if (!src || !/^\/.*\.(jpe?g|png)$/i.test(src)) return;
    const abs = path.join(DOCS, src.replace(/^\//, ''));
    let bytes = 0;
    try { bytes = fs.statSync(abs).size; } catch (e) { return; }

    // Already a modern format wearing the wrong extension: nothing to
    // convert, but the name is a trap for the next person (and for Hosting's
    // Content-Type, which is set from the extension).
    const real = sniffImageFormat(abs);
    if (real === 'webp') {
      if (!misnamedImages.has(src)) misnamedImages.set(src, { real, pages: new Set() });
      misnamedImages.get(src).pages.add(rel);
      return;
    }

    const webp = src.replace(/\.(jpe?g|png)$/i, '.webp');
    if (fs.existsSync(path.join(DOCS, webp.replace(/^\//, '')))) return;
    if (bytes < HERO_MIN_BYTES) return;
    if (!heroRasters.has(src)) heroRasters.set(src, { bytes, pages: new Set() });
    heroRasters.get(src).pages.add(rel);
  });
}

// Extension lies about the real encoding. Firebase Hosting sets Content-Type
// from the extension, so this ships WebP bytes labelled image/jpeg.
for (const [src, info] of misnamedImages) {
  const n = info.pages.size;
  add('WARN', [...info.pages][0], 'image-extension',
    `${src} is really ${info.real.toUpperCase()} — served with the wrong Content-Type`
    + (n > 1 ? ` (on ${n} pages)` : ''));
}

// One finding per oversized image, naming how many pages carry it.
for (const [src, info] of [...heroRasters.entries()].sort((a, b) => b[1].bytes - a[1].bytes)) {
  const n = info.pages.size;
  add('WARN', [...info.pages][0], 'hero-format',
    `eager ${Math.round(info.bytes / 1024)} KB raster with no .webp sibling: ${src}`
    + (n > 1 ? ` (on ${n} pages)` : ''));
}

// ── Report ──────────────────────────────────────────────────────────────
const errors = findings.filter((f) => f.level === 'ERROR');
const warns = findings.filter((f) => f.level === 'WARN');

// Verdict computed once, before any output branch, so no output mode can
// return past it.
const failed = errors.length > 0 || (WARN_AS_ERROR && warns.length > 0);

if (JSON_OUT) {
  console.log(JSON.stringify({
    pages: pages.length,
    errors: errors.length,
    warnings: warns.length,
    failed,
    findings,
  }, null, 2));
} else {
  const byCheck = {};
  for (const f of findings) {
    const k = `${f.level}:${f.check}`;
    byCheck[k] = (byCheck[k] || 0) + 1;
  }

  console.log(`seo-surface: ${pages.length} public pages audited`
    + (skippedNoIndex ? ` (${skippedNoIndex} skipped — declared noindex)` : ''));
  console.log('─'.repeat(64));

  if (!QUIET) {
    for (const f of errors) console.log(`  ERROR  ${f.file} — ${f.check}: ${f.detail}`);
    if (errors.length && warns.length) console.log('');
    for (const f of warns) console.log(`  warn   ${f.file} — ${f.check}: ${f.detail}`);
    if (findings.length) console.log('');
  } else {
    for (const f of errors) console.log(`  ERROR  ${f.file} — ${f.check}: ${f.detail}`);
    if (errors.length) console.log('');
  }

  console.log('Summary by check:');
  for (const k of Object.keys(byCheck).sort()) console.log(`  ${String(byCheck[k]).padStart(5)}  ${k}`);
  console.log('');
  console.log(`${errors.length} error(s), ${warns.length} warning(s) across ${pages.length} pages`);
}

// A page count of zero means the walk found nothing — a broken invocation,
// not a clean site. Reporting success over an audit of nothing is the second
// way crm-audit.js used to pass.
if (pages.length === 0) {
  console.error('seo-surface: matched ZERO pages — refusing to report success over an empty audit.');
  process.exit(2);
}

process.exit(failed ? 1 : 0);
