/**
 * smart-followup.js — Wave 111 (Smart follow-up engine — foundation)
 *
 * Opens the AI-augmented sales-copilot arc. Reads each lead's full
 * context and proposes the next best action: when, what to say,
 * which channel, with a confidence score and human-readable
 * reasoning.
 *
 * Wave 111 ships the **deterministic heuristic** version. Every
 * future surface that consumes suggestions (W112 kanban pill,
 * W113 customer panel, W115 morning briefing) calls
 * `SmartFollowup.computeSuggestion(lead)` — they don't care that
 * the implementation is heuristic-now / Claude-API-later.
 *
 * The heuristic uses signals the system already collects:
 *   - W92 engagement tier (Hot / Viewed / Sent / New / Responded)
 *   - W44 lastSharedAt + lastSharedVia
 *   - W58 estimate viewedAt + respondedAt
 *   - W74 snoozeCount + snoozedUntil
 *   - W17 stage + days-in-stage
 *   - W26 terminal stage detection
 *
 * Wave 114 will swap the heuristic for a Claude API call that
 * reads the same context but produces richer reasoning + better
 * draft text. The interface stays the same.
 *
 * ─── Suggestion shape ───────────────────────────────────────────
 *   {
 *     leadId:    string,
 *     computedAt: number,                  // Date.now()
 *
 *     priority:  'urgent'   |              // act now (Hot + cold rep)
 *                'today'    |              // do today
 *                'this-week'|              // sometime soon
 *                'monitor'  |              // no action; watch
 *                'wait',                   // explicitly skip
 *
 *     action:    'call'         |
 *                'text'         |          // SMS via PortalLinkHelpers
 *                'email'        |
 *                'send-portal'  |          // first-share moment
 *                'follow-up'    |          // close them; they responded
 *                'wait',                   // do nothing
 *
 *     channel:   'sms' | 'email' | 'call' | null,
 *
 *     headline:  string,                   // "Call Sarah Smith — they
 *                                           //  viewed your estimate 3x today"
 *     reasoning: string,                   // why this suggestion fires
 *     draft:     string | null,            // suggested message body
 *
 *     confidence: number,                  // 0-100
 *     signals:   string[],                 // ['multi-view', 'fresh-share']
 *   }
 *
 * Path-gated to nothing — exposed as a pure helper. Consumers
 * decide where to render. Compounds W92 (computeTier) +
 * W97 (TemplatesLibrary.apply for draft generation).
 */
(function () {
  'use strict';

  if (window.SmartFollowup
      && window.SmartFollowup.__sentinel === 'nbd-smart-followup-v1') return;

  // ─── Constants ───────────────────────────────────────────────────
  const TERMINAL_STAGES = new Set(['closed', 'lost', 'complete']);
  const FRESH_24H_MS    = 24 * 60 * 60 * 1000;
  const STALE_SHARE_MS  = 5  * 24 * 60 * 60 * 1000; // matches W54
  const COLD_REP_MS     = 24 * 60 * 60 * 1000;
  const STAGE_AGE_DAYS  = 7; // matches W17

  // ─── Helpers ─────────────────────────────────────────────────────
  function toMillis(v) {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.toDate === 'function')   return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    if (typeof v === 'string') { const d = new Date(v); return isNaN(d) ? 0 : d.getTime(); }
    return 0;
  }
  function leadName(l) {
    if (!l) return 'this lead';
    const first = (l.firstName || '').trim();
    const last  = (l.lastName  || '').trim();
    const full  = (first + ' ' + last).trim();
    return full || l.address || 'this lead';
  }
  function preferredChannel(l) {
    const phone = String(l && l.phone || '').replace(/\D+/g, '');
    const email = String(l && l.email || '').trim();
    if (phone) return 'sms';
    if (email) return 'email';
    return 'call'; // fallback — rep has to look up info
  }

  // ─── Draft generation ────────────────────────────────────────────
  // Pulls from W97 templates if any match the channel; otherwise
  // builds a context-appropriate fallback. Uses TemplatesLibrary.apply
  // to substitute {firstName}/{portalUrl}/etc.
  function generateDraft(lead, scenario, channel) {
    if (!lead || !channel || channel === 'call') return null;
    const TL = window.TemplatesLibrary;

    // Try a default template first when one is pinned for the channel.
    if (TL && typeof TL.getDefault === 'function') {
      const def = TL.getDefault(channel);
      if (def && typeof TL.apply === 'function') {
        const rendered = TL.apply(def, { lead, url: '{portalUrl}' });
        if (rendered && rendered.body) return rendered.body;
      }
    }

    const first = (lead.firstName || '').trim();
    const greeting = first ? `Hi ${first}, ` : 'Hi, ';
    if (scenario === 'fresh-view-hot') {
      return `${greeting}saw you were just looking at the estimate — happy to walk through any questions. Got a minute?`;
    }
    if (scenario === 'viewed-no-response') {
      return `${greeting}wanted to check in on the estimate I sent — any questions or want to adjust anything?`;
    }
    if (scenario === 'sent-no-view') {
      return `${greeting}did the portal link come through OK? Send me a quick yes/no when you get a sec.`;
    }
    if (scenario === 'first-share') {
      return `${greeting}here's your project portal — photos, status, and what's coming next: {portalUrl}`;
    }
    if (scenario === 'responded') {
      return `${greeting}great hearing from you on the estimate — let's lock in a time to walk through next steps. When works this week?`;
    }
    if (scenario === 'snooze-expired') {
      return `${greeting}circling back on the project — wanted to see if anything changed on your end since we last connected.`;
    }
    return null;
  }

  // ─── Compute ─────────────────────────────────────────────────────
  // Pure function. Takes a lead + optional context (estimates,
  // taskCache) and returns a suggestion object. Defaults to reading
  // window._estimates / window._taskCache so most callers don't pass
  // a context.
  function computeSuggestion(lead, ctx) {
    if (!lead || !lead.id) return null;
    ctx = ctx || {};
    const estimates = ctx.estimates
      || (Array.isArray(window._estimates) ? window._estimates : []);
    // const taskCache = ctx.taskCache || window._taskCache || {};
    const now = Date.now();

    const computedAt = now;
    const leadId = lead.id;
    const channel = preferredChannel(lead);
    const name = leadName(lead);

    // ── Skip cases ──
    const stage = (lead._stageKey || lead.stage || '').toString().toLowerCase();
    if (TERMINAL_STAGES.has(stage)) {
      return {
        leadId, computedAt,
        priority: 'wait', action: 'wait', channel: null,
        headline: 'No action needed — deal is finalized.',
        reasoning: 'Lead is in a terminal stage (closed / lost / complete).',
        draft: null,
        confidence: 100,
        signals: ['terminal-stage'],
      };
    }
    if (window.LeadSnooze && window.LeadSnooze.isSnoozed && window.LeadSnooze.isSnoozed(lead)) {
      const until = window.LeadSnooze.snoozedUntilDate
        ? window.LeadSnooze.snoozedUntilDate(lead) : null;
      const reason = (lead.snoozedReason || '').trim();
      return {
        leadId, computedAt,
        priority: 'wait', action: 'wait', channel: null,
        headline: 'Snoozed — you set this aside.',
        reasoning: `Snoozed${until ? ' until ' + until.toLocaleDateString() : ''}${reason ? ' · ' + reason : ''}.`,
        draft: null,
        confidence: 100,
        signals: ['snoozed'],
      };
    }

    // ── Engagement signals ──
    const sharedMs = toMillis(lead.lastSharedAt);
    const sharedAgeMs = sharedMs ? (now - sharedMs) : Infinity;
    const isFreshShare = sharedAgeMs < FRESH_24H_MS;
    const isStaleShare = sharedAgeMs >= STALE_SHARE_MS && sharedMs > 0;

    let viewCount = 0;
    let latestViewMs = 0;
    let anyResponded = false;
    for (const e of estimates) {
      if (!e || e.leadId !== lead.id) continue;
      if (e.respondedAt) anyResponded = true;
      const ms = toMillis(e.viewedAt);
      if (ms > 0) {
        viewCount++;
        if (ms > latestViewMs) latestViewMs = ms;
      }
    }
    const isFreshView = latestViewMs > 0 && (now - latestViewMs) < FRESH_24H_MS;

    // Last touch = most recent rep-side activity. Used to detect
    // "engaged customer + cold rep" — the highest-priority signal.
    const lastTouch = Math.max(
      toMillis(lead.updatedAt),
      sharedMs,
      toMillis(lead.createdAt)
    );
    const repCold = (now - lastTouch) >= COLD_REP_MS;

    // ── Decision tree ──

    // 1. Customer responded — close them
    if (anyResponded) {
      return {
        leadId, computedAt,
        priority: 'urgent', action: 'follow-up', channel,
        headline: `Close ${name} — they responded to your estimate`,
        reasoning: 'A customer responding (signed/declined/replied) is the highest-intent signal. Reach out today to lock in next steps.',
        draft: generateDraft(lead, 'responded', channel),
        confidence: 95,
        signals: ['responded', 'high-intent'],
      };
    }

    // 2. Snooze just expired (within 3 days) — they're "back"
    const snoozedUntilMs = toMillis(lead.snoozedUntil);
    if (snoozedUntilMs > 0 && snoozedUntilMs < now && (now - snoozedUntilMs) < 3 * FRESH_24H_MS) {
      return {
        leadId, computedAt,
        priority: 'today', action: 'text', channel,
        headline: `Reach back out to ${name} — their snooze just expired`,
        reasoning: 'You set this aside until recently. Re-engage before the moment cools off.',
        draft: generateDraft(lead, 'snooze-expired', channel),
        confidence: 75,
        signals: ['snooze-expired'],
      };
    }

    // 3. Hot tier — multi-view or fresh-share + view, rep cold
    if (viewCount > 0 && (viewCount >= 2 || isFreshShare) && repCold) {
      return {
        leadId, computedAt,
        priority: 'urgent', action: 'call', channel,
        headline: `Call ${name} now — they viewed your estimate ${viewCount}× recently`,
        reasoning: 'Engaged customer (multi-view or recent share + view) but no rep activity in 24h+. Engaged customers go cold fast — this is the highest-leverage moment.',
        draft: generateDraft(lead, 'fresh-view-hot', channel),
        confidence: 90,
        signals: viewCount >= 2 ? ['multi-view', 'rep-cold'] : ['fresh-share', 'fresh-view', 'rep-cold'],
      };
    }

    // 4. Single view, no response yet
    if (viewCount > 0 && !anyResponded) {
      return {
        leadId, computedAt,
        priority: 'today', action: 'text', channel,
        headline: `Nudge ${name} — they viewed your estimate but haven't responded`,
        reasoning: `Customer opened the portal ${isFreshView ? 'recently' : 'previously'}. A quick check-in often closes the gap.`,
        draft: generateDraft(lead, 'viewed-no-response', channel),
        confidence: isFreshView ? 75 : 55,
        signals: isFreshView ? ['viewed', 'fresh-view'] : ['viewed'],
      };
    }

    // 5. Stale share — sent 5+ days ago, no view (matches W54)
    if (isStaleShare && viewCount === 0) {
      return {
        leadId, computedAt,
        priority: 'today', action: 'text', channel,
        headline: `Re-share with ${name} — link sent 5+ days ago, never opened`,
        reasoning: 'Portal link may have gone to spam, been buried, or never reached them. A re-nudge with a fresh send often unsticks the conversation.',
        draft: generateDraft(lead, 'sent-no-view', channel),
        confidence: 65,
        signals: ['stale-share'],
      };
    }

    // 6. No share yet — first-share moment
    if (sharedMs === 0) {
      return {
        leadId, computedAt,
        priority: 'today', action: 'send-portal', channel,
        headline: `Send portal link to ${name} — first-share moment`,
        reasoning: 'No portal link sent yet. Sharing the customer portal is usually the highest-leverage first move — it surfaces photos + status + estimates in one place.',
        draft: generateDraft(lead, 'first-share', channel),
        confidence: 60,
        signals: ['no-share'],
      };
    }

    // 7. Stale stage (≥7d in stage, no engagement signals)
    const stageStartMs = toMillis(lead.stageStartedAt) || toMillis(lead.updatedAt) || toMillis(lead.createdAt);
    const daysInStage = stageStartMs ? Math.floor((now - stageStartMs) / 86400000) : 0;
    if (daysInStage >= STAGE_AGE_DAYS) {
      return {
        leadId, computedAt,
        priority: 'this-week', action: 'text', channel,
        headline: `Check in with ${name} — ${daysInStage}d in current stage`,
        reasoning: `Lead has sat ${daysInStage} days in "${lead.stage || stage}" without movement. Risk of going cold; a light-touch nudge keeps the relationship alive.`,
        draft: generateDraft(lead, 'viewed-no-response', channel),
        confidence: 45,
        signals: ['stale-stage'],
      };
    }

    // 8. Default — monitor, no action needed
    return {
      leadId, computedAt,
      priority: 'monitor', action: 'wait', channel: null,
      headline: `Watch ${name} — no urgent signal`,
      reasoning: 'No engagement spikes, no overdue follow-up, no rep cold-start. Check back if signals change.',
      draft: null,
      confidence: 30,
      signals: ['no-signal'],
    };
  }

  // ─── Priority comparator ─────────────────────────────────────────
  // For sort surfaces (W115 morning briefing). Higher = more urgent.
  const PRIORITY_ORDER = { 'urgent': 4, 'today': 3, 'this-week': 2, 'monitor': 1, 'wait': 0 };
  function priorityRank(s) {
    return s ? (PRIORITY_ORDER[s.priority] || 0) : 0;
  }

  // Score for ranking: priority bucket × 100 + confidence. Lets us
  // sort an entire pipeline by "what should I act on first" in one
  // pass. Values < 100 are 'wait' / 'monitor' which the morning
  // briefing widget will probably filter out.
  function score(s) {
    if (!s) return 0;
    return priorityRank(s) * 100 + (s.confidence || 0);
  }

  // ─── Public API ──────────────────────────────────────────────────
  window.SmartFollowup = {
    __sentinel: 'nbd-smart-followup-v1',
    computeSuggestion,
    priorityRank,
    score,
    PRIORITY_ORDER,
  };
})();
