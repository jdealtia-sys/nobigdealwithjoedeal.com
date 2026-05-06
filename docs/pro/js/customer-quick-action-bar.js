/**
 * customer-quick-action-bar.js — Wave 34 (Mobile quick-action bar)
 *
 * Reps on the phone with a customer want to be able to call back,
 * SMS, email, or set a follow-up task without scrolling around the
 * customer detail page. On desktop there's plenty of room and the
 * actions are already in the header / share row. On mobile the
 * page is a tall scroll and any of those actions take 2-3 swipes
 * + a tap. Mid-call, that's where flow dies.
 *
 * This wave adds a sticky bottom bar on mobile (≤640px) that
 * surfaces the four highest-frequency actions:
 *   - Call (tel: link with normalized digits)
 *   - SMS  (sms: link)
 *   - Email (mailto: link)
 *   - New task (window.openTaskModal — already exposed)
 *
 * Each button hides automatically when the lead doesn't have the
 * relevant data — a phoneless lead won't show Call/SMS, an
 * emailless lead won't show Email. Task is always available.
 *
 * Activates only on /pro/customer.html and only at viewport widths
 * ≤640px so desktop users don't lose page real estate. Listens for
 * resize so a phone in landscape correctly switches between
 * horizontal/vertical layouts.
 *
 * Honors iOS safe-area-inset-bottom so the bar doesn't get eaten
 * by the home-indicator strip on notched iPhones.
 */
(function () {
  'use strict';

  if (window.CustomerQuickActionBar
      && window.CustomerQuickActionBar.__sentinel === 'nbd-quick-action-v1') return;

  const PATH = window.location.pathname || '';
  if (!/\/pro\/customer\.html$/.test(PATH)) return;

  const MOBILE_MAX_WIDTH = 640;
  let barEl = null;

  // ─── Helpers ─────────────────────────────────────────────────────
  function isMobileViewport() {
    return window.innerWidth <= MOBILE_MAX_WIDTH;
  }

  function digitsOnly(s) {
    return String(s || '').replace(/\D+/g, '');
  }

  function escapeAttr(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ─── Render ──────────────────────────────────────────────────────
  function buildBar() {
    const lead = window._currentLead || {};
    const phone = digitsOnly(lead.phone);
    const email = (lead.email || '').trim();

    // Skip render entirely when there's no actionable contact info AND
    // openTaskModal isn't available — nothing to show. (Task button is
    // always shown when openTaskModal exists.)
    if (!phone && !email && typeof window.openTaskModal !== 'function') return null;

    const bar = document.createElement('div');
    bar.id = 'nbd-quick-action-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Quick actions');
    bar.style.cssText = `
      position:fixed; left:0; right:0; bottom:0;
      z-index:99985;
      background:rgba(15,18,25,0.96);
      backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
      border-top:1px solid rgba(255,255,255,0.08);
      padding:8px 10px calc(8px + env(safe-area-inset-bottom, 0px));
      display:flex; gap:6px; justify-content:space-around;
      box-shadow:0 -4px 16px rgba(0,0,0,0.25);
      font-family:'Barlow',-apple-system,system-ui,sans-serif;
      animation:nbd-qab-slide .25s cubic-bezier(0.16, 1, 0.3, 1);`;

    if (!document.getElementById('nbd-qab-style')) {
      const style = document.createElement('style');
      style.id = 'nbd-qab-style';
      style.textContent = `
        @keyframes nbd-qab-slide { from { transform:translateY(100%); } to { transform:translateY(0); } }
        #nbd-quick-action-bar .qab-btn {
          flex:1; max-width:88px;
          display:flex; flex-direction:column; align-items:center; gap:3px;
          padding:8px 4px; border:none; border-radius:10px;
          background:transparent; color:#cbd5e1;
          font-family:inherit; font-size:10px; font-weight:600;
          letter-spacing:0.3px; text-transform:uppercase;
          text-decoration:none; cursor:pointer;
          -webkit-tap-highlight-color:transparent;
          transition:background .12s, color .12s, transform .12s;
        }
        #nbd-quick-action-bar .qab-btn:active {
          background:rgba(200,84,26,0.15); color:#fff;
          transform:scale(0.96);
        }
        #nbd-quick-action-bar .qab-icon {
          font-size:22px; line-height:1;
        }
        #nbd-quick-action-bar .qab-btn.qab-call .qab-icon { color:#10b981; }
        #nbd-quick-action-bar .qab-btn.qab-sms  .qab-icon { color:#3b82f6; }
        #nbd-quick-action-bar .qab-btn.qab-email .qab-icon { color:#8b5cf6; }
        #nbd-quick-action-bar .qab-btn.qab-task .qab-icon { color:#f59e0b; }
        /* The bar pushes pinned page content up; we add bottom
           padding to <main> equivalent via body so floating share
           buttons / footers don't get covered. Defensive — the page
           normally scrolls so the bar overlapping a few pixels of
           content is harmless. */
        body.nbd-qab-active { padding-bottom:64px; }
        @media (min-width:641px) {
          #nbd-quick-action-bar { display:none !important; }
          body.nbd-qab-active   { padding-bottom:0 !important; }
        }`;
      document.head.appendChild(style);
    }

    const buttons = [];
    if (phone) {
      buttons.push(`
        <a class="qab-btn qab-call" href="tel:${escapeAttr(phone)}" aria-label="Call ${escapeAttr(lead.phone)}">
          <span class="qab-icon">📞</span><span>Call</span>
        </a>`);
      buttons.push(`
        <a class="qab-btn qab-sms" href="sms:${escapeAttr(phone)}" aria-label="Text ${escapeAttr(lead.phone)}">
          <span class="qab-icon">💬</span><span>Text</span>
        </a>`);
    }
    if (email) {
      buttons.push(`
        <a class="qab-btn qab-email" href="mailto:${escapeAttr(email)}" aria-label="Email ${escapeAttr(email)}">
          <span class="qab-icon">✉️</span><span>Email</span>
        </a>`);
    }
    if (typeof window.openTaskModal === 'function') {
      buttons.push(`
        <button class="qab-btn qab-task" type="button" aria-label="Add task">
          <span class="qab-icon">✓</span><span>Task</span>
        </button>`);
    }

    if (buttons.length === 0) return null;
    bar.innerHTML = buttons.join('');

    // Wire the Task button (link buttons handle themselves via href).
    const taskBtn = bar.querySelector('.qab-task');
    if (taskBtn) {
      taskBtn.addEventListener('click', () => {
        try { window.openTaskModal(); } catch (e) { console.warn('[qab]', e); }
      });
    }

    return bar;
  }

  function ensureBar() {
    // Remove + re-render so phone/email changes from background
    // revalidate (Wave 14) reflect in the bar without a page reload.
    if (barEl) {
      barEl.remove();
      barEl = null;
    }
    if (!isMobileViewport()) {
      document.body.classList.remove('nbd-qab-active');
      return;
    }
    const bar = buildBar();
    if (!bar) {
      document.body.classList.remove('nbd-qab-active');
      return;
    }
    document.body.appendChild(bar);
    document.body.classList.add('nbd-qab-active');
    barEl = bar;
  }

  // Debounce resize-driven re-renders so layout swap is smooth.
  let resizeTimer = null;
  function onResize() {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(ensureBar, 120);
  }

  // ─── Init ────────────────────────────────────────────────────────
  function init() {
    // Wait until the customer data has rendered so window._currentLead
    // is populated. The page itself reveals via opacity:1 on the html
    // element after loadCustomerData; we'll just defer a touch and
    // then rely on the revalidate flow + resize listener for updates.
    setTimeout(ensureBar, 1500);
    window.addEventListener('resize', onResize);
    // Re-render whenever the lead is replaced (Wave 14 background
    // revalidate fires this implicitly when it swaps _currentLead;
    // we just listen for the same data-refreshed event the bell + bottleneck
    // widgets use, since the customer page also benefits).
    window.addEventListener('nbd:data-refreshed', () => setTimeout(ensureBar, 60));
  }

  window.CustomerQuickActionBar = {
    __sentinel: 'nbd-quick-action-v1',
    refresh: ensureBar,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
