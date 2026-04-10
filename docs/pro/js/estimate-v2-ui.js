// ============================================================
// NBD Pro — Estimate V2 Builder UI
//
// Full-screen modal that wires the 3-catalog linked engine to
// a working user interface:
//
//   1. Measurement inputs (left column)
//   2. Mode toggle: Per-SQ | Line-Item
//   3. Line item picker with search + category filters (middle)
//   4. Selected scope panel with live quantity recalc (right)
//   5. Running grand total at bottom
//   6. Three export buttons: Insurance Scope | Retail Quote | Internal
//
// Triggered by window.openEstimateV2Builder() from dashboard.
// Self-contained — creates its own DOM when first opened.
// ============================================================

(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  // Session state
  const state = {
    mode: 'line-item',        // 'line-item' | 'per-sq'
    tier: 'better',
    jobMode: 'insurance',     // 'insurance' | 'cash'
    county: 'hamilton-oh',
    measurements: {
      rawSqft: 0, pitch: 8, waste: 1.17,
      ridgeLf: 0, eaveLf: 0, rakeLf: 0, hipLf: 0, valleyLf: 0, wallLf: 0,
      pipes: 0, chimneys: 0, skylights: 0, stories: 1,
      tearOffLayers: 1, deckReplacePct: 0.15, cutUpRoof: false
    },
    scope: [],                // Array of { code, overrides } entries
    customer: { name: '', address: '', phone: '', email: '' },
    claim: { carrier: '', number: '', adjuster: '', dateOfLoss: '', deductible: 2500, acv: null },
    searchFilter: '',
    categoryFilter: 'all'
  };

  // ═════════════════════════════════════════════════════════
  // Modal HTML (created lazily on first open)
  // ═════════════════════════════════════════════════════════

  function ensureModal() {
    if (document.getElementById('estV2Modal')) return;

    const modal = document.createElement('div');
    modal.id = 'estV2Modal';
    modal.innerHTML = `
      <style>
      #estV2Modal {
        position:fixed; inset:0; z-index:9999;
        background:rgba(10,12,15,0.95);
        display:none; overflow:hidden;
        font-family:'Barlow','Helvetica Neue',sans-serif;
      }
      #estV2Modal.open { display:flex; flex-direction:column; }
      .v2-hdr {
        background:#111418; border-bottom:2px solid #e8720c;
        padding:14px 24px;
        display:flex; justify-content:space-between; align-items:center;
        flex-shrink:0;
      }
      .v2-title {
        font-family:'Barlow Condensed',sans-serif; font-size:22px;
        font-weight:800; color:#fff; text-transform:uppercase;
        letter-spacing:.06em;
      }
      .v2-title .pro { color:#e8720c; }
      .v2-beta {
        font-size:9px; background:#e8720c; color:#fff;
        padding:2px 8px; border-radius:2px; letter-spacing:.15em;
        margin-left:10px;
      }
      .v2-close {
        background:none; border:1px solid #e8720c; color:#e8720c;
        padding:8px 16px; cursor:pointer; font-weight:600;
        border-radius:4px; font-size:12px;
      }
      .v2-close:hover { background:#e8720c; color:#fff; }
      .v2-body {
        flex:1; display:grid;
        grid-template-columns:280px 1fr 360px;
        gap:0; overflow:hidden;
        min-height:0;
      }
      .v2-pane {
        background:#181c22; border-right:1px solid #2a2f35;
        padding:16px; overflow-y:auto; color:#e8eaf0;
        min-height:0;
      }
      .v2-pane.right { border-right:none; border-left:1px solid #2a2f35; background:#111418; }

      /* ── Mobile responsive ── Stack the 3 panes vertically
         under 1000px so the modal stays usable on tablets in
         portrait, small laptops, and phones. */
      @media (max-width: 1000px) {
        .v2-body {
          grid-template-columns: 1fr;
          grid-template-rows: auto 1fr auto;
          overflow-y: auto;
        }
        .v2-pane {
          border-right: none;
          border-bottom: 1px solid #2a2f35;
          max-height: none;
        }
        .v2-pane.right {
          border-left: none;
          border-top: 1px solid #2a2f35;
        }
      }
      @media (max-width: 600px) {
        .v2-hdr { padding: 10px 14px; }
        .v2-title { font-size: 16px !important; }
        .v2-title + .v2-title { margin-left: 10px !important; }
        .v2-pane { padding: 12px; }
        .v2-close { padding: 6px 12px; font-size: 11px; }
        .v2-total-val { font-size: 32px !important; }
      }
      .v2-section {
        font-family:'Barlow Condensed',sans-serif; font-size:11px;
        font-weight:700; text-transform:uppercase; letter-spacing:.15em;
        color:#e8720c; margin:16px 0 8px; padding-bottom:6px;
        border-bottom:1px solid #2a2f35;
      }
      .v2-section:first-child { margin-top:0; }
      .v2-field { margin-bottom:10px; }
      .v2-field label {
        display:block; font-size:9px; text-transform:uppercase;
        letter-spacing:.1em; color:#888; margin-bottom:3px;
      }
      .v2-field input, .v2-field select {
        width:100%; background:#0a0c0f; border:1px solid #2a2f35;
        color:#e8eaf0; padding:8px 10px; border-radius:3px;
        font-size:13px; font-family:inherit;
      }
      .v2-field input:focus, .v2-field select:focus {
        outline:none; border-color:#e8720c;
      }
      .v2-field.inline {
        display:flex; align-items:center; gap:8px;
      }
      .v2-field.inline label {
        margin-bottom:0; flex:1;
      }
      .v2-field.inline input[type=checkbox] {
        width:auto;
      }
      .v2-tabs {
        display:flex; gap:0; margin-bottom:12px;
        border:1px solid #2a2f35; border-radius:4px; overflow:hidden;
      }
      .v2-tabs button {
        flex:1; background:#0a0c0f; border:none; color:#888;
        padding:10px; font-size:11px; font-weight:700;
        letter-spacing:.1em; text-transform:uppercase; cursor:pointer;
        font-family:inherit;
      }
      .v2-tabs button.active {
        background:#e8720c; color:#fff;
      }
      .v2-cat-tabs {
        display:flex; gap:4px; margin-bottom:10px; flex-wrap:wrap;
      }
      .v2-cat-tabs button {
        background:#0a0c0f; border:1px solid #2a2f35; color:#888;
        padding:4px 9px; font-size:10px; cursor:pointer; border-radius:3px;
        font-family:inherit;
      }
      .v2-cat-tabs button.active {
        background:#e8720c; color:#fff; border-color:#e8720c;
      }
      .v2-search {
        width:100%; background:#0a0c0f; border:1px solid #2a2f35;
        color:#e8eaf0; padding:10px 12px; border-radius:4px;
        font-size:13px; margin-bottom:10px; font-family:inherit;
      }
      .v2-item-list {
        display:flex; flex-direction:column; gap:4px;
      }
      .v2-item {
        background:#0a0c0f; border:1px solid #2a2f35;
        padding:10px 12px; border-radius:3px; cursor:pointer;
        display:flex; justify-content:space-between; align-items:flex-start;
        transition:all 0.15s;
      }
      .v2-item:hover {
        border-color:#e8720c; transform:translateX(2px);
      }
      .v2-item .code {
        font-family:'Barlow Condensed',sans-serif; font-size:10px;
        color:#e8720c; font-weight:700; letter-spacing:.05em;
      }
      .v2-item .name { font-size:12px; color:#e8eaf0; margin-top:2px; }
      .v2-item .cost {
        font-size:11px; color:#888; text-align:right;
        font-variant-numeric:tabular-nums; flex-shrink:0; margin-left:12px;
      }
      .v2-item .add-btn {
        background:#e8720c; border:none; color:#fff;
        padding:4px 10px; font-size:10px; font-weight:700;
        cursor:pointer; border-radius:3px; letter-spacing:.05em;
      }
      .v2-scope-item {
        background:#0a0c0f; border-left:3px solid #e8720c;
        padding:10px 12px; margin-bottom:6px; border-radius:3px;
        font-size:12px;
      }
      .v2-scope-item .name { color:#e8eaf0; font-weight:600; }
      .v2-scope-item .qty {
        color:#888; font-size:10px; margin-top:2px;
        font-variant-numeric:tabular-nums;
      }
      .v2-scope-item .total {
        color:#e8720c; font-weight:700; font-size:13px; float:right;
        font-variant-numeric:tabular-nums;
      }
      .v2-scope-item .rm {
        background:none; border:none; color:#666; cursor:pointer;
        font-size:14px; float:right; margin-left:8px; padding:0;
      }
      .v2-scope-item .rm:hover { color:#c53030; }
      .v2-total-card {
        background:#0a0c0f; border:2px solid #e8720c;
        border-radius:6px; padding:16px; margin-top:16px;
        text-align:center;
      }
      .v2-total-lbl {
        font-size:10px; color:#888; text-transform:uppercase;
        letter-spacing:.15em;
      }
      .v2-total-val {
        font-family:'Barlow Condensed',sans-serif; font-size:42px;
        font-weight:800; color:#e8720c; line-height:1;
      }
      .v2-rollup {
        font-size:11px; color:#888; margin-top:10px;
        line-height:1.6;
      }
      .v2-rollup strong { color:#e8eaf0; }
      .v2-export-btns {
        display:grid; grid-template-columns:1fr 1fr 1fr;
        gap:8px; margin-top:14px;
      }
      .v2-export-btns button {
        background:#0a0c0f; border:1px solid #2a2f35; color:#e8eaf0;
        padding:12px 6px; font-size:10px; font-weight:700;
        letter-spacing:.08em; text-transform:uppercase; cursor:pointer;
        border-radius:4px; font-family:inherit;
      }
      .v2-export-btns button.primary {
        background:#e8720c; border-color:#e8720c; color:#fff;
      }
      .v2-export-btns button:hover {
        border-color:#e8720c;
      }
      .v2-preset-btns {
        display:grid; grid-template-columns:1fr 1fr;
        gap:6px; margin-top:6px;
      }
      .v2-preset-btns button {
        background:#0a0c0f; border:1px solid #2a2f35; color:#888;
        padding:8px 6px; font-size:10px; font-weight:600;
        cursor:pointer; border-radius:3px; font-family:inherit;
        text-align:center;
      }
      .v2-preset-btns button:hover {
        border-color:#e8720c; color:#e8720c;
      }
      .v2-empty {
        text-align:center; color:#666; padding:24px 8px;
        font-size:12px; font-style:italic;
      }
      </style>

      <div class="v2-hdr">
        <div>
          <span class="v2-title">NBD<span class="pro"> PRO</span></span>
          <span class="v2-title" style="margin-left:20px;">Estimate Builder V2</span>
          <span class="v2-beta">BETA</span>
        </div>
        <button class="v2-close" onclick="closeEstimateV2Builder()">✕ Close</button>
      </div>

      <div class="v2-body">
        <!-- LEFT: Measurements + Mode + Customer -->
        <div class="v2-pane">
          <div class="v2-section">Mode</div>
          <div class="v2-tabs">
            <button id="v2modePerSq" onclick="EstimateV2UI.setMode('per-sq')">Per-SQ</button>
            <button id="v2modeLine" class="active" onclick="EstimateV2UI.setMode('line-item')">Line-Item</button>
          </div>
          <div class="v2-tabs">
            <button id="v2jobInsurance" class="active" onclick="EstimateV2UI.setJobMode('insurance')">Insurance</button>
            <button id="v2jobCash" onclick="EstimateV2UI.setJobMode('cash')">Cash</button>
          </div>

          <div class="v2-section">Measurements</div>
          <div class="v2-field">
            <label>Raw Roof Area (SF)</label>
            <input type="number" id="v2rawSqft" placeholder="3900" oninput="EstimateV2UI.updateMeasurement('rawSqft', this.value)">
          </div>
          <div class="v2-field">
            <label>Pitch (rise/12)</label>
            <select id="v2pitch" onchange="EstimateV2UI.updateMeasurement('pitch', this.value)">
              <option value="4">4/12</option>
              <option value="6">6/12</option>
              <option value="8" selected>8/12</option>
              <option value="10">10/12</option>
              <option value="12">12/12</option>
              <option value="14">14/12</option>
            </select>
          </div>
          <div class="v2-field">
            <label>Eave LF</label>
            <input type="number" id="v2eaveLf" placeholder="120" oninput="EstimateV2UI.updateMeasurement('eaveLf', this.value)">
          </div>
          <div class="v2-field">
            <label>Rake LF</label>
            <input type="number" id="v2rakeLf" placeholder="50" oninput="EstimateV2UI.updateMeasurement('rakeLf', this.value)">
          </div>
          <div class="v2-field">
            <label>Ridge LF</label>
            <input type="number" id="v2ridgeLf" placeholder="45" oninput="EstimateV2UI.updateMeasurement('ridgeLf', this.value)">
          </div>
          <div class="v2-field">
            <label>Hip LF</label>
            <input type="number" id="v2hipLf" placeholder="20" oninput="EstimateV2UI.updateMeasurement('hipLf', this.value)">
          </div>
          <div class="v2-field">
            <label>Valley LF</label>
            <input type="number" id="v2valleyLf" placeholder="32" oninput="EstimateV2UI.updateMeasurement('valleyLf', this.value)">
          </div>
          <div class="v2-field">
            <label>Pipes (count)</label>
            <input type="number" id="v2pipes" placeholder="4" oninput="EstimateV2UI.updateMeasurement('pipes', this.value)">
          </div>
          <div class="v2-field">
            <label>Chimneys (count)</label>
            <input type="number" id="v2chimneys" placeholder="1" oninput="EstimateV2UI.updateMeasurement('chimneys', this.value)">
          </div>
          <div class="v2-field">
            <label>Skylights (count)</label>
            <input type="number" id="v2skylights" placeholder="0" oninput="EstimateV2UI.updateMeasurement('skylights', this.value)">
          </div>
          <div class="v2-field">
            <label>Tear-off Layers</label>
            <select id="v2layers" onchange="EstimateV2UI.updateMeasurement('tearOffLayers', this.value)">
              <option value="1">1 Layer</option>
              <option value="2">2 Layers</option>
              <option value="3">3 Layers</option>
            </select>
          </div>
          <div class="v2-field">
            <label>Stories</label>
            <select id="v2stories" onchange="EstimateV2UI.updateMeasurement('stories', this.value)">
              <option value="1">1 Story</option>
              <option value="2">2 Story</option>
              <option value="3">3 Story</option>
            </select>
          </div>
          <div class="v2-field inline">
            <label>Cut-up Roof (+3% waste)</label>
            <input type="checkbox" id="v2cutup" onchange="EstimateV2UI.updateMeasurement('cutUpRoof', this.checked)">
          </div>

          <div class="v2-section">Presets</div>
          <div class="v2-preset-btns">
            <button onclick="EstimateV2UI.loadPreset('standard-reroof')">Standard Reroof</button>
            <button onclick="EstimateV2UI.loadPreset('storm-claim')">Storm Claim</button>
            <button onclick="EstimateV2UI.loadPreset('small-repair')">Small Repair</button>
            <button onclick="EstimateV2UI.loadPreset('full-redeck')">Full Redeck</button>
            <button onclick="EstimateV2UI.loadPreset('hail-damage-insurance')" style="grid-column:span 2;">Hail Damage Insurance</button>
          </div>
        </div>

        <!-- MIDDLE: Catalog picker -->
        <div class="v2-pane">
          <div class="v2-section">Line Item Catalog (270 items)</div>
          <input type="text" class="v2-search" id="v2search" placeholder="Search by code, name, or tag..." oninput="EstimateV2UI.setSearch(this.value)">
          <div class="v2-cat-tabs" id="v2cats"></div>
          <div class="v2-item-list" id="v2items"></div>
        </div>

        <!-- RIGHT: Selected scope + total + export -->
        <div class="v2-pane right">
          <div class="v2-section">Selected Scope</div>
          <div id="v2scopeList">
            <div class="v2-empty">No items selected yet.<br>Pick from catalog or use a preset.</div>
          </div>

          <div class="v2-total-card">
            <div class="v2-total-lbl">Grand Total</div>
            <div class="v2-total-val" id="v2total">$0</div>
            <div class="v2-rollup" id="v2rollup"></div>
          </div>

          <div class="v2-section">Preview / Export</div>
          <div class="v2-export-btns">
            <button onclick="EstimateV2UI.finalize('insurance-scope')">📋 Insurance Scope</button>
            <button onclick="EstimateV2UI.finalize('retail-quote')">💼 Retail Quote</button>
            <button onclick="EstimateV2UI.finalize('internal-view')">🔒 Internal</button>
          </div>

          <div class="v2-section">Save</div>
          <button id="v2saveBtn" onclick="EstimateV2UI.save()"
            style="width:100%;background:#e8720c;border:none;color:#fff;padding:14px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;border-radius:4px;font-family:inherit;">
            💾 Save Estimate to Customer
          </button>
          <div id="v2saveStatus" style="font-size:10px;color:#888;margin-top:6px;text-align:center;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // ═════════════════════════════════════════════════════════
  // State management
  // ═════════════════════════════════════════════════════════

  function setMode(mode) {
    state.mode = mode;
    document.getElementById('v2modePerSq').classList.toggle('active', mode === 'per-sq');
    document.getElementById('v2modeLine').classList.toggle('active', mode === 'line-item');
    render();
  }

  function setJobMode(jobMode) {
    state.jobMode = jobMode;
    document.getElementById('v2jobInsurance').classList.toggle('active', jobMode === 'insurance');
    document.getElementById('v2jobCash').classList.toggle('active', jobMode === 'cash');
    render();
  }

  function updateMeasurement(key, value) {
    if (key === 'cutUpRoof') {
      state.measurements[key] = !!value;
    } else {
      state.measurements[key] = Number(value) || 0;
    }
    render();
  }

  function setSearch(q) {
    state.searchFilter = q || '';
    renderCatalog();
  }

  function setCategory(cat) {
    state.categoryFilter = cat || 'all';
    renderCatalog();
  }

  function addToScope(code) {
    if (state.scope.find(s => s.code === code)) return;  // Already in scope
    state.scope.push({ code });
    render();
  }

  function removeFromScope(code) {
    state.scope = state.scope.filter(s => s.code !== code);
    render();
  }

  function clearScope() {
    state.scope = [];
    render();
  }

  function loadPreset(presetKey) {
    clearScope();
    const PRESETS = {
      'standard-reroof': [
        'LAB TO1', 'RFG 240-GAF-HDZ', 'RFG SYN', 'RFG IWS', 'RFG STRT',
        'RFG DRPE-AL', 'RFG RIDG-ARC', 'RFG VLY-W', 'RFG PIPE-LD',
        'RFG RIDG-VNT', 'RFG NAIL-C', 'DSP 30YD', 'PRM RES-OH',
        'LAB MOB', 'LAB DEMOB', 'LAB CLN-M'
      ],
      'storm-claim': [
        'LAB TO1', 'RFG 240-GAF-HDZ', 'RFG SYN', 'RFG IWS', 'RFG STRT',
        'RFG DRPE-AL', 'RFG RIDG-ARC', 'RFG VLY-W', 'RFG PIPE-LD',
        'RFG CHIM-STD', 'RFG RIDG-VNT', 'RFG NAIL-LUMA', 'DSP 30YD',
        'PRM RES-OH', 'LAB MOB', 'LAB DEMOB', 'LAB CLN-M', 'LAB PHOTO',
        'CUP IWS-E', 'CUP KICK'
      ],
      'small-repair': [
        'LAB TO1', 'RFG 240-GAF-HDZ', 'RFG SYN', 'RFG STRT', 'RFG DRPE-AL',
        'DSP 10YD', 'LAB MOB', 'LAB CLN-M'
      ],
      'full-redeck': [
        'LAB TO1', 'RFG OSB716', 'RFG 240-GAF-HDZ', 'RFG SYN', 'RFG IWS',
        'RFG STRT', 'RFG DRPE-AL', 'RFG RIDG-ARC', 'RFG VLY-W', 'RFG PIPE-LD',
        'RFG CHIM-STD', 'RFG RIDG-VNT', 'RFG NAIL-LUMA', 'DSP 40YD',
        'PRM RES-OH', 'LAB MOB', 'LAB DEMOB', 'LAB CLN-M'
      ],
      'hail-damage-insurance': [
        'LAB TO1', 'RFG ARM-GAF', 'RFG SYN-P', 'RFG IWS', 'RFG STRT-PS',
        'RFG DRPE-AL', 'RFG RIDG-IMP', 'RFG VLY-W', 'RFG PIPE-LD',
        'RFG CHIM-STD', 'RFG CHIM-SAD', 'RFG RIDG-VNT-PR', 'RFG NAIL-LUMA',
        'DSP 30YD', 'PRM RES-OH', 'LAB MOB', 'LAB DEMOB', 'LAB CLN-M',
        'LAB PHOTO', 'CUP IWS-E', 'CUP KICK', 'CUP HC'
      ]
    };
    const codes = PRESETS[presetKey] || [];
    codes.forEach(c => state.scope.push({ code: c }));
    render();
  }

  // ═════════════════════════════════════════════════════════
  // Rendering
  // ═════════════════════════════════════════════════════════

  function getCurrentEstimate() {
    const cat = window.NBD_XACT_CATALOG;
    if (!cat) return null;
    const items = state.scope.map(s => cat.find(s.code)).filter(Boolean);
    if (!items.length) return null;
    if (!window.EstimateLogic) return null;
    return window.EstimateLogic.resolveEstimate(items, state.measurements, {
      tier: state.tier,
      mode: state.jobMode,
      county: state.county
    });
  }

  function renderCatalog() {
    const catDiv = document.getElementById('v2items');
    const catTabs = document.getElementById('v2cats');
    if (!catDiv || !catTabs) return;

    const cat = window.NBD_XACT_CATALOG;
    if (!cat) {
      catDiv.innerHTML = '<div class="v2-empty">Catalog still loading...</div>';
      return;
    }

    // Category chips
    const cats = Object.keys(cat.byCategory || {}).sort();
    catTabs.innerHTML = [
      `<button class="${state.categoryFilter === 'all' ? 'active' : ''}" onclick="EstimateV2UI.setCategory('all')">All</button>`,
      ...cats.map(c =>
        `<button class="${state.categoryFilter === c ? 'active' : ''}" onclick="EstimateV2UI.setCategory('${c}')">${c} (${cat.byCategory[c].length})</button>`
      )
    ].join('');

    // Filter items
    let items = state.categoryFilter === 'all' ? cat.items : cat.byCategory[state.categoryFilter] || [];
    if (state.searchFilter) {
      const q = state.searchFilter.toLowerCase();
      items = items.filter(i =>
        (i.name || '').toLowerCase().includes(q) ||
        (i.code || '').toLowerCase().includes(q) ||
        (i.tags || []).some(t => t.toLowerCase().includes(q))
      );
    }

    // Limit to first 50 for performance; user can refine with search
    const limited = items.slice(0, 50);
    const totalCount = items.length;

    // Simple HTML escape for attributes + text nodes. Catalog codes
    // are alphanumeric today but this guards against any future
    // catalog entry containing quotes or HTML special characters
    // that would break out of an attribute and become an XSS sink.
    const esc = (s) => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    catDiv.innerHTML = limited.map(item => {
      const inScope = !!state.scope.find(s => s.code === item.code);
      const mat = Number(item.materialCost) || 0;
      const lab = Number(item.laborCost) || 0;
      const unitCost = mat + lab;
      // Use data-code attribute instead of embedding the code in the
      // onclick handler string. Click handler reads it from dataset.
      return `
        <div class="v2-item" data-code="${esc(item.code)}" onclick="EstimateV2UI.addToScope(this.dataset.code)" ${inScope ? 'style="border-color:#065f46;background:#0f1d15;"' : ''}>
          <div style="flex:1;min-width:0;">
            <div class="code">${esc(item.code)}</div>
            <div class="name">${esc((item.name || '').substring(0, 60))}${(item.name || '').length > 60 ? '…' : ''}</div>
          </div>
          <div class="cost">
            <div style="color:#e8eaf0;font-weight:700;">$${unitCost.toFixed(0)}</div>
            <div style="font-size:9px;">/${esc(item.unit)}</div>
            ${inScope ? '<div style="color:#065f46;font-size:9px;margin-top:2px;">✓ IN SCOPE</div>' : ''}
          </div>
        </div>
      `;
    }).join('');

    if (totalCount > limited.length) {
      catDiv.innerHTML += `<div class="v2-empty">Showing ${limited.length} of ${totalCount}. Type to refine search.</div>`;
    }
    if (!items.length) {
      catDiv.innerHTML = '<div class="v2-empty">No items match your search.</div>';
    }
  }

  function renderScope() {
    const listDiv = document.getElementById('v2scopeList');
    const totalEl = document.getElementById('v2total');
    const rollupEl = document.getElementById('v2rollup');
    if (!listDiv) return;

    if (!state.scope.length) {
      listDiv.innerHTML = '<div class="v2-empty">No items selected yet.<br>Pick from catalog or use a preset.</div>';
      totalEl.textContent = '$0';
      rollupEl.innerHTML = '';
      return;
    }

    const estimate = getCurrentEstimate();
    if (!estimate) {
      listDiv.innerHTML = '<div class="v2-empty">Engine loading...</div>';
      return;
    }

    listDiv.innerHTML = estimate.lines.map(line => {
      const safeCode = String(line.code || '').replace(/'/g, "\\'");
      return `
        <div class="v2-scope-item">
          <button class="rm" onclick="EstimateV2UI.removeFromScope('${safeCode}')" title="Remove">×</button>
          <div class="total">$${Math.round(line.lineTotal).toLocaleString()}</div>
          <div class="name">${(line.name || '').substring(0, 38)}</div>
          <div class="qty">${line.quantity.toFixed(line.unit === 'SQ' || line.unit === 'LF' ? 1 : 0)} ${line.unit} · ${line.code}</div>
        </div>
      `;
    }).join('');

    totalEl.textContent = '$' + Math.round(estimate.total).toLocaleString();

    const taxDisplay = estimate.taxRate > 0
      ? `<br>Tax: <strong>$${Math.round(estimate.tax).toLocaleString()}</strong> (${(estimate.taxRate * 100).toFixed(2)}%)`
      : '<br>Tax: <strong>Insurance mode (no tax)</strong>';

    rollupEl.innerHTML = `
      Material: <strong>$${Math.round(estimate.materialRetail).toLocaleString()}</strong><br>
      Labor: <strong>$${Math.round(estimate.laborCost).toLocaleString()}</strong><br>
      OH+Profit: <strong>$${Math.round(estimate.overhead + estimate.profit).toLocaleString()}</strong>
      ${taxDisplay}
      <br><span style="color:#065f46;">Margin: <strong>${estimate.internal.marginPct.toFixed(1)}%</strong> ($${Math.round(estimate.internal.margin).toLocaleString()})</span>
    `;
  }

  function render() {
    renderCatalog();
    renderScope();
  }

  // ═════════════════════════════════════════════════════════
  // Finalization — opens formatted estimate in new window
  // ═════════════════════════════════════════════════════════

  function finalize(format) {
    const estimate = getCurrentEstimate();
    if (!estimate) {
      alert('Add line items to the scope first.');
      return;
    }
    if (!window.EstimateFinalization) {
      alert('Finalization module not loaded.');
      return;
    }
    const meta = {
      customer: state.customer,
      claim: state.claim,
      estimate: {
        number: 'NBD-V2-' + Date.now(),
        date: new Date().toISOString().split('T')[0],
        preparedBy: 'Joe Deal'
      }
    };
    // For retail quote, also pass tier comparison.
    // Line-item mode produces identical totals across tiers because
    // the scope items are fixed. To show real tier differentiation,
    // we use the EstimateBuilderV2 per-SQ calculator which applies
    // the flat $545/$595/$660 rates from locked spec — giving the
    // customer a meaningful good/better/best choice on the quote.
    if (format === 'retail-quote') {
      const perSqInput = {
        rawSqft:         state.measurements.rawSqft,
        pitch:           state.measurements.pitch,
        cutUpRoof:       state.measurements.cutUpRoof,
        ridgeLf:         state.measurements.ridgeLf,
        eaveLf:          state.measurements.eaveLf,
        hipLf:           state.measurements.hipLf,
        pipes:           state.measurements.pipes,
        tearOffLayers:   state.measurements.tearOffLayers,
        county:          state.county,
        city:            state.county,  // permit lookup uses city or county
        mode:            state.jobMode
      };
      if (window.EstimateBuilderV2 && typeof window.EstimateBuilderV2.calculateAllTiers === 'function') {
        meta.tiers = window.EstimateBuilderV2.calculateAllTiers(perSqInput);
      } else {
        // Fallback to the (identical-per-tier) line-item calc if
        // the per-SQ engine is unavailable for some reason
        const cat = window.NBD_XACT_CATALOG;
        const items = state.scope.map(s => cat.find(s.code)).filter(Boolean);
        meta.tiers = {
          good:   window.EstimateLogic.resolveEstimate(items, state.measurements, { tier: 'good',   mode: state.jobMode, county: state.county }),
          better: window.EstimateLogic.resolveEstimate(items, state.measurements, { tier: 'better', mode: state.jobMode, county: state.county }),
          best:   window.EstimateLogic.resolveEstimate(items, state.measurements, { tier: 'best',   mode: state.jobMode, county: state.county })
        };
      }
    }
    const result = window.EstimateFinalization.formatEstimate(estimate, format, meta);
    window.EstimateFinalization.openInNewWindow(result);
  }

  // ═════════════════════════════════════════════════════════
  // Save estimate to Firestore — wires to window._saveEstimate
  // (same function the classic builder uses, so V2 estimates
  // appear in the existing Estimates list + customer records)
  // ═════════════════════════════════════════════════════════

  async function save() {
    const statusEl = document.getElementById('v2saveStatus');
    const btn = document.getElementById('v2saveBtn');
    const setStatus = (msg, color) => {
      if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color || '#888'; }
    };

    // Guard: no scope
    const estimate = getCurrentEstimate();
    if (!estimate) {
      setStatus('Add line items to the scope first.', '#c53030');
      return;
    }

    // Guard: save function missing (e.g., dashboard not loaded)
    if (typeof window._saveEstimate !== 'function') {
      setStatus('Save failed: _saveEstimate not loaded.', '#c53030');
      return;
    }

    // Guard: user not signed in
    if (!window._user?.uid) {
      setStatus('Save failed: not signed in.', '#c53030');
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    setStatus('Saving to Firestore…', '#888');

    try {
      // Match the classic builder's data shape so the estimates
      // list + customer timeline rendering picks up V2 estimates.
      const ctx = estimate.context || {};
      const payload = {
        // Identity
        estimateVersion:  'v2',
        method:           estimate.method || 'line-item',
        tier:             estimate.tier || state.tier,
        mode:             estimate.mode || state.jobMode,
        // Customer association
        leadId:           state.leadId || null,
        addr:             state.customer.address || '',
        owner:            state.customer.name || '',
        // Measurements (echoed so the estimate list can show them)
        raw:              Math.round(ctx.rawSqft || 0),
        adj:              Math.round(ctx.adjustedSqft || 0),
        sq:               Number((ctx.sq || 0).toFixed(2)),
        wf:               ctx.waste || 1.17,
        pl:               String(state.measurements.pitch || 8) + '/12',
        ridge:            ctx.ridgeLf || 0,
        eave:             ctx.eaveLf || 0,
        hip:              ctx.hipLf || 0,
        pipes:            ctx.pipes || 0,
        // Line items in the same shape the classic builder emits
        rows: (estimate.lines || []).map(line => ({
          code:   line.code,
          desc:   line.name,
          qty:    (line.quantity || 0).toFixed(2) + (line.unit || ''),
          rate:   '$' + ((line.materialCostPerUnit || 0) + (line.laborCostPerUnit || 0)).toFixed(2),
          total:  line.lineTotal || 0
        })),
        // Totals
        grandTotal:       estimate.total,
        materialCost:     estimate.materialCost,
        laborCost:        estimate.laborCost,
        subtotal:         estimate.subtotal,
        tax:              estimate.tax,
        taxRate:          estimate.taxRate,
        // Internal margin view
        internal:         estimate.internal || null,
        // Timestamp handled by _saveEstimate (serverTimestamp)
      };

      const savedId = await window._saveEstimate(payload);

      if (savedId) {
        setStatus('✓ Saved — estimate #' + savedId.substring(0, 8) + '…', '#2ECC8A');
        if (typeof window.showToast === 'function') {
          window.showToast('✓ Estimate saved to Firestore', 'success');
        }
        if (btn) { btn.textContent = '✓ Saved — Save Again?'; }
        // Re-enable after 2 seconds so user can save again after changes
        setTimeout(() => {
          if (btn) { btn.disabled = false; btn.textContent = '💾 Save Estimate to Customer'; }
        }, 2000);
      } else {
        setStatus('Save failed — check console.', '#c53030');
        if (btn) { btn.disabled = false; btn.textContent = '💾 Save Estimate to Customer'; }
      }
    } catch (e) {
      console.error('[EstimateV2UI] Save failed:', e);
      setStatus('Save error: ' + e.message, '#c53030');
      if (btn) { btn.disabled = false; btn.textContent = '💾 Save Estimate to Customer'; }
    }
  }

  // ═════════════════════════════════════════════════════════
  // Public API
  // ═════════════════════════════════════════════════════════

  function open() {
    ensureModal();
    document.getElementById('estV2Modal').classList.add('open');
    render();
  }

  function close() {
    const m = document.getElementById('estV2Modal');
    if (m) m.classList.remove('open');
  }

  window.EstimateV2UI = {
    open,
    close,
    setMode,
    setJobMode,
    updateMeasurement,
    setSearch,
    setCategory,
    addToScope,
    removeFromScope,
    clearScope,
    loadPreset,
    finalize,
    save,
    getState: () => state
  };

  // Global launchers matched in dashboard.html
  window.openEstimateV2Builder = open;
  window.closeEstimateV2Builder = close;

  console.log('[EstimateV2UI] Modal builder ready. Trigger: openEstimateV2Builder()');
})();
