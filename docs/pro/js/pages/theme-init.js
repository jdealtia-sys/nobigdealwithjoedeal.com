/**
 * Theme loader — must run before any paint to avoid a flash of the wrong
 * theme. Loaded as an external non-deferred <script> so it runs synchronously
 * in strict-CSP pages (no 'unsafe-inline' needed).
 */
(function () {
  try {
    var saved = localStorage.getItem('nbd-theme');
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'nbd-original');
  }
})();
