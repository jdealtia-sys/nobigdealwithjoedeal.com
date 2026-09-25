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

  // sign.html now loads js/toast.js before this file, so showToast exists.
  // These are recoverable validation errors — the signer stays on the page
  // and the submit button is re-enabled — so a toast is right. Terminal
  // states still take over the whole panel via msg() below.
  function _spNotify(text, kind) {
    if (typeof window.showToast === 'function') { window.showToast(text, kind || 'info'); return; }
    if (kind === 'error') console.error('[sign]', text); else console.log('[sign]', text);
  }

  // Localhost-only emulator switch (same Audit #3 rule as
  // nbd-emulator-connect.js): the rep-side pages already point their SDK at
  // the emulators when served from localhost, but the public token pages
  // hardcoded prod — leaving the homeowner surface untestable in the
  // hermetic e2e harness. Any hostname other than localhost/127.0.0.1
  // keeps prod.
  var FN_BASE = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
    ? 'http://127.0.0.1:5001/nobigdeal-pro/us-central1'
    : 'https://us-central1-nobigdeal-pro.cloudfunctions.net';
  var token = new URLSearchParams(location.search).get('token') || '';

  var frame = document.getElementById('spFrame');
  var foot = document.getElementById('spFoot');
  var submitBtn = document.getElementById('spSubmit');
  var docName = document.getElementById('spDocName');

  // ── Phone reading layout (2026-09-25, phone audit homeowner#2) ───
  // The document arrives exactly as the rep generated it: a US-letter page
  // laid out in inches — 0.5in page padding, 0.18in section padding plus a
  // 4px rule, 10px body and 9px clause text — under a 66px blank band that
  // only exists to clear the legacy popup's fixed action bar (a stored
  // document never carries that bar). On a 412px phone that measured as a
  // 277px column (225px at 360) of 9px Georgia, the 3-day cancellation
  // notice included. Pinch-zoom works, but at 2x every line needs a pan.
  //
  // WHY HERE and not in document-generator.js's shared CSS: the generated
  // HTML is the legal record. It is stored, printed by Chromium, and turned
  // into a PDF by the doc viewer's html2pdf path — which renders the
  // document's own <style> blocks inside the PARENT page, so a max-width rule
  // living in the document would match the rep's phone and reflow the
  // downloaded PDF. The phone layout therefore never enters the document:
  // it is added to the copy this page shows, and taken back out of what the
  // widget returns before submitSignature sees it (stripPhoneLayout below).
  // The signed record is the document the rep sent plus the signature —
  // the same bytes a desktop signer produces. @media screen also keeps it
  // out of any print of the live page.
  var PHONE_STYLE_ID = 'nbd-sign-phone';
  var PHONE_CSS = [
    '@media screen and (max-width:600px){',
    'html,body{background:#fff;}',
    '.document-container{margin:0!important;padding:16px 16px 0!important;max-width:none;min-height:0;box-shadow:none;}',
    '.document-header{margin:-16px -16px 20px!important;padding:20px 16px 16px!important;}',
    '.header-top{flex-wrap:wrap;gap:10px;}',
    '.header-info{font-size:13px!important;text-align:left!important;}',
    '.header-company-name{font-size:20px!important;}',
    '.header-tagline{font-size:14px!important;}',
    '.header-contact-row{font-size:13px!important;}',
    '.document-title{font-size:24px!important;letter-spacing:1px!important;}',
    '.document-subtitle{font-size:14px!important;}',
    '.document-content{font-size:16px!important;line-height:1.6!important;}',
    // The templates hard-code their small print as inline styles (the
    // contract's clause blocks are style="…font-size: 9px;"), which only an
    // !important rule can outrank. Matched by value so a deliberately LARGER
    // inline size is left alone.
    '.document-container [style*="font-size: 8px"],.document-container [style*="font-size:8px"],',
    '.document-container [style*="font-size: 9px"],.document-container [style*="font-size:9px"],',
    '.document-container [style*="font-size: 10px"],.document-container [style*="font-size:10px"],',
    '.document-container [style*="font-size: 10.5px"],.document-container [style*="font-size:10.5px"],',
    '.document-container [style*="font-size: 11px"],.document-container [style*="font-size:11px"]{font-size:inherit!important;}',
    // Line-item tables: 13px keeps a five-column scope table (with money
    // like $15,520.00, which must never break mid-figure) inside a 360px
    // column; display:block + overflow-x is the net for a wider one, so it
    // scrolls inside its section instead of spilling past the page edge.
    '.document-container table,.document-container table[style]{font-size:13px!important;display:block;max-width:100%;overflow-x:auto;}',
    '.document-container th,.document-container td{padding:5px 4px!important;}',
    '.section{padding:12px 12px 12px 14px;margin-bottom:18px;border-left-width:3px;}',
    '.section-title{font-size:15px!important;letter-spacing:.06em!important;}',
    '.summary-text,.scope-list,.warranty-details{font-size:16px!important;}',
    '.warranty-badge{font-size:15px!important;padding:10px 14px!important;}',
    '.signature-block,.sig-label,.nbd-sig-label,.nbd-sig-print-name,.nbd-sig-date{font-size:14px!important;}',
    '.photo-grid.three-col{grid-template-columns:repeat(2,1fr);}',
    '.affiliate-name{font-size:13px!important;}',
    '.affiliate-num,.affiliate-badge-num{font-size:12px!important;}',
    '.document-footer{margin:24px -16px 0!important;padding:18px 16px!important;font-size:13px!important;}',
    '.document-footer .footer-brand{font-size:13px!important;}',
    '.footer-credit{font-size:12px!important;}',
    '}',
  ].join('');
  var PHONE_STYLE = '<style id="' + PHONE_STYLE_ID + '">' + PHONE_CSS + '</style>';

  // Last thing in <head>, so it wins the cascade against the document's own
  // rules. A document with no </head> is shown exactly as served: prepending
  // a <style> before its doctype would drop it into quirks mode.
  function withPhoneLayout(html) {
    if (typeof html !== 'string') return html;
    var at = html.search(/<\/head>/i);
    if (at < 0) return html;
    return html.slice(0, at) + PHONE_STYLE + html.slice(at);
  }

  // The widget serialises documentElement.outerHTML, which writes our
  // <style> back out verbatim; remove exactly that element so the submitted
  // record carries no trace of the phone layout.
  function stripPhoneLayout(html) {
    if (typeof html !== 'string') return html;
    return html.split(PHONE_STYLE).join('');
  }

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
    // White-label (2026-07-19): tenant signing sessions brand the chrome with
    // the tenant's name (server-resolved, '' for NBD -> literals untouched).
    if (r.data.companyName) {
      var brandEl = document.getElementById('spBrand');
      if (brandEl) brandEl.textContent = r.data.companyName;
      try { document.title = 'Review & Sign · ' + r.data.companyName; } catch (e) {}
    }
    frame.srcdoc = withPhoneLayout(r.data.html || '');
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
        _spNotify('Add your signature before submitting.', 'warning');
      } else if (fin && fin.noFields) {
        // This document carries no signature field at all. Saying "try
        // again" would loop the signer forever on something that cannot
        // succeed — tell them the truth and send them back to the rep.
        msg('⚠️', 'This document can’t be signed',
          'It was sent without a signature field. Please contact your rep for a corrected copy — nothing you do here will work.');
        foot.style.display = 'none';
      } else if (fin && fin.noSignature) {
        _spNotify('Draw your signature in the box before submitting.', 'warning');
      } else if (fin && fin.timedOut) {
        _spNotify('The document is still loading — give it a second and try again.', 'warning');
      } else {
        _spNotify('Could not capture the signature. Please try again.', 'error');
      }
      return;
    }

    submitBtn.innerHTML = '<span class="spin"></span> Submitting…';
    var r;
    try { r = await post('submitSignature', { token: token, signedHtml: stripPhoneLayout(fin.html) }); }
    catch (e) { submitBtn.disabled = false; submitBtn.textContent = orig; _spNotify('Connection problem — please try again.', 'error'); return; }

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
        _spNotify(r.data.error || 'Could not submit. Please try again.', 'error');
      }
    }
  }

  submitBtn.addEventListener('click', submit);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
