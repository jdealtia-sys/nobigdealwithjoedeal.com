/**
 * lead-score-alert.js — Wave 139 (hot-lead threshold-crossing alert)
 *
 * One-shot toast when a lead's W135 score crosses INTO Hot tier
 * (≥80) since the rep last saw it. The W136 kanban card shows the
 * trend arrow but only when the rep is actively looking at the
 * board — this fires the moment a homeowner action bumps a lead
 * over the line, even if the rep is on a different tab.
 *
 * Detection runs on every `nbd:data-refreshed` event:
 *   - For each lead, compute current W135 score
 *   - Compare against last-seen score from W136's localStorage cache
 *     (nbd_lead_score_last_v1 — same key, no duplicate state)
 *   - If a lead crossed from <80 → ≥80 since last fire, queue a toast
 *   - Per-session dedup via in-memory Set so a single transient
 *     bump doesn't fire the toast twice
 *   - localStorage flag (nbd_lead_alert_fired_v1) records the
 *     last-fired timestamp per lead so we don't re-alert on every
 *     reload while a lead stays in Hot tier
 *
 * Toast click → opens that lead's customer page.
 *
 * Path-gated to dashboard.html (where the kanban + bell live —
 * customer.html is already inside a single lead, so the
 * cross-lead alert wouldn't be useful there).
 */
(function () {
  'use strict';
  if (window.NBDLeadAlert
      && window.NBDLeadAlert.__sentinel === 'nbd-lead-alert-v1') return;

  const HOT_THRESHOLD = 80;
  const ALERT_FLAG_KEY = 'nbd_lead_alert_fired_v1';
  const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours per lead
  const _firedThisSession = new Set();

  function _readLastSeen() {
    try {
      const raw = localStorage.getItem('nbd_lead_score_last_v1');
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  function _readAlertFired() {
    try {
      const raw = localStorage.getItem(ALERT_FLAG_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }

  function _writeAlertFired(map) {
    try { localStorage.setItem(ALERT_FLAG_KEY, JSON.stringify(map)); }
    catch (_) {}
  }

  // ─── Toast — uses the existing showToast if available, else a
  // floating fixed-position div with a click handler.
  function _showHotToast(lead, breakdown) {
    const name = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim()
      || lead.address || 'Lead';
    const reason = breakdown.topReason || 'Lead just went hot';
    const msg = '🔥 ' + name + ' is now Hot (' + breakdown.score + '/100). ' + reason;

    // Existing toast — fastest path. Doesn't accept a click handler
    // so we render our own when we want the click-to-open behavior.
    // Try the rich path first.
    if (typeof window.showToast === 'function') {
      try {
        window.showToast(msg, 'success');
      } catch (_) {}
    }

    // Custom click-to-open card on top of any showToast — gives the
    // rep one tap into the lead. Self-dismisses after 12s. Stacks
    // bottom-up if multiple alerts fire in quick succession.
    const stackId = 'nbd-lead-alert-stack';
    let stack = document.getElementById(stackId);
    if (!stack) {
      stack = document.createElement('div');
      stack.id = stackId;
      stack.style.cssText =
        'position:fixed;bottom:90px;right:20px;z-index:10005;' +
        'display:flex;flex-direction:column;gap:8px;align-items:flex-end;' +
        'pointer-events:none;';
      document.body.appendChild(stack);
    }
    const card = document.createElement('button');
    card.type = 'button';
    card.style.cssText =
      'pointer-events:auto;background:#1a1f2e;border:1px solid #ef4444;' +
      'border-left:4px solid #ef4444;border-radius:8px;padding:10px 14px;' +
      'color:#e2e8f0;font:inherit;font-size:13px;text-align:left;' +
      'box-shadow:0 6px 22px rgba(239,68,68,0.35);cursor:pointer;' +
      'max-width:340px;display:flex;align-items:flex-start;gap:8px;' +
      'animation:nbd-lead-alert-in 240ms ease-out;';
    card.innerHTML =
      '<span style="font-size:20px;line-height:1;flex-shrink:0;">🔥</span>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-weight:700;margin-bottom:2px;">' +
          (name.replace(/[<>&]/g, '')) + ' is now Hot' +
        '</div>' +
        '<div style="font-size:11px;color:#94a3b8;line-height:1.45;">' +
          'Score ' + breakdown.score + '/100 · ' + (reason.replace(/[<>&]/g, '')) +
        '</div>' +
        '<div style="font-size:10px;color:#fca5a5;margin-top:4px;letter-spacing:.04em;">Tap to open</div>' +
      '</div>';
    card.addEventListener('click', () => {
      // Best-effort open: try in-app handler first, then deep link.
      if (typeof window.openCardDetail === 'function') {
        try { window.openCardDetail(lead.id); _dismiss(card); return; } catch (_) {}
      }
      window.location.href = '/pro/customer.html?id=' + encodeURIComponent(lead.id);
    });
    stack.appendChild(card);

    // Inject keyframes once.
    if (!document.getElementById('nbd-lead-alert-css')) {
      const css = document.createElement('style');
      css.id = 'nbd-lead-alert-css';
      css.textContent =
        '@keyframes nbd-lead-alert-in {' +
          'from { opacity:0; transform:translateX(20px); }' +
          'to { opacity:1; transform:translateX(0); }' +
        '}';
      document.head.appendChild(css);
    }

    // Auto-dismiss after 12 seconds.
    setTimeout(() => _dismiss(card), 12_000);
  }

  function _dismiss(card) {
    if (!card || !card.parentNode) return;
    card.style.transition = 'opacity 240ms ease, transform 240ms ease';
    card.style.opacity = '0';
    card.style.transform = 'translateX(20px)';
    setTimeout(() => { try { card.remove(); } catch (_) {} }, 240);
  }

  // ─── Detect crossings on every data refresh ───────────────────
  function _check() {
    if (!window.NBDLeadScore || typeof window.NBDLeadScore.score !== 'function') return;
    const leads = Array.isArray(window._leads) ? window._leads : [];
    if (leads.length === 0) return;
    const ctx = { estimates: window._estimates || [] };
    const lastSeen = _readLastSeen();
    const alertFired = _readAlertFired();
    const now = Date.now();
    let updatedAlerts = false;

    for (const lead of leads) {
      if (!lead || lead.deleted || !lead.id) continue;
      // Skip snoozed leads — the rep deliberately quieted them.
      if (window.LeadSnooze && window.LeadSnooze.isSnoozed
          && window.LeadSnooze.isSnoozed(lead)) continue;
      let breakdown;
      try { breakdown = window.NBDLeadScore.breakdown(lead, ctx); }
      catch (_) { continue; }
      if (!breakdown) continue;

      const cur = breakdown.score;
      const prev = typeof lastSeen[lead.id] === 'number' ? lastSeen[lead.id] : null;

      // Crossed from cold-side into hot? Both prev<80 AND cur>=80
      // required so a fresh lead that boots straight into Hot tier
      // (e.g. an existing Hot lead loaded for the first time on a
      // new device) doesn't immediately fire — only an actual
      // crossing during an active session does.
      if (prev !== null && prev < HOT_THRESHOLD && cur >= HOT_THRESHOLD) {
        if (_firedThisSession.has(lead.id)) continue;
        const lastAlertMs = alertFired[lead.id] || 0;
        if (now - lastAlertMs < ALERT_COOLDOWN_MS) continue;

        _firedThisSession.add(lead.id);
        alertFired[lead.id] = now;
        updatedAlerts = true;
        _showHotToast(lead, breakdown);
      }
    }

    if (updatedAlerts) _writeAlertFired(alertFired);
  }

  // Listen for data refreshes from anywhere in the app — leads,
  // tasks, voice captures, portal events all dispatch this event.
  window.addEventListener('nbd:data-refreshed', () => {
    // W159 HIGH #7: defer 2s to align with W136's debounced
    // localStorage flush (crm.js _scheduleLeadScorePersist uses a
    // 1500ms timer). The previous 200ms wait was consistently
    // shorter than the persist debounce, so _readLastSeen() would
    // return the PRIOR-render score map, missing the actual
    // crossing event. Now the read happens after the new score is
    // persisted to localStorage.
    setTimeout(_check, 2000);
  });

  // Also run a delayed initial check so a homeowner action that
  // happened while the rep was offline can fire when they open
  // dashboard. The existing pageshow + bfcache reload handlers
  // ensure the leads cache is fresh by the time this fires.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(_check, 4000), { once: true });
  } else {
    setTimeout(_check, 4000);
  }

  window.NBDLeadAlert = {
    __sentinel: 'nbd-lead-alert-v1',
    check: _check,
    threshold: HOT_THRESHOLD,
  };
})();
