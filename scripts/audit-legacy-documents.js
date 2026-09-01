/**
 * scripts/audit-legacy-documents.js
 *
 * READ-ONLY. Answers one question: is the legacy merge-read in
 * docs/pro/js/customer-documents.js still load-bearing, or can it go?
 *
 * Background
 * ──────────
 * Before the 2026-08-18 documents consolidation
 * (documentation/audit/CRM-DOCUMENTS-STORE-2026-08-18.md), the Overview
 * upload modal wrote lead documents to the TOP-LEVEL `documents` collection
 * with a `leadId` field, while the generator, the signed-doc upload and
 * drag-and-drop all wrote the `leads/{leadId}/documents` subcollection. The
 * customer page read only the top-level one, so it showed "No documents yet"
 * for customers who had a full stack of paperwork.
 *
 * The fix made the subcollection canonical and kept a best-effort SECOND read
 * against the top-level collection so nothing written by the old modal is
 * orphaned. That second read costs a query on every customer-page load. If no
 * lead-scoped rows survive there, it is dead weight and can be deleted.
 *
 * ⚠ THE TOP-LEVEL `documents` COLLECTION IS NOT DEAD.
 * dashboard-api.js still writes it for the COMPANY-WIDE document library.
 * Those rows carry NO `leadId`. This script counts them separately and never
 * suggests touching them. Do not "clean up" this collection wholesale.
 *
 * NOT A CI GATE. This is a one-time decision aid; it always exits 0 (any
 * non-zero exit means the script itself failed). It reads and reports only —
 * it writes nothing and deletes nothing.
 *
 * SETUP (admin-script-runner pattern — prod nobigdeal-pro via ADC).
 * firebase-admin arrives through scripts/_admin.js, which resolves it out of
 * functions/node_modules — scripts/ and the repo root have none of their own.
 * Do NOT set NODE_PATH: _admin tries a bare require.resolve FIRST, so a
 * NODE_PATH install satisfies it and silently decides which firebase-admin
 * this script gets, which is the single-resolver guarantee _admin exists to
 * provide. Runs on v12 and v14 alike.
 *
 * (This docstring used to warn "v14 breaks Timestamps". That was inherited
 * boilerplate — it appeared verbatim in seven sibling scripts, the exact
 * copy-paste propagation _admin.js's own docstring describes. Timestamps do
 * sit on these documents (uploadedAt, createdAt, signedAt, date), but this
 * script reads only leadId, deleted, filename, name, url, htmlUrl,
 * signedDocumentUrl and userId — strings and one boolean — and orders by the
 * '__name__' string literal, so it never touches one. Verified against real
 * v14 Timestamp objects: no throw, no [object Object] leak, identical
 * verdict. See documentation/audit/ADMIN-SCRIPTS-ADMIN-PORT-2026-09-01.md.)
 *   export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
 *   export NBD_PROJECT=nobigdeal-pro               # optional override
 *
 * RUN
 *   node scripts/audit-legacy-documents.js          # verdict + summary
 *   node scripts/audit-legacy-documents.js --list   # every lead-scoped row
 */

const { initAdmin, getFirestore } = require('./_admin');

const args = process.argv.slice(2);
const LIST = args.includes('--list');
const PROJECT = process.env.NBD_PROJECT || 'nobigdeal-pro';
const PAGE = 500;

/**
 * Which bucket does a top-level `documents` row fall into?
 *
 *   companyLibrary  No leadId — dashboard-api.js's company-wide document
 *                   library. Live, in use, none of this script's business.
 *   softDeleted     Lead-scoped but already `deleted: true`. The store filters
 *                   these out, so they do not justify keeping the merge read.
 *   leadScoped      Lead-scoped and live. THESE are what the merge read exists
 *                   for. One of these means it stays.
 *
 * Exported for tests/legacy-documents-audit.test.js.
 */
function classify(d) {
  const row = d || {};
  if (!row.leadId) return 'companyLibrary';
  if (row.deleted === true) return 'softDeleted';
  return 'leadScoped';
}

async function main() {
  // initAdmin's default credential IS applicationDefault(), and its
  // `if (!getApps().length)` guard replaces the old hand-rolled try/catch that
  // string-matched 'already exists' — that swallowed unrelated init errors too.
  initAdmin({ projectId: PROJECT });
  const db = getFirestore();

  const buckets = { leadScoped: [], softDeleted: [], companyLibrary: [] };
  let scanned = 0;
  let last = null;

  while (true) {
    let q = db.collection('documents').orderBy('__name__').limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      const d = doc.data() || {};
      scanned++;
      buckets[classify(d)].push({
        id: doc.id,
        leadId: d.leadId || null,
        name: d.filename || d.name || '(unnamed)',
        url: String(d.url || d.htmlUrl || d.signedDocumentUrl || ''),
        userId: d.userId || null,
      });
    }

    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  // For the live lead-scoped rows, the useful follow-up is whether each one is
  // ALREADY in the canonical subcollection — i.e. already migrated, so the
  // merge read is carrying nothing for it.
  //
  // Matched on Storage URL, matching the store's dedupe key (customer-documents.js
  // `dedupe()`). Not on name: two rows sharing a filename are not necessarily
  // the same file, and the store deliberately keeps both rather than risk
  // hiding a real document. Counting a name match as "already migrated" here
  // would report a row as safe to drop when the store still needs it.
  const migrated = [];
  const orphans = [];
  for (const r of buckets.leadScoped) {
    const leadDoc = await db.collection('leads').doc(r.leadId).get();
    if (!leadDoc.exists) { orphans.push(r); continue; }
    let sub = null;
    try {
      sub = await db.collection('leads').doc(r.leadId).collection('documents').get();
    } catch (e) {
      continue;
    }
    const urls = sub.docs.map(s => {
      const sd = s.data() || {};
      return String(sd.url || sd.htmlUrl || sd.signedDocumentUrl || '');
    }).filter(Boolean);
    if (r.url && urls.includes(r.url)) migrated.push(r);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('Legacy top-level /documents audit — project ' + PROJECT);
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('  LEAD-SCOPED  live, needs the merge read   ' + String(buckets.leadScoped.length).padStart(5));
  console.log('  lead-scoped  soft-deleted (filtered out)  ' + String(buckets.softDeleted.length).padStart(5));
  console.log('  company doc library (NOT ours, leave it)  ' + String(buckets.companyLibrary.length).padStart(5));
  console.log('\n  scanned: ' + scanned);

  if (buckets.leadScoped.length) {
    console.log('\n  of the live lead-scoped rows:');
    console.log('    already migrated into leads/{id}/documents  ' + String(migrated.length).padStart(4));
    console.log('    parent lead no longer exists                ' + String(orphans.length).padStart(4));
  }

  if (LIST && buckets.leadScoped.length) {
    console.log('\n─── live lead-scoped rows ───');
    for (const r of buckets.leadScoped) {
      const flag = migrated.includes(r) ? ' [ALREADY MIGRATED]'
        : orphans.includes(r) ? ' [ORPHAN LEAD]' : '';
      console.log('  ' + r.id + '  lead=' + r.leadId + '  ' + r.name + flag);
    }
  } else if (buckets.leadScoped.length) {
    console.log('\n  (re-run with --list to see each one)');
  }

  console.log('\n───────────────────────────────────────────────────────────');
  if (buckets.leadScoped.length === 0) {
    console.log('  VERDICT — no live lead-scoped rows survive.');
    console.log('  The legacy merge read in customer-documents.js (fetchAll,');
    console.log('  the "legacy read skipped" block) is dead weight and can be');
    console.log('  deleted, along with the `legacy` flag and the split delete');
    console.log('  path in deleteCustomerDoc. Drop the `documents` entry from');
    console.log('  the customer page only — dashboard-api.js still needs it.');
  } else {
    console.log('  VERDICT — KEEP the merge read.');
    console.log('  ' + buckets.leadScoped.length + ' live document(s) exist only in the top-level');
    console.log('  collection. Removing the merge read would make them vanish');
    console.log('  from their customers\' records.');
    if (migrated.length) {
      console.log('\n  ' + migrated.length + ' of them already exist in the subcollection under the');
      console.log('  same Storage URL. The store dedupes those, so they render once —');
      console.log('  but the top-level copies are redundant and could be soft-deleted,');
      console.log('  shrinking what the merge read has to carry.');
    }
    if (orphans.length) {
      console.log('\n  ' + orphans.length + ' belong to a lead that no longer exists — unreachable from');
      console.log('  any customer page, and safe to retire.');
    }
  }
  console.log('───────────────────────────────────────────────────────────\n');

  process.exit(0);
}

// main is exported so tests/legacy-documents-audit.test.js can drive it
// directly against a stubbed Firestore — deterministic, no timing waits.
module.exports = { classify, main };

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
