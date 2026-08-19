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

     formEndpoint : where the quote form POSTs. Leave '' until a backend
                    exists. Any endpoint that accepts a POST works, e.g.
                    'https://formsubmit.co/ajax/you@oaksroofing.com'.
     formEmail    : fallback inbox. With no endpoint set, submitting opens
                    the visitor's mail app with every field filled in and
                    addressed here, so the form still does its job on a
                    plain static host.

     Set NEITHER and the form stays honest: it validates, then tells the
     visitor to call. It never pretends to have sent something.
     ════════════════════════════════════════════════════════════════════ */
  var CONFIG = {
    formEndpoint: '',
    formEmail: '',
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
    function open(i) {
      lastFocus = document.activeElement;
      show(i);
      box.hidden = false;
      document.body.style.overflow = 'hidden';
      var close = $('.orc-lightbox-close', box);
      if (close) close.focus();
    }
    function close() {
      box.hidden = true;
      document.body.style.overflow = '';
      if (lastFocus) lastFocus.focus();
    }

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
          var order = ['first_name', 'last_name', 'email', 'phone', 'zip', 'service', 'message'];
          var lines = order.filter(function (k) { return data[k]; })
            .map(function (k) { return k.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) + ': ' + data[k]; });
          window.location.href = 'mailto:' + CONFIG.formEmail
            + '?subject=' + encodeURIComponent('Website quote request — ' + (data.service || 'General'))
            + '&body=' + encodeURIComponent(lines.join('\n'));
          say('ok', 'Opening your email app so you can send this through. If nothing happens, call ' + CONFIG.phone + '.');
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
