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
// Stronger active-state styling so users can see which size is selected
// without squinting at a 1px border color difference. The active button
// uses an orange background fill, white text, and a soft glow.
function _nbdPaintSizeBtn(b, active) {
  if (active) {
    b.style.background = 'var(--orange)';
    b.style.borderColor = 'var(--orange)';
    b.style.color = 'var(--accent-fg, #fff)';
    b.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--orange) 22%, transparent)';
    b.style.fontWeight = '800';
  } else {
    b.style.background = '';
    b.style.borderColor = '';
    b.style.color = '';
    b.style.boxShadow = '';
    b.style.fontWeight = '';
  }
}
function nbdSetSize(size) {
  var scale = NBD_SIZE_SCALES[size] || 1.0;
  _nbdApplyScaleAttrs(size, scale);
  localStorage.setItem('nbd_ui_size', size);
  document.querySelectorAll('.nbd-size-btn').forEach(function(b) {
    _nbdPaintSizeBtn(b, b.dataset.size === size);
  });
  if (typeof showToast === 'function') showToast('UI size: ' + size, 'info');
}
// Sync size buttons on settings open
document.addEventListener('DOMContentLoaded', function() {
  var saved = localStorage.getItem('nbd_ui_size') || 'default';
  document.querySelectorAll('.nbd-size-btn').forEach(function(b) {
    _nbdPaintSizeBtn(b, b.dataset.size === saved);
  });
});
// Re-paint when the appearance tab opens (the size buttons are inside
// the lazy-hydrated settings template, so DOMContentLoaded fires before
// they exist in the live DOM).
window.nbdSyncSizeBtns = function() {
  var saved = localStorage.getItem('nbd_ui_size') || 'default';
  document.querySelectorAll('.nbd-size-btn').forEach(function(b) {
    _nbdPaintSizeBtn(b, b.dataset.size === saved);
  });
};

// ── Expanded font system (legacy inline picker) ──
// 28 font families spanning humanist sans, geometric, serif, slab,
// monospace, and display styles. Renamed to _NBD_LEGACY_FONTS to
// avoid colliding with the const NBD_FONTS in maps.js (theme engine
// font pairings). That collision caused a SyntaxError that killed
// maps.js entirely.
//
// Categories (cat field): 'sans' | 'serif' | 'mono' | 'display'.
// Picker UI groups by category and renders a label + Aa preview using
// the body font so users can browse by visual mood.
var _NBD_LEGACY_FONTS = [
  // ── Sans (humanist + geometric) ──
  { id: 'barlow',     label: 'Barlow',        cat: 'sans',    body: "'Barlow',sans-serif",             heading: "'Barlow Condensed',sans-serif",    gf: 'Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600' },
  { id: 'inter',      label: 'Inter',         cat: 'sans',    body: "'Inter',sans-serif",              heading: "'Inter',sans-serif",               gf: 'Inter:wght@400;500;600;700;800' },
  { id: 'poppins',    label: 'Poppins',       cat: 'sans',    body: "'Poppins',sans-serif",            heading: "'Poppins',sans-serif",             gf: 'Poppins:wght@400;500;600;700;800' },
  { id: 'roboto',     label: 'Roboto',        cat: 'sans',    body: "'Roboto',sans-serif",             heading: "'Roboto Condensed',sans-serif",    gf: 'Roboto+Condensed:wght@400;700&family=Roboto:wght@400;500;700' },
  { id: 'nunito',     label: 'Nunito',        cat: 'sans',    body: "'Nunito',sans-serif",             heading: "'Nunito',sans-serif",              gf: 'Nunito:wght@400;600;700;800' },
  { id: 'dm-sans',    label: 'DM Sans',       cat: 'sans',    body: "'DM Sans',sans-serif",            heading: "'DM Sans',sans-serif",             gf: 'DM+Sans:wght@400;500;700' },
  { id: 'space',      label: 'Space Grotesk', cat: 'sans',    body: "'Space Grotesk',sans-serif",      heading: "'Space Grotesk',sans-serif",       gf: 'Space+Grotesk:wght@400;500;600;700' },
  { id: 'outfit',     label: 'Outfit',        cat: 'sans',    body: "'Outfit',sans-serif",             heading: "'Outfit',sans-serif",              gf: 'Outfit:wght@400;500;600;700;800' },
  { id: 'montserrat', label: 'Montserrat',    cat: 'sans',    body: "'Montserrat',sans-serif",         heading: "'Montserrat',sans-serif",          gf: 'Montserrat:wght@400;500;600;700;800' },
  { id: 'lato',       label: 'Lato',          cat: 'sans',    body: "'Lato',sans-serif",               heading: "'Lato',sans-serif",                gf: 'Lato:wght@400;700;900' },
  { id: 'raleway',    label: 'Raleway',       cat: 'sans',    body: "'Raleway',sans-serif",            heading: "'Raleway',sans-serif",             gf: 'Raleway:wght@400;500;600;700;800' },
  { id: 'source',     label: 'Source Sans',   cat: 'sans',    body: "'Source Sans 3',sans-serif",      heading: "'Source Sans 3',sans-serif",       gf: 'Source+Sans+3:wght@400;600;700;800' },
  { id: 'work-sans',  label: 'Work Sans',     cat: 'sans',    body: "'Work Sans',sans-serif",          heading: "'Work Sans',sans-serif",           gf: 'Work+Sans:wght@400;500;600;700;800' },
  { id: 'manrope',    label: 'Manrope',       cat: 'sans',    body: "'Manrope',sans-serif",            heading: "'Manrope',sans-serif",             gf: 'Manrope:wght@400;500;600;700;800' },
  { id: 'sora',       label: 'Sora',          cat: 'sans',    body: "'Sora',sans-serif",               heading: "'Sora',sans-serif",                gf: 'Sora:wght@400;500;600;700;800' },
  { id: 'figtree',    label: 'Figtree',       cat: 'sans',    body: "'Figtree',sans-serif",            heading: "'Figtree',sans-serif",             gf: 'Figtree:wght@400;500;600;700;800' },
  { id: 'plus-jakarta', label: 'Plus Jakarta',cat: 'sans',    body: "'Plus Jakarta Sans',sans-serif",  heading: "'Plus Jakarta Sans',sans-serif",   gf: 'Plus+Jakarta+Sans:wght@400;500;600;700;800' },
  { id: 'be-vietnam', label: 'Be Vietnam',    cat: 'sans',    body: "'Be Vietnam Pro',sans-serif",     heading: "'Be Vietnam Pro',sans-serif",      gf: 'Be+Vietnam+Pro:wght@400;500;600;700;800' },
  { id: 'rubik',      label: 'Rubik',         cat: 'sans',    body: "'Rubik',sans-serif",              heading: "'Rubik',sans-serif",               gf: 'Rubik:wght@400;500;600;700;800' },
  // ── Serif ──
  { id: 'merriweather', label: 'Merriweather', cat: 'serif', body: "'Merriweather',serif",            heading: "'Merriweather',serif",             gf: 'Merriweather:wght@400;700;900' },
  { id: 'playfair',   label: 'Playfair',      cat: 'serif',   body: "'Playfair Display',serif",        heading: "'Playfair Display',serif",         gf: 'Playfair+Display:wght@400;500;600;700;800' },
  { id: 'lora',       label: 'Lora',          cat: 'serif',   body: "'Lora',serif",                    heading: "'Lora',serif",                     gf: 'Lora:wght@400;500;600;700' },
  { id: 'pt-serif',   label: 'PT Serif',      cat: 'serif',   body: "'PT Serif',serif",                heading: "'PT Serif',serif",                 gf: 'PT+Serif:wght@400;700' },
  { id: 'eb-garamond',label: 'EB Garamond',   cat: 'serif',   body: "'EB Garamond',serif",             heading: "'EB Garamond',serif",              gf: 'EB+Garamond:wght@400;500;600;700;800' },
  { id: 'crimson',    label: 'Crimson Pro',   cat: 'serif',   body: "'Crimson Pro',serif",             heading: "'Crimson Pro',serif",              gf: 'Crimson+Pro:wght@400;500;600;700;800' },
  // ── Mono ──
  { id: 'jetbrains',  label: 'JetBrains Mono',cat: 'mono',    body: "'JetBrains Mono',ui-monospace,monospace",  heading: "'JetBrains Mono',ui-monospace,monospace",  gf: 'JetBrains+Mono:wght@400;500;700' },
  { id: 'fira-code',  label: 'Fira Code',     cat: 'mono',    body: "'Fira Code',ui-monospace,monospace",       heading: "'Fira Code',ui-monospace,monospace",       gf: 'Fira+Code:wght@400;500;600;700' },
  { id: 'roboto-mono',label: 'Roboto Mono',   cat: 'mono',    body: "'Roboto Mono',ui-monospace,monospace",     heading: "'Roboto Mono',ui-monospace,monospace",     gf: 'Roboto+Mono:wght@400;500;600;700' }
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
// Render font grid into settings — grouped by category with a section
// heading so users can browse Sans / Serif / Mono. Each card shows an
// Aa preview rendered in that font so the picker reads like a sample
// sheet rather than a wall of labels.
function nbdRenderFontGrid() {
  var grid = document.getElementById('settings-font-grid');
  if (!grid) return;
  var saved = localStorage.getItem('nbd_font') || 'barlow';
  var cats = [
    { key: 'sans',    label: 'Sans-serif' },
    { key: 'serif',   label: 'Serif' },
    { key: 'mono',    label: 'Monospace' },
    { key: 'display', label: 'Display' }
  ];
  var html = '';
  cats.forEach(function(cat) {
    var fonts = _NBD_LEGACY_FONTS.filter(function(f) { return (f.cat || 'sans') === cat.key; });
    if (!fonts.length) return;
    html += '<div class="nbd-font-cat-head" style="grid-column:1/-1;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--m);margin:6px 0 2px;border-bottom:1px solid var(--br);padding-bottom:4px;">' + cat.label + ' <span style="opacity:.6;font-weight:600;">· ' + fonts.length + '</span></div>';
    fonts.forEach(function(f) {
      var active = f.id === saved;
      html += '<div class="nbd-font-card" data-font-id="' + f.id + '" data-action="call" data-fn="nbdApplyFont" data-arg="' + f.id + '" style="background:' + (active ? 'color-mix(in srgb, var(--orange) 12%, transparent)' : 'var(--s2)') + ';border:2px solid ' + (active ? 'var(--orange)' : 'var(--br)') + ';border-radius:8px;padding:12px;cursor:pointer;transition:all .15s;text-align:center;' + (active ? 'box-shadow:0 0 0 3px color-mix(in srgb, var(--orange) 18%, transparent);' : '') + '">'
        + '<div style="font-family:' + f.body + ';font-size:22px;font-weight:700;color:var(--t);margin-bottom:4px;line-height:1;">Aa</div>'
        + '<div style="font-size:10px;color:var(--m);font-weight:600;">' + f.label + (active ? ' ✓' : '') + '</div>'
        + '</div>';
    });
  });
  grid.innerHTML = html;
}
// Expose so the settings-tab open hook in switchSettingsTab() can call it
// when the appearance template has just been hydrated.
window.nbdRenderFontGrid = nbdRenderFontGrid;

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
