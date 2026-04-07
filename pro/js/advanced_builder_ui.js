// ═══════════════════════════════════════════════════════════════════════
// ADVANCED BUILDER UI - 4-Step Estimate Creation Wizard
// ═══════════════════════════════════════════════════════════════════════

// Global state for advanced estimate
window.advancedEstimate = {
  projectName: '',
  customerId: null,
  structure: '',
  trades: [],
  lineItems: [],
  subtotal: 0,
  tax: 0,
  total: 0,
  pricingDate: new Date().toISOString().split('T')[0],
  currentStep: 1
};

window.openAdvancedBuilder = function() {
  // Reset state
  window.advancedEstimate = {
    projectName: '',
    customerId: null,
    structure: '',
    trades: [],
    lineItems: [],
    subtotal: 0,
    tax: 0,
    total: 0,
    pricingDate: new Date().toISOString().split('T')[0],
    currentStep: 1
  };
  
  renderAdvancedBuilder();
};

window.renderAdvancedBuilder = function() {
  const modal = document.createElement('div');
  modal.id = 'advancedBuilderModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:9999;';
  
  modal.innerHTML = `
    <div style="background:var(--s);border-radius:12px;max-width:1100px;width:95%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:25px;background:linear-gradient(135deg, #C8541A 0%, #a64516 100%);color:white;">
        <h2 style="margin:0;font-size:28px;">🎯 Advanced Estimate Builder</h2>
        <div style="margin-top:10px;font-size:14px;opacity:0.9;">
          Step ${window.advancedEstimate.currentStep} of 4
        </div>
      </div>
      
      <div id="advancedStepContainer" style="flex:1;overflow-y:auto;padding:30px;">
        <!-- Step content rendered here -->
      </div>
      
      <div id="advancedNavigation" style="padding:20px;border-top:2px solid var(--br);background:var(--s2);">
        <!-- Navigation buttons rendered here -->
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  renderAdvancedStep(window.advancedEstimate.currentStep);
};

window.renderAdvancedStep = function(step) {
  const container = document.getElementById('advancedStepContainer');
  const navigation = document.getElementById('advancedNavigation');
  
  switch(step) {
    case 1:
      container.innerHTML = renderProjectSetup();
      navigation.innerHTML = `
        <div style="display:flex;justify-content:space-between;">
          <button onclick="closeAdvancedBuilder();" style="background:#6c757d;color:white;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;">Cancel</button>
          <button onclick="advNextStep(1);" style="background:#C8541A;color:white;border:none;padding:12px 32px;border-radius:6px;cursor:pointer;font-weight:600;">Continue →</button>
        </div>
      `;
      break;
    case 2:
      container.innerHTML = renderTradeSelect();
      navigation.innerHTML = `
        <div style="display:flex;justify-content:space-between;">
          <button onclick="advBackStep(2);" style="background:#6c757d;color:white;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;">← Back</button>
          <button onclick="advNextStep(2);" style="background:#C8541A;color:white;border:none;padding:12px 32px;border-radius:6px;cursor:pointer;font-weight:600;">Continue →</button>
        </div>
      `;
      break;
    case 3:
      container.innerHTML = renderLineItems();
      navigation.innerHTML = `
        <div style="display:flex;justify-content:space-between;">
          <button onclick="advBackStep(3);" style="background:#6c757d;color:white;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;">← Back</button>
          <button onclick="advNextStep(3);" style="background:#C8541A;color:white;border:none;padding:12px 32px;border-radius:6px;cursor:pointer;font-weight:600;">Continue →</button>
        </div>
      `;
      break;
    case 4:
      container.innerHTML = renderReview();
      navigation.innerHTML = `
        <div style="display:flex;justify-content:space-between;">
          <button onclick="advBackStep(4);" style="background:#6c757d;color:white;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;">← Back</button>
          <div style="display:flex;gap:10px;">
            <button onclick="saveAdvancedEstimate();" style="background:#28a745;color:white;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-weight:600;">💾 Save</button>
          </div>
        </div>
      `;
      break;
  }
};

window.closeAdvancedBuilder = function() {
  const modal = document.getElementById('advancedBuilderModal');
  if (modal) modal.remove();
};

window.advNextStep = function(currentStep) {
  // Validation
  if (currentStep === 1) {
    const projectName = document.getElementById('advProjectName').value.trim();
    if (!projectName) {
      alert('Please enter a project name');
      return;
    }
    window.advancedEstimate.projectName = projectName;
    window.advancedEstimate.structure = document.getElementById('advStructure').value.trim() || 'Main House';
    window.advancedEstimate.customerId = document.getElementById('advCustomerId').value || null;
  }
  
  if (currentStep === 2 && window.advancedEstimate.trades.length === 0) {
    alert('Please select at least one trade');
    return;
  }
  
  window.advancedEstimate.currentStep = currentStep + 1;
  renderAdvancedStep(window.advancedEstimate.currentStep);
};

window.advBackStep = function(currentStep) {
  window.advancedEstimate.currentStep = currentStep - 1;
  renderAdvancedStep(window.advancedEstimate.currentStep);
};

// ─────────────────────────────────────────────────────────────────────────
// STEP 1: PROJECT SETUP
// ─────────────────────────────────────────────────────────────────────────

function renderProjectSetup() {
  // Get existing leads for customer dropdown
  const leads = window.dashboardLeads || [];
  const customerOptions = leads.map(lead => 
    `<option value="${lead.id}">${lead.fullName || lead.email || 'Unknown'}</option>`
  ).join('');
  
  return `
    <div style="max-width:600px;margin:0 auto;">
      <h3 style="font-size:22px;color:var(--t);margin:0 0 25px 0;">Project Information</h3>
      
      <div style="margin-bottom:20px;">
        <label style="display:block;font-weight:600;margin-bottom:8px;color:#555;">Project Name *</label>
        <input type="text" id="advProjectName" value="${window.advancedEstimate.projectName}" 
               placeholder="e.g., Main House Reroof" 
               style="width:100%;padding:12px;border:1px solid var(--br);border-radius:6px;font-size:14px;">
      </div>
      
      <div style="margin-bottom:20px;">
        <label style="display:block;font-weight:600;margin-bottom:8px;color:#555;">Structure/Building</label>
        <input type="text" id="advStructure" value="${window.advancedEstimate.structure}" 
               placeholder="e.g., Main House, Garage, Barn" 
               style="width:100%;padding:12px;border:1px solid var(--br);border-radius:6px;font-size:14px;">
        <div style="font-size:12px;color:var(--m);margin-top:5px;">Leave blank for default "Main House"</div>
      </div>
      
      <div style="margin-bottom:20px;">
        <label style="display:block;font-weight:600;margin-bottom:8px;color:#555;">Link to Customer (Optional)</label>
        <select id="advCustomerId" style="width:100%;padding:12px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
          <option value="">-- None (New Lead) --</option>
          ${customerOptions}
        </select>
        <div style="font-size:12px;color:var(--m);margin-top:5px;">Connect this estimate to an existing customer</div>
      </div>
      
      <div style="background:#f0f9ff;border-left:4px solid #0ea5e9;padding:15px;border-radius:6px;margin-top:25px;">
        <div style="font-size:13px;color:#0c4a6e;">
          💡 <strong>Tip:</strong> Use descriptive project names to easily identify estimates later (e.g., "Smith Residence - Full Reroof" instead of just "Roof").
        </div>
      </div>

      <div style="margin-top:20px;border:1px solid #fde0d0;border-radius:8px;padding:16px;background:var(--s2);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-weight:700;font-size:13px;color:#C8541A;">📎 GAF Quick Measure Import</div>
          <button onclick="applyQMToAdvancedBuilder()" 
                  style="background:#C8541A;color:#fff;border:none;border-radius:5px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;"
                  ${window._qmData ? '' : 'disabled style="background:#C8541A;color:#fff;border:none;border-radius:5px;padding:7px 14px;font-size:12px;font-weight:700;cursor:pointer;opacity:.4;"'}>
            ${window._qmData ? '✓ Apply QM Data' : 'Import QM first on Step 1 of Quick Builder'}
          </button>
        </div>
        <div style="font-size:11px;color:#888;line-height:1.5;">
          ${window._qmData 
            ? `<span style="color:#C8541A;font-weight:700;">QM data ready:</span> ${window._qmData.roofArea} sq ft · ${window._qmData.pitch} pitch · ${window._qmData.squaresAtSuggestedWaste} squares — click Apply to seed measurements and auto-add line items.`
            : 'Upload a GAF Quick Measure PDF using the "📎 Import Quick Measure" button in the Quick Estimate builder first, then come back here to apply.'}
        </div>
      </div>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// STEP 2: TRADE SELECTION
// ─────────────────────────────────────────────────────────────────────────

function renderTradeSelect() {
  const trades = [
    { id: 'roofing', icon: '🏠', name: 'Roofing', desc: 'Shingles, underlayment, flashing' },
    { id: 'siding', icon: '🏗️', name: 'Siding', desc: 'Vinyl, fiber cement, wood' },
    { id: 'gutters', icon: '🌧️', name: 'Gutters', desc: 'Seamless gutters, guards, downspouts' },
    { id: 'windows', icon: '🪟', name: 'Windows & Doors', desc: 'Replacement windows and entry doors' },
    { id: 'soffit_fascia', icon: '📐', name: 'Soffit & Fascia', desc: 'Vinyl and aluminum trim' },
    { id: 'painting', icon: '🎨', name: 'Painting', desc: 'Interior and exterior painting' },
    { id: 'masonry', icon: '🧱', name: 'Masonry', desc: 'Chimney repair, brick work' },
    { id: 'decking', icon: '📋', name: 'Decking/OSB', desc: 'Roof deck replacement' },
    { id: 'cleaning', icon: '🧹', name: 'Cleaning & Repair', desc: 'Debris removal, minor repairs' }
  ];
  
  let html = '<div style="max-width:900px;margin:0 auto;">';
  html += '<h3 style="font-size:22px;color:#333;margin:0 0 25px 0;">Select Trades</h3>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:15px;">';
  
  trades.forEach(trade => {
    const isSelected = window.advancedEstimate.trades.includes(trade.id);
    html += `
      <div onclick="toggleTrade('${trade.id}');" 
           style="border:2px solid ${isSelected ? '#C8541A' : '#ddd'};
                  background:${isSelected ? '#fff8f5' : 'white'};
                  border-radius:8px;padding:20px;cursor:pointer;transition:all 0.2s;"
           onmouseover="if (!this.style.borderColor.includes('C8541A')) { this.style.borderColor='#999'; }"
           onmouseout="if (!this.style.borderColor.includes('C8541A')) { this.style.borderColor='#ddd'; }">
        <div style="font-size:36px;margin-bottom:10px;">${trade.icon}</div>
        <div style="font-weight:600;font-size:16px;color:var(--t);margin-bottom:5px;">${trade.name}</div>
        <div style="font-size:13px;color:var(--m);">${trade.desc}</div>
        ${isSelected ? '<div style="margin-top:10px;color:#C8541A;font-weight:600;font-size:13px;">✓ Selected</div>' : ''}
      </div>
    `;
  });
  
  html += '</div></div>';
  return html;
}

window.toggleTrade = function(tradeId) {
  const idx = window.advancedEstimate.trades.indexOf(tradeId);
  if (idx > -1) {
    window.advancedEstimate.trades.splice(idx, 1);
  } else {
    window.advancedEstimate.trades.push(tradeId);
  }
  renderAdvancedStep(2);
};

// ─────────────────────────────────────────────────────────────────────────
// STEP 3: LINE ITEMS BUILDER
// ─────────────────────────────────────────────────────────────────────────

function renderLineItems() {
  let html = '<div style="max-width:1000px;margin:0 auto;">';
  html += '<h3 style="font-size:22px;color:#333;margin:0 0 20px 0;">Build Estimate</h3>';
  
  // Action buttons
  html += `
    <div style="display:flex;gap:10px;margin-bottom:25px;flex-wrap:wrap;">
      <button onclick="loadFromTemplate();" style="background:#0ea5e9;color:white;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-size:14px;">
        📂 Load Template
      </button>
      <button onclick="openMaterialCatalog();" style="background:#8b5cf6;color:white;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-size:14px;">
        📦 Add from Catalog
      </button>
      <button onclick="addCustomLineItem();" style="background:#C8541A;color:white;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-size:14px;">
        ➕ Custom Item
      </button>
    </div>
  `;
  
  // Line items list
  html += '<div id="lineItemsList">' + renderLineItemsList() + '</div>';
  
  // Totals
  html += `
    <div style="margin-top:30px;padding:20px;background:var(--s2);border-radius:8px;border:2px solid var(--br);">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:16px;color:var(--m);">Subtotal:</span>
        <span style="font-size:18px;font-weight:600;">$${window.advancedEstimate.subtotal.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:16px;color:var(--m);">Tax (7%):</span>
        <span style="font-size:18px;font-weight:600;">$${window.advancedEstimate.tax.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding-top:10px;border-top:2px solid #ddd;">
        <span style="font-size:20px;font-weight:700;color:var(--t);">Total:</span>
        <span style="font-size:24px;font-weight:700;color:#C8541A;">$${window.advancedEstimate.total.toFixed(2)}</span>
      </div>
    </div>
  `;
  
  html += '</div>';
  return html;
}

function renderLineItemsList() {
  if (window.advancedEstimate.lineItems.length === 0) {
    return `
      <div style="text-align:center;padding:60px 20px;background:#f9f9f9;border-radius:8px;border:2px dashed #ddd;">
        <div style="font-size:48px;margin-bottom:15px;opacity:0.3;">📋</div>
        <div style="font-size:16px;color:var(--m);">No line items yet. Add items from the catalog or create custom items.</div>
      </div>
    `;
  }
  
  // Group by section
  const sections = {};
  window.advancedEstimate.lineItems.forEach(item => {
    if (!sections[item.section]) sections[item.section] = [];
    sections[item.section].push(item);
  });
  
  let html = '';
  Object.keys(sections).sort().forEach(sectionName => {
    html += `
      <div style="margin-bottom:25px;">
        <h4 style="font-size:16px;color:#C8541A;margin:0 0 12px 0;padding-bottom:6px;border-bottom:2px solid #C8541A;">${sectionName}</h4>
    `;
    
    sections[sectionName].forEach(item => {
      html += `
        <div style="border:1px solid var(--br);border-radius:6px;padding:15px;margin-bottom:10px;background:var(--s);">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div style="flex:1;">
              <div style="font-weight:600;color:var(--t);margin-bottom:5px;">${item.name}</div>
              <div style="font-size:13px;color:var(--m);">
                Qty: ${item.qty} ${item.unit} × $${item.sellPrice.toFixed(2)}
              </div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:18px;font-weight:700;color:#C8541A;margin-bottom:8px;">$${item.total.toFixed(2)}</div>
              <div style="display:flex;gap:8px;">
                <button onclick="editLineItem(${item.id});" style="background:#0ea5e9;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;">Edit</button>
                <button onclick="deleteLineItem(${item.id});" style="background:#ef4444;color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;">Delete</button>
              </div>
            </div>
          </div>
        </div>
      `;
    });
    
    html += '</div>';
  });
  
  return html;
}

window.addCustomLineItem = function() {
  // Check for catalog pre-fill
  const preFill = window.catalogPreFill || {};
  
  const modal = document.createElement('div');
  modal.id = 'lineItemModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10002;';
  
  modal.innerHTML = `
    <div style="background:var(--s);border-radius:12px;max-width:600px;width:90%;padding:30px;">
      <h3 style="margin:0 0 20px 0;font-size:20px;color:var(--t);">Add Line Item</h3>
      
      <div style="margin-bottom:15px;">
        <label style="display:block;font-weight:600;margin-bottom:6px;">Item Name</label>
        <input type="text" id="liName" value="${preFill.name || ''}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;">
      </div>
      
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
        <div>
          <label style="display:block;font-weight:600;margin-bottom:6px;">Quantity</label>
          <input type="number" id="liQty" value="1" step="0.01" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;">
        </div>
        <div>
          <label style="display:block;font-weight:600;margin-bottom:6px;">Unit</label>
          <input type="text" id="liUnit" value="${preFill.unit || 'EA'}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;">
        </div>
      </div>
      
      <div style="margin-bottom:15px;">
        <label style="display:block;font-weight:600;margin-bottom:6px;">Sell Price (per unit)</label>
        <input type="number" id="liSellPrice" value="${preFill.sellPrice || 0}" step="0.01" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;">
      </div>
      
      <div style="margin-bottom:15px;">
        <label style="display:block;font-weight:600;margin-bottom:6px;">Section</label>
        <input type="text" id="liSection" value="${preFill.section || 'General'}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;">
      </div>
      
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:25px;">
        <button onclick="closeLineItemModal();" style="background:#6c757d;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;">Cancel</button>
        <button onclick="saveLineItem();" style="background:#C8541A;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:600;">Add Item</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  window.catalogPreFill = null; // Clear pre-fill
};

window.closeLineItemModal = function() {
  const modal = document.getElementById('lineItemModal');
  if (modal) modal.remove();
  window.currentEditItemId = null;
};

window.saveLineItem = function() {
  const name = document.getElementById('liName').value.trim();
  const qty = parseFloat(document.getElementById('liQty').value) || 0;
  const unit = document.getElementById('liUnit').value.trim() || 'EA';
  const sellPrice = parseFloat(document.getElementById('liSellPrice').value) || 0;
  const section = document.getElementById('liSection').value.trim() || 'General';
  
  if (!name || qty <= 0 || sellPrice < 0) {
    alert('Please fill in all required fields');
    return;
  }
  
  const total = qty * sellPrice;
  
  if (window.currentEditItemId) {
    // Edit existing
    const item = window.advancedEstimate.lineItems.find(li => li.id === window.currentEditItemId);
    if (item) {
      item.name = name;
      item.qty = qty;
      item.unit = unit;
      item.sellPrice = sellPrice;
      item.section = section;
      item.total = total;
    }
  } else {
    // Add new
    window.advancedEstimate.lineItems.push({
      id: Date.now(),
      name,
      qty,
      unit,
      sellPrice,
      section,
      total,
      costPrice: 0,
      laborCost: 0
    });
  }
  
  recalculateTotals();
  closeLineItemModal();
  renderAdvancedStep(3);
};

window.editLineItem = function(itemId) {
  const item = window.advancedEstimate.lineItems.find(li => li.id === itemId);
  if (!item) return;
  
  window.currentEditItemId = itemId;
  
  const modal = document.createElement('div');
  modal.id = 'lineItemModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10002;';
  
  modal.innerHTML = `
    <div style="background:var(--s);border-radius:12px;max-width:600px;width:90%;padding:30px;">
      <h3 style="margin:0 0 20px 0;font-size:20px;color:var(--t);">Edit Line Item</h3>
      
      <div style="margin-bottom:15px;">
        <label style="display:block;font-weight:600;margin-bottom:6px;">Item Name</label>
        <input type="text" id="liName" value="${item.name}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;">
      </div>
      
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
        <div>
          <label style="display:block;font-weight:600;margin-bottom:6px;">Quantity</label>
          <input type="number" id="liQty" value="${item.qty}" step="0.01" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;">
        </div>
        <div>
          <label style="display:block;font-weight:600;margin-bottom:6px;">Unit</label>
          <input type="text" id="liUnit" value="${item.unit}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;">
        </div>
      </div>
      
      <div style="margin-bottom:15px;">
        <label style="display:block;font-weight:600;margin-bottom:6px;">Sell Price (per unit)</label>
        <input type="number" id="liSellPrice" value="${item.sellPrice}" step="0.01" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;">
      </div>
      
      <div style="margin-bottom:15px;">
        <label style="display:block;font-weight:600;margin-bottom:6px;">Section</label>
        <input type="text" id="liSection" value="${item.section}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;">
      </div>
      
      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:25px;">
        <button onclick="closeLineItemModal();" style="background:#6c757d;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;">Cancel</button>
        <button onclick="saveLineItem();" style="background:#C8541A;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:600;">Save Changes</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
};

window.deleteLineItem = function(itemId) {
  if (!confirm('Delete this line item?')) return;
  
  window.advancedEstimate.lineItems = window.advancedEstimate.lineItems.filter(li => li.id !== itemId);
  recalculateTotals();
  renderAdvancedStep(3);
};

function recalculateTotals() {
  const subtotal = window.advancedEstimate.lineItems.reduce((sum, item) => sum + item.total, 0);
  const tax = subtotal * 0.07;
  const total = subtotal + tax;
  
  window.advancedEstimate.subtotal = subtotal;
  window.advancedEstimate.tax = tax;
  window.advancedEstimate.total = total;
}

// ─────────────────────────────────────────────────────────────────────────
// STEP 4: REVIEW & EXPORT
// ─────────────────────────────────────────────────────────────────────────

function renderReview() {
  const est = window.advancedEstimate;
  
  let html = '<div style="max-width:900px;margin:0 auto;">';
  html += '<h3 style="font-size:22px;color:#333;margin:0 0 20px 0;">Review & Export</h3>';
  
  // Action buttons
  html += `
    <div style="display:flex;gap:10px;margin-bottom:25px;flex-wrap:wrap;">
      <button onclick="runAIReview();" style="background:#8b5cf6;color:white;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-size:14px;">
        🤖 AI Review
      </button>
      <button onclick="saveAsTemplate();" style="background:#0ea5e9;color:white;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-size:14px;">
        📋 Save as Template
      </button>
    </div>
  `;
  
  // Summary card
  html += `
    <div style="background:white;border:2px solid #eee;border-radius:8px;padding:25px;margin-bottom:25px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
        <div>
          <div style="font-size:12px;color:#666;margin-bottom:4px;">PROJECT NAME</div>
          <div style="font-size:16px;font-weight:600;color:#333;">${est.projectName}</div>
        </div>
        <div>
          <div style="font-size:12px;color:#666;margin-bottom:4px;">STRUCTURE</div>
          <div style="font-size:16px;font-weight:600;color:#333;">${est.structure || 'Main House'}</div>
        </div>
      </div>
      
      <div style="margin-bottom:20px;">
        <div style="font-size:12px;color:#666;margin-bottom:4px;">TRADES</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${est.trades.map(t => `<span style="background:#C8541A;color:white;padding:4px 12px;border-radius:4px;font-size:13px;">${t}</span>`).join('')}
        </div>
      </div>
      
      <div style="border-top:2px solid #eee;padding-top:15px;">
        <div style="font-size:12px;color:#666;margin-bottom:8px;">LINE ITEMS (${est.lineItems.length})</div>
        <div style="max-height:200px;overflow-y:auto;">
          ${est.lineItems.map(item => `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0;">
              <span style="font-size:13px;color:#333;">${item.name} (${item.qty} ${item.unit})</span>
              <span style="font-size:13px;font-weight:600;color:#C8541A;">$${item.total.toFixed(2)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `;
  
  // Totals
  html += `
    <div style="background:#f9f9f9;border:2px solid #eee;border-radius:8px;padding:20px;margin-bottom:25px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:16px;color:var(--m);">Subtotal:</span>
        <span style="font-size:18px;font-weight:600;">$${est.subtotal.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
        <span style="font-size:16px;color:var(--m);">Tax (7%):</span>
        <span style="font-size:18px;font-weight:600;">$${est.tax.toFixed(2)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;padding-top:10px;border-top:2px solid #ddd;">
        <span style="font-size:20px;font-weight:700;color:var(--t);">Total:</span>
        <span style="font-size:24px;font-weight:700;color:#C8541A;">$${est.total.toFixed(2)}</span>
      </div>
    </div>
  `;
  
  // Export options
  html += `
    <div style="background:white;border:2px solid #eee;border-radius:8px;padding:25px;">
      <h4 style="margin:0 0 15px 0;font-size:18px;color:#333;">Export PDF</h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:15px;">
        <button onclick="exportAdvancedEstimatePDF('simple');" 
                style="background:#28a745;color:white;border:none;padding:15px;border-radius:6px;cursor:pointer;text-align:left;">
          <div style="font-weight:600;margin-bottom:5px;">📄 Simple PDF</div>
          <div style="font-size:12px;opacity:0.9;">Section totals only (client-facing)</div>
        </button>
        <button onclick="exportAdvancedEstimatePDF('detailed');" 
                style="background:#0ea5e9;color:white;border:none;padding:15px;border-radius:6px;cursor:pointer;text-align:left;">
          <div style="font-weight:600;margin-bottom:5px;">📋 Detailed PDF</div>
          <div style="font-size:12px;opacity:0.9;">All line items (client proposal)</div>
        </button>
        <button onclick="exportAdvancedEstimatePDF('internal');" 
                style="background:#ef4444;color:white;border:none;padding:15px;border-radius:6px;cursor:pointer;text-align:left;">
          <div style="font-weight:600;margin-bottom:5px;">🔒 Internal PDF</div>
          <div style="font-size:12px;opacity:0.9;">Cost breakdown + margins (private)</div>
        </button>
      </div>
    </div>
  `;
  
  html += '</div>';
  return html;
}

// ─────────────────────────────────────────────────────────────────────────
// SAVE TO FIRESTORE
// ─────────────────────────────────────────────────────────────────────────

// ── Apply QM data to Advanced Builder ─────────────────────────────────────
window.applyQMToAdvancedBuilder = function() {
  const qm = window._qmData;
  if (!qm) { alert('No Quick Measure data found. Import a PDF first.'); return; }

  const est = window.advancedEstimate;

  // Auto-fill project name from address if empty
  if (!est.projectName && qm.address) {
    est.projectName = qm.address;
    const el = document.getElementById('advProjectName');
    if (el) el.value = qm.address;
  }

  // Seed roofing line items from QM measurements using material catalog
  const sq = qm.squaresAtSuggestedWaste || Math.ceil(qm.roofArea / 100);
  const ridgeLF = qm.ridges || 0;
  const valleyLF = qm.valleys || 0;
  const eaveLF = qm.eaves || 0;
  const rakeLF = qm.rakes || 0;
  const dripLF = qm.dripEdge || 0;
  const leakBarrierLF = qm.leakBarrier || 0;
  const pipes = qm.penetrations || 0;

  // Build line items from catalog
  const catalog = window.materialCatalog || [];
  const find = id => catalog.find(c => c.id === id);

  const newItems = [];
  const addItem = (catalogId, qty, overrideName) => {
    const cat = find(catalogId);
    if (!cat || qty <= 0) return;
    const total = parseFloat((cat.sellPrice * qty).toFixed(2));
    newItems.push({
      id: cat.id,
      name: overrideName || cat.name,
      category: cat.category,
      section: cat.section,
      unit: cat.unit,
      qty: parseFloat(qty.toFixed(2)),
      sellPrice: cat.sellPrice,
      costPrice: cat.costPrice || 0,
      laborCost: cat.laborCost || 0,
      total
    });
  };

  addItem('labor_tearoff_1layer', sq);
  addItem('roof_shingles_arch', sq);
  addItem('roof_underlayment_synthetic', sq);
  addItem('roof_ice_water', Math.ceil(leakBarrierLF / 100));
  addItem('roof_drip_edge', dripLF);
  addItem('roof_ridge_vent', ridgeLF);
  addItem('roof_valley_flashing', valleyLF);
  if (pipes > 0) addItem('roof_pipe_boot', pipes);

  // Merge into estimate — avoid duplicates by id
  const existingIds = new Set(est.lineItems.map(i => i.id));
  newItems.forEach(item => {
    if (!existingIds.has(item.id)) est.lineItems.push(item);
  });

  // Recalculate totals
  est.subtotal = est.lineItems.reduce((s, i) => s + (i.total || 0), 0);
  est.tax = parseFloat((est.subtotal * 0.07).toFixed(2));
  est.total = parseFloat((est.subtotal + est.tax).toFixed(2));

  // Store QM ref on estimate state
  est.qmData = qm;

  // Re-render current step
  renderAdvancedStep(est.currentStep);

  alert(`✓ QM data applied!\n\n${newItems.length} line items seeded from ${sq} squares.\nReview in the Line Items step.`);
};
// ── End QM Apply ───────────────────────────────────────────────────────────

window.saveAdvancedEstimate = async function() {
  const est = window.advancedEstimate;
  
  if (est.lineItems.length === 0) {
    alert('Cannot save an estimate with no line items');
    return;
  }
  
  try {
    // Use modular SDK via window-exposed functions
    const user = window._user;
    if (!user) {
      alert('You must be logged in to save estimates');
      return;
    }

    // Resolve leadId — from linked lead (customer page flow) or customerId on estimate state
    const leadId = window._estLinkedLeadId || est.customerId || null;

    // Resolve address — from linked lead record
    let addr = est.projectName || '';
    if (leadId && window._leads) {
      const lead = (window._leads || []).find(l => l.id === leadId);
      if (lead && lead.address) addr = lead.address;
    }
    
    const estimateData = {
      type: 'advanced',
      title: est.projectName || 'Advanced Estimate',
      addr: addr,
      projectName: est.projectName,
      structure: est.structure || 'Main House',
      leadId: leadId,
      customerId: leadId,
      trades: est.trades,
      lineItems: est.lineItems,
      rows: est.lineItems.map(i => ({
        code: i.id || '',
        desc: i.name,
        qty: i.qty,
        rate: '$' + (i.sellPrice || 0).toFixed(2),
        total: i.total || 0
      })),
      subtotal: est.subtotal,
      tax: est.tax,
      total: est.total,
      grandTotal: est.total,
      pricingDate: est.pricingDate,
      status: 'draft',
      deleted: false,
      userId: user.uid,
      createdBy: user.email
    };
    
    // Use modular Firestore via window-exposed addDoc
    if (window._saveEstimate) {
      await window._saveEstimate(estimateData);
    } else {
      // Fallback — should not happen if dashboard loaded correctly
      console.error('window._saveEstimate not available');
      alert('Save failed — please refresh and try again.');
      return;
    }

    window._estLinkedLeadId = null;
    
    closeAdvancedBuilder();

    // Offer to navigate to customer record if linked
    if (leadId) {
      if (confirm('✓ Estimate saved & linked to customer! Go to customer record?')) {
        window.location.href = `/pro/customer.html?id=${leadId}`;
      }
    } else {
      alert('✓ Estimate saved successfully!');
    }
    
    // Refresh estimates list if on estimates page
    if (typeof loadEstimates === 'function') {
      loadEstimates();
    }
    
  } catch (error) {
    console.error('Error saving estimate:', error);
    alert('Error saving estimate: ' + error.message);
  }
};

// ═══════════════════════════════════════════════════════════════════════
// TEMPLATE LOADER — Populates Advanced Builder from Estimate Template
// ═══════════════════════════════════════════════════════════════════════
window._advancedBuilder_loadTemplate = function(template) {
  if (!template || !template.items) return;

  const products = window.NBD_PRODUCTS || [];

  // Set project name from template
  window.advancedEstimate.projectName = template.name;

  // Collect unique trade categories from template items
  const tradeSet = new Set();

  // Build line items from template
  template.items.forEach(function(tItem) {
    const product = products.find(function(p) { return p.id === tItem.productId; });
    if (!product) return;

    // Resolve tier pricing (default to "better" if not specified)
    const tier = tItem.tier || 'better';
    const pricing = product.pricing || {};
    const tierData = pricing[tier] || pricing.better || pricing.good || { sell: 0, cost: 0 };
    const qty = tItem.qty || product.defaultQty || 1;
    const sellPrice = tierData.sell || 0;
    const costPrice = tierData.cost || 0;
    const laborCost = product.labor ? (product.labor.perUnit || 0) : 0;

    // Track trade category
    const cat = window.NBD_CATEGORIES ? window.NBD_CATEGORIES[product.category] : null;
    if (cat) tradeSet.add(cat.label);

    window.advancedEstimate.lineItems.push({
      id: Date.now() + Math.random(),
      name: product.name,
      qty: qty,
      unit: product.unit || 'EA',
      sellPrice: sellPrice,
      section: (cat ? cat.label : 'General'),
      total: qty * sellPrice,
      costPrice: costPrice,
      laborCost: laborCost,
      productId: product.id,
      tier: tier
    });
  });

  // Set trades from discovered categories
  window.advancedEstimate.trades = Array.from(tradeSet);

  // Jump to step 3 (line items) so user sees the loaded items
  window.advancedEstimate.currentStep = 3;
  recalculateTotals();
  renderAdvancedStep(3);

  // Update header
  const header = document.querySelector('#advancedBuilderModal h2');
  if (header) header.textContent = '🎯 ' + template.name;
  const stepLabel = document.querySelector('#advancedBuilderModal div[style*="opacity:0.9"]');
  if (stepLabel) stepLabel.textContent = 'Step 3 of 4 — Loaded from template (' + template.items.length + ' items)';

  if (typeof showToast === 'function') {
    showToast('✅ Template loaded: ' + template.name + ' — ' + template.items.length + ' line items added');
  }
};
