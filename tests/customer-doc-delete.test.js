/**
 * tests/customer-doc-delete.test.js — the document delete control.
 *
 * Before this shipped there was NO way to remove a generated document from a
 * customer record short of the Firebase console. On 2026-08-18 that meant two
 * conflicting invoices — one with the wrong scope entirely — sat on one live
 * customer's record with no way to take either down.
 *
 * The control is deliberately a SOFT delete: the Firestore row survives with
 * `deleted: true`, so a misclick is recoverable and the record of what was
 * generated is not rewritten. These assertions lock that in, plus the two
 * things that made the duplicates indistinguishable in the first place (every
 * generated doc rendered as the label "Document") and the CSP constraint the
 * page ships under (no inline handlers — clicks go through data-action).
 *
 * MOVED 2026-08-18: the delete used to live in customer-signed-doc-upload.js
 * alongside its own list renderer. The documents consolidation (see the header
 * of docs/pro/js/customer-documents.js) made that module upload-only and gave
 * the store — read, render, soft-delete — to customer-documents.js. Same
 * invariants, new home. This file follows them there and additionally locks
 * the delete's new obligation: routing legacy top-level rows to their own
 * collection path instead of blindly writing the lead subcollection.
 *
 * Run: node tests/customer-doc-delete.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/customer-documents.js'), 'utf8');
const UPLOAD_SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/customer-signed-doc-upload.js'), 'utf8');

console.log('DOC DELETE — static contract');
ok('deleteCustomerDoc is exported on window', /window\.deleteCustomerDoc\s*=/.test(SRC));
ok('delete button routes through data-action (CSP: no inline on* handler)',
  /data-action="deleteCustomerDoc"/.test(SRC) && !/onclick=/.test(SRC));
ok('button passes the doc id via data-arg', /data-arg="' \+ esc\(doc\.id\)/.test(SRC));
ok('soft delete, not hard — writes deleted:true via updateDoc', /updateDoc/.test(SRC) && /deleted:\s*true/.test(SRC));
ok('never calls deleteDoc (a hard delete would lose the audit trail)', !/\bdeleteDoc\b/.test(SRC));
ok('list filters soft-deleted rows out', /\.filter\(function \(r\) \{ return !r\.deleted; \}\)/.test(SRC));
ok('asks for confirmation before removing', /nbdConfirm|confirm\(/.test(SRC));
ok('label falls back through filename (generated docs have no `name`)',
  /d\.name \|\| d\.filename \|\| d\.typeName/.test(SRC));

console.log('\nDOC DELETE — ownership boundary');
ok('the upload module no longer renders the list', !/signedDocsList/.test(UPLOAD_SRC));
ok('the upload module no longer owns the delete', !/deleteCustomerDoc/.test(UPLOAD_SRC));
ok('the upload module refreshes through the store', /NBDCustomerDocs\.refresh\(\)/.test(UPLOAD_SRC));
ok('no DOMContentLoaded timer racing window._customerId any more',
  !/setTimeout\(\s*loadSignedDocs/.test(UPLOAD_SRC) && !/setTimeout\(\s*load/.test(SRC.split('window.deleteCustomerDoc')[0]));

// ── Behavioural: run the real function against a fake Firestore ──
function loadEnv(subDocs, legacyDocs) {
  const writes = [];
  const confirms = [];
  const els = {};
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
  win.updateDoc = async function (ref, patch) { writes.push({ path: ref.path, patch }); };
  win.addDoc = async function () {};
  win.getDocs = async function (ref) {
    const rows = ref && ref.legacy ? (legacyDocs || []) : (subDocs || []);
    return { docs: rows.map(d => ({ id: d.id, data: () => d })) };
  };
  win.nbdConfirm = async function (msg) { confirms.push(msg); return win.__answer; };
  win.__answer = true;
  vm.runInNewContext(SRC, sandbox, { filename: 'customer-documents.js' });
  return { win, writes, confirms, els };
}

(async function main() {
  console.log('\nDOC DELETE — behaviour');
  {
    const { win, writes } = loadEnv([{ id: 'D1', filename: 'NBD-Invoice.pdf' }]);
    await win.NBDCustomerDocs.load('LEAD1');
    await win.deleteCustomerDoc('D1', 'NBD-Invoice.pdf');
    ok('confirmed delete writes exactly one patch', writes.length === 1);
    ok('patch targets the right subcollection path', writes[0] && writes[0].path === 'leads/LEAD1/documents/D1');
    ok('patch sets deleted:true', !!(writes[0] && writes[0].patch.deleted === true));
    ok('patch stamps deletedAt', !!(writes[0] && writes[0].patch.deletedAt));
    ok('patch touches nothing else (no silent field edits)',
      !!(writes[0] && Object.keys(writes[0].patch).sort().join(',') === 'deleted,deletedAt'));
  }
  {
    // A row that came from the legacy TOP-LEVEL `documents` collection must be
    // patched there. Writing leads/{id}/documents/{id} for it would silently
    // create an empty ghost row and leave the real document on screen.
    const { win, writes } = loadEnv([], [{ id: 'L1', filename: 'old-scan.pdf' }]);
    await win.NBDCustomerDocs.load('LEAD1');
    await win.deleteCustomerDoc('L1', 'old-scan.pdf');
    ok('legacy row is patched in the top-level collection, not the subcollection',
      writes.length === 1 && writes[0].path === 'documents/L1');
  }
  {
    const { win, writes, confirms } = loadEnv([{ id: 'D1', filename: 'x.pdf' }]);
    win.__answer = false;
    await win.NBDCustomerDocs.load('LEAD1');
    await win.deleteCustomerDoc('D1', 'x.pdf');
    ok('declining the confirm writes NOTHING', writes.length === 0);
    ok('the confirm names the document being removed', confirms.length === 1 && confirms[0].indexOf('x.pdf') !== -1);
    ok('the confirm warns that an already-sent link keeps working', /still open/i.test(confirms[0] || ''));
  }
  {
    const { win, writes } = loadEnv([]);
    await win.deleteCustomerDoc('', 'x');
    ok('missing doc id is a no-op, not a wildcard write', writes.length === 0);
  }
  {
    // The delete has to actually take the row off the page, not just write.
    const { win, els } = loadEnv([{ id: 'D1', filename: 'gone.pdf' }]);
    await win.NBDCustomerDocs.load('LEAD1');
    ok('the row renders before deletion', /gone\.pdf/.test(els.docList.innerHTML));
    win.getDocs = async function () { return { docs: [] }; };
    await win.deleteCustomerDoc('D1', 'gone.pdf');
    ok('the list repaints after deletion', !/gone\.pdf/.test(els.docList.innerHTML));
  }

  console.log('\n──────────────────────');
  console.log(passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('FAILED: ' + fails.join(', ')); process.exit(1); }
  process.exit(0);
})();
