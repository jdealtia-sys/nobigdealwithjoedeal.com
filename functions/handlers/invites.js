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
const { CORS_ORIGINS, INVITE_ALLOWED_ROLES } = require('./_shared');
const { callableRateLimit } = require('../shared');

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

    // Same claim shape onRepSignup would have produced.
    await mergeCustomClaims(uid, { companyId, role, plan: 'growth' });

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
      <p style="text-align:center;margin:20px 0"><a href="${SITE_URL}/pro/register.html" style="display:inline-block;background:#e8720c;color:#fff;padding:13px 30px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px">Create your account</a></p>
      <p style="margin:0;color:#6b7280;font-size:13px">Didn't expect this? You can ignore this email — nothing happens without you signing up.</p>
    </div>
  </div>
</body></html>`;
}

function inviteEmailText(companyName, roleLabel) {
  const co = companyName || 'your team';
  return `${co} added you to their team on NBD PRO as ${roleLabel}.\n\nThree steps and you're in:\n1. Create your account at ${SITE_URL}/pro/register.html using this email address (or sign in if you already have one).\n2. Verify your email — click the link in the verification message.\n3. Open your dashboard. You'll be joined to the team automatically.\n\nDidn't expect this? You can ignore this email — nothing happens without you signing up.`;
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
      await snap.ref.update({ inviteEmailSentAt: FieldValue.serverTimestamp() }).catch(() => {});
      logger.info('teamInviteEmail: sent', { companyId });
    } catch (e) {
      logger.error('teamInviteEmail: send failed', { companyId, err: e.message });
    }
  }
);

exports._test = { resolveInviteRole, inviteEmailHtml, inviteEmailText };
