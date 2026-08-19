/**
 * tests/legacy-documents-audit.test.js — the legacy-documents decision aid.
 *
 * scripts/audit-legacy-documents.js decides whether the legacy merge read in
 * docs/pro/js/customer-documents.js is still load-bearing. Its VERDICT is the
 * whole point, and there are exactly two ways it can mislead:
 *
 *   1. It says "safe to delete" while live lead-scoped rows exist — acting on
 *      that would make those documents vanish from customer records. This is
 *      the expensive direction and the reason the script exists at all.
 *   2. It counts the COMPANY document library (dashboard-api.js writes the
 *      same top-level `documents` collection with no leadId) as lead data,
 *      making the merge read look load-bearing forever.
 *
 * This suite drives the REAL script against a stubbed Firestore and asserts
 * the verdict both ways. firebase-admin is stubbed at the module loader, so
 * no credentials, no network, and it runs in the ordinary CI bucket.
 *
 * Run: node tests/legacy-documents-audit.test.js
 */
'use strict';

const path = require('path');
const Module = require('module');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const SCRIPT = path.join(__dirname, '..', 'scripts', 'audit-legacy-documents.js');

/**
 * Run the real script.
 *   topLevel: rows in /documents        { id, leadId?, filename?, deleted? }
 *   leads:    { [leadId]: { exists, docs: [{ name|filename }] } }
 */
function runAudit(topLevel, leads, argv) {
  const docs = topLevel.map(r => ({ id: r.id, data: () => r }));

  const pagedQuery = () => {
    let started = false;
    const q = {
      orderBy: () => q,
      limit: () => q,
      startAfter: () => { started = true; return q; },
      get: async () => started
        ? { empty: true, docs: [], size: 0 }
        : { empty: docs.length === 0, docs, size: docs.length },
    };
    return q;
  };

  const leadDocRef = (leadId) => ({
    get: async () => ({ exists: !!(leads && leads[leadId] && leads[leadId].exists) }),
    collection: () => ({
      get: async () => ({
        docs: (((leads && leads[leadId]) || {}).docs || []).map(d => ({ data: () => d })),
      }),
    }),
  });

  const adminStub = {
    initializeApp() {},
    credential: { applicationDefault: () => ({}) },
    firestore: () => ({
      collection: (name) => (name === 'leads'
        ? { doc: leadDocRef }
        : pagedQuery()),
    }),
  };

  const realLoad = Module._load;
  Module._load = function (request) {
    if (request === 'firebase-admin') return adminStub;
    return realLoad.apply(this, arguments);
  };

  const realLog = console.log, realErr = console.error;
  const realExit = process.exit, realArgv = process.argv;

  let out = '';
  let code = null;
  console.log = (...a) => { out += a.join(' ') + '\n'; };
  console.error = (...a) => { out += a.join(' ') + '\n'; };
  process.argv = ['node', SCRIPT].concat(argv || []);
  process.exit = (c) => { if (code === null) code = c; };

  const restore = () => {
    Module._load = realLoad;
    console.log = realLog; console.error = realErr;
    process.exit = realExit; process.argv = realArgv;
  };

  delete require.cache[require.resolve(SCRIPT)];
  return (async () => {
    try {
      await require(SCRIPT).main();
    } catch (e) {
      out += 'THREW: ' + (e && e.message) + '\n';
    } finally {
      restore();
    }
    return { code, out };
  })();
}

// The script requires firebase-admin at module scope, which is not installed
// at the repo root (it lives in the admin-script-runner's NODE_PATH). Pull its
// exports through the same loader stub so this suite stays credential-free and
// runs in the ordinary CI bucket. main() does not fire — it is guarded by
// require.main === module.
function loadExports() {
  const realLoad = Module._load;
  Module._load = function (request) {
    if (request === 'firebase-admin') {
      return { initializeApp() {}, credential: { applicationDefault: () => ({}) }, firestore: () => ({}) };
    }
    return realLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve(SCRIPT)];
    return require(SCRIPT);
  } finally {
    Module._load = realLoad;
    delete require.cache[require.resolve(SCRIPT)];
  }
}
const { classify } = loadExports();

(async function main() {
  console.log('LEGACY DOCUMENTS AUDIT — classification');
  ok('a row with no leadId is the company library, not lead data',
    classify({ filename: 'w9.pdf', userId: 'U1' }) === 'companyLibrary');
  ok('a live row with a leadId is lead-scoped', classify({ leadId: 'L1' }) === 'leadScoped');
  ok('a soft-deleted lead row does not justify the merge read',
    classify({ leadId: 'L1', deleted: true }) === 'softDeleted');
  ok('a missing/undefined row does not throw', classify(undefined) === 'companyLibrary');

  console.log('\nLEGACY DOCUMENTS AUDIT — verdict');
  {
    // Only company-library rows. The merge read serves nothing.
    const { code, out } = await runAudit(
      [{ id: 'C1', filename: 'w9.pdf', userId: 'U1' }, { id: 'C2', filename: 'coi.pdf', userId: 'U1' }],
      {});
    ok('company-library-only → safe to delete the merge read', /can be/.test(out) && /no live lead-scoped rows/.test(out));
    ok('it does NOT propose touching the company library', /dashboard-api\.js still needs it/.test(out));
    ok('exits 0 (informational, never a gate)', code === 0);
  }
  {
    // One live lead-scoped row — the expensive direction.
    const { code, out } = await runAudit(
      [{ id: 'D1', leadId: 'L1', filename: 'old-scan.pdf', userId: 'U1' }],
      { L1: { exists: true, docs: [] } });
    ok('a single live lead-scoped row → KEEP', /VERDICT — KEEP/.test(out));
    ok('it says how many would vanish', /1 live document/.test(out));
    ok('exits 0 even when the answer is KEEP', code === 0);
  }
  {
    // Soft-deleted rows are filtered by the store, so they must not flip it.
    const { out } = await runAudit(
      [{ id: 'D1', leadId: 'L1', filename: 'gone.pdf', deleted: true }],
      { L1: { exists: true, docs: [] } });
    ok('a soft-deleted lead row does NOT flip the verdict to KEEP',
      /no live lead-scoped rows/.test(out));
  }
  {
    // Present in both stores under the same name → the store double-renders it.
    const { out } = await runAudit(
      [{ id: 'D1', leadId: 'L1', filename: 'both.pdf' }],
      { L1: { exists: true, docs: [{ name: 'both.pdf' }] } });
    ok('a row present in both stores is reported as a duplicate', /1 of them also exist/.test(out));
  }
  {
    // Parent lead gone — the row is unreachable from any customer page.
    const { out } = await runAudit(
      [{ id: 'D1', leadId: 'GONE', filename: 'x.pdf' }],
      { GONE: { exists: false, docs: [] } });
    ok('a row whose lead no longer exists is flagged as an orphan',
      /parent lead no longer exists\s+1/.test(out));
  }
  {
    const { out } = await runAudit([], {});
    ok('an empty collection is handled without throwing', !/THREW/.test(out));
  }

  console.log('\n──────────────────────');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
  process.exit(0);
})();
