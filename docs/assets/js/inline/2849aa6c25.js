/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: 2849aa6c25.  Do not edit by hand. */
/* ──────────────────────────────────────────────────────────────────────
 * Timberline page — REAL PHOTOS ONLY policy.
 *
 * Each color in the catalog below points to a JPG in
 *   /assets/gaf/timberline/{line}/{id}.jpg
 * and is only rendered if the file exists. Colors without a real GAF
 * stock photo are SILENTLY SKIPPED — no color guesses, no CSS substitute
 * swatches, no placeholder colors.
 *
 * If zero colors have photos for a given line, the section shows a
 * single honest "photos in progress — call Joe to see real samples"
 * empty state. As you drop verified photos into the assets folder,
 * the page populates automatically on next load.
 *
 * Filenames must match the `id` field below — e.g.
 *   /assets/gaf/timberline/hdz/charcoal.jpg
 *   /assets/gaf/timberline/ns/weathered-wood.jpg
 * ──────────────────────────────────────────────────────────────────── */

// Full HDZ catalog (the AI Visualizer uses the same IDs — see VIZ_OPTIONS in /visualizer.html)
const HDZ_COLORS = [
  { id:'charcoal',           name:'Charcoal',            desc:"Most-installed HDZ color overall. Reads modern on brick colonials, hides debris, pairs with white, gray, or blue siding." },
  { id:'pewter-gray',        name:'Pewter Gray',         desc:"Mid-tone gray. Softer than Charcoal — better with darker brick or ranches that have heavy stone trim." },
  { id:'fox-hollow-gray',    name:'Fox Hollow Gray',     desc:"Warmer mid-gray with a subtle brown undertone. Versatile — works with both warm and cool palettes." },
  { id:'oyster-gray',        name:'Oyster Gray',         desc:"Light warm gray. Reads beachy / coastal — good fit for tan, cream, or seafoam siding." },
  { id:'slate',              name:'Slate',               desc:"Cool-leaning gray with a hint of blue. Pairs cleanly with white trim, navy shutters, or red brick." },
  { id:'williamsburg-slate', name:'Williamsburg Slate',  desc:"Deeper blue-gray slate. Pulls warmer brick to a richer color contrast — common pick for traditional Cincinnati colonials." },
  { id:'appalachian-sky',    name:'Appalachian Sky',     desc:"Blue-leaning slate with sky-tone highlights. Distinctive without being loud — great with white or navy trim." },
  { id:'biscayne-blue',      name:'Biscayne Blue',       desc:"Deep navy with a subtle blue cast. Bold but classic — fits coastal-style new builds and modern farmhouses." },
  { id:'nantucket-morning',  name:'Nantucket Morning',   desc:"Lighter slate-blue. Softens darker brick or stonework; reads airy and cottage-style." },
  { id:'weathered-wood',     name:'Weathered Wood',      desc:"Warm brown with charcoal granules mixed in — looks like a real cedar shake roof from the street. Most-popular brown HDZ." },
  { id:'barkwood',           name:'Barkwood',            desc:"Deeper brown. Reads richer than Weathered Wood — pairs with cedar siding, log-home accents, mountain styling." },
  { id:'driftwood',          name:'Driftwood',           desc:"Lighter blended brown / tan. Fits beige-brick ranches and craftsman bungalows; less harsh than Barkwood." },
  { id:'shakewood',          name:'Shakewood',           desc:"Mid-warm brown with strong shake-tone variation. Looks great on traditional 2-story homes with painted siding." },
  { id:'hickory',            name:'Hickory',             desc:"Warm reddish-brown. Pairs with white trim and red or orange brick — Midwest classic." },
  { id:'mission-brown',      name:'Mission Brown',       desc:"Deep, almost-black brown. Anchors tan/beige homes; works on Mediterranean / Spanish-style facades." },
  { id:'birchwood',          name:'Birchwood',           desc:"Light tan with subtle gray streaks. Reads bright and airy — good fit for stucco or light-painted ranches." },
  { id:'hunter-green',       name:'Hunter Green',        desc:"Deep forest green. Bold pick — looks classic on white-sided colonials and country/farmhouse styles." },
  { id:'patriot-red',        name:'Patriot Red',         desc:"Deep brick red. A statement color — historically classic on white-sided New-England-style homes." },
  { id:'sunset-brick',       name:'Sunset Brick',        desc:"Warmer red than Patriot Red — reads more orange. Pairs with tan or terracotta accents." },
  { id:'copper-canyon',      name:'Copper Canyon',       desc:"Burnt-copper / terra-cotta. Fits stucco, Tuscan, or Spanish-style homes well." },
  { id:'golden-harvest',     name:'Golden Harvest',      desc:"Warm gold-tan blend. Distinctive without being loud — pairs with cream or olive siding." },
  { id:'sedona-sunset',      name:'Sedona Sunset',       desc:"Sunset orange-brown blend. Bold Southwestern vibe — works on adobe-style and tan stucco." },
];

const NS_COLOR_IDS   = ['charcoal','pewter-gray','weathered-wood','barkwood','driftwood','shakewood','hickory','mission-brown','slate','williamsburg-slate','hunter-green','patriot-red','sunset-brick','birchwood'];
const UHDZ_COLOR_IDS = ['charcoal','pewter-gray','weathered-wood','barkwood','driftwood','slate','williamsburg-slate','hunter-green','biscayne-blue','shakewood','hickory','birchwood'];

const NS_COLORS   = NS_COLOR_IDS.map(id => HDZ_COLORS.find(c => c.id === id));
const UHDZ_COLORS = UHDZ_COLOR_IDS.map(id => HDZ_COLORS.find(c => c.id === id));

const LINE_LABEL = { ns:'GAF Timberline NS', hdz:'GAF Timberline HDZ', uhdz:'GAF Timberline UHDZ' };

const photoUrl = (line, id) => `/assets/gaf/timberline/${line}/${id}.jpg`;

// Probe an image URL — resolves with the URL if it loads, null if it 404s.
function probeImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload  = () => resolve(url);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// Filter a color list to only those with verified stock photos.
async function withVerifiedPhotos(line, colors) {
  const probed = await Promise.all(colors.map(async col => {
    const url = await probeImage(photoUrl(line, col.id));
    return url ? { ...col, photo: url } : null;
  }));
  return probed.filter(Boolean);
}

// Render the empty state when zero photos are available for a line.
function emptyStateHTML(lineLabel, count) {
  return `<div class="color-empty">
    <div class="icon">📷</div>
    <h4>Stock Photos In Progress</h4>
    <p>I'm building this gallery with the real GAF stock photos for every color — no color-guess substitutes. ${count > 0 ? `Currently showing ${count} of ${lineLabel}'s colors. ` : `${lineLabel} colors are still being added. `}For the full physical sample book, give me a call — I bring it to every estimate.</p>
    <a href="/#contact">Get a free estimate with samples →</a>
  </div>`;
}

// HDZ board — only colors that have photos.
async function renderHDZBoard() {
  const wrap = document.getElementById('hdzBoardWrap');
  const verified = await withVerifiedPhotos('hdz', HDZ_COLORS);
  if (verified.length === 0) {
    wrap.innerHTML = emptyStateHTML(LINE_LABEL.hdz, 0);
    return;
  }
  const board = document.createElement('div');
  board.className = 'color-board';
  board.innerHTML = verified.map(col => `
    <div class="color-tile" data-id="${col.id}" tabindex="0" role="button" aria-label="${col.name}">
      <div class="swatch-img"><img src="${col.photo}" alt="GAF Timberline HDZ ${col.name}" loading="lazy" width="320" height="240"></div>
      <div class="swatch-name">${col.name}</div>
    </div>`).join('');
  wrap.appendChild(board);
  if (verified.length < HDZ_COLORS.length) {
    const note = document.createElement('p');
    note.className = 'sub';
    note.style.marginTop = '14px';
    note.textContent = `Showing ${verified.length} of ${HDZ_COLORS.length} HDZ colors with verified GAF stock photos. The rest are added as I receive the originals — call Joe for the full physical sample book.`;
    wrap.appendChild(note);
  }
  board.addEventListener('click', e => {
    const tile = e.target.closest('.color-tile');
    if (!tile) return;
    openModal('hdz', verified.find(x => x.id === tile.dataset.id));
  });
  board.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      const tile = e.target.closest('.color-tile');
      if (!tile) return;
      e.preventDefault();
      openModal('hdz', verified.find(x => x.id === tile.dataset.id));
    }
  });
}

// Click-through carousel (NS / UHDZ) — only colors with photos.
async function renderCarousel(line, colors, wrapId) {
  const wrap = document.getElementById(wrapId);
  const verified = await withVerifiedPhotos(line, colors);
  if (verified.length === 0) {
    wrap.innerHTML = emptyStateHTML(LINE_LABEL[line], 0);
    return;
  }
  wrap.innerHTML = `
    <div class="carousel">
      <div class="carousel-stage">
        <div class="carousel-image"><img id="${line}ImgEl" src="${verified[0].photo}" alt="${LINE_LABEL[line]} ${verified[0].name}" width="640" height="480"></div>
        <div class="carousel-info">
          <h4 id="${line}Name">${verified[0].name}</h4>
          <div class="meta" id="${line}Meta">${LINE_LABEL[line]} · GAF stock photo</div>
          <p id="${line}Desc">${verified[0].desc}</p>
        </div>
      </div>
      <div class="carousel-controls">
        <span class="carousel-counter" id="${line}Counter">1 / ${verified.length}</span>
        <div class="carousel-btns">
          <button class="carousel-btn" id="${line}Prev" aria-label="Previous color">‹</button>
          <button class="carousel-btn" id="${line}Next" aria-label="Next color">›</button>
        </div>
      </div>
      <div class="carousel-thumbs" id="${line}Thumbs">${verified.map((col, i) => `
        <div class="carousel-thumb${i === 0 ? ' is-active' : ''}" data-i="${i}" title="${col.name}"><img src="${col.photo}" alt="${col.name}" loading="lazy" width="42" height="42"></div>
      `).join('')}</div>
    </div>`;
  if (verified.length < colors.length) {
    const note = document.createElement('p');
    note.className = 'sub';
    note.style.marginTop = '12px';
    note.textContent = `Showing ${verified.length} of ${colors.length} ${LINE_LABEL[line]} colors with verified stock photos. The rest are added as I receive the originals.`;
    wrap.appendChild(note);
  }

  let idx = 0;
  const elImg     = document.getElementById(`${line}ImgEl`);
  const elName    = document.getElementById(`${line}Name`);
  const elDesc    = document.getElementById(`${line}Desc`);
  const elCounter = document.getElementById(`${line}Counter`);
  const elPrev    = document.getElementById(`${line}Prev`);
  const elNext    = document.getElementById(`${line}Next`);
  const elThumbs  = document.getElementById(`${line}Thumbs`);

  function paint() {
    const col = verified[idx];
    elImg.src = col.photo;
    elImg.alt = `${LINE_LABEL[line]} ${col.name}`;
    elName.textContent = col.name;
    elDesc.textContent = col.desc;
    elCounter.textContent = `${idx + 1} / ${verified.length}`;
    elPrev.disabled = idx === 0;
    elNext.disabled = idx === verified.length - 1;
    [...elThumbs.children].forEach((t, i) => t.classList.toggle('is-active', i === idx));
  }
  elPrev.addEventListener('click', () => { if (idx > 0) { idx--; paint(); } });
  elNext.addEventListener('click', () => { if (idx < verified.length - 1) { idx++; paint(); } });
  elThumbs.addEventListener('click', e => {
    const t = e.target.closest('.carousel-thumb');
    if (!t) return;
    idx = parseInt(t.dataset.i, 10);
    paint();
  });
  elImg.parentElement.style.cursor = 'pointer';
  elImg.parentElement.addEventListener('click', () => openModal(line, verified[idx]));
  paint();
}

// Modal
const modal = document.getElementById('colorModal');
const modalImgEl = document.getElementById('modalImgEl');
const modalName = document.getElementById('modalName');
const modalMeta = document.getElementById('modalMeta');
const modalDesc = document.getElementById('modalDesc');
const modalClose = document.getElementById('modalClose');

function openModal(line, col) {
  if (!col || !col.photo) return;
  modalImgEl.src = col.photo;
  modalImgEl.alt = `${LINE_LABEL[line]} ${col.name}`;
  modalName.textContent = col.name;
  modalMeta.textContent = `${LINE_LABEL[line] || ''} · GAF stock photo`;
  modalDesc.textContent = col.desc;
  modal.classList.add('is-open');
  document.body.style.overflow = 'hidden';
}
function closeModal() {
  modal.classList.remove('is-open');
  document.body.style.overflow = '';
}
modalClose.addEventListener('click', closeModal);
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Kick off async renders
renderHDZBoard();
renderCarousel('ns',   NS_COLORS,   'nsCarouselWrap');
renderCarousel('uhdz', UHDZ_COLORS, 'uhdzCarouselWrap');
