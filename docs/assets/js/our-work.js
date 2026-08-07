/**
 * our-work.js — Featured Projects page behavior.
 *
 * 1. Category filter toggling (ports the retired inline filter file).
 * 2. Card → lightbox: each generated card carries a data-project JSON
 *    payload (display fields only); clicking "View photos" (or the card
 *    image) opens the modal and mounts the shared NBDCarousel.
 *
 * The static HTML is the source of truth — this file never renders into
 * the grid, fetches nothing, and with JS disabled the gallery remains a
 * fully readable crawlable page (filters and lightbox simply inert).
 * All payload strings are rendered via textContent (never markup).
 */
(function () {
  'use strict';

  // ── Filters ───────────────────────────────────────────────────
  const filters = document.querySelector('.filters');
  if (filters) {
    filters.addEventListener('click', function (e) {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      filters.querySelectorAll('.filter-btn').forEach(function (b) {
        b.classList.toggle('active', b === btn);
      });
      const cat = btn.dataset.cat;
      document.querySelectorAll('.project').forEach(function (p) {
        p.classList.toggle('hidden', cat !== 'all' && p.dataset.cat !== cat);
      });
    });
  }

  // ── Lightbox ──────────────────────────────────────────────────
  const modal = document.getElementById('projectModal');
  const wrap = document.getElementById('pmCarouselWrap');
  const titleEl = document.getElementById('pmTitle');
  const closeBtn = document.getElementById('pmClose');
  if (!modal || !wrap || !closeBtn || !window.NBDCarousel) return;

  let lastFocus = null;

  function close() {
    modal.classList.remove('is-open');
    modal.hidden = true;
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    lastFocus = null;
  }

  function onKey(e) {
    if (e.key === 'Escape') { close(); return; }
    // Focus trap (a11y 2026-08-07): Tab used to walk out of the modal into
    // the inert page behind it. Cycle within the dialog's focusables.
    if (e.key !== 'Tab') return;
    const focusables = modal.querySelectorAll(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    } else if (!modal.contains(document.activeElement)) {
      e.preventDefault(); first.focus();
    }
  }

  function open(project, trigger) {
    const metaBits = [project.tag, project.city, project.year].filter(Boolean).join(' · ');
    const items = (project.photos || []).map(function (ph) {
      return {
        src: ph.src,
        alt: ph.alt || '',
        // The panel heading is the price range — the honest-number headline.
        // Unpriced projects leave it empty; tag/city/year already sit in meta.
        title: project.price || '',
        meta: metaBits,
        desc: project.description || '',
      };
    });
    if (!items.length) return;
    titleEl.textContent = project.title || '';
    window.NBDCarousel.mount(wrap, items);
    lastFocus = trigger || document.activeElement;
    modal.hidden = false;
    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    closeBtn.focus();
  }

  document.addEventListener('click', function (e) {
    const trigger = e.target.closest('.project-view, .project-img');
    if (trigger) {
      const card = trigger.closest('.project');
      if (!card || !card.dataset.project) return;
      let payload;
      try { payload = JSON.parse(card.dataset.project); } catch (_) { return; }
      open(payload, trigger);
      return;
    }
    if (e.target === modal || e.target.closest('#pmClose')) close();
  });
})();
