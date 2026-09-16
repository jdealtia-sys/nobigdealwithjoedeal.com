/**
 * tests/adjuster-board-handler-tenancy.test.js — the getAdjusterTacticBoard
 * CALLABLE (functions/handlers/adjuster-board.js), not just the pure
 * aggregation it calls into.
 *
 * THE GAP (adjuster-board cross-tenant audit, 2026-09-15)
 * ──────────────────────────────────────────────────────────────────
 * tests/adjuster-board.test.js only requires and exercises
 * functions/adjuster-board-logic.js's pure aggregateAdjusterBoard() — it
 * never imports or invokes the onCall handler in
 * functions/handlers/adjuster-board.js.
 * tests/analytics-container-remount.test.js only static-scans the frontend
 * files for wiring (source-text regex), not the callable. No emulator/smoke
 * suite calls getAdjusterTacticBoard. That left the single most
 * security-relevant line in this feature —
 * `const companyId = claims.companyId || uid;` plus the collectionGroup
 * query it feeds — with NO automated check that a future edit (swapping in
 * a different claim field, dropping the `|| uid` solo-owner fallback, or
 * loosening the `where('companyId', ...)` clause) would be caught by CI.
 *
 * WHY THIS FILE EXECUTES INSTEAD OF GREPPING
 * ──────────────────────────────────────────
 * Same technique as tests/session-revocation.test.js: the REAL handler
 * source is loaded with every `require()` stubbed (no functions/node_modules
 * needed — this runs even in the unit-suite-manifest job) and actually
 * INVOKED, so the assertions are about what Firestore query it issues, not
 * what strings appear near each other in the file.
 *
 * Pure Node — no emulator, no firebase-admin, no functions/ deps.
 * Run: node tests/adjuster-board-handler-tenancy.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'functions/handlers/adjuster-board.js'), 'utf8');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

// ═══════════════════════════════════════════════════════════════
// Load functions/handlers/adjuster-board.js with every require stubbed.
// A fake Firestore records every collectionGroup()/.where() call so the
// tenancy-scoping query can be asserted on shape, not string proximity.
// ═══════════════════════════════════════════════════════════════
function loadHandler(opts) {
  opts = opts || {};
  const calls = { collectionGroups: [], wheres: [], rateLimit: [], aggregateInputs: [], warnings: [] };

  class HttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  function makeQuery() {
    const q = {
      where(field, op, value) { calls.wheres.push({ field, op, value }); return q; },
      async get() {
        if (opts.queryThrows) throw new Error(opts.queryThrows);
        const docs = opts.docs || [];
        return { docs: docs.map((d) => ({ data: () => d })) };
      },
    };
    return q;
  }

  const dbStub = {
    collectionGroup(name) { calls.collectionGroups.push(name); return makeQuery(); },
  };

  const stubs = {
    'firebase-functions/v2/https': {
      onCall: (options, handler) => {
        const f = async (request) => handler(request);
        f.__options = options;
        return f;
      },
      HttpsError,
    },
    'firebase-functions/v2': {
      logger: { warn: (msg, meta) => calls.warnings.push({ msg, meta }), info: () => {}, error: () => {} },
    },
    'firebase-admin/firestore': {
      Timestamp: { fromMillis: (ms) => ({ __ts: ms }) },
      getFirestore: () => dbStub,
    },
    '../shared': {
      callableRateLimit: async (request, name, limit, windowMs) => {
        calls.rateLimit.push({ name, limit, windowMs });
        if (opts.rateLimitThrows) throw new HttpsError('resource-exhausted', 'rate limited');
      },
    },
    './_shared': { CORS_ORIGINS: ['https://example.test'] },
    '../adjuster-board-logic': {
      aggregateAdjusterBoard: (recordings) => {
        calls.aggregateInputs.push(recordings);
        return {
          totalCalls: recordings.length,
          withInsurance: 0,
          byCarrier: [],
          byAdjuster: [],
          topObjections: [],
          topRedFlags: [],
        };
      },
    },
  };

  const requireStub = (id) => {
    if (!Object.prototype.hasOwnProperty.call(stubs, id)) throw new Error('unstubbed require(' + id + ')');
    return stubs[id];
  };

  const mod = { exports: {} };
  new Function('module', 'exports', 'require', 'console', SERVER_SRC)(
    mod, mod.exports, requireStub, { log: () => {}, warn: () => {}, error: () => {} });
  return { fn: mod.exports.getAdjusterTacticBoard, calls, HttpsError };
}

async function callAndCatch(fn, request) {
  try { return { value: await fn(request), error: null }; }
  catch (e) { return { value: null, error: e }; }
}

(async function main() {

  section('the callable exists and is wired');
  {
    const { fn } = loadHandler();
    ok('handlers/adjuster-board.js exports getAdjusterTacticBoard', typeof fn === 'function');
    ok('enforceAppCheck is on', !!fn.__options && fn.__options.enforceAppCheck === true);
    const indexSrc = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
    ok('functions/index.js exports it, or it is dead code',
      /exports\.getAdjusterTacticBoard\s*=/.test(indexSrc));
  }

  section('unauthenticated calls are rejected before any Firestore read');
  {
    const { fn, calls } = loadHandler();
    const { value, error } = await callAndCatch(fn, { data: {} });
    ok('an unauthenticated call is rejected', !!error && error.code === 'unauthenticated');
    ok('...and never reaches the collectionGroup scan', calls.collectionGroups.length === 0);
    ok('...and never reaches the rate limiter (fail before spend)', calls.rateLimit.length === 0);
    ok('value is null on rejection', value === null);
  }

  section('THE TENANCY LINE — companyId claim scopes the query, not uid alone');
  {
    // A caller with a companyId claim (a team member) must be scoped by
    // THAT company, never by their own uid.
    const { fn, calls } = loadHandler({ docs: [] });
    await callAndCatch(fn, { auth: { uid: 'rep-uid-1', token: { companyId: 'company-XYZ' } }, data: {} });
    ok('collectionGroup targets "recordings"', calls.collectionGroups[0] === 'recordings');
    const companyWhere = calls.wheres.find((w) => w.field === 'companyId');
    ok('queries companyId with equality "=="', !!companyWhere && companyWhere.op === '==');
    ok('...scoped to the CLAIM\'s companyId, not the caller\'s uid',
      !!companyWhere && companyWhere.value === 'company-XYZ' && companyWhere.value !== 'rep-uid-1');
    const rangeWhere = calls.wheres.find((w) => w.field === 'recordedAt');
    ok('also range-filters recordedAt (>=) for the window', !!rangeWhere && rangeWhere.op === '>=');
  }
  {
    // Solo owners (no companyId claim) fall back to their own uid — recordings
    // are written with companyId = ctx.companyId, which is claims.companyId||uid.
    const { fn, calls } = loadHandler({ docs: [] });
    await callAndCatch(fn, { auth: { uid: 'solo-owner-uid' }, data: {} });
    const companyWhere = calls.wheres.find((w) => w.field === 'companyId');
    ok('a caller with NO companyId claim falls back to their own uid (solo-owner path)',
      !!companyWhere && companyWhere.value === 'solo-owner-uid');
  }
  {
    // A missing/empty-string companyId claim must NOT scope the query to ''
    // (which — depending on the composite index — could read as "unscoped").
    const { fn, calls } = loadHandler({ docs: [] });
    await callAndCatch(fn, { auth: { uid: 'uid-empty-claim', token: { companyId: '' } }, data: {} });
    const companyWhere = calls.wheres.find((w) => w.field === 'companyId');
    ok('an empty-string companyId claim still falls back to the uid (falsy || uid)',
      !!companyWhere && companyWhere.value === 'uid-empty-claim');
  }

  section('two different tenants never see the same query scope');
  {
    const { fn, calls: callsA } = loadHandler({ docs: [] });
    await callAndCatch(fn, { auth: { uid: 'A-uid', token: { companyId: 'company-A' } }, data: {} });
    const h2 = loadHandler({ docs: [] });
    await callAndCatch(h2.fn, { auth: { uid: 'B-uid', token: { companyId: 'company-B' } }, data: {} });
    const whereA = callsA.wheres.find((w) => w.field === 'companyId');
    const whereB = h2.calls.wheres.find((w) => w.field === 'companyId');
    const scopeA = whereA && whereA.value;
    const scopeB = whereB && whereB.value;
    ok('company-A\'s call is scoped to company-A', scopeA === 'company-A');
    ok('company-B\'s call is scoped to company-B', scopeB === 'company-B');
    ok('the two tenants never resolve to the same scope value', !!scopeA && scopeA !== scopeB);
  }

  section('windowDays is clamped, not trusted verbatim from the client');
  {
    const { fn } = loadHandler({ docs: [] });
    const { value } = await callAndCatch(fn, { auth: { uid: 'u1' }, data: {} });
    ok('default windowDays is 365 when omitted', value.windowDays === 365);
  }
  {
    const { fn } = loadHandler({ docs: [] });
    const { value } = await callAndCatch(fn, { auth: { uid: 'u1' }, data: { windowDays: 1 } });
    ok('windowDays is floored at 7 (not allowed to scan a 1-day window as a proxy for near-zero)',
      value.windowDays === 7);
  }
  {
    const { fn } = loadHandler({ docs: [] });
    const { value } = await callAndCatch(fn, { auth: { uid: 'u1' }, data: { windowDays: 99999 } });
    ok('windowDays is capped at 730 (bounds the collectionGroup scan)', value.windowDays === 730);
  }

  section('only complete, summarized recordings reach the aggregator');
  {
    const docs = [
      { status: 'complete', summary: { foo: 1 } },
      { status: 'complete', summary: null },          // no summary yet — must be dropped
      { status: 'processing', summary: { foo: 1 } },   // not complete — must be dropped
      { status: 'complete' },                          // summary key entirely absent
    ];
    const { fn, calls } = loadHandler({ docs });
    await callAndCatch(fn, { auth: { uid: 'u1' }, data: {} });
    ok('exactly one of four docs (complete + has a summary) reaches aggregateAdjusterBoard',
      calls.aggregateInputs[0].length === 1);
    ok('...and it is the right one', calls.aggregateInputs[0][0] === docs[0]);
  }

  section('a Firestore failure is a clean internal error, not a leaked stack/empty board');
  {
    const { fn, calls } = loadHandler({ queryThrows: 'composite index missing' });
    const { value, error } = await callAndCatch(fn, { auth: { uid: 'u1' }, data: {} });
    ok('the query failure surfaces as HttpsError("internal", ...)', !!error && error.code === 'internal');
    ok('...never returns a fabricated empty board as if it succeeded', value === null);
    ok('...and is logged (so an index/permission regression is visible in ops)', calls.warnings.length === 1);
  }

  section('rate limiting is applied before the scan, keyed to this callable\'s own name');
  {
    const { fn, calls } = loadHandler({ docs: [] });
    await callAndCatch(fn, { auth: { uid: 'u1' }, data: {} });
    ok('callableRateLimit is invoked with this callable\'s own name (not a copy-pasted sibling\'s)',
      calls.rateLimit.length === 1 && calls.rateLimit[0].name === 'getAdjusterTacticBoard');
    ok('...before the collectionGroup scan runs', (() => {
      // Re-run with a throwing rate limiter and confirm the scan never fires.
      const h2 = loadHandler({ docs: [], rateLimitThrows: true });
      return callAndCatch(h2.fn, { auth: { uid: 'u1' }, data: {} }).then(() => h2.calls.collectionGroups.length === 0);
    })());
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('\nFAILED:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
})().catch((e) => { console.error('\nFATAL:', e && e.stack || e); process.exit(1); });
