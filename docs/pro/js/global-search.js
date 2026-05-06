/**
 * global-search.js — Wave 18 (Cmd+K Global Search)
 *
 * Same pattern as the notification bell (Wave 13): the dashboard
 * already had a #cmdPalette modal sitting in the DOM with onclick
 * handlers (closeCmdPalette) referencing functions that never
 * existed. This module wires the palette into a real Cmd+K /
 * Ctrl+K / "/" search across the in-memory leads + estimates
 * caches so reps can jump to anything in two keystrokes.
 *
 * Sources of truth:
 *   - Leads      — window._leads (firstName, lastName, address,
 *                  phone, customerId)
 *   - Estimates  — window._estimates (joined to lead by leadId)
 *
 * Keybindings:
 *   - Cmd+K  / Ctrl+K  — toggle palette
 *   - "/" key          — open palette (only when not already
 *                         typing in another input/textarea)
 *   - Esc              — close palette
 *   - ↑/↓              — move selection
 *   - Enter            — navigate to selected
 *
 * Exposes: window.openCmdPalette, window.closeCmdPalette,
 *          window.GlobalSearch.{search, focus}
 */
(function () {
  'use strict';

  if (window.GlobalSearch && window.GlobalSearch.__sentinel === 'nbd-global-search-v1') return;

  const MAX_RESULTS_PER_GROUP = 8;
  const MIN_QUERY = 1;

  let selectedIndex = 0;
  let lastResults = []; // flat list, in render order
  let inputDebounceTimer = null;

  // ─── Helpers ─────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function normalize(s) {
    return String(s || '').toLowerCase().trim();
  }

  function leadName(l) {
    const n = `${l.firstName || ''} ${l.lastName || ''}`.trim();
    return n || l.address || 'Unnamed lead';
  }

  function highlight(text, query) {
    if (!text || !query) return escapeHtml(text);
    const safe = escapeHtml(text);
    if (query.length < 1) return safe;
    // Escape regex special chars in the query.
    const re = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    return safe.replace(re, '<mark style="background:var(--orange,#c8541a);color:#fff;padding:0 2px;border-radius:2px;font-weight:600;">$1</mark>');
  }

  // ─── Search ──────────────────────────────────────────────────────
  function searchLeads(query, leads) {
    const q = normalize(query);
    if (!q) return [];
    const phoneDigits = q.replace(/\D+/g, '');
    const results = [];
    for (const l of leads) {
      if (!l || l.deleted) continue;
      const name   = normalize(`${l.firstName || ''} ${l.lastName || ''}`);
      const addr   = normalize(l.address);
      const phone  = (l.phone || '').replace(/\D+/g, '');
      const custId = normalize(l.customerId);
      const email  = normalize(l.email);
      let score = 0;
      let reason = '';

      // Customer ID — highest specificity, often used as a quick lookup
      if (custId && custId.includes(q))   { score += 100; reason = `Customer ID: ${l.customerId}`; }
      // Name match
      else if (name && name.includes(q))  { score += 80;  reason = ''; }
      // Phone digits match
      else if (phoneDigits && phone && phone.includes(phoneDigits)) {
        score += 70; reason = `Phone: ${l.phone}`;
      }
      // Address match
      else if (addr && addr.includes(q))  { score += 50; reason = `Address: ${l.address}`; }
      // Email match
      else if (email && email.includes(q)){ score += 40; reason = `Email: ${l.email}`; }

      if (score > 0) results.push({ type: 'lead', lead: l, score, reason });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS_PER_GROUP);
  }

  function searchEstimates(query, estimates, leads) {
    const q = normalize(query);
    if (!q) return [];
    const leadById = {};
    for (const l of leads) leadById[l.id] = l;
    const results = [];
    for (const e of estimates) {
      if (!e) continue;
      const lead = leadById[e.leadId] || null;
      const leadStr = lead ? normalize(leadName(lead)) : '';
      const total = String(Math.round(Number(e.total || e.amount || 0)));
      const estNum = normalize(e.estimateNumber || e.number || '');
      let score = 0;
      let reason = '';
      if (estNum && estNum.includes(q))             { score += 90; reason = `Estimate #${e.estimateNumber || e.number}`; }
      else if (leadStr && leadStr.includes(q))      { score += 70; }
      else if (total && total.includes(q.replace(/\D+/g, ''))) { score += 40; reason = `$${Number(total).toLocaleString()}`; }
      if (score > 0) results.push({ type: 'estimate', estimate: e, lead, score, reason });
    }
    return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS_PER_GROUP);
  }

  // ─── Render ──────────────────────────────────────────────────────
  function renderResults(query) {
    const container = document.getElementById('cmdResults');
    if (!container) return;
    selectedIndex = 0;
    lastResults = [];

    if (!query || query.length < MIN_QUERY) {
      container.innerHTML = `
        <div class="cmd-empty">
          <div style="font-size:32px;margin-bottom:8px;opacity:0.4;">🔍</div>
          <div style="margin-bottom:6px;color:var(--t,#e8eaf0);font-weight:600;">Find anything in your CRM</div>
          <div style="font-size:11px;line-height:1.6;">
            Type a name, address, phone, customer ID, or estimate amount.<br>
            Use <span class="cmd-kbd">↑</span> <span class="cmd-kbd">↓</span> to navigate, <span class="cmd-kbd">↵</span> to open.
          </div>
        </div>`;
      return;
    }

    const leads = Array.isArray(window._leads) ? window._leads : [];
    const estimates = Array.isArray(window._estimates) ? window._estimates : [];

    const leadHits = searchLeads(query, leads);
    const estHits  = searchEstimates(query, estimates, leads);
    lastResults = [...leadHits, ...estHits];

    if (lastResults.length === 0) {
      container.innerHTML = `
        <div class="cmd-empty">
          <div style="font-size:24px;margin-bottom:8px;opacity:0.4;">🔍</div>
          <div>No matches for "${escapeHtml(query)}".</div>
          <div style="font-size:11px;margin-top:6px;opacity:0.7;">Try a name, partial phone, or street.</div>
        </div>`;
      return;
    }

    // Wave 51: inline reshare buttons on lead search results.
    // Same color-coded 📞/💬/📧 trio used by Hot Leads (W47),
    // Almost There (W46), bell rows (W48), and the activity feed
    // (W49). Cmd+K is the fifth and final priority surface — once
    // this lands the share trio is universal across every place
    // a rep can encounter a lead in the app.
    const renderLeadActions = (l) => {
      const phoneDigits = String(l.phone || '').replace(/\D+/g, '');
      const email = String(l.email || '').trim();
      const buttons = [];
      if (phoneDigits) {
        buttons.push(`
          <a class="cmd-action" href="tel:${escapeHtml(phoneDigits)}"
            title="Call ${escapeHtml(l.phone)}"
            style="
              display:flex; align-items:center; justify-content:center;
              width:24px; height:24px; border-radius:5px;
              background:rgba(16,185,129,0.14); color:#10b981;
              text-decoration:none; font-size:11px;
              -webkit-tap-highlight-color:transparent;
              transition:transform .12s;"
            onclick="event.stopPropagation();"
            onmouseover="this.style.transform='scale(1.10)'"
            onmouseout="this.style.transform=''"
          >📞</a>`);
        buttons.push(`
          <button class="cmd-action" type="button"
            data-action="sms" data-lead-id="${escapeHtml(l.id)}"
            title="Text portal link to ${escapeHtml(l.phone)}"
            style="
              display:flex; align-items:center; justify-content:center;
              width:24px; height:24px; border-radius:5px;
              background:rgba(59,130,246,0.14); color:#3b82f6;
              border:none; font-size:11px; cursor:pointer;
              -webkit-tap-highlight-color:transparent;
              transition:transform .12s;"
            onmouseover="this.style.transform='scale(1.10)'"
            onmouseout="this.style.transform=''"
          >💬</button>`);
      }
      if (email) {
        buttons.push(`
          <button class="cmd-action" type="button"
            data-action="email" data-lead-id="${escapeHtml(l.id)}"
            title="Email portal link to ${escapeHtml(email)}"
            style="
              display:flex; align-items:center; justify-content:center;
              width:24px; height:24px; border-radius:5px;
              background:rgba(139,92,246,0.14); color:#8b5cf6;
              border:none; font-size:11px; cursor:pointer;
              -webkit-tap-highlight-color:transparent;
              transition:transform .12s;"
            onmouseover="this.style.transform='scale(1.10)'"
            onmouseout="this.style.transform=''"
          >📧</button>`);
      }
      if (buttons.length === 0) return '';
      return `<div style="display:flex; gap:3px; flex-shrink:0; align-items:center; margin-right:6px;">${buttons.join('')}</div>`;
    };

    const renderLeadRow = (hit, idx) => {
      const l = hit.lead;
      const name = leadName(l);
      const sub = hit.reason || [l.address, l.phone].filter(Boolean).join(' · ');
      return `
        <div class="cmd-item ${idx === selectedIndex ? 'selected' : ''}" data-cmd-index="${idx}">
          <div class="cmd-icon">👤</div>
          <div class="cmd-content">
            <div class="cmd-title">${highlight(name, query)}</div>
            <div class="cmd-subtitle">${highlight(sub || '', query)}</div>
          </div>
          ${renderLeadActions(l)}
          ${l.customerId ? `<span class="cmd-badge recent">${escapeHtml(l.customerId)}</span>` : ''}
        </div>`;
    };

    const renderEstRow = (hit, idx) => {
      const e = hit.estimate;
      const lead = hit.lead;
      const title = `${lead ? leadName(lead) : 'Estimate'} · $${Number(e.total || e.amount || 0).toLocaleString()}`;
      const sub = e.estimateNumber ? `#${e.estimateNumber}` : (e.status || 'estimate');
      return `
        <div class="cmd-item ${idx === selectedIndex ? 'selected' : ''}" data-cmd-index="${idx}">
          <div class="cmd-icon">📄</div>
          <div class="cmd-content">
            <div class="cmd-title">${highlight(title, query)}</div>
            <div class="cmd-subtitle">${escapeHtml(sub)}</div>
          </div>
          <span class="cmd-badge new">Estimate</span>
        </div>`;
    };

    let html = '';
    let runningIdx = 0;
    if (leadHits.length > 0) {
      html += '<div class="cmd-section"><div class="cmd-section-label">Leads</div>';
      for (const hit of leadHits) html += renderLeadRow(hit, runningIdx++);
      html += '</div>';
    }
    if (estHits.length > 0) {
      html += '<div class="cmd-section"><div class="cmd-section-label">Estimates</div>';
      for (const hit of estHits) html += renderEstRow(hit, runningIdx++);
      html += '</div>';
    }
    container.innerHTML = html;

    // Wave 51: inline action button handlers. Wired BEFORE the row
    // click handlers so stopPropagation on the buttons takes effect
    // before the parent .cmd-item click would otherwise activate
    // the selection. SMS + Email delegate to PortalLinkHelpers
    // (W42) which fires the W44 lastSharedAt tracking on success.
    container.querySelectorAll('.cmd-action[data-action]').forEach(btn => {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-lead-id');
        if (!id) return;
        const lead = (Array.isArray(window._leads) ? window._leads : [])
          .find(l => l && l.id === id);
        if (!lead) return;
        if (action === 'sms' && window.PortalLinkHelpers) {
          window.PortalLinkHelpers.smsForLead(lead);
        } else if (action === 'email' && window.PortalLinkHelpers) {
          window.PortalLinkHelpers.emailForLead(lead);
        }
        // Close the palette so the rep can see whatever surface
        // the action handed off to (SMS composer, mail client).
        closePalette();
      });
    });

    // Wire click handlers (delegation would also work).
    container.querySelectorAll('.cmd-item').forEach(el => {
      el.addEventListener('click', (ev) => {
        // If the click originated on an action button, it already
        // stopped propagation — but defensive check in case a child
        // element of the button slipped through.
        if (ev.target && ev.target.closest && ev.target.closest('.cmd-action')) return;
        const i = parseInt(el.getAttribute('data-cmd-index'), 10);
        activate(i);
      });
      el.addEventListener('mouseenter', () => {
        const i = parseInt(el.getAttribute('data-cmd-index'), 10);
        if (!isNaN(i)) {
          selectedIndex = i;
          updateSelection();
        }
      });
    });
  }

  function updateSelection() {
    const container = document.getElementById('cmdResults');
    if (!container) return;
    container.querySelectorAll('.cmd-item').forEach((el, i) => {
      el.classList.toggle('selected', i === selectedIndex);
    });
    // Scroll selected into view.
    const sel = container.querySelector('.cmd-item.selected');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function activate(index) {
    const hit = lastResults[index];
    if (!hit) return;
    closePalette();
    if (hit.type === 'lead') {
      // Stash for instant render on customer.html (Wave 11).
      try {
        if (typeof window._stashLeadForCustomerPage === 'function') {
          window._stashLeadForCustomerPage(hit.lead.id);
        }
      } catch (e) {}
      window.location.href = `/pro/customer.html?id=${encodeURIComponent(hit.lead.id)}`;
    } else if (hit.type === 'estimate') {
      window.location.href = `/pro/dashboard.html?tab=estimates&est=${encodeURIComponent(hit.estimate.id)}`;
    }
  }

  // ─── Open / close ────────────────────────────────────────────────
  function openPalette() {
    const palette = document.getElementById('cmdPalette');
    const input = document.getElementById('cmdInput');
    if (!palette || !input) return;
    palette.style.display = 'flex';
    input.value = '';
    selectedIndex = 0;
    lastResults = [];
    renderResults('');
    // Defer focus so iOS Safari actually shows the keyboard reliably.
    setTimeout(() => input.focus(), 30);
  }

  function closePalette() {
    const palette = document.getElementById('cmdPalette');
    if (!palette) return;
    palette.style.display = 'none';
    if (inputDebounceTimer) {
      clearTimeout(inputDebounceTimer);
      inputDebounceTimer = null;
    }
  }

  function isPaletteOpen() {
    const palette = document.getElementById('cmdPalette');
    return palette && palette.style.display !== 'none';
  }

  // ─── Keybindings ─────────────────────────────────────────────────
  function isTypingInForm(target) {
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  function onGlobalKeydown(ev) {
    // Cmd+K / Ctrl+K — toggle from anywhere.
    const k = ev.key && ev.key.toLowerCase();
    if (k === 'k' && (ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey) {
      ev.preventDefault();
      if (isPaletteOpen()) closePalette();
      else openPalette();
      return;
    }
    // "/" — open only when not focused on an input.
    if (ev.key === '/' && !ev.metaKey && !ev.ctrlKey && !ev.altKey
        && !isTypingInForm(ev.target) && !isPaletteOpen()) {
      ev.preventDefault();
      openPalette();
      return;
    }
    // Within the palette: Esc / arrows / Enter.
    if (!isPaletteOpen()) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closePalette();
      return;
    }
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      if (lastResults.length === 0) return;
      selectedIndex = Math.min(lastResults.length - 1, selectedIndex + 1);
      updateSelection();
      return;
    }
    if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (lastResults.length === 0) return;
      selectedIndex = Math.max(0, selectedIndex - 1);
      updateSelection();
      return;
    }
    if (ev.key === 'Enter') {
      ev.preventDefault();
      activate(selectedIndex);
      return;
    }
  }

  function onInputChange() {
    const input = document.getElementById('cmdInput');
    if (!input) return;
    const q = input.value || '';
    if (inputDebounceTimer) clearTimeout(inputDebounceTimer);
    inputDebounceTimer = setTimeout(() => {
      renderResults(q);
    }, 80);
  }

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    const input = document.getElementById('cmdInput');
    if (input) input.addEventListener('input', onInputChange);
    document.addEventListener('keydown', onGlobalKeydown);
  }

  // Wire legacy onclick handlers expected by dashboard.html
  window.openCmdPalette = openPalette;
  window.closeCmdPalette = closePalette;

  window.GlobalSearch = {
    __sentinel: 'nbd-global-search-v1',
    open: openPalette,
    close: closePalette,
    search: (q) => {
      const leads = Array.isArray(window._leads) ? window._leads : [];
      const ests  = Array.isArray(window._estimates) ? window._estimates : [];
      return [...searchLeads(q, leads), ...searchEstimates(q, ests, leads)];
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
