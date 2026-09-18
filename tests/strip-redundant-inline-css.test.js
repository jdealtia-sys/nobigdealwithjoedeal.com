/**
 * tests/strip-redundant-inline-css.test.js — inline-CSS dedup slice 3a.
 *
 * scripts/strip-redundant-inline-css.js removed three per-page <style> blocks
 * whose declarations a shared stylesheet already supplies with the same
 * value: "trust-icon fix" (nbd-icons.css, linked after), the a11y focus ring
 * + reduced-motion block (nbd-mobile.css, linked before, nothing competing in
 * between) and "nav-collapse normalize" (nbd-nav-base.css, the last
 * stylesheet in <head>). Whether a copy is redundant depends on WHERE the
 * shared sheet links, so the script checks that per page and skips a page
 * that fails.
 *
 * This suite pins:
 *   1. the transform itself — CRLF and LF needles, exactly one trailing EOL
 *      removed, every precondition skipping when it fails, idempotence;
 *   2. the docs/ tree — no strippable copy remains (a re-introduced block is
 *      caught here), no page is skipped, and the only residual marker is
 *      docs/index.html's deliberate trust-icon variant;
 *   3. the CLI — dry run writes nothing, --write applies, a second run is a
 *      no-op, docs/pro and docs/sites are out of scope, a skip exits 1;
 *   4. scripts/fix-trust-icons.js — it must not re-stamp its stale block on a
 *      page that links nbd-icons.css (it would land after the link and win).
 *
 * Zero deps. Run: node tests/strip-redundant-inline-css.test.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'strip-redundant-inline-css.js');
const FIX_TRUST = path.join(REPO, 'scripts', 'fix-trust-icons.js');
const { stripPage, run } = require(SCRIPT);

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

// The blocks exactly as they sat on the live pages (LF). Written out here
// rather than imported from the script so a typo in the script's variant list
// cannot also be the test's expectation.
const TRUST = '<style>\n/* trust-icon fix */\n.trust-icon svg.ico{color:#fff}\n.aci-icon svg.ico,.form-success-icon svg.ico{color:var(--orange,#bd5728)}\n</style>';
const A11Y = '<style>/* a11y (audit 2026-07): visible focus ring + reduced-motion */:focus-visible{outline:3px solid #bd5728;outline-offset:2px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}}</style>';
const A11Y_SHORT = A11Y.replace('/* a11y (audit 2026-07): ', '/* a11y: ');
const NAV = '<style>/* nav-collapse normalize (visual audit 2026-07-19): hamburger threshold is 1024px site-wide */@media(max-width:1024px){.nav-links{display:none!important}.hamburger{display:flex!important}}</style>';
const NAV_SHORT = NAV.replace(' (visual audit 2026-07-19)', '');
const IOS_ZOOM = '<style>/* iOS-zoom fix (conversion audit): 16px inputs prevent Safari auto-zoom on focus */@media(max-width:600px){input,select,textarea{font-size:16px!important}}</style>';
const SKIP_LINK = '<style>.nbd-skip{position:absolute;left:-9999px;top:0;z-index:100000;background:#BD5728;color:#fff;padding:10px 16px;font-weight:700;text-decoration:none;border-radius:0 0 6px 0}.nbd-skip:focus{left:0}</style>';
const link = (href) => '<link rel="stylesheet" href="' + href + '">';
const ICONS = link('/assets/css/nbd-icons.css');
const MOBILE = link('/assets/css/nbd-mobile.css');
const MOBILE_CTA = link('/assets/css/mobile-cta.css');
const NAV_BASE = link('/assets/css/nbd-nav-base.css');

// A page whose <head> is `lines`, one per line, in the requested EOL.
function page(lines, eol = '\r\n') {
  const lf = ['<!DOCTYPE html>', '<html lang="en">', '<head>', '<meta charset="UTF-8">', ...lines, '</head>',
    '<body><div class="trust-icon"><svg class="ico" viewBox="0 0 24 24"></svg></div></body>', '</html>', ''].join('\n');
  return eol === '\n' ? lf : lf.split('\n').join(eol);
}
const loneCr = (s) => /\r(?!\n)/.test(s);

// ── 1. transform ────────────────────────────────────────────────────
console.log('\n1. transform');
for (const eol of ['\r\n', '\n']) {
  const tag = eol === '\n' ? 'LF' : 'CRLF';
  // A blank line after the block proves exactly ONE trailing EOL goes.
  const before = page(['<style>body{margin:0}</style>', TRUST, '', ICONS], eol);
  const want = page(['<style>body{margin:0}</style>', '', ICONS], eol);
  const r = stripPage(before);
  ok(tag + ': trust-icon block before nbd-icons.css is removed with exactly one EOL', r.html === want,
    JSON.stringify(r.html.slice(0, 160)));
  ok(tag + ': removal is reported, nothing skipped, no residual marker',
    r.removed.length === 1 && r.skipped.length === 0 && r.residual.length === 0);
  ok(tag + ': output has no lone CR', !loneCr(r.html));
  const again = stripPage(r.html);
  ok(tag + ': second pass is a no-op', again.html === r.html && again.removed.length === 0);
}
{
  const before = page([ICONS, TRUST]);
  const r = stripPage(before);
  ok('trust-icon block AFTER nbd-icons.css is skipped (it would be the one that wins)',
    r.html === before && r.skipped.length === 1 && /nbd-icons\.css/.test(r.skipped[0].reason) && r.residual.length === 1);
}
{
  const before = page([TRUST]);
  const r = stripPage(before);
  ok('trust-icon block with no nbd-icons.css link is skipped', r.html === before && r.skipped.length === 1);
}
{
  const before = page(['<style>a{}</style>' + TRUST, ICONS]);
  const r = stripPage(before);
  ok('block that shares its line with other markup is skipped, not spliced', r.html === before && r.skipped.length === 1);
}
{
  const before = page([TRUST.replace('#bd5728', '#e8720c'), ICONS]);
  const r = stripPage(before);
  ok('an unlisted variant is not matched, and is reported as a residual marker',
    r.html === before && r.removed.length === 0 && r.residual.length === 1 && r.residual[0].target === 'trust-icon fix');
}
for (const [label, block] of [['canonical', A11Y], ['short-comment', A11Y_SHORT]]) {
  const before = page([MOBILE, MOBILE_CTA, IOS_ZOOM, SKIP_LINK, block, '<style>.x{}</style>']);
  const want = page([MOBILE, MOBILE_CTA, IOS_ZOOM, SKIP_LINK, '<style>.x{}</style>']);
  const r = stripPage(before);
  ok('a11y (' + label + '): removed when only mobile-cta / iOS-zoom / .nbd-skip sit between it and nbd-mobile.css',
    r.html === want && r.removed.length === 1);
}
{
  // Everything between nbd-mobile.css and the block would start winning once
  // the block is gone — a competing rule there must stop the strip.
  const before = page([MOBILE, '<style>:focus-visible{outline:none}</style>', A11Y]);
  const r = stripPage(before);
  ok('a11y: skipped when a competing rule sits between nbd-mobile.css and the block',
    r.html === before && r.skipped.length === 1 && /between/.test(r.skipped[0].reason));
}
{
  const before = page([A11Y, MOBILE]);
  const r = stripPage(before);
  ok('a11y: skipped when nbd-mobile.css links AFTER the block', r.html === before && r.skipped.length === 1);
}
for (const [label, block] of [['canonical', NAV], ['short-comment', NAV_SHORT]]) {
  const before = page(['<style>.nav-links{display:flex}</style>', block, ICONS, NAV_BASE]);
  const want = page(['<style>.nav-links{display:flex}</style>', ICONS, NAV_BASE]);
  const r = stripPage(before);
  ok('nav-collapse (' + label + '): removed when nbd-nav-base.css is the last stylesheet in <head>',
    r.html === want && r.removed.length === 1);
}
{
  const before = page([NAV, NAV_BASE, '<style>.nav-links{display:flex}</style>']);
  const r = stripPage(before);
  ok('nav-collapse: skipped when a stylesheet follows nbd-nav-base.css (the !important copy is still load-bearing)',
    r.html === before && r.skipped.length === 1 && /last stylesheet/.test(r.skipped[0].reason));
}
{
  const before = page([NAV_BASE, NAV]);
  const r = stripPage(before);
  ok('nav-collapse: skipped when nbd-nav-base.css links BEFORE the block', r.html === before && r.skipped.length === 1);
}
{
  const before = page([MOBILE, MOBILE_CTA, IOS_ZOOM, SKIP_LINK, A11Y, TRUST, NAV, ICONS, NAV_BASE]);
  const want = page([MOBILE, MOBILE_CTA, IOS_ZOOM, SKIP_LINK, ICONS, NAV_BASE]);
  const r = stripPage(before);
  ok('all three on one page: each removed, iOS-zoom (a live rule) left alone', r.html === want && r.removed.length === 3,
    JSON.stringify(r.skipped));
}

// ── 2. the docs/ tree ───────────────────────────────────────────────
console.log('\n2. docs/ tree');
{
  const report = run({ write: false });
  ok('no strippable copy left anywhere in scope (re-run the script if this fails)', report.filesChanged === 0,
    JSON.stringify(report.perVariant));
  ok('no page fails a precondition', report.skipped.length === 0, report.skipped.slice(0, 3).join(' | '));
  ok('no unlisted variant carries a targeted marker', report.unexpectedResidual.length === 0,
    report.unexpectedResidual.slice(0, 3).join(' | '));
  ok('the only residual marker is docs/index.html\'s deliberate trust-icon variant',
    report.expectedResidual.length === 1 && /^index\.html:\d+ \[trust-icon fix\]$/.test(report.expectedResidual[0]),
    JSON.stringify(report.expectedResidual));
}

// ── 3. CLI on a scratch tree ────────────────────────────────────────
console.log('\n3. CLI');
function scratchTree(files, scripts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strip-css-'));
  fs.mkdirSync(path.join(dir, 'scripts'));
  for (const s of scripts) fs.copyFileSync(s, path.join(dir, 'scripts', path.basename(s)));
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(dir, 'docs', rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  return dir;
}
const readDocs = (dir, rel) => fs.readFileSync(path.join(dir, 'docs', rel), 'utf8');
function cli(dir, script, args = []) {
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts', script), ...args], { encoding: 'utf8' });
  let report = null; try { report = JSON.parse(r.stdout); } catch { /* not JSON */ }
  return { code: r.status, report, out: r.stdout + r.stderr };
}
{
  const live = page([TRUST, ICONS]);
  const dir = scratchTree({ 'a.html': live, 'pro/blog/x.html': live, 'sites/y.html': live }, [SCRIPT]);
  try {
    const dry = cli(dir, 'strip-redundant-inline-css.js');
    ok('dry run: exit 0, reports the change, writes nothing',
      dry.code === 0 && dry.report && dry.report.filesChanged === 1 && readDocs(dir, 'a.html') === live, dry.out.slice(0, 200));
    const w = cli(dir, 'strip-redundant-inline-css.js', ['--write']);
    ok('--write: strips the in-scope page', w.code === 0 && readDocs(dir, 'a.html') === page([ICONS]), w.out.slice(0, 200));
    ok('--write: docs/pro and docs/sites are out of scope and untouched',
      readDocs(dir, 'pro/blog/x.html') === live && readDocs(dir, 'sites/y.html') === live);
    const again = cli(dir, 'strip-redundant-inline-css.js', ['--write']);
    ok('second --write run matches nothing', again.code === 0 && again.report && again.report.filesChanged === 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
{
  const bad = page([ICONS, TRUST]);
  const dir = scratchTree({ 'b.html': bad }, [SCRIPT]);
  try {
    const w = cli(dir, 'strip-redundant-inline-css.js', ['--write']);
    ok('a skipped page exits 1, is listed, and is left byte-identical',
      w.code === 1 && w.report && w.report.skipped.length === 1 && /^b\.html:/.test(w.report.skipped[0]) && readDocs(dir, 'b.html') === bad,
      w.out.slice(0, 200));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ── 4. fix-trust-icons.js cannot undo the strip ─────────────────────
console.log('\n4. fix-trust-icons.js guard');
{
  const linked = page([ICONS]);
  const unlinked = page(['<style>.x{}</style>']);
  const dir = scratchTree({ 'linked.html': linked, 'unlinked.html': unlinked }, [FIX_TRUST]);
  try {
    const r = cli(dir, 'fix-trust-icons.js');
    ok('a page linking nbd-icons.css is not re-stamped with the stale trust-icon block',
      readDocs(dir, 'linked.html') === linked, readDocs(dir, 'linked.html').slice(-300));
    // Control: the harness really runs the generator — an unlinked page still
    // gets its block, so the check above is not passing vacuously.
    ok('control: a page WITHOUT nbd-icons.css still gets the block injected',
      /trust-icon fix/.test(readDocs(dir, 'unlinked.html')) && r.report && r.report.touched === 1, r.out.slice(0, 200));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// ── 5. the shared sheets still say what the stripped copies said ────
// After the strip these rules have ONE source on those pages. Parsed, not
// substring-matched: reformatting must not redden this, and a later rule in
// the same sheet overriding the value must (last declaration wins).
console.log('\n5. shared sheets');
function effective(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const map = new Map();
  const norm = (s) => s.trim().replace(/\s+/g, ' ').replace(/\s*!\s*important/i, '!important').toLowerCase();
  let i = 0;
  (function block(media) {
    while (i < css.length) {
      const open = css.indexOf('{', i), close = css.indexOf('}', i);
      if (close !== -1 && (open === -1 || close < open)) { i = close + 1; return; }
      if (open === -1) { i = css.length; return; }
      const prelude = css.slice(i, open).trim();
      i = open + 1;
      if (prelude.startsWith('@')) { block(prelude.replace(/\s+/g, '')); continue; }
      const end = css.indexOf('}', i);
      const body = css.slice(i, end);
      i = end + 1;
      for (const sel of prelude.split(',')) {
        for (const decl of body.split(';')) {
          const c = decl.indexOf(':');
          if (c < 0) continue;
          map.set([media || '', sel.trim().replace(/\s+/g, ' '), decl.slice(0, c).trim().toLowerCase()].join(' | '), norm(decl.slice(c + 1)));
        }
      }
    }
  })(null);
  return map;
}
const sheet = (n) => effective(fs.readFileSync(path.join(REPO, 'docs', 'assets', 'css', n), 'utf8'));
{
  const icons = sheet('nbd-icons.css');
  ok('nbd-icons.css: .trust-icon svg.ico is #fff (the stripped trust-icon copy)', icons.get(' | .trust-icon svg.ico | color') === '#fff');
  ok('nbd-icons.css: .aci-icon / .form-success-icon svg.ico are var(--orange,#bd5728)',
    ['.aci-icon svg.ico', '.form-success-icon svg.ico'].every((s) => icons.get(' | ' + s + ' | color') === 'var(--orange,#bd5728)'));
  const mobile = sheet('nbd-mobile.css');
  ok('nbd-mobile.css: :focus-visible is 3px solid #bd5728, offset 2px (the stripped a11y copy)',
    mobile.get(' | :focus-visible | outline') === '3px solid #bd5728' && mobile.get(' | :focus-visible | outline-offset') === '2px');
  const RM = '@media(prefers-reduced-motion:reduce)';
  ok('nbd-mobile.css: reduced-motion kill switch matches the stripped a11y copy on *, ::before, ::after',
    ['*', '*::before', '*::after'].every((s) => mobile.get(RM + ' | ' + s + ' | animation-duration') === '.001ms!important'
      && mobile.get(RM + ' | ' + s + ' | animation-iteration-count') === '1!important'
      && mobile.get(RM + ' | ' + s + ' | transition-duration') === '.001ms!important'
      && mobile.get(RM + ' | ' + s + ' | scroll-behavior') === 'auto!important'));
  const nav = sheet('nbd-nav-base.css');
  ok('nbd-nav-base.css: <=1024px hides .nav-links and shows .hamburger (the stripped nav-collapse copy)',
    nav.get('@media(max-width:1024px) | .nav-links | display') === 'none' && nav.get('@media(max-width:1024px) | .hamburger | display') === 'flex');
}

console.log('\n──────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
process.exit(0);
