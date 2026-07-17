/**
 * homeowner-wall.js — "Real Roofs. Real Neighbors." photo wall.
 *
 * Reusable, lazy-loaded photo grid driven by a JSON manifest
 * (/assets/data/homeowner-wall.json). The section stays HIDDEN until the
 * manifest has >= MIN_ENTRIES real photos, so it never renders an awkward
 * empty state on a fresh site — a job-close-out photo at every install feeds
 * it over time (DOPE handheld "No Big Deal!" signs + the completed-job
 * automation). No fabrication: every card is a real job photo Jo added.
 *
 * Manifest entry shape (all fields required):
 *   { "image": "/assets/homeowner-wall/xxx.webp",
 *     "city":  "Milford, OH",
 *     "name":  "Sarah K.",          // first name + last initial only
 *     "alt":   "New GAF Timberline roof on a two-story home in Milford" }
 *
 * Zero layout shift: every <img> ships explicit width/height (the grid cell is
 * a fixed 4:3 box), loading="lazy", decoding="async". Mount points: any element
 * with id="homeowner-wall" (homepage + area pages reuse the same component).
 */
(function () {
  'use strict';

  var MIN_ENTRIES = 3;               // hide entirely below this — no thin walls
  var MAX_ENTRIES = 12;              // cap the grid; newest first
  var MANIFEST = '/assets/data/homeowner-wall.json';

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function valid(e) {
    return e && typeof e === 'object' && e.image && e.alt &&
      /^\/assets\/[\w./-]+\.(webp|jpg|jpeg|png)$/i.test(String(e.image));
  }

  function render(mount, items) {
    var grid = items.slice(0, MAX_ENTRIES).map(function (e) {
      var cap = [e.name, e.city].filter(Boolean).map(esc).join(' · ');
      return '<figure class="hw-card">'
        + '<img class="hw-img" src="' + esc(e.image) + '" alt="' + esc(e.alt) + '"'
        + ' width="400" height="300" loading="lazy" decoding="async">'
        + (cap ? '<figcaption class="hw-cap">' + cap + '</figcaption>' : '')
        + '</figure>';
    }).join('');
    mount.querySelector('.hw-grid').innerHTML = grid;
    mount.hidden = false;            // reveal only now that we have real content
    mount.removeAttribute('aria-hidden');
  }

  function init() {
    var mount = document.getElementById('homeowner-wall');
    if (!mount || !mount.querySelector('.hw-grid')) return; // no slot on this page
    fetch(MANIFEST, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) {
        var items = (Array.isArray(data) ? data : []).filter(valid);
        if (items.length >= MIN_ENTRIES) render(mount, items);
        // else: leave hidden — component is invisible on an under-filled manifest
      })
      .catch(function () { /* network/parse fail → stay hidden, never break the page */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
