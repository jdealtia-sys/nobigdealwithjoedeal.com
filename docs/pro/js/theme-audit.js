/**
 * NBD Pro CRM — Theme Audit Harness v1.0
 *
 * One-shot WCAG contrast audit across all 153 themes x 2 modes (light/dark).
 * Drives the Phase 1 ThemeEngine.setModePref + apply contract, reads computed
 * :root CSS variables, computes WCAG 2.x contrast ratios, and emits a defect
 * list as JSON. Includes a small floating progress panel.
 *
 * Load on dashboard.html (or any pro page that already loads theme-engine.js):
 *   <script src="js/theme-audit.js" defer></script>
 * Then in DevTools:
 *   NBDThemeAudit.run().then(NBDThemeAudit.download)
 *
 * IIFE pattern, exposed as window.NBDThemeAudit. No external deps.
 */

(function() {
  'use strict';

  // ============================================================================
  // CONFIG — WCAG thresholds and the variable pairs we audit per theme/mode
  // ============================================================================

  const THRESHOLDS = {
    'text-on-bg': 4.5,       // AA normal body text
    'muted-on-bg': 3.0,      // AA large-text / non-text UI
    'accent-on-bg': 3.0,     // AA non-text UI (buttons, accents)
    'ink-on-paper': 4.5      // AA normal text inside cards
  };

  const PAIRS = [
    { key: 'text-on-bg',    fgVar: '--t',      bgVar: '--bg' },
    { key: 'muted-on-bg',   fgVar: '--m',      bgVar: '--bg' },
    { key: 'accent-on-bg',  fgVar: '--orange', bgVar: '--bg' },
    { key: 'ink-on-paper',  fgVar: '--ink',    bgVar: '--paper' }
  ];

  const READ_VARS = ['--bg', '--s', '--s2', '--t', '--m', '--orange', '--paper', '--ink'];
  const MODES = ['light', 'dark'];

  // ============================================================================
  // COLOR PARSING — accept hex (#rgb, #rrggbb, #rrggbbaa) and rgb()/rgba()
  // ============================================================================

  function parseColor(input) {
    if (!input) return null;
    const s = String(input).trim().toLowerCase();
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if (s.charAt(0) === '#') return parseHex(s);
    if (s.indexOf('rgb') === 0) return parseRgb(s);
    return null;
  }

  function parseHex(s) {
    let hex = s.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split('').map(c => c + c).join('');
    }
    if (hex.length !== 6 && hex.length !== 8) return null;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r: r, g: g, b: b, a: a };
  }

  function parseRgb(s) {
    const m = s.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const parts = m[1].split(',').map(p => p.trim());
    if (parts.length < 3) return null;
    const r = clampByte(parseFloat(parts[0]));
    const g = clampByte(parseFloat(parts[1]));
    const b = clampByte(parseFloat(parts[2]));
    const a = parts.length >= 4 ? parseFloat(parts[3]) : 1;
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r: r, g: g, b: b, a: Number.isNaN(a) ? 1 : a };
  }

  function clampByte(n) {
    if (Number.isNaN(n)) return NaN;
    return Math.max(0, Math.min(255, Math.round(n)));
  }

  function toHex(c) {
    if (!c) return null;
    const h = (n) => {
      const s = Math.round(n).toString(16);
      return s.length === 1 ? '0' + s : s;
    };
    return '#' + h(c.r) + h(c.g) + h(c.b);
  }

  // ============================================================================
  // WCAG MATH — relative luminance + contrast ratio per W3C spec
  // ============================================================================

  function srgbChannel(v) {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(c) {
    const r = srgbChannel(c.r);
    const g = srgbChannel(c.g);
    const b = srgbChannel(c.b);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  // Flatten a translucent fg over an opaque bg so contrast reflects what the eye sees.
  function blendOver(fg, bg) {
    if (!fg || !bg) return fg;
    const a = fg.a == null ? 1 : fg.a;
    if (a >= 1) return fg;
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      a: 1
    };
  }

  function contrastRatio(fg, bg) {
    if (!fg || !bg) return null;
    const flat = blendOver(fg, bg);
    const l1 = relativeLuminance(flat);
    const l2 = relativeLuminance(bg);
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }

  // ============================================================================
  // ENGINE BRIDGE — read computed :root vars after engine has applied a theme
  // ============================================================================

  function readRootVars() {
    const cs = getComputedStyle(document.documentElement);
    const out = {};
    READ_VARS.forEach(v => { out[v] = cs.getPropertyValue(v).trim(); });
    return out;
  }

  function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
  }

  function yieldToBrowser() {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  // ============================================================================
  // PER-THEME AUDIT — apply, read, evaluate pairs, emit defect entries
  // ============================================================================

  function auditPairs(themeKey, themeName, mode, vars) {
    const defects = [];
    PAIRS.forEach(pair => {
      const fgRaw = vars[pair.fgVar];
      const bgRaw = vars[pair.bgVar];
      const fg = parseColor(fgRaw);
      const bg = parseColor(bgRaw);
      const threshold = THRESHOLDS[pair.key];
      if (!fg || !bg) {
        defects.push({
          themeKey: themeKey,
          themeName: themeName,
          category: 'unreadable-variable',
          mode: mode,
          pair: pair.key,
          fgHex: fgRaw || null,
          bgHex: bgRaw || null,
          ratio: null,
          threshold: threshold
        });
        return;
      }
      const ratio = contrastRatio(fg, bg);
      if (ratio == null || ratio < threshold) {
        defects.push({
          themeKey: themeKey,
          themeName: themeName,
          category: pair.key,
          mode: mode,
          pair: pair.key,
          fgHex: toHex(fg),
          bgHex: toHex(bg),
          ratio: ratio == null ? null : Math.round(ratio * 100) / 100,
          threshold: threshold
        });
      }
    });
    return defects;
  }

  // ============================================================================
  // FLOATING PROGRESS PANEL — inline styles so it survives any active theme
  // ============================================================================

  function buildPanel() {
    const wrap = document.createElement('div');
    wrap.id = 'nbd-theme-audit-panel';
    wrap.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:99999',
      'min-width:280px', 'max-width:340px', 'padding:14px 16px',
      'background:#0f172a', 'color:#f1f5f9', 'border:1px solid #334155',
      'border-radius:10px', 'font:13px/1.4 system-ui,sans-serif',
      'box-shadow:0 10px 30px rgba(0,0,0,.4)'
    ].join(';');
    wrap.innerHTML =
      '<div style="font-weight:600;margin-bottom:6px;color:#fbbf24">Theme Audit</div>' +
      '<div id="nbd-theme-audit-status" style="margin-bottom:8px">Starting...</div>' +
      '<div style="background:#1e293b;height:6px;border-radius:3px;overflow:hidden;margin-bottom:10px">' +
      '<div id="nbd-theme-audit-bar" style="background:#fbbf24;height:100%;width:0%;transition:width .15s"></div>' +
      '</div>' +
      '<div id="nbd-theme-audit-actions"></div>';
    document.body.appendChild(wrap);
    return wrap;
  }

  function updatePanel(panel, status, pct) {
    if (!panel) return;
    const s = panel.querySelector('#nbd-theme-audit-status');
    const b = panel.querySelector('#nbd-theme-audit-bar');
    if (s) s.textContent = status;
    if (b) b.style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  function finishPanel(panel, defectList) {
    if (!panel) return;
    const actions = panel.querySelector('#nbd-theme-audit-actions');
    if (!actions) return;
    actions.innerHTML = '';
    const btn = document.createElement('button');
    btn.textContent = 'Download Report (' + defectList.length + ' defects)';
    btn.style.cssText = [
      'display:block', 'width:100%', 'padding:8px 10px',
      'background:#fbbf24', 'color:#0f172a', 'border:none',
      'border-radius:6px', 'font-weight:600', 'cursor:pointer'
    ].join(';');
    btn.addEventListener('click', () => api.download(defectList));
    actions.appendChild(btn);

    const close = document.createElement('button');
    close.textContent = 'Close';
    close.style.cssText = [
      'display:block', 'width:100%', 'margin-top:6px', 'padding:6px 10px',
      'background:transparent', 'color:#cbd5e1', 'border:1px solid #334155',
      'border-radius:6px', 'cursor:pointer'
    ].join(';');
    close.addEventListener('click', () => panel.remove());
    actions.appendChild(close);
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  const api = {
    async run(opts) {
      opts = opts || {};
      const TE = window.ThemeEngine;
      if (!TE || !TE.getAll || !TE.apply || !TE.setModePref || !TE.getResolvedMode) {
        throw new Error('[theme-audit] ThemeEngine contract not present — Phase 1 not landed?');
      }

      const allThemes = TE.getAll() || {};
      const themeKeys = opts.themes || Object.keys(allThemes);
      const modes = opts.modes || MODES.slice();
      const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

      // Snapshot original state so we can restore after the run.
      const originalTheme = (typeof TE.getCurrent === 'function' && TE.getCurrent()) ||
        localStorage.getItem('nbd_pro_theme') || null;
      const originalModePref = (TE.getModePref && TE.getModePref()) ||
        localStorage.getItem('nbd_pro_mode_pref') ||
        'auto';

      const panel = buildPanel();
      const defects = [];
      const total = themeKeys.length * modes.length;
      let done = 0;

      console.log('[theme-audit] starting: ' + themeKeys.length + ' themes x ' + modes.length + ' modes = ' + total + ' checks');

      for (let mi = 0; mi < modes.length; mi++) {
        const mode = modes[mi];
        TE.setModePref(mode);
        for (let ti = 0; ti < themeKeys.length; ti++) {
          const themeKey = themeKeys[ti];
          const themeObj = allThemes[themeKey] || {};
          const themeName = themeObj.name || themeKey;
          try {
            TE.apply(themeKey, false);
          } catch (err) {
            console.warn('[theme-audit] apply failed for ' + themeKey + ':', err && err.message);
            done++;
            continue;
          }
          await nextFrame();
          const vars = readRootVars();
          const themeDefects = auditPairs(themeKey, themeName, mode, vars);
          for (let d = 0; d < themeDefects.length; d++) defects.push(themeDefects[d]);

          done++;
          const pct = Math.round((done / total) * 100);
          const status = done + '/' + total + ' — ' + mode + ' / ' + themeName;
          updatePanel(panel, status, pct);
          if (done % 10 === 0 || done === total) {
            console.log('[theme-audit] ' + done + '/' + total + ' (' + pct + '%) — defects so far: ' + defects.length);
          }
          if (onProgress) {
            try { onProgress({ done: done, total: total, themeKey: themeKey, mode: mode, defects: defects.length }); }
            catch (_) { /* swallow callback errors */ }
          }
          // Yield to the browser every theme so the page stays responsive.
          await yieldToBrowser();
        }
      }

      // Restore original mode + theme.
      try {
        TE.setModePref(originalModePref);
        if (originalTheme) TE.apply(originalTheme, false);
      } catch (err) {
        console.warn('[theme-audit] restore failed:', err && err.message);
      }

      console.log('[theme-audit] done. defects=' + defects.length);
      finishPanel(panel, defects);
      return defects;
    },

    download(defectList) {
      const list = Array.isArray(defectList) ? defectList : [];
      const payload = {
        generatedAt: new Date().toISOString(),
        summary: api.summarize(list),
        defects: list
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date();
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      a.href = url;
      a.download = 'theme-audit-' + yyyy + '-' + mm + '-' + dd + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 0);
    },

    summarize(defectList) {
      const list = Array.isArray(defectList) ? defectList : [];
      const failingThemeSet = new Set();
      const failsByCategory = {};
      list.forEach(d => {
        failingThemeSet.add(d.themeKey + '|' + d.mode);
        failsByCategory[d.category] = (failsByCategory[d.category] || 0) + 1;
      });
      const TE = window.ThemeEngine;
      const totalThemes = (TE && TE.getAll) ? Object.keys(TE.getAll()).length : null;
      const totalChecks = totalThemes != null ? totalThemes * MODES.length * PAIRS.length : null;
      return {
        totalThemes: totalThemes,
        totalChecks: totalChecks,
        failingThemes: failingThemeSet.size,
        failsByCategory: failsByCategory
      };
    }
  };

  window.NBDThemeAudit = api;

})();
