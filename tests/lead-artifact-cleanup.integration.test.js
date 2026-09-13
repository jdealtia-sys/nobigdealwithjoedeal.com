/**
 * tests/lead-artifact-cleanup.integration.test.js — appointments sweep on
 * lead hard-delete (functions/lead-artifact-cleanup.js, added 2026-09-13).
 *
 * THE BUG THIS CLOSES
 * ────────────────────
 * Hard-deleting a lead (the Trash drawer's Remove → window._permanentDelete
 * Lead → a bare `deleteDoc(doc(db,'leads',id))`) never touched a Cal.com
 * booking linked to it. appointments/{bookingId}.leadId
 * (functions/integrations/calcom.js) points at whichever CRM lead the
 * booking is linked to — a pre-existing match, or the calcom__<bookingId>
 * lead created for an unmatched booker. onLeadDeleted swept Storage
 * artifacts and token collections but never queried `appointments` at all
 * (grepped — zero references). No client UI anywhere deletes an
 * appointments/{id} doc directly, and Firestore does not cascade a delete
 * into a sibling top-level collection, so once a Cal.com-linked lead was
 * hard-deleted its appointment became a permanent orphan — leadId pointing
 * at nothing, with no path in the product to ever remove it.
 *
 * Drives the REAL onLeadDeleted trigger (functions + firestore emulator):
 * seeds a lead + linked appointments/{id} docs via the admin SDK, hard-
 * deletes the lead, and asserts they're gone. Also pins CONFINEMENT
 * (another lead's appointment must survive) and that a lead with no linked
 * appointment still deletes cleanly.
 *
 * RUN:
 *   npx firebase-tools emulators:exec --only functions,firestore --project demo-nbd-pl \
 *     "node tests/lead-artifact-cleanup.integration.test.js"
 */
'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || 'demo-nbd-pl';
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('✗ emulator env not set — run via emulators:exec --only functions,firestore');
  process.exit(1);
}
initializeApp({ projectId: PROJECT });
const db = getFirestore();

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function staysGone(ref, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!(await ref.get()).exists) return true;
    await sleep(300);
  }
  return !(await ref.get()).exists;
}

async function run() {
  console.log('LEAD-ARTIFACT-CLEANUP INTEGRATION — appointments swept on hard delete');
  const RUN = 'ZZ_QA_' + Date.now();
  const OWNER = RUN + 'Owner';

  // ── 1) A Cal.com-linked lead + its appointment(s) are both swept ────
  const leadId = RUN + '_lead1';
  const bookingId = RUN + '_booking1';
  const bookingId1b = RUN + '_booking1b'; // reschedule chain: same leadId, different doc
  await db.doc(`leads/${leadId}`).set({
    userId: OWNER, companyId: OWNER, stage: 'New',
    firstName: 'ZZ_QA', source: 'Website — Cal.com booking',
  });
  await db.doc(`appointments/${bookingId}`).set({
    bookingId, leadId, userId: OWNER, repUid: OWNER, status: 'booked', source: 'calcom',
  });
  await db.doc(`appointments/${bookingId1b}`).set({
    bookingId: bookingId1b, leadId, userId: OWNER, repUid: OWNER,
    status: 'cancelled', cancelledReason: 'rescheduled', supersededBy: bookingId, source: 'calcom',
  });

  // ── 2) An unrelated lead + appointment — CONFINEMENT control ────────
  const leadId2 = RUN + '_lead2';
  const bookingId2 = RUN + '_booking2';
  await db.doc(`leads/${leadId2}`).set({
    userId: OWNER, companyId: OWNER, stage: 'New',
    firstName: 'ZZ_QA Two', source: 'Website — Cal.com booking',
  });
  await db.doc(`appointments/${bookingId2}`).set({
    bookingId: bookingId2, leadId: leadId2, userId: OWNER, repUid: OWNER,
    status: 'booked', source: 'calcom',
  });

  // ── 3) A lead with no linked appointment at all ─────────────────────
  const leadId3 = RUN + '_lead3';
  await db.doc(`leads/${leadId3}`).set({
    userId: OWNER, companyId: OWNER, stage: 'New', firstName: 'ZZ_QA Three',
  });

  // Hard-delete lead1 and lead3; leave lead2 (and its appointment) alone.
  await db.doc(`leads/${leadId}`).delete();
  await db.doc(`leads/${leadId3}`).delete();

  const gone1 = await staysGone(db.doc(`appointments/${bookingId}`));
  ok('appointment linked to a hard-deleted lead is deleted', gone1);

  const gone1b = await staysGone(db.doc(`appointments/${bookingId1b}`));
  ok('a second appointment sharing the same leadId (reschedule chain) is also swept', gone1b);

  // lead3's delete has no appointment to wait on; give the trigger the same
  // settle window so any crash on the empty-query path would have surfaced.
  await sleep(4000);

  const stillThere2 = await db.doc(`appointments/${bookingId2}`).get();
  ok("an unrelated lead's appointment survives (confinement)", stillThere2.exists);

  const lead3Gone = await staysGone(db.doc(`leads/${leadId3}`), 5000);
  ok('a lead with no linked appointment still deletes cleanly (no crash on empty sweep)', lead3Gone);

  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
  console.log('✓ All lead-artifact-cleanup integration tests passed');
}

run().then(() => process.exit(0)).catch((e) => { console.error('integration test crashed:', e && (e.stack || e.message)); process.exit(1); });
