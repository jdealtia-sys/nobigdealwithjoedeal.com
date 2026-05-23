/* Announcement bar: short/long text swap + slide rotation.
   Shared across all homeowner pages so the bar reads on a single line
   at ≤600px (was wrapping the phone number to a second row on Android
   phones because the long text "Free Roof Inspections — Call or Text
   Joe: (859) 420-7382" overflows narrow viewports). */
(function(){
  var mq = window.matchMedia('(max-width:600px)');
  function sync(){
    var nodes = document.querySelectorAll('.ann-text');
    for (var i = 0; i < nodes.length; i++){
      var el = nodes[i];
      var want = mq.matches ? (el.dataset.short || el.dataset.long) : el.dataset.long;
      if (want && el.textContent !== want) el.textContent = want;
    }
  }
  sync();
  if (mq.addEventListener) mq.addEventListener('change', sync);
  else if (mq.addListener) mq.addListener(sync);
})();

(function(){
  var slides = document.querySelectorAll('.ann-slide');
  if (slides.length < 2) return;
  var current = 0;
  setInterval(function(){
    slides[current].classList.remove('active');
    slides[current].classList.add('exit');
    var prev = current;
    current = (current + 1) % slides.length;
    slides[current].classList.add('active');
    slides[current].classList.remove('exit');
    setTimeout(function(){ slides[prev].classList.remove('exit'); }, 600);
  }, 4000);
})();
