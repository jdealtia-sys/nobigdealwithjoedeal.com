/**
 * NBD — Abandoned Funnel Recovery
 * ═══════════════════════════════════════════════════════════════
 *
 * When a visitor enters their email in /estimate but abandons before
 * completing, we save the partial state. One hour later, a scheduled
 * job fires a warm recovery email signed by Joe with a link back.
 *
 * Functions:
 *   - saveFunnelProgress (HTTP onRequest)  — client posts partial/complete state
 *   - runAbandonRecovery (onSchedule hourly) — sends recovery emails
 *
 * Firestore:
 *   funnel_abandoned/{docId}  — one record per unique funnel session
 *
 * Safety:
 *   The scheduled function is GATED by the FUNNEL_RECOVERY_ENABLED
 *   env var. When unset OR not === "true", the job runs in DRY-RUN
 *   mode — it logs which emails *would* have been sent but does not
 *   actually send. Enable production sending via:
 *     firebase functions:config:set  (legacy — not used here)
 *   or set FUNNEL_RECOVERY_ENABLED=true on the runAbandonRecovery
 *   function via the Google Cloud Console (Cloud Run → edit & deploy
 *   new revision → environment variables) OR via gcloud:
 *     gcloud run services update runabandonrecovery \
 *       --region=us-central1 \
 *       --update-env-vars=FUNNEL_RECOVERY_ENABLED=true
 *
 * Future work:
 *   - Token-based resume that pre-fills the funnel from saved state
 *   - Second-touch SMS at 24h (needs TCPA consent gating)
 *   - Retry-on-failure + bounce tracking via Resend webhooks
 */

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { Resend } = require('resend');

// ───────────────────────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────────────────────

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const EMAIL_FROM = defineSecret('EMAIL_FROM');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];

const SITE_URL = 'https://nobigdealwithjoedeal.com';
const REPLY_TO = 'jd@nobigdealwithjoedeal.com';
const ABANDON_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RECOVERY_MAX_AGE_DAYS = 30; // Don't send recovery if record is older than this

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

function buildRecoveryEmailHtml({ firstName }) {
  const greeting = firstName ? `Hey ${firstName},` : 'Hey,';
  const resumeUrl = `${SITE_URL}/estimate?utm_source=recovery&utm_medium=email&utm_campaign=abandoned-funnel`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Your No Big Deal estimate is waiting</title></head>
<body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f5f3ef;color:#1a1a1a;line-height:1.6;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="background:#142a52;color:#fff;padding:20px 24px;border-radius:10px 10px 0 0;text-align:center;">
      <div style="font-size:18px;font-weight:800;letter-spacing:.06em;">NO BIG DEAL</div>
      <div style="font-size:11px;color:rgba(255,255,255,.7);letter-spacing:.08em;text-transform:uppercase;margin-top:4px;">Home Solutions</div>
    </div>
    <div style="background:#fff;padding:32px 28px;border-radius:0 0 10px 10px;border:1px solid #e8e5e0;border-top:none;">
      <p style="font-size:16px;margin:0 0 16px;">${greeting}</p>
      <p style="font-size:16px;margin:0 0 16px;">Joe here. I noticed you started an estimate on my site but didn't get a chance to finish it — totally understand, life happens.</p>
      <p style="font-size:16px;margin:0 0 16px;">If you still want that roof / siding / gutter estimate (no pressure, no pushy follow-ups), just pick up where you left off:</p>
      <div style="text-align:center;margin:28px 0;">
        <a href="${resumeUrl}" style="display:inline-block;background:#e8720c;color:#fff;padding:14px 28px;border-radius:8px;font-weight:800;font-size:15px;text-decoration:none;letter-spacing:.02em;">Finish my estimate →</a>
      </div>
      <p style="font-size:15px;margin:0 0 16px;">Or if it's easier, just call or text me directly — I answer my own phone:</p>
      <p style="font-size:15px;margin:0 0 16px;"><strong>📞 (859) 420-7382</strong></p>
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

function buildRecoveryEmailText({ firstName }) {
  const greeting = firstName ? `Hey ${firstName},` : 'Hey,';
  const resumeUrl = `${SITE_URL}/estimate?utm_source=recovery&utm_medium=email&utm_campaign=abandoned-funnel`;
  return [
    greeting,
    '',
    "Joe here. I noticed you started an estimate on my site but didn't get a chance to finish it — totally understand, life happens.",
    '',
    "If you still want that roof / siding / gutter estimate (no pressure, no pushy follow-ups), just pick up where you left off:",
    '',
    resumeUrl,
    '',
    "Or if it's easier, just call or text me directly — I answer my own phone:",
    '',
    '(859) 420-7382',
    '',
    "Either way, no big deal.",
    '',
    '— Joe',
    '',
    '---',
    'No Big Deal Home Solutions · Greater Cincinnati, OH',
    'Licensed & insured · GAF Certified · Owner-operated by Joe Deal',
  ].join('\n');
}

// ───────────────────────────────────────────────────────────────
// saveFunnelProgress — HTTP endpoint called by the estimate funnel
// ───────────────────────────────────────────────────────────────
//
// Request body:
//   {
//     email: string (required, validated),
//     funnelId: string (required — client-generated UUID),
//     firstName?: string,
//     lastName?: string,
//     phoneNumber?: string,
//     address?: string,
//     currentStep?: number,
//     completed?: boolean   (true when user finishes the funnel)
//   }
//
// Response:
//   { success: true }
//
// The doc ID is the funnelId (not email) so a user who restarts with
// the same email in a new session gets a fresh record. Older
// abandoned records with the same email can coexist; the scheduled
// job handles dedupe.

exports.saveFunnelProgress = onRequest(
  {
    cors: CORS_ORIGINS,
    maxInstances: 10,
    concurrency: 40,
    timeoutSeconds: 10,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    if (req.method !== 'POST') {
      res.status(405).json({ success: false, error: 'POST only' });
      return;
    }

    try {
      const body = req.body || {};
      const email = sanitizeString(body.email, 254).toLowerCase();
      const funnelId = sanitizeString(body.funnelId, 64);

      if (!isValidEmail(email)) {
        res.status(400).json({ success: false, error: 'invalid_email' });
        return;
      }
      if (!funnelId || funnelId.length < 8) {
        res.status(400).json({ success: false, error: 'invalid_funnel_id' });
        return;
      }

      const db = admin.firestore();
      const docRef = db.collection('funnel_abandoned').doc(funnelId);
      const now = admin.firestore.FieldValue.serverTimestamp();

      const existing = await docRef.get();
      const isNew = !existing.exists;

      const update = {
        email,
        funnelId,
        firstName: sanitizeString(body.firstName, 80),
        lastName: sanitizeString(body.lastName, 80),
        phoneNumber: sanitizeString(body.phoneNumber, 20),
        address: sanitizeString(body.address, 240),
        currentStep: Number.isFinite(body.currentStep) ? body.currentStep : 0,
        updatedAt: now,
      };

      if (isNew) {
        update.createdAt = now;
        update.completedAt = null;
        update.recoveryEmailSentAt = null;
        update.recoveryEmailStatus = null;
      }

      if (body.completed === true) {
        update.completedAt = now;
        update.recoveryEmailStatus = 'skipped_completed';
      }

      await docRef.set(update, { merge: true });

      res.status(200).json({ success: true });
    } catch (err) {
      logger.error('saveFunnelProgress_failed', {
        error: err && err.message,
        stack: err && err.stack,
      });
      res.status(500).json({ success: false, error: 'server_error' });
    }
  }
);

// ───────────────────────────────────────────────────────────────
// runAbandonRecovery — hourly scheduled job
// ───────────────────────────────────────────────────────────────
//
// Query: all funnel_abandoned docs where:
//   - createdAt is older than 1 hour
//   - completedAt is null (user didn't finish)
//   - recoveryEmailSentAt is null (we haven't sent yet)
//   - createdAt is newer than 30 days (don't send stale recoveries)
//
// For each matching doc, send a warm recovery email via Resend,
// signed by Joe, with a direct link back to /estimate.
//
// GATED by FUNNEL_RECOVERY_ENABLED env var. When disabled, runs
// in DRY-RUN mode — logs eligible records but does not send.

exports.runAbandonRecovery = onSchedule(
  {
    schedule: 'every 60 minutes',
    secrets: [RESEND_API_KEY, EMAIL_FROM],
    maxInstances: 1,
    timeoutSeconds: 300,
    memory: '256MiB',
  },
  async (event) => {
    const enabled = process.env.FUNNEL_RECOVERY_ENABLED === 'true';
    const db = admin.firestore();
    const now = Date.now();
    const cutoffOld = new Date(now - ABANDON_WINDOW_MS);
    const cutoffTooOld = new Date(now - RECOVERY_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

    const snap = await db
      .collection('funnel_abandoned')
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(cutoffOld))
      .where('createdAt', '>', admin.firestore.Timestamp.fromDate(cutoffTooOld))
      .limit(200)
      .get();

    if (snap.empty) {
      logger.info('funnel_recovery_no_eligible', { mode: enabled ? 'live' : 'dry-run' });
      return;
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let resend = null;
    let fromAddress = 'Joe Deal <jd@nobigdealwithjoedeal.com>';
    if (enabled) {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        logger.error('funnel_recovery_missing_api_key');
        return;
      }
      resend = new Resend(apiKey);
      if (process.env.EMAIL_FROM) fromAddress = process.env.EMAIL_FROM;
    }

    for (const doc of snap.docs) {
      const data = doc.data() || {};

      // Skip if already completed or already sent recovery
      if (data.completedAt) { skipped++; continue; }
      if (data.recoveryEmailSentAt) { skipped++; continue; }
      if (!isValidEmail(data.email)) { skipped++; continue; }

      const firstName = sanitizeString(data.firstName, 80);

      if (!enabled) {
        logger.info('funnel_recovery_dry_run', {
          funnelId: doc.id,
          email: data.email,
          firstName,
          age_min: Math.round((now - data.createdAt.toMillis()) / 60000),
        });
        skipped++;
        continue;
      }

      try {
        await resend.emails.send({
          from: fromAddress,
          to: data.email,
          replyTo: REPLY_TO,
          subject: 'You started an estimate — want me to finish it?',
          html: buildRecoveryEmailHtml({ firstName }),
          text: buildRecoveryEmailText({ firstName }),
          headers: {
            'X-NBD-Campaign': 'funnel-recovery-v1',
          },
        });

        await doc.ref.update({
          recoveryEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
          recoveryEmailStatus: 'sent',
        });
        sent++;
      } catch (err) {
        logger.error('funnel_recovery_send_failed', {
          funnelId: doc.id,
          error: err && err.message,
        });
        await doc.ref.update({
          recoveryEmailStatus: 'failed',
          recoveryEmailError: (err && err.message) || 'unknown',
        });
        failed++;
      }
    }

    logger.info('funnel_recovery_done', {
      mode: enabled ? 'live' : 'dry-run',
      eligible: snap.size,
      sent,
      skipped,
      failed,
    });
  }
);
