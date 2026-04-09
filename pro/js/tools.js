// ══════════════════════════════════════════════════════════════
// NBD Pro — tools.js
// QM Import, Quick Add, CSV Export, Onboarding
// ══════════════════════════════════════════════════════════════

// ── GAF Quick Measure Import ──

// ══ GAF QUICK MEASURE IMPORT ══════════════════════════════════════════════
// GAF Quick Measure uses Anthropic API (key from Settings → Ask Joe AI)
// Use var to avoid redeclaration collision with dashboard.html inline script
var _qmData = _qmData || null;

function openQMImportModal() {
  _qmData = null;
  document.getElementById('qmImportModal').classList.add('open');
  document.getElementById('qmStatus').style.display = 'none';
  document.getElementById('qmPreview').style.display = 'none';
  document.getElementById('qmApplyBtn').style.display = 'none';
  document.getElementById('qmFileInput').value = '';
  document.getElementById('qmDropZone').style.borderColor = '';
}

function closeQMImportModal() {
  document.getElementById('qmImportModal').classList.remove('open');
}

function handleQMDrop(e) {
  e.preventDefault();
  document.getElementById('qmDropZone').style.borderColor = '';
  const file = e.dataTransfer.files[0];
  if (file && file.type === 'application/pdf') handleQMFile(file);
  else showToast('Please drop a PDF file', 'error');
}

async function handleQMFile(file) {
  if (!file) return;
  const statusEl = document.getElementById('qmStatus');
  const statusText = document.getElementById('qmStatusText');
  statusEl.style.display = 'block';
  statusText.textContent = '⏳ Reading PDF...';
  document.getElementById('qmPreview').style.display = 'none';
  document.getElementById('qmApplyBtn').style.display = 'none';

  try {
    // Convert PDF to base64
    const base64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result.split(',')[1]);
      reader.onerror = () => rej(new Error('File read failed'));
      reader.readAsDataURL(file);
    });

    statusText.textContent = '🤖 AI extracting measurements...';

    const prompt = `You are parsing a GAF Quick Measure roofing report PDF. Extract ONLY these exact fields and return ONLY valid JSON with no markdown, no explanation, no backticks:
{
  "address": "full property address",
  "roofArea": number (sq ft, total),
  "roofFacets": number,
  "pitch": "X/12 format predominant pitch e.g. 6/12",
  "ridges": number (ft),
  "hips": number (ft),
  "valleys": number (ft),
  "rakes": number (ft),
  "eaves": number (ft),
  "bends": number (ft),
  "flash": number (ft),
  "step": number (ft),
  "dripEdge": number (ft),
  "leakBarrier": number (ft),
  "ridgeCap": number (ft),
  "starter": number (ft),
  "penetrations": number,
  "suggestedWastePct": number (suggested waste % as integer e.g. 14),
  "squaresAtSuggestedWaste": number
}
Return ONLY the JSON object. No other text.`;

    if (!window.callClaude) {
      throw new Error('Claude proxy not loaded. Refresh the page and try again.');
    }

    const result = await window.callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: prompt }
        ]
      }]
    });

    const raw = result?.content?.[0]?.text || '';
    const clean = raw.replace(/```json|```/g, '').trim();
    _qmData = JSON.parse(clean);

    statusText.textContent = '✅ Measurements extracted successfully';
    renderQMPreview(_qmData);

  } catch(err) {
    console.error('QM Import error:', err);
    statusText.textContent = '❌ Failed to parse PDF. Please try again or check the file.';
    showToast('QM import failed', 'error');
  }
}

function renderQMPreview(d) {
  const grid = document.getElementById('qmPreviewGrid');
  const rows = [
    ['Address', d.address],
    ['Roof Area', d.roofArea + ' sq ft'],
    ['Facets', d.roofFacets],
    ['Pitch', d.pitch],
    ['Ridges', d.ridges + ' ft'],
    ['Hips', d.hips + ' ft'],
    ['Valleys', d.valleys + ' ft'],
    ['Rakes', d.rakes + ' ft'],
    ['Eaves', d.eaves + ' ft'],
    ['Drip Edge', d.dripEdge + ' ft'],
    ['Leak Barrier', d.leakBarrier + ' ft'],
    ['Ridge Cap', d.ridgeCap + ' ft'],
    ['Suggested Waste', d.suggestedWastePct + '%'],
    ['Squares (w/waste)', d.squaresAtSuggestedWaste],
  ];
  grid.innerHTML = rows.map(([k,v]) => `
    <div style="background:var(--s2);border-radius:5px;padding:6px 8px;">
      <div style="font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--m);">${k}</div>
      <div style="font-size:12px;font-weight:700;color:var(--t);">${v}</div>
    </div>`).join('');
  document.getElementById('qmPreview').style.display = 'block';
  document.getElementById('qmApplyBtn').style.display = 'flex';
}

function applyQMData() {
  if (!_qmData) return;
  const d = _qmData;

  // Populate Step 1 fields
  const addr = document.getElementById('estAddr'); if (addr) addr.value = d.address || '';
  const sqft = document.getElementById('estRawSqft'); if (sqft) { sqft.value = d.roofArea || ''; }
  const ridge = document.getElementById('estRidge'); if (ridge) ridge.value = d.ridges || '';
  const eave = document.getElementById('estEave'); if (eave) eave.value = d.eaves || '';
  const hip = document.getElementById('estHip'); if (hip) hip.value = d.hips || '';

  // Store full QM data on estData for export appendix
  estData._qm = d;

  // Show QM import note
  const qmNote = document.getElementById('qmImportNote');
  if (qmNote) qmNote.style.display = 'block';
  const drawNote = document.getElementById('drawImportNote');
  if (drawNote) drawNote.style.display = 'none';

  // Auto-select pitch in Step 2
  const pitchMap = {
    '4/12': '1.054|4/12', '5/12': '1.083|5/12', '6/12': '1.118|6/12',
    '7/12': '1.158|7/12', '8/12': '1.202|8/12', '9/12': '1.25|9/12',
    '10/12': '1.302|10/12', '11/12': '1.357|11/12', '12/12': '1.414|12/12'
  };
  const pitchKey = (d.pitch || '').replace(/\s/g,'');
  const pitchSel = document.getElementById('estPitch');
  if (pitchSel && pitchMap[pitchKey]) pitchSel.value = pitchMap[pitchKey];

  // Auto-select waste factor closest to suggested
  const wastePct = d.suggestedWastePct || 14;
  const wasteSel = document.getElementById('estWaste');
  if (wasteSel) {
    const wasteMap = [[10,'1.10'],[15,'1.15'],[17,'1.17'],[20,'1.20'],[25,'1.25']];
    const closest = wasteMap.reduce((a,b) => Math.abs(b[0]-wastePct) < Math.abs(a[0]-wastePct) ? b : a);
    wasteSel.value = closest[1];
  }

  updateEstCalc();
  closeQMImportModal();
  showToast('✅ Quick Measure data applied', 'success');
}

// ══ QUICK ADD LEAD (mobile field tool) ════════════════════════════════
function openQuickAddLead() {
  document.getElementById('quickAddModal').classList.add('open');
  document.getElementById('qaAddr').value = '';
  document.getElementById('qaPhone').value = '';
  document.getElementById('qaErr').style.display = 'none';
  setTimeout(() => document.getElementById('qaAddr').focus(), 120);
}
function closeQuickAddLead() {
  document.getElementById('quickAddModal').classList.remove('open');
}
async function saveQuickLead() {
  const addr = document.getElementById('qaAddr').value.trim();
  const phone = document.getElementById('qaPhone').value.trim();
  const damage = document.getElementById('qaDamage').value;
  const source = document.getElementById('qaSource').value;
  const errEl = document.getElementById('qaErr');

  if (!addr) {
    errEl.textContent = 'Address is required.';
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';

  const btn = document.querySelector('#quickAddModal button[onclick="saveQuickLead()"]');
  const orig = btn.textContent;
  btn.textContent = 'Saving...';
  btn.disabled = true;

  try {
    await window._saveLead({
      address: addr,
      phone: phone || '',
      damageType: damage,
      source: source,
      stage: 'New',
      firstName: '',
      lastName: '',
      email: '',
      notes: '',
      followUp: '',
      insCarrier: '',
      jobValue: '',
      claimStatus: 'No Claim'
    });
    showToast('✓ Lead added — tap CRM to view', 'success');
    closeQuickAddLead();
    loadLeads();
  } catch(e) {
    errEl.textContent = 'Save failed. Check connection.';
    errEl.style.display = 'block';
    btn.textContent = orig;
    btn.disabled = false;
  }
}
window.openQuickAddLead = openQuickAddLead;
window.closeQuickAddLead = closeQuickAddLead;
window.saveQuickLead = saveQuickLead;
// ══ END QUICK ADD ══════════════════════════════════════════════════════

// (warranty certificate functions removed — canonical source is warranty-cert.js)

// ══ LEAD EXPORT CSV ═══════════════════════════════════════════════════════
function exportLeadsCSV() {
  const leads = window._leads || [];
  if (!leads.length) { showToast('No leads to export', 'error'); return; }

  const headers = [
    'First Name','Last Name','Address','Phone','Email','Stage','Source',
    'Damage Type','Claim Status','Insurance Carrier','Job Value','Follow Up',
    'Notes','Created'
  ];

  const rows = leads.map(l => [
    l.firstName||'', l.lastName||'', l.address||'', l.phone||'', l.email||'',
    l.stage||'', l.source||'', l.damageType||'', l.claimStatus||'',
    l.insCarrier||'', l.jobValue||'', l.followUp||'',
    (l.notes||'').replace(/,/g,';').replace(/\n/g,' '),
    l.createdAt?.toDate ? l.createdAt.toDate().toLocaleDateString() : ''
  ].map(v => `"${String(v).replace(/"/g,'""')}"`));

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `NBD-Leads-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`✓ Exported ${leads.length} leads to CSV`, 'success');
}
window.exportLeadsCSV = exportLeadsCSV;
// ══ END LEAD EXPORT ════════════════════════════════════════════════════════

window.openQMImportModal = openQMImportModal;
window.closeQMImportModal = closeQMImportModal;
window.handleQMDrop = handleQMDrop;
window.handleQMFile = handleQMFile;
window.applyQMData = applyQMData;
// ══ END QUICK MEASURE IMPORT ═══════════════════════════════════════════════

// (duplicate openQuickAddLead/closeQuickAddLead/saveQuickLead removed — canonical definition is above)

// (duplicate exportLeadsCSV removed — canonical definition is above)

// ── Onboarding Flow ──

// ══ ONBOARDING FLOW ════════════════════════════════════════════════════
// _onbStep may already be declared inline in dashboard.html
if (typeof _onbStep === 'undefined') { var _onbStep = 1; }

async function checkAndShowOnboarding() {
  if (!window._user) return;
  try {
    const { getDoc, doc, setDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    const userSnap = await getDoc(doc(window._db, 'users', window._user.uid));
    const userData = userSnap.exists() ? userSnap.data() : {};

    // Show onboarding if user has never completed it
    if (!userData.onboarded) {
      // Pre-fill name from auth
      const name = window._user.displayName || '';
      if (name) document.getElementById('onbName').value = name;
      if (userData.company) document.getElementById('onbCompany').value = userData.company;
      if (userData.phone) document.getElementById('onbPhone').value = userData.phone;
      if (userData.phone) { const ph = document.getElementById('onbPhone'); if(ph) ph.value = userData.phone; }
      if (userData.role) { const rl = document.getElementById('onbRole'); if(rl) rl.value = userData.role; }

      // Personalize greeting
      const firstName = (name || '').split(' ')[0] || 'there';
      document.getElementById('onbGreeting').textContent = `Hey ${firstName}, let's get you set up.`;

      const modal = document.getElementById('onboardingModal');
      modal.style.display = 'flex';
      setTimeout(() => document.getElementById('onbCompany').focus(), 200);

      // Wire autocomplete for Step 2 address
      setTimeout(() => initAddressAutocomplete('onbAddr'), 300);
    }
  } catch(e) {
    console.error('Onboarding check error:', e);
  }
}

async function onbNext(step) {
  if (step === 1) {
    const company = document.getElementById('onbCompany').value.trim();
    const name = document.getElementById('onbName').value.trim();

    // Save company + display name
    if (company || name) {
      try {
        const { setDoc, doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
        const phone = document.getElementById('onbPhone')?.value?.trim() || '';
        const role  = document.getElementById('onbRole')?.value || 'owner';
        const updates = {};
        if (company) updates.company = company;
        if (phone) updates.phone = phone;
        if (role) updates.role = role;
        if (name) {
          const parts = name.split(' ');
          updates.firstName = parts[0] || '';
          updates.lastName = parts.slice(1).join(' ') || '';
        }
        await setDoc(doc(window._db, 'users', window._user.uid), updates, { merge: true });

        // Also update settings UI
        if (phone) { const sp = document.getElementById('settingsPhone'); if(sp) sp.value = phone; }
        if (company) { const sc = document.getElementById('settingsCompany'); if(sc) sc.value = company; }

        // Update header display name
        if (name) {
          document.getElementById('userName').textContent = name;
          if (document.getElementById('userAvatar')) document.getElementById('userAvatar').textContent = name[0].toUpperCase();
          if (window._userSettings) window._userSettings.displayName = name;
        }
      } catch(e) { console.error('Onboarding step 1 save error:', e); }
    }

    // Advance to step 2
    document.getElementById('onbStep1').style.display = 'none';
    document.getElementById('onbStep2').style.display = 'block';
    document.getElementById('onbDot2').style.background = 'var(--orange)';
    document.getElementById('onbAddr').focus();
  }
}

async function onbSaveLead() {
  const addr = document.getElementById('onbAddr').value.trim();
  const damage = document.getElementById('onbDamage').value;
  if (addr) {
    try {
      await window._saveLead({
        address: addr, damageType: damage, source: 'Direct',
        stage: 'New', firstName: '', lastName: '', phone: '',
        email: '', notes: '', followUp: '', insCarrier: '',
        jobValue: '', claimStatus: 'No Claim'
      });
      showToast('✓ Lead added to your pipeline', 'success');
      loadLeads();
    } catch(e) { console.error('Onboarding lead save error:', e); }
  }
  onbShowFinal();
}

function onbSkipLead() { onbShowFinal(); }

function onbShowFinal() {
  document.getElementById('onbStep2').style.display = 'none';
  document.getElementById('onbStep3').style.display = 'block';
  document.getElementById('onbDot3').style.background = 'var(--orange)';
}

async function onbFinish() {
  // Mark onboarded in Firestore
  try {
    const { setDoc, doc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
    await setDoc(doc(window._db, 'users', window._user.uid), { onboarded: true }, { merge: true });
  } catch(e) { console.error('Onboarding finish error:', e); }
  document.getElementById('onboardingModal').style.display = 'none';
}

window.onbNext = onbNext;
window.onbSaveLead = onbSaveLead;
window.onbSkipLead = onbSkipLead;
window.onbFinish = onbFinish;
window.checkAndShowOnboarding = checkAndShowOnboarding;
// ══ END ONBOARDING ═════════════════════════════════════════════════════

// Window scope exposures for tools
if (typeof handleQMFile === 'function') window.handleQMFile = handleQMFile;
if (typeof applyQMData === 'function') window.applyQMData = applyQMData;
if (typeof openQMImportModal === 'function') window.openQMImportModal = openQMImportModal;
if (typeof closeQMImportModal === 'function') window.closeQMImportModal = closeQMImportModal;
if (typeof saveQuickLead === 'function') window.saveQuickLead = saveQuickLead;
if (typeof exportLeadsCSV === 'function') window.exportLeadsCSV = exportLeadsCSV;
if (typeof checkAndShowOnboarding === 'function') window.checkAndShowOnboarding = checkAndShowOnboarding;
