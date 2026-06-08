/**
 * scripts/backup-collections.js — READ-ONLY Firestore backup + plan verify.
 *
 * Phase D prereq: before any subscriptions re-key migration, snapshot the
 * affected collections, and verify NBD's own subscription resolves to a paid
 * tier (so we never strip the owner-email bypass and self-lock Joe to free).
 *
 * NEVER WRITES. Pure reads via the admin SDK (ADC or GOOGLE_APPLICATION_CREDENTIALS).
 * Output is written OUTSIDE the repo (default C:/Users/jonat/nbd-backups) so
 * lead PII is never committed. firebase-admin is resolved from functions/
 * (scripts/ has no node_modules), mirroring provision-tenant.js.
 *
 * USAGE:
 *   node scripts/backup-collections.js
 *   node scripts/backup-collections.js --out C:/Users/jonat/nbd-backups \
 *        --collections subscriptions,leads,companies,companyProfile
 *   node scripts/backup-collections.js --verify-only   # just the plan report, no dump
 */
'use strict';

const fs = require('fs');
const path = require('path');

let admin;
// firebase-admin lives in functions/node_modules. A fresh git worktree has no
// node_modules, so try the local functions/ first, then fall back to the main
// clone's functions/ (deps installed there). Resolve via createRequire.
const { createRequire } = require('module');
const ADMIN_CANDIDATES = [
  path.join(__dirname, '..', 'functions', 'package.json'),
  'C:/Users/jonat/nobigdealwithjoedeal.com/functions/package.json',
];
try {
  admin = require('firebase-admin');
} catch (_) {
  for (const pkg of ADMIN_CANDIDATES) {
    try { admin = createRequire(pkg)('firebase-admin'); break; } catch (_e) { /* next */ }
  }
}
if (!admin) { console.error('✗ could not resolve firebase-admin from any candidate functions/ dir'); process.exit(1); }
if (!admin.apps.length) admin.initializeApp();

const argv = process.argv.slice(2);
const arg = (flag, def) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : def; };
const has = (flag) => argv.includes(flag);

const NBD_OWNER_UID = '1phDvAVXHSg82wDLegAbQFq14Ci1';
const OUT = arg('--out', 'C:/Users/jonat/nbd-backups');
const COLLECTIONS = arg('--collections', 'subscriptions,leads,companies,companyProfile')
  .split(',').map((s) => s.trim()).filter(Boolean);
const verifyOnly = has('--verify-only');

const db = admin.firestore();

// Pad to a fixed-width, sortable timestamp WITHOUT Date.now()-style nondeterminism
// is irrelevant here (one-shot CLI), but the harness blocks Date in workflow
// scripts only — this is a plain node CLI, so new Date() is fine.
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function planReport() {
  console.log('\n=== PLAN VERIFICATION (read-only) ===');
  // NBD owner
  const nbdSub = await db.doc(`subscriptions/${NBD_OWNER_UID}`).get();
  if (nbdSub.exists) {
    const d = nbdSub.data() || {};
    console.log(`subscriptions/${NBD_OWNER_UID}: plan=${d.plan || '(unset)'} status=${d.status || '(unset)'} stripeCustomerId=${d.stripeCustomerId ? 'set' : '(none)'} seats=${d.seats ?? '(none)'}`);
  } else {
    console.log(`subscriptions/${NBD_OWNER_UID}: ABSENT  <-- WARNING: NBD owner has no sub doc`);
  }
  // Oaks owner (slug tenant): resolve owner uid via companies/oaks.ownerId
  const oaks = await db.doc('companies/oaks').get();
  if (oaks.exists) {
    const ownerId = (oaks.data() || {}).ownerId;
    console.log(`companies/oaks.ownerId: ${ownerId || '(unset)'}`);
    if (ownerId) {
      const oSub = await db.doc(`subscriptions/${ownerId}`).get();
      console.log(`subscriptions/${ownerId} (oaks owner): ${oSub.exists ? `plan=${(oSub.data() || {}).plan} status=${(oSub.data() || {}).status}` : 'ABSENT'}`);
      const oSlug = await db.doc('subscriptions/oaks').get();
      console.log(`subscriptions/oaks (slug-keyed): ${oSlug.exists ? 'EXISTS' : 'ABSENT (expected — D-2 re-key target)'}`);
    }
  } else {
    console.log('companies/oaks: ABSENT');
  }
}

async function dumpCollection(name) {
  const snap = await db.collection(name).get();
  const docs = {};
  snap.forEach((doc) => { docs[doc.id] = doc.data(); });
  const file = path.join(OUT, `${name}__${stamp()}.json`);
  fs.writeFileSync(file, JSON.stringify({ collection: name, count: snap.size, exportedAt: new Date().toISOString(), docs }, null, 2));
  // Print COUNT + field names only — never echo PII to stdout.
  const sampleFields = snap.size ? Object.keys(snap.docs[0].data() || {}).sort() : [];
  console.log(`  ${name}: ${snap.size} docs -> ${file}`);
  if (sampleFields.length) console.log(`     fields(sample): ${sampleFields.join(', ')}`);
  return { name, count: snap.size, file };
}

async function main() {
  console.log(`project: ${process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '(admin default)'}`);
  await planReport();
  if (verifyOnly) { console.log('\n--verify-only: skipping dump.'); return; }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  console.log(`\n=== BACKUP -> ${OUT} ===`);
  const results = [];
  for (const c of COLLECTIONS) {
    try { results.push(await dumpCollection(c)); }
    catch (e) { console.log(`  ${c}: ERROR ${e.message}`); }
  }
  console.log('\n=== SUMMARY ===');
  results.forEach((r) => console.log(`  ${r.name}: ${r.count} docs`));
  console.log('done.');
}

main().then(() => process.exit(0)).catch((e) => { console.error('FATAL', e); process.exit(1); });
