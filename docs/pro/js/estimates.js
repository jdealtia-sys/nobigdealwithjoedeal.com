// ============================================================
// NBD Pro — estimates.js
// Inline estimate builder (original), calculations, tier pricing
// Extracted from dashboard.html for maintainability
// ============================================================
//
// ── PRICING MODEL (Estimate Builder v2, 2026-04-23) ──────────
// Per the locked site-wide spec, customer price = SQ × TIER_RATE
// plus itemized add-ons (permit, dump, extra tear-off layers,
// gutters, valley metal, etc). The previous cost-plus-markup
// sum-of-line-items model under-priced jobs by roughly $10K at
// Better tier — a 39-SQ Better job quoted $12,672 vs the correct
// $23,205 (39 × $595).
//
// The itemized line items produced by getLineItems() are retained
// but are now the internal cost basis used by the "Internal View"
// toggle to surface markup + margin; they no longer drive the
// customer-facing grand total.
const TIER_RATES = { good: 545, better: 595, best: 660 };
const JOB_MINIMUM_CENTS = 250000; // $2,500 — covers trip, dump, permit, mobilization
const ROUND_TO_CENTS = 2500;      // Nearest $25

// Ohio + Northern Kentucky county sales tax rates (2026-04). Insurance
// mode hides the line; Cash mode shows it and adds to total.
const COUNTY_TAX_RATES = {
  Hamilton: 0.0780, Butler: 0.0725, Warren: 0.0675, Clermont: 0.0725,
  Kenton:   0.0600, Boone:  0.0600, Campbell: 0.0600,
};
const DEFAULT_TAX_RATE = 0.0700; // fallback

// Permit cost by city. Values are editable at runtime via estData.permitCost
// override; these are the sensible defaults.
const PERMIT_COSTS = {
  Cincinnati: 175, Hamilton: 150, Fairfield: 140, Mason: 160,
  'West Chester': 165, Milford: 150, Loveland: 150,
  'Fort Thomas': 135, Covington: 140, Florence: 140, Newport: 135,
};
const DEFAULT_PERMIT_COST = 150;
const DEFAULT_DUMP_FEE    = 550; // flat, editable per-estimate
const LAYER_TEAROFF_PER_SQ_CENTS = 5000; // +$50/SQ per extra layer beyond the first
const CUT_UP_WASTE_BONUS = 0.03; // +3% waste when the "cut-up roof" box is checked

// All dollar math stays in cents internally to avoid float drift.
const _toCents   = (d) => Math.round(d * 100);
const _fromCents = (c) => c / 100;
const _roundUpTo = (cents, step) => Math.ceil(cents / step) * step;
const _applyJobMin = (cents) => Math.max(cents, JOB_MINIMUM_CENTS);
const _roundNearest25 = (cents) => Math.round(cents / ROUND_TO_CENTS) * ROUND_TO_CENTS;

// Default pricing table (Cincinnati/Ohio market fallback)
//
// UNIT CONVENTION: all SF-based items (shingle, felt, tear, iws, deck)
// are stored PER SQUARE (100 SF), not per SF. The calcTierPrices()
// formulas multiply by `sq` (the count of 100-SF squares), so these
// rates must be dollars per square. Historical bug: previously these
// were stored as per-SF ($4.25/SF for shingle) but the formula used
// squares, producing estimates ~30x below real market. Example of
// the fix impact: a 54-sq (3900 SF raw) Good-tier reroof was quoting
// $1,194 — now correctly quotes ~$12,000.
//
// LF items (starter, drip, ridge, hip, gutter) stay per LF.
// Count items (pipe) stay per EA.
const DEFAULT_RATES = {
  // SF-based materials — PER SQUARE (100 SF)
  shingle: 135,    // $/SQ — 30-yr architectural retail installed
  felt: 35,        // $/SQ — synthetic underlayment
  tear: 75,        // $/SQ — tear-off labor (1 layer)
  iws: 95,         // $/SQ — ice & water shield
  deck: 145,       // $/SQ — OSB decking material + labor
  // LF-based — PER LINEAR FOOT
  starter: 2.10,   // $/LF
  drip: 1.85,      // $/LF
  ridge: 5.50,     // $/LF ridge cap
  hip: 5.75,       // $/LF hip cap
  gutter: 8.50,    // $/LF seamless aluminum
  // Count-based
  pipe: 45.00,     // $/EA — pipe boot
  // Fractional
  deckPct: 0.15    // 15% deck allowance
};

// Product Library → Estimate Rate Mapping.
// Each entry says: "when syncRatesFromProductLibrary() runs, look up
// product.pricing[tier].sell and multiply by unitConvert to produce
// the value stored in window.R[key]."
//
// Product prices are native to their own units (per SQ for shingles,
// per 25-LF bundle for ridge, etc.). unitConvert bridges that to the
// rate unit required by the calcTierPrices formulas.
//
// For SF-based items the target unit is PER SQ (100 SF), matching
// the DEFAULT_RATES convention above. Previously these used 1/100
// to convert to per-SF, which produced rates the formula couldn't
// use correctly.
const PRODUCT_MAP = {
  shingle: { id: 'shingle_001', unitConvert: 1 },     // product per SQ → rate per SQ
  felt:    { id: 'under_001',   unitConvert: 1 },     // product per SQ → rate per SQ
  tear:    null,                                        // labor only — no product mapping
  starter: { id: 'flash_008',   unitConvert: 1/100 }, // product per 100-LF bundle → rate per LF
  drip:    { id: 'flash_003',   unitConvert: 1 },     // product per LF → rate per LF
  ridge:   { id: 'flash_007',   unitConvert: 1/25 },  // product per 25-LF bundle → rate per LF
  iws:     { id: 'under_006',   unitConvert: 1/2 },   // product per 2-SQ roll (200 SF) → rate per SQ
  hip:     { id: 'flash_007',   unitConvert: 1/25 },  // same as ridge
  pipe:    { id: 'flash_002',   unitConvert: 1 },     // product per EA → rate per EA
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
  const list    = document.getElementById('est-list');
  const builder = document.getElementById('est-builder');
  if (!builder) { console.warn('Estimate builder not in DOM'); return; }
  if (list)    list.style.display='none';
  builder.style.display='flex';
  builder.style.flexDirection='column';
  estCurrentStep=0; selectedTier=null; estData={};
  window._estLinkedLeadId = null;
  window._editingEstimateId = null;
  const titleEl = document.getElementById('estBuilderTitle');
  if (titleEl) titleEl.textContent = 'New Estimate';
  showEstStep(1);
  const note = document.getElementById('drawImportNote');
  if (note) note.style.display='none';
  ['estAddr','estOwner','estParcel','estYear','estRawSqft','estRidge','estEave','estHip'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const pipes = document.getElementById('estPipes');
  if (pipes) pipes.value='4';
  updateEstCalc();
}

function cancelEstimate() {
  const list    = document.getElementById('est-list');
  const builder = document.getElementById('est-builder');
  if (list)    list.style.display='block';
  if (builder) builder.style.display='none';
  window._editingEstimateId = null;
}

function showEstStep(n) {
  [1,2,3,4].forEach(i=>{
    const step = document.getElementById('estStep'+i);
    if (step) step.style.display=i===n?'block':'none';
    const sEl=document.getElementById('estS'+i);
    if (sEl) sEl.className='est-step'+(i<n?' done':i===n?' active':'');
  });
  estCurrentStep=n;
}

function estNext(from) {
  if(from===1){
    const rawEl = document.getElementById('estRawSqft');
    const rawVal = rawEl ? parseFloat(rawEl.value) : NaN;
    if(!rawVal || rawVal <= 0 || isNaN(rawVal)){showToast('Enter a valid square footage (greater than 0)','error');return;}
    if(rawVal > 100000){showToast('Square footage seems too high — please double-check','error');return;}
    updateEstCalc(); showEstStep(2);
  } else if(from===2){
    const ridge=parseFloat(document.getElementById('estRidge')?.value)||0;
    const eave=parseFloat(document.getElementById('estEave')?.value)||0;
    if(ridge < 0 || eave < 0){showToast('Measurements cannot be negative','error');return;}
    updateEstCalc(); calcTierPrices(); showEstStep(3);
  } else if(from===3){
    if(!selectedTier){showToast('Select a tier/package','error');return;}
    if(!estData.prices||!estData.prices.good){showToast('Calculate pricing first','error');return;}
    buildReview(); showEstStep(4);
  }
}
function estBack(from){ showEstStep(from-1); }

// Map pitch → recommended waste factor. Steeper roofs lose more material
// to cuts; this mirrors the IKO/Owens-Corning shingle waste tables and
// is what every experienced estimator does in their head. The "cut-up
// roof" checkbox adds another +3% per spec for dormers/valleys/etc.
function recommendedWasteForPitch(pitchFactor) {
  if (pitchFactor <= 1.054) return 1.10;  // 4/12 and below
  if (pitchFactor <= 1.118) return 1.12;  // 5/12 – 6/12
  if (pitchFactor <= 1.202) return 1.15;  // 7/12 – 8/12
  if (pitchFactor <= 1.302) return 1.18;  // 9/12 – 10/12
  return 1.22;                            // 11/12+
}

function updateEstCalc() {
  const raw = Math.max(0, parseFloat(document.getElementById('estRawSqft')?.value) || 0);
  const pitchVal = document.getElementById('estPitch')?.value || '1.202|8/12';
  const [pf, pl] = pitchVal.split('|');
  const pfNum = parseFloat(pf);
  const cutUp = !!document.getElementById('estCutUp')?.checked;
  // Waste factor: user override takes precedence, else auto-derive from
  // pitch and layer the +3% cut-up bonus on top.
  const manual = parseFloat(document.getElementById('estWaste')?.value);
  const auto = recommendedWasteForPitch(pfNum) + (cutUp ? CUT_UP_WASTE_BONUS : 0);
  const wf = Math.max(1, manual > 0 ? manual + (cutUp ? CUT_UP_WASTE_BONUS : 0) : auto);
  const adj = raw * pfNum * wf;
  const sq = adj / 100;
  const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  el('ec-raw',   raw + ' sf');
  el('ec-pitch', pfNum.toFixed(4) + '×');
  el('ec-waste', wf.toFixed(3) + '×' + (cutUp ? ' (cut-up +3%)' : ''));
  el('ec-adj',   Math.round(adj) + ' sf');
  el('ec-sq',    sq.toFixed(2) + ' sq');
  estData.raw = raw; estData.pf = pfNum; estData.pl = pl || '8/12';
  estData.wf = wf; estData.adj = adj; estData.sq = sq; estData.cutUp = cutUp;
}

// Gather the user-selectable add-ons from step 2/3 DOM + estData overrides.
// Returns a detailed cents breakdown so buildReview() can render each line.
function collectAddOns() {
  const d = estData;
  const eave = Math.max(0, parseFloat(document.getElementById('estEave')?.value) || 0);
  const pipes = Math.max(0, parseInt(document.getElementById('estPipes')?.value) || 0);
  const sq = d.sq || 0;
  const tearOffLayers = Math.max(1, parseInt(document.getElementById('estTearOff')?.value) || 1);
  const valley = document.getElementById('estValley')?.checked;
  const chimney = document.getElementById('estChimney')?.checked;
  const skylight = document.getElementById('estSkylight')?.checked;
  const gutterLF = Math.max(0, parseFloat(document.getElementById('estGutterLF')?.value) || 0);

  // Permit: user override > city-derived > fallback. Gets set any time
  // the user picks a city from the selector.
  const cityEl = document.getElementById('estCity');
  const city = cityEl ? cityEl.value : '';
  const permitDollars = d.permitCost != null ? d.permitCost
                       : city         ? lookupPermitCost(city)
                       : DEFAULT_PERMIT_COST;
  const permitCents = _toCents(permitDollars);
  const dumpCents   = _toCents(d.dumpFee != null ? d.dumpFee : DEFAULT_DUMP_FEE);
  const extraLayers = Math.max(0, tearOffLayers - 1);
  const extraLayerCents = extraLayers * sq * LAYER_TEAROFF_PER_SQ_CENTS;
  const valleyCents   = valley   ? _toCents(Math.max(0, eave * 0.25 * 12)) : 0; // ~$12/LF rough
  const chimneyCents  = chimney  ? _toCents(425) : 0;
  const skylightCents = skylight ? _toCents(275) : 0;
  const gutterCents   = _toCents(gutterLF * 8.50);
  // Extra pipe boots beyond 4 are a spec-called-out add-on; use R.pipe
  // to keep parity with the product library's pricing.
  const extraPipes = Math.max(0, pipes - 4);
  const extraPipeCents = _toCents(extraPipes * (window.R?.pipe || 45));

  return {
    permitCents, dumpCents, extraLayerCents, valleyCents, chimneyCents,
    skylightCents, gutterCents, extraPipeCents,
    tearOffLayers, extraLayers, gutterLF, hasValley: !!valley,
    hasChimney: !!chimney, hasSkylight: !!skylight, extraPipes,
    totalCents: permitCents + dumpCents + extraLayerCents + valleyCents
              + chimneyCents + skylightCents + gutterCents + extraPipeCents
  };
}

// Look up the sales tax rate for a given county. Unknown counties fall
// back to 7% (reasonable average across the Tri-State). Insurance mode
// returns 0 regardless — per spec the adjuster's ACV/RCV covers tax.
function lookupTaxRate(county, mode) {
  if (mode === 'insurance') return 0;
  if (!county) return DEFAULT_TAX_RATE;
  return COUNTY_TAX_RATES[county] != null ? COUNTY_TAX_RATES[county] : DEFAULT_TAX_RATE;
}

function lookupPermitCost(city) {
  if (!city) return DEFAULT_PERMIT_COST;
  return PERMIT_COSTS[city] != null ? PERMIT_COSTS[city] : DEFAULT_PERMIT_COST;
}

// EBv2 price: flat per-SQ tier rate × squares + add-ons + tax.
// Enforces the $2,500 job minimum and rounds to the nearest $25.
// All intermediate math is in cents so we don't accrue float drift
// before rounding. Tax is applied to (base + add-ons) then added.
function calcEstimateTotalCents(sq, tier, addOns, opts) {
  opts = opts || {};
  const rate = TIER_RATES[tier] || TIER_RATES.better;
  const baseCents = _toCents(sq * rate);
  const addOnsCents = (addOns && addOns.totalCents) || 0;
  const subtotalCents = baseCents + addOnsCents;
  const taxRate = opts.taxRate != null ? opts.taxRate : 0;
  const taxCents = Math.round(subtotalCents * taxRate);
  const preRound = _applyJobMin(subtotalCents + taxCents);
  return _roundNearest25(preRound);
}

function calcTierPrices() {
  // Re-sync rates from product library each time tiers are recalculated —
  // needed for the internal cost basis, not the customer price.
  syncRatesFromProductLibrary(selectedTier || 'better');
  updateEstCalc();
  const sq = estData.sq || 0;
  const ridge = Math.max(0, parseFloat(document.getElementById('estRidge')?.value) || 0);
  const eave  = Math.max(0, parseFloat(document.getElementById('estEave')?.value) || 0);
  const hip   = Math.max(0, parseFloat(document.getElementById('estHip')?.value) || 0);
  const pipes = Math.max(0, parseInt(document.getElementById('estPipes')?.value) || 0);
  const deckSq = sq * R.deckPct;
  const iwsSq = Math.max(1, Math.ceil((eave * 6) / 100));

  const addOns = collectAddOns();

  // Mode: Insurance (carrier covers tax via ACV/RCV) vs Cash (show tax
  // at county rate). Default Cash so unconfigured estimates are
  // conservative — never quote a customer a missing-tax price.
  const mode = document.getElementById('estMode')?.value || 'cash';
  const county = document.getElementById('estCounty')?.value || '';
  const taxRate = lookupTaxRate(county, mode);
  estData.mode = mode; estData.county = county; estData.taxRate = taxRate;

  const goodCents   = calcEstimateTotalCents(sq, 'good',   addOns, { taxRate });
  const betterCents = calcEstimateTotalCents(sq, 'better', addOns, { taxRate });
  const bestCents   = calcEstimateTotalCents(sq, 'best',   addOns, { taxRate });

  // Capture pre-tax subtotal + tax amount for the selected tier so
  // buildReview() can render the tax line without recomputing.
  if (selectedTier) {
    const rate = TIER_RATES[selectedTier];
    const baseCents = _toCents(sq * rate);
    const subtotalCents = baseCents + (addOns.totalCents || 0);
    estData.subtotal = _fromCents(subtotalCents);
    estData.taxAmount = _fromCents(Math.round(subtotalCents * taxRate));
  }

  estData.ridge = ridge; estData.eave = eave; estData.hip = hip; estData.pipes = pipes;
  estData.deckSq = deckSq; estData.iwsSq = iwsSq;
  estData.addOns = addOns;
  estData.prices = {
    good:   _fromCents(goodCents),
    better: _fromCents(betterCents),
    best:   _fromCents(bestCents)
  };

  const setPrice = (id, cents) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = '$' + _fromCents(cents).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  };
  setPrice('price-good',   goodCents);
  setPrice('price-better', betterCents);
  setPrice('price-best',   bestCents);
}

function selectTier(tier,el) {
  document.querySelectorAll('.tier-card').forEach(c=>c.classList.remove('selected'));
  if (el && el.classList) el.classList.add('selected');
  selectedTier=tier;
  const btn=document.getElementById('estStep3Next');
  if (btn) { btn.disabled=false; btn.style.opacity='1'; }
}

function getProductName(mapKey, fallback) {
  if (!window._productLib || !PRODUCT_MAP[mapKey]) return fallback;
  const products = window._productLib.getProducts();
  const p = products.find(pr => pr.id === PRODUCT_MAP[mapKey].id);
  return p ? p.name : fallback;
}

// Customer-facing line items. Under EBv2 the top line is the flat
// per-SQ tier driver; add-ons append below. The internal cost-basis
// breakdown (shingle/felt/ridge/etc.) is available via
// getInternalCostBasis() and is surfaced only in the "Internal View"
// toggle, not on the customer estimate.
function getLineItems() {
  syncRatesFromProductLibrary(selectedTier || 'better');
  const d = estData;
  const sq = d.sq || 0;
  const tier = selectedTier || 'better';
  const addOns = d.addOns || collectAddOns();
  const rate = TIER_RATES[tier];
  const tierLabel = { good: 'Good — Standard Reroof', better: 'Better — Reroof Plus', best: 'Best — Full Redeck' }[tier] || tier;

  const rows = [];
  rows.push({
    code: 'RFG SYS',
    desc: tierLabel + ' · turnkey per-square price',
    qty:  sq.toFixed(2) + ' SQ',
    rate: '$' + rate + '/SQ',
    total: sq * rate
  });
  if (addOns.permitCents)    rows.push({ code: 'PERMIT', desc: 'Local building permit',                           qty: '1 EA', rate: '', total: _fromCents(addOns.permitCents) });
  if (addOns.dumpCents)      rows.push({ code: 'DUMP',   desc: 'Dump / disposal fee',                              qty: '1 EA', rate: '', total: _fromCents(addOns.dumpCents) });
  if (addOns.extraLayers)    rows.push({ code: 'TEAR+',  desc: 'Extra tear-off layer(s) — ' + addOns.extraLayers + '×',
                                         qty: sq.toFixed(2) + ' SQ', rate: '$50/SQ', total: _fromCents(addOns.extraLayerCents) });
  if (addOns.hasValley)      rows.push({ code: 'VALLEY', desc: 'Valley metal flashing',                            qty: 'set', rate: '', total: _fromCents(addOns.valleyCents) });
  if (addOns.hasChimney)     rows.push({ code: 'CHIM',   desc: 'Chimney flashing kit',                             qty: '1 EA', rate: '', total: _fromCents(addOns.chimneyCents) });
  if (addOns.hasSkylight)    rows.push({ code: 'SKY',    desc: 'Skylight flashing kit',                            qty: '1 EA', rate: '', total: _fromCents(addOns.skylightCents) });
  if (addOns.gutterLF)       rows.push({ code: 'GUTTER', desc: 'Seamless aluminum gutters (6")',                   qty: addOns.gutterLF + ' LF', rate: '$8.50/LF', total: _fromCents(addOns.gutterCents) });
  if (addOns.extraPipes)     rows.push({ code: 'PIPE+',  desc: 'Extra pipe boots beyond 4',                        qty: addOns.extraPipes + ' EA', rate: '', total: _fromCents(addOns.extraPipeCents) });

  return rows;
}

// Internal cost basis — what the job actually costs us in materials +
// labor. Used by the Internal View toggle to show markup + margin.
// NOT shown to customers. Sum of per-item rates × quantities from the
// product library, same math the old builder used for customer price.
function getInternalCostBasis() {
  syncRatesFromProductLibrary(selectedTier || 'better');
  const d = estData;
  const sq = d.sq || 0;
  const ridge = d.ridge || 0, eave = d.eave || 0, hip = d.hip || 0, pipes = d.pipes || 0;
  const deckSq = d.deckSq || 0;
  const iwsSq = d.iwsSq || 0;
  const tier = selectedTier || 'better';

  const good = sq * R.shingle + sq * R.felt + sq * R.tear + eave * R.starter + eave * R.drip + ridge * R.ridge;
  const better = good + iwsSq * R.iws + pipes * R.pipe + hip * R.hip + deckSq * R.deck;
  const best = better + sq * R.deck + eave * R.gutter;
  const byTier = { good, better, best };
  return byTier[tier] || better;
}

function buildReview() {
  updateEstCalc();
  calcTierPrices();  // ensure addOns + prices are fresh before locking the total
  const d = estData;
  const val = (id) => document.getElementById(id)?.value || '—';
  const addr = val('estAddr');
  const owner = val('estOwner');
  const parcel = val('estParcel');
  const yr = val('estYear');
  const roofType = val('estRoofType');
  const tierNames = { 'good': 'Standard Reroof', 'better': 'Reroof Plus', 'best': 'Full Redeck' };
  const rows = getLineItems();
  // Grand total is the LOCKED tier price from calcTierPrices(), NOT the
  // sum of display line items. This matters because the individual rows
  // render as whole dollars while the underlying math carries cents —
  // summing the rounded display values would reintroduce drift.
  const tierCents = _toCents(d.prices?.[selectedTier] || 0);
  const grandTotal = _fromCents(tierCents);
  estData.grandTotal = grandTotal;
  estData.addr = addr; estData.owner = owner; estData.parcel = parcel; estData.yr = yr; estData.roofType = roofType;
  estData.tierName = tierNames[selectedTier]; estData.rows = rows;

  // Internal margin for the optional Internal View toggle. Not rendered
  // unless the user clicks through to it — customer-facing review stays
  // clean.
  const costBasis = getInternalCostBasis();
  const margin = grandTotal - costBasis;
  const marginPct = grandTotal > 0 ? (margin / grandTotal) * 100 : 0;
  estData.costBasis = costBasis; estData.margin = margin; estData.marginPct = marginPct;

  const fmt=n=>'$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  // Escape every interpolated user-typed value. The classic review
  // step was previously dropping addr/owner/parcel/yr/roofType + row
  // descriptions straight into innerHTML, meaning any user who typed
  // HTML into an address would get it rendered on the review page
  // (self-XSS if they paste a malicious address from elsewhere).
  // The esc() helper here runs locally so this file has no external
  // dependency on dom-safe.js even if script load order shifts.
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const reviewEl = document.getElementById('estReviewBody');
  if (!reviewEl) return;
  const marginSafeClass = marginPct >= 35 ? 'margin-strong'
                        : marginPct >= 20 ? 'margin-ok'
                        : 'margin-weak';
  const internalViewHtml = `
    <div id="internalViewPanel" style="display:none;margin-top:16px;padding:12px;background:var(--s2);border:1px dashed var(--orange);border-radius:7px;font-size:11px;">
      <div style="font-weight:700;color:var(--orange);margin-bottom:8px;">Internal View — NOT FOR CUSTOMER</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
        <div><div style="color:var(--m);">Customer Price</div><div style="font-weight:700;">${fmt(grandTotal)}</div></div>
        <div><div style="color:var(--m);">Cost Basis</div><div style="font-weight:700;">${fmt(costBasis)}</div></div>
        <div><div style="color:var(--m);">Margin</div><div class="${marginSafeClass}" style="font-weight:700;">${fmt(margin)} · ${marginPct.toFixed(1)}%</div></div>
      </div>
    </div>`;
  reviewEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;">
      <div>
        <div style="font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--m);margin-bottom:4px;">Property</div>
        <div style="font-size:14px;font-weight:600;color:var(--blue);">${esc(addr)}</div>
        <div style="font-size:12px;color:var(--m);">${esc(owner)} · Parcel: ${esc(parcel)} · Built: ${esc(yr)}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--m);">Estimate Total</div>
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:700;color:var(--orange);">${fmt(grandTotal)}</div>
        <div style="font-size:11px;color:var(--m);">${esc(tierNames[selectedTier])}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;font-size:11px;">
      <div style="background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:10px;"><div style="color:var(--m);margin-bottom:3px;">Roof Type</div><div style="font-weight:700;">${esc(roofType)}</div></div>
      <div style="background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:10px;"><div style="color:var(--m);margin-bottom:3px;">Pitch</div><div style="font-weight:700;">${esc(d.pl)}</div></div>
      <div style="background:var(--s2);border:1px solid var(--br);border-radius:7px;padding:10px;"><div style="color:var(--m);margin-bottom:3px;">Squares</div><div style="font-weight:700;">${d.sq.toFixed(2)} SQ</div></div>
    </div>
    <table class="li-table">
      <thead><tr><th>Code</th><th>Description</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead>
      <tbody>
        ${rows.map(r=>`<tr><td class="code">${esc(r.code)}</td><td>${esc(r.desc)}</td><td>${esc(r.qty)}</td><td>${esc(r.rate)}</td><td><strong>${fmt(r.total)}</strong></td></tr>`).join('')}
        ${(d.mode === 'cash' && d.taxAmount > 0) ? `
        <tr><td class="code">TAX</td><td>Sales tax${d.county ? ' — ' + esc(d.county) + ' County' : ''} (${((d.taxRate||0)*100).toFixed(2)}%)</td><td></td><td></td><td><strong>${fmt(d.taxAmount)}</strong></td></tr>
        ` : ''}
        ${(d.mode === 'insurance') ? `
        <tr><td class="code" style="color:var(--blue);">INS</td><td colspan="3" style="color:var(--m);font-style:italic;">Insurance mode — tax covered by adjuster (ACV/RCV)</td><td></td></tr>
        ` : ''}
        <tr class="total-row grand"><td colspan="4"><strong>ESTIMATE TOTAL</strong></td><td><strong>${fmt(grandTotal)}</strong></td></tr>
      </tbody>
    </table>
    <div style="margin-top:10px;display:flex;justify-content:flex-end;">
      <button type="button" class="btn btn-ghost" style="font-size:10px;padding:4px 10px;" onclick="toggleInternalView()">🔒 Internal View</button>
    </div>
    ${internalViewHtml}`;
}

// Toggle the margin / cost-basis panel on the review step. Kept on
// window so the onclick handler in the review HTML can find it.
window.toggleInternalView = function toggleInternalView() {
  const el = document.getElementById('internalViewPanel');
  if (!el) return;
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
};

// ── Presets ────────────────────────────────────────────────
// Pre-wired configurations for the most common job types. Each preset
// sets a sensible default tier + add-ons + mode so the rep only has
// to drop in measurements. Everything is still user-overridable.
const ESTIMATE_PRESETS = {
  standard: {
    label: 'Standard Reroof',
    tier: 'better',   mode: 'cash',
    tearOff: 1,       cutUp: false,
    addOns: { valley: false, chimney: false, skylight: false, gutterLF: 0 }
  },
  storm: {
    label: 'Storm Claim',
    tier: 'better',   mode: 'insurance',
    tearOff: 1,       cutUp: true,
    addOns: { valley: true, chimney: true, skylight: false, gutterLF: 0 }
  },
  repair: {
    label: 'Small Repair',
    tier: 'good',     mode: 'cash',
    tearOff: 1,       cutUp: false,
    addOns: { valley: false, chimney: false, skylight: false, gutterLF: 0 }
  },
  redeck: {
    label: 'Full Redeck',
    tier: 'best',     mode: 'cash',
    tearOff: 1,       cutUp: false,
    addOns: { valley: true, chimney: false, skylight: false, gutterLF: 0 }
  },
  hail: {
    label: 'Hail Damage Insurance',
    tier: 'better',   mode: 'insurance',
    tearOff: 1,       cutUp: true,
    addOns: { valley: false, chimney: false, skylight: false, gutterLF: 0 }
  }
};

window.applyEstimatePreset = function applyEstimatePreset(key) {
  const p = ESTIMATE_PRESETS[key];
  if (!p) return;
  const set = (id, val) => { const el = document.getElementById(id); if (el) { el.value = val; } };
  const check = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
  set('estMode',    p.mode);
  set('estTearOff', String(p.tearOff));
  check('estCutUp', p.cutUp);
  check('estValley',   p.addOns.valley);
  check('estChimney',  p.addOns.chimney);
  check('estSkylight', p.addOns.skylight);
  set('estGutterLF', p.addOns.gutterLF || '');
  // Auto-select the tier card so the rep sees the price immediately.
  if (typeof selectTier === 'function') {
    const card = document.querySelector('.tier-card[onclick*="' + p.tier + '"]');
    selectTier(p.tier, card || null);
  }
  updateEstCalc();
  if (typeof calcTierPrices === 'function') calcTierPrices();
  if (typeof showToast === 'function') showToast('Applied preset: ' + p.label, 'info');
};

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

  // Estimate name: use whatever was typed, else fall back to the
  // address + tier so the list row is still recognizable. Never
  // blank — every saved estimate should be easy to identify later
  // even if it was never formally named or assigned.
  const existingName = (estData.name || '').trim();
  const fallbackName = (estData.addr ? estData.addr.trim() : '')
    || (estData.owner ? estData.owner.trim() + ' estimate' : '')
    || ('Untitled estimate ' + new Date().toLocaleDateString());
  const estName = existingName || fallbackName;

  try {
    await window._saveEstimate({
      name: estName,
      builder: 'classic',
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
  // Escape every user-typed interpolation. This HTML is written to
  // a brand-new window via document.write — if any field contains
  // </script> or <img onerror> we'd execute attacker code in the
  // new window's origin (same-origin, so it could read cookies and
  // Firebase tokens). Every d.* and r.* interpolation below must
  // run through esc() with the single exception of numeric values
  // like fmt(d.grandTotal) and d.sq.toFixed() which are always
  // pure numbers out of parseFloat.
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>NBD Roofing Estimate — ${esc(d.addr)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
  <style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Barlow',sans-serif;padding:36px;max-width:860px;margin:0 auto;}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:3px solid var(--orange);margin-bottom:26px;}
  .brand{font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;}
  .brand span{color:var(--orange);}.sub{font-size:13px;color:#666;margin-top:2px;}.badge{font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--orange);border:1px solid var(--orange);padding:2px 9px;border-radius:2px;display:inline-block;margin-top:5px;}
  .est-hdr{text-align:right;}.est-type{font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:#111;}
  .est-date{font-size:12px;color:#666;}.est-by{font-size:12px;color:#666;}
  .est-total-lbl{font-size:9px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:var(--orange);margin-top:10px;}
  .est-total-val{font-family:'Barlow Condensed',sans-serif;font-size:38px;font-weight:800;color:var(--orange);}
  h2{font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.18em;color:#111;margin:22px 0 12px;padding-bottom:4px;border-bottom:2px solid var(--orange);}
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
  .code{color:var(--orange);font-weight:700;font-family:'Barlow Condensed',sans-serif;font-size:13px;}
  .total-cell{font-weight:700;color:#111;}
  .grand-row td{font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;color:var(--orange);border-top:3px solid #111;background:#fff8f5;padding:12px 10px;}
  .footer{margin-top:32px;padding-top:14px;border-top:1px solid #eee;display:flex;justify-content:space-between;font-size:10px;color:#999;}
  @media print{body{padding:20px;}@page{margin:1.5cm;size:letter;}}
  </style></head><body>
  <div class="hdr">
    <div><div class="brand">No Big <span>Deal</span></div><div class="sub">Home Solutions</div><div class="badge">Insurance Restoration</div></div>
    <div class="est-hdr"><div class="est-type">${esc(tierNames[selectedTier]||'Estimate')}</div><div class="est-date">${esc(dateStr)}</div>
      <div class="est-total-lbl">Estimate Total</div><div class="est-total-val">${fmt(d.grandTotal)}</div></div>
  </div>
  <h2>Property Information</h2>
  <div class="prop-grid">
    <div class="prop-field"><label>Address</label><div class="v">${esc(d.addr||'—')}</div></div>
    <div class="prop-field"><label>Owner</label><div class="v">${esc(d.owner||'—')}</div></div>
    <div class="prop-field"><label>Parcel</label><div class="v">${esc(d.parcel||'—')}</div></div>
    <div class="prop-field"><label>Year Built</label><div class="v">${esc(d.yr||'—')}</div></div>
  </div>
  <h2>Measurements</h2>
  <div class="meas-grid">
    <div class="mf"><label>Pitch</label><div class="v">${esc(d.pl||'—')}</div></div>
    <div class="mf"><label>Squares</label><div class="v">${d.sq?d.sq.toFixed(2):'—'} SQ</div></div>
    <div class="mf"><label>Roof Type</label><div class="v">${esc(d.roofType||'—')}</div></div>
  </div>
  <h2>Line Items</h2>
  <table>
    <thead><tr><th>Code</th><th>Description</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead>
    <tbody>
      ${rows.map(r=>'<tr><td class="code">'+esc(r.code)+'</td><td>'+esc(r.desc)+'</td><td>'+esc(r.qty)+'</td><td>'+esc(r.rate)+'</td><td class="total-cell">'+fmt(r.total)+'</td></tr>').join('')}
      <tr class="grand-row"><td colspan="4"><strong>ESTIMATE TOTAL</strong></td><td><strong>${fmt(d.grandTotal)}</strong></td></tr>
    </tbody>
  </table>
  <div class="footer"><span>No Big Deal Home Solutions — Greater Cincinnati</span><span>Generated by NBD Pro</span></div>
  </body></html>`;
  // Route through the Universal Document Viewer so the user gets
  // Save to Customer / Email / Print / Download PDF / Close action
  // bar instead of being dumped into a blank popup with no way back.
  if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
    const addrSlug = (d.addr || 'Estimate').replace(/[^A-Za-z0-9]+/g, '-').substring(0, 40);
    const tierLabel = tierNames[selectedTier] || 'Estimate';
    window.NBDDocViewer.open({
      html: html,
      title: tierLabel + (d.addr ? ' — ' + d.addr : ''),
      filename: 'NBD-' + addrSlug + '-' + new Date().toISOString().split('T')[0] + '.pdf',
      onSave: async () => {
        // Route the doc viewer's "Save to Customer" button to the
        // same Firestore write the classic builder's Save uses.
        if (typeof window.saveEstimate === 'function') {
          await window.saveEstimate();
        }
      }
    });
    return;
  }
  // Fallback: legacy popup if the viewer isn't loaded
  const w = window.open('','_blank');
  if(w){ w.document.write(html); w.document.close(); }
  else { showToast('Pop-up blocked — allow pop-ups for this site','error'); }
}

// Real estimate-type chooser modal. Fires when the user clicks
// "New Estimate" from anywhere — the CRM toolbar, the home widget,
// the customer page, etc. Instead of silently dropping them into
// the classic v1 builder, this shows both options so they can pick
// the right tool for the job.
//
// DOM is built with createElement (not innerHTML) so this is safe
// under the Report-Only CSP (`script-src-attr 'none'`) and there's
// no way a malicious theme variable or catalog name could inject.
function showEstimateTypeSelector() {
  // Reuse an existing modal if it's still in the DOM (fast re-open).
  let overlay = document.getElementById('est-type-chooser');
  if (overlay) {
    overlay.style.display = 'flex';
    return;
  }

  overlay = document.createElement('div');
  overlay.id = 'est-type-chooser';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;'
    + 'background:rgba(0,0,0,.75);'
    + 'display:flex;align-items:center;justify-content:center;'
    + 'padding:20px;';

  const sheet = document.createElement('div');
  sheet.style.cssText = 'background:var(--s, #1a1d23);border:1px solid var(--br, #2a2d35);'
    + 'border-radius:12px;padding:28px;max-width:680px;width:100%;'
    + 'box-shadow:0 20px 60px rgba(0,0,0,.5);';

  const hdr = document.createElement('div');
  hdr.style.cssText = 'margin-bottom:20px;';
  const hdrTitle = document.createElement('div');
  hdrTitle.style.cssText = "font-family:'Barlow Condensed',sans-serif;font-size:22px;"
    + 'font-weight:800;color:var(--t, #fff);text-transform:uppercase;letter-spacing:.05em;';
  hdrTitle.textContent = 'New Estimate';
  const hdrSub = document.createElement('div');
  hdrSub.style.cssText = 'font-size:12px;color:var(--m, #888);margin-top:4px;';
  hdrSub.textContent = 'Choose which builder to start with.';
  hdr.appendChild(hdrTitle);
  hdr.appendChild(hdrSub);
  sheet.appendChild(hdr);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:14px;';

  const makeCard = (opts) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.style.cssText = 'text-align:left;background:var(--s2, #22252c);'
      + 'border:2px solid var(--br, #2a2d35);border-radius:10px;'
      + 'padding:20px;cursor:pointer;font-family:inherit;color:var(--t, #fff);'
      + 'transition:border-color .15s, transform .12s;';
    card.addEventListener('mouseenter', () => { card.style.borderColor = 'var(--orange)'; });
    card.addEventListener('mouseleave', () => { card.style.borderColor = 'var(--br, #2a2d35)'; });
    card.addEventListener('click', () => {
      overlay.style.display = 'none';
      opts.onClick();
    });

    const badge = document.createElement('div');
    badge.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:.12em;'
      + 'text-transform:uppercase;color:' + opts.badgeColor + ';margin-bottom:8px;';
    badge.textContent = opts.badge;
    card.appendChild(badge);

    const name = document.createElement('div');
    name.style.cssText = "font-family:'Barlow Condensed',sans-serif;font-size:20px;"
      + 'font-weight:800;color:var(--t, #fff);text-transform:uppercase;'
      + 'letter-spacing:.04em;margin-bottom:6px;';
    name.textContent = opts.name;
    card.appendChild(name);

    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:var(--m, #888);line-height:1.55;margin-bottom:12px;';
    desc.textContent = opts.desc;
    card.appendChild(desc);

    const list = document.createElement('ul');
    list.style.cssText = 'font-size:11px;color:var(--m, #888);line-height:1.8;padding-left:16px;margin:0;';
    (opts.features || []).forEach(f => {
      const li = document.createElement('li');
      li.textContent = f;
      list.appendChild(li);
    });
    card.appendChild(list);

    return card;
  };

  grid.appendChild(makeCard({
    badge: 'Classic — Tiers',
    badgeColor: '#60a5fa',
    name: 'Classic Builder',
    desc: '4-step walkthrough with Good / Better / Best package tiers. Fast for standard reroofs.',
    features: [
      '4-step wizard (Measure, Pitch, Package, Review)',
      'Good / Better / Best pricing tiers',
      'Product library sync',
      'Quick Measure PDF import'
    ],
    onClick: () => { if (typeof startNewEstimateOriginal === 'function') startNewEstimateOriginal(); }
  }));

  grid.appendChild(makeCard({
    badge: 'V2 Beta — Line-Item',
    badgeColor: 'var(--orange)',
    name: 'V2 Builder',
    desc: '270-line Xactimate-style catalog with presets, per-item qty overrides, and 3 output formats.',
    features: [
      '6 job presets incl. Small Repair & Shingle Patch',
      'Measurement auto-scale per preset',
      'Per-item manual qty override (pencil icon)',
      '3 outputs: Insurance / Retail / Internal'
    ],
    onClick: () => { if (typeof window.openEstimateV2Builder === 'function') window.openEstimateV2Builder(); }
  }));

  sheet.appendChild(grid);

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:flex-end;margin-top:20px;';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'background:none;border:1px solid var(--br, #2a2d35);'
    + 'color:var(--m, #888);padding:10px 20px;border-radius:6px;cursor:pointer;'
    + "font-family:'Barlow Condensed',sans-serif;font-size:12px;"
    + 'font-weight:700;letter-spacing:.08em;text-transform:uppercase;';
  cancelBtn.addEventListener('click', () => { overlay.style.display = 'none'; });
  footer.appendChild(cancelBtn);
  sheet.appendChild(footer);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  // Click outside to close
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.style.display = 'none';
  });
  // Esc to close
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      overlay.style.display = 'none';
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

// ══════════════════════════════════════════════════════════════
// Estimates list row actions — duplicate / rename / assign / delete
// Called from the delegated click handler in renderEstimatesList
// (dashboard.html). Each one reads window._estimates, mutates via
// the window._* Firestore helpers, and the list re-renders because
// loadEstimates() is called inside those helpers.
// ══════════════════════════════════════════════════════════════

async function duplicateEstimateAction(id) {
  if (typeof window._duplicateEstimate !== 'function') {
    showToast('Duplicate not available — reload the page', 'error');
    return;
  }
  const src = (window._estimates || []).find(e => e.id === id);
  if (!src) { showToast('Estimate not found', 'error'); return; }
  const newId = await window._duplicateEstimate(id);
  if (newId) showToast('\u2713 Estimate duplicated', 'success');
  else showToast('Failed to duplicate', 'error');
}

async function renameEstimateAction(id) {
  const src = (window._estimates || []).find(e => e.id === id);
  if (!src) { showToast('Estimate not found', 'error'); return; }
  const current = src.name || src.addr || '';
  // eslint-disable-next-line no-alert
  const next = window.prompt('Rename estimate:', current);
  if (next === null) return;  // user hit Cancel
  const trimmed = String(next).trim();
  if (!trimmed) { showToast('Name cannot be empty', 'error'); return; }
  if (typeof window._renameEstimate !== 'function') {
    showToast('Rename not available', 'error');
    return;
  }
  const ok = await window._renameEstimate(id, trimmed);
  if (ok) showToast('\u2713 Renamed', 'success');
  else showToast('Failed to rename', 'error');
}

async function assignEstimateAction(id) {
  const src = (window._estimates || []).find(e => e.id === id);
  if (!src) { showToast('Estimate not found', 'error'); return; }
  const leads = window._leads || [];
  if (!leads.length) {
    showToast('No customers available — add a lead first', 'error');
    return;
  }
  // Show picker modal
  showAssignLeadPicker(id, src);
}

async function deleteEstimateAction(id) {
  const src = (window._estimates || []).find(e => e.id === id);
  if (!src) { showToast('Estimate not found', 'error'); return; }
  const label = src.name || src.addr || 'this estimate';
  // eslint-disable-next-line no-alert
  if (!window.confirm('Delete "' + label + '"? This cannot be undone.')) return;
  if (typeof window._deleteEstimate !== 'function') {
    showToast('Delete not available', 'error');
    return;
  }
  const ok = await window._deleteEstimate(id);
  if (ok) showToast('\u2713 Estimate deleted', 'success');
  else showToast('Failed to delete', 'error');
}

// Lead picker modal for the Assign action. Built via createElement
// (no innerHTML string interpolation) so user-generated lead names
// can never smuggle markup into the page.
function showAssignLeadPicker(estimateId, estimate) {
  const leads = window._leads || [];
  // Reuse existing overlay if present
  let overlay = document.getElementById('assign-lead-picker');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'assign-lead-picker';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:9998;'
    + 'background:rgba(0,0,0,.75);display:flex;align-items:center;'
    + 'justify-content:center;padding:20px;';

  const sheet = document.createElement('div');
  sheet.style.cssText = 'background:var(--s, #1a1d23);border:1px solid var(--br, #2a2d35);'
    + 'border-radius:12px;padding:24px;max-width:500px;width:100%;'
    + 'max-height:80vh;display:flex;flex-direction:column;'
    + 'box-shadow:0 20px 60px rgba(0,0,0,.5);';

  const hdr = document.createElement('div');
  hdr.style.cssText = 'margin-bottom:14px;';
  const hdrTitle = document.createElement('div');
  hdrTitle.style.cssText = "font-family:'Barlow Condensed',sans-serif;font-size:18px;"
    + 'font-weight:800;color:var(--t, #fff);text-transform:uppercase;letter-spacing:.04em;';
  hdrTitle.textContent = 'Assign to Customer';
  const hdrSub = document.createElement('div');
  hdrSub.style.cssText = 'font-size:11px;color:var(--m, #888);margin-top:4px;';
  hdrSub.textContent = (estimate.name || estimate.addr || 'Untitled estimate');
  hdr.appendChild(hdrTitle);
  hdr.appendChild(hdrSub);
  sheet.appendChild(hdr);

  // Search box
  const search = document.createElement('input');
  search.type = 'text';
  search.placeholder = 'Search customers...';
  search.style.cssText = 'background:var(--s2);border:1px solid var(--br);'
    + 'border-radius:6px;padding:10px 12px;font-size:13px;color:var(--t);'
    + 'margin-bottom:12px;font-family:inherit;outline:none;';
  sheet.appendChild(search);

  // Results container — scrollable
  const results = document.createElement('div');
  results.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:4px;min-height:200px;';
  sheet.appendChild(results);

  const renderLeads = (filter) => {
    results.textContent = '';
    const q = (filter || '').toLowerCase().trim();
    const filtered = q
      ? leads.filter(l => {
          const text = [l.firstName, l.lastName, l.address, l.phone].filter(Boolean).join(' ').toLowerCase();
          return text.includes(q);
        })
      : leads;

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:30px 10px;color:var(--m);font-size:12px;';
      empty.textContent = q ? 'No customers match "' + q + '"' : 'No customers yet';
      results.appendChild(empty);
      return;
    }

    // "Unassign" option at the top if currently assigned
    if (estimate.leadId) {
      const unassign = document.createElement('button');
      unassign.type = 'button';
      unassign.style.cssText = 'background:var(--s2);border:1px dashed var(--br);'
        + 'color:var(--m);padding:10px 14px;border-radius:6px;text-align:left;'
        + 'cursor:pointer;font-family:inherit;font-size:12px;';
      unassign.textContent = '✕ Unassign (leave without customer)';
      unassign.addEventListener('click', async () => {
        overlay.remove();
        const ok = await window._assignEstimateToLead(estimateId, null);
        if (ok) showToast('\u2713 Estimate unassigned', 'success');
      });
      results.appendChild(unassign);
    }

    filtered.slice(0, 100).forEach(lead => {
      const row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = 'background:var(--s2);border:1px solid var(--br);'
        + 'border-radius:6px;padding:10px 14px;text-align:left;cursor:pointer;'
        + 'font-family:inherit;transition:border-color .15s;';
      row.addEventListener('mouseenter', () => { row.style.borderColor = 'var(--orange)'; });
      row.addEventListener('mouseleave', () => { row.style.borderColor = 'var(--br)'; });

      const name = document.createElement('div');
      name.style.cssText = 'font-size:13px;font-weight:600;color:var(--t);';
      name.textContent = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || '(no name)';
      row.appendChild(name);

      const addr = document.createElement('div');
      addr.style.cssText = 'font-size:11px;color:var(--m);margin-top:2px;';
      addr.textContent = lead.address || 'No address';
      row.appendChild(addr);

      row.addEventListener('click', async () => {
        overlay.remove();
        const ok = await window._assignEstimateToLead(estimateId, lead.id);
        if (ok) showToast('\u2713 Assigned to ' + (lead.firstName || lead.address || 'customer'), 'success');
        else showToast('Failed to assign', 'error');
      });
      results.appendChild(row);
    });
  };

  renderLeads('');
  search.addEventListener('input', () => renderLeads(search.value));

  // Footer — cancel button
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:flex-end;margin-top:14px;';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'background:none;border:1px solid var(--br);'
    + 'color:var(--m);padding:8px 18px;border-radius:6px;cursor:pointer;'
    + "font-family:'Barlow Condensed',sans-serif;font-size:12px;"
    + 'font-weight:700;letter-spacing:.08em;text-transform:uppercase;';
  cancelBtn.addEventListener('click', () => overlay.remove());
  footer.appendChild(cancelBtn);
  sheet.appendChild(footer);

  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  // Click outside + Esc to close
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const escHandler = (e) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);
  setTimeout(() => search.focus(), 50);
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
window.duplicateEstimateAction = duplicateEstimateAction;
window.renameEstimateAction = renameEstimateAction;
window.assignEstimateAction = assignEstimateAction;
window.deleteEstimateAction = deleteEstimateAction;
