/**
 * lead-score.js — Wave 135 — unified lead-priority engine
 *
 * Opens the Lead Intelligence arc. Combines every signal NBD already
 * collects into ONE 0-100 score per lead, plus a breakdown so the
 * customer page can show "why" this lead is hot/warm/cold.
 *
 * Six signal sources, weighted into a single number:
 *   - Engagement tier (0-30) ......... W92 customer-engagement-score
 *   - Stage gravity (0-25) ........... how close to close
 *   - Recency (0-20) ................. exp decay from last activity
 *   - Hot signals (0-15) ............. unread messages, recent uploads,
 *                                       callback requests
 *   - Smart-followup priority (0-15) . W111 deterministic heuristic
 *   - Pattern boost (0-5) ............ W116 personal-adjustment delta
 *
 * Total clamps to 0-100. Threshold buckets:
 *   80+ → 🔥 hot      (call today)
 *   60+ → 🌡 warm     (call this week)
 *   40+ → 💧 lukewarm (monitor)
 *   20+ → 💤 cold     (low priority)
 *    0+ → 🪦 dead     (skip / archive candidate)
 *
 * Public API (path-gated to nothing — pure helper):
 *   NBDLeadScore.score(lead)
 *     → number 0-100
 *
 *   NBDLeadScore.breakdown(lead, ctx?)
 *     → {
 *         score:     number,         // 0-100
 *         tier:      'hot'|'warm'|'lukewarm'|'cold'|'dead',
 *         label:     string,         // 🔥 Hot
 *         parts:     { engagement, stage, recency, hot, smart, pattern },
 *         signals:   string[],       // ['unread-message', 'multi-view', ...]
 *         topReason: string,         // single-line explanation
 *       }
 *
 *   NBDLeadScore.top(n=10, opts?)
 *     → top N leads from window._leads, sorted by score descending,
 *       each carrying its breakdown
 *
 *   NBDLeadScore.tier(score)         → 'hot'|'warm'|'lukewarm'|'cold'|'dead'
 *   NBDLeadScore.tierLabel(score)    → '🔥 Hot' etc.
 *
 * The score is computed live on each call — no caching. With <2000
 * leads in memory the math is sub-millisecond, and live computation
 * means a homeowner action (W118 photo, W119 callback, W123 message,
 * W121 rating) is reflected on the next render without manual refresh.
 *
 * If a downstream consumer needs frequent recomputation (e.g. the
 * kanban renders 50 cards 60×/sec during a drag), they should
 * memoize at their own layer — the engine itself is intentionally
 * stateless and side-effect-free.
 */
(function () {
  'use strict';
  if (window.NBDLeadScore && window.NBDLeadScore.__sentinel === 'nbd-lead-score-v1') return;

  // ─── Constants ──────────────────────────────────────────────────
  const WEIGHTS = Object.freeze({
    engagement: 30,
    stage:      25,
    recency:    20,
    hot:        15,
    smart:      15,
    pattern:     5,
  });
  // Note: total can exceed 100 by design — gives leads with multiple
  // strong signals headroom above ones with just one. Final clamp to
  // 0-100 happens at the end.

  // Stage → 0-25 gravity. Raw stage keys + display variants. The
  // values intentionally compress at the high end so a 'completed'
  // lead isn't ranked above a 'estimate-sent-and-actively-viewing'
  // one (which is where the rep should focus closing energy).
  const STAGE_GRAVITY = Object.freeze({
    new:                    5,
    contacted:              8,
    inspection_scheduled:  12,
    inspection_completed:  14,
    inspected:             14,
    estimate_sent:         18,   // peak value: ready to close
    quote_sent:            18,
    contract_signed:       20,
    job_created:           18,
    permit_pulled:         16,
    materials_ordered:     16,
    install_scheduled:     14,
    install_in_progress:   12,
    install_complete:       8,   // post-install drops because the
    final_payment:          5,   // primary sales work is done
    completed:              4,
    closed:                 4,
    // Negative outcomes
    rejected:              0,
    closed_lost:           0,
    archived:              0,
    cold:                  3,
  });

  // Tier thresholds — same vocabulary as W92 engagement but applied
  // to the unified score so the rep has ONE consistent ladder.
  const TIERS = [
    { min: 80, name: 'hot',      label: '🔥 Hot',      color: '#ef4444' },
    { min: 60, name: 'warm',     label: '🌡 Warm',     color: '#f59e0b' },
    { min: 40, name: 'lukewarm', label: '💧 Lukewarm', color: '#3b82f6' },
    { min: 20, name: 'cold',     label: '💤 Cold',     color: '#64748b' },
    { min:  0, name: 'dead',     label: '🪦 Dead',     color: '#475569' },
  ];

  // Day in milliseconds — used for the recency decay.
  const DAY_MS = 86_400_000;

  // ─── Helpers ────────────────────────────────────────────────────
  function _toMillis(ts) {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts;
    if (typeof ts.toMillis === 'function') {
      try { return ts.toMillis(); } catch (_) { return 0; }
    }
    if (typeof ts.seconds === 'number') return ts.seconds * 1000;
    if (ts instanceof Date) return ts.getTime();
    if (typeof ts === 'string') {
      const n = Date.parse(ts);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  function _normalizeStage(lead) {
    const raw = lead && (lead._stageKey || lead.stage) || 'new';
    return String(raw).toLowerCase().trim().replace(/[\s-]/g, '_');
  }

  // ─── Signal scorers ─────────────────────────────────────────────

  // Engagement (0-30). Tier from customer-engagement-score.js (W92):
  //   tier 4 (Responded) → 30
  //   tier 3 (Hot)       → 24
  //   tier 2 (Viewed)    → 16
  //   tier 1 (Sent)      →  8
  //   tier 0 (New)       →  0
  function _scoreEngagement(lead, ctx) {
    if (typeof window.computeTier !== 'function') return 0;
    let tier;
    try {
      tier = window.computeTier(lead, ctx && ctx.estimates) || { tier: 0 };
    } catch (_) {
      return 0;
    }
    const map = { 4: 30, 3: 24, 2: 16, 1: 8, 0: 0 };
    return map[tier.tier] || 0;
  }

  // Stage gravity (0-25). Compressed so 'estimate_sent' and
  // 'contract_signed' are the peak; post-job stages drop because
  // sales energy doesn't belong there.
  function _scoreStage(lead) {
    const key = _normalizeStage(lead);
    if (key in STAGE_GRAVITY) return STAGE_GRAVITY[key];
    // Unknown stage: middle-of-pack so we don't surprise the rep.
    return 10;
  }

  // Recency (0-20). Exponential decay from the freshest activity
  // timestamp. 0 days → 20, 1 day → ~16, 3 days → ~10, 7 days → ~4,
  // 14+ days → ~0.
  function _scoreRecency(lead) {
    const lastMs = Math.max(
      _toMillis(lead.updatedAt),
      _toMillis(lead.createdAt),
      _toMillis(lead.lastSharedAt),
      _toMillis(lead.lastHomeownerMessageAt),
      _toMillis(lead.lastUploadAt)
    );
    if (!lastMs) return 0;
    const days = Math.max(0, (Date.now() - lastMs) / DAY_MS);
    // 20 * exp(-days / 4) — half-life of about 2.8 days.
    const v = 20 * Math.exp(-days / 4);
    return Math.max(0, Math.min(20, v));
  }

  // Hot signals (0-15). Discrete +N for each fresh customer-side
  // event. Caps at 15 — a lead with both a callback request AND an
  // unread message AND a recent photo upload tops out.
  function _scoreHot(lead, signals) {
    let h = 0;
    const now = Date.now();

    // Unread homeowner messages — the loudest signal.
    if ((lead.unreadHomeownerMessages || 0) > 0) {
      h += 8;
      signals.push('unread-message');
    }

    // Last homeowner message within 24h — even after read.
    const lastMsgMs = _toMillis(lead.lastHomeownerMessageAt);
    if (lastMsgMs && (now - lastMsgMs) < DAY_MS) {
      h += 3;
      signals.push('fresh-message');
    }

    // Last homeowner photo upload within 48h.
    const lastUploadMs = _toMillis(lead.lastUploadAt);
    if (lastUploadMs && (now - lastUploadMs) < 2 * DAY_MS) {
      h += 4;
      signals.push('recent-upload');
    }

    // Pending callback request (task with source='homeowner_callback'
    // due today or earlier). We can't query subcollections without a
    // round-trip, so we approximate via lead.lastCallbackAt freshness
    // — rep should treat any callback within 48h as hot.
    const lastCbMs = _toMillis(lead.lastCallbackAt);
    if (lastCbMs && (now - lastCbMs) < 2 * DAY_MS) {
      h += 5;
      signals.push('callback-requested');
    }

    // 1-3★ rating from homeowner = recovery-call needed (high-priority).
    if (typeof lead.customerRating === 'number'
        && lead.customerRating >= 1 && lead.customerRating <= 3) {
      h += 6;
      signals.push('recovery-needed');
    }

    return Math.min(15, h);
  }

  // Smart-followup priority (0-15). Reuses W111's deterministic
  // heuristic. priorityRank: 4=urgent, 3=today, 2=this-week,
  // 1=monitor, 0=wait. Confidence multiplies into the value.
  function _scoreSmart(lead, ctx, signals) {
    if (!window.SmartFollowup || typeof window.SmartFollowup.computeSuggestion !== 'function') {
      return { value: 0, suggestion: null };
    }
    let sug;
    try {
      sug = window.SmartFollowup.computeSuggestion(lead, ctx || {});
    } catch (_) {
      return { value: 0, suggestion: null };
    }
    if (!sug) return { value: 0, suggestion: null };

    const PRI_BASE = { urgent: 15, today: 11, 'this-week': 7, monitor: 3, wait: 0 };
    const base = PRI_BASE[sug.priority] || 0;
    const conf = Math.max(0, Math.min(1, (sug.confidence || 0) / 100));
    // Confidence dampens the signal slightly so a low-confidence
    // 'urgent' doesn't dominate a high-confidence 'today'.
    const value = base * (0.5 + 0.5 * conf);

    if (Array.isArray(sug.signals)) signals.push(...sug.signals);
    return { value, suggestion: sug };
  }

  // Pattern boost (0-5). W116's getPersonalAdjustment ranges -15 to
  // +15. We map to 0-5 with neutral at the midpoint so the rep's
  // personal pattern can nudge but never dominate.
  function _scorePattern(lead, sigList) {
    if (!window.SmartFollowup || typeof window.SmartFollowup.getPersonalAdjustment !== 'function') {
      return 0;
    }
    let adjust = 0;
    try {
      adjust = window.SmartFollowup.getPersonalAdjustment(sigList) || 0;
    } catch (_) { return 0; }
    // Map [-15, +15] → [0, 5] with -15 → 0, 0 → 2.5, +15 → 5.
    const mapped = ((adjust + 15) / 30) * 5;
    return Math.max(0, Math.min(5, mapped));
  }

  // ─── Top-reason picker ─────────────────────────────────────────
  // The single line shown next to the score badge. Picks the most
  // motivating signal from the breakdown — the rep cares more about
  // "homeowner just messaged you" than "score 87 because of stage".
  function _topReason(lead, parts, signals, suggestion) {
    if (signals.includes('unread-message')) return 'Unread message from homeowner';
    if (signals.includes('callback-requested')) return 'Callback requested';
    if (signals.includes('recovery-needed')) return 'Low rating — recovery needed';
    if (signals.includes('recent-upload')) return 'Homeowner uploaded a photo';
    if (signals.includes('fresh-message')) return 'Fresh homeowner activity';
    if (suggestion && suggestion.headline) return suggestion.headline;
    if (parts.engagement >= 24) return 'Hot engagement on estimate';
    if (parts.engagement >= 16) return 'Estimate viewed recently';
    if (parts.recency >= 14) return 'Active lead';
    if (parts.recency < 4) return 'Going cold';
    return 'Standard follow-up';
  }

  // ─── Public API ────────────────────────────────────────────────
  function breakdown(lead, ctx) {
    if (!lead || typeof lead !== 'object') {
      return { score: 0, tier: 'dead', label: '🪦 Dead', parts: {}, signals: [], topReason: '' };
    }
    const signals = [];
    const eng = _scoreEngagement(lead, ctx);
    const stg = _scoreStage(lead);
    const rec = _scoreRecency(lead);
    const hot = _scoreHot(lead, signals);
    const smart = _scoreSmart(lead, ctx, signals);
    const pat = _scorePattern(lead, signals);

    const raw = eng + stg + rec + hot + smart.value + pat;
    const score = Math.max(0, Math.min(100, Math.round(raw)));

    const parts = {
      engagement: Math.round(eng * 10) / 10,
      stage:      Math.round(stg * 10) / 10,
      recency:    Math.round(rec * 10) / 10,
      hot:        Math.round(hot * 10) / 10,
      smart:      Math.round(smart.value * 10) / 10,
      pattern:    Math.round(pat * 10) / 10,
    };

    return {
      score,
      tier: tier(score),
      label: tierLabel(score),
      parts,
      weights: WEIGHTS,
      signals: Array.from(new Set(signals)), // dedupe
      topReason: _topReason(lead, parts, signals, smart.suggestion),
      suggestion: smart.suggestion || null,
    };
  }

  function score(lead, ctx) { return breakdown(lead, ctx).score; }

  function tier(s) {
    const v = Number(s) || 0;
    for (const t of TIERS) if (v >= t.min) return t.name;
    return 'dead';
  }
  function tierLabel(s) {
    const v = Number(s) || 0;
    for (const t of TIERS) if (v >= t.min) return t.label;
    return '🪦 Dead';
  }
  function tierColor(s) {
    const v = Number(s) || 0;
    for (const t of TIERS) if (v >= t.min) return t.color;
    return '#475569';
  }

  // top(n) — sort window._leads by score, return top N with breakdowns.
  // Skips snoozed/archived leads. Caller can pass {includeSnoozed:true}
  // to override.
  function top(n, opts) {
    n = Math.max(1, Math.min(100, Number(n) || 10));
    opts = opts || {};
    const leads = Array.isArray(window._leads) ? window._leads : [];
    const ctx = { estimates: window._estimates || [] };
    const scored = [];
    for (const lead of leads) {
      if (!lead || lead.deleted) continue;
      if (!opts.includeSnoozed && window.LeadSnooze && window.LeadSnooze.isSnoozed
          && window.LeadSnooze.isSnoozed(lead)) continue;
      const b = breakdown(lead, ctx);
      scored.push({ lead, ...b });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, n);
  }

  // Bulk score for kanban-card rendering — single ctx prep per call,
  // returns a Map<leadId, breakdown> the renderer can lookup.
  function scoreAll(leads) {
    const ctx = { estimates: window._estimates || [] };
    const out = new Map();
    const arr = Array.isArray(leads) ? leads : (window._leads || []);
    for (const lead of arr) {
      if (!lead || !lead.id) continue;
      out.set(lead.id, breakdown(lead, ctx));
    }
    return out;
  }

  window.NBDLeadScore = {
    __sentinel: 'nbd-lead-score-v1',
    score,
    breakdown,
    top,
    scoreAll,
    tier,
    tierLabel,
    tierColor,
    WEIGHTS,
    TIERS,
  };
})();
