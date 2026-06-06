/**
 * Theme loader — must run before any paint to avoid a flash of the wrong
 * theme. Loaded as an external non-deferred <script> so it runs synchronously
 * in strict-CSP pages (no 'unsafe-inline' needed).
 */
(function () {
  try {
    // Canonical key is nbd_pro_theme (ThemeEngine); nbd-theme is the legacy
    // mirror. Read canonical first so the pre-paint data-theme matches what
    // ThemeEngine.init() will apply — otherwise the engine swaps the theme
    // after load and the user sees a flash of the wrong theme (audit F-1/F-2).
    var saved = localStorage.getItem('nbd_pro_theme') || localStorage.getItem('nbd-theme');
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
    }
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'nbd-original');
  }
})();
