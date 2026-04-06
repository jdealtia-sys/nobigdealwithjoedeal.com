// ══════════════════════════════════════════════════════════════
// NBD Pro — tools.js
// QM Import, Quick Add, CSV Export, Onboarding
// ══════════════════════════════════════════════════════════════

// ── GAF Quick Measure Import ──

// ══ GAF QUICK MEASURE IMPORT ══════════════════════════════════════════════
// GAF Quick Measure uses Anthropic API (key from Settings → Ask Joe AI)
let _qmData = null;

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

    const _qmKey = typeof getJoeKey === 'function' ? getJoeKey() : (localStorage.getItem('nbd_joe_key') || '');
    if (!_qmKey || !_qmKey.startsWith('sk-ant')) {
      throw new Error('Add your Anthropic API key in Settings → Ask Joe AI to use Quick Measure import');
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-allow-browser': 'true',
        'x-api-key': _qmKey
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const result = await resp.json();
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

// ══ WARRANTY CERTIFICATE GENERATOR ═══════════════════════════════════════
// Use var to avoid "already declared" error if dashboard.html inline script loaded first
var WC_TIER_DESCS = WC_TIER_DESCS || {
  standard: 'NBD will return and correct any labor-related defect at no charge for the lifetime of the installation. Does not transfer on sale of property.',
  preferred: 'NBD will return and correct any labor-related defect at no charge for the lifetime of the installation. Transferable to one subsequent owner within 30 days of sale.',
  elite: 'NBD will return and correct any labor-related defect at no charge for the lifetime of the installation. Fully transferable — follows the property through all subsequent owners. Annual courtesy inspection included.'
};

function openWarrantyCertWizard(lead) {
  const modal = document.getElementById('warrantyCertModal');
  // Pre-fill from lead if provided
  if (lead) {
    const owner = `${lead.firstName||''} ${lead.lastName||''}`.trim() || '';
    document.getElementById('wcOwner').value = owner;
    document.getElementById('wcAddr').value = lead.address || '';
    document.getElementById('wcWork').value = lead.damageType ? `${lead.damageType} — GAF Timberline` : 'Roof replacement — GAF Timberline';
  }
  // Default date to today
  document.getElementById('wcDate').value = new Date().toISOString().split('T')[0];
  updateCertPreview();
  modal.classList.add('open');
}

function updateCertPreview() {
  const tier = document.getElementById('wcTier')?.value || 'standard';
  const desc = document.getElementById('wcTierDesc');
  if (desc) desc.textContent = WC_TIER_DESCS[tier] || '';
}

function generateWarrantyCertPDF() {
  const owner = document.getElementById('wcOwner').value.trim() || '___________________';
  const addr  = document.getElementById('wcAddr').value.trim()  || '___________________';
  const date  = document.getElementById('wcDate').value         || '';
  const tier  = document.getElementById('wcTier').value         || 'standard';
  const work  = document.getElementById('wcWork').value.trim()  || 'Roofing installation';

  const dateFormatted = date ? new Date(date + 'T12:00:00').toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric'}) : '___________________';
  const certNum = 'NBD-' + Date.now().toString().slice(-6);

  const tierLabels = {
    standard: 'Standard — Lifetime Labor Guarantee',
    preferred: 'Preferred — Lifetime Labor Guarantee (Transferable to One Owner)',
    elite: 'Elite — Lifetime Labor Guarantee (Fully Transferable + Annual Inspection)'
  };
  const tierLabel = tierLabels[tier];
  const tierDesc = WC_TIER_DESCS[tier];

  const isElite = tier === 'elite';
  const isPreferred = tier === 'preferred';

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <title>NBD Warranty Certificate — ${addr}</title>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800;900&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Barlow',sans-serif;background:#fff;color:#111;padding:40px 48px;max-width:800px;margin:0 auto;}
    .header{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:4px solid #C8541A;margin-bottom:28px;}
    .brand{font-family:'Barlow Condensed',sans-serif;font-size:26px;font-weight:900;text-transform:uppercase;letter-spacing:.03em;}
    .brand span{color:#C8541A;}
    .brand-sub{font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#C8541A;border:1px solid #C8541A;padding:2px 10px;border-radius:2px;display:inline-block;margin-top:6px;}
    .cert-header{text-align:right;}
    .cert-type{font-size:9px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#999;margin-bottom:4px;}
    .cert-title{font-family:'Barlow Condensed',sans-serif;font-size:30px;font-weight:900;text-transform:uppercase;letter-spacing:.04em;color:#111;}
    .cert-num{font-size:11px;color:#888;margin-top:4px;}
    .tier-badge{display:inline-block;background:${isElite?'#111':isPreferred?'#1a3260':'#C8541A'};color:#fff;font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:6px 18px;border-radius:3px;margin-bottom:24px;}
    h2{font-family:'Barlow Condensed',sans-serif;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:#111;margin:22px 0 12px;padding-bottom:5px;border-bottom:2px solid #C8541A;}
    .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px 24px;margin-bottom:8px;}
    .field label{font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#999;display:block;margin-bottom:3px;}
    .field .val{font-size:15px;font-weight:700;color:#111;border-bottom:1.5px solid #ddd;padding-bottom:4px;min-height:24px;}
    .guarantee-box{background:#f9f9f9;border:1px solid #eee;border-left:4px solid #C8541A;border-radius:4px;padding:16px 18px;margin:16px 0;}
    .guarantee-box .tier{font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#C8541A;margin-bottom:6px;}
    .guarantee-box .terms{font-size:12px;color:#444;line-height:1.7;}
    .features{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:12px 0;}
    .feature{display:flex;align-items:center;gap:8px;font-size:12px;color:#333;}
    .feature-dot{width:8px;height:8px;border-radius:50%;background:#C8541A;flex-shrink:0;}
    .sig-section{margin-top:32px;padding-top:20px;border-top:1px solid #eee;}
    .sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:20px;}
    .sig-line{border-bottom:1.5px solid #333;height:32px;margin-bottom:5px;}
    .sig-label{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888;}
    .footer{margin-top:24px;padding-top:14px;border-top:1px solid #eee;display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#aaa;}
    .seal{width:60px;height:60px;border-radius:50%;border:3px solid #C8541A;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#C8541A;text-align:center;line-height:1.3;padding:8px;}
    @page{margin:1.5cm 2cm;size:letter;}
    *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
  </style></head><body>

  <div class="header">
    <div>
      <div class="brand">No Big <span>Deal</span> Home Solutions</div>
      <div class="brand-sub">Insurance Restoration Specialists · Greater Cincinnati</div>
      <div style="font-size:11px;color:#666;margin-top:8px;">(859) 420-7382 · jd@nobigdealwithjoedeal.com</div>
    </div>
    <div class="cert-header">
      <div class="cert-type">Official Document</div>
      <div class="cert-title">Warranty<br>Certificate</div>
      <div class="cert-num">Certificate No. ${certNum}</div>
    </div>
  </div>

  <div class="tier-badge">🛡️ ${tierLabel}</div>

  <h2>Property &amp; Installation</h2>
  <div class="grid-2">
    <div class="field" style="grid-column:1/-1;"><label>Property Address</label><div class="val">${addr}</div></div>
    <div class="field"><label>Homeowner</label><div class="val">${owner}</div></div>
    <div class="field"><label>Installation Date</label><div class="val">${dateFormatted}</div></div>
    <div class="field" style="grid-column:1/-1;"><label>Work Performed</label><div class="val">${work}</div></div>
  </div>

  <h2>Guarantee Terms</h2>
  <div class="guarantee-box">
    <div class="tier">${tierLabel}</div>
    <div class="terms">${tierDesc}</div>
  </div>

  <div class="features">
    <div class="feature"><div class="feature-dot"></div>Lifetime labor guarantee — no expiration</div>
    <div class="feature"><div class="feature-dot"></div>GAF Timberline lifetime manufacturer shingle warranty</div>
    ${isPreferred||isElite ? '<div class="feature"><div class="feature-dot"></div>Transferable to new owner on sale</div>' : ''}
    ${isElite ? '<div class="feature"><div class="feature-dot"></div>Annual courtesy inspection included</div>' : ''}
    ${isElite ? '<div class="feature"><div class="feature-dot"></div>Fully transferable — follows the property</div>' : ''}
    <div class="feature"><div class="feature-dot"></div>Backed personally by Joe Deal</div>
    <div class="feature"><div class="feature-dot"></div>Recorded on file at NBD Home Solutions</div>
  </div>

  <p style="font-size:11px;color:#666;margin-top:16px;line-height:1.7;">This guarantee covers defects in labor and workmanship only. It does not cover damage caused by acts of nature, severe weather events, improper maintenance, or modifications made by parties other than No Big Deal Home Solutions. The GAF manufacturer shingle warranty is a separate warranty provided directly by GAF and is not administered by No Big Deal Home Solutions.</p>

  <h2>Signatures</h2>
  <div class="sig-section">
    <div class="sig-grid">
      <div>
        <div class="sig-line"></div>
        <div class="sig-label">Homeowner Signature &amp; Date</div>
      </div>
      <div>
        <div class="sig-line"></div>
        <div class="sig-label">Joe Deal — No Big Deal Home Solutions</div>
      </div>
    </div>
  </div>

  <div class="footer">
    <div>
      <div style="font-weight:700;color:#111;font-size:11px;margin-bottom:2px;">No Big Deal Home Solutions</div>
      <div>nobigdealwithjoedeal.com · (859) 420-7382 · Greater Cincinnati, OH</div>
      <div style="margin-top:2px;">Certificate No. ${certNum} · Keep this document with your permanent home records</div>
    </div>
    <div class="seal">NBD<br>Lifetime<br>Guarantee</div>
  </div>

  <script>window.print();<\/script>
  </body></html>`;

  const w = window.open('', '_blank');
  w.document.write(html);
  w.document.close();
  document.getElementById('warrantyCertModal').classList.remove('open');
  showToast('✓ Warranty certificate generated', 'success');
}

window.openWarrantyCertWizard = openWarrantyCertWizard;
window.updateCertPreview = updateCertPreview;
window.generateWarrantyCertPDF = generateWarrantyCertPDF;
// ══ END WARRANTY CERTIFICATE ═══════════════════════════════════════════════

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

// ── Quick Add Lead ──

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

// ── Lead Export CSV ──

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

// ── Onboarding Flow ──

// ══ ONBOARDING FLOW ════════════════════════════════════════════════════
let _onbStep = 1;

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
