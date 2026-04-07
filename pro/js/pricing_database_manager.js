// ═══════════════════════════════════════════════════════════════════════
// PRICING DATABASE MANAGER - Edit material prices in Settings
// ═══════════════════════════════════════════════════════════════════════

window.openPricingDatabase = function() {
  // Navigate to settings page (assumes settings tab exists)
  const settingsTab = document.querySelector('[data-tab="settings"]');
  if (settingsTab) {
    settingsTab.click();
  }
  
  // Inject pricing database UI into settings
  setTimeout(() => {
    const settingsContainer = document.getElementById('settingsContent');
    if (settingsContainer) {
      settingsContainer.innerHTML = renderPricingDatabase();
    }
  }, 100);
};

function renderPricingDatabase() {
  const catalog = window.materialCatalog || [];
  
  return `
    <div style="max-width:1200px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:25px;">
        <div>
          <h2 style="margin:0 0 5px 0;font-size:28px;color:var(--t);">💰 Pricing Database</h2>
          <p style="margin:0;color:var(--m);">Manage material pricing for your region</p>
        </div>
        <div style="display:flex;gap:10px;">
          <button onclick="addCustomMaterial();" 
                  style="background:#C8541A;color:white;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-weight:600;">
            ➕ Add Material
          </button>
          <button onclick="exportPricingCSV();" 
                  style="background:#0ea5e9;color:white;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-weight:600;">
            📥 Export CSV
          </button>
        </div>
      </div>
      
      <div style="margin-bottom:20px;">
        <input type="text" id="pricingSearchInput" placeholder="Search materials..."
               oninput="filterPricingTable()"
               style="width:100%;max-width:400px;padding:12px;border:1px solid var(--br);border-radius:6px;font-size:14px;">
      </div>
      
      <div style="background:var(--s);border:1px solid var(--br);border-radius:8px;overflow:hidden;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:var(--s2);border-bottom:2px solid var(--br);">
              <th style="padding:15px;text-align:left;font-weight:600;">Material Name</th>
              <th style="padding:15px;text-align:left;font-weight:600;">Category</th>
              <th style="padding:15px;text-align:left;font-weight:600;">Unit</th>
              <th style="padding:15px;text-align:right;font-weight:600;">Sell Price</th>
              <th style="padding:15px;text-align:right;font-weight:600;">Cost Price</th>
              <th style="padding:15px;text-align:center;font-weight:600;">Actions</th>
            </tr>
          </thead>
          <tbody id="pricingTableBody">
            ${renderPricingTableRows('')}
          </tbody>
        </table>
      </div>
      
      <div style="margin-top:20px;padding:15px;background:#f0f9ff;border-left:4px solid #0ea5e9;border-radius:4px;">
        <div style="font-size:13px;color:#0c4a6e;">
          💡 <strong>Tip:</strong> Price changes are saved immediately. All new estimates will use the updated pricing.
        </div>
      </div>
    </div>
  `;
}

function renderPricingTableRows(searchTerm) {
  const catalog = window.materialCatalog || [];
  const filtered = catalog.filter(m => 
    m.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    m.category.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  if (filtered.length === 0) {
    return '<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--m);">No materials found</td></tr>';
  }
  
  return filtered.map(material => `
    <tr style="border-bottom:1px solid var(--br);">
      <td style="padding:15px;">${material.name}</td>
      <td style="padding:15px;color:var(--m);text-transform:capitalize;">${material.category}</td>
      <td style="padding:15px;font-weight:600;">${material.unit}</td>
      <td style="padding:15px;text-align:right;font-weight:600;color:#C8541A;">$${material.sellPrice.toFixed(2)}</td>
      <td style="padding:15px;text-align:right;color:var(--m);">$${(material.costPrice || 0).toFixed(2)}</td>
      <td style="padding:15px;text-align:center;">
        <button onclick="editMaterialPrice('${material.id}');" 
                style="background:#0ea5e9;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;">
          Edit
        </button>
      </td>
    </tr>
  `).join('');
}

window.filterPricingTable = function() {
  const searchTerm = document.getElementById('pricingSearchInput').value;
  const tbody = document.getElementById('pricingTableBody');
  if (tbody) {
    tbody.innerHTML = renderPricingTableRows(searchTerm);
  }
};

window.editMaterialPrice = function(materialId) {
  const material = window.materialCatalog.find(m => m.id === materialId);
  if (!material) return;
  
  const modal = document.createElement('div');
  modal.id = 'editPriceModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10005;';
  
  modal.innerHTML = `
    <div style="background:white;border-radius:12px;max-width:500px;width:90%;padding:30px;">
      <h3 style="margin:0 0 20px 0;font-size:20px;color:#333;">Edit Material Pricing</h3>
      
      <div style="margin-bottom:15px;">
        <label style="display:block;font-weight:600;margin-bottom:6px;">Material</label>
        <input type="text" value="${material.name}" disabled 
               style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;background:#f9f9f9;">
      </div>
      
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
        <div>
          <label style="display:block;font-weight:600;margin-bottom:6px;">Sell Price ($)</label>
          <input type="number" id="editSellPrice" value="${material.sellPrice}" step="0.01" 
                 style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;">
        </div>
        <div>
          <label style="display:block;font-weight:600;margin-bottom:6px;">Cost Price ($)</label>
          <input type="number" id="editCostPrice" value="${material.costPrice || 0}" step="0.01" 
                 style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;">
        </div>
      </div>
      
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:25px;">
        <button onclick="closeEditPriceModal();" 
                style="background:#6c757d;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;">
          Cancel
        </button>
        <button onclick="saveMaterialPrice('${material.id}');" 
                style="background:#C8541A;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:600;">
          Save Changes
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
};

window.closeEditPriceModal = function() {
  const modal = document.getElementById('editPriceModal');
  if (modal) modal.remove();
};

window.saveMaterialPrice = function(materialId) {
  const material = window.materialCatalog.find(m => m.id === materialId);
  if (!material) return;
  
  const sellPrice = parseFloat(document.getElementById('editSellPrice').value) || 0;
  const costPrice = parseFloat(document.getElementById('editCostPrice').value) || 0;
  
  material.sellPrice = sellPrice;
  material.costPrice = costPrice;
  material.lastUpdated = new Date().toISOString();
  
  // Save to localStorage
  localStorage.setItem('nbd_material_catalog', JSON.stringify(window.materialCatalog));
  
  closeEditPriceModal();
  
  // Refresh table
  const tbody = document.getElementById('pricingTableBody');
  if (tbody) {
    tbody.innerHTML = renderPricingTableRows('');
  }
  
  alert('✓ Pricing updated successfully!');
};

window.exportPricingCSV = function() {
  const catalog = window.materialCatalog || [];
  
  let csv = 'Material Name,Category,Unit,Sell Price,Cost Price,Section\n';
  catalog.forEach(m => {
    csv += `"${m.name}","${m.category}","${m.unit}",${m.sellPrice},${m.costPrice || 0},"${m.section}"\n`;
  });
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `NBD_Pricing_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
};

window.addCustomMaterial = function() {
  alert('Custom material addition feature - to be implemented in next iteration');
};

// Load saved pricing on page load
if (localStorage.getItem('nbd_material_catalog')) {
  window.materialCatalog = JSON.parse(localStorage.getItem('nbd_material_catalog'));
}
