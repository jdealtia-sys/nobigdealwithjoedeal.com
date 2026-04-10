// ═══════════════════════════════════════════════════════════════════════
// MATERIAL CATALOG - Pre-loaded database with 25+ common items
// ═══════════════════════════════════════════════════════════════════════

window.materialCatalog = [
  // ─────── ROOFING MATERIALS ───────
  { id: 'roof_shingles_arch', name: 'Architectural Shingles (30-yr)', category: 'roofing', unit: 'SQ', sellPrice: 150, section: 'Roofing Materials', costPrice: 85 },
  { id: 'roof_shingles_3tab', name: '3-Tab Shingles (25-yr)', category: 'roofing', unit: 'SQ', sellPrice: 110, section: 'Roofing Materials', costPrice: 65 },
  { id: 'roof_underlayment_felt', name: 'Felt Underlayment (#30)', category: 'roofing', unit: 'SQ', sellPrice: 25, section: 'Roofing Materials', costPrice: 12 },
  { id: 'roof_underlayment_synthetic', name: 'Synthetic Underlayment', category: 'roofing', unit: 'SQ', sellPrice: 45, section: 'Roofing Materials', costPrice: 22 },
  { id: 'roof_ice_water', name: 'Ice & Water Shield', category: 'roofing', unit: 'SQ', sellPrice: 65, section: 'Roofing Materials', costPrice: 32 },
  { id: 'roof_ridge_vent', name: 'Ridge Vent', category: 'roofing', unit: 'LF', sellPrice: 4.50, section: 'Roofing Materials', costPrice: 2.25 },
  { id: 'roof_drip_edge', name: 'Drip Edge (Aluminum)', category: 'roofing', unit: 'LF', sellPrice: 2.75, section: 'Roofing Materials', costPrice: 1.40 },
  { id: 'roof_valley_flashing', name: 'Valley Flashing', category: 'roofing', unit: 'LF', sellPrice: 8.50, section: 'Roofing Materials', costPrice: 4.25 },
  { id: 'roof_pipe_boot', name: 'Pipe Boot Flashing', category: 'roofing', unit: 'EA', sellPrice: 18, section: 'Roofing Materials', costPrice: 8 },
  { id: 'roof_chimney_flash', name: 'Chimney Flashing Kit', category: 'roofing', unit: 'EA', sellPrice: 120, section: 'Roofing Materials', costPrice: 60 },
  
  // ─────── ROOFING LABOR ───────
  { id: 'labor_tearoff_1layer', name: 'Tear-off (1 Layer)', category: 'roofing', unit: 'SQ', sellPrice: 65, section: 'Roofing Labor', costPrice: 0, laborCost: 35 },
  { id: 'labor_tearoff_2layer', name: 'Tear-off (2 Layers)', category: 'roofing', unit: 'SQ', sellPrice: 95, section: 'Roofing Labor', costPrice: 0, laborCost: 55 },
  { id: 'labor_install_shingles', name: 'Install Shingles', category: 'roofing', unit: 'SQ', sellPrice: 85, section: 'Roofing Labor', costPrice: 0, laborCost: 45 },
  { id: 'labor_osb_decking', name: 'OSB Decking Replacement', category: 'roofing', unit: 'SQ', sellPrice: 125, section: 'Roofing Labor', costPrice: 45, laborCost: 40 },
  { id: 'labor_dumpster', name: 'Dumpster Rental (30-yard)', category: 'roofing', unit: 'EA', sellPrice: 450, section: 'Roofing Labor', costPrice: 275, laborCost: 0 },
  
  // ─────── GUTTERS ───────
  { id: 'gutter_seamless_6in', name: 'Seamless Gutters (6")', category: 'gutters', unit: 'LF', sellPrice: 12, section: 'Gutters', costPrice: 5.50 },
  { id: 'gutter_downspout', name: 'Downspouts (3x4)', category: 'gutters', unit: 'LF', sellPrice: 8.50, section: 'Gutters', costPrice: 4 },
  { id: 'gutter_guards', name: 'Gutter Guards (Mesh)', category: 'gutters', unit: 'LF', sellPrice: 9, section: 'Gutters', costPrice: 4.50 },
  
  // ─────── SIDING ───────
  { id: 'siding_vinyl', name: 'Vinyl Siding', category: 'siding', unit: 'SQ', sellPrice: 185, section: 'Siding', costPrice: 95 },
  { id: 'siding_fiber_cement', name: 'Fiber Cement Siding', category: 'siding', unit: 'SQ', sellPrice: 425, section: 'Siding', costPrice: 225 },
  { id: 'soffit_vinyl', name: 'Vinyl Soffit', category: 'siding', unit: 'SQ', sellPrice: 95, section: 'Siding', costPrice: 45 },
  { id: 'fascia_aluminum', name: 'Aluminum Fascia', category: 'siding', unit: 'LF', sellPrice: 11, section: 'Siding', costPrice: 5.50 },
  
  // ─────── SPECIALTY ───────
  { id: 'skylight_install', name: 'Skylight Installation', category: 'specialty', unit: 'EA', sellPrice: 850, section: 'Specialty', costPrice: 425, laborCost: 225 },
  { id: 'turbine_vent', name: 'Turbine Vent', category: 'specialty', unit: 'EA', sellPrice: 185, section: 'Specialty', costPrice: 75, laborCost: 45 },
  { id: 'box_vent', name: 'Box Vent (Static)', category: 'specialty', unit: 'EA', sellPrice: 65, section: 'Specialty', costPrice: 25, laborCost: 20 },
];

window.openMaterialCatalog = function() {
  const modal = document.createElement('div');
  modal.id = 'materialCatalogModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10001;';
  
  modal.innerHTML = `
    <div style="background:var(--s);border-radius:12px;max-width:900px;width:95%;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:25px;border-bottom:2px solid var(--br);">
        <h2 style="margin:0 0 15px 0;font-size:24px;color:var(--t);">📦 Material Catalog</h2>
        <input type="text" id="catalogSearchInput" placeholder="Search materials..."
               oninput="filterMaterialCatalog()"
               style="width:100%;padding:12px;border:1px solid var(--br);border-radius:6px;font-size:14px;">
      </div>
      
      <div id="catalogItemsContainer" style="flex:1;overflow-y:auto;padding:20px;">
        ${renderCatalogItems('')}
      </div>
      
      <div style="padding:20px;border-top:2px solid var(--br);text-align:right;">
        <button onclick="closeMaterialCatalog();" 
                style="background:#6c757d;color:white;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;">
          Close
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
};

window.closeMaterialCatalog = function() {
  const modal = document.getElementById('materialCatalogModal');
  if (modal) modal.remove();
};

window.filterMaterialCatalog = function() {
  const searchTerm = document.getElementById('catalogSearchInput').value.toLowerCase();
  const container = document.getElementById('catalogItemsContainer');
  container.innerHTML = renderCatalogItems(searchTerm);
};

window.addMaterialFromCatalog = function(materialId) {
  const material = window.materialCatalog.find(m => m.id === materialId);
  if (!material) return;
  
  closeMaterialCatalog();
  
  // Pre-fill the line item modal with catalog data
  window.catalogPreFill = {
    name: material.name,
    unit: material.unit,
    sellPrice: material.sellPrice,
    section: material.section,
    costPrice: material.costPrice || 0,
    laborCost: material.laborCost || 0
  };
  
  addCustomLineItem();
};

function renderCatalogItems(searchTerm) {
  const filtered = window.materialCatalog.filter(m => 
    m.name.toLowerCase().includes(searchTerm) || 
    m.category.toLowerCase().includes(searchTerm) ||
    m.section.toLowerCase().includes(searchTerm)
  );
  
  if (filtered.length === 0) {
    return '<div style="text-align:center;padding:40px;color:#999;">No materials found</div>';
  }
  
  // Group by section
  const sections = {};
  filtered.forEach(item => {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  });
  
  let html = '';
  Object.keys(sections).sort().forEach(sectionName => {
    html += `<div style="margin-bottom:25px;">
      <h3 style="font-size:16px;color:#e8720c;margin:0 0 12px 0;padding-bottom:6px;border-bottom:2px solid #e8720c;">${sectionName}</h3>
      <div style="display:grid;gap:10px;">`;
    
    sections[sectionName].forEach(item => {
      html += `
        <div onclick="addMaterialFromCatalog('${item.id}');"
             style="border:1px solid var(--br);border-radius:6px;padding:15px;cursor:pointer;transition:all 0.2s;display:flex;justify-content:space-between;align-items:center;"
             onmouseover="this.style.borderColor='#e8720c';this.style.backgroundColor='var(--s2)';"
             onmouseout="this.style.borderColor='var(--br)';this.style.backgroundColor='var(--s)';">
          <div>
            <div style="font-weight:600;color:var(--t);margin-bottom:4px;">${item.name}</div>
            <div style="font-size:12px;color:var(--m);">Unit: ${item.unit}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:18px;font-weight:700;color:#e8720c;">$${item.sellPrice.toFixed(2)}</div>
            <div style="font-size:11px;color:var(--m);">per ${item.unit}</div>
          </div>
        </div>
      `;
    });
    
    html += `</div></div>`;
  });
  
  return html;
}
