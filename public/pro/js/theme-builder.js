(function() {
  'use strict';

  // Default theme template
  const DEFAULT_THEME = {
    name: 'New Theme',
    custom: true,
    colors: {
      bg: '#1a1a1a',
      surface: '#242424',
      surface2: '#2c2c2c',
      text: '#e0e0e0',
      muted: '#888888',
      border: '#404040',
      accent: '#ff6b35',
      accentBg: 'rgba(255, 107, 53, 0.12)',
      green: '#10b981',
      red: '#ef4444',
      gold: '#f59e0b',
      blue: '#3b82f6'
    },
    overlay: { type: 'none' },
    font: { heading: 'Barlow Condensed', body: null },
    borderRadius: '12px',
    cardEffect: 'none',
    transition: '0.2s ease'
  };

  const OVERLAY_TYPES = [
    'none', 'film-grain', 'star-twinkle', 'bubbles', 'rain', 'snow', 'matrix-rain'
  ];

  const FONT_OPTIONS = [
    'Barlow Condensed', 'Orbitron', 'Press Start 2P', 'Merriweather',
    'Playfair Display', 'Space Mono', 'Oswald', 'Permanent Marker'
  ];

  const CARD_EFFECTS = ['none', 'glow', 'float', 'rough'];
  const TRANSITION_SPEEDS = [
    { label: 'Instant', value: '0s' },
    { label: 'Fast', value: '0.1s' },
    { label: 'Normal', value: '0.2s' },
    { label: 'Smooth', value: '0.4s' },
    { label: 'Dramatic', value: '0.6s' }
  ];

  let customThemes = [];
  let currentTheme = { ...DEFAULT_THEME };
  let previewMode = false;

  // Utility: lighten color by percentage
  function lightenColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, (num >> 8 & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
  }

  // Utility: mix two colors
  function mixColors(color1, color2, ratio) {
    const c1 = parseInt(color1.replace('#', ''), 16);
    const c2 = parseInt(color2.replace('#', ''), 16);
    const r = Math.round(((c1 >> 16) & 255) * ratio + ((c2 >> 16) & 255) * (1 - ratio));
    const g = Math.round(((c1 >> 8) & 255) * ratio + ((c2 >> 8) & 255) * (1 - ratio));
    const b = Math.round((c1 & 255) * ratio + (c2 & 255) * (1 - ratio));
    return `#${(0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1)}`;
  }

  // Auto-generate derived colors
  function generateDerivedColors(theme) {
    return {
      ...theme.colors,
      surface2: lightenColor(theme.colors.surface, 8),
      muted: mixColors(theme.colors.text, theme.colors.bg, 0.6),
      accentBg: `rgba(${hexToRgb(theme.colors.accent)}, 0.12)`
    };
  }

  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '0, 0, 0';
  }

  // Load themes from localStorage
  function loadCustomThemes() {
    const stored = localStorage.getItem('nbd-custom-themes');
    customThemes = stored ? JSON.parse(stored) : [];
    return customThemes;
  }

  // Save themes to localStorage
  function saveCustomThemes() {
    localStorage.setItem('nbd-custom-themes', JSON.stringify(customThemes));
  }

  // Generate CSS variables string
  function generateCSSVariables(theme) {
    const colors = generateDerivedColors(theme);
    let css = '';
    for (const [key, value] of Object.entries(colors)) {
      css += `--${key}: ${value}; `;
    }
    if (theme.font.heading) css += `--font-heading: ${theme.font.heading}; `;
    css += `--br: ${theme.borderRadius}; `;
    css += `--transition: ${theme.transition}; `;
    return css;
  }

  // Render the live preview panel
  function renderPreview(theme) {
    const preview = document.getElementById('theme-builder-preview');
    if (!preview) return;

    const cssVars = generateCSSVariables(theme);
    preview.style.cssText = `${cssVars} padding: 20px; background: var(--s); color: var(--t); border-radius: var(--br); font-family: ${theme.font.heading || 'sans-serif'};`;

    preview.innerHTML = `
      <div style="margin-bottom: 16px; padding: 12px; background: var(--s2); border-radius: var(--br); border: 1px solid var(--br);">
        <div style="font-size: 12px; color: var(--muted); margin-bottom: 4px;">NAVBAR</div>
        <div style="display: flex; gap: 8px;">
          <div style="flex: 1; height: 20px; background: var(--orange); border-radius: 4px;"></div>
          <div style="width: 60px; height: 20px; background: var(--accent2); border-radius: 4px;"></div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
        <div style="padding: 12px; background: var(--s2); border-radius: var(--br); border: 1px solid var(--br);">
          <div style="font-size: 11px; color: var(--muted); margin-bottom: 4px;">KPI</div>
          <div style="font-size: 16px; font-weight: bold; color: var(--orange);">1,234</div>
        </div>
        <div style="padding: 12px; background: var(--s2); border-radius: var(--br); border: 1px solid var(--br);">
          <div style="font-size: 11px; color: var(--muted); margin-bottom: 4px;">KPI</div>
          <div style="font-size: 16px; font-weight: bold; color: var(--accent2);">567</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
        <div style="padding: 12px; background: var(--s2); border-radius: var(--br); border: 1px solid var(--br);">
          <div style="font-size: 11px; color: var(--muted); margin-bottom: 8px;">CARD</div>
          <div style="height: 40px; background: var(--orange); border-radius: 4px; opacity: 0.2;"></div>
        </div>
        <div style="padding: 12px; background: var(--s2); border-radius: var(--br); border: 1px solid var(--br);">
          <div style="font-size: 11px; color: var(--muted); margin-bottom: 8px;">CARD</div>
          <div style="height: 40px; background: var(--accent2); border-radius: 4px; opacity: 0.2;"></div>
        </div>
      </div>

      <button style="width: 100%; padding: 8px; background: var(--orange); color: var(--s); border: none; border-radius: var(--br); cursor: pointer; font-weight: bold; margin-bottom: 12px;">Button</button>

      <div style="font-size: 14px; font-weight: bold; color: var(--t); margin-bottom: 4px;">Heading</div>
      <div style="font-size: 12px; color: var(--t); margin-bottom: 6px;">Body text sample</div>
      <div style="font-size: 11px; color: var(--muted);">Muted text</div>
    `;
  }

  // Render the builder UI
  function renderBuilder(containerId) {
    loadCustomThemes();
    const container = document.getElementById(containerId);
    if (!container) return console.error(`Container ${containerId} not found`);

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; padding: 20px; background: var(--s); color: var(--t); border-radius: 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">

        <!-- LEFT PANEL -->
        <div id="theme-builder-controls" style="display: flex; flex-direction: column; gap: 16px;">
          <h2 style="margin: 0 0 8px 0; font-size: 18px;">Theme Builder</h2>

          <div>
            <label style="display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase;">Theme Name</label>
            <input type="text" id="theme-name" placeholder="My Theme" value="${currentTheme.name}" style="width: 100%; padding: 8px; background: var(--s2); border: 1px solid var(--br); border-radius: 4px; color: var(--t); box-sizing: border-box;">
          </div>

          <div>
            <label style="display: block; font-size: 12px; color: var(--muted); margin-bottom: 8px; text-transform: uppercase;">Base Mode</label>
            <div style="display: flex; gap: 8px;">
              <button class="mode-toggle" data-mode="dark" style="flex: 1; padding: 8px; background: var(--orange); border: none; border-radius: 4px; color: var(--s); cursor: pointer; font-weight: bold;">Dark</button>
              <button class="mode-toggle" data-mode="light" style="flex: 1; padding: 8px; background: var(--s2); border: 1px solid var(--br); border-radius: 4px; color: var(--t); cursor: pointer;">Light</button>
            </div>
          </div>

          <div>
            <label style="display: block; font-size: 12px; color: var(--muted); margin-bottom: 8px; text-transform: uppercase;">Colors</label>
            ${renderColorPickers()}
          </div>

          <div>
            <label style="display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase;">Overlay Effect</label>
            <select id="overlay-select" style="width: 100%; padding: 8px; background: var(--s2); border: 1px solid var(--br); border-radius: 4px; color: var(--t);">
              ${OVERLAY_TYPES.map(t => `<option value="${t}" ${currentTheme.overlay.type === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>

          <div>
            <label style="display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase;">Font (Heading)</label>
            <select id="font-heading" style="width: 100%; padding: 8px; background: var(--s2); border: 1px solid var(--br); border-radius: 4px; color: var(--t);">
              ${FONT_OPTIONS.map(f => `<option value="${f}" ${currentTheme.font.heading === f ? 'selected' : ''}>${f}</option>`).join('')}
            </select>
          </div>

          <div>
            <label style="display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase;">Border Radius</label>
            <div style="display: flex; gap: 8px; align-items: center;">
              <input type="range" id="border-radius" min="0" max="24" value="${parseInt(currentTheme.borderRadius)}" style="flex: 1;">
              <span id="border-radius-value" style="font-size: 12px; color: var(--muted); min-width: 40px;">${currentTheme.borderRadius}</span>
            </div>
          </div>

          <div>
            <label style="display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase;">Card Effect</label>
            <select id="card-effect" style="width: 100%; padding: 8px; background: var(--s2); border: 1px solid var(--br); border-radius: 4px; color: var(--t);">
              ${CARD_EFFECTS.map(e => `<option value="${e}" ${currentTheme.cardEffect === e ? 'selected' : ''}>${e}</option>`).join('')}
            </select>
          </div>

          <div>
            <label style="display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; text-transform: uppercase;">Transition Speed</label>
            <select id="transition-speed" style="width: 100%; padding: 8px; background: var(--s2); border: 1px solid var(--br); border-radius: 4px; color: var(--t);">
              ${TRANSITION_SPEEDS.map(t => `<option value="${t.value}" ${currentTheme.transition === t.value + ' ease' ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
          </div>
        </div>

        <!-- RIGHT PANEL: PREVIEW -->
        <div id="theme-builder-preview" style="background: var(--s2); border: 1px solid var(--br); border-radius: 8px; overflow: hidden;"></div>
      </div>

      <!-- ACTIONS BAR -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 16px; padding: 16px; background: var(--s); border-radius: 8px;">
        <button id="btn-preview-full" style="padding: 10px; background: var(--accent2); border: none; border-radius: 4px; color: var(--s); cursor: pointer; font-weight: bold;">Preview Full</button>
        <button id="btn-save-theme" style="padding: 10px; background: var(--orange); border: none; border-radius: 4px; color: var(--s); cursor: pointer; font-weight: bold;">Save Theme</button>
        <button id="btn-export-code" style="padding: 10px; background: var(--blue); border: none; border-radius: 4px; color: var(--s); cursor: pointer; font-weight: bold;">Export Code</button>
        <button id="btn-import-code" style="padding: 10px; background: var(--gold); border: none; border-radius: 4px; color: var(--s); cursor: pointer; font-weight: bold;">Import Code</button>
        <button id="btn-reset" style="padding: 10px; background: var(--br); border: none; border-radius: 4px; color: var(--t); cursor: pointer; font-weight: bold;">Reset</button>
      </div>
    `;

    attachEventListeners();
    renderPreview(currentTheme);
  }

  function renderColorPickers() {
    const colorLabels = {
      bg: 'Background',
      surface: 'Surface',
      text: 'Text',
      accent: 'Accent',
      accentBg: 'Accent BG',
      border: 'Border'
    };

    return Object.entries(colorLabels).map(([key, label]) => `
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
        <label style="flex: 0 0 80px; font-size: 11px; color: var(--muted);">${label}</label>
        <input type="color" class="color-picker" data-key="${key}" value="${currentTheme.colors[key] || '#000'}" style="width: 40px; height: 32px; border: 1px solid var(--br); border-radius: 4px; cursor: pointer;">
        <input type="text" class="color-text" data-key="${key}" value="${currentTheme.colors[key] || '#000'}" style="flex: 1; padding: 4px; background: var(--s2); border: 1px solid var(--br); border-radius: 4px; color: var(--t); font-size: 11px;">
      </div>
    `).join('');
  }

  function attachEventListeners() {
    // Theme name
    document.getElementById('theme-name')?.addEventListener('change', (e) => {
      currentTheme.name = e.target.value;
    });

    // Mode toggle
    document.querySelectorAll('.mode-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = e.target.dataset.mode;
        const isDark = mode === 'dark';
        currentTheme.colors = isDark ? { ...DEFAULT_THEME.colors } : invertColors(DEFAULT_THEME.colors);
        document.querySelectorAll('.color-picker').forEach(picker => {
          picker.value = currentTheme.colors[picker.dataset.key];
        });
        document.querySelectorAll('.color-text').forEach(input => {
          input.value = currentTheme.colors[input.dataset.key];
        });
        renderPreview(currentTheme);
      });
    });

    // Color pickers
    document.querySelectorAll('.color-picker').forEach(picker => {
      picker.addEventListener('input', (e) => {
        const key = e.target.dataset.key;
        currentTheme.colors[key] = e.target.value;
        document.querySelector(`.color-text[data-key="${key}"]`).value = e.target.value;
        renderPreview(currentTheme);
      });
    });

    document.querySelectorAll('.color-text').forEach(input => {
      input.addEventListener('change', (e) => {
        const key = e.target.dataset.key;
        if (/^#[0-9a-f]{6}$/i.test(e.target.value)) {
          currentTheme.colors[key] = e.target.value;
          document.querySelector(`.color-picker[data-key="${key}"]`).value = e.target.value;
          renderPreview(currentTheme);
        }
      });
    });

    // Overlay
    document.getElementById('overlay-select')?.addEventListener('change', (e) => {
      currentTheme.overlay.type = e.target.value;
      renderPreview(currentTheme);
    });

    // Font
    document.getElementById('font-heading')?.addEventListener('change', (e) => {
      currentTheme.font.heading = e.target.value;
      renderPreview(currentTheme);
    });

    // Border radius
    document.getElementById('border-radius')?.addEventListener('input', (e) => {
      currentTheme.borderRadius = e.target.value + 'px';
      document.getElementById('border-radius-value').textContent = currentTheme.borderRadius;
      renderPreview(currentTheme);
    });

    // Card effect
    document.getElementById('card-effect')?.addEventListener('change', (e) => {
      currentTheme.cardEffect = e.target.value;
      renderPreview(currentTheme);
    });

    // Transition speed
    document.getElementById('transition-speed')?.addEventListener('change', (e) => {
      currentTheme.transition = e.target.value + ' ease';
      renderPreview(currentTheme);
    });

    // Action buttons
    document.getElementById('btn-preview-full')?.addEventListener('click', previewFullTheme);
    document.getElementById('btn-save-theme')?.addEventListener('click', saveTheme);
    document.getElementById('btn-export-code')?.addEventListener('click', exportTheme);
    document.getElementById('btn-import-code')?.addEventListener('click', importTheme);
    document.getElementById('btn-reset')?.addEventListener('click', resetTheme);
  }

  function invertColors(colors) {
    return {
      bg: '#f5f5f5',
      surface: '#e8e8e8',
      text: '#1a1a1a',
      accent: colors.accent,
      border: '#d0d0d0',
      ...colors
    };
  }

  function previewFullTheme() {
    previewMode = !previewMode;
    const root = document.documentElement;
    if (previewMode) {
      const cssVars = generateCSSVariables(currentTheme);
      root.style.cssText = cssVars;
      alert('Theme preview applied. Click again to exit.');
    } else {
      root.style.cssText = '';
    }
  }

  function saveTheme() {
    if (!currentTheme.name.trim()) {
      alert('Please enter a theme name');
      return;
    }
    if (customThemes.length >= 10) {
      alert('Maximum 10 custom themes allowed');
      return;
    }
    const theme = {
      key: 'custom-' + Date.now(),
      ...currentTheme,
      colors: generateDerivedColors(currentTheme)
    };
    customThemes.push(theme);
    saveCustomThemes();
    alert(`Theme "${theme.name}" saved!`);
  }

  function exportTheme() {
    const theme = {
      ...currentTheme,
      colors: generateDerivedColors(currentTheme)
    };
    const json = JSON.stringify(theme, null, 2);
    navigator.clipboard.writeText(json).then(() => {
      alert('Theme exported to clipboard!');
    });
  }

  function importTheme() {
    const json = prompt('Paste theme JSON:');
    if (!json) return;
    try {
      const theme = JSON.parse(json);
      currentTheme = { ...DEFAULT_THEME, ...theme };
      renderBuilder(document.querySelector('[id*="theme-builder"]')?.parentElement?.id || 'theme-builder');
    } catch (e) {
      alert('Invalid JSON format');
    }
  }

  function resetTheme() {
    if (confirm('Reset all fields to defaults?')) {
      currentTheme = { ...DEFAULT_THEME };
      renderBuilder(document.querySelector('[id*="theme-builder"]')?.parentElement?.id || 'theme-builder');
    }
  }

  // Public API
  window.ThemeBuilder = {
    renderBuilder,
    getCustomThemes: () => loadCustomThemes(),
    deleteCustomTheme: (key) => {
      customThemes = customThemes.filter(t => t.key !== key);
      saveCustomThemes();
    },
    exportTheme: (key) => {
      const theme = customThemes.find(t => t.key === key);
      return theme ? JSON.stringify(theme, null, 2) : null;
    },
    importTheme: (jsonString) => {
      try {
        const theme = JSON.parse(jsonString);
        theme.key = 'custom-' + Date.now();
        theme.custom = true;
        customThemes.push(theme);
        saveCustomThemes();
        return theme;
      } catch (e) {
        console.error('Import failed:', e);
        return null;
      }
    }
  };

})();
