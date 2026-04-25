/**
 * console-quiet.js — suppress noisy console.log/console.debug in production
 *
 * The codebase has ~280 console.log calls across 79 modules. Keeping all of
 * them shipping to a contractor's devtools (and through Sentry breadcrumbs)
 * leaks debug detail and makes real signal harder to find. This shim:
 *
 *   - leaves console.warn / console.error untouched (Sentry needs them)
 *   - silences console.log / console.debug / console.info on production hosts
 *   - re-enables full logging when ?debug=1 is on the URL or
 *     localStorage.nbd_debug === '1' (set once, sticks across reloads)
 *
 * Loaded BEFORE every other module (right after sentry-init) so the suppression
 * is in place by the time anything else runs. To temporarily debug in prod:
 *   localStorage.setItem('nbd_debug','1'); location.reload();
 */
(function () {
  'use strict';
  if (typeof console === 'undefined') return;

  const host = (typeof location !== 'undefined' ? location.hostname : '') || '';
  const isLocal = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host) || host.endsWith('.local');
  const debugFlag = (() => {
    try {
      if (/[?&]debug=1\b/.test(location.search || '')) return true;
      if (localStorage.getItem('nbd_debug') === '1') return true;
    } catch (_) {}
    return false;
  })();

  if (isLocal || debugFlag) return; // keep verbose locally + when explicitly enabled

  const noop = function () {};
  // Only silence the chatty levels — warn/error/trace stay so real
  // problems still surface in Sentry breadcrumbs and dev consoles.
  console.log = noop;
  console.debug = noop;
  console.info = noop;
})();
