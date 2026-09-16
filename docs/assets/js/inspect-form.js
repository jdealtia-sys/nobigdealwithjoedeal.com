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
 *  - Name, address and a 10-digit US mobile number are checked BEFORE the
 *    request (2026-09-13). The form is `novalidate` and this file used to post
 *    blind, so a missing phone reached the gateway, which answers a bare 400
 *    "Invalid submission" and keeps nothing — the homeowner saw that string
 *    with no hint which field was wrong, and the lead was gone. The phone rule
 *    is the one every public form now shares (tests/lead-form-phone-contract):
 *    digits only, a leading country-code 1 dropped, exactly 10 left.
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
    // Send as a string: the server's optional-field allowlist drops any
    // value that isn't a string (typeof !== 'string' → skipped), so a
    // numeric photoCount would silently never persist on the lead.
    var photoFiles = photoInput && photoInput.files ? photoInput.files.length : 0;
    out.photoCount = String(photoFiles);
    if (photoFiles) {
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

  // Shared public-form phone rule — keep byte-identical across the forms that
  // carry it (tests/lead-form-phone-contract.test.js pins the expression).
  function isUsPhone(v) {
    return String(v == null ? '' : v).replace(/\D/g, '').replace(/^1/, '').length === 10;
  }

  // Returns [] when the form can be sent, else the invalid inputs in order.
  function invalidFields() {
    var checks = [
      ['f-name', function (v) { return v.trim().length > 0; }],
      ['f-address', function (v) { return v.trim().length > 0; }],
      ['f-phone', isUsPhone]
    ];
    var bad = [];
    checks.forEach(function (c) {
      var el = document.getElementById(c[0]);
      if (!el) return;
      var good = c[1](el.value || '');
      el.setAttribute('aria-invalid', good ? 'false' : 'true');
      if (!good) bad.push(el);
    });
    return bad;
  }

  function invalidMessage(bad) {
    var ids = bad.map(function (el) { return el.id; });
    if (ids.length === 1 && ids[0] === 'f-phone') {
      return 'Please add a 10-digit mobile number (area code included) so Joe can reach you.';
    }
    return 'Please add your name, the property address and a 10-digit mobile number so Joe can reach you.';
  }

  // photoCount is a string (see gatherFormData) — '0' when no file was
  // chosen, so this form never silently implies the rep already has photos
  // that were, in fact, dropped on the floor (the file input's bytes are
  // never sent — only its filenames/count, as photoNames/photoCount text
  // fields; see gatherFormData's own comment).
  function showSuccess(photoCount) {
    var form = document.getElementById('inspectForm');
    var ok = document.getElementById('inspectSuccess');
    var note = document.getElementById('inspectPhotoNote');
    if (form) form.style.display = 'none';
    if (note) note.hidden = !(Number(photoCount) > 0);
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

      var bad = invalidFields();
      if (bad.length) {
        showError(btn, invalidMessage(bad));
        try { bad[0].focus(); } catch (e) {}
        return;
      }
      var prior = document.getElementById('inspectFormError');
      if (prior) prior.remove();

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
          showSuccess(data.photoCount);
        } else {
          // The gateway client returns the server's message as `res.reason`
          // (not `res.error`), so the real rejection text was never surfaced —
          // read reason first, fall back to error for safety.
          var msg = (res && (res.reason || res.error)) ? String(res.reason || res.error) : '';
          console.warn('[inspect-form] submission rejected', res);
          // The gateway's per-field 400 is deliberately opaque; say what to check.
          if (/^invalid submission$/i.test(msg)) {
            msg = 'Something in the form did not go through. Check your name, address and 10-digit mobile number, or call or text Joe at (859) 420-7382.';
          }
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
