#!/usr/bin/env node
/**
 * build-projects.mjs — regenerates the Featured Projects gallery inside
 * docs/our-work.html from docs/assets/data/projects.json.
 *
 * WHY: /our-work is the Thumbtack-style featured-projects page — real jobs
 * with retail price RANGES, photos, and category filters. The cards must be
 * crawlable static HTML (this is cost-transparency SEO content), but hand-
 * duplicating card markup is the drift class this repo keeps paying for.
 * Same shape as build-blog-index.mjs: a data file is the single editing
 * surface, this script owns the marked regions, CI gates the drift.
 *
 * USAGE:
 *   node scripts/build-projects.mjs            # restamp docs/our-work.html
 *   node scripts/build-projects.mjs --check    # write nothing; exit 1 on drift
 *
 * MARKERS (one-time, already in the page):
 *   <!-- OURWORK-STATIC-START -->…<!-- OURWORK-STATIC-END -->        gallery
 *   <!-- OURWORK-HEAD-SCHEMA-START -->…<!-- OURWORK-HEAD-SCHEMA-END --> head
 *
 * VALIDATION IS THE POINT. This page publishes prices and photos of real
 * jobs, so the generator refuses bad entries loudly instead of shipping
 * them: retail-only keys (a cost/margin key anywhere in the manifest is
 * fatal — tests/catalog-cost-privacy.test.js is the independent backstop),
 * consentOnFile must be literally true, photos must be repo-local
 * re-encoded copies that exist on disk (never CRM storage URLs), and the
 * price range must be a sane both-or-neither pair.
 *
 * Publish procedure: documentation/runbooks/PUBLISH-PROJECT.md
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'docs', 'assets', 'data', 'projects.json');
const HTML = path.join(ROOT, 'docs', 'our-work.html');
const CHECK = process.argv.includes('--check');

const CATEGORIES = {
  replacement: 'Roof Replacement',
  storm: 'Storm Damage',
  active: 'Active Jobsite',
  specialty: 'Metal & Specialty',
  commercial: 'Commercial',
};

// ── Load + validate ─────────────────────────────────────────────
const manifest = JSON.parse(readFileSync(DATA, 'utf8'));
const all = manifest.projects;
const fail = (msg) => { console.error(`FATAL: ${msg}`); process.exitCode = 1; };

if (!Array.isArray(all) || !all.length) { fail('projects.json has no projects[] array'); process.exit(1); }

// Forbidden-key scan over the WHOLE manifest (keys only — values are prose).
// A cost-family key here means someone pasted internal numbers; token/street/
// address means a CRM URL or a real address is about to ship. Fails before
// the catalog-cost-privacy CI sweep would.
const FORBIDDEN_KEY = /cost|contractor|margin|token|address|street/i;
(function scanKeys(node, at) {
  if (Array.isArray(node)) return node.forEach((v, i) => scanKeys(v, `${at}[${i}]`));
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (FORBIDDEN_KEY.test(k)) fail(`${at}.${k}: forbidden key (cost/margin/token/address family) — retail figures and city-level location only`);
      scanKeys(v, `${at}.${k}`);
    }
  }
})(manifest, 'manifest');

const IMG_RE = /^\/assets\/[\w./-]+\.(webp|jpg|jpeg|png)$/;   // homeowner-wall.js contract
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const seen = new Set();

for (const p of all) {
  const at = `project "${p.slug || p.title || '?'}"`;
  if (!SLUG_RE.test(p.slug || '')) fail(`${at}: slug must be kebab-case`);
  if (seen.has(p.slug)) fail(`${at}: duplicate slug`);
  seen.add(p.slug);
  if (!(p.category in CATEGORIES)) fail(`${at}: category must be one of ${Object.keys(CATEGORIES).join('|')}`);
  for (const req of ['title', 'tag', 'city', 'description', 'hero', 'published']) {
    if (!p[req] || typeof p[req] !== 'string') fail(`${at}: missing required field "${req}"`);
  }
  if (p.consentOnFile !== true) fail(`${at}: consentOnFile must be literally true — no consent, no publish`);
  if (isNaN(new Date(p.published).getTime())) fail(`${at}: published is not a valid ISO date`);
  if (!Array.isArray(p.photos) || !p.photos.length) fail(`${at}: photos[] must have at least one entry`);

  const hasLow = p.priceLow != null, hasHigh = p.priceHigh != null;
  if (hasLow !== hasHigh) fail(`${at}: priceLow/priceHigh are both-or-neither`);
  if (hasLow) {
    if (!Number.isInteger(p.priceLow) || !Number.isInteger(p.priceHigh) || p.priceLow <= 0)
      fail(`${at}: prices must be positive whole retail dollars`);
    if (p.priceLow > p.priceHigh) fail(`${at}: priceLow > priceHigh`);
  }

  for (const img of [{ src: p.hero, alt: 'hero' }, ...p.photos]) {
    if (!IMG_RE.test(img.src || '')) fail(`${at}: image "${img.src}" must match ${IMG_RE} — repo-local re-encoded copies only, never CRM URLs`);
    else if (!existsSync(path.join(ROOT, 'docs', img.src))) fail(`${at}: image ${img.src} does not exist on disk`);
  }
  for (const ph of p.photos) {
    if (!ph.alt || !String(ph.alt).trim()) fail(`${at}: every photo needs real alt text`);
  }
}
if (process.exitCode) process.exit(1);

// ── Render ──────────────────────────────────────────────────────
const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const today = new Date(); today.setHours(0, 0, 0, 0);
const live = all.filter((p) => {
  const d = new Date(p.published); d.setHours(0, 0, 0, 0);
  return d <= today;                       // future date = staged, blog model
});

const money = (n) => '$' + n.toLocaleString('en-US');
const priceLine = (p) => (p.priceLow != null ? `${money(p.priceLow)}–${money(p.priceHigh)}` : null);

const webpFor = (src) => {
  const w = src.replace(/\.(jpg|jpeg|png)$/, '.webp');
  return w !== src && existsSync(path.join(ROOT, 'docs', w)) ? w : null;
};

const PIN_SVG = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>';

const card = (p) => {
  const webp = webpFor(p.hero);
  const heroAlt = (p.photos.find((ph) => ph.src === p.hero) || p.photos[0]).alt;
  const img = `<img src="${esc(p.hero)}" alt="${esc(heroAlt)}" class="project-img" loading="lazy" decoding="async" width="800" height="600">`;
  const price = priceLine(p);
  // Lightbox payload — display fields only, all re-escaped by esc() as one
  // JSON attribute. The client JSON.parses it; it renders via textContent.
  const payload = {
    title: p.title, tag: p.tag, city: p.city, price, year: p.year || null,
    description: p.description, photos: p.photos,
  };
  const meta = [
    `<span class="project-loc">${PIN_SVG} ${esc(p.city)}</span>`,
    p.year ? `<span>${esc(String(p.year))}</span>` : null,
    p.duration ? `<span>${esc(p.duration)}</span>` : null,
    `<span>${p.photos.length} photo${p.photos.length === 1 ? '' : 's'}</span>`,
  ].filter(Boolean).join(' <span class="project-dot">·</span> ');
  return `      <div class="project" data-cat="${esc(p.category)}" data-slug="${esc(p.slug)}" data-project="${esc(JSON.stringify(payload))}">
        ${webp ? `<picture><source srcset="${esc(webp)}" type="image/webp">${img}</picture>` : img}
        <div class="project-body">
          <span class="project-tag">${esc(p.tag)}</span>
          <h3>${esc(p.title)}</h3>${price ? `
          <div class="project-price">${esc(price)}</div>` : ''}
          <p>${esc(p.description)}</p>
          <div class="project-meta">${meta}</div>
          <button type="button" class="project-view">View photos &rarr;</button>
        </div>
      </div>`;
};

const cats = Object.keys(CATEGORIES).filter((c) => live.some((p) => p.category === c));
const filters = [
  `      <button class="filter-btn active" data-cat="all">All Projects</button>`,
  ...cats.map((c) => `      <button class="filter-btn" data-cat="${c}">${esc(CATEGORIES[c])}</button>`),
].join('\n');

// Newest published date, not today's date: the generated comment must be a
// pure function of projects.json, or the --check gate goes red at the next
// UTC midnight on untouched code (bit CI daily until 2026-08-07).
const newestPublished = live.map((p) => p.published).sort().at(-1);

const staticBlock = `<!-- OURWORK-STATIC-START -->
<!-- generated by build-projects.mjs from assets/data/projects.json — do not hand-edit; ${live.length} live projects, newest published ${newestPublished} -->
    <div class="filters">
${filters}
    </div>

    <div class="gallery" id="gallery">
${live.map(card).join('\n\n')}
    </div>
<!-- OURWORK-STATIC-END -->`;

// ── Schema ──────────────────────────────────────────────────────
const ORIGIN = 'https://nobigdealwithjoedeal.com';
// Service + AggregateOffer, deliberately NOT Product: Product rich-result
// markup on a portfolio page is a documented spammy-structured-markup risk,
// and no rich result exists for local-service portfolios either way.
// Service keeps the price range machine-readable and ties every item to the
// sitewide RoofingContractor node via provider @id.
const schema = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'RoofingContractor',
      '@id': `${ORIGIN}/#org`,
      name: 'No Big Deal Home Solutions',
      alternateName: 'No Big Deal with Joe Deal',
      url: ORIGIN,
      telephone: '+18594207382',
      email: 'jd@nobigdealwithjoedeal.com',
    },
    {
      '@type': 'ImageGallery',
      '@id': `${ORIGIN}/our-work#gallery`,
      name: 'Our Work — No Big Deal Home Solutions',
      description: 'Real roof replacement, storm damage repair, siding, and gutter projects across Greater Cincinnati — with honest price ranges.',
      url: `${ORIGIN}/our-work`,
      about: { '@id': `${ORIGIN}/#org` },
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${ORIGIN}/our-work#breadcrumbs`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
        { '@type': 'ListItem', position: 2, name: 'Our Work', item: `${ORIGIN}/our-work` },
      ],
    },
    {
      '@type': 'ItemList',
      '@id': `${ORIGIN}/our-work#projects`,
      numberOfItems: live.length,
      itemListElement: live.map((p, i) => {
        const item = {
          '@type': 'Service',
          '@id': `${ORIGIN}/our-work#p-${p.slug}`,
          name: p.title,
          serviceType: CATEGORIES[p.category],
          provider: { '@id': `${ORIGIN}/#org` },
          areaServed: p.city,
          description: p.description,
          image: `${ORIGIN}${p.hero}`,
        };
        if (p.priceLow != null) {
          item.offers = {
            '@type': 'AggregateOffer',
            lowPrice: p.priceLow, highPrice: p.priceHigh, priceCurrency: 'USD',
          };
        }
        return { '@type': 'ListItem', position: i + 1, item };
      }),
    },
  ],
};

const schemaBlock = `<!-- OURWORK-HEAD-SCHEMA-START -->
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<!-- OURWORK-HEAD-SCHEMA-END -->`;

// ── Stamp ───────────────────────────────────────────────────────
let html = readFileSync(HTML, 'utf8');
const before = html;

const replaceBetween = (name, re, block) => {
  if (!re.test(html)) {
    console.error(`FATAL: ${name} markers not found in ${HTML}.
Add <!-- ${name}-START --><!-- ${name}-END --> once (gallery inside its <section> .inner, schema in <head>).`);
    process.exit(1);
  }
  // Callback form on purpose — $-sequences in titles would corrupt output.
  html = html.replace(re, () => block);
};

replaceBetween('OURWORK-STATIC', /<!-- OURWORK-STATIC-START -->[\s\S]*?<!-- OURWORK-STATIC-END -->/, staticBlock);
replaceBetween('OURWORK-HEAD-SCHEMA', /<!-- OURWORK-HEAD-SCHEMA-START -->[\s\S]*?<!-- OURWORK-HEAD-SCHEMA-END -->/, schemaBlock);

if (CHECK) {
  if (html === before) {
    console.log(`build-projects --check: ${live.length} live project(s) match docs/our-work.html — clean.`);
    process.exit(0);
  }
  console.error(`build-projects --check: docs/our-work.html is stale vs assets/data/projects.json.
The OURWORK-* regions are GENERATED. Edit docs/assets/data/projects.json, then run:
  node scripts/build-projects.mjs
and commit BOTH files.`);
  process.exit(1);
}

writeFileSync(HTML, html);
console.log(`OK: ${live.length} static project card(s) + schema written into ${HTML}${all.length - live.length ? ` (${all.length - live.length} staged for a future date)` : ''}`);
