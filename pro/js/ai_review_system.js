// ═══════════════════════════════════════════════════════════════════════
// AI REVIEW SYSTEM - Free Gemini Flash analysis for missed items
// ═══════════════════════════════════════════════════════════════════════

window.runAIReview = async function() {
  const est = window.advancedEstimate;
  
  if (est.lineItems.length === 0) {
    if(typeof showToast==='function') showToast('Add some line items first before running AI review','error'); else alert('Add some line items first before running AI review');
    return;
  }
  
  // Show loading state
  const loadingModal = document.createElement('div');
  loadingModal.id = 'aiReviewLoadingModal';
  loadingModal.className = 'modal-overlay';
  loadingModal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10004;';
  loadingModal.innerHTML = `
    <div style="background:white;border-radius:12px;padding:40px;text-align:center;">
      <div style="font-size:48px;margin-bottom:15px;">🤖</div>
      <div style="font-size:18px;font-weight:600;margin-bottom:10px;">AI Reviewing Your Estimate...</div>
      <div style="font-size:14px;color:#666;">This may take a few seconds</div>
    </div>
  `;
  document.body.appendChild(loadingModal);
  
  try {
    // Build context for AI
    const itemsList = est.lineItems.map(item => `${item.name} (${item.qty} ${item.unit})`).join(', ');
    const tradesStr = est.trades.join(', ');
    
    const prompt = `You are a professional roofing and home exterior contractor reviewing an estimate for potential issues or missing items.

Project: ${est.projectName}
Structure: ${est.structure || 'Main House'}
Trades: ${tradesStr}

Current Line Items:
${itemsList}

Please review this estimate and provide:
1. A brief checklist of what IS included (✓)
2. Suggestions for potentially missing items (⚠)
3. Code requirements or safety items to consider

Focus on common oversights like:
- Proper ventilation (ridge vents, soffit vents)
- Flashing components (pipe boots, chimney flashing, valley flashing)
- Ice & water shield coverage
- Permits and inspections
- Debris removal and cleanup
- Safety items (guards, boots)

Keep your response concise and formatted with bullet points. Use ✓ for included items and ⚠ for suggestions.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-allow-browser': 'true', 'x-api-key': localStorage.getItem('nbd_joe_key') || '' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: prompt
        }]
      })
    });
    
    const data = await response.json();
    
    if (data.content && data.content[0]?.text) {
      const suggestions = data.content[0].text;
      showAIReviewResults(suggestions);
    } else {
      throw new Error('Invalid response from AI');
    }
    
  } catch (error) {
    console.error('AI Review error:', error);
    if(typeof showToast==='function') showToast('AI review failed: ' + error.message,'error'); else alert('AI review failed: ' + error.message);
  } finally {
    loadingModal.remove();
  }
};

function showAIReviewResults(suggestions) {
  const modal = document.createElement('div');
  modal.id = 'aiReviewModal';
  modal.className = 'modal-overlay';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10004;';
  
  // Format suggestions with proper line breaks and styling
  const formattedSuggestions = suggestions
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>')
    .replace(/✓/g, '<span style="color:#28a745;">✓</span>')
    .replace(/⚠/g, '<span style="color:#ffc107;">⚠</span>');
  
  modal.innerHTML = `
    <div style="background:white;border-radius:12px;max-width:700px;width:90%;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:25px;background:linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);color:white;">
        <h3 style="margin:0;font-size:22px;">🤖 AI Review Results</h3>
        <div style="font-size:13px;opacity:0.9;margin-top:5px;">Powered by Gemini Flash</div>
      </div>
      
      <div style="flex:1;overflow-y:auto;padding:25px;line-height:1.8;">
        <div style="font-size:14px;color:#333;">
          ${formattedSuggestions}
        </div>
      </div>
      
      <div style="padding:20px;border-top:2px solid #eee;background:#f9f9f9;">
        <div style="font-size:12px;color:#666;margin-bottom:15px;">
          💡 These are AI-generated suggestions. Review them carefully and add items as needed.
        </div>
        <div style="text-align:right;">
          <button onclick="closeAIReviewModal();" 
                  style="background:#C8541A;color:white;border:none;padding:12px 24px;border-radius:6px;cursor:pointer;font-weight:600;">
            Got It
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

window.closeAIReviewModal = function() {
  const modal = document.getElementById('aiReviewModal');
  if (modal) modal.remove();
};
