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
  if (window.NBDFabStackCoordinator
      && window.NBDFabStackCoordinator.__sentinel === 'nbd-fab-coord-v1') return;

  const FAB_IDS = [
    'nbd-whisper-fab',          // W128
    'nbd-qc-fab',               // W130
    'nbd-qci-fab',              // W132
  ];

  // Modals that, when present in the DOM, hide the bottom-right
  // FAB stack so the floating buttons don't cover modal content.
  // Only full-screen overlays go here — toasts, dropdowns, the
  // W139 lead-alert toast stack do NOT block (they're non-modal
  // and sit next to the FABs, not over them).
  const BLOCKING_MODAL_IDS = [
    'nbd-qc-modal',             // W130 Quick Capture full-screen
    'nbd-qci-modal',            // W132 Capture inbox modal
    'nbd-cmd-modal',            // W133 Cmd+K palette
    'nbd-supplement-modal',     // W144 supplement builder
    'estV2Modal',               // V2 estimate builder
    'nbd-picker-modal',         // appearance picker
    'nbd-daily-brief-modal',    // W161 Daily Morning Brief
    'nbd-weekly-recap-modal',   // W167 Weekly Recap
    'nbd-inspection-modal',     // W168 Inspection Capture
  ];
  const _BLOCK_SET = new Set(BLOCKING_MODAL_IDS);

  function _isModalActive() {
    for (const id of _BLOCK_SET) {
      const el = document.getElementById(id);
      if (!el) continue;
      const style = el.style;
      // The estV2Modal toggles via a `.open` class; others toggle display.
      if (id === 'estV2Modal') {
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

  window.NBDFabStackCoordinator = {
    __sentinel: 'nbd-fab-coord-v1',
    check: _check,
  };
})();
