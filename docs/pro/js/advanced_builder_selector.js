// ═══════════════════════════════════════════════════════════════════════
// ESTIMATE TYPE SELECTOR - Quick vs Advanced Builder Choice Modal
// ═══════════════════════════════════════════════════════════════════════

window.showEstimateTypeSelector = function() {
  const modal = document.createElement('div');
  modal.id = 'estimateTypeSelectorModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10000;';
  
  modal.innerHTML = `
    <div style="background:var(--s);border-radius:12px;max-width:960px;width:95%;padding:40px;box-shadow:0 20px 60px rgba(0,0,0,0.3);">
      <h2 style="margin:0 0 30px 0;font-size:28px;color:var(--t);">Create New Estimate</h2>
      
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-bottom:30px;">

        <!-- Quick Estimate Option -->
        <div onclick="startNewEstimateOriginal(); closeEstimateTypeSelector();"
             style="border:2px solid var(--br);border-radius:8px;padding:30px;cursor:pointer;transition:all 0.3s;"
             onmouseover="this.style.borderColor='#e8720c';this.style.transform='translateY(-4px)';this.style.boxShadow='0 8px 20px rgba(232,114,12,0.2)';"
             onmouseout="this.style.borderColor='var(--br)';this.style.transform='translateY(0)';this.style.boxShadow='none';">
          <div style="font-size:48px;margin-bottom:15px;">⚡</div>
          <h3 style="margin:0 0 10px 0;font-size:20px;color:#e8720c;">Quick Estimate</h3>
          <p style="margin:0;color:var(--m);font-size:14px;line-height:1.5;">
            Good-Better-Best pricing wizard. Fast, simple, perfect for initial quotes.
          </p>
          <div style="margin-top:15px;font-size:12px;color:var(--m);">
            ⏱️ ~2 minutes
          </div>
        </div>

        <!-- From Template Option -->
        <div onclick="closeEstimateTypeSelector(); showEstimateTemplateSelector();"
             style="border:2px solid var(--br);border-radius:8px;padding:30px;cursor:pointer;transition:all 0.3s;position:relative;"
             onmouseover="this.style.borderColor='#e8720c';this.style.transform='translateY(-4px)';this.style.boxShadow='0 8px 20px rgba(232,114,12,0.2)';"
             onmouseout="this.style.borderColor='var(--br)';this.style.transform='translateY(0)';this.style.boxShadow='none';">
          <div style="position:absolute;top:10px;right:10px;background:linear-gradient(135deg,#e8720c,#e8651f);color:white;font-size:10px;font-weight:700;padding:3px 8px;border-radius:10px;letter-spacing:.5px;">55 TEMPLATES</div>
          <div style="font-size:48px;margin-bottom:15px;">📋</div>
          <h3 style="margin:0 0 10px 0;font-size:20px;color:#e8720c;">From Template</h3>
          <p style="margin:0;color:var(--m);font-size:14px;line-height:1.5;">
            Pre-built job templates for common scopes. Pick, customize, and send.
          </p>
          <div style="margin-top:15px;font-size:12px;color:var(--m);">
            ⏱️ ~3 minutes
          </div>
        </div>

        <!-- Advanced Builder Option -->
        <div onclick="startAdvancedEstimate();"
             style="border:2px solid var(--br);border-radius:8px;padding:30px;cursor:pointer;transition:all 0.3s;"
             onmouseover="this.style.borderColor='#e8720c';this.style.transform='translateY(-4px)';this.style.boxShadow='0 8px 20px rgba(232,114,12,0.2)';"
             onmouseout="this.style.borderColor='var(--br)';this.style.transform='translateY(0)';this.style.boxShadow='none';">
          <div style="font-size:48px;margin-bottom:15px;">🎯</div>
          <h3 style="margin:0 0 10px 0;font-size:20px;color:#e8720c;">Advanced Builder</h3>
          <p style="margin:0;color:var(--m);font-size:14px;line-height:1.5;">
            Multi-trade, line-item estimates with material catalog, templates, and AI review.
          </p>
          <div style="margin-top:15px;font-size:12px;color:var(--m);">
            ⏱️ ~5-10 minutes
          </div>
        </div>

      </div>
      
      <div style="text-align:right;">
        <button onclick="closeEstimateTypeSelector();" 
                style="background:#6c757d;color:white;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-size:14px;">
          Cancel
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
};

window.closeEstimateTypeSelector = function() {
  const modal = document.getElementById('estimateTypeSelectorModal');
  if (modal) modal.remove();
};

window.startAdvancedEstimate = function() {
  closeEstimateTypeSelector();
  openAdvancedBuilder();
};
