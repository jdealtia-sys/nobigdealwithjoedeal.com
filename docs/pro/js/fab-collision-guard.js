/**
 * fab-collision-guard.js — the ⋯ launcher gets out of its own way
 *
 * WHY THIS EXISTS
 * The ⋯ field-tools launcher (#nbd-fab-dial, fab-speed-dial.js) is
 * position:fixed in the bottom-right corner. Every view that puts an
 * interactive control in that corner collides with it, and each
 * collision has so far been patched by hand in CSS:
 *
 *   #1058 — Photos job cards' VIEW/ADD buttons (gated the launcher off
 *           the view entirely)
 *   #1059 — D2D value-per-door / streak cards (#d2dContent, 150px
 *           bottom clearance)
 *   #1061 — D2D map spyglass row's 📍 / Go buttons (76px right column)
 *
 * Three hand-written rules for three collisions is a pattern, not a
 * coincidence: the launcher can't know what a future view will park
 * under it, and the next one will be found the same way — from a
 * screenshot, after it shipped. This module makes the launcher detect
 * what's beneath it and move, so an unanticipated view degrades to "the
 * button nudged up" instead of "the control is unreachable."
 *
 * The existing static CSS clearances STAY. They're the cheap, jitter-free
 * baseline for the cases we know about; this guard is the safety net for
 * the ones we don't. Where the static clearance already works, the guard
 * simply never fires.
 *
 * HOW IT WORKS
 * Hit-test the launcher's own footprint with elementsFromPoint(), keep
 * any *interactive* element found underneath it, then translate the
 * launcher up by exactly enough to clear the topmost one (not a fixed
 * step — measured, so it settles in a single move). If the required
 * dodge exceeds MAX_DODGE the launcher yields instead: shrinks + fades
 * so it obscures as little as possible while staying reachable.
 *
 * Deliberate non-goals / guards:
 *   - Never moves while the dial is OPEN. kanban-force.css parks the
 *     fanned-out tools at fixed slots relative to the launcher's CSS
 *     position; translating the launcher would desync the fan. Opening
 *     clears any dodge first.
 *   - Never moves while the mic is recording (same reasoning as
 *     fab-speed-dial's dismiss guards — don't move the ⏹ target).
 *   - Never fights fab-stack-coordinator: when it has inline-hidden the
 *     stack for a modal, we bail and leave the transform alone.
 *   - Uses transform, NOT bottom/right — kanban-force.css sets those with
 *     !important, and transform composes cleanly with them.
 */
(function () {
  'use strict';
  const __NBD_LOADED = window.__NBD_LOADED = window.__NBD_LOADED || {};
  if (__NBD_LOADED['fab-collision-guard']) return;
  __NBD_LOADED['fab-collision-guard'] = true;

  const DIAL_ID = 'nbd-fab-dial';
  const OPEN_CLASS = 'nbd-dial-open';
  const DODGE_VAR = '--nbd-fab-dodge';
  const YIELD_CLASS = 'nbd-fab-yield';

  // Clear the control by this much before it's considered safe.
  const GAP = 10;
  // Past this the dodge would sling the launcher into the middle of the
  // screen; yield instead.
  const MAX_DODGE = 168;
  // Scroll can fire ~60x/s; hit-testing that often is wasteful. One check
  // per this many ms is well inside human reaction time.
  const THROTTLE_MS = 90;

  // Anything a rep could need to tap. [data-action] is the repo's CSP-safe
  // delegate attribute, so it catches controls that aren't <button>.
  const INTERACTIVE_SEL = [
    'button', 'a[href]', 'input', 'select', 'textarea', 'label',
    '[role="button"]', '[role="link"]', '[role="tab"]', '[data-action]',
    '[data-fn]', '[contenteditable="true"]', '.btn',
  ].join(',');

  // The FAB stack is allowed to overlap itself. [data-fab-ignore] is the
  // escape hatch for anything that WANTS to sit under the launcher.
  const STACK_SEL = [
    '#' + DIAL_ID, '#nbd-whisper-fab', '#nbd-qc-fab', '#nbd-qci-fab',
    '#addLeadFab', '[data-fab-ignore]',
  ].join(',');

  let _raf = 0;
  let _last = 0;
  let _appliedDodge = 0;

  function _dial() { return document.getElementById(DIAL_ID); }

  function _micIsRecording() {
    const mic = document.getElementById('nbd-whisper-fab');
    return !!(mic && mic.textContent && mic.textContent.indexOf('⏹') !== -1);
  }

  // The coordinator inline-hides the whole stack while a full-screen modal
  // is open. Measuring a hidden launcher is meaningless.
  function _isSuppressed(el) {
    if (!el) return true;
    if (el.style && el.style.opacity === '0') return true;
    const cs = window.getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  }

  function _setDodge(px) {
    const el = _dial();
    if (!el) return;
    if (px === _appliedDodge) return;
    _appliedDodge = px;
    if (px) el.style.setProperty(DODGE_VAR, '-' + px + 'px');
    else el.style.removeProperty(DODGE_VAR);
  }

  function _setYield(on) {
    document.body.classList.toggle(YIELD_CLASS, !!on);
  }

  function _reset() {
    _setDodge(0);
    _setYield(false);
  }

  /**
   * Interactive elements sitting underneath the launcher's footprint.
   * Sampled at the centre + four inset corners: cheaper than walking the
   * DOM, and catches a control clipping any corner rather than only a
   * dead-centre hit.
   */
  function _blockersUnder(rect) {
    const inset = 6;
    const pts = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + inset, rect.top + inset],
      [rect.right - inset, rect.top + inset],
      [rect.left + inset, rect.bottom - inset],
      [rect.right - inset, rect.bottom - inset],
    ];
    const found = [];
    const seen = new Set();
    for (const [x, y] of pts) {
      // Off-viewport sample points return [] — harmless.
      const stack = document.elementsFromPoint(x, y) || [];
      for (const node of stack) {
        if (!node || node.nodeType !== 1) continue;
        if (node.closest && node.closest(STACK_SEL)) continue;
        const hit = node.closest && node.closest(INTERACTIVE_SEL);
        if (!hit || seen.has(hit)) continue;
        if (hit.closest(STACK_SEL)) continue;
        // A disabled/invisible control isn't worth dodging for.
        if (hit.disabled) continue;
        const hr = hit.getBoundingClientRect();
        if (!hr.width || !hr.height) continue;
        seen.add(hit);
        found.push(hr);
      }
    }
    return found;
  }

  function _check() {
    const el = _dial();
    if (!el) return;

    // Open dial → the fanned-out tools are parked at slots anchored to the
    // launcher's CSS position, so it must sit at that natural slot while
    // open: drop any dodge/yield rather than leaving the fan desynced.
    if (document.body.classList.contains(OPEN_CLASS)) { _reset(); return; }
    // Recording → the launcher's neighbour is the ⏹ stop target; freeze
    // exactly as-is rather than shifting under the rep's thumb.
    if (_micIsRecording()) return;
    if (_isSuppressed(el)) { _reset(); return; }

    // Measure the launcher at its natural slot so the dodge is computed
    // from a stable origin rather than compounding on itself.
    const prevDodge = _appliedDodge;
    if (prevDodge) _setDodge(0);
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) { _setYield(false); return; }

    const blockers = _blockersUnder(rect);
    if (!blockers.length) { _setDodge(0); _setYield(false); return; }

    // Move up just enough that the launcher's bottom clears the highest
    // blocker's top edge.
    let needed = 0;
    for (const b of blockers) {
      needed = Math.max(needed, rect.bottom - b.top + GAP);
    }
    needed = Math.ceil(needed);

    if (needed <= 0) { _setDodge(0); _setYield(false); return; }
    if (needed > MAX_DODGE) {
      // Can't clear it without ending up mid-screen — obscure as little
      // as possible instead, and stay tappable.
      _setDodge(0);
      _setYield(true);
      return;
    }
    _setDodge(needed);
    _setYield(false);
  }

  function _schedule() {
    if (_raf) return;
    _raf = window.requestAnimationFrame(() => {
      _raf = 0;
      const now = Date.now();
      if (now - _last < THROTTLE_MS) return;
      _last = now;
      try { _check(); } catch (e) { /* never break the page over layout */ }
    });
  }

  function _bootstrap() {
    _schedule();
    window.addEventListener('scroll', _schedule, { passive: true, capture: true });
    window.addEventListener('resize', _schedule);
    window.addEventListener('orientationchange', _schedule);
    // View switches re-render whole subtrees under the launcher.
    document.addEventListener('click', _schedule, true);
    window.addEventListener('nbd:data-refreshed', _schedule);

    if (typeof MutationObserver === 'function') {
      const obs = new MutationObserver(_schedule);
      obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
      window.addEventListener('pagehide', () => { try { obs.disconnect(); } catch (_) {} }, { once: true });
    }
    // Backstop for any layout path the listeners above miss, mirroring
    // fab-stack-coordinator's own interval + pagehide teardown.
    const id = setInterval(_schedule, 1200);
    window.addEventListener('pagehide', () => { try { clearInterval(id); } catch (_) {} }, { once: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootstrap, { once: true });
  } else {
    setTimeout(_bootstrap, 0);
  }

  window.NBDFabCollisionGuard = { check: _check, reset: _reset };
})();
