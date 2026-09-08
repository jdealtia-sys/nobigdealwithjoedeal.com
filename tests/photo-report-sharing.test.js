/**
 * tests/photo-report-sharing.test.js — the report number, and the share link.
 *
 * Two gaps PR #1483 left open, and the two things that make them dangerous:
 *
 *   1. THE NUMBER WAS A CLOCK READING. `'PHO-' + Date.now().toString()
 *      .slice(-6)` changed on every regeneration of the same report, so a
 *      homeowner quoting "report PHO-482913" named a document that no longer
 *      existed under that name. It is printed on the cover, in the masthead and
 *      — since #1483 fixed the running footer — on every page.
 *
 *   2. A FILED PHOTO REPORT COULD NOT BE SHARED. createReportShareToken only
 *      accepted a `reportId` in the top-level /reports collection; a photo
 *      report is a row in leads/{id}/documents.
 *
 * Everything here is EXECUTED, not grepped. Both files are vm-sandboxed and
 * their real functions called, because the interesting failures all pass a
 * shape test: a number that is stable-looking but re-derived, a share path that
 * authorises off the wrong rules clause, a storagePath guard that matches the
 * happy case and admits a traversal one line over.
 *
 * The escalation tests in §3 are the ones to keep. A `documents` row is
 * CLIENT-writable (firestore.rules:389 — lead owner or company staff), so
 * `storagePath` is attacker-controlled input to a function that mints an
 * UNAUTHENTICATED public URL. Every one of those cases is a real hole if the
 * guard regresses, not a hypothetical.
 *
 * Run: node tests/photo-report-sharing.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
async function throwsWith(fn, code) {
  try { await fn(); return { threw: false }; }
  catch (e) { return { threw: true, code: e && e.code, message: e && e.message }; }
}

// Slice a contiguous run of source out of a file, from a start marker through
// the closing brace of a named function. Throws rather than returning a short
// slice — a silently truncated slice is how a sandbox ends up defining nothing
// and every assertion below it passes against `undefined`.
function endOfFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('function ' + name + ' not found');
  // Balance the PARAMETER LIST before looking for the body. A destructured
  // parameter — `function f(db, { uid, leadId })` — puts a `{` before the body
  // brace, and naive brace-counting from the first `{` closes the function at
  // the end of the parameter list and slices the body away. The suite then
  // sandboxes a fragment, throws a SyntaxError, and (had this been wrapped in a
  // try) would have skipped every assertion below it.
  let i = src.indexOf('(', start), parens = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') parens++;
    else if (src[i] === ')') { parens--; if (parens === 0) { i++; break; } }
  }
  i = src.indexOf('{', i);
  if (i === -1) throw new Error('no body found for ' + name);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('unbalanced braces reading ' + name);
}
function sliceFrom(src, marker, endFnName) {
  const from = src.indexOf(marker);
  if (from === -1) throw new Error('marker not found: ' + marker);
  return src.slice(from, endOfFn(src, endFnName));
}

console.log('PHOTO REPORT — the number that changed every time, and the link that did not exist');

// ══════════════════════════════════════════════════════════════════
// 1. The report number
// ══════════════════════════════════════════════════════════════════
console.log('\n1. Report number — derivation');

const PHOTO_REPORT = read('docs/pro/js/photo-report.js');
const numberSandbox = { console, window: {} };
vm.createContext(numberSandbox);
vm.runInContext(sliceFrom(PHOTO_REPORT, 'const _MODE_TAG', '_resolveReportNumber'), numberSandbox);

const mint = numberSandbox._mintReportNumber;
const seed = numberSandbox._reportSeed;
const dateStamp = numberSandbox._reportDateStamp;
const filedNumber = numberSandbox._filedReportNumber;
const resolveNumber = numberSandbox._resolveReportNumber;

ok('the sandbox actually defined the four helpers',
  [mint, seed, dateStamp, filedNumber].every((f) => typeof f === 'function'));

const SHAPE = /^[A-Z0-9]{2,10}-(PHO|ADJ)-\d{4}-\d{4}-\d{4}$/;
const AT = new Date(2026, 8, 8, 20, 30, 0);   // 2026-09-08 20:30 local

{
  const n = mint('NBD', 'lead-abc', 'homeowner', AT);
  ok('shape is <TENANT>-<PHO|ADJ>-<YYYY>-<MMDD>-<NNNN>', SHAPE.test(n), n);
  ok('carries the date', /-2026-0908-/.test(n), n);
  ok('homeowner mode tags PHO', /-PHO-/.test(n), n);
  ok('adjuster mode tags ADJ', /-ADJ-/.test(mint('NBD', 'lead-abc', 'adjuster', AT)));
}

// THE defect. The old number was a clock reading, so this was false.
{
  const a = mint('NBD', 'lead-abc', 'homeowner', AT);
  const b = mint('NBD', 'lead-abc', 'homeowner', AT);
  ok('regenerating the same report yields the SAME number', a === b, a + ' vs ' + b);
}
{
  const homeowner = mint('NBD', 'lead-abc', 'homeowner', AT);
  const adjuster = mint('NBD', 'lead-abc', 'adjuster', AT);
  ok('the two modes are different documents and get different numbers',
    homeowner !== adjuster);
}
{
  const one = mint('NBD', 'lead-abc', 'homeowner', AT);
  const two = mint('NBD', 'lead-xyz', 'homeowner', AT);
  ok('two leads on the same day do not collide', one !== two, one + ' vs ' + two);
}

// Multi-tenant. A hardcoded 'NBD' on a contractor's own paper is the defect
// estimate-finalization.js:267 and company-profile.js:619 are both written up
// around — a Summit Ridge document that promised an NBD warranty.
{
  const oak = mint('OAK', 'lead-abc', 'adjuster', AT);
  ok('a tenant prefix reaches the number', oak.startsWith('OAK-'), oak);
  ok('no NBD literal leaks into a tenant number', !/NBD/.test(oak), oak);
}

// Local calendar date, not toISOString(). A report built at 8:30pm EDT on the
// 8th must not be stamped the 9th.
{
  const evening = new Date(2026, 8, 8, 20, 30, 0);
  ok('date stamp is LOCAL, not UTC', dateStamp(evening) === '2026-0908',
    dateStamp(evening) + ' (toISOString would say ' + evening.toISOString().slice(0, 10) + ')');
  ok('single-digit month and day are zero-padded',
    dateStamp(new Date(2026, 0, 5)) === '2026-0105', dateStamp(new Date(2026, 0, 5)));
}
{
  ok('seed is four digits', /^\d{4}$/.test(seed(['lead-abc', 'homeowner'])));
  ok('seed is deterministic', seed(['a', 'b']) === seed(['a', 'b']));
  ok('seed varies with its parts', seed(['a', 'b']) !== seed(['a', 'c']));
}

// ══════════════════════════════════════════════════════════════════
// 2. Reuse — the number is assigned once and read back
// ══════════════════════════════════════════════════════════════════
console.log('\n2. Report number — reuse from the filed row');

// Minimal Firestore stub. getDocs returns a snapshot whose forEach yields the
// rows, which is the only surface _filedReportNumber touches.
function withRows(rows, opts) {
  const o = opts || {};
  let prefixCalls = 0;
  const win = {
    db: {},
    collection: (...a) => a,
    query: (...a) => a,
    where: (f, op, v) => ({ f, op, v }),
    getDocs: async () => {
      if (o.throws) throw new Error('permission-denied');
      return { forEach: (cb) => rows.forEach((r) => cb({ data: () => r })) };
    },
    _tenantIdPrefix: async () => { prefixCalls++; return o.prefix || 'NBD'; },
  };
  numberSandbox.window = win;
  return { win, prefixCalls: () => prefixCalls };
}
const ts = (ms) => ({ toMillis: () => ms });

(async () => {
  {
    withRows([{ source: 'photo_report', reportMode: 'homeowner', reportNumber: 'NBD-PHO-2026-0901-1111', uploadedAt: ts(1000) }]);
    ok('a filed number is reused verbatim',
      (await filedNumber('lead-abc', 'homeowner')) === 'NBD-PHO-2026-0901-1111');
  }
  {
    // A number already in a customer's hands outranks a tidy format.
    withRows([{ source: 'photo_report', reportMode: 'homeowner', reportNumber: 'PHO-482913', uploadedAt: ts(1000) }]);
    ok('a LEGACY number is reused rather than renumbered',
      (await filedNumber('lead-abc', 'homeowner')) === 'PHO-482913');
  }
  {
    // Assigned ONCE. The earliest row is the assignment; later rows are
    // regenerations that should have carried it.
    withRows([
      { source: 'photo_report', reportMode: 'homeowner', reportNumber: 'LATER', uploadedAt: ts(9000) },
      { source: 'photo_report', reportMode: 'homeowner', reportNumber: 'FIRST', uploadedAt: ts(1000) },
    ]);
    ok('the EARLIEST filed number wins, not the newest',
      (await filedNumber('lead-abc', 'homeowner')) === 'FIRST');
  }
  {
    withRows([{ source: 'photo_report', reportMode: 'adjuster', reportNumber: 'ADJ-ONE', uploadedAt: ts(1000) }]);
    ok('the other mode\'s number is not borrowed',
      (await filedNumber('lead-abc', 'homeowner')) === '');
  }
  {
    withRows([{ source: 'photo_report', reportMode: 'homeowner', reportNumber: 'GONE', uploadedAt: ts(1000), deleted: true }]);
    ok('a soft-deleted row does not pin the number',
      (await filedNumber('lead-abc', 'homeowner')) === '');
  }
  {
    // Rows filed before reportMode existed were homeowner reports — that was
    // the only mode the dashboard chip could produce.
    withRows([{ source: 'photo_report', reportNumber: 'PHO-OLD', uploadedAt: ts(1000) }]);
    ok('a row with no reportMode counts as homeowner',
      (await filedNumber('lead-abc', 'homeowner')) === 'PHO-OLD');
  }
  {
    // A viewer on a teammate's lead, or an offline client. Must not throw —
    // the report has to render either way.
    withRows([], { throws: true });
    let threw = false, got = null;
    try { got = await filedNumber('lead-abc', 'homeowner'); } catch (_) { threw = true; }
    ok('a denied or failed query returns empty instead of throwing', !threw && got === '');
  }

  console.log('\n3. Report number — resolution order');
  {
    const h = withRows([{ source: 'photo_report', reportMode: 'homeowner', reportNumber: 'REUSED', uploadedAt: ts(1) }]);
    const n = await resolveNumber('lead-abc', 'homeowner');
    ok('resolve prefers the filed number over a fresh mint', n === 'REUSED');
    // The hydration gate. _tenantIdPrefix awaits company-profile hydration and
    // everything after this call reads window._brand() SYNCHRONOUSLY, so it has
    // to be awaited on BOTH branches. estimate-v2-ui.js:3377 is the write-up of
    // what happens when that ordering is left to argument-evaluation order.
    ok('hydration is awaited even on the reuse path that does not need a prefix',
      h.prefixCalls() === 1, 'prefix resolved ' + h.prefixCalls() + ' times');
  }
  {
    withRows([], { prefix: 'OAK' });
    const n = await resolveNumber('lead-abc', 'adjuster');
    ok('with nothing filed, resolve mints in the new shape', SHAPE.test(n), n);
    ok('and mints under the TENANT prefix', n.startsWith('OAK-ADJ-'), n);
  }
  {
    // A failed lookup must still land on the number a successful one would
    // have produced — which is why the seed is (leadId, mode), not the clock.
    withRows([], { throws: true, prefix: 'NBD' });
    const a = await resolveNumber('lead-abc', 'homeowner');
    const b = await resolveNumber('lead-abc', 'homeowner');
    ok('a failed lookup still mints deterministically', a === b && SHAPE.test(a), a);
  }

  // ══════════════════════════════════════════════════════════════════
  // 4. The share path — authorization
  // ══════════════════════════════════════════════════════════════════
  console.log('\n4. Share token — who may publish a lead document');

  const SHARING = read('functions/report-sharing.js');
  class FakeHttpsError extends Error {
    constructor(code, message) { super(message); this.code = code; }
  }

  // Storage stub. getMetadata() is what proves provenance, and it throws for an
  // object that does not exist — the same way the real SDK does.
  function makeSandbox(objects) {
    const sb = {
      console,
      HttpsError: FakeHttpsError,
      logger: { warn() {}, info() {}, error() {} },
      FieldValue: { serverTimestamp: () => '<ts>' },
      REPORT_URL_BASE: 'https://nobigdealwithjoedeal.com/report/',
      getStorage: () => ({
        bucket: () => ({
          file: (p) => ({
            getMetadata: async () => {
              if (!Object.prototype.hasOwnProperty.call(objects, p)) throw new Error('No such object: ' + p);
              return [objects[p]];
            },
          }),
        }),
      }),
    };
    vm.createContext(sb);
    // sanitizeFilename lives up with escHtml, above the resolvers.
    vm.runInContext(sliceFrom(SHARING, 'function sanitizeFilename', 'sanitizeFilename'), sb);
    vm.runInContext(sliceFrom(SHARING, 'const ID_RE', 'resolveLeadDocumentSubject'), sb);
    return sb;
  }

  // A rendered photo report, exactly as render-pdf.js:588-600 writes it.
  const RENDERED = {
    contentType: 'application/pdf', size: 2048,
    metadata: { template: 'photoReport', renderedBy: 'rep-uid', renderedAtMs: '1' },
  };
  const GOOD_PATH = 'pdf-renders/rep-uid/1757000000000-NBD-HomeownerPhotos-Smith-2026-09-08.pdf';

  function makeDb(overrides) {
    const o = overrides || {};
    const lead = Object.assign({ userId: 'rep-uid', companyId: 'co-1', address: '12 Elm St' }, o.lead);
    const row = Object.assign({
      name: 'HomeownerPhotos.pdf', source: 'photo_report',
      storagePath: GOOD_PATH, reportNumber: 'NBD-PHO-2026-0908-4471',
    }, o.row);
    const extra = o.docs || {};
    const writes = [];
    return {
      writes,
      db: {
        doc: (p) => ({
          get: async () => {
            if (p === 'leads/lead-1') return { exists: o.noLead !== true, data: () => lead };
            if (p === 'leads/lead-1/documents/doc-1') return { exists: o.noRow !== true, data: () => row };
            if (Object.prototype.hasOwnProperty.call(extra, p)) return { exists: true, data: () => extra[p] };
            return { exists: false, data: () => ({}) };
          },
          set: async (data) => { writes.push({ path: p, data }); },
        }),
      },
    };
  }

  const sb = makeSandbox({ [GOOD_PATH]: RENDERED });
  const resolveDoc = sb.resolveLeadDocumentSubject;
  ok('the sandbox defined resolveLeadDocumentSubject', typeof resolveDoc === 'function');

  const call = (dbWrap, caller) => resolveDoc(dbWrap.db, Object.assign({
    uid: 'rep-uid', isAdmin: false, leadId: 'lead-1', documentId: 'doc-1',
    token: { role: 'sales_rep', companyId: 'co-1' },
  }, caller));

  {
    const s = await call(makeDb());
    ok('the lead owner may share their own report', s && s.kind === 'lead_document');
    ok('the token records the storagePath, not the recorded url',
      s.tokenExtras.storagePath === GOOD_PATH);
    ok('the token records the report number for the email body',
      s.tokenExtras.reportNumber === 'NBD-PHO-2026-0908-4471');
    ok('a photo report is named as one in the email subject', s.subjectNoun === 'photo report');
  }
  {
    const s = await call(makeDb(), { uid: 'mgr-uid', token: { role: 'manager', companyId: 'co-1' } });
    ok('a same-company manager may share a teammate\'s report', s && s.kind === 'lead_document');
  }
  {
    // Mirrors the WRITE clause (firestore.rules:389), not the READ clause above
    // it. Minting a link PUBLISHES the document; a role that may only look at
    // it must not be able to broadcast it.
    const r = await throwsWith(() => call(makeDb(), { uid: 'viewer-uid', token: { role: 'viewer', companyId: 'co-1' } }));
    ok('a VIEWER who can read the report may NOT publish a link to it',
      r.threw && r.code === 'permission-denied', JSON.stringify(r));
  }
  {
    const r = await throwsWith(() => call(makeDb(), { uid: 'other-uid', token: { role: 'manager', companyId: 'co-2' } }));
    ok('a manager at another company is denied', r.threw && r.code === 'permission-denied');
  }
  {
    // sales_rep is own-leads-only in the role taxonomy, and isCompanyStaff()
    // excludes it — so a rep looking at a teammate's lead is read-only there.
    const r = await throwsWith(() => call(makeDb({ lead: { userId: 'someone-else' } }),
      { uid: 'rep-uid', token: { role: 'sales_rep', companyId: 'co-1' } }));
    ok('a sales_rep on a teammate\'s lead is denied', r.threw && r.code === 'permission-denied');
  }
  {
    const r = await throwsWith(() => call(makeDb({ row: { deleted: true } })));
    ok('a soft-deleted document cannot be shared', r.threw && r.code === 'not-found');
  }

  // ══════════════════════════════════════════════════════════════════
  // 5. The storagePath guard — the escalation surface
  // ══════════════════════════════════════════════════════════════════
  console.log('\n5. Share token — storagePath is attacker-controlled input');

  {
    const r = await throwsWith(() => call(makeDb({ row: { storagePath: '' } })));
    ok('a row with no storagePath is refused rather than falling back to url',
      r.threw && r.code === 'failed-precondition');
  }
  {
    // The whole point of the guard: a rep may WRITE this row.
    const r = await throwsWith(() => call(makeDb({ row: { storagePath: 'photos/other-uid/private.jpg' } })));
    ok('a path outside pdf-renders/ is refused', r.threw && r.code === 'failed-precondition');
  }
  {
    const r = await throwsWith(() => call(makeDb({ row: { storagePath: 'pdf-renders/../photos/x.jpg' } })));
    ok('a traversal path is refused', r.threw && r.code === 'failed-precondition');
  }
  {
    const r = await throwsWith(() => call(makeDb({ row: { storagePath: 'pdf-renders/uid/sub/dir/x.pdf' } })));
    ok('a deeper path than the renderer writes is refused', r.threw && r.code === 'failed-precondition');
  }
  {
    const P = 'pdf-renders/rep-uid/nosuchfile.pdf';
    const s2 = makeSandbox({});
    const r = await throwsWith(() => s2.resolveLeadDocumentSubject(makeDb({ row: { storagePath: P } }).db, {
      uid: 'rep-uid', isAdmin: false, leadId: 'lead-1', documentId: 'doc-1',
      token: { role: 'sales_rep', companyId: 'co-1' },
    }));
    ok('a missing object is refused', r.threw && r.code === 'not-found');
  }
  {
    // Provenance. Object metadata is written by the renderer with the admin SDK
    // and is NOT client-writable, so it is the half a forged Firestore row
    // cannot fake. An object with no renderedBy stamp did not come from
    // renderPdf.
    const P = 'pdf-renders/rep-uid/hand-placed.pdf';
    const s2 = makeSandbox({ [P]: { contentType: 'application/pdf', size: 1, metadata: {} } });
    const r = await throwsWith(() => s2.resolveLeadDocumentSubject(makeDb({ row: { storagePath: P } }).db, {
      uid: 'rep-uid', isAdmin: false, leadId: 'lead-1', documentId: 'doc-1',
      token: { role: 'sales_rep', companyId: 'co-1' },
    }));
    ok('an object with no renderedBy stamp is refused', r.threw && r.code === 'failed-precondition');
  }
  {
    // A third party's render, pointed at from a row the caller may write.
    const P = 'pdf-renders/stranger-uid/1-their-report.pdf';
    const s2 = makeSandbox({ [P]: { contentType: 'application/pdf', size: 1, metadata: { renderedBy: 'stranger-uid' } } });
    const r = await throwsWith(() => s2.resolveLeadDocumentSubject(makeDb({ row: { storagePath: P } }).db, {
      uid: 'rep-uid', isAdmin: false, leadId: 'lead-1', documentId: 'doc-1',
      token: { role: 'sales_rep', companyId: 'co-1' },
    }));
    ok('a stranger\'s rendered PDF cannot be shared through your own lead row',
      r.threw && r.code === 'permission-denied');
  }

  // ══════════════════════════════════════════════════════════════════
  // 6. Token reuse
  // ══════════════════════════════════════════════════════════════════
  console.log('\n6. Share token — reuse, so revoking revokes the right link');

  const LIVE = { status: 'active', storagePath: GOOD_PATH, expiresAt: ts(Date.now() + 86400000) };
  {
    const w = makeDb({
      row: { shareToken: 'ABCDEFGHJKLMNPQRSTUVWX' },
      docs: { 'report_share_tokens/ABCDEFGHJKLMNPQRSTUVWX': LIVE },
    });
    const s = await call(w);
    ok('a live token is reused instead of minting a second link',
      s.existingToken === 'ABCDEFGHJKLMNPQRSTUVWX');
  }
  {
    const w = makeDb({
      row: { shareToken: 'ABCDEFGHJKLMNPQRSTUVWX' },
      docs: { 'report_share_tokens/ABCDEFGHJKLMNPQRSTUVWX': Object.assign({}, LIVE, { status: 'revoked' }) },
    });
    const s = await call(w);
    ok('a REVOKED token is not reused', s.existingToken === '');
  }
  {
    const w = makeDb({
      row: { shareToken: 'ABCDEFGHJKLMNPQRSTUVWX' },
      docs: { 'report_share_tokens/ABCDEFGHJKLMNPQRSTUVWX': Object.assign({}, LIVE, { expiresAt: ts(Date.now() - 1000) }) },
    });
    const s = await call(w);
    ok('an EXPIRED token is not reused', s.existingToken === '');
  }
  {
    // The report was regenerated, so the row points at a new object. Reusing a
    // token bound to the old path would serve the stale PDF forever.
    const w = makeDb({
      row: { shareToken: 'ABCDEFGHJKLMNPQRSTUVWX' },
      docs: { 'report_share_tokens/ABCDEFGHJKLMNPQRSTUVWX': Object.assign({}, LIVE, { storagePath: 'pdf-renders/rep-uid/old.pdf' }) },
    });
    const s = await call(w);
    ok('a token bound to a DIFFERENT storagePath is not reused', s.existingToken === '');
  }
  {
    const w = makeDb();
    const s = await call(w);
    await s.onMinted('TOKENTOKENTOKENTOKEN12', ts(1));
    const back = w.writes.find((x) => x.path === 'leads/lead-1/documents/doc-1');
    ok('minting writes the link back onto the document row',
      !!back && back.data.shareToken === 'TOKENTOKENTOKENTOKEN12'
      && /\/report\/TOKENTOKENTOKENTOKEN12$/.test(back.data.shareUrl || ''));
  }

  // ══════════════════════════════════════════════════════════════════
  // 7. Serving
  // ══════════════════════════════════════════════════════════════════
  console.log('\n7. Serving the PDF');

  {
    const clean = sb.sanitizeFilename;
    ok('sanitizeFilename is reachable', typeof clean === 'function');
    ok('a quote cannot close the Content-Disposition string',
      !/["]/.test(clean('re"port".pdf')), clean('re"port".pdf'));
    ok('a CRLF cannot inject a second header',
      !/[\r\n]/.test(clean('a.pdf\r\nX-Evil: 1')), JSON.stringify(clean('a.pdf\r\nX-Evil: 1')));
    ok('an empty name still yields a filename', clean('') === 'report.pdf');
    ok('a leading dot cannot make a hidden file', !clean('...pdf').startsWith('.'), clean('...pdf'));
    ok('an ordinary name survives', clean('NBD-HomeownerPhotos-Smith-2026-09-08.pdf')
      === 'NBD-HomeownerPhotos-Smith-2026-09-08.pdf');
  }
  {
    // The serve-side path guard, executed against the same regex the mint side
    // uses. Defense in depth: the token was written by this function, but a
    // second read of an attacker-influenced field deserves a second check.
    // A `const` in a vm context is not a property of the context object the
    // way a hoisted function declaration is — read it by evaluating the name.
    const RE = vm.runInContext('RENDER_PATH_RE', sb);
    // `instanceof RegExp` is FALSE here: the vm context is a separate realm
    // with its own RegExp constructor. Brand-check across realms instead.
    ok('the serve-side guard regex was actually read',
      Object.prototype.toString.call(RE) === '[object RegExp]');
    ok('the serve-side guard accepts a real render path', RE.test(GOOD_PATH));
    ok('the serve-side guard rejects a photos/ path', !RE.test('photos/uid/x.jpg'));
  }
  {
    // Backward compatibility: every token minted before today has no `kind`,
    // and must still take the inline-HTML path.
    const serve = SHARING.slice(SHARING.indexOf('getSharedReport — /report/'));
    ok('the PDF branch is gated on an explicit kind, so legacy tokens fall through to HTML',
      /tok\.kind === 'lead_document'/.test(serve));
    ok('the view stamp is recorded before the branch, so both kinds are tracked',
      serve.indexOf('viewCount') < serve.indexOf("tok.kind === 'lead_document'"));
  }

  // ══════════════════════════════════════════════════════════════════
  console.log('\n' + (failed === 0 ? '✅' : '❌') + ' ' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('   failed: ' + fails.join(' · ')); process.exit(1); }
})().catch((e) => {
  console.error('\n❌ suite crashed:', e && e.stack || e);
  process.exit(1);
});
