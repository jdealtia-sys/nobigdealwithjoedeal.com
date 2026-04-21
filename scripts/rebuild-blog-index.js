#!/usr/bin/env node
/**
 * Rebuild the blog index from docs/blog/*.html files.
 *
 * Usage:
 *   node scripts/rebuild-blog-index.js              # Just regenerate POSTS array from existing HTML dates
 *   node scripts/rebuild-blog-index.js --reschedule # Also rewrite dates per SEASONAL_MAP below
 *
 * The seasonal map clusters posts around Cincinnati roofing seasonality:
 *   - Premium-components series (Mar-Apr 2026): cluster recent, LumaNail anchors at -4 wks
 *   - Insurance season (Dec-Feb): moderate cadence
 *   - Late-fall post-storm settlements (Oct-Nov 2025): paired
 *   - Peak summer hail/replacement season (May-Jul 2025): clustered
 *   - Pre-season basics (Mar-Apr 2025): foundational posts
 *
 * Add a new blog post: drop the HTML file in docs/blog/, set its
 * <meta property="article:published_time"> to your chosen date, then run
 * `node scripts/rebuild-blog-index.js`. POSTS array auto-updates.
 */

const fs = require('fs');
const path = require('path');

const BLOG_DIR = path.join(__dirname, '..', 'docs', 'blog');
const INDEX_FILE = path.join(BLOG_DIR, 'index.html');
const RESCHEDULE = process.argv.includes('--reschedule');

// Seasonal date map: slug → published date (YYYY-MM-DD).
// Mirrors how a working Cincinnati roofer would actually publish — clusters around
// storm/insurance/replacement seasons, with longer gaps in slow months.
const SEASONAL_MAP = {
  // === 2026 SPRING — Premium Components Series + Pre-Hail-Season ===
  'the-pipe-boot-fork':                          '2026-04-20', // newest, series finale
  'why-roofivent-is-on-my-roofs':                '2026-04-06', // series middle
  'why-i-install-lumanail-on-every-elite-roof':  '2026-03-23', // SERIES ANCHOR (4 wks back)
  'cincinnati-hail-season-2026':                 '2026-03-09', // pre-season prep
  // === 2026 WINTER — Post-storm insurance season ===
  'can-i-keep-insurance-check-not-fix-roof':     '2026-02-16',
  'state-farm-allstate-roof-claims-ohio':        '2026-01-26',
  'my-roof-is-too-old-will-insurance-still-pay': '2026-01-12',
  'how-long-roof-insurance-claim-ohio':          '2025-12-22',
  // === 2025 LATE FALL — post-storm settlement guidance ===
  'how-to-file-storm-damage-insurance-claim-ohio': '2025-11-10',
  'what-to-expect-roof-insurance-adjuster-visit':  '2025-10-13',
  // === 2025 PEAK SEASON — hail/replacement ===
  'does-homeowner-insurance-cover-hail-damage-ohio': '2025-07-21',
  'gaf-vs-owens-corning-vs-atlas-shingles':          '2025-06-09',
  'how-much-does-roof-cost-cincinnati-2026':         '2025-05-19',
  'how-long-does-roof-replacement-take-cincinnati':  '2025-05-05',
  // === 2025 EARLY SPRING — pre-season basics (the OG posts) ===
  'architectural-shingles-vs-3-tab':             '2025-04-14',
  'signs-your-roof-needs-replacement-vs-repair': '2025-03-24', // oldest
};

// Tag inference from slug
const TAG_GUESSES = [
  [/lumanail|roofivent|pipe-boot|gaf-pivot/, 'Premium Components'],
  [/hail-season|storm-damage/, 'Storm Damage'],
  [/insurance|adjuster|claim|state-farm|allstate|insurance-check/, 'Insurance'],
  [/cost|price|how-much/, 'Pricing Guide'],
  [/shingle|architectural|gaf-vs|signs-your|replacement-take/, 'Roofing'],
];

function guessTag(slug) {
  for (const [re, tag] of TAG_GUESSES) {
    if (re.test(slug)) return tag;
  }
  return 'Roofing';
}

function extractMeta(html, slug) {
  const get = (re) => {
    const m = html.match(re);
    return m ? m[1].trim() : null;
  };
  const title =
    get(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
    get(/<title>([^<|]+)/i) ||
    slug;
  const description =
    get(/<meta\s+name="description"\s+content="([^"]+)"/i) ||
    get(/<meta\s+property="og:description"\s+content="([^"]+)"/i) ||
    '';
  const published =
    get(/<meta\s+property="article:published_time"\s+content="(\d{4}-\d{2}-\d{2})"/i) ||
    get(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/i) ||
    null;
  // Try to recover the existing min-read from the article-meta string
  const readMatch = html.match(/(\d+)\s*min read/i);
  const readMin = readMatch ? parseInt(readMatch[1], 10) : null;
  return {
    title: title.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+\|\s+(?:Joe Deal NBD|No Big Deal.*)$/i, ''),
    description: description.replace(/&amp;/g, '&').replace(/&quot;/g, '"'),
    published,
    readMin,
  };
}

function formatMeta(date, readMin) {
  const d = new Date(date + 'T12:00:00Z'); // noon UTC to avoid timezone month-boundary issues
  const monthYear = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const r = readMin || 6;
  return `By Joe Deal · ${monthYear} · ${r} min read`;
}

function rewritePostDatesInHtml(filepath, newDate) {
  let html = fs.readFileSync(filepath, 'utf8');
  const before = html;
  html = html.replace(/<meta\s+property="article:published_time"\s+content="\d{4}-\d{2}-\d{2}"\s*\/?>/i,
    `<meta property="article:published_time" content="${newDate}">`);
  html = html.replace(/"datePublished"\s*:\s*"\d{4}-\d{2}-\d{2}"/g, `"datePublished":"${newDate}"`);
  html = html.replace(/"dateModified"\s*:\s*"\d{4}-\d{2}-\d{2}"/g, `"dateModified":"${newDate}"`);
  // Update visible date in article-meta — match common patterns
  const d = new Date(newDate + 'T12:00:00Z');
  const visibleDate = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const monthYearOnly = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  // Replace "<span>Month D, YYYY</span>" or "<span>Month YYYY</span>" patterns
  html = html.replace(/(<span>)(?:January|February|March|April|May|June|July|August|September|October|November|December)\s*\d{0,2},?\s*\d{4}(<\/span>)/g,
    `$1${visibleDate}$2`);
  // Also update inline "By Joe Deal · Month YYYY · X min read" strings that aren't inside <span>
  html = html.replace(/By Joe Deal\s*·\s*(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\s*·/g,
    `By Joe Deal · ${monthYearOnly} ·`);
  if (html !== before) {
    fs.writeFileSync(filepath, html, 'utf8');
    return true;
  }
  return false;
}

function buildPostsArray(posts) {
  const ordered = [...posts].sort((a, b) => new Date(b.published) - new Date(a.published));
  const lines = ordered.map((p) => {
    return `  {
    url: "/blog/${p.slug}",
    tag: ${JSON.stringify(p.tag)},
    title: ${JSON.stringify(p.title)},
    meta: ${JSON.stringify(p.meta)},
    excerpt: ${JSON.stringify(p.description)},
    published: "${p.published}",
  }`;
  });
  return `[\n${lines.join(',\n')}\n]`;
}

function regenerateBlogIndex(posts) {
  let html = fs.readFileSync(INDEX_FILE, 'utf8');
  const arrayLiteral = buildPostsArray(posts);
  const replaced = html.replace(/const POSTS = \[[\s\S]*?\n\];/m, `const POSTS = ${arrayLiteral};`);
  if (replaced === html) {
    throw new Error('Could not locate POSTS array in blog/index.html (looking for "const POSTS = [ ... ];")');
  }
  fs.writeFileSync(INDEX_FILE, replaced, 'utf8');
}

function main() {
  const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.html') && f !== 'index.html');
  console.log(`Scanning ${files.length} blog posts in docs/blog/`);

  const posts = files.map(filename => {
    const slug = filename.replace(/\.html$/, '');
    const filepath = path.join(BLOG_DIR, filename);
    const html = fs.readFileSync(filepath, 'utf8');
    const meta = extractMeta(html, slug);
    return { slug, filename, filepath, ...meta, tag: guessTag(slug) };
  });

  if (RESCHEDULE) {
    console.log('Applying SEASONAL_MAP dates to each post HTML file...');
    posts.forEach(p => {
      const newDate = SEASONAL_MAP[p.slug];
      if (newDate) {
        const updated = rewritePostDatesInHtml(p.filepath, newDate);
        p.published = newDate;
        console.log(`  ${updated ? '✓' : '·'}  ${newDate}  ${p.slug}`);
      } else {
        console.warn(`  !  no date in SEASONAL_MAP for ${p.slug} — keeping ${p.published}`);
      }
    });
  }

  // Rebuild meta strings now that we have final dates (use existing readMin if present)
  posts.forEach(p => {
    if (p.published) p.meta = formatMeta(p.published, p.readMin);
  });

  const valid = posts.filter(p => p.published && p.title);
  if (valid.length !== posts.length) {
    console.warn(`Skipped ${posts.length - valid.length} posts missing published date or title`);
  }

  regenerateBlogIndex(valid);
  console.log(`\nWrote POSTS array (${valid.length} entries) to blog/index.html`);

  console.log('\nFinal cadence (newest → oldest):');
  [...valid].sort((a, b) => new Date(b.published) - new Date(a.published)).forEach(p => {
    console.log(`  ${p.published}  [${p.tag.padEnd(20)}]  ${p.slug}`);
  });
}

main();
