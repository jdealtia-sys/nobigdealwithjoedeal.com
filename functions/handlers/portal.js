/**
 * functions/handlers/portal.js — inline-portal callables that lived
 * directly in index.js (NOT the sibling functions/portal.js — that one
 * owns createPortalToken / revokePortalToken / getHomeownerPortalView
 * and is left untouched).
 *
 * Step 4c extraction. Moved verbatim from functions/index.js:
 *   - validateAccessCode (onCall, redeems an access code → custom token)
 *
 * No behavioral changes; pure structural move.
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { Timestamp, getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue } = require('firebase-admin/firestore');

const { enforceRateLimit, clientIp } = require('../integrations/upstash-ratelimit');

// ═══════════════════════════════════════════════════════════════════
// validateAccessCode — hardened.
//
// Security notes:
// - Codes live in Firestore (`access_codes/{CODE}`) and are writable only
//   via admin SDK. Clients cannot enumerate or read this collection.
// - Never returns a password. Instead mints a Firebase custom token that
//   the client exchanges via `signInWithCustomToken`.
// - The `admin` role is NEVER granted via access code. Admin access is
//   provisioned by a Joe-only CLI script that calls setCustomUserClaims.
// - Per-IP rate limit (5 requests / 5 minutes). Failed attempts logged.
// - Requires App Check so random curl/script callers are blocked.
// ═══════════════════════════════════════════════════════════════════
exports.validateAccessCode = onCall(
  {
    enforceAppCheck: true,
    maxInstances: 5,
    concurrency: 10,
    timeoutSeconds: 15,
    memory: '256MiB',
  },
  async (request) => {
    const ip = clientIp(request.rawRequest || {});

    // Per-IP rate limit — tight. 5 attempts / 5 minutes.
    try {
      await enforceRateLimit('validateAccessCode:ip', ip, 5, 5 * 60_000);
    } catch (e) {
      if (e.rateLimited) {
        throw new HttpsError('resource-exhausted', 'Too many attempts. Try again in a few minutes.');
      }
      throw e;
    }

    const rawCode = (request.data && request.data.code) || '';
    if (typeof rawCode !== 'string' || rawCode.length < 3 || rawCode.length > 40) {
      throw new HttpsError('invalid-argument', 'Code not recognized');
    }
    const normalized = rawCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!normalized) {
      throw new HttpsError('invalid-argument', 'Code not recognized');
    }

    const db = getFirestore();
    const codeRef = db.collection('access_codes').doc(normalized);
    // Validate + reserve a use ATOMICALLY. The previous flow checked
    // useCount and incremented it several async hops apart, so two
    // concurrent redemptions of a one-time code could both pass the cap
    // (TOCTOU — flagged in the 2026-07 access-code audit). The transaction
    // serializes check + increment; if the side effects below fail, the
    // catch releases the reservation.
    const code = await db.runTransaction(async (tx) => {
      const codeSnap = await tx.get(codeRef);
      if (!codeSnap.exists) {
        logger.warn('access_code_invalid', { ip, normalized });
        throw new HttpsError('not-found', 'Code not recognized');
      }
      const c = codeSnap.data();
      if (c.active !== true) {
        logger.warn('access_code_inactive', { ip, normalized });
        throw new HttpsError('permission-denied', 'Code not recognized');
      }
      if (c.expiresAt && c.expiresAt.toMillis && c.expiresAt.toMillis() < Date.now()) {
        throw new HttpsError('permission-denied', 'Code expired');
      }
      if (typeof c.maxUses === 'number' && typeof c.useCount === 'number' && c.useCount >= c.maxUses) {
        throw new HttpsError('resource-exhausted', 'Code fully redeemed');
      }
      tx.update(codeRef, {
        useCount: FieldValue.increment(1),
        lastUsedAt: FieldValue.serverTimestamp(),
      });
      return c;
    });
    // Hard rule: access codes NEVER grant admin.
    const role = code.role === 'manager' ? 'manager' : 'member';
    const email = typeof code.email === 'string' && code.email.includes('@') ? code.email : null;
    if (!email) {
      logger.error('access_code_missing_email', { normalized });
      throw new HttpsError('failed-precondition', 'Code misconfigured. Contact support.');
    }

    try {
      // Look up or create the user — but do not overwrite passwords.
      let userRecord;
      try {
        userRecord = await getAuth().getUserByEmail(email);
      } catch (e) {
        if (e.code === 'auth/user-not-found') {
          userRecord = await getAuth().createUser({
            email,
            emailVerified: false,
            displayName: code.displayName || 'NBD Member',
          });
        } else {
          throw e;
        }
      }

      // Set role claim (never admin).
      await getAuth().setCustomUserClaims(userRecord.uid, { role });

      // Create subscription doc via admin SDK. Trust only the fields from the
      // Firestore-stored access code record.
      const planFromCode = code.plan === 'professional' ? 'professional' : 'foundation';
      const subData = {
        plan: planFromCode,
        status: 'active',
        source: 'access_code',
        accessCode: normalized,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (typeof code.trialDays === 'number' && code.trialDays > 0) {
        const trialEnd = new Date(Date.now() + code.trialDays * 86_400_000);
        subData.trialEndsAt = Timestamp.fromDate(trialEnd);
      }
      const subRef = db.doc(`subscriptions/${userRecord.uid}`);
      if (!(await subRef.get()).exists) {
        subData.createdAt = FieldValue.serverTimestamp();
      }
      await subRef.set(subData, { merge: true });

      // Create user profile doc if missing. Role is set via claim, not via the
      // users/<uid>.role field (which clients can write).
      const userDocRef = db.doc(`users/${userRecord.uid}`);
      const userDocSnap = await userDocRef.get();
      if (!userDocSnap.exists) {
        await userDocRef.set({
          email,
          displayName: userRecord.displayName || 'NBD Member',
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      // (useCount already reserved atomically in the transaction above.)

      // Mint a short-lived custom token. Client exchanges via signInWithCustomToken.
      const customToken = await getAuth().createCustomToken(userRecord.uid, { role });
      logger.info('access_code_redeemed', { normalized, uid: userRecord.uid, role });
      return { success: true, customToken, role };
    } catch (e) {
      if (e instanceof HttpsError) throw e;
      // The use was reserved up front — release it so a transient failure
      // (e.g. token mint) doesn't burn a one-time code. Best-effort only.
      try {
        await codeRef.update({ useCount: FieldValue.increment(-1) });
      } catch (_) { /* release is advisory; the audit trail has lastUsedAt */ }
      logger.error('validateAccessCode error', { normalized, err: e.message });
      throw new HttpsError('internal', 'Authentication error. Please try again.');
    }
  }
);
