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

function isPortalDraft(draft) {
  return !!draft && typeof draft.triggerType === 'string' && PORTAL_TRIGGER_TYPES.has(draft.triggerType);
}

// Portal messages allow 2000 chars (vs SMS 1600). Trim + clamp; '' means the
// draft has no body and must not be delivered.
function clampPortalText(s, max) {
  const t = typeof s === 'string' ? s.trim() : '';
  return t.slice(0, (max && max > 0) ? max : 2000);
}

module.exports = { isPortalDraft, clampPortalText, PORTAL_TRIGGER_TYPES };
