/**
 * fab-speed-dial.js — mobile speed-dial for the field-tool FABs
 *
 * Jo's pick (2026-07-06, from his phone screenshots): on phones the
 * three field-tool FABs (W128 mic, W130 quick capture, W132 capture
 * inbox) collapse behind ONE launcher button (#nbd-fab-dial) so the
 * bottom-right corner never stacks four buttons over the kanban and
 * the bottom nav again. ＋ Add Lead stays its own always-visible
 * button, floating directly ABOVE the launcher.
 *
 * Split of responsibilities:
 *   - This module: builds the launcher, toggles body.nbd-dial-open,
 *     dismiss behaviors (outside tap, Escape).
 *   - kanban-force.css (@media ≤768px): parks the tools at their fan
 *     slots faded + untappable when closed, fans them out in a thumb
 *     row LEFT of the launcher when open. Desktop ≥769px hides the
 *     launcher and keeps the classic vertical stack.
 *   - fab-stack-coordinator.js: lists the launcher in FAB_IDS, so a
 *     full-screen modal hides it with the rest of the stack (its
 *     inline opacity:0 outranks our CSS open-state).
 *
 * DO NOT fold the dial when a fanned-out tool is tapped: tapping the
 * mic starts a recording and the SAME button becomes the ⏹ stop
 * control — folding would leave the rep with a recording they can't
 * stop until the 60s ceiling. The coordinator already hides the fan
 * while quick-capture / inbox modals are open, so tool taps need no
 * help from us. Outside-tap and Escape dismissal are guarded by the
 * same recording check.
 */
(function () {
  'use strict';
  const __NBD_LOADED = window.__NBD_LOADED = window.__NBD_LOADED || {};
  if (__NBD_LOADED['fab-speed-dial']) return;
  __NBD_LOADED['fab-speed-dial'] = true;

  const DIAL_ID = 'nbd-fab-dial';
  const OPEN_CLASS = 'nbd-dial-open';
  const CLOSED_GLYPH = '⋯';
  const OPEN_GLYPH = '✕';
  const CLOSED_TITLE = 'Field tools — dictate, quick capture, inbox';
  const OPEN_TITLE = 'Close field tools';

  function _isOpen() {
    return document.body.classList.contains(OPEN_CLASS);
  }

  // The W128 mic swaps its glyph to ⏹ while recording (nbd-whisper.js
  // _updateFabState). That's the only observable "recording" signal
  // that doesn't reach into the module's private state.
  function _micIsRecording() {
    const mic = document.getElementById('nbd-whisper-fab');
    return !!(mic && mic.textContent && mic.textContent.indexOf('⏹') !== -1);
  }

  function _setOpen(open) {
    document.body.classList.toggle(OPEN_CLASS, open);
    const btn = document.getElementById(DIAL_ID);
    if (!btn) return;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? OPEN_GLYPH : CLOSED_GLYPH;
    btn.title = open ? OPEN_TITLE : CLOSED_TITLE;
  }

  function _buildDial() {
    if (document.getElementById(DIAL_ID)) return;
    const btn = document.createElement('button');
    btn.id = DIAL_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Field tools');
    btn.setAttribute('aria-expanded', 'false');
    btn.textContent = CLOSED_GLYPH;
    btn.title = CLOSED_TITLE;
    btn.addEventListener('click', () => { _setOpen(!_isOpen()); });
    document.body.appendChild(btn);
  }

  // Outside tap dismisses. Capture phase so a click that lands in a
  // just-opened modal still folds the dial behind it. The launcher's
  // own click is excluded (its listener is the toggle), and so are
  // the fanned-out tools: this capture handler runs BEFORE the tool's
  // own click handler, so _micIsRecording() can't yet see the ⏹ a mic
  // tap is about to create — folding here would strand the recording
  // the header comment warns about.
  function _onDocClick(e) {
    if (!_isOpen()) return;
    if (_micIsRecording()) return;
    const t = e.target;
    if (t && t.closest &&
        t.closest('#' + DIAL_ID + ', #nbd-whisper-fab, #nbd-qc-fab, #nbd-qci-fab')) return;
    _setOpen(false);
  }

  function _onKeydown(e) {
    if (e.key !== 'Escape') return;
    if (!_isOpen() || _micIsRecording()) return;
    _setOpen(false);
  }

  function _bootstrap() {
    _buildDial();
    document.addEventListener('click', _onDocClick, true);
    document.addEventListener('keydown', _onKeydown, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _bootstrap, { once: true });
  } else {
    setTimeout(_bootstrap, 0);
  }
})();
