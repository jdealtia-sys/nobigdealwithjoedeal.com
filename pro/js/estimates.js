// ============================================================
// NBD Pro — estimates.js
// Inline estimate builder (original), calculations, tier pricing
// Extracted from dashboard.html for maintainability
// ============================================================

function startNewEstimate() {
  showEstimateTypeSelector();
}

function startNewEstimateOriginal() {
  document.getElementById('est-list').style.display='none';
  document.getElementById('est-builder').style.display='flex';
  document.getElementById('est-builder').style.flexDirection='column';
  estCurrentStep=0; selectedTier=null; estData={};
  window._estLinkedLeadId = null;
  showEstStep(1);
  document.getElementById('drawImportNote').style.display='none';
  ['estAddr','estOwner','estParcel','estYear','estRawSqft','estRidge','estEave','estHip'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('estPipes').value='4';
  updateEstCalc();
}

function cancelEstimate() {
  document.getElementById('est-list').style.display='block';
  document.getElementById('est-builder').style.display='none';
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
    if(!document.getElementById('estRawSqft').value){showToast('Enter raw square footage','error');return;}
    updateEstCalc(); showEstStep(2);
  } else if(from===2){
    updateEstCalc(); calcTierPrices(); showEstStep(3);
  } else if(from===3){
    if(!selectedTier){showToast('Select a package','error');return;}
    buildReview(); showEstStep(4);
  }
}
function estBack(from){ showEstStep(from-1); }

function updateEstCalc() {
  const raw=parseFloat(document.getElementById('estRawSqft')?.value)||0;
  const pitchVal=document.getElementById('estPitch')?.value||'1.202|8/12';
  const [pf,pl]=pitchVal.split('|');
  const wf=parseFloat(document.getElementById('estWaste')?.value||1.17);
  const adj=raw*parseFloat(pf)*wf;
  const sq=adj/100;
  const el=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  el('ec-raw',raw+' sf'); el('ec-pitch',parseFloat(pf).toFixed(4)+'×'); el('ec-waste',wf.toFixed(3)+'×');
  el('ec-adj',Math.round(adj)+' sf'); el('ec-sq',sq.toFixed(2)+' sq');
  estData.raw=raw; estData.pf=parseFloat(pf); estData.pl=pl||'8/12'; estData.wf=wf; estData.adj=adj; estData.sq=sq;
}

function calcTierPrices() {
  updateEstCalc();
  const sq=estData.sq||0;
  const ridge=parseFloat(document.getElementById('estRidge').value)||0;
  const eave=parseFloat(document.getElementById('estEave').value)||0;
  const hip=parseFloat(document.getElementById('estHip').value)||0;
  const pipes=parseInt(document.getElementById('estPipes').value)||0;
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

function getLineItems() {
  const d=estData, sq=d.sq, tier=selectedTier;
  const fmt=(n)=>'$'+(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const rows=[];
  rows.push({code:'RFG SHNG',desc:'Roofing shingles – architectural 30yr',qty:sq.toFixed(2)+'SQ',rate:'$'+R.shingle,total:sq*R.shingle});
  rows.push({code:'RFG FELT',desc:'Underlayment / roofing felt',qty:sq.toFixed(2)+'SQ',rate:'$'+R.felt,total:sq*R.felt});
  rows.push({code:'RFG TEAR',desc:'Remove existing roof covering',qty:sq.toFixed(2)+'SQ',rate:'$'+R.tear,total:sq*R.tear});
  rows.push({code:'RFG STRT',desc:'Starter strip shingles',qty:d.eave+'LF',rate:'$'+R.starter,total:d.eave*R.starter});
  rows.push({code:'RFG DRPE',desc:'Drip edge – aluminum',qty:d.eave+'LF',rate:'$'+R.drip,total:d.eave*R.drip});
  rows.push({code:'RFG RIDG',desc:'Ridge cap shingles',qty:d.ridge+'LF',rate:'$'+R.ridge,total:d.ridge*R.ridge});
  if(tier==='better'||tier==='best'){
    rows.push({code:'RFG I&WS',desc:'Ice & water shield',qty:'5SQ',rate:'$'+R.iws,total:5*R.iws});
    rows.push({code:'RFG HIPC',desc:'Hip cap shingles',qty:d.hip+'LF',rate:'$'+R.hip,total:d.hip*R.hip});
    for(let i=1;i<=d.pipes;i++) rows.push({code:'RFG PIPE',desc:`Pipe boot / plumbing flashing #${i}`,qty:'1EA',rate:'$'+R.pipe,total:R.pipe});
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

async function saveEstimate() {
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

  await window._saveEstimate({
    addr:estData.addr, owner:estData.owner, parcel:estData.parcel, yr:estData.yr,
    roofType:estData.roofType, pitch:estData.pl, sq:estData.sq, tier:selectedTier,
    tierName:estData.tierName, grandTotal:estData.grandTotal,
    raw:estData.raw, adj:Math.round(estData.adj),
    ridge:estData.ridge||null, eave:estData.eave||null, hip:estData.hip||null,
    pipes:estData.pipes||null, rows:estData.rows||[],
    leadId: leadId,
    qmData: estData._qm || null
  });

  // If we know the lead, offer to go back to customer page
  if (leadId) {
    showToast('✓ Estimate saved & linked to customer record', 'success');
    // Small delay then offer navigation
    setTimeout(() => {
      if (confirm('Estimate saved! Go to customer record?')) {
        window.location.href = `/pro/customer.html?id=${leadId}`;
      }
    }, 400);
  } else {
    showToast('Estimate saved!', 'success');
  }
  window._estLinkedLeadId = null;
  cancelEstimate();
}

function exportEstimate() {
  if(!estData.grandTotal){showToast('Build estimate first','error');return;}
  const d=estData;
  const fmt=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
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
  @media print {
    /* Hide everything except the doc viewer content */
    body > * { display: none !important; }
    #docViewerModal { display: block !important; position: static !important;
      background: white !important; padding: 0 !important; margin: 0 !important; }
    #docViewerModal .modal-bg,
    #docViewerModal .modal { display: block !important; position: static !important;
      background: white !important; border: none !important; box-shadow: none !important;
      max-height: none !important; max-width: 100% !important; padding: 0 !important; overflow: visible !important; }
    .modal-close, .print-btn-row { display: none !important; }
    .doc-viewer-content { background: white !important; border: none !important;
      color: #111 !important; padding: 0 !important; margin: 0 !important; }
    @page { margin: 1.8cm 2cm; size: letter; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
/* ── CRM ENHANCEMENTS ── */
.follow-up-alert{background:rgba(249,115,22,.1);border:1px solid rgba(249,115,22,.3);border-radius:8px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;font-size:12px;}
.follow-up-alert .fa-name{font-weight:700;color:var(--t);}
.follow-up-alert .fa-date{color:var(--orange);font-size:11px;}
.follow-up-alert .fa-btn{margin-left:auto;background:var(--orange);color:#fff;border:none;border-radius:4px;padding:4px 10px;font-size:10px;cursor:pointer;font-family:inherit;font-weight:700;}

.leads-table{width:100%;border-collapse:collapse;font-size:12px;}
.leads-table th{text-align:left;padding:8px 10px;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--m);border-bottom:1px solid var(--br);font-weight:600;}
.leads-table td{padding:10px 10px;border-bottom:1px solid var(--br);vertical-align:middle;}
.leads-table tr:hover td{background:var(--s2);}
.leads-table tr:last-child td{border-bottom:none;}
.lead-name{font-weight:600;color:var(--t);}
.lead-addr{font-size:10px;color:var(--m);margin-top:2px;}
.lead-val{font-weight:700;color:var(--green);}
.lead-actions{display:flex;gap:6px;}
.lead-actions button{background:transparent;border:1px solid var(--br);border-radius:4px;padding:4px 8px;font-size:10px;cursor:pointer;color:var(--m);font-family:inherit;transition:all .15s;}
.lead-actions button:hover{background:var(--s2);color:var(--t);}
.lead-actions .btn-edit:hover{border-color:var(--orange);color:var(--orange);}
.lead-actions .btn-del:hover{border-color:var(--red);color:var(--red);}

.tag-new{background:rgba(156,163,175,.15);color:#9CA3AF;}
.tag-insp{background:rgba(74,158,255,.15);color:#4A9EFF;}
.tag-es{background:rgba(212,160,23,.15);color:#D4A017;}
.tag-appr{background:rgba(155,109,255,.15);color:#9B6DFF;}
.tag-prog{background:rgba(34,197,94,.15);color:#22C55E;}
.tag-won{background:rgba(34,197,94,.15);color:#22C55E;}
.tag-lost{background:rgba(224,82,82,.15);color:#E05252;}

/* ── DOCUMENT LIBRARY ── */
.doc-card{background:var(--s2);border:1px solid var(--br);border-radius:8px;padding:16px;cursor:pointer;transition:all .15s;}
.doc-card:hover{border-color:var(--orange);background:var(--s3);}
.doc-icon{font-size:28px;margin-bottom:8px;}
.doc-name{font-weight:700;font-size:13px;color:var(--t);margin-bottom:4px;}
.doc-desc{font-size:11px;color:var(--m);line-height:1.5;margin-bottom:8px;}
.doc-action{font-size:10px;color:var(--orange);font-weight:700;letter-spacing:.05em;}

/* ── DOCUMENT VIEWER MODAL ── */
#docViewerModal .modal{max-width:760px;max-height:92vh;overflow-y:auto;}
/* Doc viewer content — screen styles */
.doc-viewer-content {
  background: #fff;
  color: #111;
  border-radius: 8px;
  padding: 40px 44px;
  margin-top: 16px;
  font-family: 'Barlow', 'Georgia', serif;
  font-size: 13px;
  line-height: 1.75;
  border: 1px solid var(--br);
}
/* Doc header strip */
.doc-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding-bottom: 14px;
  margin-bottom: 20px;
  border-bottom: 3px solid #C8541A;
}
.doc-brand-name {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 22px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: .02em;
  color: #0A0C0F;
  line-height: 1;
}
.doc-brand-name span { color: #C8541A; }
.doc-brand-tag {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .18em;
  text-transform: uppercase;
  color: #C8541A;
  border: 1px solid #C8541A;
  padding: 2px 8px;
  border-radius: 2px;
  display: inline-block;
  margin-top: 5px;
}
.doc-contact-block {
  text-align: right;
  font-size: 11px;
  color: #555;
  line-height: 1.6;
}
.doc-contact-block strong { color: #111; font-size: 12px; }
/* Doc title */
.doc-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 26px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .04em;
  color: #0A0C0F;
  margin-bottom: 4px;
}
.doc-subtitle {
  font-size: 11px;
  color: #888;
  letter-spacing: .06em;
  text-transform: uppercase;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid #e5e5e5;
}
/* Section headings */
.doc-section-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: #C8541A;
  margin: 18px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #fde0d0;
}
/* Field rows */
.doc-field-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 10px;
}
.doc-field-label {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: #555;
  flex-shrink: 0;
  min-width: 120px;
}
.doc-field-line {
  flex: 1;
  border: none;
  border-bottom: 1.5px solid #bbb;
  height: 22px;
  background: transparent;
  min-width: 80px;
}
.doc-field-line.short { max-width: 140px; }
.doc-field-line.med   { max-width: 220px; }
/* Two-col field layout */
.doc-row-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 20px;
  margin-bottom: 10px;
}
/* Checklist items */
.doc-check-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px 20px;
  margin-bottom: 8px;
}
.doc-check-item {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #333;
}
.doc-checkbox {
  width: 14px;
  height: 14px;
  border: 1.5px solid #999;
  border-radius: 2px;
  flex-shrink: 0;
  display: inline-block;
}
/* Supplement table */
.doc-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 14px;
  font-size: 12px;
}
.doc-table th {
  background: #0A0C0F;
  color: #fff;
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 10px;
  letter-spacing: .1em;
  text-transform: uppercase;
  padding: 7px 10px;
  text-align: left;
}
.doc-table td {
  padding: 8px 10px;
  border-bottom: 1px solid #eee;
  vertical-align: middle;
}
.doc-table tr:nth-child(even) td { background: #fafafa; }
.doc-table .doc-field-line { border-bottom: 1px solid #ccc; min-width: 60px; }
.doc-table-total td {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 15px;
  font-weight: 700;
  color: #C8541A;
  border-top: 2px solid #111;
  padding: 10px;
}
/* Info box */
.doc-info-box {
  background: #fff8f5;
  border: 1px solid #fde0d0;
  border-left: 3px solid #C8541A;
  border-radius: 4px;
  padding: 10px 14px;
  font-size: 12px;
  color: #333;
  margin-bottom: 14px;
  line-height: 1.6;
}
/* Signature block */
.doc-sig-block {
  margin-top: 24px;
  padding-top: 16px;
  border-top: 1px solid #e5e5e5;
}
.doc-sig-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 14px;
}
.doc-sig-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.doc-sig-field .doc-field-line { border-bottom: 1.5px solid #333; height: 28px; }
.doc-sig-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .08em;
  color: #888;
}
/* Footer strip */
.doc-footer-strip {
  margin-top: 20px;
  padding-top: 12px;
  border-top: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: #aaa;
}
/* Completion certificate special */
.doc-cert-badge {
  text-align: center;
  padding: 16px;
  background: #f9f9f9;
  border: 2px solid #C8541A;
  border-radius: 8px;
  margin: 16px 0;
}
.doc-cert-badge .cert-title {
  font-family: 'Barlow Condensed', sans-serif;
  font-size: 18px;
  font-weight: 800;
  text-transform: uppercase;
  color: #C8541A;
  letter-spacing: .08em;
}
.doc-cert-badge .cert-sub {
  font-size: 12px;
  color: #555;
  margin-top: 4px;
}
/* Print-only — buttons hidden */
.print-btn-row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}


/* ════════════════════════════════
   KANBAN CRM
   ════════════════════════════════ */

/* Header bar */
.crm-header{
  display:flex;justify-content:space-between;align-items:center;
  padding:18px 24px 12px;flex-shrink:0;
  border-bottom:1px solid var(--br);
  background:var(--bg);
  position:sticky;
  top:0;
  z-index:100;
}
.page-title{
  font-size:24px;
  font-weight:700;
  color:var(--t);
  font-family:'Barlow Condensed',sans-serif;
  letter-spacing:.02em;
  text-transform:uppercase;
}
.page-sub{
  font-size:12px;
  color:var(--m);
  margin-top:2px;
  font-weight:500;
}

/* Secondary toolbar */
.crm-secondary-header{
  display:flex;gap:4px;padding:0 20px;flex-shrink:0;
  border-bottom:2px solid var(--br);align-items:flex-end;
  transition:all .25s ease;flex-wrap:nowrap;overflow-x:auto;
  background:var(--bg);
}
.crm-secondary-header.hidden{
  max-height:0;padding-top:0;padding-bottom:0;opacity:0;overflow:hidden;
  border-bottom:none;
}
.crm-sec-btn{
  display:flex;flex-direction:column;align-items:center;gap:4px;
  background:transparent;border:none;border-bottom:3px solid transparent;
  padding:12px 16px 10px;font-size:11px;color:var(--m);cursor:pointer;
  font-family:'Barlow Condensed',sans-serif;letter-spacing:.05em;
  transition:all .2s cubic-bezier(0.4, 0, 0.2, 1);white-space:nowrap;flex-shrink:0;
  font-weight:600;position:relative;
}
.crm-sec-btn:hover{
  color:var(--t);
  background:rgba(200,84,26,.05);
  border-bottom-color:rgba(200,84,26,.3);
}
.crm-sec-btn.active{
  color:var(--orange);
  border-bottom-color:var(--orange);
  background:rgba(200,84,26,.08);
}
.crm-sec-btn.active .crm-sec-icon{
  transform:scale(1.15);
}
.crm-sec-icon{
  font-size:17px;
  line-height:1;
  opacity:.85;
  transition:transform .2s;
}
.crm-sec-btn.active .crm-sec-icon{opacity:1;}
.crm-sec-label{font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:.08em;}

/* Restore button (shows when secondary header is hidden) */
.crm-sec-restore{
  display:none;padding:4px 16px;text-align:center;
  font-size:10px;color:var(--orange);cursor:pointer;
  font-family:'Barlow Condensed',sans-serif;letter-spacing:.08em;
  border-bottom:1px solid var(--br);flex-shrink:0;
  transition:all .15s ease;
}
.crm-sec-restore:hover{background:var(--s2);color:var(--orange);}
.crm-sec-restore span{font-size:12px;margin-right:4px;}


/* Revenue strip */
.crm-rev-strip{
  display:flex;gap:0;padding:4px 20px 10px;flex-shrink:0;align-items:center;border-bottom:1px solid var(--br);margin-bottom:4px;
}
.rev-pill{
  display:flex;flex-direction:column;align-items:center;
  padding:6px 16px;border-right:1px solid var(--br);
}
.rev-pill:first-child{padding-left:0;}
.rev-pill:last-child{border-right:none;}
.rev-num{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;color:var(--t);line-height:1;}
.rev-lbl{font-size:9px;color:var(--m);text-transform:uppercase;letter-spacing:.08em;margin-top:2px;}

/* Board container — horizontal scroll, full remaining height */
.kanban-board{
  display:flex !important;gap:10px;
  padding:0 16px 16px;
  overflow-x:auto !important;overflow-y:hidden !important;
  flex:1;min-height:0;
  scrollbar-width:thin;
  scrollbar-color:var(--br) transparent;
}
.kanban-board::-webkit-scrollbar{height:6px;}
.kanban-board::-webkit-scrollbar-track{background:transparent;}
.kanban-board::-webkit-scrollbar-thumb{background:var(--br);border-radius:3px;}

/* Column */
.kanban-col{
  display:flex;flex-direction:column;
  min-width:220px;max-width:220px;
  background:var(--s2);
  border:1px solid var(--br);
  border-radius:10px;
  overflow:hidden;
  flex-shrink:0;
}

/* Column header */
.kcol-header{
  display:flex;justify-content:space-between;align-items:center;
  padding:10px 12px;
  font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
  flex-shrink:0;
}
.kcol-label{color:inherit;}
.kcol-count{
  background:rgba(255,255,255,.12);
  border-radius:20px;padding:2px 8px;
  font-size:11px;font-weight:700;
}
.kh-new  {background:#1e2a3a;color:#9CA3AF;border-bottom:2px solid #374151;}
.kh-insp {background:#1a2e4a;color:#4A9EFF;border-bottom:2px solid #2d5a8e;}
.kh-est  {background:#2a2414;color:#D4A017;border-bottom:2px solid #6b5010;}
.kh-appr {background:#221a3a;color:#9B6DFF;border-bottom:2px solid #5a3da0;}
.kh-prog {background:#142a22;color:#22C55E;border-bottom:2px solid #166534;}
.kh-done {background:#0f2a1a;color:#4ade80;border-bottom:2px solid #16a34a;}
.kh-lost {background:#2a1414;color:#E05252;border-bottom:2px solid #7f1d1d;}

/* Column body — scrollable */
.kcol-body{
  flex:1;overflow-y:auto;overflow-x:hidden;
  padding:8px;display:flex;flex-direction:column;gap:6px;
  min-height:120px;max-height:calc(100vh - 280px);
  scrollbar-width:thin;
  scrollbar-color:var(--br) transparent;
}
.kcol-body::-webkit-scrollbar{width:4px;}
.kcol-body::-webkit-scrollbar-thumb{background:var(--br);border-radius:2px;}
.kcol-body.drag-over{background:rgba(232,114,12,.06);outline:2px dashed var(--orange);}

/* Empty state */
.k-empty{
  text-align:center;padding:20px 8px;
  font-size:11px;color:var(--m);
  border:1px dashed var(--br);border-radius:6px;
}

/* Lead Card */
.k-card{
  background:var(--paper);
  border:1px solid var(--rule);
  border-radius:8px;
  padding:10px 12px;
  cursor:grab;
  transition:box-shadow .15s,transform .1s,opacity .15s;
  position:relative;
  color:var(--ink);
}
.k-card:hover{box-shadow:0 6px 20px rgba(0,0,0,.13);transform:translateY(-2px);}
.k-card.dragging{opacity:.45;cursor:grabbing;}
.k-card.drag-placeholder{
  border:2px dashed var(--orange);
  background:rgba(232,114,12,.06);
  height:60px;border-radius:8px;
}

/* Optimistic update states */

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
