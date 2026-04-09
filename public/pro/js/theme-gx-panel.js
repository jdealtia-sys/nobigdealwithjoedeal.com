/**
 * theme-gx-panel.js — Settings Panel UI for the Opera GX Enhancement Layer
 *
 * Renders a "GX Effects" section inside the existing Settings > Appearance tab.
 * Call ThemeGXPanel.render(containerId) to inject the controls.
 *
 * Features:
 *   - Freeform accent color picker with live preview (updates as you drag)
 *   - Glow effects toggle
 *   - Animated background toggle
 *   - Intensity slider (subtle → full neon)
 *   - Quick accent presets (neon colors)
 *   - Reset to theme default
 */

(function() {
  'use strict';

  const NEON_PRESETS = [
    { label: 'NBD Orange', hex: '#e8720c' },
    { label: 'Electric Blue', hex: '#00d4ff' },
    { label: 'Neon Pink', hex: '#ff2d78' },
    { label: 'Cyber Green', hex: '#39ff14' },
    { label: 'Plasma Purple', hex: '#bf00ff' },
    { label: 'Solar Gold', hex: '#ffd700' },
    { label: 'Lava Red', hex: '#ff3131' },
    { label: 'Ice White', hex: '#e0f7ff' },
    { label: 'Mint', hex: '#00ffab' },
    { label: 'Sunset', hex: '#ff6b35' },
  ];

  function createEl(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'style' && typeof v === 'object') {
        Object.assign(el.style, v);
      } else if (k.startsWith('on')) {
        el.addEventListener(k.slice(2), v);
      } else {
        el.setAttribute(k, v);
      }
    });
    if (children) {
      if (typeof children === 'string') el.textContent = children;
      else if (Array.isArray(children)) children.forEach(c => { if (c) el.appendChild(c); });
      else el.appendChild(children);
    }
    return el;
  }

  function render(containerId) {
    const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!container) return console.warn('[ThemeGXPanel] Container not found:', containerId);

    const gx = window.ThemeGX;
    if (!gx) return console.warn('[ThemeGXPanel] ThemeGX not loaded');
    const st = gx.getState();

    // Clear existing if re-rendering
    const existing = container.querySelector('.gx-panel');
    if (existing) existing.remove();

    const panel = createEl('div', { class: 'gx-panel', style: {
      padding: '16px', borderRadius: 'var(--te-radius, 12px)',
      background: 'var(--s2, #1a2a45)', border: '1px solid var(--br, rgba(255,255,255,0.08))',
      marginTop: '16px'
    }});

    // ── Header ──
    const header = createEl('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}, [
      createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' }}, [
        createEl('span', { style: { fontSize: '18px' }}, '\u26A1'),
        createEl('span', { style: { fontWeight: '800', fontSize: '14px', color: 'var(--t, #fff)', letterSpacing: '0.04em', textTransform: 'uppercase' }}, 'GX Effects'),
      ]),
      createToggle(st.enabled, function(val) {
        gx.setEnabled(val);
        render(containerId); // re-render to show/hide controls
      })
    ]);
    panel.appendChild(header);

    if (!st.enabled) {
      panel.appendChild(createEl('p', { style: { fontSize: '12px', color: 'var(--m, #888)', margin: '0' }}, 'Enable GX effects for glow, animated backgrounds, and accent color customization.'));
      container.appendChild(panel);
      return;
    }

    // ── Accent Color Picker ──
    const accentSection = createEl('div', { style: { marginBottom: '16px' }});
    accentSection.appendChild(createLabel('Accent Color'));

    const pickerRow = createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }});

    const colorInput = createEl('input', {
      type: 'color',
      value: st.accentOverride || gx.getAccent(),
      style: { width: '48px', height: '36px', border: 'none', borderRadius: '8px', cursor: 'pointer', background: 'transparent', padding: '0' },
      oninput: function() {
        gx.setAccent(this.value);
        hexInput.value = this.value;
        updatePresetHighlight(this.value);
      }
    });

    const hexInput = createEl('input', {
      type: 'text',
      value: st.accentOverride || gx.getAccent(),
      maxlength: '7',
      placeholder: '#e8720c',
      style: {
        flex: '1', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--br, rgba(255,255,255,0.1))',
        background: 'var(--s, #0d1c35)', color: 'var(--t, #fff)', fontFamily: 'monospace', fontSize: '13px'
      },
      oninput: function() {
        const val = this.value.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(val)) {
          gx.setAccent(val);
          colorInput.value = val;
          updatePresetHighlight(val);
        }
      }
    });

    const resetBtn = createEl('button', {
      style: {
        padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--br, rgba(255,255,255,0.1))',
        background: 'transparent', color: 'var(--m, #888)', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap'
      },
      onclick: function() {
        gx.clearAccentOverride();
        const accent = gx.getAccent();
        colorInput.value = accent;
        hexInput.value = accent;
        updatePresetHighlight(accent);
      }
    }, 'Reset');

    pickerRow.appendChild(colorInput);
    pickerRow.appendChild(hexInput);
    pickerRow.appendChild(resetBtn);
    accentSection.appendChild(pickerRow);

    // Preset swatches
    const presetRow = createEl('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' }});
    NEON_PRESETS.forEach(function(preset) {
      const swatch = createEl('button', {
        title: preset.label,
        'data-gx-preset': preset.hex,
        style: {
          width: '28px', height: '28px', borderRadius: '50%', border: '2px solid transparent',
          background: preset.hex, cursor: 'pointer', transition: 'border-color 0.2s, transform 0.2s',
          boxShadow: '0 0 6px ' + preset.hex + '40'
        },
        onclick: function() {
          gx.setAccent(preset.hex);
          colorInput.value = preset.hex;
          hexInput.value = preset.hex;
          updatePresetHighlight(preset.hex);
        },
        onmouseenter: function() { this.style.transform = 'scale(1.2)'; },
        onmouseleave: function() { this.style.transform = 'scale(1)'; }
      });
      presetRow.appendChild(swatch);
    });
    accentSection.appendChild(presetRow);
    panel.appendChild(accentSection);

    function updatePresetHighlight(hex) {
      presetRow.querySelectorAll('[data-gx-preset]').forEach(function(s) {
        s.style.borderColor = s.getAttribute('data-gx-preset').toLowerCase() === hex.toLowerCase()
          ? '#fff' : 'transparent';
      });
    }
    updatePresetHighlight(st.accentOverride || gx.getAccent());

    // ── Intensity Slider ──
    const intensitySection = createEl('div', { style: { marginBottom: '16px' }});
    intensitySection.appendChild(createLabel('Glow Intensity'));

    const sliderRow = createEl('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' }});
    sliderRow.appendChild(createEl('span', { style: { fontSize: '11px', color: 'var(--m, #888)' }}, 'Subtle'));

    const slider = createEl('input', {
      type: 'range', min: '0', max: '100', value: String(Math.round(st.intensity * 100)),
      style: { flex: '1', accentColor: 'var(--gx-accent, var(--orange, #e8720c))' },
      oninput: function() {
        gx.setIntensity(parseInt(this.value) / 100);
        valLabel.textContent = this.value + '%';
      }
    });
    sliderRow.appendChild(slider);
    sliderRow.appendChild(createEl('span', { style: { fontSize: '11px', color: 'var(--m, #888)' }}, 'Neon'));

    const valLabel = createEl('span', { style: { fontSize: '11px', color: 'var(--orange, #e8720c)', fontWeight: '700', minWidth: '32px', textAlign: 'right' }},
      Math.round(st.intensity * 100) + '%');
    sliderRow.appendChild(valLabel);
    intensitySection.appendChild(sliderRow);
    panel.appendChild(intensitySection);

    // ── Toggles ──
    const toggleSection = createEl('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' }});

    toggleSection.appendChild(createToggleRow('Glow Effects', 'Neon glow on buttons, inputs, nav, and scrollbar', st.glowEnabled, function(val) {
      gx.setGlow(val);
    }));

    toggleSection.appendChild(createToggleRow('Animated Background', 'Slow-moving gradient orbs tied to your accent color', st.animatedBgEnabled, function(val) {
      gx.setAnimatedBg(val);
    }));

    panel.appendChild(toggleSection);

    container.appendChild(panel);
  }

  // ── UI Helpers ──

  function createLabel(text) {
    return createEl('div', { style: { fontSize: '11px', fontWeight: '700', color: 'var(--m, #888)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}, text);
  }

  function createToggle(checked, onChange) {
    const wrapper = createEl('label', { style: {
      position: 'relative', display: 'inline-block', width: '40px', height: '22px', cursor: 'pointer'
    }});
    const input = createEl('input', { type: 'checkbox', style: { display: 'none' }});
    input.checked = checked;
    const track = createEl('span', { style: {
      position: 'absolute', top: '0', left: '0', right: '0', bottom: '0',
      borderRadius: '11px', transition: '0.2s',
      background: checked ? 'var(--gx-accent, var(--orange, #e8720c))' : 'var(--br, rgba(255,255,255,0.15))'
    }});
    const thumb = createEl('span', { style: {
      position: 'absolute', top: '2px', left: checked ? '20px' : '2px', width: '18px', height: '18px',
      borderRadius: '50%', background: '#fff', transition: '0.2s',
      boxShadow: checked ? '0 0 8px var(--gx-glow-soft, rgba(232,114,12,0.4))' : 'none'
    }});
    wrapper.appendChild(input);
    wrapper.appendChild(track);
    wrapper.appendChild(thumb);
    wrapper.addEventListener('click', function(e) {
      e.preventDefault();
      input.checked = !input.checked;
      track.style.background = input.checked ? 'var(--gx-accent, var(--orange, #e8720c))' : 'var(--br, rgba(255,255,255,0.15))';
      thumb.style.left = input.checked ? '20px' : '2px';
      thumb.style.boxShadow = input.checked ? '0 0 8px var(--gx-glow-soft, rgba(232,114,12,0.4))' : 'none';
      onChange(input.checked);
    });
    return wrapper;
  }

  function createToggleRow(label, desc, checked, onChange) {
    const row = createEl('div', { style: {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '10px 12px', borderRadius: '8px', background: 'var(--s, #0d1c35)',
      border: '1px solid var(--br, rgba(255,255,255,0.06))'
    }}, [
      createEl('div', {}, [
        createEl('div', { style: { fontSize: '13px', fontWeight: '600', color: 'var(--t, #fff)' }}, label),
        createEl('div', { style: { fontSize: '11px', color: 'var(--m, #888)', marginTop: '2px' }}, desc),
      ]),
      createToggle(checked, onChange)
    ]);
    return row;
  }

  // ── Public API ──

  window.ThemeGXPanel = {
    render: render,
    NEON_PRESETS: NEON_PRESETS
  };
})();