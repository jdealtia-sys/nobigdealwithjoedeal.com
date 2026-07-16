/**
 * NBD PRO — team invites, de-GCIP'd (PILLAR1 Phase 3)
 * ═══════════════════════════════════════════════════════════════
 * The original design stamped invited reps' claims in onRepSignup, a
 * beforeUserCreated BLOCKING trigger — which needs a GCIP upgrade and sits
 * permanently in NBD_DEPLOY_SKIP_LIST, so invites have never worked in
 * production: the team tab wrote companies/{owner}/members/{email} docs,
 * no email went out, and no claim was ever stamped. This module is the
 * plan's recommended alternative (Phase 0 option b): a non-blocking claim
 * on first dashboard load instead of a blocking trigger at signup.
 *
 *   claimInvite (onCall)      — signed-in user with a VERIFIED email and no
 *     foreign company claim looks up their pending invite and, if found,
 *     gets { companyId, role, plan } claims merged + the member doc
 *     activated. Called by dashboard-bootstrap on first load; idempotent.
 *
 *   teamInviteEmail (onDocumentCreated companies/{companyId}/members/{id})
 *     — the missing notification: emails the invitee signup instructions
 *     when the owner creates an invite. Platform-branded, reply-to owner.
 *
 * Security posture:
 *  - email_verified REQUIRED before a claim can be made. The blocking
 *    trigger matched the provider-supplied email at creation; without it,
 *    anyone could register an unverified account with someone else's email
 *    and inherit their invite. Google SSO is verified by construction;
 *    email/password users click the verification link register.js sends.
 *  - Role allowlist (INVITE_ALLOWED_ROLES) re-checked server-side — an
 *    invite doc carrying role 'admin' can never mint platform-admin claims.
 *  - Platform admins are refused outright: claiming an invite would
 *    OVERWRITE their role claim with a tenant role.
 *  - A rep who already belongs to ANOTHER company is refused (claims are
 *    not silently re-pointed). A self-serve solo owner (companyId == uid,
 *    the Phase-2 default for every new signup) MAY claim — their empty
 *    solo tenant is marked superseded, never deleted.
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { Resend } = require('resend');
const { CORS_ORIGINS, INVITE_ALLOWED_ROLES, isOwnerCaller, requireTeamAdmin } = require('./_shared');
const { callableRateLimit } = require('../shared');
// Seat caps live in billing.js PLAN_LIMITS (server source of truth for the
// plan table; mirrors docs/pro/js/billing-gate.js PLANS).
const { _test: { PLAN_LIMITS } } = require('../billing');

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const EMAIL_FROM = defineSecret('EMAIL_FROM');

// Mirror of stripe.js/provisioning.js mergeCustomClaims — setCustomUserClaims
// replaces the whole set, so read-merge-write to keep billing claims intact.
async function mergeCustomClaims(uid, patch) {
  let existing = {};
  try {
    existing = (await getAuth().getUser(uid)).customClaims || {};
  } catch (e) {
    logger.error('claimInvite_getUser_failed', { uid, err: e.message });
    throw new HttpsError('internal', 'Could not read account');
  }
  await getAuth().setCustomUserClaims(uid, { ...existing, ...patch });
}

// The role an invite actually grants. Exported for unit tests.
// Fail-down mirror of onRepSignup: anything outside the allowlist (incl.
// 'admin' and garbage) becomes the lowest-privilege field role.
function resolveInviteRole(requested) {
  return INVITE_ALLOWED_ROLES.has(requested) ? requested : 'sales_rep';
}

exports.claimInvite = onCall(
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
    await callableRateLimit(request, 'claimInvite', 10, 3_600_000);

    const token = request.auth.token || {};
    const email = String(token.email || '').toLowerCase().trim();
    if (!email) return { claimed: false, reason: 'no_email' };

    // Never let an invite doc rewrite a platform admin's claims.
    if (token.role === 'admin') return { claimed: false, reason: 'platform_admin' };

    // Already on someone else's team — claims are not re-pointed silently.
    if (token.companyId && token.companyId !== uid) {
      return { claimed: false, reason: 'already_member' };
    }

    const db = getFirestore();

    // Find the pending invite BEFORE the verified-email wall so an
    // unverified user with no invite gets the cheap terminal 'no_invite'
    // (the dashboard hook stops retrying) instead of an endless
    // email-unverified loop for the 99% with no invite at all.
    const inviteSnap = await db.collectionGroup('members')
      .where('email', '==', email)
      .where('status', '==', 'invited')
      .limit(1)
      .get();
    if (inviteSnap.empty) return { claimed: false, reason: 'no_invite' };

    // Invite exists — now the email-ownership wall.
    if (token.email_verified !== true) {
      throw new HttpsError('failed-precondition',
        'Verify your email address first — check your inbox for the verification link, then reload.');
    }

    const memberDoc = inviteSnap.docs[0];
    const memberData = memberDoc.data() || {};
    const companyId = memberDoc.ref.parent.parent.id;

    // Owner inviting themselves is a no-op tenant-wise; refuse to avoid a
    // self-invite overwriting company_admin with a lesser role.
    if (companyId === uid) return { claimed: false, reason: 'own_company' };

    const role = resolveInviteRole(typeof memberData.role === 'string' ? memberData.role : '');
    if (role !== memberData.role) {
      logger.warn('claimInvite: invite role outside allowlist', { companyId, requested: memberData.role });
    }

    const companySnap = await db.doc(`companies/${companyId}`).get();
    const companyName = (companySnap.exists && (companySnap.data() || {}).name) || '';

    // Only companyId + role. Deliberately NO `plan` claim: post-Pillar-4
    // billing resolves from subscriptions/{companyId}, so a rep inherits the
    // company plan from the doc automatically — and hardcoding plan:'growth'
    // here (the old onRepSignup shape) CLOBBERED a paid solo owner's real
    // plan claim on merge (the plan claim is telemetry-only now, but the
    // clobber still violated the merge-don't-replace invariant and mislabeled
    // Sentry). mergeCustomClaims preserves any existing plan/billing claims.
    await mergeCustomClaims(uid, { companyId, role });

    const batch = db.batch();
    batch.update(memberDoc.ref, {
      status: 'active',
      uid,
      activatedAt: FieldValue.serverTimestamp(),
      activatedVia: 'claimInvite-v1',
    });
    batch.set(db.doc(`users/${uid}`), {
      email,
      role,
      companyId,
      displayName: token.name || email.split('@')[0],
    }, { merge: true });
    // A Phase-2 self-serve solo tenant being absorbed into a team: keep the
    // doc (their solo-era data stays keyed to them) but mark it so nothing
    // routes new work to it.
    if (token.companyId === uid) {
      const soloRef = db.doc(`companies/${uid}`);
      const soloSnap = await soloRef.get();
      if (soloSnap.exists && (soloSnap.data() || {}).ownerId === uid) {
        batch.update(soloRef, {
          status: 'superseded-by-invite',
          supersededBy: companyId,
          supersededAt: FieldValue.serverTimestamp(),
        });
      }
    }
    await batch.commit();

    logger.info('claimInvite: activated', { uid, companyId, role });
    // Client must getIdToken(true) to pick up the new claims.
    return { claimed: true, companyId, role, companyName };
  }
);

// ───────────────────────────────────────────────────────────────
// teamInviteEmail — the notification the team tab always implied
// ("Invite sent") but never actually sent.
// ───────────────────────────────────────────────────────────────
const SITE_URL = 'https://nobigdealwithjoedeal.com';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function inviteEmailHtml(companyName, roleLabel) {
  const co = esc(companyName || 'your team');
  return `<!doctype html><html><body style="font-family:'Barlow','Segoe UI',Roboto,sans-serif;background:#f5f5f5;margin:0;color:#333">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
    <div style="background:linear-gradient(135deg,#1e3a6e,#142a52);color:#fff;padding:22px 20px;text-align:center">
      <div style="font-size:22px;font-weight:700">You're invited to join ${co}</div>
      <div style="font-size:13px;opacity:.85;margin-top:4px">on NBD PRO — the contractor platform</div>
    </div>
    <div style="padding:24px 22px;font-size:15px;line-height:1.65">
      <p style="margin:0 0 14px">${co} added you to their team as <strong>${esc(roleLabel)}</strong>. Three steps and you're in:</p>
      <ol style="margin:0 0 14px;padding-left:22px">
        <li style="margin-bottom:8px">Create your account at the link below <strong>using this email address</strong> (or sign in if you already have one).</li>
        <li style="margin-bottom:8px">Verify your email — click the link in the verification message.</li>
        <li>Open your dashboard. You'll be joined to the team automatically.</li>
      </ol>
      <p style="text-align:center;margin:20px 0"><a href="${SITE_URL}/pro/register.html?invite=1" style="display:inline-block;background:#e8720c;color:#fff;padding:13px 30px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px">Create your account</a></p>
      <p style="margin:0;color:#6b7280;font-size:13px">Didn't expect this? You can ignore this email — nothing happens without you signing up.</p>
    </div>
  </div>
</body></html>`;
}

function inviteEmailText(companyName, roleLabel) {
  const co = companyName || 'your team';
  return `${co} added you to their team on NBD PRO as ${roleLabel}.\n\nThree steps and you're in:\n1. Create your account at ${SITE_URL}/pro/register.html?invite=1 using this email address (or sign in if you already have one).\n2. Verify your email — click the link in the verification message.\n3. Open your dashboard. You'll be joined to the team automatically.\n\nDidn't expect this? You can ignore this email — nothing happens without you signing up.`;
}

exports.teamInviteEmail = onDocumentCreated(
  {
    region: 'us-central1',
    document: 'companies/{companyId}/members/{memberId}',
    secrets: [RESEND_API_KEY, EMAIL_FROM],
    maxInstances: 10,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const d = snap.data() || {};
    if (d.status !== 'invited') return; // seeds/migrations/active writes: not ours
    const to = String(d.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      logger.warn('teamInviteEmail: bad invite email, skipping', { companyId: event.params.companyId });
      return;
    }

    const db = getFirestore();
    const companyId = event.params.companyId;
    let companyName = '';
    let replyTo;
    try {
      const coSnap = await db.doc(`companies/${companyId}`).get();
      if (coSnap.exists) companyName = (coSnap.data() || {}).name || '';
      // Reply-to the inviting owner so responses go to a human.
      const inviterUid = d.invitedBy || companyId;
      const inviter = await getAuth().getUser(String(inviterUid)).catch(() => null);
      if (inviter && inviter.email) replyTo = inviter.email;
    } catch (_) { /* cosmetic lookups — never block the send */ }

    const roleLabel = String(d.role || 'sales rep').replace(/_/g, ' ');
    let emailStatus;
    try {
      const resend = new Resend(RESEND_API_KEY.value());
      const from = EMAIL_FROM.value() || 'noreply@nobigdealwithjoedeal.com';
      await resend.emails.send({
        from,
        to,
        reply_to: replyTo,
        subject: `${companyName || 'A team'} invited you to NBD PRO`,
        html: inviteEmailHtml(companyName, roleLabel),
        text: inviteEmailText(companyName, roleLabel),
        headers: { 'X-NBD-Campaign': 'team-invite-v1' },
      });
      emailStatus = 'sent';
      await snap.ref.update({ inviteEmailSentAt: FieldValue.serverTimestamp() }).catch(() => {});
      logger.info('teamInviteEmail: sent', { companyId });
    } catch (e) {
      emailStatus = 'failed:' + String(e && e.message || e).slice(0, 200);
      logger.error('teamInviteEmail: send failed', { companyId, err: e.message });
    }
    // Ledger the attempt in alert_outbox (same seam as lead-alert.js
    // recordAlertOutbox): the dashboard's alert-health banner surfaces
    // 'failed:*' statuses to the owner — without this, a dead Resend key
    // means invites silently never arrive and nobody finds out. Best-effort:
    // an outbox write failure never blocks anything.
    try {
      await db.collection('alert_outbox').add({
        kind: 'team-invite',
        collection: `companies/${companyId}/members`,
        leadId: null,
        companyId,
        target: { emails: [to], sms: null, name: companyName, seal: '' },
        emailStatus,
        smsStatus: 'skipped:n/a',
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      logger.warn('teamInviteEmail: outbox write failed', { companyId, err: e && e.message });
    }
  }
);

// ───────────────────────────────────────────────────────────────
// createTeamInvite — Pillar 4: invites move server-side so plan
// seat limits are enforceable. firestore.rules now denies client
// member CREATEs; the team tab calls this instead. The write shape
// matches the old client write exactly, so teamInviteEmail and
// claimInvite behave identically.
//
// Seat policy: (invited + active) member docs < PLAN_LIMITS[plan].reps.
// free/starter (reps:1) → no team invites; growth (reps:5) → up to 5
// reps besides the owner (the generous reading of the landing copy
// "Growth allows up to 5 team reps"); enterprise → unlimited.
// ───────────────────────────────────────────────────────────────

// How many INVITED-REP seats a plan grants (besides the owner). reps:1 in
// the plan table means "solo — 1 user total" → 0 invite seats; reps:5
// means "up to 5 team reps" → 5 seats. Exported for unit tests.
function seatLimitForPlan(plan) {
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
  if (limits.reps === Infinity) return Infinity;
  return limits.reps <= 1 ? 0 : limits.reps;
}

exports.createTeamInvite = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request) => {
    await callableRateLimit(request, 'createTeamInvite', 30, 3_600_000);
    // Owner (incl. solo companyId==uid convention) or platform admin only —
    // same gate the admin team-management callables use.
    const { uid, companyId, isGlobalAdmin } = await requireTeamAdmin(request);

    const email = String((request.data && request.data.email) || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpsError('invalid-argument', 'Enter a valid email address.');
    }
    const callerEmail = String(request.auth.token.email || '').toLowerCase();
    if (email === callerEmail) {
      throw new HttpsError('invalid-argument', "That's your own email — you already own this company.");
    }
    const role = String((request.data && request.data.role) || 'sales_rep');
    if (!INVITE_ALLOWED_ROLES.has(role)) {
      throw new HttpsError('invalid-argument', 'Role must be one of: company_admin, manager, sales_rep, viewer.');
    }

    const db = getFirestore();

    const coRef = db.doc(`companies/${companyId}`);
    const coSnap = await coRef.get();

    // Resolve the company's plan: subscription doc first (webhook-written
    // truth), company doc plan as fallback. Joe's owner accounts and
    // platform admins are never seat-gated.
    let plan = 'free';
    // Owner seat-cap bypass: claims-based (token.owner === true) with the
    // deprecated email fallback inside isOwnerCaller (remove fallback after
    // owner claims confirmed in prod).
    if (isGlobalAdmin || isOwnerCaller(request.auth.token)) {
      plan = 'enterprise';
    } else {
      const subSnap = await db.doc(`subscriptions/${companyId}`).get();
      const subData = subSnap.exists ? (subSnap.data() || {}) : {};
      // 'past_due' stays entitled for seat resolution: Stripe is still
      // auto-retrying the card (dunning), the subscription is not cancelled,
      // and without this a paying owner mid-dunning got seats=0 plus the
      // free-tier "your current plan is solo" copy — reads like data loss to
      // a customer whose card merely bounced (gauntlet gap). Hard removal
      // only happens on customer.subscription.deleted.
      const subActive = subData.status === 'active' || subData.status === 'trialing'
        || subData.status === 'past_due';
      if (subActive && subData.plan) {
        plan = subData.plan;
      } else {
        plan = (coSnap.exists && (coSnap.data() || {}).plan) || 'free';
      }
    }

    const seats = seatLimitForPlan(plan);
    const membersSnap = await db.collection(`companies/${companyId}/members`).get();
    const occupied = membersSnap.docs.filter((m) => {
      const st = (m.data() || {}).status;
      return st === 'invited' || st === 'active';
    });
    const existing = membersSnap.docs.find((m) => m.id === email);
    const existingStatus = existing ? (existing.data() || {}).status : null;

    if (existingStatus === 'active') {
      return { invited: false, reason: 'already_member', seatsUsed: occupied.length, seatsLimit: seats === Infinity ? null : seats };
    }
    // CL6: a DEACTIVATED member's Auth account is disabled — re-inviting them
    // would write a fresh 'invited' row they can never claim (they can't sign
    // in), leaving a permanently-stuck invite consuming a seat. Send the owner
    // to the Re-enable action in that member's row instead.
    if (existingStatus === 'deactivated') {
      throw new HttpsError('failed-precondition',
        'That person is on your team but disabled. Use "Re-enable" in their row to restore access — no new invite needed.');
    }
    // Re-inviting a pending member re-uses their seat; only a NEW seat is gated.
    const takingNewSeat = !existing || (existingStatus !== 'invited' && existingStatus !== 'active');
    const seatsAfter = occupied.length + (existingStatus === 'invited' ? 0 : (takingNewSeat ? 1 : 0));
    if (seats !== Infinity && seatsAfter > seats) {
      throw new HttpsError('resource-exhausted',
        seats === 0
          ? 'Team invites need the Growth plan — your current plan is solo. Upgrade at /pro/landing.html#pricing.'
          : `Your plan includes ${seats} team seat${seats === 1 ? '' : 's'} and they're all taken. Remove a member or upgrade to add more.`);
    }

    // Solo owners may not have a companies/{uid} doc yet (pre-Phase-2
    // accounts) — create it so rules' ownerId checks and member listing
    // work. Never touch an EXISTING doc (the old client write clobbered
    // `name` with the rep's displayName on every invite).
    if (!coSnap.exists && companyId === uid) {
      await coRef.set({
        ownerId: uid,
        name: request.auth.token.name || 'My Company',
        status: 'active',
        plan: 'free',
        source: 'invite-ensure',
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // Re-invite of a pending invite: delete + recreate so the
    // teamInviteEmail onDocumentCreated trigger fires again (resend).
    // CL5: the delete is now transaction-guarded so a claimInvite that flipped
    // this exact doc to 'active' in the window since our seat read can't be
    // silently clobbered back to 'invited' (which would DEMOTE a just-joined
    // teammate and re-consume their seat). Re-read inside the txn; abort if it
    // raced to active/deactivated. The recreate stays a separate set() so the
    // onDocumentCreated resend trigger fires.
    const memberRef = db.doc(`companies/${companyId}/members/${email}`);
    if (existing) {
      await db.runTransaction(async (tx) => {
        const cur = await tx.get(memberRef);
        const st = cur.exists ? (cur.data() || {}).status : null;
        if (st === 'active') {
          throw new HttpsError('failed-precondition', 'That person just joined your team — no invite needed.');
        }
        if (st === 'deactivated') {
          throw new HttpsError('failed-precondition',
            'That person is on your team but disabled. Use "Re-enable" in their row to restore access.');
        }
        tx.delete(memberRef);
      });
    }
    await memberRef.set({
      email,
      role,
      status: 'invited',
      invitedAt: FieldValue.serverTimestamp(),
      invitedBy: uid,
    });

    logger.info('createTeamInvite: invited', { companyId, role, plan, seatsAfter });
    return {
      invited: true,
      resent: existingStatus === 'invited',
      seatsUsed: seatsAfter,
      seatsLimit: seats === Infinity ? null : seats,
    };
  }
);

exports._test = { resolveInviteRole, inviteEmailHtml, inviteEmailText, seatLimitForPlan };
