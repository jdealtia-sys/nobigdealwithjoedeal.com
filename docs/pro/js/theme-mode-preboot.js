/**
 * NBD Pro — Theme Mode Preboot
 *
 * Reads the user's light/dark preference from localStorage and stamps
 * <html data-mode="..."> before the page paints, so theme-system.css
 * rules keyed on [data-mode="light"|"dark"] apply on the first frame.
 *
 * Must load synchronously in <head> BEFORE css/theme-system.css and
 * BEFORE theme-engine.js. ThemeEngine.init() takes over afterward.
 */
(function () {
  try {
    var pref = localStorage.getItem('nbd_pro_mode_pref') || 'auto';
    var mode = pref;
    if (pref === 'auto') {
      mode = (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    }
    document.documentElement.setAttribute('data-mode', mode);
    if (mode === 'light') document.documentElement.setAttribute('data-light', 'true');
  } catch (e) {}
})();
