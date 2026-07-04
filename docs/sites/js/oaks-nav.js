/* Oaks template — nav/banner behaviors, externalized.
 *
 * These used to be inline onclick= attributes, but the site-wide CSP
 * (script-src-attr 'none' in firebase.json) blocks ALL inline handler
 * attributes, so the mobile menu toggle, menu-link auto-close, and the
 * top-banner close button were silently dead in production. Same
 * addEventListener pattern as the H-1 remediation used elsewhere.
 */
(function () {
  function init() {
    var banner = document.getElementById('topBanner');
    var closeBtn = document.querySelector('.banner-close');
    if (closeBtn && banner) {
      closeBtn.addEventListener('click', function () {
        banner.style.display = 'none';
      });
    }

    var menu = document.getElementById('mobileMenu');
    var toggle = document.querySelector('.nav-toggle');
    if (toggle && menu) {
      toggle.addEventListener('click', function () {
        menu.classList.toggle('open');
      });
    }
    if (menu) {
      // Delegated: any menu link tap closes the menu before the jump.
      menu.addEventListener('click', function (e) {
        var t = e.target;
        while (t && t !== menu && t.tagName !== 'A') t = t.parentElement;
        if (t && t.tagName === 'A') menu.classList.remove('open');
      });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
