/**
 * functions/handlers/admin.js — admin-facing callables.
 *
 * Step 4c extraction. Moved verbatim from functions/index.js:
 *   - getAdminAnalytics             (C3: ops dashboard numbers)
 *   - auditCustomerDataIntegrity    (Rock 3 PR 2: read-only integrity report)
 *   - backfillCustomerData          (Rock 3 PR 2: idempotent migration)
 *   - rotateAccessCodes             (C-2: legacy access-code kill switch)
 *   - createTeamMember              (team lifecycle: add member)
 *   - updateUserRole                (team lifecycle: change role)
 *   - deactivateUser                (team lifecycle: disable/reactivate)
 *   - listTeamMembers               (team lifecycle: roster fetch)
 *
 * No behavioral changes; pure structural move.
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');

const { callableRateLimit } = require('../shared');
const {
  CORS_ORIGINS,
  LEGACY_ACCESS_CODES,
  requireTeamAdmin,
  normalizeRole,
  normalizeEmail,
} = require('./_shared');

// ═══════════════════════════════════════════════════════════════
// getAdminAnalytics — C3: ops dashboard numbers for the Team Manager.
//
// Returns:
//   signatures:   { sent30d, signed30d, avgHoursToSign }
//   measurements: { requested30d, ready30d, passThruRevenueEst }
//   portal:       { linksMinted30d, portalViews30d }
//   claude:       { tokens30d, costEstimate }
//   leads:        { created30d, signed30d, winRatePct }
//
// Platform admin OR company_admin of the target company. company_admin
// gets scoped to their own companyId; platform admin gets the union
// across the platform when called without a company filter.
// ═══════════════════════════════════════════════════════════════
exports.getAdminAnalytics = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '512MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const isPlatformAdmin = request.auth.token.role === 'admin';
    const isCompanyAdmin  = request.auth.token.role === 'company_admin';
    // H-04: a previous "solo-owner fallback" branch let every
    // authenticated user without a companyId claim (i.e. every
    // free-tier signup) through this callable. Each call runs three
    // 30-day collection scans — a cheap DoS vector and a
    // reconnaissance gift. Require an actual admin claim.
    if (!isPlatformAdmin && !isCompanyAdmin) {
      throw new HttpsError('permission-denied', 'Admin access required');
    }
    // Per-uid rate limit — admins still shouldn't be calling this in
    // a loop. 30/hour is generous for a dashboard refresh.
    await callableRateLimit(request, 'getAdminAnalytics', 30, 3_600_000);

    const companyId = isPlatformAdmin
      ? (request.data?.companyId || request.auth.token.companyId || null)
      : request.auth.token.companyId;

    const db = admin.firestore();
    const since = admin.firestore.Timestamp.fromMillis(Date.now() - 30 * 86_400_000);

    // Helper — for a rep-owned collection, restrict to the caller's
    // company when not platform admin. Platform admin with no company
    // filter gets unfiltered.
    async function companyUids() {
      if (!companyId) return null; // platform admin, global
      const membersSnap = await db.collection('companies/' + companyId + '/members').get();
      const uids = membersSnap.docs.map(d => d.data().uid).filter(Boolean);
      // Always include the owner.
      const coSnap = await db.doc('companies/' + companyId).get();
      if (coSnap.exists && coSnap.data().ownerId) uids.push(coSnap.data().ownerId);
      return [...new Set(uids)];
    }

    const repUids = await companyUids();

    // Signatures — walk estimates created in last 30d that have a
    // signatureStatus of sent/viewed/signed/declined/expired.
    let estQuery = db.collection('estimates').where('createdAt', '>=', since);
    const estSnap = await estQuery.get();
    const ests = estSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(e => !repUids || repUids.includes(e.userId));
    const sent = ests.filter(e => e.signatureStatus && e.signatureStatus !== 'none');
    const signed = ests.filter(e => e.signatureStatus === 'signed');
    const hours = signed
      .map(e => {
        const sent_t = e.signatureSentAt?.toMillis?.();
        const signed_t = e.signedAt?.toMillis?.();
        return (sent_t && signed_t) ? (signed_t - sent_t) / 3_600_000 : null;
      })
      .filter(h => h != null && h > 0);
    const avgHoursToSign = hours.length
      ? Math.round(hours.reduce((a, b) => a + b, 0) / hours.length * 10) / 10
      : null;

    // Measurements — rollup of count + estimated revenue from the
    // pass-through line. We count only 'ready' jobs in the window.
    let msQuery = db.collection('measurements').where('createdAt', '>=', since);
    const msSnap = await msQuery.get();
    const measurements = msSnap.docs.map(d => d.data())
      .filter(m => !repUids || repUids.includes(m.ownerId));
    const readyMeas = measurements.filter(m => m.status === 'ready');
    const passThruPrice = Number(process.env.NBD_MEASUREMENT_PASSTHRU_PRICE) || 75;
    const passThruRevenueEst = readyMeas.length * passThruPrice;

    // Portal links
    let linksMinted30d = 0, portalViews30d = 0;
    try {
      const tokSnap = await db.collection('portal_tokens')
        .where('mintedAt', '>=', since).get();
      const tokens = tokSnap.docs.map(d => d.data())
        .filter(t => !repUids || repUids.includes(t.ownerUid));
      linksMinted30d = tokens.length;
      portalViews30d = tokens.reduce((s, t) => s + (t.uses || 0), 0);
    } catch (e) { /* index may not exist yet */ }

    // Claude tokens — we already stamp companyId on api_usage.
    let claudeTokens30d = 0;
    try {
      const q = companyId
        ? db.collection('api_usage').where('companyId', '==', companyId).where('timestamp', '>=', since)
        : db.collection('api_usage').where('timestamp', '>=', since);
      const s = await q.get();
      s.forEach(d => {
        const r = d.data();
        claudeTokens30d += (r.inputTokens || 0) + (r.outputTokens || 0);
      });
    } catch (e) { /* fall through */ }
    // Sonnet pricing: $3/M input, $15/M output. Approx with ratio
    // input:output = 3:1 which is our typical.
    const claudeCostEstimate = (claudeTokens30d / 1_000_000) * 6.0;

    // Leads
    let leadQuery = db.collection('leads').where('createdAt', '>=', since);
    const leadSnap = await leadQuery.get();
    const leads = leadSnap.docs.map(d => d.data())
      .filter(l => !repUids || repUids.includes(l.userId));
    const createdCount = leads.length;
    const signedCount = leads.filter(l => /sign|won|closed/i.test(l.stage || '')).length;

    return {
      range: 'last 30 days',
      companyId: companyId || 'all',
      generatedAt: new Date().toISOString(),
      signatures: {
        sent30d: sent.length,
        signed30d: signed.length,
        avgHoursToSign: avgHoursToSign
      },
      measurements: {
        requested30d: measurements.length,
        ready30d: readyMeas.length,
        passThruRevenueEst: passThruRevenueEst,
        passThruPrice
      },
      portal: {
        linksMinted30d,
        portalViews30d
      },
      claude: {
        tokens30d: claudeTokens30d,
        costEstimateUSD: Math.round(claudeCostEstimate * 100) / 100
      },
      leads: {
        created30d: createdCount,
        won30d: signedCount,
        winRatePct: createdCount > 0 ? Math.round(signedCount / createdCount * 100) : 0
      }
    };
  }
);

// ═════════════════════════════════════════════════════════════
// auditCustomerDataIntegrity (Rock 3 PR 2)
//
// Read-only inventory of the caller's leads. Reports counts of
// leads missing companyId or customerId, plus 5 sample doc IDs of
// each so Joe can spot-check before running backfill. Caller-scoped
// — only sees their own leads (filtered by userId == request.auth.uid),
// so a rep can't audit somebody else's tenant.
//
// Returns:
//   {
//     total: <int>,
//     missingCompanyId: <int>, sampleMissingCompanyId: [docId, ...],
//     missingCustomerId: <int>, sampleMissingCustomerId: [docId, ...]
//   }
//
// Counterpart write fn: backfillCustomerData (next).
// ═════════════════════════════════════════════════════════════
exports.auditCustomerDataIntegrity = onCall(
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

    const db = admin.firestore();
    const snap = await db.collection('leads').where('userId', '==', uid).limit(10000).get();

    let missingCompanyId = 0;
    let missingCustomerId = 0;
    const sampleMissingCompanyId = [];
    const sampleMissingCustomerId = [];

    for (const doc of snap.docs) {
      const d = doc.data();
      if (!d.companyId) {
        missingCompanyId++;
        if (sampleMissingCompanyId.length < 5) sampleMissingCompanyId.push(doc.id);
      }
      if (!d.customerId) {
        missingCustomerId++;
        if (sampleMissingCustomerId.length < 5) sampleMissingCustomerId.push(doc.id);
      }
    }

    logger.info('auditCustomerDataIntegrity', {
      uid, total: snap.size, missingCompanyId, missingCustomerId
    });

    return {
      total: snap.size,
      missingCompanyId,
      sampleMissingCompanyId,
      missingCustomerId,
      sampleMissingCustomerId
    };
  }
);

// ═════════════════════════════════════════════════════════════
// backfillCustomerData (Rock 3 PR 2)
//
// Idempotent migration: scans the caller's leads and patches any
// doc missing `companyId` or `customerId`. Companies default to
// the caller's existing companyId claim, falling back to their uid
// (matches the solo-operator convention used in _saveLead and the
// `callerCompanyId = decoded.companyId || decoded.uid` pattern in
// the analytics callables). customerIds are allocated via the
// existing counters/customerIds transaction so we don't reuse
// numbers from the live counter.
//
// Safe to run multiple times — re-runs no-op on docs already fixed.
//
// Returns:
//   {
//     scanned: <int>,
//     fixedCompanyId: <int>,
//     fixedCustomerId: <int>,
//     stillMissing: <int>   // any doc the function couldn't safely patch
//   }
// ═════════════════════════════════════════════════════════════
exports.backfillCustomerData = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 540,
    memory: '512MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');

    const db = admin.firestore();
    const callerCompanyId = (request.auth.token && request.auth.token.companyId) || uid;

    const snap = await db.collection('leads').where('userId', '==', uid).limit(10000).get();

    let fixedCompanyId = 0;
    let fixedCustomerId = 0;
    let stillMissing = 0;
    let batch = db.batch();
    let batchCount = 0;

    const counterRef = db.collection('counters').doc('customerIds');

    for (const doc of snap.docs) {
      const d = doc.data();
      const updates = {};

      if (!d.companyId) {
        updates.companyId = callerCompanyId;
        fixedCompanyId++;
      }

      if (!d.customerId) {
        // Allocate a new NBD-#### transactionally, OUTSIDE the batch,
        // because the counter increment is global and the batch must
        // not race with a concurrent _saveLead client write.
        try {
          const newCid = await db.runTransaction(async (tx) => {
            const cs = await tx.get(counterRef);
            const next = cs.exists ? (cs.data().next || 0) + 1 : 1;
            tx.set(counterRef, { next }, { merge: true });
            return 'NBD-' + String(next).padStart(4, '0');
          });
          updates.customerId = newCid;
          fixedCustomerId++;
        } catch (cidErr) {
          logger.warn('backfillCustomerData: customerId alloc failed', { docId: doc.id, err: cidErr && cidErr.message });
          stillMissing++;
        }
      }

      if (Object.keys(updates).length > 0) {
        updates.backfilledAt = admin.firestore.FieldValue.serverTimestamp();
        batch.update(doc.ref, updates);
        batchCount++;

        if (batchCount >= 400) {
          await batch.commit();
          batch = db.batch();
          batchCount = 0;
        }
      }
    }

    if (batchCount > 0) await batch.commit();

    logger.info('backfillCustomerData: done', {
      uid, scanned: snap.size, fixedCompanyId, fixedCustomerId, stillMissing
    });

    return {
      scanned: snap.size,
      fixedCompanyId,
      fixedCustomerId,
      stillMissing
    };
  }
);

// ═════════════════════════════════════════════════════════════
// rotateAccessCodes — platform-admin-only kill switch for legacy
// hardcoded access codes (C-2).
//
// Until this runs, NBD-2026 and the other pre-rotation codes are
// still live in Firestore because the old seed script wrote them.
// Calling this deactivates them server-side. After this, the seed
// script is the only way to mint new codes — and it prints them
// to stdout only.
//
// Platform admin only. Intentionally very loud in logs — every
// call creates an audit_log entry.
// ═════════════════════════════════════════════════════════════
exports.rotateAccessCodes = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    if (request.auth.token.role !== 'admin') {
      throw new HttpsError('permission-denied', 'Platform admin required');
    }

    const db = admin.firestore();
    const deactivated = [];
    for (const codeId of LEGACY_ACCESS_CODES) {
      const ref = db.doc(`access_codes/${codeId}`);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const cur = snap.data();
      if (cur.active === false) continue;
      await ref.update({
        active: false,
        rotatedAt: admin.firestore.FieldValue.serverTimestamp(),
        rotatedBy: uid,
        rotatedReason: 'legacy hardcoded code auto-disabled'
      });
      deactivated.push(codeId);
    }
    logger.warn('rotateAccessCodes: legacy codes disabled', { by: uid, deactivated });
    // Write an audit_log entry explicitly — this predates the audit
    // triggers, so we record it here too.
    await db.collection('audit_log').add({
      type: 'rotate_access_codes',
      actorUid: uid,
      deactivated,
      ts: admin.firestore.FieldValue.serverTimestamp()
    });
    return { success: true, deactivated };
  }
);

// ═════════════════════════════════════════════════════════════
// ADMIN ACCOUNT MANAGER — Team lifecycle Cloud Functions
//
// These callables back the "Team" admin view. Only a global admin
// OR the company owner can invoke them. All writes go through the
// Admin SDK so they bypass Firestore rules — meaning the auth check
// below is the ONLY thing standing between the caller and the data.
// Treat every guard as load-bearing.
//
// Roles: admin | manager | sales_rep | viewer
// ═════════════════════════════════════════════════════════════

// ── createTeamMember ─────────────────────────────────────────
// Creates (or adopts) a Firebase Auth user, stamps role + companyId
// claims, and records the member in companies/{companyId}/members.
// The target's default status is 'active' if we created them fresh,
// 'invited' if they don't have a password set yet.
exports.createTeamMember = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const { uid: callerUid, companyId, companyRef } = await requireTeamAdmin(request);
    await callableRateLimit(request, 'createTeamMember', 20, 60_000);

    const email = normalizeEmail(request.data && request.data.email);
    if (!email) throw new HttpsError('invalid-argument', 'Valid email required');

    // Global admin can grant admin; company owners cannot.
    const role = normalizeRole(request.data && request.data.role);
    if (!role) throw new HttpsError('invalid-argument', 'Invalid role');

    const displayName = typeof request.data?.displayName === 'string'
      ? request.data.displayName.trim().slice(0, 120)
      : '';

    const db = admin.firestore();

    // Make sure the company doc exists so security rules for members work.
    const companySnap = await companyRef.get();
    if (!companySnap.exists) {
      await companyRef.set({
        ownerId: callerUid,
        name: (request.auth.token.name || 'My Company'),
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    let userRecord;
    let created = false;
    try {
      userRecord = await admin.auth().getUserByEmail(email);
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        userRecord = await admin.auth().createUser({
          email,
          emailVerified: false,
          displayName: displayName || email.split('@')[0],
          disabled: false
        });
        created = true;
      } else {
        throw e;
      }
    }

    // Block cross-company poaching: if the target already has a different
    // companyId claim, require global admin to reassign.
    const existingClaims = userRecord.customClaims || {};
    if (existingClaims.companyId && existingClaims.companyId !== companyId && request.auth.token.role !== 'admin') {
      throw new HttpsError('already-exists', 'User is already a member of another company');
    }

    // Merge claims — preserve plan/subscriptionStatus if present.
    const newClaims = {
      ...existingClaims,
      companyId,
      role
    };
    await admin.auth().setCustomUserClaims(userRecord.uid, newClaims);

    const memberRef = db.doc(`companies/${companyId}/members/${email}`);
    await memberRef.set({
      email,
      role,
      displayName: displayName || userRecord.displayName || email.split('@')[0],
      uid: userRecord.uid,
      status: created ? 'invited' : 'active',
      invitedAt: admin.firestore.FieldValue.serverTimestamp(),
      invitedBy: callerUid,
      active: true
    }, { merge: true });

    // Seed user profile doc so the user list query has a name to show.
    await db.doc(`users/${userRecord.uid}`).set({
      email,
      displayName: displayName || userRecord.displayName || email.split('@')[0],
      companyId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // M-5: hash email before logging so Cloud Logging retention can't
    // leak PII. Log the first 16 hex chars — enough for correlation
    // between admins and audit_log entries, not enough for reversal.
    const emailHash = require('crypto').createHash('sha256').update(email).digest('hex').slice(0, 16);
    logger.info('createTeamMember', { companyId, emailHash, role, created });
    return {
      success: true,
      uid: userRecord.uid,
      email,
      role,
      status: created ? 'invited' : 'active',
      created
    };
  }
);

// ── updateUserRole ───────────────────────────────────────────
// Change an existing team member's role. Rewrites custom claims
// and the member doc. Won't let a non-admin promote to admin or
// demote the company owner.
exports.updateUserRole = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const { uid: callerUid, companyId, companyRef } = await requireTeamAdmin(request);
    await callableRateLimit(request, 'updateUserRole', 30, 60_000);

    const targetUid = typeof request.data?.uid === 'string' ? request.data.uid : null;
    const targetEmail = normalizeEmail(request.data && request.data.email);
    if (!targetUid && !targetEmail) {
      throw new HttpsError('invalid-argument', 'Target uid or email required');
    }

    const role = normalizeRole(request.data && request.data.role);
    if (!role) throw new HttpsError('invalid-argument', 'Invalid role');

    const isGlobalAdmin = request.auth.token.role === 'admin';

    // Resolve the target user.
    let userRecord;
    try {
      userRecord = targetUid
        ? await admin.auth().getUser(targetUid)
        : await admin.auth().getUserByEmail(targetEmail);
    } catch (e) {
      throw new HttpsError('not-found', 'User not found');
    }

    const existingClaims = userRecord.customClaims || {};
    // Block changing a user from a different company unless platform admin.
    if (existingClaims.companyId && existingClaims.companyId !== companyId && !isGlobalAdmin) {
      throw new HttpsError('permission-denied', 'User belongs to another company');
    }

    // Prevent demoting the company owner through this path. The owner
    // must keep at least company_admin privileges; downgrade requires
    // transferring ownership first.
    const companySnap = await companyRef.get();
    const ownerId = companySnap.exists ? companySnap.data().ownerId : null;
    if (ownerId && userRecord.uid === ownerId && role !== 'company_admin' && !isGlobalAdmin) {
      throw new HttpsError('failed-precondition', 'Cannot demote the company owner');
    }

    await admin.auth().setCustomUserClaims(userRecord.uid, {
      ...existingClaims,
      companyId,
      role
    });

    // Phase-2.4: force re-auth so a role change (esp. a downgrade) takes
    // effect promptly. Without this the target keeps their old claims on
    // the current ID token until it refreshes (~1h). Mirrors
    // deactivateUser's revoke. (The in-flight token's ~1h lifetime is a
    // Firebase trait; revoking blocks refreshing into a fresh token that
    // still carries stale claims, and forces a re-login that picks up the
    // new role.)
    try {
      await admin.auth().revokeRefreshTokens(userRecord.uid);
    } catch (e) {
      logger.warn('updateUserRole: token revoke failed', { uid: userRecord.uid, err: e.message });
    }

    const emailKey = (userRecord.email || targetEmail || '').toLowerCase();
    if (emailKey) {
      await admin.firestore().doc(`companies/${companyId}/members/${emailKey}`).set({
        role,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: callerUid
      }, { merge: true });
    }

    logger.info('updateUserRole', { companyId, targetUid: userRecord.uid, role });
    return { success: true, uid: userRecord.uid, role };
  }
);

// ── deactivateUser ───────────────────────────────────────────
// Disable the Firebase Auth account and mark the member doc
// deactivated. Data is preserved; toggle `reactivate: true` to
// re-enable. Won't let anyone deactivate the company owner.
exports.deactivateUser = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const { uid: callerUid, companyId, companyRef } = await requireTeamAdmin(request);
    await callableRateLimit(request, 'deactivateUser', 20, 60_000);

    const targetUid = typeof request.data?.uid === 'string' ? request.data.uid : null;
    const targetEmail = normalizeEmail(request.data && request.data.email);
    if (!targetUid && !targetEmail) {
      throw new HttpsError('invalid-argument', 'Target uid or email required');
    }
    const reactivate = request.data?.reactivate === true;

    let userRecord;
    try {
      userRecord = targetUid
        ? await admin.auth().getUser(targetUid)
        : await admin.auth().getUserByEmail(targetEmail);
    } catch (e) {
      throw new HttpsError('not-found', 'User not found');
    }

    const existingClaims = userRecord.customClaims || {};
    const isGlobalAdmin = request.auth.token.role === 'admin';
    if (existingClaims.companyId && existingClaims.companyId !== companyId && !isGlobalAdmin) {
      throw new HttpsError('permission-denied', 'User belongs to another company');
    }

    // Safety: never kill the owner's login from this path.
    const companySnap = await companyRef.get();
    const ownerId = companySnap.exists ? companySnap.data().ownerId : null;
    if (ownerId && userRecord.uid === ownerId) {
      throw new HttpsError('failed-precondition', 'Cannot deactivate the company owner');
    }
    // Don't let the caller lock themselves out.
    if (userRecord.uid === callerUid) {
      throw new HttpsError('failed-precondition', 'Cannot deactivate your own account');
    }

    await admin.auth().updateUser(userRecord.uid, { disabled: !reactivate });
    // Revoke tokens when deactivating so existing sessions die.
    if (!reactivate) {
      await admin.auth().revokeRefreshTokens(userRecord.uid);
    }

    const emailKey = (userRecord.email || targetEmail || '').toLowerCase();
    if (emailKey) {
      await admin.firestore().doc(`companies/${companyId}/members/${emailKey}`).set({
        status: reactivate ? 'active' : 'deactivated',
        active: !!reactivate,
        deactivatedAt: reactivate ? null : admin.firestore.FieldValue.serverTimestamp(),
        deactivatedBy: reactivate ? null : callerUid
      }, { merge: true });
    }

    logger.info(reactivate ? 'reactivateUser' : 'deactivateUser', {
      companyId, targetUid: userRecord.uid
    });
    return { success: true, uid: userRecord.uid, disabled: !reactivate };
  }
);

// ── listTeamMembers ──────────────────────────────────────────
// Returns the team roster enriched with Auth data (lastSignInTime,
// disabled) and a lead count per member. The member doc by itself
// has email/role/status; the extras come from Auth + a cheap
// collectionGroup count on leads.
exports.listTeamMembers = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    const claims = request.auth.token || {};
    const isGlobalAdmin = claims.role === 'admin';
    const isManager = claims.role === 'manager';
    const callerCompanyId = claims.companyId || uid;
    const companyId = (request.data && request.data.companyId) || callerCompanyId;

    // Managers and owners can list their own team. Admins can list any.
    if (!isGlobalAdmin && companyId !== callerCompanyId) {
      throw new HttpsError('permission-denied', 'Cannot view another company');
    }

    const db = admin.firestore();
    const companySnap = await db.doc(`companies/${companyId}`).get();
    // Solo-operator fallback: if the company doc hasn't been created
    // yet AND the caller is acting on their own workspace
    // (companyId === uid), treat them as the owner. Otherwise a solo
    // operator who clicks "Team" before ever creating a company doc
    // gets permission-denied and an empty roster they can't escape.
    const isSelfWorkspace = companyId === uid;
    const ownerId = companySnap.exists
      ? companySnap.data().ownerId
      : (isSelfWorkspace ? uid : null);
    if (!isGlobalAdmin && !isManager && ownerId !== uid) {
      throw new HttpsError('permission-denied', 'Owner, manager, or admin required');
    }

    const membersSnap = await db.collection(`companies/${companyId}/members`).get();
    const members = [];

    // Always include the owner card first.
    if (ownerId) {
      try {
        const ownerRecord = await admin.auth().getUser(ownerId);
        members.push({
          uid: ownerId,
          email: (ownerRecord.email || '').toLowerCase(),
          displayName: ownerRecord.displayName || 'Owner',
          role: 'company_admin',
          status: ownerRecord.disabled ? 'deactivated' : 'active',
          isOwner: true,
          disabled: !!ownerRecord.disabled,
          lastSignInTime: ownerRecord.metadata?.lastSignInTime || null,
          creationTime: ownerRecord.metadata?.creationTime || null,
          leadCount: 0
        });
      } catch (e) {
        logger.warn('listTeamMembers: owner lookup failed', { ownerId, err: e.message });
      }
    }

    for (const doc of membersSnap.docs) {
      const m = doc.data() || {};
      if (!m.email) continue;
      if (m.uid && m.uid === ownerId) continue; // owner already listed

      let authMeta = null;
      try {
        const u = m.uid
          ? await admin.auth().getUser(m.uid)
          : await admin.auth().getUserByEmail(m.email);
        authMeta = {
          uid: u.uid,
          disabled: !!u.disabled,
          lastSignInTime: u.metadata?.lastSignInTime || null,
          creationTime: u.metadata?.creationTime || null
        };
      } catch (e) { /* invited but not signed up yet */ }

      // Lead count — skip if member never activated (no uid to match).
      let leadCount = 0;
      if (authMeta?.uid) {
        try {
          const leadsSnap = await db.collection('leads')
            .where('userId', '==', authMeta.uid)
            .count()
            .get();
          leadCount = leadsSnap.data().count || 0;
        } catch (e) { /* counts may fail on missing index; leave 0 */ }
      }

      members.push({
        uid: authMeta?.uid || m.uid || null,
        email: m.email,
        displayName: m.displayName || m.email.split('@')[0],
        role: m.role || 'sales_rep',
        status: authMeta?.disabled
          ? 'deactivated'
          : (m.status || (authMeta ? 'active' : 'invited')),
        isOwner: false,
        disabled: !!authMeta?.disabled,
        lastSignInTime: authMeta?.lastSignInTime || null,
        creationTime: authMeta?.creationTime || m.invitedAt?.toDate?.()?.toISOString() || null,
        leadCount
      });
    }

    return { success: true, companyId, members, count: members.length };
  }
);
