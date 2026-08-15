/* free-tools-clicks.js — GA4 click events for the Free Tools hub.
 * Delegated listener on the tool cards; fires `tool_click` with the
 * destination path + card name. GA4's gtag uses sendBeacon, so the
 * event survives the same-tab navigation. No PII in params.
 */
(function () {
  'use strict';
  document.addEventListener('click', function (e) {
    var card = e.target && e.target.closest ? e.target.closest('a.tool-card') : null;
    if (!card) return;
    try {
      if (typeof window.gtag === 'function') {
        var nameEl = card.querySelector('.tool-name');
        window.gtag('event', 'tool_click', {
          tool_path: card.getAttribute('href') || '',
          tool_name: nameEl ? nameEl.textContent.trim() : ''
        });
      }
    } catch (err) {}
  });
})();
