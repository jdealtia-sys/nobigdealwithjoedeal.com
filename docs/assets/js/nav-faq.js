/* Restores the FAQ accordion handler that CSP `script-src-attr 'none'` blocks:
   <div class="faq-q"> toggles its parent's `open` class.

   The Services nav dropdown USED to be toggled here too. It moved to
   assets/js/nbd-nav.js on 2026-09-08 so that one file owns the header.
   Two owners was not survivable: this file's toggle was a document-level
   delegate, nbd-nav's is bound to the trigger itself, so nbd-nav opened the
   menu in the target phase and this delegate — seeing it already open —
   closed it again in the same click. On any touch device wider than 900px
   the menu opened and vanished. It also called a.blur() (dumping keyboard
   focus to <body>), preventDefault()ed Cmd/Ctrl-click so "open in new tab"
   silently did nothing, and bound nothing to close the menu on outside
   click or Escape, so an ~900px panel could sit open indefinitely.
   Do not reintroduce dropdown handling here — tests/nav-contract.test.js
   asserts this file stays out of it. */
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

})();
