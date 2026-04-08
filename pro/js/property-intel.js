// ══════════════════════════════════════════════════════════════
// NBD Pro — property-intel.js
// Property Intel: auditor lookup, intel cards, modal display
// ══════════════════════════════════════════════════════════════

// Use var to avoid redeclaration collision with dashboard.html inline script
var _piCache = _piCache || {};

async function fetchPropertyIntel(nominatimData, targetElId) {
  const targetEl = document.getElementById(targetElId);

  // Determine county from Nominatim response
  const addr = nominatimData?.address || {};
  const county = addr.county || addr.state_district || '';
  const countyClean = county.replace(' County','').trim();

  // Build the clean address for searching
  const num   = addr.house_number || '';
  const road  = addr.road || addr.street || '';
  const city  = addr.city || addr.town || addr.village || '';
  const state = addr.state_code || addr.state || 'OH';
  const zip   = addr.postcode || '';
  const fullAddr = [num+' '+road, city, state+' '+zip].map(s=>s.trim()).filter(Boolean).join(', ');

  // Cache check
  const cacheKey = fullAddr.toLowerCase().replace(/\s/g,'');
  if(_piCache[cacheKey]) {
    renderIntelCard(targetElId, _piCache[cacheKey], countyClean, fullAddr);
    return;
  }

  // Build the auditor URL based on county
  let auditorUrl = '';
  let searchUrl  = '';

  if(county.toLowerCase().includes('hamilton')) {
    const numEnc  = encodeURIComponent(num.toUpperCase());
    const roadEnc = encodeURIComponent(road.toUpperCase());
    // Hamilton address search returns list with parcel IDs
    auditorUrl = `https://wedge1.hcauditor.org/search/address/${numEnc}/${roadEnc}//1/10`;
    searchUrl  = auditorUrl;
  } else if(county.toLowerCase().includes('clermont')) {
    auditorUrl = `https://www.clermontauditor.org/real-estate/`;
    searchUrl  = `https://opendata.clermontauditor.org/resource/ti6j-ub22.json?$$app_token=&$where=situs_address+like+%27${encodeURIComponent(num+'%25')}%27&$limit=5`;
  } else if(county.toLowerCase().includes('warren')) {
    auditorUrl = `https://www.wcauditor.org/PropertySearch/`;
  } else if(county.toLowerCase().includes('butler')) {
    auditorUrl = `https://propertysearch.bcohio.gov/search/commonsearch.aspx?mode=address`;
  } else {
    // Unknown county — use Claude to try to find it
    auditorUrl = `https://www.hamiltoncountyauditor.org/`;
  }

  // ── Claude-powered extraction ─────────────────────────────────
  // For Hamilton we can fetch the search page HTML and parse parcel ID,
  // then fetch the summary page. For others, we ask Claude to help interpret.

  try {
    // Step 1: Ask Claude to look up the property data
    const prompt = `You are a property data extraction assistant for a roofing contractor app covering the Cincinnati, Ohio metro area (Hamilton, Clermont, Warren, Butler counties).

The user needs property intel for this address: "${fullAddr}"
County: ${countyClean || 'unknown — likely Hamilton or Clermont, OH'}

Your job: Return ONLY a valid JSON object with these fields (use null for unknown):
{
  "ownerName": "FULL NAME OR LLC NAME",
  "isLLC": true/false,
  "yearBuilt": 1985,
  "roofAge": 40,
  "lastSaleDate": "MM/DD/YYYY",
  "lastSaleAmount": 245000,
  "marketValue": 310000,
  "assessedValue": 108500,
  "propertyType": "Single Family",
  "bedrooms": 3,
  "sqft": 1850,
  "acreage": 0.25,
  "homestead": true,
  "ownerOccupied": true,
  "taxDistrict": "CINTI CORP",
  "parcelId": "040-0003-0039-00",
  "auditorUrl": "${auditorUrl}",
  "dataSource": "Hamilton County Auditor"
}

To find this data, use the Hamilton County auditor search at: ${auditorUrl}
The page at wedge1.hcauditor.org/search/address/[HOUSE_NUMBER]/[STREET_NAME]//1/10 returns matching parcels.
Then wedge1.hcauditor.org/view/re/[PARCEL_ID_NO_DASHES]/2024/summary has the full record.

For the address "${fullAddr}", search the auditor, find the parcel, and extract all available fields.
If you cannot access the page, return your best estimate with "dataSource": "estimated" and null for unknown fields.
RETURN ONLY THE JSON OBJECT. No explanation, no markdown, no preamble.`;

    const _piKey = getJoeKey ? getJoeKey() : (localStorage.getItem('nbd_joe_key') || '');
    if (!_piKey || !_piKey.startsWith('sk-ant')) {
      throw new Error('Add your Anthropic API key in Settings → Ask Joe AI to use Property Intel');
    }

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-allow-browser': 'true',
        'x-api-key': _piKey
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{role: 'user', content: prompt}]
      })
    });

    if(!resp.ok) throw new Error('API ' + resp.status);
    const data = await resp.json();

    // Extract text from Anthropic response
    let rawText = data?.content?.[0]?.text || '';

    // Parse JSON from response
    let intel = null;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if(jsonMatch) intel = JSON.parse(jsonMatch[0]);
    } catch(e) { console.warn('Property intel JSON parse failed:', e.message); }

    if(!intel) throw new Error('No parseable data returned');

    // Compute roofAge if we have yearBuilt but not roofAge
    if(intel.yearBuilt && !intel.roofAge) {
      intel.roofAge = new Date().getFullYear() - parseInt(intel.yearBuilt);
    }

    _piCache[cacheKey] = intel;
    renderIntelCard(targetElId, intel, countyClean, fullAddr);

  } catch(err) {
    if(targetEl) {
      const card = targetEl.querySelector('.pi-card');
      const errHtml = `<div class="pi-card"><div class="pi-header"><span class="pi-title">🏠 Property Intel</span><span class="pi-county">${countyClean}</span></div><div class="pi-error">Could not load property data. Check your API key or try again.<br><small>${err.message}</small></div></div>`;
      if(card) card.outerHTML = errHtml;
    }
  }
}

function renderIntelCard(targetElId, intel, county, address) {
  const targetEl = document.getElementById(targetElId);
  if(!targetEl) return;

  // Store intel globally for pre-fill
  window._lastIntel = intel;

  const yr = intel.yearBuilt ? parseInt(intel.yearBuilt) : null;
  const age = yr ? (new Date().getFullYear() - yr) : null;
  const roofAge = intel.roofAge || age;

  let roofBadgeClass = 'pi-roof-mid';
  let roofLabel = '';
  if(roofAge !== null) {
    if(roofAge < 10)      { roofBadgeClass='pi-roof-new';     roofLabel=`${roofAge} yrs — Likely good`; }
    else if(roofAge < 20) { roofBadgeClass='pi-roof-mid';     roofLabel=`${roofAge} yrs — Watch it`; }
    else if(roofAge < 30) { roofBadgeClass='pi-roof-old';     roofLabel=`${roofAge} yrs — Needs attention`; }
    else                  { roofBadgeClass='pi-roof-ancient'; roofLabel=`${roofAge} yrs — Due for replacement`; }
  }

  const ownerName  = intel.ownerName || 'Owner Unknown';
  const isLLC     = intel.isLLC || /LLC|INC|CORP|TRUST|PROPERTIES|HOLDINGS|INVESTMENTS/i.test(ownerName);
  const lastSale  = intel.lastSaleAmount ? '$'+parseInt(intel.lastSaleAmount).toLocaleString() : null;
  const mktVal    = intel.marketValue ? '$'+parseInt(intel.marketValue).toLocaleString() : null;
  const dataNote  = intel.dataSource === 'estimated' ? ' (est.)' : '';

  const card = `<div class="pi-card">
    <div class="pi-header">
      <span class="pi-title">🏠 Property Intel${dataNote}</span>
      <span class="pi-county">${county || 'OH'} County</span>
    </div>
    <div class="pi-body">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-bottom:4px;">
        <span class="pi-owner">${ownerName}</span>
        ${isLLC ? '<span class="pi-llc-flag">🏢 LLC/Corp</span>' : ''}
      </div>
      <div class="pi-addr-line">${address}</div>
      ${roofAge !== null ? `<div class="pi-roof-badge ${roofBadgeClass}">🏠 ${roofLabel}</div>` : ''}
      <div class="pi-grid">
        ${yr ? `<div class="pi-stat"><span class="pi-stat-val">${yr}</span><span class="pi-stat-key">Year Built</span></div>` : ''}
        ${intel.propertyType ? `<div class="pi-stat"><span class="pi-stat-val">${intel.propertyType}</span><span class="pi-stat-key">Type</span></div>` : ''}
        ${mktVal ? `<div class="pi-stat"><span class="pi-stat-val">${mktVal}</span><span class="pi-stat-key">Market Value</span></div>` : ''}
        ${lastSale ? `<div class="pi-stat"><span class="pi-stat-val">${lastSale}</span><span class="pi-stat-key">Last Sale</span></div>` : ''}
        ${intel.lastSaleDate ? `<div class="pi-stat"><span class="pi-stat-val">${intel.lastSaleDate}</span><span class="pi-stat-key">Sale Date</span></div>` : ''}
        ${intel.bedrooms ? `<div class="pi-stat"><span class="pi-stat-val">${intel.bedrooms} bed</span><span class="pi-stat-key">Bedrooms</span></div>` : ''}
        ${intel.sqft ? `<div class="pi-stat"><span class="pi-stat-val">${parseInt(intel.sqft).toLocaleString()} sf</span><span class="pi-stat-key">Living Area</span></div>` : ''}
        ${intel.acreage ? `<div class="pi-stat"><span class="pi-stat-val">${parseFloat(intel.acreage).toFixed(3)} ac</span><span class="pi-stat-key">Acreage</span></div>` : ''}
        ${intel.homestead ? `<div class="pi-stat"><span class="pi-stat-val" style="color:var(--green);">Yes</span><span class="pi-stat-key">Homestead</span></div>` : ''}
        ${intel.parcelId ? `<div class="pi-stat"><span class="pi-stat-val" style="font-size:10px;">${intel.parcelId}</span><span class="pi-stat-key">Parcel ID</span></div>` : ''}
      </div>
      ${intel.auditorUrl ? `<a class="pi-link" href="${intel.auditorUrl}" target="_blank">↗ View Full County Record</a>` : ''}
    </div>
  </div>`;

  // Replace loading card, keep Make This a Lead button
  const existingCard = targetEl.querySelector('.pi-card');
  if(existingCard) {
    existingCard.outerHTML = card;
  } else {
    targetEl.innerHTML = card + '<button class="make-lead-btn" onclick="makeLeadFromSearch()">＋ Make This a Lead</button>';
  }
}

// ── Pull intel inside lead modal ──────────────────────────────
// PROPERTY INTEL SELECTIVE PULL SYSTEM
async function pullIntelForModal() {
  const addr = document.getElementById('lAddr')?.value?.trim();
  if(!addr) { showToast('Enter an address first','error'); return; }
  
  // Store address for later use
  window._pendingIntelAddress = addr;
  
  // Reset selections
  document.getElementById('piOwnerContact').checked = false;
  document.getElementById('piPropertyDetails').checked = false;
  document.getElementById('piZestimate').checked = false;
  document.getElementById('piTaxData').checked = false;
  updatePropertyIntelCost();
  
  // Show selection modal
  document.getElementById('propertyIntelModal').style.display = 'flex';
}

function closePropertyIntelModal() {
  document.getElementById('propertyIntelModal').style.display = 'none';
}

function closePropertyIntelConfirmModal() {
  document.getElementById('propertyIntelConfirmModal').style.display = 'none';
}

function updatePropertyIntelCost() {
  const prices = {
    piOwnerContact: 0.30,
    piPropertyDetails: 0.15,
    piZestimate: 0.05,
    piTaxData: 0.10
  };
  
  let total = 0;
  for (const [id, price] of Object.entries(prices)) {
    if (document.getElementById(id)?.checked) {
      total += price;
    }
  }
  
  document.getElementById('piTotalCost').textContent = '$' + total.toFixed(2);
  
  // Disable pull button if nothing selected
  const btn = document.getElementById('piPullBtn');
  if (total === 0) {
    btn.disabled = true;
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
  } else {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  }
}

function confirmPropertyIntelPull() {
  const selections = {
    'Owner Name & Contact': document.getElementById('piOwnerContact').checked,
    'Property Details': document.getElementById('piPropertyDetails').checked,
    'Zillow Zestimate': document.getElementById('piZestimate').checked,
    'Tax Assessor Data': document.getElementById('piTaxData').checked
  };
  
  const selected = Object.entries(selections).filter(([_, checked]) => checked).map(([name, _]) => name);
  
  if (selected.length === 0) {
    showToast('Select at least one data source', 'error');
    return;
  }
  
  // Calculate cost
  const prices = { 'Owner Name & Contact': 0.30, 'Property Details': 0.15, 'Zillow Zestimate': 0.05, 'Tax Assessor Data': 0.10 };
  const cost = selected.reduce((sum, name) => sum + prices[name], 0);
  
  // Update confirmation modal
  document.getElementById('piConfirmCost').textContent = '$' + cost.toFixed(2);
  const listEl = document.getElementById('piConfirmList');
  listEl.innerHTML = selected.map(name => `<li>${name}</li>`).join('');
  
  // Hide selection modal, show confirmation
  document.getElementById('propertyIntelModal').style.display = 'none';
  document.getElementById('propertyIntelConfirmModal').style.display = 'flex';
}

async function executePullPropertyIntel() {
  const confirmBtn = document.getElementById('piConfirmBtn');
  const originalText = confirmBtn.textContent;
  confirmBtn.disabled = true;
  confirmBtn.textContent = '⏳ Pulling...';
  
  try {
    const addr = window._pendingIntelAddress;
    if (!addr) throw new Error('No address found');
    
    // Get selections
    const selections = {
      ownerContact: document.getElementById('piOwnerContact').checked,
      propertyDetails: document.getElementById('piPropertyDetails').checked,
      zestimate: document.getElementById('piZestimate').checked,
      taxData: document.getElementById('piTaxData').checked
    };
    
    // Calculate actual cost
    const prices = { ownerContact: 0.30, propertyDetails: 0.15, zestimate: 0.05, taxData: 0.10 };
    const cost = Object.entries(selections)
      .filter(([_, checked]) => checked)
      .reduce((sum, [key, _]) => sum + prices[key], 0);
    
    // Geocode address first
    const geo = await geocode(addr);
    if (!geo) throw new Error('Could not geocode address');
    
    // TODO: Call actual property data APIs based on selections
    // For now, simulate with existing fetchPropertyIntel
    await fetchPropertyIntelModal(geo, addr);
    
    // Close modals
    closePropertyIntelConfirmModal();
    
    // Show success with cost
    const selectedCount = Object.values(selections).filter(Boolean).length;
    showToast(`✓ Pulled ${selectedCount} data point${selectedCount > 1 ? 's' : ''} for $${cost.toFixed(2)}`, 'success');
    
  } catch (error) {
    console.error('Property intel pull error:', error);
    showToast('Failed to pull property data: ' + error.message, 'error');
  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = originalText;
  }
}

async function fetchPropertyIntelModal(geo, addr) {
  const resultEl = document.getElementById('modalIntelResult');
  const gAddr = geo.address || {};
  const county = (gAddr.county||'').replace(' County','').trim();

  // Run same engine but capture result for modal
  const cacheKey = addr.toLowerCase().replace(/\s/g,'');
  let intel = _piCache[cacheKey] || null;

  if(!intel) {
    // Temporarily show result container
    resultEl.innerHTML = '<div style="color:var(--m);font-size:11px;">Fetching county records...</div>';
    resultEl.classList.add('visible');
    // Fire the intel engine with a temp container
    const tempId = 'pi-temp-' + Date.now();
    const tempDiv = document.createElement('div');
    tempDiv.id = tempId;
    tempDiv.style.display = 'none';
    document.body.appendChild(tempDiv);
    await fetchPropertyIntel(geo, tempId);
    intel = window._lastIntel || null;
    document.body.removeChild(tempDiv);
  }

  if(!intel) {
    resultEl.innerHTML = '<div style="color:var(--red);font-size:11px;">Could not retrieve property data. Check your API key in Settings.</div>';
    resultEl.classList.add('visible');
    return;
  }

  // Pre-fill lead modal fields
  if(intel.ownerName && intel.ownerName !== 'Owner Unknown') {
    const parts = intel.ownerName.trim().split(/\s+/);
    const fname = document.getElementById('lFname');
    const lname = document.getElementById('lLname');
    if(fname && !fname.value) {
      if(parts.length >= 2) {
        fname.value = parts[0];
        lname.value = parts.slice(1).join(' ');
      } else {
        fname.value = intel.ownerName;
      }
    }
  }

  // Build notes pre-fill
  const notesEl = document.getElementById('lNotes');
  if(notesEl && !notesEl.value) {
    const yr = intel.yearBuilt;
    const age = yr ? (new Date().getFullYear() - parseInt(yr)) : null;
    const lines = [];
    if(yr) lines.push(`Year Built: ${yr} (${age} yr old roof)`);
    if(intel.ownerName) lines.push(`Owner of Record: ${intel.ownerName}`);
    if(intel.propertyType) lines.push(`Property: ${intel.propertyType}`);
    if(intel.marketValue) lines.push(`Market Value: $${parseInt(intel.marketValue).toLocaleString()}`);
    if(intel.lastSaleDate && intel.lastSaleAmount) lines.push(`Last Sale: $${parseInt(intel.lastSaleAmount).toLocaleString()} on ${intel.lastSaleDate}`);
    if(intel.isLLC) lines.push('Owner is LLC/Corporate entity');
    notesEl.value = lines.join('\n');
  }

  // Store yearBuilt for Firestore save
  window._modalIntel = intel;

  // Show compact result card
  const yr = intel.yearBuilt;
  const age = yr ? (new Date().getFullYear() - parseInt(yr)) : null;
  const roofAge = intel.roofAge || age;
  let roofColor = '#EAB308';
  if(roofAge !== null) {
    if(roofAge < 10) roofColor = '#2ECC8A';
    else if(roofAge < 20) roofColor = '#EAB308';
    else if(roofAge < 30) roofColor = '#E05252';
    else roofColor = '#9B6DFF';
  }

  resultEl.innerHTML = `
    <div class="mir-owner">${intel.ownerName||'Unknown Owner'}${intel.isLLC?'&nbsp;<span style="font-size:9px;color:#4A9EFF;font-weight:700;">LLC</span>':''}</div>
    <div class="mir-grid">
      ${yr ? `<div class="mir-item">Built <span>${yr}</span></div>` : ''}
      ${roofAge !== null ? `<div class="mir-item">Roof <span style="color:${roofColor};">${roofAge} yrs</span></div>` : ''}
      ${intel.marketValue ? `<div class="mir-item">Value <span>$${parseInt(intel.marketValue).toLocaleString()}</span></div>` : ''}
      ${intel.propertyType ? `<div class="mir-item">Type <span>${intel.propertyType}</span></div>` : ''}
      ${intel.bedrooms ? `<div class="mir-item">Beds <span>${intel.bedrooms}</span></div>` : ''}
      ${intel.homestead ? `<div class="mir-item">Homestead <span style="color:#2ECC8A;">Yes</span></div>` : ''}
    </div>
    <div style="font-size:10px;color:var(--m);margin-top:5px;">✓ Owner name and notes pre-filled below</div>`;
  resultEl.classList.add('visible');
}

async function geocode(q){
  try{
    const res=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`);
    const d=await res.json();
    if(!d.length){showToast('Address not found','error');return null;}
    return d[0];
  }catch(e){showToast('Geocode failed','error');return null;}
}


// Window scope exposures for Property Intel
window.fetchPropertyIntel = fetchPropertyIntel;
window.renderIntelCard = renderIntelCard;
window.executePullPropertyIntel = executePullPropertyIntel;
window.fetchPropertyIntelModal = fetchPropertyIntelModal;
