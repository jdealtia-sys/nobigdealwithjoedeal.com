/**
 * integrations/slack.js — fire-and-forget Slack alert helper
 *
 * Shared helper + two triggers that fire on high-signal events:
 *   - New lead created (stage changed to "contract signed")
 *   - Platform admin grant attempt (security alert from audit module)
 *
 * SETUP:
 *   1. In Slack, create an incoming webhook for a channel like #nbd-ops.
 *   2. firebase functions:secrets:set SLACK_WEBHOOK_URL
 *   3. Paste the webhook URL when prompted.
 *
 * If the secret isn't set the helpers no-op silently — the rest of
 * the pipeline doesn't notice.
 */

'use strict';

const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { getSecret, hasSecret, SECRETS } = require('./_shared');

async function postSlack(payload) {
  if (!hasSecret('SLACK_WEBHOOK_URL')) return { posted: false, reason: 'unconfigured' };
  const url = getSecret('SLACK_WEBHOOK_URL');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return { posted: res.ok, status: res.status };
  } catch (e) {
    logger.warn('slack post failed:', e.message);
    return { posted: false, reason: e.message };
  }
}

// ─── Trigger: lead flipped to a signed/won stage ─────────────
// Hits on `contract_signed`, `won`, `closed_won` etc. Conservative
// stage allowlist — we don't want a chatty channel on every stage
// bump, just the money moments.
const WIN_STAGES = new Set([
  'contract_signed', 'contract-signed', 'won', 'closed_won', 'closed-won',
  'signed', 'sale_closed', 'deal_closed'
]);

exports.slack_onLeadWon = onDocumentWritten(
  {
    region: 'us-central1',
    document: 'leads/{leadId}',
    secrets: [SECRETS.SLACK_WEBHOOK_URL]
  },
  async (event) => {
    if (!hasSecret('SLACK_WEBHOOK_URL')) return;
    const before = event.data && event.data.before && event.data.before.exists
      ? event.data.before.data() : null;
    const after = event.data && event.data.after && event.data.after.exists
      ? event.data.after.data() : null;
    if (!after) return;

    const prevStage = (before && before.stage || '').toLowerCase().replace(/\s+/g, '_');
    const nextStage = (after.stage || '').toLowerCase().replace(/\s+/g, '_');
    if (prevStage === nextStage) return;
    if (!WIN_STAGES.has(nextStage)) return;

    const repName = await resolveRepName(after.userId);
    const addr = after.address || '(no address)';
    const value = typeof after.jobValue === 'number' ? after.jobValue : null;
    const dollars = value ? `$${value.toLocaleString()}` : '';

    await postSlack({
      text: `💰 Deal signed: ${addr} ${dollars}`.trim(),
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*💰 Deal signed* by *${escSlack(repName)}*\n*${escSlack(addr)}* — ${dollars || 'value not set'}`
          }
        }
      ]
    });
  }
);

// ─── Trigger: security_admin_grant_attempt audit entry ───────
// The audit-triggers module writes one of these whenever an invite
// doc tries to set role='admin'. That's a C-1 probe. Page on-call.
exports.slack_onAdminGrantAttempt = onDocumentCreated(
  {
    region: 'us-central1',
    document: 'audit_log/{id}',
    secrets: [SECRETS.SLACK_WEBHOOK_URL]
  },
  async (event) => {
    if (!hasSecret('SLACK_WEBHOOK_URL')) return;
    const data = event.data && event.data.data && event.data.data();
    if (!data || data.type !== 'security_admin_grant_attempt') return;
    await postSlack({
      text: '🚨 SECURITY: invite doc set role=admin — investigate now',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              '*🚨 SECURITY ALERT — admin grant attempt*\n' +
              '`companies/' + (data.ids && data.ids.companyId) + '/members/<redacted>`\n' +
              'onRepSignup clamped the role to sales_rep, but the attempt itself means someone probed the C-1 path. ' +
              'Pull the audit_log entry and the company owner\'s session history.'
          }
        }
      ]
    });
  }
);

// ─── Trigger: storm alert — post the summary to ops channel ──
exports.slack_onStormAlert = onDocumentCreated(
  {
    region: 'us-central1',
    document: 'storm_alerts_sent/{id}',
    secrets: [SECRETS.SLACK_WEBHOOK_URL]
  },
  async (event) => {
    if (!hasSecret('SLACK_WEBHOOK_URL')) return;
    const d = event.data && event.data.data && event.data.data();
    if (!d) return;
    await postSlack({
      text: '⛈ Storm alert fired: ' + (d.zip || d.area || 'unknown area'),
      blocks: [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*⛈ Storm alert*\nArea: *${escSlack(d.zip || d.area || 'unknown')}*\nSubscribers notified: *${d.subscribers || 0}*\nSeverity: *${escSlack(d.severity || 'unknown')}*`
        }
      }]
    });
  }
);

async function resolveRepName(uid) {
  if (!uid) return 'Unknown rep';
  try {
    const snap = await admin.firestore().doc(`users/${uid}`).get();
    if (snap.exists) {
      const d = snap.data();
      return d.displayName || d.email || uid;
    }
  } catch (e) {}
  return uid;
}

function escSlack(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = exports;
module.exports.postSlack = postSlack;
