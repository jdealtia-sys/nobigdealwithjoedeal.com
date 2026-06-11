/**
 * NBD — "Email My Estimate" sender  (estimator funnel)
 * ═══════════════════════════════════════════════════════════════
 *
 * The /estimate instant-estimator's "Email My Estimate" button submits a
 * public lead with type === 'email_estimate_request' plus the homeowner's
 * email and a preformatted plain-text estimateSummary. submitPublicLead
 * writes it into estimate_leads — and, until now, nothing ever sent the
 * email. This trigger closes that loop.
 *
 * Functions:
 *   - estimateEmail (onDocumentCreated estimate_leads/{id}) — emails the
 *     homeowner their estimate summary + free-inspection CTA via Resend
 *
 * Design notes:
 *   - Additive. Does NOT touch submitPublicLead / lead-alert / lead-bridge.
 *     The lead is captured + the office notified by the normal path
 *     regardless; this only adds the homeowner's emailed copy.
 *   - No new public endpoint → no "email anything to anyone" abuse vector.
 *     It can only fire on a lead the gated, rate-limited capture already
 *     created, and only emails the address on that lead (gateway-capped:
 *     email ≤200, estimateSummary ≤2000).
 *   - NBD-only: a lead tagged with a non-NBD tenant companyId is skipped —
 *     this email is signed by Joe and books Joe's calendar.
 *   - Idempotent: Firestore triggers are at-least-once. We transactionally
 *     claim the doc (set estimateEmailedAt) before sending, so a redelivered
 *     event is a no-op rather than a duplicate email.
 *   - Reuses the existing Resend provider + secrets (RESEND_API_KEY, EMAIL_FROM).
 *
 * Safety:
 *   GATED by the ESTIMATE_EMAIL_ENABLED env var, same pattern as
 *   funnel-recovery.js. When unset OR not === "true", the trigger runs in
 *   DRY-RUN mode — it logs the email it *would* have sent but does not
 *   actually send (and does not claim the doc). Enable production sending
 *   via gcloud:
 *     gcloud run services update estimateemail \
 *       --region=us-central1 \
 *       --update-env-vars=ESTIMATE_EMAIL_ENABLED=true
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { Resend } = require('resend');

// ───────────────────────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────────────────────

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const EMAIL_FROM = defineSecret('EMAIL_FROM');

const REPLY_TO = 'jd@nobigdealwithjoedeal.com';
const BOOKING_URL = 'https://cal.com/nobigdeal/roof-inspection';
const PHONE_DISPLAY = '(859) 420-7382';

// Tenant-zero (NBD) owner uid — solo convention: companyId == owner uid.
// Matches lead-bridge.js. NBD's own forms pass no companyId at all; a lead
// tagged with any OTHER tenant's companyId must not get Joe's email.
const NBD_OWNER_UID = process.env.NBD_OWNER_UID || '1phDvAVXHSg82wDLegAbQFq14Ci1';

// ───────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

function sanitizeString(value, maxLen = 200) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildEstimateEmailHtml({ firstName, estimateSummary }) {
  const greeting = firstName ? `Hey ${escapeHtml(firstName)},` : 'Hey,';
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Your roof estimate from No Big Deal</title></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f5f3ef;color:#1a1a1a;line-height:1.6;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="background:#142a52;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0;text-align:center;">
      <div style="font-size:18px;font-weight:800;letter-spacing:.06em;">NO BIG DEAL</div>
      <div style="font-size:11px;color:rgba(255,255,255,.7);letter-spacing:.08em;text-transform:uppercase;margin-top:4px;">Home Solutions</div>
    </div>
    <div style="background:#fff;padding:32px 28px;border-radius:0 0 10px 10px;border:1px solid #e8e5e0;border-top:none;">
      <p style="font-size:16px;margin:0 0 16px;">${greeting}</p>
      <p style="font-size:16px;margin:0 0 16px;">Joe here. Thanks for running the numbers on my site — here's your estimate, just like you asked:</p>
      <div style="background:#f5f3ef;border-left:4px solid #142a52;border-radius:6px;padding:16px 18px;margin:18px 0;font-family:'Courier New',Courier,monospace;font-size:14px;white-space:pre-line;">${escapeHtml(estimateSummary)}</div>
      <p style="font-size:16px;margin:0 0 16px;">The next step is simple, and it's free: I'll come out, walk the roof myself, and confirm exactly what you need (and what you don't).</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${BOOKING_URL}" style="display:inline-block;background:#e8720c;color:#fff;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px;text-decoration:none;letter-spacing:.02em;">Book my free inspection →</a>
      </div>
      <p style="font-size:15px;margin:0 0 16px;">Or if it's easier, just call or text me directly — I answer my own phone:</p>
      <p style="font-size:15px;margin:0 0 16px;"><strong>📞 ${PHONE_DISPLAY}</strong></p>
      <p style="font-size:13px;color:#6b7280;margin:0 0 16px;">This is a ballpark — final pricing is confirmed after Joe walks the roof.</p>
      <p style="font-size:15px;margin:0 0 8px;">Either way, no big deal.</p>
      <p style="font-size:15px;margin:0;">— Joe</p>
    </div>
    <div style="text-align:center;font-size:12px;color:#6b7280;padding:20px 16px;">
      <p style="margin:0 0 6px;">No Big Deal Home Solutions · Greater Cincinnati, OH</p>
      <p style="margin:0;">Licensed &amp; insured · GAF Certified · Owner-operated by Joe Deal</p>
    </div>
  </div>
</body>
</html>`;
}

function buildEstimateEmailText({ firstName, estimateSummary }) {
  const greeting = firstName ? `Hey ${firstName},` : 'Hey,';
  return [
    greeting,
    '',
    "Joe here. Thanks for running the numbers on my site — here's your estimate, just like you asked:",
    '',
    estimateSummary,
    '',
    "The next step is simple, and it's free: I'll come out, walk the roof myself, and confirm exactly what you need (and what you don't).",
    '',
    'Book your free inspection here:',
    BOOKING_URL,
    '',
    "Or if it's easier, just call or text me directly — I answer my own phone:",
    '',
    PHONE_DISPLAY,
    '',
    'This is a ballpark — final pricing is confirmed after Joe walks the roof.',
    '',
    'Either way, no big deal.',
    '',
    '— Joe',
    '',
    '---',
    'No Big Deal Home Solutions · Greater Cincinnati, OH',
    'Licensed & insured · GAF Certified · Owner-operated by Joe Deal',
  ].join('\n');
}

// ───────────────────────────────────────────────────────────────
// estimateEmail — onCreate trigger on estimate_leads
// ───────────────────────────────────────────────────────────────
//
// Fires once per estimate lead. Only acts when:
//   - type === 'email_estimate_request' (homeowner explicitly asked)
//   - the lead is NBD's (no companyId, or NBD's own tenant id)
//   - the lead carries a plausible email + non-empty estimateSummary
//
// GATED by ESTIMATE_EMAIL_ENABLED env var. When disabled, runs in
// DRY-RUN mode — logs the would-be send but does not send.

exports.estimateEmail = onDocumentCreated(
  {
    region: 'us-central1',
    document: 'estimate_leads/{id}',
    secrets: [RESEND_API_KEY, EMAIL_FROM],
    maxInstances: 10,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (event) => {
    const enabled = process.env.ESTIMATE_EMAIL_ENABLED === 'true';
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    const leadId = event.params && event.params.id;

    // Only the estimator's explicit "Email My Estimate" requests.
    if (data.type !== 'email_estimate_request') return;

    // NBD-only: skip leads tagged to another tenant.
    if (data.companyId && String(data.companyId) !== NBD_OWNER_UID) {
      logger.info('estimate_email_skipped_non_nbd_tenant', { leadId, companyId: data.companyId });
      return;
    }

    if (!isValidEmail(data.email)) {
      logger.info('estimate_email_skipped_invalid_email', { leadId });
      return;
    }

    const estimateSummary = sanitizeString(data.estimateSummary, 2000);
    if (!estimateSummary) {
      logger.info('estimate_email_skipped_empty_summary', { leadId });
      return;
    }

    const firstName = sanitizeString(data.firstName, 80);

    if (!enabled) {
      logger.info('estimate_email_dry_run', { leadId, email: data.email, firstName });
      return;
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      logger.error('estimate_email_missing_api_key', { leadId });
      return;
    }

    // Idempotency: at-least-once delivery means this can fire more than once.
    // Transactionally claim the doc before sending so a redelivery is a no-op.
    let claimed = false;
    try {
      claimed = await admin.firestore().runTransaction(async (tx) => {
        const fresh = await tx.get(snap.ref);
        if (!fresh.exists) return false;
        if (fresh.get('estimateEmailedAt')) return false; // already handled
        tx.update(snap.ref, { estimateEmailedAt: FieldValue.serverTimestamp() });
        return true;
      });
    } catch (err) {
      logger.error('estimate_email_claim_failed', { leadId, error: err && err.message });
      return;
    }
    if (!claimed) {
      logger.info('estimate_email_already_sent', { leadId });
      return;
    }

    const resend = new Resend(apiKey);
    let fromAddress = 'Joe Deal <jd@nobigdealwithjoedeal.com>';
    if (process.env.EMAIL_FROM) fromAddress = process.env.EMAIL_FROM;

    try {
      await resend.emails.send({
        from: fromAddress,
        to: data.email,
        replyTo: REPLY_TO,
        subject: 'Your Roof Estimate — No Big Deal Home Solutions',
        html: buildEstimateEmailHtml({ firstName, estimateSummary }),
        text: buildEstimateEmailText({ firstName, estimateSummary }),
        headers: {
          'X-NBD-Campaign': 'estimate-email-v1',
        },
      });

      await snap.ref.update({ estimateEmailStatus: 'sent' });
      logger.info('estimate_email_sent', { leadId });
    } catch (err) {
      // Don't rethrow — the lead is already captured + the office notified by
      // the normal pipeline. We logged the failure; we don't trigger a retry
      // storm (and we've already claimed, so no duplicate attempt).
      logger.error('estimate_email_send_failed', { leadId, error: err && err.message });
      await snap.ref.update({
        estimateEmailStatus: 'failed',
        estimateEmailError: (err && err.message) || 'unknown',
      });
    }
  }
);
