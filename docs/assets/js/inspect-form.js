/**
 * inspect-form.js — /inspect lead-capture form handler.
 *
 * Behavior:
 *  - On load, read utm_source / utm_medium / utm_campaign from the URL
 *    and stamp them into the matching hidden form fields. This is the
 *    print-tracking pipeline: QR codes encode the UTM params and they
 *    flow into the submission so we know which piece (yard sign vs.
 *    door hanger vs. card-front) drove the lead.
 *  - On submit, prevent default, gather all fields, POST via
 *    window.submitPublicLead('inspect', payload), and swap the form for
 *    a success message. On error, re-enable the button and show an
 *    inline alert so the user can retry or call Joe directly.
 *  - photoNames is sent as a comma-joined string (the server allowlist
 *    treats it as a single string field with maxLen 2000).
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
      // Server allowlist treats photoNames as a single string field —
      // join (and cap to the 2000-char maxLen with some margin).
      out.photoNames = Array.prototype.map
        .call(photoInput.files, function (f) { return f.name; })
        .join(', ')
        .slice(0, 1900);
    }
    out.source = '/inspect';
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

  function showError(btn, msg) {
    if (btn) { btn.disabled = false; btn.textContent = 'Request Free Inspection'; }
    var form = document.getElementById('inspectForm');
    if (!form) return;
    var existing = document.getElementById('inspectFormError');
    if (existing) existing.remove();
    var p = document.createElement('p');
    p.id = 'inspectFormError';
    p.setAttribute('role', 'alert');
    p.style.cssText = 'margin-top:12px;padding:12px 14px;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.35);border-radius:8px;color:#7f1d1d;font-size:.9rem;line-height:1.4';
    p.textContent = msg || 'Something went wrong. Please call or text Joe at (859) 420-7382.';
    form.appendChild(p);
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

      if (typeof window.submitPublicLead !== 'function') {
        // public-lead-submit.js failed to load — fail loud so we can
        // tell from logs, but still surface a user-actionable message.
        console.error('[inspect-form] window.submitPublicLead unavailable');
        showError(btn);
        return;
      }

      window.submitPublicLead('inspect', data).then(function (res) {
        if (res && res.ok) {
          showSuccess();
        } else {
          var msg = (res && res.error) ? String(res.error) : '';
          console.warn('[inspect-form] submission rejected', res);
          showError(btn, msg && /[a-z]/i.test(msg) ? msg : null);
        }
      }).catch(function (err) {
        console.error('[inspect-form] submission failed', err);
        showError(btn);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
