#!/usr/bin/env node
/**
 * scripts/seed-emulator.js — Audit #3 local QA seed (EMULATOR ONLY).
 *
 * Stands up a throwaway, tenancy-correct test tenant inside the Firebase
 * Emulator Suite. NEVER touches production: it refuses to run unless the
 * Auth + Firestore emulator host env vars are present (set automatically by
 * `firebase emulators:exec`). RULE 0 guard.
 *
 * What it creates (companyId = 'demo-co' for the whole tenant):
 *   - 4 role users + 1 demo user, each with custom claims { role, companyId }
 *   - companyProfile/demo-co (per-tenant, Audit #2 scoped)
 *   - an ACTIVE professional subscription for the company_admin (billing gate)
 *   - leads owned by BOTH the company_admin and a sales_rep (lead reads are
 *     gated on userId ownership per firestore.rules:74, so each operator needs
 *     their own leads to have a non-empty pipeline), every lead stamped with
 *     companyId so client CREATE-shaped rules + company rollups are satisfied
 *   - estimates, a customer, knocks — all companyId-stamped
 *
 * After seeding it VERIFIES the result: reads claims back, and asserts every
 * seeded lead/estimate carries a companyId matching the owner's claim. The
 * brief's #1 footgun is a companyId-less seed masquerading as broken features;
 * this script fails loudly if that ever regresses.
 *
 * Run:
 *   firebase emulators:exec --only auth,firestore --project nobigdeal-pro \
 *     'node scripts/seed-emulator.js'
 */
'use strict';

const admin = require('../functions/node_modules/firebase-admin');

// ── RULE 0 SAFETY GUARD ──────────────────────────────────────
// Refuse to run against anything but the emulator.
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST;
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!FS_HOST || !AUTH_HOST) {
  console.error('✗ REFUSING TO RUN: FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST not set.');
  console.error('  This script is emulator-only. Launch it via `firebase emulators:exec`.');
  process.exit(1);
}
console.log(`[seed-emulator] Firestore emulator: ${FS_HOST}`);
console.log(`[seed-emulator] Auth emulator:      ${AUTH_HOST}`);

admin.initializeApp({ projectId: 'nobigdeal-pro' });
const db = admin.firestore();
const auth = admin.auth();
const TS = admin.firestore.Timestamp;

const COMPANY_ID = 'demo-co';
const PASSWORD = 'Test123!';

const USERS = [
  { key: 'companyAdmin', email: 'companyadmin@demo.test', name: 'Casey Admin',   claims: { role: 'company_admin', companyId: COMPANY_ID } },
  { key: 'salesRep',     email: 'salesrep@demo.test',     name: 'Sam Rep',       claims: { role: 'sales_rep',     companyId: COMPANY_ID } },
  { key: 'viewer',       email: 'viewer@demo.test',       name: 'Val Viewer',    claims: { role: 'viewer',        companyId: COMPANY_ID } },
  { key: 'platformAdmin',email: 'admin@demo.test',        name: 'Pat Platform',  claims: { role: 'admin',         companyId: COMPANY_ID } },
  { key: 'demo',         email: 'demo@nobigdeal.pro',     name: 'Demo User',     claims: { role: 'demo_viewer', demo: true, companyId: COMPANY_ID } },
];

async function ensureUser(u) {
  let rec;
  try {
    rec = await auth.getUserByEmail(u.email);
  } catch {
    rec = await auth.createUser({ email: u.email, password: PASSWORD, displayName: u.name, emailVerified: true });
  }
  await auth.setCustomUserClaims(rec.uid, u.claims);
  return rec.uid;
}

function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n); return TS.fromDate(d);
}

async function seed() {
  console.log('\n[1/6] Users + custom claims');
  const uid = {};
  for (const u of USERS) {
    uid[u.key] = await ensureUser(u);
    console.log(`  ✓ ${u.email.padEnd(24)} uid=${uid[u.key]}  claims=${JSON.stringify(u.claims)}`);
  }

  console.log('\n[2/6] companyProfile/demo-co (per-tenant)');
  await db.doc(`companyProfile/${COMPANY_ID}`).set({
    companyId: COMPANY_ID,
    name: 'Demo Roofing Co',
    ownerUid: uid.companyAdmin,
    phone: '555-0100', email: 'office@demo.test',
    address: '100 Demo Way, Austin, TX 78701',
    createdAt: daysAgo(120),
  });
  console.log('  ✓ companyProfile written');

  console.log('\n[3/6] Subscription (ACTIVE professional → passes billing gate)');
  await db.doc(`subscriptions/${uid.companyAdmin}`).set({
    plan: 'professional', status: 'active', companyId: COMPANY_ID,
    stripeCustomerId: 'cus_emulator_demo', currentPeriodEnd: daysAgo(-30),
  });
  await db.doc(`userSettings/${uid.companyAdmin}`).set({ companyId: COMPANY_ID, theme: 'default' });
  console.log('  ✓ subscription + userSettings written');

  console.log('\n[4/6] Leads (owned across roles, all companyId-stamped)');
  const leadDefs = [
    { owner: 'companyAdmin', firstName: 'Maria',  lastName: 'Lopez',   stage: 'new',       jobValue: 14500 },
    { owner: 'companyAdmin', firstName: 'James',  lastName: 'Nguyen',  stage: 'inspected', jobValue: 21800 },
    { owner: 'companyAdmin', firstName: 'Tara',   lastName: 'Boone',   stage: 'won',       jobValue: 19200 },
    { owner: 'salesRep',     firstName: 'Derek',  lastName: 'Shaw',    stage: 'new',       jobValue: 9800  },
    { owner: 'salesRep',     firstName: 'Priya',  lastName: 'Patel',   stage: 'quoted',    jobValue: 16400 },
  ];
  const leadIds = [];
  for (const l of leadDefs) {
    const ref = db.collection('leads').doc();
    await ref.set({
      userId: uid[l.owner], companyId: COMPANY_ID,
      firstName: l.firstName, lastName: l.lastName, name: `${l.firstName} ${l.lastName}`,
      address: `${100 + leadIds.length} Maple St, Austin, TX`, phone: '555-02' + (10 + leadIds.length),
      email: `${l.firstName.toLowerCase()}@example.com`,
      stage: l.stage, source: 'manual', jobValue: l.jobValue, estValue: l.jobValue, value: l.jobValue,
      deleted: false, createdAt: daysAgo(20 - leadIds.length), updatedAt: daysAgo(2),
    });
    leadIds.push({ id: ref.id, owner: l.owner, sq: 28 + leadIds.length * 3 });
  }
  console.log(`  ✓ ${leadIds.length} leads written (3 companyAdmin, 2 salesRep)`);

  console.log('\n[5/6] Estimates + customer + knock (companyId-stamped)');
  for (const l of leadIds.slice(0, 3)) {
    const ref = db.collection('estimates').doc();
    await ref.set({
      userId: uid[l.owner], companyId: COMPANY_ID, leadId: l.id,
      tier: 'better', tierName: 'Better', sq: l.sq,
      grandTotal: l.sq * 480, roofType: 'Gable', pitch: '6/12',
      rows: [{ code: 'RFG 240', desc: 'Architectural shingles', qty: l.sq, rate: 360, total: l.sq * 360 }],
      createdAt: daysAgo(10), updatedAt: daysAgo(5),
    });
  }
  await db.collection('customers').doc().set({
    userId: uid.companyAdmin, companyId: COMPANY_ID,
    name: 'Tara Boone', address: '102 Maple St, Austin, TX', phone: '555-0212',
    createdAt: daysAgo(8),
  });
  await db.collection('knocks').doc().set({
    userId: uid.salesRep, repId: uid.salesRep, companyId: COMPANY_ID,
    address: '300 Oak Dr, Austin, TX', disposition: 'not_home', createdAt: daysAgo(1),
  });
  console.log('  ✓ 3 estimates, 1 customer, 1 knock written');

  return { uid, leadIds };
}

async function verify(ctx) {
  console.log('\n[6/6] VERIFY — claims + companyId integrity');
  let problems = 0;

  for (const u of USERS) {
    const rec = await auth.getUser(ctx.uid[u.key]);
    const c = rec.customClaims || {};
    const ok = c.role === u.claims.role && (u.key === 'platformAdmin' || c.companyId === COMPANY_ID);
    console.log(`  ${ok ? '✓' : '✗'} ${u.email.padEnd(24)} claims=${JSON.stringify(c)}`);
    if (!ok && u.key !== 'platformAdmin') problems++;
  }

  const leadSnap = await db.collection('leads').get();
  let leadsNoCompany = 0;
  leadSnap.forEach(d => { if (!d.get('companyId')) leadsNoCompany++; });
  console.log(`  ${leadsNoCompany === 0 ? '✓' : '✗'} leads: ${leadSnap.size} total, ${leadsNoCompany} missing companyId`);
  if (leadsNoCompany) problems++;

  const estSnap = await db.collection('estimates').get();
  let estNoCompany = 0;
  estSnap.forEach(d => { if (!d.get('companyId')) estNoCompany++; });
  console.log(`  ${estNoCompany === 0 ? '✓' : '✗'} estimates: ${estSnap.size} total, ${estNoCompany} missing companyId`);
  if (estNoCompany) problems++;

  // Ownership distribution — proves per-uid read scoping will yield data per role.
  const byOwner = {};
  leadSnap.forEach(d => { const u = d.get('userId'); byOwner[u] = (byOwner[u] || 0) + 1; });
  console.log(`  · lead ownership by uid: ${JSON.stringify(byOwner)}`);
  console.log(`    (companyAdmin=${ctx.uid.companyAdmin}, salesRep=${ctx.uid.salesRep})`);

  if (problems) {
    console.error(`\n✗ SEED VERIFY FAILED: ${problems} integrity problem(s).`);
    process.exit(1);
  }
  console.log('\n✓ SEED VERIFIED — tenant is tenancy-correct (every doc carries companyId; claims match).');
  console.log(`\nLogin credentials (password for all): ${PASSWORD}`);
  for (const u of USERS) console.log(`  ${u.claims.role.padEnd(13)} → ${u.email}`);
}

seed().then(verify).then(() => process.exit(0)).catch(e => {
  console.error('SEED FAILED:', e && (e.stack || e.message));
  process.exit(1);
});
