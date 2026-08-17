#!/usr/bin/env node
/**
 * build-projects.mjs — regenerates every Featured Projects surface from
 * docs/assets/data/projects.json:
 *
 *   1. docs/our-work.html         — gallery + filters (OURWORK-STATIC) and
 *                                   head JSON-LD (OURWORK-HEAD-SCHEMA)
 *   2. docs/services/<hub>.html   — "Recent jobs" strips (OURWORK-STRIP
 *                                   markers, one per hub page; the marker's
 *                                   service="…" attribute picks which
 *                                   projects it shows)
 *   3. docs/assets/data/homeowner-wall.json — homepage photo-wall manifest,
 *                                   derived from the same live projects so
 *                                   the two manifests can never drift
 *
 * WHY: /our-work is the Thumbtack-style featured-projects page — real jobs
 * with retail price RANGES, photos, and service filters. The cards must be
 * crawlable static HTML (this is cost-transparency SEO content), but hand-
 * duplicating card markup is the drift class this repo keeps paying for.
 * Same shape as build-blog-index.mjs: a data file is the single editing
 * surface, this script owns the marked regions, CI gates the drift.
 *
 * USAGE:
 *   node scripts/build-projects.mjs            # restamp all surfaces
 *   node scripts/build-projects.mjs --check    # write nothing; exit 1 on drift
 *
 * TAXONOMY: every project carries services[] — 1+ keys of the SERVICES map
 * below. The keys are exactly the /services/ hub filenames, so one list
 * drives the filter buttons, the deep links (#service=<key>), the schema.org
 * serviceType, the card→hub crosslink pills, and which hub strips a job
 * appears in. A job may carry several (a hail-claim tear-off is
 * ["roof-replacement","storm-damage"]). The legacy category field is
 * optional and display-inert (kept on old entries, validated when present).
 *
 * SORTING: surfaces render newest published first (stable tiebreak =
 * manifest order), so new entries are APPENDED at the end of projects.json —
 * the lowest-risk edit — and still show first everywhere.
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

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'docs', 'assets', 'data', 'projects.json');
const HTML = path.join(ROOT, 'docs', 'our-work.html');
const SERVICES_DIR = path.join(ROOT, 'docs', 'services');
const WALL = path.join(ROOT, 'docs', 'assets', 'data', 'homeowner-wall.json');
const CHECK = process.argv.includes('--check');

// Key = /services/<key>.html hub page = filter value = strip target.
// Order = filter-button order on /our-work.
const SERVICES = {
  'roof-replacement': 'Roof Replacement',
  'roof-repair': 'Roof Repair',
  'siding-replacement': 'Siding Replacement',
  'siding-repair': 'Siding Repair',
  'gutter-replacement': 'Gutters',
  'storm-damage': 'Storm & Hail',
  'roof-inspection': 'Inspection',
};

// Legacy display facet — optional since the services[] taxonomy (2026-08-10);
// still validated when present so old entries stay well-formed.
const CATEGORIES = {
  replacement: 'Roof Replacement',
  storm: 'Storm Damage',
  active: 'Active Jobsite',
  specialty: 'Metal & Specialty',
  commercial: 'Commercial',
};

const KNOWN_FIELDS = new Set([
  'slug', 'title', 'category', 'services', 'tag', 'city', 'description',
  'hero', 'photos', 'consentOnFile', 'published', 'priceLow', 'priceHigh',
  'year', 'duration',
]);

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
  if (!Array.isArray(p.services) || !p.services.length) {
    fail(`${at}: services[] is required — 1+ of ${Object.keys(SERVICES).join('|')}`);
  } else {
    for (const s of p.services) if (!(s in SERVICES)) fail(`${at}: unknown service "${s}" — must be one of ${Object.keys(SERVICES).join('|')}`);
    if (new Set(p.services).size !== p.services.length) fail(`${at}: duplicate entries in services[]`);
  }
  if (p.category != null && !(p.category in CATEGORIES)) fail(`${at}: category (legacy, optional) must be one of ${Object.keys(CATEGORIES).join('|')}`);
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
  // Warn-only typo net: an unknown optional field silently no-ops otherwise.
  for (const k of Object.keys(p)) {
    if (!KNOWN_FIELDS.has(k)) console.warn(`WARN: ${at}: unknown field "${k}" is ignored by the renderer (typo?)`);
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
// Newest first everywhere; Array.prototype.sort is stable, so same-date
// entries keep their curated manifest order. New entries are appended at the
// END of projects.json and still render first.
live.sort((a, b) => new Date(b.published) - new Date(a.published));

const money = (n) => '$' + n.toLocaleString('en-US');
const priceLine = (p) => (p.priceLow != null ? `${money(p.priceLow)}–${money(p.priceHigh)}` : null);

const webpFor = (src) => {
  const w = src.replace(/\.(jpg|jpeg|png)$/, '.webp');
  return w !== src && existsSync(path.join(ROOT, 'docs', w)) ? w : null;
};

const heroAlt = (p) => (p.photos.find((ph) => ph.src === p.hero) || p.photos[0]).alt;

const heroImg = (p, cls) => {
  const webp = webpFor(p.hero);
  const img = `<img src="${esc(p.hero)}" alt="${esc(heroAlt(p))}" class="${cls}" loading="lazy" decoding="async" width="800" height="600">`;
  return webp ? `<picture><source srcset="${esc(webp)}" type="image/webp">${img}</picture>` : img;
};

const PIN_SVG = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/></svg>';

const card = (p) => {
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
  const pills = p.services.map((s) =>
    `<a href="/services/${s}">${esc(SERVICES[s])}</a>`).join('\n            ');
  return `      <div class="project" data-services="${esc(p.services.join(' '))}" data-slug="${esc(p.slug)}" data-project="${esc(JSON.stringify(payload))}">
        ${heroImg(p, 'project-img')}
        <div class="project-body">
          <span class="project-tag">${esc(p.tag)}</span>
          <h3>${esc(p.title)}</h3>${price ? `
          <div class="project-price">${esc(price)}</div>` : ''}
          <p>${esc(p.description)}</p>
          <div class="project-meta">${meta}</div>
          <div class="project-services">
            ${pills}
          </div>
          <button type="button" class="project-view">View photos &rarr;</button>
        </div>
      </div>`;
};

const activeServices = Object.keys(SERVICES).filter((s) => live.some((p) => p.services.includes(s)));
const filters = [
  `      <button class="filter-btn active" data-service="all">All Projects</button>`,
  // id="svc-…" makes /our-work#svc-<key> a REAL anchor (site-integrity checks
  // cross-page anchors), so hub strips deep-link straight to the filter bar.
  ...activeServices.map((s) => `      <button class="filter-btn" id="svc-${s}" data-service="${s}">${esc(SERVICES[s])}</button>`),
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
          serviceType: SERVICES[p.services[0]],
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

// ── Hub-page strips ─────────────────────────────────────────────
// Each /services/ hub page carries one OURWORK-STRIP marker pair whose
// service="…" attribute picks the projects (so e.g. the hail hub reuses
// service="storm-damage"). Markers are hand-placed ONCE, outside every
// nbd:partial region; this script owns everything between them.
const STRIP_MAX = 3;

const stripCard = (p, service) => {
  const price = priceLine(p);
  return `    <a class="project project-link" href="/our-work#svc-${service}">
      ${heroImg(p, 'project-img')}
      <div class="project-body">
        <span class="project-tag">${esc(p.tag)}</span>
        <h3>${esc(p.title)}</h3>${price ? `
        <div class="project-price">${esc(price)}</div>` : ''}
        <div class="project-meta"><span class="project-loc">${PIN_SVG} ${esc(p.city)}</span></div>
      </div>
    </a>`;
};

const stripBlock = (service) => {
  const label = SERVICES[service];
  const matches = live.filter((p) => p.services.includes(service)).slice(0, STRIP_MAX);
  const newest = matches.length ? matches.map((p) => p.published).sort().at(-1) : null;
  const header = `<!-- generated by build-projects.mjs from assets/data/projects.json — do not hand-edit; ${matches.length} live ${service} project(s)${newest ? `, newest published ${newest}` : ''} -->`;
  if (!matches.length) {
    // No matching live jobs yet: CTA band only — never an empty grid.
    return `${header}
<section class="nbd-recent-jobs" id="recent-jobs">
  <div class="nbd-recent-jobs-inner">
    <div class="nbd-recent-jobs-cta">
      <p>Fresh ${esc(label.toLowerCase())} job photos are coming soon — see completed roofing, siding, and gutter projects with honest price ranges.</p>
      <a href="/our-work">See Our Work &rarr;</a>
    </div>
  </div>
</section>`;
  }
  return `${header}
<section class="nbd-recent-jobs" id="recent-jobs" aria-labelledby="recent-jobs-h">
  <div class="nbd-recent-jobs-inner">
    <div class="nbd-recent-jobs-head">
      <h2 id="recent-jobs-h">Recent <span>${esc(label)}</span> Jobs</h2>
      <a class="nbd-recent-jobs-all" href="/our-work#svc-${service}">See all our work &rarr;</a>
    </div>
    <div class="gallery">
${matches.map((p) => stripCard(p, service)).join('\n\n')}
    </div>
  </div>
</section>`;
};

const STRIP_RE = /<!-- OURWORK-STRIP-START service="([a-z-]+)" -->[\s\S]*?<!-- OURWORK-STRIP-END -->/g;

// ── Homeowner-wall manifest (derived, drift-proof) ──────────────
// Same live projects feed the homepage "Real Roofs. Real Neighbors." wall
// (docs/assets/js/homeowner-wall.js: entries need image+alt, name optional,
// wall reveals at >=3 and caps at 12).
const wallJson = JSON.stringify(
  live.slice(0, 12).map((p) => ({ image: p.hero, city: p.city, alt: heroAlt(p) })),
  null, 2,
) + '\n';

// ── Stamp all targets ───────────────────────────────────────────
const stale = [];
const stampFile = (file, transform, required) => {
  const rel = path.relative(ROOT, file);
  const src = readFileSync(file, 'utf8');
  const out = transform(src);
  if (out === null) {
    if (required) { console.error(`FATAL: expected markers not found in ${rel}`); process.exit(1); }
    return 0;
  }
  if (out === src) return 0;
  if (CHECK) { stale.push(rel); return 0; }
  writeFileSync(file, out);
  return 1;
};

// 1. our-work.html (both regions; missing markers are fatal — page contract)
stampFile(HTML, (src) => {
  const reStatic = /<!-- OURWORK-STATIC-START -->[\s\S]*?<!-- OURWORK-STATIC-END -->/;
  const reSchema = /<!-- OURWORK-HEAD-SCHEMA-START -->[\s\S]*?<!-- OURWORK-HEAD-SCHEMA-END -->/;
  if (!reStatic.test(src) || !reSchema.test(src)) return null;
  // Callback form on purpose — $-sequences in titles would corrupt output.
  return src.replace(reStatic, () => staticBlock).replace(reSchema, () => schemaBlock);
}, true);

// 2. Every /services/ page that carries a strip marker
let stripCount = 0;
for (const f of readdirSync(SERVICES_DIR)) {
  if (!f.endsWith('.html')) continue;
  const file = path.join(SERVICES_DIR, f);
  stampFile(file, (src) => {
    if (!STRIP_RE.test(src)) return null;           // page has no strip — fine
    STRIP_RE.lastIndex = 0;
    let ok = true;
    const out = src.replace(STRIP_RE, (m, service) => {
      if (!(service in SERVICES)) {
        console.error(`FATAL: docs/services/${f}: OURWORK-STRIP service="${service}" is not one of ${Object.keys(SERVICES).join('|')}`);
        ok = false;
        return m;
      }
      stripCount++;
      return `<!-- OURWORK-STRIP-START service="${service}" -->\n${stripBlock(service)}\n<!-- OURWORK-STRIP-END -->`;
    });
    if (!ok) process.exit(1);
    return out;
  }, false);
}

// 3. Derived homeowner-wall manifest
{
  const rel = path.relative(ROOT, WALL);
  const cur = existsSync(WALL) ? readFileSync(WALL, 'utf8') : '';
  if (cur !== wallJson) {
    if (CHECK) stale.push(rel);
    else writeFileSync(WALL, wallJson);
  }
}

if (CHECK) {
  if (!stale.length) {
    console.log(`build-projects --check: ${live.length} live project(s), ${stripCount} hub strip(s) — all stamped surfaces clean.`);
    process.exit(0);
  }
  console.error(`build-projects --check: stale generated surfaces vs assets/data/projects.json:
${stale.map((s) => `  - ${s}`).join('\n')}
The OURWORK-* regions and homeowner-wall.json are GENERATED. Edit docs/assets/data/projects.json, then run:
  node scripts/build-projects.mjs
and commit ALL stamped files.`);
  process.exit(1);
}

console.log(`OK: ${live.length} live project(s) stamped — gallery + schema in docs/our-work.html, ${stripCount} hub strip(s), homeowner-wall.json (${Math.min(live.length, 12)} entries)${all.length - live.length ? ` (${all.length - live.length} staged for a future date)` : ''}`);
