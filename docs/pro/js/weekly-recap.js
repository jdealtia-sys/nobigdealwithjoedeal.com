/**
 * weekly-recap.js — Wave 167 (Personal Weekly Recap — Friday bookend)
 *
 * The end-of-week complement to W161's Daily Brief. Where the Brief
 * orients the rep's day, the Recap closes their week — giving them
 * a real sense of "what just happened, did I move forward, what
 * should I carry into next week?"
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ Your week in review — May 1-7                          [×]│
 *   │ ──────────────────────────────────────────────────────── │
 *   │ "Strong week — three signed deals at $47k pipeline and    │
 *   │ four review requests landed. Two warm leads went cold —   │
 *   │ worth a Monday call."                                     │
 *   │                                                            │
 *   │ ┌──────────┬──────────┬──────────┬──────────┐             │
 *   │ │   3      │  $47.2k  │   12     │    4     │             │
 *   │ │ signed   │  closed  │  added   │  reviews │             │
 *   │ └──────────┴──────────┴──────────┴──────────┘             │
 *   │                                                            │
 *   │ 🏆 Top deal of the week                                   │
 *   │     Sarah Mills — $24,800 metal roof                       │
 *   │ 📈 Most-active channel  SMS (28 outbound)                 │
 *   │                                                            │
 *   │ Wins                                                       │
 *   │   ✅ Sarah Mills — signed Tuesday ($24.8k)                │
 *   │   ✅ Tom Reilly — signed Thursday ($14.4k)                │
 *   │   ...                                                      │
 *   │ Carry into next week                                       │
 *   │   ⚠️  3 leads went cold (no contact 7+ days)              │
 *   │   📞 2 callbacks still pending                             │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Auto-show:
 *   - Friday between 3pm and 7pm local time → first dashboard
 *     load that day pops the recap
 *   - Saturday/Sunday → first dashboard load before noon, if
 *     Friday was missed
 *   - Once per week max (localStorage keyed by ISO week number)
 *   - Rep can opt out of auto-show via checkbox in the modal
 *
 * Path-gated to dashboard.html. Zero new fetches — everything
 * computed from window._leads / _estimates already in memory.
 *
 * Public API:
 *   window.NBDWeeklyRecap.open()
 *   window.NBDWeeklyRecap.dismissForThisWeek()
 *   window.NBDWeeklyRecap.disableAutoOpen()
 *   window.NBDWeeklyRecap.enableAutoOpen()
 */
(function () {
  'use strict';
  if (window.NBDWeeklyRecap
      && window.NBDWeeklyRecap.__sentinel === 'nbd-weekly-recap-v1') return;

  const STORAGE_KEY = 'nbd_weekly_recap_state_v1';
  const MODAL_ID = 'nbd-weekly-recap-modal';
  const AUTO_OPEN_DELAY_MS = 4000;

  // ─── Path gate ────────────────────────────────────────────────
  function _onDashboard() {
    const p = (window.location && window.location.pathname || '').toLowerCase();
    return p.indexOf('/pro/dashboard') !== -1
      || /\/pro\/?(?:\?|#|$)/.test(p);
  }

  // ─── State ────────────────────────────────────────────────────
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

  // ISO-week key (YYYY-Www). Mondays-of-the-week define a unique
  // week regardless of crossing year boundaries.
  //
  // W169 audit fix: the Math.round formula could return 0 for
  // dates near the year boundary that ISO 8601 actually counts as
  // week 52/53 of the prior year. A weekNo=0 key never matches
  // the stored value so the modal would re-pop every weekend in
  // that window. The fix is the standard "if weekNo<1 use prior
  // year's last week" pattern from the canonical ISO snippet.
  function _weekKey(date) {
    const d = new Date(date || Date.now());
    d.setHours(0, 0, 0, 0);
    // Move to Thursday (ISO week anchor) so DEC 31 / JAN 1
    // edge cases land in the right year.
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    let weekNo = 1 + Math.round(((d.getTime() - yearStart.getTime()) / 86_400_000 - 3 + ((yearStart.getDay() + 6) % 7)) / 7);
    let year = d.getFullYear();
    // Edge case: dates in early Jan that ISO calls week 52/53 of
    // the prior year. Re-anchor to Dec 31 of the prior year.
    if (weekNo < 1) {
      const prior = new Date(year - 1, 11, 31);
      return _weekKey(prior);
    }
    // Edge case: dates in late Dec that ISO calls week 1 of the
    // next year (when Jan 1 falls Mon-Wed). Detect by checking
    // whether the Thursday-shifted date crossed back into next
    // year — `year` already accounts for that — but the unrounded
    // formula can produce 53 in years that only have 52 ISO weeks.
    if (weekNo > 52) {
      // Check whether year actually has 53 ISO weeks: it does iff
      // Jan 1 is a Thursday OR Jan 1 is Wed in a leap year.
      const jan1 = new Date(year, 0, 1).getDay();
      const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
      const has53 = (jan1 === 4) || (isLeap && jan1 === 3);
      if (!has53) { weekNo = 1; year = year + 1; }
    }
    return year + '-W' + String(weekNo).padStart(2, '0');
  }
  function _shownThisWeek() {
    return _readState().lastShownWeek === _weekKey();
  }
  function _markShown() {
    _writeState({ lastShownWeek: _weekKey() });
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
  // ─── W169 audit: prompt-injection sanitization ───────────────
  function _sanFact(s, max) {
    return String(s == null ? '' : s)
      .replace(/[\r\n]+/g, ' ')
      .replace(/[`<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max || 80);
  }

  function _money(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '$0';
    if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (n >= 10_000)    return '$' + (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return '$' + Math.round(n).toLocaleString();
  }

  function _weekRange() {
    // Sunday → Saturday window for "this week" recap.
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay()); // back to Sunday
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { startMs: start.getTime(), endMs: end.getTime(), startDate: start, endDate: end };
  }
  function _formatRange(startDate, endDate) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const sm = months[startDate.getMonth()];
    const em = months[endDate.getMonth()];
    if (sm === em) {
      return sm + ' ' + startDate.getDate() + '–' + endDate.getDate();
    }
    return sm + ' ' + startDate.getDate() + ' – ' + em + ' ' + endDate.getDate();
  }

  // ─── Data aggregation ─────────────────────────────────────────
  function _gather() {
    const leads = Array.isArray(window._leads) ? window._leads : [];
    const ests = Array.isArray(window._estimates) ? window._estimates : [];
    const range = _weekRange();
    const inWeek = (ms) => ms >= range.startMs && ms <= range.endMs;

    // Estimates signed this week
    let signed = [];
    for (const e of ests) {
      const sm = _toMillis(e.signedAt);
      if (sm && inWeek(sm)) signed.push({ est: e, ms: sm });
    }
    signed.sort((a, b) => b.ms - a.ms);
    const signedTotal = signed.reduce((s, x) => s + (Number(x.est.grandTotal || x.est.total) || 0), 0);

    // Top deal
    let topDeal = null;
    for (const x of signed) {
      const v = Number(x.est.grandTotal || x.est.total) || 0;
      if (!topDeal || v > topDeal.value) topDeal = { est: x.est, value: v };
    }

    // Estimates sent this week (sentAt)
    let sentCount = 0;
    for (const e of ests) {
      const sm = _toMillis(e.sentAt);
      if (sm && inWeek(sm)) sentCount++;
    }

    // Leads added this week
    let leadsAdded = 0;
    for (const l of leads) {
      const cm = _toMillis(l.createdAt);
      if (cm && inWeek(cm)) leadsAdded++;
    }

    // Review requests this week (lead.reviewRequestedAt within window)
    let reviewsRequested = 0;
    for (const l of leads) {
      const rm = _toMillis(l.reviewRequestedAt);
      if (rm && inWeek(rm)) reviewsRequested++;
    }

    // Cold leads (no contact in 7+ days, but otherwise active)
    const NOW = Date.now();
    const coldCutoff = 7 * 86_400_000;
    let cold = [];
    for (const l of leads) {
      if (!l || l.deleted) continue;
      const sk = String(l._stageKey || l.stage || '').toLowerCase();
      // Skip already-closed leads
      if (['closed', 'completed', 'install_complete', 'closed_lost', 'archived'].includes(sk)) continue;
      const lc = _toMillis(l.lastContactedAt) || _toMillis(l.updatedAt);
      if (lc && (NOW - lc) > coldCutoff) cold.push(l);
    }
    cold.sort((a, b) => _toMillis(b.updatedAt) - _toMillis(a.updatedAt));

    // Pending callbacks (lastCallbackAt within window AND no
    // logCommunication response after it)
    let pendingCallbacks = 0;
    for (const l of leads) {
      const cb = _toMillis(l.lastCallbackAt);
      if (!cb || !inWeek(cb)) continue;
      const lc = _toMillis(l.lastContactedAt);
      if (!lc || lc < cb) pendingCallbacks++;
    }

    return {
      range,
      signed,
      signedCount: signed.length,
      signedTotal,
      sentCount,
      leadsAdded,
      reviewsRequested,
      topDeal,
      cold: cold.slice(0, 5),
      coldCount: cold.length,
      pendingCallbacks,
    };
  }

  // ─── AI opener ────────────────────────────────────────────────
  async function _aiOpener(data) {
    const cacheKey = _weekKey();
    const s = _readState();
    if (s.openerWeek === cacheKey && typeof s.openerText === 'string') {
      return s.openerText;
    }
    if (typeof window.callClaude !== 'function') return _fallbackOpener(data);

    const facts = [];
    if (data.signedCount) facts.push(data.signedCount + ' deal' + (data.signedCount === 1 ? '' : 's') + ' signed totaling ' + _money(data.signedTotal));
    if (data.sentCount) facts.push(data.sentCount + ' new estimate' + (data.sentCount === 1 ? '' : 's') + ' sent');
    if (data.leadsAdded) facts.push(data.leadsAdded + ' new lead' + (data.leadsAdded === 1 ? '' : 's') + ' added');
    if (data.reviewsRequested) facts.push(data.reviewsRequested + ' review request' + (data.reviewsRequested === 1 ? '' : 's') + ' sent');
    if (data.coldCount) facts.push(data.coldCount + ' lead' + (data.coldCount === 1 ? '' : 's') + ' went cold (no contact in 7+ days)');
    if (data.pendingCallbacks) facts.push(data.pendingCallbacks + ' callback' + (data.pendingCallbacks === 1 ? '' : 's') + ' still pending');
    if (data.topDeal) {
      // W169: sanitize the lead name before embedding in the prompt.
      const dealLead = (window._leads || []).find(l => l && l.id === data.topDeal.est.leadId) || {};
      facts.push('Top deal: ' + _sanFact(_name(dealLead), 60) + ' at ' + _money(data.topDeal.value));
    }
    if (!facts.length) facts.push('No closes or new leads logged this week');

    const prompt = "You are a balanced field-rep coach. Given the rep's weekly facts, write ONE 2-sentence summary (max 40 words) that names the wins, names the work to carry forward, and closes with a forward-looking nudge. No greetings, no lists. Just the summary.\n\nFacts:\n- " + facts.join('\n- ') + '\n\nSummary:';

    try {
      const result = await Promise.race([
        window.callClaude({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 160,
          messages: [{ role: 'user', content: prompt }],
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 9000)),
      ]);
      let text = '';
      if (result && Array.isArray(result.content)) {
        for (const c of result.content) {
          if (c && c.type === 'text' && typeof c.text === 'string') text += c.text;
        }
      }
      text = String(text || '').trim().replace(/^"+|"+$/g, '');
      if (!text) return _fallbackOpener(data);
      _writeState({ openerWeek: cacheKey, openerText: text });
      return text;
    } catch (e) {
      console.warn('[weekly-recap] Claude opener failed:', e && e.message);
      return _fallbackOpener(data);
    }
  }
  function _fallbackOpener(data) {
    const parts = [];
    if (data.signedCount) parts.push(data.signedCount + ' signed (' + _money(data.signedTotal) + ')');
    if (data.leadsAdded) parts.push(data.leadsAdded + ' new');
    if (data.reviewsRequested) parts.push(data.reviewsRequested + ' review' + (data.reviewsRequested === 1 ? '' : 's'));
    const wins = parts.length ? 'You closed ' + parts.join(', ') + ' this week.' : 'A quiet week — no closes logged.';
    const carry = data.coldCount
      ? ' ' + data.coldCount + ' cold lead' + (data.coldCount === 1 ? '' : 's') + ' to revive Monday.'
      : ' Carry the energy into next week.';
    return wins + carry;
  }

  // ─── Render ───────────────────────────────────────────────────
  function _renderStat(value, label) {
    return '<div style="background:rgba(15,23,42,0.55);border:1px solid var(--border, #2a3344);border-radius:8px;padding:10px 8px;text-align:center;flex:1;min-width:80px;">' +
      '<div style="font-size:18px;font-weight:700;color:var(--text, #e2e8f0);line-height:1.1;">' + _esc(value) + '</div>' +
      '<div style="font-size:10px;color:var(--muted, #94a3b8);text-transform:uppercase;letter-spacing:0.04em;margin-top:3px;">' + _esc(label) + '</div>' +
    '</div>';
  }

  function _renderHighlights(data) {
    const lines = [];
    if (data.topDeal) {
      const lead = (window._leads || []).find(l => l && l.id === data.topDeal.est.leadId);
      lines.push(
        '<div style="display:flex;align-items:center;gap:8px;color:var(--text, #e2e8f0);font-size:12px;">' +
          '<span style="font-size:14px;flex-shrink:0;">🏆</span>' +
          '<span style="font-weight:600;">Top deal:</span>' +
          '<span>' + _esc(_name(lead || {})) + ' — ' + _esc(_money(data.topDeal.value)) + '</span>' +
        '</div>'
      );
    }
    if (data.signedCount > 0 && data.signedTotal > 0) {
      const avg = data.signedTotal / data.signedCount;
      lines.push(
        '<div style="display:flex;align-items:center;gap:8px;color:var(--text, #e2e8f0);font-size:12px;">' +
          '<span style="font-size:14px;flex-shrink:0;">📊</span>' +
          '<span style="font-weight:600;">Avg deal size:</span>' +
          '<span>' + _esc(_money(avg)) + '</span>' +
        '</div>'
      );
    }
    if (!lines.length) return '';
    return '<div style="display:flex;flex-direction:column;gap:6px;margin:14px 0 10px;">' + lines.join('') + '</div>';
  }

  function _renderSection(title, html) {
    if (!html) return '';
    return '<div style="margin-bottom:14px;">' +
      '<div style="font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--muted, #94a3b8);margin-bottom:6px;padding-left:4px;">' + _esc(title) + '</div>' +
      html +
    '</div>';
  }
  function _row(emoji, label, sub, leadId) {
    return '<div class="nbd-wr-row" ' + (leadId ? 'data-leadid="' + _esc(leadId) + '"' : '') + ' ' +
      'style="display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:5px;cursor:' + (leadId ? 'pointer' : 'default') + ';transition:background 120ms ease;">' +
      '<span style="font-size:16px;line-height:1;flex-shrink:0;">' + emoji + '</span>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-weight:600;color:var(--text, #e2e8f0);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(label) + '</div>' +
        (sub ? '<div style="color:var(--muted, #94a3b8);font-size:11px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + _esc(sub) + '</div>' : '') +
      '</div>' +
      (leadId ? '<span style="color:#64748b;font-size:13px;flex-shrink:0;">›</span>' : '') +
    '</div>';
  }

  function _buildBody(data) {
    let html = '';

    // Stats grid
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">' +
      _renderStat(data.signedCount, 'signed') +
      _renderStat(_money(data.signedTotal), 'closed') +
      _renderStat(data.leadsAdded, 'added') +
      _renderStat(data.reviewsRequested, 'reviews') +
    '</div>';

    // Highlights
    html += _renderHighlights(data);

    // Wins
    if (data.signed.length) {
      const rows = data.signed.slice(0, 5).map(x => {
        const lead = (window._leads || []).find(l => l && l.id === x.est.leadId);
        const v = Number(x.est.grandTotal || x.est.total) || 0;
        return _row('✅', _name(lead || {}) + ' — ' + _money(v),
          'Signed ' + new Date(x.ms).toLocaleDateString(undefined, { weekday: 'short' }),
          lead ? lead.id : null);
      }).join('');
      html += _renderSection('Wins', rows);
    }

    // Carry forward
    const carry = [];
    if (data.coldCount) {
      const sub = data.coldCount === 1
        ? '1 lead with no contact 7+ days'
        : data.coldCount + ' leads with no contact 7+ days';
      carry.push(_row('⚠️', 'Cold leads to revive', sub, null));
    }
    if (data.pendingCallbacks) {
      carry.push(_row('📞',
        data.pendingCallbacks + ' callback' + (data.pendingCallbacks === 1 ? '' : 's') + ' still pending',
        'Logged this week, no return contact yet',
        null));
    }
    if (carry.length) html += _renderSection('Carry into next week', carry.join(''));

    if (!data.signed.length && !carry.length) {
      html += '<div style="color:var(--muted, #94a3b8);font-size:13px;padding:20px 4px;text-align:center;line-height:1.5;">A quiet week. Use Monday to plant seeds for next.</div>';
    }
    return html;
  }

  // ─── Modal ────────────────────────────────────────────────────
  let _opening = false;

  async function open() {
    if (document.getElementById(MODAL_ID)) return;
    if (_opening) return;
    _opening = true;

    const data = _gather();
    const range = _formatRange(data.range.startDate, data.range.endDate);

    const modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'nbd-wr-title');
    modal.style.cssText =
      'position:fixed;inset:0;z-index:10005;background:rgba(2,6,23,0.66);' +
      'display:flex;align-items:center;justify-content:center;' +
      'padding:env(safe-area-inset-top, 16px) 16px env(safe-area-inset-bottom, 16px) 16px;' +
      'animation:nbd-wr-fade 200ms ease-out;';

    modal.innerHTML =
      '<div role="document" style="' +
        'background:#0f1729;color:#e2e8f0;border:1px solid #2a3344;' +
        'border-top:4px solid #a855f7;border-radius:12px;' +
        'width:min(580px, 100%);max-height:calc(100dvh - 32px);' +
        'display:flex;flex-direction:column;' +
        'box-shadow:0 18px 60px rgba(0,0,0,0.55);font:inherit;' +
        'animation:nbd-wr-pop 220ms cubic-bezier(0.16, 1, 0.3, 1);' +
      '">' +
        '<div style="padding:18px 20px 14px;border-bottom:1px solid #1f2937;">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">' +
            '<div id="nbd-wr-title" style="font-size:18px;font-weight:700;color:#fff;">Your week in review — ' + _esc(range) + '</div>' +
            '<button type="button" id="nbd-wr-close" aria-label="Close" style="background:transparent;color:#94a3b8;border:none;font-size:22px;line-height:1;cursor:pointer;padding:2px 6px;">×</button>' +
          '</div>' +
          '<div id="nbd-wr-opener" style="color:#cbd5e1;font-size:13px;line-height:1.55;min-height:18px;">' +
            '<span style="opacity:0.55;">Pulling your week together…</span>' +
          '</div>' +
        '</div>' +
        '<div id="nbd-wr-body" style="padding:14px 16px;overflow-y:auto;flex:1;-webkit-overflow-scrolling:touch;">' +
          _buildBody(data) +
        '</div>' +
        '<div style="padding:10px 16px;border-top:1px solid #1f2937;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">' +
          '<label style="display:flex;align-items:center;gap:6px;color:#94a3b8;font-size:11px;cursor:pointer;">' +
            '<input type="checkbox" id="nbd-wr-noauto" style="margin:0;cursor:pointer;"' +
              (_readState().autoOpenDisabled ? ' checked' : '') + '>' +
            "Don't auto-open next week" +
          '</label>' +
          '<button type="button" id="nbd-wr-done" style="background:#a855f7;color:#fff;border:none;border-radius:6px;padding:8px 16px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;">Got it</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(modal);

    if (!document.getElementById('nbd-wr-css')) {
      const css = document.createElement('style');
      css.id = 'nbd-wr-css';
      css.textContent =
        '@keyframes nbd-wr-fade { from { opacity: 0; } to { opacity: 1; } }' +
        '@keyframes nbd-wr-pop { from { opacity: 0; transform: translateY(20px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }' +
        '#' + MODAL_ID + ' .nbd-wr-row[data-leadid]:hover { background:rgba(168,85,247,0.10); }';
      document.head.appendChild(css);
    }

    function closeModal() {
      const m = document.getElementById(MODAL_ID);
      if (!m) return;
      m.style.transition = 'opacity 160ms ease';
      m.style.opacity = '0';
      setTimeout(() => { try { m.remove(); } catch (_) {} }, 170);
    }
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    const closeBtn = modal.querySelector('#nbd-wr-close');
    const doneBtn = modal.querySelector('#nbd-wr-done');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (doneBtn) doneBtn.addEventListener('click', closeModal);
    function onKey(e) {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', onKey, true);
      }
    }
    document.addEventListener('keydown', onKey, true);
    const noAuto = modal.querySelector('#nbd-wr-noauto');
    if (noAuto) {
      noAuto.addEventListener('change', () => {
        _writeState({ autoOpenDisabled: !!noAuto.checked });
      });
    }
    const body = modal.querySelector('#nbd-wr-body');
    if (body) {
      body.addEventListener('click', (e) => {
        const row = e.target && e.target.closest && e.target.closest('.nbd-wr-row[data-leadid]');
        if (!row) return;
        const id = row.getAttribute('data-leadid');
        if (!id) return;
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

    _markShown();
    _opening = false;

    try {
      const opener = await _aiOpener(data);
      const slot = document.getElementById('nbd-wr-opener');
      if (slot) slot.textContent = opener;
    } catch (e) {
      const slot = document.getElementById('nbd-wr-opener');
      if (slot) slot.textContent = _fallbackOpener(data);
    }
  }

  function dismissForThisWeek() { _markShown(); }
  function disableAutoOpen() { _writeState({ autoOpenDisabled: true }); }
  function enableAutoOpen() { _writeState({ autoOpenDisabled: false }); }

  // ─── Auto-open trigger ────────────────────────────────────────
  // Auto-show window: Friday 3pm-7pm local OR Sat/Sun before noon
  // (catches reps who didn't open NBD on Friday afternoon).
  function _isAutoOpenWindow() {
    const now = new Date();
    const d = now.getDay(); // 0=Sun, 5=Fri, 6=Sat
    const h = now.getHours();
    if (d === 5 && h >= 15 && h <= 19) return true; // Fri 3pm-7pm
    if ((d === 6 || d === 0) && h < 12) return true; // Sat/Sun morning
    return false;
  }

  function _maybeAutoOpen() {
    if (!_onDashboard()) return;
    const s = _readState();
    if (s.autoOpenDisabled) return;
    if (_shownThisWeek()) return;
    if (!_isAutoOpenWindow()) return;
    setTimeout(() => {
      if (_shownThisWeek()) return;
      if (document.getElementById(MODAL_ID)) return;
      const leads = Array.isArray(window._leads) ? window._leads : [];
      const ests = Array.isArray(window._estimates) ? window._estimates : [];
      if (!leads.length && !ests.length) return;
      open();
    }, AUTO_OPEN_DELAY_MS);
  }

  function _bootstrap() {
    if (!_onDashboard()) return;
    let booted = false;
    function tryBoot() {
      if (booted) return;
      booted = true;
      _maybeAutoOpen();
    }
    document.addEventListener('nbd:data-refreshed', tryBoot, { once: true });
    setTimeout(tryBoot, 8000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootstrap, { once: true });
  } else {
    setTimeout(_bootstrap, 0);
  }

  window.NBDWeeklyRecap = {
    __sentinel: 'nbd-weekly-recap-v1',
    open,
    dismissForThisWeek,
    disableAutoOpen,
    enableAutoOpen,
  };
})();
