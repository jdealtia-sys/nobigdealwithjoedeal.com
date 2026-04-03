// ═══════════════════════════════════════════════════════════════════════
// TEMPLATE LIBRARY - Save and reuse estimate configurations
// ═══════════════════════════════════════════════════════════════════════

window.estimateTemplates = JSON.parse(localStorage.getItem('nbd_estimate_templates') || '[]');

window.saveAsTemplate = function() {
  const est = window.advancedEstimate;
  
  if (est.lineItems.length === 0) {
    alert('Cannot save a template with no line items');
    return;
  }
  
  const modal = document.createElement('div');
  modal.id = 'saveTemplateModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10003;';
  
  modal.innerHTML = `
    <div style="background:white;border-radius:12px;max-width:500px;width:90%;padding:30px;">
      <h3 style="margin:0 0 20px 0;font-size:20px;color:#333;">Save as Template</h3>
      
      <div style="margin-bottom:15px;">
        <label style="display:block;font-weight:600;margin-bottom:6px;">Template Name</label>
        <input type="text" id="templateName" value="${est.projectName}" 
               placeholder="e.g., Standard Gable Roof (20-30 SQ)" 
               style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;">
      </div>
      
      <div style="margin-bottom:15px;">
        <label style="display:block;font-weight:600;margin-bottom:6px;">Description (Optional)</label>
        <textarea id="templateDescription" rows="3" 
                  placeholder="Brief description of what this template is for..." 
                  style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;resize:vertical;"></textarea>
      </div>
      
      <div style="background:#f0f9ff;border-left:4px solid #0ea5e9;padding:12px;border-radius:4px;margin-bottom:20px;">
        <div style="font-size:12px;color:#0c4a6e;">
          This template will save ${est.lineItems.length} line items and ${est.trades.length} trade selections.
        </div>
      </div>
      
      <div style="display:flex;justify-content:flex-end;gap:10px;">
        <button onclick="closeSaveTemplateModal();" 
                style="background:#6c757d;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;">
          Cancel
        </button>
        <button onclick="confirmSaveTemplate();" 
                style="background:#C8541A;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:600;">
          Save Template
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
};

window.closeSaveTemplateModal = function() {
  const modal = document.getElementById('saveTemplateModal');
  if (modal) modal.remove();
};

window.confirmSaveTemplate = function() {
  const name = document.getElementById('templateName').value.trim();
  const description = document.getElementById('templateDescription').value.trim();
  
  if (!name) {
    alert('Please enter a template name');
    return;
  }
  
  const est = window.advancedEstimate;
  
  const template = {
    id: 'tpl_' + Date.now(),
    name,
    description,
    trades: [...est.trades],
    lineItems: est.lineItems.map(item => ({...item})), // Deep copy
    createdAt: new Date().toISOString(),
    usedCount: 0
  };
  
  window.estimateTemplates.push(template);
  localStorage.setItem('nbd_estimate_templates', JSON.stringify(window.estimateTemplates));
  
  closeSaveTemplateModal();
  alert('✓ Template saved successfully!');
};

window.loadFromTemplate = function() {
  if (window.estimateTemplates.length === 0) {
    alert('No templates saved yet. Create your first template by building an estimate and clicking "Save as Template".');
    return;
  }
  
  const modal = document.createElement('div');
  modal.id = 'loadTemplateModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10003;';
  
  let templatesList = '';
  window.estimateTemplates.forEach(tpl => {
    const createdDate = new Date(tpl.createdAt).toLocaleDateString();
    templatesList += `
      <div onclick="applyTemplate('${tpl.id}');" 
           style="border:1px solid #ddd;border-radius:8px;padding:20px;margin-bottom:15px;cursor:pointer;transition:all 0.2s;"
           onmouseover="this.style.borderColor='#C8541A';this.style.backgroundColor='#fff8f5';"
           onmouseout="this.style.borderColor='#ddd';this.style.backgroundColor='white';">
        <div style="font-weight:600;font-size:16px;color:#333;margin-bottom:8px;">${tpl.name}</div>
        ${tpl.description ? `<div style="font-size:13px;color:#666;margin-bottom:10px;">${tpl.description}</div>` : ''}
        <div style="display:flex;gap:20px;font-size:12px;color:#999;">
          <span>📋 ${tpl.lineItems.length} items</span>
          <span>🏗️ ${tpl.trades.length} trades</span>
          <span>📅 Created ${createdDate}</span>
          <span>🔄 Used ${tpl.usedCount} times</span>
        </div>
      </div>
    `;
  });
  
  modal.innerHTML = `
    <div style="background:white;border-radius:12px;max-width:700px;width:90%;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:25px;border-bottom:2px solid #eee;">
        <h3 style="margin:0;font-size:20px;color:#333;">Load Template</h3>
      </div>
      
      <div style="flex:1;overflow-y:auto;padding:20px;">
        ${templatesList}
      </div>
      
      <div style="padding:20px;border-top:2px solid #eee;text-align:right;">
        <button onclick="closeLoadTemplateModal();" 
                style="background:#6c757d;color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;">
          Cancel
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
};

window.closeLoadTemplateModal = function() {
  const modal = document.getElementById('loadTemplateModal');
  if (modal) modal.remove();
};

window.applyTemplate = function(templateId) {
  const template = window.estimateTemplates.find(t => t.id === templateId);
  if (!template) return;
  
  // Apply template data to current estimate
  window.advancedEstimate.trades = [...template.trades];
  window.advancedEstimate.lineItems = template.lineItems.map(item => ({
    ...item,
    id: Date.now() + Math.random() // New IDs to avoid conflicts
  }));
  
  // Recalculate totals
  recalculateTotals();
  
  // Increment usage count
  template.usedCount++;
  localStorage.setItem('nbd_estimate_templates', JSON.stringify(window.estimateTemplates));
  
  closeLoadTemplateModal();
  
  // Jump to line items step
  window.advancedEstimate.currentStep = 3;
  renderAdvancedStep(3);
  
  alert(`✓ Template "${template.name}" loaded with ${template.lineItems.length} items`);
};
