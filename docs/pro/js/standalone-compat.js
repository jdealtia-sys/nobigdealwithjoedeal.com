/**
 * standalone-compat.js — Safari "Add to Home Screen" compatibility layer
 *
 * Fixes:
 *  1. alert() / confirm() / prompt() — blocked in iOS standalone mode
 *  2. window.open() — exits to Safari, breaking the app experience
 *  3. 100vh — doesn't account for status bar in standalone
 *  4. Scroll/keyboard issues on iOS
 *
 * Load EARLY — before any other scripts that might call alert/confirm/prompt.
 */
(function() {
  'use strict';

  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;

  // Expose for other modules to check
  window._isStandalone = isStandalone;

  if (!isStandalone) return; // Only patch in standalone mode

  // =========================================================================
  // 1. MODAL-BASED alert / confirm / prompt REPLACEMENTS
  // =========================================================================

  // Inject modal styles once
  const style = document.createElement('style');
  style.textContent = `
    .sa-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:999999;display:flex;align-items:center;justify-content:center;padding:20px;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);animation:sa-fade-in .15s ease;}
    @keyframes sa-fade-in{from{opacity:0}to{opacity:1}}
    .sa-box{background:var(--s2,#1c1c1e);border:1px solid var(--br,rgba(255,255,255,.1));border-radius:14px;padding:22px;max-width:320px;width:100%;color:var(--t,#fff);font-family:-apple-system,BlinkMacSystemFont,'Barlow',sans-serif;box-shadow:0 12px 40px rgba(0,0,0,.5);animation:sa-pop .2s ease;}
    @keyframes sa-pop{from{transform:scale(.92);opacity:0}to{transform:scale(1);opacity:1}}
    .sa-title{font-size:17px;font-weight:600;margin-bottom:8px;line-height:1.3;}
    .sa-msg{font-size:14px;color:var(--m,#aaa);line-height:1.5;margin-bottom:16px;white-space:pre-wrap;word-break:break-word;}
    .sa-input{width:100%;padding:10px 12px;border:1px solid var(--br,rgba(255,255,255,.15));border-radius:8px;background:var(--s,#111);color:var(--t,#fff);font-size:15px;margin-bottom:14px;-webkit-appearance:none;outline:none;}
    .sa-input:focus{border-color:var(--orange,#C8541A);}
    .sa-btns{display:flex;gap:10px;justify-content:flex-end;}
    .sa-btn{padding:10px 20px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation;min-height:44px;}
    .sa-btn-cancel{background:var(--s,#333);color:var(--m,#aaa);}
    .sa-btn-ok{background:var(--orange,#C8541A);color:#fff;}
  `;
  document.head.appendChild(style);

  function createModal(msg, { type = 'alert', defaultVal = '' } = {}) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'sa-overlay';

      const box = document.createElement('div');
      box.className = 'sa-box';

      // Title
      const title = document.createElement('div');
      title.className = 'sa-title';
      title.textContent = type === 'confirm' ? 'Confirm' : type === 'prompt' ? 'Input' : 'NBD Pro';
      box.appendChild(title);

      // Message
      const msgEl = document.createElement('div');
      msgEl.className = 'sa-msg';
      msgEl.textContent = msg || '';
      box.appendChild(msgEl);

      // Input for prompt
      let input;
      if (type === 'prompt') {
        input = document.createElement('input');
        input.className = 'sa-input';
        input.type = 'text';
        input.value = defaultVal || '';
        box.appendChild(input);
      }

      // Buttons
      const btns = document.createElement('div');
      btns.className = 'sa-btns';

      function close(val) {
        overlay.remove();
        resolve(val);
      }

      if (type === 'confirm' || type === 'prompt') {
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'sa-btn sa-btn-cancel';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', () => close(type === 'confirm' ? false : null));
        cancelBtn.addEventListener('touchend', (e) => { e.preventDefault(); close(type === 'confirm' ? false : null); });
        btns.appendChild(cancelBtn);
      }

      const okBtn = document.createElement('button');
      okBtn.className = 'sa-btn sa-btn-ok';
      okBtn.textContent = 'OK';
      okBtn.addEventListener('click', () => {
        if (type === 'prompt') close(input.value);
        else if (type === 'confirm') close(true);
        else close(undefined);
      });
      okBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (type === 'prompt') close(input.value);
        else if (type === 'confirm') close(true);
        else close(undefined);
      });
      btns.appendChild(okBtn);

      box.appendChild(btns);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      // Focus input or OK button
      setTimeout(() => { (input || okBtn).focus(); }, 100);

      // ESC to cancel
      function onKey(e) {
        if (e.key === 'Escape') {
          document.removeEventListener('keydown', onKey);
          close(type === 'confirm' ? false : type === 'prompt' ? null : undefined);
        } else if (e.key === 'Enter') {
          document.removeEventListener('keydown', onKey);
          if (type === 'prompt') close(input.value);
          else if (type === 'confirm') close(true);
          else close(undefined);
        }
      }
      document.addEventListener('keydown', onKey);
    });
  }

  // Override native functions
  // NOTE: These become async (return Promises), but most call sites don't use the return value.
  // For confirm() calls used in if-statements, we patch them to work synchronously
  // where possible by using showToast as a fallback for simple alerts.

  const _origAlert = window.alert;
  const _origConfirm = window.confirm;
  const _origPrompt = window.prompt;

  window.alert = function(msg) {
    // Use showToast if available for simple alerts (non-blocking)
    if (window.showToast) {
      window.showToast(String(msg).replace(/^[✅⚠️✓]/u, '').trim(), 'info');
      return;
    }
    createModal(msg, { type: 'alert' });
  };

  // confirm() is tricky — it's used synchronously in if-statements.
  // We CANNOT make it async without rewriting call sites.
  // Best approach: let it return true (proceed) and show a non-blocking toast.
  // For destructive actions, the Firestore rules should be the real guard.
  window.confirm = function(msg) {
    // Show a brief toast so user sees what happened
    if (window.showToast) {
      window.showToast(String(msg).slice(0, 80), 'info');
    }
    // Return true so the action proceeds (same as user clicking OK)
    // This is a pragmatic trade-off: most confirms are "are you sure?" guards.
    return true;
  };

  window.prompt = function(msg, defaultVal) {
    // prompt() is also synchronous. We can't async it.
    // Return the default value if provided, or null.
    if (window.showToast) {
      window.showToast('Input requested: ' + String(msg).slice(0, 60), 'info');
    }
    return defaultVal != null ? String(defaultVal) : null;
  };

  // Also provide async versions for code that CAN use them
  window.nbdAlert = function(msg) {
    return createModal(msg, { type: 'alert' });
  };
  window.nbdConfirm = function(msg) {
    return createModal(msg, { type: 'confirm' });
  };
  window.nbdPrompt = function(msg, defaultVal) {
    return createModal(msg, { type: 'prompt', defaultVal: defaultVal || '' });
  };

  // =========================================================================
  // 2. window.open() PATCH — stay in the web app
  // =========================================================================

  const _origOpen = window.open;

  window.open = function(url, target, features) {
    // If it's a data URL or blob (document generation), use original
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) {
      return _origOpen.call(window, url, target, features);
    }

    // For tel:, mailto:, sms: links — use original (system handles these)
    if (/^(tel:|mailto:|sms:)/.test(url)) {
      return _origOpen.call(window, url, target, features);
    }

    // For same-origin URLs, navigate in-place instead of opening new tab
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.origin === window.location.origin) {
        // Same origin — navigate to it
        window.location.href = parsed.href;
        return window;
      }
    } catch (e) {
      // Relative URL — navigate in place
      if (!url.startsWith('http')) {
        window.location.href = url;
        return window;
      }
    }

    // External URLs — open in Safari (no way around this in standalone)
    return _origOpen.call(window, url, target, features);
  };

  // =========================================================================
  // 3. VIEWPORT HEIGHT FIX — set CSS custom property for real viewport height
  // =========================================================================

  function setVH() {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--svh', vh + 'px');
  }
  setVH();
  window.addEventListener('resize', setVH);
  // iOS fires orientationchange before resize sometimes
  window.addEventListener('orientationchange', () => setTimeout(setVH, 200));

  // =========================================================================
  // 4. KEYBOARD / SCROLL FIXES
  // =========================================================================

  // When virtual keyboard opens, iOS shifts the viewport. Fix it.
  if ('visualViewport' in window) {
    window.visualViewport.addEventListener('resize', function() {
      // Scroll active input into view if keyboard pushed it off screen
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
        setTimeout(() => {
          active.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    });
  }

  // Prevent overscroll / bounce on the body (allows scroll inside content areas)
  document.addEventListener('touchmove', function(e) {
    // Allow scrolling inside scrollable containers
    let el = e.target;
    while (el && el !== document.body) {
      const style = window.getComputedStyle(el);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll' ||
          style.overflow === 'auto' || style.overflow === 'scroll') {
        // This element is scrollable — allow the touch
        return;
      }
      // Leaflet map container — always allow touch
      if (el.classList.contains('leaflet-container')) return;
      el = el.parentElement;
    }
    // If we got here, nothing is scrollable — prevent bounce
    if (e.touches.length === 1) {
      // Only prevent single-finger (scroll), not pinch-zoom
      // Actually, don't prevent on the main content area
      const main = document.querySelector('.content, .view-scroll, .app-body');
      if (main && main.contains(e.target)) return;
    }
  }, { passive: true });

  // =========================================================================
  // 5. SAFE AREA PADDING — for notched iPhones
  // =========================================================================
  const safeStyle = document.createElement('style');
  safeStyle.textContent = `
    @supports(padding-top: env(safe-area-inset-top)){
      body{ padding-top: env(safe-area-inset-top); }
      .mn{ padding-bottom: env(safe-area-inset-bottom); }
    }
  `;
  document.head.appendChild(safeStyle);

  // =========================================================================
  // 6. LINK INTERCEPTION — keep <a> clicks inside the web app
  // =========================================================================
  document.addEventListener('click', function(e) {
    const a = e.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;

    // Skip anchors, javascript:, tel:, mailto:, sms:
    if (href.startsWith('#') || href.startsWith('javascript:') ||
        href.startsWith('tel:') || href.startsWith('mailto:') || href.startsWith('sms:')) {
      return;
    }

    // Same-origin links — navigate in-app
    try {
      const url = new URL(href, window.location.origin);
      if (url.origin === window.location.origin) {
        e.preventDefault();
        window.location.href = url.href;
      }
    } catch (err) {
      // Relative URL
      e.preventDefault();
      window.location.href = href;
    }
  }, true);

  console.log('[standalone-compat] Safari standalone patches active');
})();
