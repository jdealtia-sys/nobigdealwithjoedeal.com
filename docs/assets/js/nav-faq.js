/* Restores two universal inline handlers that CSP `script-src-attr 'none'` blocks:
   1. FAQ accordion: <div class="faq-q"> toggles its parent's `open` class
   2. Services nav dropdown: top-level <a> inside <ul class="nav-links"> > <li class="dropdown"> toggles on desktop */
(function () {
  function toggleFaq(q) {
    if (!q.parentElement) return;
    var open = q.parentElement.classList.toggle('open');
    q.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // A11y (T4b): the .faq-q headers are <div>s — expose them as buttons so
  // keyboard users can Tab to them and toggle with Enter/Space.
  function initFaqA11y() {
    var qs = document.querySelectorAll('.faq-q');
    for (var i = 0; i < qs.length; i++) {
      var q = qs[i];
      if (!q.hasAttribute('role')) q.setAttribute('role', 'button');
      if (!q.hasAttribute('tabindex')) q.setAttribute('tabindex', '0');
      q.setAttribute('aria-expanded',
        q.parentElement && q.parentElement.classList.contains('open') ? 'true' : 'false');
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFaqA11y);
  } else {
    initFaqA11y();
  }

  document.addEventListener('click', function (e) {
    var q = e.target.closest && e.target.closest('.faq-q');
    if (q) toggleFaq(q);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    var q = e.target.closest && e.target.closest('.faq-q');
    if (!q) return;
    e.preventDefault(); // stop Space from scrolling the page
    toggleFaq(q);
  });

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a) return;
    var li = a.parentElement;
    if (!li || !li.classList.contains('dropdown')) return;
    var ul = li.parentElement;
    if (!ul || !ul.classList.contains('nav-links')) return;
    if (window.innerWidth <= 900) return;
    e.preventDefault();
    var wasOpen = li.classList.contains('open');
    var open = ul.querySelectorAll('.dropdown.open');
    for (var i = 0; i < open.length; i++) open[i].classList.remove('open');
    if (!wasOpen) li.classList.add('open');
    a.blur();
  });
})();
