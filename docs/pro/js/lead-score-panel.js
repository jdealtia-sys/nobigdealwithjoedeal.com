/**
 * lead-score-panel.js — Wave 137 (customer-page breakdown panel)
 *
 * Wires the #leadScoreChip in the customer header to the
 * NBDLeadScore engine + opens an expandable breakdown card on
 * click. The breakdown shows:
 *
 *   - Score (0-100) and tier label (🔥 Hot / 🌡 Warm / etc.)
 *   - Top reason (single sentence — what to act on)
 *   - Each signal's contribution as a horizontal bar:
 *       Engagement, Stage, Recency, Hot, Smart, Pattern
 *   - Active signal tags ('unread-message', 'multi-view', etc.)
 *   - Smart-followup suggestion details (if available)
 *
 * Path-gated to customer.html (uses #leadScoreChip ID). Auto-runs
 * once when window._customerId resolves and again on every
 * 'nbd:data-refreshed' event so freshly-saved rep activity bumps
 * the score in real time.
 *
 * Render strategy:
 *   - The chip (in the customer-header) is always-present once
 *     resolved — minimal at-a-glance signal for the rep
 *   - The panel (created lazily on first click) sits below the
 *     header, above the tab content — collapsible with a chevron
 */
(function () {
  'use strict';
  if (window.NBDLeadScorePanel
      && window.NBDLeadScorePanel.__sentinel === 'nbd-score-panel-v1') return;

  const PANEL_ID = 'leadScorePanel';
  let _currentBreakdown = null;
  let _panelOpen = false;

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ─── Pull the lead from caches ──────────────────────────────────
  // Prefers the in-memory window._leads cache (already populated by
  // dashboard.html bootstrap on the parent page); falls back to a
  // direct getDoc if customer.html is opened directly.
  async function _getLead() {
    const id = window._customerId;
    if (!id) return null;
    if (Array.isArray(window._leads)) {
      const cached = window._leads.find(l => l && l.id === id);
      if (cached) return cached;
    }
    // Fallback: direct fetch from Firestore. customer.html exposes
    // window.db + window.getDoc + window.doc.
    if (window.db && window.getDoc && window.doc) {
      try {
        const snap = await window.getDoc(window.doc(window.db, 'leads', id));
        if (snap.exists()) return { id: snap.id, ...snap.data() };
      } catch (_) {}
    }
    return null;
  }

  // ─── Render the chip in the header ──────────────────────────────
  function _updateChip(b) {
    const chip = document.getElementById('leadScoreChip');
    const dot = document.getElementById('leadScoreDot');
    const num = document.getElementById('leadScoreNum');
    if (!chip || !dot || !num) return;
    const color = window.NBDLeadScore && window.NBDLeadScore.tierColor
      ? window.NBDLeadScore.tierColor(b.score) : '#64748b';
    chip.style.display = 'inline-flex';
    chip.style.borderColor = color + '88';
    chip.style.background = color + '22';
    chip.style.color = color;
    chip.title = 'Lead score ' + b.score + '/100 (' + b.label + '). ' + (b.topReason || '') + '. Click for breakdown.';
    dot.style.background = color;
    num.textContent = String(b.score);
  }

  // ─── Build / refresh the breakdown panel ────────────────────────
  function _ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;
    // Insert just below the customer-header for prominence — sits
    // above the jump-nav so it's the first thing under the name.
    const header = document.querySelector('.customer-header');
    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText =
      'display:none;margin:14px 0 18px;padding:16px;border-radius:10px;' +
      'background:var(--s, #0f1729);border:1px solid var(--br, #2a3344);';
    if (header && header.parentNode) {
      header.parentNode.insertBefore(panel, header.nextSibling);
    } else {
      document.body.appendChild(panel);
    }
    return panel;
  }

  function _renderPanel(b) {
    const panel = _ensurePanel();
    const color = window.NBDLeadScore && window.NBDLeadScore.tierColor
      ? window.NBDLeadScore.tierColor(b.score) : '#64748b';

    // Bar segment for each signal contribution.
    const weights = b.weights || { engagement: 30, stage: 25, recency: 20, hot: 15, smart: 15, pattern: 5 };
    const parts = b.parts || {};
    const entries = [
      ['Engagement', parts.engagement || 0, weights.engagement, '👁'],
      ['Stage',      parts.stage || 0,      weights.stage,      '📈'],
      ['Recency',    parts.recency || 0,    weights.recency,    '⏱'],
      ['Hot signals',parts.hot || 0,        weights.hot,        '🔥'],
      ['AI priority',parts.smart || 0,      weights.smart,      '🤖'],
      ['Pattern',    parts.pattern || 0,    weights.pattern,    '📊'],
    ];

    const barRows = entries.map(([label, val, max, icon]) => {
      const pct = max > 0 ? Math.min(100, (val / max) * 100) : 0;
      return (
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:7px;font-size:12px;">' +
          '<span style="width:120px;flex-shrink:0;color:var(--m,#94a3b8);">' + _esc(icon) + ' ' + _esc(label) + '</span>' +
          '<div style="flex:1;height:7px;background:var(--bg,#0a1424);border-radius:4px;overflow:hidden;border:1px solid var(--br,#2a3344);">' +
            '<div style="height:100%;background:' + color + ';width:' + pct.toFixed(1) + '%;transition:width 240ms ease;"></div>' +
          '</div>' +
          '<span style="width:54px;text-align:right;font-variant-numeric:tabular-nums;color:var(--t,#fff);font-weight:600;">' +
            (Math.round(val * 10) / 10) + ' / ' + max +
          '</span>' +
        '</div>'
      );
    }).join('');

    const sigTags = (b.signals || []).slice(0, 8).map(sig =>
      '<span style="display:inline-block;padding:2px 8px;background:' + color + '22;color:' + color + ';' +
      'border:1px solid ' + color + '55;border-radius:999px;font-size:10px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;margin:0 4px 4px 0;">' +
      _esc(sig) + '</span>'
    ).join('');

    const sug = b.suggestion || {};
    const sugBlock = (sug.headline || sug.draft) ? (
      '<div style="margin-top:14px;padding:12px;background:var(--bg,#0a1424);border-radius:8px;border:1px solid var(--br,#2a3344);">' +
        '<div style="font-size:10px;color:var(--m,#94a3b8);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;font-weight:600;">AI suggestion</div>' +
        (sug.headline ? '<div style="font-weight:600;font-size:13px;margin-bottom:4px;">' + _esc(sug.headline) + '</div>' : '') +
        (sug.reasoning ? '<div style="font-size:12px;color:var(--m,#94a3b8);margin-bottom:8px;line-height:1.5;">' + _esc(sug.reasoning) + '</div>' : '') +
        (sug.draft ? '<div style="font-size:12px;padding:8px 10px;background:var(--s2,#13171d);border-radius:6px;border-left:2px solid ' + color + ';font-style:italic;">' + _esc(sug.draft) + '</div>' : '') +
      '</div>'
    ) : '';

    panel.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;gap:14px;flex-wrap:wrap;">' +
        '<div style="display:flex;align-items:center;gap:14px;min-width:0;flex:1;">' +
          '<div style="width:64px;height:64px;border-radius:50%;background:' + color + '22;border:3px solid ' + color + ';' +
            'display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:' + color + ';' +
            'font-variant-numeric:tabular-nums;flex-shrink:0;">' +
            b.score +
          '</div>' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-size:11px;color:var(--m,#94a3b8);letter-spacing:.06em;text-transform:uppercase;font-weight:600;margin-bottom:3px;">Lead intelligence</div>' +
            '<div style="font-size:18px;font-weight:700;margin-bottom:3px;">' + _esc(b.label) + '</div>' +
            '<div style="font-size:13px;color:var(--m,#94a3b8);">' + _esc(b.topReason || 'No active signals') + '</div>' +
          '</div>' +
        '</div>' +
        '<button type="button" id="leadScorePanelClose" style="background:transparent;border:none;color:var(--m,#94a3b8);font-size:20px;cursor:pointer;padding:4px 8px;line-height:1;align-self:flex-start;" title="Hide breakdown">×</button>' +
      '</div>' +
      '<div style="margin-bottom:12px;">' + barRows + '</div>' +
      (sigTags ? (
        '<div style="margin-bottom:8px;">' +
          '<div style="font-size:10px;color:var(--m,#94a3b8);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;font-weight:600;">Active signals</div>' +
          sigTags +
        '</div>'
      ) : '') +
      sugBlock;

    const close = panel.querySelector('#leadScorePanelClose');
    if (close) close.addEventListener('click', closePanel);
    panel.style.display = 'block';
    _panelOpen = true;
  }

  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.style.display = 'none';
    _panelOpen = false;
  }

  function togglePanel() {
    if (_panelOpen) {
      closePanel();
    } else if (_currentBreakdown) {
      _renderPanel(_currentBreakdown);
    }
  }

  // ─── Refresh on data events ────────────────────────────────────
  async function refresh() {
    if (!window.NBDLeadScore || typeof window.NBDLeadScore.breakdown !== 'function') return;
    const lead = await _getLead();
    if (!lead) return;
    const ctx = { estimates: window._estimates || [] };
    let b;
    try { b = window.NBDLeadScore.breakdown(lead, ctx); }
    catch (_) { return; }
    _currentBreakdown = b;
    _updateChip(b);
    if (_panelOpen) _renderPanel(b); // keep panel content fresh
  }

  // ─── Bootstrap ─────────────────────────────────────────────────
  function _attach() {
    const chip = document.getElementById('leadScoreChip');
    if (chip && !chip.dataset.bound) {
      chip.dataset.bound = '1';
      chip.addEventListener('click', togglePanel);
    }
    // Wait for window._customerId to be populated by the customer.html
    // bootstrap. Same probe pattern as voice-intel + portal-messages.
    let tries = 0;
    const probe = setInterval(() => {
      tries++;
      if (window._customerId) {
        clearInterval(probe);
        refresh();
      }
      if (tries > 100) clearInterval(probe); // 10s ceiling
    }, 100);

    // Re-render whenever data refreshes — covers the cases where the
    // rep does an action that changes a signal (sends a message,
    // opens an estimate, etc.). The dispatchEvent is already wired
    // by tasks.js, crm.js, portal.js, voice-capture, etc.
    window.addEventListener('nbd:data-refreshed', () => { refresh(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attach, { once: true });
  } else {
    setTimeout(_attach, 0);
  }

  window.NBDLeadScorePanel = {
    __sentinel: 'nbd-score-panel-v1',
    refresh,
    togglePanel,
    closePanel,
  };
})();
