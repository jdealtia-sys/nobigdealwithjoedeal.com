// ══════════════════════════════════════════════════════════════
// NBD Pro — warranty-cert.js
// Warranty Certificate PDF Generator
// ══════════════════════════════════════════════════════════════

// ══ WARRANTY CERTIFICATE GENERATOR ═══════════════════════════════════════
// Use var to avoid redeclaration collision with dashboard.html inline script
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

// Window scope exposures
window.generateWarrantyCertPDF = generateWarrantyCertPDF;
window.openWarrantyCert = typeof openWarrantyCert === 'function' ? openWarrantyCert : null;
