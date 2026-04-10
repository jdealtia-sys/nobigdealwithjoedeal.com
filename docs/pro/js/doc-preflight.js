/**
 * NBD Pro — Document Pre-Flight Modal
 * ------------------------------------------------------------------
 * A schema-driven review/edit modal that runs BEFORE the document
 * generator fires. The user confirms or edits every field the
 * template will use, decides whether changes persist to the
 * customer record or only to this one document, then submits.
 *
 * Exposes: window.DocPreflight
 *
 * Architecture:
 *   DOC_SCHEMAS[type]  -> sections -> fields (with key, type, source,
 *                                             persist, required, ...)
 *   open(type, customerId)
 *     1. Load lead + estimate + photos via getCustomerDocData()
 *     2. Load any saved per-doc overrides from lead.docOverrides[type]
 *     3. Resolve each field to an initial value via its source
 *     4. Render modal with Hybrid mode (required on top, optional
 *        collapsed)
 *     5. On submit -> validate -> split edits into leadUpdates +
 *        docOverrides -> persist via applyDocEdits() -> call
 *        window.NBDDocGen.generate(type, mergedData)
 *
 * Dependencies (all global):
 *   window.NBDDocGen              — document generator
 *   window.getCustomerDocData()   — data bridge (customer.html)
 *   window.checkPrerequisites()   — prerequisite gate (customer.html)
 *   window._leadDoc               — current lead Firestore doc
 *   window._customerEstimates     — loaded estimates
 *   window._allPhotos             — loaded photos
 *   window.db, doc, updateDoc,
 *     serverTimestamp             — Firestore helpers
 *   window.showToast (optional)
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════
  // SECTION 1: CONSTANTS & HELPERS
  // ═══════════════════════════════════════════════════════════════

  var MODAL_ID = 'docPreflightModal';
  var MODAL_STYLE_ID = 'docPreflightStyles';

  /**
   * Persist destinations:
   *   'lead'      — updates leads/{id}.<fieldKey> (customer record)
   *   'document'  — updates leads/{id}.docOverrides.<type>.<fieldKey>
   *                 (only used for this doc type going forward)
   *   'ephemeral' — not saved; passed into generate() and forgotten
   */
  var PERSIST = { LEAD: 'lead', DOCUMENT: 'document', EPHEMERAL: 'ephemeral' };

  /** Tiny utility: escape HTML so user text can't break the modal. */
  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Show toast if available, otherwise console. */
  function toast(msg, type) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, type || 'info');
    } else {
      console.log('[DocPreflight]', type || 'info', msg);
    }
  }

  /** Safe get of nested path like "lead.firstName". */
  function getPath(obj, path) {
    if (!obj || !path) return undefined;
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /** Convert date-ish value to yyyy-mm-dd for <input type="date">. */
  function toDateInput(v) {
    if (!v) return '';
    try {
      var d = (v && v.toDate) ? v.toDate() : new Date(v);
      if (isNaN(d.getTime())) return '';
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    } catch (e) { return ''; }
  }

  /** Format currency for display. */
  function fmtCurrency(v) {
    var n = parseFloat(v);
    if (isNaN(n)) return '';
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 2: FIELD SOURCE RESOLVERS
  // ═══════════════════════════════════════════════════════════════

  /**
   * Resolve a field's initial value from its `source` descriptor.
   *
   * Source formats:
   *   "lead.firstName"          — pull from window._leadDoc
   *   "estimate.grandTotal"     — pull from first estimate
   *   "estimate.lineItems"      — map estimate.lineItems to doc line-items
   *   "photos"                  — all photos
   *   "photos.before"           — photos with phase=='before'
   *   "photos.after"            — photos with phase=='after'
   *   "computed.<name>"         — named computed (see computeValue)
   *   "literal:<value>"         — literal default string
   *   any other string          — treated as literal
   *
   * Priority order when hydrating:
   *   1. docOverrides[type][key]  (saved per-doc edits)
   *   2. lead[key]                (if key exists on lead)
   *   3. source resolver
   */
  function resolveFieldValue(field, ctx) {
    // 1. Per-doc override wins
    if (ctx.overrides && Object.prototype.hasOwnProperty.call(ctx.overrides, field.key)) {
      return ctx.overrides[field.key];
    }

    // 2. Direct lead field wins next (only for lead-persist fields)
    if (field.persist === PERSIST.LEAD && ctx.lead && Object.prototype.hasOwnProperty.call(ctx.lead, field.key)) {
      var v = ctx.lead[field.key];
      if (v !== undefined && v !== null && v !== '') return v;
    }

    // 3. Source resolver
    var src = field.source;
    if (!src) return field.default !== undefined ? field.default : '';

    if (typeof src === 'string' && src.indexOf('literal:') === 0) {
      return src.slice('literal:'.length);
    }

    if (src === 'photos') return ctx.photos || [];
    if (src === 'photos.before') return (ctx.photos || []).filter(function (p) { return (p.phase || '').toLowerCase() === 'before'; });
    if (src === 'photos.after') return (ctx.photos || []).filter(function (p) { return (p.phase || '').toLowerCase() === 'after'; });
    if (src === 'photos.during') return (ctx.photos || []).filter(function (p) { return (p.phase || '').toLowerCase() === 'during'; });

    if (typeof src === 'string' && src.indexOf('computed.') === 0) {
      return computeValue(src.slice('computed.'.length), ctx, field);
    }

    if (typeof src === 'string' && src.indexOf('lead.') === 0) {
      return getPath(ctx.lead, src.slice('lead.'.length)) || '';
    }

    if (typeof src === 'string' && src.indexOf('estimate.') === 0) {
      var key = src.slice('estimate.'.length);
      if (key === 'lineItems') return mapEstimateLineItems(ctx.estimate);
      return getPath(ctx.estimate, key) || '';
    }

    // Plain literal fallback
    return src;
  }

  /** Map estimate.lineItems into the doc line-items shape. */
  function mapEstimateLineItems(est) {
    if (!est || !Array.isArray(est.lineItems)) return [];
    return est.lineItems.map(function (it) {
      var qty = parseFloat(it.quantity || it.qty || 1) || 1;
      var rate = parseFloat(it.unitPrice || it.rate || 0);
      var amt = parseFloat(it.amount || it.total || 0);
      if (!rate && qty && amt) rate = amt / qty;
      var total = amt || (qty * rate);
      return {
        description: it.description || it.name || 'Line item',
        qty: qty,
        unit: it.unit || 'ea',
        rate: rate || 0,
        total: total || 0
      };
    });
  }

  /** Named computed values. */
  function computeValue(name, ctx, field) {
    var lead = ctx.lead || {};
    var est = ctx.estimate || {};
    switch (name) {
      case 'homeownerName':
        return ((lead.firstName || '') + ' ' + (lead.lastName || '')).trim();
      case 'today':
        return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      case 'todayISO':
        return toDateInput(new Date());
      case 'jobValue':
        return lead.jobValue || est.grandTotal || est.total || est.amount || 0;
      case 'invoiceNumber':
        return 'INV-' + new Date().getFullYear() + '-' + String(Date.now()).slice(-5);
      case 'depositAmount':
        var jv = parseFloat(lead.jobValue || est.grandTotal || 0);
        return jv ? (jv * 0.5).toFixed(2) : '';
      case 'dueDate':
        var d = new Date();
        d.setDate(d.getDate() + 30);
        return toDateInput(d);
      case 'scopeItems':
        // Prefer lead.scopeOfWork as newline list, else estimate description
        var raw = lead.scopeOfWork || est.description || '';
        if (!raw) {
          return [
            'Remove existing roofing materials',
            'Install new architectural asphalt shingles',
            'Install premium underlayment & ice/water shield',
            'Install flashing & ridge vents',
            'Final cleanup & debris removal'
          ];
        }
        return raw.split(/\r?\n|•|;/).map(function (s) { return s.trim(); }).filter(Boolean);
      default:
        return field.default !== undefined ? field.default : '';
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 3: DOC SCHEMAS
  // ═══════════════════════════════════════════════════════════════
  //
  // Each schema describes the pre-flight form for one doc type.
  // Sections are rendered top-to-bottom. Fields inside sections are
  // rendered in order. Required fields float to the top automatically
  // in Hybrid mode.
  //
  // Schema shape:
  // {
  //   title:   'Proposal',
  //   subtitle:'Review before generating',
  //   sections: [
  //     { id, title, collapsed, fields: [
  //       { key, label, type, source, persist, required?, placeholder?,
  //         help?, options?, rows?, default? }
  //     ]}
  //   ]
  // }

  var CUSTOMER_SECTION = {
    id: 'customer',
    title: 'Customer',
    collapsed: false,
    fields: [
      { key: 'firstName',     label: 'First Name',     type: 'text',  source: 'lead.firstName',  persist: PERSIST.LEAD, required: true },
      { key: 'lastName',      label: 'Last Name',      type: 'text',  source: 'lead.lastName',   persist: PERSIST.LEAD, required: true },
      { key: 'address',       label: 'Property Address', type: 'text', source: 'lead.address',  persist: PERSIST.LEAD, required: true, placeholder: '123 Main St, Cincinnati, OH' },
      { key: 'phone',         label: 'Phone',          type: 'tel',   source: 'lead.phone',      persist: PERSIST.LEAD },
      { key: 'email',         label: 'Email',          type: 'email', source: 'lead.email',      persist: PERSIST.LEAD }
    ]
  };

  var COMPANY_SECTION_FIELDS = [
    { key: 'companyName',    label: 'Company Name',  type: 'text',  source: 'literal:No Big Deal Home Solutions', persist: PERSIST.DOCUMENT },
    { key: 'companyPhone',   label: 'Company Phone', type: 'tel',   source: 'literal:(859) 420-7382',            persist: PERSIST.DOCUMENT },
    { key: 'companyEmail',   label: 'Company Email', type: 'email', source: 'literal:info@nobigdeal.pro',        persist: PERSIST.DOCUMENT }
  ];

  var WARRANTY_TIER_OPTIONS = [
    { value: 'good',   label: 'Good — 5yr Workmanship + Standard Mfr' },
    { value: 'better', label: 'Better — 10yr Workmanship + Enhanced Mfr' },
    { value: 'best',   label: 'Best — Lifetime Workmanship + Premium Mfr' }
  ];

  var DOC_SCHEMAS = {

    // ── 1. PROPOSAL ─────────────────────────────────────────────
    proposal: {
      title: 'Proposal / Estimate',
      subtitle: 'Confirm the details before generating the proposal PDF.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'project', title: 'Project', collapsed: false,
          fields: [
            { key: 'date', label: 'Proposal Date', type: 'date', source: 'computed.todayISO', persist: PERSIST.DOCUMENT, required: true },
            { key: 'projectDescription', label: 'Project Description', type: 'textarea', rows: 3, required: true,
              source: 'lead.scopeOfWork', persist: PERSIST.LEAD,
              placeholder: 'Complete roof replacement including removal of existing materials, installation of new architectural shingles, flashing, underlayment, and cleanup.' },
            { key: 'scopeItems', label: 'Scope of Work (bullet list)', type: 'scope-list',
              source: 'computed.scopeItems', persist: PERSIST.DOCUMENT,
              help: 'Bullet points that appear under "Scope of Work" in the proposal.' }
          ]
        },
        {
          id: 'pricing', title: 'Pricing & Line Items', collapsed: false,
          fields: [
            { key: 'lineItems', label: 'Line Items', type: 'line-items',
              source: 'estimate.lineItems', persist: PERSIST.DOCUMENT, required: true,
              help: 'Pulled from the current estimate. Override to edit just this proposal, or Save to estimate to update the source.' },
            { key: 'totalPrice', label: 'Total Price', type: 'currency',
              source: 'computed.jobValue', persist: PERSIST.DOCUMENT, required: true }
          ]
        },
        {
          id: 'warranty', title: 'Warranty', collapsed: true,
          fields: [
            { key: 'warrantyTier', label: 'Warranty Tier', type: 'warranty-tier',
              source: 'lead.warrantyTier', persist: PERSIST.LEAD, default: 'better' }
          ]
        },
        {
          id: 'photos', title: 'Site Photos', collapsed: true,
          fields: [
            { key: 'photos', label: 'Photos to include', type: 'photo-selector',
              source: 'photos', persist: PERSIST.DOCUMENT,
              help: 'Select which photos appear in the proposal. At least 2 recommended.' }
          ]
        },
        {
          id: 'terms', title: 'Terms & Notes', collapsed: true,
          fields: [
            { key: 'termsNote', label: 'Custom note to homeowner', type: 'textarea', rows: 2,
              source: 'literal:', persist: PERSIST.DOCUMENT,
              placeholder: 'Optional note that appears above standard terms.' }
          ]
        }
      ]
    },

    // ── 2. CONTRACT ─────────────────────────────────────────────
    contract: {
      title: 'Roofing Contract',
      subtitle: 'Final review before the contract is generated.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'project', title: 'Project', collapsed: false,
          fields: [
            { key: 'projectDescription', label: 'Description of Work', type: 'textarea', rows: 3, required: true,
              source: 'lead.scopeOfWork', persist: PERSIST.LEAD },
            { key: 'lineItems', label: 'Line Items', type: 'line-items',
              source: 'estimate.lineItems', persist: PERSIST.DOCUMENT, required: true },
            { key: 'totalPrice', label: 'Contract Price', type: 'currency',
              source: 'computed.jobValue', persist: PERSIST.DOCUMENT, required: true }
          ]
        },
        {
          id: 'warranty', title: 'Warranty', collapsed: false,
          fields: [
            { key: 'warrantyTier', label: 'Warranty Tier', type: 'warranty-tier',
              source: 'lead.warrantyTier', persist: PERSIST.LEAD, required: true, default: 'better' }
          ]
        },
        {
          id: 'payment', title: 'Payment & Schedule', collapsed: false,
          fields: [
            { key: 'depositAmount', label: 'Deposit Amount', type: 'currency',
              source: 'computed.depositAmount', persist: PERSIST.DOCUMENT, required: true, help: 'Typically 50% of contract price.' },
            { key: 'paymentSchedule', label: 'Payment Schedule / Terms', type: 'textarea', rows: 2,
              source: 'literal:50% due upon contract execution; remaining balance due upon substantial completion.',
              persist: PERSIST.DOCUMENT },
            { key: 'startDate', label: 'Start Date', type: 'date',
              source: 'computed.todayISO', persist: PERSIST.DOCUMENT, required: true },
            { key: 'estimatedCompletion', label: 'Estimated Completion', type: 'text',
              source: 'literal:5-7 business days', persist: PERSIST.DOCUMENT }
          ]
        },
        {
          id: 'signatures', title: 'Signatures & Authorization', collapsed: true,
          fields: [
            { key: 'authorizedBy', label: 'Authorized by (contractor rep)', type: 'text',
              source: 'literal:Joe Deal', persist: PERSIST.DOCUMENT }
          ]
        }
      ]
    },

    // ── 3. WORK AUTHORIZATION ───────────────────────────────────
    work_authorization: {
      title: 'Work Authorization',
      subtitle: 'Authorization form for starting work on-site.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'scope', title: 'Scope', collapsed: false,
          fields: [
            { key: 'projectAddress', label: 'Project Address', type: 'text',
              source: 'lead.address', persist: PERSIST.LEAD, required: true },
            { key: 'scopeOfWork', label: 'Scope of Work', type: 'textarea', rows: 4, required: true,
              source: 'lead.scopeOfWork', persist: PERSIST.LEAD },
            { key: 'authorizedBy', label: 'Authorized By', type: 'text', required: true,
              source: 'literal:', persist: PERSIST.DOCUMENT, placeholder: 'Homeowner name' },
            { key: 'authDate', label: 'Authorization Date', type: 'date',
              source: 'computed.todayISO', persist: PERSIST.DOCUMENT, required: true }
          ]
        }
      ]
    },

    // ── 4. SCOPE OF WORK ────────────────────────────────────────
    scope_of_work: {
      title: 'Scope of Work',
      subtitle: 'Detailed scope document.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'scope', title: 'Scope', collapsed: false,
          fields: [
            { key: 'projectScope', label: 'Project Scope Summary', type: 'textarea', rows: 3, required: true,
              source: 'lead.scopeOfWork', persist: PERSIST.LEAD },
            { key: 'scopeItems', label: 'Scope Bullets', type: 'scope-list',
              source: 'computed.scopeItems', persist: PERSIST.DOCUMENT },
            { key: 'materials', label: 'Materials', type: 'textarea', rows: 3,
              source: 'literal:', persist: PERSIST.DOCUMENT,
              placeholder: 'e.g., GAF Timberline HDZ architectural shingles, ice & water shield, synthetic underlayment' },
            { key: 'labor', label: 'Labor Notes', type: 'textarea', rows: 2,
              source: 'literal:', persist: PERSIST.DOCUMENT,
              placeholder: 'Crew size, safety protocols, supervisor' },
            { key: 'timeline', label: 'Timeline', type: 'text',
              source: 'literal:5-7 business days', persist: PERSIST.DOCUMENT }
          ]
        }
      ]
    },

    // ── 5. INSPECTION REPORT (HOMEOWNER) ────────────────────────
    inspectionHomeowner: {
      title: 'Homeowner Inspection Report',
      subtitle: 'Condition report for the homeowner.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'property', title: 'Property Details', collapsed: false,
          fields: [
            { key: 'inspectionDate', label: 'Inspection Date', type: 'date',
              source: 'computed.todayISO', persist: PERSIST.DOCUMENT, required: true },
            { key: 'inspectorName', label: 'Inspector Name', type: 'text',
              source: 'literal:NBD Inspector', persist: PERSIST.DOCUMENT, required: true },
            { key: 'roofAge', label: 'Roof Age (years)', type: 'number',
              source: 'lead.roofAge', persist: PERSIST.LEAD },
            { key: 'roofType', label: 'Roof Type', type: 'text',
              source: 'lead.roofType', persist: PERSIST.LEAD, placeholder: 'e.g., 3-tab, architectural' },
            { key: 'squareFootage', label: 'Square Footage', type: 'number',
              source: 'lead.squareFootage', persist: PERSIST.LEAD }
          ]
        },
        {
          id: 'condition', title: 'Roof Condition Notes', collapsed: false,
          fields: [
            { key: 'overallDescription', label: 'Overall Assessment', type: 'textarea', rows: 3, required: true,
              source: 'literal:The roof shows signs of wear consistent with age. Several areas require attention to prevent further damage.',
              persist: PERSIST.DOCUMENT },
            { key: 'roofCondition', label: 'Roof Notes', type: 'textarea', rows: 2,
              source: 'literal:', persist: PERSIST.DOCUMENT },
            { key: 'gutterCondition', label: 'Gutter Notes', type: 'textarea', rows: 2,
              source: 'literal:', persist: PERSIST.DOCUMENT }
          ]
        },
        {
          id: 'photos', title: 'Inspection Photos', collapsed: false,
          fields: [
            { key: 'photos', label: 'Photos to include', type: 'photo-selector',
              source: 'photos', persist: PERSIST.DOCUMENT, required: true }
          ]
        },
        {
          id: 'recommendations', title: 'Recommendations', collapsed: true,
          fields: [
            { key: 'recommendationsNote', label: 'Recommendations Summary', type: 'textarea', rows: 3,
              source: 'literal:', persist: PERSIST.DOCUMENT,
              placeholder: 'Summary of recommended repairs or replacement.' }
          ]
        }
      ]
    },

    // ── 6. INSPECTION REPORT (INSURANCE) ────────────────────────
    inspectionInsurance: {
      title: 'Insurance Damage Report',
      subtitle: 'Report for insurance adjuster.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'claim', title: 'Claim Info', collapsed: false,
          fields: [
            { key: 'insCarrier', label: 'Insurance Carrier', type: 'text', required: true,
              source: 'lead.insCarrier', persist: PERSIST.LEAD, placeholder: 'e.g., State Farm' },
            { key: 'claimNumber', label: 'Claim Number', type: 'text', required: true,
              source: 'lead.claimNumber', persist: PERSIST.LEAD },
            { key: 'policyNumber', label: 'Policy Number', type: 'text',
              source: 'lead.policyNumber', persist: PERSIST.LEAD },
            { key: 'dateOfLoss', label: 'Date of Loss', type: 'date', required: true,
              source: 'lead.dateOfLoss', persist: PERSIST.LEAD },
            { key: 'damageType', label: 'Damage Type', type: 'select', required: true,
              source: 'lead.damageType', persist: PERSIST.LEAD,
              options: [
                { value: 'Wind', label: 'Wind' },
                { value: 'Hail', label: 'Hail' },
                { value: 'Wind & Hail', label: 'Wind & Hail' },
                { value: 'Fallen Tree', label: 'Fallen Tree' },
                { value: 'Ice Dam', label: 'Ice Dam' },
                { value: 'Other', label: 'Other' }
              ] }
          ]
        },
        {
          id: 'property', title: 'Property & Inspection', collapsed: false,
          fields: [
            { key: 'inspectionDate', label: 'Inspection Date', type: 'date', required: true,
              source: 'computed.todayISO', persist: PERSIST.DOCUMENT },
            { key: 'inspectorName', label: 'Damage Assessor', type: 'text', required: true,
              source: 'literal:NBD Damage Assessor', persist: PERSIST.DOCUMENT }
          ]
        },
        {
          id: 'damage', title: 'Damage & Scope', collapsed: false,
          fields: [
            { key: 'damageNotes', label: 'Damage Description', type: 'textarea', rows: 3, required: true,
              source: 'literal:Evidence of wind/impact damage to shingles including lifted edges, puncture marks, and missing shingles.',
              persist: PERSIST.DOCUMENT },
            { key: 'scopeItems', label: 'Scope of Restoration', type: 'scope-list',
              source: 'computed.scopeItems', persist: PERSIST.DOCUMENT },
            { key: 'estimatedRepairCost', label: 'Estimated Repair Cost', type: 'currency', required: true,
              source: 'computed.jobValue', persist: PERSIST.DOCUMENT }
          ]
        },
        {
          id: 'photos', title: 'Photo Evidence', collapsed: false,
          fields: [
            { key: 'photos', label: 'Photos to include', type: 'photo-selector',
              source: 'photos', persist: PERSIST.DOCUMENT, required: true,
              help: 'Select damage photos for the adjuster.' }
          ]
        }
      ]
    },

    // ── 7. SUPPLEMENT REQUEST ───────────────────────────────────
    supplement_request: {
      title: 'Supplement Request',
      subtitle: 'Additional scope items for the insurance carrier.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'claim', title: 'Claim Info', collapsed: false,
          fields: [
            { key: 'insCarrier', label: 'Carrier', type: 'text', required: true,
              source: 'lead.insCarrier', persist: PERSIST.LEAD },
            { key: 'claimNumber', label: 'Claim Number', type: 'text', required: true,
              source: 'lead.claimNumber', persist: PERSIST.LEAD }
          ]
        },
        {
          id: 'scope', title: 'Supplement Scope', collapsed: false,
          fields: [
            { key: 'originalScope', label: 'Original Approved Scope', type: 'textarea', rows: 3,
              source: 'lead.scopeOfWork', persist: PERSIST.LEAD },
            { key: 'supplementItems', label: 'Supplement Line Items', type: 'line-items',
              source: 'estimate.lineItems', persist: PERSIST.DOCUMENT, required: true,
              help: 'Items being added to the claim.' },
            { key: 'justification', label: 'Justification', type: 'textarea', rows: 4, required: true,
              source: 'literal:', persist: PERSIST.DOCUMENT,
              placeholder: 'Why are these items needed? Reference code, manufacturer spec, photos, etc.' }
          ]
        }
      ]
    },

    // ── 8. WARRANTY CERTIFICATE ─────────────────────────────────
    warranty_certificate: {
      title: 'Warranty Certificate',
      subtitle: 'Official warranty document for completed work.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'warranty', title: 'Warranty Details', collapsed: false,
          fields: [
            { key: 'installDate', label: 'Install Completion Date', type: 'date', required: true,
              source: 'computed.todayISO', persist: PERSIST.DOCUMENT },
            { key: 'warrantyTier', label: 'Warranty Tier', type: 'warranty-tier', required: true,
              source: 'lead.warrantyTier', persist: PERSIST.LEAD, default: 'better' },
            { key: 'coverageDetails', label: 'Coverage Details', type: 'textarea', rows: 3,
              source: 'literal:Workmanship warranty as shown above. Manufacturer warranties per shingle product datasheet.',
              persist: PERSIST.DOCUMENT },
            { key: 'transferable', label: 'Transferable to next owner?', type: 'checkbox',
              source: 'literal:false', persist: PERSIST.DOCUMENT }
          ]
        }
      ]
    },

    // ── 9. CERTIFICATE OF COMPLETION ────────────────────────────
    certificate_of_completion: {
      title: 'Certificate of Completion',
      subtitle: 'Proof that the job is complete and signed off.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'completion', title: 'Completion Details', collapsed: false,
          fields: [
            { key: 'completionDate', label: 'Completion Date', type: 'date', required: true,
              source: 'computed.todayISO', persist: PERSIST.DOCUMENT },
            { key: 'scopeCompleted', label: 'Scope Completed', type: 'textarea', rows: 3, required: true,
              source: 'lead.scopeOfWork', persist: PERSIST.LEAD },
            { key: 'qualitySignoff', label: 'Quality Sign-off Note', type: 'textarea', rows: 2,
              source: 'literal:Work completed to specification. Final walkthrough passed.',
              persist: PERSIST.DOCUMENT }
          ]
        },
        {
          id: 'photos', title: 'Before & After Photos', collapsed: false,
          fields: [
            { key: 'beforePhotos', label: 'Before Photos', type: 'photo-selector',
              source: 'photos.before', persist: PERSIST.DOCUMENT, required: true },
            { key: 'afterPhotos', label: 'After Photos', type: 'photo-selector',
              source: 'photos.after', persist: PERSIST.DOCUMENT, required: true }
          ]
        }
      ]
    },

    // ── 10. INVOICE ─────────────────────────────────────────────
    invoice: {
      title: 'Invoice',
      subtitle: 'Review invoice line items and totals.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'invoice', title: 'Invoice Info', collapsed: false,
          fields: [
            { key: 'invoiceNumber', label: 'Invoice Number', type: 'text', required: true,
              source: 'computed.invoiceNumber', persist: PERSIST.DOCUMENT },
            { key: 'invoiceDate', label: 'Invoice Date', type: 'date', required: true,
              source: 'computed.todayISO', persist: PERSIST.DOCUMENT },
            { key: 'dueDate', label: 'Due Date', type: 'date', required: true,
              source: 'computed.dueDate', persist: PERSIST.DOCUMENT }
          ]
        },
        {
          id: 'items', title: 'Line Items & Totals', collapsed: false,
          fields: [
            { key: 'lineItems', label: 'Line Items', type: 'line-items', required: true,
              source: 'estimate.lineItems', persist: PERSIST.DOCUMENT },
            { key: 'subtotal', label: 'Subtotal', type: 'currency', required: true,
              source: 'computed.jobValue', persist: PERSIST.DOCUMENT },
            { key: 'taxRate', label: 'Tax Rate (%)', type: 'number',
              source: 'literal:0', persist: PERSIST.DOCUMENT },
            { key: 'totalPrice', label: 'Total Due', type: 'currency', required: true,
              source: 'computed.jobValue', persist: PERSIST.DOCUMENT }
          ]
        },
        {
          id: 'terms', title: 'Payment Terms', collapsed: true,
          fields: [
            { key: 'paymentTerms', label: 'Payment Terms', type: 'textarea', rows: 2,
              source: 'literal:Net 30. Check, ACH, or credit card accepted.',
              persist: PERSIST.DOCUMENT }
          ]
        }
      ]
    },

    // ── 11. CHANGE ORDER ────────────────────────────────────────
    change_order: {
      title: 'Change Order',
      subtitle: 'Modification to an existing contract.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'original', title: 'Original Contract', collapsed: false,
          fields: [
            { key: 'originalContractNumber', label: 'Original Contract #', type: 'text',
              source: 'literal:', persist: PERSIST.DOCUMENT, placeholder: 'e.g., CON-2026-001' },
            { key: 'originalTotal', label: 'Original Total', type: 'currency',
              source: 'computed.jobValue', persist: PERSIST.DOCUMENT }
          ]
        },
        {
          id: 'changes', title: 'Changes', collapsed: false,
          fields: [
            { key: 'changeDescription', label: 'Description of Changes', type: 'textarea', rows: 4, required: true,
              source: 'literal:', persist: PERSIST.DOCUMENT,
              placeholder: 'What is being added, removed, or changed and why.' },
            { key: 'changeAmount', label: 'Change Amount (+/-)', type: 'currency', required: true,
              source: 'literal:0', persist: PERSIST.DOCUMENT,
              help: 'Positive for additions, negative for credits.' },
            { key: 'newTotal', label: 'New Contract Total', type: 'currency', required: true,
              source: 'literal:0', persist: PERSIST.DOCUMENT }
          ]
        }
      ]
    },

    // ── 12. BEFORE & AFTER REPORT ───────────────────────────────
    before_after_report: {
      title: 'Before & After Report',
      subtitle: 'Visual comparison of the project.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'project', title: 'Project', collapsed: false,
          fields: [
            { key: 'projectDescription', label: 'Project Description', type: 'textarea', rows: 2, required: true,
              source: 'lead.scopeOfWork', persist: PERSIST.LEAD },
            { key: 'duration', label: 'Project Duration', type: 'text',
              source: 'literal:5 business days', persist: PERSIST.DOCUMENT }
          ]
        },
        {
          id: 'photos', title: 'Photo Selection', collapsed: false,
          fields: [
            { key: 'beforePhotos', label: 'Before Photos', type: 'photo-selector', required: true,
              source: 'photos.before', persist: PERSIST.DOCUMENT },
            { key: 'afterPhotos', label: 'After Photos', type: 'photo-selector', required: true,
              source: 'photos.after', persist: PERSIST.DOCUMENT }
          ]
        }
      ]
    },

    // ── 13. FINANCING OPTIONS ───────────────────────────────────
    financing_options: {
      title: 'Financing Options',
      subtitle: 'Payment plan options for the customer.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'financing', title: 'Financing', collapsed: false,
          fields: [
            { key: 'jobTotal', label: 'Job Total', type: 'currency', required: true,
              source: 'computed.jobValue', persist: PERSIST.DOCUMENT },
            { key: 'term12', label: '12-month payment', type: 'currency',
              source: 'literal:', persist: PERSIST.DOCUMENT, placeholder: 'Monthly payment' },
            { key: 'term24', label: '24-month payment', type: 'currency',
              source: 'literal:', persist: PERSIST.DOCUMENT },
            { key: 'term60', label: '60-month payment', type: 'currency',
              source: 'literal:', persist: PERSIST.DOCUMENT },
            { key: 'interestRate', label: 'Interest Rate', type: 'text',
              source: 'literal:0% APR (approved credit)', persist: PERSIST.DOCUMENT },
            { key: 'applicationLink', label: 'Application Link', type: 'text',
              source: 'literal:nobigdeal.pro/financing', persist: PERSIST.DOCUMENT }
          ]
        }
      ]
    },

    // ── 14. COMPANY INTRO ───────────────────────────────────────
    company_intro: {
      title: 'Company Introduction',
      subtitle: 'About-us handout for new leads.',
      sections: [
        {
          id: 'company', title: 'Company Info', collapsed: false,
          fields: COMPANY_SECTION_FIELDS.concat([
            { key: 'serviceArea', label: 'Service Area', type: 'text',
              source: 'literal:Greater Cincinnati & Northern Kentucky', persist: PERSIST.DOCUMENT },
            { key: 'services', label: 'Services Offered', type: 'textarea', rows: 2,
              source: 'literal:Roofing, Siding, Gutters, Windows, Insurance Claim Assistance', persist: PERSIST.DOCUMENT }
          ])
        },
        {
          id: 'social', title: 'Social Proof', collapsed: true,
          fields: [
            { key: 'testimonialsNote', label: 'Featured Testimonial', type: 'textarea', rows: 3,
              source: 'literal:', persist: PERSIST.DOCUMENT,
              placeholder: 'Optional featured testimonial to include.' }
          ]
        }
      ]
    },

    // ── 15. REFERRAL CARD ───────────────────────────────────────
    referral_card: {
      title: 'Referral Card',
      subtitle: 'Give the homeowner a card to share.',
      sections: [
        {
          id: 'customer', title: 'Customer', collapsed: false,
          fields: [
            { key: 'firstName', label: 'First Name', type: 'text', required: true,
              source: 'lead.firstName', persist: PERSIST.LEAD },
            { key: 'lastName',  label: 'Last Name',  type: 'text', required: true,
              source: 'lead.lastName',  persist: PERSIST.LEAD }
          ]
        },
        {
          id: 'referral', title: 'Referral Details', collapsed: false,
          fields: [
            { key: 'referralCode', label: 'Referral Code', type: 'text', required: true,
              source: 'lead.referralCode', persist: PERSIST.LEAD, placeholder: 'Auto-generated or custom' },
            { key: 'bonusAmount', label: 'Referral Bonus', type: 'currency', required: true,
              source: 'literal:250', persist: PERSIST.DOCUMENT },
            { key: 'terms', label: 'Terms', type: 'textarea', rows: 2,
              source: 'literal:Bonus paid upon completion of referred job. One bonus per referred customer.',
              persist: PERSIST.DOCUMENT }
          ]
        }
      ]
    },

    // ── 16. STORM CHECKLIST ─────────────────────────────────────
    storm_checklist: {
      title: 'Storm Checklist',
      subtitle: 'Post-storm homeowner checklist.',
      sections: [
        {
          id: 'storm', title: 'Storm Event', collapsed: false,
          fields: [
            { key: 'stormDate', label: 'Storm Event Date', type: 'date', required: true,
              source: 'computed.todayISO', persist: PERSIST.DOCUMENT },
            { key: 'stormType', label: 'Storm Type', type: 'select',
              source: 'literal:Hail', persist: PERSIST.DOCUMENT,
              options: [
                { value: 'Hail', label: 'Hail' },
                { value: 'Wind', label: 'Wind' },
                { value: 'Tornado', label: 'Tornado' },
                { value: 'Ice', label: 'Ice' },
                { value: 'Other', label: 'Other' }
              ] },
            { key: 'checklistNotes', label: 'Additional Notes', type: 'textarea', rows: 3,
              source: 'literal:', persist: PERSIST.DOCUMENT },
            { key: 'emergencyPhone', label: 'Emergency Contact Phone', type: 'tel',
              source: 'literal:(859) 420-7382', persist: PERSIST.DOCUMENT }
          ]
        }
      ]
    },

    // ── 17. CLAIM GUIDE ─────────────────────────────────────────
    claim_guide: {
      title: 'Insurance Claim Guide',
      subtitle: 'Carrier-specific instructions.',
      sections: [
        {
          id: 'carrier', title: 'Carrier', collapsed: false,
          fields: [
            { key: 'insCarrier', label: 'Carrier', type: 'select',
              source: 'lead.insCarrier', persist: PERSIST.LEAD,
              options: [
                { value: 'State Farm', label: 'State Farm' },
                { value: 'Allstate', label: 'Allstate' },
                { value: 'Liberty Mutual', label: 'Liberty Mutual' },
                { value: 'USAA', label: 'USAA' },
                { value: 'Nationwide', label: 'Nationwide' },
                { value: 'Farmers', label: 'Farmers' },
                { value: 'Other', label: 'Other' }
              ] },
            { key: 'timeline', label: 'Expected Timeline', type: 'text',
              source: 'literal:30-60 days from claim filing', persist: PERSIST.DOCUMENT },
            { key: 'guideNotes', label: 'What to Expect', type: 'textarea', rows: 4,
              source: 'literal:Adjuster will contact you within 48-72 hours of filing. We will meet the adjuster on-site to review damage together.',
              persist: PERSIST.DOCUMENT }
          ]
        }
      ]
    },

    // ── 18. DOOR HANGER ─────────────────────────────────────────
    door_hanger: {
      title: 'Door Hanger',
      subtitle: 'Canvassing door hanger.',
      sections: [
        {
          id: 'company', title: 'Company Info', collapsed: false,
          fields: COMPANY_SECTION_FIELDS.concat([
            { key: 'headline', label: 'Headline', type: 'text',
              source: 'literal:Free Roof Inspection — No Obligation', persist: PERSIST.DOCUMENT },
            { key: 'services', label: 'Services', type: 'textarea', rows: 2,
              source: 'literal:Storm damage repair • Insurance claims • Roof replacement • Gutters',
              persist: PERSIST.DOCUMENT }
          ])
        }
      ]
    },

    // ── 19. NEIGHBORHOOD MAILER ─────────────────────────────────
    neighborhood_mailer: {
      title: 'Neighborhood Mailer',
      subtitle: 'Storm-event neighborhood mail piece.',
      sections: [
        {
          id: 'event', title: 'Storm Event', collapsed: false,
          fields: [
            { key: 'stormDate', label: 'Storm Event Date', type: 'date', required: true,
              source: 'computed.todayISO', persist: PERSIST.DOCUMENT },
            { key: 'affectedArea', label: 'Affected Area', type: 'text', required: true,
              source: 'literal:', persist: PERSIST.DOCUMENT, placeholder: 'e.g., West Chester, OH' },
            { key: 'ctaText', label: 'Call to Action', type: 'text',
              source: 'literal:Schedule your free storm damage inspection today', persist: PERSIST.DOCUMENT }
          ]
        },
        { id: 'company', title: 'Company Info', collapsed: true, fields: COMPANY_SECTION_FIELDS }
      ]
    },

    // ── 20. TESTIMONIAL SHEET ───────────────────────────────────
    testimonial_sheet: {
      title: 'Testimonial Sheet',
      subtitle: 'Customer testimonials handout.',
      sections: [
        {
          id: 'testimonials', title: 'Testimonials', collapsed: false,
          fields: [
            { key: 'testimonial1', label: 'Testimonial #1', type: 'textarea', rows: 3,
              source: 'literal:', persist: PERSIST.DOCUMENT, placeholder: 'Customer quote + name' },
            { key: 'rating1', label: 'Rating #1', type: 'select',
              source: 'literal:5', persist: PERSIST.DOCUMENT,
              options: [
                { value: '5', label: '5 stars' },
                { value: '4', label: '4 stars' },
                { value: '3', label: '3 stars' }
              ] },
            { key: 'testimonial2', label: 'Testimonial #2', type: 'textarea', rows: 3,
              source: 'literal:', persist: PERSIST.DOCUMENT },
            { key: 'rating2', label: 'Rating #2', type: 'select',
              source: 'literal:5', persist: PERSIST.DOCUMENT,
              options: [
                { value: '5', label: '5 stars' },
                { value: '4', label: '4 stars' },
                { value: '3', label: '3 stars' }
              ] },
            { key: 'testimonial3', label: 'Testimonial #3', type: 'textarea', rows: 3,
              source: 'literal:', persist: PERSIST.DOCUMENT },
            { key: 'rating3', label: 'Rating #3', type: 'select',
              source: 'literal:5', persist: PERSIST.DOCUMENT,
              options: [
                { value: '5', label: '5 stars' },
                { value: '4', label: '4 stars' },
                { value: '3', label: '3 stars' }
              ] }
          ]
        }
      ]
    },

    // ── 21. THANK YOU ───────────────────────────────────────────
    thank_you: {
      title: 'Thank You Letter',
      subtitle: 'Post-job thank-you for the customer.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'thankyou', title: 'Thank You Details', collapsed: false,
          fields: [
            { key: 'projectSummary', label: 'Project Summary', type: 'textarea', rows: 3, required: true,
              source: 'lead.scopeOfWork', persist: PERSIST.LEAD },
            { key: 'personalNote', label: 'Personal Note', type: 'textarea', rows: 3,
              source: 'literal:It was a pleasure working with you. Thank you for choosing No Big Deal Home Solutions.',
              persist: PERSIST.DOCUMENT },
            { key: 'reviewLink', label: 'Google Review Link', type: 'text',
              source: 'literal:https://g.page/r/nobigdeal/review', persist: PERSIST.DOCUMENT }
          ]
        }
      ]
    },

    // ── 22. PAYMENT AGREEMENT ───────────────────────────────────
    payment_agreement: {
      title: 'Payment Agreement',
      subtitle: 'Payment schedule agreement.',
      sections: [
        CUSTOMER_SECTION,
        {
          id: 'agreement', title: 'Agreement', collapsed: false,
          fields: [
            { key: 'totalPrice', label: 'Total Amount', type: 'currency', required: true,
              source: 'computed.jobValue', persist: PERSIST.DOCUMENT },
            { key: 'payment1Amount', label: 'Payment 1 Amount', type: 'currency', required: true,
              source: 'computed.depositAmount', persist: PERSIST.DOCUMENT },
            { key: 'payment1Date', label: 'Payment 1 Date', type: 'date', required: true,
              source: 'computed.todayISO', persist: PERSIST.DOCUMENT },
            { key: 'payment2Amount', label: 'Payment 2 Amount', type: 'currency',
              source: 'literal:', persist: PERSIST.DOCUMENT },
            { key: 'payment2Date', label: 'Payment 2 Date', type: 'date',
              source: 'literal:', persist: PERSIST.DOCUMENT },
            { key: 'paymentTerms', label: 'Terms', type: 'textarea', rows: 2,
              source: 'literal:Payments are non-refundable once work has begun. Late payments subject to 1.5% monthly finance charge.',
              persist: PERSIST.DOCUMENT }
          ]
        }
      ]
    }
  };

  // ═══════════════════════════════════════════════════════════════
  // SECTION 4: STATE
  // ═══════════════════════════════════════════════════════════════

  var state = {
    open: false,
    type: null,
    customerId: null,
    schema: null,
    values: {},       // { fieldKey: currentValue }
    fieldIndex: {},   // { fieldKey: fieldDefinition }
    showAll: false,
    lineItemsMode: {} // { fieldKey: 'locked' | 'override' }
  };

  // ═══════════════════════════════════════════════════════════════
  // SECTION 5: STYLES (injected once)
  // ═══════════════════════════════════════════════════════════════

  function injectStyles() {
    if (document.getElementById(MODAL_STYLE_ID)) return;
    var css = [
      '.dpf-overlay{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.82);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;animation:dpf-fade .18s ease-out;}',
      '@keyframes dpf-fade{from{opacity:0}to{opacity:1}}',
      '@keyframes dpf-slide{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}',
      '.dpf-card{width:100%;max-width:720px;max-height:90vh;background:var(--s,#111418);border:1px solid var(--br,rgba(255,255,255,.09));border-radius:14px;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 60px rgba(0,0,0,.6);animation:dpf-slide .22s ease-out;}',
      '.dpf-header{padding:18px 22px 14px;border-bottom:1px solid var(--br,rgba(255,255,255,.09));display:flex;align-items:flex-start;justify-content:space-between;gap:12px;background:linear-gradient(180deg,var(--s2,#181C22) 0%,var(--s,#111418) 100%);}',
      '.dpf-title{font-family:"Barlow Condensed",sans-serif;font-size:22px;font-weight:700;color:var(--t,#E8EAF0);text-transform:uppercase;letter-spacing:.04em;line-height:1.1;margin:0;}',
      '.dpf-subtitle{font-size:12px;color:var(--m,#6B7280);margin-top:4px;}',
      '.dpf-actions{display:flex;gap:8px;align-items:center;flex-shrink:0;}',
      '.dpf-icon-btn{background:var(--s3,#1E2229);border:1px solid var(--br,rgba(255,255,255,.09));color:var(--t,#E8EAF0);width:32px;height:32px;border-radius:8px;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;}',
      '.dpf-icon-btn:hover{background:var(--s2,#181C22);border-color:var(--orange,#e8720c);}',
      '.dpf-showall{background:var(--s3,#1E2229);border:1px solid var(--br,rgba(255,255,255,.09));color:var(--m,#6B7280);padding:6px 12px;border-radius:8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;cursor:pointer;transition:all .15s;}',
      '.dpf-showall:hover{color:var(--t,#E8EAF0);border-color:var(--orange,#e8720c);}',
      '.dpf-showall.active{color:var(--orange,#e8720c);border-color:var(--orange,#e8720c);background:rgba(232,114,12,.08);}',
      '.dpf-body{flex:1;overflow-y:auto;padding:20px 22px;scroll-behavior:smooth;}',
      '.dpf-body::-webkit-scrollbar{width:10px;}',
      '.dpf-body::-webkit-scrollbar-track{background:var(--s,#111418);}',
      '.dpf-body::-webkit-scrollbar-thumb{background:var(--s3,#1E2229);border-radius:5px;}',
      '.dpf-required-banner{background:rgba(232,114,12,.08);border:1px solid rgba(232,114,12,.25);border-radius:10px;padding:12px 14px;margin-bottom:18px;font-size:12px;color:var(--orange,#e8720c);display:flex;align-items:center;gap:10px;}',
      '.dpf-required-banner.hidden{display:none;}',
      '.dpf-section{margin-bottom:16px;border:1px solid var(--br,rgba(255,255,255,.09));border-radius:10px;background:var(--s2,#181C22);overflow:hidden;}',
      '.dpf-section-head{padding:12px 16px;display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;transition:background .15s;}',
      '.dpf-section-head:hover{background:var(--s3,#1E2229);}',
      '.dpf-section-title{font-family:"Barlow Condensed",sans-serif;font-size:14px;font-weight:700;color:var(--t,#E8EAF0);text-transform:uppercase;letter-spacing:.06em;margin:0;border-bottom:2px solid var(--orange,#e8720c);padding-bottom:3px;display:inline-block;}',
      '.dpf-section-chevron{font-size:16px;color:var(--m,#6B7280);transition:transform .2s;}',
      '.dpf-section.collapsed .dpf-section-chevron{transform:rotate(-90deg);}',
      '.dpf-section-body{padding:4px 16px 16px;}',
      '.dpf-section.collapsed .dpf-section-body{display:none;}',
      '.dpf-field{margin:12px 0;}',
      '.dpf-field-label{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--t,#E8EAF0);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;}',
      '.dpf-required-dot{width:6px;height:6px;border-radius:50%;background:var(--red,#E05252);display:inline-block;}',
      '.dpf-persist-badge{margin-left:auto;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;padding:2px 6px;border-radius:3px;}',
      '.dpf-persist-badge.lead{background:rgba(46,204,138,.12);color:var(--green,#2ECC8A);border:1px solid rgba(46,204,138,.3);}',
      '.dpf-persist-badge.document{background:rgba(155,109,255,.12);color:var(--purple,#9B6DFF);border:1px solid rgba(155,109,255,.3);}',
      '.dpf-persist-badge.ephemeral{background:var(--s3,#1E2229);color:var(--m,#6B7280);border:1px solid var(--br,rgba(255,255,255,.09));}',
      '.dpf-input,.dpf-textarea,.dpf-select{width:100%;background:var(--s,#111418);border:1px solid var(--br,rgba(255,255,255,.09));color:var(--t,#E8EAF0);padding:10px 12px;border-radius:8px;font-size:13px;font-family:inherit;box-sizing:border-box;transition:border-color .15s;}',
      '.dpf-input:focus,.dpf-textarea:focus,.dpf-select:focus{outline:none;border-color:var(--orange,#e8720c);box-shadow:0 0 0 2px rgba(232,114,12,.15);}',
      '.dpf-textarea{resize:vertical;min-height:60px;font-family:inherit;line-height:1.45;}',
      '.dpf-field.missing .dpf-input,.dpf-field.missing .dpf-textarea,.dpf-field.missing .dpf-select{border-color:var(--red,#E05252);}',
      '.dpf-field-help{font-size:11px;color:var(--m,#6B7280);margin-top:5px;line-height:1.4;}',
      '.dpf-field-error{font-size:11px;color:var(--red,#E05252);margin-top:5px;display:none;}',
      '.dpf-field.missing .dpf-field-error{display:block;}',
      '.dpf-currency-wrap{position:relative;}',
      '.dpf-currency-wrap::before{content:"$";position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--m,#6B7280);font-size:13px;pointer-events:none;}',
      '.dpf-currency-wrap .dpf-input{padding-left:24px;}',
      '.dpf-checkbox-wrap{display:flex;align-items:center;gap:10px;padding:8px 12px;background:var(--s,#111418);border:1px solid var(--br,rgba(255,255,255,.09));border-radius:8px;cursor:pointer;}',
      '.dpf-checkbox-wrap input{width:18px;height:18px;accent-color:var(--orange,#e8720c);cursor:pointer;}',
      '.dpf-checkbox-wrap span{font-size:13px;color:var(--t,#E8EAF0);}',
      '.dpf-line-items{border:1px solid var(--br,rgba(255,255,255,.09));border-radius:8px;background:var(--s,#111418);overflow:hidden;}',
      '.dpf-line-items-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--s3,#1E2229);border-bottom:1px solid var(--br,rgba(255,255,255,.09));gap:8px;flex-wrap:wrap;}',
      '.dpf-line-items-badge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--green,#2ECC8A);padding:3px 8px;background:rgba(46,204,138,.1);border:1px solid rgba(46,204,138,.3);border-radius:3px;}',
      '.dpf-line-items-badge.override{color:var(--purple,#9B6DFF);background:rgba(155,109,255,.1);border-color:rgba(155,109,255,.3);}',
      '.dpf-line-items-btns{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap;}',
      '.dpf-mini-btn{background:var(--s2,#181C22);border:1px solid var(--br,rgba(255,255,255,.09));color:var(--t,#E8EAF0);font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;padding:5px 9px;border-radius:5px;cursor:pointer;transition:all .15s;}',
      '.dpf-mini-btn:hover{border-color:var(--orange,#e8720c);color:var(--orange,#e8720c);}',
      '.dpf-mini-btn.danger:hover{border-color:var(--red,#E05252);color:var(--red,#E05252);}',
      '.dpf-li-table{width:100%;border-collapse:collapse;font-size:12px;}',
      '.dpf-li-table th{padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--m,#6B7280);border-bottom:1px solid var(--br,rgba(255,255,255,.09));font-weight:600;}',
      '.dpf-li-table td{padding:6px 8px;border-bottom:1px solid var(--br,rgba(255,255,255,.09));}',
      '.dpf-li-table tr:last-child td{border-bottom:none;}',
      '.dpf-li-table input{width:100%;background:transparent;border:1px solid transparent;color:var(--t,#E8EAF0);padding:6px 8px;font-size:12px;border-radius:4px;font-family:inherit;box-sizing:border-box;}',
      '.dpf-li-table input:focus{outline:none;border-color:var(--orange,#e8720c);background:var(--s2,#181C22);}',
      '.dpf-li-table input[readonly]{opacity:.75;cursor:default;}',
      '.dpf-li-table .dpf-li-qty,.dpf-li-table .dpf-li-rate,.dpf-li-table .dpf-li-total{text-align:right;}',
      '.dpf-li-table .col-desc{width:44%;}',
      '.dpf-li-table .col-qty{width:10%;}',
      '.dpf-li-table .col-unit{width:10%;}',
      '.dpf-li-table .col-rate{width:14%;}',
      '.dpf-li-table .col-total{width:16%;}',
      '.dpf-li-table .col-x{width:6%;}',
      '.dpf-li-x{background:transparent;border:none;color:var(--m,#6B7280);font-size:14px;cursor:pointer;padding:4px;}',
      '.dpf-li-x:hover{color:var(--red,#E05252);}',
      '.dpf-li-footer{padding:10px 12px;background:var(--s3,#1E2229);border-top:1px solid var(--br,rgba(255,255,255,.09));display:flex;align-items:center;justify-content:space-between;}',
      '.dpf-li-total-final{font-size:14px;font-weight:700;color:var(--orange,#e8720c);font-family:"Barlow Condensed",sans-serif;}',
      '.dpf-scope-list{display:flex;flex-direction:column;gap:6px;}',
      '.dpf-scope-row{display:flex;align-items:center;gap:6px;}',
      '.dpf-scope-row .dpf-input{flex:1;}',
      '.dpf-photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;padding:4px 0;}',
      '.dpf-photo-cell{position:relative;aspect-ratio:1;border-radius:6px;overflow:hidden;border:2px solid var(--br,rgba(255,255,255,.09));cursor:pointer;transition:all .15s;}',
      '.dpf-photo-cell img{width:100%;height:100%;object-fit:cover;display:block;}',
      '.dpf-photo-cell.selected{border-color:var(--orange,#e8720c);box-shadow:0 0 0 2px rgba(232,114,12,.25);}',
      '.dpf-photo-check{position:absolute;top:4px;right:4px;width:20px;height:20px;background:rgba(0,0,0,.7);border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;}',
      '.dpf-photo-cell.selected .dpf-photo-check{background:var(--orange,#e8720c);}',
      '.dpf-photo-phase{position:absolute;bottom:4px;left:4px;right:4px;background:rgba(0,0,0,.75);color:#fff;font-size:9px;text-transform:uppercase;letter-spacing:.06em;padding:2px 5px;border-radius:3px;text-align:center;}',
      '.dpf-photo-empty{grid-column:1/-1;padding:20px;text-align:center;color:var(--m,#6B7280);font-size:12px;border:1px dashed var(--br,rgba(255,255,255,.09));border-radius:6px;}',
      '.dpf-warranty-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;}',
      '.dpf-warranty-card{padding:14px 12px;border:2px solid var(--br,rgba(255,255,255,.09));border-radius:10px;background:var(--s,#111418);cursor:pointer;transition:all .15s;text-align:center;}',
      '.dpf-warranty-card:hover{border-color:var(--orange,#e8720c);}',
      '.dpf-warranty-card.selected{border-color:var(--orange,#e8720c);background:rgba(232,114,12,.06);}',
      '.dpf-warranty-name{font-family:"Barlow Condensed",sans-serif;font-size:18px;font-weight:700;text-transform:uppercase;color:var(--t,#E8EAF0);letter-spacing:.04em;}',
      '.dpf-warranty-tag{font-size:11px;color:var(--orange,#e8720c);margin-top:2px;font-weight:600;}',
      '.dpf-warranty-desc{font-size:10px;color:var(--m,#6B7280);margin-top:6px;line-height:1.4;}',
      '.dpf-footer{padding:14px 22px;border-top:1px solid var(--br,rgba(255,255,255,.09));background:var(--s2,#181C22);display:flex;gap:10px;align-items:center;}',
      '.dpf-btn-cancel{background:transparent;border:1px solid var(--br,rgba(255,255,255,.09));color:var(--m,#6B7280);padding:12px 20px;border-radius:8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;cursor:pointer;transition:all .15s;font-family:inherit;}',
      '.dpf-btn-cancel:hover{color:var(--t,#E8EAF0);border-color:var(--t,#E8EAF0);}',
      '.dpf-btn-submit{background:var(--orange,#e8720c);border:none;color:#fff;padding:12px 22px;border-radius:8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;cursor:pointer;transition:all .15s;flex:1;font-family:inherit;box-shadow:0 4px 12px rgba(232,114,12,.25);}',
      '.dpf-btn-submit:hover{background:var(--ob,#f08030);transform:translateY(-1px);box-shadow:0 6px 16px rgba(232,114,12,.35);}',
      '.dpf-btn-submit:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none;}',
      '@media (max-width:640px){',
      '  .dpf-overlay{padding:0;}',
      '  .dpf-card{max-width:100vw;max-height:100vh;border-radius:0;}',
      '  .dpf-warranty-grid{grid-template-columns:1fr;}',
      '  .dpf-li-table .col-desc{width:38%;}',
      '  .dpf-header{padding:14px 16px 10px;}',
      '  .dpf-body{padding:14px 16px;}',
      '  .dpf-footer{padding:12px 16px;flex-direction:column-reverse;}',
      '  .dpf-btn-cancel,.dpf-btn-submit{width:100%;}',
      '}'
    ].join('\n');
    var style = document.createElement('style');
    style.id = MODAL_STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 6: FIELD RENDERERS
  // ═══════════════════════════════════════════════════════════════

  function renderField(field, value) {
    var helpHTML = field.help ? '<div class="dpf-field-help">' + esc(field.help) + '</div>' : '';
    var errorHTML = '<div class="dpf-field-error">This field is required.</div>';
    var labelHTML = renderLabel(field);
    var bodyHTML = '';

    switch (field.type) {
      case 'text':
      case 'email':
      case 'tel':
        bodyHTML = '<input class="dpf-input" type="' + field.type + '" data-field="' + esc(field.key) + '" value="' + esc(value || '') + '" placeholder="' + esc(field.placeholder || '') + '">';
        break;
      case 'number':
        bodyHTML = '<input class="dpf-input" type="number" step="any" data-field="' + esc(field.key) + '" value="' + esc(value === 0 ? '0' : (value || '')) + '" placeholder="' + esc(field.placeholder || '') + '">';
        break;
      case 'date':
        bodyHTML = '<input class="dpf-input" type="date" data-field="' + esc(field.key) + '" value="' + esc(toDateInput(value) || value || '') + '">';
        break;
      case 'currency':
        bodyHTML = '<div class="dpf-currency-wrap"><input class="dpf-input" type="number" step="0.01" data-field="' + esc(field.key) + '" value="' + esc(value === 0 ? '0' : (value || '')) + '" placeholder="0.00"></div>';
        break;
      case 'textarea':
        bodyHTML = '<textarea class="dpf-textarea" rows="' + (field.rows || 3) + '" data-field="' + esc(field.key) + '" placeholder="' + esc(field.placeholder || '') + '">' + esc(value || '') + '</textarea>';
        break;
      case 'select':
        var optsHTML = (field.options || []).map(function (o) {
          var sel = String(o.value) === String(value) ? ' selected' : '';
          return '<option value="' + esc(o.value) + '"' + sel + '>' + esc(o.label) + '</option>';
        }).join('');
        bodyHTML = '<select class="dpf-select" data-field="' + esc(field.key) + '">' + (value ? '' : '<option value="">Select...</option>') + optsHTML + '</select>';
        break;
      case 'checkbox':
        var checked = (value === true || value === 'true' || value === 1 || value === '1') ? ' checked' : '';
        bodyHTML = '<label class="dpf-checkbox-wrap"><input type="checkbox" data-field="' + esc(field.key) + '"' + checked + '><span>' + esc(field.checkboxLabel || 'Yes') + '</span></label>';
        break;
      case 'line-items':
        bodyHTML = renderLineItems(field, value);
        break;
      case 'scope-list':
        bodyHTML = renderScopeList(field, value);
        break;
      case 'photo-selector':
        bodyHTML = renderPhotoSelector(field, value);
        break;
      case 'warranty-tier':
        bodyHTML = renderWarrantyTier(field, value);
        break;
      default:
        bodyHTML = '<input class="dpf-input" type="text" data-field="' + esc(field.key) + '" value="' + esc(value || '') + '">';
    }

    var missingCls = field.required && isEmpty(value) ? ' missing' : '';
    return '<div class="dpf-field' + missingCls + '" data-field-wrap="' + esc(field.key) + '">' +
      labelHTML + bodyHTML + helpHTML + errorHTML +
      '</div>';
  }

  function renderLabel(field) {
    var dot = field.required ? '<span class="dpf-required-dot" title="Required"></span>' : '';
    var badge = '<span class="dpf-persist-badge ' + field.persist + '" title="' + persistTooltip(field.persist) + '">' + persistLabel(field.persist) + '</span>';
    return '<div class="dpf-field-label">' + dot + esc(field.label) + badge + '</div>';
  }

  function persistLabel(p) {
    if (p === PERSIST.LEAD) return 'Updates customer';
    if (p === PERSIST.DOCUMENT) return 'This doc only';
    return 'Ephemeral';
  }

  function persistTooltip(p) {
    if (p === PERSIST.LEAD) return 'Edits saved to the customer record.';
    if (p === PERSIST.DOCUMENT) return 'Edits saved as an override for this document type only.';
    return 'Edits used once and discarded.';
  }

  function isEmpty(v) {
    if (v === null || v === undefined || v === '') return true;
    if (Array.isArray(v) && v.length === 0) return true;
    return false;
  }

  // ── LINE ITEMS RENDERER ─────────────────────────────────────
  function renderLineItems(field, value) {
    var items = Array.isArray(value) ? value : [];
    var mode = state.lineItemsMode[field.key] || 'locked';
    var readonly = mode === 'locked';
    var badgeCls = readonly ? '' : ' override';
    var badgeText = readonly ? 'From estimate' : 'Override mode';

    var overrideBtn = readonly
      ? '<button type="button" class="dpf-mini-btn" data-li-override="' + esc(field.key) + '">Override</button>'
      : '<button type="button" class="dpf-mini-btn danger" data-li-revert="' + esc(field.key) + '">Revert to estimate</button>';

    var addBtn = readonly ? '' : '<button type="button" class="dpf-mini-btn" data-li-add="' + esc(field.key) + '">+ Add item</button>';
    var saveBtn = readonly ? '' : '<button type="button" class="dpf-mini-btn" data-li-save-est="' + esc(field.key) + '">Save to estimate</button>';

    var rowsHTML = items.map(function (it, idx) {
      var qty = parseFloat(it.qty || 0);
      var rate = parseFloat(it.rate || 0);
      var total = (it.total !== undefined && it.total !== null && !isNaN(parseFloat(it.total))) ? parseFloat(it.total) : (qty * rate);
      var ro = readonly ? ' readonly' : '';
      var xBtn = readonly ? '' : '<button type="button" class="dpf-li-x" data-li-remove="' + esc(field.key) + '" data-idx="' + idx + '" title="Remove">&times;</button>';
      return '<tr>' +
        '<td class="col-desc"><input type="text" data-li-field="' + esc(field.key) + '" data-li-prop="description" data-idx="' + idx + '" value="' + esc(it.description || '') + '"' + ro + '></td>' +
        '<td class="col-qty dpf-li-qty"><input type="number" step="any" data-li-field="' + esc(field.key) + '" data-li-prop="qty" data-idx="' + idx + '" value="' + esc(qty) + '"' + ro + '></td>' +
        '<td class="col-unit"><input type="text" data-li-field="' + esc(field.key) + '" data-li-prop="unit" data-idx="' + idx + '" value="' + esc(it.unit || 'ea') + '"' + ro + '></td>' +
        '<td class="col-rate dpf-li-rate"><input type="number" step="any" data-li-field="' + esc(field.key) + '" data-li-prop="rate" data-idx="' + idx + '" value="' + esc(rate) + '"' + ro + '></td>' +
        '<td class="col-total dpf-li-total"><input type="number" step="any" data-li-field="' + esc(field.key) + '" data-li-prop="total" data-idx="' + idx + '" value="' + esc(total.toFixed(2)) + '"' + ro + '></td>' +
        (readonly ? '' : '<td class="col-x">' + xBtn + '</td>') +
      '</tr>';
    }).join('');

    if (!rowsHTML) {
      var colspan = readonly ? 5 : 6;
      rowsHTML = '<tr><td colspan="' + colspan + '" style="text-align:center;color:var(--m,#6B7280);padding:16px;font-size:11px;">No line items yet. Click Override to start adding.</td></tr>';
    }

    var grandTotal = items.reduce(function (sum, it) {
      var t = parseFloat(it.total);
      if (isNaN(t)) t = (parseFloat(it.qty) || 0) * (parseFloat(it.rate) || 0);
      return sum + t;
    }, 0);

    return '<div class="dpf-line-items">' +
      '<div class="dpf-line-items-head">' +
        '<span class="dpf-line-items-badge' + badgeCls + '">' + badgeText + '</span>' +
        '<div class="dpf-line-items-btns">' + overrideBtn + addBtn + saveBtn + '</div>' +
      '</div>' +
      '<table class="dpf-li-table"><thead><tr>' +
        '<th class="col-desc">Description</th>' +
        '<th class="col-qty dpf-li-qty">Qty</th>' +
        '<th class="col-unit">Unit</th>' +
        '<th class="col-rate dpf-li-rate">Rate</th>' +
        '<th class="col-total dpf-li-total">Total</th>' +
        (readonly ? '' : '<th class="col-x"></th>') +
      '</tr></thead><tbody>' + rowsHTML + '</tbody></table>' +
      '<div class="dpf-li-footer"><span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--m,#6B7280);">Grand Total</span><span class="dpf-li-total-final">' + fmtCurrency(grandTotal) + '</span></div>' +
    '</div>';
  }

  // ── SCOPE LIST RENDERER ─────────────────────────────────────
  function renderScopeList(field, value) {
    var items = Array.isArray(value) ? value : (value ? [value] : []);
    if (items.length === 0) items = [''];
    var rows = items.map(function (it, idx) {
      return '<div class="dpf-scope-row">' +
        '<span style="color:var(--orange,#e8720c);font-weight:700;">&bull;</span>' +
        '<input class="dpf-input" type="text" data-scope-field="' + esc(field.key) + '" data-idx="' + idx + '" value="' + esc(it) + '" placeholder="Scope item">' +
        '<button type="button" class="dpf-li-x" data-scope-remove="' + esc(field.key) + '" data-idx="' + idx + '" title="Remove">&times;</button>' +
      '</div>';
    }).join('');
    return '<div class="dpf-scope-list">' + rows + '</div>' +
      '<button type="button" class="dpf-mini-btn" style="margin-top:8px;" data-scope-add="' + esc(field.key) + '">+ Add scope item</button>';
  }

  // ── PHOTO SELECTOR RENDERER ─────────────────────────────────
  function renderPhotoSelector(field, value) {
    var allPool;
    if (field.source === 'photos.before') allPool = (window._allPhotos || []).filter(function (p) { return (p.phase || '').toLowerCase() === 'before'; });
    else if (field.source === 'photos.after') allPool = (window._allPhotos || []).filter(function (p) { return (p.phase || '').toLowerCase() === 'after'; });
    else if (field.source === 'photos.during') allPool = (window._allPhotos || []).filter(function (p) { return (p.phase || '').toLowerCase() === 'during'; });
    else allPool = window._allPhotos || [];

    if (!allPool.length) {
      return '<div class="dpf-photo-empty">No photos available for this customer.</div>';
    }

    var selectedIds = Array.isArray(value) ? value.map(function (p) { return typeof p === 'string' ? p : p.id; }).filter(Boolean) : [];

    var cells = allPool.map(function (p) {
      var isSel = selectedIds.indexOf(p.id) !== -1;
      var cls = isSel ? ' selected' : '';
      var phaseLabel = p.phase ? '<div class="dpf-photo-phase">' + esc(p.phase) + '</div>' : '';
      return '<div class="dpf-photo-cell' + cls + '" data-photo-field="' + esc(field.key) + '" data-photo-id="' + esc(p.id) + '">' +
        '<img src="' + esc(p.url) + '" alt="" loading="lazy">' +
        '<div class="dpf-photo-check">' + (isSel ? '&#10003;' : '') + '</div>' +
        phaseLabel +
      '</div>';
    }).join('');

    return '<div class="dpf-photo-grid">' + cells + '</div>';
  }

  // ── WARRANTY TIER RENDERER ──────────────────────────────────
  function renderWarrantyTier(field, value) {
    var tiers = [
      { id: 'good',   name: 'Good',   tag: '5-Year Workmanship',     desc: 'Covers defects in workmanship for 5 years.' },
      { id: 'better', name: 'Better', tag: '10-Year + Enhanced Mfr', desc: 'Comprehensive 10-year coverage, enhanced manufacturer.' },
      { id: 'best',   name: 'Best',   tag: 'Lifetime Workmanship',   desc: 'Lifetime workmanship, premium manufacturer.' }
    ];
    var cur = (value || 'better').toLowerCase();
    var cards = tiers.map(function (t) {
      var sel = t.id === cur ? ' selected' : '';
      return '<div class="dpf-warranty-card' + sel + '" data-warranty-field="' + esc(field.key) + '" data-warranty-tier="' + t.id + '">' +
        '<div class="dpf-warranty-name">' + t.name + '</div>' +
        '<div class="dpf-warranty-tag">' + t.tag + '</div>' +
        '<div class="dpf-warranty-desc">' + t.desc + '</div>' +
      '</div>';
    }).join('');
    return '<div class="dpf-warranty-grid">' + cards + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 7: MODAL ASSEMBLY
  // ═══════════════════════════════════════════════════════════════

  function renderModal() {
    var schema = state.schema;
    var sectionsHTML = schema.sections.map(function (sec) {
      var collapsed = (sec.collapsed && !state.showAll) ? ' collapsed' : '';
      var fieldsHTML = sec.fields.map(function (f) {
        return renderField(f, state.values[f.key]);
      }).join('');
      return '<div class="dpf-section' + collapsed + '" data-section="' + esc(sec.id) + '">' +
        '<div class="dpf-section-head" data-section-toggle="' + esc(sec.id) + '">' +
          '<h3 class="dpf-section-title">' + esc(sec.title) + '</h3>' +
          '<span class="dpf-section-chevron">&#9660;</span>' +
        '</div>' +
        '<div class="dpf-section-body">' + fieldsHTML + '</div>' +
      '</div>';
    }).join('');

    var missingCount = countMissingRequired();
    var bannerHTML = missingCount > 0
      ? '<div class="dpf-required-banner"><span style="font-size:14px;">&#9888;</span><span><strong>' + missingCount + ' required field' + (missingCount > 1 ? 's' : '') + '</strong> need attention before generating.</span></div>'
      : '<div class="dpf-required-banner hidden"></div>';

    var html =
      '<div class="dpf-overlay" id="' + MODAL_ID + '" data-dpf-overlay>' +
        '<div class="dpf-card" role="dialog" aria-labelledby="dpf-title">' +
          '<div class="dpf-header">' +
            '<div>' +
              '<h2 class="dpf-title" id="dpf-title">' + esc(schema.title) + '</h2>' +
              '<div class="dpf-subtitle">' + esc(schema.subtitle || 'Review before generating.') + '</div>' +
            '</div>' +
            '<div class="dpf-actions">' +
              '<button type="button" class="dpf-showall' + (state.showAll ? ' active' : '') + '" data-dpf-showall>' + (state.showAll ? 'Collapse' : 'Show all fields') + '</button>' +
              '<button type="button" class="dpf-icon-btn" data-dpf-close title="Close">&times;</button>' +
            '</div>' +
          '</div>' +
          '<div class="dpf-body">' +
            bannerHTML +
            sectionsHTML +
          '</div>' +
          '<div class="dpf-footer">' +
            '<button type="button" class="dpf-btn-cancel" data-dpf-close>Cancel</button>' +
            '<button type="button" class="dpf-btn-submit" data-dpf-submit>Generate Document &rarr;</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Remove any prior modal before re-inserting
    var prior = document.getElementById(MODAL_ID);
    if (prior) prior.remove();

    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    document.body.appendChild(wrap.firstChild);
    bindModalEvents();
  }

  function countMissingRequired() {
    var n = 0;
    Object.keys(state.fieldIndex).forEach(function (k) {
      var f = state.fieldIndex[k];
      if (f.required && isEmpty(state.values[k])) n++;
    });
    return n;
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 8: EVENT BINDING
  // ═══════════════════════════════════════════════════════════════

  /**
   * Bind events once using delegation at the modal root. Because all
   * handlers live on the root, a partial re-render via redrawField()
   * does not require rebinding — the fresh child elements are picked
   * up automatically by event bubbling.
   */
  function bindModalEvents() {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;

    // Remove any prior keydown handler (safe no-op if not attached)
    // then attach a fresh one so Esc only closes the current modal.
    document.removeEventListener('keydown', escHandler);
    document.addEventListener('keydown', escHandler);

    // Click delegation (handles overlay close, buttons, photo/warranty cards)
    modal.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      // Overlay backdrop click closes (only if clicking exactly the overlay)
      if (t.hasAttribute && t.hasAttribute('data-dpf-overlay')) { close(); return; }

      var closeBtn = t.closest ? t.closest('[data-dpf-close]') : null;
      if (closeBtn) { close(); return; }

      var showAllBtn = t.closest ? t.closest('[data-dpf-showall]') : null;
      if (showAllBtn) {
        state.showAll = !state.showAll;
        renderModal();
        return;
      }

      var secHead = t.closest ? t.closest('[data-section-toggle]') : null;
      if (secHead) {
        var sec = secHead.closest('.dpf-section');
        if (sec) sec.classList.toggle('collapsed');
        return;
      }

      // Line item buttons
      var overrideBtn = t.closest ? t.closest('[data-li-override]') : null;
      if (overrideBtn) {
        var k1 = overrideBtn.getAttribute('data-li-override');
        state.lineItemsMode[k1] = 'override';
        redrawField(k1);
        return;
      }
      var revertBtn = t.closest ? t.closest('[data-li-revert]') : null;
      if (revertBtn) {
        var k2 = revertBtn.getAttribute('data-li-revert');
        var est = (window._customerEstimates || [])[0];
        state.values[k2] = mapEstimateLineItems(est);
        state.lineItemsMode[k2] = 'locked';
        redrawField(k2);
        return;
      }
      var addBtn = t.closest ? t.closest('[data-li-add]') : null;
      if (addBtn) {
        var k3 = addBtn.getAttribute('data-li-add');
        var arr3 = Array.isArray(state.values[k3]) ? state.values[k3].slice() : [];
        arr3.push({ description: '', qty: 1, unit: 'ea', rate: 0, total: 0 });
        state.values[k3] = arr3;
        redrawField(k3);
        return;
      }
      var removeBtn = t.closest ? t.closest('[data-li-remove]') : null;
      if (removeBtn) {
        var k4 = removeBtn.getAttribute('data-li-remove');
        var idx4 = parseInt(removeBtn.getAttribute('data-idx'), 10);
        var arr4 = Array.isArray(state.values[k4]) ? state.values[k4].slice() : [];
        arr4.splice(idx4, 1);
        state.values[k4] = arr4;
        redrawField(k4);
        return;
      }
      var saveEstBtn = t.closest ? t.closest('[data-li-save-est]') : null;
      if (saveEstBtn) {
        var k5 = saveEstBtn.getAttribute('data-li-save-est');
        saveLineItemsToEstimate(k5);
        return;
      }

      // Scope list
      var scopeAdd = t.closest ? t.closest('[data-scope-add]') : null;
      if (scopeAdd) {
        var k6 = scopeAdd.getAttribute('data-scope-add');
        var arr6 = Array.isArray(state.values[k6]) ? state.values[k6].slice() : [];
        arr6.push('');
        state.values[k6] = arr6;
        redrawField(k6);
        return;
      }
      var scopeRem = t.closest ? t.closest('[data-scope-remove]') : null;
      if (scopeRem) {
        var k7 = scopeRem.getAttribute('data-scope-remove');
        var idx7 = parseInt(scopeRem.getAttribute('data-idx'), 10);
        var arr7 = Array.isArray(state.values[k7]) ? state.values[k7].slice() : [];
        arr7.splice(idx7, 1);
        if (arr7.length === 0) arr7.push('');
        state.values[k7] = arr7;
        redrawField(k7);
        return;
      }

      // Photo selector
      var photoCell = t.closest ? t.closest('[data-photo-field]') : null;
      if (photoCell) {
        var k8 = photoCell.getAttribute('data-photo-field');
        var id8 = photoCell.getAttribute('data-photo-id');
        var current = Array.isArray(state.values[k8]) ? state.values[k8].slice() : [];
        var ids = current.map(function (p) { return typeof p === 'string' ? p : (p && p.id); });
        var pos = ids.indexOf(id8);
        if (pos === -1) {
          var photo = (window._allPhotos || []).find(function (p) { return p.id === id8; });
          if (photo) current.push(photo);
        } else {
          current.splice(pos, 1);
        }
        state.values[k8] = current;
        redrawField(k8);
        return;
      }

      // Warranty tier card
      var warrantyCard = t.closest ? t.closest('[data-warranty-field]') : null;
      if (warrantyCard) {
        var k9 = warrantyCard.getAttribute('data-warranty-field');
        var tier = warrantyCard.getAttribute('data-warranty-tier');
        state.values[k9] = tier;
        redrawField(k9);
        return;
      }

      // Submit
      var submitBtn = t.closest ? t.closest('[data-dpf-submit]') : null;
      if (submitBtn) {
        submit();
        return;
      }
    });

    // Input delegation — handles all simple fields (text/textarea/select/etc)
    // plus line-items and scope-list inputs
    var inputHandler = function (e) {
      var el = e.target;
      if (!el) return;

      // Simple field
      if (el.hasAttribute && el.hasAttribute('data-field')) {
        var key = el.getAttribute('data-field');
        var v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'number') v = el.value === '' ? '' : parseFloat(el.value);
        else v = el.value;
        state.values[key] = v;
        updateFieldMissingState(key);
        return;
      }

      // Line item cell
      if (el.hasAttribute && el.hasAttribute('data-li-field')) {
        var key2 = el.getAttribute('data-li-field');
        var prop = el.getAttribute('data-li-prop');
        var idx = parseInt(el.getAttribute('data-idx'), 10);
        var arr = Array.isArray(state.values[key2]) ? state.values[key2] : [];
        if (!arr[idx]) arr[idx] = {};
        var v2 = el.value;
        if (prop === 'qty' || prop === 'rate' || prop === 'total') {
          v2 = v2 === '' ? '' : parseFloat(v2);
        }
        arr[idx][prop] = v2;
        if (prop === 'qty' || prop === 'rate') {
          var qty = parseFloat(arr[idx].qty) || 0;
          var rate = parseFloat(arr[idx].rate) || 0;
          arr[idx].total = qty * rate;
          var totalEl = modal.querySelector('[data-li-field="' + CSS.escape(key2) + '"][data-li-prop="total"][data-idx="' + idx + '"]');
          if (totalEl) totalEl.value = (qty * rate).toFixed(2);
        }
        state.values[key2] = arr;
        updateLineItemsGrandTotal(key2);
        return;
      }

      // Scope list item
      if (el.hasAttribute && el.hasAttribute('data-scope-field')) {
        var key3 = el.getAttribute('data-scope-field');
        var idx3 = parseInt(el.getAttribute('data-idx'), 10);
        var arr3 = Array.isArray(state.values[key3]) ? state.values[key3].slice() : [];
        arr3[idx3] = el.value;
        state.values[key3] = arr3;
        return;
      }
    };
    modal.addEventListener('input', inputHandler);
    modal.addEventListener('change', inputHandler);
  }

  function escHandler(e) {
    if (e.key === 'Escape' && state.open) close();
  }

  function updateFieldMissingState(key) {
    var wrap = document.querySelector('[data-field-wrap="' + CSS.escape(key) + '"]');
    if (!wrap) return;
    var f = state.fieldIndex[key];
    if (!f) return;
    if (f.required && isEmpty(state.values[key])) wrap.classList.add('missing');
    else wrap.classList.remove('missing');
    // Update banner count
    var banner = document.querySelector('#' + MODAL_ID + ' .dpf-required-banner');
    if (banner) {
      var n = countMissingRequired();
      if (n > 0) {
        banner.classList.remove('hidden');
        banner.innerHTML = '<span style="font-size:14px;">&#9888;</span><span><strong>' + n + ' required field' + (n > 1 ? 's' : '') + '</strong> need attention before generating.</span>';
      } else {
        banner.classList.add('hidden');
      }
    }
  }

  function updateLineItemsGrandTotal(key) {
    var modal = document.getElementById(MODAL_ID);
    if (!modal) return;
    var arr = state.values[key] || [];
    var total = arr.reduce(function (sum, it) {
      var t = parseFloat(it.total);
      if (isNaN(t)) t = (parseFloat(it.qty) || 0) * (parseFloat(it.rate) || 0);
      return sum + t;
    }, 0);
    var wrap = modal.querySelector('[data-field-wrap="' + CSS.escape(key) + '"]');
    if (!wrap) return;
    var el = wrap.querySelector('.dpf-li-total-final');
    if (el) el.textContent = fmtCurrency(total);
  }

  /**
   * Re-render a single field in place (for structural changes like
   * adding/removing rows). Event listeners live on the modal root via
   * delegation, so no rebinding is needed after replacing children.
   */
  function redrawField(key) {
    var wrap = document.querySelector('[data-field-wrap="' + CSS.escape(key) + '"]');
    if (!wrap) return;
    var f = state.fieldIndex[key];
    if (!f) return;
    var fragment = document.createElement('div');
    fragment.innerHTML = renderField(f, state.values[key]);
    var newEl = fragment.firstChild;
    wrap.parentNode.replaceChild(newEl, wrap);
    updateLineItemsGrandTotal(key);
    updateFieldMissingState(key);
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 9: PERSISTENCE
  // ═══════════════════════════════════════════════════════════════

  /**
   * Split current values into leadUpdates vs docOverrides and persist.
   * @param {string} customerId
   * @param {object} leadUpdates
   * @param {string} docType
   * @param {object} docOverrides
   */
  async function applyDocEdits(customerId, leadUpdates, docType, docOverrides) {
    if (!customerId) return;
    if (!window.db || !window.doc || !window.updateDoc || !window.serverTimestamp) {
      console.warn('[DocPreflight] Firestore helpers missing; skipping persistence.');
      return;
    }
    var updates = {};
    Object.keys(leadUpdates || {}).forEach(function (k) { updates[k] = leadUpdates[k]; });
    if (docOverrides && Object.keys(docOverrides).length) {
      updates['docOverrides.' + docType] = docOverrides;
    }
    if (!Object.keys(updates).length) return;
    updates.updatedAt = window.serverTimestamp();
    try {
      await window.updateDoc(window.doc(window.db, 'leads', customerId), updates);
    } catch (err) {
      console.error('[DocPreflight] Persist failed', err);
      toast('Failed to save edits: ' + (err && err.message ? err.message : 'unknown error'), 'error');
      throw err;
    }
  }

  /**
   * Save the current line-items state back onto the underlying estimate document.
   */
  async function saveLineItemsToEstimate(fieldKey) {
    var est = (window._customerEstimates || [])[0];
    if (!est || !est.id) {
      toast('No estimate found to update.', 'error');
      return;
    }
    if (!window.db || !window.doc || !window.updateDoc) {
      toast('Firestore not available.', 'error');
      return;
    }
    var items = state.values[fieldKey] || [];
    var mapped = items.map(function (it) {
      var qty = parseFloat(it.qty) || 0;
      var rate = parseFloat(it.rate) || 0;
      var amount = parseFloat(it.total);
      if (isNaN(amount)) amount = qty * rate;
      return {
        description: it.description || '',
        quantity: qty,
        unit: it.unit || 'ea',
        unitPrice: rate,
        amount: amount
      };
    });
    var grandTotal = mapped.reduce(function (s, i) { return s + (parseFloat(i.amount) || 0); }, 0);
    try {
      await window.updateDoc(window.doc(window.db, 'estimates', est.id), {
        lineItems: mapped,
        grandTotal: grandTotal,
        updatedAt: window.serverTimestamp ? window.serverTimestamp() : new Date()
      });
      // Mutate cached copy so subsequent fields see it
      est.lineItems = mapped;
      est.grandTotal = grandTotal;
      toast('Line items saved to estimate.', 'success');
    } catch (err) {
      console.error('[DocPreflight] Save to estimate failed', err);
      toast('Failed to save to estimate: ' + (err && err.message ? err.message : 'unknown error'), 'error');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 10: OPEN / CLOSE / SUBMIT
  // ═══════════════════════════════════════════════════════════════

  /**
   * Open the pre-flight modal for a doc type.
   * @param {string} type      — doc type key
   * @param {string} customerId — current lead id
   */
  function open(type, customerId) {
    if (!DOC_SCHEMAS[type]) {
      console.warn('[DocPreflight] No schema for type:', type, '— falling back to direct generate.');
      if (window.NBDDocGen && typeof window.NBDDocGen.generate === 'function') {
        var fallbackData = typeof window.getCustomerDocData === 'function' ? window.getCustomerDocData() : {};
        window.NBDDocGen.generate(type, fallbackData);
      }
      return;
    }

    injectStyles();

    // Hydrate context
    var lead = window._leadDoc || {};
    var estimate = (window._customerEstimates || [])[0] || null;
    var photos = window._allPhotos || [];
    var overrides = (lead.docOverrides && lead.docOverrides[type]) || {};

    var ctx = { lead: lead, estimate: estimate, photos: photos, overrides: overrides };
    var schema = DOC_SCHEMAS[type];
    var values = {};
    var fieldIndex = {};
    var lineItemsMode = {};

    schema.sections.forEach(function (sec) {
      sec.fields.forEach(function (field) {
        values[field.key] = resolveFieldValue(field, ctx);
        fieldIndex[field.key] = field;
        if (field.type === 'line-items') lineItemsMode[field.key] = 'locked';
      });
    });

    state.open = true;
    state.type = type;
    state.customerId = customerId || window._customerId || null;
    state.schema = schema;
    state.values = values;
    state.fieldIndex = fieldIndex;
    state.lineItemsMode = lineItemsMode;
    state.showAll = false;

    renderModal();
  }

  function close() {
    var m = document.getElementById(MODAL_ID);
    if (m) m.remove();
    document.removeEventListener('keydown', escHandler);
    state.open = false;
    state.type = null;
    state.schema = null;
    state.values = {};
    state.fieldIndex = {};
  }

  /**
   * Validate, persist, and fire the document generator.
   */
  async function submit() {
    // Validate required fields
    var missing = [];
    Object.keys(state.fieldIndex).forEach(function (k) {
      var f = state.fieldIndex[k];
      if (f.required && isEmpty(state.values[k])) missing.push(f.label);
    });
    if (missing.length) {
      toast('Missing required fields: ' + missing.join(', '), 'error');
      // Re-run render to highlight missing and expand their sections
      state.showAll = true;
      renderModal();
      return;
    }

    // Split updates by persist destination
    var leadUpdates = {};
    var docOverrides = {};
    var mergedData = {};
    Object.keys(state.fieldIndex).forEach(function (k) {
      var f = state.fieldIndex[k];
      var v = state.values[k];
      mergedData[k] = v;
      if (f.persist === PERSIST.LEAD) {
        leadUpdates[k] = v;
      } else if (f.persist === PERSIST.DOCUMENT) {
        docOverrides[k] = v;
      }
    });

    // Derive extra fields the templates expect
    hydrateDerivedFields(mergedData);

    // Persist
    var submitBtn = document.querySelector('[data-dpf-submit]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }

    try {
      if (state.customerId) {
        await applyDocEdits(state.customerId, leadUpdates, state.type, docOverrides);
      }
    } catch (err) {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Generate Document →'; }
      return;
    }

    // Fire generator
    if (window.NBDDocGen && typeof window.NBDDocGen.generate === 'function') {
      try {
        window.NBDDocGen.generate(state.type, mergedData);
      } catch (err) {
        console.error('[DocPreflight] Generator threw', err);
        toast('Generator failed: ' + (err && err.message ? err.message : 'unknown error'), 'error');
      }
    } else {
      toast('Document generator not loaded.', 'error');
    }

    // Log the generated doc in the history list if helper exists
    if (typeof window.logGeneratedDoc === 'function') {
      try { window.logGeneratedDoc(state.type, mergedData); } catch (e) { /* ignore */ }
    }

    close();
  }

  /**
   * Add template-convenience fields that the NBDDocGen templates expect
   * but that we don't expose directly in the schema.
   */
  function hydrateDerivedFields(data) {
    // Names
    if (!data.homeownerName) {
      data.homeownerName = ((data.firstName || '') + ' ' + (data.lastName || '')).trim();
    }
    data.customerName = data.homeownerName;
    data.claimantName = data.homeownerName;

    // Address aliases
    data.homeownerAddress = data.address || data.homeownerAddress || '';
    data.propertyAddress = data.address || '';

    // Date fallback
    if (!data.date) {
      data.date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    // Currency display version of totalPrice when supplied as number
    if (data.totalPrice !== undefined && data.totalPrice !== null && data.totalPrice !== '') {
      var tp = parseFloat(data.totalPrice);
      if (!isNaN(tp)) {
        data.totalPrice = '$' + tp.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
    }
    if (data.contractPrice === undefined && data.totalPrice) data.contractPrice = data.totalPrice;
    if (data.estimateAmount === undefined && data.totalPrice) data.estimateAmount = data.totalPrice;
    if (data.estimatedRepairCost !== undefined && data.estimatedRepairCost !== null && data.estimatedRepairCost !== '') {
      var rc = parseFloat(data.estimatedRepairCost);
      if (!isNaN(rc)) {
        data.estimatedRepairCost = '$' + rc.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
    }

    // Line items: templates expect qty/unitPrice/total on each row
    if (Array.isArray(data.lineItems)) {
      data.lineItems = data.lineItems.map(function (it) {
        var qty = parseFloat(it.qty || it.quantity || 1) || 1;
        var unitPrice = parseFloat(it.rate || it.unitPrice || 0) || 0;
        var total = parseFloat(it.total || it.amount);
        if (isNaN(total)) total = qty * unitPrice;
        return {
          description: it.description || '',
          qty: qty,
          unit: it.unit || 'ea',
          unitPrice: unitPrice,
          total: total
        };
      });
    }

    // Photos array: flatten to url list for templates that expect urls
    if (Array.isArray(data.photos)) {
      data.photoUrls = data.photos.map(function (p) { return typeof p === 'string' ? p : p.url; }).filter(Boolean);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 11: PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  window.DocPreflight = {
    open: open,
    close: close,
    submit: submit,
    DOC_SCHEMAS: DOC_SCHEMAS,
    // Internal helpers exposed for debugging / testing only:
    _state: state,
    _resolveFieldValue: resolveFieldValue,
    _applyDocEdits: applyDocEdits
  };

})();
