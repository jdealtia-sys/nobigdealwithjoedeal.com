#!/usr/bin/env node
/**
 * Generates docs/sitemap.xml from the filesystem + curated rules.
 *
 * SAFE BY DEFAULT: running with no flags is a DRY-RUN. It prints a unified
 * diff against the current docs/sitemap.xml and writes NOTHING. Pass --write
 * to actually replace the file (atomic write: temp file + rename).
 *
 * lastmod policy: each URL already present in docs/sitemap.xml keeps its
 * current <lastmod>. Only URLs that are NEW to the sitemap get today's date.
 * (The previous generator re-stamped every URL on every run, destroying the
 * change history — that is why this one parses the existing file first.)
 *
 * Regression note (2026-04-17): a previous ad-hoc rebuild used path.join on
 * Windows and leaked backslashes into 11 service URLs. This generator builds
 * URLs with string concatenation + "/" only — never path.join. path.join is
 * used ONLY for local filesystem paths, never for anything that ends up in
 * the XML. A backslash guard aborts before any write.
 *
 * Regression note (2026-06-11): the previous generator (a) overwrote
 * docs/sitemap.xml on ANY invocation, even --help, and (b) silently dropped
 * /inspect, /storm-check, /storm-report, /the-pledge, /free-roof/, the six
 * directory-based service pages, the /areas/ and /blog/ hub entries, and
 * added private /pro URLs (185 URLs vs the live 196). This version derives
 * its rules from the live file: same sections, same URL set, same
 * priorities/changefreqs, and /pro/ stays out (see the comment kept at the
 * bottom of the generated XML).
 *
 * Usage:
 *   node scripts/build-sitemap.js          # dry-run: print diff, write nothing
 *   node scripts/build-sitemap.js --write  # regenerate docs/sitemap.xml
 *
 * Exit codes: 0 = no differences (or written OK); 1 = dry-run found
 * differences (CI-friendly); 2 = bad flags / fatal sanity-check failure.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(DOCS, 'sitemap.xml');
const ORIGIN = 'https://nobigdealwithjoedeal.com';
const TODAY = new Date().toISOString().slice(0, 10);

const USAGE = [
  'Usage:',
  '  node scripts/build-sitemap.js          Dry-run (default): print a unified diff vs docs/sitemap.xml. Writes NOTHING.',
  '  node scripts/build-sitemap.js --write  Regenerate docs/sitemap.xml (atomic temp-file + rename).',
  '',
  'Behavior:',
  '  - Existing URLs keep their current <lastmod>; only NEW URLs get today\'s date.',
  '  - Any other flag (including --help) prints this usage and exits without writing.',
].join('\n');

/* ── Curated rules (derived from the live docs/sitemap.xml) ──────────────── */

// Core pages, in sitemap order: [url path, docs-relative file, priority, changefreq]
const CORE_PAGES = [
  ['',             'index.html',            '1.0',  'weekly'],
  ['the-pledge',   'the-pledge/index.html', '0.95', 'monthly'],
  ['about',        'about.html',            '0.8',  'monthly'],
  ['our-work',     'our-work.html',         '0.8',  'monthly'],
  ['storm-alerts', 'storm-alerts.html',     '0.7',  'monthly'],
  ['visualizer',   'visualizer.html',       '0.7',  'monthly'],
  ['estimate',     'estimate.html',         '0.9',  'weekly'],
  ['inspect',      'inspect.html',          '0.9',  'weekly'],
  ['storm-check',  'storm-check.html',      '0.9',  'weekly'],
  ['storm-report', 'storm-report.html',     '0.9',  'weekly'],
  ['free-roof/',   'free-roof/index.html',  '0.85', 'monthly'],
  ['privacy',      'privacy.html',          '0.6',  'monthly'],
  ['review',       'review.html',           '0.6',  'monthly'],
];

// Index hubs (trailing slash on purpose — these are directory indexes).
const INDEX_HUBS = [
  ['areas/', 'areas/index.html', '0.8', 'monthly'],
  ['blog/',  'blog/index.html',  '0.7', 'weekly'],
];

// Directory-based service pages (docs/services/<slug>/index.html), curated
// order + priority. gaf-timberline lives in its own section near the bottom.
const PREMIUM_DIR_SERVICES = [
  ['the-nbd-guarantee', '0.95'],
  ['the-nbd-build',     '0.90'],
  ['lumanail',          '0.85'],
  ['roofivent',         '0.85'],
  ['gaf-pivot-boot',    '0.85'],
];
const GAF_TIMBERLINE_SERVICE = ['gaf-timberline', '0.85'];

// Blog posts that live outside the main 0.6 blog section.
const PREMIUM_BLOG_POSTS = [
  ['why-i-install-lumanail-on-every-elite-roof', '0.75'],
  ['why-roofivent-is-on-my-roofs',               '0.75'],
  ['the-pipe-boot-fork',                         '0.75'],
  ['field-notes-joes-notebook-goes-public',      '0.70'],
];
const GAF_TIMBERLINE_BLOG = ['why-class-4-impact-shingles', '0.7'];

// The 11 plain service pages (no city suffix). Everything else under
// docs/services/*.html is a service+city combo page.
const PLAIN_SERVICES = new Set([
  'financing',
  'fire-water-smoke-damage',
  'gutter-replacement',
  'hail-damage-insurance-claim',
  'roof-cleaning-soft-wash',
  'roof-inspection',
  'roof-repair',
  'roof-replacement',
  'siding-repair',
  'siding-replacement',
  'storm-damage',
]);

// Combo priority tiers keyed by trailing city slug. Slugs whose service
// prefix isn't a plain service (e.g. hail-damage-*) fall through to 0.65.
const TIER_1_CITIES = new Set([
  'batavia-oh', 'cincinnati-oh', 'loveland-oh', 'mason-oh', 'west-chester-oh',
]);
const TIER_2_CITIES = new Set([
  'anderson-township-oh', 'blue-ash-oh', 'covington-ky', 'erlanger-ky',
  'fairfield-oh', 'florence-ky', 'fort-mitchell-ky', 'lebanon-oh',
]);

// Tier 1 areas get 0.9; everything else in /areas/ gets 0.8.
const TIER_1_AREAS = new Set([
  'cincinnati-oh', 'florence-ky', 'loveland-oh', 'mason-oh', 'west-chester-oh',
]);

// Kept verbatim at the bottom of the generated XML.
const PRO_FOOTNOTE = [
  '  <!-- /pro/ B2B content is intentionally NOT in this sitemap. If contractor SEO needs',
  '       sitemap visibility, host it at /sitemap-pro.xml and reference it separately. Mixing',
  '       homeowner + B2B audiences in one sitemap dilutes topical focus for both. -->',
];

/* ── Filesystem discovery ────────────────────────────────────────────────── */

const listHtml = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir)
        .filter((f) => f.endsWith('.html') && f !== 'index.html' && f !== '404.html' && f !== 'offline.html')
        .filter((f) => fs.statSync(path.join(dir, f)).isFile())
        .map((f) => f.replace(/\.html$/, ''))
        .sort()
    : [];

const listDirServices = () => {
  const base = path.join(DOCS, 'services');
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(base, d.name, 'index.html')))
    .map((d) => d.name)
    .sort();
};

/* ── URL + entry rendering (string concatenation ONLY — see header note) ─── */

const urlFor = (slug) => (slug ? ORIGIN + '/' + slug : ORIGIN + '/');

const comboCityFromSlug = (slug) => {
  // Longest plain-service prefix wins; remainder is the city slug.
  const match = [...PLAIN_SERVICES]
    .sort((a, b) => b.length - a.length)
    .find((svc) => slug.startsWith(svc + '-'));
  return match ? slug.slice(match.length + 1) : null;
};

const comboPriority = (slug) => {
  const city = comboCityFromSlug(slug);
  if (TIER_1_CITIES.has(city)) return '0.75';
  if (TIER_2_CITIES.has(city)) return '0.70';
  return '0.65';
};

/* ── Existing-sitemap parsing (lastmod preservation) ─────────────────────── */

function parseLastmods(xml) {
  const map = new Map();
  const re = /<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g;
  let m;
  while ((m = re.exec(xml))) map.set(m[1], m[2]);
  return map;
}

/* ── XML generation ──────────────────────────────────────────────────────── */

function generate(prevLastmod, warn) {
  const entry = (loc, changefreq, priority) =>
    '  <url><loc>' + loc + '</loc><lastmod>' + (prevLastmod.get(loc) || TODAY) +
    '</lastmod><changefreq>' + changefreq + '</changefreq><priority>' + priority +
    '</priority></url>';

  const checkExists = (rel, urlPath) => {
    if (!fs.existsSync(path.join(DOCS, rel))) {
      warn('curated page missing on disk (kept in sitemap, please verify): /' + urlPath + ' -> docs/' + rel);
    }
  };

  // Directory-based service pages: discovered from docs/services/*/index.html,
  // then matched against the curated section map.
  const dirServicesOnDisk = listDirServices();
  const knownDirSlugs = new Set([
    ...PREMIUM_DIR_SERVICES.map(([s]) => s),
    GAF_TIMBERLINE_SERVICE[0],
  ]);
  const premiumEntries = PREMIUM_DIR_SERVICES.filter(([slug]) => {
    if (dirServicesOnDisk.includes(slug)) return true;
    warn('directory service page missing on disk, dropped: services/' + slug + '/');
    return false;
  });
  for (const slug of dirServicesOnDisk) {
    if (!knownDirSlugs.has(slug)) {
      warn('NEW directory service page found: services/' + slug + '/ — added to the Premium Components section at default priority 0.85. Curate its slot in PREMIUM_DIR_SERVICES.');
      premiumEntries.push([slug, '0.85']);
    }
  }

  // Blog posts: specials are pinned to their sections; the rest go to the
  // main homeowner blog section at 0.6.
  const blogOnDisk = listHtml(path.join(DOCS, 'blog'));
  const specialBlogSlugs = new Set([
    ...PREMIUM_BLOG_POSTS.map(([s]) => s),
    GAF_TIMBERLINE_BLOG[0],
  ]);
  const premiumBlogEntries = PREMIUM_BLOG_POSTS.filter(([slug]) => {
    if (blogOnDisk.includes(slug)) return true;
    warn('premium blog post missing on disk, dropped: blog/' + slug);
    return false;
  });
  const mainBlogSlugs = blogOnDisk.filter((s) => !specialBlogSlugs.has(s));

  // Services: plain pages + city combos from docs/services/*.html.
  const serviceHtmlSlugs = listHtml(path.join(DOCS, 'services'));
  const plainOnDisk = [...PLAIN_SERVICES].sort().filter((slug) => {
    if (serviceHtmlSlugs.includes(slug)) return true;
    warn('plain service page missing on disk, dropped: services/' + slug);
    return false;
  });
  const comboSlugs = serviceHtmlSlugs.filter((s) => !PLAIN_SERVICES.has(s));

  // Areas: tier 1 first (0.9), then the rest (0.8), each alphabetical.
  const areaSlugs = listHtml(path.join(DOCS, 'areas'));
  const tier1Areas = areaSlugs.filter((s) => TIER_1_AREAS.has(s));
  const tier2Areas = areaSlugs.filter((s) => !TIER_1_AREAS.has(s));

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  lines.push('');

  lines.push('  <!-- Core Pages -->');
  for (const [slug, rel, priority, changefreq] of CORE_PAGES) {
    checkExists(rel, slug);
    lines.push(entry(urlFor(slug), changefreq, priority));
  }
  lines.push('');

  lines.push('  <!-- Index hubs -->');
  for (const [slug, rel, priority, changefreq] of INDEX_HUBS) {
    checkExists(rel, slug);
    lines.push(entry(urlFor(slug), changefreq, priority));
  }
  lines.push('');

  lines.push('  <!-- The NBD Guarantee + Premium Components -->');
  for (const [slug, priority] of premiumEntries) {
    lines.push(entry(urlFor('services/' + slug), 'monthly', priority));
  }
  lines.push('');

  lines.push('  <!-- New Blog Posts (Premium Components Series) -->');
  for (const [slug, priority] of premiumBlogEntries) {
    lines.push(entry(urlFor('blog/' + slug), 'monthly', priority));
  }
  lines.push('');

  lines.push('  <!-- Services -->');
  for (const slug of plainOnDisk) {
    lines.push(entry(urlFor('services/' + slug), 'monthly', '0.8'));
  }
  lines.push('');

  lines.push('  <!-- Service + City Combos (Tier 1: 0.75 | Tier 2: 0.70 | Tier 3: 0.65) -->');
  for (const slug of comboSlugs) {
    lines.push(entry(urlFor('services/' + slug), 'monthly', comboPriority(slug)));
  }
  lines.push('');

  lines.push('  <!-- Service Areas -->');
  for (const slug of tier1Areas) lines.push(entry(urlFor('areas/' + slug), 'monthly', '0.9'));
  for (const slug of tier2Areas) lines.push(entry(urlFor('areas/' + slug), 'monthly', '0.8'));
  lines.push('');

  lines.push('  <!-- Blog Posts (homeowner-facing — /pro/blog/* B2B posts live elsewhere) -->');
  for (const slug of mainBlogSlugs) {
    lines.push(entry(urlFor('blog/' + slug), 'monthly', '0.6'));
  }
  lines.push('');

  lines.push('  <!-- GAF Timberline product page + Class 4 blog -->');
  if (dirServicesOnDisk.includes(GAF_TIMBERLINE_SERVICE[0])) {
    lines.push(entry(urlFor('services/' + GAF_TIMBERLINE_SERVICE[0]), 'monthly', GAF_TIMBERLINE_SERVICE[1]));
  } else {
    warn('directory service page missing on disk, dropped: services/' + GAF_TIMBERLINE_SERVICE[0] + '/');
  }
  if (blogOnDisk.includes(GAF_TIMBERLINE_BLOG[0])) {
    lines.push(entry(urlFor('blog/' + GAF_TIMBERLINE_BLOG[0]), 'monthly', GAF_TIMBERLINE_BLOG[1]));
  } else {
    warn('blog post missing on disk, dropped: blog/' + GAF_TIMBERLINE_BLOG[0]);
  }
  lines.push('');

  lines.push(...PRO_FOOTNOTE);
  lines.push('');
  lines.push('</urlset>');

  return lines.join('\n') + '\n';
}

/* ── Unified diff (pure JS, no temp files, no shelling out) ──────────────── */

function diffOps(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = []; // { t: ' '|'-'|'+', line, ai, bi }
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push({ t: ' ', line: a[i], ai: i, bi: j }); i++; j++;
    } else if (i < n && (j === m || dp[i + 1][j] >= dp[i][j + 1])) {
      ops.push({ t: '-', line: a[i], ai: i, bi: j }); i++;
    } else {
      ops.push({ t: '+', line: b[j], ai: i, bi: j }); j++;
    }
  }
  return ops;
}

function unifiedDiff(aText, bText, aName, bName, context = 3) {
  if (aText === bText) return '';
  const a = aText.split('\n');
  const b = bText.split('\n');
  if (a.length * b.length > 16e6) {
    // Pathological size — skip the O(n*m) LCS and report the first divergence.
    let k = 0;
    while (k < Math.min(a.length, b.length) && a[k] === b[k]) k++;
    return '--- ' + aName + '\n+++ ' + bName +
      '\n(files too large for full diff; first difference at line ' + (k + 1) + ')' +
      '\n-' + (a[k] === undefined ? '<EOF>' : a[k]) +
      '\n+' + (b[k] === undefined ? '<EOF>' : b[k]);
  }
  const ops = diffOps(a, b);
  const out = ['--- ' + aName, '+++ ' + bName];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].t === ' ') { k++; continue; }
    const hunkStart = Math.max(0, k - context);
    // Extend through subsequent changes separated by <= 2*context equal lines.
    let last = k;
    let t = k;
    while (t < ops.length) {
      if (ops[t].t !== ' ') { last = t; t++; continue; }
      let run = t;
      while (run < ops.length && ops[run].t === ' ') run++;
      if (run < ops.length && run - t <= context * 2) { t = run; continue; }
      break;
    }
    const hunkEnd = Math.min(ops.length, last + context + 1);
    const slice = ops.slice(hunkStart, hunkEnd);
    const aSide = slice.filter((o) => o.t !== '+');
    const bSide = slice.filter((o) => o.t !== '-');
    const aStart = aSide.length ? aSide[0].ai + 1 : slice[0].ai;
    const bStart = bSide.length ? bSide[0].bi + 1 : slice[0].bi;
    out.push('@@ -' + aStart + ',' + aSide.length + ' +' + bStart + ',' + bSide.length + ' @@');
    for (const o of slice) out.push(o.t + o.line);
    k = hunkEnd;
  }
  return out.join('\n');
}

/* ── Main ────────────────────────────────────────────────────────────────── */

function main() {
  const args = process.argv.slice(2);
  let write = false;
  for (const arg of args) {
    if (arg === '--write') { write = true; continue; }
    const isHelp = arg === '--help' || arg === '-h';
    (isHelp ? console.log : console.error)(USAGE);
    process.exit(isHelp ? 0 : 2); // never writes
  }

  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  const prevLastmod = parseLastmods(current);

  const warnings = [];
  const xml = generate(prevLastmod, (msg) => warnings.push(msg));
  for (const w of warnings) console.error('WARN: ' + w);

  // Sanity guards — abort before any write.
  if (xml.includes('\\')) {
    console.error('FATAL: backslash detected in generated sitemap — aborting.');
    process.exit(2);
  }
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const dupes = locs.filter((loc, idx) => locs.indexOf(loc) !== idx);
  if (dupes.length) {
    console.error('FATAL: duplicate <loc> in generated sitemap — aborting: ' + dupes.join(', '));
    process.exit(2);
  }

  if (xml === current) {
    console.log('OK: generated sitemap matches docs/sitemap.xml exactly (' + locs.length + ' URLs). Zero diff — nothing to do.');
    return;
  }

  const currentLocs = new Set(parseLastmods(current).keys());
  const generatedLocs = new Set(locs);
  const added = locs.filter((loc) => !currentLocs.has(loc));
  const removed = [...currentLocs].filter((loc) => !generatedLocs.has(loc));

  if (write) {
    const tmp = OUT + '.tmp-' + process.pid;
    fs.writeFileSync(tmp, xml);
    fs.renameSync(tmp, OUT);
    console.log('Wrote ' + OUT + ' (' + locs.length + ' URLs; +' + added.length + ' new, -' + removed.length + ' removed; new URLs stamped ' + TODAY + ').');
    return;
  }

  console.log(unifiedDiff(current, xml, 'docs/sitemap.xml (current)', 'docs/sitemap.xml (generated)'));
  console.log('');
  if (added.length) console.log('New URLs (would get lastmod=' + TODAY + '):\n  ' + added.join('\n  '));
  if (removed.length) console.log('Removed URLs:\n  ' + removed.join('\n  '));
  console.log('DRY-RUN: generated ' + locs.length + ' URLs; differences found. NOTHING was written. Re-run with --write to apply.');
  process.exit(1);
}

if (require.main === module) main();

module.exports = { generate, parseLastmods, unifiedDiff };
