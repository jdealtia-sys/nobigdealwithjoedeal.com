
function openEditCustomerModal() {
  const lead = window._currentLead;
  if (!lead) return;
  document.getElementById('editFirstName').value = lead.firstName || '';
  document.getElementById('editLastName').value = lead.lastName || '';
  document.getElementById('editPhone').value = lead.phone || '';
  document.getElementById('editEmail').value = lead.email || '';
  document.getElementById('editAddress').value = lead.address || '';
  document.getElementById('editDamageType').value = lead.damageType || lead.serviceType || '';
  document.getElementById('editJobValue').value = lead.jobValue || lead.estimatedValue || '';
  const modal = document.getElementById('editCustomerModal');
  modal.style.display = 'flex';
}

function closeEditCustomerModal() {
  document.getElementById('editCustomerModal').style.display = 'none';
}

async function saveCustomerEdits() {
  const btn = document.getElementById('saveEditBtn');
  btn.disabled = true;
  btn.textContent = 'SAVING...';
  try {
    const updates = {
      firstName: document.getElementById('editFirstName').value.trim(),
      lastName: document.getElementById('editLastName').value.trim(),
      phone: document.getElementById('editPhone').value.trim(),
      email: document.getElementById('editEmail').value.trim(),
      address: document.getElementById('editAddress').value.trim(),
      damageType: document.getElementById('editDamageType').value.trim(),
      jobValue: document.getElementById('editJobValue').value.trim(),
      updatedAt: new Date()
    };
    await window.updateDoc(window.doc(window.db, 'leads', window._customerId), updates);
    // Update display
    document.getElementById('customerName').textContent = ((updates.firstName + ' ' + updates.lastName).trim()) || 'Unknown';
    document.getElementById('customerAddress').textContent = updates.address || '—';
    document.getElementById('customerPhone').textContent = updates.phone || '—';
    document.getElementById('customerEmail').textContent = updates.email || '—';
    const callLink = document.getElementById('callLink');
    if (callLink) callLink.href = 'tel:' + updates.phone.replace(/\D/g, '');
    const emailLink = document.getElementById('emailLink');
    if (emailLink) emailLink.href = 'mailto:' + updates.email;
    // NEW-D17: refresh the header value cells live (mirrors loadCustomerData
    // lines ~3449-3451) so the Job Value / Damage Type don't stay stale until
    // a full reload.
    const _jvCell = document.getElementById('infoJobValue');
    if (_jvCell && ('jobValue' in updates)) _jvCell.textContent = updates.jobValue ? `$${parseFloat(updates.jobValue).toLocaleString()}` : '—';
    const _dtCell = document.getElementById('infoDamageType');
    if (_dtCell && ('damageType' in updates)) _dtCell.textContent = updates.damageType || '—';
    // Update local state
    Object.assign(window._currentLead, updates);
    // jobValue feeds the profit-panel margin math → re-render it too
    if (window.ProfitTracker && typeof window.ProfitTracker.renderCostPanel === 'function') {
      try { window.ProfitTracker.renderCostPanel('profitPanel', window._customerId); } catch (e) {}
    }
    closeEditCustomerModal();
    if (typeof showToast === 'function') showToast('Customer info updated', 'success');
  } catch(e) {
    console.error('Save failed:', e);
    if (typeof showToast === 'function') showToast('Failed to save: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.textContent = 'SAVE CHANGES';
}

// Close on backdrop click
document.getElementById('editCustomerModal').addEventListener('click', function(e) {
  if (e.target === this) closeEditCustomerModal();
});
