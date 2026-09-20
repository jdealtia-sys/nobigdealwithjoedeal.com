/**
 * docs/careers.html is PARKED — it must not advertise employment terms.
 *
 * WHY (2026-09-20)
 * ──────────────────────────────────────────────────────────────────
 * The page ran a part-time roofing-helper posting that promised, in body copy
 * AND in JobPosting structured data that Google Jobs surfaces:
 *
 *     "W2, paid weekly, taxes withheld properly, workers' comp coverage from
 *      your first hour."
 *     "W2. You're an employee, not a subcontractor. ... A lot of roofing labor
 *      in this area gets paid as 1099 or cash, which leaves the worker with no
 *      coverage at all. I'm not doing that."
 *
 * Those terms were not accurate. That is categorically different from marketing
 * overstatement: a job ad is a promise to a PERSON about their tax treatment and
 * their injury coverage, and someone could have taken the job on it. So the
 * posting came down rather than being reworded, and the terms are deliberately
 * not restated.
 *
 * WHAT THIS PINS, and why each one matters
 * ────────────────────────────────────────
 * 1. The page still EXISTS and still resolves. 219 pages link to /careers from
 *    the footer partial; deleting the file would 404 every one of them. The fix
 *    was never "remove the page", it was "remove the claim".
 * 2. No employment-terms language in VISIBLE prose. Comments are stripped first,
 *    because the page's own comment explains what was removed and therefore
 *    legitimately contains the words the page must not CLAIM.
 * 3. No JobPosting structured data. This is the half that outlives the page in
 *    Google Jobs, so it matters more than the body copy.
 * 4. noindex is present AND the page is absent from the sitemap. These two have
 *    to agree: a noindex page listed in the sitemap asks Google to index a page
 *    that forbids it.
 *
 * This suite going red does NOT necessarily mean something is broken — it means
 * somebody restored a posting. That is allowed. It just has to be a posting
 * whose terms are true, confirmed by a human, at which point this file gets
 * updated in the same change.
 *
 * Pure Node, zero deps. Run: node tests/careers-posting-parked.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function ok(label, cond, hint) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label + (hint ? '\n      ' + hint : '')); }
}
function section(t) { console.log('\n' + t); }

const CAREERS = 'docs/careers.html';
const html = read(CAREERS);
// Strip comments AND script bodies: JSON-LD ships inside <script>, and the
// explanatory comment quotes the very claims being banned.
const prose = html.replace(/<!--[\s\S]*?-->/g, '');
const visible = prose.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

section('the page still exists and still resolves');

ok('docs/careers.html is present', fs.existsSync(path.join(ROOT, CAREERS)),
  '219 pages link to /careers from the footer partial — deleting it 404s all of them');
ok('...and still closes a valid document', /<\/body><\/html>|<\/body>\s*<\/html>/.test(html));
ok('...with its nav and footer partials intact',
  html.includes('nbd:partial nav-standard') && html.includes('nbd:partial footer-extended'));

section('no employment terms are advertised');

const BANNED = [
  ['W2', 'the tax treatment promised to the worker'],
  ['W-2', 'ditto, hyphenated'],
  ['1099', 'the contrast the old copy drew'],
  ['taxes withheld', 'a payroll promise'],
  ["workers' comp", 'an injury-coverage promise'],
  ['not a subcontractor', 'the classification claim'],
  ['Now Hiring', 'the page must not advertise a role while parked'],
];
for (const [term, why] of BANNED) {
  ok(`visible copy does not say ${JSON.stringify(term)} (${why})`,
    !visible.includes(term),
    'if a posting was restored, confirm the terms are TRUE and update this suite in the same change');
}

section('no JobPosting structured data');

const ldBlocks = html.match(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) || [];
ok('no ld+json block declares @type JobPosting',
  !ldBlocks.some((b) => /"@type"\s*:\s*"JobPosting"/.test(b)),
  'structured data outlives the page in Google Jobs — this is the half that matters most');
ok('no ld+json block restates the employment terms',
  !ldBlocks.some((b) => /W2|W-2|1099|taxes withheld|workers' comp/.test(b)));

section('noindex and the sitemap agree');

const hasNoindex = /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html);
const sitemap = read('docs/sitemap.xml');
const inSitemap = /\/careers</.test(sitemap);
const coreRow = read('scripts/build-sitemap.js');
const rowActive = /^\s*\['careers'/m.test(coreRow);

ok('careers.html carries robots noindex', hasNoindex);
ok('careers is NOT in docs/sitemap.xml', !inSitemap);
ok('...and its CORE_PAGES row is commented out, so a rebuild keeps it out',
  !rowActive,
  'the sitemap here is CURATED, not globbed — regenerating would re-add the URL if the row were live');
ok('THE INVARIANT: noindex and sitemap-absence agree',
  hasNoindex === !inSitemap,
  'a noindex page listed in the sitemap asks Google to index a page that forbids indexing');

section('the parked page still does something useful');

ok('it points crews at /partners instead of dead-ending',
  visible.includes('/partners'));
ok('it still offers a way to reach Jo', /tel:\+18594207382/.test(visible));

console.log('\n' + '─'.repeat(30));
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
