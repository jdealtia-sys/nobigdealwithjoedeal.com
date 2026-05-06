/**
 * notif-bell.js — Wave 13 (Notification Bell)
 *
 * The dashboard.html header has had a notification bell UI sitting
 * unwired since the kanban refactor: a button with an empty badge,
 * a dropdown panel, "Mark all read" / "Clear all" buttons that
 * referenced functions that didn't exist. This module wires it all
 * up using the in-memory data already loaded by tasks.js and the
 * estimates loader in dashboard.html.
 *
 * Sources of truth:
 *   - Overdue tasks       — window._taskCache (loaded by tasks.js)
 *   - Tasks due today     — window._taskCache
 *   - Stale estimates     — window._estimates (sent ≥3 days ago, no
 *                           viewedAt or no respondedAt)
 *   - Stale active leads  — window._leads at contacted/inspected
 *                           stages with no activity in 7+ days
 *
 * Dismissed state persists in localStorage keyed by item ID, so a
 * rep doesn't see the same nag twice.
 *
 * Re-renders on:
 *   - Module init (after auth)
 *   - 60-second polling interval
 *   - Custom 'nbd:data-refreshed' event (dashboard fires this after
 *     loadLeads / loadEstimates / loadAllTasks)
 *
 * Exposes:
 *   window.toggleNotificationDropdown()
 *   window.markAllNotificationsRead()
 *   window.clearAllNotifications()
 *   window.NotifBell.render()        — force re-render
 *   window.NotifBell.getCount()      — current badge count
 */
(function () {
  'use strict';

  if (window.NotifBell && window.NotifBell.__sentinel === 'nbd-notif-bell-v1') return;

  // ─── Constants ───────────────────────────────────────────────────
  const STALE_ESTIMATE_DAYS = 3;
  const STALE_LEAD_DAYS = 7;
  const ACTIVE_LEAD_STAGES = new Set(['contacted', 'inspected', 'estimate_sent_cash', 'negotiating']);
  const DISMISS_KEY = 'nbd_notif_dismissed_v1';
  const READ_KEY    = 'nbd_notif_read_v1';

  // ─── Dismissed / read state (localStorage) ───────────────────────
  function _readSet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return new Set();
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (e) { return new Set(); }
  }
  function _writeSet(key, set) {
    try {
      // Cap at 500 entries to bound storage growth.
      const arr = Array.from(set).slice(-500);
      localStorage.setItem(key, JSON.stringify(arr));
    } catch (e) { /* quota / private mode — silent */ }
  }
  let dismissed = _readSet(DISMISS_KEY);
  let read      = _readSet(READ_KEY);

  function isDismissed(id) { return dismissed.has(id); }
  function isRead(id)      { return read.has(id); }
  function dismiss(id)     { dismissed.add(id); _writeSet(DISMISS_KEY, dismissed); }
  function markRead(id)    { read.add(id);      _writeSet(READ_KEY, read); }

  // ─── Helpers ─────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function leadName(lead) {
    if (!lead) return 'Unknown';
    const n = `${lead.firstName || ''} ${lead.lastName || ''}`.trim();
    return n || lead.address || 'Unnamed lead';
  }

  function relativeTime(date) {
    if (!date) return '';
    const ms = Date.now() - date.getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const d = Math.floor(hr / 24);
    if (d < 7) return `${d}d ago`;
    const w = Math.floor(d / 7);
    return `${w}w ago`;
  }

  function toDate(v) {
    if (!v) return null;
    if (v instanceof Date) return v;
    if (typeof v.toDate === 'function') return v.toDate();
    if (typeof v.toMillis === 'function') return new Date(v.toMillis());
    if (typeof v === 'number') return new Date(v);
    if (typeof v === 'string') { const d = new Date(v); return isNaN(d) ? null : d; }
    return null;
  }

  // ─── Aggregation: build the notification list from in-memory data ─
  function buildNotifications() {
    const now = new Date();
    const sod = new Date(); sod.setHours(0, 0, 0, 0);
    const eod = new Date(); eod.setHours(23, 59, 59, 999);
    const items = [];
    const leads = Array.isArray(window._leads) ? window._leads : [];
    const taskCache = window._taskCache || {};
    const estimates = Array.isArray(window._estimates) ? window._estimates : [];

    // ── Overdue + due-today tasks ──
    // Wave 35: skip task signals on snoozed leads — the rep
    // explicitly deferred this lead, no point pinging them about
    // its tasks until the snooze expires.
    leads.forEach(lead => {
      if (window.LeadSnooze && window.LeadSnooze.isSnoozed(lead)) return;
      const tasks = taskCache[lead.id] || [];
      tasks.forEach(t => {
        if (t.done) return;
        const due = t.dueDate ? new Date(t.dueDate + 'T23:59:59') : null;
        if (!due) return;
        if (due > eod) return;
        const isOverdue = due < sod;
        const id = `task:${lead.id}:${t.id}`;
        items.push({
          id,
          type:    isOverdue ? 'overdue-task' : 'task-today',
          severity: isOverdue ? 'high' : 'medium',
          icon:    isOverdue ? '🔴' : '⏰',
          title:   isOverdue ? 'Overdue task' : 'Task due today',
          text:    `"${t.text}"`,
          sub:     leadName(lead),
          ts:      due,
          href:    `/pro/dashboard.html?tab=crm&lead=${encodeURIComponent(lead.id)}`,
          onClick: () => window.openTaskModal && window.openTaskModal(lead.id, null),
        });
      });
    });

    // ── Stale estimates (sent but no response) ──
    const staleCutoff = new Date(now.getTime() - STALE_ESTIMATE_DAYS * 24 * 60 * 60 * 1000);
    estimates.forEach(est => {
      const status = (est.status || '').toLowerCase();
      // Skip estimates the customer already responded to.
      if (status === 'signed' || status === 'rejected' || status === 'expired') return;
      if (est.respondedAt) return;
      const sentAt = toDate(est.sentAt) || toDate(est.createdAt);
      if (!sentAt || sentAt > staleCutoff) return;
      const lead = leads.find(l => l.id === est.leadId);
      const id = `estimate:${est.id}`;
      items.push({
        id,
        type:    'stale-estimate',
        severity: 'medium',
        icon:    '📄',
        title:   est.viewedAt ? 'Estimate viewed, no response' : 'Estimate awaiting reply',
        text:    `$${Number(est.total || est.amount || 0).toLocaleString()} estimate`,
        sub:     leadName(lead) + ' · sent ' + relativeTime(sentAt),
        ts:      sentAt,
        href:    `/pro/dashboard.html?tab=estimates&est=${encodeURIComponent(est.id)}`,
      });
    });

    // ── Stale active leads (no activity in 7+ days) ──
    const leadStaleCutoff = new Date(now.getTime() - STALE_LEAD_DAYS * 24 * 60 * 60 * 1000);
    leads.forEach(lead => {
      // Wave 35: skip stale-stage signal on snoozed leads.
      if (window.LeadSnooze && window.LeadSnooze.isSnoozed(lead)) return;
      const stage = (lead.stage || '').toLowerCase();
      if (!ACTIVE_LEAD_STAGES.has(stage)) return;
      const lastActivity = toDate(lead.updatedAt) || toDate(lead.createdAt);
      if (!lastActivity || lastActivity > leadStaleCutoff) return;
      const id = `stale-lead:${lead.id}`;
      items.push({
        id,
        type:    'stale-lead',
        severity: 'low',
        icon:    '💤',
        title:   `Lead going cold (${stage.replace(/_/g, ' ')})`,
        text:    leadName(lead),
        sub:     'No activity in ' + relativeTime(lastActivity),
        ts:      lastActivity,
        href:    `/pro/dashboard.html?tab=crm&lead=${encodeURIComponent(lead.id)}`,
      });
    });

    // Sort: severity first (high → medium → low), then most recent ts first.
    const sevOrder = { high: 0, medium: 1, low: 2 };
    items.sort((a, b) => {
      const s = (sevOrder[a.severity] ?? 3) - (sevOrder[b.severity] ?? 3);
      if (s !== 0) return s;
      return (b.ts?.getTime?.() || 0) - (a.ts?.getTime?.() || 0);
    });
    return items;
  }

  // ─── Render ──────────────────────────────────────────────────────
  function render() {
    const list      = document.getElementById('notifList');
    const dismissedList = document.getElementById('notifDismissedList');
    const dismissedToggle = document.getElementById('notifDismissedToggle');
    const dismissedCount = document.getElementById('dismissedCount');
    const badge     = document.getElementById('notifBadge');
    const clearBtn  = document.getElementById('clearAllNotifBtn');
    if (!list || !badge) return;

    const all = buildNotifications();
    const active    = all.filter(n => !isDismissed(n.id));
    const dismissedItems = all.filter(n =>  isDismissed(n.id));
    const unread    = active.filter(n => !isRead(n.id));

    // Badge — only un-read, un-dismissed items count.
    if (unread.length > 0) {
      badge.style.display = 'block';
      badge.textContent = unread.length > 99 ? '99+' : String(unread.length);
    } else {
      badge.style.display = 'none';
    }

    // Active list
    if (active.length === 0) {
      list.innerHTML = `
        <div style="padding:32px 20px;text-align:center;color:var(--m,#9aa3b2);font-size:12px;">
          <div style="font-size:28px;margin-bottom:8px;">✓</div>
          <div style="font-weight:600;color:var(--t,#e8eaf0);margin-bottom:4px;">All caught up</div>
          <div>No pending alerts.</div>
        </div>`;
    } else {
      list.innerHTML = active.map(n => renderItem(n)).join('');
    }

    // Dismissed toggle
    if (dismissedItems.length > 0) {
      if (dismissedToggle) dismissedToggle.style.display = 'block';
      if (dismissedCount)  dismissedCount.textContent = `(${dismissedItems.length})`;
      if (dismissedList)   dismissedList.innerHTML = dismissedItems.map(n => renderItem(n, true)).join('');
    } else {
      if (dismissedToggle) dismissedToggle.style.display = 'none';
      if (dismissedList)   dismissedList.innerHTML = '';
    }

    if (clearBtn) clearBtn.style.display = active.length > 0 ? '' : 'none';
  }

  function renderItem(n, isDismissedView) {
    const sevColor = n.severity === 'high'   ? '#ef4444'
                   : n.severity === 'medium' ? '#f59e0b'
                                             : '#9ca3af';
    const opacity = (isDismissedView || isRead(n.id)) ? '0.55' : '1';

    // Wave 48: inline reshare buttons. Mirrors the W46/W47 pattern
    // from Almost There + Hot Leads: a notification about a lead
    // with phone/email gets one-tap Call/Text/Email actions next
    // to the dismiss button. Only renders for leads that exist in
    // the in-memory cache (otherwise we can't resolve the contact
    // info). stopPropagation on each so an action click doesn't
    // ALSO fire the row's _handleClick navigation.
    let actionButtonsHTML = '';
    if (n.leadId && Array.isArray(window._leads)) {
      const lead = window._leads.find(l => l && l.id === n.leadId);
      if (lead) {
        const phoneDigits = String(lead.phone || '').replace(/\D+/g, '');
        const email = String(lead.email || '').trim();
        const buttons = [];
        if (phoneDigits) {
          buttons.push(`
            <a class="notif-action" href="tel:${escapeHtml(phoneDigits)}"
              title="Call ${escapeHtml(lead.phone)}"
              style="
                display:flex; align-items:center; justify-content:center;
                width:26px; height:26px; border-radius:5px;
                background:rgba(16,185,129,0.14); color:#10b981;
                text-decoration:none; font-size:12px;
                -webkit-tap-highlight-color:transparent;
                transition:transform .12s;"
              onclick="event.stopPropagation();"
              onmouseover="this.style.transform='scale(1.08)'"
              onmouseout="this.style.transform=''"
            >📞</a>`);
          buttons.push(`
            <button class="notif-action" type="button"
              title="Text portal link to ${escapeHtml(lead.phone)}"
              style="
                display:flex; align-items:center; justify-content:center;
                width:26px; height:26px; border-radius:5px;
                background:rgba(59,130,246,0.14); color:#3b82f6;
                border:none; font-size:12px; cursor:pointer;
                -webkit-tap-highlight-color:transparent;
                transition:transform .12s;"
              onclick="event.stopPropagation(); window.NotifBell._actionSms('${escapeHtml(lead.id)}')"
              onmouseover="this.style.transform='scale(1.08)'"
              onmouseout="this.style.transform=''"
            >💬</button>`);
        }
        if (email) {
          buttons.push(`
            <button class="notif-action" type="button"
              title="Email portal link to ${escapeHtml(email)}"
              style="
                display:flex; align-items:center; justify-content:center;
                width:26px; height:26px; border-radius:5px;
                background:rgba(139,92,246,0.14); color:#8b5cf6;
                border:none; font-size:12px; cursor:pointer;
                -webkit-tap-highlight-color:transparent;
                transition:transform .12s;"
              onclick="event.stopPropagation(); window.NotifBell._actionEmail('${escapeHtml(lead.id)}')"
              onmouseover="this.style.transform='scale(1.08)'"
              onmouseout="this.style.transform=''"
            >📧</button>`);
        }
        if (buttons.length > 0) {
          actionButtonsHTML = `
            <div style="display:flex; gap:3px; align-self:center; flex-shrink:0;">
              ${buttons.join('')}
            </div>`;
        }
      }
    }

    return `
      <div class="notif-item" data-notif-id="${escapeHtml(n.id)}"
        style="
          padding:10px 14px; border-bottom:1px solid var(--br,#1e2530);
          display:flex; gap:10px; cursor:pointer; opacity:${opacity};
          transition:background .15s;"
        onmouseover="this.style.background='var(--s2,#1a1f2a)'"
        onmouseout="this.style.background=''"
        onclick="window.NotifBell._handleClick('${escapeHtml(n.id)}')">
        <div style="font-size:16px; flex-shrink:0; line-height:1.2;">${n.icon}</div>
        <div style="flex:1; min-width:0;">
          <div style="font-size:12px; font-weight:600; color:var(--t,#e8eaf0); margin-bottom:2px;">
            <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${sevColor};margin-right:6px;vertical-align:middle;"></span>
            ${escapeHtml(n.title)}
          </div>
          <div style="font-size:11px; color:var(--t,#e8eaf0); margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
            ${escapeHtml(n.text)}
          </div>
          <div style="font-size:10px; color:var(--m,#9aa3b2);">
            ${escapeHtml(n.sub)}
          </div>
        </div>
        ${actionButtonsHTML}
        <button title="Dismiss"
          style="
            background:transparent; border:none; color:var(--m,#9aa3b2);
            cursor:pointer; padding:4px 8px; font-size:14px; line-height:1;
            opacity:0.6; align-self:flex-start;"
          onclick="event.stopPropagation(); window.NotifBell._dismiss('${escapeHtml(n.id)}')">
          ×
        </button>
      </div>`;
  }

  // ─── Click handlers ──────────────────────────────────────────────
  function handleClick(id) {
    const all = buildNotifications();
    const item = all.find(n => n.id === id);
    if (!item) return;
    markRead(id);
    closeDropdown();
    if (typeof item.onClick === 'function') {
      try { item.onClick(); } catch (e) { console.warn('[NotifBell]', e); }
    } else if (item.href) {
      window.location.href = item.href;
    }
    render();
  }

  function dismissOne(id) {
    dismiss(id);
    render();
  }

  function markAllRead() {
    const items = buildNotifications().filter(n => !isDismissed(n.id));
    items.forEach(n => read.add(n.id));
    _writeSet(READ_KEY, read);
    render();
  }

  function clearAll() {
    const items = buildNotifications().filter(n => !isDismissed(n.id));
    items.forEach(n => dismissed.add(n.id));
    _writeSet(DISMISS_KEY, dismissed);
    render();
  }

  // ─── Dropdown open/close ─────────────────────────────────────────
  function toggleDropdown() {
    const dd = document.getElementById('notifDropdown');
    if (!dd) return;
    if (dd.style.display === 'none' || !dd.style.display) {
      dd.style.display = 'flex';
      render();
      // Close on outside click.
      setTimeout(() => {
        document.addEventListener('click', _outsideClick, { once: true });
      }, 0);
    } else {
      closeDropdown();
    }
  }
  function closeDropdown() {
    const dd = document.getElementById('notifDropdown');
    if (dd) dd.style.display = 'none';
  }
  function _outsideClick(ev) {
    const dd = document.getElementById('notifDropdown');
    const btn = document.getElementById('notifBtn');
    if (!dd || !btn) return;
    if (dd.contains(ev.target) || btn.contains(ev.target)) {
      // Re-arm for the next outside click.
      setTimeout(() => {
        document.addEventListener('click', _outsideClick, { once: true });
      }, 0);
      return;
    }
    closeDropdown();
  }

  function toggleDismissedView() {
    const list = document.getElementById('notifDismissedList');
    const label = document.getElementById('dismissedToggleLabel');
    if (!list) return;
    if (list.style.display === 'none' || !list.style.display) {
      list.style.display = 'block';
      if (label) label.textContent = 'Hide dismissed';
    } else {
      list.style.display = 'none';
      if (label) label.textContent = 'Show dismissed';
    }
  }

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    render();
    // Re-render every 60s so time-based items (overdue, stale) update
    // even if the underlying data hasn't changed.
    setInterval(render, 60_000);
    // Re-render whenever dashboard publishes a data refresh.
    window.addEventListener('nbd:data-refreshed', render);
    // Also react to focus — reps tabbing back to the dashboard.
    window.addEventListener('focus', render);
  }

  // Wave 48: bell-row reshare action helpers. Mirrors the W42
  // PortalLinkHelpers entry points but resolves the lead by id from
  // the in-memory cache so the inline onclick handlers on the
  // rendered HTML can fire by id alone.
  function _actionSms(leadId) {
    const lead = (Array.isArray(window._leads) ? window._leads : [])
      .find(l => l && l.id === leadId);
    if (!lead) return;
    if (window.PortalLinkHelpers && typeof window.PortalLinkHelpers.smsForLead === 'function') {
      window.PortalLinkHelpers.smsForLead(lead);
    }
  }
  function _actionEmail(leadId) {
    const lead = (Array.isArray(window._leads) ? window._leads : [])
      .find(l => l && l.id === leadId);
    if (!lead) return;
    if (window.PortalLinkHelpers && typeof window.PortalLinkHelpers.emailForLead === 'function') {
      window.PortalLinkHelpers.emailForLead(lead);
    }
  }

  // Expose API
  window.NotifBell = {
    __sentinel: 'nbd-notif-bell-v1',
    render,
    getCount: () => buildNotifications().filter(n => !isDismissed(n.id) && !isRead(n.id)).length,
    _handleClick: handleClick,
    _dismiss: dismissOne,
    _actionSms,
    _actionEmail,
  };

  // Wire the legacy onclick handlers expected by dashboard.html
  window.toggleNotificationDropdown = toggleDropdown;
  window.markAllNotificationsRead = markAllRead;
  window.clearAllNotifications = clearAll;
  window.toggleDismissedNotifications = toggleDismissedView;

  // Defer init until after other modules have populated their caches.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2500));
  } else {
    setTimeout(init, 2500);
  }
})();
