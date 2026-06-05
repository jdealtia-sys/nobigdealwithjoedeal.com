#!/usr/bin/env node
/**
 * scripts/seed-emulator.js — SAFE local-Emulator seeder for the NBD Pro QA sweep.
 * ============================================================================
 * Stands up a complete, role-diverse test tenant in the Firebase Emulator
 * Suite so every CRM feature can be exercised locally without touching prod.
 *
 * 🔒 RULE 0 — NEVER WRITES TO PRODUCTION:
 *   This script HARD-SETS FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST /
 *   FIREBASE_STORAGE_EMULATOR_HOST before loading firebase-admin. With those set,
 *   firebase-admin routes EVERY Auth/Firestore/Storage operation to the local
 *   emulator and NEVER to Google — even though prod ADC credentials exist on
 *   this machine (~/AppData/Roaming/gcloud/application_default_credentials.json)
 *   and the firebase CLI is logged in. It also pre-flights the emulator and
 *   aborts loudly if it isn't running, so a typo can't silently fail.
 *
 * It reuses the existing functions/seed-demo.js for the rich demo dataset
 * (shares the same firebase-admin instance + initialized app, so seed-demo's
 * own `if (!admin.apps.length) initializeApp(...)` is a no-op).
 *
 * PREREQ:  emulators running, e.g.
 *            firebase emulators:start --project nobigdeal-pro
 *          (project id MUST match the client firebaseConfig.projectId so the
 *           app and the seed share one emulator namespace.)
 *
 * RUN:     node scripts/seed-emulator.js
 *
 * Idempotent: re-running updates users/claims/docs in place.
 */
'use strict';
const path = require('path');

// ── 🔒 RULE 0 GUARD — pin admin SDK to the emulators BEFORE requiring it ──────
const EMU_FIRESTORE = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const EMU_AUTH      = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const EMU_STORAGE   = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.FIRESTORE_EMULATOR_HOST       = EMU_FIRESTORE;
process.env.FIREBASE_AUTH_EMULATOR_HOST   = EMU_AUTH;
process.env.FIREBASE_STORAGE_EMULATOR_HOST = EMU_STORAGE;

// Must match the client firebaseConfig.projectId so the served app reads the
// same emulator namespace this script writes to.
const PROJECT_ID = process.env.GCLOUD_PROJECT || 'nobigdeal-pro';
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;

// Resolve the SAME firebase-admin instance functions/seed-demo.js uses, so
// initializeApp() here registers the default app for that module too.
const FUNCTIONS_DIR = path.join(__dirname, '..', 'functions');
const admin = require(require.resolve('firebase-admin', { paths: [FUNCTIONS_DIR] }));

const TEST_PASSWORD = process.env.NBD_TEST_PASSWORD || 'test1234';
const COMPANY_ID = 'testco';

// Role matrix — one user per role the rules taxonomy recognises, plus an
// owner-bypass account (jonathandeal459@gmail.com is in nbd-auth OWNER_EMAILS)
// and a no-subscription account for the billing-gate test.
const USERS = [
  { uid: 'owner-admin', email: 'jonathandeal459@gmail.com', displayName: 'Jo (Owner / Platform Admin)', claims: { role: 'admin' },                                  sub: { plan: 'professional', status: 'active' } },
  { uid: 'demo-user',   email: 'demo@nobigdeal.pro',        displayName: 'Demo User',                    claims: { demo: true },                                      sub: { plan: 'professional', status: 'active' } },
  { uid: 'co-admin',    email: 'admin@testco.pro',          displayName: 'Casey (Company Admin)',        claims: { role: 'company_admin', companyId: COMPANY_ID },    sub: { plan: 'professional', status: 'active' } },
  { uid: 'co-rep',      email: 'rep@testco.pro',            displayName: 'Sam (Sales Rep)',              claims: { role: 'sales_rep', companyId: COMPANY_ID },        sub: { plan: 'professional', status: 'active' } },
  { uid: 'co-viewer',   email: 'viewer@testco.pro',         displayName: 'Val (Viewer)',                 claims: { role: 'viewer', companyId: COMPANY_ID },           sub: { plan: 'professional', status: 'active' } },
  { uid: 'free-user',   email: 'free@testco.pro',           displayName: 'Fran (Free, no subscription)', claims: {},                                                  sub: null },
];

async function assertEmulatorReachable() {
  const url = `http://${EMU_FIRESTORE}/`;
  try {
    await fetch(url); // Firestore emulator root responds "Ok"; any response = up
  } catch (e) {
    console.error('\n✗ Firestore emulator not reachable at ' + EMU_FIRESTORE);
    console.error('  Start it first, e.g.:');
    console.error('    firebase emulators:start --project ' + PROJECT_ID + '\n');
    process.exit(1);
  }
}

async function upsertUser(u) {
  let rec;
  try {
    rec = await admin.auth().getUserByEmail(u.email);
  } catch (_) {
    rec = await admin.auth().createUser({
      uid: u.uid, email: u.email, password: TEST_PASSWORD,
      emailVerified: true, displayName: u.displayName,
    });
  }
  await admin.auth().setCustomUserClaims(rec.uid, u.claims);
  return rec.uid;
}

async function main() {
  console.log('=========================================');
  console.log('  NBD Pro — SAFE Emulator Seed');
  console.log('  project   :', PROJECT_ID, '(emulator namespace)');
  console.log('  firestore :', EMU_FIRESTORE);
  console.log('  auth      :', EMU_AUTH);
  console.log('=========================================\n');

  await assertEmulatorReachable();
  admin.initializeApp({ projectId: PROJECT_ID });
  const db = admin.firestore();
  const Timestamp = admin.firestore.Timestamp;

  // 1) Users + custom claims
  console.log('[1/4] Creating test users + claims...');
  const uidByEmail = {};
  for (const u of USERS) {
    const uid = await upsertUser(u);
    uidByEmail[u.email] = uid;
    if (u.sub) {
      await db.doc(`subscriptions/${uid}`).set({
        plan: u.sub.plan, status: u.sub.status, email: u.email,
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      }, { merge: true });
    }
    console.log(`   ✓ ${u.email.padEnd(28)} uid=${uid.padEnd(12)} claims=${JSON.stringify(u.claims)}`);
  }

  // 2) Company tenant doc + per-tenant company profile
  console.log('\n[2/4] Seeding company tenant (' + COMPANY_ID + ')...');
  const coAdminUid = uidByEmail['admin@testco.pro'];
  await db.doc(`companies/${COMPANY_ID}`).set({
    ownerId: coAdminUid, name: 'Test Roofing Co', owner: 'Casey Admin',
    phone: '(513) 555-7000', email: 'admin@testco.pro', address: 'Cincinnati, OH',
    subscription: { plan: 'professional', status: 'active' },
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  }, { merge: true });
  // companyProfile is keyed by companyId (per firestore.rules) and drives
  // generated-document constants.
  await db.doc(`companyProfile/${COMPANY_ID}`).set({
    companyId: COMPANY_ID, companyName: 'Test Roofing Co',
    legalName: 'Test Roofing Co LLC', license: 'OH-TEST-0001',
    warranty: '10-Year Labor Warranty', updatedAt: Timestamp.now(),
  }, { merge: true });
  console.log('   ✓ companies/' + COMPANY_ID + '  (ownerId=' + coAdminUid + ')');
  console.log('   ✓ companyProfile/' + COMPANY_ID);

  // 3) reps/{uid} for the team so Team tab + company-scoped reads resolve
  console.log('\n[3/4] Seeding team rep profiles...');
  for (const u of USERS) {
    if (!u.claims || u.claims.companyId !== COMPANY_ID) continue;
    const uid = uidByEmail[u.email];
    await db.doc(`reps/${uid}`).set({
      companyId: COMPANY_ID, role: u.claims.role, name: u.displayName,
      email: u.email, active: true, createdAt: Timestamp.now(),
    }, { merge: true });
    console.log(`   ✓ reps/${uid} (${u.claims.role})`);
  }

  // 4) Rich demo dataset for demo@nobigdeal.pro (reuses functions/seed-demo.js).
  //    seed-demo looks up that user (created above) and seeds userId-scoped
  //    leads/estimates/knocks/tasks. Shares this process's admin app.
  console.log('\n[4/4] Running functions/seed-demo.js for demo@nobigdeal.pro...\n');
  const { seed } = require(path.join(FUNCTIONS_DIR, 'seed-demo.js'));
  await seed();

  console.log('\n=========================================');
  console.log('  SEED COMPLETE — log in at /pro/login.html');
  console.log('  password for all: ' + TEST_PASSWORD);
  for (const u of USERS) {
    console.log('   • ' + u.email.padEnd(28) + ' — ' + u.displayName);
  }
  console.log('=========================================\n');
  process.exit(0);
}

main().catch((e) => {
  console.error('SEED FAILED:', e && (e.stack || e.message || e));
  process.exit(1);
});
