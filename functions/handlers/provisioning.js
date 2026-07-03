/**
 * NBD PRO — self-serve tenant provisioning (PILLAR1 Phase 2)
 * ═══════════════════════════════════════════════════════════════
 * createCompany: a freshly-signed-up owner turns their account into a real
 * tenant — `companies/{uid}` + a minimal `companyProfile/{uid}` seed + the
 * `companyId`/`role:company_admin` custom claims (the rules' + requireTeamAdmin's canonical top company role — 'owner' is not in the role vocabulary) — without Jo hand-seeding Firestore
 * (previously the ONLY way; see NBD-PRO-PRODUCT-AUDIT-2026-07.md gap #1 and
 * PILLAR1-PROVISIONING-PLAN.md Phase 2).
 *
 * Conventions honored:
 *  - companyId == uid (the existing solo-operator convention, formalized —
 *    every resolver, rules block, and lead-router already understands it, and
 *    it makes companies/{id} exist so submitPublicLead's tenant validation
 *    and lead-bridge routing work for the new tenant).
 *  - The companyProfile seed is NEUTRAL (tenant's own name + their auth
 *    email as alert contact). Deliberately NOT NBD's brand defaults — the
 *    Pillar-2 "NBD bleed" review (M1) is why: a half-configured tenant must
 *    never inherit Joe's phone/logo/seal. Unset fields fall through to the
 *    same neutral behavior the resolver already implements.
 *  - Claims via merge (setCustomUserClaims REPLACES the set — same trap the
 *    Stripe webhook guards against with its own mergeCustomClaims).
 *
 * Idempotent: calling again returns the existing tenant. A user who already
 * belongs to SOMEONE ELSE'S company (invited rep) is refused — reps don't
 * spawn their own tenants by accident.
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { CORS_ORIGINS } = require('./_shared');
const { callableRateLimit } = require('../shared');

// Mirror of functions/stripe.js mergeCustomClaims — setCustomUserClaims
// replaces the whole claim set, so read-merge-write to avoid wiping the
// billing claims the Stripe webhook maintains.
async function mergeCustomClaims(uid, patch) {
  let existing = {};
  try {
    existing = (await getAuth().getUser(uid)).customClaims || {};
  } catch (e) {
    logger.error('createCompany_getUser_failed', { uid, err: e.message });
    throw new HttpsError('internal', 'Could not read account');
  }
  await getAuth().setCustomUserClaims(uid, { ...existing, ...patch });
}

// Exported for unit tests.
function validateCompanyInput(data) {
  const name = String((data && data.name) || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) {
    return { error: 'Company name must be 2-80 characters.' };
  }
  const phoneDigits = String((data && data.phone) || '').replace(/[^\d]/g, '');
  const phone = phoneDigits.length === 10 ? phoneDigits
    : (phoneDigits.length === 11 && phoneDigits[0] === '1') ? phoneDigits.slice(1) : '';
  const serviceArea = String((data && data.serviceArea) || '').trim().slice(0, 120);
  return { name, phone, serviceArea };
}

exports.createCompany = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Not authenticated');
    await callableRateLimit(request, 'createCompany', 5, 3_600_000);

    // Invited reps belong to their inviter's tenant — refuse a second one.
    const claimCompany = request.auth.token.companyId;
    if (claimCompany && claimCompany !== uid) {
      throw new HttpsError('failed-precondition',
        'This account already belongs to a company.');
    }

    const db = getFirestore();
    const companyRef = db.doc(`companies/${uid}`);

    // Idempotent re-call: tenant already provisioned.
    const existing = await companyRef.get();
    if (existing.exists) {
      if ((existing.data() || {}).ownerId !== uid) {
        // companies/{uid} owned by someone else shouldn't be possible under
        // the uid convention — refuse loudly rather than adopt it.
        throw new HttpsError('failed-precondition', 'Company id conflict.');
      }
      if (!claimCompany) await mergeCustomClaims(uid, { companyId: uid, role: 'company_admin' });
      return { created: false, companyId: uid };
    }

    const v = validateCompanyInput(request.data);
    if (v.error) throw new HttpsError('invalid-argument', v.error);

    const email = String(request.auth.token.email || '').toLowerCase();
    const now = FieldValue.serverTimestamp();

    const batch = db.batch();
    batch.set(companyRef, {
      name: v.name,
      ownerId: uid,
      status: 'active',
      plan: 'free',
      source: 'self-serve',
      createdAt: now,
    });
    batch.set(db.doc(`companyProfile/${uid}`), {
      brand: {
        legalName: v.name,
        contact: {
          ...(email ? { alertEmail: email } : {}),
          ...(v.phone ? { alertSms: '+1' + v.phone } : {}),
        },
        ...(v.serviceArea ? { serviceArea: v.serviceArea } : {}),
      },
      provisionedBy: 'createCompany-v1',
      createdAt: now,
    });
    await batch.commit();

    await mergeCustomClaims(uid, { companyId: uid, role: 'company_admin' });

    logger.info('createCompany_provisioned', { uid, name: v.name });
    // Client must force-refresh the ID token to pick up the new claims.
    return { created: true, companyId: uid };
  }
);

exports._test = { validateCompanyInput };
