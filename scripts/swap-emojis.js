#!/usr/bin/env node
/*
 * Swap the most visible emojis for clean inline SVG icons across all docs pages.
 * Focused on consistent UI containers so replacements are safe and bounded.
 *
 * Scope:
 *  - .ann-slide leading emoji
 *  - .trust-icon / .aci-icon / .cm-icon / .wc-phone-icon single-emoji content
 *  - Button-leading emojis like `>📞 Call` and `>📅 Schedule`
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'docs');

// Inline SVG snippets (keep small; match the ones used on index.html).
const SVG = {
  phone: '<svg class="ico ico-fill" viewBox="0 0 24 24"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.36 2.3.56 3.6.56.55 0 1 .45 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.56 3.6a1 1 0 0 1-.25 1z"/></svg>',
  calendar: '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/></svg>',
  shield: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 2 L4 6 V12 C4 17 8 21 12 22 C16 21 20 17 20 12 V6 Z"/></svg>',
  house: '<svg class="ico" viewBox="0 0 24 24"><path d="M3 11 L12 3 L21 11"/><path d="M5 10 V20 H19 V10"/></svg>',
  star: '<svg class="ico ico-fill" viewBox="0 0 24 24"><polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9"/></svg>',
  clipboard: '<svg class="ico" viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/></svg>',
  money: '<svg class="ico" viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/></svg>',
  bolt: '<svg class="ico ico-fill" viewBox="0 0 24 24"><path d="M13 2 L4 14 L11 14 L10 22 L20 10 L13 10 Z"/></svg>',
  storm: '<svg class="ico" viewBox="0 0 24 24"><path d="M17.5 19a4.5 4.5 0 0 0 .4-8.98A6 6 0 0 0 6.1 11.3 4 4 0 0 0 7 19"/><polyline points="13 12 10 17 14 17 11 22"/></svg>',
  mail: '<svg class="ico" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/></svg>',
  pin: '<svg class="ico" viewBox="0 0 24 24"><path d="M12 22s-7-7.5-7-13a7 7 0 0 1 14 0c0 5.5-7 13-7 13z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  check: '<svg class="ico" viewBox="0 0 24 24"><polyline points="4 12 10 18 20 6"/></svg>',
};

// CSS block to inject if missing — so .ico sizing works.
const ICO_CSS = `
/* unified-emoji-swap injected */
.ico{width:1em;height:1em;stroke:currentColor;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round;flex-shrink:0;display:inline-block;vertical-align:-0.14em}
.ico-fill{fill:currentColor;stroke:none}
.trust-icon svg.ico,.aci-icon svg.ico,.cm-icon svg.ico{width:24px;height:24px}
.wc-phone-icon svg.ico{width:26px;height:26px}
`;

// Map single-emoji content to SVG.
const EMOJI_SVG = {
  '📞': SVG.phone,
  '📅': SVG.calendar,
  '🛡️': SVG.shield,
  '🛡': SVG.shield,
  '🏠': SVG.house,
  '⭐': SVG.star,
  '📋': SVG.clipboard,
  '💰': SVG.money,
  '⚡': SVG.bolt,
  '🌩️': SVG.storm,
  '🌩': SVG.storm,
  '⛈️': SVG.storm,
  '⛈': SVG.storm,
  '📧': SVG.mail,
  '📍': SVG.pin,
  '✅': SVG.check,
};

// Container classes whose inner single-emoji content should be swapped.
const ICON_CLASSES = ['trust-icon', 'aci-icon', 'cm-icon', 'wc-phone-icon', 'form-success-icon'];

function swapIconContainers(html) {
  let out = html;
  for (const cls of ICON_CLASSES) {
    // Match <div class="cls"> WHITESPACE EMOJI WHITESPACE </div>
    // and replace the emoji with its SVG. Only swap when the content is JUST one emoji.
    const re = new RegExp('(<div class="' + cls + '"[^>]*>)\\s*([\\u{1F000}-\\u{1FFFF}\\u{2600}-\\u{27BF}\\u{FE0F}\\u{1F300}-\\u{1F9FF}]+)\\s*(<\\/div>)', 'gu');
    out = out.replace(re, (m, open, emoji, close) => {
      // Normalize emoji and try direct lookup; fallback to first char
      const norm = emoji.replace(/\uFE0F/g, '');
      const svg = EMOJI_SVG[norm] || EMOJI_SVG[emoji] || null;
      if (!svg) return m;
      // Add color hint inline so icons adopt the accent color.
      const addColor = /style="/.test(open) ? open : open.replace('>', ' style="color:var(--orange,#e8720c)">');
      return addColor + svg + close;
    });
  }
  return out;
}

function swapAnnSlides(html) {
  // Match <div class="ann-slide ..."> EMOJI TEXT </div>  → replace leading emoji with SVG + text.
  const re = /(<div class="ann-slide[^"]*"[^>]*>)\s*([\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F300}-\u{1F9FF}]+)\s+/gu;
  return html.replace(re, (m, open, emoji) => {
    const norm = emoji.replace(/\uFE0F/g, '');
    const svg = EMOJI_SVG[norm] || EMOJI_SVG[emoji];
    if (!svg) return m;
    return open + svg + ' ';
  });
}

function swapLeadingInButtons(html) {
  // Match href links / buttons whose text starts with an emoji space
  const re = /(>)([\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F300}-\u{1F9FF}]+)(\s+[A-Z][^<]{2,}<\/a>)/gu;
  return html.replace(re, (m, lt, emoji, rest) => {
    const norm = emoji.replace(/\uFE0F/g, '');
    const svg = EMOJI_SVG[norm] || EMOJI_SVG[emoji];
    if (!svg) return m;
    return lt + svg + ' ' + rest.trimStart();
  });
}

function injectCssIfMissing(html) {
  if (/unified-emoji-swap injected/.test(html)) return html;
  // Prefer injecting right before </head> in its own <style> block so we don't
  // depend on </style> being adjacent to </head>.
  if (/<\/head>/.test(html)) {
    return html.replace(/<\/head>/, '<style>' + ICO_CSS + '</style>\n</head>');
  }
  return html;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['admin', 'pro', 'sites', 'assets', 'deploy', 'free-guide', 'tools'].includes(entry.name)) continue;
      walk(full, out);
    } else if (entry.name.endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

let touched = 0, unchanged = 0;
for (const file of walk(ROOT)) {
  const orig = fs.readFileSync(file, 'utf8');
  let next = orig;
  next = swapIconContainers(next);
  next = swapAnnSlides(next);
  next = swapLeadingInButtons(next);
  // Inject ico CSS if page already contains any svg.ico element (added now or earlier).
  if (/<svg class="ico/.test(next)) next = injectCssIfMissing(next);
  if (next !== orig) {
    fs.writeFileSync(file, next);
    touched++;
  } else {
    unchanged++;
  }
}
console.log(JSON.stringify({ touched, unchanged }, null, 2));
