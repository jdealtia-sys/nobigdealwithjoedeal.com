/**
 * offline-banner.js — Wave 151 (network status banner)
 *
 * Surfaces a persistent yellow banner across the top of the page
 * when the browser reports `navigator.onLine === false`. Reads
 * are still served from cache (W124+W127 SW), but writes are
 * queued via offline-manager.js — the banner gives the rep
 * confidence that:
 *   - The app is still working
 *   - Their writes will sync when reconnection happens
 *   - The "save failed" toasts they might see are network-related,
 *     not data-related
 *
 * Reappears on every transition online → offline. Auto-hides on
 * reconnection.
 *
 * iOS Safari + Android Chrome both fire `online` / `offline`
 * window events when the radio status changes. Reliable enough for
 * a status banner; we don't try to actively probe (cellular
 * "online but no LTE" stays as online here, which matches user
 * expectation).
 */
(function () {
  'use strict';
  if (window.NBDOfflineBanner
      && window.NBDOfflineBanner.__sentinel === 'nbd-offline-banner-v1') return;

  const BANNER_ID = 'nbd-offline-banner';

  function _render() {
    if (document.getElementById(BANNER_ID)) return;
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:10006;' +
      'background:#fbbf24;color:#1a1a1a;font:inherit;font-size:13px;' +
      'font-weight:600;padding:8px 14px;text-align:center;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.18);' +
      'padding-top:calc(8px + env(safe-area-inset-top, 0px));' +
      'padding-left:calc(14px + env(safe-area-inset-left, 0px));' +
      'padding-right:calc(14px + env(safe-area-inset-right, 0px));' +
      'animation:nbd-offline-in 220ms ease-out;';
    banner.innerHTML =
      '<span style="font-size:14px;margin-right:6px;">📡</span>' +
      'You\'re offline. Saves will queue and sync when you reconnect.';
    document.body.appendChild(banner);
    if (!document.getElementById('nbd-offline-css')) {
      const css = document.createElement('style');
      css.id = 'nbd-offline-css';
      css.textContent =
        '@keyframes nbd-offline-in {' +
          'from { opacity:0; transform:translateY(-100%); }' +
          'to { opacity:1; transform:translateY(0); }' +
        '}';
      document.head.appendChild(css);
    }
  }
  function _hide() {
    const b = document.getElementById(BANNER_ID);
    if (!b) return;
    b.style.transition = 'opacity 200ms ease, transform 200ms ease';
    b.style.opacity = '0';
    b.style.transform = 'translateY(-100%)';
    setTimeout(() => { try { b.remove(); } catch (_) {} }, 220);
  }

  function _check() {
    if (typeof navigator === 'undefined') return;
    if (navigator.onLine === false) _render();
    else _hide();
  }

  window.addEventListener('online', _check);
  window.addEventListener('offline', _check);
  // Also recheck on focus — some browsers don't fire online/offline
  // reliably on bfcache restore.
  window.addEventListener('focus', _check);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _check, { once: true });
  } else {
    setTimeout(_check, 0);
  }

  window.NBDOfflineBanner = {
    __sentinel: 'nbd-offline-banner-v1',
    check: _check,
  };
})();
