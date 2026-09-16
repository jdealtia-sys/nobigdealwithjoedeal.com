/**
 * tests/customer-audit-integrity.test.js — dispute-evidence integrity for
 * functions/customer-audit.js + the document_view coverage gap.
 *
 * Two findings from the audit, both proven red-then-green here:
 *
 * 1. recordCustomerEvent (functions/customer-audit.js) validated the portal
 *    token but never validated that resourceId referred to something the
 *    token's homeowner could actually see. A rep — or anyone holding the
 *    token — could POST an arbitrary photo_view/estimate_view/document_view
 *    resourceId and it would be written to customerAuditEvents (write:false
 *    to clients, read-only to the rep) indistinguishable from a genuine
 *    homeowner action. Section 1 drives the REAL handler against a stubbed
 *    Firestore (Module._load stub for firebase-admin/firestore + the
 *    rate-limit adapter, same convention as tests/legacy-documents-audit.test.js)
 *    and proves a forged resourceId is never trusted verbatim.
 *
 * 2. 'document_view' is declared in ALLOWED_TYPES and rendered in the rep
 *    timeline, but nothing ever emitted it — the homeowner's one
 *    document-viewing action (Download Signed Contract) had zero audit
 *    trail. Section 2 extracts wireDocumentLinks() from docs/pro/js/portal.js
 *    and vm-executes it against a fake DOM (same extract-and-vm-execute
 *    convention as tests/portal-preview-telemetry.test.js), proving a real
 *    click fires _emitAuditEvent('document_view', <estimateId>).
 *
 * Run: node tests/customer-audit-integrity.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { EventEmitter } = require('events');

const ROOT = path.join(__dirname, '..');
const CUSTOMER_AUDIT = path.join(ROOT, 'functions', 'customer-audit.js');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('CUSTOMER AUDIT INTEGRITY — forgeable resourceId + document_view gap');

/* ══════════════════════════════════════════════════════════════════
   1. recordCustomerEvent — resourceId must be verified, not trusted
   ══════════════════════════════════════════════════════════════════ */
console.log('\n1. functions/customer-audit.js — recordCustomerEvent (real execution, stubbed Firestore)');

/**
 * Loads the real customer-audit.js with firebase-admin/firestore and the
 * rate-limit adapter stubbed at the module loader, mirroring
 * tests/legacy-documents-audit.test.js's convention for functions/*.js.
 *
 * fixtures:
 *   tokens:    { [token]: portal_tokens doc data (or undefined) }
 *   photos:    { [id]: photos doc data (or undefined) }
 *   estimates: { [id]: estimates doc data (or undefined) }
 * writes: array this call pushes every customerAuditEvents.add() payload into.
 */
function loadRecordCustomerEvent(fixtures, writes) {
  const realLoad = Module._load;
  Module._load = function (request) {
    if (request === 'firebase-admin/firestore') {
      const snap = (data) => ({ exists: data !== undefined, data: () => data });
      const db = {
        doc(p) {
          const [col, id] = p.split('/');
          const table = col === 'portal_tokens' ? fixtures.tokens
            : col === 'photos' ? fixtures.photos
            : col === 'estimates' ? fixtures.estimates
            : {};
          return { get: async () => snap(table ? table[id] : undefined) };
        },
        collection(name) {
          if (name !== 'customerAuditEvents') throw new Error('unexpected collection: ' + name);
          return { add: async (data) => { writes.push(data); return { id: 'ev_' + writes.length }; } };
        },
      };
      return { getFirestore: () => db, FieldValue: { serverTimestamp: () => 'SERVER_TS' } };
    }
    if (request === './integrations/upstash-ratelimit') {
      // Rate limiting is a separate concern with its own coverage; never let
      // it block this suite's requests.
      return { httpRateLimit: async () => true };
    }
    return realLoad.apply(this, arguments);
  };
  try {
    delete require.cache[require.resolve(CUSTOMER_AUDIT)];
    const mod = require(CUSTOMER_AUDIT);
    return mod.recordCustomerEvent;
  } finally {
    Module._load = realLoad;
    delete require.cache[require.resolve(CUSTOMER_AUDIT)];
  }
}

function makeReq(body) {
  return {
    method: 'POST',
    body,
    headers: { 'user-agent': 'test-agent', 'x-forwarded-for': '203.0.113.5' },
  };
}
// onRequest({..., cors: [...]}, handler) wraps the real handler in the cors
// npm middleware, which needs a real response-like object (EventEmitter +
// header methods) — a bare {status,json,end} stub throws inside firebase-
// functions' `res.on("finish", resolve)` wrapper. This mirrors an actual
// Express/Connect ServerResponse just enough for that middleware to pass
// through and for our handler's res.status().json()/res.end() calls to work.
function makeRes() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.body = null;
  const headers = {};
  res.setHeader = (k, v) => { headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => headers[k.toLowerCase()];
  res.removeHeader = (k) => { delete headers[k.toLowerCase()]; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.end(); return res; };
  res.end = (...args) => { if (!res._ended) { res._ended = true; res.emit('finish'); } return res; };
  return res;
}

const VALID_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAA'; // 24 chars, matches the mint shape
const FUTURE = { toMillis: () => Date.now() + 999999, seconds: 0 };
const baseTok = { leadId: 'lead1', ownerUid: 'rep1', expiresAt: FUTURE, uses: 3, maxUses: 100 };

/* Section 1 runs inside an async function so awaits work top-level in this
   plain-Node test file. */
async function section1() {
  // 1a. photo_view: resourceId belonging to a DIFFERENT lead is forgeable pre-fix.
  {
    const writes = [];
    const handler = loadRecordCustomerEvent({
      tokens: { [VALID_TOKEN]: baseTok },
      photos: { photoVictim: { leadId: 'lead2', userId: 'rep1', sharedWithHomeowner: true } },
      estimates: {},
    }, writes);
    await handler(makeReq({ token: VALID_TOKEN, type: 'photo_view', resourceId: 'photoVictim' }), makeRes());
    ok('cross-lead photo resourceId is written but NEVER trusted verbatim',
      writes.length === 1 && writes[0].resourceId !== 'photoVictim',
      'wrote resourceId=' + JSON.stringify(writes[0] && writes[0].resourceId));
    ok('cross-lead photo resourceId is nulled out', writes.length === 1 && writes[0].resourceId === null);
    ok('entry is stamped resourceVerified:false (unverified, not evidentiary)',
      writes.length === 1 && writes[0].resourceVerified === false);
  }

  // 1b. photo_view for a photo that exists, belongs to the right lead, but was
  // never flipped sharedWithHomeowner (the homeowner never actually had it in
  // their gallery) — same forgery shape, must also be rejected.
  {
    const writes = [];
    const handler = loadRecordCustomerEvent({
      tokens: { [VALID_TOKEN]: baseTok },
      photos: { photoPrivate: { leadId: 'lead1', userId: 'rep1', sharedWithHomeowner: false } },
      estimates: {},
    }, writes);
    await handler(makeReq({ token: VALID_TOKEN, type: 'photo_view', resourceId: 'photoPrivate' }), makeRes());
    ok('a not-shared photo cannot be claimed as viewed', writes[0].resourceId === null && writes[0].resourceVerified === false);
  }

  // 1c. photo_view for a resourceId that does not exist at all (pure fabrication).
  {
    const writes = [];
    const handler = loadRecordCustomerEvent({
      tokens: { [VALID_TOKEN]: baseTok },
      photos: {},
      estimates: {},
    }, writes);
    await handler(makeReq({ token: VALID_TOKEN, type: 'photo_view', resourceId: 'doesNotExist' }), makeRes());
    ok('a wholly fabricated photo id is nulled out', writes[0].resourceId === null && writes[0].resourceVerified === false);
  }

  // 1d. photo_view for a REAL, correctly-shared photo on the token's own lead
  // must still be recorded and marked verified — the fix must not break the
  // legitimate case.
  {
    const writes = [];
    const handler = loadRecordCustomerEvent({
      tokens: { [VALID_TOKEN]: baseTok },
      photos: { photoReal: { leadId: 'lead1', userId: 'rep1', sharedWithHomeowner: true } },
      estimates: {},
    }, writes);
    await handler(makeReq({ token: VALID_TOKEN, type: 'photo_view', resourceId: 'photoReal' }), makeRes());
    ok('a genuine same-lead, shared photo view IS recorded with its real id',
      writes[0].resourceId === 'photoReal');
    ok('genuine view is stamped resourceVerified:true', writes[0].resourceVerified === true);
  }

  // 1e. estimate_view: an estimate belonging to a different lead is forgeable pre-fix.
  {
    const writes = [];
    const handler = loadRecordCustomerEvent({
      tokens: { [VALID_TOKEN]: baseTok },
      photos: {},
      estimates: { estVictim: { leadId: 'lead2' } },
    }, writes);
    await handler(makeReq({ token: VALID_TOKEN, type: 'estimate_view', resourceId: 'estVictim' }), makeRes());
    ok('cross-lead estimate resourceId is nulled out, not trusted',
      writes[0].resourceId === null && writes[0].resourceVerified === false);
  }

  // 1f. estimate_view for the token's own lead's real estimate is recorded verified.
  {
    const writes = [];
    const handler = loadRecordCustomerEvent({
      tokens: { [VALID_TOKEN]: baseTok },
      photos: {},
      estimates: { est1: { leadId: 'lead1' } },
    }, writes);
    await handler(makeReq({ token: VALID_TOKEN, type: 'estimate_view', resourceId: 'est1' }), makeRes());
    ok('genuine same-lead estimate view is recorded with its real id and verified:true',
      writes[0].resourceId === 'est1' && writes[0].resourceVerified === true);
  }

  // 1g. document_view: claiming a document was viewed on an estimate that has
  // no signedDocumentUrl at all — there is no document to have viewed.
  {
    const writes = [];
    const handler = loadRecordCustomerEvent({
      tokens: { [VALID_TOKEN]: baseTok },
      photos: {},
      estimates: { est2: { leadId: 'lead1' /* no signedDocumentUrl */ } },
    }, writes);
    await handler(makeReq({ token: VALID_TOKEN, type: 'document_view', resourceId: 'est2' }), makeRes());
    ok('document_view against an estimate with no signed document is nulled out',
      writes[0].resourceId === null && writes[0].resourceVerified === false);
  }

  // 1h. document_view for a real signed estimate on the token's own lead is
  // recorded and verified — the fix must not break the real path this same
  // suite's section 2 wires up.
  {
    const writes = [];
    const handler = loadRecordCustomerEvent({
      tokens: { [VALID_TOKEN]: baseTok },
      photos: {},
      estimates: { est3: { leadId: 'lead1', signedDocumentUrl: 'https://storage.googleapis.com/x/signed.pdf' } },
    }, writes);
    await handler(makeReq({ token: VALID_TOKEN, type: 'document_view', resourceId: 'est3' }), makeRes());
    ok('genuine signed-document view is recorded with its real id and verified:true',
      writes[0].resourceId === 'est3' && writes[0].resourceVerified === true);
  }

  // 1i. portal_open never carries a resourceId to verify — resourceVerified
  // stays null (not applicable), and the write still happens (no regression
  // to the base telemetry path).
  {
    const writes = [];
    const handler = loadRecordCustomerEvent({
      tokens: { [VALID_TOKEN]: baseTok },
      photos: {},
      estimates: {},
    }, writes);
    await handler(makeReq({ token: VALID_TOKEN, type: 'portal_open' }), makeRes());
    ok('portal_open (no resourceId) still writes normally', writes.length === 1 && writes[0].resourceId === null);
    ok('portal_open resourceVerified is null (not applicable, not "unverified")', writes[0].resourceVerified === null);
  }

  // 1j. Existing invariants untouched by the fix: unknown token, expired
  // token, and invalid type still short-circuit before any write.
  {
    const writes = [];
    const handler = loadRecordCustomerEvent({ tokens: {}, photos: {}, estimates: {} }, writes);
    const res = makeRes();
    await handler(makeReq({ token: VALID_TOKEN, type: 'photo_view', resourceId: 'x' }), res);
    ok('unknown token still 404s with zero writes', res.statusCode === 404 && writes.length === 0);
  }
  {
    const writes = [];
    const handler = loadRecordCustomerEvent({
      tokens: { [VALID_TOKEN]: Object.assign({}, baseTok, { expiresAt: { toMillis: () => Date.now() - 1000 } }) },
      photos: {}, estimates: {},
    }, writes);
    const res = makeRes();
    await handler(makeReq({ token: VALID_TOKEN, type: 'photo_view', resourceId: 'x' }), res);
    ok('expired token still 410s with zero writes', res.statusCode === 410 && writes.length === 0);
  }
}

/* ══════════════════════════════════════════════════════════════════
   2. docs/pro/js/portal.js — document_view is actually emitted
   ══════════════════════════════════════════════════════════════════ */
function section2() {
  console.log('\n2. docs/pro/js/portal.js — wireDocumentLinks() emits document_view (real execution)');
  const PORTAL = fs.readFileSync(path.join(ROOT, 'docs/pro/js/portal.js'), 'utf8').replace(/\r\n/g, '\n');

  ok("'document_view' stays a declared ALLOWED_TYPE on the server (sanity — the gap was coverage, not the type)",
    (() => {
      const src = fs.readFileSync(CUSTOMER_AUDIT, 'utf8');
      return /'document_view'/.test(src);
    })());

  const fnBlock = PORTAL.match(/function wireDocumentLinks\(view\) \{[\s\S]*?\n {2}\}\n/);
  ok('wireDocumentLinks() exists in portal.js', !!fnBlock,
    'the signed-contract link had no click handler at all — this is the gap the audit found');
  if (!fnBlock) {
    console.log('\ncannot continue without wireDocumentLinks');
    return;
  }

  ok('the signed-contract anchor carries the id wireDocumentLinks binds to',
    /id="signedContractLink"[\s\S]{0,20}class="btn btn-ghost"/.test(PORTAL)
      || /class="btn btn-ghost"[\s\S]{0,5}id="signedContractLink"/.test(PORTAL)
      || /<a id="signedContractLink"/.test(PORTAL));

  ok('wireDocumentLinks(view) is called from the render pipeline (not just defined)',
    /wireDocumentLinks\(view\);/.test(PORTAL));

  // Real execution: vm-run the extracted function against a fake DOM + a
  // spy _emitAuditEvent, and click the fake anchor.
  function evalClick({ hasLink }) {
    const calls = [];
    let clickCb = null;
    const fakeLink = {
      addEventListener(evt, cb) { if (evt === 'click') clickCb = cb; },
    };
    const ctx = {
      document: { getElementById: (id) => (hasLink && id === 'signedContractLink') ? fakeLink : null },
      _emitAuditEvent: (type, id) => { calls.push([type, id]); },
    };
    vm.createContext(ctx);
    vm.runInContext(fnBlock[0] + '\nthis.__wire = wireDocumentLinks;', ctx);
    ctx.__wire({ estimate: { id: 'est_42' } });
    if (clickCb) clickCb();
    return calls;
  }

  const calls = evalClick({ hasLink: true });
  ok('clicking the signed-contract link emits document_view',
    calls.length === 1 && calls[0][0] === 'document_view',
    'calls=' + JSON.stringify(calls));
  ok('the emitted resourceId is the estimate id (matches the estimate_view convention)',
    calls.length === 1 && calls[0][1] === 'est_42');

  const noLinkCalls = evalClick({ hasLink: false });
  ok('no-op when the card never rendered (no signed document → no link → no crash, no emit)',
    noLinkCalls.length === 0);
}

(async function main() {
  await section1();
  section2();

  console.log('\n' + '─'.repeat(60));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('\nFailures:');
    fails.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
})();
