#!/usr/bin/env node
/**
 * Rebuilds docs/sitemap.xml from the filesystem.
 *
 * Regression note (2026-04-17): a previous ad-hoc rebuild used path.join on
 * Windows and leaked backslashes into 11 service URLs. This generator builds
 * URLs with string concatenation + "/" only — never path.join.
 *
 * Usage: node scripts/build-sitemap.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const OUT = path.join(DOCS, 'sitemap.xml');
const ORIGIN = 'https://www.nobigdealwithjoedeal.com';
const TODAY = new Date().toISOString().slice(0, 10);

// Stable: homepage + 7 top-level customer-facing pages. Rendered as root paths.
const CORE_PAGES = [
  { slug: '', priority: '1.0', changefreq: 'weekly' },
  { slug: 'about', priority: '0.8', changefreq: 'monthly' },
  { slug: 'our-work', priority: '0.8', changefreq: 'monthly' },
  { slug: 'storm-alerts', priority: '0.7', changefreq: 'monthly' },
  { slug: 'visualizer', priority: '0.7', changefreq: 'monthly' },
  { slug: 'estimate', priority: '0.6', changefreq: 'monthly' },
  { slug: 'privacy', priority: '0.6', changefreq: 'monthly' },
  { slug: 'review', priority: '0.6', changefreq: 'monthly' },
];

// The 11 plain service pages (no city suffix). Everything else under
// docs/services/ whose filename doesn't match one of these is a combo page.
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

// Combo priority tiers keyed by trailing city slug (everything after the
// service prefix). Tier 1 = core metros, Tier 2 = adjacent, Tier 3 = outer.
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

// Only these two /pro pages belong in the public sitemap.
const PRO_ALLOW = new Set(['', 'dashboard']);

const listHtml = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir)
        .filter((f) => f.endsWith('.html') && f !== 'index.html' && f !== '404.html' && f !== 'offline.html')
        .map((f) => f.replace(/\.html$/, ''))
        .sort()
    : [];

const urlFor = (slug) => (slug ? `${ORIGIN}/${slug}` : `${ORIGIN}/`);

const entry = (loc, priority, changefreq = 'monthly') =>
  `  <url><loc>${loc}</loc><lastmod>${TODAY}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;

const comboCityFromSlug = (slug) => {
  // Find the longest plain-service prefix that matches, then take the remainder.
  const match = [...PLAIN_SERVICES]
    .sort((a, b) => b.length - a.length)
    .find((svc) => slug.startsWith(`${svc}-`));
  return match ? slug.slice(match.length + 1) : null;
};

const comboPriority = (slug) => {
  const city = comboCityFromSlug(slug);
  if (TIER_1_CITIES.has(city)) return '0.75';
  if (TIER_2_CITIES.has(city)) return '0.70';
  return '0.65';
};

const sections = [];

sections.push('  <!-- Core Pages -->');
for (const p of CORE_PAGES) {
  sections.push(entry(urlFor(p.slug), p.priority, p.changefreq));
}
sections.push('');

sections.push('  <!-- Services -->');
for (const slug of [...PLAIN_SERVICES].sort()) {
  sections.push(entry(urlFor(`services/${slug}`), '0.8'));
}
sections.push('');

sections.push('  <!-- Service + City Combos (Tier 1: 0.75 | Tier 2: 0.70 | Tier 3: 0.65) -->');
for (const slug of listHtml(path.join(DOCS, 'services'))) {
  if (PLAIN_SERVICES.has(slug)) continue;
  sections.push(entry(urlFor(`services/${slug}`), comboPriority(slug)));
}
sections.push('');

sections.push('  <!-- Service Areas -->');
const areaSlugs = listHtml(path.join(DOCS, 'areas'));
const tier1 = areaSlugs.filter((s) => TIER_1_AREAS.has(s));
const tier2 = areaSlugs.filter((s) => !TIER_1_AREAS.has(s));
for (const slug of tier1) sections.push(entry(urlFor(`areas/${slug}`), '0.9'));
for (const slug of tier2) sections.push(entry(urlFor(`areas/${slug}`), '0.8'));
sections.push('');

sections.push('  <!-- Blog Posts -->');
for (const slug of listHtml(path.join(DOCS, 'blog'))) {
  sections.push(entry(urlFor(`blog/${slug}`), '0.6'));
}
sections.push('');

sections.push('  <!-- Pro -->');
const proSlugs = listHtml(path.join(DOCS, 'pro')).filter((s) => PRO_ALLOW.has(s));
sections.push(entry(urlFor('pro'), '0.5'));
for (const slug of proSlugs) {
  if (slug === '') continue;
  sections.push(entry(urlFor(`pro/${slug}`), '0.5'));
}

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  '',
  ...sections,
  '',
  '</urlset>',
  '',
].join('\n');

if (xml.includes('\\')) {
  console.error('FATAL: backslash detected in generated sitemap — aborting.');
  process.exit(1);
}

fs.writeFileSync(OUT, xml);
const urlCount = (xml.match(/<url>/g) || []).length;
console.log(`Wrote ${OUT} (${urlCount} URLs, lastmod=${TODAY})`);
