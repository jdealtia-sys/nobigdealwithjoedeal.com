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

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'docs', 'assets', 'data', 'projects.json');
const HTML = path.join(ROOT, 'docs', 'our-work.html');
const SERVICES_DIR = path.join(ROOT, 'docs', 'services');
const WALL = path.join(ROOT, 'docs', 'assets', 'data', 'homeowner-wall.json');
// /our-work/<slug>.html — a FLAT file, deliberately, not a directory with its
// own index.html: this repo's cleanUrls resolves /our-work/<slug> straight to
// that file with no directory-index relative-path ambiguity to worry about.
const PROJECT_DIR = path.join(ROOT, 'docs', 'our-work');
const CHECK = process.argv.includes('--check');

// Key = /services/<key>.html hub page = filter value = strip target.
// Order = filter-button order on /our-work.
const SERVICES = {
  'roof-replacement': 'Roof Replacement',
  'roof-repair': 'Roof Repair',
  'siding-replacement': 'Siding Replacement',
  'siding-repair': 'Siding Repair',
  'wood-siding-repair': 'Wood Siding Repair',
  'shed-roof-replacement': 'Sheds & Outbuildings',
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

// The second filter axis (2026-09-08). services[] answers "what trade" — this
// answers "what kind of job story", which services[] can't: a storm claim and
// a same-day repair can both be roof-replacement. tag is now a KEY into this
// map (was free text; every live entry was migrated 2026-09-08), same pattern
// as SERVICES — one list drives both the badge label and the filter button.
const TAGS = {
  'full-replacement': 'Full Replacement',
  'storm-hail': 'Storm & Hail',
  'warranty-claim': 'Warranty Claim',
  commercial: 'Commercial',
  'metal-specialty': 'Metal & Specialty',
  craftsmanship: 'Craftsmanship',
  'small-same-day': 'Small & Same-Day',
  'inspection-docs': 'Inspection & Documentation',
  'active-jobsite': 'Active Jobsite',
};

const KNOWN_FIELDS = new Set([
  'slug', 'title', 'category', 'services', 'tag', 'city', 'description',
  'hero', 'photos', 'consentOnFile', 'published', 'priceLow', 'priceHigh',
  'year', 'duration', 'featured',
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
  if (p.tag != null && !(p.tag in TAGS)) fail(`${at}: tag "${p.tag}" is not one of ${Object.keys(TAGS).join('|')} — tag is a controlled filter key now, not free text`);
  if (p.featured != null && typeof p.featured !== 'boolean') fail(`${at}: featured must be true/false when present`);
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
// Featured first, then newest first; Array.prototype.sort is stable, so
// same-date (and same-featured-state) entries keep their curated manifest
// order. New entries are appended at the END of projects.json and still
// render first within their featured tier.
live.sort((a, b) => {
  const f = (b.featured ? 1 : 0) - (a.featured ? 1 : 0);
  return f !== 0 ? f : new Date(b.published) - new Date(a.published);
});

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
  const featuredBadge = p.featured ? `<span class="project-featured-badge">&#9733; Featured</span>` : '';
  return `      <div class="project" data-services="${esc(p.services.join(' '))}" data-tag="${esc(p.tag)}" data-slug="${esc(p.slug)}" data-project="${esc(JSON.stringify(payload))}">
        ${heroImg(p, 'project-img')}
        <div class="project-body">
          <span class="project-tag">${esc(TAGS[p.tag])}</span>${featuredBadge}
          <h3><a href="/our-work/${esc(p.slug)}">${esc(p.title)}</a></h3>${price ? `
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

// Second filter row — job-story tag (2026-09-08). Independent of the service
// filter; our-work.js ANDs the two. Only tags actually in use get a button.
const activeTags = Object.keys(TAGS).filter((t) => live.some((p) => p.tag === t));
const tagFilters = [
  `      <button class="filter-btn active" data-tag="all">All Stories</button>`,
  ...activeTags.map((t) => `      <button class="filter-btn" id="tag-${t}" data-tag="${t}">${esc(TAGS[t])}</button>`),
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

    <div class="filters tag-filters">
${tagFilters}
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
        <span class="project-tag">${esc(TAGS[p.tag])}</span>
        <h3>${esc(p.title)}</h3>${price ? `
        <div class="project-price">${esc(price)}</div>` : ''}
        <div class="project-meta"><span class="project-loc">${PIN_SVG} ${esc(p.city)}</span></div>
      </div>
    </a>`;
};

const stripBlock = (service) => {
  const label = SERVICES[service];
  // Count BEFORE the cap: the provenance comment is what a future session reads to
  // decide whether a strip is showing everything, so it has to name what was left out.
  const all = live.filter((p) => p.services.includes(service));
  const matches = all.slice(0, STRIP_MAX);
  const newest = matches.length ? matches.map((p) => p.published).sort().at(-1) : null;
  const capped = all.length > matches.length ? ` (${all.length} carry this service; ${all.length - matches.length} not shown, STRIP_MAX=${STRIP_MAX})` : '';
  const header = `<!-- generated by build-projects.mjs from assets/data/projects.json — do not hand-edit; ${matches.length} live ${service} project(s)${capped}${newest ? `, newest published ${newest}` : ''} -->`;
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

// ── Per-project detail pages (docs/our-work/<slug>.html) ────────
// A dedicated, crawlable, shareable page per job — the card/lightbox on
// /our-work stays the fast-browse view; this is the "send someone the link
// to just this job" view. Uses the SAME nbd:partial markers as every other
// page (scripts/apply-partials.js owns everything between them — run it
// after this script so the stub markers below get real nav/footer chrome).
const relatedFor = (p) => live
  .filter((o) => o.slug !== p.slug && o.services.some((s) => p.services.includes(s)))
  .slice(0, 3);

// Every homeowner page on this site carries the SAME pile of hand-inlined
// "injected" <style> blocks (nav flex layout, dropdown, footer contrast,
// typography, nav-responsive-fix, readability) — nbd-nav.css's own header
// comment documents that this is drift (233 copies, 6 mobile-nav variants)
// but the base nav/footer rules have not actually been centralised yet, so a
// NEW page that skips them renders an unstyled, un-collapsed nav. Copied
// verbatim from docs/our-work.html (2026-08-10 restore) rather than
// reinventing a subset — this is the proven-working version, and detail
// pages are siblings of that page, not a new template family.
const PAGE_CHROME_CSS = `<style>
:root{--navy:#1a3057;--navy-dark:#12223d;--orange:#bd5728;--orange-light:#dd875f;--orange-dark:#a14a22;--white:#fff;--off-white:#f5f3ef;--gray:#5d6673;--light-gray:#e8e5e0;--success:#22a06b}
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Montserrat',sans-serif;color:var(--navy-dark);background:var(--white)}
a{text-decoration:none}

/* NAV */
nav{background:var(--navy-dark);padding:0 40px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:1000;height:70px;box-shadow:0 2px 20px rgba(0,0,0,.4);border-bottom:3px solid var(--orange)}
.nav-logo{display:flex;align-items:center;gap:10px;text-decoration:none}.nav-logo img{height:42px;border-radius:6px}
.nav-logo-text .brand{font-size:1rem;font-weight:800;color:white}.nav-logo-text .sub{font-size:.7rem;color:rgba(255,255,255,.6)}
.nav-links{display:flex;list-style:none;gap:24px;align-items:center}.nav-links > li > a,.nav-links a{color:rgba(255,255,255,.85);text-decoration:none;font-size:.76rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.nav-cta{background:#BD5728;color:white!important;padding:8px 20px;border-radius:6px;font-weight:700!important}
.hamburger{display:none;flex-direction:column;gap:6px;cursor:pointer;padding:10px;background:transparent;border:none;z-index:1001}.hamburger span{display:block;width:26px;height:3px;background:#fff;border-radius:2px;transition:all .3s;box-shadow:0 1px 3px rgba(0,0,0,.3)}

/* CTA */
.cta-section{background:var(--navy-dark);text-align:center;padding:64px 40px;position:relative}
.cta-section::before{content:'';position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,var(--orange),var(--orange-light))}
.cta-section h2{font-family:'Bebas Neue',sans-serif;font-size:2.2rem;color:white;margin-bottom:12px}.cta-section h2 span{color:#BD5728}
.cta-section p{color:rgba(255,255,255,.7);font-size:.9rem;margin-bottom:24px}
.btn-primary{background:#BD5728;color:white;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:.88rem;display:inline-flex;align-items:center;gap:8px;transition:all .2s}
.btn-primary:hover{background:#A14A22;transform:translateY(-1px)}

/* FOOTER */
footer{background:var(--navy-dark);border-top:3px solid var(--orange);padding:40px;text-align:center}
footer p{color:rgba(255,255,255,.5);font-size:.75rem;line-height:1.7}footer a{color:var(--orange-light);text-decoration:none}

/* RESPONSIVE */
@media(max-width:768px){
  nav{padding:0 16px;height:60px}.nav-links{display:none}.hamburger{display:flex}
  .cta-section{padding:40px 20px}
}
@media print {
  .ann-bar, nav, .mobile-nav, .cta-float, .footer-cta, footer .social { display: none !important; }
  body { background: #fff !important; color: #000 !important; }
  a[href]:after { content: " (" attr(href) ")"; font-size: 9px; color: #666; }
  a[href^="#"]:after, a[href^="tel"]:after, a[href^="javascript"]:after { content: ""; }
  section { page-break-inside: avoid; }
  @page { margin: 0.75in; }
}
</style>
<link rel="stylesheet" href="/assets/css/project-cards.css?v=1">
<style>
/* nav base (injected) */
.nav-links .dropdown{position:relative}
.nav-links .dropdown-menu{display:none;position:absolute;top:100%;left:0;background:var(--navy-dark,#12223d);border:2px solid var(--orange,#bd5728);border-top:none;min-width:230px;border-radius:0 0 8px 8px;padding:8px 0;z-index:999;list-style:none;margin:0}
.nav-links .dropdown:hover .dropdown-menu,.nav-links .dropdown:focus-within .dropdown-menu,.nav-links .dropdown.open .dropdown-menu{display:block}
.nav-links .dropdown-menu a{display:block;padding:10px 18px;font-size:.75rem;border-bottom:1px solid rgba(255,255,255,.08);color:rgba(255,255,255,.85);text-decoration:none;letter-spacing:.06em;text-transform:uppercase;font-weight:600;transition:color .2s,background .2s}
.nav-links .dropdown-menu a:last-child{border-bottom:none}
.nav-links .dropdown-menu a:hover{color:var(--orange-light,#dd875f);background:rgba(255,255,255,.04);border-bottom-color:rgba(255,255,255,.08)}
.mobile-nav{display:none;position:fixed;top:70px;left:0;right:0;background:var(--navy-dark,#12223d);z-index:999;border-top:2px solid var(--orange,#bd5728);max-height:calc(100vh - 70px);overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,.4);padding-top:0}
.mobile-nav.open{display:block}
.mobile-nav > a{display:block;padding:12px 24px;color:rgba(255,255,255,.85);text-decoration:none;font-size:.82rem;font-weight:600;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,.06)}
.mobile-nav > a:hover{color:var(--orange-light,#dd875f);background:rgba(255,255,255,.04)}
.hamburger{display:none;flex-direction:column;gap:6px;cursor:pointer;padding:10px;background:transparent;border:none;z-index:1001}
.hamburger span{display:block;width:26px;height:3px;background:#fff;border-radius:2px;transition:all .3s;box-shadow:0 1px 3px rgba(0,0,0,.3)}
@media (max-width:1024px){.nav-links{display:none}.hamburger{display:flex}}
</style>
<style>
/* footer contrast fix (injected) */
footer .label{color:rgba(255,255,255,.72)!important;font-weight:700}
footer .footer-col ul li a{color:rgba(255,255,255,.82)!important}
footer .footer-col ul li a:hover{color:var(--orange,#bd5728)!important}
footer .footer-contact-item .val,footer .footer-contact-item .val a{color:rgba(255,255,255,.9)!important}
footer p{color:rgba(255,255,255,.7)!important}
footer .footer-desc{color:rgba(255,255,255,.72)!important}
footer .footer-bottom p{color:rgba(255,255,255,.55)!important}
footer .footer-bottom a{color:rgba(255,255,255,.65)!important}
footer .footer-bottom a:hover{color:var(--orange,#bd5728)!important}
footer .pro-door{color:rgba(255,255,255,.65)!important}
footer .pro-door:hover{color:var(--orange,#bd5728)!important}
</style>
<style>
/* nav-logo text color (injected) */
nav .nav-logo-text .brand{color:#fff!important}
nav .nav-logo-text .sub{color:rgba(255,255,255,.6)!important}
nav .nav-logo{text-decoration:none}
</style>
<style>
/* nav-logo layout (injected) */
nav .nav-logo{display:flex!important;align-items:center!important;gap:10px!important;text-decoration:none!important;flex-shrink:0}
nav .nav-logo img{height:42px;width:auto;border-radius:6px;flex-shrink:0}
nav .nav-logo-text{display:flex;flex-direction:column;line-height:1.15}
</style>
<style>
/* typography normalize (injected) */
body{font-family:'Montserrat','Segoe UI',-apple-system,sans-serif;color:#1a1a1a;-webkit-font-smoothing:antialiased}
h1,h2,h3{font-family:'Bebas Neue','Montserrat',sans-serif;letter-spacing:.03em;line-height:1.1}
h1{font-size:clamp(2.5rem,4.8vw,4.5rem);line-height:1.04;letter-spacing:.02em}
h2{font-size:clamp(1.8rem,3.1vw,2.75rem)}
h3{font-size:clamp(1.05rem,1.4vw,1.3rem);line-height:1.25}
p{font-size:.95rem;line-height:1.72;color:#4a4a4a}
.prose p,.post-body p,article p{font-size:.95rem;line-height:1.72}
.nav-links > li > a,.nav-links a{font-size:.76rem;letter-spacing:.08em;font-weight:600}
a.nav-cta,nav .nav-cta{font-size:.8rem!important;letter-spacing:.05em;font-weight:700!important}
</style>
<style>
/* nbd-social-v1 */
.nbd-social{display:inline-flex;gap:10px;align-items:center;margin-left:14px;vertical-align:middle}
.nbd-social a{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.08);color:rgba(255,255,255,.85);text-decoration:none!important;transition:transform .2s,background .2s,color .2s}
.nbd-social a:hover{transform:translateY(-2px);color:#fff}
.nbd-social a.s-fb:hover{background:#1877f2}
.nbd-social a.s-ig:hover{background:linear-gradient(45deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)}
.nbd-social a.s-gg:hover{background:#4285f4}
.nbd-social a.s-yelp:hover{background:#d32323}
.nbd-social svg{width:15px;height:15px;display:block}
@media(max-width:640px){.nbd-social{margin-left:0;margin-top:8px;display:flex;gap:8px}}
footer.foot .nbd-social a,.review-footer .nbd-social a{background:rgba(255,255,255,.1)}
</style>
<style>
/* nav-responsive-fix v3 */
@media(max-width:1024px){
  nav .nav-links{display:none!important}
  nav .hamburger,nav button.hamburger{display:flex!important}
  nav{padding-left:20px!important;padding-right:20px!important}
}
@media(min-width:1025px) and (max-width:1440px){
  nav{padding-left:24px!important;padding-right:24px!important}
  nav .nav-links{gap:14px!important}
  nav .nav-links > li > a{font-size:.7rem!important;letter-spacing:.05em!important;padding:4px 0!important}
  nav .nav-cta{padding:8px 14px!important;font-size:.7rem!important}
  nav .nav-logo img{height:36px!important}
  nav .nav-logo-text .brand{font-size:.9rem!important}
  nav .nav-logo-text .sub{font-size:.62rem!important}
  nav .nav-logo{margin-right:12px!important}
}
</style>
<style>
/* nbd-readability-v2 */
html{font-size:16px}
body{font-size:1rem;line-height:1.65;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
main p,section p,article p,.sec-desc,.hiw-body{font-size:1rem!important;line-height:1.7!important}
.sc-body{font-size:.97rem!important;line-height:1.65!important;color:#4b5563!important}
main h2,section h2,article h2{font-size:clamp(1.8rem,3vw,2.6rem)!important;line-height:1.1!important}
main h3,section h3,article h3{font-size:clamp(1.05rem,1.35vw,1.3rem)!important;line-height:1.3!important}
footer .footer-desc,footer .footer-links a,footer .footer-col ul li a,footer p,footer li{font-size:.92rem!important;line-height:1.65!important}
footer .footer-desc{color:rgba(255,255,255,.82)!important}
footer .footer-col-title,footer h4,footer .label{font-size:.72rem!important;letter-spacing:.14em!important;text-transform:uppercase!important;color:rgba(255,255,255,.95)!important;font-weight:800!important;margin-bottom:14px!important}
footer .footer-bottom,footer .footer-bottom p,footer .footer-bottom a,footer .pro-door{font-size:.82rem!important;line-height:1.6!important}
footer .footer-bottom a{color:rgba(255,255,255,.7)!important}
footer .footer-bottom a:hover{color:#bd5728!important}
footer.foot,.review-footer{font-size:.9rem!important;padding:24px 5%!important;line-height:1.6!important}
footer.foot a,.review-footer a{color:#bd5728!important}
.ann-bar{font-size:.8rem!important;letter-spacing:.04em!important}
@media(max-width:640px){.ann-bar{font-size:.72rem!important;padding:10px 14px!important;min-height:40px!important}}
@media(min-width:1441px){
  nav{padding-left:40px!important;padding-right:40px!important}
  nav .nav-logo{margin-right:28px!important}
  nav .nav-links{gap:22px!important}
  nav .nav-links > li > a{font-size:.78rem!important;letter-spacing:.07em!important}
}
@media(min-width:1600px){
  nav{padding-left:56px!important;padding-right:56px!important}
  nav .nav-links{gap:28px!important}
}
</style>`;

const detailPage = (p) => {
  const price = priceLine(p);
  const title = `${p.title} | Our Work | NBD`;
  const desc = p.description.length > 155 ? `${p.description.slice(0, 152)}…` : p.description;
  const heroAbs = `${ORIGIN}${p.hero}`;
  const pageUrl = `${ORIGIN}/our-work/${p.slug}`;

  const ldSchema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'RoofingContractor', '@id': `${ORIGIN}/#org`, name: 'No Big Deal Home Solutions',
        alternateName: 'No Big Deal with Joe Deal', url: ORIGIN, telephone: '+18594207382', email: 'jd@nobigdealwithjoedeal.com',
      },
      {
        '@type': 'BreadcrumbList', '@id': `${pageUrl}#breadcrumbs`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: `${ORIGIN}/` },
          { '@type': 'ListItem', position: 2, name: 'Our Work', item: `${ORIGIN}/our-work` },
          { '@type': 'ListItem', position: 3, name: p.title, item: pageUrl },
        ],
      },
      {
        '@type': 'Service', '@id': `${pageUrl}#service`,
        name: p.title, serviceType: SERVICES[p.services[0]], provider: { '@id': `${ORIGIN}/#org` },
        areaServed: p.city, description: p.description, image: heroAbs,
        ...(price ? { offers: { '@type': 'AggregateOffer', lowPrice: p.priceLow, highPrice: p.priceHigh, priceCurrency: 'USD' } } : {}),
      },
    ],
  };

  const galleryHtml = p.photos.map((ph) => {
    const webp = webpFor(ph.src);
    const img = `<img src="${esc(ph.src)}" alt="${esc(ph.alt)}" loading="lazy" decoding="async" width="800" height="600">`;
    return `      <figure class="detail-photo">${webp ? `<picture><source srcset="${esc(webp)}" type="image/webp">${img}</picture>` : img}
        <figcaption>${esc(ph.alt)}</figcaption>
      </figure>`;
  }).join('\n');

  const pills = p.services.map((s) => `<a href="/services/${s}">${esc(SERVICES[s])}</a>`).join('\n          ');
  const meta = [
    `<span class="project-loc">${PIN_SVG} ${esc(p.city)}</span>`,
    p.year ? `<span>${esc(String(p.year))}</span>` : null,
    p.duration ? `<span>${esc(p.duration)}</span>` : null,
  ].filter(Boolean).join(' <span class="project-dot">·</span> ');
  const featuredBadge = p.featured ? `<span class="project-featured-badge">&#9733; Featured</span>` : '';

  const related = relatedFor(p);
  const relatedHtml = related.length ? `
<div class="detail-related">
  <h2>More ${esc(SERVICES[p.services[0]].toLowerCase())} projects</h2>
  <div class="gallery">
${related.map((r) => {
    const rp = priceLine(r);
    return `      <a class="project project-link" href="/our-work/${esc(r.slug)}">
        ${heroImg(r, 'project-img')}
        <div class="project-body">
          <span class="project-tag">${esc(TAGS[r.tag])}</span>
          <h3>${esc(r.title)}</h3>${rp ? `
          <div class="project-price">${esc(rp)}</div>` : ''}
          <div class="project-meta"><span class="project-loc">${PIN_SVG} ${esc(r.city)}</span></div>
        </div>
      </a>`;
  }).join('\n\n')}
  </div>
</div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-8PG7N9Q3DL"></script>
<script defer  src="/assets/js/inline/2a90205f1b.js"></script>
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:image" content="${esc(heroAbs)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(heroAbs)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/assets/images/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/css/nbd-fonts.css">
<script type="application/ld+json">${JSON.stringify(ldSchema)}</script>
${PAGE_CHROME_CSS}
<link rel="stylesheet" href="/assets/css/nbd-mobile.css">
<script src="/assets/js/nav-faq.js" defer></script>
<link rel="stylesheet" href="/assets/css/mobile-cta.css">
<link rel="stylesheet" href="/assets/css/project-carousel.css">
<style>.nbd-skip{position:absolute;left:-9999px;top:0;z-index:100000;background:#BD5728;color:#fff;padding:10px 16px;font-weight:700;text-decoration:none;border-radius:0 0 6px 0}.nbd-skip:focus{left:0}</style>
<style>
nav .nav-logo-text .brand{white-space:nowrap}
nav .nav-logo-text .sub{white-space:nowrap}
@media(max-width:768px){
  nav .nav-logo img{height:36px!important}
  nav .nav-logo-text .brand{font-size:.9rem!important}
  nav .nav-logo-text .sub{font-size:.62rem!important}
}
</style>
<link rel="stylesheet" href="/assets/css/nbd-icons.css">
<style>
.crumbs{max-width:1100px;margin:20px auto 0;padding:0 24px;font-size:.8rem;color:var(--gray)}
.crumbs a{color:var(--gray)}.crumbs a:hover{color:var(--orange)}
.detail-hero{max-width:1100px;margin:16px auto 0;padding:0 24px}
.detail-hero img{width:100%;max-height:520px;object-fit:cover;border-radius:14px;display:block}
.detail-head{max-width:1100px;margin:24px auto 0;padding:0 24px}
.detail-head h1{font-family:'Bebas Neue',sans-serif;font-size:2.4rem;letter-spacing:.5px;color:var(--navy-dark);margin-top:6px}
.detail-price{font-family:'Bebas Neue',sans-serif;font-size:1.6rem;color:#A14A22;margin:6px 0}
.detail-desc{max-width:760px;font-size:1rem;line-height:1.7;color:var(--gray);margin-top:14px}
.detail-gallery{max-width:1100px;margin:32px auto 0;padding:0 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px}
.detail-photo img{width:100%;height:220px;object-fit:cover;border-radius:10px;display:block}
.detail-photo figcaption{font-size:.78rem;color:var(--gray);margin-top:6px;line-height:1.4}
.detail-related{max-width:1100px;margin:52px auto 0;padding:0 24px}
.detail-related h2{font-size:1.1rem;color:var(--navy-dark);margin-bottom:16px}
.detail-related .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px}
.back-link{display:inline-block;margin:28px 24px 0;font-size:.85rem;font-weight:700;color:var(--orange)}
/* .cta-section / .btn-primary come from the copied page-chrome bundle above —
   same CTA look as every other page, not a bespoke one here. */
</style>
</head>
<body><a class="nbd-skip" href="#main">Skip to content</a>
<!-- nbd:partial nav-standard cta_href="/#contact" -->
<!-- /nbd:partial nav-standard -->
<main id="main">
<!-- nbd:partial mobile-nav-standard cta_href="/#contact" -->
<!-- /nbd:partial mobile-nav-standard -->

<!-- a <div>, not <nav> — a bare nav{...} tag selector styles the sitewide
     header navy/sticky/70px, and every homeowner page defines one; a second
     <nav> anywhere on the page inherits it. role="navigation" keeps the a11y
     semantics without the tag-selector collision. -->
<div class="crumbs" role="navigation" aria-label="Breadcrumb">
  <a href="/">Home</a> &rsaquo; <a href="/our-work">Our Work</a> &rsaquo; <span>${esc(p.title)}</span>
</div>

<div class="detail-hero">${heroImg(p, '')}</div>

<div class="detail-head">
  <span class="project-tag">${esc(TAGS[p.tag])}</span>${featuredBadge}
  <h1>${esc(p.title)}</h1>
  ${price ? `<div class="detail-price">${esc(price)}</div>` : ''}
  <div class="project-meta">${meta}</div>
  <p class="detail-desc">${esc(p.description)}</p>
  <div class="project-services" style="margin-top:16px">
    ${pills}
  </div>
</div>

<div class="detail-gallery">
${galleryHtml}
</div>
${relatedHtml}

<a class="back-link" href="/our-work">&larr; See all our work</a>

<section class="cta-section">
  <h2>Ready to Start <span>Your Project?</span></h2>
  <p>Free inspections. Honest quotes. Quality work guaranteed. Every job drone-documented.</p>
  <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
    <a href="tel:+18594207382" class="btn-primary">Call Joe: (859) 420-7382</a>
    <a href="/estimate" class="btn-primary" style="background:transparent;border:2px solid var(--orange)">Instant Estimate</a>
  </div>
</section>

</main>
<!-- nbd:partial footer-standard crumb_service_href="/our-work" crumb_service_name="Our Work" crumb_city_href="/areas" crumb_city_name="${esc(p.city)}" -->
<!-- /nbd:partial footer-standard -->
<div class="mobile-cta-strip" aria-label="Quick contact options">
  <a href="tel:+18594207382" class="mobile-cta-call">Call Joe</a>
  <a href="sms:+18594207382" class="mobile-cta-text">Text Joe</a>
</div>
</body></html>
`;
};

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

// EOL DISCIPLINE — the stamped pages are CRLF in a Windows worktree (autocrlf)
// and LF on CI, while every block rendered above is LF. Stamping LF into a CRLF
// page makes `out === src` false forever: --check exited 1 on every clean
// Windows checkout for line endings alone (an always-red gate everyone learns
// to ignore), and --write rewrote 10 files as pure ending churn. Render in LF,
// then emit with the destination's own ending — scripts/apply-partials.js:201
// is the same three steps, and is why that generator alone passes here.
const toEol = (s, eol) => (eol === '\n' ? s : s.replace(/\n/g, eol));

const stampFile = (file, transform, required) => {
  const rel = path.relative(ROOT, file);
  const src = readFileSync(file, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const out = transform(src, eol);
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
stampFile(HTML, (src, eol) => {
  const reStatic = /<!-- OURWORK-STATIC-START -->[\s\S]*?<!-- OURWORK-STATIC-END -->/;
  const reSchema = /<!-- OURWORK-HEAD-SCHEMA-START -->[\s\S]*?<!-- OURWORK-HEAD-SCHEMA-END -->/;
  if (!reStatic.test(src) || !reSchema.test(src)) return null;
  // Callback form on purpose — $-sequences in titles would corrupt output.
  return src
    .replace(reStatic, () => toEol(staticBlock, eol))
    .replace(reSchema, () => toEol(schemaBlock, eol));
}, true);

// 2. Every /services/ page that carries a strip marker
let stripCount = 0;
for (const f of readdirSync(SERVICES_DIR)) {
  if (!f.endsWith('.html')) continue;
  const file = path.join(SERVICES_DIR, f);
  stampFile(file, (src, eol) => {
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
      return toEol(`<!-- OURWORK-STRIP-START service="${service}" -->\n${stripBlock(service)}\n<!-- OURWORK-STRIP-END -->`, eol);
    });
    if (!ok) process.exit(1);
    return out;
  }, false);
}

// 2b. Per-project detail pages — one flat file per live project.
//
// These pages carry nbd:partial markers (nav-standard, mobile-nav-standard,
// footer-standard) that scripts/apply-partials.js owns, same as every other
// page on the site — this script must never fight it for that content. A
// freshly-rendered page emits EMPTY stub markers (apply-partials.js fills
// them on the next run); on a re-render of an EXISTING page, reuse whatever
// is already stamped inside each marker verbatim, UNLESS this render's own
// opening-tag attributes changed (e.g. projects.json's city field moved,
// which changes footer-standard's crumb_city_name) — in that case fall back
// to the fresh empty stub so a human re-run of apply-partials.js re-stamps
// it with the new attributes, exactly the documented two-step flow.
const PARTIAL_NAMES = ['nav-standard', 'mobile-nav-standard', 'footer-standard'];
const partialBlockRe = (name) => new RegExp(`<!-- nbd:partial ${name}[^>]*-->[\\s\\S]*?<!-- /nbd:partial ${name} -->`);
const openTagOf = (block) => block.split('-->')[0] + '-->';
const preserveStampedPartials = (freshHtml, priorHtml) => {
  if (!priorHtml) return freshHtml;
  let out = freshHtml;
  for (const name of PARTIAL_NAMES) {
    const re = partialBlockRe(name);
    const freshMatch = re.exec(out);
    const priorMatch = re.exec(priorHtml);
    if (!freshMatch || !priorMatch) continue;
    if (openTagOf(freshMatch[0]) === openTagOf(priorMatch[0])) {
      out = out.slice(0, freshMatch.index) + priorMatch[0] + out.slice(freshMatch.index + freshMatch[0].length);
    }
  }
  return out;
};

let detailCount = 0;
if (!existsSync(PROJECT_DIR)) { if (!CHECK) mkdirSync(PROJECT_DIR, { recursive: true }); }
const liveSlugFiles = new Set(live.map((p) => `${p.slug}.html`));
for (const p of live) {
  const file = path.join(PROJECT_DIR, `${p.slug}.html`);
  const exists = existsSync(file);
  const cur = exists ? readFileSync(file, 'utf8') : '';
  const eol = cur.includes('\r\n') ? '\r\n' : '\n';
  const rendered = preserveStampedPartials(toEol(detailPage(p), eol), cur);
  if (cur.replace(/\r\n/g, '\n') !== rendered.replace(/\r\n/g, '\n')) {
    if (CHECK) stale.push(path.relative(ROOT, file));
    else writeFileSync(file, rendered);
  }
  detailCount++;
}
// Stale-file check: a project that was removed/unpublished leaves an orphan
// page nothing links to. Never auto-delete (could destroy a Jo hand-edit);
// just name it the same way the unknown-field warn does.
if (existsSync(PROJECT_DIR)) {
  for (const f of readdirSync(PROJECT_DIR)) {
    if (f.endsWith('.html') && !liveSlugFiles.has(f)) {
      console.warn(`WARN: docs/our-work/${f} has no matching live project in projects.json — orphaned detail page, remove it manually if the job was pulled`);
    }
  }
}

// 3. Derived homeowner-wall manifest
{
  const rel = path.relative(ROOT, WALL);
  const cur = existsSync(WALL) ? readFileSync(WALL, 'utf8') : '';
  // Same EOL discipline as stampFile above. A file that does not exist yet gets
  // LF, which is what the index stores and what CI checks out.
  const eol = cur.includes('\r\n') ? '\r\n' : '\n';
  if (cur.replace(/\r\n/g, '\n') !== wallJson) {
    if (CHECK) stale.push(rel);
    else writeFileSync(WALL, toEol(wallJson, eol));
  }
}

if (CHECK) {
  if (!stale.length) {
    console.log(`build-projects --check: ${live.length} live project(s), ${stripCount} hub strip(s), ${detailCount} detail page(s) — all stamped surfaces clean.`);
    process.exit(0);
  }
  console.error(`build-projects --check: stale generated surfaces vs assets/data/projects.json:
${stale.map((s) => `  - ${s}`).join('\n')}
The OURWORK-* regions, docs/our-work/<slug>.html detail pages, and homeowner-wall.json are GENERATED. Edit docs/assets/data/projects.json, then run:
  node scripts/build-projects.mjs
  node scripts/apply-partials.js
and commit ALL stamped files.`);
  process.exit(1);
}

console.log(`OK: ${live.length} live project(s) stamped — gallery + schema in docs/our-work.html, ${stripCount} hub strip(s), ${detailCount} detail page(s) in docs/our-work/, homeowner-wall.json (${Math.min(live.length, 12)} entries)${all.length - live.length ? ` (${all.length - live.length} staged for a future date)` : ''}`);
