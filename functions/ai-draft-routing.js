/**
 * ai-draft-routing.js — where an approved ai_draft is delivered, by channel
 * (idea #5). Dependency-free (no firebase) so the routing decision is
 * unit-tested and onAiDraftApproved shares it verbatim.
 *
 * ai_drafts started life SMS-only (triggerType 'inbound_sms' → Twilio). A
 * homeowner-portal reply reuses the same draft → approve → send loop but must
 * be delivered into the portal thread, NOT texted. This module is the single
 * source of truth for that fork so the SMS path stays byte-identical.
 */
'use strict';

// Trigger types whose approved draft is delivered to the portal thread, not SMS.
const PORTAL_TRIGGER_TYPES = new Set(['portal_message_in']);

// Explicit delivery channel, stamped on every draft at generation time
// (ai-texting.js). Defense in depth: a portal draft also carries the
// homeowner's customerPhone (copied from lead.phone), so triggerType was the
// ONLY thing standing between a web-portal reply and an actual text message.
// Either signal now routes to the portal; a draft carrying neither (legacy
// rows written before the stamp existed) keeps the documented SMS default.
const PORTAL_CHANNEL = 'portal';

function isPortalDraft(draft) {
  if (!draft) return false;
  if (draft.channel === PORTAL_CHANNEL) return true;
  return typeof draft.triggerType === 'string' && PORTAL_TRIGGER_TYPES.has(draft.triggerType);
}

// The channel to stamp for a given triggerType, so producers never hand-code it.
function channelForTriggerType(triggerType) {
  return (typeof triggerType === 'string' && PORTAL_TRIGGER_TYPES.has(triggerType))
    ? PORTAL_CHANNEL
    : 'sms';
}

// Portal messages allow 2000 chars (vs SMS 1600). Trim + clamp; '' means the
// draft has no body and must not be delivered.
function clampPortalText(s, max) {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.slice(0, (max && max > 0) ? max : 2000);
}

module.exports = {
  isPortalDraft, clampPortalText, channelForTriggerType,
  PORTAL_TRIGGER_TYPES, PORTAL_CHANNEL,
};
