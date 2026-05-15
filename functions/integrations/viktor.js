/**
 * integrations/viktor.js — Viktor.ai AI coworker webhook fan-out
 *
 * Phase B.3 of the roadmap. Viktor (getviktor.com) is an AI coworker
 * that lives in Slack and connects to 3,000+ tools to proactively
 * execute tasks. The cheapest way to integrate is to **invite Viktor
 * into the same #nbd-ops Slack channel** the existing slack.js
 * helper already posts to — Viktor watches channel traffic and acts
 * on it natively, no extra code required.
 *
 * This module is the optional second leg: if VIKTOR_WEBHOOK_URL is
 * configured, we ALSO POST the same high-signal events directly to
 * Viktor's webhook with structured action metadata (lead IDs,
 * suggested actions, portal links) so Viktor can act without parsing
 * Slack markdown. If the secret isn't set everything silently no-ops
 * — Viktor still works via Slack, just through chat instead of an
 * event stream.
 *
 * Triggers
 *   viktor_onLeadWon          mirror of slack_onLeadWon
 *   viktor_onStormBriefing    mirror of stormBriefing_onAlertSent —
 *                             fires AFTER the briefing is composed and
 *                             includes the ranked lead list for Viktor
 *                             to schedule follow-up tasks
 *   viktor_onHotLeadAlert     mirror of any hot-lead-threshold event
 *                             (when lead engagement tier crosses HOT)
 *
 * Message shape
 *   {
 *     event: 'lead.won' | 'storm.briefing.sent' | 'lead.hot',
 *     ts: ISO timestamp,
 *     source: 'nbd-pro',
 *     ownerUid?: string,
 *     payload: { ... event-specific fields ... },
 *     suggestedActions: [{ kind, label, url, leadId? }, ...]
 *   }
 *
 * Viktor receives these as plain JSON and routes them to its agent
 * pipeline. Suggested actions are advisory — Viktor's policy decides
 * what to actually execute.
 */

'use strict';

const { onDocumentCreated, onDocumentWritten } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { getSecret, hasSecret, SECRETS } = require('./_shared');

const VIKTOR_SOURCE = 'nbd-pro';

async function postViktor(envelope) {
  if (!hasSecret('VIKTOR_WEBHOOK_URL')) {
    return { posted: false, reason: 'unconfigured' };
  }
  const url = getSecret('VIKTOR_WEBHOOK_URL');
  const body = {
    source: VIKTOR_SOURCE,
    ts: new Date().toISOString(),
    ...envelope,
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { posted: res.ok, status: res.status };
  } catch (e) {
    logger.warn('viktor.post_failed', { event: envelope.event, err: e.message });
    return { posted: false, reason: e.message };
  }
}

function leadDeepLink(leadId) {
  if (!leadId) return null;
  // Reps land on the kanban + auto-open the card detail modal via the
  // existing hash router. Customer-facing portal links live on the
  // lead doc itself; we only emit dashboard deep links here.
  return `https://nobigdealwithjoedeal.com/pro/dashboard#/crm?lead=${encodeURIComponent(leadId)}`;
}

// ─── Trigger: lead flipped to a signed/won stage ─────────────
exports.viktor_onLeadWon = onDocumentWritten(
  {
    region: 'us-central1',
    document: 'leads/{leadId}',
    secrets: [SECRETS.VIKTOR_WEBHOOK_URL],
  },
  async (event) => {
    if (!hasSecret('VIKTOR_WEBHOOK_URL')) return;
    const before = event.data && event.data.before && event.data.before.data();
    const after  = event.data && event.data.after  && event.data.after.data();
    if (!after) return;
    const wasWon = before && (before.stage === 'contract_signed' || before._stageKey === 'contract_signed');
    const isWon  =          (after.stage  === 'contract_signed' || after._stageKey  === 'contract_signed');
    if (!isWon || wasWon) return;     // edge-triggered: only on the new flip

    const leadId = event.params.leadId;
    const name = ((after.firstName || '') + ' ' + (after.lastName || '')).trim() || after.name || 'Lead';
    await postViktor({
      event: 'lead.won',
      ownerUid: after.ownerUid || null,
      payload: {
        leadId,
        name,
        address: after.address || null,
        phone: after.phone || null,
        email: after.email || null,
        jobValue: Number(after.jobValue) || 0,
        carrier: after.carrier || after.insuranceCarrier || null,
        damageType: after.damageType || null,
        hailHit: after.hailHit || null,
      },
      suggestedActions: [
        { kind: 'open-lead',  label: 'Open lead',   url: leadDeepLink(leadId), leadId },
        { kind: 'next-task',  label: 'Schedule install kickoff call', leadId },
        { kind: 'send-doc',   label: 'Send Welcome + Warranty packet', leadId },
      ],
    });
  }
);

// ─── Trigger: storm briefing was just sent ────────────────────
// Listens to storm_briefings_sent/{alertId} doc creation (the dedup
// sentinel that stormBriefing_onAlertSent writes). When status flips
// to "sent", forward the briefing's ranked lead list to Viktor.
exports.viktor_onStormBriefing = onDocumentWritten(
  {
    region: 'us-central1',
    document: 'storm_briefings_sent/{alertId}',
    secrets: [SECRETS.VIKTOR_WEBHOOK_URL],
  },
  async (event) => {
    if (!hasSecret('VIKTOR_WEBHOOK_URL')) return;
    const before = event.data && event.data.before && event.data.before.data();
    const after  = event.data && event.data.after  && event.data.after.data();
    if (!after) return;
    const wasSent = before && before.status === 'sent';
    const isSent  =          after.status === 'sent';
    if (!isSent || wasSent) return;     // edge-triggered on first sent

    const alertId = event.params.alertId;
    await postViktor({
      event: 'storm.briefing.sent',
      payload: {
        alertId,
        zip: after.zip || null,
        area: after.area || null,
        eventName: after.event || null,
        leadCount: after.leadCount || 0,
        topLeadIds: Array.isArray(after.topLeadIds) ? after.topLeadIds : [],
      },
      suggestedActions: (after.topLeadIds || []).slice(0, 5).map(leadId => ({
        kind: 'call-lead',
        label: 'Call lead about storm',
        url: leadDeepLink(leadId),
        leadId,
      })),
    });
  }
);

// ─── Trigger: hot-lead alert fires ────────────────────────────
// The existing smart-followup pipeline writes hot_lead_alerts/{id}
// when a lead crosses the engagement threshold. Mirror those to
// Viktor so the AI coworker can suggest a follow-up sequence.
exports.viktor_onHotLeadAlert = onDocumentCreated(
  {
    region: 'us-central1',
    document: 'hot_lead_alerts/{id}',
    secrets: [SECRETS.VIKTOR_WEBHOOK_URL],
  },
  async (event) => {
    if (!hasSecret('VIKTOR_WEBHOOK_URL')) return;
    const data = event.data && event.data.data && event.data.data();
    if (!data) return;
    const leadId = data.leadId || null;
    await postViktor({
      event: 'lead.hot',
      ownerUid: data.ownerUid || null,
      payload: {
        leadId,
        leadName: data.leadName || null,
        engagementTier: data.engagementTier || null,
        engagementScore: data.engagementScore || null,
        triggeredAt: data.triggeredAt && data.triggeredAt.toDate
          ? data.triggeredAt.toDate().toISOString()
          : null,
      },
      suggestedActions: leadId ? [
        { kind: 'open-lead', label: 'Open lead',           url: leadDeepLink(leadId), leadId },
        { kind: 'call-lead', label: 'Call while engagement is hot', leadId },
        { kind: 'next-task', label: 'Add follow-up task',  leadId },
      ] : [],
    });
  }
);

// Test surface
exports._test = { leadDeepLink, postViktor };
