/**
 * tests/lead-lifecycle.test.js — Phase 2 core daily loop, end-to-end.
 *
 * Drives the lead pipeline the way the CRM does: a signed-in sales_rep (client
 * firebase SDK vs the Auth+Firestore emulators) CREATES a lead, READS it back
 * (persistence), MOVES it across stages with updateDoc (the persisted outcome
 * of a kanban drag), EDITS a field, SOFT-deletes it (deleted:true → excluded by
 * the active-pipeline query), then HARD-deletes it. Every write is re-read from
 * Firestore to prove it survived "reload". Real rules are in force throughout.
 *
 * RUN (via emulator):
 *   firebase emulators:exec --only auth,firestore --project nobigdeal-pro \
 *     'node tests/lead-lifecycle.test.js'
 */
'use strict';

const admin = require('firebase-admin');
const { initializeApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const {
  getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc,
  collection, addDoc, getDocs, query, where,
} = require('firebase/firestore');

const PROJECT = process.env.GCLOUD_PROJECT || 'nobigdeal-pro';
const COMPANY_ID = 'demo-co';
const PASSWORD = 'Test123!';
const EMAIL = 'salesrep@demo.test';
const FS_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('✗ emulator host env not set — run via `firebase emulators:exec`.');
  process.exit(1);
}

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

admin.initializeApp({ projectId: PROJECT });

async function run() {
  // Provision the signing-in rep.
  let rec;
  try { rec = await admin.auth().getUserByEmail(EMAIL); }
  catch { rec = await admin.auth().createUser({ email: EMAIL, password: PASSWORD, emailVerified: true }); }
  await admin.auth().setCustomUserClaims(rec.uid, { role: 'sales_rep', companyId: COMPANY_ID });

  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake-emulator-key' }, 'lifecycle');
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${AUTH_HOST}`, { disableWarnings: true });
  const db = getFirestore(app);
  const [h, p] = FS_HOST.split(':');
  connectFirestoreEmulator(db, h, Number(p));

  const cred = await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
  const uid = cred.user.uid;

  console.log('LEAD LIFECYCLE (signed-in sales_rep, rules enforced)');

  // CREATE
  const ref = await addDoc(collection(db, 'leads'), {
    userId: uid, companyId: COMPANY_ID, firstName: 'Dana', lastName: 'Reed',
    name: 'Dana Reed', phone: '555-0190', address: '12 Birch Ln, Austin TX',
    stage: 'new', source: 'referral', jobValue: 18000, deleted: false,
  });
  ok('create lead → returns id', !!ref.id);

  // READ back (persistence #1)
  let snap = await getDoc(doc(db, 'leads', ref.id));
  ok('created lead persists + reads back', snap.exists() && snap.get('name') === 'Dana Reed' && snap.get('stage') === 'new');

  // MOVE across stages (kanban drag → updateDoc), re-read each time.
  for (const stage of ['inspected', 'quoted', 'won']) {
    await updateDoc(doc(db, 'leads', ref.id), { stage });
    snap = await getDoc(doc(db, 'leads', ref.id));
    ok(`move stage → '${stage}' persists (survives reload)`, snap.get('stage') === stage);
  }

  // EDIT a field
  await updateDoc(doc(db, 'leads', ref.id), { jobValue: 23500 });
  snap = await getDoc(doc(db, 'leads', ref.id));
  ok('edit jobValue persists', snap.get('jobValue') === 23500);

  // SOFT delete → excluded from the active-pipeline query (deleted == false)
  await updateDoc(doc(db, 'leads', ref.id), { deleted: true });
  const activeSnap = await getDocs(query(collection(db, 'leads'),
    where('userId', '==', uid), where('deleted', '==', false)));
  const stillListed = activeSnap.docs.some(d => d.id === ref.id);
  ok('soft-deleted lead excluded from active pipeline query', !stillListed);
  snap = await getDoc(doc(db, 'leads', ref.id));
  ok('soft-deleted doc still exists with deleted:true (recoverable)', snap.exists() && snap.get('deleted') === true);

  // HARD delete. NB: a client getDoc on a now-missing lead would throw
  // permission-denied (the read rule evaluates isOwner(resource.data.userId)
  // and resource is null) — an expected rules detail, not a bug — so we confirm
  // removal with the admin SDK, which bypasses rules.
  await deleteDoc(doc(db, 'leads', ref.id));
  const adminSnap = await admin.firestore().doc(`leads/${ref.id}`).get();
  ok('hard delete removes the doc (admin-confirmed)', !adminSnap.exists);

  console.log('\n──────────────────────────────────────────────────');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('✓ All lead-lifecycle tests passed');
}

// Explicit exit: the admin + client Firestore gRPC channels keep the event loop
// alive, so without this the process hangs and emulators:exec never returns.
run().then(() => process.exit(0)).catch(e => { console.error('lead-lifecycle test crashed:', e && (e.stack || e.message)); process.exit(1); });
