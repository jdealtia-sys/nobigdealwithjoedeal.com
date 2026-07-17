/* intro-video.js — homepage "Meet Joe" video slot (T10).
 *
 * Stays HIDDEN until a real 11-character YouTube video ID is set on the
 * section's data-yt attribute (same hidden-until-ready pattern as
 * homeowner-wall.js). When a valid ID is present, the section is revealed
 * and the play button links to the video.
 *
 * The video opens in a new tab (a normal link) rather than an on-page
 * iframe, so NO Content-Security-Policy change is required. Upgrading to an
 * inline youtube-nocookie embed later would need frame-src amended in both
 * the homepage <meta> CSP and the global firebase.json header.
 */
(function () {
  'use strict';
  var sec = document.getElementById('intro-video');
  if (!sec) return;
  var id = (sec.getAttribute('data-yt') || '').trim();
  // YouTube IDs are 11 url-safe base64 chars. Anything else (incl. the empty
  // default) leaves the section hidden so nothing broken ever ships.
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return;
  var link = sec.querySelector('[data-iv-link]');
  if (link) link.href = 'https://www.youtube.com/watch?v=' + id;
  sec.hidden = false;
  sec.setAttribute('aria-hidden', 'false');
})();
