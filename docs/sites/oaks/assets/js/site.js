/* ══════════════════════════════════════════════════════════════════════
   OAKS ROOFING & CONSTRUCTION — site behaviour
   ──────────────────────────────────────────────────────────────────────
   No dependencies, no inline handlers (the host site runs a strict CSP with
   script-src-attr 'none', and Oaks' own host may too). Everything below is
   progressive: with JS off you still get the whole site, every phone link,
   and every navigation path — only the drawer, the lightbox and the
   form-to-email convenience need this file.
   ══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ════════════════════════════════════════════════════════════════════
     ▼▼▼  HAND-OFF CONFIG — this is the only block you need to edit.  ▼▼▼

     formEmail    : ACTIVE. Submitting opens the visitor's mail app with every
                    field filled in and addressed here, then they hit send.
                    Needs no account, no server and no signup, and the details
                    never pass through anyone else's system on the way — which
                    is also what privacy.html tells visitors.

     formEndpoint : optional upgrade, and it WINS over formEmail when set. Any
                    URL that accepts a POST works. A relay means the lead
                    arrives even when the visitor has no mail app configured
                    (mostly desktop webmail users). E.g. uncomment:
                      formEndpoint: 'https://formsubmit.co/ajax/scott@oaksroofingandconstruction.com',
                    FormSubmit emails Scott a one-time activation link on the
                    first submission — until he clicks it, nothing is relayed.
                    If you switch to a relay, update the "Third parties"
                    section of privacy.html, which currently states that
                    submissions are not routed through an outside service.

     Set NEITHER and the form stays honest: it validates, then tells the
     visitor to call. It never pretends to have sent something.
     ════════════════════════════════════════════════════════════════════ */
  var CONFIG = {
    formEndpoint: '',
    formEmail: 'scott@oaksroofingandconstruction.com',
    phone: '(513) 827-5297',
    phoneHref: 'tel:+15138275297'
  };
  /* ▲▲▲  END HAND-OFF CONFIG  ▲▲▲ */

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ── Announcement bar ────────────────────────────────────────────── */
  function initBanner() {
    var bar = $('.orc-banner');
    var btn = $('.orc-banner-close');
    if (!bar || !btn) return;
    try {
      if (sessionStorage.getItem('orcBannerClosed') === '1') { bar.hidden = true; return; }
    } catch (e) { /* private mode — just show it */ }
    btn.addEventListener('click', function () {
      bar.hidden = true;
      try { sessionStorage.setItem('orcBannerClosed', '1'); } catch (e) {}
    });
  }

  /* ── Mobile drawer ───────────────────────────────────────────────── */
  function initNav() {
    var burger = $('.orc-burger');
    var drawer = $('.orc-mobile');
    if (!burger || !drawer) return;
    burger.addEventListener('click', function () {
      var open = drawer.classList.toggle('is-open');
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // Any drawer link closes it; keeps in-page anchors from leaving it open.
    drawer.addEventListener('click', function (ev) {
      if (ev.target.closest('a')) {
        drawer.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && drawer.classList.contains('is-open')) {
        drawer.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
        burger.focus();
      }
    });
  }

  /* ── "Select Service" jump menu on the service pages ─────────────── */
  function initServiceSelect() {
    $$('[data-orc-jump]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        if (sel.value) window.location.href = sel.value;
      });
    });
  }

  /* ── Service-area "Load More" ────────────────────────────────────── */
  function initAreas() {
    var btn = $('[data-orc-more]');
    if (!btn) return;
    var list = document.getElementById(btn.getAttribute('data-orc-more'));
    if (!list) return;
    btn.addEventListener('click', function () {
      $$('li[hidden]', list).forEach(function (li) { li.hidden = false; });
      btn.parentNode.removeChild(btn);
    });
  }

  /* ── Gallery lightbox ────────────────────────────────────────────── */
  function initGallery() {
    var grid = $('.orc-gallery');
    var box = $('.orc-lightbox');
    if (!grid || !box) return;

    var items = $$('button', grid).map(function (b) {
      return { full: b.getAttribute('data-full'), alt: b.getAttribute('data-alt') || '' };
    });
    var img = $('img', box);
    var count = $('.orc-lightbox-count', box);
    var at = 0;
    var lastFocus = null;

    function show(i) {
      at = (i + items.length) % items.length;
      img.src = items[at].full;
      img.alt = items[at].alt;
      if (count) count.textContent = (at + 1) + ' / ' + items.length;
    }
    // The dialog claims aria-modal="true", so the rest of the page must actually
    // be inert while it is open — otherwise Tab walks focus onto content sitting
    // behind an opaque overlay, invisible but still reachable. inert is the modern
    // answer; aria-hidden covers browsers that do not support it yet.
    // NEVER inert an element that CONTAINS the dialog. The first version of this
    // filtered on `el !== box`, which is only correct while the dialog is a direct
    // child of <body>. It was not — it sat inside <main>, so <main> got inert and
    // took the dialog's own Close/Prev/Next with it. The buttons were dead in
    // production and only Escape still worked. `contains()` is true for the
    // element itself too, so this covers both cases.
    var siblings = Array.prototype.filter.call(document.body.children, function (el) {
      return !el.contains(box);
    });
    function setBackground(inert) {
      siblings.forEach(function (el) {
        if (inert) { el.setAttribute('inert', ''); el.setAttribute('aria-hidden', 'true'); }
        else { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
      });
    }
    function open(i) {
      lastFocus = document.activeElement;
      show(i);
      box.hidden = false;
      document.body.style.overflow = 'hidden';
      setBackground(true);
      var close = $('.orc-lightbox-close', box);
      if (close) close.focus();
    }
    function close() {
      box.hidden = true;
      document.body.style.overflow = '';
      setBackground(false);
      if (lastFocus) lastFocus.focus();
    }

    // Keep Tab inside the dialog for browsers without inert.
    box.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Tab') return;
      var f = $$('button, [href], img[tabindex]', box).filter(function (el) { return el.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    });

    grid.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button');
      if (!btn) return;
      open($$('button', grid).indexOf(btn));
    });
    box.addEventListener('click', function (ev) {
      if (ev.target === box) return close();
      if (ev.target.closest('.orc-lightbox-close')) return close();
      if (ev.target.closest('.orc-lightbox-prev')) return show(at - 1);
      if (ev.target.closest('.orc-lightbox-next')) return show(at + 1);
    });
    document.addEventListener('keydown', function (ev) {
      if (box.hidden) return;
      if (ev.key === 'Escape') close();
      else if (ev.key === 'ArrowLeft') show(at - 1);
      else if (ev.key === 'ArrowRight') show(at + 1);
    });
  }

  /* ── Quote form ──────────────────────────────────────────────────── */
  function initForms() {
    $$('form[data-orc-form]').forEach(function (form) {
      var msg = $('.orc-form-msg', form);
      var submit = $('[type="submit"]', form);

      function say(kind, text) {
        if (!msg) return;
        msg.className = 'orc-form-msg ' + kind;
        msg.textContent = text;
        msg.scrollIntoView({ block: 'nearest' });
      }

      form.addEventListener('submit', function (ev) {
        ev.preventDefault();

        // Honeypot: real people never fill a field they cannot see.
        var hp = form.querySelector('.orc-hp input');
        if (hp && hp.value) return;

        if (!form.checkValidity()) { form.reportValidity(); return; }

        var data = {};
        new FormData(form).forEach(function (v, k) { if (k !== 'company_website') data[k] = v; });

        if (CONFIG.formEndpoint) {
          if (submit) { submit.disabled = true; }
          say('ok', 'Sending…');
          fetch(CONFIG.formEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(data)
          }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            form.reset();
            say('ok', 'Thanks — your request is in. We will get back to you shortly.');
          }).catch(function () {
            say('err', 'That did not go through. Please call ' + CONFIG.phone + ' and we will take care of you.');
          }).then(function () {
            if (submit) { submit.disabled = false; }
          });
          return;
        }

        if (CONFIG.formEmail) {
          var name = [data.first_name, data.last_name].filter(Boolean).join(' ');
          var LABELS = [
            ['phone', 'Phone'], ['email', 'Email'], ['zip', 'ZIP'],
            ['service', 'Service'], ['message', 'Message'],
          ];
          var lines = (name ? ['Name: ' + name] : []).concat(
            LABELS.filter(function (p) { return data[p[0]]; })
              .map(function (p) { return p[1] + ': ' + data[p[0]]; })
          );
          window.location.href = 'mailto:' + CONFIG.formEmail
            + '?subject=' + encodeURIComponent(
              (data.service || 'Quote request') + (name ? ' — ' + name : '') + ' (website)')
            + '&body=' + encodeURIComponent(lines.join('\n') + '\n\n— Sent from the website quote form.');
          say('ok', 'Opening your email app so you can send this through — press send and it comes straight to us. If nothing opens, call ' + CONFIG.phone + '.');
          return;
        }

        say('err', 'The online form is not connected yet — please call ' + CONFIG.phone + '. Sorry for the extra step.');
      });
    });
  }

  /* ── Footer year ─────────────────────────────────────────────────── */
  function initYear() {
    $$('[data-orc-year]').forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
  }

  function boot() {
    initBanner();
    initNav();
    initServiceSelect();
    initAreas();
    initGallery();
    initForms();
    initYear();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
