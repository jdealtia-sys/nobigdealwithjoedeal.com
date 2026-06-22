// ── Blog mobile-nav toggle ──────────────────────────────────────────
// The hamburger button on blog posts previously used an inline onclick
// to toggle #mobileNav. Blog posts are served under /pro/blog/* which
// inherits the strict app CSP (script-src-attr 'none'), so that inline
// handler was dead — tapping the hamburger did nothing on mobile. This
// external, CSP-clean delegate restores it. Loaded on every blog post.
(function () {
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#hamburger, .hamburger')) {
      e.preventDefault();
      var m = document.getElementById('mobileNav');
      if (m) m.classList.toggle('open');
      return;
    }
    // Tapping a link inside the open menu should dismiss it.
    if (t.closest('#mobileNav a')) {
      var nav = document.getElementById('mobileNav');
      if (nav) nav.classList.remove('open');
    }
  });
})();
