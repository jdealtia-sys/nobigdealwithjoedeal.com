/**
 * pwa-install.js — Wave 150
 *
 * Surfaces a small "Install NBD Pro" prompt when the browser
 * fires `beforeinstallprompt` (Chrome/Edge/Samsung Internet on
 * Android, Edge on Windows). iOS Safari doesn't fire this event
 * — it has its own Add-to-Home-Screen flow that requires a
 * manual sequence — so we show a separate iOS instruction card
 * for iPhone users when they're not already running standalone.
 *
 * Why install matters for a daily-driver field rep:
 *   - Standalone mode hides the browser chrome (more screen)
 *   - Survives app-switcher kill better than a tab
 *   - Mic + camera permissions persist across sessions
 *   - Push notifications work reliably (W104 push functions)
 *   - Home screen icon = one-tap launch from anywhere
 *
 * UX rules:
 *   - Never auto-show within first 2 seconds of pageload (don't
 *     interrupt the rep's actual work)
 *   - Dismissed prompts stay dismissed for 7 days (localStorage)
 *   - "Install" button click → call deferredPrompt.prompt()
 *   - On `appinstalled` event, persist a "yes" flag forever
 *   - Hide entirely when already running standalone
 */
(function () {
  'use strict';
  if (window.NBDPwaInstall
      && window.NBDPwaInstall.__sentinel === 'nbd-pwa-install-v1') return;

  const STORAGE_KEY = 'nbd_pwa_install_state_v1';
  const DISMISS_DAYS = 7;
  const SHOW_DELAY_MS = 2000;
  const BANNER_ID = 'nbd-pwa-install-banner';

  let _deferredPrompt = null;

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

  function _isStandalone() {
    return window.matchMedia && window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true; // iOS Safari standalone
  }
  function _isInstalled() {
    if (_isStandalone()) return true;
    const s = _readState();
    return !!s.installedAt;
  }
  function _isDismissed() {
    const s = _readState();
    if (!s.dismissedAt) return false;
    const ageMs = Date.now() - s.dismissedAt;
    return ageMs < DISMISS_DAYS * 86_400_000;
  }
  function _isIOS() {
    const ua = window.navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua) && !window.MSStream) return true;
    // iPadOS 13+ reports as Mac; check for touch + standalone hint.
    if (/Macintosh/.test(ua) && 'ontouchend' in document) return true;
    return false;
  }

  // ─── Banner UI ────────────────────────────────────────────────
  function _renderBanner(opts) {
    if (document.getElementById(BANNER_ID)) return;
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.style.cssText =
      'position:fixed;left:50%;transform:translateX(-50%);' +
      'bottom:calc(20px + env(safe-area-inset-bottom, 0px));' +
      'z-index:10004;max-width:min(92vw, 420px);width:auto;' +
      'background:#0f1729;color:#e2e8f0;border:1px solid #2a3344;' +
      'border-left:4px solid var(--orange, #c8541a);' +
      'border-radius:10px;padding:12px 14px;' +
      'box-shadow:0 8px 28px rgba(0,0,0,0.5);' +
      'font:inherit;font-size:13px;display:flex;align-items:center;gap:10px;' +
      'animation:nbd-pwa-in 220ms ease-out;';
    banner.innerHTML =
      '<span style="font-size:22px;line-height:1;flex-shrink:0;">📱</span>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-weight:700;margin-bottom:2px;">' + (opts.title || 'Install NBD Pro') + '</div>' +
        '<div style="font-size:11px;color:#94a3b8;line-height:1.45;">' + (opts.body || '') + '</div>' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">' +
        '<button type="button" id="nbd-pwa-install-btn" style="background:var(--orange, #c8541a);color:#fff;border:none;border-radius:5px;padding:7px 12px;font:inherit;font-size:12px;font-weight:700;cursor:pointer;">' + (opts.cta || 'Install') + '</button>' +
        '<button type="button" id="nbd-pwa-dismiss-btn" style="background:transparent;color:#94a3b8;border:none;padding:3px 8px;font:inherit;font-size:11px;cursor:pointer;text-decoration:underline;">Not now</button>' +
      '</div>';
    document.body.appendChild(banner);
    if (!document.getElementById('nbd-pwa-css')) {
      const css = document.createElement('style');
      css.id = 'nbd-pwa-css';
      css.textContent =
        '@keyframes nbd-pwa-in {' +
          'from { opacity:0; transform:translateX(-50%) translateY(20px); }' +
          'to { opacity:1; transform:translateX(-50%) translateY(0); }' +
        '}';
      document.head.appendChild(css);
    }
    document.getElementById('nbd-pwa-dismiss-btn').addEventListener('click', () => {
      _writeState({ dismissedAt: Date.now() });
      _hideBanner();
    });
    return banner;
  }
  function _hideBanner() {
    const b = document.getElementById(BANNER_ID);
    if (!b) return;
    b.style.transition = 'opacity 200ms ease, transform 200ms ease';
    b.style.opacity = '0';
    b.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => { try { b.remove(); } catch (_) {} }, 220);
  }

  function _showAndroidPrompt() {
    if (!_deferredPrompt) return;
    const banner = _renderBanner({
      title: 'Install NBD Pro',
      body: 'Add to your home screen for full-screen mode, push alerts, and faster launches.',
      cta: 'Install',
    });
    if (!banner) return;
    document.getElementById('nbd-pwa-install-btn').addEventListener('click', async () => {
      const prompt = _deferredPrompt;
      _deferredPrompt = null;
      try {
        prompt.prompt();
        const result = await prompt.userChoice;
        if (result.outcome === 'accepted') {
          _writeState({ installedAt: Date.now() });
        } else {
          // Treat dismissal as "not now" — re-prompt in 7 days.
          _writeState({ dismissedAt: Date.now() });
        }
      } catch (e) {
        console.warn('[pwa-install] prompt failed:', e);
      }
      _hideBanner();
    });
  }

  function _showIOSPrompt() {
    _renderBanner({
      title: 'Install NBD Pro',
      body: 'Tap the Share button below, then "Add to Home Screen" for full-screen mode and faster launches.',
      cta: 'Got it',
    });
    if (!document.getElementById('nbd-pwa-install-btn')) return;
    document.getElementById('nbd-pwa-install-btn').addEventListener('click', () => {
      _writeState({ dismissedAt: Date.now() });
      _hideBanner();
    });
  }

  // ─── Bootstrap ────────────────────────────────────────────────
  function _bootstrap() {
    if (_isInstalled()) return;
    if (_isDismissed()) return;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      _deferredPrompt = e;
      // Don't auto-show immediately — let the user actually use the
      // app for a beat first. After 2s, show the banner.
      setTimeout(() => {
        if (!_isInstalled() && !_isDismissed()) _showAndroidPrompt();
      }, SHOW_DELAY_MS);
    });

    window.addEventListener('appinstalled', () => {
      _deferredPrompt = null;
      _writeState({ installedAt: Date.now() });
      _hideBanner();
    });

    // iOS Safari path: no beforeinstallprompt event. Show the
    // manual instruction card instead. Only on iOS, only when not
    // standalone, and respect the dismiss flag.
    if (_isIOS() && !_isStandalone()) {
      setTimeout(() => {
        if (!_isInstalled() && !_isDismissed()) _showIOSPrompt();
      }, SHOW_DELAY_MS + 1500); // slightly later so iOS users get
                                  // a moment to land before being
                                  // interrupted
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootstrap, { once: true });
  } else {
    setTimeout(_bootstrap, 0);
  }

  window.NBDPwaInstall = {
    __sentinel: 'nbd-pwa-install-v1',
    isStandalone: _isStandalone,
    isInstalled: _isInstalled,
    forceShow: () => {
      // For testing / a Settings tab "Reset install prompt" button.
      _writeState({ dismissedAt: 0, installedAt: 0 });
      if (_deferredPrompt) _showAndroidPrompt();
      else if (_isIOS()) _showIOSPrompt();
    },
  };
})();
