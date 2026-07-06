/**
 * fab-stack-coordinator.js — Wave 149
 *
 * Hides the bottom-right FAB stack (W128 mic, W130 quick-capture,
 * W132 inbox) whenever a full-screen modal is open. Without this,
 * the FABs floated on top of W130's record modal, the W144
 * supplement modal, the W146 estimate viewer, etc — covering
 * content + giving the rep a stale set of tap targets that don't
 * make sense in the current context.
 *
 * Detection strategy: a MutationObserver watches document.body
 * for known modal IDs being added/removed (the same set the
 * keyboard ESC handlers in those modules use). When ANY of them
 * is present + visible, the FAB stack opacity drops + pointer-
 * events disable. When all are absent, FABs return.
 *
 * The list of "blocking modals" is intentionally narrow — random
 * dropdowns, toasts, and small banners do NOT hide the FABs. Only
 * full-screen overlays that take focus.
 */
(function () {
  'use strict';
  const __NBD_LOADED = window.__NBD_LOADED = window.__NBD_LOADED || {};
  if (__NBD_LOADED['fab-stack-coordinator']) return;
  __NBD_LOADED['fab-stack-coordinator'] = true;

  const FAB_IDS = [
    'nbd-whisper-fab',          // W128
    'nbd-qc-fab',               // W130
    'nbd-qci-fab',              // W132
    'addLeadFab',               // Add Lead — revived + restacked 2026-07-06
    'nbd-fab-dial',             // mobile speed-dial launcher (fab-speed-dial.js)
  ];

  const BLOCKING_MODAL_IDS = [
    'nbd-qc-modal',             // W130 Quick Capture full-screen
    'nbd-qci-modal',            // W132 Capture inbox modal
    'nbd-cmd-modal',            // W133 Cmd+K palette
    'nbd-supplement-modal',     // W144 supplement builder
    'nbd-lead-alert-stack',     // W139 hot-lead toast stack — DOESN'T block, see below
    'estV2Modal',               // V2 estimate builder
    'nbd-picker-modal',         // appearance picker
    // W150 PWA install banner sits at z-index:99990 with bottom:14px,
    // covering the FAB stack region on phones. Without coordinating
    // the FABs would still be visible BEHIND the banner but tap-blocked
    // by it — the rep sees mic / inbox icons they can't reach. Treat
    // the banner like any other blocking overlay and hide the FABs
    // while it's mounted.
    'nbd-pwa-install-banner',
    'nbd-pwa-ios-modal',        // W150 iOS Add-to-Home-Screen walkthrough
    'nbd-pwa-and-modal',        // W150 Android install fallback walkthrough
    // Add Lead revival (2026-07-06): the lead + quick-add modals are
    // .modal-bg overlays at z-index 2000 — BELOW the FAB stack's 9999 —
    // so without coordination the newly restacked Add Lead FAB (and the
    // mic/capture FABs) float on top of the very modal the FAB opened.
    'leadModal',                // full Add/Edit Lead modal (class-toggled)
    'quickAddModal',            // mobile 3-tap quick add (class-toggled)
    // Visual QA 2026-07-06 (emulator screenshots): the onboarding tour's
    // full-screen overlay rendered UNDER the FAB stack — the buttons
    // floated over the welcome dialog. Mounted on open / removed on
    // close, so display-toggle presence semantics are correct.
    'nbd-onb-overlay',
  ];

  // The lead-alert stack lists itself but should NOT trigger hide
  // (the stack is non-modal — it sits next to the FABs). Filter it.
  const _BLOCK_SET = new Set(BLOCKING_MODAL_IDS.filter(id => id !== 'nbd-lead-alert-stack'));

  // Modals that toggle a `.open` class instead of style.display —
  // _isModalActive treats presence-in-DOM as open for display-toggled
  // ids, which would read these as permanently open (they live in the
  // static HTML). estV2Modal was the original case; the lead modals
  // joined 2026-07-06.
  //
  // nbd-picker-modal is the load-bearing entry: it is STATIC in
  // dashboard.html and class-toggled (theme-bridge.css `.open` →
  // display:flex; maps.js nbdPickerOpen/Close flip the class, never
  // inline style) — but Wave 149 listed it as display-toggled, so
  // "presence = open" made _isModalActive() TRUE on every dashboard
  // load and the ENTIRE FAB stack (mic / quick-capture / inbox) has
  // been opacity-0 + untappable since. Found 2026-07-06 by the
  // add-lead revival E2E, whose restore assertion could never pass.
  const _CLASS_TOGGLED = new Set(['estV2Modal', 'leadModal', 'quickAddModal', 'nbd-picker-modal']);

  function _isModalActive() {
    for (const id of _BLOCK_SET) {
      const el = document.getElementById(id);
      if (!el) continue;
      const style = el.style;
      // Class-toggled modals (estV2Modal, leadModal, quickAddModal) flip
      // a `.open` class; others toggle display.
      if (_CLASS_TOGGLED.has(id)) {
        if (el.classList && el.classList.contains('open')) return true;
        continue;
      }
      // Display-toggle modals: visible when display !== 'none' (or
      // missing → defaults to flex/block per the modal's CSS rule).
      if (style.display === 'none') continue;
      // Some modals only exist in DOM when open; mere presence = open.
      return true;
    }
    return false;
  }

  function _applyHidden(hide) {
    FAB_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      if (hide) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        el.setAttribute('aria-hidden', 'true');
      } else {
        el.style.opacity = '';
        el.style.pointerEvents = '';
        el.removeAttribute('aria-hidden');
      }
    });
  }

  function _check() {
    _applyHidden(_isModalActive());
  }

  function _bootstrap() {
    _check();
    if (typeof MutationObserver !== 'function') return;
    const obs = new MutationObserver(() => { _check(); });
    obs.observe(document.body, {
      childList: true,
      subtree: false,         // only direct body children matter
      attributes: true,       // class+style toggles
      attributeFilter: ['class', 'style'],
    });
    // Class-toggled modals are PERSISTENT children — their .open flip is
    // an attribute change on a child, which the body observer above
    // deliberately doesn't see (subtree:false). Without this, hiding
    // waited on the belt-and-suspenders keydown/interval and the FAB
    // stack floated over a just-opened lead modal for up to 1.5s.
    // One observer, multiple targets; estV2Modal mounts dynamically and
    // simply isn't present here — its childList mount + the fallbacks
    // keep covering it as before.
    _CLASS_TOGGLED.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    // Also recheck on any keydown/click — a modal that toggled via
    // a child mutation might not have triggered the observer. Cheap
    // belt-and-suspenders.
    document.addEventListener('keydown', _check, true);
    window.addEventListener('focus', _check);
    // Periodic safety check — covers any modal toggle path I missed.
    // W159 CRITICAL fix: track the interval id + disconnect the
    // MutationObserver on pagehide so a bfcache restore doesn't
    // accumulate intervals. Previously every page navigation
    // started a new interval without clearing the old one — on
    // bfcache restore, two intervals ran in parallel checking a
    // potentially stale DOM state. If a modal had been open when
    // the user left, the stale interval's _check evaluated against
    // the now-detached DOM and could leave the FAB stack
    // permanently hidden.
    const intervalId = setInterval(_check, 1500);
    window.addEventListener('pagehide', () => {
      try { clearInterval(intervalId); } catch (_) {}
      try { obs.disconnect(); } catch (_) {}
    }, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootstrap, { once: true });
  } else {
    setTimeout(_bootstrap, 0);
  }

  const NBDFabStackCoordinator = {
    check: _check,
  };
})();
