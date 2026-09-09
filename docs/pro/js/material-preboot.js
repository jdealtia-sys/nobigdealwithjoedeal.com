/**
 * NBD Pro — Material Preboot
 *
 * Reads the user's Material preference (Settings > Appearance — Shop Copy
 * / Golden Hour) from localStorage and stamps <html data-material="...">
 * before the page paints, mirroring shape-preboot.js's exact pattern so
 * a saved non-default preference doesn't flash unstyled before applying.
 * "none" is the true no-op default — an absent attribute already renders
 * identically, so this only sets one when a real preference was saved.
 *
 * Must load synchronously in <head> BEFORE css/dashboard-app.css.
 */
(function () {
  try {
    var material = localStorage.getItem('nbd_material_style');
    if (material && material !== 'none') {
      document.documentElement.setAttribute('data-material', material);
    }
  } catch (e) {}
})();
