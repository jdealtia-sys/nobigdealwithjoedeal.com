/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: 963b091009.  Do not edit by hand. */
(function(){
  const slides = document.querySelectorAll('.ann-slide');
  let current = 0;
  if(slides.length < 2) return;
  setInterval(function(){
    slides[current].classList.remove('active');
    slides[current].classList.add('exit');
    const prev = current;
    current = (current + 1) % slides.length;
    slides[current].classList.add('active');
    slides[current].classList.remove('exit');
    setTimeout(function(){ slides[prev].classList.remove('exit'); }, 600);
  }, 4000);
})();
