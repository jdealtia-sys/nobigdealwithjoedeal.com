/**
 * tests/marketing-polish-contract.test.js — visual-audit sweep contracts
 * (2026-07-19 marketing polish batch 1).
 *
 * The marketing site has no shared chrome layer — consistency is enforced by
 * injection sweeps, and drift = pages a sweep missed (that is exactly how the
 * Fairfield/Lebanon .ico black-blob defect happened). These guards make the
 * batch-1 invariants permanent so a future page/template can't silently fork:
 *
 *  1. .btn-cal:hover background is #B85400 everywhere (white text passes AA;
 *     the old #f08030/#e8720c hovers were 2.68:1 / 3.07:1).
 *  2. No 7px/99px border-radius strays (8px / 100px system).
 *  3. nbd-mobile.css carries the a11y + interaction-polish block
 *     (:focus-visible ring, pressed states, reduced-motion kill switch).
 *  4. The 4 lead-tool pages load nbd-mobile.css (overflow/safe-area guards).
 *  5. Every page using <svg class="ico"> has the .ico sizing CSS (unsized
 *     inline SVG renders as a giant black blob).
 *  6. Every page with a collapsible nav collapses at 1024px (not only a
 *     legacy 900/780px rule).
 *  7. Blog pages all carry the Non-hero heading caps block.
 *  8. The 12 service hubs carry the laptop nav-squeeze block their city
 *     variants have.
 *  9. One-off regressions: privacy favicon, estimate footer separator,
 *     no empty-src <img> on marketing pages.
 *
 * Zero deps. Run: node tests/marketing-polish-contract.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DOCS = path.join(__dirname, '..', 'docs');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

function listHtml(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      const rel = path.relative(DOCS, full).replace(/\\/g, '/');
      if (/^(pro|admin|assets)(\/|$)/.test(rel)) continue;
      listHtml(full, out);
    } else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}
const ALL = listHtml(DOCS);
const rel = (f) => path.relative(DOCS, f).replace(/\\/g, '/');
const marketing = ALL.filter((f) => !/^(sites|tools)\//.test(rel(f)));
const read = (f) => fs.readFileSync(f, 'utf8');

console.log('MARKETING POLISH CONTRACT — batch 1 invariants');

// 1. btn-cal hover
{
  const bad = [];
  for (const f of marketing) {
    const s = read(f);
    const m = s.match(/\.btn-cal:hover\s*\{[^}]*?background:\s*([^;}]+)/g) || [];
    for (const rule of m) {
      if (!/#b85400/i.test(rule)) { bad.push(rel(f)); break; }
    }
  }
  ok('.btn-cal:hover background is #B85400 site-wide', bad.length === 0, bad.slice(0, 4).join(', '));
}

// 2. radius strays
{
  const bad = [];
  const targets = marketing.concat(
    ['quick-lead-form.css', 'blog-midpost-cta.css', 'nbd-mobile.css', 'mobile-cta.css']
      .map((n) => path.join(DOCS, 'assets/css', n)).filter(fs.existsSync)
  );
  for (const f of targets) {
    const s = read(f);
    if (/border-radius:\s*(7|99)px/.test(s)) bad.push(rel(f));
  }
  ok('no 7px/99px border-radius strays', bad.length === 0, bad.slice(0, 4).join(', '));
}

// 3. nbd-mobile a11y block
{
  const s = read(path.join(DOCS, 'assets/css/nbd-mobile.css'));
  ok('nbd-mobile.css has focus ring + pressed states + reduced-motion',
    /:focus-visible\{outline:3px solid #e8720c/.test(s)
    && /\.btn-primary:active/.test(s)
    && /prefers-reduced-motion:reduce/.test(s)
    && /nbdRevealIn/.test(s));
}

// 4. funnel pages load nbd-mobile.css
{
  const bad = ['inspect.html', 'roof-score.html', 'storm-check.html', 'storm-report.html']
    .filter((p) => !read(path.join(DOCS, p)).includes('nbd-mobile.css'));
  ok('lead-tool pages load nbd-mobile.css', bad.length === 0, bad.join(', '));
}

// 5. svg.ico pages have sizing CSS
{
  const bad = [];
  for (const f of marketing) {
    const s = read(f);
    if (!s.includes('class="ico"')) continue;
    if (!/\.ico\{[^}]*width:1em/.test(s)) bad.push(rel(f));
  }
  ok('every svg.ico page has .ico sizing CSS (no black-blob regressions)', bad.length === 0, bad.slice(0, 4).join(', '));
}

// 6. nav collapse at 1024
{
  const bad = [];
  for (const f of marketing) {
    const s = read(f);
    if (!s.includes('nav-links') || !s.includes('hamburger')) continue;
    const legacyOnly = /@media[^{]*max-width:\s*(900|780)px[^{]*\{[^@]*?\.nav-links\s*\{[^}]*display:\s*none/.test(s)
      && !/@media[^{]*max-width:\s*1024px[^{]*\{[\s\S]{0,600}?\.nav-links\s*\{[^}]*display:\s*none/.test(s);
    if (legacyOnly) bad.push(rel(f));
  }
  ok('no page collapses nav only below 1024px', bad.length === 0, bad.slice(0, 4).join(', '));
}

// 7. blog caps coverage
{
  const bad = marketing.filter((f) => rel(f).startsWith('blog/') && !read(f).includes('Non-hero heading caps')).map(rel);
  ok('all blog pages carry the heading-caps block', bad.length === 0, bad.slice(0, 4).join(', '));
}

// 8. hub nav-squeeze
{
  const hubs = ['roof-replacement', 'roof-repair', 'roof-inspection', 'hail-damage-insurance-claim',
    'storm-damage', 'gutter-replacement', 'siding-repair', 'siding-replacement',
    'financing', 'fire-water-smoke-damage', 'roof-care-plan', 'roof-cleaning-soft-wash'];
  const bad = hubs.filter((h) => !read(path.join(DOCS, 'services', h + '.html')).includes('min-width:1025px'));
  ok('all 12 service hubs have the laptop nav-squeeze block', bad.length === 0, bad.join(', '));
}

// 9. one-offs
ok('privacy.html has a favicon', /rel="icon"/.test(read(path.join(DOCS, 'privacy.html'))));
ok('estimate.html footer has no doubled separator',
  !/Solutions &middot;\s*<span style="opacity:\.4">·<\/span>/.test(read(path.join(DOCS, 'estimate.html'))));
{
  const bad = marketing.filter((f) => /<img[^>]+src=""/.test(read(f))).map(rel);
  ok('no empty-src <img> on marketing pages', bad.length === 0, bad.slice(0, 3).join(', '));
}

// 10. Audit-response (2026-07-19 external audit): review markup + funnel link
{
  const s = read(path.join(DOCS, 'review.html'));
  const m = s.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  let j = null;
  try { j = JSON.parse(m[1]); } catch (_) {}
  ok('review.html LocalBusiness carries review[] from on-page cards',
    !!(j && Array.isArray(j.review) && j.review.length >= 3 && j.review[0].author));
  // Deliberate: no fabricated aggregateRating (no truthful count on page).
  ok('review.html schema has NO aggregateRating (honest-count rule)', !(j && j.aggregateRating));
}
ok('free-guide funnel link present in consumer footers (index)',
  /data-nbd-freeguide/.test(read(path.join(DOCS, 'index.html'))));
ok('free-roof page has JSON-LD', /application\/ld\+json/.test(read(path.join(DOCS, 'free-roof/index.html'))));

// 11. Chrome batch 2 (Jo's calls, 2026-07-19)
{
  // Differentiated nav CTAs: no marketing page pairs "Free Estimate" nav
  // button with the Instant Estimate link anymore.
  const bad = marketing.filter((f) => /class="nav-cta">Free Estimate/.test(read(f))).map(rel);
  ok('nav CTA button is "Book Inspection" site-wide (no Free Estimate dupes)', bad.length === 0, bad.slice(0, 3).join(', '));
}
{
  // Cert badges on every city service page.
  const bad = marketing.filter((f) => /^services\/[a-z-]+-(oh|ky)\.html$/.test(rel(f))
    && !read(f).includes('gaf-certified-badge')).map(rel);
  ok('every city service page carries the GAF/TAMKO badge row', bad.length === 0, bad.slice(0, 3).join(', '));
}
{
  // Timberline in the dropdown wherever LumaNail is listed.
  const bad = marketing.filter((f) => {
    const s = read(f);
    return s.includes('/services/lumanail') && !s.includes('/services/gaf-timberline');
  }).map(rel);
  ok('GAF Timberline dropdown link everywhere LumaNail is listed', bad.length === 0, bad.slice(0, 3).join(', '));
}
{
  // Hub closers on the site-majority navy.
  const bad = marketing.filter((f) => /^services\/[a-z-]+\.html$/.test(rel(f))
    && /\.final-cta\s*\{\s*background:#B85400/.test(read(f))).map(rel);
  ok('no hub keeps the solid-orange closing band', bad.length === 0, bad.join(', '));
}
{
  // Reviews widget on all 12 hubs.
  const hubs = ['roof-replacement', 'roof-repair', 'roof-inspection', 'hail-damage-insurance-claim',
    'storm-damage', 'gutter-replacement', 'siding-repair', 'siding-replacement',
    'financing', 'fire-water-smoke-damage', 'roof-care-plan', 'roof-cleaning-soft-wash'];
  const bad = hubs.filter((h) => !fs.readFileSync(path.join(DOCS, 'services', h + '.html'), 'utf8').includes('google-reviews-widget'));
  ok('google-reviews widget on all 12 service hubs', bad.length === 0, bad.join(', '));
}

// ────────────────────────────────────────────────────────────────────────────
// BATCH 3 (2026-07-20) — cert bar sweep, nav canon, hub lead capture, chrome
// gaps. Same rationale as above: no shared chrome layer, so every one of these
// is a sweep result that a new page or a hand-edit can silently fork away from.
// ────────────────────────────────────────────────────────────────────────────
console.log('\nMARKETING POLISH CONTRACT — batch 3 invariants');

const HUBS = ['roof-replacement', 'roof-repair', 'roof-inspection', 'hail-damage-insurance-claim',
  'storm-damage', 'gutter-replacement', 'siding-repair', 'siding-replacement',
  'financing', 'fire-water-smoke-damage', 'roof-care-plan', 'roof-cleaning-soft-wash'];

// Pages the add-footer-cert-bar.js sweep targets: city service pages + area pages.
const certBarTargets = marketing.filter((f) => /^services\/[a-z0-9-]+-(oh|ky)\.html$/.test(rel(f))
  || (/^areas\/[a-z0-9-]+\.html$/.test(rel(f)) && rel(f) !== 'areas/index.html'));

{
  // 1. Footer cert bar present on every swept city + area page.
  const bad = certBarTargets.filter((f) => !read(f).includes('data-nbd-certbar="v1"')).map(rel);
  ok('footer cert bar on every city service + area page', bad.length === 0,
    `${bad.length} missing: ` + bad.slice(0, 3).join(', '));
}
{
  // 2. Injected exactly once — a re-run of the idempotent sweep must not double-insert.
  const bad = certBarTargets.filter((f) => read(f).split('data-nbd-certbar="v1"').length - 1 > 1).map(rel);
  ok('cert bar injected exactly once per page', bad.length === 0, bad.slice(0, 3).join(', '));
}
{
  // 3. Cert bar carries both verify links + the full independent-contractor
  //    disclaimer with the license IDs (the legal reason the bar exists).
  const bad = certBarTargets.filter((f) => {
    const s = read(f);
    return !(s.includes('gaf-certified-badge-120.png') && s.includes('tamko-pro-gold-badge-120.png')
      && s.includes('GAF ID 1162011') && s.includes('TAMKO Pro ID 181382')
      && s.includes('Independent Contractor'));
  }).map(rel);
  ok('cert bar carries both badges + IDs + disclaimer', bad.length === 0, bad.slice(0, 3).join(', '));
}
{
  // 4. CERT CLAIM GUARD — Joe is GAF Certified (System Plus) and TAMKO only.
  //    "Master Elite" is a higher GAF tier he does NOT hold; he holds no Owens
  //    Corning certification at all. Both names legitimately appear as honest
  //    prose — the-nbd-guarantee explicitly disclaims Master Elite, and the
  //    shingle-comparison blog says outright "I'm not one of them" about OC's
  //    network — so a bare name match is NOT the defect. The defect is an
  //    affirmative self-claim, so match claim verbs and drop negated sentences.
  const CLAIM = /\b(we are|we're|i am|i'm|as an?|proud(?:ly)?)\s+(?:an?\s+)?(?:[a-z]+\s+){0,3}(master.?elite|owens.?corning)[^.<>]{0,40}(certified|certification|contractor|preferred|platinum|elite)/i;
  const NEG = /\b(not|isn'?t|aren'?t|never|don'?t|doesn'?t|separate|different)\b/i;
  const bad = marketing.filter((f) => {
    // Sentence-level so a disclaimer elsewhere on the page can't mask a claim,
    // and a negation inside the sentence correctly clears it.
    const text = read(f).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    return text.split(/(?<=[.!?])\s+/).some((sent) => CLAIM.test(sent) && !NEG.test(sent));
  }).map(rel);
  ok('no Master Elite / Owens Corning certification claim', bad.length === 0, bad.slice(0, 3).join(', '));
}
{
  // 5. Quick-lead form on all 12 hubs — markup, stylesheet and renderer, i.e.
  //    the SAME embed the city pages use (no second submit path).
  const bad = HUBS.filter((h) => {
    const s = fs.readFileSync(path.join(DOCS, 'services', h + '.html'), 'utf8');
    return !(s.includes('data-nbd-quick-form') && s.includes('/assets/css/quick-lead-form.css')
      && s.includes('/assets/js/quick-lead-form.js'));
  });
  ok('quick-lead form embed on all 12 service hubs', bad.length === 0, bad.join(', '));
}
{
  // 6. Exactly one form host per hub (idempotency of add-hub-quick-lead-form.js).
  const bad = HUBS.filter((h) => {
    const s = fs.readFileSync(path.join(DOCS, 'services', h + '.html'), 'utf8');
    return s.split('data-nbd-quick-form').length - 1 !== 1;
  });
  ok('hub quick-lead form injected exactly once', bad.length === 0, bad.join(', '));
}
{
  // 7. No page invents its own lead endpoint — every quick-form page routes
  //    through the shared submitPublicLead gateway client.
  const bad = marketing.filter((f) => {
    const s = read(f);
    if (!s.includes('data-nbd-quick-form')) return false;
    // a raw <form action="http..."> next to the quick form = a forked path
    return /<form[^>]+action\s*=\s*["']https?:/i.test(s);
  }).map(rel);
  ok('no forked submit path on quick-form pages', bad.length === 0, bad.slice(0, 3).join(', '));
}
{
  // 8. free-roof.html shipped with no chrome at all — lock header + footer.
  const s = fs.readFileSync(path.join(DOCS, 'free-roof', 'index.html'), 'utf8');
  ok('free-roof carries header + footer chrome',
    /<header class="fr-head"/.test(s) && /class="fr-foot"/.test(s) && s.includes('tel:+18594207382'));
}
{
  // 9. inspect mini-footer carries the phone (funnel-family parity).
  const s = fs.readFileSync(path.join(DOCS, 'inspect.html'), 'utf8');
  ok('inspect mini-footer carries the phone number',
    /mini-footer/.test(s) && /<span class="ph"><a href="tel:\+18594207382">/.test(s));
}
{
  // 10. Nav dropdown label canon: the pledge entry in a dropdown-menu reads
  //     "The Lifetime Pledge" (index.html also has a separate top-level
  //     "The Pledge" nav item, which is intentionally short — dropdown only).
  const bad = marketing.filter((f) => {
    const s = read(f);
    const menus = s.match(/<ul class="dropdown-menu">[\s\S]*?<\/ul>/g) || [];
    return menus.some((m) => m.includes('/the-pledge') && !m.includes('>The Lifetime Pledge<'));
  }).map(rel);
  ok('nav dropdown pledge label is "The Lifetime Pledge"', bad.length === 0, bad.slice(0, 3).join(', '));
}
{
  // 11. JSON-LD must stay parseable — the cert-bar/form sweeps edit near the
  //     schema blocks, and a broken block silently kills rich results.
  const bad = [];
  for (const f of marketing) {
    const blocks = read(f).match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const b of blocks) {
      const body = b.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
      try { JSON.parse(body); } catch { bad.push(rel(f)); break; }
    }
  }
  ok('all JSON-LD blocks parse', bad.length === 0, bad.slice(0, 3).join(', '));
}
{
  // 12. Cert-bar pages must not keep the superseded short trademark line the
  //     sweep replaces (both = duplicated, conflicting disclaimers).
  const bad = certBarTargets.filter((f) => {
    const s = read(f);
    return s.includes('data-nbd-certbar="v1"')
      && s.includes('Independent Contractor &mdash; not an employee or agent');
  }).map(rel);
  ok('superseded short disclaimer removed where cert bar landed', bad.length === 0, bad.slice(0, 3).join(', '));
}

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
