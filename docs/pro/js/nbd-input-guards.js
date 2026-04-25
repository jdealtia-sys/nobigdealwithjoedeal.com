/**
 * nbd-input-guards.js — paste/length guards on big-text fields
 *
 * Firestore documents have a 1MB hard limit. A user pasting a 5MB+
 * inspection report into a notes textarea hit that limit silently —
 * the optimistic UI showed the note saved, the actual write failed,
 * the catch logged to console with no toast. Data loss with a smile.
 *
 * This shim binds a delegated input handler to the body that:
 *   1. Honors any explicit `maxlength` on the element
 *   2. For textareas + multi-line inputs without a maxlength, enforces
 *      a soft cap of 240,000 chars (~240 KB UTF-16, well under the
 *      1MB doc ceiling once you account for sibling fields)
 *   3. Truncates on paste — replaces the in-flight clipboard payload
 *      with a clamped version so the user keeps as much as fits and
 *      sees a clear toast about what happened.
 *
 * Idempotent: safe to load on every page; only binds once via a
 * sentinel on document.body. Skips inputs with `data-nbd-guard="off"`.
 */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  if (document.body && document.body.dataset && document.body.dataset.nbdGuards === 'on') return;

  const SOFT_CAP = 240000;
  const _toast = (msg) => {
    if (typeof window.showToast === 'function') window.showToast(msg, 'warning');
  };

  function _isLongFormElement(el) {
    if (!el) return false;
    if (el.dataset && el.dataset.nbdGuard === 'off') return false;
    if (el.tagName === 'TEXTAREA') return true;
    // Plain text inputs: only guard those without maxlength and that
    // accept long values (e.g., textareas-by-css). We don't guard
    // <input type="email"> etc.
    if (el.tagName === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'text' || t === 'search' || t === 'url') {
        if (!el.maxLength || el.maxLength === -1 || el.maxLength > SOFT_CAP) {
          return el.classList?.contains('nbd-long') || el.dataset?.nbdLong === '1';
        }
      }
    }
    return false;
  }

  function _enforce(el, valueOverride) {
    if (!el) return;
    const cap = (el.maxLength && el.maxLength > 0 && el.maxLength <= SOFT_CAP)
      ? el.maxLength : SOFT_CAP;
    const v = valueOverride != null ? String(valueOverride) : String(el.value || '');
    if (v.length > cap) {
      el.value = v.slice(0, cap);
      _toast('Trimmed to ' + Math.round(cap / 1000) + 'K chars — Firestore limit.');
      return true;
    }
    return false;
  }

  // Delegated paste handler on document so dynamically-mounted
  // textareas (modals, customer page sections) are covered.
  document.addEventListener('paste', (e) => {
    const el = e.target;
    if (!_isLongFormElement(el)) return;
    const cap = (el.maxLength && el.maxLength > 0 && el.maxLength <= SOFT_CAP)
      ? el.maxLength : SOFT_CAP;
    const dt = e.clipboardData || window.clipboardData;
    if (!dt) return;
    const incoming = dt.getData('text') || '';
    if (!incoming) return;
    const existing = String(el.value || '');
    const start = el.selectionStart ?? existing.length;
    const end = el.selectionEnd ?? existing.length;
    const nextLen = (existing.length - (end - start)) + incoming.length;
    if (nextLen <= cap) return; // fits, let it through
    e.preventDefault();
    const room = Math.max(0, cap - (existing.length - (end - start)));
    const trimmed = incoming.slice(0, room);
    const merged = existing.slice(0, start) + trimmed + existing.slice(end);
    el.value = merged;
    // Move caret to the end of the inserted (truncated) chunk.
    try {
      const caret = start + trimmed.length;
      el.selectionStart = el.selectionEnd = caret;
    } catch (_) {}
    el.dispatchEvent(new Event('input', { bubbles: true }));
    _toast('Paste was longer than ' + Math.round(cap / 1000) + 'K chars — kept the first ' + Math.round(trimmed.length / 1000) + 'K.');
  }, true);

  // Catch programmatic / IME / drag drops where paste won't fire.
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!_isLongFormElement(el)) return;
    _enforce(el);
  }, true);

  if (document.body) document.body.dataset.nbdGuards = 'on';
})();
