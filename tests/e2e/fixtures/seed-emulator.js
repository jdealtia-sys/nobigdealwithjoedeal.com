// @ts-check
// Seed the Firebase Auth + Firestore EMULATORS with a known test tenant so
// the authed Playwright suite (pro-authed.spec.js) can run hermetically —
// no prod credentials, no live traffic. Path B of BIG_ROCKS Rock 3.
//
// Run inside `firebase emulators:exec` (which exports
// FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST to child processes);
// refuses to run otherwise so it can never touch production.
//
//   npm run test:e2e:authed:emu     (see tests/package.json)
//
// The seeded shape mirrors what real provisioning writes:
//   - Auth user (email verified, password login)
//   - users/{uid}            — onboarded:true so the wizard doesn't intercept
//   - companies/{uid}        — createCompany's self-serve tenant shape
//                              (functions/handlers/provisioning.js)
//   - companyProfile/{uid}   — neutral brand seed
//   - subscriptions/{uid}    — active growth plan (company-keyed per Pillar 4;
//                              solo owner ⇒ companyId == uid)
//   - custom claims          — { companyId: uid, role: 'company_admin' }

// Modular admin API (firebase-admin >= 12; REQUIRED as of 14, which removed
// the legacy namespaced admin.auth()/admin.firestore() entry points).
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const EMAIL = process.env.PLAYWRIGHT_TEST_USER_EMAIL || 'playwright-e2e@nbd.test';
const PASSWORD = process.env.PLAYWRIGHT_TEST_USER_PASSWORD || 'nbd-e2e-password-1';
// Must match the projectId the client SDK initializes with (the pages served
// by the hosting emulator are hardcoded to nobigdeal-pro) or the browser and
// this seed would read/write different emulator namespaces.
const PROJECT_ID = 'nobigdeal-pro';

async function main() {
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIRESTORE_EMULATOR_HOST) {
    console.error(
      '[seed-emulator] Refusing to run: FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST ' +
      'not set. Run via `firebase emulators:exec` only — this script must never touch prod.'
    );
    process.exit(1);
  }

  initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth();
  const db = getFirestore();

  // Idempotent: emulators usually start empty, but a re-run inside one
  // emulators:exec session shouldn't fail.
  let user;
  try {
    user = await auth.getUserByEmail(EMAIL);
  } catch (e) {
    user = await auth.createUser({
      email: EMAIL,
      password: PASSWORD,
      emailVerified: true,
      displayName: 'Playwright E2E',
    });
  }
  const uid = user.uid;

  await auth.setCustomUserClaims(uid, { companyId: uid, role: 'company_admin' });

  const now = FieldValue.serverTimestamp();
  const batch = db.batch();
  batch.set(db.doc(`users/${uid}`), {
    firstName: 'Playwright',
    lastName: 'E2E',
    company: 'E2E Test Roofing',
    email: EMAIL,
    onboarded: true,
    onboardedAt: now,
    createdAt: now,
  }, { merge: true });
  batch.set(db.doc(`companies/${uid}`), {
    name: 'E2E Test Roofing',
    ownerId: uid,
    status: 'active',
    plan: 'growth',
    source: 'e2e-seed',
    createdAt: now,
  }, { merge: true });
  batch.set(db.doc(`companyProfile/${uid}`), {
    brand: {
      legalName: 'E2E Test Roofing',
      contact: { alertEmail: EMAIL },
    },
    provisionedBy: 'seed-emulator',
    createdAt: now,
  }, { merge: true });
  batch.set(db.doc(`subscriptions/${uid}`), {
    plan: 'growth',
    status: 'active',
    source: 'e2e-seed',
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
  await batch.commit();

  console.log(`[seed-emulator] Seeded ${EMAIL} (uid ${uid}) with an active growth tenant.`);
}

main().catch((e) => {
  console.error('[seed-emulator] FAILED:', e);
  process.exit(1);
});
