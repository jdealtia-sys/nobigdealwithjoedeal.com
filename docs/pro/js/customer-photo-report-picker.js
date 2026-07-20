
  window.openPhotoReportPicker = function() {
    if (!window._customerId) {
      if (typeof showToast === 'function') showToast('No customer loaded yet', 'error');
      return;
    }
    var pk = document.getElementById('photoReportPicker');
    if (pk) pk.classList.add('active');
  };
  window.closePhotoReportPicker = function() {
    var pk = document.getElementById('photoReportPicker');
    if (pk) pk.classList.remove('active');
  };
  window.pickPhotoReport = function(mode) {
    closePhotoReportPicker();
    if (typeof generatePhotoReport === 'function') {
      generatePhotoReport(window._customerId, mode);
    } else if (typeof showToast === 'function') {
      showToast('Report module not loaded yet — try again in a moment', 'error');
    }
  };
  // Backdrop click + Esc dismiss
  document.addEventListener('click', function(e) {
    if (e.target && e.target.id === 'photoReportPicker') closePhotoReportPicker();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    var pk = document.getElementById('photoReportPicker');
    if (pk && pk.classList.contains('active')) closePhotoReportPicker();
  });
  // Phase 5: auto-open the picker when arriving from photo-review.html
  // with a #photo-report hash. Defer until _customerId is populated.
  function maybeAutoOpenFromHash() {
    if (window.location.hash !== '#photo-report') return;
    if (!window._customerId) { setTimeout(maybeAutoOpenFromHash, 250); return; }
    history.replaceState(null, '', window.location.pathname + window.location.search);
    openPhotoReportPicker();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(maybeAutoOpenFromHash, 600); });
  } else {
    setTimeout(maybeAutoOpenFromHash, 600);
  }
