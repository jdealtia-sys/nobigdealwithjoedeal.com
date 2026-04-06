// ============================================================
// NBD Pro — estimates.js
// Inline estimate builder (original), calculations, tier pricing
// Extracted from dashboard.html for maintainability
// ============================================================

// Default pricing table (Cincinnati/Ohio market fallback)
const DEFAULT_RATES = {
  shingle: 4.25, felt: 0.45, tear: 1.75, starter: 2.10, drip: 1.85,
  ridge: 5.50, iws: 2.25, hip: 5.75, pipe: 45.00, deck: 2.50,
  gutter: 8.50, deckPct: 0.15
};

// Product Library → Estimate Rate Mapping
// Maps estimate line-item codes to product library IDs
const PRODUCT_MAP = {
  shingle: { id: 'shingle_001', unitConvert: 1/100 }, // product is per SQ (100sqft), rate is per sqft
  felt:    { id: 'under_001',   unitConvert: 1/100 }, // product per SQ, rate per sqft
  tear:    null,                                        // labor only — no product mapping
  starter: { id: 'flash_008',  unitConvert: 1/100 }, // product per BDNL (~100LF), rate per LF
  drip:    { id: 'flash_003',  unitConvert: 1 },     // product per LF, rate per LF
  ridge:   { id: 'flash_007',  unitConvert: 1/25 },  // product per BDNL (~25LF), rate per LF
  iws:     { id: 'under_006',  unitConvert: 1/200 }, // product per RL (200SF), rate per sqft
  hip:     { id: 'flash_007',  unitConvert: 1/25 },  // same as ridge
  pipe:    { id: 'flash_002',  unitConvert: 1 },     // product per EA, rate per EA
  deck:    null,                                        // decking — use default rate
  gutter:  null                                         // gutters — use default rate
};

// Build window.R by pulling live pricing from product library, falling back to defaults
function syncRatesFromProductLibrary(tier) {
  tier = tier || 'better';
  const rates = Object.assign({}, DEFAULT_RATES);

  if (window._productLib && typeof window._productLib.getProducts === 'function') {
    const products = window._productLib.getProducts();
    for (const [key, mapping] of Object.entries(PRODUCT_MAP)) {
      if (!mapping) continue;
      const product = products.find(p => p.id === mapping.id);
      if (product && product.pricing && product.pricing[tier]) {
        // Convert product sell price to per-unit rate used by estimates
        rates[key] = product.pricing[tier].sell * mapping.unitConvert;
      }
    }
  }

  window.R = rates;
  return rates;
}

// Initialize rates — try product library first, then defaults
if (typeof window.R === 'undefined' || !window.R) {
  syncRatesFromProductLibrary('better');
}

function startNewEstimate() {
  showEstimateTypeSelector();
}

function startNewEstimateOriginal() {
  document.getElementById('est-list').style.display='none';
  document.getElementById('est-builder').style.display='flex';
  document.getElementById('est-builder').style.flexDirection='column';
  estCurrentStep=0; selectedTier=null; estData={};
  window._estLinkedLeadId = null;
  window._editingEstimateId = null;
  const titleEl = document.getElementById('estBuilderTitle');
  if (titleEl) titleEl.textContent = 'New Estimate';
  showEstStep(1);
  document.getElementById('drawImportNote').style.display='none';
  ['estAddr','estOwner','estParcel','estYear','estRawSqft','estRidge','estEave','estHip'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('estPipes').value='4';
  updateEstCalc();
}

function cancelEstimate() {
  document.getElementById('est-list').style.display='block';
  document.getElementById('est-builder').style.display='none';
  window._editingEstimateId = null;
}

function showEstStep(n) {
  [1,2,3,4].forEach(i=>{
    document.getElementById('estStep'+i).style.display=i===n?'block':'none';
    const sEl=document.getElementById('estS'+i);
    sEl.className='est-step'+(i<n?' done':i===n?' active':'');
  });
  estCurrentStep=n;
}

function estNext(from) {
  if(from===1){
    const rawVal = parseFloat(document.getElementById('estRawSqft').value);
    if(!rawVal || rawVal <= 0 || isNaN(rawVal)){showToast('Enter a valid square footage (greater than 0)','error');return;}
    if(rawVal > 100000){showToast('Square footage seems too high — please double-check','error');return;}
    updateEstCalc(); showEstStep(2);
  } else if(from===2){
    const ridge=parseFloat(document.getElementById('estRidge').value)||0;
    const eave=parseFloat(document.getElementById('estEave').value)||0;
    if(ridge < 0 || eave < 0){showToast('Measurements cannot be negative','error');return;}
    updateEstCalc(); calcTierPrices(); showEstStep(3);
  } else if(from===3){
    if(!selectedTier){showToast('Select a tier/package','error');return;}
    if(!estData.prices||!estData.prices.good){showToast('Calculate pricing first','error');return;}
    buildReview(); showEstStep(4);
  }
}
function estBack(from){ showEstStep(from-1); }

function updateEstCalc() {
  const raw=Math.max(0, parseFloat(document.getElementById('estRawSqft')?.value)||0);
  const pitchVal=document.getElementById('estPitch')?.value||'1.202|8/12';
  const [pf,pl]=pitchVal.split('|');
  const wf=Math.max(1, parseFloat(document.getElementById('estWaste')?.value||1.17));
  const adj=raw*parseFloat(pf)*wf;
  const sq=adj/100;
  const el=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  el('ec-raw',raw+' sf'); el('ec-pitch',parseFloat(pf).toFixed(4)+'×'); el('ec-waste',wf.toFixed(3)+'×');
  el('ec-adj',Math.round(adj)+' sf'); el('ec-sq',sq.toFixed(2)+' sq');
  estData.raw=raw; estData.pf=parseFloat(pf); estData.pl=pl||'8/12'; estData.wf=wf; estData.adj=adj; estData.sq=sq;
}

function calcTierPrices() {
  // Re-sync rates from product library each time tiers are recalculated
  syncRatesFromProductLibrary(selectedTier || 'better');
  updateEstCalc();
  const sq=estData.sq||0;
  const ridge=Math.max(0, parseFloat(document.getElementById('estRidge').value)||0);
  const eave=Math.max(0, parseFloat(document.getElementById('estEave').value)||0);
  const hip=Math.max(0, parseFloat(document.getElementById('estHip').value)||0);
  const pipes=Math.max(0, parseInt(document.getElementById('estPipes').value)||0);
  const deckSq=sq*R.deckPct;

  const good = sq*R.shingle + sq*R.felt + sq*R.tear + eave*R.starter + eave*R.drip + ridge*R.ridge;
  const better = good + 5*R.iws + pipes*R.pipe + hip*R.hip + deckSq*R.deck;
  const best = better + sq*R.deck + eave*R.gutter;

  estData.ridge=ridge; estData.eave=eave; estData.hip=hip; estData.pipes=pipes;
  estData.deckSq=deckSq;
  estData.prices={good,better,best};

  document.getElementById('price-good').textContent='$'+good.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById('price-better').textContent='$'+better.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById('price-best').textContent='$'+best.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function selectTier(tier,el) {
  document.querySelectorAll('.tier-card').forEach(c=>c.classList.remove('selected'));
  el.classList.add('selected');
  selectedTier=tier;
  const btn=document.getElementById('estStep3Next');
  btn.disabled=false; btn.style.opacity='1';
}

function getProductName(mapKey, fallback) {
  if (!window._productLib || !PRODUCT_MAP[mapKey]) return fallback;
  const products = window._productLib.getProducts();
  const p = products.find(pr => pr.id === PRODUCT_MAP[mapKey].id);
  return p ? p.name : fallback;
}

function getLineItems() {
  // Ensure rates are synced for the selected tier
  syncRatesFromProductLibrary(selectedTier || 'better');
  const d=estData, sq=d.sq, tier=selectedTier;
  const fmt=(n)=>'$'+(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const rows=[];
  rows.push({code:'RFG SHNG',desc:getProductName('shingle','Roofing shingles – architectural 30yr'),qty:sq.toFixed(2)+'SQ',rate:'$'+R.shingle,total:sq*R.shingle});
  rows.push({code:'RFG FELT',desc:getProductName('felt','Underlayment / roofing felt'),qty:sq.toFixed(2)+'SQ',rate:'$'+R.felt,total:sq*R.felt});
  rows.push({code:'RFG TEAR',desc:'Remove existing roof covering',qty:sq.toFixed(2)+'SQ',rate:'$'+R.tear,total:sq*R.tear});
  rows.push({code:'RFG STRT',desc:getProductName('starter','Starter strip shingles'),qty:d.eave+'LF',rate:'$'+R.starter,total:d.eave*R.starter});
  rows.push({code:'RFG DRPE',desc:getProductName('drip','Drip edge – aluminum'),qty:d.eave+'LF',rate:'$'+R.drip,total:d.eave*R.drip});
  rows.push({code:'RFG RIDG',desc:getProductName('ridge','Ridge cap shingles'),qty:d.ridge+'LF',rate:'$'+R.ridge,total:d.ridge*R.ridge});
  if(tier==='better'||tier==='best'){
    rows.push({code:'RFG I&WS',desc:getProductName('iws','Ice & water shield'),qty:'5SQ',rate:'$'+R.iws,total:5*R.iws});
    rows.push({code:'RFG HIPC',desc:getProductName('hip','Hip cap shingles'),qty:d.hip+'LF',rate:'$'+R.hip,total:d.hip*R.hip});
    for(let i=1;i<=d.pipes;i++) rows.push({code:'RFG PIPE',desc:getProductName('pipe',`Pipe boot / plumbing flashing #${i}`),qty:'1EA',rate:'$'+R.pipe,total:R.pipe});
    rows.push({code:'RFG DECK',desc:`OSB decking – partial replacement (${Math.round(R.deckPct*100)}%)`,qty:d.deckSq.toFixed(2)+'SQ',rate:'$'+R.deck,total:d.deckSq*R.deck});
  }
  if(tier==='best'){
    rows.push({code:'RFG DECK',desc:'OSB decking – full replacement',qty:sq.toFixed(2)+'SQ',rate:'$'+R.deck,total:sq*R.deck});
    rows.push({code:'GUT ALUM',desc:'Seamless aluminum gutters (6")',qty:d.eave+'LF',rate:'$'+R.gutter,total:d.eave*R.gutter});
  }
  return rows;
}

function buildReview() {
  updateEstCalc();
  const d=estData;
  const addr=document.getElementById('estAddr').value||'—';
  const owner=document.getElementById('estOwner').value||'—';
  const parcel=document.getElementById('estParcel').value||'—';
  const yr=document.getElementById('estYear').value||'—';
  const roofType=document.getElementById('estRoofType').value||'—';
  const tierNames={'good':'Standard Reroof','better':'Reroof Plus','best':'Full Redeck'};
  const rows=getLineItems();
  const grandTotal=rows.reduce((s,r)=>s+r.total,0);
  estData.grandTotal=grandTotal;
  estData.addr=addr; estData.owner=owner; estData.parcel=parcel; estData.yr=yr; estData.roofType=roofType;
  estData.tierName=tierNames[selectedTier]; estData.rows=rows;

  const fmt=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  document.getElementById('estReviewBody').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;">
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--m);margin-bottom:4px;">Property</div>
        <div style="font-size:14px;font-weight:600;color:var(--blue);">${addr}</div>
        <div style="font-size:12px;color:var(--m);">${owner} · Parcel: ${parcel} · Built: ${yr}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--m);">Estimate Total</div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:700;color:var(--orange);">${fmt(grandTotal)}</div>
        <div style="font-size:11px;color:var(--m);">${tierNames[selectedTier]}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;font-size:11px;">
      <div style="background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:10px;"><div style="color:var(--m);margin-bottom:3px;">Roof Type</div><div style="font-weight:700;">${roofType}</div></div>
      <div style="background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:10px;"><div style="color:var(--m);margin-bottom:3px;">Pitch</div><div style="font-weight:700;">${d.pl}</div></div>
      <div style="background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:10px;"><div style="color:var(--m);margin-bottom:3px;">Squares</div><div style="font-weight:700;">${d.sq.toFixed(2)} SQ</div></div>
    </div>
    <table class="li-table">
      <thead><tr><th>Code</th><th>Description</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead>
      <tbody>
        ${rows.map(r=>`<tr><td class="code">${r.code}</td><td>${r.desc}</td><td>${r.qty}</td><td>${r.rate}</td><td><strong>${fmt(r.total)}</strong></td></tr>`).join('')}
        <tr class="total-row grand"><td colspan="4"><strong>ESTIMATE TOTAL</strong></td><td><strong>${fmt(grandTotal)}</strong></td></tr>
      </tbody>
    </table>`;
}

let _savingEstimate = false;
async function saveEstimate() {
  if(_savingEstimate) return;
  if(!estData.grandTotal){showToast('Build estimate first','error');return;}

  // Resolve leadId — from URL param flow, QM import, or address match against loaded leads
  let leadId = window._estLinkedLeadId || null;
  if (!leadId && estData.addr) {
    const addrNorm = (estData.addr||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const matched = (window._leads||[]).find(l => {
      const lNorm = (l.address||'').toLowerCase().replace(/[^a-z0-9]/g,'');
      return lNorm && addrNorm && lNorm.includes(addrNorm.substring(0,12));
    });
    if (matched) leadId = matched.id;
  }

  _savingEstimate = true;
  const isUpdate = !!window._editingEstimateId;
  const saveBtn = document.querySelector('#estStep4 .btn-primary, #estStep4 button[onclick*="saveEstimate"]');
  const origText = saveBtn ? saveBtn.textContent : '';
  if(saveBtn){ saveBtn.disabled = true; saveBtn.textContent = 'Saving...'; }

  try {
    await window._saveEstimate({
      addr:estData.addr, owner:estData.owner, parcel:estData.parcel, yr:estData.yr,
      roofType:estData.roofType, pitch:estData.pl, wf:estData.wf, sq:estData.sq, tier:selectedTier,
      tierName:estData.tierName, grandTotal:estData.grandTotal,
      raw:estData.raw, adj:Math.round(estData.adj),
      ridge:estData.ridge ?? null, eave:estData.eave ?? null, hip:estData.hip ?? null,
      pipes:estData.pipes ?? null, rows:estData.rows||[],
      leadId: leadId,
      qmData: estData._qm || null
    });

    // If we know the lead, offer to go back to customer page
    if (leadId) {
      showToast(isUpdate ? '✓ Estimate updated & linked to customer' : '✓ Estimate saved & linked to customer record', 'success');
      setTimeout(() => {
        if (confirm((isUpdate ? 'Estimate updated!' : 'Estimate saved!') + ' Go to customer record?')) {
          window.location.href = `/pro/customer.html?id=${leadId}`;
        }
      }, 400);
    } else {
      showToast(isUpdate ? 'Estimate updated!' : 'Estimate saved!', 'success');
    }
    window._estLinkedLeadId = null;
    cancelEstimate();
  } catch(e) {
    console.error('saveEstimate error:', e);
    showToast('Failed to save estimate — check connection and try again', 'error');
  } finally {
    _savingEstimate = false;
    if(saveBtn){ saveBtn.disabled = false; saveBtn.textContent = origText; }
  }
}


function exportEstimate() {
  if(!estData.grandTotal){showToast('Build estimate first','error');return;}
  const d=estData;
  const fmt=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const rows=d.rows||getLineItems();
  const tierNames={'good':'Standard Reroof','better':'Reroof Plus','best':'Full Redeck'};
  const dateStr=new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NBD Roofing Estimate — ${d.addr}</title>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
  <style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Barlow',sans-serif;padding:36px;max-width:860px;margin:0 auto;}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:3px solid #C8541A;margin-bottom:26px;}
  .brand{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;}
  .brand span{color:#C8541A;}.sub{font-size:13px;color:#666;margin-top:2px;}.badge{font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#C8541A;border:1px solid #C8541A;padding:2px 9px;border-radius:2px;display:inline-block;margin-top:5px;}
  .est-hdr{text-align:right;}.est-type{font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#111;}
  .est-date{font-size:12px;color:#666;}.est-by{font-size:12px;color:#666;}
  .est-total-lbl{font-size:9px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#C8541A;margin-top:10px;}
  .est-total-val{font-family:'Barlow Condensed',sans-serif;font-size:38px;font-weight:800;color:#C8541A;}
  h2{font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:#111;margin:22px 0 12px;padding-bottom:4px;border-bottom:2px solid #C8541A;}
  .prop-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:4px;}
  .prop-field label{font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#999;}
  .prop-field .v{font-size:15px;font-weight:700;color:#111;}
  .meas-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:6px;}
  .mf label{font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#999;}
  .mf .v{font-size:18px;font-weight:700;color:#111;}
  table{width:100%;border-collapse:collapse;}
  thead tr{border-bottom:2px solid #111;}
  th{font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;padding:8px 10px;text-align:left;color:#111;}
  td{padding:8px 10px;border-bottom:1px solid #f0f0f0;font-size:13px;}
  .code{color:#C8541A;font-weight:700;font-family:'Barlow Condensed',sans-serif;font-size:13px;}
  .total-cell{font-weight:700;color:#111;}
  .grand-row td{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;color:#C8541A;border-top:3px solid #111;background:#fff8f5;padding:12px 10px;}
  .footer{margin-top:32px;padding-top:14px;border-top:1px solid #eee;display:flex;justify-content:space-between;font-size:10px;color:#999;}
  @media print{body{padding:20px;}@page{margin:1.5cm;size:letter;}}
  </style></head><body>
  <div class="hdr">
    <div><div class="brand">No Big <span>Deal</span></div><div class="sub">Home Solutions</div><div class="badge">Insurance Restoration</div></div>
    <div class="est-hdr"><div class="est-type">${tierNames[selectedTier]||'Estimate'}</div><div class="est-date">${dateStr}</div>
      <div class="est-total-lbl">Estimate Total</div><div class="est-total-val">${fmt(d.grandTotal)}</div></div>
  </div>
  <h2>Property Information</h2>
  <div class="prop-grid">
    <div class="prop-field"><label>Address</label><div class="v">${d.addr||'—'}</div></div>
    <div class="prop-field"><label>Owner</label><div class="v">${d.owner||'—'}</div></div>
    <div class="prop-field"><label>Parcel</label><div class="v">${d.parcel||'—'}</div></div>
    <div class="prop-field"><label>Year Built</label><div class="v">${d.yr||'—'}</div></div>
  </div>
  <h2>Measurements</h2>
  <div class="meas-grid">
    <div class="mf"><label>Pitch</label><div class="v">${d.pl||'—'}</div></div>
    <div class="mf"><label>Squares</label><div class="v">${d.sq?d.sq.toFixed(2):'—'} SQ</div></div>
    <div class="mf"><label>Roof Type</label><div class="v">${d.roofType||'—'}</div></div>
  </div>
  <h2>Line Items</h2>
  <table>
    <thead><tr><th>Code</th><th>Description</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead>
    <tbody>
      ${rows.map(r=>'<tr><td class="code">'+r.code+'</td><td>'+r.desc+'</td><td>'+r.qty+'</td><td>'+r.rate+'</td><td class="total-cell">'+fmt(r.total)+'</td></tr>').join('')}
      <tr class="grand-row"><td colspan="4"><strong>ESTIMATE TOTAL</strong></td><td><strong>${fmt(d.grandTotal)}</strong></td></tr>
    </tbody>
  </table>
  <div class="footer"><span>No Big Deal Home Solutions — Greater Cincinnati</span><span>Generated by NBD Pro</span></div>
  </body></html>`;
  const w = window.open('','_blank');
  if(w){ w.document.write(html); w.document.close(); }
  else { showToast('Pop-up blocked — allow pop-ups for this site','error'); }
}

function showEstimateTypeSelector() {
  // Default to original estimate builder
  startNewEstimateOriginal();
}

// ══ Window Scope Exposures ══════════════════════════════════
window.startNewEstimate = startNewEstimate;
window.startNewEstimateOriginal = startNewEstimateOriginal;
window.cancelEstimate = cancelEstimate;
window.showEstStep = showEstStep;
window.estNext = estNext;
window.estBack = estBack;
window.updateEstCalc = updateEstCalc;
window.calcTierPrices = calcTierPrices;
window.exportEstimate = exportEstimate;
window.selectTier = selectTier;
window.saveEstimate = saveEstimate;
window.buildReview = buildReview;
window.getLineItems = getLineItems;
window.syncRatesFromProductLibrary = syncRatesFromProductLibrary;
window.getProductName = getProductName;
window.showEstimateTypeSelector = showEstimateTypeSelector;
