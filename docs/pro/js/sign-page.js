/**
 * sign-page.js — public remote-signing page logic (Signatures PR4)
 *
 * Drives /pro/sign.html. No Firebase auth — the only credential is the
 * ?token= in the URL, validated server-side by the getSignDocument /
 * submitSignature Cloud Functions (functions/remote-signing.js).
 *
 * Flow:
 *   1. read token from the query string
 *   2. POST getSignDocument({token}) → the interactive doc HTML
 *   3. srcdoc it into the sandboxed iframe (the doc loads signature-
 *      widget.js itself, via the generator's _injectSignatureAssets)
 *   4. on Submit, postMessage {__nbd_sig:'finalize'} to the iframe →
 *      it bakes the canvases into <img> PNGs and returns the signed HTML
 *   5. POST submitSignature({token, signedHtml}) → done (token burned)
 */
(function () {
  'use strict';

  var FN_BASE = 'https://us-central1-nobigdeal-pro.cloudfunctions.net';
  var token = new URLSearchParams(location.search).get('token') || '';

  var frame = document.getElementById('spFrame');
  var foot = document.getElementById('spFoot');
  var submitBtn = document.getElementById('spSubmit');
  var docName = document.getElementById('spDocName');

  function msg(icon, title, body) {
    document.getElementById('spMsg').style.display = 'flex';
    document.getElementById('spMsgIcon').innerHTML = icon;
    document.getElementById('spMsgTitle').textContent = title;
    document.getElementById('spMsgBody').textContent = body;
  }
  function hideMsg() { document.getElementById('spMsg').style.display = 'none'; }

  async function post(path, body) {
    var res = await fetch(FN_BASE + '/' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = null;
    try { data = await res.json(); } catch (_) {}
    return { ok: res.ok, status: res.status, data: data || {} };
  }

  // ── Load the document ────────────────────────────────────────────
  async function load() {
    if (!token || token.length < 10) {
      msg('⚠️', 'Invalid link', 'This signing link looks incomplete. Please use the button in your email.');
      return;
    }
    var r;
    try { r = await post('getSignDocument', { token: token }); }
    catch (e) { msg('📡', 'Connection problem', 'Could not reach the server. Check your connection and reload.'); return; }

    if (!r.ok) {
      if (r.status === 410) msg('✅', 'Already signed', (r.data.error || 'This document has already been signed — nothing more to do.'));
      else if (r.status === 404) msg('🔗', 'Invalid link', (r.data.error || 'This signing link is not valid.'));
      else if (r.status === 429) msg('⏳', 'Too many tries', 'Please wait a minute and reload.');
      else msg('⚠️', 'Could not load', (r.data.error || 'Something went wrong. Try again shortly.'));
      return;
    }

    if (docName) docName.textContent = r.data.docTypeName ? '· ' + r.data.docTypeName : '';
    frame.srcdoc = r.data.html || '';
    frame.style.display = 'block';
    frame.addEventListener('load', function () {
      hideMsg();
      foot.style.display = 'flex';
    }, { once: true });
  }

  // ── Finalize bridge (parent ↔ sandboxed widget) ──────────────────
  var pendingResolve = null;
  window.addEventListener('message', function (e) {
    if (!e.data || typeof e.data !== 'object' || e.data.__nbd_sig !== 'finalized') return;
    if (!pendingResolve) return;
    var r = pendingResolve; pendingResolve = null; r(e.data);
  });

  function finalize() {
    return new Promise(function (resolve) {
      pendingResolve = resolve;
      var t = setTimeout(function () {
        if (pendingResolve === resolve) { pendingResolve = null; resolve({ ok: false, timedOut: true }); }
      }, 4000);
      var wrapped = resolve;
      pendingResolve = function (p) { clearTimeout(t); wrapped(p); };
      try { frame.contentWindow.postMessage({ __nbd_sig: 'finalize' }, '*'); }
      catch (err) { clearTimeout(t); pendingResolve = null; resolve({ ok: false, error: err }); }
    });
  }

  // ── Submit ───────────────────────────────────────────────────────
  async function submit() {
    submitBtn.disabled = true;
    var orig = submitBtn.textContent;
    submitBtn.innerHTML = '<span class="spin"></span> Finalizing…';

    var fin = await finalize();
    if (!fin || !fin.ok) {
      submitBtn.disabled = false; submitBtn.textContent = orig;
      if (fin && Array.isArray(fin.missing) && fin.missing.length) {
        alert('Please add your signature before submitting.');
      } else if (fin && fin.timedOut) {
        alert('The document is still loading — give it a second and try again.');
      } else {
        alert('Could not capture the signature. Please try again.');
      }
      return;
    }

    submitBtn.innerHTML = '<span class="spin"></span> Submitting…';
    var r;
    try { r = await post('submitSignature', { token: token, signedHtml: fin.html }); }
    catch (e) { submitBtn.disabled = false; submitBtn.textContent = orig; alert('Connection problem — please try again.'); return; }

    if (r.ok && r.data.ok) {
      frame.style.display = 'none';
      foot.style.display = 'none';
      msg('🎉', 'All done — thank you!', 'Your signature has been recorded and sent to your rep. You can close this page.');
    } else {
      submitBtn.disabled = false; submitBtn.textContent = orig;
      if (r.status === 409 || r.status === 410) {
        msg('✅', 'Already signed', (r.data.error || 'This document was already signed.'));
        foot.style.display = 'none';
      } else {
        alert(r.data.error || 'Could not submit. Please try again.');
      }
    }
  }

  submitBtn.addEventListener('click', submit);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
