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

  // The booked dollar value of a deal. A remote acceptance writes acceptedTier +
  // acceptedPrice (the server's price snapshot, deal-acceptance.js) — NOT
  // selectedTier, which stays null. So reading d.selectedTier silently priced
  // every non-'better' close at the 'better' tier. Prefer the authoritative
  // acceptedPrice, then the accepted tier's current price, then 'better', then 0.
  function dealValue(d) {
    if (!d) return 0;
    const ap = Number(d.acceptedPrice);
    if (d.acceptedPrice != null && !isNaN(ap)) return ap;
    const tierKey = d.acceptedTier || d.selectedTier || 'better';
    return (d.tiers && d.tiers[tierKey] && Number(d.tiers[tierKey].price)) || 0;
  }

  // Whether the homeowner ever opened the deal link. The server stamps viewedAt
  // (getDealRoom) on first open, then overwrites status to 'accepted' on accept —
  // so status==='viewed' undercounts, and viewCount is never incremented at all.
  // Treat viewedAt OR any post-sent status as evidence of a view.
  function wasViewed(d) {
    return !!(d && (d.viewedAt || d.viewCount > 0 ||
      [DEAL_STATUS.VIEWED, DEAL_STATUS.ACCEPTED, DEAL_STATUS.SIGNED, DEAL_STATUS.SCHEDULED].includes(d.status)));
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
        companyId: window._userClaims?.companyId || window._user.uid,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (e) { console.error('Deal Firestore sync error:', e); }
  }

  // Hydrate from Firestore so the board reflects SERVER state — most importantly
  // a REMOTE homeowner acceptance (submitDealAcceptance flips deal_rooms/{id}.
  // status → 'accepted'), and deals created/sent on another device. Without
  // this the board read localStorage only, so a real remote close showed as
  // still-open, Closed Value never moved, and the deal was invisible on any
  // other device. Server is authoritative for the deal lifecycle; local-only
  // drafts (never synced) are preserved. Re-renders when it returns.
  async function hydrateFromFirestore() {
    if (!window._db || !window._user) return;
    try {
      const { getDocs, query, collection, where } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const snap = await getDocs(query(
        collection(window._db, DEAL_COLLECTION),
        where('userId', '==', window._user.uid)
      ));
      if (snap.empty) return;
      const byId = {};
      dealRooms.forEach(d => { if (d && d.id) byId[d.id] = d; });
      snap.forEach(docSnap => {
        const remote = docSnap.data() || {};
        const id = remote.id || docSnap.id;
        // Server overrides any local copy (it has the latest status/acceptance);
        // server-only deals get added.
        byId[id] = Object.assign({}, byId[id] || {}, remote, { id });
      });
      dealRooms = Object.values(byId);
      saveDealRooms();
      // Don't clobber a rep mid-typing in the New Deal form — hydrate only needs
      // to refresh the active/analytics views (the create tab re-renders to the
      // active list on submit anyway).
      if (currentTab !== 'create') render();
    } catch (e) { console.error('Close Board hydrate error:', e); }
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

  async function deleteDeal(dealId) {
    dealRooms = dealRooms.filter(d => d.id !== dealId);
    saveDealRooms();
    render();
    // Also remove the server copy — without this, hydrateFromFirestore (which
    // queries deal_rooms by userId) merges the deal right back on the next load.
    if (window._db && window._user) {
      try {
        const { deleteDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        await deleteDoc(doc(window._db, DEAL_COLLECTION, dealId));
      } catch (e) { console.error('Deal delete (Firestore) error:', e); }
    }
  }

  // Destructive — confirm before removing a deal room from every device.
  function confirmDeleteDeal(dealId) {
    const deal = dealRooms.find(d => d.id === dealId);
    const name = (deal && deal.customerName) || 'this deal';
    if (window.confirm('Delete the deal room for ' + name + '?\nThis removes it from all your devices and cannot be undone.')) {
      deleteDeal(dealId);
    }
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

  // Full white-label (2026-07-19): the deal room is generated REP-side, so
  // the tenant brand is baked at generation time via window._brand() (same
  // lazy-gate pattern as photo-report.js). NBD (or unconfigured) keeps every
  // literal byte-identical — incl. the legal authorization sentence, which
  // previously named No Big Deal for EVERY tenant's homeowner.
  function _dealBrand() {
    let b = {};
    try { if (typeof window._brand === 'function') b = window._brand() || {}; } catch (_) {}
    const isNbd = !b.legalName || b.legalName === 'No Big Deal Home Solutions';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const logo = (!isNbd && typeof b.logoUrl === 'string' && /^https:\/\//i.test(b.logoUrl)) ? b.logoUrl : '';
    const accent = (!isNbd && b.colors && /^#[0-9a-f]{3,8}$/i.test(b.colors.accent || '')) ? b.colors.accent : '#e8720c';
    return {
      isNbd,
      name: isNbd ? 'No Big Deal Home Solutions' : b.legalName,
      nameEsc: isNbd ? 'No Big Deal Home Solutions' : esc(b.legalName),
      logoHtml: isNbd
        ? 'NO BIG DEAL <span>HOME SOLUTIONS</span>'
        : (logo
          ? '<img src="' + esc(logo) + '" alt="' + esc(b.legalName) + '" style="max-height:48px;max-width:240px;display:inline-block;">'
          : esc(b.legalName)),
      accent,
    };
  }

  function generateDealPageHTML(deal) {
    const goodPay = calcMonthlyPayment(deal.tiers.good.price, 7.99, 60);
    const betterPay = calcMonthlyPayment(deal.tiers.better.price, 7.99, 60);
    const bestPay = calcMonthlyPayment(deal.tiers.best.price, 7.99, 60);
    const BRAND = _dealBrand();

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Roof Estimate — ${BRAND.nameEsc}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
/* Standalone generated page: define the token locally so the color-mix
   glow below resolves (visual audit 2026-07-19 — var(--orange) was
   undefined here, the declaration was invalid, glow never rendered). */
:root{--orange:${BRAND.accent};}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Barlow',sans-serif;background:#0d0f14;color:#e5e7eb;min-height:100vh;}
.hero{background:linear-gradient(135deg,#1a1d23 0%,#0d0f14 100%);padding:40px 20px 30px;text-align:center;border-bottom:2px solid var(--orange);}
.logo{font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;letter-spacing:.04em;}
.logo span{color:var(--orange);}
.addr{font-size:14px;color:#8b8e96;margin-top:8px;}
.customer{font-size:18px;font-weight:600;margin-top:12px;}
.rep-bar{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:16px;padding:12px 20px;background:#1e2028;border-radius:10px;max-width:400px;margin-left:auto;margin-right:auto;}
.rep-name{font-size:13px;font-weight:600;}
.rep-contact{font-size:11px;color:#8b8e96;}
.container{max-width:600px;margin:0 auto;padding:20px;}
.section-title{font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--orange);margin:24px 0 12px;}
.tier-cards{display:flex;flex-direction:column;gap:12px;}
.tier{background:#1e2028;border:2px solid #2a2d35;border-radius:14px;padding:20px;cursor:pointer;transition:all .2s;position:relative;overflow:hidden;}
.tier:hover{border-color:color-mix(in srgb, var(--orange) 25%, transparent);}
.tier.selected{border-color:var(--orange);box-shadow:0 0 20px color-mix(in srgb, var(--orange) 20%, transparent);}
.tier.recommended::before{content:'RECOMMENDED';position:absolute;top:10px;right:-28px;background:var(--orange);color:white;font-size:9px;font-weight:700;padding:2px 30px;transform:rotate(45deg);letter-spacing:.08em;}
.tier-name{font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;}
.tier-price{font-size:28px;font-weight:700;color:var(--orange);margin:8px 0;}
.tier-monthly{font-size:12px;color:#8b8e96;}
.tier-desc{font-size:13px;color:#8b8e96;margin-top:8px;line-height:1.5;}
.tier-items{margin-top:12px;border-top:1px solid #2a2d35;padding-top:10px;}
.tier-item{display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:#8b8e96;border-bottom:1px solid #1a1d2310;}
.finance-section{margin-top:20px;}
.finance-opt{display:flex;align-items:center;gap:10px;padding:12px;background:#1e2028;border:2px solid #2a2d35;border-radius:10px;margin-bottom:8px;cursor:pointer;transition:all .2s;}
.finance-opt:hover{border-color:var(--orange)40;}
.finance-opt.selected{border-color:var(--orange);background:var(--orange)10;}
.finance-label{font-size:13px;font-weight:600;flex:1;}
.finance-payment{font-size:14px;font-weight:700;color:var(--orange);}
.insurance-box{background:#1e2028;border:1px solid #2a2d35;border-radius:10px;padding:16px;margin-top:16px;}
.ins-label{font-size:11px;font-weight:700;color:var(--orange);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;}
.ins-detail{font-size:13px;color:#e5e7eb;}
.sign-section{margin-top:24px;text-align:center;}
.sign-canvas-wrap{background:#fff;border-radius:10px;margin:12px auto;max-width:400px;height:120px;position:relative;}
.sign-canvas{width:100%;height:100%;border-radius:10px;cursor:crosshair;}
.sign-clear{position:absolute;top:4px;right:8px;background:none;border:none;color:#999;font-size:11px;cursor:pointer;}
.sign-btn{padding:16px 40px;background:var(--orange);color:white;border:none;border-radius:12px;font-size:16px;font-weight:700;font-family:'Barlow Condensed',sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;margin-top:12px;transition:all .2s;}
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
.warranty-badge{display:inline-block;background:linear-gradient(135deg,var(--orange),#ff8c42);color:white;padding:8px 20px;border-radius:20px;font-size:12px;font-weight:700;font-family:'Barlow Condensed',sans-serif;letter-spacing:.04em;margin-top:12px;}
@media(max-width:500px){.tier-price{font-size:22px;}.tier-name{font-size:17px;}}
</style>
</head><body>

<div class="hero">
  <div class="logo">${BRAND.logoHtml}</div>
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
    <div class="tier" id="tier-good" data-deal-tier="good">
      <div class="tier-name">☆ Good</div>
      <div class="tier-price">${fmtCurrency(deal.tiers.good.price)}</div>
      <div class="tier-monthly">or ~${fmtCurrency(goodPay)}/mo with financing</div>
      <div class="tier-desc">${esc(deal.tiers.good.description)}</div>
    </div>
    <div class="tier recommended" id="tier-better" data-deal-tier="better">
      <div class="tier-name">★★ Better</div>
      <div class="tier-price">${fmtCurrency(deal.tiers.better.price)}</div>
      <div class="tier-monthly">or ~${fmtCurrency(betterPay)}/mo with financing</div>
      <div class="tier-desc">${esc(deal.tiers.better.description)}</div>
    </div>
    <div class="tier" id="tier-best" data-deal-tier="best">
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
    <p style="font-size:13px;color:#8b8e96;margin-bottom:8px;">By signing below, you authorize ${BRAND.nameEsc} to proceed with the selected roof package.</p>
    <div class="sign-canvas-wrap">
      <canvas id="sigCanvas" class="sign-canvas"></canvas>
      <button class="sign-clear" data-deal-action="clearSig">Clear</button>
    </div>
    <div class="schedule-section">
      <p style="font-size:12px;color:#8b8e96;margin-bottom:8px;">Preferred installation date:</p>
      <input type="date" id="schedDate" class="schedule-input" min="${new Date().toISOString().split('T')[0]}">
    </div>
    <button class="sign-btn" id="submitBtn" data-deal-action="submit" disabled>✓ ACCEPT & SCHEDULE</button>
  </div>

  <div class="footer">
    <div>${BRAND.nameEsc} · Licensed & Insured</div>
    <div style="margin-top:4px;">This estimate is valid until ${fmtDate(deal.expiresAt)}</div>
  </div>
</div>

<div class="success-overlay" id="successOverlay">
  <div class="success-icon">🎉</div>
  <div class="success-text">You're All Set!</div>
  <div class="success-sub">We've received your selection and signature. Your rep ${esc(deal.repName)} will be in touch shortly to confirm your installation date.</div>
</div>

<script type="application/json" id="nbd-deal-data">${
    // Data island, not executable script — CSP does not block JSON blocks.
    // Escape < so lead-sourced strings can never close the tag early.
    JSON.stringify({
      prices: { good: deal.tiers.good.price, better: deal.tiers.better.price, best: deal.tiers.best.price },
      rates: FINANCING_RATES,
    }).replace(/</g, '\\u003c')
  }</script>
<script src="https://nobigdealwithjoedeal.com/pro/deal-room.js?v=1"><\/script>
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
    // CB fix: the deal preview is INTERACTIVE (pick tier, choose financing,
    // sign, ACCEPT). Its inline <script> + onclick handlers are dead inside the
    // NBDDocViewer srcdoc sandbox (no allow-same-origin + the dashboard's strict
    // CSP), which left every preview control inert. Open it as a blob-URL tab
    // instead — a top-level document with no inherited CSP, so it behaves exactly
    // like the customer's shared link. The doc viewer stays as a visual-only
    // fallback if the popup is blocked.
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (w) {
      // Free the blob once the new tab has had time to load the document.
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 60000);
      return;
    }
    // Popup blocked — fall back to the (script-sandboxed) doc viewer so the rep
    // can at least see the layout. Release the blob URL we won't use.
    try { URL.revokeObjectURL(url); } catch (_) {}
    if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
      const slug = String(deal.customerName || dealId || 'deal').replace(/[^A-Za-z0-9]+/g, '-').substring(0, 40);
      window.NBDDocViewer.open({
        html: html,
        title: 'Deal Preview — ' + (deal.customerName || 'Deal #' + dealId),
        filename: 'NBD-Deal-' + slug + '-' + new Date().toISOString().split('T')[0] + '.pdf'
      });
    }
  }

  async function sendViaSMS(dealId) {
    const deal = dealRooms.find(d => d.id === dealId);
    if (!deal || !deal.customerPhone) {
      if (window.showToast) window.showToast('No phone number for this customer', 'error');
      return;
    }

    // Upload + mint a single-use accept link (/deal/<token>) the homeowner
    // can actually accept from — not the raw Storage URL.
    const shareUrl = await getDealAcceptLink(deal);

    if (shareUrl) {
      // Certification finding: outbound SMS/email named NBD while the linked
      // page was tenant-branded (dead fallback chain on dashboard). Use the
      // same resolver as the generated page.
      const brand = _dealBrand().name;
      const msg = `Hi ${deal.customerName || 'there'}! Here's your roof estimate from ${brand}. View your options, compare packages, and sign digitally: ${shareUrl}`;
      if (window.NBDComms && typeof window.NBDComms.sendSMS === 'function') {
        const result = await window.NBDComms.sendSMS({
          to: deal.customerPhone,
          message: msg,
          leadId: deal.leadId || null,
        });
        if (result && result.success) {
          updateDeal(dealId, { status: DEAL_STATUS.SENT, sentAt: new Date().toISOString(), sentVia: 'sms' });
          return;
        }
      } else {
        window.open(`sms:${deal.customerPhone.replace(/\D/g, '')}?body=${encodeURIComponent(msg)}`, '_self');
        updateDeal(dealId, { status: DEAL_STATUS.SENT, sentAt: new Date().toISOString(), sentVia: 'sms' });
      }
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

    const shareUrl = await getDealAcceptLink(deal);

    // Certification finding: outbound SMS/email named NBD while the linked

    // page was tenant-branded (dead fallback chain on dashboard). Use the

    // same resolver as the generated page.

    const brand = _dealBrand().name;
    const subject = `Your Roof Estimate — ${brand}`;
    const body = `Hi ${deal.customerName || 'there'},\n\nThank you for giving us the opportunity to earn your business! I've put together your personalized roof estimate.\n\nView your options here: ${shareUrl || '[Link will be available shortly]'}\n\nYou can compare packages, see financing options, and digitally sign — all from your phone.\n\nBest,\n${deal.repName || ''}\n${brand}\n${deal.repPhone || ''}`;

    if (window.NBDComms && typeof window.NBDComms.sendEmail === 'function') {
      const result = await window.NBDComms.sendEmail({
        to: deal.customerEmail,
        subject: subject,
        body: body,
        leadId: deal.leadId || null,
      });
      if (result && result.success) {
        updateDeal(dealId, { status: DEAL_STATUS.SENT, sentAt: new Date().toISOString(), sentVia: 'email' });
        return;
      }
    } else {
      window.open(`mailto:${deal.customerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_self');
      updateDeal(dealId, { status: DEAL_STATUS.SENT, sentAt: new Date().toISOString(), sentVia: 'email' });
    }
  }

  // Build the first-party ACCEPT link for a deal: upload the interactive HTML
  // to Storage, then mint a single-use token via createDealAcceptToken. The
  // homeowner opens /deal/<token> (served same-origin by getDealRoom) and can
  // actually ACCEPT — submitDealAcceptance records tier + signature + date and
  // notifies the rep. Returns the /deal/<token> URL, or null on failure.
  async function getDealAcceptLink(deal) {
    try { await syncDealToFirestore(deal); } catch (_) {}
    const html = generateDealPageHTML(deal);
    await uploadDealPage(deal, html); // → deal_rooms/<uid>/<dealId>.html
    if (!window._httpsCallable || !window._functions) {
      if (window.showToast) window.showToast('Sign in required to create a share link', 'error');
      return null;
    }
    try {
      const fn = window._httpsCallable(window._functions, 'createDealAcceptToken');
      const res = await fn({ dealId: deal.id });
      const acceptUrl = res && res.data && res.data.acceptUrl;
      if (acceptUrl) { deal.acceptUrl = acceptUrl; saveDealRooms(); }
      return acceptUrl || null;
    } catch (e) {
      console.error('createDealAcceptToken failed:', e);
      if (window.showToast) window.showToast('Could not create the accept link — try again', 'error');
      return null;
    }
  }

  async function copyDealLink(dealId) {
    const deal = dealRooms.find(d => d.id === dealId);
    if (!deal) return;
    if (window.showToast) window.showToast('Creating accept link…', 'info');
    const url = await getDealAcceptLink(deal);
    if (!url) return; // getDealAcceptLink already surfaced the failure
    // Mark the first share as Sent so Analytics counts a copied link like
    // SMS/email do (sentAt is the close-rate denominator). Escalate status only
    // from draft so a viewed/accepted deal is never regressed to 'sent'.
    if (!deal.sentAt) {
      updateDeal(dealId, Object.assign(
        { sentAt: new Date().toISOString(), sentVia: 'link' },
        deal.status === DEAL_STATUS.DRAFT ? { status: DEAL_STATUS.SENT } : {}
      ));
    }
    try {
      await navigator.clipboard?.writeText(url);
      if (window.showToast) window.showToast('Accept link copied!', 'success');
    } catch (e) {
      if (window.showToast) window.showToast('Link ready — paste it to your customer', 'success');
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

    // Lapse past-expiry, non-closed deals to 'expired' so the Active list/count
    // stop carrying them forever — nothing else transitions them (no server
    // cron). Display-only and idempotent on every paint.
    const _now = Date.now();
    dealRooms.forEach(d => {
      if (d && d.expiresAt && new Date(d.expiresAt).getTime() < _now &&
          ![DEAL_STATUS.ACCEPTED, DEAL_STATUS.SIGNED, DEAL_STATUS.SCHEDULED, DEAL_STATUS.EXPIRED].includes(d.status)) {
        d.status = DEAL_STATUS.EXPIRED;
      }
    });

    const tabBtn = (id, label, icon) => {
      const active = currentTab === id;
      return `<button data-cb-action="setTab" data-cb-id="${id}" style="padding:8px 16px;border:none;border-radius:8px;background:${active ? 'var(--orange,#e8720c)' : 'var(--s2,#1e2028)'};color:${active ? '#fff' : 'var(--m,#8b8e96)'};font-size:12px;font-weight:${active ? '700' : '500'};font-family:'Barlow Condensed',sans-serif;cursor:pointer;letter-spacing:.03em;transition:all .15s;">${icon} ${label}</button>`;
    };

    const active = dealRooms.filter(d => d.status !== DEAL_STATUS.EXPIRED);
    // A remote homeowner acceptance lands as status 'accepted' (deal-acceptance.js);
    // count it as closed alongside signed/scheduled so Closed Value actually moves.
    const signed = dealRooms.filter(d => d.status === DEAL_STATUS.ACCEPTED || d.status === DEAL_STATUS.SIGNED || d.status === DEAL_STATUS.SCHEDULED);
    const totalValue = signed.reduce((s, d) => s + dealValue(d), 0);

    let html = `
      <div style="padding:16px 20px 0;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <div>
            <div style="font-size:22px;font-weight:800;font-family:'Barlow Condensed',sans-serif;color:var(--t);letter-spacing:.02em;">📋 CLOSE BOARD</div>
            <div style="font-size:12px;color:var(--m);margin-top:2px;">Shareable deal rooms — one link to close</div>
          </div>
          <button data-cb-action="createNew" style="padding:8px 16px;background:var(--orange,#e8720c);color:white;border:none;border-radius:8px;font-size:12px;font-weight:700;font-family:'Barlow Condensed',sans-serif;cursor:pointer;letter-spacing:.04em;text-transform:uppercase;">
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
            <div style="font-size:22px;font-weight:700;color:var(--orange);">${dealRooms.filter(wasViewed).length}</div>
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

    // NEW-C2: bind the New-Deal insurance toggle on every paint. render()
    // replaces innerHTML, so #cb-insurance is a fresh node each time — binding
    // here attaches exactly one listener (no accumulation) and survives tab
    // round-trips, unlike the one-shot setTimeout bind in init() which fired
    // before the create form existed on the default 'active' tab.
    const insToggle = scroll.querySelector('#cb-insurance');
    if (insToggle) {
      insToggle.addEventListener('change', () => {
        const fields = scroll.querySelector('#cb-ins-fields');
        if (fields) fields.style.display = insToggle.checked ? 'block' : 'none';
      });
    }

    // Delegated click handler — replaces previously-inline onclick handlers
    // that were silently no-op'd by prod CSP `script-src-attr 'none'`. The
    // CSP blocks inline event-handler attributes even when injected via
    // innerHTML, so the buttons rendered above need a property-based
    // handler attached to the container.
    scroll.onclick = function (ev) {
      const target = ev.target.closest('[data-cb-action]');
      if (!target) return;
      const action = target.dataset.cbAction;
      const id = target.dataset.cbId;
      const fn = window.CloseBoard && window.CloseBoard[action];
      if (typeof fn === 'function') {
        try { id ? fn(id) : fn(); }
        catch (e) { console.error('[close-board] dispatch failed for ' + action + ':', e); }
      } else {
        console.warn('[close-board] unknown action:', action);
      }
    };
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
              <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${STATUS_COLORS[d.status] || 'var(--m)'}20;color:${STATUS_COLORS[d.status] || 'var(--m)'};font-weight:600;text-transform:uppercase;">${esc(d.status)}</span>
              <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--s);border:1px solid var(--br);color:var(--t);">${fmtCurrency(dealValue(d))}</span>
              ${wasViewed(d) ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--s);border:1px solid var(--br);color:var(--m);">👁 Viewed</span>` : ''}
              ${d.sentVia ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--s);border:1px solid var(--br);color:var(--m);">📤 via ${d.sentVia}</span>` : ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
            <button data-cb-action="preview" data-cb-id="${esc(d.id)}" style="padding:5px 10px;background:var(--blue,var(--orange));color:white;border:none;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;">👁 Preview</button>
            <button data-cb-action="sendSMS" data-cb-id="${esc(d.id)}" style="padding:5px 10px;background:var(--green,#2ECC8A);color:white;border:none;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;">📱 Text</button>
            <button data-cb-action="sendEmail" data-cb-id="${esc(d.id)}" style="padding:5px 10px;background:var(--orange,#e8720c);color:white;border:none;border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;">📧 Email</button>
            <button data-cb-action="copyLink" data-cb-id="${esc(d.id)}" style="padding:5px 10px;background:var(--s);border:1px solid var(--br);color:var(--t);border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;">🔗 Copy</button>
            <button data-cb-action="remove" data-cb-id="${esc(d.id)}" style="padding:5px 10px;background:transparent;border:1px solid var(--br);color:var(--m);border-radius:5px;font-size:10px;font-weight:600;cursor:pointer;">🗑 Delete</button>
          </div>
        </div>
        <div style="font-size:10px;color:var(--m);margin-top:8px;">Created ${timeAgo(d.createdAt)} · Expires ${fmtDate(d.expiresAt)}${d.scheduledInstallDate ? ' · 🔨 Install ' + esc(fmtDate(d.scheduledInstallDate)) : ''}</div>
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

        <button data-cb-action="submitCreate" style="width:100%;padding:14px;background:var(--orange,#e8720c);color:white;border:none;border-radius:10px;font-size:14px;font-weight:700;font-family:'Barlow Condensed',sans-serif;cursor:pointer;letter-spacing:.04em;text-transform:uppercase;margin-top:8px;">
          CREATE DEAL ROOM
        </button>
      </div>
    `;
  }

  function renderAnalytics() {
    const total = dealRooms.length;
    const sent = dealRooms.filter(d => d.sentAt).length;
    const viewed = dealRooms.filter(wasViewed).length;
    const signed = dealRooms.filter(d => d.status === DEAL_STATUS.ACCEPTED || d.status === DEAL_STATUS.SIGNED || d.status === DEAL_STATUS.SCHEDULED).length;
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
    // Pull server state so remote homeowner acceptances + deals from another
    // device appear and reflect their real status. Async; re-renders on return.
    hydrateFromFirestore();
    // Insurance toggle is bound inside render() (it reattaches on every paint,
    // surviving tab switches); the old one-shot setTimeout bind here fired
    // before the create form existed on the default 'active' tab and is removed.
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
    remove: confirmDeleteDeal,
    updateDeal,
    deleteDeal,
    getDeals: () => dealRooms,
    generatePageHTML: generateDealPageHTML
  };

})();
