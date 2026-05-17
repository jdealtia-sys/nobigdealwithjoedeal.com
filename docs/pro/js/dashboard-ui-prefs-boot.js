// ── Professional Mode (DE-MOJI) — early boot ──
// Set the body class BEFORE paint so emojis never flash then disappear.
// The toggle function is also defined here so it's available to the
// Settings checkbox before any deferred scripts load.
(function() {
  if (localStorage.getItem('nbd_professional_mode') === '1') {
    document.body.classList.add('professional-mode');
  }
})();
// ── Site-wide sizing system ──
// 4 presets that scale --nbd-scale on :root, which every
// padding/font/gap rule multiplies against. The CSS uses
// calc() with the scale variable so one change ripples everywhere.
//
// data-nbd-scale-cards="true" tells card-font-size CSS rules to
// multiply by --nbd-scale. Default size leaves it absent (cards
// use their density-token sizes verbatim, scale=1.0 is implicit).
const NBD_SIZE_SCALES = { compact: 0.85, default: 1.0, comfortable: 1.12, large: 1.25 };
function _nbdApplyScaleAttrs(size, scale) {
  document.documentElement.style.setProperty('--nbd-scale', scale);
  document.body.dataset.nbdSize = size;
  if (size === 'default') document.documentElement.removeAttribute('data-nbd-scale-cards');
  else document.documentElement.setAttribute('data-nbd-scale-cards', 'true');
}
(function() {
  var saved = localStorage.getItem('nbd_ui_size') || 'default';
  var scale = NBD_SIZE_SCALES[saved] || 1.0;
  _nbdApplyScaleAttrs(saved, scale);
})();
function nbdSetSize(size) {
  var scale = NBD_SIZE_SCALES[size] || 1.0;
  _nbdApplyScaleAttrs(size, scale);
  localStorage.setItem('nbd_ui_size', size);
  // Highlight active button
  document.querySelectorAll('.nbd-size-btn').forEach(function(b) {
    var active = b.dataset.size === size;
    b.style.borderColor = active ? 'var(--orange)' : '';
    b.style.color = active ? 'var(--orange)' : '';
    b.style.background = active ? 'color-mix(in srgb, var(--orange) 8%, transparent)' : '';
  });
  if (typeof showToast === 'function') showToast('UI size: ' + size, 'info');
}
// Sync size buttons on settings open
document.addEventListener('DOMContentLoaded', function() {
  var saved = localStorage.getItem('nbd_ui_size') || 'default';
  document.querySelectorAll('.nbd-size-btn').forEach(function(b) {
    var active = b.dataset.size === saved;
    b.style.borderColor = active ? 'var(--orange)' : '';
    b.style.color = active ? 'var(--orange)' : '';
    b.style.background = active ? 'color-mix(in srgb, var(--orange) 8%, transparent)' : '';
  });
});

// ── Expanded font system (legacy inline picker) ──
// 16 font families. Renamed to _NBD_LEGACY_FONTS to avoid colliding
// with the const NBD_FONTS in maps.js (theme engine font pairings).
// That collision caused a SyntaxError that killed maps.js entirely.
var _NBD_LEGACY_FONTS = [
  { id: 'barlow',     label: 'Barlow',        body: "'Barlow',sans-serif",             heading: "'Barlow Condensed',sans-serif",    gf: 'Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600' },
  { id: 'inter',      label: 'Inter',         body: "'Inter',sans-serif",              heading: "'Inter',sans-serif",               gf: 'Inter:wght@400;500;600;700;800' },
  { id: 'poppins',    label: 'Poppins',       body: "'Poppins',sans-serif",            heading: "'Poppins',sans-serif",             gf: 'Poppins:wght@400;500;600;700;800' },
  { id: 'roboto',     label: 'Roboto',        body: "'Roboto',sans-serif",             heading: "'Roboto Condensed',sans-serif",    gf: 'Roboto+Condensed:wght@400;700&family=Roboto:wght@400;500;700' },
  { id: 'nunito',     label: 'Nunito',        body: "'Nunito',sans-serif",             heading: "'Nunito',sans-serif",              gf: 'Nunito:wght@400;600;700;800' },
  { id: 'dm-sans',    label: 'DM Sans',       body: "'DM Sans',sans-serif",            heading: "'DM Sans',sans-serif",             gf: 'DM+Sans:wght@400;500;700' },
  { id: 'space',      label: 'Space Grotesk', body: "'Space Grotesk',sans-serif",      heading: "'Space Grotesk',sans-serif",       gf: 'Space+Grotesk:wght@400;500;600;700' },
  { id: 'outfit',     label: 'Outfit',        body: "'Outfit',sans-serif",             heading: "'Outfit',sans-serif",              gf: 'Outfit:wght@400;500;600;700;800' },
  { id: 'montserrat', label: 'Montserrat',    body: "'Montserrat',sans-serif",         heading: "'Montserrat',sans-serif",          gf: 'Montserrat:wght@400;500;600;700;800' },
  { id: 'lato',       label: 'Lato',          body: "'Lato',sans-serif",               heading: "'Lato',sans-serif",                gf: 'Lato:wght@400;700;900' },
  { id: 'raleway',    label: 'Raleway',       body: "'Raleway',sans-serif",            heading: "'Raleway',sans-serif",             gf: 'Raleway:wght@400;500;600;700;800' },
  { id: 'source',     label: 'Source Sans',   body: "'Source Sans 3',sans-serif",      heading: "'Source Sans 3',sans-serif",        gf: 'Source+Sans+3:wght@400;600;700;800' },
  { id: 'work-sans',  label: 'Work Sans',     body: "'Work Sans',sans-serif",          heading: "'Work Sans',sans-serif",           gf: 'Work+Sans:wght@400;500;600;700;800' },
  { id: 'manrope',    label: 'Manrope',       body: "'Manrope',sans-serif",            heading: "'Manrope',sans-serif",             gf: 'Manrope:wght@400;500;600;700;800' },
  { id: 'sora',       label: 'Sora',          body: "'Sora',sans-serif",               heading: "'Sora',sans-serif",                gf: 'Sora:wght@400;500;600;700;800' },
  { id: 'figtree',    label: 'Figtree',       body: "'Figtree',sans-serif",            heading: "'Figtree',sans-serif",             gf: 'Figtree:wght@400;500;600;700;800' }
];
var _nbdLoadedFonts = {};
function nbdApplyFont(fontId) {
  var font = _NBD_LEGACY_FONTS.find(function(f) { return f.id === fontId; });
  if (!font) font = _NBD_LEGACY_FONTS[0]; // fallback to Barlow
  // Load Google Font if not already loaded
  if (!_nbdLoadedFonts[font.id]) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + font.gf + '&display=swap';
    document.head.appendChild(link);
    _nbdLoadedFonts[font.id] = true;
  }
  document.documentElement.style.setProperty('--nbd-font-body', font.body);
  document.documentElement.style.setProperty('--nbd-font-heading', font.heading);
  document.body.style.fontFamily = font.body;
  localStorage.setItem('nbd_font', fontId);
  // Highlight active font card
  document.querySelectorAll('.nbd-font-card').forEach(function(c) {
    var active = c.dataset.fontId === fontId;
    c.style.borderColor = active ? 'var(--orange)' : 'var(--br)';
    c.style.background = active ? 'color-mix(in srgb, var(--orange) 6%, transparent)' : 'var(--s2)';
  });
  if (typeof showToast === 'function') showToast('Font: ' + font.label, 'info');
}
// Render font grid into settings
function nbdRenderFontGrid() {
  var grid = document.getElementById('settings-font-grid');
  if (!grid) return;
  var saved = localStorage.getItem('nbd_font') || 'barlow';
  grid.innerHTML = _NBD_LEGACY_FONTS.map(function(f) {
    var active = f.id === saved;
    return '<div class="nbd-font-card" data-font-id="' + f.id + '" data-action="call" data-fn="nbdApplyFont" data-arg="' + f.id + '" style="background:' + (active ? 'color-mix(in srgb, var(--orange) 6%, transparent)' : 'var(--s2)') + ';border:2px solid ' + (active ? 'var(--orange)' : 'var(--br)') + ';border-radius:8px;padding:12px;cursor:pointer;transition:all .15s;text-align:center;">'
      + '<div style="font-family:' + f.body + ';font-size:18px;font-weight:700;color:var(--t);margin-bottom:4px;">Aa</div>'
      + '<div style="font-size:10px;color:var(--m);font-weight:600;">' + f.label + '</div>'
      + '</div>';
  }).join('');
}
// Boot: apply saved font
(function() {
  var saved = localStorage.getItem('nbd_font');
  if (saved && saved !== 'barlow') nbdApplyFont(saved);
})();
document.addEventListener('DOMContentLoaded', nbdRenderFontGrid);

function toggleProfessionalMode(on) {
  if (on) {
    document.body.classList.add('professional-mode');
    localStorage.setItem('nbd_professional_mode', '1');
  } else {
    document.body.classList.remove('professional-mode');
    localStorage.removeItem('nbd_professional_mode');
  }
  // Sync the Settings checkbox if it exists
  var cb = document.getElementById('professionalModeToggle');
  if (cb) cb.checked = !!on;
  if (typeof showToast === 'function') showToast(on ? 'Professional Mode enabled' : 'Professional Mode disabled', 'info');
}
// On Settings tab open, sync the checkbox state
document.addEventListener('DOMContentLoaded', function() {
  var cb = document.getElementById('professionalModeToggle');
  if (cb) cb.checked = localStorage.getItem('nbd_professional_mode') === '1';
});
