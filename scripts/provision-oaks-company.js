/**
 * scripts/provision-oaks-company.js — ensure companies/oaks exists (Phase C / OAKS-1).
 *
 * WHY (pre-deploy review blocker OAKS-1):
 * submitPublicLead validates a public lead's companyId against companies/{cid}
 * and DROPS the tag if that doc is absent. If companies/oaks does not exist
 * when the Oaks microsite starts posting companyId:'oaks', the tag is stripped
 * -> the lead becomes "untagged" -> (1) lead-alert routes to Joe instead of
 * Scott, and (2) lead-bridge mirrors the Oaks customer's PII into Joe's NBD
 * pipeline (a cross-tenant misroute). So companies/oaks MUST exist before the
 * Oaks form cutover goes live.
 *
 * ownerId is separate: setting it enables the CRM pipeline MIRROR for Oaks
 * leads (lead-bridge resolves the owner from companies/oaks.ownerId). Leave it
 * unset until Oaks's owner (Scott) has a real account — until then Oaks leads
 * still alert Scott (via companyProfile/oaks) + sit in contact_leads, and the
 * pipeline mirror simply no-ops (graceful). Set --owner once Scott is onboarded.
 *
 * ⚠ WRITES TO PROD FIRESTORE when --ensure/--owner is passed. Jo runs this
 *   (Claude does not write prod). Auth: GOOGLE_APPLICATION_CREDENTIALS -> a
 *   nobigdeal-pro service account (same as backfill-oaks-brand.js).
 *
 * USAGE:
 *   node scripts/provision-oaks-company.js                # CHECK only (read-only report)
 *   node scripts/provision-oaks-company.js --ensure       # create companies/oaks if absent (no owner)
 *   node scripts/provision-oaks-company.js --owner <uid>  # ensure exists + set ownerId=<uid>
 */
'use strict';

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
if (!admin.apps.length) admin.initializeApp();

const KEY = 'oaks';
const args = process.argv.slice(2);
const ensure = args.includes('--ensure');
const ownerIdx = args.indexOf('--owner');
const ownerUid = ownerIdx >= 0 ? args[ownerIdx + 1] : null;

(async () => {
  const db = admin.firestore();
  const ref = db.collection('companies').doc(KEY);
  const snap = await ref.get();
  const data = snap.exists ? (snap.data() || {}) : null;

  console.log(`companies/${KEY}: ${snap.exists ? 'EXISTS' : 'ABSENT'}`);
  if (snap.exists) {
    console.log(`  ownerId: ${data.ownerId || '(unset)'}`);
    console.log(`  owner (legacy display-name field): ${data.owner || '(none)'}`);
  }

  if (ownerUid) {
    await ref.set({ id: KEY, ownerId: String(ownerUid), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    console.log(`\n✅ set companies/${KEY}.ownerId = ${ownerUid} (doc created if it was absent).`);
    console.log('   Oaks leads now route to Scott AND mirror into his CRM pipeline.');
  } else if (ensure && !snap.exists) {
    await ref.set({ id: KEY, name: 'Oaks Roofing & Construction', createdAt: FieldValue.serverTimestamp() }, { merge: true });
    console.log('\n✅ created companies/oaks (no ownerId).');
    console.log('   Oaks leads keep companyId=oaks -> alert Scott + sit in contact_leads;');
    console.log('   the pipeline mirror no-ops gracefully until you run --owner <Scott uid>.');
  } else if (ensure) {
    console.log('\nℹ companies/oaks already exists — nothing to create.');
  } else if (!snap.exists) {
    console.log('\n⚠ ABSENT — the Oaks form cutover (companyId:\'oaks\') is UNSAFE to deploy until this');
    console.log('  doc exists (else Oaks leads misroute to Joe). Run with --ensure (or --owner <uid>) first.');
  } else {
    console.log('\n✓ EXISTS — the Oaks form cutover is safe to deploy: leads keep companyId=oaks ->');
    console.log('  alert Scott. Pipeline mirror needs --owner <Scott uid> (graceful skip until then).');
  }

  await db.terminate();
  process.exit(0);
})().catch((e) => { console.error('❌ failed:', e && e.message); process.exit(1); });
