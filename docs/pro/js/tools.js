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

  // Track what stage we're at so error messages can be specific
  let stage = 'init';
  let rawResponse = '';

  try {
    // ── Stage 1: pre-flight checks ──
    stage = 'preflight';
    if (!file.type || !file.type.includes('pdf')) {
      throw new Error(`Not a PDF file (got ${file.type || 'unknown type'})`);
    }
    // Cloud Function request body limit is 10 MB. Base64 adds ~33% overhead,
    // so the raw PDF needs to be under ~7.5 MB to fit.
    const mb = (file.size / 1024 / 1024);
    if (mb > 7.5) {
      throw new Error(`PDF too large (${mb.toFixed(1)} MB). Max 7.5 MB — export a lower-res version from Quick Measure and try again.`);
    }
    if (!window.callClaude) {
      throw new Error('Claude proxy not loaded. Refresh the page and try again.');
    }
    if (!window._user?.uid) {
      throw new Error('Not signed in. Please log in and try again.');
    }

    // ── Stage 2: file → base64 ──
    stage = 'reading file';
    const base64 = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          res(reader.result.split(',')[1]);
        } catch (e) {
          rej(new Error('File read returned invalid data URL'));
        }
      };
      reader.onerror = () => rej(new Error('FileReader failed: ' + (reader.error?.message || 'unknown error')));
      reader.readAsDataURL(file);
    });
    if (!base64 || base64.length < 100) {
      throw new Error('PDF base64 encoding produced empty or truncated data');
    }

    statusText.textContent = '🤖 AI extracting measurements…';

    // ── Stage 3: Claude API call ──
    stage = 'Claude API';
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

    // Sonnet 4.5 has stronger PDF document extraction than Haiku 4.5 — the
    // accuracy gain on QM reports is worth the ~5x token cost.
    const result = await window.callClaude({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: prompt }
        ]
      }]
    });

    // ── Stage 4: parse response ──
    stage = 'parsing response';
    if (!result) {
      throw new Error('Claude returned empty response');
    }
    if (result.error) {
      throw new Error('Claude API error: ' + (result.error.message || JSON.stringify(result.error)));
    }
    rawResponse = result?.content?.[0]?.text || '';
    if (!rawResponse) {
      throw new Error('Claude response missing content.[0].text — structure: ' + JSON.stringify(result).substring(0, 200));
    }
    // Strip any code fences Claude might add
    const clean = rawResponse.replace(/```json|```/g, '').trim();
    try {
      _qmData = JSON.parse(clean);
    } catch (parseErr) {
      throw new Error('Claude returned non-JSON response. First 200 chars: ' + clean.substring(0, 200));
    }
    if (!_qmData || typeof _qmData !== 'object') {
      throw new Error('Parsed response is not an object: ' + typeof _qmData);
    }

    statusText.textContent = '✅ Measurements extracted successfully';
    if (typeof showToast === 'function') {
      showToast('✓ Quick Measure imported', 'success');
    }
    renderQMPreview(_qmData);

  } catch(err) {
    // Structured log for diagnosis
    console.error('[QM Import] failed at stage:', stage, {
      message: err?.message,
      fileName: file?.name,
      fileSize: file ? (file.size / 1024 / 1024).toFixed(2) + ' MB' : 'n/a',
      fileType: file?.type,
      rawResponsePreview: rawResponse.substring(0, 200)
    });

    // Surface the actual error to the user. Using DOM builders instead
    // of innerHTML so err.message (which can come from Claude API /
    // network / JSON parser) can never smuggle markup into the page.
    // Matches the security posture of the innerHTML sweep in fe24f7e.
    const msg = (err?.message || 'unknown error').substring(0, 300);
    statusText.textContent = '';
    const xmark = document.createTextNode('❌ ');
    const strong = document.createElement('strong');
    strong.textContent = 'Import failed at: ' + stage;
    const br = document.createElement('br');
    const span = document.createElement('span');
    span.style.cssText = 'font-size:11px;color:var(--m);';
    span.textContent = msg;
    statusText.appendChild(xmark);
    statusText.appendChild(strong);
    statusText.appendChild(br);
    statusText.appendChild(span);

    if (typeof showToast === 'function') {
      showToast('QM import failed: ' + msg.substring(0, 80), 'error');
    }
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
  // Build the preview grid with DOM builders so Claude-extracted field
  // values (address, pitch, etc.) cannot smuggle markup into the page.
  // Matches the security posture from the innerHTML sweep in fe24f7e.
  grid.textContent = '';
  rows.forEach(([k, v]) => {
    const card = document.createElement('div');
    card.style.cssText = 'background:var(--s2);border-radius:5px;padding:6px 8px;';
    const label = document.createElement('div');
    label.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--m);';
    label.textContent = k;
    const value = document.createElement('div');
    value.style.cssText = 'font-size:12px;font-weight:700;color:var(--t);';
    value.textContent = v == null ? '' : String(v);
    card.appendChild(label);
    card.appendChild(value);
    grid.appendChild(card);
  });
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

// (duplicate onboarding flow removed — canonical definition is in dashboard.html)

// Window scope exposures for tools
if (typeof handleQMFile === 'function') window.handleQMFile = handleQMFile;
if (typeof applyQMData === 'function') window.applyQMData = applyQMData;
if (typeof openQMImportModal === 'function') window.openQMImportModal = openQMImportModal;
if (typeof closeQMImportModal === 'function') window.closeQMImportModal = closeQMImportModal;
if (typeof saveQuickLead === 'function') window.saveQuickLead = saveQuickLead;
if (typeof exportLeadsCSV === 'function') window.exportLeadsCSV = exportLeadsCSV;
