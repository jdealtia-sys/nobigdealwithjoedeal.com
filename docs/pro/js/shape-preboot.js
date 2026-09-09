/**
 * NBD Pro — Shape & Depth Preboot
 *
 * Reads the user's Shape & Depth preference (Settings > Appearance) from
 * localStorage and stamps <html data-shape="..."> before the page paints,
 * so dashboard-app.css rules keyed on [data-shape="..."] apply on the
 * first frame instead of flashing "sharp" and then switching.
 *
 * Must load synchronously in <head> BEFORE css/dashboard-app.css, the
 * same way theme-mode-preboot.js already does for light/dark mode.
 * "sharp" is the true no-op default — an absent attribute already
 * renders identically, so this only sets one when a non-default
 * preference was actually saved.
 */
(function () {
  try {
    var shape = localStorage.getItem('nbd_shape_style');
    if (shape && shape !== 'sharp') {
      document.documentElement.setAttribute('data-shape', shape);
    }
  } catch (e) {}
})();
