#!/usr/bin/env node
/*
 * One-shot cleanup (2026-09-17, inline-CSS dedup phase 2 slice 2): three
 * "injected" <style> blocks — "nav-logo text color", "nav-logo layout",
 * "nav-wordmark guard (consistency audit 2026-07-15)" — carry CSS scoped to
 * `.nav-logo-text` (and its `.brand`/`.sub` children). That markup does not
 * exist anywhere in the shared nav-standard partial (site-src/partials/
 * nav-standard.html renders a bare <img> inside .nav-logo, no wrapping
 * <span class="nav-logo-text">) — confirmed by a repo-wide grep for
 * class="nav-logo-text", which matches only 8 files, all under docs/pro/ or
 * docs/sites/free-guide/ (a different product/tenant, out of scope). So
 * every `.nav-logo-text`-scoped declaration in these 3 blocks is dead code
 * on all ~220 population-A marketing pages, not merely duplicated.
 *
 * NOT a blind block delete: each of the 3 blocks also carries 1-2 LIVE
 * declarations scoped to plain `.nav-logo` (no `-text`) — real markup that
 * IS on the page. Some of the same pages also carry their own hand-authored
 * `.nav-logo`/`.nav-logo img` rules elsewhere (e.g. docs/our-work.html's own
 * "/* NAV *​/" section), with DIFFERENT pixel values and no !important —
 * competing definitions the injected block's higher-specificity/!important
 * rules currently win over. Consolidating THAT overlap is a separate,
 * harder problem (which definition should "win" is a judgment call, not a
 * mechanical one) and is deliberately NOT attempted here. This script only
 * removes provably-dead declarations; every live declaration, on every
 * page, is left byte-for-byte exactly where it was.
 *
 * Default run is a dry-run report (no writes, exit 0); --write applies the
 * exact byte-match transforms below (all 3 target blocks are 100%
 * byte-identical wherever they appear — verified against the population A
 * census, zero variants — so this uses the same byte-exact-match discipline
 * as ensure-nav-css.js's migration, no fuzzy matching).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');
const WRITE = process.argv.includes('--write');
const EXCLUDED_TOP = new Set(['admin', 'pro', 'assets', 'deploy', 'tools']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === ROOT && EXCLUDED_TOP.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

// docs/sites/free-guide is its own design system (real .nav-logo-text
// markup lives there) — walk() already covers docs/sites/**, so exclude it
// explicitly the same way the census did.
function inScope(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join('/');
  return !rel.startsWith('sites/free-guide/');
}

// Each transform: the exact legacy block (byte-for-byte, LF), and its
// replacement (dead declarations removed, live ones untouched, same
// position). Matched with the file's own EOL substituted in, mirroring
// ensure-nav-css.js's exactBlockRegex approach.
const TRANSFORMS = [
  {
    name: 'nav-logo text color',
    from: `<style>
/* nav-logo text color (injected) */
nav .nav-logo-text .brand{color:#fff!important}
nav .nav-logo-text .sub{color:rgba(255,255,255,.6)!important}
nav .nav-logo{text-decoration:none}
</style>`,
    to: `<style>
nav .nav-logo{text-decoration:none}
</style>`,
  },
  {
    name: 'nav-logo layout',
    from: `<style>
/* nav-logo layout (injected) */
nav .nav-logo{display:flex!important;align-items:center!important;gap:10px!important;text-decoration:none!important;flex-shrink:0}
nav .nav-logo img{height:60px;width:auto;border-radius:6px;flex-shrink:0}
nav .nav-logo-text{display:flex;flex-direction:column;line-height:1.15}
</style>`,
    to: `<style>
nav .nav-logo{display:flex!important;align-items:center!important;gap:10px!important;text-decoration:none!important;flex-shrink:0}
nav .nav-logo img{height:60px;width:auto;border-radius:6px;flex-shrink:0}
</style>`,
  },
  {
    name: 'nav-wordmark guard',
    from: `<style>
/* nav-wordmark guard (consistency audit 2026-07-15): keep the wordmark on one
   line and shrink logo+text on phones — the blog family had no mobile rules,
   so "NO BIG DEAL" wrapped to two lines next to the logo. */
nav .nav-logo-text .brand{white-space:nowrap}
nav .nav-logo-text .sub{white-space:nowrap}
@media(max-width:768px){
  nav .nav-logo img{height:50px!important}
  nav .nav-logo-text .brand{font-size:.9rem!important}
  nav .nav-logo-text .sub{font-size:.62rem!important}
}
</style>`,
    to: `<style>
/* shrink the logo on phones (consistency audit 2026-07-15) */
@media(max-width:768px){
  nav .nav-logo img{height:50px!important}
}
</style>`,
  },
];

let filesChanged = 0;
const perTransform = TRANSFORMS.map(() => 0);
const mismatches = [];

for (const file of walk(ROOT)) {
  if (!inScope(file)) continue;
  const orig = fs.readFileSync(file, 'utf8');
  if (!orig.includes('nav-logo')) continue;
  const eol = orig.includes('\r\n') ? '\r\n' : '\n';
  let next = orig;
  let touched = false;

  TRANSFORMS.forEach((t, i) => {
    const from = eol === '\n' ? t.from : t.from.split('\n').join(eol);
    const to = eol === '\n' ? t.to : t.to.split('\n').join(eol);
    if (next.includes(from)) {
      next = next.split(from).join(to);
      perTransform[i]++;
      touched = true;
    }
  });

  // Confirm each transform that looked applicable actually landed: the
  // page had the marker comment (so it was a transform candidate) but the
  // byte-exact `from` block never matched (a variant, or drift not caught
  // by the population-A census). Deliberately NOT a blanket "any
  // nav-logo-text left" check — the typography-normalize block and some
  // pages' own hand-authored base styles reference .nav-logo-text too
  // (dead there as well, but out of scope for this slice; see file header).
  const MARKER_RE = [
    /\/\* nav-logo text color \(injected\) \*\//,
    /\/\* nav-logo layout \(injected\) \*\//,
    /\/\* nav-wordmark guard \(consistency audit 2026-07-15\)/,
  ];
  MARKER_RE.forEach((re, i) => {
    if (re.test(orig) && re.test(next)) {
      mismatches.push(path.relative(ROOT, file) + ' [' + TRANSFORMS[i].name + ']');
    }
  });

  if (touched) {
    filesChanged++;
    if (WRITE) fs.writeFileSync(file, next);
  }
}

console.log(JSON.stringify({
  mode: WRITE ? 'write' : 'dry-run',
  filesChanged,
  perTransform: TRANSFORMS.map((t, i) => [t.name, perTransform[i]]),
  residualNavLogoText: mismatches,
}, null, 2));

if (mismatches.length) process.exitCode = 1;
