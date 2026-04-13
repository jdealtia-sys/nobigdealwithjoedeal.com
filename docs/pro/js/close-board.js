/**
 * NBD Pro — Close Board v1
 * Customer-facing shareable deal rooms
 * Generate unique estimate links → homeowner views tiers, signs, schedules
 * Stores deal room data in Firestore, generates standalone HTML for sharing
 */

(function() {
  'use strict';

  // ============================================================================
  // CONSTANTS
  // ============================================================================

  const DEAL_COLLECTION = 'deal_rooms';
  const DEAL_STORAGE_KEY = 'nbd_deal_rooms';
  const FINANCING_RATES = [
    { term: 12, rate: 0, label: '12 mo Same-as-Cash' },
    { term: 36, rate: 5.99, label: '36 mo @ 5.99%' },
    { term: 60, rate: 7.99, label: '60 mo @ 7.99%' },
    { term: 120, rate: 9.99, label: '120 mo @ 9.99%' },
    { term: 180, rate: 11.99, label: '180 mo @ 11.99%' }
  ];

  const DEAL_STATUS = {
    DRAFT: 'draft',
    SENT: 'sent',
    VIEWED: 'viewed',
    ACCEPTED: 'accepted',
    SIGNED: 'signed',
    SCHEDULED: 'scheduled',
    EXPIRED: 'expired'
  };

  const STATUS_COLORS = {
    draft: 'var(--m)',
    sent: 'var(--blue)',
    viewed: '#ffab00',
    accepted: 'var(--green)',
    signed: '#2ECC8A',
    scheduled: 'var(--orange)',
    expired: 'var(--red)'
  };

  // ============================================================================
  // STATE
  // ============================================================================

  let dealRooms = [];
  let activeDeal = null;
  let currentTab = 'active'; // 'active' | 'create' | 'analytics'

  // ============================================================================
  // HELPERS
  // ============================================================================

  function esc(s) { const d = document.createElement('div'); d.textContent = s || ''; return d.innerHTML; }
  function fmtCurrency(n) { return '$' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  function timeAgo(d) {
    if (!d) return '';
    const diff = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    return Math.floor(hrs / 24) + 'd ago';
  }
  function generateId() { return 'dr_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6); }

  function calcMonthlyPayment(principal, annualRate, termMonths) {
    if (annualRate === 0) return principal / termMonths;
    const r = annualRate / 100 / 12;
    return principal * r * Math.pow(1 + r, termMonths) / (Math.pow(1 + r, termMonths) - 1);
  }

  // ============================================================================
  // STORAGE
  // ============================================================================

  function loadDealRooms() {
    try {
      const raw = localStorage.getItem(DEAL_STORAGE_KEY);
      dealRooms = raw ? JSON.parse(raw) : [];
    } catch (e) { dealRooms = []; }
  }

  function saveDealRooms() {
    try { localStorage.setItem(DEAL_STORAGE_KEY, JSON.stringify(dealRooms)); }
    catch (e) { console.error('Deal rooms save error:', e); }
  }

  // Also save to Firestore if available
  async function syncDealToFirestore(deal) {
    if (!window._db || !window._user) return;
    try {
      const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      await setDoc(doc(window._db, DEAL_COLLECTION, deal.id), {
        ...deal,
        userId: window._user.uid,
        companyId: window._user.companyId || null,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (e) { console.error('Deal Firestore sync error:', e); }
  }

  // ============================================================================
  // DEAL ROOM CRUD
  // ============================================================================

  function createDealRoom(opts) {
    const deal = {
      id: generateId(),
      status: DEAL_STATUS.DRAFT,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 14 days

      // Customer info
      customerName: opts.customerName || '',
      customerEmail: opts.customerEmail || '',
      customerPhone: opts.customerPhone || '',
      address: opts.address || '',

      // Lead reference
      leadId: opts.leadId || null,
      estimateId: opts.estimateId || null,

      // Pricing tiers
      tiers: opts.tiers || {
        good: { label: 'Good', price: 0, lineItems: [], description: 'Standard reroof with quality materials' },
        better: { label: 'Better', price: 0, lineItems: [], description: 'Enhanced reroof with premium underlayment and ice shield' },
        best: { label: 'Best', price: 0, lineItems: [], description: 'Complete roof system with full deck replacement and gutters' }
      },

      // Product details
      selectedProducts: opts.selectedProducts || [],
      shingleColor: opts.shingleColor || '',
      warranty: opts.warranty || '25-year limited lifetime',

      // Insurance
      insuranceClaim: opts.insuranceClaim || false,
      insuranceCarrier: opts.insuranceCarrier || '',
      claimNumber: opts.claimNumber || '',
      deductible: opts.deductible || 0,

      // Signature
      signedAt: null,
      signatureData: null,
      selectedTier: null,
      selectedFinancing: null,
      scheduledDate: null,

      // Tracking
      viewCount: 0,
      lastViewedAt: null,
      sentAt: null,
      sentVia: null, // 'sms' | 'email' | 'link'

      // Rep info
      repName: opts.repName || window._user?.displayName || 'Your NBD Rep',
      repPhone: opts.repPhone || '',
      repEmail: opts.repEmail || window._user?.email || '',
      repPhoto: opts.repPhoto || '',

      // Notes
      notes: opts.notes || ''
    };

    dealRooms.unshift(deal);
    saveDealRooms();
    syncDealToFirestore(deal);
    return deal;
  }

  function updateDeal(dealId, updates) {
    const deal = dealRooms.find(d => d.id === dealId);
    if (deal) {
      Object.assign(deal, updates, { updatedAt: new Date().toISOString() });
      saveDealRooms();
      syncDealToFirestore(deal);
    }
    return deal;
  }

  function deleteDeal(dealId) {
    dealRooms = dealRooms.filter(d => d.id !== dealId);
    saveDealRooms();
  }

  // ============================================================================
  // DEAL ROOM FROM ESTIMATE
  // ============================================================================

  function createFromEstimate(estimateData, leadData) {
    // Pull pricing from current estimate
    const tiers = {
      good: {
        label: 'Good',
        price: estimateData?.prices?.good || 0,
        description: 'Standard reroof — quality architectural shingles, synthetic underlayment, proper ventilation',
        lineItems: []
      },
      better: {
        label: 'Better',
        price: estimateData?.prices?.better || 0,
        description: 'Enhanced — adds ice & water shield, hip caps, pipe boots, partial deck repair',
        lineItems: []
      },
      best: {
        label: 'Best',
        price: estimateData?.prices?.best || 0,
        description: 'Complete system — full deck replacement, seamless gutters, maximum protection',
        lineItems: []
      }
    };

    // Pull line items if available
    if (typeof window.getLineItems === 'function') {
      const items = window.getLineItems();
      tiers.good.lineItems = items.filter(i => !i.code?.includes('I&WS') && !i.code?.includes('HIPC') && !i.code?.includes('PIPE') && !i.code?.includes('DECK') && !i.code?.includes('GUT'));
      tiers.better.lineItems = items.filter(i => !i.code?.includes('GUT'));
      tiers.best.lineItems = items;
    }

    // Get product names from library
    let selectedProducts = [];
    if (window._productLib) {
      const products = window._productLib.getProducts();
      const shingle = products.find(p => p.id === 'shingle_001');
      if (shingle) selectedProducts.push({ name: shingle.name, manufacturer: shingle.manufacturer });
    }

    const deal = createDealRoom({
      customerName: leadData?.name || '',
      customerEmail: leadData?.email || '',
      customerPhone: leadData?.phone || '',
      address: leadData?.address || '',
      leadId: leadData?.id || null,
      tiers,
      selectedProducts,
      insuranceClaim: !!leadData?.insuranceCarrier,
      insuranceCarrier: leadData?.insuranceCarrier || '',
      claimNumber: leadData?.claimNumber || '',
      deductible: leadData?.deductible || 0
    });

    return deal;
  }

  // ============================================================================
  // SHAREABLE DEAL PAGE GENERATOR
  // ============================================================================

  function generateDealPageHTML(deal) {
    const goodPay = calcMonthlyPayment(deal.tiers.good.price, 7.99, 60);
    const betterPay = calcMonthlyPayment(deal.tiers.better.price, 7.99, 60);
    const bestPay = calcMonthlyPayment(deal.tiers.best.price, 7.99, 60);

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Roof Estimate — No Big Deal Home Solutions</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Barlow',sans-serif;background:#0d0f14;color:#e5e7eb;min-height:100vh;}
.hero{background:linear-gradient(135deg,#1a1d23 0%,#0d0f14 100%);padding:40px 20px 30px;text-align:center;border-bottom:2px solid #e8720c;}
.logo{font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;letter-spacing:.04em;}
.logo span{color:#e8720c;}
.addr{font-size:14px;color:#8b8e96;margin-top:8px;}
.customer{font-size:18px;font-weight:600;margin-top:12px;}
.rep-bar{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:16px;padding:12px 20px;background:#1e2028;border-radius:10px;max-width:400px;margin-left:auto;margin-right:auto;}
.rep-name{font-size:13px;font-weight:600;}
.rep-contact{font-size:11px;color:#8b8e96;}
.container{max-width:600px;margin:0 auto;padding:20px;}
.section-title{font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#e8720c;margin:24px 0 12px;}
.tier-cards{display:flex;flex-direction:column;gap:12px;}
.tier{background:#1e2028;border:2px solid #2a2d35;border-radius:14px;padding:20px;cursor:pointer;transition:all .2s;position:relative;overflow:hidden;}
.tier:hover{border-color:#e8720c40;}
.tier.selected{border-color:#e8720c;box-shadow:0 0 20px rgba(232,114,12,.2);}
.tier.recommended::before{content:'RECOMMENDED';position:absolute;top:10px;right:-28px;background:#e8720c;color:white;font-size:9px;font-weight:700;padding:2px 30px;transform:rotate(45deg);letter-spacing:.08em;}
.tier-name{font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;}
.tier-price{font-size:28px;font-weight:700;color:#e8720c;margin:8px 0;}
.tier-monthly{font-size:12px;color:#8b8e96;}
.tier-desc{font-size:13px;color:#8b8e96;margin-top:8px;line-height:1.5;}
.tier-items{margin-top:12px;border-top:1px solid #2a2d35;padding-top:10px;}
.tier-item{display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#8b8e96;border-bottom:1px solid #1a1d2310;}
.finance-section{margin-top:20px;}
.finance-opt{display:flex;align-items:center;gap:10px;padding:12px;background:#1e2028;border:2px solid #2a2d35;border-radius:10px;margin-bottom:8px;cursor:pointer;transition:all .2s;}
.finance-opt:hover{border-color:#4A9EFF40;}
.finance-opt.selected{border-color:#4A9EFF;background:#4A9EFF10;}
.finance-label{font-size:13px;font-weight:600;flex:1;}
.finance-payment{font-size:14px;font-weight:700;color:#4A9EFF;}
.insurance-box{background:#1e2028;border:1px solid #2a2d35;border-radius:10px;padding:16px;margin-top:16px;}
.ins-label{font-size:11px;font-weight:700;color:#4A9EFF;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;}
.ins-detail{font-size:13px;color:#e5e7eb;}
.sign-section{margin-top:24px;text-align:center;}
.sign-canvas-wrap{background:#fff;border-radius:10px;margin:12px auto;max-width:400px;height:120px;position:relative;}
.sign-canvas{width:100%;height:100%;border-radius:10px;cursor:crosshair;}
.sign-clear{position:absolute;top:4px;right:8px;background:none;border:none;color:#999;font-size:11px;cursor:pointer;}
.sign-btn{padding:16px 40px;background:#e8720c;color:white;border:none;border-radius:12px;font-size:16px;font-weight:700;font-family:'Barlow Condensed',sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;margin-top:12px;transition:all .2s;}
.sign-btn:hover{filter:brightness(1.15);}
.sign-btn:disabled{opacity:.4;cursor:not-allowed;}
.schedule-section{margin-top:20px;text-align:center;}
.schedule-input{padding:12px;background:#1e2028;border:1px solid #2a2d35;border-radius:8px;color:#e5e7eb;font-size:14px;font-family:'Barlow',sans-serif;width:100%;max-width:300px;}
.footer{text-align:center;padding:30px 20px;font-size:11px;color:#8b8e96;border-top:1px solid #2a2d35;margin-top:30px;}
.success-overlay{display:none;position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(0,0,0,.85);z-index:100;align-items:center;justify-content:center;flex-direction:column;gap:16px;}
.success-overlay.show{display:flex;}
.success-icon{font-size:60px;}
.success-text{font-size:22px;font-weight:700;font-family:'Barlow Condensed',sans-serif;}
.success-sub{font-size:13px;color:#8b8e96;max-width:300px;text-align:center;}
.warranty-badge{display:inline-block;background:linear-gradient(135deg,#e8720c,#ff8c42);color:white;padding:8px 20px;border-radius:20px;font-size:12px;font-weight:700;font-family:'Barlow Condensed',sans-serif;letter-spacing:.04em;margin-top:12px;}
@media(max-width:500px){.tier-price{font-size:22px;}.tier-name{font-size:17px;}}
</style>
</head><body>

<div class="hero">
  <div class="logo">NO BIG DEAL <span>HOME SOLUTIONS</span></div>
  <div class="customer">${esc(deal.customerName) || 'Homeowner'}</div>
  <div class="addr">${esc(deal.address)}</div>
  <div class="rep-bar">
    <div>
      <div class="rep-name">${esc(deal.repName)}</div>
      <div class="rep-contact">${esc(deal.repPhone)} · ${esc(deal.repEmail)}</div>
    </div>
  </div>
  <div class="warranty-badge">${esc(deal.warranty)}</div>
</div>

<div class="container">
  <div class="section-title">Choose Your Roof Package</div>
  <div class="tier-cards">
    <div class="tier" id="tier-good" onclick="selectTier('good')">
      <div class="tier-name">☆ Good</div>
      <div class="tier-price">${fmtCurrency(deal.tiers.good.price)}</div>
      <div class="tier-monthly">or ~${fmtCurrency(goodPay)}/mo with financing</div>
      <div class="tier-desc">${esc(deal.tiers.good.description)}</div>
    </div>
    <div class="tier recommended" id="tier-better" onclick="selectTier('better')">
      <div class="tier-name">★★ Better</div>
      <div class="tier-price">${fmtCurrency(deal.tiers.better.price)}</div>
      <div class="tier-monthly">or ~${fmtCurrency(betterPay)}/mo with financing</div>
      <div class="tier-desc">${esc(deal.tiers.better.description)}</div>
    </div>
    <div class="tier" id="tier-best" onclick="selectTier('best')">
      <div class="tier-name">★★★ Best</div>
      <div class="tier-price">${fmtCurrency(deal.tiers.best.price)}</div>
      <div class="tier-monthly">or ~${fmtCurrency(bestPay)}/mo with financing</div>
      <div class="tier-desc">${esc(deal.tiers.best.description)}</div>
    </div>
  </div>

  ${deal.insuranceClaim ? `
  <div class="insurance-box">
    <div class="ins-label">📋 Insurance Claim Info</div>
    <div class="ins-detail">Carrier: <strong>${esc(deal.insuranceCarrier)}</strong></div>
    ${deal.claimNumber ? `<div class="ins-detail">Claim #: ${esc(deal.claimNumber)}</div>` : ''}
    ${deal.deductible ? `<div class="ins-detail">Your deductible: <strong>${fmtCurrency(deal.deductible)}</strong></div>` : ''}
    <div style="font-size:11px;color:#8b8e96;margin-top:8px;">We work directly with your insurance — you typically only pay your deductible.</div>
  </div>
  ` : ''}

  <div class="section-title">Financing Options</div>
  <div class="finance-section" id="financeOpts"></div>

  <div class="section-title">Sign & Schedule</div>
  <div class="sign-section">
    <p style="font-size:13px;color:#8b8e96;margin-bottom:8px;">By signing below, you authorize No Big Deal Home Solutions to proceed with the selected roof package.</p>
    <div class="sign-canvas-wrap">
      <canvas id="sigCanvas" class="sign-canvas"></canvas>
      <button class="sign-clear" onclick="clearSig()">Clear</button>
    </div>
    <div class="schedule-section">
      <p style="font-size:12px;color:#8b8e96;margin-bottom:8px;">Preferred installation date:</p>
      <input type="date" id="schedDate" class="schedule-input" min="${new Date().toISOString().split('T')[0]}">
    </div>
    <button class="sign-btn" id="submitBtn" onclick="submitDeal()" disabled>✓ ACCEPT & SCHEDULE</button>
  </div>

  <div class="footer">
    <div>No Big Deal Home Solutions · Licensed & Insured</div>
    <div style="margin-top:4px;">This estimate is valid until ${fmtDate(deal.expiresAt)}</div>
  </div>
</div>

<div class="success-overlay" id="successOverlay">
  <div class="success-icon">🎉</div>
  <div class="success-text">You're All Set!</div>
  <div class="success-sub">We've received your selection and signature. Your rep ${esc(deal.repName)} will be in touch shortly to confirm your installation date.</div>
</div>

<script>
let selectedTier = null;
let selectedFinance = null;
let sigDrawing = false;
let sigHasContent = false;

function selectTier(tier) {
  selectedTier = tier;
  document.querySelectorAll('.tier').forEach(t => t.classList.remove('selected'));
  document.getElementById('tier-' + tier).classList.add('selected');
  updateFinancing();
  checkReady();
}

function updateFinancing() {
  if (!selectedTier) return;
  const prices = ${JSON.stringify({ good: deal.tiers.good.price, better: deal.tiers.better.price, best: deal.tiers.best.price })};
  const price = prices[selectedTier];
  const rates = ${JSON.stringify(FINANCING_RATES)};
  const container = document.getElementById('financeOpts');
  container.innerHTML = '<div class="finance-opt selected" onclick="selectFinancing(-1,this)" data-idx="-1"><span class="finance-label">💰 Pay in Full</span><span class="finance-payment">' + formatCurrency(price) + '</span></div>' +
    rates.map((r, i) => {
      const monthly = r.rate === 0 ? price / r.term : price * (r.rate/100/12) * Math.pow(1+r.rate/100/12, r.term) / (Math.pow(1+r.rate/100/12, r.term) - 1);
      return '<div class="finance-opt" onclick="selectFinancing('+i+',this)" data-idx="'+i+'"><span class="finance-label">' + r.label + '</span><span class="finance-payment">' + formatCurrency(monthly) + '/mo</span></div>';
    }).join('');
  selectedFinance = -1;
}

function selectFinancing(idx, el) {
  document.querySelectorAll('.finance-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  selectedFinance = idx;
  checkReady();
}

function formatCurrency(n) { return '$' + n.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}); }

function checkReady() {
  const btn = document.getElementById('submitBtn');
  btn.disabled = !(selectedTier && sigHasContent);
}

// Signature canvas
const canvas = document.getElementById('sigCanvas');
const ctx = canvas.getContext('2d');
canvas.width = canvas.offsetWidth * 2;
canvas.height = canvas.offsetHeight * 2;
ctx.scale(2, 2);
ctx.strokeStyle = '#333';
ctx.lineWidth = 2;
ctx.lineCap = 'round';

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const t = e.touches ? e.touches[0] : e;
  return { x: t.clientX - rect.left, y: t.clientY - rect.top };
}

canvas.addEventListener('mousedown', e => { sigDrawing = true; ctx.beginPath(); const p = getPos(e); ctx.moveTo(p.x, p.y); });
canvas.addEventListener('mousemove', e => { if (!sigDrawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); sigHasContent = true; checkReady(); });
canvas.addEventListener('mouseup', () => { sigDrawing = false; });
canvas.addEventListener('touchstart', e => { e.preventDefault(); sigDrawing = true; ctx.beginPath(); const p = getPos(e); ctx.moveTo(p.x, p.y); }, {passive:false});
canvas.addEventListener('touchmove', e => { e.preventDefault(); if (!sigDrawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); sigHasContent = true; checkReady(); }, {passive:false});
canvas.addEventListener('touchend', () => { sigDrawing = false; });

function clearSig() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  sigHasContent = false;
  checkReady();
}

function submitDeal() {
  if (!selectedTier || !sigHasContent) return;
  const sigData = canvas.toDataURL('image/png');
  const schedDate = document.getElementById('schedDate').value;
  // In production this would POST to a webhook/function
  console.log('Deal accepted:', { tier: selectedTier, financing: selectedFinance, signature: sigData, scheduledDate: schedDate, dealId: '${deal.id}' });
  document.getElementById('successOverlay').classList.add('show');
}
<\/script>
</body></html>`;
  }

  // ============================================================================
  // SHARE FUNCTIONS
  // ============================================================================

  function generateShareableLink(deal) {
    // Generate the HTML and store as a data URL or blob URL
    const html = generateDealPageHTML(deal);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);

    // Also try Firebase Storage if available
    if (window._storage) {
      uploadDealPage(deal, html);
    }

    return url;
  }

  async function uploadDealPage(deal, html) {
    if (!window._storage || !window._user) return null;
    try {
      const { ref, uploadString, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js');
      const storageRef = ref(window._storage, `deal_rooms/${window._user.uid}/${deal.id}.html`);
      await uploadString(storageRef, html, 'raw', { contentType: 'text/html' });
      const downloadUrl = await getDownloadURL(storageRef);
      deal.shareUrl = downloadUrl;
      saveDealRooms();
      syncDealToFirestore(deal);
      return downloadUrl;
    } catch (e) {
      console.error('Deal page upload error:', e);
      return null;
    }
  }

  function openDealPreview(dealId) {
    const deal = dealRooms.find(d => d.id === dealId);
    if (!deal) return;
    const html = generateDealPageHTML(deal);
    // Route through the Universal Document Viewer
    if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
      const slug = String(deal.customerName || dealId || 'deal').replace(/[^A-Za-z0-9]+/g, '-').substring(0, 40);
      window.NBDDocViewer.open({
        html: html,
        title: 'Deal Preview — ' + (deal.customerName || 'Deal #' + dealId),
        filename: 'NBD-Deal-' + slug + '-' + new Date().toISOString().split('T')[0] + '.pdf'
      });
      return;
    }
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  }

  async function sendViaSMS(dealId) {
    const deal = dealRooms.find(d => d.id === dealId);
    if (!deal || !deal.customerPhone) {
      if (window.showToast) window.showToast('No phone number for this customer', 'error');
      return;
    }

    // Generate and upload the page
    const html = generateDealPageHTML(deal);
    let shareUrl = deal.shareUrl;
    if (!shareUrl) {
      shareUrl = await uploadDealPage(deal, html);
    }

    if (shareUrl) {
      // Open SMS with pre-filled message
      const msg = encodeURIComponent(`Hi ${deal.customerName || 'there'}! Here's your roof estimate from No Big Deal Home Solutions. View your options, compare packages, and sign digitally: ${shareUrl}`);
      window.open(`sms:${deal.customerPhone.replace(/\D/g, '')}?body=${msg}`, '_self');
      updateDeal(dealId, { status: DEAL_STATUS.SENT, sentAt: new Date().toISOString(), sentVia: 'sms' });
    } else {
      // Fallback: copy link
      if (window.showToast) window.showToast('Upload failed — preview the deal and share manually', 'warning');
    }
  }

  async function sendViaEmail(dealId) {
    const deal = dealRooms.find(d => d.id === dealId);
    if (!deal || !deal.customerEmail) {
      if (window.showToast) window.showToast('No email for this customer', 'error');
      return;
    }

    const html = generateDealPageHTML(deal);
    let shareUrl = deal.shareUrl;
    if (!shareUrl) {
      shareUrl = await uploadDealPage(deal, html);
    }

    const subject = encodeURIComponent('Your Roof Estimate — No Big Deal Home Solutions');
    const body = encodeURIComponent(`Hi ${deal.customerName || 'there'},\n\nThank you for giving us the opportunity to earn your business! I've put together your personalized roof estimate.\n\nView your options here: ${shareUrl || '[Link will be available shortly]'}\n\nYou can compare packages, see financing options, and digitally sign — all from your phone.\n\nBest,\n${deal.repName}\nNo Big Deal Home Solutions\n${deal.repPhone}`);

    window.open(`mailto:${deal.customerEmail}?subject=${subject}&body=${body}`, '_self');
    updateDeal(dealId, { status: DEAL_STATUS.SENT, sentAt: new Date().toISOString(), sentVia: 'email' });
  }

  function copyDealLink(dealId) {
    const deal = dealRooms.find(d => d.id === dealId);
    if (!deal) return;
    if (deal.shareUrl) {
      navigator.clipboard?.writeText(deal.shareUrl).then(() => {
        if (window.showToast) window.showToast('Link copied!', 'success');
      });
    } else {
      // Generate and upload first
      const html = generateDealPageHTML(deal);
      uploadDealPage(deal, html).then(url => {
        if (url) {
          navigator.clipboard?.writeText(url).then(() => {
            if (window.showToast) window.showToast('Link copied!', 'success');
          });
        } else {
          if (window.showToast) window.showToast('Could not generate link — try preview instead', 'warning');
        }
      });
    }
  }

  // ============================================================================
  // UI RENDERING
  // ============================================================================

  function setTab(tab) {
    currentTab = tab;
    render();
  }

  function render() {
    const container = document.getElementById('view-closeboard');
    if (!container) return;
    const scroll = container.querySelector('.view-scroll') || container;

    const tabBtn = (id, label, icon) => {
      const active = currentTab === id;
      return `<button onclick="window.CloseBoard.setTab('${id}')" style="padding:8px 16px;border:none;border-radius:8px;background:${active ? 'var(--orange,#e8720c)' : 'var(--s2,#1e2028)'};color:${active ? '#fff' : 'var(--m,#8b8e96)'};font-size:12px;font-weight:${active ? '700' : '500'};font-family:'Barlow Condensed',sans-serif;cursor:pointer;letter-spacing:.03em;transition:all .15s;">${icon} ${label}</button>`;
    };

    const active = dealRooms.filter(d => d.status !== DEAL_STATUS.EXPIRED);
    const signed = dealRooms.filter(d => d.status === DEAL_STATUS.SIGNED || d.status === DEAL_STATUS.SCHEDULED);
    const totalValue = signed.reduce((s, d) => s + (d.tiers[d.selectedTier || 'better']?.price || 0), 0);

    let html = `
      <div style="padding:16px 20px 0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div>
            <div style="font-size:22px;font-weight:800;font-family:'Barlow Condensed',sans-serif;color:var(--t);letter-spacing:.02em;">📋 CLOSE BOARD</div>
            <div style="font-size:12px;color:var(--m);margin-top:2px;">Shareable deal rooms — one link to close</div>
          </div>
          <button onclick="window.CloseBoard.createNew()" style="padding:8px 16px;background:var(--orange,#e8720c);color:white;border:none;border-radius:8px;font-size:12px;font-weight:700;font-family:'Barlow Condensed',sans-serif;cursor:pointer;letter-spacing:.04em;text-transform:uppercase;">
            + NEW DEAL
          </button>
        </div>

        <!-- Stats -->
        <div style="display:flex;gap:10px;margin-bottom:14px;overflow-x:auto;">
          <div style="flex:1;min-width:100px;background:var(--s2);border:1px solid var(--br);border-radius:10px;padding:12px;text-align:center;">
            <div style="font-size:22px;font-weight:700;color:var(--blue);">${active.length}</div>
            <div style="font-size:10px;color:var(--m);text-transform:uppercase;letter-spacing:.06em;">Active Deals</div>
          </div>
          <div style="flex:1;min-width:100px;background:var(--s2);border:1px solid var(--br);border-radius:10px;padding:12px;text-align:center;">
            <div style="font-size:22px;font-weight:700;color:var(--orange);">${dealRooms.filter(d => d.status === DEAL_STATUS.VIEWED).length}</div>
            <div style="font-size:10px;color:var(--m);text-transform:uppercase;letter-spacing:.06em;">Viewed</div>
          </div>
          <div style="flex:1;min-width:100px;background:var(--s2);border:1px solid var(--br);border-radius:10px;padding:12px;text-align:center;">
            <div style="font-size:22px;font-weight:700;color:var(--green);">${signed.length}</div>
            <div style="font-size:10px;color:var(--m);text-transform:uppercase;letter-spacing:.06em;">Signed</div>
          </div>
          <div style="flex:1;min-width:100px;background:var(--s2);border:1px solid var(--br);border-radius:10px;padding:12px;text-align:center;">
            <div style="font-size:22px;font-weight:700;color:var(--green);">${fmtCurrency(totalValue)}</div>
            <div style="font-size:10px;color:var(--m);text-transform:uppercase;letter-spacing:.06em;">Closed Value</div>
          </div>
        </div>

        <!-- Tabs -->
        <div style="display:flex;gap:6px;margin-bottom:14px;">
          ${tabBtn('active', 'Active Deals', '📋')}
          ${tabBtn('create', 'New Deal', '➕')}
          ${tabBtn('analytics', 'Analytics', '📊')}
        </div>
      </div>

      <div style="padding:0 20px 20px;">
    `;

    if (currentTab === 'active') {
      html += renderActiveDeals();
    } else if (currentTab === 'create') {
      html += renderCreateForm();
    } else if (currentTab === 'analytics') {
      html += renderAnalytics();
    }

    html += '</div>';
    scroll.innerHTML = html;
  }

  function renderActiveDeals() {
    if (dealRooms.length === 0) {
      return `
        <div style="text-align:center;padding:40px;">
          <div style="font-size:40px;margin-bottom:12px;">📋</div>
          <div style="font-size:15px;font-weight:600;color:var(--t);">No Deal Rooms Yet</div>
          <div style="font-size:12px;color:var(--m);margin-top:4px;">Create a deal from any estimate to generate a shareable link.</div>
        </div>
      `;
    }

    return dealRooms.map(d => `
      <div style="background:var(--s2);border:1px solid var(--br);border-radius:10px;padding:14px;margin-bottom:10px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
          <div style="flex:1;">
            <div style="font-size:14px;font-weight:700;color:var(--t);">${esc(d.customerName) || 'Unnamed'}</div>
            <div style="font-size:11px;color:var(--m);margin-top:2px;">${esc(d.address) || 'No address'}</div>
            <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
              <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${STATUS_COLORS[d.status]}20;color:${STATUS_COLORS[d.status]};font-weight:600;text-transform:uppercase;">${d.status}</span>
              <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--s);border:1px solid var(--br);color:var(--t);">${fmtCurrency(d.tiers.better.price)}</span>
              ${d.viewCount > 0 ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--s);border:1px solid var(--br);color:var(--m);">👁 ${d.viewCount} views</span>` : ''}
              ${d.sentVia ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--s);border:1px solid var(--br);color:var(--m);">📤 via ${d.sentVia}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
            <button onclick="window.CloseBoard.preview('${esc(d.id)}')" style="padding:5px 10px;background:var(--blue,#4A9EFF);color:white;border:none;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;">👁 Preview</button>
            <button onclick="window.CloseBoard.sendSMS('${esc(d.id)}')" style="padding:5px 10px;background:var(--green,#2ECC8A);color:white;border:none;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;">📱 Text</button>
            <button onclick="window.CloseBoard.sendEmail('${esc(d.id)}')" style="padding:5px 10px;background:var(--orange,#e8720c);color:white;border:none;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;">📧 Email</button>
            <button onclick="window.CloseBoard.copyLink('${esc(d.id)}')" style="padding:5px 10px;background:var(--s);border:1px solid var(--br);color:var(--t);border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;">🔗 Copy</button>
          </div>
        </div>
        <div style="font-size:10px;color:var(--m);margin-top:8px;">Created ${timeAgo(d.createdAt)} · Expires ${fmtDate(d.expiresAt)}</div>
      </div>
    `).join('');
  }

  function renderCreateForm() {
    return `
      <div style="background:var(--s2);border:1px solid var(--br);border-radius:10px;padding:16px;">
        <div style="font-size:14px;font-weight:700;color:var(--t);margin-bottom:12px;">Create New Deal Room</div>

        <div style="margin-bottom:10px;">
          <label style="font-size:11px;font-weight:600;color:var(--m);text-transform:uppercase;letter-spacing:.06em;">Customer Name</label>
          <input id="cb-name" type="text" placeholder="John Smith" style="width:100%;padding:10px;background:var(--s);border:1px solid var(--br);border-radius:8px;color:var(--t);font-size:13px;margin-top:4px;box-sizing:border-box;">
        </div>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <div style="flex:1;">
            <label style="font-size:11px;font-weight:600;color:var(--m);text-transform:uppercase;letter-spacing:.06em;">Phone</label>
            <input id="cb-phone" type="tel" placeholder="(555) 123-4567" style="width:100%;padding:10px;background:var(--s);border:1px solid var(--br);border-radius:8px;color:var(--t);font-size:13px;margin-top:4px;box-sizing:border-box;">
          </div>
          <div style="flex:1;">
            <label style="font-size:11px;font-weight:600;color:var(--m);text-transform:uppercase;letter-spacing:.06em;">Email</label>
            <input id="cb-email" type="email" placeholder="john@email.com" style="width:100%;padding:10px;background:var(--s);border:1px solid var(--br);border-radius:8px;color:var(--t);font-size:13px;margin-top:4px;box-sizing:border-box;">
          </div>
        </div>
        <div style="margin-bottom:10px;">
          <label style="font-size:11px;font-weight:600;color:var(--m);text-transform:uppercase;letter-spacing:.06em;">Address</label>
          <input id="cb-addr" type="text" placeholder="123 Main St, Cincinnati, OH" style="width:100%;padding:10px;background:var(--s);border:1px solid var(--br);border-radius:8px;color:var(--t);font-size:13px;margin-top:4px;box-sizing:border-box;">
        </div>

        <div style="font-size:12px;font-weight:700;color:var(--t);margin:14px 0 8px;">Pricing Tiers</div>
        <div style="display:flex;gap:8px;margin-bottom:10px;">
          <div style="flex:1;">
            <label style="font-size:10px;color:var(--m);">Good ($)</label>
            <input id="cb-good" type="number" placeholder="8000" style="width:100%;padding:8px;background:var(--s);border:1px solid var(--br);border-radius:6px;color:var(--t);font-size:13px;margin-top:3px;box-sizing:border-box;">
          </div>
          <div style="flex:1;">
            <label style="font-size:10px;color:var(--m);">Better ($)</label>
            <input id="cb-better" type="number" placeholder="11000" style="width:100%;padding:8px;background:var(--s);border:1px solid var(--br);border-radius:6px;color:var(--t);font-size:13px;margin-top:3px;box-sizing:border-box;">
          </div>
          <div style="flex:1;">
            <label style="font-size:10px;color:var(--m);">Best ($)</label>
            <input id="cb-best" type="number" placeholder="15000" style="width:100%;padding:8px;background:var(--s);border:1px solid var(--br);border-radius:6px;color:var(--t);font-size:13px;margin-top:3px;box-sizing:border-box;">
          </div>
        </div>

        <div style="margin-bottom:10px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input id="cb-insurance" type="checkbox" style="accent-color:var(--orange);">
            <span style="font-size:12px;color:var(--t);">Insurance claim</span>
          </label>
        </div>
        <div id="cb-ins-fields" style="display:none;margin-bottom:10px;">
          <div style="display:flex;gap:8px;">
            <input id="cb-carrier" type="text" placeholder="Insurance carrier" style="flex:1;padding:8px;background:var(--s);border:1px solid var(--br);border-radius:6px;color:var(--t);font-size:12px;box-sizing:border-box;">
            <input id="cb-deductible" type="number" placeholder="Deductible $" style="width:120px;padding:8px;background:var(--s);border:1px solid var(--br);border-radius:6px;color:var(--t);font-size:12px;box-sizing:border-box;">
          </div>
        </div>

        <button onclick="window.CloseBoard.submitCreate()" style="width:100%;padding:14px;background:var(--orange,#e8720c);color:white;border:none;border-radius:10px;font-size:14px;font-weight:700;font-family:'Barlow Condensed',sans-serif;cursor:pointer;letter-spacing:.04em;text-transform:uppercase;margin-top:8px;">
          CREATE DEAL ROOM
        </button>
      </div>
    `;
  }

  function renderAnalytics() {
    const total = dealRooms.length;
    const sent = dealRooms.filter(d => d.sentAt).length;
    const viewed = dealRooms.filter(d => d.viewCount > 0).length;
    const signed = dealRooms.filter(d => d.status === DEAL_STATUS.SIGNED || d.status === DEAL_STATUS.SCHEDULED).length;
    const closeRate = sent > 0 ? Math.round(signed / sent * 100) : 0;

    return `
      <div style="margin-top:4px;">
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:16px;">
          <div style="background:var(--s2);border:1px solid var(--br);border-radius:10px;padding:14px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:var(--t);">${total}</div>
            <div style="font-size:10px;color:var(--m);text-transform:uppercase;">Total Deals</div>
          </div>
          <div style="background:var(--s2);border:1px solid var(--br);border-radius:10px;padding:14px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:var(--blue);">${sent}</div>
            <div style="font-size:10px;color:var(--m);text-transform:uppercase;">Sent</div>
          </div>
          <div style="background:var(--s2);border:1px solid var(--br);border-radius:10px;padding:14px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:#ffab00;">${viewed}</div>
            <div style="font-size:10px;color:var(--m);text-transform:uppercase;">Viewed</div>
          </div>
          <div style="background:var(--s2);border:1px solid var(--br);border-radius:10px;padding:14px;text-align:center;">
            <div style="font-size:28px;font-weight:700;color:var(--green);">${closeRate}%</div>
            <div style="font-size:10px;color:var(--m);text-transform:uppercase;">Close Rate</div>
          </div>
        </div>

        <div style="font-size:11px;font-weight:700;color:var(--t);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Conversion Funnel</div>
        <div style="background:var(--s2);border:1px solid var(--br);border-radius:10px;padding:14px;">
          ${['Created → Sent', 'Sent → Viewed', 'Viewed → Signed'].map((label, i) => {
            const vals = [
              [total, sent],
              [sent, viewed],
              [viewed, signed]
            ][i];
            const pct = vals[0] > 0 ? Math.round(vals[1] / vals[0] * 100) : 0;
            return `
              <div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--t);margin-bottom:4px;">
                  <span>${label}</span>
                  <span style="font-weight:700;">${pct}% (${vals[1]}/${vals[0]})</span>
                </div>
                <div style="height:6px;background:var(--s);border-radius:3px;overflow:hidden;">
                  <div style="height:100%;width:${pct}%;background:var(--orange);border-radius:3px;transition:width .3s;"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // ============================================================================
  // FORM HANDLERS
  // ============================================================================

  function submitCreateForm() {
    const name = document.getElementById('cb-name')?.value?.trim();
    const phone = document.getElementById('cb-phone')?.value?.trim();
    const email = document.getElementById('cb-email')?.value?.trim();
    const addr = document.getElementById('cb-addr')?.value?.trim();
    const good = parseFloat(document.getElementById('cb-good')?.value) || 0;
    const better = parseFloat(document.getElementById('cb-better')?.value) || 0;
    const best = parseFloat(document.getElementById('cb-best')?.value) || 0;
    const isInsurance = document.getElementById('cb-insurance')?.checked;
    const carrier = document.getElementById('cb-carrier')?.value?.trim();
    const deductible = parseFloat(document.getElementById('cb-deductible')?.value) || 0;

    if (!name) {
      if (window.showToast) window.showToast('Customer name is required', 'error');
      return;
    }
    if (good === 0 && better === 0 && best === 0) {
      if (window.showToast) window.showToast('Enter at least one tier price', 'error');
      return;
    }

    const deal = createDealRoom({
      customerName: name,
      customerPhone: phone,
      customerEmail: email,
      address: addr,
      tiers: {
        good: { label: 'Good', price: good, description: 'Standard reroof with quality materials', lineItems: [] },
        better: { label: 'Better', price: better, description: 'Enhanced reroof with premium underlayment and ice shield', lineItems: [] },
        best: { label: 'Best', price: best, description: 'Complete roof system with full deck replacement and gutters', lineItems: [] }
      },
      insuranceClaim: isInsurance,
      insuranceCarrier: carrier,
      deductible
    });

    if (window.showToast) window.showToast('Deal room created for ' + name, 'success');
    currentTab = 'active';
    render();
  }

  // ============================================================================
  // INIT & PUBLIC API
  // ============================================================================

  function init() {
    loadDealRooms();
    render();

    // Bind insurance toggle
    setTimeout(() => {
      const cb = document.getElementById('cb-insurance');
      if (cb) {
        cb.addEventListener('change', () => {
          const fields = document.getElementById('cb-ins-fields');
          if (fields) fields.style.display = cb.checked ? 'block' : 'none';
        });
      }
    }, 100);
  }

  function createNew() {
    currentTab = 'create';
    render();
  }

  window.CloseBoard = {
    init,
    render,
    setTab,
    createNew,
    createFromEstimate,
    submitCreate: submitCreateForm,
    preview: openDealPreview,
    sendSMS: sendViaSMS,
    sendEmail: sendViaEmail,
    copyLink: copyDealLink,
    updateDeal,
    deleteDeal,
    getDeals: () => dealRooms,
    generatePageHTML: generateDealPageHTML
  };

})();
