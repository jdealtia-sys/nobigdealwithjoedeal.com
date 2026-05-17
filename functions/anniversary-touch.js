/**
 * NBD Pro — One-Year Anniversary Auto-Touch
 * ═══════════════════════════════════════════════════════════════
 *
 * Mirrors the dormant-leads.js pattern: a scheduled Cloud Function
 * that scans every rep's book and flags customers whose install
 * "anniversary" is happening today. Roofing is a referral business
 * — a 1-year touch is the single most reliable referral driver
 * after warranty work, and it's almost always forgotten.
 *
 * What we do:
 *   1. Scan leads in terminal stages (Complete / install_complete /
 *      deductible_collected) whose stageStartedAt is between 360
 *      and 380 days ago (window gives the scheduler slack and
 *      catches anniversaries that crossed a weekend skip).
 *   2. Idempotency: skip leads whose lead.anniversaryTouchedAt is
 *      within the last 350 days. The flag is set after each successful
 *      email so re-runs (manual or otherwise) don't double-touch.
 *   3. Aggregate per-rep so each rep gets ONE morning email listing
 *      all today's anniversaries (typical: 0-3 customers; rare days
 *      have 5+ if the rep had a big install week last year).
 *   4. Write an `anniversary_due` activity row on each lead so the
 *      rep's CRM bell catches it even if they don't open email.
 *
 * What we DON'T do:
 *   - We don't auto-send to the homeowner. TCPA / CAN-SPAM compliance
 *     requires explicit consent for outbound contact, and a 1-year-
 *     later message arguably falls outside the original transaction
 *     consent. We give the rep a prefilled deep link so they can
 *     review and tap one button to send the touch from the CRM.
 *
 * Per-user opt-out: users/{uid}.anniversaryTouchEnabled === false.
 * E2E test accounts always skipped.
 *
 * Ships DRY-RUN by default. Set ANNIVERSARY_TOUCH_ENABLED=true on
 * the Cloud Run revision after a cycle of observation.
 */

'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { Resend } = require('resend');

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const EMAIL_FROM     = defineSecret('EMAIL_FROM');

const DAY_MS = 24 * 60 * 60 * 1000;
// Anniversary window: 360-380 days ago. Symmetric around 365 with
// a few days of slack. Catches:
//   - Daily reruns that drift across midnight
//   - Customers whose stage transition landed on a weekend
//   - Reps with leap-year edge cases (Feb 29 → Feb 28/Mar 1)
const ANNIVERSARY_MIN_DAYS = 360;
const ANNIVERSARY_MAX_DAYS = 380;
// Idempotency window — re-skip a lead if the touch already fired
// in the last 350 days. Slightly shorter than the catch window so
// we never miss the next year's touch.
const RESKIP_WINDOW_DAYS = 350;

// Stages that count as "the job is done" for anniversary purposes.
// Stored both lower-case and capitalized to match the various ways
// the codebase persists the stage field.
const COMPLETE_STAGES = new Set([
  'complete', 'Complete',
  'install_complete',
  'deductible_collected',
  'final_payment',
]);

// ─── Branded email template ──────────────────────────────────────
const TEMPLATE_STYLES = `
  body { font-family: 'Barlow','Segoe UI',Roboto,sans-serif; line-height:1.6; color:#333; background:#f5f5f5; margin:0; padding:0; }
  .container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
  .header { background:linear-gradient(135deg,#C8541A 0%,#a64516 100%); color:#fff; padding:32px 24px; text-align:center; }
  .header h1 { margin:0 0 6px; font-size:24px; font-weight:700; letter-spacing:-0.3px; }
  .header p { margin:0; font-size:13px; opacity:0.9; }
  .content { padding:28px 24px; color:#1f2937; }
  h2 { color:#1e3a6e; margin:0 0 8px; font-size:18px; }
  p { margin:8px 0; }
  .anniv-row {
    display:block; padding:14px; border-radius:8px;
    background:#fff7ed; border:1px solid #fed7aa;
    margin-bottom:8px; text-decoration:none; color:inherit;
  }
  .anniv-name { font-weight:700; color:#111827; font-size:15px; margin-bottom:3px; }
  .anniv-meta { font-size:12px; color:#6b7280; }
  .anniv-pill {
    display:inline-block; background:#fef3c7; color:#92400e;
    font-size:10px; font-weight:700; padding:2px 8px;
    border-radius:999px; text-transform:uppercase;
    letter-spacing:0.4px; margin-right:6px;
  }
  .cta {
    display:inline-block; margin-top:18px; padding:12px 24px;
    background:#C8541A; color:#fff; border-radius:6px;
    text-decoration:none; font-weight:600;
  }
  .footer { background:#1e3a6e; color:#94a3b8; padding:18px 24px; text-align:center; font-size:11px; }
  .footer a { color:#C8541A; text-decoration:none; }
  .script-box {
    background:#f9fafb; border:1px dashed #d1d5db;
    border-radius:6px; padding:12px 14px; font-size:13px;
    color:#374151; margin-top:8px;
  }
`;

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
}

function timestampMillis(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.toDate === 'function')   return t.toDate().getTime();
  if (typeof t === 'number')            return t;
  return 0;
}

function fmtMonthDay(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildEmailHtml({ firstName, anniversaries }) {
  const dashboardUrl  = 'https://nobigdeal-pro.web.app/pro/dashboard.html';
  const customerBase  = 'https://nobigdeal-pro.web.app/pro/customer.html';
  const total = anniversaries.length;
  const greeting = firstName ? `Hey ${escapeHtml(firstName)},` : 'Hey,';

  // Pre-baked SMS script the rep can copy & tweak. Personal, low-key,
  // referral-aware — not a marketing blast. The script intentionally
  // doesn't mention warranty (that's a separate flow); this is the
  // relationship-keeping moment.
  const sampleScript =
    `Hey {firstName}, it's been a year since we wrapped your roof — wanted to check in and see how everything's holding up. ` +
    `Any questions or anyone you'd send our way? Either way, we appreciate you.`;

  const rowsHtml = anniversaries.map(l => {
    const name = `${l.firstName || ''} ${l.lastName || ''}`.trim() || 'Customer';
    const url  = `${customerBase}?id=${encodeURIComponent(l.id)}&anniversary=1`;
    const meta = [l.address, l.phone].filter(Boolean).map(escapeHtml).join(' · ');
    const installedOn = fmtMonthDay(l.completionMs);
    return `
      <a class="anniv-row" href="${url}">
        <div class="anniv-name">${escapeHtml(name)}</div>
        <div style="margin-bottom:6px;">
          <span class="anniv-pill">1-year anniversary</span>
          <span style="font-size:12px;color:#6b7280;">Installed ${escapeHtml(installedOn)}</span>
        </div>
        <div class="anniv-meta">${meta || '&nbsp;'}</div>
      </a>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${total} anniversary touch${total === 1 ? '' : 's'} ready</title>
  <style>${TEMPLATE_STYLES}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${total} customer${total === 1 ? '' : 's'} hitting 1 year today</h1>
      <p>NBD Pro · Anniversary check-in</p>
    </div>
    <div class="content">
      <p>${greeting}</p>
      <p>${total === 1 ? 'A customer' : `${total} customers`} crossed the 1-year mark on ${total === 1 ? 'their install' : 'their installs'} today. A quick text now is the single most reliable referral driver in roofing — and it almost always gets forgotten.</p>

      <h2 style="margin-top:24px;">Today's anniversaries</h2>
      <div style="margin:14px 0;">
        ${rowsHtml}
      </div>

      <h2 style="margin-top:22px;">Drop-in script</h2>
      <div class="script-box">${escapeHtml(sampleScript)}</div>
      <p style="font-size:12px;color:#6b7280;margin-top:8px;">Click any customer above to open their record in the CRM — the address + phone are pre-loaded so you can text, call, or email in one tap.</p>

      <p style="text-align:center; margin-top:18px;">
        <a href="${dashboardUrl}" class="cta">Open Dashboard</a>
      </p>

      <p style="font-size:12px; color:#6b7280; margin-top:18px; text-align:center;">
        Don't want these? <a href="${dashboardUrl}#settings" style="color:#C8541A;">Manage email preferences</a>.
      </p>
    </div>
    <div class="footer">
      <p>No Big Deal Home Solutions · (859) 420-7382 · jd@nobigdealwithjoedeal.com</p>
    </div>
  </div>
</body>
</html>`;
}

// ─── Per-user aggregation ────────────────────────────────────────
async function findAnniversaryLeads(db, uid) {
  const now = Date.now();
  const minCompletionMs = now - ANNIVERSARY_MAX_DAYS * DAY_MS;
  const maxCompletionMs = now - ANNIVERSARY_MIN_DAYS * DAY_MS;
  const reSkipCutoff    = now - RESKIP_WINDOW_DAYS    * DAY_MS;

  const snap = await db.collection('leads').where('userId', '==', uid).limit(5000).get();
  const out = [];
  for (const doc of snap.docs) {
    const lead = { id: doc.id, ...doc.data() };
    if (lead.deleted) continue;
    if (lead.isProspect) continue;
    if (!COMPLETE_STAGES.has(lead.stage)) continue;

    // Use the canonical completion field — fall back through the
    // common candidates the codebase uses to mark "job is done".
    const completionMs = timestampMillis(lead.completedAt)
                      || timestampMillis(lead.installCompletedAt)
                      || timestampMillis(lead.stageStartedAt)
                      || timestampMillis(lead.updatedAt);
    if (!completionMs) continue;

    // Inside the 360-380 day window?
    if (completionMs < minCompletionMs) continue;
    if (completionMs > maxCompletionMs) continue;

    // Idempotency — already touched within RESKIP_WINDOW_DAYS?
    const lastTouchedMs = timestampMillis(lead.anniversaryTouchedAt);
    if (lastTouchedMs && lastTouchedMs > reSkipCutoff) continue;

    out.push({ ...lead, completionMs });
  }
  // Newest install first — gives the email a sensible visual rhythm
  // when there are multiple anniversaries the same day.
  out.sort((a, b) => b.completionMs - a.completionMs);
  return out;
}

async function writeAnniversaryActivity(db, leadId, uid) {
  try {
    await db.collection(`leads/${leadId}/activity`).add({
      userId: uid,
      type: 'anniversary_due',
      label: '1-year anniversary check-in due',
      message: 'Reach out today — a 1-year touch is the single most reliable referral driver in roofing.',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    logger.warn('anniversary_activity_write_failed', { leadId, err: e.message });
  }
}

async function markAnniversaryTouched(db, leadId) {
  try {
    await db.doc(`leads/${leadId}`).update({
      anniversaryTouchedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    logger.warn('anniversary_mark_failed', { leadId, err: e.message });
  }
}

// ─── Scheduled function ──────────────────────────────────────────
// Daily at 8am Eastern. Cron: every morning so anniversaries land
// on the rep's actual anniversary day rather than waiting for a
// weekly cycle.
exports.anniversaryAutoTouch = onSchedule(
  {
    schedule: '0 8 * * *',
    timeZone: 'America/New_York',
    secrets: [RESEND_API_KEY, EMAIL_FROM],
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const enabled = process.env.ANNIVERSARY_TOUCH_ENABLED === 'true';
    const db = admin.firestore();

    const usersSnap = await db.collection('users').limit(500).get();
    if (usersSnap.empty) {
      logger.info('anniversary_no_users');
      return;
    }

    const resend = enabled && process.env.RESEND_API_KEY
      ? new Resend(process.env.RESEND_API_KEY)
      : null;
    const fromAddress = process.env.EMAIL_FROM || 'Joe Deal <jd@nobigdealwithjoedeal.com>';

    let emailed = 0, skippedOptOut = 0, skippedNothing = 0, failed = 0;
    let activityWritten = 0;

    for (const userDoc of usersSnap.docs) {
      const user = userDoc.data() || {};
      const uid  = userDoc.id;

      if (!user.email || !isValidEmail(user.email)) { skippedOptOut++; continue; }
      if (user.anniversaryTouchEnabled === false)   { skippedOptOut++; continue; }
      if (user.e2eTestAccount)                      { skippedOptOut++; continue; }

      try {
        const anniversaries = await findAnniversaryLeads(db, uid);
        if (anniversaries.length === 0) { skippedNothing++; continue; }

        // Activity write always fires — even in dry-run — so the rep's
        // CRM bell catches the anniversary regardless of email mode.
        // This is the more important channel anyway; email is just a
        // morning nudge.
        for (const lead of anniversaries) {
          await writeAnniversaryActivity(db, lead.id, uid);
          activityWritten++;
        }

        const firstName = user.displayName ? String(user.displayName).split(' ')[0] : '';
        const html = buildEmailHtml({ firstName, anniversaries });
        const subject = `${anniversaries.length} customer${anniversaries.length === 1 ? '' : 's'} hitting 1 year today`;

        if (!enabled || !resend) {
          logger.info('anniversary_dry_run', {
            uid, email: user.email, count: anniversaries.length,
            sample: anniversaries.slice(0, 3).map(a => a.id),
          });
          continue;
        }

        await resend.emails.send({
          from: fromAddress,
          to: user.email,
          subject,
          html,
        });

        // Mark each lead touched only after the email lands. Activity
        // entries already exist regardless — that's the audit trail.
        for (const lead of anniversaries) {
          await markAnniversaryTouched(db, lead.id);
        }

        emailed++;
      } catch (e) {
        logger.warn('anniversary_user_error', { uid, err: e.message });
        failed++;
      }
    }

    logger.info('anniversary_touch_complete', {
      mode: enabled ? 'live' : 'dry-run',
      emailed, skippedOptOut, skippedNothing, failed,
      activityWritten,
      total: usersSnap.size,
    });
  }
);
