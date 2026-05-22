/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: 7bd16e1384.  Do not edit by hand. */
// Try-again button — hard reload so the new SW can claim the page if it
  // was waiting. Using location.reload(true) is deprecated in modern
  // browsers; use location.href reassignment which bypasses bfcache.
  document.getElementById('tryAgain').addEventListener('click', function () {
    window.location.href = window.location.href;
  });

  // Show live online/offline state so users know to retry when it flips.
  function updateStatus() {
    var el = document.getElementById('netStatus');
    if (!el) return;
    el.textContent = 'Network: ' + (navigator.onLine ? 'online — tap Try Again' : 'offline');
    el.style.color = navigator.onLine ? 'rgba(255,255,255,.7)' : 'rgba(255,255,255,.35)';
  }
  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus();

  // Auto-refresh the moment the device comes back online.
  window.addEventListener('online', function () {
    setTimeout(function () { window.location.href = window.location.href; }, 500);
  });
