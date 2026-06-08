/**
 * NBD Pro — Weekly Digest Email
 * ═══════════════════════════════════════════════════════════════
 *
 * Scheduled Cloud Function that emails each rep a Monday-morning
 * recap of the previous 7 days: new leads, won deals + revenue,
 * lost deals, total pipeline value, and the top 5 new leads.
 *
 * Reps who don't open the dashboard daily lose track of momentum.
 * The digest is the "where am I" snapshot they get without having
 * to log in. The notification bell (Wave 13) handles real-time
 * alerts; this handles the slower weekly rhythm.
 *
 * Schedule: Monday 7am Eastern (Cincinnati-based business). Runs
 * once per week. Per-user opt-out via users/{uid}.weeklyDigestEnabled
 * === false. E2E test accounts are always skipped.
 *
 * Gate: WEEKLY_DIGEST_ENABLED env var. When unset/false, runs in
 * DRY-RUN mode — logs eligible recipients but does not send. Lets
 * us deploy and observe before flipping the switch.
 */

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { Resend } = require('resend');

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const EMAIL_FROM     = defineSecret('EMAIL_FROM');

// Stages that count as a "win" for revenue + count purposes. Includes
// the contract-signed and deductible-collected milestones, since both
// represent committed revenue even if the job isn't installed yet.
const WON_STAGES = new Set([
  'closed', 'contract_signed', 'deductible_collected', 'final_payment'
]);

// Active pipeline = anything not won, not lost, not new-untouched.
// We use a negative filter so future stages auto-roll in.
const TERMINAL_STAGES = new Set([
  'closed', 'lost', 'final_payment', 'deductible_collected'
]);

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Branded HTML template (mirrors email-functions.js styling) ──
const TEMPLATE_STYLES = `
  body { font-family: 'Barlow','Segoe UI',Roboto,sans-serif; line-height:1.6; color:#333; background:#f5f5f5; margin:0; padding:0; }
  .container { max-width:600px; margin:0 auto; background:#ffffff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.08); }
  .header { background:linear-gradient(135deg,#C8541A 0%,#a64516 100%); color:#fff; padding:32px 24px; text-align:center; }
  .header h1 { margin:0 0 6px; font-size:24px; font-weight:700; letter-spacing:-0.3px; }
  .header p { margin:0; font-size:13px; opacity:0.9; }
  .content { padding:28px 24px; color:#1f2937; }
  .stats { display:table; width:100%; border-collapse:separate; border-spacing:8px; margin:18px 0 24px; }
  .stat { display:table-cell; background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:14px 12px; text-align:center; vertical-align:top; }
  .stat-value { font-size:24px; font-weight:700; color:#1e3a6e; line-height:1.1; margin-bottom:4px; }
  .stat-label { font-size:11px; color:#6b7280; text-transform:uppercase; letter-spacing:0.4px; font-weight:600; }
  .stat.success .stat-value { color:#166534; }
  .stat.warn    .stat-value { color:#9a3412; }
  .lead-list { margin:20px 0; }
  .lead-row { padding:10px 12px; border-bottom:1px solid #f1f5f9; font-size:13px; color:#1f2937; }
  .lead-row:last-child { border-bottom:none; }
  .lead-name { font-weight:600; color:#111827; }
  .lead-sub { color:#6b7280; font-size:12px; margin-top:2px; }
  .empty { padding:24px; text-align:center; color:#6b7280; font-size:13px; font-style:italic; }
  .cta { display:inline-block; margin-top:18px; padding:12px 24px; background:#C8541A; color:#fff; border-radius:6px; text-decoration:none; font-weight:600; }
  .footer { background:#1e3a6e; color:#94a3b8; padding:18px 24px; text-align:center; font-size:11px; }
  .footer a { color:#C8541A; text-decoration:none; }
  h2 { color:#1e3a6e; margin:0 0 8px; font-size:18px; }
  p { margin:8px 0; }
`;

function fmtMoney(n) {
  const v = Math.round(Number(n) || 0);
  return '$' + v.toLocaleString('en-US');
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function buildDigestHtml(d) {
  const greeting = d.firstName ? `Good morning, ${escapeHtml(d.firstName)}` : 'Good morning';
  const newLeadRows = d.topLeads.length === 0
    ? `<div class="empty">No new leads this week. Time to hit the route.</div>`
    : d.topLeads.map(l => {
        const name = `${l.firstName || ''} ${l.lastName || ''}`.trim() || 'New lead';
        const sub  = [l.address, l.phone].filter(Boolean).join(' · ');
        return `
          <div class="lead-row">
            <div class="lead-name">${escapeHtml(name)}</div>
            ${sub ? `<div class="lead-sub">${escapeHtml(sub)}</div>` : ''}
          </div>`;
      }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Your week at NBD Pro</title>
  <style>${TEMPLATE_STYLES}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Your Week at a Glance</h1>
      <p>NBD Pro · ${escapeHtml(d.weekLabel)}</p>
    </div>
    <div class="content">
      <h2>${greeting}.</h2>
      <p>Here's how the last 7 days looked across your pipeline.</p>

      <div class="stats">
        <div class="stat">
          <div class="stat-value">${d.newLeadsCount}</div>
          <div class="stat-label">New Leads</div>
        </div>
        <div class="stat success">
          <div class="stat-value">${d.wonCount}</div>
          <div class="stat-label">Closed</div>
        </div>
        <div class="stat warn">
          <div class="stat-value">${d.lostCount}</div>
          <div class="stat-label">Lost</div>
        </div>
      </div>

      <div class="stats">
        <div class="stat success">
          <div class="stat-value">${fmtMoney(d.wonRevenue)}</div>
          <div class="stat-label">Won Revenue (Wk)</div>
        </div>
        <div class="stat">
          <div class="stat-value">${fmtMoney(d.activePipelineValue)}</div>
          <div class="stat-label">Active Pipeline</div>
        </div>
      </div>

      <h2 style="margin-top:24px;">New leads this week</h2>
      <div class="lead-list">${newLeadRows}</div>

      ${d.topLeads.length > 0 ? `
        <p style="text-align:center; margin-top:8px;">
          <a href="https://nobigdeal-pro.web.app/pro/dashboard.html" class="cta">Open Dashboard</a>
        </p>` : ''}

      <p style="font-size:12px; color:#6b7280; margin-top:24px; text-align:center;">
        Want fewer emails? <a href="https://nobigdeal-pro.web.app/pro/dashboard.html#settings" style="color:#C8541A;">Manage your digest preferences</a>.
      </p>
    </div>
    <div class="footer">
      <p>No Big Deal Home Solutions · (859) 420-7382 · jd@nobigdealwithjoedeal.com</p>
    </div>
  </div>
</body>
</html>`;
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

// ─── Per-user aggregation ───────────────────────────────────────
async function aggregateUserMetrics(db, uid) {
  const now = Date.now();
  const cutoff = now - ONE_WEEK_MS;
  const snap = await db.collection('leads').where('userId', '==', uid).limit(2000).get();
  // 5.2: surface silent truncation — a rep with >2000 leads gets metrics
  // computed over a truncated set (weekly digest genuinely needs a broad
  // read; the real fix is a date-windowed query, see Audit #4 Phase 5).
  if (snap.size >= 2000) logger.warn('weekly_digest_truncated', { uid, limit: 2000 });
  const allLeads = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(l => !l.deleted);

  const newLeads = allLeads.filter(l => timestampMillis(l.createdAt) >= cutoff);

  const wonThisWeek = allLeads.filter(l => {
    const stage = (l.stage || '').toLowerCase();
    if (!WON_STAGES.has(stage)) return false;
    return timestampMillis(l.updatedAt) >= cutoff;
  });
  const wonRevenue = wonThisWeek.reduce((s, l) => s + (Number(l.jobValue) || 0), 0);

  const lostThisWeek = allLeads.filter(l => {
    if ((l.stage || '').toLowerCase() !== 'lost') return false;
    return timestampMillis(l.updatedAt) >= cutoff;
  });

  const activePipelineValue = allLeads
    .filter(l => !TERMINAL_STAGES.has((l.stage || '').toLowerCase()))
    .reduce((s, l) => s + (Number(l.jobValue) || 0), 0);

  // Sort new leads by creation time desc, take top 5 for display.
  const topLeads = [...newLeads]
    .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt))
    .slice(0, 5);

  return {
    newLeadsCount: newLeads.length,
    wonCount: wonThisWeek.length,
    lostCount: lostThisWeek.length,
    wonRevenue,
    activePipelineValue,
    topLeads,
    hasAnyActivity: newLeads.length > 0 || wonThisWeek.length > 0 || lostThisWeek.length > 0,
  };
}

// ─── Scheduled function ─────────────────────────────────────────
exports.weeklyDigest = onSchedule(
  {
    // Monday 7am Eastern. Cincinnati-based business — most reps are
    // Eastern. The cron syntax is interpreted in the timeZone option.
    schedule: '0 7 * * MON',
    timeZone: 'America/New_York',
    secrets: [RESEND_API_KEY, EMAIL_FROM],
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const enabled = process.env.WEEKLY_DIGEST_ENABLED === 'true';
    const db = admin.firestore();

    const resend = enabled && process.env.RESEND_API_KEY
      ? new Resend(process.env.RESEND_API_KEY)
      : null;
    const fromAddress = process.env.EMAIL_FROM || 'Joe Deal <jd@nobigdealwithjoedeal.com>';

    let sent = 0, skipped = 0, failed = 0, noActivity = 0;

    // Friendly week label like "Apr 28 — May 4".
    const now = new Date();
    const weekStart = new Date(now.getTime() - ONE_WEEK_MS);
    const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const weekLabel = `${fmt(weekStart)} — ${fmt(now)}`;

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
      const uid = userDoc.id;

      if (!user.email || !isValidEmail(user.email)) { skipped++; continue; }
      if (user.weeklyDigestEnabled === false)        { skipped++; continue; }
      if (user.e2eTestAccount)                       { skipped++; continue; }

      try {
        const metrics = await aggregateUserMetrics(db, uid);

        // Skip the digest entirely for users with no movement at all
        // this week. Nothing more demoralizing than a "0 / 0 / 0" recap.
        // We still want to nudge dormant users eventually but that's
        // a different cron (re-engagement), not the weekly digest.
        if (!metrics.hasAnyActivity) { noActivity++; continue; }

        const firstName = user.displayName ? String(user.displayName).split(' ')[0] : '';
        const html = buildDigestHtml({ ...metrics, firstName, weekLabel });
        const subject = `Your NBD week: ${metrics.newLeadsCount} new · ${metrics.wonCount} closed · ${fmtMoney(metrics.wonRevenue)} won`;

        if (!enabled || !resend) {
          logger.info('weekly_digest_dry_run', {
            uid, email: user.email,
            newLeads: metrics.newLeadsCount,
            won: metrics.wonCount,
            lost: metrics.lostCount,
            wonRevenue: metrics.wonRevenue,
          });
          skipped++;
          continue;
        }

        await resend.emails.send({
          from: fromAddress,
          to: user.email,
          subject,
          html,
        });

        await userDoc.ref.update({
          lastDigestSentAt: FieldValue.serverTimestamp(),
        });

        sent++;
      } catch (e) {
        logger.warn('weekly_digest_user_error', { uid, err: e.message });
        failed++;
      }
      }

      if (usersSnap.size < 500) break;
      userCursor = usersSnap.docs[usersSnap.docs.length - 1];
    }

    logger.info('weekly_digest_complete', {
      mode: enabled ? 'live' : 'dry-run',
      sent, skipped, failed, noActivity,
      total: totalUsers,
    });
  }
);
