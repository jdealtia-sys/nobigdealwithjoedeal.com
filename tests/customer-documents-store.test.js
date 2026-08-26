/**
 * tests/customer-documents-store.test.js — one store, one loader, every surface.
 *
 * THE BUG THIS LOCKS OUT (2026-08-18)
 *
 * The customer page grew four "documents" surfaces reading three different
 * Firestore locations, and the one location documents actually land in was
 * read by only one of them:
 *
 *   Overview → Documents (#docList)     read top-level `documents`
 *   Documents tab → Shared              read `lead_documents`
 *   Documents tab → Generated           read nothing at all (DOM-only)
 *   Documents tab → #signedDocsList     read leads/{id}/documents  ← the real one
 *
 * All three real writers — the document generator, the signed-doc upload, and
 * drag-and-drop — write leads/{leadId}/documents. So a customer with a stack of
 * generated contracts showed "No documents yet" on the Overview, a permanently
 * empty "Shared Documents" panel (nothing in this repo has EVER written
 * `lead_documents`), and a "Generated Documents" list that emptied itself on
 * reload. The one honest panel ran off a setTimeout(…, 2000) at
 * DOMContentLoaded — before window._customerId existed on a cold load — and
 * silently gave up forever when it lost that race.
 *
 * These assertions are the guard rails for the consolidation:
 *   1. every writer targets the canonical subcollection,
 *   2. no surface reads a store nothing writes,
 *   3. the loader runs off the real lead id, never a timer,
 *   4. a FAILED read never renders as an empty one — that lie is what let the
 *      whole thing hide for as long as it did.
 *
 * Run: node tests/customer-documents-store.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');

const STORE = read('docs/pro/js/customer-documents.js');
const HTML = read('docs/pro/customer.html');
const UPLOAD = read('docs/pro/js/customer-signed-doc-upload.js');
const DND = read('docs/pro/js/customer-dnd-upload.js');
const GEN = read('docs/pro/js/document-generator.js');
const LEGACY = read('docs/pro/js/customer-photo-report-generator.js');
const TASKS = read('docs/pro/js/customer-tasks-ui.js');
const BOOT = read('docs/pro/js/customer-bootstrap.module.js');

const CANONICAL = /collection\(\s*window\.db\s*,\s*'leads'\s*,\s*[^,]+,\s*'documents'\s*\)/;

console.log('DOCUMENTS STORE — every writer targets the canonical subcollection');
ok('signed/camera upload writes leads/{id}/documents', CANONICAL.test(UPLOAD));
ok('drag-and-drop writes leads/{id}/documents', CANONICAL.test(DND));
ok('the document generator writes leads/{id}/documents', /'leads',\s*_leadIdEarly,\s*'documents'/.test(GEN));
ok('the Overview upload modal writes leads/{id}/documents too (was top-level)',
  CANONICAL.test(LEGACY));
ok('no customer-page module writes the bare top-level `documents` collection',
  ![UPLOAD, DND, LEGACY, TASKS, STORE].some(s => /collection\(\s*window\.db\s*,\s*'documents'\s*\)/.test(s)));

console.log('\nDOCUMENTS STORE — no surface reads a store nothing writes');
ok('`lead_documents` is gone from the whole customer page',
  ![HTML, TASKS, STORE, UPLOAD, DND, LEGACY].some(s => /getDocs|collection/.test(s) && /'lead_documents'/.test(s)));
ok('the dead Shared Documents panel is gone from the markup', !/id="sharedDocList"/.test(HTML));
ok('loadSharedDocuments is no longer defined', !/window\.loadSharedDocuments\s*=/.test(TASKS));
ok('loadSharedDocuments is no longer called', !/window\.loadSharedDocuments\(/.test(TASKS));

console.log('\nDOCUMENTS STORE — one loader, wired to the real lead id');
ok('the store publishes window.loadDocuments', /window\.loadDocuments\s*=\s*load;/.test(STORE));
ok('nothing else defines window.loadDocuments', !/window\.loadDocuments\s*=/.test(LEGACY));
ok('the bootstrap calls it with the resolved lead id', /await window\.loadDocuments\(id\)/.test(BOOT));
ok('the page loads the store module', /src="js\/customer-documents\.js/.test(HTML));
ok('the store loads BEFORE the upload modules that refresh it',
  HTML.indexOf('js/customer-documents.js') < HTML.indexOf('js/customer-signed-doc-upload.js'));
ok('generated docs are persisted+reread, not just inserted into the DOM',
  /NBDCustomerDocs\.refresh\(\)/.test(TASKS) && !/listEl\.insertBefore/.test(TASKS));

console.log('\nDOCUMENTS STORE — a failed read must not look like an empty one');
ok('the store has a distinct error paint', /Could not load documents/.test(STORE));
// Guard the error branch's own body, so nobody "simplifies" it back into the
// empty state. That collapse is the exact shape of the original bug.
const PAINT_ERROR_BODY = (/function paintError\(\)[\s\S]*?\r?\n {2}\}/.exec(STORE) || [''])[0]
  .split(/\r?\n/).filter(l => !/^\s*\/\//.test(l)).join('\n');   // comments name the bug; code must not
ok('paintError() was found to inspect', PAINT_ERROR_BODY.length > 0);
ok('the error paint never reuses the empty-state copy',
  !PAINT_ERROR_BODY.includes('No documents yet'));
ok('the subcollection read rethrows instead of swallowing', /throw e;/.test(STORE));

// ── Behavioural: the real store against a fake Firestore ──────────
function loadEnv(subDocs, legacyDocs, opts) {
  opts = opts || {};
  const els = {};
  const counts = {};
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, Date,
    document: {
      addEventListener() {},
      getElementById(id) { return (els[id] = els[id] || { id, innerHTML: '' }); },
    },
  };
  const win = sandbox;
  win.window = win;
  win._customerId = 'LEAD1';
  win.db = {};
  win.auth = { currentUser: { uid: 'U1' } };
  win.collection = function (_db, ...parts) { return { path: parts.join('/') }; };
  win.query = function (c) { return { legacy: true, ref: c }; };
  win.where = function () { return {}; };
  win.doc = function (_db, ...parts) { return { path: parts.join('/') }; };
  win.updateDoc = async function () {};
  win.getDocs = async function (ref) {
    if (ref && ref.legacy) return { docs: (legacyDocs || []).map(d => ({ id: d.id, data: () => d })) };
    if (opts.failSub) throw new Error('permission-denied');
    return { docs: (subDocs || []).map(d => ({ id: d.id, data: () => d })) };
  };
  win.nbdNavCount = function (id, n) { counts[id] = n; };
  win.nbdTitleCount = function (id, base, n) { counts[id] = n; };
  vm.runInNewContext(STORE, sandbox, { filename: 'customer-documents.js' });
  return { win, els, counts };
}

const ts = iso => ({ toDate: () => new Date(iso) });

// The three writers stamp three different field shapes for the same thing.
// GENERATED is the PRE-MIGRATION generator shape: htmlUrl was a
// getDownloadURL — a permanent, no-auth, unrevocable token URL — persisted
// to Firestore. GENERATED_V2 is the current shape: htmlPath only, re-opened
// through the authed getDocumentHtml callable (functions/document-view.js).
const GENERATED = {
  id: 'G1', type: 'contract', typeName: 'Roofing Contract',
  filename: 'NBD-contract-2026-08-18.pdf', htmlUrl: 'https://x.test/c.html',
  createdAt: ts('2026-08-18T10:00:00Z'),
};
const GENERATED_V2 = {
  id: 'G2', type: 'contract', typeName: 'Roofing Contract',
  filename: 'NBD-contract-2026-08-26.pdf',
  htmlPath: 'documents/U1/LEAD1/d-123.html',
  createdAt: ts('2026-08-26T10:00:00Z'),
};
const UPLOADED = {
  id: 'U1', name: 'signed-scan.pdf', url: 'https://x.test/s.pdf',
  type: 'application/pdf', size: 51200, uploadedAt: ts('2026-08-17T10:00:00Z'),
  source: 'signed_upload',
};

(async function main() {
  console.log('\nDOCUMENTS STORE — behaviour');
  {
    const { win, els, counts } = loadEnv([GENERATED, UPLOADED]);
    await win.NBDCustomerDocs.load('LEAD1');

    ok('a GENERATED doc renders (was invisible on the Overview)',
      /NBD-contract-2026-08-18\.pdf/.test(els.docList.innerHTML));
    ok('an UPLOADED doc renders on the Overview too',
      /signed-scan\.pdf/.test(els.docList.innerHTML));
    ok('a PRE-MIGRATION generated doc (htmlUrl, no htmlPath) still links its htmlUrl',
      /href="https:\/\/x\.test\/c\.html"/.test(els.docList.innerHTML));
    ok('generated docs land in the Generated panel',
      /NBD-contract/.test(els.generatedDocList.innerHTML) && !/signed-scan/.test(els.generatedDocList.innerHTML));
    ok('uploaded docs land in the Uploaded panel',
      /signed-scan/.test(els.signedDocsList.innerHTML) && !/NBD-contract/.test(els.signedDocsList.innerHTML));
    ok('the nav badge counts the merged set', counts.navCountDocs === 2);
    ok('the panel title counts the merged set', counts.docsPanelTitle === 2);
    ok('newest first', els.docList.innerHTML.indexOf('NBD-contract') < els.docList.innerHTML.indexOf('signed-scan'));
  }
  {
    // The tokenless shape (2026-08-18 fix): htmlPath only. No anchor to a
    // permanent token URL — a data-doc-view button routed through the authed
    // getDocumentHtml callable instead.
    const { win, els, counts } = loadEnv([GENERATED_V2]);
    await win.NBDCustomerDocs.load('LEAD1');
    ok('an htmlPath-only generated doc renders',
      /NBD-contract-2026-08-26\.pdf/.test(els.docList.innerHTML));
    ok('…with a callable View button, not an anchor',
      /data-doc-view="G2"/.test(els.docList.innerHTML));
    ok('…and no href at all — there is no URL to leak',
      !/href=/.test(els.docList.innerHTML));
    ok('…and is counted', counts.navCountDocs === 1);
  }
  {
    // A row that recorded BOTH (late pre-migration) prefers the callable —
    // its token may already have been revoked by the orphan sweep.
    const BOTH = Object.assign({}, GENERATED, { id: 'G3', htmlPath: 'documents/U1/LEAD1/d-9.html' });
    const { win, els } = loadEnv([BOTH]);
    await win.NBDCustomerDocs.load('LEAD1');
    ok('a row with htmlPath AND htmlUrl prefers the callable',
      /data-doc-view="G3"/.test(els.docList.innerHTML));
    ok('…and never links the token URL', !/x\.test\/c\.html/.test(els.docList.innerHTML));
  }
  {
    // A document migrated from the top-level collection into the subcollection
    // is returned by BOTH reads. Without deduping it renders twice.
    const SAME = 'https://x.test/same.pdf';
    const { win, els, counts } = loadEnv(
      [{ id: 'S1', name: 'moved.pdf', url: SAME, uploadedAt: ts('2026-08-18T10:00:00Z') }],
      [{ id: 'L1', filename: 'moved.pdf', url: SAME, uploadedAt: ts('2026-01-01T00:00:00Z') }]);
    await win.NBDCustomerDocs.load('LEAD1');
    // Count ROWS, not name occurrences — each row prints the name twice
    // (the label, and the delete button's data-arg2).
    const rows = (els.docList.innerHTML.match(/data-doc-id="/g) || []).length;
    ok('a row in BOTH stores renders once, not twice', rows === 1);
    ok('and is counted once', counts.navCountDocs === 1);
    ok('the surviving row is the canonical one, so delete can reach it',
      win._customerDocs[0].id === 'S1' && win._customerDocs[0].legacy === false);
  }
  {
    // The dangerous direction: two DIFFERENT files that happen to share a
    // name must both survive. Hiding a real document is worse than a dupe.
    const { win, els, counts } = loadEnv([
      { id: 'A1', name: 'invoice.pdf', url: 'https://x.test/a.pdf', uploadedAt: ts('2026-08-18T10:00:00Z') },
      { id: 'A2', name: 'invoice.pdf', url: 'https://x.test/b.pdf', uploadedAt: ts('2026-08-17T10:00:00Z') },
    ]);
    await win.NBDCustomerDocs.load('LEAD1');
    ok('same name + different file = both kept (never hide a document)', counts.navCountDocs === 2);
    ok('both rows render', (els.docList.innerHTML.match(/data-doc-id="/g) || []).length === 2);
  }
  {
    // Nothing to prove sameness with — must not collapse.
    const { win, counts } = loadEnv([
      { id: 'N1', name: 'one.pdf', uploadedAt: ts('2026-08-18T10:00:00Z') },
      { id: 'N2', name: 'two.pdf', uploadedAt: ts('2026-08-17T10:00:00Z') },
    ]);
    await win.NBDCustomerDocs.load('LEAD1');
    ok('rows with no URL are never deduped', counts.navCountDocs === 2);
  }
  {
    // Rows that predate the consolidation still live in the top-level
    // collection. They must show, not be orphaned.
    const { win, els } = loadEnv([], [{ id: 'L1', filename: 'old.pdf', url: 'https://x.test/o.pdf', uploadedAt: ts('2026-01-01T00:00:00Z') }]);
    await win.NBDCustomerDocs.load('LEAD1');
    ok('legacy top-level rows are merged in, not orphaned', /old\.pdf/.test(els.docList.innerHTML));
  }
  {
    const { win, els, counts } = loadEnv([
      GENERATED,
      { id: 'X1', name: 'removed.pdf', deleted: true, uploadedAt: ts('2026-08-18T11:00:00Z') },
    ]);
    await win.NBDCustomerDocs.load('LEAD1');
    ok('soft-deleted rows stay hidden', !/removed\.pdf/.test(els.docList.innerHTML));
    ok('soft-deleted rows are not counted', counts.navCountDocs === 1);
  }
  {
    const { win, els } = loadEnv([{ id: 'B1', name: 'bad.pdf', url: 'javascript:alert(1)', uploadedAt: ts('2026-08-18T10:00:00Z') }]);
    await win.NBDCustomerDocs.load('LEAD1');
    ok('a non-http url is dropped rather than linked', !/javascript:/.test(els.docList.innerHTML));
    ok('the row still renders without its link', /bad\.pdf/.test(els.docList.innerHTML));
  }
  {
    const { win, els } = loadEnv([], [], { failSub: true });
    await win.NBDCustomerDocs.load('LEAD1');
    ok('a failed read says so on the Overview', /Could not load documents/.test(els.docList.innerHTML));
    ok('a failed read does NOT claim the customer has no documents',
      !/No documents yet/.test(els.docList.innerHTML));
    ok('a failed read marks the Documents-tab panels too',
      /Could not load documents/.test(els.generatedDocList.innerHTML));
  }
  {
    const { win, els } = loadEnv([]);
    await win.NBDCustomerDocs.load('LEAD1');
    ok('a genuinely empty customer still gets the empty state', /No documents yet/.test(els.docList.innerHTML));
  }
  {
    const { win } = loadEnv([GENERATED]);
    win._customerId = '';
    const res = await win.NBDCustomerDocs.load('');
    ok('no lead id anywhere is a no-op, not a wildcard read', Array.isArray(res) && res.length === 0);
  }
  {
    // refresh() passes no argument and relies on the window._customerId fallback.
    const { win, els } = loadEnv([GENERATED]);
    await win.NBDCustomerDocs.refresh();
    ok('refresh() resolves the lead from window._customerId', /NBD-contract/.test(els.docList.innerHTML));
  }

  console.log('\n──────────────────────');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
  process.exit(0);
})();
