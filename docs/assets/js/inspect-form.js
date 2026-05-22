/**
 * inspect-form.js — /inspect lead-capture form handler.
 *
 * Behavior:
 *  - On load, read utm_source / utm_medium / utm_campaign from the URL
 *    and stamp them into the matching hidden form fields. This is the
 *    print-tracking pipeline: QR codes encode the UTM params and they
 *    flow into the submission so we know which piece (yard sign vs.
 *    door hanger vs. card-front) drove the lead.
 *  - On submit, prevent default, gather all fields including the UTMs,
 *    log to console, and swap the form for a success message.
 *
 * TODO (follow-up — not first-ship scope):
 *  - Wire to the existing /assets/js/public-lead-submit.js client by
 *    calling window.submitPublicLead('inspect', payload) once the
 *    server-side submitPublicLead function adds 'inspect' to its
 *    accepted kinds list (see functions/submitPublicLead.js).
 *  - Add a /pro/thank-you page redirect after success.
 *  - Fire a GA conversion event when submission succeeds.
 */
(function () {
  'use strict';

  function readUtms() {
    var params;
    try { params = new URLSearchParams(window.location.search); }
    catch (e) { return {}; }
    return {
      utm_source:   (params.get('utm_source')   || '').slice(0, 80),
      utm_medium:   (params.get('utm_medium')   || '').slice(0, 80),
      utm_campaign: (params.get('utm_campaign') || '').slice(0, 80)
    };
  }

  function stampHiddenFields(utms) {
    Object.keys(utms).forEach(function (k) {
      var el = document.getElementById(k);
      if (el) el.value = utms[k];
    });
  }

  function gatherFormData(form) {
    var fd = new FormData(form);
    var out = {};
    fd.forEach(function (v, k) {
      if (k === 'photos') return; // files handled separately
      out[k] = typeof v === 'string' ? v.trim() : v;
    });
    var photoInput = form.querySelector('input[type=file][name=photos]');
    out.photoCount = photoInput && photoInput.files ? photoInput.files.length : 0;
    if (out.photoCount) {
      out.photoNames = Array.prototype.map.call(photoInput.files, function (f) { return f.name; });
    }
    return out;
  }

  function showSuccess() {
    var form = document.getElementById('inspectForm');
    var ok = document.getElementById('inspectSuccess');
    if (form) form.style.display = 'none';
    if (ok) {
      ok.classList.add('visible');
      try { ok.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    }
  }

  function onReady() {
    var utms = readUtms();
    stampHiddenFields(utms);

    var form = document.getElementById('inspectForm');
    if (!form) return;

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = document.getElementById('inspectSubmit');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

      var data = gatherFormData(form);
      // TODO (follow-up): replace this console.log with a real backend
      // call — see header for the pointer to submitPublicLead.
      console.log('[inspect-form] submission', data);

      // Simulate a network round-trip so users perceive action.
      setTimeout(showSuccess, 400);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
