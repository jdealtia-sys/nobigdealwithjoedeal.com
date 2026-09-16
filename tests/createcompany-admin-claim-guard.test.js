/**
 * tests/createcompany-admin-claim-guard.test.js
 *
 * THE DEFECT
 * ──────────
 * functions/handlers/provisioning.js:createCompany read-merge-wrote custom
 * claims via mergeCustomClaims(uid, { companyId: uid, role: 'company_admin' })
 * unconditionally — on both the idempotent re-call path (existing tenant) and
 * the fresh-provisioning path. Neither call checked whether the caller already
 * held role:'admin' (platform admin, minted by mintOwnerClaims in
 * functions/handlers/auth.js for the OWNER_EMAILS founder accounts). Any
 * platform admin who called createCompany — testing self-serve signup, or via
 * the onboarding wizard's documented self-heal retry — had their role claim
 * silently demoted from 'admin' to 'company_admin', losing every
 * isAdmin()/isGlobalAdmin gate in firestore.rules and the callable handlers
 * until mintOwnerClaims was manually re-run.
 *
 * The sibling function already has the correct pattern for this exact
 * hazard: functions/handlers/invites.js:claimInvite refuses outright with
 * "Never let an invite doc rewrite a platform admin's claims." createCompany
 * had no equivalent guard on either of its two mergeCustomClaims call sites.
 *
 * WHY THIS FILE EXECUTES INSTEAD OF GREPPING
 * ───────────────────────────────────────────
 * A string-shape test would have passed on the vulnerable code (the "Never
 * let an invite doc rewrite..." comment lives in a different file entirely).
 * The actual defect is a data-flow property — the CLAIMS PATCH createCompany
 * sends to setCustomUserClaims — so the handler is loaded and RUN here
 * against Firestore/Auth stubs, and the assertions are about what patch it
 * actually wrote, not what the source contains.
 *
 * Pure Node — no emulator, no firebase-admin, no functions/ deps.
 * Run: node tests/createcompany-admin-claim-guard.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'functions/handlers/provisioning.js'), 'utf8');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name); }
}

// ═══════════════════════════════════════════════════════════════
// Load functions/handlers/provisioning.js with every require stubbed, the
// same technique tests/session-revocation.test.js uses for handlers/auth.js.
// new Function (rather than vm) keeps one realm, so HttpsError thrown inside
// the handler is instanceof the class this file created.
// ═══════════════════════════════════════════════════════════════
function loadProvisioning(seedClaims) {
  const calls = { setClaims: [], getUserUids: [] };
  const claimsStore = { 'caller-uid': Object.assign({}, seedClaims) };

  class HttpsError extends Error {
    constructor(code, message, details) { super(message); this.code = code; this.details = details; }
  }

  const authStub = {
    getUser: async (uid) => {
      calls.getUserUids.push(uid);
      return { customClaims: Object.assign({}, claimsStore[uid] || {}) };
    },
    setCustomUserClaims: async (uid, next) => {
      calls.setClaims.push({ uid, next: Object.assign({}, next) });
      claimsStore[uid] = Object.assign({}, next);
    },
  };

  // Minimal Firestore stub: a flat path->data map, doc()/get()/set()/create(),
  // and a batch() that applies its queued set() ops on commit(). Good enough
  // to drive createCompany's idempotent-re-call and fresh-provision branches.
  function makeDb(initialDocs) {
    const docs = Object.assign({}, initialDocs);
    function docRef(p) {
      return {
        path: p,
        get: async () => ({
          exists: Object.prototype.hasOwnProperty.call(docs, p),
          data: () => docs[p],
        }),
        set: async (data, options) => {
          docs[p] = (options && options.merge) ? Object.assign({}, docs[p] || {}, data) : data;
        },
        create: async (data) => {
          if (Object.prototype.hasOwnProperty.call(docs, p)) {
            const e = new Error('ALREADY_EXISTS'); e.code = 6; throw e;
          }
          docs[p] = data;
        },
      };
    }
    return {
      doc: (p) => docRef(p),
      batch: () => {
        const ops = [];
        return {
          set: (ref, data, options) => ops.push({ ref, data, options }),
          commit: async () => {
            for (const op of ops) {
              docs[op.ref.path] = (op.options && op.options.merge)
                ? Object.assign({}, docs[op.ref.path] || {}, op.data)
                : op.data;
            }
          },
        };
      },
      _docs: docs,
    };
  }

  const dbHolder = { db: makeDb({}) };

  const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

  const stubs = {
    'firebase-functions/v2/https': {
      onCall: (options, handler) => {
        const f = async (request) => handler(request);
        f.__options = options;
        return f;
      },
      HttpsError,
    },
    'firebase-functions/v2': { logger: noopLogger },
    'firebase-admin/firestore': {
      getFirestore: () => dbHolder.db,
      FieldValue: { serverTimestamp: () => 'ts' },
    },
    'firebase-admin/auth': { getAuth: () => authStub },
    './_shared': { CORS_ORIGINS: [] },
    '../shared': { callableRateLimit: async () => {} },
    '../prefix-reservation': { validateSeal: () => ({}), decideReservation: () => ({}) },
  };

  const requireStub = (id) => {
    if (!Object.prototype.hasOwnProperty.call(stubs, id)) throw new Error('unstubbed require(' + id + ')');
    return stubs[id];
  };

  const mod = { exports: {} };
  new Function('module', 'exports', 'require', 'console', SERVER_SRC)(
    mod, mod.exports, requireStub, { log: () => {}, warn: () => {}, error: () => {} });

  return {
    fn: mod.exports.createCompany,
    calls,
    claimsStore,
    setDb: (docsObj) => { dbHolder.db = makeDb(docsObj); },
    getDb: () => dbHolder.db,
  };
}

async function callAndCatch(fn, request) {
  try { return { value: await fn(request), error: null }; }
  catch (e) { return { value: null, error: e }; }
}

(async function main() {
  const UID = 'caller-uid';

  // ── 1. Idempotent re-call path (existing tenant) ─────────────────
  console.log('\nIDEMPOTENT RE-CALL — platform admin re-triggers self-heal on an existing tenant');
  {
    const h = loadProvisioning({ role: 'admin', owner: true });
    h.setDb({ [`companies/${UID}`]: { ownerId: UID, name: 'Existing Co' } });

    const { value, error } = await callAndCatch(h.fn, {
      auth: { uid: UID, token: { role: 'admin', owner: true, email: 'owner@example.com' } },
      data: {},
    });

    ok('call succeeds (idempotent no-op)', !error && !!value && value.created === false);
    ok('setCustomUserClaims WAS called (companyId still needs stamping)',
       h.calls.setClaims.length === 1);
    const finalClaims = h.claimsStore[UID] || {};
    ok('BUG GUARD: role stays "admin" — createCompany must not demote a platform admin',
       finalClaims.role === 'admin');
    ok('owner:true survives the merge', finalClaims.owner === true);
    ok('companyId is still stamped so the tenant doc is usable',
       finalClaims.companyId === UID);
  }

  // ── 2. Fresh-provisioning path (brand-new tenant) ────────────────
  console.log('\nFRESH PROVISION — platform admin runs self-serve signup end-to-end');
  {
    const h = loadProvisioning({ role: 'admin', owner: true });
    h.setDb({}); // companies/{uid} does not exist yet

    const { value, error } = await callAndCatch(h.fn, {
      auth: { uid: UID, token: { role: 'admin', owner: true, email: 'owner@example.com' } },
      data: { name: 'Brand New Co', phone: '5551234567', serviceArea: 'Cincinnati' },
    });

    ok('call succeeds and reports created:true', !error && !!value && value.created === true);
    ok('companies/{uid} was actually written',
       !!h.getDb()._docs[`companies/${UID}`] && h.getDb()._docs[`companies/${UID}`].name === 'Brand New Co');
    const finalClaims = h.claimsStore[UID] || {};
    ok('BUG GUARD: role stays "admin" after full provisioning flow — the exact '
       + 'demotion the audit flagged (line 163\'s unconditional mergeCustomClaims call)',
       finalClaims.role === 'admin');
    ok('owner:true survives the merge', finalClaims.owner === true);
    ok('companyId is stamped to the new tenant id',
       finalClaims.companyId === UID);
  }

  // ── 3. Non-regression: ordinary solo signup still gets company_admin ──
  console.log('\nNON-REGRESSION — an ordinary (non-platform-admin) caller still becomes company_admin');
  {
    const h = loadProvisioning({});
    h.setDb({});

    const { value, error } = await callAndCatch(h.fn, {
      auth: { uid: UID, token: { email: 'homeowner@example.com' } },
      data: { name: 'Solo Roofing Co' },
    });

    ok('call succeeds', !error && !!value && value.created === true);
    const finalClaims = h.claimsStore[UID] || {};
    ok('ordinary caller is stamped company_admin (fix must not touch this path)',
       finalClaims.role === 'company_admin');
    ok('companyId is stamped to the new tenant id',
       finalClaims.companyId === UID);
  }

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('Failures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
  console.log('✓ All createCompany admin-claim-guard tests passed');
})().catch((e) => { console.error('\nFATAL:', e && e.stack || e); process.exit(1); });
