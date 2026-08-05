/**
 * inbound-sms-route-logic.js — pure tenant-safe routing decision for the
 * incomingSMS webhook (audit 2026-08-02 HIGH-5). Dependency-free (no firebase)
 * so tests/inbound-sms-route.test.js can require() it directly and the webhook
 * (sms-functions.js) shares the exact same code path — no logic mirror to
 * drift (pattern: inbound-sms-convert-logic.js).
 *
 * WHY: one shared Twilio number serves every tenant, so a bare
 * `phoneDigits == fromDigits` match with limit(1) could file a homeowner's
 * reply — and the AI draft generated from it — into ANOTHER company's lead.
 * This module takes ALL candidate leads for the sender's number and decides:
 *
 *   - 0 candidates                     → unmatched (existing triage inbox)
 *   - 1 candidate                      → route (the common case, unchanged)
 *   - N candidates, one tenant        → route to the most-recently-worked
 *                                        lead (outbound SMS recency, then
 *                                        lastContactedAt, then createdAt) —
 *                                        tenant is unambiguous so a wrong
 *                                        pick stays inside the right company
 *   - N candidates, multiple tenants  → route ONLY when exactly one lead
 *                                        holds the strictly-newest outbound
 *                                        SMS within the recency window
 *                                        (someone texted them recently —
 *                                        they're replying to that thread);
 *                                        otherwise UNMATCHED. We never guess
 *                                        across tenants: a misroute is a
 *                                        cross-company PII leak, a triaged
 *                                        message is a 30-second admin task.
 *
 * Candidate shape (all timestamps in epoch millis or null):
 *   { id, companyId, userId, lastOutboundAt, lastContactedAt, createdAt }
 *
 * Returns:
 *   { decision: 'route',     leadId, ambiguity: null|'same-tenant'|'cross-tenant-resolved' }
 *   { decision: 'unmatched',         ambiguity: null|'cross-tenant-unresolved' }
 */
'use strict';

// A reply more than 30 days after the last outbound text isn't safely
// attributable to that thread — beyond this window we file to triage instead.
const DEFAULT_RECENCY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Tenant key: companyId with the repo-wide solo-owner fallback (companyId ==
// uid for solo tenants — see buildConvertedLead). A lead with neither (should
// not exist; rules require userId) gets a per-lead key so it can never be
// silently grouped with anything.
function tenantOf(c) {
  return c.companyId || c.userId || ('lead:' + (c.id || ''));
}

// Most-recently-worked comparator: outbound SMS recency beats lastContactedAt
// beats createdAt. Nulls sort last. Stable for full ties (Array.sort is stable
// in Node ≥ 12), so equal candidates keep query order.
function newestFirst(a, b) {
  const byOut = (b.lastOutboundAt || 0) - (a.lastOutboundAt || 0);
  if (byOut) return byOut;
  const byContact = (b.lastContactedAt || 0) - (a.lastContactedAt || 0);
  if (byContact) return byContact;
  return (b.createdAt || 0) - (a.createdAt || 0);
}

function pickLeadForInbound(candidates, opts) {
  const list = Array.isArray(candidates) ? candidates.filter(c => c && c.id) : [];
  const now = (opts && typeof opts.now === 'number') ? opts.now : Date.now();
  const windowMs = (opts && typeof opts.recencyWindowMs === 'number')
    ? opts.recencyWindowMs
    : DEFAULT_RECENCY_WINDOW_MS;

  if (list.length === 0) return { decision: 'unmatched', ambiguity: null };
  if (list.length === 1) return { decision: 'route', leadId: list[0].id, ambiguity: null };

  const tenants = new Set(list.map(tenantOf));
  if (tenants.size === 1) {
    const sorted = list.slice().sort(newestFirst);
    return { decision: 'route', leadId: sorted[0].id, ambiguity: 'same-tenant' };
  }

  // Cross-tenant: a fresh outbound text is the only signal safe enough to
  // route on. "Fresh" = within the window; "safe" = exactly one lead holds
  // the strictly-newest one (a tie means two threads could own the reply).
  const withFresh = list.filter(c =>
    typeof c.lastOutboundAt === 'number' &&
    c.lastOutboundAt > 0 &&
    (now - c.lastOutboundAt) <= windowMs);
  if (withFresh.length) {
    let max = 0;
    for (const c of withFresh) { if (c.lastOutboundAt > max) max = c.lastOutboundAt; }
    const holders = withFresh.filter(c => c.lastOutboundAt === max);
    if (holders.length === 1) {
      return { decision: 'route', leadId: holders[0].id, ambiguity: 'cross-tenant-resolved' };
    }
  }
  return { decision: 'unmatched', ambiguity: 'cross-tenant-unresolved' };
}

module.exports = { pickLeadForInbound, tenantOf, DEFAULT_RECENCY_WINDOW_MS };
