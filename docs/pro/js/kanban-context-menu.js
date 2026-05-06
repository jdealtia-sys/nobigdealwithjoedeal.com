/**
 * kanban-context-menu.js — Wave 26 (Kanban card context menu)
 *
 * Reps do the same handful of actions on kanban cards dozens of
 * times a day: open the detail modal, edit fields, add a task,
 * call the customer, copy their address into Maps, delete a dud.
 * Until now each one needed either drag-clicking the right tiny
 * footer icon or opening the detail modal first. This wave gives
 * a context menu that floats next to whichever card the rep
 * right-clicked or long-pressed — desktop AND mobile both get
 * the same vocabulary.
 *
 * Triggers:
 *   - Right-click on .k-card (contextmenu event)
 *   - Long-press (500ms touchstart with no touchmove) on .k-card
 *
 * Menu items (each gracefully no-ops if the underlying handler
 * isn't loaded — the module never fails closed):
 *   - View details          → openCardDetailModal
 *   - Edit                  → editLead
 *   - Add task              → openTaskModal
 *   - Call (when phone set) → tel: link
 *   - Copy phone            → clipboard
 *   - Copy address          → clipboard
 *   - Open in Maps          → maps.apple.com / google.com/maps
 *   - Delete                → deleteLead (which already confirms)
 *
 * Dismissed on: outside click, Esc, scroll, second contextmenu
 * elsewhere. Auto-positions to stay inside viewport.
 *
 * Exposes: window.KanbanContextMenu.{open, close}
 */
(function () {
  'use strict';

  if (window.KanbanContextMenu && window.KanbanContextMenu.__sentinel === 'nbd-kanban-ctx-v1') return;

  const LONG_PRESS_MS = 500;
  let menuEl = null;
  let touchTimer = null;
  let touchStart = null;

  // ─── Helpers ─────────────────────────────────────────────────────
  function findLead(leadId) {
    if (!Array.isArray(window._leads)) return null;
    return window._leads.find(l => l && l.id === leadId) || null;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function copyToClipboard(text) {
    if (!text) return Promise.resolve(false);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
    }
    // Legacy fallback for environments without async clipboard.
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return Promise.resolve(ok);
    } catch (e) { return Promise.resolve(false); }
  }

  function _toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, type || 'info');
  }

  function isApplePlatform() {
    const ua = navigator.userAgent || '';
    return /iP(ad|hone|od)|Macintosh/.test(ua);
  }

  function mapsUrl(addr) {
    const q = encodeURIComponent(addr);
    return isApplePlatform()
      ? `https://maps.apple.com/?q=${q}`
      : `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  // ─── Menu rendering ─────────────────────────────────────────────
  function buildMenu(lead, x, y) {
    const items = [];
    items.push({
      icon: '👁',
      label: 'View details',
      onSelect: () => window.openCardDetailModal && window.openCardDetailModal(lead.id),
    });
    items.push({
      icon: '✏️',
      label: 'Edit lead',
      onSelect: () => window.editLead && window.editLead(lead.id),
    });
    items.push({
      icon: '✓',
      label: 'Add task',
      onSelect: () => window.openTaskModal && window.openTaskModal(lead.id, null),
    });
    if (lead.phone) {
      const phoneDigits = String(lead.phone).replace(/\D+/g, '');
      items.push({ divider: true });
      items.push({
        icon: '📞',
        label: `Call ${lead.phone}`,
        onSelect: () => { window.location.href = 'tel:' + phoneDigits; },
      });
      items.push({
        icon: '📋',
        label: 'Copy phone',
        onSelect: async () => {
          const ok = await copyToClipboard(lead.phone);
          _toast(ok ? 'Phone copied' : 'Couldn\'t copy phone', ok ? 'success' : 'error');
        },
      });
    }
    if (lead.address) {
      if (!lead.phone) items.push({ divider: true });
      items.push({
        icon: '📋',
        label: 'Copy address',
        onSelect: async () => {
          const ok = await copyToClipboard(lead.address);
          _toast(ok ? 'Address copied' : 'Couldn\'t copy address', ok ? 'success' : 'error');
        },
      });
      items.push({
        icon: '🗺',
        label: 'Open in Maps',
        onSelect: () => window.open(mapsUrl(lead.address), '_blank', 'noopener'),
      });
    }
    items.push({ divider: true });
    items.push({
      icon: '🗑',
      label: 'Delete lead',
      danger: true,
      onSelect: () => window.deleteLead && window.deleteLead(lead.id),
    });
    return renderMenu(items, x, y);
  }

  function renderMenu(items, x, y) {
    closeMenu();
    const menu = document.createElement('div');
    menu.id = 'nbd-kanban-ctx-menu';
    menu.setAttribute('role', 'menu');
    menu.style.cssText = `
      position:fixed; z-index:99997;
      background:var(--s,#1a1f2a); color:var(--t,#e8eaf0);
      border:1px solid var(--br,#2a3344); border-radius:8px;
      box-shadow:0 8px 24px rgba(0,0,0,0.4);
      padding:6px 0; min-width:200px;
      font-family:'Barlow',-apple-system,system-ui,sans-serif;
      font-size:13px; line-height:1.4;
      animation:nbd-ctx-fade .12s ease-out;`;
    menu.innerHTML = items.map((it, i) => {
      if (it.divider) return `<div style="height:1px; background:var(--br,#2a3344); margin:4px 0;"></div>`;
      const danger = it.danger ? 'color:#ef4444;' : '';
      return `
        <button class="nbd-ctx-item" data-idx="${i}" type="button"
          style="
            display:flex; align-items:center; gap:10px;
            width:100%; padding:8px 14px; border:none; background:transparent;
            color:inherit; ${danger}
            text-align:left; font: inherit; cursor:pointer;
            -webkit-tap-highlight-color:transparent;">
          <span style="width:18px; text-align:center;">${escapeHtml(it.icon || '')}</span>
          <span>${escapeHtml(it.label)}</span>
        </button>`;
    }).join('');

    // Inject the keyframes once.
    if (!document.getElementById('nbd-ctx-style')) {
      const style = document.createElement('style');
      style.id = 'nbd-ctx-style';
      style.textContent = `
        @keyframes nbd-ctx-fade { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:translateY(0); } }
        .nbd-ctx-item:hover, .nbd-ctx-item:focus { background:var(--s2,#0f1419); outline:none; }`;
      document.head.appendChild(style);
    }

    document.body.appendChild(menu);

    // Position: clamp inside viewport, prefer below+right of cursor.
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = x, top = y;
    if (left + rect.width > vw - 8)  left = Math.max(8, vw - rect.width - 8);
    if (top  + rect.height > vh - 8) top  = Math.max(8, vh - rect.height - 8);
    menu.style.left = left + 'px';
    menu.style.top  = top + 'px';

    // Wire item clicks.
    menu.querySelectorAll('.nbd-ctx-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-idx'), 10);
        const it = items[i];
        closeMenu();
        if (it && typeof it.onSelect === 'function') {
          try { it.onSelect(); } catch (e) { console.warn('[ctx-menu]', e); }
        }
      });
    });

    menuEl = menu;
    setTimeout(() => {
      document.addEventListener('mousedown', _outsideClick, { once: true, capture: true });
      document.addEventListener('keydown', _onEsc, { once: true });
      window.addEventListener('scroll', closeMenu, { once: true, passive: true });
      // Close on the next contextmenu so a second right-click on a
      // different card opens its menu.
      document.addEventListener('contextmenu', _onSecondContext, { once: true, capture: true });
    }, 0);

    return menu;
  }

  function closeMenu() {
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    menuEl = null;
  }

  function _outsideClick(ev) {
    if (menuEl && menuEl.contains(ev.target)) return;
    closeMenu();
  }
  function _onEsc(ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeMenu();
    } else {
      // Re-arm the listener so we don't lose the close-on-Esc.
      document.addEventListener('keydown', _onEsc, { once: true });
    }
  }
  function _onSecondContext(ev) {
    // Don't close if the new contextmenu is on a different card —
    // we'll let the contextmenu handler open the new menu instead.
    closeMenu();
  }

  // ─── Triggers ───────────────────────────────────────────────────
  function findCardEl(target) {
    if (!target) return null;
    return target.closest ? target.closest('.k-card') : null;
  }

  function onContextMenu(ev) {
    const card = findCardEl(ev.target);
    if (!card) return;
    const id = card.getAttribute('data-id');
    if (!id) return;
    const lead = findLead(id);
    if (!lead) return;
    ev.preventDefault();
    buildMenu(lead, ev.clientX, ev.clientY);
  }

  function onTouchStart(ev) {
    const card = findCardEl(ev.target);
    if (!card) return;
    const id = card.getAttribute('data-id');
    if (!id) return;
    const t = ev.touches && ev.touches[0];
    if (!t) return;
    touchStart = { x: t.clientX, y: t.clientY };
    if (touchTimer) clearTimeout(touchTimer);
    touchTimer = setTimeout(() => {
      const lead = findLead(id);
      if (!lead) return;
      // Suppress the click that would normally fire after the
      // touchend so the long-press doesn't ALSO open the card.
      const suppressClick = (e) => { e.preventDefault(); e.stopPropagation(); };
      card.addEventListener('click', suppressClick, { once: true, capture: true });
      // Light haptic if supported.
      if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) {}
      buildMenu(lead, touchStart.x, touchStart.y);
      touchTimer = null;
    }, LONG_PRESS_MS);
  }

  function onTouchMove(ev) {
    if (!touchTimer || !touchStart) return;
    const t = ev.touches && ev.touches[0];
    if (!t) return;
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    if (dx * dx + dy * dy > 100) {  // ~10px slop
      clearTimeout(touchTimer);
      touchTimer = null;
      touchStart = null;
    }
  }

  function onTouchEnd() {
    if (touchTimer) clearTimeout(touchTimer);
    touchTimer = null;
    touchStart = null;
  }

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove',  onTouchMove,  { passive: true });
    document.addEventListener('touchend',   onTouchEnd,   { passive: true });
    document.addEventListener('touchcancel', onTouchEnd,  { passive: true });
  }

  window.KanbanContextMenu = {
    __sentinel: 'nbd-kanban-ctx-v1',
    open: (leadId, x, y) => {
      const lead = findLead(leadId);
      if (!lead) return;
      buildMenu(lead, x || 100, y || 100);
    },
    close: closeMenu,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
