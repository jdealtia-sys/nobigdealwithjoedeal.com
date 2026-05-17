/**
 * crm-snooze.js — notifications subsystem + follow-up engines.
 *
 * Extracted from crm.js (Step 4b — 2026-05-16) as one of four
 * sibling modules. Load order is critical and locked in
 * dashboard.html:
 *
 *   leads → pipeline → snooze → portal-bridge → crm (shim)
 *
 * This file holds:
 *   - the in-page notification subsystem (bell badge, dropdown,
 *     onSnapshot subscription, dismissed drawer, mark-read /
 *     dismiss / restore / clear-all helpers)
 *   - the follow-up notification engine
 *     (checkAndCreateFollowUpNotifications)
 *   - the missing-required-field auto-notifier
 *     (checkAndCreateNeedsFieldNotifications)
 *   - the tel:/sms:/mailto: comm-log click delegate
 *   - the user-gesture-gated browser notification permission
 *     request + waitForNotifAuth poll
 *   - sign-out / pagehide tear-down for the poll + onSnapshot
 *
 * Naming note: "snooze" in the module name follows the cleanup-plan
 * grouping (notifications + follow-ups + the user-controllable
 * pause-the-noise surface live together). The LeadSnooze module
 * itself lives in lead-snooze.js — this file just consumes it from
 * the buildCard render path in crm-pipeline.js.
 *
 * It references the Firebase shim consts (col, _addDoc,
 * _serverTimestamp, …) declared in crm-leads.js — visible as
 * outer-scope globals in classic-script sibling scope.
 */


// ═══════════════════════════════════════════════════════════════
// NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════════

window._notifications = [];
window._notifDropdownOpen = false;
window._notifUnsub = null; // onSnapshot unsubscribe handle

function _renderNotifBadgeAndList(allNotifs) {
  window._notifications = allNotifs.filter(n => !n.dismissed);
  window._dismissedNotifications = allNotifs.filter(n => n.dismissed);
  const unreadCount = window._notifications.filter(n => !n.read).length;
  const badge = document.getElementById('notifBadge');
  if (badge) {
    if (unreadCount > 0) {
      badge.style.display = 'block';
      badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
    } else {
      badge.style.display = 'none';
    }
  }
  if (window._notifDropdownOpen) {
    renderNotifications();
  }
}

async function loadNotifications() {
  try {
    const _auth = window._auth;
    const _db   = window._db;
    if (!_auth || !_db) return;
    const user  = _auth.currentUser;
    if (!user) return;

    const {getDocs: _getDocs, onSnapshot: _onSnap, query: _query, collection: _col, where: _where, orderBy: _order, limit: _limit} =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    const q = _query(
      _col(_db, 'notifications'),
      _where('userId', '==', user.uid),
      _order('createdAt', 'desc'),
      _limit(50)
    );

    // ── Live listener ──
    // Previously this was a one-shot getDocs, so the bell badge was a
    // snapshot — push messages, server-issued notifications, and peer
    // activity never appeared until a hard reload. Subscribe via
    // onSnapshot so the badge + list update in real time. We keep a
    // single subscription per session (re-arming bails the old one)
    // and tear down on sign-out.
    if (typeof window._notifUnsub === 'function') {
      try { window._notifUnsub(); } catch(_) {}
      window._notifUnsub = null;
    }
    if (typeof _onSnap === 'function') {
      window._notifUnsub = _onSnap(q, (snap) => {
        const allNotifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _renderNotifBadgeAndList(allNotifs);
      }, (err) => {
        // Listener errored — fall back to a one-shot read so the
        // user at least sees something instead of a broken badge.
        console.warn('notifications onSnapshot error:', err && err.message);
        _getDocs(q).then(s => {
          _renderNotifBadgeAndList(s.docs.map(d => ({ id: d.id, ...d.data() })));
        }).catch(() => {});
      });
    } else {
      // SDK shape changed — last-resort one-shot.
      const snap = await _getDocs(q);
      _renderNotifBadgeAndList(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }
  } catch (error) {
    console.error('Error loading notifications:', error);
  }
}

const NOTIF_ICONS = {
  'task_due': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M5 2h10v4l-3 3 3 3v4H5v-4l3-3-3-3V2z"/></svg>',
  'task_overdue': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M10 3L2 17h16L10 3z"/><path d="M10 8v4M10 14.5v.5"/></svg>',
  'estimate_approved': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><circle cx="10" cy="10" r="7"/><path d="M7 10l2 2 4-5"/></svg>',
  'stage_change': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M3 10a7 7 0 0112.9-3.7L17 5"/><path d="M17 10a7 7 0 01-12.9 3.7L3 15"/><path d="M17 2v3h-3M3 18v-3h3"/></svg>',
  'follow_up': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;vertical-align:middle;"><rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14"/><path d="M7 2v4M13 2v4"/></svg>',
  'new_lead': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><circle cx="10" cy="7" r="3"/><path d="M4 17a6 6 0 0112 0"/></svg>',
  'default': '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;vertical-align:middle;"><path d="M10 2a5 5 0 00-5 5c0 4-2 6-2 6h14s-2-2-2-6a5 5 0 00-5-5z"/><path d="M8.5 16a1.5 1.5 0 003 0"/></svg>'
};

function renderNotifItem(n, opts = {}) {
  const isUnread = !n.read;
  const isDismissed = opts.dismissed || false;
  const timestamp = n.createdAt?.toDate ? n.createdAt.toDate() : new Date(n.createdAt || Date.now());
  const timeAgo = getTimeAgo(timestamp);
  const icon = NOTIF_ICONS[n.type] || NOTIF_ICONS.default;
  const hasLead = n.leadId && !n.leadId.startsWith('d-');

  // Notification.message is populated from incoming SMS + push content via
  // Cloud Functions, so it can contain attacker-controlled HTML. Every field
  // is escaped and all IDs are data-attributes consumed by event listeners
  // (see wireNotifListeners below) instead of inline onclick handlers.
  return `
    <div class="nbd-notif-row" data-notif-id="${escHtml(n.id)}" data-notif-lead="${escHtml(n.leadId||'')}" data-notif-dismissed="${isDismissed ? '1' : '0'}" data-notif-type="${escHtml(n.type||'')}" style="padding:10px 14px;border-bottom:1px solid var(--br);cursor:pointer;transition:background .15s;${isUnread && !isDismissed ? 'background:var(--og);' : ''}${isDismissed ? 'opacity:0.65;' : ''}">
      <div style="display:flex;gap:10px;align-items:start;">
        <div style="font-size:20px;flex-shrink:0;">${icon}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:${isUnread ? '600' : '400'};margin-bottom:3px;color:var(--t);">
            ${escHtml(n.title || 'Notification')}
          </div>
          <div style="font-size:12px;color:var(--m);margin-bottom:3px;line-height:1.4;">
            ${escHtml(n.message || '')}
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px;color:var(--m);opacity:0.8;">${escHtml(timeAgo)}</span>
            ${hasLead && !isDismissed ? `<span style="font-size:9px;color:var(--blue);font-weight:600;letter-spacing:.03em;">→ VIEW LEAD</span>` : ''}
            ${hasLead && !isDismissed && (n.type === 'follow_up' || n.type === 'task_overdue') ? `<span class="nbd-notif-sms" style="font-size:9px;color:var(--green,var(--green));font-weight:600;letter-spacing:.03em;cursor:pointer;">📱 SMS</span>` : ''}
            ${isDismissed ? `<span class="nbd-notif-restore" style="font-size:9px;color:var(--orange);font-weight:600;letter-spacing:.03em;cursor:pointer;">↩ RESTORE</span>` : ''}
          </div>
        </div>
        ${isUnread && !isDismissed ? `<div style="width:8px;height:8px;background:var(--orange);border-radius:50%;flex-shrink:0;margin-top:4px;"></div>` : ''}
        ${!isDismissed ? `<button class="nbd-notif-dismiss" title="Dismiss" style="background:none;border:none;color:var(--m);cursor:pointer;font-size:14px;padding:2px 4px;opacity:0.4;flex-shrink:0;line-height:1;">✕</button>` : ''}
      </div>
    </div>`;
}

// Wire event listeners on all rendered notification rows. Called after every
// innerHTML = list.map(renderNotifItem) so handlers attach to the new DOM.
// Delegated click listener for every kanban card. Replaces the inline
// onclick="..." attributes that buildCard() used to emit. Each action
// button has a data-action attribute naming the handler, plus data-id /
// data-* payloads. Called by the kanban render functions after every
// innerHTML update so listeners survive re-renders.

function wireNotifListeners(container) {
  if (!container) return;
  container.querySelectorAll('.nbd-notif-row').forEach(row => {
    const id = row.dataset.notifId;
    const leadId = row.dataset.notifLead || '';
    const dismissed = row.dataset.notifDismissed === '1';
    row.addEventListener('mouseenter', () => { row.style.background = 'var(--s2)'; });
    row.addEventListener('mouseleave', () => { row.style.background = dismissed ? '' : row.dataset.notifBg || ''; });
    row.addEventListener('click', () => notifAction(id, leadId, dismissed));

    const smsBtn = row.querySelector('.nbd-notif-sms');
    if (smsBtn) smsBtn.addEventListener('click', (e) => { e.stopPropagation(); sendFollowUpSMS(leadId); });

    const restoreBtn = row.querySelector('.nbd-notif-restore');
    if (restoreBtn) restoreBtn.addEventListener('click', (e) => { e.stopPropagation(); restoreNotification(id); });

    const dismissBtn = row.querySelector('.nbd-notif-dismiss');
    if (dismissBtn) dismissBtn.addEventListener('click', (e) => { e.stopPropagation(); dismissNotification(id); });
  });
}

function renderNotifications() {
  const list = document.getElementById('notifList');
  if (!list) return;

  const unreadCount = window._notifications.filter(n => !n.read).length;
  const dismissedCount = (window._dismissedNotifications||[]).length;

  // Show/hide header buttons
  const markAllBtn = document.querySelector('[onclick="markAllNotificationsRead()"]');
  if (markAllBtn) markAllBtn.style.display = unreadCount > 0 ? 'inline-block' : 'none';
  const clearAllBtn = document.getElementById('clearAllNotifBtn');
  if (clearAllBtn) clearAllBtn.style.display = window._notifications.length > 0 ? 'inline-block' : 'none';

  // Show/hide dismissed toggle
  const dismissedToggle = document.getElementById('notifDismissedToggle');
  if (dismissedToggle) dismissedToggle.style.display = dismissedCount > 0 ? 'block' : 'none';
  const dismissedCountEl = document.getElementById('dismissedCount');
  if (dismissedCountEl) dismissedCountEl.textContent = dismissedCount > 0 ? `(${dismissedCount})` : '';

  if (window._notifications.length === 0) {
    list.innerHTML = `
      <div style="padding:40px 20px;text-align:center;color:var(--m);">
        <div style="margin-bottom:8px;opacity:0.5;"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px;"><path d="M10 2a5 5 0 00-5 5c0 4-2 6-2 6h14s-2-2-2-6a5 5 0 00-5-5z"/><path d="M8.5 16a1.5 1.5 0 003 0"/></svg></div>
        <div style="font-size:13px;">${dismissedCount > 0 ? 'All caught up' : 'No notifications yet'}</div>
        ${dismissedCount > 0 ? '<div style="font-size:11px;color:var(--m);margin-top:4px;">Dismissed items are below</div>' : ''}
      </div>`;
    return;
  }

  list.innerHTML = window._notifications.map(n => renderNotifItem(n)).join('');
  wireNotifListeners(list);

  // Render dismissed list if open
  renderDismissedNotifications();
}

function getTimeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

window.toggleNotificationDropdown = function() {
  const dropdown = document.getElementById('notifDropdown');
  if (!dropdown) return;
  
  window._notifDropdownOpen = !window._notifDropdownOpen;
  
  if (window._notifDropdownOpen) {
    dropdown.style.display = 'flex';
    renderNotifications();
  } else {
    dropdown.style.display = 'none';
  }
};

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const notifBtn = document.getElementById('notifBtn');
  const dropdown = document.getElementById('notifDropdown');
  if (notifBtn && dropdown && window._notifDropdownOpen) {
    if (!notifBtn.contains(e.target) && !dropdown.contains(e.target)) {
      window._notifDropdownOpen = false;
      dropdown.style.display = 'none';
    }
  }
});

// ── Click a notification: mark read + navigate to lead ──
async function notifAction(notifId, leadId, isDismissed) {
  if (isDismissed) {
    // If clicking a dismissed notification, restore it
    await restoreNotification(notifId);
    return;
  }
  // Mark as read
  await markNotificationRead(notifId);
  // Navigate to the lead if we have one
  if (leadId && !leadId.startsWith('d-')) {
    // Close dropdown
    window._notifDropdownOpen = false;
    const dropdown = document.getElementById('notifDropdown');
    if (dropdown) dropdown.style.display = 'none';
    // Go to CRM and open the lead
    if (typeof goTo === 'function') goTo('crm');
    // Small delay to let CRM view render, then trigger lead card click
    setTimeout(() => {
      if (typeof handleCardClick === 'function') {
        handleCardClick(leadId);
      } else {
        // Fallback: find card and click it
        const card = document.querySelector(`.lead-card[data-id="${leadId}"]`);
        if (card) card.click();
      }
    }, 300);
  }
}

async function markNotificationRead(notifId) {
  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { updateDoc, doc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    await updateDoc(doc(_db, 'notifications', notifId), {
      read: true,
      readAt: serverTimestamp()
    });

    // Update local state
    const notif = window._notifications.find(n => n.id === notifId);
    if (notif) notif.read = true;

    // Refresh display
    await loadNotifications();

  } catch (error) {
    console.error('Error marking notification as read:', error);
  }
}

// ── Dismiss a single notification ──
async function dismissNotification(notifId) {
  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { updateDoc, doc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    await updateDoc(doc(_db, 'notifications', notifId), {
      dismissed: true,
      dismissedAt: serverTimestamp(),
      read: true
    });

    await loadNotifications();
    window.showToast?.('Notification dismissed', 'success');
  } catch (error) {
    console.error('Error dismissing notification:', error);
  }
}

// ── Clear ALL visible notifications ──
async function clearAllNotifications() {
  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { updateDoc, doc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    const visible = window._notifications.filter(n => !n.dismissed);
    if (!visible.length) return;

    await Promise.all(visible.map(n =>
      updateDoc(doc(_db, 'notifications', n.id), {
        dismissed: true,
        dismissedAt: serverTimestamp(),
        read: true
      })
    ));

    await loadNotifications();
    window.showToast?.(`${visible.length} notification${visible.length!==1?'s':''} cleared`, 'success');
  } catch (error) {
    console.error('Error clearing all notifications:', error);
  }
}

// ── Restore a dismissed notification ──
async function restoreNotification(notifId) {
  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { updateDoc, doc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    await updateDoc(doc(_db, 'notifications', notifId), {
      dismissed: false,
      read: false,
      restoredAt: serverTimestamp()
    });

    await loadNotifications();
    window.showToast?.('Notification restored', 'success');
  } catch (error) {
    console.error('Error restoring notification:', error);
  }
}

// ── Toggle dismissed notifications drawer ──
window._dismissedDrawerOpen = false;
function toggleDismissedNotifications() {
  window._dismissedDrawerOpen = !window._dismissedDrawerOpen;
  const dismissedList = document.getElementById('notifDismissedList');
  const toggleLabel = document.getElementById('dismissedToggleLabel');
  if (dismissedList) {
    dismissedList.style.display = window._dismissedDrawerOpen ? 'block' : 'none';
  }
  if (toggleLabel) {
    toggleLabel.textContent = window._dismissedDrawerOpen ? 'Hide dismissed' : 'Show dismissed';
  }
  if (window._dismissedDrawerOpen) renderDismissedNotifications();
}

function renderDismissedNotifications() {
  const list = document.getElementById('notifDismissedList');
  if (!list || !window._dismissedDrawerOpen) return;
  const dismissed = window._dismissedNotifications || [];
  if (!dismissed.length) {
    list.innerHTML = `<div style="padding:16px;text-align:center;font-size:11px;color:var(--m);">No dismissed notifications</div>`;
    return;
  }
  list.innerHTML = dismissed.map(n => renderNotifItem(n, {dismissed:true})).join('');
  wireNotifListeners(list);
}

async function markAllNotificationsRead() {
  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { updateDoc, doc, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    const unread = window._notifications.filter(n => !n.read);

    await Promise.all(unread.map(n =>
      updateDoc(doc(_db, 'notifications', n.id), {
        read: true,
        readAt: serverTimestamp()
      })
    ));

    // Update local state
    window._notifications.forEach(n => n.read = true);

    // Refresh display
    await loadNotifications();

  } catch (error) {
    console.error('Error marking all as read:', error);
  }
}

// Helper function to create notifications (for system use)
async function createNotification(userId, type, title, message, leadId = null) {
  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { addDoc, collection, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    await addDoc(collection(_db, 'notifications'), {
      userId: userId,
      type: type,
      title: title,
      message: message,
      leadId: leadId,
      read: false,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error creating notification:', error);
  }
}

// ══════════════════════════════════════════════════════════════════════
// FOLLOW-UP NOTIFICATION ENGINE
// ══════════════════════════════════════════════════════════════════════
async function checkAndCreateFollowUpNotifications(leads) {
  if (!window._user || !leads || !leads.length) return;
  // Respect the user's notif settings — if they turned the
  // "Overdue Follow-Ups" trigger off (or set mode=digest in
  // critical-only state), skip both the Firestore write AND
  // the browser Notification ping.
  // 'firestore' isn't a user-facing channel, so we just check
  // the trigger gate via 'follow_up' type with high priority.
  if (typeof window.shouldFireNotif === 'function' &&
      !window.shouldFireNotif('follow_up', null, 'high')) {
    return;
  }
  const userId = window._user.uid;

  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  // Categorize leads
  const overdue = [];
  const dueToday = [];
  const dueTomorrow = [];

  leads.forEach(l => {
    if (!l.followUp || ['Complete','Lost'].includes(l.stage||'')) return;
    const d = new Date(l.followUp); d.setHours(0,0,0,0);
    if (d < today) overdue.push(l);
    else if (d.getTime() === today.getTime()) dueToday.push(l);
    else if (d.getTime() === tomorrow.getTime()) dueTomorrow.push(l);
  });

  if (!overdue.length && !dueToday.length && !dueTomorrow.length) return;

  // Deduplicate — only create one notification per lead per day
  const todayKey = today.toISOString().split('T')[0];
  const existingKeys = new Set(
    (window._notifications || [])
      .filter(n => n.type === 'follow_up' && (n.dateKey === todayKey))
      .map(n => n.leadId)
  );

  // Wave 110: sanitize user-controlled fields BEFORE writing to
  // Firestore. The render path uses escHtml at display time so the
  // notification dropdown is XSS-safe today, but writing
  // unsanitized data into Firestore is a latent issue for any
  // future consumer that doesn't escape (admin panel, email
  // template, audit log, third-party integration). Sanitize at
  // write time so the data is clean at rest. Strips control
  // characters + caps length to avoid pathological inputs.
  const _sanitize = (s, max) => {
    if (typeof s !== 'string') return s;
    // Drop control characters + zero-width chars; keep newlines/tabs.
    const cleaned = s.replace(/[ --​-‏﻿]/g, '');
    return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
  };
  const _safeName = (l) =>
    _sanitize(`${l.firstName||''} ${l.lastName||''}`.trim() || (l.address||'').split(',')[0] || 'Lead', 80);
  const _safeAddr = (l) => _sanitize((l.address||'').split(',')[0] || '', 80);
  const _safeStage = (l) => _sanitize(l.stage || '', 40);
  const _safeCarrier = (l) => _sanitize(l.insCarrier || '', 40);

  const toCreate = [];

  overdue.forEach(l => {
    if (existingKeys.has(l.id)) return;
    const name = _safeName(l);
    const addr = _safeAddr(l);
    const stage = _safeStage(l);
    const daysLate = Math.round((today - new Date(l.followUp)) / 86400000);
    toCreate.push({
      userId, type: 'follow_up', leadId: l.id, dateKey: todayKey,
      title: `Overdue Follow-Up — ${name}`,
      message: `${daysLate} day${daysLate!==1?'s':''} overdue${addr ? ' · ' + addr : ''}. ${stage ? 'Stage: ' + stage : ''}`,
      priority: 'high', read: false
    });
  });

  dueToday.forEach(l => {
    if (existingKeys.has(l.id)) return;
    const name = _safeName(l);
    const addr = _safeAddr(l);
    const stage = _safeStage(l);
    const carrier = _safeCarrier(l);
    toCreate.push({
      userId, type: 'follow_up', leadId: l.id, dateKey: todayKey,
      title: `Follow-Up Today — ${name}`,
      message: `${addr ? addr + ' · ' : ''}${stage ? 'Stage: ' + stage : ''}${carrier ? ' · ' + carrier : ''}`,
      priority: 'normal', read: false
    });
  });

  dueTomorrow.forEach(l => {
    if (existingKeys.has(l.id)) return;
    const name = _safeName(l);
    const addr = _safeAddr(l);
    const stage = _safeStage(l);
    toCreate.push({
      userId, type: 'follow_up', leadId: l.id, dateKey: todayKey,
      title: `Follow-Up Tomorrow — ${name}`,
      message: `${addr ? addr + ' · ' : ''}${stage ? 'Stage: ' + stage : ''}`,
      priority: 'low', read: false
    });
  });

  if (!toCreate.length) return;

  // Write to Firestore
  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { addDoc, collection: firestoreCol, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    await Promise.all(toCreate.map(n =>
      addDoc(firestoreCol(_db, 'notifications'), {
        ...n,
        createdAt: serverTimestamp()
      })
    ));
    // Reload notifications so badge updates immediately
    await loadNotifications();

    // Browser notification if permitted AND push channel enabled in settings
    const pushAllowed = typeof window.shouldFireNotif === 'function'
      ? window.shouldFireNotif('follow_up', 'push', 'high')
      : true;
    if (pushAllowed && 'Notification' in window && Notification.permission === 'granted') {
      const overdueCount = overdue.filter(l => !existingKeys.has(l.id)).length;
      const todayCount = dueToday.filter(l => !existingKeys.has(l.id)).length;
      let body = '';
      if (overdueCount) body += `${overdueCount} overdue follow-up${overdueCount!==1?'s':''}. `;
      if (todayCount) body += `${todayCount} due today.`;
      if (body) new Notification('NBD Pro — Follow-Ups', { body: body.trim(), icon: '/favicon.ico' });
    }
  } catch(e) {
    console.error('Follow-up notification error:', e);
  }
}
window.checkAndCreateFollowUpNotifications = checkAndCreateFollowUpNotifications;

// ─────────────────────────────────────────────────────────
// Needs-field auto-notifier
// ─────────────────────────────────────────────────────────
// Walks the current lead cache and creates ONE notification per
// lead per day for any lead that:
//   - is non-terminal (not closed/lost)
//   - has been in its current stage > 1 day
//   - is missing one or more required fields for its current stage
//     (per missingRequiredFields() from crm-stages.js)
//
// Gated by the 'notifNeedsField' trigger in user settings. Dedupes
// against existing same-day notifications using the same dateKey
// pattern as checkAndCreateFollowUpNotifications.
//
// Fired alongside the follow-up check from the dashboard loadLeads
// success path (and the legacy bundle).
async function checkAndCreateNeedsFieldNotifications(leads) {
  if (!window._user || !leads || !leads.length) return;
  if (typeof window.missingRequiredFields !== 'function') return;
  // Trigger gate
  if (typeof window.shouldFireNotif === 'function' &&
      !window.shouldFireNotif('needs_field', null, 'normal')) {
    return;
  }
  const userId = window._user.uid;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayKey = today.toISOString().split('T')[0];

  // Existing keys: don't notify twice for the same lead today.
  // Match across both follow_up and needs_field types since the rep
  // sees the same physical card — a needs-field nudge on top of a
  // follow-up nudge for the same lead is noise.
  const existingKeys = new Set(
    (window._notifications || [])
      .filter(n => (n.type === 'needs_field' || n.type === 'follow_up') && n.dateKey === todayKey)
      .map(n => n.leadId)
  );

  const FIELD_LABELS = {
    insCarrier: 'carrier', claimNumber: 'claim #', policyNumber: 'policy #',
    dateOfLoss: 'date of loss', estimateAmount: 'estimate amount',
    deductibleOrOwedByHO: 'deductible', jobValue: 'job value',
    financeCompany: 'lender', loanAmount: 'loan amount',
    scheduledDate: 'install date'
  };

  const toCreate = [];
  for (const l of leads) {
    if (!l || !l.id) continue;
    if (existingKeys.has(l.id)) continue;
    const stage = (l._stageKey || l.stage || '').toString().toLowerCase();
    if (stage === 'closed' || stage === 'lost' || stage === 'complete') continue;

    // Only nudge after a lead has been in its current stage for 1+ day.
    // Fresh moves are noisy and the rep is actively working the lead.
    if (l.stageStartedAt) {
      let stageMs = 0;
      const s = l.stageStartedAt;
      if (s && typeof s.toMillis === 'function')      stageMs = s.toMillis();
      else if (s && typeof s.toDate === 'function')   stageMs = s.toDate().getTime();
      else if (s instanceof Date)                     stageMs = s.getTime();
      else if (typeof s === 'number')                 stageMs = s;
      if (stageMs && (Date.now() - stageMs) < 24 * 60 * 60 * 1000) continue;
    }

    let missing = [];
    try { missing = window.missingRequiredFields(l) || []; } catch (_) { continue; }
    if (missing.length === 0) continue;

    const niceList = missing.map(f => FIELD_LABELS[f] || f);
    const first = niceList[0];
    const more = niceList.length - 1;
    const name = ((l.firstName || '') + ' ' + (l.lastName || '')).trim() || (l.address || '').split(',')[0] || 'Lead';
    const stageLabel = (window.STAGE_META && window.STAGE_META[stage] && window.STAGE_META[stage].label) || stage || 'current stage';

    toCreate.push({
      userId,
      type: 'needs_field',
      leadId: l.id,
      dateKey: todayKey,
      title: `Needs ${first}${more > 0 ? ` +${more}` : ''} — ${name}`,
      message: `Stuck in ${stageLabel}. Add ${niceList.join(', ')} to advance.`,
      priority: 'normal',
      read: false
    });
  }

  if (!toCreate.length) return;

  try {
    const _db = window._db || window.db;
    if (!_db) return;
    const { addDoc, collection: firestoreCol, serverTimestamp } =
      await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    await Promise.all(toCreate.map(n =>
      addDoc(firestoreCol(_db, 'notifications'), Object.assign({}, n, {
        createdAt: serverTimestamp()
      }))
    ));
    if (typeof loadNotifications === 'function') await loadNotifications();
  } catch (e) {
    console.warn('Needs-field notification error:', e && e.message);
  }
}
window.checkAndCreateNeedsFieldNotifications = checkAndCreateNeedsFieldNotifications;
window.markNotificationRead = markNotificationRead;
window.markAllNotificationsRead = markAllNotificationsRead;
window.loadNotifications = loadNotifications;
window.renderNotifications = renderNotifications;
window.notifAction = notifAction;
window.dismissNotification = dismissNotification;
window.clearAllNotifications = clearAllNotifications;
window.restoreNotification = restoreNotification;
window.toggleDismissedNotifications = toggleDismissedNotifications;
window.renderDismissedNotifications = renderDismissedNotifications;

// ═══════════════════════════════════════════════════════════
// Auto-log communications from tel:/sms:/mailto: clicks
// ═══════════════════════════════════════════════════════════
// Critical Finding: "Communication not auto-logged — trust/memory hole."
// customer.html already logs on its own Call/Text/Email buttons, but
// every other surface (pipeline kanban cards, contact drawer rows,
// map popups, dashboard quick-contacts) just renders a plain
// <a href="tel:..."> with no logging. Reps tap those daily and nothing
// hits the timeline, so weeks later nobody can remember whether the
// customer was actually contacted.
//
// This delegated click handler catches EVERY tel:/sms:/mailto: anchor
// anywhere on the authed app and posts a lightweight `communications`
// doc if we can resolve a leadId from the surrounding DOM context.
// It deliberately doesn't block navigation — the protocol handler fires
// as normal; we just fire-and-forget the Firestore write alongside.
(function setupCommLogDelegate() {
  if (window.__NBD_COMM_LOG_DELEGATE) return;
  window.__NBD_COMM_LOG_DELEGATE = true;

  function resolveLeadId(anchor) {
    // Walk up from the clicked anchor looking for a data-lead-id,
    // data-id on a pipeline card, or the globally-current customer.
    let el = anchor;
    while (el && el !== document.body) {
      if (el.dataset && el.dataset.leadId) return el.dataset.leadId;
      if (el.dataset && el.dataset.id && el.classList && el.classList.contains('kc-card')) return el.dataset.id;
      el = el.parentElement;
    }
    return window._customerId || window._cardDetailLeadId || null;
  }

  function typeFromHref(href) {
    if (!href) return null;
    if (href.startsWith('tel:'))    return 'call';
    if (href.startsWith('sms:'))    return 'sms';
    if (href.startsWith('mailto:')) return 'email';
    return null;
  }

  document.addEventListener('click', function (e) {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const type = typeFromHref(a.getAttribute('href') || '');
    if (!type) return;
    const leadId = resolveLeadId(a);
    if (!leadId) return;
    // Skip if this anchor already has a dedicated handler that logs
    // (customer.html does; flag = data-nbd-log-skip="1").
    if (a.dataset && a.dataset.nbdLogSkip === '1') return;

    try {
      const uid = (window._user && window._user.uid) || null;
      if (!uid || !_db || !_addDoc || !_serverTimestamp) return;
      const descByType = { call: 'Tapped call link', sms: 'Tapped SMS link', email: 'Tapped email link' };
      _addDoc(col(_db, 'communications'), {
        leadId, userId: uid, type,
        direction: 'outbound',
        content: descByType[type] || 'Contacted customer',
        timestamp: _serverTimestamp(),
        source: 'crm_link_click'
      }).catch(err => console.warn('[comm-log] write failed:', err.message));
    } catch (err) {
      // Never break navigation because of a logging hiccup.
      console.warn('[comm-log] delegate threw:', err.message);
    }
  }, true);  // capture-phase so we fire before any stopPropagation handlers
})();

// Request browser notification permission.
// Must be called from a user-gesture handler (click/tap) per Chrome 80+,
// Firefox 72+, and Safari. Calling on page load gets silently denied on
// every modern browser and poisons the permission state until the user
// manually resets it. We now defer until the user clicks "Enable
// notifications" — wired via enableNotifCTA below.
async function requestNotifPermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch (e) {
    console.warn('[notif] permission request threw:', e);
    return 'denied';
  }
}
// Attach to any element tagged data-action="enable-notifications" so the
// call happens inside the click handler. Safe to call multiple times.
window.addEventListener('click', (e) => {
  const el = e.target && e.target.closest && e.target.closest('[data-action="enable-notifications"]');
  if (!el) return;
  requestNotifPermission().then(state => {
    if (typeof showToast === 'function') {
      if (state === 'granted') showToast('Notifications enabled', 'success');
      else if (state === 'denied') showToast('Notifications blocked — check browser settings', 'error');
    }
  });
});
// ══ END FOLLOW-UP NOTIFICATION ENGINE ═════════════════════════════════

// Load notifications on auth - poll for window._user set by main auth callback
let _notifInterval = null;
(function waitForNotifAuth() {
  if (window._user) {
    loadNotifications();
    if (_notifInterval) clearInterval(_notifInterval);
    _notifInterval = setInterval(loadNotifications, 120000);
  } else {
    setTimeout(waitForNotifAuth, 300);
  }
})();

// Wave 103: tear down the notification poll on sign-out + on
// pagehide so a re-auth as a different user doesn't leak the
// previous user's interval. Without this, every sign-out left the
// 2-min poll running with a now-stale auth context — calls would
// briefly hit `window._user` from the previous session before the
// auth state propagation cleared it. The onSnapshot listener was
// already torn down via window._notifUnsub; the polling fallback
// was the asymmetric leak.
window.addEventListener('nbd:auth-signed-out', () => {
  if (_notifInterval) { clearInterval(_notifInterval); _notifInterval = null; }
  if (typeof window._notifUnsub === 'function') {
    try { window._notifUnsub(); } catch(_) {}
    window._notifUnsub = null;
  }
});
window.addEventListener('pagehide', () => {
  if (_notifInterval) { clearInterval(_notifInterval); _notifInterval = null; }
});
