/**
 * pwa-install-nudge.js — Wave 20 (PWA Install Nudge)
 *
 * Reps benefit massively from running NBD Pro as an installed app:
 * full-screen layout (no Safari chrome eating screen estate during
 * D2D), home-screen icon, faster cold start, no chance of accidental
 * tab close during a knock. But:
 *   - iOS Safari NEVER fires beforeinstallprompt; users can install
 *     only via Share → "Add to Home Screen" — discoverable only if
 *     the rep already knows the gesture.
 *   - Android Chrome fires beforeinstallprompt but auto-suppresses
 *     it after a few visits, leaving the install affordance buried
 *     in the 3-dot menu.
 *
 * This module:
 *   1. Detects whether the app is already installed (display-mode
 *      standalone or navigator.standalone). Never nudges installed
 *      users.
 *   2. Captures Android Chrome's beforeinstallprompt event so we can
 *      trigger the native dialog on demand.
 *   3. Tracks session count in localStorage; only nudges from the 3rd
 *      session onward (prevents annoying first-day users).
 *   4. On dashboard.html only.
 *   5. Bottom banner with two actions:
 *        - "Install" (Android: native prompt) / "How?" (iOS: modal
 *          with step-by-step Share-button instructions)
 *        - "Not now" (snoozes 7 days)
 *      Plus a × dismiss that hides forever (until storage cleared).
 *   6. iOS-aware: detects iOS Safari via UA + non-standalone +
 *      Apple touch device, shows the share-icon walkthrough.
 *
 * No exposed API beyond debug helpers.
 */
(function () {
  'use strict';

  if (window.PWAInstallNudge && window.PWAInstallNudge.__sentinel === 'nbd-pwa-nudge-v1') return;

  // Only nudge on the dashboard; the homeowner portal etc. should not
  // promote "install our app" to non-rep users.
  const PATH = window.location.pathname || '';
  if (!/\/pro\/(dashboard\.html)?$/.test(PATH)) return;

  const STORAGE_KEY_SESSIONS  = 'nbd_pwa_sessions';
  const STORAGE_KEY_DISMISSED = 'nbd_pwa_dismissed_v1';
  const STORAGE_KEY_SNOOZE    = 'nbd_pwa_snooze_until';
  const SHOW_AFTER_SESSIONS   = 3;
  const SNOOZE_DAYS           = 7;

  // ─── Platform detection ──────────────────────────────────────────
  function isStandalone() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
    } catch (e) {}
    if (window.navigator && window.navigator.standalone === true) return true;
    return false;
  }

  function isIOS() {
    const ua = window.navigator.userAgent || '';
    if (/iP(ad|hone|od)/.test(ua)) return true;
    // iPadOS reports "MacIntel" with touch points — common detection trick.
    if (window.navigator.platform === 'MacIntel'
        && typeof window.navigator.maxTouchPoints === 'number'
        && window.navigator.maxTouchPoints > 1) return true;
    return false;
  }

  function isIOSSafari() {
    if (!isIOS()) return false;
    const ua = window.navigator.userAgent || '';
    // Filter out Chrome/Firefox/Edge on iOS (which all use WebKit but
    // don't expose Add to Home Screen the same way).
    if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return false;
    return /Safari/.test(ua);
  }

  // ─── Session tracking ────────────────────────────────────────────
  function bumpSessionCount() {
    try {
      // Bump at most once per browser session.
      if (sessionStorage.getItem('nbd_pwa_session_counted') === '1') {
        return Number(localStorage.getItem(STORAGE_KEY_SESSIONS) || 0);
      }
      sessionStorage.setItem('nbd_pwa_session_counted', '1');
      const cur = Number(localStorage.getItem(STORAGE_KEY_SESSIONS) || 0);
      const next = cur + 1;
      localStorage.setItem(STORAGE_KEY_SESSIONS, String(next));
      return next;
    } catch (e) { return 0; }
  }

  function isDismissedForever() {
    try { return localStorage.getItem(STORAGE_KEY_DISMISSED) === '1'; }
    catch (e) { return false; }
  }
  function dismissForever() {
    try { localStorage.setItem(STORAGE_KEY_DISMISSED, '1'); } catch (e) {}
  }

  function isSnoozed() {
    try {
      const until = Number(localStorage.getItem(STORAGE_KEY_SNOOZE) || 0);
      return until > Date.now();
    } catch (e) { return false; }
  }
  function snooze() {
    try {
      localStorage.setItem(STORAGE_KEY_SNOOZE, String(Date.now() + SNOOZE_DAYS * 86400000));
    } catch (e) {}
  }

  // ─── beforeinstallprompt capture (Android Chrome) ───────────────
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (ev) => {
    // Hold onto the event so we can fire the native dialog from a
    // user gesture later. Default behavior on Chrome would auto-show
    // the mini-infobar; preventing the default keeps our UI tidy.
    ev.preventDefault();
    deferredPrompt = ev;
  });

  // ─── Banner UI ──────────────────────────────────────────────────
  function buildBanner() {
    const banner = document.createElement('div');
    banner.id = 'nbd-pwa-install-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Install NBD Pro');
    banner.style.cssText = `
      position:fixed; left:50%; transform:translateX(-50%) translateY(100%);
      bottom:14px; z-index:99990;
      background:linear-gradient(135deg,#1f2937 0%,#111827 100%);
      color:#fff; border:1px solid rgba(255,255,255,0.08);
      border-radius:14px; padding:14px 16px;
      box-shadow:0 8px 28px rgba(0,0,0,0.4);
      max-width:min(420px, calc(100vw - 28px));
      width:100%; box-sizing:border-box;
      font-family:'Barlow',-apple-system,system-ui,sans-serif;
      transition:transform .35s cubic-bezier(0.16, 1, 0.3, 1);
      display:flex; gap:12px; align-items:center;`;
    banner.innerHTML = `
      <div style="font-size:26px; flex-shrink:0;">📱</div>
      <div style="flex:1; min-width:0;">
        <div style="font-size:13px; font-weight:700; margin-bottom:2px;">Install NBD Pro</div>
        <div style="font-size:11px; color:#cbd5e1; line-height:1.4;">
          Faster cold start, full-screen layout, home-screen icon. No app store needed.
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px; flex-shrink:0;">
        <button id="nbd-pwa-install-action" style="
          background:linear-gradient(135deg,#c8541a 0%,#a64516 100%);
          color:#fff; border:none; padding:8px 14px; border-radius:7px;
          font-size:12px; font-weight:700; cursor:pointer;
          -webkit-tap-highlight-color:transparent; white-space:nowrap;
          letter-spacing:0.2px;">Install</button>
        <button id="nbd-pwa-install-later" style="
          background:transparent; color:#94a3b8;
          border:1px solid rgba(255,255,255,0.12); padding:6px 14px;
          border-radius:7px; font-size:11px; font-weight:600; cursor:pointer;
          -webkit-tap-highlight-color:transparent; white-space:nowrap;">Not now</button>
      </div>
      <button id="nbd-pwa-install-x" aria-label="Dismiss"
        style="
          position:absolute; top:6px; right:8px;
          background:transparent; border:none; color:#64748b;
          cursor:pointer; padding:4px 6px; line-height:1;
          font-size:14px; -webkit-tap-highlight-color:transparent;">×</button>`;
    document.body.appendChild(banner);
    requestAnimationFrame(() => {
      banner.style.transform = 'translateX(-50%) translateY(0)';
    });
    return banner;
  }

  function hideBanner(banner) {
    if (!banner) return;
    banner.style.transform = 'translateX(-50%) translateY(120%)';
    setTimeout(() => banner.remove(), 350);
  }

  // ─── iOS instructions modal ─────────────────────────────────────
  function showIOSInstructionsModal() {
    if (document.getElementById('nbd-pwa-ios-modal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'nbd-pwa-ios-modal';
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:99995;
      display:flex; align-items:center; justify-content:center; padding:20px;
      font-family:'Barlow',-apple-system,system-ui,sans-serif;`;
    overlay.innerHTML = `
      <div style="
        background:#ffffff; color:#1f2937;
        border-radius:14px; padding:22px;
        max-width:380px; width:100%;
        box-shadow:0 12px 40px rgba(0,0,0,0.5);">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
          <div style="font-size:24px;">📱</div>
          <h2 style="font-size:17px; margin:0; color:#111827;">Add to Home Screen</h2>
        </div>
        <ol style="padding-left:22px; margin:0 0 14px; line-height:1.7; font-size:14px; color:#374151;">
          <li>Tap the <strong>Share</strong> button at the bottom of Safari
            <span style="display:inline-block; vertical-align:middle; margin-left:4px;">
              <svg width="16" height="20" viewBox="0 0 16 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:#6366f1;"><path d="M8 2v12"/><path d="M5 5l3-3 3 3"/><rect x="2" y="9" width="12" height="9" rx="1.5"/></svg>
            </span>
          </li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
          <li>Tap <strong>Add</strong> in the top-right corner</li>
        </ol>
        <div style="background:#f9fafb; border-radius:8px; padding:10px 12px; margin-bottom:14px; font-size:12px; color:#6b7280; line-height:1.5;">
          You'll see the NBD Pro icon on your home screen. Tap it any time — opens full-screen, no Safari address bar.
        </div>
        <button id="nbd-pwa-ios-close" style="
          width:100%;
          background:linear-gradient(135deg,#c8541a 0%,#a64516 100%);
          color:#fff; border:none; padding:12px;
          border-radius:8px; font-size:14px; font-weight:700;
          cursor:pointer; -webkit-tap-highlight-color:transparent;">
          Got it
        </button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#nbd-pwa-ios-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // ─── Android fallback instructions ──────────────────────────────
  function showAndroidFallbackModal() {
    if (document.getElementById('nbd-pwa-and-modal')) return;
    const overlay = document.createElement('div');
    overlay.id = 'nbd-pwa-and-modal';
    overlay.style.cssText = `
      position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:99995;
      display:flex; align-items:center; justify-content:center; padding:20px;
      font-family:'Barlow',-apple-system,system-ui,sans-serif;`;
    overlay.innerHTML = `
      <div style="
        background:#ffffff; color:#1f2937; border-radius:14px;
        padding:22px; max-width:380px; width:100%;
        box-shadow:0 12px 40px rgba(0,0,0,0.5);">
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
          <div style="font-size:24px;">📱</div>
          <h2 style="font-size:17px; margin:0; color:#111827;">Install NBD Pro</h2>
        </div>
        <ol style="padding-left:22px; margin:0 0 14px; line-height:1.7; font-size:14px; color:#374151;">
          <li>Tap the <strong>⋮</strong> menu (top-right of Chrome)</li>
          <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong></li>
          <li>Confirm <strong>Install</strong></li>
        </ol>
        <button id="nbd-pwa-and-close" style="
          width:100%;
          background:linear-gradient(135deg,#c8541a 0%,#a64516 100%);
          color:#fff; border:none; padding:12px;
          border-radius:8px; font-size:14px; font-weight:700;
          cursor:pointer; -webkit-tap-highlight-color:transparent;">
          Got it
        </button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#nbd-pwa-and-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // ─── Decide + show ──────────────────────────────────────────────
  let _shown = false;
  function maybeShow() {
    if (_shown) return;
    if (isStandalone()) return;          // already installed
    if (isDismissedForever()) return;
    if (isSnoozed()) return;

    const sessions = bumpSessionCount();
    if (sessions < SHOW_AFTER_SESSIONS) return;

    // Wait until the page settles so the banner doesn't compete with
    // initial render / sub-loaders.
    setTimeout(() => {
      if (_shown || isStandalone()) return;
      _shown = true;
      const banner = buildBanner();
      const installBtn = banner.querySelector('#nbd-pwa-install-action');
      const laterBtn   = banner.querySelector('#nbd-pwa-install-later');
      const xBtn       = banner.querySelector('#nbd-pwa-install-x');

      // On iOS, the action is a "How?" since we can't trigger an
      // install programmatically. On Android, fire the captured
      // beforeinstallprompt if we have it; otherwise fall back to
      // instructions. Re-label accordingly.
      if (isIOSSafari()) {
        installBtn.textContent = 'How?';
      } else if (deferredPrompt) {
        installBtn.textContent = 'Install';
      } else {
        installBtn.textContent = 'How?';
      }

      installBtn.addEventListener('click', async () => {
        if (isIOSSafari()) {
          showIOSInstructionsModal();
          hideBanner(banner);
          return;
        }
        if (deferredPrompt && typeof deferredPrompt.prompt === 'function') {
          try {
            deferredPrompt.prompt();
            const choice = await deferredPrompt.userChoice;
            if (choice && choice.outcome === 'accepted') {
              dismissForever();
            } else {
              snooze();
            }
            deferredPrompt = null;
            hideBanner(banner);
            return;
          } catch (e) {
            console.warn('[PWAInstall] prompt error', e);
          }
        }
        // Fallback for Android without the deferred prompt.
        showAndroidFallbackModal();
        hideBanner(banner);
      });

      laterBtn.addEventListener('click', () => {
        snooze();
        hideBanner(banner);
      });
      xBtn.addEventListener('click', () => {
        dismissForever();
        hideBanner(banner);
      });

      // Treat successful install (Android Chrome fires this) as a
      // permanent dismiss so we don't keep nagging users who later
      // open the dashboard in a browser tab.
      window.addEventListener('appinstalled', () => {
        dismissForever();
        hideBanner(banner);
      }, { once: true });
    }, 2500);
  }

  // ─── Init ────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeShow);
  } else {
    maybeShow();
  }

  // Debug helpers exposed for support / QA — clearable via console.
  window.PWAInstallNudge = {
    __sentinel: 'nbd-pwa-nudge-v1',
    isStandalone,
    isIOSSafari,
    reset() {
      try {
        localStorage.removeItem(STORAGE_KEY_SESSIONS);
        localStorage.removeItem(STORAGE_KEY_DISMISSED);
        localStorage.removeItem(STORAGE_KEY_SNOOZE);
        sessionStorage.removeItem('nbd_pwa_session_counted');
        console.log('[PWAInstall] state reset');
      } catch (e) {}
    },
    forceShow() {
      _shown = false;
      try {
        localStorage.removeItem(STORAGE_KEY_DISMISSED);
        localStorage.removeItem(STORAGE_KEY_SNOOZE);
        localStorage.setItem(STORAGE_KEY_SESSIONS, String(SHOW_AFTER_SESSIONS));
        sessionStorage.removeItem('nbd_pwa_session_counted');
      } catch (e) {}
      maybeShow();
    },
  };
})();
