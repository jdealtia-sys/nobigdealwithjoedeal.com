// ============================================================
// NBD Pro — Supplement Builder
//
// The insurance leverage tool. Takes an original estimate,
// lets Joe add newly-discovered line items and increase
// quantities on existing lines, tracks justifications + code
// refs + photos per change, and generates a formal supplement
// letter the adjuster can approve.
//
// Data model lives in window.EstimateSupplement. Firestore
// collection: 'supplements' (leadId + parentEstimateId indexed).
//
// Depends on:
//   - NBD_XACT_CATALOG (line item lookup)
//   - NBD_LABOR (labor rate lookup)
//   - EstimateLogic (resolver + formula evaluator)
//   - EstimateFinalization (reuses helpers for HTML output)
// ============================================================

(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  // ═════════════════════════════════════════════════════════
  // Data model
  // ═════════════════════════════════════════════════════════

  /**
   * Create a new supplement from a parent estimate.
   *
   * @param {Object} parentEstimate - The resolved parent estimate
   * @param {Object} opts
   *   - leadId: Firestore lead ID
   *   - parentEstimateId: Firestore estimate ID
   *   - version: Supplement number (1, 2, 3…)
   *   - reason: Short reason for the supplement
   * @returns {Object} Supplement document
   */
  function createSupplement(parentEstimate, opts) {
    opts = opts || {};
    const now = new Date().toISOString();
    return {
      id: 'sup_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8),
      leadId: opts.leadId || null,
      parentEstimateId: opts.parentEstimateId || null,
      version: opts.version || 1,
      createdAt: now,
      updatedAt: now,
      status: 'draft',                  // draft | submitted | approved | partial | denied
      reason: opts.reason || '',

      // Snapshot of the parent estimate's line items at supplement time
      originalLineItems: (parentEstimate.lines || []).map(l => ({
        code: l.code,
        name: l.name,
        unit: l.unit,
        quantity: l.quantity,
        materialCostPerUnit: l.materialCostPerUnit,
        laborCostPerUnit: l.laborCostPerUnit,
        lineTotal: l.lineTotal
      })),
      originalTotal: parentEstimate.total,
      originalMaterial: parentEstimate.materialCost,
      originalLabor: parentEstimate.laborCost,

      // Changes introduced by this supplement
      addedItems: [],                    // Brand-new line items
      modifiedItems: [],                 // Quantity increases on existing items

      // Calculated totals (populated by calculateDelta)
      supplementMaterial: 0,
      supplementLabor: 0,
      supplementSubtotal: 0,
      supplementOhp: 0,
      supplementTax: 0,
      supplementTotal: 0,
      newGrandTotal: 0,
      deltaPct: 0,

      // Submission tracking
      submission: {
        submittedAt: null,
        submittedTo: null,
        adjuster: null,
        method: null,                    // email | portal | print
        respondedAt: null,
        responseStatus: null,            // approved | partial | denied
        approvedAmount: null,
        responseNotes: ''
      },

      // Settings snapshot (so the delta calc doesn't drift if
      // Joe edits rates between supplements)
      settingsSnapshot: window.EstimateBuilderV2
        ? window.EstimateBuilderV2.loadSettings()
        : null,

      meta: Object.assign({}, opts.meta || {})
    };
  }

  /**
   * Add a brand-new line item to the supplement.
   *
   * @param {Object} supplement
   * @param {Object} itemData - At minimum: code, name, unit, quantity
   *   plus justification, codeRef, photos[], materialCost, laborCost
   */
  function addItem(supplement, itemData) {
    const entry = {
      code: itemData.code,
      name: itemData.name,
      unit: itemData.unit || 'EA',
      quantity: Number(itemData.quantity) || 0,
      materialCostPerUnit: Number(itemData.materialCost) || 0,
      laborCostPerUnit: Number(itemData.laborCost) || 0,
      lineTotal: 0,
      justification: itemData.justification || '',
      codeRef: itemData.codeRef || '',
      codeRefs: itemData.codeRefs || {},
      photos: itemData.photos || [],
      requiresPhoto: !!itemData.requiresPhoto,
      reason: itemData.reason || itemData.justification || '',
      addedAt: new Date().toISOString(),
      source: itemData.source || 'manual'  // manual | catalog | ai-suggested
    };
    entry.lineTotal = entry.quantity * (entry.materialCostPerUnit + entry.laborCostPerUnit);
    supplement.addedItems.push(entry);
    supplement.updatedAt = new Date().toISOString();
    calculateDelta(supplement);
    return entry;
  }

  /**
   * Add a brand-new line item from the Xactimate catalog by code.
   * Auto-fills cost, unit, code refs from the catalog entry.
   */
  function addFromCatalog(supplement, catalogCode, overrides) {
    const cat = window.NBD_XACT_CATALOG;
    if (!cat) return null;
    const item = cat.find(catalogCode);
    if (!item) {
      console.warn('[Supplement] Catalog code not found:', catalogCode);
      return null;
    }
    const data = Object.assign({}, {
      code: item.code,
      name: item.name,
      unit: item.unit,
      quantity: overrides && overrides.quantity != null ? overrides.quantity : 1,
      materialCost: item.materialCost,
      laborCost: item.laborCost,
      justification: (overrides && overrides.justification) || item.reason || '',
      codeRefs: item.codeRefs,
      requiresPhoto: item.requiresPhoto,
      reason: item.reason,
      source: 'catalog'
    }, overrides || {});
    return addItem(supplement, data);
  }

  /**
   * Modify quantity on an existing line item from the parent estimate.
   * Tracks original vs new qty, computes delta cost.
   */
  function modifyItemQuantity(supplement, originalCode, newQuantity, justification, photos) {
    const original = supplement.originalLineItems.find(l => l.code === originalCode);
    if (!original) {
      console.warn('[Supplement] Original line item not found:', originalCode);
      return null;
    }
    const deltaQty = Number(newQuantity) - Number(original.quantity);
    if (deltaQty <= 0) {
      console.warn('[Supplement] Supplement can only increase quantity, not decrease');
      return null;
    }
    // Remove any existing modification for this code (replace)
    supplement.modifiedItems = supplement.modifiedItems.filter(m => m.originalCode !== originalCode);

    const entry = {
      originalCode: originalCode,
      name: original.name,
      unit: original.unit,
      originalQuantity: Number(original.quantity),
      newQuantity: Number(newQuantity),
      deltaQuantity: deltaQty,
      materialCostPerUnit: Number(original.materialCostPerUnit),
      laborCostPerUnit: Number(original.laborCostPerUnit),
      deltaMaterial: deltaQty * Number(original.materialCostPerUnit),
      deltaLabor: deltaQty * Number(original.laborCostPerUnit),
      deltaLineTotal: deltaQty * (Number(original.materialCostPerUnit) + Number(original.laborCostPerUnit)),
      justification: justification || '',
      photos: photos || [],
      addedAt: new Date().toISOString()
    };
    supplement.modifiedItems.push(entry);
    supplement.updatedAt = new Date().toISOString();
    calculateDelta(supplement);
    return entry;
  }

  /**
   * Remove an added item by code
   */
  function removeAddedItem(supplement, code) {
    supplement.addedItems = supplement.addedItems.filter(i => i.code !== code);
    calculateDelta(supplement);
  }

  /**
   * Remove a quantity modification by original code
   */
  function removeModification(supplement, originalCode) {
    supplement.modifiedItems = supplement.modifiedItems.filter(m => m.originalCode !== originalCode);
    calculateDelta(supplement);
  }

  /**
   * Attach a photo to an added item or a modification
   */
  function attachPhoto(supplement, targetCode, photoId, isModification) {
    const list = isModification ? supplement.modifiedItems : supplement.addedItems;
    const target = list.find(i => (isModification ? i.originalCode : i.code) === targetCode);
    if (!target) return false;
    target.photos = target.photos || [];
    if (!target.photos.includes(photoId)) target.photos.push(photoId);
    supplement.updatedAt = new Date().toISOString();
    return true;
  }

  // ═════════════════════════════════════════════════════════
  // Delta calculator — rolls up added + modified items
  // ═════════════════════════════════════════════════════════

  function calculateDelta(supplement) {
    const s = supplement.settingsSnapshot || (window.EstimateBuilderV2 && window.EstimateBuilderV2.loadSettings()) || {};

    // Added items total
    let addedMat = 0, addedLab = 0;
    supplement.addedItems.forEach(item => {
      addedMat += (Number(item.quantity) || 0) * (Number(item.materialCostPerUnit) || 0);
      addedLab += (Number(item.quantity) || 0) * (Number(item.laborCostPerUnit) || 0);
      item.lineTotal = (Number(item.quantity) || 0) * ((Number(item.materialCostPerUnit) || 0) + (Number(item.laborCostPerUnit) || 0));
    });

    // Modified items delta
    let modMat = 0, modLab = 0;
    supplement.modifiedItems.forEach(mod => {
      modMat += Number(mod.deltaMaterial) || 0;
      modLab += Number(mod.deltaLabor) || 0;
    });

    supplement.supplementMaterial = addedMat + modMat;
    supplement.supplementLabor    = addedLab + modLab;

    // Apply OH&P on the delta (insurance standard)
    const overheadPct = Number(s.overheadPct != null ? s.overheadPct : 0.10);
    const profitPct   = Number(s.profitPct != null ? s.profitPct : 0.10);
    const matMarkupPct = Number(s.materialMarkupPct != null ? s.materialMarkupPct : 0.25);

    const matRetail = supplement.supplementMaterial * (1 + matMarkupPct);
    const retailPreOhp = matRetail + supplement.supplementLabor;

    supplement.supplementMatRetail = matRetail;
    supplement.supplementRetailPreOhp = retailPreOhp;
    supplement.supplementOverhead = retailPreOhp * overheadPct;
    supplement.supplementProfit   = retailPreOhp * profitPct;
    supplement.supplementOhp      = supplement.supplementOverhead + supplement.supplementProfit;
    supplement.supplementSubtotal = retailPreOhp + supplement.supplementOhp;

    // Supplements in insurance mode skip tax
    supplement.supplementTax = 0;

    // Grand total (rounded to $25)
    const roundTo = Number(s.roundTo || 25);
    supplement.supplementTotal = Math.round(supplement.supplementSubtotal / roundTo) * roundTo;
    supplement.newGrandTotal = supplement.originalTotal + supplement.supplementTotal;
    supplement.deltaPct = supplement.originalTotal > 0
      ? (supplement.supplementTotal / supplement.originalTotal) * 100
      : 0;

    return supplement;
  }

  // ═════════════════════════════════════════════════════════
  // Submission tracking
  // ═════════════════════════════════════════════════════════

  function markSubmitted(supplement, submission) {
    supplement.status = 'submitted';
    supplement.submission.submittedAt = new Date().toISOString();
    supplement.submission.submittedTo = submission.submittedTo || null;
    supplement.submission.adjuster    = submission.adjuster || null;
    supplement.submission.method      = submission.method || 'email';
    supplement.updatedAt = new Date().toISOString();
    return supplement;
  }

  function recordResponse(supplement, response) {
    supplement.status = response.status || 'partial';  // approved | partial | denied
    supplement.submission.respondedAt     = new Date().toISOString();
    supplement.submission.responseStatus  = response.status;
    supplement.submission.approvedAmount  = Number(response.approvedAmount) || null;
    supplement.submission.responseNotes   = response.notes || '';
    supplement.updatedAt = new Date().toISOString();
    return supplement;
  }

  // ═════════════════════════════════════════════════════════
  // Formal supplement letter (HTML output)
  // ═════════════════════════════════════════════════════════

  function formatSupplementLetter(supplement, meta) {
    meta = meta || {};
    const customer = meta.customer || {};
    const claim    = meta.claim || {};
    const est      = meta.estimate || {};
    const company  = meta.company || {
      name: 'No Big Deal Home Solutions',
      phone: '(859) 420-7382',
      email: 'JD@nobigdealwithjoedeal.com',
      address: '6563 Manila Rd · Goshen, OH'
    };

    const EF = window.EstimateFinalization;
    if (!EF) {
      console.warn('[Supplement] EstimateFinalization not loaded, using basic output');
    }

    const escape = EF ? EF.escapeHtml : (s => String(s || ''));
    const fmtMoney = EF ? EF.fmtMoney : (n => '$' + Number(n).toFixed(2));
    const fmtMoneyBig = EF ? EF.fmtMoneyBig : (n => '$' + Math.round(Number(n)).toLocaleString());
    const fmtQty = EF ? EF.fmtQty : (n => Number(n).toFixed(2));
    const fmtDate = EF ? EF.fmtDate : (d => new Date(d).toLocaleDateString());
    const baseCSS = EF ? EF.BASE_CSS : '';

    // Added items table
    const addedRows = supplement.addedItems.map((item, i) => {
      const photoFlag = item.photos && item.photos.length
        ? `<span style="display:inline-block;font-size:8px;font-weight:700;color:#065f46;background:#ecfdf5;padding:2px 6px;border-radius:2px;letter-spacing:.08em;margin-left:6px;">${item.photos.length} PHOTO${item.photos.length > 1 ? 'S' : ''}</span>`
        : '';
      const codeRefText = item.codeRef || (item.codeRefs && Object.values(item.codeRefs).filter(Boolean).join(' · ')) || '';
      const codeRef = codeRefText
        ? `<div class="code-refs">${escape(codeRefText)}</div>`
        : '';
      return `
        <tr>
          <td style="font-weight:700;color:#333;">${i + 1}.</td>
          <td class="code">${escape(item.code || '')}</td>
          <td>
            <strong>${escape(item.name || '')}</strong>${photoFlag}
            <div class="reason">${escape(item.justification || item.reason || '')}</div>
            ${codeRef}
          </td>
          <td class="num">${fmtQty(item.quantity, item.unit)} ${escape(item.unit)}</td>
          <td class="num">${fmtMoney(item.materialCostPerUnit)}</td>
          <td class="num">${fmtMoney(item.laborCostPerUnit)}</td>
          <td class="num"><strong>${fmtMoney(item.lineTotal)}</strong></td>
        </tr>
      `;
    }).join('');

    // Modified items table
    const modifiedRows = supplement.modifiedItems.map((mod, i) => {
      const photoFlag = mod.photos && mod.photos.length
        ? `<span style="display:inline-block;font-size:8px;font-weight:700;color:#065f46;background:#ecfdf5;padding:2px 6px;border-radius:2px;letter-spacing:.08em;margin-left:6px;">${mod.photos.length} PHOTO${mod.photos.length > 1 ? 'S' : ''}</span>`
        : '';
      return `
        <tr>
          <td style="font-weight:700;color:#333;">${i + 1}.</td>
          <td class="code">${escape(mod.originalCode || '')}</td>
          <td>
            <strong>${escape(mod.name || '')}</strong>${photoFlag}
            <div class="reason">${escape(mod.justification || '')}</div>
          </td>
          <td class="num">${fmtQty(mod.originalQuantity, mod.unit)} → <strong>${fmtQty(mod.newQuantity, mod.unit)}</strong></td>
          <td class="num">+${fmtQty(mod.deltaQuantity, mod.unit)} ${escape(mod.unit)}</td>
          <td class="num"><strong>${fmtMoney(mod.deltaLineTotal)}</strong></td>
        </tr>
      `;
    }).join('');

    const addedTable = supplement.addedItems.length ? `
      <h2>Newly Discovered Items</h2>
      <p style="font-size:11px;color:#555;margin-bottom:8px;">The following items were discovered during the work
      and were not visible during the original adjuster inspection. Each includes photo documentation and
      code references where applicable.</p>
      <table>
        <thead>
          <tr>
            <th style="width:30px;">#</th>
            <th style="width:100px;">Code</th>
            <th>Description & Justification</th>
            <th class="num" style="width:75px;">Qty</th>
            <th class="num" style="width:75px;">Material</th>
            <th class="num" style="width:75px;">Labor</th>
            <th class="num" style="width:85px;">Line Total</th>
          </tr>
        </thead>
        <tbody>${addedRows}</tbody>
      </table>
    ` : '';

    const modifiedTable = supplement.modifiedItems.length ? `
      <h2>Quantity Adjustments</h2>
      <p style="font-size:11px;color:#555;margin-bottom:8px;">The following line items required more material
      or labor than the original scope specified. Each adjustment includes justification and photo
      documentation.</p>
      <table>
        <thead>
          <tr>
            <th style="width:30px;">#</th>
            <th style="width:100px;">Code</th>
            <th>Description & Justification</th>
            <th class="num" style="width:120px;">Qty Change</th>
            <th class="num" style="width:80px;">Delta Qty</th>
            <th class="num" style="width:85px;">Delta Total</th>
          </tr>
        </thead>
        <tbody>${modifiedRows}</tbody>
      </table>
    ` : '';

    // Financial summary
    const summaryRows = [
      ['Original Estimate Total', fmtMoney(supplement.originalTotal)],
      ['Supplement — Material', fmtMoney(supplement.supplementMatRetail || supplement.supplementMaterial)],
      ['Supplement — Labor', fmtMoney(supplement.supplementLabor)],
      ['Supplement — Overhead', fmtMoney(supplement.supplementOverhead)],
      ['Supplement — Profit', fmtMoney(supplement.supplementProfit)],
      ['SUPPLEMENT TOTAL', fmtMoneyBig(supplement.supplementTotal), 'grand'],
      ['NEW GRAND TOTAL', fmtMoneyBig(supplement.newGrandTotal), 'grand']
    ];

    const summaryTable = `
      <h2>Supplement Financial Summary</h2>
      <table>
        <tbody>
          ${summaryRows.map(r => {
            const cls = r[2] === 'grand' ? 'grand-row' : '';
            return `<tr class="${cls}"><td colspan="5"><strong>${escape(r[0])}</strong></td><td class="num"><strong>${r[1]}</strong></td></tr>`;
          }).join('')}
        </tbody>
      </table>
      <div style="font-size:11px;color:#555;margin-top:8px;">
        Delta from original: <strong>${supplement.deltaPct.toFixed(1)}%</strong> increase
      </div>
    `;

    const header = `
      <div class="hdr">
        <div>
          <div class="brand">No Big Deal<span class="pro"> PRO</span></div>
          <div class="sub">Insurance Restoration Supplement</div>
          <div class="badge">Supplement #${supplement.version}</div>
        </div>
        <div class="doc-hdr">
          <div class="doc-title">Supplement Request</div>
          <div class="doc-date">${fmtDate(supplement.createdAt)}</div>
          <div class="doc-date">Supplement ID: ${escape(supplement.id)}</div>
          ${supplement.parentEstimateId ? `<div class="doc-date">Parent Est: ${escape(supplement.parentEstimateId)}</div>` : ''}
          <div class="doc-total-lbl">Supplement Total</div>
          <div class="doc-total-val">${fmtMoneyBig(supplement.supplementTotal)}</div>
        </div>
      </div>
    `;

    const claimBlock = `
      <h2>Claim Information</h2>
      <div class="field-grid">
        <div class="field"><label>Insured</label><div class="v">${escape(customer.name || '—')}</div></div>
        <div class="field"><label>Property Address</label><div class="v">${escape(customer.address || '—')}</div></div>
        <div class="field"><label>Carrier</label><div class="v">${escape(claim.carrier || '—')}</div></div>
        <div class="field"><label>Claim Number</label><div class="v">${escape(claim.number || '—')}</div></div>
        <div class="field"><label>Adjuster</label><div class="v">${escape(claim.adjuster || '—')}</div></div>
        <div class="field"><label>Date of Loss</label><div class="v">${escape(claim.dateOfLoss || '—')}</div></div>
        <div class="field"><label>Original Est. Amount</label><div class="v">${fmtMoneyBig(supplement.originalTotal)}</div></div>
        <div class="field"><label>Supplement Reason</label><div class="v">${escape(supplement.reason || 'Additional work required')}</div></div>
      </div>
    `;

    const introBlock = `
      <h2>Purpose of Supplement</h2>
      <p style="font-size:12px;color:#333;line-height:1.6;">
        Dear ${escape(claim.adjuster || 'Adjuster')},
      </p>
      <p style="font-size:12px;color:#333;line-height:1.6;margin-top:8px;">
        During the course of repair work at the above property, additional damage or
        conditions were discovered that were not visible or accessible during the original
        inspection. This supplement request documents those findings with photo evidence,
        code references where applicable, and line-item pricing consistent with the original
        scope methodology.
      </p>
      <p style="font-size:12px;color:#333;line-height:1.6;margin-top:8px;">
        We respectfully request approval of the itemized supplement below. All items are
        priced at industry-standard rates for the Cincinnati/Northern Kentucky market.
        Photo documentation is available upon request.
      </p>
    `;

    const signBlock = `
      <h2>Acknowledgment</h2>
      <div class="sig-block">
        <div>
          <div style="height:40px;"></div>
          <div class="sig-line">Contractor — ${escape(est.preparedBy || 'Joe Deal')}<br>
               ${escape(company.name)}<br>
               Date: ${fmtDate(supplement.createdAt)}</div>
        </div>
        <div>
          <div style="height:40px;"></div>
          <div class="sig-line">Adjuster Acknowledgment<br>
               ${escape(claim.adjuster || '')}<br>
               Carrier: ${escape(claim.carrier || '')}<br>
               Date: ____________________</div>
        </div>
      </div>

      <div class="terms">
        <strong>Supplement Terms:</strong> This supplement is submitted in good faith based on
        conditions discovered during active repair work. Pricing is consistent with the original
        estimate methodology and reflects current market rates. Photo documentation for each
        line item is available for inspection upon request. Thank you for your timely review.
      </div>

      <div class="footer">
        <div style="display:flex;justify-content:space-between;">
          <span>${escape(company.name)} · ${escape(company.phone)} · ${escape(company.email)}</span>
          <span>Supplement #${supplement.version} · Generated ${fmtDate(supplement.createdAt)}</span>
        </div>
      </div>
    `;

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<title>Supplement #${supplement.version} — ${escape(customer.name || 'NBD')} — ${fmtDate(supplement.createdAt)}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${baseCSS}</style>
</head><body>
${header}
${claimBlock}
${introBlock}
${addedTable}
${modifiedTable}
${summaryTable}
${signBlock}
</body></html>`;

    return {
      format: 'supplement-letter',
      html,
      version: supplement.version,
      addedCount: supplement.addedItems.length,
      modifiedCount: supplement.modifiedItems.length,
      supplementTotal: supplement.supplementTotal,
      newGrandTotal: supplement.newGrandTotal,
      deltaPct: supplement.deltaPct
    };
  }

  // ═════════════════════════════════════════════════════════
  // Firestore persistence (stub — wires in dashboard)
  // ═════════════════════════════════════════════════════════

  /**
   * Save a supplement to Firestore. Auto-increments version
   * based on existing supplements for the parent estimate.
   */
  async function saveToFirestore(supplement) {
    if (typeof window.addDoc !== 'function' || !window.db || !window.auth?.currentUser) {
      console.warn('[Supplement] Firestore not available — cannot save');
      return null;
    }
    try {
      const data = Object.assign({}, supplement, {
        userId: window.auth.currentUser.uid,
        updatedAt: new Date().toISOString()
      });
      const ref = await window.addDoc(
        window.collection(window.db, 'supplements'),
        data
      );
      return ref.id;
    } catch (e) {
      console.error('[Supplement] Save failed:', e);
      return null;
    }
  }

  /**
   * Get all supplements for a parent estimate, ordered by version.
   */
  async function loadForEstimate(parentEstimateId) {
    if (typeof window.getDocs !== 'function') return [];
    try {
      const q = window.query(
        window.collection(window.db, 'supplements'),
        window.where('parentEstimateId', '==', parentEstimateId),
        window.where('userId', '==', window.auth.currentUser.uid)
      );
      const snap = await window.getDocs(q);
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.version || 0) - (b.version || 0));
    } catch (e) {
      console.warn('[Supplement] Load failed:', e);
      return [];
    }
  }

  // ═════════════════════════════════════════════════════════
  // Public API
  // ═════════════════════════════════════════════════════════

  window.EstimateSupplement = {
    createSupplement,
    addItem,
    addFromCatalog,
    modifyItemQuantity,
    removeAddedItem,
    removeModification,
    attachPhoto,
    calculateDelta,
    markSubmitted,
    recordResponse,
    formatSupplementLetter,
    saveToFirestore,
    loadForEstimate
  };

  console.log('[EstimateSupplement] Supplement builder ready.');
})();
