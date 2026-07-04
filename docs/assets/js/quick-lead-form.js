/* Quick on-page lead form — self-configuring (2026-07-03, conversion audit).
 * Service/city pages used to bounce "Get My Free Estimate" to the homepage
 * /#contact, leaking intent. This renders a short form IN PLACE and posts
 * through the same hardened submitPublicLead gateway (App Check + rate limit +
 * honeypot) every NBD public form uses — tagged with the page's service/city
 * so the lead lands in Joe's pipeline with context, no navigation required.
 *
 * Usage: <div data-nbd-quick-form data-service="Hail Damage" data-city="Mason"></div>
 * Only firstName + phone are required (phone is the lead); address optional.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Lazy-load the shared gateway client if a page didn't include it.
  function ensureGateway() {
    if (typeof window.submitPublicLead === 'function') return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = '/assets/js/public-lead-submit.js';
      s.onload = resolve;
      s.onerror = function () { reject(new Error('gateway load failed')); };
      document.head.appendChild(s);
    });
  }

  function render(host) {
    var service = host.getAttribute('data-service') || '';
    var city = host.getAttribute('data-city') || '';
    var uid = 'qlf-' + Math.abs((service + city + host.offsetTop).split('').reduce(function (a, c) { return (a * 31 + c.charCodeAt(0)) | 0; }, 7));
    var heading = city ? ('Get Your Free ' + esc(city) + ' Estimate') : 'Get Your Free Estimate';
    var sub = service
      ? ('Tell Joe where and he\'ll reach out — usually same day. Or just call.')
      : ('Tell Joe where and he\'ll reach out — usually same day.');
    host.innerHTML =
      '<form class="qlf" novalidate aria-labelledby="' + uid + '-h">' +
        '<h3 class="qlf-title" id="' + uid + '-h">' + heading + '</h3>' +
        '<p class="qlf-sub">' + sub + '</p>' +
        '<div class="qlf-msg qlf-err" id="' + uid + '-err" role="alert"></div>' +
        '<div class="qlf-msg qlf-ok" id="' + uid + '-ok" role="status"></div>' +
        '<div class="qlf-row">' +
          '<label class="qlf-field"><span>First name *</span><input id="' + uid + '-fn" type="text" name="given-name" autocomplete="given-name" required></label>' +
          '<label class="qlf-field"><span>Mobile phone *</span><input id="' + uid + '-ph" type="tel" name="tel" autocomplete="tel" inputmode="tel" required></label>' +
        '</div>' +
        '<label class="qlf-field"><span>Property address <em>(optional)</em></span><input id="' + uid + '-ad" type="text" name="street-address" autocomplete="street-address"></label>' +
        // Honeypot — the gateway drops any submission that fills this.
        '<input class="qlf-hp" id="' + uid + '-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
        '<button class="qlf-btn" type="submit" id="' + uid + '-btn">Send &mdash; Joe calls you back</button>' +
        '<div class="qlf-alt">Rather talk now? <a href="tel:+18594207382">Call or text (859) 420-7382</a></div>' +
      '</form>';

    var form = host.querySelector('form');
    var err = document.getElementById(uid + '-err');
    var ok = document.getElementById(uid + '-ok');
    var btn = document.getElementById(uid + '-btn');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      err.textContent = ''; ok.textContent = '';
      var firstName = document.getElementById(uid + '-fn').value.trim();
      var phone = document.getElementById(uid + '-ph').value.trim();
      if (!firstName || !phone) { err.textContent = 'Please add your first name and phone.'; return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      ensureGateway().then(function () {
        return window.submitPublicLead('contact', {
          firstName: firstName,
          phone: phone,
          address: document.getElementById(uid + '-ad').value.trim(),
          service: service,
          message: (service || city) ? ('Page: ' + [service, city].filter(Boolean).join(' — ')) : '',
          website: document.getElementById(uid + '-hp').value, // honeypot
          source: 'page-form:' + (window.location.pathname || '')
        });
      }).then(function (out) {
        if (!out || !out.ok) throw new Error((out && out.reason) || 'failed');
        form.reset();
        ok.textContent = 'Got it! Joe will reach out shortly — usually same day.';
        btn.textContent = 'Sent ✓';
      }).catch(function (e2) {
        err.textContent = 'Could not send — please call or text (859) 420-7382. (' + (e2.message || 'error') + ')';
        btn.disabled = false; btn.textContent = 'Send — Joe calls you back';
      });
    });
  }

  function init() {
    var hosts = document.querySelectorAll('[data-nbd-quick-form]');
    for (var i = 0; i < hosts.length; i++) render(hosts[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
