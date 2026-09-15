/**
 * tests/pro-claims-honesty-2026-09-13.test.js
 *
 * WHY THIS EXISTS
 * ────────────────
 * A 2026-09-13 evaluation of an outside audit (jdealtia-sys/nbd-audits-2026)
 * found roughly fifteen /pro marketing and in-app strings that claimed
 * something the code does not do — the same class of bug #1501 fixed on
 * 2026-09-08 with no regression test, which is why several of these (the
 * Starter "exact setup" line, the Growth-only trial FAQ, "9 e-sign ready")
 * had drifted back to false since. This pins both directions: the corrected
 * string is present, and the false string it replaced does not reappear
 * anywhere in the shipped tree. Absence-only would pass vacuously if a
 * rewrite dropped the sentence instead of fixing it; presence-only would
 * miss a partial revert. Both, on every published file, catches both.
 *
 * Pure-Node, zero-dep. Run: node tests/pro-claims-honesty-2026-09-13.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');

let passed = 0, failed = 0;
const fails = [];
function ok(label, cond, detail) {
  if (cond) { console.log('  ✓ ' + label); passed++; }
  else { console.log('  ✗ ' + label + (detail ? ' — ' + detail : '')); failed++; fails.push(label); }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Walk every published file once so "does the false string appear ANYWHERE
// under docs/" is a real sweep, not a per-file spot check.
function walk(dir, out) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) walk(p, out);
    else if (/\.(html|js)$/.test(name.name)) out.push(p);
  }
}
const PUBLISHED = [];
walk(DOCS, PUBLISHED);
function countAcross(needle) {
  let n = 0;
  for (const f of PUBLISHED) {
    const src = fs.readFileSync(f, 'utf8');
    if (src.includes(needle)) n += src.split(needle).length - 1;
  }
  return n;
}

console.log('\nSTARTER exact-setup claim — Joe is structurally never on Starter (owner claim bypasses every cap)');
{
  ok('pricing.html no longer claims Starter is literally the setup Joe runs on',
     countAcross('The exact setup I run my business on every day') === 0);
  ok('index.html no longer claims it in the third person either',
     countAcross('The exact setup Joe runs his business on every day') === 0);
  ok('pricing.html carries the honest replacement', read('docs/pro/pricing.html').includes('The same tools I run NBD on every day.'));
  ok('index.html carries the honest replacement', read('docs/pro/index.html').includes('The same tools Joe runs NBD on every day.'));
}

console.log('\nTRIAL — Team AND Growth get 14 days (functions/stripe.js grants both); Starter has none');
{
  const stripe = read('functions/stripe.js');
  const idx = stripe.indexOf('trial_period_days');
  ok('code truth: trial_period_days:14 is still gated on team/growth',
     idx >= 0 && /trial_period_days:\s*14/.test(stripe) && /team/i.test(stripe.slice(Math.max(0, idx - 400), idx)) && /growth/i.test(stripe.slice(Math.max(0, idx - 400), idx)));
  ok('pricing.html FAQ no longer says only Growth gets the trial',
     countAcross('Start the Growth plan and your first 14 days are free') === 0);
  ok('pricing.html FAQ names both tiers and the card-up-front truth', /Team and Growth both start with 14 free days/.test(read('docs/pro/pricing.html')));
  ok('demo.html no longer says "14-day free trial on Growth" alone',
     countAcross('14-day free trial on Growth</div>') === 0);
}

console.log('\nE-SIGN — 3 of 25 doc types ship a default signer block; links expire in 14 days (functions/esign-envelope.js TTL_DAYS)');
{
  const ttl = read('functions/esign-envelope.js');
  const m = ttl.match(/const TTL_DAYS\s*=\s*(\d+)/);
  ok('code truth: TTL_DAYS is still 14 (this test needs updating if that ever changes)', m && m[1] === '14');
  ok('demo.html no longer says 9 are e-sign ready', countAcross('9 e-sign ready with homeowner') === 0);
  ok('demo.html no longer says links expire after 7 days', countAcross('expire after 7 days') === 0);
  ok("demo.html matches index.html's already-corrected count", read('docs/pro/demo.html').includes('3 e-sign ready out of the box'));
  ok('demo.html states the real TTL', read('docs/pro/demo.html').includes('expire after 14 days'));
}

console.log('\nA2P — texting is on a shared number today; a business\'s own number needs carrier registration that is roadmap, not shipped');
{
  ok('demo.html mockup no longer implies A2P is a one-time, already-available toggle',
     !/SMS delivery activates with one-time carrier \(A2P\) registration\.<\/div>/.test(read('docs/pro/demo.html')));
  ok('demo.html states the shared-number-today / roadmap truth', /shared NBD Pro number.*roadmap and not yet available/.test(read('docs/pro/demo.html')));
}

console.log("\nDEMO ACCOUNT — login.html no longer calls seeded sample data 'real'");
{
  ok('false claim gone', countAcross('Live lead pipeline with real data') === 0);
  ok('honest replacement present', read('docs/pro/login.html').includes('Live lead pipeline with sample data'));
}

console.log('\nSIGNING — how-to.html no longer promises an auto-advance + push that no handler performs');
{
  const howto = read('docs/pro/how-to.html');
  ok('no longer claims the stage auto-advances on signature', !/stage auto-advances to <strong>Contract Signed/.test(howto));
  ok('no longer claims a push notification fires', !/You get a push notification and a toast\.<\/li>/.test(howto));
}

console.log('\nPROPERTY INTEL — in-app spinners no longer claim a live county-records lookup (Regrid is stubbed for non-owners)');
{
  ok('no "Looking up county records" strings remain anywhere under docs/',
     countAcross('Looking up county records...') === 0);
  ok('no "Fetching county records" strings remain anywhere under docs/',
     countAcross('Fetching county records...') === 0);
  ok('register.html Property Intel tile no longer promises a live pull "from county records"',
     !/from county records at any address\.<\/div>/.test(read('docs/pro/register.html')));
  ok('D2D verify tooltip no longer claims a county-records check',
     !read('docs/pro/js/d2d-tracker-ui-2026b.js').includes('against Google + county records'));
}

console.log("\nCAP MODAL — enforceGate hard-blocks new leads at 100%; the modal must say so, not promise no lockout");
{
  const bg = read('docs/pro/js/billing-gate.js');
  ok('module header documents the real gate behaviour', bg.includes('Leads: warns at 80%; at 100% new-lead creation is blocked client-side'));
  ok("the \"we won't lock you out mid-cycle\" promise is gone", !bg.includes("we won't lock you out mid-cycle"));
  ok('the cap modal states leads pause, not "no lockout"', bg.includes('New leads pause until you upgrade or your cycle resets'));
}

console.log('\nSANDBOX TIERS — relabeled to the live Standard/Preferred/Elite lifetime model (#1529), not the retired 10/15/25-yr one');
{
  const sb = read('docs/pro/sandbox.html');
  ok('no 10-yr/15-yr/25-yr workmanship chips remain', !/\d+-yr workmanship|ridge vent · 15-yr|full ice &amp; water · 25-yr/.test(sb));
  ok('chips now read Standard/Preferred/Elite', sb.includes('<h4>Standard</h4>') && sb.includes('<h4>Preferred</h4>') && sb.includes('<h4>Elite</h4>'));
  ok("chips claim lifetime workmanship, matching how-to.html's tier table", (sb.match(/lifetime/gi) || []).length >= 3);
}

console.log('\nESX EXPORT — the fake "Xactimate Export (ESX)" button is gone; the drawing tool no longer implies it produces a real ESX file');
{
  const dash = read('docs/pro/dashboard.html');
  ok('the ESX button is removed from the drawing-tool panel', !dash.includes('data-fn="exportXactimateESX"'));
  ok('an honest disclosure line replaces it', dash.includes('Carrier estimates stay in Xactimate'));
  const maps = read('docs/pro/js/maps-routing.js');
  ok('the underlying function is left in place (frozen, not deleted — no JS file churn)', maps.includes('function exportXactimateESX()'));
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }
