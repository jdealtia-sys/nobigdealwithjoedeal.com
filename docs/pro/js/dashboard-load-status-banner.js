/*
 * Load-status banner (formerly W159 P1 diag banner).
 *
 * Three behaviors:
 *   1. Hidden by default while the page is loading normally.
 *   2. Appears as an actionable failure banner after ~6s if leads haven't
 *      loaded — big "Retry now" button, tap-anywhere-to-retry, and a
 *      live countdown for the next auto-retry. Replaces the previous
 *      passive info banner that had no retry action.
 *   3. On success: flashes a brief green "Loaded N leads" then fully
 *      removes itself after 2.5s (the previous 25%-opacity stuck state
 *      was the "transparent overlay" the user complained about).
 *
 * The "Details" toggle reveals the old diagnostic fields (UA, retry
 * count, error code) so we don't lose debug visibility on mobile.
 */
(function _loadStatusBanner() {
  const VERSION = 'v159.7';
  const FAIL_GRACE_MS = 6000;        // wait this long before assuming "stuck"
  const SUCCESS_HIDE_MS = 2500;      // remove banner this long after success
  let banner;
  let _detailsOpen = false;
  let _dismissedByUser = false;
  let _successHideTimer = null;

  // v159.7 self-recovery globals. Exposed on window so the user can also
  // invoke them from devtools if the banner isn't visible (e.g. iOS Safari
  // with overflow:hidden on an ancestor). Both are silent unless tapped.
  window.__nbdHardReset = async function _nbdHardReset() {
    try {
      // Unregister every service worker scoped to this origin.
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister().catch(() => {})));
      }
      // Wipe every cache (SW caches, image caches, etc.).
      if (window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k).catch(() => {})));
      }
    } catch (e) { /* non-fatal */ }
    // Append ?nosw=1 so the next load also bypasses the SW kill switch
    // (the page-bottom swBootstrap honours this by refusing to register).
    const u = new URL(location.href);
    u.searchParams.set('nosw', '1');
    location.replace(u.toString());
  };
  window.__nbdGstaticTest = async function _nbdGstaticTest() {
    const btn = document.getElementById('nbd-ls-gstatic-btn');
    if (btn) btn.textContent = 'testing…';
    const url = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
    const t0 = Date.now();
    try {
      const res = await fetch(url, { cache: 'no-store', mode: 'cors' });
      const ms = Date.now() - t0;
      if (window.__nbdLoadErrors && window.__nbdLoadErrors.length < 8) {
        window.__nbdLoadErrors.push('gstatic ' + res.status + ' in ' + ms + 'ms');
      }
      if (btn) btn.textContent = 'gstatic: ' + res.status + ' (' + ms + 'ms)';
    } catch (e) {
      if (window.__nbdLoadErrors && window.__nbdLoadErrors.length < 8) {
        window.__nbdLoadErrors.push('gstatic FAIL: ' + (e && e.message || e));
      }
      if (btn) btn.textContent = 'gstatic BLOCKED';
    }
  };
  function _state() {
    const loaded = !!window._leadsLoaded;
    const count = (window._leads && window._leads.length) || 0;
    const err = window._loadLeadsLastError || null;
    const retry = (window._loadLeadsRetryAttempt || 0) + (window._loadLeadsSlowAttempt || 0);
    const nextRetryAt = window._loadLeadsNextRetryAt || null;
    const exhausted = !!window._loadLeadsExhausted;
    const hasData = loaded && count > 0;
    const stuck = !loaded || (loaded && count === 0 && !!err);
    const online = navigator.onLine;
    return { loaded, count, err, retry, nextRetryAt, exhausted, hasData, stuck, online };
  }
  function _ensureBanner() {
    if (banner) return banner;
    banner = document.createElement('div');
    banner.id = 'nbd-load-status';
    // Clear the 62px mobile-nav on phones; on desktop just the safe-area inset.
    // mobile-nav is display:flex on viewports <= 768px (see #mobile-nav styles
    // around dashboard.html:5904), so the calc gives us breathing room either
    // way without needing JS to measure.
    banner.style.cssText = 'position:fixed;left:0;right:0;z-index:2147483647;background:#1a1a1a;color:#fff;padding:12px 14px;font:13px/1.35 -apple-system,system-ui,sans-serif;box-shadow:0 -4px 18px rgba(0,0,0,.55);border-top:3px solid #f80;display:none;cursor:pointer;transition:opacity .25s,transform .25s;';
    // Add the bottom offset via a sub-style so a media query can override on mobile
    banner.style.bottom = 'env(safe-area-inset-bottom, 0px)';
    // On viewports <= 768px we have a 62px-tall fixed mobile nav at the
    // bottom — push the banner above it so both stay visible.
    if (window.matchMedia && window.matchMedia('(max-width: 768px)').matches) {
      banner.style.bottom = 'calc(62px + env(safe-area-inset-bottom, 0px))';
    }
    banner.setAttribute('role', 'alert');
    banner.addEventListener('click', (e) => {
      // Don't retry when user clicks the close × or the Details toggle
      if (e.target.closest('.nbd-ls-close') || e.target.closest('.nbd-ls-details-toggle')) return;
      _retry();
    });
    document.body.appendChild(banner);
    return banner;
  }
  function _retry() {
    if (typeof window.loadLeads !== 'function') return;
    // Reset slow-loop counter so the user-initiated retry gets the full retry budget
    window._loadLeadsSlowAttempt = 0;
    window._loadLeadsExhausted = false;
    window._loadLeadsNextRetryAt = null;
    if (banner) {
      banner.style.borderTopColor = '#fb0';
      const btn = banner.querySelector('.nbd-ls-retry');
      if (btn) { btn.textContent = 'Retrying…'; btn.disabled = true; }
    }
    window.loadLeads().catch(e => console.warn('user retry failed:', e.message));
  }
  function _dismiss() {
    _dismissedByUser = true;
    if (banner) banner.style.display = 'none';
  }
  function _render() {
    if (_dismissedByUser) return;
    const s = _state();
    const ageMs = Date.now() - (window._bootStartedAt || performance.now() + 0);
    // Don't show the banner during the normal grace period — only when
    // stuck for too long OR when we have a definite error.
    if (s.hasData) {
      // Success path
      if (!banner) return;
      banner.style.display = 'block';
      banner.style.borderTopColor = '#22c55e';
      banner.style.background = 'linear-gradient(180deg,#0f3a1a,#1a1a1a)';
      banner.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">' +
          '<div style="font-weight:700;font-size:14px;">✓ Loaded ' + s.count + ' lead' + (s.count === 1 ? '' : 's') + '</div>' +
          '<button class="nbd-ls-close" aria-label="Dismiss" style="background:none;border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:4px;padding:2px 9px;font-size:14px;line-height:1;cursor:pointer;">×</button>' +
        '</div>';
      const closeBtn = banner.querySelector('.nbd-ls-close');
      if (closeBtn) closeBtn.addEventListener('click', _dismiss);
      // Schedule full removal so we don't leave a translucent overlay
      if (!_successHideTimer) {
        _successHideTimer = setTimeout(() => {
          if (banner) { banner.style.opacity = '0'; banner.style.transform = 'translateY(110%)'; }
          setTimeout(() => { if (banner) banner.remove(); banner = null; }, 300);
        }, SUCCESS_HIDE_MS);
      }
      return;
    }
    // Not loaded yet — show only after grace period unless there's an error already
    if (!s.err && ageMs < FAIL_GRACE_MS) {
      if (banner) banner.style.display = 'none';
      return;
    }
    const b = _ensureBanner();
    b.style.display = 'block';
    b.style.opacity = '1';
    b.style.transform = 'none';
    b.style.borderTopColor = s.exhausted ? '#dc2626' : '#f80';
    b.style.background = s.exhausted ? 'linear-gradient(180deg,#3a0f0f,#1a1a1a)' : '#1a1a1a';

    const offlineNote = !s.online ? ' · <span style="color:#fbbf24;">offline</span>' : '';
    const errLine = s.err
      ? '<div style="font-size:12px;opacity:.85;margin-top:2px;">' + (s.err.code || s.err.name || 'error') + ': ' + _esc(s.err.message) + '</div>'
      : '';
    let nextRetryLine = '';
    if (s.nextRetryAt) {
      const secs = Math.max(0, Math.ceil((s.nextRetryAt - Date.now()) / 1000));
      nextRetryLine = '<div style="font-size:11px;opacity:.75;margin-top:3px;">Auto-retrying in ' + secs + 's…</div>';
    } else if (s.exhausted) {
      nextRetryLine = '<div style="font-size:11px;opacity:.85;color:#fca5a5;margin-top:3px;">Auto-retries exhausted — tap Retry to try again.</div>';
    }
    // v159.5+ phase trail + first captured load error. The trail tells
    // us how far the module pipeline got before stalling; the error
    // tells us why. Both come from the pre-module error trap.
    const phases = (window.__nbdPhases || []).slice(-8).join(' › ');
    const firstErr = (window.__nbdLoadErrors && window.__nbdLoadErrors[0]) || null;
    const errCount = (window.__nbdLoadErrors && window.__nbdLoadErrors.length) || 0;
    const detailsHtml = _detailsOpen
      ? '<div style="font-size:10px;line-height:1.4;opacity:.7;margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.15);word-break:break-all;">' +
          'NBD ' + VERSION + ' · retry: ' + s.retry + offlineNote +
          ' · auth: ' + (window._user ? 'yes' : 'no') +
          ' · db: ' + (window.db ? 'yes' : 'no') +
          ' · uid: ' + (window._user?.uid ? window._user.uid.slice(0,8) + '…' : 'none') +
          (phases ? '<br><span style="color:#9cf;">phase:</span> ' + _esc(phases) : '') +
          (firstErr ? '<br><span style="color:#fb6;">⚠ ' + _esc(firstErr) +
            (errCount > 1 ? ' <span style="opacity:.6;">(+' + (errCount - 1) + ' more)</span>' : '') + '</span>' : '') +
          // v159.7 self-recovery actions — only surfaced inside Details so
          // the rep can't fat-finger a hard reset, but devtools-savvy
          // testers and Joe can drive them from the on-page banner instead
          // of pasting JS into the console.
          '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">' +
            '<button data-action="call" data-fn="hardResetTest" ' +
              'style="background:#c33;border:none;color:#fff;border-radius:4px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;flex:1;min-height:32px;">' +
              '↻ Hard Reset (SW + caches)</button>' +
            '<button id="nbd-ls-gstatic-btn" data-action="call" data-fn="gstaticTest" ' +
              'style="background:#246;border:none;color:#fff;border-radius:4px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;flex:1;min-height:32px;">' +
              'Test gstatic fetch</button>' +
          '</div>' +
          '<br>' + _esc(navigator.userAgent || '') +
        '</div>'
      : '';

    b.innerHTML =
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px;">' +
            '<span class="nbd-ls-spin" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:nbd-ls-spin 0.8s linear infinite;"></span>' +
            'Couldn’t load your CRM data' +
          '</div>' +
          errLine +
          nextRetryLine +
          detailsHtml +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">' +
          '<button class="nbd-ls-retry" type="button" style="background:#f80;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;min-height:36px;">Retry now</button>' +
          '<div style="display:flex;gap:4px;">' +
            '<button class="nbd-ls-details-toggle" type="button" style="background:none;border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer;flex:1;">' + (_detailsOpen ? 'Hide' : 'Details') + '</button>' +
            '<button class="nbd-ls-close" aria-label="Dismiss" style="background:none;border:1px solid rgba(255,255,255,.4);color:#fff;border-radius:4px;padding:3px 9px;font-size:13px;line-height:1;cursor:pointer;">×</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    const retryBtn = b.querySelector('.nbd-ls-retry');
    if (retryBtn) retryBtn.addEventListener('click', (e) => { e.stopPropagation(); _retry(); });
    const detailsBtn = b.querySelector('.nbd-ls-details-toggle');
    if (detailsBtn) detailsBtn.addEventListener('click', (e) => { e.stopPropagation(); _detailsOpen = !_detailsOpen; _render(); });
    const closeBtn = b.querySelector('.nbd-ls-close');
    if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); _dismiss(); });
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }
  // Inject spinner keyframes once
  const _styleEl = document.createElement('style');
  _styleEl.textContent = '@keyframes nbd-ls-spin{to{transform:rotate(360deg);}}';
  document.head.appendChild(_styleEl);
  function _start() {
    if (!window._bootStartedAt) window._bootStartedAt = Date.now();
    setTimeout(_render, FAIL_GRACE_MS);
    setInterval(_render, 1000); // 1s tick so the countdown updates smoothly
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _start, { once: true });
  } else {
    _start();
  }
})();
