/**
 * functions/referral-rewards.js — referral-CODE redemption + $200 bonus.
 * ═══════════════════════════════════════════════════════════════
 *
 * The redemption/crediting half of the "share your code" lane. A past
 * customer is texted a personal referral code (JOHN-AB12) by
 * review-engine.js `sendReferralSMS`, promising them a $200 bonus "when
 * their project closes." This trigger is what makes that promise real.
 *
 * A referred lead is stamped with `redeemReferralCode` at intake — either
 * by the rep in the Add/Edit Lead modal (docs/pro/js/crm-leads.js) or by a
 * friend on the public intake form (functions/handlers/integrations.js
 * `submitPublicLead` → lead-bridge). This single `leads/{leadId}` onWrite
 * trigger then does everything server-side (no client is trusted in the
 * money path):
 *
 *   Phase A — ATTRIBUTE: resolve the code against the `referrals` collection
 *     (minted by review-engine.js `assignReferralCode`), validate it belongs
 *     to the same rep/tenant and isn't a self-referral, and link the referred
 *     lead back to the referrer (referrerLeadId + referralRewardStatus:
 *     'pending'). Idempotent via the `referralAttributedAt` latch.
 *
 *   Phase B — CREDIT: when the referred lead's project reaches a CLOSED stage
 *     (Jo's chosen payout moment), record the $200 as OWED on the referrer's
 *     referrals doc and notify the rep to pay it. Idempotent via the
 *     referralRewardStatus pending→owed flip. There is no automated payment
 *     rail to a customer — the bonus is TRACKED + the rep is notified; they
 *     pay it manually and mark it settled.
 *
 * Distinct from the working customerId LINK lane (functions/referrals.js
 * `submitReferral`), which stamps `referredByLeadId` and deliberately makes
 * NO payout promise. Only code-lane leads (they carry `referralRewardStatus`)
 * are credited here.
 *
 * NOTE the export below is a LITERAL `exports.x = onDocumentWritten(...)`
 * call — the CI auto-deploy allowlist greps that exact shape
 * (.github/workflows/firebase-deploy.yml). A wrapper RHS would be silently
 * dropped from the deploy (same gap documented in lead-bridge.js).
 */

'use strict';

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions/v2');
// Modular FieldValue/getFirestore — FieldValue is undefined under the
// namespaced admin import in the emulator runtime; the modular path works in
// both prod and emulator (see lead-bridge.js / emulator-QA notes).
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

// The bonus a referrer earns when a lead they referred via their personal
// code reaches a closed project. Single source of truth so this payout and
// the SMS copy (docs/pro/js/review-engine.js) stay in sync. FUTURE: read
// per-tenant from companyProfile so each SaaS tenant sets their own amount;
// hardcoded to NBD's $200 for now.
const REFERRAL_BONUS_USD = 200;

// Stages that count as "the project closed" — Jo's payout trigger. Matches
// crm-stages.js S.CLOSED ('closed', the 🏆 final job stage) plus the legacy
// display names that normalize to it. Compared after lower-casing +
// space→underscore so 'Closed', 'Closed Won' and 'Complete' all match.
const CLOSED_STAGES = new Set(['closed', 'closed_won', 'closed-won', 'complete']);

function normStage(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, '_');
}
function isClosed(stage) {
  return CLOSED_STAGES.has(normStage(stage));
}
function fullName(lead) {
  return `${(lead && lead.firstName) || ''} ${(lead && lead.lastName) || ''}`.trim();
}

async function handleReferralLeadWrite(event) {
  const afterSnap = event.data && event.data.after;
  const after = afterSnap && afterSnap.exists ? afterSnap.data() : null;
  if (!after) return; // lead deleted — nothing to do
  const before = event.data && event.data.before && event.data.before.exists
    ? event.data.before.data() : null;
  const leadId = event.params && event.params.leadId;
  const db = getFirestore();

  // ─── Phase A: attribute a freshly-entered referral code ─────────
  // The referred lead carries `redeemReferralCode` (rep- or public-stamped).
  // `referralAttributedAt` is the idempotency latch — set on BOTH the success
  // and the invalid path so a bad code is resolved once, never retried.
  if (after.redeemReferralCode && !after.referralAttributedAt) {
    const code = String(after.redeemReferralCode).toUpperCase().trim();

    // Mark the code processed-but-not-credited (unknown / foreign / self /
    // empty). We still set the latch so the trigger stops re-evaluating it.
    const markInvalid = async (reason) => {
      logger.info('[referral] code not attributed', { leadId, code, reason });
      try {
        await afterSnap.ref.set({
          referralAttributedAt: FieldValue.serverTimestamp(),
          referralCodeInvalid: true,
        }, { merge: true });
      } catch (e) {
        logger.error('[referral] invalid-latch write failed', { leadId, err: e && e.message });
      }
    };

    if (!code) { await markInvalid('empty-code'); return; }

    let snap;
    try {
      snap = await db.collection('referrals').where('code', '==', code).limit(1).get();
    } catch (e) {
      // Transient lookup error — do NOT set the latch, let a later write retry.
      logger.error('[referral] code lookup failed', { leadId, code, err: e && e.message });
      return;
    }
    if (snap.empty) { await markInvalid('unknown-code'); return; }

    const refDoc = snap.docs[0];
    const referral = refDoc.data() || {};

    // Guard 1: the code must belong to the SAME rep/tenant that owns this
    // lead — otherwise a rep could self-credit by typing a rival tenant's
    // code, or a public submitter could redeem a code not on this book.
    // (referral.userId is the minting rep; legacy docs without it fall through
    // as same-tenant, matching the pre-existing owner-scoped assumption.)
    if (referral.userId && after.userId && referral.userId !== after.userId) {
      await markInvalid('foreign-tenant-code'); return;
    }
    // Guard 2: no self-referral — the referrer's own lead can't redeem their
    // own code.
    if (referral.referrerLeadId && referral.referrerLeadId === leadId) {
      await markInvalid('self-referral'); return;
    }

    // Resolve the referrer's display name for the notification + rep-side badge.
    let referrerName = '';
    if (referral.referrerLeadId) {
      try {
        const rl = await db.doc(`leads/${referral.referrerLeadId}`).get();
        if (rl.exists) referrerName = fullName(rl.data());
      } catch (_) { /* best-effort — name is cosmetic */ }
    }

    try {
      // Stamp attribution on the referred lead. referralRewardStatus:'pending'
      // arms Phase B for when this lead's project closes.
      await afterSnap.ref.set({
        referredBy: code,
        referrerLeadId: referral.referrerLeadId || null,
        referralDocId: refDoc.id,
        referredByName: referrerName || null,
        referralRewardStatus: 'pending',
        referralAttributedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      // Link the referred lead into the referrer's code record (mirrors the
      // old client trackReferral this replaces).
      await refDoc.ref.set({
        referredLeads: FieldValue.arrayUnion(leadId),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      // Attribution write failed — leave the latch unset so a retry can
      // re-attempt rather than silently losing the referral.
      logger.error('[referral] attribution write failed', { leadId, code, err: e && e.message });
      return;
    }

    // Notify the rep the referral was tracked (mirrors submitReferral's shape).
    try {
      await db.collection('notifications').add({
        userId: referral.userId || after.userId || null,
        type: 'referral',
        leadId,
        title: '🎁 Referral tracked',
        message: `${fullName(after) || 'A new lead'} was referred${referrerName ? ' by ' + referrerName : ''} (code ${code}). $${REFERRAL_BONUS_USD} bonus is owed when their project closes.`,
        read: false,
        dismissed: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      logger.warn('[referral] tracked-notification failed', { leadId, err: e && e.message });
    }

    // The attribution set() above re-fires this trigger; Phase B is evaluated
    // on that next pass (and every subsequent lead write) until close.
    return;
  }

  // ─── Phase B: credit the bonus when the referred project closes ─
  // Runs at most once per lead: referralRewardStatus flips pending→owed, so
  // the re-trigger from our own write no longer matches. The status latch —
  // not a stage-transition check — is the idempotency guard, so a code
  // entered on an already-closed lead still credits exactly once.
  if (after.referralRewardStatus === 'pending' && isClosed(after.stage)) {
    const amount = REFERRAL_BONUS_USD;
    try {
      await afterSnap.ref.set({
        referralRewardStatus: 'owed',
        referralRewardAmount: amount,
        referralRewardOwedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      logger.error('[referral] reward-status write failed', { leadId, err: e && e.message });
      return; // status still 'pending' — a later write retries
    }

    // Record the owed reward on the referrer's code record. serverTimestamp()
    // is NOT allowed inside arrayUnion(), so the array element carries a
    // concrete Date (admin SDK stores it as a Timestamp).
    if (after.referralDocId) {
      try {
        await db.doc(`referrals/${after.referralDocId}`).set({
          rewards: FieldValue.arrayUnion({
            referredLeadId: leadId,
            amount,
            status: 'owed',
            owedAt: new Date(),
          }),
          rewardsOwedTotal: FieldValue.increment(amount),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (e) {
        logger.warn('[referral] referral-doc reward update failed', { leadId, err: e && e.message });
      }
    }

    // Notify the rep the bonus is now owed. Recipient is the lead owner, which
    // Phase A validated equals the code's minting rep.
    try {
      await db.collection('notifications').add({
        userId: after.userId || null,
        type: 'referral_reward',
        leadId,
        title: '🎁 Referral bonus owed',
        message: `$${amount} referral bonus owed to ${after.referredByName || 'your referrer'} — ${fullName(after) || 'a referred lead'}'s project closed. Mark paid once you've sent it.`,
        read: false,
        dismissed: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      logger.warn('[referral] reward-notification failed', { leadId, err: e && e.message });
    }
  }
}

exports.onReferralLeadWrite = onDocumentWritten(
  {
    region: 'us-central1',
    document: 'leads/{leadId}',
    memory: '256MiB',
    timeoutSeconds: 60,
    maxInstances: 20,
  },
  handleReferralLeadWrite
);
