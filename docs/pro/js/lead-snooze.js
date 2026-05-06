/**
 * lead-snooze.js — Wave 35 (Snooze a lead until a future date)
 *
 * Every rep has 5-10 leads at any time they want to push out — the
 * customer who said "call me in two weeks", the homeowner waiting on
 * adjuster paperwork, the spring-storm prospect who's not actionable
 * until storm season. Until now those leads sat on the kanban
 * cluttering the view and tripping bell + Hot Leads + Needs
 * Attention into surfacing them as stale.
 *
 * This wave introduces a tiny per-lead "snoozedUntil" field plus
 * filter integration:
 *
 *   - lead-snooze.js (this module): API + UI for set/clear/prompt
 *   - kanban-context-menu.js: adds 💤 Snooze / ⏰ Unsnooze item
 *   - hot-leads-widget.js: skips snoozed leads
 *   - needs-attention-filter.js: skips snoozed leads
 *   - notif-bell.js: skips stale-stage + overdue-task signals on
 *                    snoozed leads (estimates still show — those
 *                    aren't suppressed by the rep's deferral)
 *   - crm.js: kanban hides snoozed cards by default; "Show
 *             snoozed" header toggle to bring them back
 *   - customer.html: banner at top "Snoozed until <date>" with
 *                    a one-tap Unsnooze when the lead is
 *                    currently snoozed
 *
 * Auto-unsnooze: when `snoozedUntil < now`, every filter just
 * passes the lead through — no cron, no scheduler, just
 * inequality-on-read.
 *
 * Exposes: window.LeadSnooze
 */
(function () {
  'use strict';

  if (window.LeadSnooze && window.LeadSnooze.__sentinel === 'nbd-lead-snooze-v1') return;

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

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  // ─── Snooze status ──────────────────────────────────────────────
  function isSnoozed(lead) {
    if (!lead) return false;
    const until = toMillis(lead.snoozedUntil);
    return until > Date.now();
  }

  function snoozedUntilDate(lead) {
    if (!lead) return null;
    const ms = toMillis(lead.snoozedUntil);
    if (ms <= 0) return null;
    return new Date(ms);
  }

  // Friendly label like "Tomorrow", "Next Monday", "Apr 23".
  function formatSnoozeLabel(date) {
    if (!date) return '';
    const now = new Date();
    const sod = new Date(now); sod.setHours(0, 0, 0, 0);
    const tgtSod = new Date(date); tgtSod.setHours(0, 0, 0, 0);
    const dayMs = 86400000;
    const days = Math.round((tgtSod - sod) / dayMs);
    if (days <= 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days < 7)  return date.toLocaleDateString('en-US', { weekday: 'long' });
    if (days < 14) return 'next ' + date.toLocaleDateString('en-US', { weekday: 'long' });
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ─── Firestore writes ────────────────────────────────────────────
  async function snooze(leadId, untilDate) {
    if (!leadId) throw new Error('leadId required');
    if (!(untilDate instanceof Date) || isNaN(untilDate)) throw new Error('untilDate required');
    if (!window.db || !window.doc || !window.updateDoc) {
      throw new Error('Firestore not loaded');
    }
    const ref = window.doc(window.db, 'leads', leadId);
    await window.updateDoc(ref, {
      snoozedUntil: untilDate,
      updatedAt: window.serverTimestamp ? window.serverTimestamp() : new Date(),
    });
    // Patch in-memory cache so the kanban + filters update immediately.
    if (Array.isArray(window._leads)) {
      const i = window._leads.findIndex(l => l && l.id === leadId);
      if (i >= 0) window._leads[i] = { ...window._leads[i], snoozedUntil: untilDate };
    }
    // Customer detail page also reads window._currentLead (set by
    // loadCustomerData). Patch that mirror so the customer-page
    // banner picks up the new state without a Firestore re-read.
    if (window._currentLead && window._currentLead.id === leadId) {
      window._currentLead = { ...window._currentLead, snoozedUntil: untilDate };
    }
    try { window.dispatchEvent(new CustomEvent('nbd:data-refreshed', { detail: { source: 'snooze' } })); } catch (_) {}
    if (typeof window.renderLeads === 'function') {
      try { window.renderLeads(window._leads, window._filteredLeads); } catch (_) {}
    }
    return true;
  }

  async function unsnooze(leadId) {
    if (!leadId) throw new Error('leadId required');
    if (!window.db || !window.doc || !window.updateDoc || !window.deleteField) {
      // deleteField is the Firestore sentinel we'd want, but we can
      // just set null which is equally well-handled by toMillis() → 0.
      // Falls through to plain updateDoc below.
    }
    const ref = window.doc(window.db, 'leads', leadId);
    await window.updateDoc(ref, {
      snoozedUntil: null,
      updatedAt: window.serverTimestamp ? window.serverTimestamp() : new Date(),
    });
    if (Array.isArray(window._leads)) {
      const i = window._leads.findIndex(l => l && l.id === leadId);
      if (i >= 0) window._leads[i] = { ...window._leads[i], snoozedUntil: null };
    }
    // Same _currentLead mirror update as snooze() — keeps the
    // customer-page banner in sync without a Firestore re-read.
    if (window._currentLead && window._currentLead.id === leadId) {
      window._currentLead = { ...window._currentLead, snoozedUntil: null };
    }
    try { window.dispatchEvent(new CustomEvent('nbd:data-refreshed', { detail: { source: 'unsnooze' } })); } catch (_) {}
    if (typeof window.renderLeads === 'function') {
      try { window.renderLeads(window._leads, window._filteredLeads); } catch (_) {}
    }
    return true;
  }

  // ─── Date picker modal ──────────────────────────────────────────
  // Presets cover the common asks (tomorrow morning / next Monday /
  // 1 week / 2 weeks / 1 month) plus a custom date input. Each
  // preset sets the time to 9 AM local so the lead reappears in the
  // morning, not at midnight.
  function _morningOfDay(date) {
    const d = new Date(date);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  function _nextMonday() {
    const now = new Date();
    const dow = now.getDay();          // 0 Sun, 1 Mon, ...
    const daysUntilMon = (8 - dow) % 7 || 7;
    const next = new Date(now);
    next.setDate(now.getDate() + daysUntilMon);
    return _morningOfDay(next);
  }

  function _addDays(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return _morningOfDay(d);
  }

  function buildPresets() {
    return [
      { label: 'Tomorrow morning',  date: _addDays(1) },
      { label: 'Next Monday',       date: _nextMonday() },
      { label: '1 week from now',   date: _addDays(7) },
      { label: '2 weeks from now',  date: _addDays(14) },
      { label: '1 month from now',  date: _addDays(30) },
    ];
  }

  function openSnoozeModal(leadId, leadNameHint) {
    closeSnoozeModal();
    const overlay = document.createElement('div');
    overlay.id = 'nbd-snooze-overlay';
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:99996;
      display:flex; align-items:center; justify-content:center; padding:20px;
      font-family:'Barlow',-apple-system,system-ui,sans-serif;`;

    const presets = buildPresets();
    overlay.innerHTML = `
      <div style="
        background:var(--s,#1a1f2a); color:var(--t,#e8eaf0);
        border:1px solid var(--br,#2a3344); border-radius:12px;
        padding:22px; max-width:380px; width:100%;
        box-shadow:0 12px 40px rgba(0,0,0,0.5);">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
          <span style="font-size:24px;">💤</span>
          <h2 style="font-size:17px; margin:0;">Snooze lead</h2>
        </div>
        <p style="font-size:12px; color:var(--m,#9aa3b2); margin:0 0 14px; line-height:1.5;">
          ${leadNameHint ? escapeHtml(leadNameHint) + ' ' : ''}will hide from the kanban + Hot Leads + Needs Attention until the snooze expires.
        </p>
        <div id="nbd-snooze-presets" style="display:flex; flex-direction:column; gap:6px; margin-bottom:14px;">
          ${presets.map((p, i) => `
            <button data-snooze-i="${i}" type="button" style="
              text-align:left; padding:10px 13px; border-radius:8px;
              background:var(--s2,#0f1419); color:var(--t,#e8eaf0);
              border:1px solid var(--br,#2a3344);
              font: inherit; font-size:13px; font-weight:600;
              cursor:pointer; -webkit-tap-highlight-color:transparent;
              display:flex; justify-content:space-between; align-items:center;">
              <span>${escapeHtml(p.label)}</span>
              <span style="font-size:10px; color:var(--m,#9aa3b2); font-weight:500;">
                ${escapeHtml(p.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}
              </span>
            </button>
          `).join('')}
        </div>
        <div style="border-top:1px solid var(--br,#2a3344); padding-top:12px; margin-bottom:14px;">
          <label style="display:block; font-size:11px; color:var(--m,#9aa3b2); margin-bottom:6px; font-weight:600; text-transform:uppercase; letter-spacing:0.4px;">
            Or pick a date
          </label>
          <div style="display:flex; gap:8px;">
            <input type="date" id="nbd-snooze-custom" style="
              flex:1; background:var(--s2,#0f1419); color:var(--t,#e8eaf0);
              border:1px solid var(--br,#2a3344); border-radius:6px;
              padding:8px 10px; font: inherit; font-size:13px;
              color-scheme:dark;">
            <button id="nbd-snooze-custom-go" type="button" style="
              background:linear-gradient(135deg,#c8541a 0%,#a64516 100%);
              color:#fff; border:none; padding:8px 16px; border-radius:6px;
              font: inherit; font-size:12px; font-weight:700;
              cursor:pointer; -webkit-tap-highlight-color:transparent;">Go</button>
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end;">
          <button id="nbd-snooze-cancel" type="button" style="
            background:transparent; color:var(--m,#9aa3b2);
            border:1px solid var(--br,#2a3344); padding:8px 16px;
            border-radius:7px; font: inherit; font-size:12px; font-weight:600;
            cursor:pointer; -webkit-tap-highlight-color:transparent;">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    // Default the custom input to one week out so power users don't
    // have to type a full date.
    const customEl = overlay.querySelector('#nbd-snooze-custom');
    if (customEl) {
      const oneWeek = _addDays(7);
      customEl.value = `${oneWeek.getFullYear()}-${String(oneWeek.getMonth() + 1).padStart(2, '0')}-${String(oneWeek.getDate()).padStart(2, '0')}`;
    }

    overlay.querySelectorAll('[data-snooze-i]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const i = parseInt(btn.getAttribute('data-snooze-i'), 10);
        const p = presets[i];
        if (!p) return;
        await _doSnooze(leadId, p.date, p.label);
      });
      btn.addEventListener('mouseover', () => { btn.style.background = 'var(--s,#1a1f2a)'; });
      btn.addEventListener('mouseout',  () => { btn.style.background = 'var(--s2,#0f1419)'; });
    });
    overlay.querySelector('#nbd-snooze-custom-go').addEventListener('click', async () => {
      const v = customEl ? customEl.value : '';
      if (!v) { _toast('Pick a date first', 'error'); return; }
      const d = _morningOfDay(new Date(v + 'T00:00:00'));
      if (isNaN(d) || d.getTime() <= Date.now()) {
        _toast('Pick a future date', 'error');
        return;
      }
      await _doSnooze(leadId, d, formatSnoozeLabel(d));
    });
    overlay.querySelector('#nbd-snooze-cancel').addEventListener('click', closeSnoozeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeSnoozeModal(); });
  }

  function closeSnoozeModal() {
    const el = document.getElementById('nbd-snooze-overlay');
    if (el) el.remove();
  }

  async function _doSnooze(leadId, date, label) {
    closeSnoozeModal();
    try {
      await snooze(leadId, date);
      _toast(`Snoozed until ${label}`, 'success');
    } catch (e) {
      console.error('[snooze] failed', e);
      _toast('Snooze failed: ' + (e.message || 'unknown'), 'error');
    }
  }

  async function _doUnsnooze(leadId) {
    try {
      await unsnooze(leadId);
      _toast('Lead unsnoozed', 'success');
    } catch (e) {
      console.error('[unsnooze] failed', e);
      _toast('Unsnooze failed: ' + (e.message || 'unknown'), 'error');
    }
  }

  // ─── Show-snoozed toggle wiring ─────────────────────────────────
  // The kanban header has a Snoozed button that toggles localStorage
  // flag nbd_crm_show_snoozed. We listen for clicks via a window
  // handler + update the toggle button styling + count badge.
  function toggleShowSnoozed() {
    const cur = localStorage.getItem('nbd_crm_show_snoozed') === '1';
    const next = !cur;
    if (next) localStorage.setItem('nbd_crm_show_snoozed', '1');
    else      localStorage.removeItem('nbd_crm_show_snoozed');
    updateSnoozedToggle();
    if (typeof window.renderLeads === 'function') {
      try { window.renderLeads(window._leads, window._filteredLeads); } catch (_) {}
    }
  }

  function updateSnoozedToggle() {
    const btn   = document.getElementById('snoozedToggleBtn');
    const badge = document.getElementById('snoozedCountBadge');
    if (!btn) return;
    const showing = localStorage.getItem('nbd_crm_show_snoozed') === '1';
    const leads = Array.isArray(window._leads) ? window._leads : [];
    const count = leads.filter(l => !l.deleted && isSnoozed(l)).length;

    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
    if (showing) {
      btn.style.background  = 'rgba(155,109,255,0.18)';
      btn.style.borderColor = '#9b6dff';
      btn.style.color       = '#cab8ff';
    } else {
      btn.style.background  = '';
      btn.style.borderColor = '';
      btn.style.color       = '';
    }
  }

  // Re-paint on data refresh + once on load.
  window.addEventListener('nbd:data-refreshed', updateSnoozedToggle);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(updateSnoozedToggle, 1500));
  } else {
    setTimeout(updateSnoozedToggle, 1500);
  }

  // ─── Public API ─────────────────────────────────────────────────
  window.LeadSnooze = {
    __sentinel: 'nbd-lead-snooze-v1',
    isSnoozed,
    snoozedUntilDate,
    formatSnoozeLabel,
    snooze,
    unsnooze,
    prompt: openSnoozeModal,
    promptUnsnooze: _doUnsnooze,
    closeModal: closeSnoozeModal,
    toggleShowSnoozed,
    updateSnoozedToggle,
  };
  window.toggleShowSnoozed = toggleShowSnoozed;
})();
