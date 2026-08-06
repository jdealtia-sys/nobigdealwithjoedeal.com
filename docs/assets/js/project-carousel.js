/**
 * project-carousel.js — shared click-through photo carousel.
 *
 * Lifted from the GAF Timberline color carousel (assets/js/inline/2849aa6c25.js
 * renderCarousel) with the element-ID scheme replaced by class scoping so
 * multiple instances can mount independently. The Timberline page keeps its
 * own copy for now (its IDs are load-bearing for the HDZ board); the class
 * names here match its CSS on purpose so a future swap is mechanical.
 *
 * API:  window.NBDCarousel.mount(container, items)
 *   container — element to render into (content is replaced)
 *   items     — [{ src, alt, title, meta, desc }]  (strings; rendered via
 *               textContent — never markup)
 *
 * The build script guarantees every src exists on disk, so there is no
 * runtime probeImage pass here.
 */
(function () {
  'use strict';

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function mount(container, items) {
    container.textContent = '';
    if (!Array.isArray(items) || !items.length) return;

    const root = el('div', 'carousel');
    const stage = el('div', 'carousel-stage');

    const imgWrap = el('div', 'carousel-image');
    const img = document.createElement('img');
    img.width = 800; img.height = 600;
    img.decoding = 'async';
    imgWrap.appendChild(img);

    const info = el('div', 'carousel-info');
    const name = el('h4');
    const meta = el('div', 'meta');
    const desc = el('p');
    info.append(name, meta, desc);
    stage.append(imgWrap, info);

    const controls = el('div', 'carousel-controls');
    const counter = el('span', 'carousel-counter');
    const btns = el('div', 'carousel-btns');
    const prev = el('button', 'carousel-btn', '‹');
    prev.type = 'button'; prev.setAttribute('aria-label', 'Previous photo');
    const next = el('button', 'carousel-btn', '›');
    next.type = 'button'; next.setAttribute('aria-label', 'Next photo');
    btns.append(prev, next);
    controls.append(counter, btns);

    const thumbs = el('div', 'carousel-thumbs');
    items.forEach(function (it, i) {
      const t = el('div', 'carousel-thumb' + (i === 0 ? ' is-active' : ''));
      t.dataset.i = String(i);
      if (it.title) t.title = it.title;
      const ti = document.createElement('img');
      ti.src = it.src; ti.alt = it.alt || ''; ti.loading = 'lazy';
      ti.width = 42; ti.height = 42;
      t.appendChild(ti);
      thumbs.appendChild(t);
    });

    root.append(stage, controls);
    if (items.length > 1) root.appendChild(thumbs);
    container.appendChild(root);

    let idx = 0;
    function paint() {
      const it = items[idx];
      img.src = it.src;
      img.alt = it.alt || '';
      name.textContent = it.title || '';
      meta.textContent = it.meta || '';
      desc.textContent = it.desc || '';
      counter.textContent = (idx + 1) + ' / ' + items.length;
      prev.disabled = idx === 0;
      next.disabled = idx === items.length - 1;
      Array.prototype.forEach.call(thumbs.children, function (t, i) {
        t.classList.toggle('is-active', i === idx);
      });
    }
    prev.addEventListener('click', function () { if (idx > 0) { idx--; paint(); } });
    next.addEventListener('click', function () { if (idx < items.length - 1) { idx++; paint(); } });
    thumbs.addEventListener('click', function (e) {
      const t = e.target.closest('.carousel-thumb');
      if (!t) return;
      idx = parseInt(t.dataset.i, 10) || 0;
      paint();
    });
    paint();
  }

  window.NBDCarousel = { __sentinel: 'nbd-project-carousel-v1', mount: mount };
})();
