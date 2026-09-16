/**
 * tests/portal-open-signal-extension-2026-09-16.test.js
 *
 * The 2026-09-16 view-tracking fix (portal-view-tracking-2026-09-16.test.js)
 * taught customer-engagement-score.js / customer-viewed-chip.js /
 * crm-pipeline.js to treat lead.lastPortalOpenAt (stamped by
 * functions/portal.js's getHomeownerPortalView on a genuine open) as an
 * engagement signal equal to estimate.viewedAt. Three more dashboard
 * consumers had the exact same estimate.viewedAt-only blind spot and are
 * extended here:
 *
 *   - docs/pro/js/almost-there-widget.js's compute() — the "Almost there"
 *     panel never listed a lead whose homeowner opened the portal but had
 *     no estimate to view yet (or already viewed all of them earlier).
 *   - docs/pro/js/buying-intent-strike.js's detectFreshViews() — the
 *     real-time "customer viewing RIGHT NOW, call them" strike card never
 *     fired off a fresh portal open, only a fresh estimate view. (Covered
 *     by new assertions appended to tests/buying-intent-strike.test.js,
 *     which already require()s this pure function directly — not
 *     duplicated here.)
 *   - docs/pro/js/notif-bell.js's Wave 95 fresh-view bell item — same gap,
 *     covered below by source-shape assertions: buildNotifications() is a
 *     large stateful function entangled with localStorage read/dismiss
 *     sets and the server-notification merge, impractical to vm-lift in
 *     isolation (same call this repo's own portal-view-tracking-2026-09-16
 *     test made for crm-pipeline.js's anonymous badge IIFE).
 *
 * House style: vm-lift what's cleanly extractable, source-shape assert what
 * isn't. Run: node tests/portal-open-signal-extension-2026-09-16.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const ALMOST_THERE = read('docs/pro/js/almost-there-widget.js');
const NOTIF_BELL = read('docs/pro/js/notif-bell.js');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? '\n      ' + detail : '')); }
}
function group(name, fn) { console.log('\n' + name); fn(); }

function liftFunction(src, name) {
  const sig = 'function ' + name + '(';
  const start = src.indexOf(sig);
  if (start < 0) return null;
  const bodyStart = src.indexOf('{', start);
  let depth = 0, i = bodyStart;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return i < src.length ? src.slice(start, i + 1) : null;
}

/* ══════════════════════════════════════════════════════════════════
   1. almost-there-widget.js — vm-lift compute() + its toMillis() helper
   ══════════════════════════════════════════════════════════════════ */
const toMillisSrc = liftFunction(ALMOST_THERE, 'toMillis');
const computeSrc = liftFunction(ALMOST_THERE, 'compute');
group('almost-there-widget.js: toMillis and compute are present and liftable', () => {
  ok('found toMillis', !!toMillisSrc, 'if it moved, update the extractor — do NOT delete the suite');
  ok('found compute', !!computeSrc, 'if it moved, update the extractor — do NOT delete the suite');
});

function runCompute({ leads, estimates, snoozedIds, nowMs }) {
  const ctx = {
    window: {
      _leads: leads || [],
      _estimates: estimates || [],
      LeadSnooze: snoozedIds ? { isSnoozed: (l) => snoozedIds.has(l.id) } : undefined,
    },
    Date: nowMs != null
      ? class extends Date { constructor(...a) { if (a.length) super(...a); else super(nowMs); } static now() { return nowMs; } }
      : Date,
    Array,
  };
  vm.createContext(ctx);
  vm.runInContext(
    "const TOP_N = 5;\nconst STALE_VIEW_DAYS = 30;\n"
    + "const TERMINAL_ESTIMATE_STATUSES = new Set(['signed', 'rejected', 'expired']);\n"
    + toMillisSrc + '\n' + computeSrc + '\nthis.__compute = compute;',
    ctx
  );
  return ctx.__compute();
}

if (toMillisSrc && computeSrc) {
  const NOW = 1_800_000_000_000;
  const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();

  group('a lead with a fresh portal open but NO estimate ever created now appears', () => {
    const rows = runCompute({
      leads: [{ id: 'L1', firstName: 'Sarah', lastPortalOpenAt: daysAgo(1) }],
      estimates: [],
      nowMs: NOW,
    });
    ok('one row, portal-only', rows.length === 1 && rows[0].lead.id === 'L1');
    ok('total is 0 (renders with no $ figure)', rows.length === 1 && rows[0].total === 0);
    ok('estCount is 0 (renders as "viewed the portal", not "0 estimates")', rows.length === 1 && rows[0].estCount === 0);
  });

  group('a portal open more recent than the estimate view bumps viewedAt on the SAME row (no duplicate)', () => {
    const rows = runCompute({
      leads: [{ id: 'L1', lastPortalOpenAt: daysAgo(1) }],
      estimates: [{ id: 'E1', leadId: 'L1', viewedAt: daysAgo(10), total: 18000 }],
      nowMs: NOW,
    });
    ok('still exactly one row for L1', rows.length === 1 && rows[0].lead.id === 'L1');
    ok('viewedAt is the MORE RECENT portal-open time, not the older estimate view', rows[0].viewedAt === new Date(daysAgo(1)).getTime());
    ok('total/estCount from the estimate are preserved (portal open only bumps the timestamp)',
      rows[0].total === 18000 && rows[0].estCount === 1);
  });

  group('an OLDER portal open does not regress a more recent estimate view', () => {
    const rows = runCompute({
      leads: [{ id: 'L1', lastPortalOpenAt: daysAgo(10) }],
      estimates: [{ id: 'E1', leadId: 'L1', viewedAt: daysAgo(1), total: 18000 }],
      nowMs: NOW,
    });
    ok('viewedAt stays the newer estimate-view time', rows[0].viewedAt === new Date(daysAgo(1)).getTime());
  });

  group('a stale portal open (31 days) is excluded, same cutoff as estimate views', () => {
    const rows = runCompute({ leads: [{ id: 'L1', lastPortalOpenAt: daysAgo(31) }], estimates: [], nowMs: NOW });
    ok('no row', rows.length === 0);
  });

  group('exclusions carry over to the portal-open path', () => {
    ok('deleted lead excluded',
      runCompute({ leads: [{ id: 'L1', deleted: true, lastPortalOpenAt: daysAgo(1) }], estimates: [], nowMs: NOW }).length === 0);
    ok('prospect excluded',
      runCompute({ leads: [{ id: 'L1', isProspect: true, lastPortalOpenAt: daysAgo(1) }], estimates: [], nowMs: NOW }).length === 0);
    ok('snoozed lead excluded',
      runCompute({ leads: [{ id: 'L1', lastPortalOpenAt: daysAgo(1) }], estimates: [], snoozedIds: new Set(['L1']), nowMs: NOW }).length === 0);
    ok('a lead whose only estimate was already responded-to is not re-added just for a portal open',
      runCompute({
        leads: [{ id: 'L1', lastPortalOpenAt: daysAgo(1) }],
        estimates: [{ id: 'E1', leadId: 'L1', viewedAt: daysAgo(20), respondedAt: daysAgo(19) }],
        nowMs: NOW,
      }).length === 0);
    ok('a lead whose estimate status is terminal (signed) is not re-added just for a portal open',
      runCompute({
        leads: [{ id: 'L1', lastPortalOpenAt: daysAgo(1) }],
        estimates: [{ id: 'E1', leadId: 'L1', viewedAt: daysAgo(20), status: 'signed' }],
        nowMs: NOW,
      }).length === 0);
  });

  group('leads.length === 0 still short-circuits to []; estimates.length === 0 no longer does (the actual fix)', () => {
    ok('no leads at all -> []', runCompute({ leads: [], estimates: [{ id: 'E', leadId: 'L1', viewedAt: daysAgo(1) }], nowMs: NOW }).length === 0);
    ok('leads exist, zero estimates, one fresh portal open -> 1 row (this is what regresses without the fix)',
      runCompute({ leads: [{ id: 'L1', lastPortalOpenAt: daysAgo(1) }], estimates: [], nowMs: NOW }).length === 1);
  });
}

/* ══════════════════════════════════════════════════════════════════
   2. notif-bell.js Wave 95 — source-shape assertions (buildNotifications()
      is a large stateful function; see file header for why it isn't lifted)
   ══════════════════════════════════════════════════════════════════ */
group('notif-bell.js: the portal-open fresh-view block exists with the right shape', () => {
  const anchor = 'Portal-open fresh-viewing signal';
  const idx = NOTIF_BELL.indexOf(anchor);
  ok('block exists', idx >= 0, 'if renamed/moved, update this test — do NOT delete it');
  const block = idx >= 0 ? NOTIF_BELL.slice(idx, idx + 1800) : '';
  ok('reads lead.lastPortalOpenAt via toDate', /toDate\(lead\.lastPortalOpenAt\)/.test(block));
  ok('dedupes against leads already matched by an estimate fresh-view (one bell per lead)',
    /freshViewLeadIds\.has\(lead\.id\)/.test(block));
  ok('skips terminal-stage leads (closed/lost/complete), same as the estimate loop',
    /stage === 'closed' \|\| stage === 'lost' \|\| stage === 'complete'/.test(block));
  ok('skips a lead whose estimate already got a response',
    /estimates\.some\(e => e && e\.leadId === lead\.id && e\.respondedAt\)/.test(block));
  ok('reuses the SAME fresh-view window constant as the estimate loop (no drift between the two signals)',
    /ageMs > FRESH_VIEW_WINDOW_MS/.test(block));
  ok('pushes a type:"fresh-view" item so it renders through the existing bell UI, not a new one',
    /type:\s*'fresh-view'/.test(block));
  ok('the id is namespaced (fresh-view:portal:) so it can never collide with an estimate-sourced fresh-view id',
    /id:\s*`fresh-view:portal:\$\{lead\.id\}`/.test(block));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('FAILED:\n  - ' + fails.join('\n  - ')); process.exit(1); }
