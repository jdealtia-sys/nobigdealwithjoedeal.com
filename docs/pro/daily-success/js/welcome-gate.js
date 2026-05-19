  // First-visit welcome modal gate. The modal ships with
  // display:none so this script is the ONLY thing that shows it.
  // Runs inline immediately after the modal's HTML is parsed, so
  // there's no flash of the welcome on later visits.
  (function () {
    try {
      if (!localStorage.getItem('nbd-welcome-seen')) {
        var wm = document.getElementById('welcomeModal');
        if (wm) wm.style.display = 'flex';
      }
    } catch (e) { /* localStorage blocked — default to hidden */ }
  })();
