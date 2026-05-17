  // Remove loader once DOM is ready + a tiny delay for paint
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
      var loader = document.getElementById('nbd-loader');
      if (loader) { loader.style.opacity = '0'; setTimeout(function() { loader.remove(); }, 400); }
    }, 300);
  });
