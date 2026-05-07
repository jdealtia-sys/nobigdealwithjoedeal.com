/**
 * daily-brief.js — Wave 161 (Daily Morning Brief — anchor surface)
 *
 * Opens the "first thing the rep sees each morning" surface. Pulls
 * from data already in memory (no new fetches) and aggregates the
 * pieces a rep needs to orient their day:
 *
 *   - One-line AI opener via Claude ("You have 3 callbacks today,
 *     2 hot leads cooling, and 1 unread homeowner message. Closest
 *     opportunity: Sarah Mills — estimate sent 3 days ago, viewed
 *     7 times.")
 *   - Today's callbacks  ............... lead.lastCallbackAt within 48h
 *   - Hot leads needing attention ...... NBDLeadScore.top filtered ≥70
 *   - Unread homeowner messages ........ lead.unreadHomeownerMessages>0
 *   - New homeowner uploads ............ lead.lastUploadAt within 48h
 *   - Yesterday's wins ................. estimates signed yesterday
 *
 * Auto-opens on the first dashboard load of each calendar day
 * (localStorage flag), 3500ms after the page settles so the rep
 * isn't interrupted mid-action. After that day's first show, all
 * re-opens for the same day skip the AI call (cached opener) and
 * the auto-open suppression flag prevents re-popping if the rep
 * navigates away and back.
 *
 * Path-gated to dashboard.html (the home base where the rep lands).
 * Customer.html is already inside a single lead — a cross-lead
 * brief there would be jarring.
 *
 * Public API:
 *   window.NBDDailyBrief.open()           — open manually
 *   window.NBDDailyBrief.dismissForToday()
 *   window.NBDDailyBrief.disableAutoOpen()
 *   window.NBDDailyBrief.enableAutoOpen()
 */
(function () {
  'use strict';
  if (window.NBDDailyBrief
      && window.NBDDailyBrief.__sentinel === 'nbd-daily-brief-v1') return;

  const STORAGE_KEY = 'nbd_daily_brief_state_v1';
  const MODAL_ID = 'nbd-daily-brief-modal';
  const AUTO_OPEN_DELAY_MS = 3500;
  const HOT_FLOOR = 70;            // include in "hot leads" section
  const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000;
  const MAX_HOT_LEADS = 5;
  const MAX_CALLBACKS = 5;
  const MAX_MESSAGES = 5;

  // ─── Path gate ────────────────────────────────────────────────
  // Dashboard-only. The path can be /pro/dashboard.html or just
  // /pro/ (index.html that redirects) — be liberal about matching.
  function _onDashboard() {
    const p = (window.location && window.location.pathname || '').toLowerCase();
    return p.indexOf('/pro/dashboard') !== -1
      || /\/pro\/?(?:\?|#|$)/.test(p);
  }

  // ─── State persistence ────────────────────────────────────────
  function _readState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function _writeState(patch) {
    try {
      const cur = _readState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign(cur, patch)));
    } catch (_) {}
  }

  function _todayKey() {
    // Local-tz YYYY-MM-DD. localStorage is per-device so respecting
    // the device's clock is what the rep actually means by "today".
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function _shownToday() {
    const s = _readState();
    return s.lastShownDate === _todayKey();
  }
  function _markShown() {
    _writeState({ lastShownDate: _todayKey() });
  }

  // ─── Helpers ──────────────────────────────────────────────────
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function _toMillis(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') {
      try { return v.toMillis(); } catch (_) { return 0; }
    }
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    if (v instanceof Date) return v.getTime();
    return 0;
  }
  function _name(lead) {
    if (!lead) return 'Lead';
    const n = ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim();
    return n || lead.address || lead.email || 'Lead';
  }
  function _money(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '$0';
    if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (n >= 10_000)    return '$' + Math.round(n / 1000) + 'k';
    return '$' + Math.round(n).toLocaleString();
  }
  function _firstName() {
    // Try several spots the rep's first name might live in.
    const u = window._user || {};
    if (u.firstName) return u.firstName;
    if (u.displayName) return String(u.displayName).split(/\s+/)[0];
    try {
      const auth = window.firebase && window.firebase.auth && window.firebase.auth();
      const cu = auth && auth.currentUser;
      if (cu && cu.displayName) return String(cu.displayName).split(/\s+/)[0];
      if (cu && cu.email) return String(cu.email).split('@')[0];
    } catch (_) {}
    return 'there';
  }
  function _greeting() {
    const h = new Date().getHours();
    if (h < 5)  return 'Burning the midnight oil';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 22) return 'Good evening';
    return 'Late shift';
  }

  // ─── Data aggregation ─────────────────────────────────────────
  function _gather() {
    const leads = Array.isArray(window._leads) ? window._leads : [];
    const ests = Array.isArray(window._estimates) ? window._estimates : [];
    const now = Date.now();

    // Callbacks — within last 48h, freshest first.
    const callbacks = [];
    // Unread messages — homeowner sent us something.
    const unread = [];
    // Recent uploads — homeowner shared a photo.
    const uploads = [];

    for (const l of leads) {
      if (!l || l.deleted) continue;
      const cbMs = _toMillis(l.lastCallbackAt);
      if (cbMs && (now - cbMs) < RECENT_WINDOW_MS) {
        callbacks.push({ lead: l, ts: cbMs });
      }
      const um = Number(l.unreadHomeownerMessages || 0);
      if (um > 0) {
        const lastMsg = _toMillis(l.lastHomeownerMessageAt);
        unread.push({ lead: l, count: um, ts: lastMsg });
      }
      const upMs = _toMillis(l.lastUploadAt);
      if (upMs && (now - upMs) < RECENT_WINDOW_MS) {
        uploads.push({ lead: l, ts: upMs });
      }
    }
    callbacks.sort((a, b) => b.ts - a.ts);
    unread.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    uploads.sort((a, b) => b.ts - a.ts);

    // Hot leads — reuse W135's top() helper if available. Keep only
    // those at score ≥ HOT_FLOOR. Filter out any we already showed
    // in callbacks / unread so the same lead doesn't appear in two
    // sections.
    let hot = [];
    if (window.NBDLeadScore && typeof window.NBDLeadScore.top === 'function') {
      try {
        const dupIds = new Set([
          ...callbacks.map(c => c.lead.id),
          ...unread.map(u => u.lead.id),
        ]);
        hot = window.NBDLeadScore.top(MAX_HOT_LEADS * 3)
          .filter(r => r.score >= HOT_FLOOR && !dupIds.has(r.lead.id))
          .slice(0, MAX_HOT_LEADS);
      } catch (e) {
        console.warn('[daily-brief] lead-score.top failed:', e);
      }
    }

    // Yesterday's wins — estimates signed within the last 24h.
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    let signedYesterday = 0;
    let signedYesterdayTotal = 0;
    for (const e of ests) {
      const sm = _toMillis(e.signedAt);
      if (sm && sm >= oneDayAgo && sm <= now) {
        signedYesterday++;
        signedYesterdayTotal += Number(e.grandTotal || e.total) || 0;
      }
    }

    return {
      callbacks: callbacks.slice(0, MAX_CALLBACKS),
      unread:    unread.slice(0, MAX_MESSAGES),
      uploads:   uploads.slice(0, MAX_MESSAGES),
      hot,
      signedYesterday,
      signedYesterdayTotal,
      totalLeads: leads.length,
    };
  }

  // ─── AI opener via Claude ─────────────────────────────────────
  // Cached per calendar day — same opener for re-opens, no new
  // API spend. Falls back gracefully if Claude isn't reachable.
  async function _aiOpener(data) {
    const cacheKey = _todayKey();
    const s = _readState();
    if (s.openerDate === cacheKey && typeof s.openerText === 'string') {
      return s.openerText;
    }

    // No Claude available → fall back to deterministic summary.
    if (typeof window.callClaude !== 'function') {
      return _fallbackOpener(data);
    }

    // Build a compact prompt — names + counts only, no PII beyond
    // what the rep already sees. Output is short by design.
    const facts = [];
    if (data.callbacks.length) {
      facts.push(data.callbacks.length + ' callback' + (data.callbacks.length === 1 ? '' : 's') + ' requested in the last 48h');
    }
    if (data.unread.length) {
      const total = data.unread.reduce((s, u) => s + u.count, 0);
      facts.push(total + ' unread homeowner message' + (total === 1 ? '' : 's'));
    }
    if (data.uploads.length) {
      facts.push(data.uploads.length + ' new homeowner photo' + (data.uploads.length === 1 ? '' : 's'));
    }
    if (data.hot.length) {
      facts.push(data.hot.length + ' hot lead' + (data.hot.length === 1 ? '' : 's')
        + ' (top: ' + _name(data.hot[0].lead) + ' at ' + data.hot[0].score + '/100 — ' + (data.hot[0].topReason || 'high score') + ')');
    }
    if (data.signedYesterday) {
      facts.push(data.signedYesterday + ' estimate' + (data.signedYesterday === 1 ? '' : 's')
        + ' signed in the last 24h totaling ' + _money(data.signedYesterdayTotal));
    }
    if (!facts.length) {
      facts.push('No urgent signals today — good time to prospect or follow up on warm leads');
    }

    const prompt = 'You are an upbeat field rep coach. Given the rep\'s morning facts, write ONE motivating sentence (max 25 words) that orients their day. No filler, no greetings, no lists. Just the sentence.\n\nFacts:\n- ' + facts.join('\n- ') + '\n\nSentence:';

    try {
      const result = await Promise.race([
        window.callClaude({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 120,
          messages: [{ role: 'user', content: prompt }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
      ]);
      let text = '';
      if (result && Array.isArray(result.content)) {
        for (const c of result.content) {
          if (c && c.type === 'text' && typeof c.text === 'string') text += c.text;
        }
      }
      text = String(text || '').trim().replace(/^"+|"+$/g, '');
      // Defensive: if Claude over-shot, hard-trim to one sentence.
      const firstStop = text.search(/(?:[.!?])(?:\s|$)/);
      if (firstStop > 0 && firstStop < text.length - 1) {
        text = text.slice(0, firstStop + 1);
      }
      if (!text) return _fallbackOpener(data);
      _writeState({ openerDate: cacheKey, openerText: text });
      return text;
    } catch (e) {
      console.warn('[daily-brief] Claude opener failed:', e && e.message);
      return _fallbackOpener(data);
    }
  }

  function _fallbackOpener(data) {
    const parts = [];
    if (data.callbacks.length) parts.push(data.callbacks.length + ' callback' + (data.callbacks.length === 1 ? '' : 's'));
    if (data.unread.length) {
      const t = data.unread.reduce((s, u) => s + u.count, 0);
      parts.push(t + ' unread message' + (t === 1 ? '' : 's'));
    }
    if (data.hot.length) parts.push(data.hot.length + ' hot lead' + (data.hot.length === 1 ? '' : 's'));
    if (!parts.length) return 'Quiet morning — great time to reach out to warm leads.';
    return 'You have ' + parts.join(', ').replace(/, ([^,]*)$/, ' and $1') + ' to handle.';
  }

  // ─── Modal render ─────────────────────────────────────────────
  function _renderRow(emoji, label, sub, leadId) {
    const safe = _esc(label);
    const safeSub = _esc(sub || '');
    return '<div class="nbd-db-row"' + (leadId ? ' data-leadid="' + _esc(leadId) + '"' : '') + ' style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;cursor:' + (leadId ? 'pointer' : 'default') + ';transition:background 120ms ease;">' +
      '<span style="font-size:18px;line-height:1;flex-shrink:0;">' + emoji + '</span>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-weight:600;color:#e2e8f0;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + safe + '</div>' +
        (sub ? '<div style="color:#94a3b8;font-size:11px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + safeSub + '</div>' : '') +
      '</div>' +
      (leadId ? '<span style="color:#64748b;font-size:14px;flex-shrink:0;">›</span>' : '') +
    '</div>';
  }

  function _renderSection(title, html) {
    if (!html) return '';
    return '<div style="margin-bottom:14px;">' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px;padding-left:4px;">' + _esc(title) + '</div>' +
      html +
    '</div>';
  }

  function _buildBody(data) {
    let html = '';

    // Callbacks
    if (data.callbacks.length) {
      const rows = data.callbacks.map(c => {
        const ago = _ago(c.ts);
        return _renderRow('📞', _name(c.lead), 'Callback requested ' + ago, c.lead.id);
      }).join('');
      html += _renderSection('Callbacks (last 48h)', rows);
    }

    // Unread messages
    if (data.unread.length) {
      const rows = data.unread.map(u => {
        return _renderRow('💬', _name(u.lead),
          u.count + ' unread message' + (u.count === 1 ? '' : 's'), u.lead.id);
      }).join('');
      html += _renderSection('Unread messages', rows);
    }

    // Uploads
    if (data.uploads.length) {
      const rows = data.uploads.map(u => {
        const ago = _ago(u.ts);
        return _renderRow('📷', _name(u.lead), 'Uploaded a photo ' + ago, u.lead.id);
      }).join('');
      html += _renderSection('New homeowner photos', rows);
    }

    // Hot leads
    if (data.hot.length) {
      const rows = data.hot.map(r => {
        return _renderRow('🔥', _name(r.lead),
          r.score + '/100 — ' + (r.topReason || 'high score'), r.lead.id);
      }).join('');
      html += _renderSection('Hot leads needing attention', rows);
    }

    // Yesterday's wins (encouragement)
    if (data.signedYesterday) {
      html += _renderSection('Last 24 hours',
        _renderRow('💰',
          data.signedYesterday + ' estimate' + (data.signedYesterday === 1 ? '' : 's') + ' signed',
          _money(data.signedYesterdayTotal) + ' in pipeline', null));
    }

    if (!html) {
      html = '<div style="color:#94a3b8;font-size:13px;padding:20px 4px;text-align:center;line-height:1.5;">No urgent signals — good morning to prospect or work warm leads.</div>';
    }
    return html;
  }

  function _ago(ms) {
    if (!ms) return '';
    const diff = Date.now() - ms;
    if (diff < 0) return 'just now';
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.floor(hrs / 24);
    return days + 'd ago';
  }

  // ─── Show modal ───────────────────────────────────────────────
  let _opening = false;

  async function open(opts) {
    opts = opts || {};
    if (document.getElementById(MODAL_ID)) return;     // already open
    if (_opening) return;                              // race guard
    _opening = true;

    const data = _gather();

    // Build modal scaffold immediately so the rep sees the panel
    // even if the AI opener takes a moment.
    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'nbd-db-title');
    modal.style.cssText =
      'position:fixed;inset:0;z-index:10005;' +
      'background:rgba(2,6,23,0.66);' +
      'display:flex;align-items:center;justify-content:center;' +
      'padding:env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px) 16px;' +
      'animation:nbd-db-fade 200ms ease-out;';

    modal.innerHTML =
      '<div role="document" style="' +
        'background:#0f1729;color:#e2e8f0;border:1px solid #2a3344;' +
        'border-top:4px solid var(--orange, #c8541a);' +
        'border-radius:12px;' +
        'width:min(560px, 100%);max-height:calc(100dvh - 32px);' +
        'display:flex;flex-direction:column;' +
        'box-shadow:0 18px 60px rgba(0,0,0,0.55);font:inherit;' +
        'animation:nbd-db-pop 220ms cubic-bezier(0.16, 1, 0.3, 1);' +
      '">' +
        '<div style="padding:18px 20px 14px;border-bottom:1px solid #1f2937;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">' +
            '<div id="nbd-db-title" style="font-size:18px;font-weight:700;color:#fff;">' +
              _esc(_greeting()) + ', ' + _esc(_firstName()) +
            '</div>' +
            '<button type="button" id="nbd-db-close" aria-label="Close" style="background:transparent;color:#94a3b8;border:none;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;">×</button>' +
          '</div>' +
          '<div id="nbd-db-opener" style="color:#cbd5e1;font-size:13px;line-height:1.55;min-height:18px;">' +
            '<span style="opacity:0.55;">Loading your morning brief…</span>' +
          '</div>' +
        '</div>' +
        '<div id="nbd-db-body" style="padding:14px 16px;overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;">' +
          _buildBody(data) +
        '</div>' +
        '<div style="padding:10px 16px;border-top:1px solid #1f2937;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
          '<label style="display:flex;align-items:center;gap:6px;color:#94a3b8;font-size:11px;cursor:pointer;">' +
            '<input type="checkbox" id="nbd-db-noauto" style="margin:0;cursor:pointer;"' +
              (_readState().autoOpenDisabled ? ' checked' : '') + '>' +
            "Don't auto-open tomorrow" +
          '</label>' +
          '<button type="button" id="nbd-db-done" style="background:var(--orange, #c8541a);color:#fff;border:none;border-radius:6px;padding:8px 16px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;">Got it</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    // Inject animation keyframes once.
    if (!document.getElementById('nbd-db-css')) {
      const css = document.createElement('style');
      css.id = 'nbd-db-css';
      css.textContent =
        '@keyframes nbd-db-fade {' +
          'from { opacity: 0; }' +
          'to { opacity: 1; }' +
        '}' +
        '@keyframes nbd-db-pop {' +
          'from { opacity: 0; transform: translateY(20px) scale(0.97); }' +
          'to { opacity: 1; transform: translateY(0) scale(1); }' +
        '}' +
        '#' + MODAL_ID + ' .nbd-db-row[data-leadid]:hover {' +
          'background:rgba(200,84,26,0.10);' +
        '}';
      document.head.appendChild(css);
    }

    // ─── Wire up close + dismiss ─────────────────────────────
    function closeModal() {
      const m = document.getElementById(MODAL_ID);
      if (!m) return;
      m.style.transition = 'opacity 160ms ease';
      m.style.opacity = '0';
      setTimeout(() => { try { m.remove(); } catch (_) {} }, 170);
    }
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal(); // click backdrop closes
    });
    const closeBtn = modal.querySelector('#nbd-db-close');
    const doneBtn = modal.querySelector('#nbd-db-done');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (doneBtn) doneBtn.addEventListener('click', closeModal);

    // ESC closes — capture so other handlers don't swallow it.
    function onKey(e) {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', onKey, true);
      }
    }
    document.addEventListener('keydown', onKey, true);

    // Auto-open opt-out toggle.
    const noAuto = modal.querySelector('#nbd-db-noauto');
    if (noAuto) {
      noAuto.addEventListener('change', () => {
        _writeState({ autoOpenDisabled: !!noAuto.checked });
      });
    }

    // Row click → open that lead's customer page.
    const body = modal.querySelector('#nbd-db-body');
    if (body) {
      body.addEventListener('click', (e) => {
        const row = e.target && e.target.closest && e.target.closest('.nbd-db-row[data-leadid]');
        if (!row) return;
        const id = row.getAttribute('data-leadid');
        if (!id) return;
        // Navigate to the customer page for this lead. Existing app
        // exposes openCustomer / customer.html?id= patterns; pick
        // whichever is wired.
        try {
          if (typeof window.openCustomer === 'function') {
            closeModal();
            window.openCustomer(id);
            return;
          }
        } catch (_) {}
        closeModal();
        window.location.href = 'customer.html?id=' + encodeURIComponent(id);
      });
    }

    // Mark as shown for the calendar day regardless of how it
    // opened — manual or auto. Without this, a manual open before
    // the auto-open delay completes would let the auto-open timer
    // re-pop the modal on top of itself.
    _markShown();

    _opening = false;

    // ─── AI opener (async, fills in after Claude responds) ────
    try {
      const opener = await _aiOpener(data);
      const slot = document.getElementById('nbd-db-opener');
      if (slot) slot.textContent = opener;
    } catch (e) {
      const slot = document.getElementById('nbd-db-opener');
      if (slot) slot.textContent = _fallbackOpener(data);
    }
  }

  function dismissForToday() { _markShown(); }
  function disableAutoOpen() { _writeState({ autoOpenDisabled: true }); }
  function enableAutoOpen()  { _writeState({ autoOpenDisabled: false }); }

  // ─── Auto-open bootstrap ──────────────────────────────────────
  function _maybeAutoOpen() {
    if (!_onDashboard()) return;
    const s = _readState();
    if (s.autoOpenDisabled) return;
    if (_shownToday()) return;
    // Wait a bit so the rep lands first. data-refreshed firing
    // also gives the in-memory leads/estimates time to populate.
    setTimeout(() => {
      // Re-check inside the timeout — the rep might've opened
      // it manually in the meantime.
      if (_shownToday()) return;
      if (document.getElementById(MODAL_ID)) return;
      // Bail if the data hasn't loaded at all yet — better to
      // skip a day than show an empty brief.
      const leads = Array.isArray(window._leads) ? window._leads : [];
      const ests = Array.isArray(window._estimates) ? window._estimates : [];
      if (!leads.length && !ests.length) return;
      open({ fromAutoOpen: true });
    }, AUTO_OPEN_DELAY_MS);
  }

  function _bootstrap() {
    if (!_onDashboard()) return;
    // Listen for the first data-refreshed signal — that's when
    // window._leads / window._estimates are populated and the
    // brief has something to summarize.
    let bootedAuto = false;
    function tryBoot() {
      if (bootedAuto) return;
      bootedAuto = true;
      _maybeAutoOpen();
    }
    document.addEventListener('nbd:data-refreshed', tryBoot, { once: true });
    // Belt-and-suspenders: even if data-refreshed never fires (slow
    // load, missing event), give it 8s and try anyway. The auto-
    // open's empty-data check above prevents an empty brief.
    setTimeout(tryBoot, 8000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootstrap, { once: true });
  } else {
    setTimeout(_bootstrap, 0);
  }

  window.NBDDailyBrief = {
    __sentinel: 'nbd-daily-brief-v1',
    open,
    dismissForToday,
    disableAutoOpen,
    enableAutoOpen,
  };
})();
