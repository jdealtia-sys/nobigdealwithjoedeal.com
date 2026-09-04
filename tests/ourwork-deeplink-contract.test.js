/**
 * tests/ourwork-deeplink-contract.test.js — /our-work deep-link contract
 * (2026-09-04).
 *
 * WHY THIS EXISTS. Every OURWORK proof strip and every service hub links
 * `/our-work#svc-<slug>`, and `svc-<slug>` is the id of the filter BUTTON on
 * our-work.html. The browser scrolls that button into view and marks it
 * :target — it does not click it. So 55 hrefs across docs/ were landing
 * homeowners on the full unfiltered wall of 45 projects, while our-work.js
 * quietly supported a *different* hash form (`#service=<slug>`) that nothing
 * linked. check-site-integrity did not catch it because the anchor id really
 * does exist; it was checking the wrong thing. 29 of the 55 were added the
 * same week by the wood-siding cluster, so the failure mode was still growing.
 *
 * The guards, in the order a regression would trip them:
 *
 *  1. STATIC — every `#svc-<slug>` href in docs/ names a filter button that
 *     exists on our-work.html. (A renamed service slug breaks this first.)
 *  2. STATIC — the hash matcher in our-work.js accepts BOTH forms. (Someone
 *     "simplifying" the regex back trips this.)
 *  3. BEHAVIOURAL — the real our-work.js, run against a DOM shim built from
 *     the real our-work.html, filters identically for `#svc-<slug>` and
 *     `#service=<slug>`, and leaves the gallery alone for no hash and for an
 *     unknown slug. This is the one that actually proves the fix; it was run
 *     against the pre-fix file first and FAILED, which is why it is trusted.
 *
 * Zero deps (node's own vm). Run: node tests/ourwork-deeplink-contract.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DOCS = path.join(__dirname, '..', 'docs');
const OUR_WORK = path.join(DOCS, 'our-work.html');
const OUR_WORK_JS = path.join(DOCS, 'assets', 'js', 'our-work.js');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name + (detail ? ' — ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'pro') walk(p, out); }
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const html = fs.readFileSync(OUR_WORK, 'utf8');
const js = fs.readFileSync(OUR_WORK_JS, 'utf8');

const buttons = [...html.matchAll(/<button class="filter-btn[^"]*"[^>]*data-service="([a-z-]+)"/g)].map((m) => m[1]);
const cards = [...html.matchAll(/class="project[^"]*"[^>]*data-services="([^"]*)"/g)].map((m) => m[1]);

console.log('\nOUR-WORK DEEP LINKS — the #svc- form must actually filter');
ok('our-work.html parses: filter buttons found', buttons.length > 0, `${buttons.length} buttons`);
ok('our-work.html parses: project cards found', cards.length > 0, `${cards.length} cards`);

// ── 1. every #svc- href names a real filter button ────────────────
const linked = new Map();
for (const file of walk(DOCS, [])) {
  const body = fs.readFileSync(file, 'utf8');
  for (const m of body.matchAll(/href="[^"]*#svc-([a-z-]+)"/g)) {
    if (!linked.has(m[1])) linked.set(m[1], []);
    linked.get(m[1]).push(path.relative(DOCS, file));
  }
}
const orphans = [...linked.keys()].filter((s) => !buttons.includes(s));
const linkCount = [...linked.values()].reduce((n, v) => n + v.length, 0);
ok('every #svc-<slug> deep link names a live filter button',
  orphans.length === 0,
  orphans.length ? `no button for: ${orphans.join(', ')} (e.g. ${linked.get(orphans[0])[0]})` : `${linkCount} link(s) across ${linked.size} slug(s)`);

// ── 2. the matcher accepts both hash forms ────────────────────────
const matcher = /const m = (\/\^#.*?\/)\.exec\(location\.hash\)/.exec(js);
ok('our-work.js still parses location.hash with a literal regex', !!matcher);
if (matcher) {
  const re = new RegExp(matcher[1].slice(1, -1));
  ok('the hash matcher accepts #service=<slug>', re.test('#service=roof-repair'), matcher[1]);
  ok('the hash matcher accepts #svc-<slug> (the form 55 hrefs use)', re.test('#svc-roof-repair'), matcher[1]);
  ok('the hash matcher rejects a bare #svc-', !re.test('#svc-'), matcher[1]);
}

// ── 3. behavioural: run the real file against a shim of the real page ──
function el(data) {
  const classes = new Set();
  return {
    dataset: data,
    classList: { toggle(c, on) { on ? classes.add(c) : classes.delete(c); }, contains: (c) => classes.has(c) },
    scrollIntoView() { this._scrolled = true; },
  };
}
function run(hash) {
  const btnEls = buttons.map((s) => el({ service: s }));
  const cardEls = cards.map((s) => el({ services: s }));
  const gallery = el({});
  const filters = {
    querySelectorAll: () => btnEls,
    querySelector(sel) {
      const m = /\[data-service="([a-z-]+)"\]/.exec(sel);
      return m ? btnEls.find((b) => b.dataset.service === m[1]) || null : null;
    },
    addEventListener() {},
  };
  const sandbox = {
    document: {
      querySelector: (sel) => (sel === '.filters' ? filters : null),
      querySelectorAll: (sel) => (sel === '.project' ? cardEls : []),
      getElementById: (id) => (id === 'gallery' ? gallery : null),
      addEventListener() {},
    },
    location: { hash, pathname: '/our-work' },
    history: { replaceState() {} },
    console: { log() {}, warn() {}, error() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: 'our-work.js' });
  return {
    active: btnEls.filter((b) => b.classList.contains('active')).map((b) => b.dataset.service),
    visible: cardEls.filter((c) => !c.classList.contains('hidden')).length,
    total: cardEls.length,
    scrolled: !!gallery._scrolled,
  };
}

// Pick a slug that actually narrows the gallery, so "filtered" is observable.
const probe = buttons.find((s) => {
  if (s === 'all') return false;
  const n = cards.filter((c) => c.split(/\s+/).includes(s)).length;
  return n > 0 && n < cards.length;
});
ok('a filterable probe slug exists on the live page', !!probe, probe || 'none of the buttons narrow the gallery');

if (probe) {
  const none = run('');
  const byService = run('#service=' + probe);
  const bySvc = run('#svc-' + probe);
  const bogus = run('#svc-definitely-not-a-service');

  ok('no hash leaves every card visible and no button active',
    none.visible === none.total && none.active.length === 0,
    `visible ${none.visible}/${none.total}, active [${none.active}]`);
  ok(`#service=${probe} filters (control)`,
    byService.active.join() === probe && byService.visible > 0 && byService.visible < byService.total,
    `visible ${byService.visible}/${byService.total}, active [${byService.active}]`);
  ok(`#svc-${probe} filters identically`,
    bySvc.active.join() === probe && bySvc.visible === byService.visible,
    `visible ${bySvc.visible}/${bySvc.total}, active [${bySvc.active}]`);
  ok(`#svc-${probe} scrolls the gallery into view`, bySvc.scrolled === true);
  ok('an unknown #svc- slug leaves the gallery unfiltered',
    bogus.visible === bogus.total && bogus.active.length === 0,
    `visible ${bogus.visible}/${bogus.total}, active [${bogus.active}]`);
}

console.log('\n' + '─'.repeat(50));
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
