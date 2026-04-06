// ============================================================
// NBD Pro — icons.js
// Branded SVG icon system replacing emoji throughout the CRM
// Icons use currentColor for theme compatibility
// ============================================================

const NBD_ICONS = {
  // ── NAVIGATION ──
  home: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L10 4l7 6.5"/><path d="M5 9v7a1 1 0 001 1h3v-4h2v4h3a1 1 0 001-1V9"/></svg>`,
  chart: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="10" width="3" height="7" rx=".5"/><rect x="8.5" y="6" width="3" height="11" rx=".5"/><rect x="14" y="3" width="3" height="14" rx=".5"/></svg>`,
  kanban: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="4.5" height="14" rx="1"/><rect x="7.75" y="3" width="4.5" height="10" rx="1"/><rect x="13.5" y="3" width="4.5" height="12" rx="1"/></svg>`,
  map: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11a3 3 0 100-6 3 3 0 000 6z"/><path d="M10 18s-6-5.35-6-10a6 6 0 1112 0c0 4.65-6 10-6 10z"/></svg>`,
  photos: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="16" height="14" rx="2"/><circle cx="7" cy="8" r="1.5"/><path d="M2 13l4-4 3 3 4-4 5 5"/></svg>`,
  estimates: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h8l4 4v10a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M12 3v4h4"/><path d="M7 10h6M7 13h4"/></svg>`,
  docs: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2h7l4 4v11a1 1 0 01-1 1H5a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M12 2v4h4"/></svg>`,
  brain: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 18V9"/><path d="M7 4.5A3 3 0 004 7.5c0 1.2.7 2.2 1.7 2.7A3 3 0 007 15h3"/><path d="M13 4.5A3 3 0 0116 7.5c0 1.2-.7 2.2-1.7 2.7A3 3 0 0013 15h-3"/><circle cx="10" cy="3" r="1.5"/></svg>`,
  tree: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v16"/><path d="M10 5l-5 4"/><path d="M10 5l5 4"/><path d="M10 9l-4 3.5"/><path d="M10 9l4 3.5"/><path d="M10 13l-3 3"/><path d="M10 13l3 3"/></svg>`,
  lightbulb: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 16h4M8.5 17.5h3"/><path d="M10 2a5 5 0 00-3 9v2h6v-2a5 5 0 00-3-9z"/></svg>`,
  search: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="9" r="5"/><path d="M13 13l4 4"/></svg>`,
  settings: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="2.5"/><path d="M10 1.5v2M10 16.5v2M3.3 3.3l1.4 1.4M15.3 15.3l1.4 1.4M1.5 10h2M16.5 10h2M3.3 16.7l1.4-1.4M15.3 4.7l1.4-1.4"/></svg>`,
  menu: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 5h14M3 10h14M3 15h14"/></svg>`,

  // ── ACTIONS ──
  plus: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 4v12M4 10h12"/></svg>`,
  edit: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 3.5l4 4L7 17H3v-4l9.5-9.5z"/></svg>`,
  trash: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5h10l-1 12H6L5 5z"/><path d="M3 5h14"/><path d="M8 5V3h4v2"/></svg>`,
  save: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 17H5a1 1 0 01-1-1V4a1 1 0 011-1h8l4 4v9a1 1 0 01-1 1z"/><rect x="7" y="11" width="6" height="5" rx=".5"/><path d="M7 3v4h5"/></svg>`,
  close: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15"/></svg>`,
  upload: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13V3"/><path d="M6 7l4-4 4 4"/><path d="M3 13v3a1 1 0 001 1h12a1 1 0 001-1v-3"/></svg>`,
  download: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v10"/><path d="M6 9l4 4 4-4"/><path d="M3 13v3a1 1 0 001 1h12a1 1 0 001-1v-3"/></svg>`,
  export: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 3H5a1 1 0 00-1 1v12a1 1 0 001 1h10a1 1 0 001-1v-6"/><path d="M12 2l5 5-5 5"/><path d="M17 7H9"/></svg>`,
  lock: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="9" width="12" height="8" rx="1.5"/><path d="M7 9V6a3 3 0 016 0v3"/></svg>`,
  refresh: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10a7 7 0 0112.9-3.7L17 5"/><path d="M17 10a7 7 0 01-12.9 3.7L3 15"/><path d="M17 2v3h-3M3 18v-3h3"/></svg>`,
  filter: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h14l-5 6v5l-4 2V10L3 4z"/></svg>`,

  // ── DATA / CONTACT ──
  phone: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h3l2 4-2.5 1.5A9 9 0 0011.5 13.5L13 11l4 2v3a1 1 0 01-1 1C8.4 17 3 11.6 3 4a1 1 0 011-1z"/></svg>`,
  email: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="16" height="12" rx="1.5"/><path d="M2 6l8 5 8-5"/></svg>`,
  pin: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11a3 3 0 100-6 3 3 0 000 6z"/><path d="M10 18s-6-5.35-6-10a6 6 0 1112 0c0 4.65-6 10-6 10z"/></svg>`,
  user: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="7" r="3"/><path d="M4 17a6 6 0 0112 0"/></svg>`,
  clock: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l2.5 2.5"/></svg>`,
  calendar: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="14" height="13" rx="1.5"/><path d="M3 8h14"/><path d="M7 2v4M13 2v4"/></svg>`,
  dollar: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v16"/><path d="M14 6c0-1.7-1.8-3-4-3S6 4.3 6 6s1.8 3 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3"/></svg>`,

  // ── STATUS ──
  check: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5l4 4 8-9"/></svg>`,
  checkCircle: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M7 10l2 2 4-5"/></svg>`,
  alert: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3L2 17h16L10 3z"/><path d="M10 8v4M10 14.5v.5"/></svg>`,
  info: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M10 9v5M10 6.5v.5"/></svg>`,
  bell: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2a5 5 0 00-5 5c0 4-2 6-2 6h14s-2-2-2-6a5 5 0 00-5-5z"/><path d="M8.5 16a1.5 1.5 0 003 0"/></svg>`,
  star: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2l2.4 5 5.6.8-4 3.9 1 5.5L10 14.5 5 17.2l1-5.5-4-3.9 5.6-.8z"/></svg>`,
  bolt: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2L4 11h5l-1 7 7-9h-5l1-7z"/></svg>`,
  target: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><circle cx="10" cy="10" r="4"/><circle cx="10" cy="10" r="1"/></svg>`,

  // ── DOMAIN-SPECIFIC ──
  roof: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10l8-7 8 7"/><path d="M4 9v7a1 1 0 001 1h10a1 1 0 001-1V9"/><path d="M8 17v-4h4v4"/></svg>`,
  clipboard: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="12" height="14" rx="1.5"/><path d="M7 3V1.5h6V3"/><path d="M7 8h6M7 11h4"/></svg>`,
  note: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3h12a1 1 0 011 1v10l-4 4H4a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M13 14v4"/><path d="M7 7h6M7 10h3"/></svg>`,
  shield: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2l6 3v4c0 4.4-2.6 7.3-6 9-3.4-1.7-6-4.6-6-9V5l6-3z"/></svg>`,
  camera: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="16" height="11" rx="1.5"/><circle cx="10" cy="11" r="3"/><path d="M7 6l1-3h4l1 3"/></svg>`,
  folder: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h5l2 2h7a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V6a1 1 0 011-1z"/></svg>`,
  compass: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="7"/><path d="M13.5 6.5l-2 5-5 2 2-5 5-2z"/></svg>`,
  arrowRight: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h12M12 6l4 4-4 4"/></svg>`,
  arrowLeft: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 10H4M8 6l-4 4 4 4"/></svg>`,
  chevronDown: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7l5 5 5-5"/></svg>`,
  externalLink: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3h5v5"/><path d="M17 3L9 11"/><path d="M15 11v5a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1h5"/></svg>`,
  grid: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/></svg>`,
  weather: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16a4 4 0 01-.5-7.97A5.5 5.5 0 0115.18 7 4 4 0 0116 15H5z"/></svg>`,
  tool: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a4 4 0 00-3.5 5.9L3 14.4 5.6 17l5.5-5.5A4 4 0 0012 3z"/></svg>`,
  robot: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="6" width="12" height="10" rx="2"/><circle cx="8" cy="11" r="1"/><circle cx="12" cy="11" r="1"/><path d="M10 2v4"/><path d="M2 10h2M16 10h2"/><circle cx="10" cy="2" r="1"/></svg>`,
  trophy: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h8v6a4 4 0 01-8 0V3z"/><path d="M6 5H4a1 1 0 00-1 1v1a3 3 0 003 3"/><path d="M14 5h2a1 1 0 011 1v1a3 3 0 01-3 3"/><path d="M10 13v2"/><path d="M7 17h6"/></svg>`,
  chart2: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l4-6 3 3 3-5 4 2"/></svg>`,
  hourglass: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2h10v4l-3 3 3 3v4H5v-4l3-3-3-3V2z"/></svg>`,
};

/**
 * Render an NBD Pro icon as inline SVG HTML
 * @param {string} name - Icon name from NBD_ICONS
 * @param {number|string} size - Size in px (default 16)
 * @param {string} className - Optional CSS class
 * @param {string} color - Optional CSS color override
 * @returns {string} HTML string
 */
function nbdIcon(name, size, className, color) {
  const svg = NBD_ICONS[name];
  if (!svg) return '';
  const s = size || 16;
  const cls = className ? ` class="${className}"` : '';
  const col = color ? ` style="color:${color}"` : '';
  return `<span${cls}${col} aria-hidden="true" style="display:inline-flex;align-items:center;justify-content:center;width:${s}px;height:${s}px;flex-shrink:0;${color ? 'color:'+color+';' : ''}">${svg}</span>`;
}

// Expose globally
window.NBD_ICONS = NBD_ICONS;
window.nbdIcon = nbdIcon;
