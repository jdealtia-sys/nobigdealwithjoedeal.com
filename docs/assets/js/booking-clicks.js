/* booking-clicks.js — GA4 click events for the /book hub.
 * Delegated listener on the appointment cards; fires `booking_click` with
 * the cal.com event slug + card name, so the pipeline shows which visit
 * type homeowners actually pick. GA4's gtag uses sendBeacon, so the event
 * survives the navigation to cal.com. No PII in params.
 *
 * Mirrors free-tools-clicks.js — same `a.tool-card` delegation, different
 * event name, plus the slug parsed off the cal.com URL.
 */
(function () {
  'use strict';
  document.addEventListener('click', function (e) {
    var card = e.target && e.target.closest ? e.target.closest('a.tool-card') : null;
    if (!card) return;
    try {
      if (typeof window.gtag === 'function') {
        var href = card.getAttribute('href') || '';
        var nameEl = card.querySelector('.tool-name');
        // https://cal.com/nobigdeal/<slug> -> <slug>
        var slug = '';
        var m = href.match(/cal\.com\/[^/]+\/([^/?#]+)/);
        if (m) slug = m[1];
        window.gtag('event', 'booking_click', {
          booking_slug: slug,
          booking_name: nameEl ? nameEl.textContent.trim() : '',
          booking_href: href
        });
      }
    } catch (err) {}
  });
})();
