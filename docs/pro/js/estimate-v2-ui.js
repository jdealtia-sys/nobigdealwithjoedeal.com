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
    categoryFilter: 'all',
    // Per-job minimum-charge floor. null means "use engine default"
    // ($2500). Presets can override this — e.g. Shingle Patch sets
    // it to $500 so tiny jobs don't get bumped to the full-job floor.
    minJobCharge: null
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
        /* Safe-area insets so the header isn't clipped under the notch
           and the footer isn't clipped by the home indicator. */
        padding-top: env(safe-area-inset-top, 0);
        padding-bottom: env(safe-area-inset-bottom, 0);
        padding-left: env(safe-area-inset-left, 0);
        padding-right: env(safe-area-inset-right, 0);
      }
      #estV2Modal.open { display:flex; flex-direction:column; }
      .v2-hdr {
        background:#111418; border-bottom:2px solid #e8720c;
        padding:12px 20px;
        display:flex; justify-content:space-between; align-items:center;
        flex-shrink:0;
        gap:12px;
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
      /* Close button: iOS HIG minimum 44x44 tap target, clearly
         visible, orange-filled on mobile so it's impossible to miss. */
      .v2-close {
        background:#e8720c; border:1px solid #e8720c; color:#fff;
        padding:10px 18px; cursor:pointer; font-weight:700;
        border-radius:6px; font-size:13px;
        min-height:44px; min-width:44px;
        display:inline-flex; align-items:center; justify-content:center;
        flex-shrink:0;
        font-family:inherit;
        letter-spacing:.04em;
        transition:background .15s, transform .12s;
        -webkit-tap-highlight-color:transparent;
        touch-action:manipulation;
      }
      .v2-close:hover { background:#ff8420; border-color:#ff8420; }
      .v2-close:active { transform:scale(.95); }
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
        /* Keep the 44×44 tap target on mobile — only trim label
           length if the header runs tight. */
        .v2-close { padding: 10px 14px; font-size: 12px; min-height:44px; }
        .v2-total-val { font-size: 32px !important; }
      }
      /* Extra-small phones (iPhone SE, 320px): stack header vertically
         to avoid crowding the close button against the title. */
      @media (max-width: 380px) {
        .v2-hdr { flex-wrap: wrap; padding: 8px 12px; gap: 8px; }
        .v2-title { font-size: 14px !important; }
        .v2-title + .v2-title { margin-left: 8px !important; }
        .v2-close { width: 100%; }
      }
      .v2-section {
        font-family:'Barlow Condensed',sans-serif; font-size:11px;
        font-weight:700; text-transform:uppercase; letter-spacing:.15em;
        color:#e8720c; margin:16px 0 8px; padding:6px 8px 6px 4px;
        border-bottom:1px solid #2a2f35;
        cursor:pointer; user-select:none;
        display:flex; align-items:center; justify-content:space-between;
        -webkit-tap-highlight-color:transparent; touch-action:manipulation;
        min-height:32px;
      }
      .v2-section:first-child { margin-top:0; }
      .v2-section::after {
        content:'−';
        font-size:16px; line-height:1; color:#e8720c;
        margin-left:8px; transition:transform .15s;
      }
      .v2-section.collapsed::after { content:'+'; }
      .v2-section-content {
        overflow:hidden;
        transition:max-height .2s ease, opacity .2s ease, margin .2s ease;
        max-height:5000px; /* large enough for any content */
        opacity:1;
      }
      .v2-section.collapsed + .v2-section-content {
        max-height:0 !important;
        opacity:0;
        margin:0 !important;
        pointer-events:none;
      }

      /* On small screens: make the panes flex so collapsed sections let
         the open one breathe. Each pane scrolls independently, so the
         items list can fill the entire middle pane when the measurements
         + scope sections are collapsed. */
      @media (max-width: 1000px) {
        #estV2Modal.open .v2-body { min-height:0; }
        .v2-pane { display:flex; flex-direction:column; }
        .v2-pane > .v2-section-content { flex:0 0 auto; }
        /* The catalog list is the one content area that must always
           be free to grow, so give it flex:1 inside its pane. */
        .v2-pane #v2items { flex:1 1 auto; min-height:200px; }
      }
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
      .v2-scope-item.overridden { border-left-color:#22d3ee; }
      .v2-scope-item .name { color:#e8eaf0; font-weight:600; }
      .v2-scope-item .qty {
        color:#888; font-size:10px; margin-top:2px;
        font-variant-numeric:tabular-nums;
      }
      .v2-scope-item.overridden .qty { color:#22d3ee; }
      .v2-scope-item .total {
        color:#e8720c; font-weight:700; font-size:13px; float:right;
        font-variant-numeric:tabular-nums;
      }
      .v2-scope-item .actions {
        float:right; display:flex; gap:4px; margin-left:8px;
      }
      .v2-scope-item .rm,
      .v2-scope-item .edit-qty {
        background:none; border:none; color:#666; cursor:pointer;
        font-size:14px; padding:2px 6px; border-radius:3px;
        min-width:28px; min-height:28px;
        display:inline-flex; align-items:center; justify-content:center;
        transition:color .15s, background .15s;
      }
      .v2-scope-item .edit-qty { font-size:12px; }
      .v2-scope-item .edit-qty:hover { color:#22d3ee; background:rgba(34,211,238,.08); }
      .v2-scope-item .rm:hover { color:#c53030; background:rgba(197,48,48,.08); }
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
        <button class="v2-close" type="button" data-action="close">✕ Close</button>
      </div>

      <div class="v2-body">
        <!-- LEFT: Measurements + Mode + Customer -->
        <div class="v2-pane">
          <div class="v2-section">Mode</div>
          <div class="v2-tabs">
            <button id="v2modePerSq" type="button" data-action="set-mode" data-arg="per-sq">Per-SQ</button>
            <button id="v2modeLine" type="button" class="active" data-action="set-mode" data-arg="line-item">Line-Item</button>
          </div>
          <div class="v2-tabs">
            <button id="v2jobInsurance" type="button" class="active" data-action="set-job-mode" data-arg="insurance">Insurance</button>
            <button id="v2jobCash" type="button" data-action="set-job-mode" data-arg="cash">Cash</button>
          </div>

          <div class="v2-section">Measurements</div>
          <div class="v2-field">
            <label>Raw Roof Area (SF)</label>
            <input type="number" id="v2rawSqft" placeholder="3900" data-field="rawSqft">
          </div>
          <div class="v2-field">
            <label>Pitch (rise/12)</label>
            <select id="v2pitch" data-field="pitch">
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
            <input type="number" id="v2eaveLf" placeholder="120" data-field="eaveLf">
          </div>
          <div class="v2-field">
            <label>Rake LF</label>
            <input type="number" id="v2rakeLf" placeholder="50" data-field="rakeLf">
          </div>
          <div class="v2-field">
            <label>Ridge LF</label>
            <input type="number" id="v2ridgeLf" placeholder="45" data-field="ridgeLf">
          </div>
          <div class="v2-field">
            <label>Hip LF</label>
            <input type="number" id="v2hipLf" placeholder="20" data-field="hipLf">
          </div>
          <div class="v2-field">
            <label>Valley LF</label>
            <input type="number" id="v2valleyLf" placeholder="32" data-field="valleyLf">
          </div>
          <div class="v2-field">
            <label>Pipes (count)</label>
            <input type="number" id="v2pipes" placeholder="4" data-field="pipes">
          </div>
          <div class="v2-field">
            <label>Chimneys (count)</label>
            <input type="number" id="v2chimneys" placeholder="1" data-field="chimneys">
          </div>
          <div class="v2-field">
            <label>Skylights (count)</label>
            <input type="number" id="v2skylights" placeholder="0" data-field="skylights">
          </div>
          <div class="v2-field">
            <label>Tear-off Layers</label>
            <select id="v2layers" data-field="tearOffLayers">
              <option value="1">1 Layer</option>
              <option value="2">2 Layers</option>
              <option value="3">3 Layers</option>
            </select>
          </div>
          <div class="v2-field">
            <label>Stories</label>
            <select id="v2stories" data-field="stories">
              <option value="1">1 Story</option>
              <option value="2">2 Story</option>
              <option value="3">3 Story</option>
            </select>
          </div>
          <div class="v2-field inline">
            <label>Cut-up Roof (+3% waste)</label>
            <input type="checkbox" id="v2cutup" data-field="cutUpRoof">
          </div>

          <div class="v2-section">Presets</div>
          <div class="v2-preset-btns">
            <button type="button" data-action="load-preset" data-arg="standard-reroof">Standard Reroof</button>
            <button type="button" data-action="load-preset" data-arg="storm-claim">Storm Claim</button>
            <button type="button" data-action="load-preset" data-arg="small-repair">Small Repair</button>
            <button type="button" data-action="load-preset" data-arg="shingle-patch">Shingle Patch</button>
            <button type="button" data-action="load-preset" data-arg="full-redeck">Full Redeck</button>
            <button type="button" data-action="load-preset" data-arg="hail-damage-insurance" style="grid-column:span 2;">Hail Damage Insurance</button>
          </div>
        </div>

        <!-- MIDDLE: Catalog picker -->
        <div class="v2-pane">
          <div class="v2-section">Line Item Catalog (270 items)</div>
          <input type="text" class="v2-search" id="v2search" placeholder="Search by code, name, or tag..." data-action="search">
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
            <button type="button" data-action="finalize" data-arg="insurance-scope">📋 Insurance Scope</button>
            <button type="button" data-action="finalize" data-arg="retail-quote">💼 Retail Quote</button>
            <button type="button" data-action="finalize" data-arg="internal-view">🔒 Internal</button>
          </div>

          <div class="v2-section">Save</div>
          <button id="v2saveBtn" type="button" data-action="save"
            style="width:100%;background:#e8720c;border:none;color:#fff;padding:14px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;cursor:pointer;border-radius:4px;font-family:inherit;">
            💾 Save Estimate to Customer
          </button>
          <div id="v2saveStatus" style="font-size:10px;color:#888;margin-top:6px;text-align:center;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // ─────────────────────────────────────────────────────
    // Wrap each .v2-section header's following siblings into
    // a .v2-section-content block so the section can be
    // collapsed by toggling a class on the header. This runs
    // once, right after the modal DOM is created.
    // ─────────────────────────────────────────────────────
    modal.querySelectorAll('.v2-pane').forEach(pane => {
      const sections = Array.from(pane.querySelectorAll('.v2-section'));
      sections.forEach((hdr, i) => {
        const next = sections[i + 1] || null;
        const wrapper = document.createElement('div');
        wrapper.className = 'v2-section-content';
        // Move every sibling between this header and the next header
        // (or the end of the pane) into the wrapper.
        let cursor = hdr.nextSibling;
        while (cursor && cursor !== next) {
          const toMove = cursor;
          cursor = cursor.nextSibling;
          wrapper.appendChild(toMove);
        }
        hdr.parentNode.insertBefore(wrapper, next);
      });

      // On screens ≤1000px, start with everything EXCEPT the catalog
      // section collapsed so the items list is front-and-center. The
      // user can expand measurements/presets/scope on demand.
      if (window.innerWidth <= 1000) {
        pane.querySelectorAll('.v2-section').forEach(hdr => {
          const txt = (hdr.textContent || '').trim().toLowerCase();
          if (txt.startsWith('line item catalog')) return; // keep this expanded
          hdr.classList.add('collapsed');
        });
      }
    });

    // Click-to-toggle. Delegation keeps it robust against re-renders
    // inside the sections.
    modal.addEventListener('click', (ev) => {
      const hdr = ev.target.closest('.v2-section');
      if (!hdr || !modal.contains(hdr)) return;
      // Ignore clicks inside inputs/buttons that happen to be inside a
      // section header (shouldn't happen given the markup, but defensive).
      if (ev.target.closest('input, select, textarea, button')) return;
      hdr.classList.toggle('collapsed');
    });

    // ─────────────────────────────────────────────────────
    // CSP-strict-safe delegated click handler. Every button in
    // the modal uses data-action + optional data-arg instead of
    // an inline onclick attribute. One listener dispatches them
    // all so the file runs clean under the Report-Only CSP
    // (script-src-attr 'none').
    // ─────────────────────────────────────────────────────
    modal.addEventListener('click', (ev) => {
      const target = ev.target.closest('[data-action]');
      if (!target || !modal.contains(target)) return;
      // Skip non-button elements that happen to have data-action
      // further up the chain (inputs handle their own events below).
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;

      const action = target.dataset.action;
      const arg    = target.dataset.arg;
      switch (action) {
        case 'close':
          close();
          break;
        case 'set-mode':
          if (arg) setMode(arg);
          break;
        case 'set-job-mode':
          if (arg) setJobMode(arg);
          break;
        case 'load-preset':
          if (arg) loadPreset(arg);
          break;
        case 'finalize':
          if (arg) finalize(arg);
          break;
        case 'save':
          save();
          break;
        case 'set-category':
          setCategory(arg || 'all');
          break;
        case 'add-to-scope': {
          const code = target.dataset.code;
          if (code) addToScope(code);
          break;
        }
        case 'remove-from-scope': {
          const item = target.closest('.v2-scope-item');
          const code = item && item.dataset.code;
          if (code) removeFromScope(code);
          break;
        }
        case 'override-qty': {
          const item = target.closest('.v2-scope-item');
          const code = item && item.dataset.code;
          if (code) overrideQty(code);
          break;
        }
      }
    });

    // ─────────────────────────────────────────────────────
    // CSP-strict-safe delegated input/change handler. Every
    // measurement input / select / checkbox has data-field set
    // to the state key it updates. One listener pipes them all
    // through updateMeasurement().
    // The search input uses data-action="search" instead so
    // it routes to setSearch() (it's not a measurement field).
    // ─────────────────────────────────────────────────────
    const fieldInputHandler = (ev) => {
      const el = ev.target;
      if (!el || !modal.contains(el)) return;

      // Search input → setSearch
      if (el.dataset.action === 'search') {
        setSearch(el.value);
        return;
      }
      // Measurement field → updateMeasurement
      const field = el.dataset.field;
      if (!field) return;
      const value = (el.type === 'checkbox') ? el.checked : el.value;
      updateMeasurement(field, value);
    };
    // input fires for text/number/search; change fires for select/checkbox
    modal.addEventListener('input', fieldInputHandler);
    modal.addEventListener('change', fieldInputHandler);
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

  // Manual quantity override. Opens a prompt seeded with the current
  // computed quantity so the user can type the exact value they want
  // (e.g. 2 squares for a tiny repair, 15 LF of drip edge instead of
  // the auto-calculated full perimeter). Passing an empty string or
  // "auto" clears the override and reverts to the formula.
  function overrideQty(code) {
    const scopeEntry = state.scope.find(s => s.code === code);
    if (!scopeEntry) return;
    const estimate = getCurrentEstimate();
    const line = estimate && estimate.lines.find(l => l.code === code);
    if (!line) return;

    const unit = line.unit || '';
    const qtyDecimals = (unit === 'SQ' || unit === 'LF') ? 1 : 0;
    const current = (Number(line.quantity) || 0).toFixed(qtyDecimals);
    const msg = 'Edit quantity for ' + (line.name || code) + ' (' + unit + ')\n\n'
      + 'Current: ' + current + ' ' + unit + '\n'
      + 'Enter a number to override, or leave blank to revert to auto-calculation.';
    // eslint-disable-next-line no-alert
    const input = window.prompt(msg, line.qtyOverridden ? current : '');
    if (input === null) return;  // user hit Cancel

    scopeEntry.overrides = scopeEntry.overrides || {};
    const trimmed = String(input).trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'auto') {
      // Revert to formula
      delete scopeEntry.overrides.qty;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0) {
        // eslint-disable-next-line no-alert
        window.alert('Please enter a non-negative number (or blank to revert).');
        return;
      }
      scopeEntry.overrides.qty = n;
    }
    render();
  }

  function clearScope() {
    state.scope = [];
    render();
  }

  // Sync state.measurements back into the DOM inputs. Used when a
  // preset carries its own measurement defaults so the user actually
  // sees the new rawSqft / eaveLf / etc. numbers reflected in the
  // left pane, not just in the total.
  function syncMeasurementInputs() {
    const map = {
      rawSqft: 'v2rawSqft', pitch: 'v2pitch', eaveLf: 'v2eaveLf',
      rakeLf: 'v2rakeLf', ridgeLf: 'v2ridgeLf', hipLf: 'v2hipLf',
      valleyLf: 'v2valleyLf', pipes: 'v2pipes', chimneys: 'v2chimneys',
      skylights: 'v2skylights', tearOffLayers: 'v2layers', stories: 'v2stories'
    };
    Object.keys(map).forEach(key => {
      const el = document.getElementById(map[key]);
      if (!el) return;
      const v = state.measurements[key];
      el.value = (v == null ? '' : String(v));
    });
    const cutupEl = document.getElementById('v2cutup');
    if (cutupEl) cutupEl.checked = !!state.measurements.cutUpRoof;
  }

  // Presets are objects, not bare code lists. Each preset declares:
  //   codes        — the line items to add
  //   measurements — optional measurement defaults to load (null =
  //                  keep whatever the user already typed)
  //
  // Full-roof presets (Standard Reroof, Storm Claim, Full Redeck,
  // Hail Insurance) keep measurements:null because those ARE full-
  // roof jobs and the user should type their real measurements first.
  //
  // Repair presets (Small Repair, Shingle Patch) ship with baked-in
  // small-job defaults so the line items scale to the repair size
  // instead of inheriting whatever the user had typed before.
  //
  // Disposal line choice: full-roof presets use DSP 30YD / DSP 40YD
  // (formula-gated by sq). Repair presets use DSP HAUL which is
  // manual-entry so user types their actual disposal cost.
  const PRESETS = {
    // Standard Reroof: bread-and-butter cash/insurance reroof with
    // all the finish flashing most houses actually need. Adds
    // chimney + step flashing which the prior preset was missing,
    // so the quote doesn't short the field crew on flashing labor.
    //
    // Dumpster sizes: we include all three sq-gated sizes so the
    // engine's self-selecting formulas pick exactly one based on
    // the actual roof size. A 22-sq roof gets 20YD, a 33-sq roof
    // gets 30YD, a 45-sq roof gets 40YD. The other two resolve
    // to qty=0 and sit at $0 in the scope list. User can remove
    // the zero-qty ones if they want a cleaner quote.
    'standard-reroof': {
      codes: [
        'LAB TO1', 'RFG 240-GAF-HDZ', 'RFG SYN', 'RFG IWS', 'RFG STRT',
        'RFG DRPE-AL', 'RFG RIDG-ARC', 'RFG VLY-W', 'RFG PIPE-LD',
        'RFG CHIM-STD', 'RFG STPF-AL',
        'RFG RIDG-VNT', 'RFG NAIL-C',
        'DSP 20YD', 'DSP 30YD', 'DSP 40YD',
        'PRM RES-OH', 'LAB MOB', 'LAB DEMOB', 'LAB CLN-M'
      ],
      measurements: null
    },
    // Storm Claim: Standard Reroof + insurance documentation lines
    // (LAB PHOTO, LAB WALK for adjuster walk, CUP IWS-E, CUP KICK).
    // Uses premium nail gun line and adds step flashing.
    'storm-claim': {
      codes: [
        'LAB TO1', 'RFG 240-GAF-HDZ', 'RFG SYN', 'RFG IWS', 'RFG STRT',
        'RFG DRPE-AL', 'RFG RIDG-ARC', 'RFG VLY-W', 'RFG PIPE-LD',
        'RFG CHIM-STD', 'RFG STPF-AL',
        'RFG RIDG-VNT', 'RFG NAIL-LUMA',
        'DSP 20YD', 'DSP 30YD', 'DSP 40YD',
        'PRM RES-OH', 'LAB MOB', 'LAB DEMOB', 'LAB CLN-M', 'LAB PHOTO',
        'LAB WALK', 'CUP IWS-E', 'CUP KICK'
      ],
      measurements: null
    },
    // Small Repair: 2 squares, ~20 LF of eave. Uses DSP HAUL (manual)
    // so a 10-yd dumpster doesn't get auto-zero'd by its sq-gate.
    // User can tweak rawSqft/eaveLf for their specific repair area.
    // $2,500 min-job floor applies — a crew roll-out isn't worth less.
    'small-repair': {
      codes: [
        'LAB TO1', 'RFG 240-GAF-HDZ', 'RFG SYN', 'RFG STRT', 'RFG DRPE-AL',
        'DSP HAUL', 'LAB MOB', 'LAB CLN-M'
      ],
      measurements: {
        rawSqft: 200, pitch: 8, waste: 1.15,
        ridgeLf: 0, eaveLf: 20, rakeLf: 0, hipLf: 0, valleyLf: 0, wallLf: 0,
        pipes: 0, chimneys: 0, skylights: 0, stories: 1,
        tearOffLayers: 1, deckReplacePct: 0, cutUpRoof: false
      },
      minJobCharge: 2500
    },
    // Shingle Patch: truly tiny — 10 SF / ~1 square foot of repair.
    // Barebones scope: tear-off labor, shingles, detail hourly,
    // haul-it disposal. User fills in DSP HAUL + LAB DTL-HR with
    // real numbers via the qty-override pencil.
    // $500 min-job floor — this is a trip charge, not a job-level min.
    'shingle-patch': {
      codes: [
        'LAB TO1', 'RFG 240-GAF-HDZ', 'RFG NAIL-C',
        'LAB DTL-HR', 'DSP HAUL'
      ],
      measurements: {
        rawSqft: 10, pitch: 8, waste: 1.10,
        ridgeLf: 0, eaveLf: 0, rakeLf: 0, hipLf: 0, valleyLf: 0, wallLf: 0,
        pipes: 0, chimneys: 0, skylights: 0, stories: 1,
        tearOffLayers: 1, deckReplacePct: 0, cutUpRoof: false
      },
      minJobCharge: 500
    },
    // Full Redeck: 100% deck replacement. Without this override the
    // engine used deckReplacePct=0.15 (15%) from the default — a
    // critical bug that made Full Redeck quotes read like Standard
    // Reroof quotes with an extra OSB line at 15% coverage. Now we
    // force deckReplacePct=1.0 so all decking lines scale to full
    // adjustedSqft. Also adds step flashing for completeness.
    'full-redeck': {
      codes: [
        'LAB TO1', 'RFG OSB716', 'RFG 240-GAF-HDZ', 'RFG SYN', 'RFG IWS',
        'RFG STRT', 'RFG DRPE-AL', 'RFG RIDG-ARC', 'RFG VLY-W', 'RFG PIPE-LD',
        'RFG CHIM-STD', 'RFG STPF-AL',
        'RFG RIDG-VNT', 'RFG NAIL-LUMA',
        'DSP 30YD', 'DSP 40YD',
        'PRM RES-OH', 'LAB MOB', 'LAB DEMOB', 'LAB CLN-M'
      ],
      // Partial measurement override — only the keys listed get
      // merged in, preserving whatever the user typed for rawSqft
      // / ridge / eave / etc. from their real measurements.
      measurements: {
        deckReplacePct: 1.0
      }
    },
    // Hail Damage Insurance: impact-rated shingles, code upgrades,
    // hurricane clips, chimney saddle, step flashing, full
    // insurance doc package. This is the premium claim scope.
    'hail-damage-insurance': {
      codes: [
        'LAB TO1', 'RFG ARM-GAF', 'RFG SYN-P', 'RFG IWS', 'RFG STRT-PS',
        'RFG DRPE-AL', 'RFG RIDG-IMP', 'RFG VLY-W', 'RFG PIPE-LD',
        'RFG CHIM-STD', 'RFG CHIM-SAD', 'RFG STPF-AL',
        'RFG RIDG-VNT-PR', 'RFG NAIL-LUMA',
        'DSP 30YD', 'PRM RES-OH', 'LAB MOB', 'LAB DEMOB', 'LAB CLN-M',
        'LAB PHOTO', 'LAB WALK', 'CUP IWS-E', 'CUP KICK', 'CUP HC'
      ],
      measurements: null
    }
  };

  function loadPreset(presetKey) {
    clearScope();
    const preset = PRESETS[presetKey];
    if (!preset) return;
    // If the preset ships its own measurements, overwrite state +
    // sync the DOM so the user sees the change. Otherwise leave the
    // user's typed measurements alone.
    if (preset.measurements) {
      state.measurements = Object.assign({}, state.measurements, preset.measurements);
      syncMeasurementInputs();
    }
    // Per-preset min job charge. Presets without a floor fall back
    // to the engine default ($2500). Repair presets drop it to $500
    // so a Shingle Patch quote shows the real cost instead of the
    // full-job crew-rollout minimum.
    state.minJobCharge = (preset.minJobCharge != null) ? preset.minJobCharge : null;
    (preset.codes || []).forEach(c => state.scope.push({ code: c, overrides: {} }));
    render();
  }

  // ═════════════════════════════════════════════════════════
  // Rendering
  // ═════════════════════════════════════════════════════════

  function getCurrentEstimate() {
    const cat = window.NBD_XACT_CATALOG;
    if (!cat) return null;
    // Merge each scope entry's override.qty onto the catalog item
    // so resolveLineItem() can skip the formula. Non-destructive —
    // we spread a fresh object so the catalog's original item stays
    // untouched and other consumers see clean data.
    const items = state.scope.map(s => {
      const base = cat.find(s.code);
      if (!base) return null;
      const ov = s.overrides && s.overrides.qty;
      if (ov !== undefined && ov !== null && ov !== '') {
        return Object.assign({}, base, { _qtyOverride: Number(ov) });
      }
      return base;
    }).filter(Boolean);
    if (!items.length) return null;
    if (!window.EstimateLogic) return null;
    const settings = {
      tier: state.tier,
      mode: state.jobMode,
      county: state.county
    };
    // Only pass minJobCharge if the preset/user set one — otherwise
    // the engine uses its own $2500 default. null means "use default".
    if (state.minJobCharge != null) {
      settings.minJobCharge = state.minJobCharge;
    }
    return window.EstimateLogic.resolveEstimate(items, state.measurements, settings);
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

    // Category chips — use data-action + data-arg so the
    // delegated click handler dispatches them, keeping this
    // file CSP-strict (no inline onclick attributes).
    const escAttr = (s) => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const cats = Object.keys(cat.byCategory || {}).sort();
    catTabs.innerHTML = [
      `<button type="button" class="${state.categoryFilter === 'all' ? 'active' : ''}" data-action="set-category" data-arg="all">All</button>`,
      ...cats.map(c =>
        `<button type="button" class="${state.categoryFilter === c ? 'active' : ''}" data-action="set-category" data-arg="${escAttr(c)}">${escAttr(c)} (${cat.byCategory[c].length})</button>`
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
      // data-code is read by the delegated click handler installed
      // on #v2items in ensureModal(). No inline onclick attribute so
      // this stays clean under the Report-Only CSP (script-src-attr 'none').
      return `
        <div class="v2-item" data-action="add-to-scope" data-code="${esc(item.code)}" ${inScope ? 'style="border-color:#065f46;background:#0f1d15;"' : ''}>
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

    // Escape every interpolated value so catalog data (today trusted,
    // tomorrow possibly user-editable) can never smuggle markup into
    // the scope list. Consistent with the data-code pattern introduced
    // in the CRITICAL-1 fix for the catalog renderer above.
    const escLocal = (s) => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    // Hide zero-qty dumpster lines (DSP 20YD / 30YD / 40YD) so
    // when a preset loads all three sizes only the one the engine
    // self-selected for the actual roof size actually renders.
    // User can still remove the live one via the × button; if they
    // want an alternate size, they re-add from the catalog.
    // Only dumpster codes are filtered — every other zero-qty line
    // (e.g. step flashing with wallLf=0) still shows so the user
    // can see what's in scope and pencil a quantity in.
    const visibleLines = estimate.lines.filter(line => {
      if (line.quantity > 0) return true;
      // Filter zero-qty auto-gated dumpsters
      if (/^DSP\s+\d+YD$/.test(line.code)) return false;
      return true;
    });

    listDiv.innerHTML = visibleLines.map(line => {
      const qtyDecimals = (line.unit === 'SQ' || line.unit === 'LF') ? 1 : 0;
      const safeQty = (Number(line.quantity) || 0).toFixed(qtyDecimals);
      const overridden = !!line.qtyOverridden;
      // data-action + data-code get picked up by the delegated click
      // handler on #v2scopeList installed in ensureModal(). Clean under
      // Report-Only CSP (script-src-attr 'none') — zero inline onclicks.
      // The pencil (edit-qty) lets the user set a manual quantity that
      // bypasses the measurement-based formula.
      return `
        <div class="v2-scope-item${overridden ? ' overridden' : ''}" data-code="${escLocal(line.code)}">
          <div class="actions">
            <button class="edit-qty" type="button" data-action="override-qty" title="Edit quantity">✎</button>
            <button class="rm" type="button" data-action="remove-from-scope" title="Remove">×</button>
          </div>
          <div class="total">$${Math.round(Number(line.lineTotal) || 0).toLocaleString()}</div>
          <div class="name">${escLocal((line.name || '').substring(0, 38))}</div>
          <div class="qty">${safeQty} ${escLocal(line.unit)} · ${escLocal(line.code)}${overridden ? ' · <span style="color:#22d3ee;">manual</span>' : ''}</div>
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
    // Route through the Universal Document Viewer so the user
    // can Save, Email, Print, or Download PDF without being
    // dumped into a blank popup with no way back.
    if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
      const titleMap = {
        'insurance-scope': 'Insurance Scope',
        'retail-quote': 'Retail Quote',
        'internal': 'Internal Estimate View'
      };
      const titleSuffix = state.customer.address
        ? ' — ' + state.customer.address
        : '';
      window.NBDDocViewer.open({
        html: result.html,
        title: (titleMap[format] || 'Estimate') + titleSuffix,
        filename: 'NBD-' + (titleMap[format] || 'Estimate').replace(/\s+/g, '-')
          + '-' + new Date().toISOString().split('T')[0] + '.pdf',
        onSave: async () => {
          // Wire the doc viewer's "Save to Customer" button to
          // the same Firestore write the Save button in the
          // bottom-left corner of the builder uses.
          await save();
        }
      });
    } else {
      // Fallback: original popup behavior if the viewer isn't loaded
      window.EstimateFinalization.openInNewWindow(result);
    }
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
      // Estimate name: use typed name if any, else synthesize one
      // from customer + tier so the list row is still recognizable
      // (matches the pattern used by the classic builder).
      const existingName = (state.estimateName || '').trim();
      const fallbackName = (state.customer.address || '').trim()
        || (state.customer.name ? state.customer.name.trim() + ' estimate' : '')
        || 'V2 Estimate ' + new Date().toLocaleDateString();
      const payload = {
        // Identity
        name:             existingName || fallbackName,
        builder:          'v2',
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
