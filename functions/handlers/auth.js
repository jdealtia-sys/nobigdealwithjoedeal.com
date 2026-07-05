/**
 * functions/handlers/auth.js — auth-related triggers + callables.
 *
 * Step 4c extraction. Moved verbatim from functions/index.js:
 *   - onRepSignup           (beforeUserCreated, blocking auth trigger)
 *   - activateInvitedRep    (onCall, first-login profile finalize)
 *   - provisionE2ETestUser  (onCall owner-only, Playwright setup)
 *   - cleanupE2ETestData    (onCall caller-scoped, Playwright teardown)
 *   - mintOwnerClaims       (onCall, stamps { owner:true, role:'admin' }
 *                            on the OWNER_EMAILS founder accounts —
 *                            added 2026-07, not part of the Step 4c move)
 *
 * NOTE: onRepSignup is in NBD_DEPLOY_SKIP_LIST per .github/workflows/
 * firebase-deploy.yml — DO NOT remove its export. The skip-list is
 * applied at deploy time, not at code time.
 *
 * No behavioral changes; pure structural move.
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { beforeUserCreated, beforeUserSignedIn } = require('firebase-functions/v2/identity');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue } = require('firebase-admin/firestore');

const {
  CORS_ORIGINS,
  E2E_TEST_USER_EMAIL,
  OWNER_EMAILS,
  isOwnerCaller,
  _generateE2EPassword,
  INVITE_ALLOWED_ROLES,
} = require('./_shared');
const { callableRateLimit } = require('../shared');

// ═════════════════════════════════════════════════════════════
// provisionE2ETestUser (Rock 3 PR 3)
//
// One-shot owner-only callable that provisions the Playwright E2E
// test user. Idempotent: if the user already exists it rotates the
// password and re-stamps the e2eTestAccount flag. Returns the new
// password ONCE in the response — caller's responsibility to capture
// and store it (GitHub Secrets etc.).
//
// Owner-only because creating a Firebase Auth account directly via
// Admin SDK is a privileged op. Mirrors the OWNER_EMAILS allowlist
// in docs/pro/js/nbd-auth.js so behaviour stays consistent.
//
// The created user is tagged so leaderboards and analytics can
// filter it out:
//   users/{uid}: { e2eTestAccount: true, companyId: <uid>, plan: 'free' }
//
// Returns:
//   {
//     email:    'playwright-e2e@nobigdealwithjoedeal.com',
//     password: <16-char strong random>,
//     uid:      <firebase auth uid>,
//     action:   'created' | 'rotated'
//   }
// ═════════════════════════════════════════════════════════════
exports.provisionE2ETestUser = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 60,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');

    const callerEmail = (request.auth.token && request.auth.token.email || '').toLowerCase();
    const callerRole  = request.auth.token && request.auth.token.role;
    // Claims-based owner check (token.owner === true, minted by
    // mintOwnerClaims below) with the deprecated OWNER_EMAILS fallback
    // — remove the email fallback (inside isOwnerCaller) after owner
    // claims are confirmed in prod.
    const isOwner = isOwnerCaller(request.auth.token);
    const isPlatformAdmin = callerRole === 'admin';
    if (!isOwner && !isPlatformAdmin) {
      logger.warn('provisionE2ETestUser: rejected non-owner', { uid, callerEmail });
      throw new HttpsError('permission-denied', 'Owner-only');
    }

    const auth = getAuth();
    const db = getFirestore();
    const password = _generateE2EPassword();

    let userRecord, action;
    try {
      userRecord = await auth.getUserByEmail(E2E_TEST_USER_EMAIL);
      // Already exists — rotate password.
      await auth.updateUser(userRecord.uid, { password, emailVerified: true });
      action = 'rotated';
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
      // Create from scratch.
      userRecord = await auth.createUser({
        email: E2E_TEST_USER_EMAIL,
        password,
        emailVerified: true,
        displayName: 'Playwright E2E Test User'
      });
      action = 'created';
    }

    // Stamp Firestore user doc so leaderboards/analytics can filter
    // and so the dashboard's plan-tier check doesn't lock us out.
    await db.collection('users').doc(userRecord.uid).set({
      email: E2E_TEST_USER_EMAIL,
      e2eTestAccount: true,
      companyId: userRecord.uid,                  // solo-op convention
      plan: 'free',                                // lowest tier; tests should run on the cheapest path
      provisionedBy: uid,
      provisionedAt: FieldValue.serverTimestamp(),
      provisionAction: action
    }, { merge: true });

    logger.info('provisionE2ETestUser: ' + action, {
      provisionerUid: uid, testUid: userRecord.uid, email: E2E_TEST_USER_EMAIL
    });

    return {
      email: E2E_TEST_USER_EMAIL,
      password,
      uid: userRecord.uid,
      action
    };
  }
);

// ═════════════════════════════════════════════════════════════
// cleanupE2ETestData (Rock 3 PR 4)
//
// Caller-scoped destructive sweep used by the Playwright authed
// suite's afterAll hook. Deletes every doc in `leads`, `estimates`,
// `notes`, and `documents` subcollections where the caller owns
// the parent lead AND the doc is tagged `e2eTestData: true`.
//
// Why caller-scoped not admin-scoped: any user can call this on
// THEIR OWN data only. The test user (e2eTestAccount: true) is the
// only practical caller because all production users have
// e2eTestData: false on every doc by default. A real human running
// this on themselves would only delete docs they explicitly tagged
// as test data, which is impossible via the UI — there's no field
// for it. So functionally, this is test-user-only without needing
// an explicit role check.
//
// Belt-and-suspenders: also requires the caller to have
// `e2eTestAccount: true` on their users/{uid} doc. If a future bug
// somehow tagged a real user's doc as test data, this guard prevents
// the test cleanup from nuking it.
//
// Returns:
//   {
//     leadsDeleted: <int>,
//     estimatesDeleted: <int>,
//     activityDeleted: <int>,
//     notesDeleted: <int>,
//     documentsDeleted: <int>,
//     flatDeleted: { invoices, photos, knocks, expenses },
//     topLevelNotesDeleted: <int>,
//     storageDeleted: <int>
//   }
//
// 2026-07-05 expansion: the journeys added this week (invoice, photo,
// docgen, D2D knock, expenses) tag their docs e2eTestData but the
// sweep only covered leads + estimates — a prod-mode run left orphans
// (three commits acknowledged the tradeoff). Now also swept:
//   - flat tagged collections: invoices (owner field createdBy),
//     photos / knocks / expenses (userId)
//   - Storage objects referenced by swept docs (photo originals +
//     thumbs via storagePath/thumbStoragePath; docgen HTML via the
//     lead documents-subcollection htmlPath) — best-effort deletes
//   - leads/{id}/signatures subcollection (docgen PR3a reuse store)
//   - TOP-LEVEL notes by leadId of swept leads: moveCard's stage-
//     change notes are auto-created and never carry the tag, so they
//     can only be found through their parent lead
// ═════════════════════════════════════════════════════════════
exports.cleanupE2ETestData = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 120,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');

    const db = getFirestore();

    // Belt-and-suspenders: only the e2eTestAccount user can run
    // cleanup. A regular user calling this would see leadsDeleted=0
    // because no production doc carries the e2eTestData flag, but
    // the explicit guard makes intent obvious in the audit log.
    const userDoc = await db.collection('users').doc(uid).get();
    if (!userDoc.exists || userDoc.data().e2eTestAccount !== true) {
      throw new HttpsError('permission-denied',
        'cleanupE2ETestData is only callable by the E2E test account');
    }

    let leadsDeleted = 0, estimatesDeleted = 0;
    let activityDeleted = 0, notesDeleted = 0, documentsDeleted = 0;
    let topLevelNotesDeleted = 0, storageDeleted = 0;
    const flatDeleted = { invoices: 0, photos: 0, knocks: 0, expenses: 0 };

    // Best-effort Storage object delete — a missing object (already
    // cleaned, emulator restart, manual delete) must never fail the sweep.
    const bucket = admin.storage().bucket();
    const deleteStorageObject = async (objectPath) => {
      if (!objectPath || typeof objectPath !== 'string') return;
      try {
        await bucket.file(objectPath).delete();
        storageDeleted++;
      } catch (e) { /* best-effort — 404s expected */ }
    };

    // Lead deletion: scoped to userId == caller AND e2eTestData == true.
    // Subcollections (activity, notes, documents, signatures) get walked
    // and deleted before the parent so we never orphan children.
    const leadsSnap = await db.collection('leads')
      .where('userId', '==', uid)
      .where('e2eTestData', '==', true)
      .limit(1000)
      .get();

    for (const leadDoc of leadsSnap.docs) {
      // Subcollections — admin SDK reaches under leads/{leadId}/*
      for (const subPath of ['activity', 'notes', 'documents', 'signatures']) {
        const subSnap = await leadDoc.ref.collection(subPath).limit(500).get();
        if (subSnap.empty) continue;
        let subBatch = db.batch();
        let subBatchCount = 0;
        for (const subDoc of subSnap.docs) {
          // Docgen persists the rendered HTML to Storage and records the
          // path on the metadata doc — reap the object with the doc.
          if (subPath === 'documents') {
            await deleteStorageObject((subDoc.data() || {}).htmlPath);
          }
          subBatch.delete(subDoc.ref);
          subBatchCount++;
          if (subPath === 'activity') activityDeleted++;
          else if (subPath === 'notes') notesDeleted++;
          else documentsDeleted++; // documents + signatures (both doc artifacts)
          if (subBatchCount >= 400) {
            await subBatch.commit();
            subBatch = db.batch();
            subBatchCount = 0;
          }
        }
        if (subBatchCount > 0) await subBatch.commit();
      }
    }

    // TOP-LEVEL notes keyed to swept leads. moveCard's stage-change notes
    // live in the flat /notes collection with a leadId field and are
    // auto-created — they never carry e2eTestData, so the only way to find
    // them is through their parent lead. 'in' queries cap at 30 values.
    const sweptLeadIds = leadsSnap.docs.map((d) => d.id);
    for (let i = 0; i < sweptLeadIds.length; i += 30) {
      const chunk = sweptLeadIds.slice(i, i + 30);
      const notesSnap = await db.collection('notes')
        .where('userId', '==', uid)
        .where('leadId', 'in', chunk)
        .limit(500)
        .get();
      if (notesSnap.empty) continue;
      let nBatch = db.batch();
      let nCount = 0;
      for (const n of notesSnap.docs) {
        nBatch.delete(n.ref);
        nCount++;
        topLevelNotesDeleted++;
        if (nCount >= 400) { await nBatch.commit(); nBatch = db.batch(); nCount = 0; }
      }
      if (nCount > 0) await nBatch.commit();
    }

    // Flat tagged collections from the newer journeys. Owner field varies:
    // invoices stamp createdBy (see createInvoiceFromEstimate); the rest
    // stamp userId. Photos also own Storage objects (original + thumb).
    const FLAT_SWEEPS = [
      { coll: 'invoices', ownerField: 'createdBy', key: 'invoices' },
      { coll: 'photos',   ownerField: 'userId',    key: 'photos' },
      { coll: 'knocks',   ownerField: 'userId',    key: 'knocks' },
      { coll: 'expenses', ownerField: 'userId',    key: 'expenses' },
    ];
    for (const { coll, ownerField, key } of FLAT_SWEEPS) {
      const snap = await db.collection(coll)
        .where(ownerField, '==', uid)
        .where('e2eTestData', '==', true)
        .limit(1000)
        .get();
      if (snap.empty) continue;
      let fBatch = db.batch();
      let fCount = 0;
      for (const d of snap.docs) {
        if (coll === 'photos') {
          const data = d.data() || {};
          await deleteStorageObject(data.storagePath);
          await deleteStorageObject(data.thumbStoragePath);
        }
        fBatch.delete(d.ref);
        fCount++;
        flatDeleted[key]++;
        if (fCount >= 400) { await fBatch.commit(); fBatch = db.batch(); fCount = 0; }
      }
      if (fCount > 0) await fBatch.commit();
    }

    // Now batch-delete the leads themselves.
    let batch = db.batch();
    let batchCount = 0;
    for (const leadDoc of leadsSnap.docs) {
      batch.delete(leadDoc.ref);
      batchCount++;
      leadsDeleted++;
      if (batchCount >= 400) {
        await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }
    if (batchCount > 0) await batch.commit();

    // Estimates collection — flat, scoped by userId + e2eTestData.
    const estSnap = await db.collection('estimates')
      .where('userId', '==', uid)
      .where('e2eTestData', '==', true)
      .limit(1000)
      .get();

    let estBatch = db.batch();
    let estBatchCount = 0;
    for (const estDoc of estSnap.docs) {
      estBatch.delete(estDoc.ref);
      estBatchCount++;
      estimatesDeleted++;
      if (estBatchCount >= 400) {
        await estBatch.commit();
        estBatch = db.batch();
        estBatchCount = 0;
      }
    }
    if (estBatchCount > 0) await estBatch.commit();

    logger.info('cleanupE2ETestData: done', {
      uid, leadsDeleted, estimatesDeleted, activityDeleted, notesDeleted,
      documentsDeleted, topLevelNotesDeleted, flatDeleted, storageDeleted
    });

    return {
      leadsDeleted,
      estimatesDeleted,
      activityDeleted,
      notesDeleted,
      documentsDeleted,
      topLevelNotesDeleted,
      flatDeleted,
      storageDeleted
    };
  }
);

// ═════════════════════════════════════════════════════════════
// onRepSignup — Blocking auth trigger (beforeUserCreated)
//
// Fires when ANY user creates an account. Checks if their email
// is in any company's members subcollection. If found:
//   1. Sets custom claims: { companyId, role, plan }
//   2. Updates the member doc status from 'invited' → 'active'
//   3. Creates a Firestore user profile with company scoping
//
// If the email isn't in any company's members list, this is a
// solo operator signup — they get no company claims (default).
//
// This is a BLOCKING trigger — it runs before the user's
// account is finalized, so the claims are available immediately
// on their first login (no token refresh delay).
// ═════════════════════════════════════════════════════════════
exports.onRepSignup = beforeUserCreated(
  { region: 'us-central1' },
  async (event) => {
    const user = event.data;
    const email = (user.email || '').toLowerCase().trim();
    if (!email) return; // No email = nothing to match

    const db = getFirestore();

    let companyId, role;
    try {
      // Search all companies' member lists for this email
      // This is a collectionGroup query on 'members' subcollections.
      const memberSnap = await db.collectionGroup('members')
        .where('email', '==', email)
        .where('status', '==', 'invited')
        .limit(1)
        .get();

      if (memberSnap.empty) {
        // Not an invited rep — solo operator signup. No claims to set.
        logger.info('onRepSignup: no matching invite');
        return;
      }

      const memberDoc = memberSnap.docs[0];
      const memberData = memberDoc.data();
      // The parent path is companies/{companyId}/members/{email}
      companyId = memberDoc.ref.parent.parent.id;

      // CRITICAL: hard allowlist. A malicious/compromised company owner
      // could have written `role: 'admin'` into the invite doc in an
      // attempt to mint platform-admin claims. Reject anything outside
      // the invite allowlist and fall back to the lowest-privilege role.
      const requested = typeof memberData.role === 'string' ? memberData.role : '';
      if (!INVITE_ALLOWED_ROLES.has(requested)) {
        logger.warn('onRepSignup: invite role outside allowlist', { companyId, requested });
        role = 'sales_rep';
      } else {
        role = requested;
      }

      logger.info('onRepSignup: matched invite', { companyId, role });
    } catch (e) {
      // Fail CLOSED. Previously we returned no claims and let signup
      // succeed "so claims can be set later" — but that created a
      // window where the user could read any doc missing a companyId
      // field, since myCompanyId() was null. Block signup on error.
      logger.error('onRepSignup error — blocking signup', { err: e.message });
      throw new HttpsError('internal', 'Signup temporarily unavailable. Try again shortly.');
    }

    return {
      customClaims: {
        companyId: companyId,
        role: role,
        plan: 'growth' // invited reps inherit the company's plan
      }
    };
  }
);

// ═════════════════════════════════════════════════════════════
// Q3: beforeAdminSignIn — TEMPORARILY DISABLED.
//
// The trigger code below is functionally correct; the problem is
// deploy-time registration. This project has only ever used
// beforeUserCreated as a blocking trigger. Adding a brand-new
// trigger TYPE (beforeUserSignedIn) requires a one-time Identity
// Platform config update, which the GitHub Actions deploy SA
// lacks the role for. Result: batch function-update rolls back
// and 32 unrelated functions can't redeploy.
//
// Re-enablement runbook (must land before uncommenting `exports.`
// below):
//   1. Firebase Console → Authentication → Settings → Blocking
//      functions → confirm "Enabled" for the `beforeUserSignedIn`
//      event. If disabled, enable it (sends you to Identity
//      Platform upgrade if the project hasn't been upgraded yet).
//   2. Grant the GitHub Actions deploy SA
//      `roles/identityplatform.admin` on the project (or the
//      narrower blocking-function-config role once GCP ships it).
//   3. Uncomment the `exports.beforeAdminSignIn = ...` line below.
//   4. Deploy. On first deploy the CLI may still emit a one-time
//      "blocking function configured" notice — expected.
//
// Until then: the feature-flag + mfa-enroll.html + login.js
// guidance still ship. Admins can self-enroll, and the runtime
// enforcement at the blocking-trigger layer is the only piece
// that's deferred.
//
// Threat model context (same as the active version would apply):
// admin email is findable via OSINT; password is guessable via
// credential stuffing; SMS MFA is bypassable via SIM-swap. TOTP
// (enrolment UI already shipped at /admin/mfa-enroll.html) closes
// all three.
//
// Trigger body preserved below as a plain function so the
// re-enablement step is a one-line change. NOT exported.
// ═════════════════════════════════════════════════════════════
// eslint-disable-next-line no-unused-vars
const _beforeAdminSignInHandler = beforeUserSignedIn(
  { region: 'us-central1' },
  async (event) => {
    const user = event.data;
    if (!user || !user.uid) return;

    // Fast-path: only enforce on accounts with the platform-admin
    // claim. Custom claims ride on the ID token the trigger receives.
    // Firebase Auth sets `user.customClaims` OR `user.tokenClaims`
    // depending on blocking-trigger flavor — probe both.
    const claims = (user.customClaims || user.tokenClaims || {});
    if (claims.role !== 'admin') return;

    // Check the runtime flag. If Firestore is unreachable or the
    // flag doc is missing, fail SAFE (allow) — we don't want a
    // Firestore outage to lock Joe out of his own admin panel.
    let mfaRequired = false;
    try {
      const flagSnap = await getFirestore().doc('feature_flags/_default').get();
      mfaRequired = !!(flagSnap.exists && flagSnap.data()?.admin_mfa_required === true);
    } catch (e) {
      logger.warn('beforeAdminSignIn: feature-flag read failed — allowing', { err: e.message });
      return;
    }
    if (!mfaRequired) return;

    // `multiFactor.enrolledFactors` is an array of MFA info objects.
    // Empty array or missing field = no enrolled factor.
    const factors = (user.multiFactor && user.multiFactor.enrolledFactors) || [];
    if (factors.length > 0) {
      logger.info('beforeAdminSignIn: admin signed in with MFA', {
        uid: user.uid,
        factorCount: factors.length,
        factorTypes: factors.map(f => f && f.factorId).filter(Boolean)
      });
      return;
    }

    // Hard block. The error code + message surface to the client
    // via Firebase Auth's signIn error; the admin-login UI reads
    // this and routes the user to the enrolment flow.
    logger.warn('beforeAdminSignIn: admin blocked — no MFA factor enrolled', { uid: user.uid });
    throw new HttpsError(
      'permission-denied',
      'Admin access requires a second factor. Enroll a TOTP authenticator (e.g., 1Password, Authy) or a hardware key before signing in again.'
    );
  }
);

// ═════════════════════════════════════════════════════════════
// activateInvitedRep — Callable function that reps call after
// their first login to mark their invite as active + create
// their user profile. The beforeUserCreated trigger sets claims
// but can't write to Firestore (blocking triggers are limited).
// This function does the Firestore writes.
// ═════════════════════════════════════════════════════════════
exports.activateInvitedRep = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');

    const companyId = request.auth.token.companyId;
    const role = request.auth.token.role;
    const email = request.auth.token.email || '';

    if (!companyId) {
      // Not an invited rep — nothing to activate
      return { activated: false, reason: 'no_company_claim' };
    }

    const db = getFirestore();

    try {
      // Update the member doc: invited → active
      const memberRef = db.doc(`companies/${companyId}/members/${email.toLowerCase()}`);
      const memberSnap = await memberRef.get();
      if (memberSnap.exists) {
        await memberRef.update({
          status: 'active',
          uid: uid,
          activatedAt: FieldValue.serverTimestamp()
        });
      }

      // Create user profile with company scoping
      await db.doc(`users/${uid}`).set({
        email: email,
        role: role,
        companyId: companyId,
        createdAt: FieldValue.serverTimestamp(),
        displayName: request.auth.token.name || email.split('@')[0]
      }, { merge: true });

      logger.info('activateInvitedRep: success');
      return { activated: true, companyId, role };

    } catch (e) {
      logger.error('activateInvitedRep error', { uid, err: e.message });
      throw new HttpsError('internal', 'Activation failed');
    }
  }
);

// ═════════════════════════════════════════════════════════════
// mintOwnerClaims — owner-role claim minting (claims-based root).
//
// Stamps { owner: true, role: 'admin' } custom claims on the two
// founder accounts listed in _shared.js OWNER_EMAILS — the ONLY
// server-side owner email list. Every other owner check (client
// and server) keys on the `owner` claim, with a deprecated email
// fallback during the rollout.
//
// WHY A CALLABLE AND NOT A BLOCKING AUTH TRIGGER: minting must run
// on a code path that actually DEPLOYS.
//   - beforeUserCreated (onRepSignup) is in NBD_DEPLOY_SKIP_LIST
//     (.github/workflows/firebase-deploy.yml — the deploy SA lacks
//     identityplatform.admin, so the strict pass skips it and the
//     tolerant retry fails). It also only fires at account CREATION
//     — Joe's accounts already exist.
//   - beforeUserSignedIn was never exported (see the Q3 header on
//     _beforeAdminSignInHandler above): registering a new blocking-
//     trigger TYPE needs a one-time Identity Platform config change
//     the deploy SA can't make. If/when that trigger is re-enabled,
//     this minting can move into it (return { sessionClaims } /
//     { customClaims } from the handler) and this callable becomes
//     a no-op safety net.
// A plain onCall in handlers/*.js IS deployed: the workflow greps
// `^exports.<name> = onCall` across functions/handlers/*.js, and
// mintOwnerClaims is not in NBD_DEPLOY_SKIP_LIST, so it ships in
// the strict deploy pass (index.js re-exports it — required for
// deploy-by-name; see the AUDIT #2 FIX note in the workflow).
//
// CALLER: docs/pro/js/nbd-auth.js fires this (fire-and-forget) when
// a signed-in user matches the client OWNER_EMAILS fallback but the
// token doesn't carry owner:true yet, then forces a token refresh.
// Same de-GCIP'd claim-at-login pattern as claimInvite
// (handlers/invites.js) — mergeCustomClaims read-merge-write, since
// setCustomUserClaims REPLACES the whole claim set and we must not
// drop companyId/plan/billing claims.
//
// SECURITY:
//   - Non-owner callers get a benign { owner: false } no-op — the
//     email list never authorizes anything by itself here, it only
//     selects who gets the claim.
//   - email_verified is required (checked on the Auth USER RECORD,
//     not just the token) so an unverified account squatting on an
//     owner address can never mint root. If an owner account is
//     unverified, minting is refused but the client email fallback
//     keeps Jo working — no lockout, just no claim yet.
//   - Idempotent: re-calls when claims already present are no-ops.
// ═════════════════════════════════════════════════════════════
exports.mintOwnerClaims = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');
    await callableRateLimit(request, 'mintOwnerClaims', 10, 3_600_000);

    const token = request.auth.token || {};
    const tokenEmail = (token.email || '').trim().toLowerCase();

    // Cheap pre-checks on the token (case-insensitive email match).
    if (!tokenEmail || !OWNER_EMAILS.has(tokenEmail)) {
      return { owner: false };
    }
    if (token.owner === true && token.role === 'admin') {
      return { owner: true, minted: false }; // already stamped — no-op
    }

    // Authoritative checks against the Auth user record: the email on
    // the record must (still) be an owner email AND be verified.
    const auth = getAuth();
    let userRecord;
    try {
      userRecord = await auth.getUser(uid);
    } catch (e) {
      logger.error('mintOwnerClaims: getUser failed', { uid, err: e.message });
      throw new HttpsError('internal', 'Could not read account');
    }
    const recordEmail = (userRecord.email || '').trim().toLowerCase();
    if (!recordEmail || !OWNER_EMAILS.has(recordEmail)) {
      return { owner: false };
    }
    if (userRecord.emailVerified !== true) {
      // Refuse to mint root off an unverified address. The client-side
      // OWNER_EMAILS fallback keeps the account usable meanwhile.
      logger.warn('mintOwnerClaims: owner email unverified — not minting', { uid });
      return { owner: false, reason: 'email_unverified' };
    }

    const existing = userRecord.customClaims || {};
    if (existing.owner === true && existing.role === 'admin') {
      // Claims already on the record; the caller's token is just stale.
      return { owner: true, minted: false, refresh: true };
    }

    // Read-merge-write (mergeCustomClaims pattern — stripe.js /
    // provisioning.js / invites.js): keep companyId/plan/etc. intact.
    await auth.setCustomUserClaims(uid, { ...existing, owner: true, role: 'admin' });
    logger.info('mintOwnerClaims: minted owner claims', { uid });
    return { owner: true, minted: true, refresh: true };
  }
);
