/**
 * NBD Pro — Dormant Lead Re-engagement
 * ═══════════════════════════════════════════════════════════════
 *
 * Companion to weekly-digest.js (Wave 16). The Monday digest is
 * "here's how the week looked" — informational. This Wednesday
 * re-engagement is "you have leads sitting too long, take action
 * before the week ends" — operational.
 *
 * Why Wednesday: gives the rep two business days to call/email the
 * stuck leads before the weekend kills the week. Monday is too late
 * (Wave 16 sits there). Friday is too late (rep has shifted to
 * weekend mode).
 *
 * For each user, finds non-terminal leads where the current stage
 * has been sitting ≥30 days. Skips users who explicitly opted out
 * via users/{uid}.dormantNudgeEnabled === false. Skips when there's
 * nothing dormant — empty inbox is not the goal.
 *
 * Gate: DORMANT_NUDGE_ENABLED env var. DRY-RUN by default — logs
 * eligible recipients but does not send. Flip on the Cloud Run
 * revision after one or two cycles of observation.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { Resend } = require('resend');

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const EMAIL_FROM     = defineSecret('EMAIL_FROM');

const DORMANT_DAYS = 30;
const DAY_MS       = 24 * 60 * 60 * 1000;

// Stages that don't count — these are terminal or low-effort.
const TERMINAL_STAGES = new Set([
  'closed', 'lost', 'Lost', 'Complete',
  'final_payment', 'deductible_collected',
]);

// ─── Branded HTML template ───────────────────────────────────────
const TEMPLATE_STYLES = `
  body { font-family: 'Barlow','Segoe UI',Roboto,sans-serif; line-height:1.6; color:#333; background:#f5f5f5; margin:0; padding:0; }
  .container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
  .header { background:linear-gradient(135deg,#C8541A 0%,#a64516 100%); color:#fff; padding:32px 24px; text-align:center; }
  .header h1 { margin:0 0 6px; font-size:24px; font-weight:700; letter-spacing:-0.3px; }
  .header p { margin:0; font-size:13px; opacity:0.9; }
  .content { padding:28px 24px; color:#1f2937; }
  h2 { color:#1e3a6e; margin:0 0 8px; font-size:18px; }
  p { margin:8px 0; }
  .lead-row {
    display:block; padding:12px 14px; border-radius:8px;
    background:#f9fafb; border:1px solid #e5e7eb;
    margin-bottom:8px; text-decoration:none; color:inherit;
  }
  .lead-name { font-weight:700; color:#111827; font-size:14px; margin-bottom:3px; }
  .lead-meta { font-size:12px; color:#6b7280; }
  .lead-stage {
    display:inline-block; background:#fef3c7; color:#92400e;
    font-size:10px; font-weight:700; padding:2px 8px;
    border-radius:999px; text-transform:uppercase;
    letter-spacing:0.4px; margin-right:6px;
  }
  .lead-days {
    display:inline-block; background:#fee2e2; color:#991b1b;
    font-size:10px; font-weight:700; padding:2px 8px;
    border-radius:999px; letter-spacing:0.4px;
  }
  .cta {
    display:inline-block; margin-top:18px; padding:12px 24px;
    background:#C8541A; color:#fff; border-radius:6px;
    text-decoration:none; font-weight:600;
  }
  .footer { background:#1e3a6e; color:#94a3b8; padding:18px 24px; text-align:center; font-size:11px; }
  .footer a { color:#C8541A; text-decoration:none; }
`;

const STAGE_LABELS = {
  'new': 'New', 'contacted': 'Contacted', 'inspected': 'Inspected',
  'claim_filed': 'Claim Filed', 'adjuster_meeting_scheduled': 'Adjuster Meeting',
  'adjuster_inspection_done': 'Adjuster Done', 'scope_received': 'Scope Received',
  'estimate_submitted': 'Estimate Sent', 'estimate_sent_cash': 'Est Sent (Cash)',
  'supplement_requested': 'Supplement', 'supplement_approved': 'Supp Approved',
  'contract_signed': 'Contract Signed', 'negotiating': 'Negotiating',
  'prequal_sent': 'Pre-Qual Sent', 'loan_approved': 'Loan Approved',
  'job_created': 'Job Created', 'permit_pulled': 'Permit',
  'materials_ordered': 'Materials Ordered', 'materials_delivered': 'Materials Here',
  'crew_scheduled': 'Crew Scheduled', 'install_in_progress': 'Installing',
  'install_complete': 'Install Done', 'final_photos': 'Final Photos',
};

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

function buildEmailHtml({ firstName, dormantLeads, total }) {
  const dashboardUrl = 'https://nobigdeal-pro.web.app/pro/dashboard.html';
  const greeting = firstName ? `Hey ${escapeHtml(firstName)},` : 'Hey,';
  const top = dormantLeads.slice(0, 5);
  const topRowsHtml = top.map(l => {
    const name = `${l.firstName || ''} ${l.lastName || ''}`.trim() || 'Unnamed lead';
    const stage = STAGE_LABELS[l.stage] || l.stage || 'unknown';
    const url = `${dashboardUrl.replace('/dashboard.html','/customer.html')}?id=${encodeURIComponent(l.id)}`;
    const subParts = [];
    if (l.address) subParts.push(escapeHtml(l.address));
    if (l.phone)   subParts.push(escapeHtml(l.phone));
    return `
      <a class="lead-row" href="${url}">
        <div class="lead-name">${escapeHtml(name)}</div>
        <div style="margin-bottom:6px;">
          <span class="lead-stage">${escapeHtml(stage)}</span>
          <span class="lead-days">${l.daysInStage} days dormant</span>
        </div>
        <div class="lead-meta">${subParts.join(' · ') || '&nbsp;'}</div>
      </a>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Stuck leads to re-engage</title>
  <style>${TEMPLATE_STYLES}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>${total} stuck lead${total === 1 ? '' : 's'} to re-engage</h1>
      <p>NBD Pro · Wednesday check-in</p>
    </div>
    <div class="content">
      <p>${greeting}</p>
      <p>You have <strong>${total}</strong> lead${total === 1 ? ' that has' : 's that have'} been sitting in the same stage for over 30 days. Two business days to wrap them up before the week's gone.</p>

      <h2 style="margin-top:24px;">Top ${top.length} oldest</h2>
      <div style="margin:14px 0;">
        ${topRowsHtml}
      </div>

      ${total > top.length ? `
        <p style="font-size:13px; color:#6b7280; text-align:center;">
          + ${total - top.length} more in your CRM
        </p>` : ''}

      <p style="text-align:center; margin-top:18px;">
        <a href="${dashboardUrl}" class="cta">Open Dashboard</a>
      </p>

      <p style="font-size:11px; color:#9ca3af; margin-top:24px; text-align:center; line-height:1.5;">
        Tip: the new "Needs Attention" filter on your kanban groups these together with overdue tasks + stale estimates so you can knock them all out in one sitting.
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
async function findDormantLeads(db, uid) {
  const cutoff = Date.now() - DORMANT_DAYS * DAY_MS;
  const snap = await db.collection('leads').where('userId', '==', uid).limit(2000).get();
  // 5.2: surface silent truncation. A rep with >2000 leads gets an incomplete
  // dormant scan (the broad query can't be cheaply narrowed without a
  // lastActivityAt convention — see Audit #4 Phase 5). Make it visible.
  if (snap.size >= 2000) logger.warn('dormant_nudge_truncated', { uid, limit: 2000 });
  const out = [];
  for (const doc of snap.docs) {
    const lead = { id: doc.id, ...doc.data() };
    if (lead.deleted) continue;
    if (lead.isProspect) continue;
    const stage = (lead.stage || '').toLowerCase();
    if (TERMINAL_STAGES.has(stage)) continue;

    const stageStart = timestampMillis(lead.stageStartedAt)
                    || timestampMillis(lead.updatedAt)
                    || timestampMillis(lead.createdAt);
    if (!stageStart) continue;
    if (stageStart > cutoff) continue;
    const daysInStage = Math.floor((Date.now() - stageStart) / DAY_MS);
    out.push({ ...lead, daysInStage });
  }
  out.sort((a, b) => b.daysInStage - a.daysInStage);
  return out;
}

// ─── Scheduled function ──────────────────────────────────────────
exports.dormantLeadNudge = onSchedule(
  {
    // Wednesday 8am Eastern. Two business days to call/email before
    // the weekend kills the week.
    schedule: '0 8 * * WED',
    timeZone: 'America/New_York',
    secrets: [RESEND_API_KEY, EMAIL_FROM],
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const enabled = process.env.DORMANT_NUDGE_ENABLED === 'true';
    const db = admin.firestore();

    const resend = enabled && process.env.RESEND_API_KEY
      ? new Resend(process.env.RESEND_API_KEY)
      : null;
    const fromAddress = process.env.EMAIL_FROM || 'Joe Deal <jd@nobigdealwithjoedeal.com>';

    let sent = 0, skippedOptOut = 0, skippedNothing = 0, failed = 0;

    // 2.6: paginate ALL users. The previous single .limit(500).get() meant
    // user #501+ was silently never processed once team/tenant count grew
    // past 500. Page by document id so every user is covered.
    let totalUsers = 0;
    let userCursor = null;
    while (true) {
      let uq = db.collection('users')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(500);
      if (userCursor) uq = uq.startAfter(userCursor);
      const usersSnap = await uq.get();
      if (usersSnap.empty) break;
      totalUsers += usersSnap.size;

      for (const userDoc of usersSnap.docs) {
      const user = userDoc.data() || {};
      const uid  = userDoc.id;

      if (!user.email || !isValidEmail(user.email)) { skippedOptOut++; continue; }
      if (user.dormantNudgeEnabled === false)        { skippedOptOut++; continue; }
      if (user.e2eTestAccount)                       { skippedOptOut++; continue; }

      try {
        const dormant = await findDormantLeads(db, uid);
        if (dormant.length === 0) { skippedNothing++; continue; }

        const firstName = user.displayName ? String(user.displayName).split(' ')[0] : '';
        const html = buildEmailHtml({ firstName, dormantLeads: dormant, total: dormant.length });
        const subject = `${dormant.length} stuck lead${dormant.length === 1 ? '' : 's'} to re-engage`;

        if (!enabled || !resend) {
          logger.info('dormant_nudge_dry_run', {
            uid, email: user.email, dormant: dormant.length,
            oldest: dormant[0]?.daysInStage,
          });
          skippedOptOut++;  // counted toward not-sent for the summary
          continue;
        }

        await resend.emails.send({
          from: fromAddress,
          to: user.email,
          subject,
          html,
        });

        await userDoc.ref.update({
          lastDormantNudgeSentAt: FieldValue.serverTimestamp(),
        });

        sent++;
      } catch (e) {
        logger.warn('dormant_nudge_user_error', { uid, err: e.message });
        failed++;
      }
      }

      if (usersSnap.size < 500) break;
      userCursor = usersSnap.docs[usersSnap.docs.length - 1];
    }

    logger.info('dormant_nudge_complete', {
      mode: enabled ? 'live' : 'dry-run',
      sent, skippedOptOut, skippedNothing, failed,
      total: totalUsers,
    });
  }
);
