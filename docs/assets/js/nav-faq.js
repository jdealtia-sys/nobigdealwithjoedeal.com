/* Restores two universal inline handlers that CSP `script-src-attr 'none'` blocks:
   1. FAQ accordion: <div class="faq-q"> toggles its parent's `open` class
   2. Services nav dropdown: top-level <a> inside <ul class="nav-links"> > <li class="dropdown"> toggles on desktop */
(function () {
  document.addEventListener('click', function (e) {
    var q = e.target.closest && e.target.closest('.faq-q');
    if (q && q.parentElement) q.parentElement.classList.toggle('open');
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
