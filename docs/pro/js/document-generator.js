/**
 * NBD Home Solutions - Document Generation Engine
 *
 * Professional document generator for roofing/exterior contracting CRM.
 * Generates magazine-quality branded documents as HTML that can be printed to PDF.
 *
 * Exposes: window.NBDDocGen
 */

/**
 * Core NBD Document Generator
 * @namespace window.NBDDocGen
 */
window.NBDDocGen = {
  // ============================================================================
  // SECTION 1: CONSTANTS & CONFIGURATION
  // ============================================================================

  /**
   * Company branding and contact information
   */
  COMPANY: {
    name: 'No Big Deal Home Solutions',
    phone: '(859) 420-7382',
    email: 'info@nobigdealwithjoedeal.com',
    website: 'nobigdealwithjoedeal.com',
    tagline: 'No Big Deal — We\'ve Got You Covered',
    address: '', // Optional
    colors: {
      primary: '#1e3a6e',    // Navy blue (matches website brand)
      secondary: '#1a1a2e',  // Dark navy
      accent: '#e8720c',     // Brand orange (matches site brand)
      lightGray: '#f5f5f5',
      borderGray: '#ddd'
    }
  },

  /**
   * Warranty tier definitions with descriptions
   */
  WARRANTY_TIERS: {
    good: {
      name: 'Good',
      workmanship: '5-Year',
      manufacturer: 'Standard',
      description: '5-Year Workmanship Warranty + Standard Manufacturer Warranty',
      details: 'Covers defects in workmanship for 5 years. Manufacturer warranties vary by material.'
    },
    better: {
      name: 'Better',
      workmanship: '10-Year',
      manufacturer: 'Enhanced',
      description: '10-Year Workmanship Warranty + Enhanced Manufacturer Warranty',
      details: 'Comprehensive coverage for 10 years including labor and materials. Enhanced manufacturer coverage on select products.'
    },
    best: {
      name: 'Best',
      workmanship: 'Lifetime',
      manufacturer: 'Premium',
      description: 'Lifetime Workmanship Warranty + Premium Manufacturer Warranty',
      details: 'Premium protection covering all workmanship for the life of the structure. Maximum manufacturer coverage on premium materials.'
    }
  },

  /**
   * Registry of available document types
   */
  DOCUMENT_TYPES: {
    // 4 dedicated templates with custom render functions
    proposal:              { name: 'Proposal / Estimate',             template: 'renderProposal' },
    contract:              { name: 'Roofing Contract',                template: 'renderContract' },
    inspectionHomeowner:   { name: 'Inspection Report (Homeowner)',   template: 'renderInspectionHomeowner' },
    inspectionInsurance:   { name: 'Inspection Report (Insurance)',   template: 'renderInspectionInsurance' },
    // 20 document types with dedicated render functions in
    // document-generator-templates.js. Each produces a fully branded,
    // professional document specific to its purpose. Falls back to
    // renderGenericDoc if the template file isn't loaded yet.
    invoice:               { name: 'Invoice',                         template: 'renderInvoice' },
    customer_report:       { name: 'Customer Report',                 template: 'renderCustomerReport' },
    warranty_certificate:  { name: 'Warranty Certificate',            template: 'renderWarrantyCertificate' },
    certificate_of_completion: { name: 'Certificate of Completion',   template: 'renderCertificateOfCompletion' },
    supplement_request:    { name: 'Supplement Request',              template: 'renderSupplementRequest' },
    scope_of_work:         { name: 'Scope of Work',                   template: 'renderScopeOfWork' },
    assignment_of_benefits:{ name: 'Assignment of Benefits',          template: 'renderAssignmentOfBenefits' },
    change_order:          { name: 'Change Order',                    template: 'renderChangeOrder' },
    work_authorization:    { name: 'Work Authorization',              template: 'renderWorkAuthorization' },
    payment_agreement:     { name: 'Payment Agreement',               template: 'renderPaymentAgreement' },
    material_delivery:     { name: 'Material Delivery Receipt',       template: 'renderMaterialDelivery' },
    thank_you:             { name: 'Thank You Letter',                template: 'renderThankYou' },
    company_intro:         { name: 'Company Introduction',            template: 'renderCompanyIntro' },
    financing_options:     { name: 'Financing Options',               template: 'renderFinancingOptions' },
    storm_checklist:       { name: 'Storm Damage Checklist',          template: 'renderStormChecklist' },
    claim_guide:           { name: 'Insurance Claim Guide',           template: 'renderClaimGuide' },
    referral_card:         { name: 'Referral Card',                   template: 'renderReferralCard' },
    before_after_report:   { name: 'Before & After Report',           template: 'renderBeforeAfterReport' },
    door_hanger:           { name: 'Door Hanger',                     template: 'renderDoorHanger' },
    neighborhood_mailer:   { name: 'Neighborhood Mailer',             template: 'renderNeighborhoodMailer' },
    testimonial_sheet:     { name: 'Testimonial Sheet',               template: 'renderTestimonialSheet' }
  },

  // ============================================================================
  // SECTION 2: CORE ENGINE METHODS
  // ============================================================================

  /**
   * Generate document and open in new window with print button
   * @param {string} type - Document type (proposal, contract, inspectionHomeowner, inspectionInsurance)
   * @param {object} data - Merge field data
   */
  async generate(type, data = {}) {
    // Pass the document type through data so renderGenericDoc can
    // use it for the title (the generic template handles 20+ types).
    data._documentType = type;

    // Attach the merged shop-wide profile so every render function reads
    // editable legal text / financing / marketing from one place. Lead-
    // level overrides on `data` still win — render functions should look
    // up `data.foo ?? data.companyProfile.foo`.
    data.companyProfile = (window._companyProfile && typeof window._companyProfile === 'object')
      ? window._companyProfile
      : (window.NBD_COMPANY_PROFILE_DEFAULTS || {});

    // ─── D-5: try server-side Puppeteer render first ───
    // Supported types: contract / invoice / change_order. Receipt is
    // a future call site (no client surface yet). Falls through to
    // the legacy renderer on any error so reps are never blocked.
    const SERVER_TYPE_MAP = {
      contract:     'contract',
      invoice:      'invoice',
      change_order: 'changeOrder',
      receipt:      'receipt',
    };
    if (SERVER_TYPE_MAP[type]) {
      try {
        const ok = await this._tryServerRender(SERVER_TYPE_MAP[type], type, data);
        if (ok) return;
      } catch (e) {
        console.warn('[NBDDocGen] server render failed, falling back:', e && e.message || e);
      }
    }

    let html = this.getHTML(type, data);
    if (!html) {
      if(typeof showToast==='function') showToast('Document type not found','error'); else console.error('Document type not found:', type);
      return;
    }
    // Blank-preview watermark. Set by _blankifyDocData() on
    // customer.html when the rep uses the "Preview blank template"
    // escape hatch (either from the doc-template ⓘ icon or the
    // Can't-Generate prereq modal). Stamped here, in one place, so
    // every template type picks it up without per-template work.
    if (data && data._isBlankPreview && /<\/body>/i.test(html)) {
      const wm = '<div data-nbd-watermark="blank-preview" style="position:fixed;top:14px;left:50%;transform:translateX(-50%);background:#fef9c3;color:#92400e;border:1px solid #f59e0b;border-radius:8px;padding:6px 14px;font:700 11px/1 Barlow,sans-serif;letter-spacing:.12em;text-transform:uppercase;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,.15);pointer-events:none;white-space:nowrap;">&#9888;&#65039; Blank Preview &middot; Not for Delivery</div>';
      html = html.replace(/<\/body>/i, wm + '</body>');
    }
    const typeName = this.DOCUMENT_TYPES[type]?.name || type;
    // Route through the Universal Document Viewer so the user
    // can Save / Email / Print / PDF / Close without being dumped
    // into a blank popup with no way to persist the doc.
    if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
      const customerName = (data.customer && (data.customer.name || data.customer.firstName)) || '';
      const slug = (customerName || typeName).replace(/[^A-Za-z0-9]+/g, '-').substring(0, 40);

      // Persist on generate — not on Save. The previous flow only ran
      // the persist callback when the user explicitly tapped "Save"
      // inside the doc viewer; closing the viewer (or downloading a
      // PDF) without saving meant nothing was recorded. Now we kick
      // off the persistence in the background as soon as generate()
      // is called and use the doc id later in the onSave hook for
      // any post-processing. The HTML body is also uploaded to
      // Storage so the customer page can re-open the rendered
      // document later — previously only PDF + memory existed.
      const _leadIdEarly = data.leadId || (data.customer && data.customer.id) || window._customerId || null;
      const _filename = 'NBD-' + slug + '-' + new Date().toISOString().split('T')[0] + '.pdf';
      let _persistPromise = null;
      if (_leadIdEarly && window.db && window.addDoc && window.collection) {
        _persistPromise = (async () => {
          let htmlPath = null;
          let htmlUrl = null;
          // Upload the rendered HTML to Storage so we can re-open it
          // from the documents tab later. Best-effort — if Storage
          // isn't wired on this page we still record metadata.
          try {
            if (window.storage && window.ref && window.uploadBytes && window.getDownloadURL && window._user?.uid) {
              const docId = 'd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
              htmlPath = `documents/${window._user.uid}/${_leadIdEarly}/${docId}.html`;
              const sRef = window.ref(window.storage, htmlPath);
              const blob = new Blob([html], { type: 'text/html' });
              await window.uploadBytes(sRef, blob, { contentType: 'text/html' });
              htmlUrl = await window.getDownloadURL(sRef);
            }
          } catch (e) {
            console.warn('Document HTML upload failed:', e && e.message);
          }
          try {
            await window.addDoc(
              window.collection(window.db, 'leads', _leadIdEarly, 'documents'),
              {
                type: type,
                typeName: typeName,
                customerName: customerName || null,
                filename: _filename,
                htmlPath: htmlPath,
                htmlUrl: htmlUrl,
                createdAt: window.serverTimestamp ? window.serverTimestamp() : new Date(),
                createdBy: window.auth?.currentUser?.email || window._user?.email || 'unknown',
                userId: window.auth?.currentUser?.uid || window._user?.uid || null,
                snapshot: {
                  total: (data.estimate && data.estimate.grandTotal) || data.total || null,
                  address: (data.customer && data.customer.address) || null
                }
              }
            );
          } catch (e) {
            console.warn('Document metadata persist failed:', e && e.message);
          }
        })();
      }
      window.NBDDocViewer.open({
        html: html,
        title: typeName + (customerName ? ' — ' + customerName : ''),
        filename: _filename,
        onSave: async () => {
          // Persistence already kicked off in the background via
          // _persistPromise above \u2014 wait for it (no-op if already
          // settled) so the success toast reflects the real state.
          if (_persistPromise) { try { await _persistPromise; } catch (_) {} }
          if (typeof showToast === 'function') {
            showToast('\u2713 Document generated \u2014 use Print or Download PDF to save a copy', 'success');
          }
        }
      });
      return;
    }
    // Fallback: legacy popup if the doc viewer isn't loaded
    const win = window.open('', '_blank');
    if (!win) {
      if(typeof showToast==='function') showToast('Popup blocked — please allow popups for this site and try again.','error');
      else alert('Please allow popups for this site to generate documents.');
      return;
    }
    // Inject action bar before closing </body>
    const actionBar = `
      <div class="doc-action-bar">
        <div class="doc-bar-left">
          <button class="doc-bar-btn doc-bar-close" data-dg-action="closeWindow">&#x2190; Close</button>
          <span class="doc-bar-title">${typeName}</span>
        </div>
        <div class="doc-bar-right">
          <button class="doc-bar-btn doc-bar-print" data-dg-action="print">Print / Save PDF</button>
        </div>
      </div>`;
    const injected = html.replace('</body>', actionBar + '</body>');
    win.document.write(injected);
    win.document.close();
  },

  /**
   * D-5: Server-side render via the renderPdf callable.
   * @param {string} template - Server-side template key (e.g. 'contract')
   * @param {string} type     - Original NBDDocGen type (used for filename)
   * @param {object} data     - Merge data, mapped to template payload
   */
  async _tryServerRender(template, type, data) {
    if (!window._functions || !window._httpsCallable) {
      const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
      window._functions = mod.getFunctions();
      window._httpsCallable = mod.httpsCallable;
    }
    const payload = this._buildServerPayload(template, data);
    if (!payload) return false;

    if (typeof showToast === 'function') showToast('Rendering ' + (this.DOCUMENT_TYPES[type]?.name || type) + '…', 'info');

    const customerName = (payload.preparedFor && payload.preparedFor.name) || 'NBD-Doc';
    const slug = customerName.replace(/[^A-Za-z0-9]+/g, '-').substring(0, 40);
    const filename = 'NBD-' + (this.DOCUMENT_TYPES[type]?.name || type).replace(/\s+/g, '-') + '-' + slug + '-' + new Date().toISOString().split('T')[0] + '.pdf';

    const fn = window._httpsCallable(window._functions, 'renderPdf');
    const r = await fn({ template, payload, filename });
    const respData = r && r.data;
    if (!respData || !respData.ok || !respData.url) throw new Error('Render returned no URL');

    if (window.NBDDocViewer && typeof window.NBDDocViewer.open === 'function') {
      window.NBDDocViewer.open({
        url: respData.url,
        title: (this.DOCUMENT_TYPES[type]?.name || type) + (customerName ? ' — ' + customerName : ''),
        filename: respData.filename || filename,
      });
    } else {
      window.open(respData.url, '_blank', 'noopener');
    }
    const ms = respData.timing && respData.timing.totalMs;
    if (typeof showToast === 'function') {
      showToast(ms ? '✓ Document rendered in ' + ms + 'ms' : '✓ Document rendered', 'success');
    }
    return true;
  },

  /**
   * D-5: Map NBDDocGen legacy data to the new template payload shape.
   * Centralizes the conversion so the templates stay the only place
   * that knows the doc structure.
   */
  _buildServerPayload(template, data) {
    const customer = data.customer || {};
    const fullName = customer.name
      || ((customer.firstName || '') + ' ' + (customer.lastName || '')).trim()
      || data.homeownerName
      || 'Homeowner';
    const address = customer.address || data.address || '';
    const lead = (window._leads || []).find(l =>
      (l.address && address && l.address.trim() === String(address).trim()) ||
      (l.id && (l.id === customer.id || l.id === data.leadId))
    );

    const preparedFor = {
      name: fullName,
      address,
      customerId: (lead && lead.customerId) || customer.customerId || null,
      projectLine: data.projectLine || null,
    };
    const preparedBy = {
      name:  (window._user && window._user.displayName) || 'Joe Deal',
      role:  'Project Owner · No Big Deal Home Solutions',
      phone: '(859) 420-7382',
      email: 'jd@nobigdealwithjoedeal.com',
    };
    const todayStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    // ── Per-template payload shaping ──
    if (template === 'invoice') {
      const lines = (data.lineItems || data.lines || []).map(i => ({
        description: i.description || i.name || '',
        category:    i.category || '',
        quantity:    i.qty || i.quantity || 1,
        unit:        i.unit || 'ea',
        unitPrice:   Number(i.rate || i.unitPrice || 0),
        lineTotal:   Number(i.lineTotal || ((i.qty || i.quantity || 1) * (i.rate || i.unitPrice || 0))),
      }));
      const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
      const tax = Number(data.tax || (subtotal * (data.taxRate || 0)));
      const paymentsReceived = Number(data.paymentsReceived || 0);
      const total = subtotal + tax;
      const balanceDue = total - paymentsReceived;
      return {
        coverTagline: 'Final billing<br>for your project.',
        coverSub:     'Itemized invoice with payment detail and remaining balance. Pay online, by check, or by ACH.',
        preparedFor, preparedBy,
        projectMeta: [
          { label: 'Invoice Date', value: data.invoiceDate || todayStr },
          { label: 'Invoice No.',  value: data.invoiceNumber || ('INV-' + Date.now().toString().slice(-6)) },
          { label: 'Due',          value: data.dueDate || 'Upon receipt' },
        ],
        summary: {
          headline: 'Invoice for completed work.',
          body: data.notes || null,
        },
        invoice: {
          number: data.invoiceNumber, date: data.invoiceDate || todayStr, dueDate: data.dueDate, status: data.status || 'due',
        },
        lines, subtotal, tax, paymentsReceived, total, balanceDue,
        notes: data.notes || null,
        payUrl: data.payUrl || null,
      };
    }

    if (template === 'contract') {
      return {
        coverTagline: 'The work,<br>committed in writing.',
        coverSub:     'A complete agreement covering scope, price, schedule, payment terms, and warranty. Both parties sign at the foot.',
        preparedFor, preparedBy,
        projectMeta: [
          { label: 'Contract Date', value: data.contractDate || todayStr },
          { label: 'Contract No.',  value: data.contractNumber || ('CT-' + Date.now().toString().slice(-6)) },
          { label: 'Start',         value: data.startDate || 'Upon execution' },
        ],
        contract: { number: data.contractNumber, date: data.contractDate || todayStr, startDate: data.startDate, completionDate: data.completionDate },
        scope: data.scope || null,
        contractPrice: Number(data.contractPrice || data.total || 0),
        paymentSchedule: (data.paymentSchedule || []).map(p => ({
          stage: p.stage || p.label,
          dueDescription: p.due || p.dueDescription || '',
          amount: Number(p.amount || 0),
        })),
        paymentTerms: data.paymentTerms || 'Fifty percent (50%) due upon contract execution; remaining balance due upon substantial completion of work.',
        materials: data.materials || null,
        warranty: data.warranty || null,
        rightToCancel: data.rightToCancel || 'You, the buyer, may cancel this transaction at any time prior to midnight of the third business day after the date of this transaction. See the attached Notice of Cancellation form for an explanation of this right.',
        additionalTerms: data.additionalTerms || [],
      };
    }

    if (template === 'changeOrder') {
      const itemsAdded = (data.itemsAdded || []).map(i => ({
        description: i.item || i.description || '',
        quantity:    i.qty || i.quantity || 1,
        unit:        i.unit || 'ea',
        unitPrice:   Number(i.price || i.unitPrice || 0),
        lineTotal:   Number(i.lineTotal || ((i.qty || 1) * (i.price || 0))),
      }));
      const itemsRemoved = (data.itemsRemoved || []).map(i => ({
        description: i.item || i.description || '',
        quantity:    i.qty || i.quantity || 1,
        unit:        i.unit || 'ea',
        unitPrice:   Number(i.price || i.unitPrice || 0),
        lineTotal:   Number(i.lineTotal || ((i.qty || 1) * (i.price || 0))),
      }));
      const addedTotal = itemsAdded.reduce((s, x) => s + x.lineTotal, 0);
      const removedTotal = itemsRemoved.reduce((s, x) => s + x.lineTotal, 0);
      const netChange = addedTotal - removedTotal;
      const originalTotal = Number(data.originalTotal || 0);
      const newTotal = originalTotal + netChange;
      return {
        coverTagline: 'Scope changed.<br>Amended in writing.',
        coverSub:     'Amends the original contract referenced below. Work and pricing here are added to (or removed from) the previously agreed scope.',
        preparedFor, preparedBy,
        projectMeta: [
          { label: 'CO Date',         value: data.changeOrderDate || todayStr },
          { label: 'CO No.',          value: data.changeOrderNumber || ('CO-' + Date.now().toString().slice(-6)) },
          { label: 'Original Contract', value: data.originalContractNumber || '—' },
        ],
        changeOrder: {
          number: data.changeOrderNumber,
          originalContractNumber: data.originalContractNumber,
          originalDate: data.originalContractDate,
        },
        description: data.changesDescription || data.description || 'Additional work identified during project execution.',
        itemsAdded, itemsRemoved,
        originalTotal, netChange, newTotal,
        scheduleImpact: data.scheduleImpact || 'No change to estimated completion date.',
      };
    }

    if (template === 'receipt') {
      const amount = Number(data.amount || data.paymentAmount || 0);
      const contractTotal = Number(data.contractTotal || 0);
      const priorPayments = Number(data.priorPayments || 0);
      return {
        coverTagline: 'Payment<br>received.',
        coverSub:     'A record of payment posted to your project. Keep it with your project documents for warranty and tax purposes.',
        preparedFor, preparedBy,
        projectMeta: [
          { label: 'Receipt Date', value: data.paymentDate || todayStr },
          { label: 'Receipt No.',  value: data.receiptNumber || ('RCT-' + Date.now().toString().slice(-6)) },
          { label: 'Amount',       value: '$' + amount.toLocaleString('en-US', { maximumFractionDigits: 0 }) },
        ],
        payment: {
          number: data.receiptNumber,
          date:   data.paymentDate || todayStr,
          method: data.paymentMethod || 'Check',
          reference: data.paymentReference || data.checkNumber || '—',
        },
        amount,
        contractTotal: contractTotal || null,
        priorPayments,
        balanceRemaining: contractTotal ? Math.max(0, contractTotal - priorPayments - amount) : null,
        appliedTo: data.appliedTo || (data.projectDescription) || null,
      };
    }

    return null;
  },

  /**
   * Get raw HTML string for document (without opening window)
   * @param {string} type - Document type
   * @param {object} data - Merge field data
   * @returns {string} Complete HTML document
   */
  getHTML(type, data = {}) {
    // Try the dedicated template first, fall back to generic if the
    // extended templates file hasn't loaded yet (deferred script).
    let template = this[this.DOCUMENT_TYPES[type]?.template];
    if (!template && this.DOCUMENT_TYPES[type]) {
      template = this.renderGenericDoc; // fallback
    }
    if (!template) {
      console.error(`Unknown document type: ${type}`);
      return null;
    }
    if (!data.companyProfile) {
      data.companyProfile = (window._companyProfile && typeof window._companyProfile === 'object')
        ? window._companyProfile
        : (window.NBD_COMPANY_PROFILE_DEFAULTS || {});
    }
    return template.call(this, data);
  },

  /**
   * Open fill form modal, generate document on submit
   * @param {string} type - Document type
   */
  fillAndGenerate(type) {
    this.renderFillFormModal(type);
  },

  /**
   * Generate a blank copy of the template with placeholder lines
   * instead of filled data. User can print and fill by hand.
   * @param {string} type - Document type
   */
  generateBlank(type) {
    // Build blank data with underline placeholders for hand-fill
    const blankData = {
      homeownerName: '________________________________',
      address: '________________________________',
      phone: '________________',
      email: '________________________________',
      projectDescription: '________________________________________________________________',
      totalPrice: '$__________',
      warrantyTier: '____________',
      warrantyTerms: '________________________________',
      startDate: '____ / ____ / ________',
      endDate: '____ / ____ / ________',
      signature: '________________________________',
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      // Keep company info filled since that's the contractor's data
      companyName: this.COMPANY.name,
      companyPhone: this.COMPANY.phone,
      companyEmail: this.COMPANY.email,
      companyWebsite: this.COMPANY.website,
      companyTagline: this.COMPANY.tagline
    };
    this.generate(type, blankData);
  },

  /**
   * Merge template fields with data
   * @param {string} template - HTML template with {{field}} placeholders
   * @param {object} data - Data object
   * @returns {string} Merged HTML
   */
  mergeFields(template, data = {}) {
    // Provide defaults for common fields
    const mergedData = {
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      homeownerName: '',
      address: '',
      phone: this.COMPANY.phone,
      email: this.COMPANY.email,
      projectDescription: '',
      totalPrice: '$0.00',
      warrantyTier: 'better',
      warrantyTerms: '',
      companyName: this.COMPANY.name,
      companyPhone: this.COMPANY.phone,
      companyEmail: this.COMPANY.email,
      companyWebsite: this.COMPANY.website,
      companyTagline: this.COMPANY.tagline,
      ...data
    };

    let result = template;
    Object.keys(mergedData).forEach(key => {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
      result = result.replace(regex, mergedData[key]);
    });

    return result;
  },

  // ============================================================================
  // SECTION 3: SHARED STYLING & UTILITIES
  // ============================================================================

  /**
   * Get shared CSS for all documents
   * @private
   * @returns {string} CSS styles
   */
  getSharedCSS() {
    return `
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        html, body {
          font-family: 'Georgia', serif;
          color: #333;
          line-height: 1.6;
          background: white;
        }

        .document-container {
          max-width: 8.5in;
          height: 11in;
          margin: 20px auto;
          padding: 0.5in;
          background: white;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15);
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .document-header {
          position: relative;
          background: linear-gradient(180deg, ${this.COMPANY.colors.primary} 0%, ${this.COMPANY.colors.secondary} 100%);
          color: #fff;
          margin: -0.5in -0.5in 0.3in -0.5in;
          padding: 0.35in 0.5in 0.25in 0.5in;
          border-bottom: 6px solid ${this.COMPANY.colors.accent};
        }

        .header-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.3in;
          margin-bottom: 0.12in;
        }

        .header-logo {
          flex: 0 0 auto;
        }

        /* Logo: inline <img> backed by an inline data URI of the real
           NBD brand mark (docs/assets/images/nbd-logo.png, 1536x1024).
           Switched from <object> after we discovered the iframe srcdoc
           CSP includes object-src 'none', which blocks <object> from
           loading its data URI regardless of MIME. <img> + data: URIs
           are allowed by img-src. The source image has a lot of
           whitespace around it; object-fit:contain keeps the mark
           centered with breathing room in this header strip. */
        .nbd-logo-img {
          display: block;
          /* Source logo is 1.5:1 (1536x1024). Width is fixed; height is
             left to auto so the white card hugs the artwork. The
             previous explicit height:72px forced a 2.78:1 box, leaving
             wide empty white bars on either side of the centered
             contain-fitted image — read as "logo stretched". */
          width: 200px;
          height: auto;
          object-fit: contain;
          object-position: left center;
          /* White card so the navy-on-white logo stays legible
             against the navy gradient header below. */
          background: #fff;
          border-radius: 8px;
          padding: 6px 10px;
          box-sizing: border-box;
        }

        .header-info {
          font: 600 10px/1.55 'Helvetica Neue', Arial, sans-serif;
          text-align: right;
          color: rgba(255,255,255,.95);
          letter-spacing: .02em;
        }
        .header-info > div + div { margin-top: 1px; }

        .header-company-name {
          font: 800 18px/1.1 'Helvetica Neue', Arial, sans-serif;
          color: #fff;
          letter-spacing: .04em;
          text-transform: uppercase;
          margin: 0.08in 0 0 0;
        }
        .header-tagline {
          font: italic 400 11px/1.3 Georgia, serif;
          color: ${this.COMPANY.colors.accent};
          margin-top: 2px;
        }

        .header-contact-row {
          font: 600 10px/1.4 'Helvetica Neue', Arial, sans-serif;
          color: rgba(255,255,255,.85);
          margin-top: 0.08in;
          padding-top: 0.06in;
          border-top: 1px solid rgba(255,255,255,.18);
          letter-spacing: .02em;
        }

        .document-title {
          font: 800 26px/1.1 'Helvetica Neue', Arial, sans-serif;
          color: ${this.COMPANY.colors.secondary};
          text-align: center;
          margin: 0.25in 0 0.08in 0;
          text-transform: uppercase;
          letter-spacing: 2px;
          position: relative;
          padding-bottom: 0.12in;
        }
        .document-title:after {
          content: "";
          display: block;
          width: 64px;
          height: 4px;
          background: ${this.COMPANY.colors.accent};
          margin: 0.1in auto 0 auto;
          border-radius: 2px;
        }

        .document-subtitle {
          font: 600 12px/1.4 'Helvetica Neue', Arial, sans-serif;
          text-align: center;
          color: ${this.COMPANY.colors.primary};
          margin-bottom: 0.22in;
          letter-spacing: .04em;
        }

        .document-content {
          flex: 1;
          overflow: hidden;
          font-size: 11px;
        }

        .section {
          margin-bottom: 0.22in;
          padding: 0.12in 0.18in;
          border-left: 4px solid ${this.COMPANY.colors.accent};
          background: linear-gradient(90deg, rgba(232,114,12,.04) 0%, rgba(232,114,12,0) 60%);
          border-radius: 0 6px 6px 0;
        }

        .section-title {
          font: 800 13px/1.1 'Helvetica Neue', Arial, sans-serif;
          color: ${this.COMPANY.colors.primary};
          margin-bottom: 0.12in;
          text-transform: uppercase;
          letter-spacing: 1.2px;
          padding-bottom: 0.06in;
          position: relative;
          display: inline-block;
          padding-right: 0.3in;
        }
        .section-title:after {
          content: "";
          position: absolute;
          left: 0; bottom: 0;
          width: 28px; height: 3px;
          background: ${this.COMPANY.colors.accent};
          border-radius: 2px;
        }

        .summary-text {
          font-size: 11px;
          line-height: 1.5;
          margin: 0.1in 0;
          color: #333;
        }

        .scope-list {
          list-style: none;
          margin: 0.1in 0;
        }

        .scope-list li {
          margin: 0.08in 0;
          padding-left: 0.25in;
        }

        .scope-list li:before {
          content: "•";
          color: ${this.COMPANY.colors.accent};
          font-weight: bold;
          margin-right: 0.1in;
          margin-left: -0.25in;
        }

        /* TABLE STYLING */
        table {
          width: 100%;
          border-collapse: collapse;
          margin: 0.15in 0;
          font-size: 11px;
        }

        table thead {
          background-color: ${this.COMPANY.colors.primary};
          color: white;
        }

        table th {
          padding: 0.1in;
          text-align: left;
          font-weight: bold;
          border: 1px solid ${this.COMPANY.colors.primary};
        }

        table td {
          padding: 0.08in 0.1in;
          border: 1px solid ${this.COMPANY.colors.borderGray};
        }

        table tr:nth-child(even) {
          background-color: ${this.COMPANY.colors.lightGray};
        }

        .total-row {
          background-color: #fff;
          font-weight: bold;
          border-top: 2px solid ${this.COMPANY.colors.primary};
        }

        .price-column {
          text-align: right;
        }

        .total-price {
          font-size: 14px;
          color: ${this.COMPANY.colors.accent};
          font-weight: bold;
        }

        /* WARRANTY BADGE */
        .warranty-badge {
          display: inline-block;
          padding: 0.15in 0.25in;
          background-color: ${this.COMPANY.colors.accent};
          color: white;
          border-radius: 4px;
          font-weight: bold;
          font-size: 12px;
          margin: 0.1in 0;
        }

        .warranty-details {
          background-color: ${this.COMPANY.colors.lightGray};
          border-left: 3px solid ${this.COMPANY.colors.primary};
          padding: 0.15in;
          margin: 0.1in 0;
          font-size: 10px;
          line-height: 1.5;
        }

        /* PHOTO ZONES */
        .photo-zone {
          border: 2px dashed ${this.COMPANY.colors.borderGray};
          background-color: ${this.COMPANY.colors.lightGray};
          padding: 0.2in;
          text-align: center;
          min-height: 1.5in;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #999;
          font-size: 10px;
          margin: 0.1in 0;
        }

        .photo-zone.has-image {
          border: 1px solid ${this.COMPANY.colors.borderGray};
          background: white;
        }

        .photo-zone img {
          max-width: 100%;
          max-height: 1.5in;
        }

        .photo-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 0.15in;
          margin: 0.15in 0;
        }

        .photo-grid.three-col {
          grid-template-columns: repeat(3, 1fr);
        }

        /* SIGNATURE BLOCKS */
        .signature-block {
          margin: 0.25in 0;
          font-size: 10px;
        }

        .signature-line {
          display: flex;
          justify-content: space-between;
          margin-bottom: 0.15in;
        }

        .sig-field {
          flex: 1;
          margin-right: 0.3in;
        }

        .sig-field:last-child {
          margin-right: 0;
        }

        .sig-underline {
          border-bottom: 1px solid #333;
          width: 100%;
          height: 0.4in;
          margin-bottom: 0.05in;
        }

        .sig-label {
          font-size: 9px;
          color: #666;
          font-weight: bold;
        }

        /* FOOTER */
        .document-footer {
          margin: 0.2in -0.5in -0.5in -0.5in;
          padding: 0.18in 0.5in;
          text-align: center;
          font: 600 10px/1.4 'Helvetica Neue', Arial, sans-serif;
          color: rgba(255,255,255,.92);
          background: linear-gradient(180deg, ${this.COMPANY.colors.secondary} 0%, ${this.COMPANY.colors.primary} 100%);
          border-top: 4px solid ${this.COMPANY.colors.accent};
          letter-spacing: .04em;
        }
        .document-footer .footer-brand {
          display: block;
          font: 800 11px/1.2 'Helvetica Neue', Arial, sans-serif;
          color: #fff;
          letter-spacing: .1em;
          text-transform: uppercase;
          margin-bottom: 3px;
        }

        .footer-page-number {
          display: inline-block;
          margin: 0 0.2in;
          color: rgba(255,255,255,.7);
        }

        .footer-credit {
          display: block;
          font-size: 9px;
          color: rgba(255,255,255,.65);
          margin-top: 0.04in;
          letter-spacing: .06em;
        }

        /* ACTION BAR — fixed top bar with Close + Print/Save */
        .doc-action-bar {
          position: fixed;
          top: 0; left: 0; right: 0;
          height: 56px;
          background: ${this.COMPANY.colors.primary};
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 20px;
          z-index: 1000;
          box-shadow: 0 2px 12px rgba(0,0,0,0.3);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        .doc-action-bar .doc-bar-left {
          display: flex; align-items: center; gap: 12px;
        }
        .doc-action-bar .doc-bar-right {
          display: flex; align-items: center; gap: 10px;
        }
        .doc-bar-btn {
          padding: 10px 20px;
          border: none; border-radius: 6px;
          font-size: 13px; font-weight: 700;
          cursor: pointer; transition: all 0.15s;
          text-transform: uppercase; letter-spacing: 0.04em;
        }
        .doc-bar-btn:active { transform: scale(0.96); }
        .doc-bar-close {
          background: rgba(255,255,255,0.15);
          color: white;
        }
        .doc-bar-close:hover { background: rgba(255,255,255,0.25); }
        .doc-bar-print {
          background: ${this.COMPANY.colors.accent};
          color: white;
        }
        .doc-bar-print:hover { opacity: 0.9; }
        .doc-bar-title {
          color: rgba(255,255,255,0.8);
          font-size: 14px; font-weight: 600;
        }

        /* Push content below action bar */
        .document-container {
          margin-top: 66px !important;
        }

        /* Legacy print button (hidden, replaced by action bar) */
        .print-button-container { display: none; }

        /* PRINT MEDIA */
        @media print {
          body {
            margin: 0;
            padding: 0;
            background: white;
          }

          .doc-action-bar {
            display: none;
          }

          .print-button-container {
            display: none;
          }

          .document-container {
            margin-top: 0 !important;
          }

          .document-container {
            max-width: 100%;
            height: auto;
            margin: 0;
            padding: 0;
            box-shadow: none;
            page-break-after: always;
          }

          @page {
            margin: 0;
            size: letter;
          }
        }

        /* CONDITION GRADES */
        .condition-grade {
          display: inline-block;
          padding: 0.15in 0.25in;
          border-radius: 4px;
          font-weight: bold;
          color: white;
          margin: 0.05in 0;
        }

        .grade-a {
          background-color: #28a745;
        }

        .grade-b {
          background-color: #ffc107;
          color: #333;
        }

        .grade-c {
          background-color: #fd7e14;
        }

        .grade-d {
          background-color: #dc3545;
        }

        .grade-f {
          background-color: #6f42c1;
        }

        .urgency-immediate {
          color: #dc3545;
          font-weight: bold;
        }

        .urgency-monitor {
          color: #ffc107;
          font-weight: bold;
        }

        .urgency-good {
          color: #28a745;
          font-weight: bold;
        }

        /* HORIZONTAL RULE */
        hr {
          border: none;
          border-top: 1px solid ${this.COMPANY.colors.borderGray};
          margin: 0.15in 0;
        }
      </style>
    `;
  },

  // ============================================================================
  // SECTION 4: BRAND COMPONENTS (HEADER, FOOTER, LOGO, etc.)
  // ============================================================================

  /**
   * Origin for absolute asset URLs. Docs render inside the
   * universal viewer (often `about:blank` / srcdoc), where relative
   * paths can't resolve. We bake the parent origin in at render time
   * so the logo loads regardless of viewer context. Falls back to
   * the production host for headless/server-side renders.
   * @private
   */
  _assetOrigin() {
    try {
      if (typeof window !== 'undefined' && window.location && window.location.origin && window.location.origin !== 'null') {
        return window.location.origin;
      }
    } catch (_) {}
    return 'https://nobigdealwithjoedeal.com';
  },

  /**
   * Resolve the active letterhead identity by merging
   * NBD_COMPANY_PROFILE_DEFAULTS / window._companyProfile overrides
   * on top of the hardcoded NBDDocGen.COMPANY constant. Render
   * helpers (renderHeader, renderFooter, renderCustomerReport) call
   * this so editing Settings → Company Profile → Letterhead updates
   * every template at once. Empty profile fields fall through to the
   * COMPANY defaults so the existing behavior is preserved for reps
   * who never touch the Settings panel.
   * @param {object} data - Merge field data (data.companyProfile preferred)
   * @returns {{name:string,phone:string,email:string,website:string,address:string,license:string,tagline:string}}
   */
  _letterhead(data) {
    const cp = (data && data.companyProfile)
      || (typeof window !== 'undefined' && window._companyProfile)
      || {};
    const C = this.COMPANY;
    const pick = (override, fallback) => {
      const o = (override == null ? '' : String(override)).trim();
      return o || fallback || '';
    };
    return {
      name:    pick(cp.businessName,    C.name),
      phone:   pick(cp.businessPhone,   C.phone),
      email:   pick(cp.businessEmail,   C.email),
      website: pick(cp.businessWebsite, C.website),
      address: pick(cp.businessAddress, C.address),
      license: pick(cp.businessLicense, ''),
      tagline: pick(cp.tagline,         C.tagline)
    };
  },

  /**
   * Render NBD logo + textual fallback. The text fallback ships
   * inside the same anchor so if the image fails (offline, CSP) the
   * customer still sees a readable brand mark — no JS error handler
   * needed (strict CSP blocks inline onerror anyway).
   * @private
   * @returns {string} HTML
   */
  renderNBDLogo() {
    // Inline data URI of the REAL company logo (docs/assets/images/nbd-logo.png).
    // Uses <img> instead of <object> because the doc viewer's iframe srcdoc
    // CSP includes `object-src 'none'`, which blocks <object> entirely. The
    // img-src directive allows `data:`, so inline data URIs through <img>
    // work. The actual logo bytes live in nbd-logo-asset.js, which is loaded
    // before any document render and exposes window.NBD_LOGO_DATA_URI.
    const src = (typeof window !== 'undefined' && window.NBD_LOGO_DATA_URI)
      ? window.NBD_LOGO_DATA_URI
      : this._assetOrigin() + '/assets/images/nbd-logo.png';
    return `<img class="nbd-logo-img" src="${src}" alt="No Big Deal Home Solutions" />`;
  },

  /**
   * Render branded document header
   * @param {object} data - Header data
   * @returns {string} HTML
   */
  renderHeader(data = {}) {
    const L = this._letterhead(data);
    const address = data.address || L.address;
    const showAddress = address ? ` &middot; ${address}` : '';

    return `
      <div class="document-header">
        <div class="header-top">
          <div class="header-logo">
            ${this.renderNBDLogo()}
          </div>
          <div class="header-info">
            <div>${L.phone}</div>
            <div>${L.email}</div>
            <div>${L.website}</div>
          </div>
        </div>
        <div class="header-company-name">${L.name}</div>
        <div class="header-tagline">${L.tagline}</div>
        <div class="header-contact-row">
          ${L.phone} &nbsp;|&nbsp; ${L.email} &nbsp;|&nbsp; ${L.website}${showAddress}
        </div>
      </div>
    `;
  },

  /**
   * Render branded document footer
   * @param {object} data - Footer data (pageNumber optional)
   * @returns {string} HTML
   */
  renderFooter(data = {}) {
    const L = this._letterhead(data);
    const pageNum = data.pageNumber || '';
    const pageText = pageNum ? `<span class="footer-page-number">Page ${pageNum}</span>` : '';
    const licenseLine = L.license ? `<div class="footer-license">License #${L.license}</div>` : '';

    return `
      <div class="document-footer">
        <span class="footer-brand">${L.name}</span>
        <div>${L.phone} &nbsp;|&nbsp; ${L.email} &nbsp;|&nbsp; ${L.website}</div>
        ${licenseLine}
        ${pageText}
        <span class="footer-credit">${L.tagline}</span>
      </div>
    `;
  },

  /**
   * Render signature block with multiple signers
   * @param {array} signers - Array of signer names/titles
   * @returns {string} HTML
   */
  renderSignatureBlock(signers = ['Homeowner', 'Contractor']) {
    let html = '<div class="signature-block">';

    signers.forEach(signer => {
      html += `
        <div class="signature-line">
          <div class="sig-field">
            <div class="sig-underline"></div>
            <div class="sig-label">Signature</div>
          </div>
          <div class="sig-field">
            <div class="sig-underline"></div>
            <div class="sig-label">Date</div>
          </div>
        </div>
        <div style="font-size: 10px; margin-bottom: 0.15in; color: #666;">
          <strong>${signer}</strong>
        </div>
      `;
    });

    html += '</div>';
    return html;
  },

  /**
   * Render photo grid
   * @param {array} photos - Array of photo URLs or null
   * @param {number} columns - Number of columns (2 or 3)
   * @returns {string} HTML
   */
  renderPhotoGrid(photos = [], columns = 2) {
    const colClass = columns === 3 ? 'three-col' : '';
    let html = `<div class="photo-grid ${colClass}">`;

    if (!photos || photos.length === 0) {
      // Empty placeholders
      for (let i = 0; i < 2; i++) {
        html += '<div class="photo-zone">Photo</div>';
      }
    } else {
      photos.forEach(photo => {
        if (photo) {
          html += `<div class="photo-zone has-image"><img src="${photo}" alt="Photo" /></div>`;
        } else {
          html += '<div class="photo-zone">Photo</div>';
        }
      });
    }

    html += '</div>';
    return html;
  },

  /**
   * Render warranty badge and details
   * @param {string} tier - Warranty tier (good, better, best)
   * @returns {string} HTML
   */
  renderWarrantyBadge(tier = 'better') {
    const warranty = this.WARRANTY_TIERS[tier] || this.WARRANTY_TIERS.better;

    return `
      <div class="warranty-badge">
        ${warranty.name}: ${warranty.workmanship} ${warranty.manufacturer}
      </div>
      <div class="warranty-details">
        <div><strong>${warranty.description}</strong></div>
        <div style="margin-top: 0.08in;">${warranty.details}</div>
      </div>
    `;
  },

  // ============================================================================
  // SECTION 5: DOCUMENT TEMPLATE - PROPOSAL/ESTIMATE
  // ============================================================================

  /**
   * Render Proposal/Estimate document
   * @private
   * @param {object} data - Document data
   * @returns {string} Complete HTML document
   */
  renderProposal(data = {}) {
    const cp = data.companyProfile || (window.NBD_COMPANY_PROFILE_DEFAULTS || {});
    // Merge with defaults
    const merged = {
      homeownerName: '',
      address: '',
      date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      projectDescription: 'Complete roofing system replacement including removal of existing materials, installation of new premium asphalt shingles, underlayment, flashing, and gutters.',
      scopeItems: [
        'Remove existing roofing materials and debris',
        'Install new architectural asphalt shingles',
        'Install premium underlayment and ice/water shield',
        'Install new flashing and ridge vents',
        'Install seamless gutters and downspouts',
        'Final cleanup and debris removal'
      ],
      lineItems: [
        { description: 'Architectural Asphalt Shingles', qty: 25, unit: 'SQ', unitPrice: 165, total: 4125 },
        { description: 'Underlayment & Ice/Water Shield', qty: 25, unit: 'SQ', unitPrice: 45, total: 1125 },
        { description: 'Flashing & Ridge Vent Installation', qty: 1, unit: 'Job', unitPrice: 500, total: 500 },
        { description: 'Seamless Gutter Installation', qty: 140, unit: 'LF', unitPrice: 15, total: 2100 },
        { description: 'Labor & Installation', qty: 1, unit: 'Job', unitPrice: 3000, total: 3000 },
        { description: 'Permits & Compliance', qty: 1, unit: 'Job', unitPrice: 200, total: 200 }
      ],
      totalPrice: '',
      warrantyTier: 'better',
      photos: null,
      ...data
    };

    // Build line items table
    let lineItemsHTML = '<table><thead><tr><th>Item</th><th style="width: 8%;">Qty</th><th style="width: 10%;">Unit</th><th style="width: 12%;">Unit Price</th><th class="price-column" style="width: 12%;">Total</th></tr></thead><tbody>';

    let total = 0;
    const _esc = (s) => String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    merged.lineItems.forEach(item => {
      const totalAmount = item.total || (item.qty * item.unitPrice);
      total += totalAmount;
      lineItemsHTML += `
        <tr>
          <td>${_esc(item.description)}</td>
          <td style="text-align: center;">${_esc(item.qty)}</td>
          <td style="text-align: center;">${_esc(item.unit)}</td>
          <td class="price-column">$${Number(item.unitPrice||0).toFixed(2)}</td>
          <td class="price-column">$${Number(totalAmount||0).toFixed(2)}</td>
        </tr>
      `;
    });

    lineItemsHTML += `
      <tr class="total-row">
        <td colspan="4" style="text-align: right; padding-right: 0.1in;">TOTAL PROJECT COST</td>
        <td class="price-column"><span class="total-price">${merged.totalPrice}</span></td>
      </tr>
    </tbody></table>`;

    // Build scope list
    let scopeHTML = '<ul class="scope-list">';
    merged.scopeItems.forEach(item => {
      scopeHTML += `<li>${_esc(item)}</li>`;
    });
    scopeHTML += '</ul>';

    // Standard terms — all rep-editable via Settings → Company Profile.
    const termsHTML = `
      <div style="font-size: 10px; line-height: 1.4; color: #555;">
        <strong>Payment Terms:</strong> ${cp.paymentTermsProposal}
        <br/><br/>
        <strong>Change Orders:</strong> ${cp.changeOrderClauseShort}
        <br/><br/>
        <strong>Cancellation Rights:</strong> ${cp.cancellationProposalShort}
        <br/><br/>
        <strong>Warranty Disclaimer:</strong> ${cp.materialsWarrantyDisclaimer}
        <br/><br/>
        <strong>Limitation of Liability:</strong> ${cp.limitationOfLiability}
      </div>
    `;

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>NBD Home Solutions - Proposal</title>
        ${this.getSharedCSS()}
      </head>
      <body>
        <div class="print-button-container">
          <button class="print-button" data-dg-action="print">Print / Save as PDF</button>
        </div>

        <div class="document-container">
          ${this.renderHeader(merged)}

          <div class="document-title">Roofing Proposal</div>

          <div class="document-subtitle">
            <div><strong>Prepared for:</strong> ${merged.homeownerName}</div>
            <div><strong>Property:</strong> ${merged.address}</div>
            <div><strong>Date:</strong> ${merged.date}</div>
          </div>

          <div class="document-content">
            <!-- EXECUTIVE SUMMARY -->
            <div class="section">
              <div class="section-title">Executive Summary</div>
              <div class="summary-text">
                ${merged.projectDescription}
              </div>
            </div>

            <!-- SCOPE OF WORK -->
            <div class="section">
              <div class="section-title">Scope of Work</div>
              ${scopeHTML}
            </div>

            <!-- PRICING -->
            <div class="section">
              <div class="section-title">Pricing</div>
              ${lineItemsHTML}
            </div>

            <!-- WARRANTY -->
            <div class="section">
              <div class="section-title">Warranty Coverage</div>
              ${this.renderWarrantyBadge(merged.warrantyTier)}
            </div>

            <!-- PHOTOS -->
            <div class="section">
              <div class="section-title">Site Documentation</div>
              ${this.renderPhotoGrid(merged.photos, 2)}
            </div>

            <!-- TERMS & CONDITIONS -->
            <div class="section">
              <div class="section-title">Terms & Conditions</div>
              ${termsHTML}
            </div>

            <!-- ACCEPTANCE -->
            <div class="section">
              <div class="section-title">Acceptance</div>
              ${this.renderSignatureBlock(['Homeowner', 'Authorized NBD Representative'])}
            </div>
          </div>

          ${this.renderFooter({ pageNumber: '1' })}
        </div>
      </body>
      </html>
    `;

    return this.mergeFields(html, merged);
  },

  // ============================================================================
  // SECTION 6: DOCUMENT TEMPLATE - ROOFING CONTRACT
  // ============================================================================

  /**
   * Render Roofing Contract document
   * @private
   * @param {object} data - Document data
   * @returns {string} Complete HTML document
   */
  renderContract(data = {}) {
    const cp = data.companyProfile || (window.NBD_COMPANY_PROFILE_DEFAULTS || {});
    const merged = {
      homeownerName: '',
      homeownerAddress: '',
      contractorName: this.COMPANY.name,
      contractorPhone: this.COMPANY.phone,
      contractPrice: '',
      startDate: 'Upon contract execution',
      estimatedCompletion: '5-7 business days',
      projectDescription: 'Complete roofing system replacement including removal of existing materials, installation of new premium asphalt shingles, underlayment, flashing, and gutters.',
      warrantyTier: 'better',
      paymentSchedule: cp.paymentTermsContract,
      isInsuranceJob: false,
      ...data
    };

    const contractHTML = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>NBD Home Solutions - Roofing Contract</title>
        ${this.getSharedCSS()}
      </head>
      <body>
        <div class="print-button-container">
          <button class="print-button" data-dg-action="print">Print / Save as PDF</button>
        </div>

        <div class="document-container">
          ${this.renderHeader(merged)}

          <div class="document-title">Roofing Contract</div>

          <div class="document-content" style="font-size: 10px; line-height: 1.5;">
            <!-- PARTIES -->
            <div class="section">
              <div class="section-title">Parties to Agreement</div>
              <div style="margin: 0.1in 0;">
                <strong>Contractor:</strong> ${merged.contractorName}<br/>
                <strong>Phone:</strong> ${merged.contractorPhone}<br/>
                <strong>Email:</strong> ${this.COMPANY.email}
              </div>
              <div style="margin: 0.1in 0; margin-top: 0.15in;">
                <strong>Homeowner:</strong> {{homeownerName}}<br/>
                <strong>Property Address:</strong> {{address}}<br/>
                <strong>Phone:</strong> {{phone}}<br/>
                <strong>Email:</strong> {{email}}
              </div>
            </div>

            <!-- PROJECT DETAILS -->
            <div class="section">
              <div class="section-title">Project Details</div>
              <div style="margin: 0.1in 0;">
                <strong>Description of Work:</strong><br/>
                {{projectDescription}}
              </div>
              <div style="margin: 0.1in 0; margin-top: 0.08in;">
                <strong>Contract Price:</strong> {{totalPrice}}<br/>
                <strong>Start Date:</strong> {{startDate}}<br/>
                <strong>Estimated Completion:</strong> {{estimatedCompletion}}
              </div>
            </div>

            <!-- PAYMENT TERMS -->
            <div class="section">
              <div class="section-title">Payment Schedule & Terms</div>
              <div style="margin: 0.1in 0;">
                {{paymentSchedule}}
              </div>
              <div style="margin: 0.1in 0; margin-top: 0.08in; font-size: 9px;">
                ${cp.paymentMethodsNoCash}
              </div>
            </div>

            <!-- WARRANTY -->
            <div class="section">
              <div class="section-title">Warranty Coverage</div>
              {{warrantyTerms}}
            </div>

            <!-- CHANGE ORDERS -->
            <div class="section">
              <div class="section-title">Change Orders & Scope Modifications</div>
              <div style="margin: 0.1in 0; font-size: 9px;">
                ${cp.changeOrderClause}
              </div>
            </div>

            <!-- CANCELLATION CLAUSE -->
            <div class="section">
              <div class="section-title">Cancellation & Rescission Rights</div>
              <div style="margin: 0.1in 0; font-size: 9px;">
                ${cp.cancellationContractClause}
              </div>
            </div>

            <!-- DISPUTE RESOLUTION -->
            <div class="section">
              <div class="section-title">Dispute Resolution</div>
              <div style="margin: 0.1in 0; font-size: 9px;">
                ${cp.disputeResolutionClause}
              </div>
            </div>

            <!-- INSURANCE CLAUSE -->
            <div class="section">
              <div class="section-title">Insurance Assignment</div>
              <div style="margin: 0.1in 0; font-size: 9px;">
                ${cp.insuranceAssignmentClause}
              </div>
            </div>

            <!-- ENTIRE AGREEMENT -->
            <div class="section">
              <div class="section-title">Entire Agreement</div>
              <div style="margin: 0.1in 0; font-size: 9px;">
                ${cp.entireAgreementClause}
              </div>
            </div>

            <!-- SIGNATURES -->
            <div class="section">
              <div class="section-title">Contract Execution</div>
              <div style="margin-top: 0.15in;">
                ${this.renderSignatureBlock(['Homeowner', 'Contractor - NBD Home Solutions'])}
              </div>
            </div>
          </div>

          ${this.renderFooter({ pageNumber: '1' })}
        </div>
      </body>
      </html>
    `;

    return this.mergeFields(contractHTML, merged);
  },

  // ============================================================================
  // SECTION 7: DOCUMENT TEMPLATE - INSPECTION REPORT (HOMEOWNER)
  // ============================================================================

  /**
   * Render Inspection Report - Homeowner Version
   * @private
   * @param {object} data - Document data
   * @returns {string} Complete HTML document
   */
  renderInspectionHomeowner(data = {}) {
    const merged = {
      homeownerName: '',
      address: '',
      inspectionDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      inspectorName: 'NBD Inspector',
      overallConditionGrade: 'C',
      overallDescription: 'The roof shows moderate wear and aging. Several sections require attention.',
      roofCondition: { grade: 'C', description: 'Asphalt shingles showing wear, some cupping and loss of granules observed.' },
      gutterCondition: { grade: 'D', description: 'Gutters clogged and sagging in places. Potential water damage risk.' },
      sidingCondition: { grade: 'B', description: 'Vinyl siding in fair condition with some areas needing repainting.' },
      windowCondition: { grade: 'A', description: 'Windows in good condition with no visible damage or leaks.' },
      otherCondition: { grade: 'C', description: 'Fascia boards showing signs of rot. Downspouts misaligned.' },
      recommendations: [
        { item: 'Roof Replacement', urgency: 'Immediate Attention', price: '$11,500' },
        { item: 'Gutter Repair & Cleaning', urgency: 'Immediate Attention', price: '$1,200' },
        { item: 'Fascia Board Replacement', urgency: 'Monitor', price: '$800' },
        { item: 'Siding Touch-up Paint', urgency: 'Monitor', price: '$300' }
      ],
      photos: null,
      ...data
    };

    const gradeColor = (grade) => {
      const colors = { 'A': 'grade-a', 'B': 'grade-b', 'C': 'grade-c', 'D': 'grade-d', 'F': 'grade-f' };
      return colors[grade] || 'grade-c';
    };

    const urgencyClass = (urgency) => {
      if (urgency === 'Immediate Attention') return 'urgency-immediate';
      if (urgency === 'Monitor') return 'urgency-monitor';
      return 'urgency-good';
    };

    let recommendationsHTML = '<table><thead><tr><th>Recommended Repair</th><th>Urgency</th><th style="width: 15%;">Est. Cost</th></tr></thead><tbody>';
    merged.recommendations.forEach(rec => {
      recommendationsHTML += `
        <tr>
          <td>${rec.item}</td>
          <td><span class="${urgencyClass(rec.urgency)}">${rec.urgency}</span></td>
          <td class="price-column">${rec.price}</td>
        </tr>
      `;
    });
    recommendationsHTML += '</tbody></table>';

    const inspectionHTML = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>NBD Home Solutions - Inspection Report</title>
        ${this.getSharedCSS()}
      </head>
      <body>
        <div class="print-button-container">
          <button class="print-button" data-dg-action="print">Print / Save as PDF</button>
        </div>

        <div class="document-container">
          ${this.renderHeader(merged)}

          <div class="document-title">Home Inspection Report</div>

          <div class="document-subtitle">
            <div><strong>Property:</strong> {{address}}</div>
            <div><strong>Homeowner:</strong> {{homeownerName}}</div>
            <div><strong>Inspection Date:</strong> {{inspectionDate}}</div>
          </div>

          <div class="document-content" style="font-size: 10px;">
            <!-- OVERALL CONDITION -->
            <div class="section">
              <div class="section-title">Overall Condition</div>
              <div style="margin: 0.1in 0;">
                <span class="condition-grade ${gradeColor('C')}">Grade C</span>
              </div>
              <div class="summary-text">
                {{overallDescription}}
              </div>
            </div>

            <!-- ROOF CONDITION -->
            <div class="section">
              <div class="section-title">Roof Assessment</div>
              <div style="margin: 0.1in 0;">
                <span class="condition-grade ${gradeColor('C')}">Grade C</span>
              </div>
              <div class="summary-text">
                {{roofCondition}}
              </div>
              ${this.renderPhotoGrid([null, null], 2)}
            </div>

            <!-- GUTTERS -->
            <div class="section">
              <div class="section-title">Gutters & Drainage</div>
              <div style="margin: 0.1in 0;">
                <span class="condition-grade ${gradeColor('D')}">Grade D</span>
              </div>
              <div class="summary-text">
                Gutters clogged and sagging in places. Potential water damage risk.
              </div>
              ${this.renderPhotoGrid([null, null], 2)}
            </div>

            <!-- SIDING -->
            <div class="section">
              <div class="section-title">Exterior Siding</div>
              <div style="margin: 0.1in 0;">
                <span class="condition-grade ${gradeColor('B')}">Grade B</span>
              </div>
              <div class="summary-text">
                Vinyl siding in fair condition with some areas needing repainting.
              </div>
            </div>

            <!-- WINDOWS -->
            <div class="section">
              <div class="section-title">Windows</div>
              <div style="margin: 0.1in 0;">
                <span class="condition-grade ${gradeColor('A')}">Grade A</span>
              </div>
              <div class="summary-text">
                Windows in good condition with no visible damage or leaks.
              </div>
            </div>

            <!-- RECOMMENDATIONS -->
            <div class="section">
              <div class="section-title">Recommended Repairs</div>
              ${recommendationsHTML}
            </div>

            <!-- NEXT STEPS -->
            <div class="section" style="background-color: ${this.COMPANY.colors.lightGray}; border-left: 3px solid ${this.COMPANY.colors.primary}; padding: 0.15in;">
              <div class="section-title">Next Steps</div>
              <div class="summary-text">
                Based on this assessment, we recommend immediate attention to the roof and gutters to prevent further water damage. Contact us to schedule a free estimate and discuss financing options for recommended repairs.
              </div>
              <div style="margin-top: 0.1in; font-weight: bold; color: ${this.COMPANY.colors.primary};">
                ${this.COMPANY.phone} | ${this.COMPANY.email}
              </div>
            </div>

            <!-- INSPECTOR INFO -->
            <div class="section">
              <div class="section-title">Inspector Information</div>
              ${this.renderSignatureBlock(['Certified NBD Inspector'])}
            </div>
          </div>

          ${this.renderFooter({ pageNumber: '1' })}
        </div>
      </body>
      </html>
    `;

    return this.mergeFields(inspectionHTML, merged);
  },

  // ============================================================================
  // SECTION 8: DOCUMENT TEMPLATE - INSPECTION REPORT (INSURANCE)
  // ============================================================================

  /**
   * Render Inspection Report - Insurance Version
   * @private
   * @param {object} data - Document data
   * @returns {string} Complete HTML document
   */
  renderInspectionInsurance(data = {}) {
    const cp = data.companyProfile || (window.NBD_COMPANY_PROFILE_DEFAULTS || {});
    const merged = {
      claimantName: '',
      claimNumber: 'CLM-2026-0001',
      dateOfLoss: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      propertyAddress: '',
      inspectionDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      inspectorName: 'NBD Damage Assessor',
      damageType: 'Wind Damage',
      estimatedRepairCost: '',
      photos: null,
      // Lead-level override wins; otherwise fall back to the shop-wide
      // company profile.
      codeCycle: data.codeCycle || cp.codeCycle,
      codeJurisdiction: data.codeJurisdiction || cp.codeJurisdiction,
      ...data
    };
    // Re-resolve after spread, in case `data` carried explicit null/empty.
    merged.codeCycle = data.codeCycle || cp.codeCycle;
    merged.codeJurisdiction = data.codeJurisdiction || cp.codeJurisdiction;

    const insuranceHTML = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>NBD Home Solutions - Insurance Claim Report</title>
        ${this.getSharedCSS()}
      </head>
      <body>
        <div class="print-button-container">
          <button class="print-button" data-dg-action="print">Print / Save as PDF</button>
        </div>

        <div class="document-container">
          ${this.renderHeader(merged)}

          <div class="document-title">Insurance Damage Report</div>

          <div class="document-subtitle">
            <div><strong>Claim Number:</strong> {{claimNumber}}</div>
            <div><strong>Date of Loss:</strong> {{dateOfLoss}}</div>
          </div>

          <div class="document-content" style="font-size: 10px; line-height: 1.4;">
            <!-- CLAIMANT INFO -->
            <div class="section">
              <div class="section-title">Claimant & Property Information</div>
              <div style="margin: 0.1in 0;">
                <strong>Claimant Name:</strong> {{claimantName}}<br/>
                <strong>Property Address:</strong> {{address}}<br/>
                <strong>Claim Number:</strong> {{claimNumber}}<br/>
                <strong>Inspection Date:</strong> {{inspectionDate}}
              </div>
            </div>

            <!-- DAMAGE ASSESSMENT -->
            <div class="section">
              <div class="section-title">Damage Assessment & Cause</div>
              <div style="margin: 0.1in 0;">
                <strong>Type of Damage:</strong> {{damageType}}<br/>
                <strong>Estimated Repair Cost:</strong> {{totalPrice}}
              </div>
              <div class="summary-text" style="margin-top: 0.1in;">
                Evidence of wind/impact damage to roof shingles including lifted edges, puncture marks, and missing shingles. Structural integrity compromised requiring immediate repair to prevent water infiltration and secondary damage.
              </div>
            </div>

            <!-- ROOF DAMAGE DETAILS -->
            <div class="section">
              <div class="section-title">Roof Damage - Detailed Assessment</div>
              <table>
                <thead>
                  <tr>
                    <th>Area</th>
                    <th>Damage Type</th>
                    <th>Severity</th>
                    <th>Measurement</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>North Slope</td>
                    <td>Missing shingles, lifted edges</td>
                    <td>High</td>
                    <td>~400 sq ft</td>
                  </tr>
                  <tr>
                    <td>South Slope</td>
                    <td>Puncture marks, granule loss</td>
                    <td>Medium</td>
                    <td>~250 sq ft</td>
                  </tr>
                  <tr>
                    <td>East Gable</td>
                    <td>Flashing damage</td>
                    <td>Medium</td>
                    <td>~60 sq ft</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <!-- PHOTO EVIDENCE -->
            <div class="section">
              <div class="section-title">Photographic Evidence</div>
              <div class="photo-grid three-col">
                <div class="photo-zone">Photo 1</div>
                <div class="photo-zone">Photo 2</div>
                <div class="photo-zone">Photo 3</div>
                <div class="photo-zone">Photo 4</div>
                <div class="photo-zone">Photo 5</div>
                <div class="photo-zone">Photo 6</div>
              </div>
            </div>

            <!-- SCOPE OF RESTORATION -->
            <div class="section">
              <div class="section-title">Recommended Restoration Scope</div>
              <ul class="scope-list">
                <li>Remove all damaged roofing materials</li>
                <li>Inspect and repair/replace underlying decking</li>
                <li>Install new underlayment per code</li>
                <li>Install new architectural shingles matching existing</li>
                <li>Repair/replace flashing</li>
                <li>Replace damaged gutters and downspouts</li>
                <li>Final inspection and cleanup</li>
              </ul>
            </div>

            <!-- CODE COMPLIANCE -->
            <div class="section">
              <div class="section-title">Code Compliance & Standards</div>
              <div style="font-size: 9px; line-height: 1.4;">
                <strong>Current Code Requirements:</strong> All repairs performed in accordance with ${merged.codeCycle} and ${merged.codeJurisdiction}. Work complies with manufacturer specifications and NRCA guidelines.
              </div>
            </div>

            <!-- RESTORATION CERTIFICATION -->
            <div class="section">
              <div class="section-title">Assessor Certification</div>
              <div style="font-size: 9px; margin: 0.1in 0;">
                I certify that I have personally inspected the subject property and that the damages, measurements, and repair estimates contained in this report are accurate to the best of my knowledge and belief.
              </div>
              ${this.renderSignatureBlock(['Certified NBD Damage Assessor'])}
            </div>
          </div>

          ${this.renderFooter({ pageNumber: '1' })}
        </div>
      </body>
      </html>
    `;

    return this.mergeFields(insuranceHTML, merged);
  },

  // ============================================================================
  // SECTION 9: FILL FORM MODAL
  // ============================================================================

  /**
   * Render and display fill form modal
   * @param {string} documentType - Type of document
   */
  // ═══════════════════════════════════════════════════════════
  // GENERIC DOCUMENT TEMPLATE
  // Professional branded document for any type that doesn't have
  // a dedicated custom render function yet. Covers invoice,
  // warranty, scope of work, change order, etc. Produces a clean
  // printable page with NBD branding, merged field data, and
  // signature blocks.
  // ═══════════════════════════════════════════════════════════
  renderGenericDoc(data = {}) {
    const type = data._documentType || 'document';
    const typeName = this.DOCUMENT_TYPES[type]?.name || type.replace(/_/g, ' ');
    const d = { ...data };
    const name = d.homeownerName || d.customerName || '';
    const addr = d.address || '';
    const date = d.date || new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
    const phone = d.phone || '';
    const email = d.email || '';
    const desc = d.projectDescription || d.scopeSummary || d.workDescription || d.notes || '';
    const price = d.totalPrice || d.totalAmount || d.contractPrice || '';

    // Collect all non-empty fields into a data table
    const skipFields = new Set(['_documentType','date','companyName','companyPhone','companyEmail','companyWebsite','companyTagline']);
    const fieldRows = Object.entries(d)
      .filter(([k,v]) => v && !skipFields.has(k) && typeof v === 'string' && v.trim())
      .map(([k,v]) => {
        const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).replace(/_/g, ' ');
        return `<tr><td style="padding:8px 12px;font-weight:600;color:#1e3a6e;white-space:nowrap;width:180px;border-bottom:1px solid #f0f0f0;">${label}</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">${String(v).substring(0, 500)}</td></tr>`;
      }).join('');

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${typeName} — ${name || 'NBD Pro'}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Barlow',sans-serif;padding:36px;max-width:860px;margin:0 auto;color:#1a1a2e;}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:3px solid #e8720c;margin-bottom:26px;}
.brand-row{display:flex;align-items:center;gap:12px;}
/* Width-only; height derives from the 1.5:1 source so the white card hugs the artwork. */
.brand-logo{display:block;width:140px;height:auto;background:#fff;border-radius:6px;padding:4px 8px;box-sizing:border-box;}
.brand{font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:800;text-transform:uppercase;color:#1a1a2e;line-height:1.1;}
.badge{font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#e8720c;border:1px solid #e8720c;padding:2px 9px;border-radius:2px;display:inline-block;margin-top:5px;}
.doc-type{font-family:'Barlow Condensed',sans-serif;font-size:28px;font-weight:800;text-transform:uppercase;color:#1e3a6e;text-align:right;}
.doc-date{font-size:12px;color:#666;text-align:right;margin-top:4px;}
h2{font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.15em;color:#e8720c;margin:24px 0 12px;padding-bottom:4px;border-bottom:1px solid #eee;}
table{width:100%;border-collapse:collapse;margin-bottom:16px;}
.desc{background:#f8f8f8;border-left:4px solid #e8720c;padding:16px 20px;margin:16px 0;font-size:14px;line-height:1.6;border-radius:0 6px 6px 0;}
.sig-block{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px;padding-top:20px;border-top:2px solid #eee;}
.sig-line{border-top:1px solid #333;padding-top:6px;font-size:11px;color:#666;margin-top:50px;}
.footer{margin-top:40px;padding-top:16px;border-top:1px solid #eee;display:flex;justify-content:space-between;font-size:10px;color:#999;}
@media print{body{padding:20px;}@page{margin:1.5cm;size:letter;}}
</style></head><body>
<div class="hdr">
  <div>
    <div class="brand-row"><img class="brand-logo" src="${(typeof window!=='undefined'&&window.NBD_LOGO_DATA_URI)?window.NBD_LOGO_DATA_URI:(this._assetOrigin()+'/assets/images/nbd-logo.png')}" alt="${this.COMPANY.name}"/><div class="brand">${this.COMPANY.name}</div></div>
    <div class="badge">${typeName}</div>
  </div>
  <div><div class="doc-type">${typeName}</div><div class="doc-date">${date}</div></div>
</div>
${name || addr ? `<h2>Customer Information</h2>
<table>
  ${name ? '<tr><td style="padding:8px 12px;font-weight:600;color:#1e3a6e;width:180px;border-bottom:1px solid #f0f0f0;">Homeowner</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">' + name + '</td></tr>' : ''}
  ${addr ? '<tr><td style="padding:8px 12px;font-weight:600;color:#1e3a6e;width:180px;border-bottom:1px solid #f0f0f0;">Address</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">' + addr + '</td></tr>' : ''}
  ${phone ? '<tr><td style="padding:8px 12px;font-weight:600;color:#1e3a6e;width:180px;border-bottom:1px solid #f0f0f0;">Phone</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">' + phone + '</td></tr>' : ''}
  ${email ? '<tr><td style="padding:8px 12px;font-weight:600;color:#1e3a6e;width:180px;border-bottom:1px solid #f0f0f0;">Email</td><td style="padding:8px 12px;border-bottom:1px solid #f0f0f0;">' + email + '</td></tr>' : ''}
</table>` : ''}
${fieldRows ? '<h2>Details</h2><table>' + fieldRows + '</table>' : ''}
${desc ? '<h2>Description</h2><div class="desc">' + desc + '</div>' : ''}
${price ? '<div style="text-align:right;margin:24px 0;"><span style="font-size:12px;color:#666;">Total:</span> <span style="font-family:\'Barlow Condensed\',sans-serif;font-size:32px;font-weight:800;color:#e8720c;">' + (String(price).startsWith('$') ? price : '$' + price) + '</span></div>' : ''}
<div class="sig-block">
  <div><div class="sig-line">Homeowner Signature</div><div style="margin-top:16px;"><div class="sig-line">Date</div></div></div>
  <div><div class="sig-line">Contractor Signature</div><div style="margin-top:16px;"><div class="sig-line">Date</div></div></div>
</div>
<div class="footer"><span>${this.COMPANY.name} · ${this.COMPANY.phone} · ${this.COMPANY.website}</span><span>Generated by NBD Pro</span></div>
</body></html>`;
  },

  // ═══════════════════════════════════════════════════════════
  // CUSTOMER REPORT TEMPLATE
  // Multi-section, multi-page-friendly project summary for the
  // "Export PDF" button on a customer's portal page. Unlike the
  // single-page contract/invoice templates, this report grows
  // vertically and paginates naturally on print — long activity
  // histories no longer get truncated.
  // ═══════════════════════════════════════════════════════════
  renderCustomerReport(data = {}) {
    const cp = data.companyProfile || (window.NBD_COMPANY_PROFILE_DEFAULTS || {});
    const C = this.COMPANY;
    const L = this._letterhead(data);
    const esc = (s) => String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    const toDate = (d) => {
      if (!d) return null;
      const dt = d.toDate ? d.toDate() : (d instanceof Date ? d : new Date(d));
      return isNaN(dt.getTime()) ? null : dt;
    };
    const fmtDate = (d) => {
      const dt = toDate(d);
      return dt ? dt.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '—';
    };
    const fmtDateTime = (d) => {
      const dt = toDate(d);
      return dt ? dt.toLocaleString('en-US', { year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) : '—';
    };
    const fmtMoney = (v) => {
      if (v == null || v === '') return null;
      const n = parseFloat(String(v).replace(/[^0-9.\-]/g,''));
      if (!isFinite(n)) return null;
      return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    };

    const customer = data.customer || {};
    const project = data.project || {};
    const timeline = Array.isArray(data.timeline) ? data.timeline : [];
    const estimates = Array.isArray(data.estimates) ? data.estimates : [];
    const notes = Array.isArray(data.notes) ? data.notes : [];

    const fullName = customer.name
      || ((customer.firstName || '') + ' ' + (customer.lastName || '')).trim()
      || 'Customer';

    const logoSrc = (typeof window !== 'undefined' && window.NBD_LOGO_DATA_URI)
      ? window.NBD_LOGO_DATA_URI
      : this._assetOrigin() + '/assets/images/nbd-logo.png';

    const today = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

    const STAGE_LABELS = {
      new: 'New', contacted: 'Contacted', inspected: 'Inspected',
      claim_filed: 'Claim Filed', adjuster_meeting_scheduled: 'Adjuster Meeting',
      adjuster_inspection_done: 'Adjuster Done', scope_received: 'Scope Received',
      estimate_submitted: 'Estimate Submitted', supplement_requested: 'Supplement Requested',
      supplement_approved: 'Supplement Approved', contract_signed: 'Contract Signed',
      job_created: 'Job Created', permit_pulled: 'Permit Pulled',
      materials_ordered: 'Materials Ordered', materials_delivered: 'Materials Delivered',
      crew_scheduled: 'Crew Scheduled', install_in_progress: 'Installing',
      install_complete: 'Install Complete', final_photos: 'Final Photos',
      deductible_collected: 'Deductible Collected', final_payment: 'Final Payment',
      closed: 'Closed'
    };
    const JOB_TYPE_LABELS = { insurance: 'Insurance', cash: 'Cash', finance: 'Finance', warranty: 'Warranty', service: 'Service' };

    const customerRowsHtml = [
      ['Customer',    fullName],
      ['Address',     customer.address],
      ['Phone',       customer.phone],
      ['Email',       customer.email],
      ['Stage',       customer.stage ? (STAGE_LABELS[customer.stage] || customer.stage) : null],
      ['Lead since',  customer.createdAt ? fmtDate(customer.createdAt) : null]
    ].filter(([k, v]) => v && v !== '—').map(([k, v]) =>
      `<tr><td class="kv-k">${esc(k)}</td><td class="kv-v">${esc(v)}</td></tr>`
    ).join('');

    const projectRowsHtml = [
      ['Job type',          project.jobType ? (JOB_TYPE_LABELS[project.jobType] || project.jobType) : null],
      ['Damage type',       project.damageType],
      ['Insurance carrier', project.insCarrier],
      ['Claim #',           project.claimNumber],
      ['Claim status',      project.claimStatus],
      ['Deductible',        fmtMoney(project.deductible)],
      ['Job value',         fmtMoney(project.jobValue)],
      ['Crew',              project.crew],
      ['Scheduled',         project.scheduledDate ? fmtDate(project.scheduledDate) : null],
      ['Scope of work',     project.scopeOfWork]
    ].filter(([k, v]) => v && v !== '—').map(([k, v]) =>
      `<tr><td class="kv-k">${esc(k)}</td><td class="kv-v">${esc(v)}</td></tr>`
    ).join('');

    const TYPE_BADGE = {
      stage:         { label: 'Stage',    bg: '#dbeafe', fg: '#1e3a6e' },
      task:          { label: 'Task',     bg: '#fef3c7', fg: '#92400e' },
      document:      { label: 'Document', bg: '#e9d5ff', fg: '#6b21a8' },
      photo:         { label: 'Photo',    bg: '#d1fae5', fg: '#065f46' },
      communication: { label: 'Contact',  bg: '#fee2e2', fg: '#991b1b' },
      note:          { label: 'Note',     bg: '#f3f4f6', fg: '#374151' }
    };
    const timelineRowsHtml = timeline.map(t => {
      const badge = TYPE_BADGE[t.type] || TYPE_BADGE.note;
      return `
        <div class="tl-row">
          <div class="tl-time">${esc(fmtDateTime(t.time))}</div>
          <div class="tl-body">
            <div class="tl-title">
              <span class="tl-badge" style="background:${badge.bg};color:${badge.fg};">${esc(badge.label)}</span>
              <span>${esc(t.title || '')}</span>
            </div>
            ${t.desc ? `<div class="tl-desc">${esc(t.desc)}</div>` : ''}
          </div>
        </div>`;
    }).join('');

    const estimateRowsHtml = estimates.map(e => {
      const title = e.title || e.name || 'Estimate';
      const amount = (e.amount != null && e.amount !== '') ? (fmtMoney(e.amount) || 'Draft') : 'Draft';
      const created = e.createdAt ? fmtDate(e.createdAt) : '—';
      const note = e.notes || e.description || '';
      return `
        <tr><td>${esc(title)}</td><td>${esc(created)}</td><td class="num">${esc(amount)}</td></tr>
        ${note ? `<tr class="est-note"><td colspan="3">${esc(note)}</td></tr>` : ''}`;
    }).join('');

    const notesBlocksHtml = notes.map(n => `
      <div class="note-card">
        <div class="note-meta">${esc(n.createdBy || 'Note')} &middot; ${esc(n.createdAt ? fmtDateTime(n.createdAt) : '')}</div>
        <div class="note-body">${esc(n.text || '').replace(/\n/g, '<br>')}</div>
      </div>`).join('');

    const serviceArea = esc(cp.serviceArea || '');
    const tagline = esc(L.tagline);
    const disclaimer = cp.cancellationProposalShort ? esc(cp.cancellationProposalShort) : '';
    const customerRowsFinal = customerRowsHtml || `<tr><td class="kv-k">Customer</td><td class="kv-v">${esc(fullName)}</td></tr>`;

    return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<title>Customer Report — ${esc(fullName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  html,body{font-family:'Barlow',sans-serif;color:#1a1a2e;background:#f6f6f8;}
  body{padding:24px;}
  .page{max-width:8.5in;margin:0 auto;background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.08);border-radius:6px;overflow:hidden;}

  .doc-hdr{background:linear-gradient(180deg,${C.colors.primary} 0%,${C.colors.secondary} 100%);color:#fff;padding:24px 36px 18px 36px;border-bottom:6px solid ${C.colors.accent};}
  .doc-hdr-top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;}
  .doc-hdr-logo{display:block;width:160px;height:auto;background:#fff;border-radius:8px;padding:6px 10px;box-sizing:border-box;}
  .doc-hdr-contact{font:600 10.5px/1.5 Barlow,sans-serif;text-align:right;color:rgba(255,255,255,.92);letter-spacing:.02em;}
  .doc-hdr-contact > div + div{margin-top:1px;}
  .doc-hdr-co{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:20px;letter-spacing:.04em;text-transform:uppercase;margin-top:10px;}
  .doc-hdr-tag{font:italic 400 12px/1.3 Georgia,serif;color:${C.colors.accent};margin-top:2px;}
  .doc-hdr-row{margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.18);font:600 10.5px/1.4 Barlow,sans-serif;color:rgba(255,255,255,.86);letter-spacing:.02em;}

  .doc-title{font-family:'Barlow Condensed',sans-serif;font-weight:800;text-transform:uppercase;letter-spacing:2px;font-size:26px;color:${C.colors.secondary};text-align:center;margin:18px 36px 4px 36px;padding-bottom:10px;border-bottom:3px solid ${C.colors.accent};}
  .doc-sub{text-align:center;color:#666;font:600 11px/1.3 Barlow,sans-serif;letter-spacing:.04em;margin:6px 36px 18px 36px;}

  .section{margin:18px 36px;}
  h2{font-family:'Barlow Condensed',sans-serif;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.18em;color:${C.colors.accent};margin:0 0 10px 0;padding-bottom:4px;border-bottom:1px solid #eee;}

  table.kv{width:100%;border-collapse:collapse;font-size:12px;}
  table.kv td{padding:7px 10px;border-bottom:1px solid #f0f0f0;vertical-align:top;}
  .kv-k{font-weight:600;color:${C.colors.primary};width:160px;white-space:nowrap;}
  .kv-v{color:#1a1a2e;}

  .tl-row{display:flex;gap:14px;padding:10px 12px;border-left:3px solid ${C.colors.accent};background:linear-gradient(90deg,rgba(232,114,12,.05) 0%,rgba(232,114,12,0) 60%);border-radius:0 6px 6px 0;margin-bottom:8px;page-break-inside:avoid;break-inside:avoid;}
  .tl-time{font:600 10.5px/1.3 Barlow,sans-serif;color:#666;width:130px;flex:0 0 130px;}
  .tl-body{flex:1;min-width:0;}
  .tl-title{font:700 12px/1.3 Barlow,sans-serif;color:#1a1a2e;display:flex;align-items:center;gap:8px;}
  .tl-badge{font:700 9px/1 Barlow,sans-serif;text-transform:uppercase;letter-spacing:.1em;padding:3px 7px;border-radius:3px;white-space:nowrap;}
  .tl-desc{font:500 11px/1.4 Barlow,sans-serif;color:#555;margin-top:3px;word-wrap:break-word;}
  .tl-empty{font:500 11px/1.4 Barlow,sans-serif;color:#999;font-style:italic;padding:8px 12px;}

  table.est{width:100%;border-collapse:collapse;font-size:12px;}
  table.est thead{background:${C.colors.primary};color:#fff;}
  table.est th,table.est td{padding:8px 10px;text-align:left;border-bottom:1px solid #e5e7eb;}
  table.est th{font:700 10.5px/1.2 Barlow,sans-serif;text-transform:uppercase;letter-spacing:.08em;}
  table.est td.num{text-align:right;font-weight:700;color:${C.colors.accent};font-family:'Barlow Condensed',sans-serif;font-size:14px;}
  table.est tr.est-note td{background:#fafafa;color:#666;font-size:11px;font-style:italic;padding-top:6px;padding-bottom:10px;}

  .note-card{background:#fafbfc;border-left:3px solid ${C.colors.accent};border-radius:0 6px 6px 0;padding:10px 14px;margin-bottom:8px;page-break-inside:avoid;break-inside:avoid;}
  .note-meta{font:600 10px/1.3 Barlow,sans-serif;color:#666;margin-bottom:4px;}
  .note-body{font:500 12px/1.5 Barlow,sans-serif;color:#1a1a2e;word-wrap:break-word;}

  .doc-ftr{margin-top:24px;padding:14px 36px 18px 36px;background:linear-gradient(180deg,${C.colors.secondary} 0%,${C.colors.primary} 100%);color:rgba(255,255,255,.92);border-top:4px solid ${C.colors.accent};text-align:center;font:600 10px/1.5 Barlow,sans-serif;letter-spacing:.04em;}
  .doc-ftr .ftr-brand{display:block;font:800 11px/1.2 Barlow,sans-serif;color:#fff;letter-spacing:.1em;text-transform:uppercase;margin-bottom:3px;}
  .doc-ftr .ftr-disc{display:block;font-size:9px;color:rgba(255,255,255,.7);margin-top:6px;line-height:1.4;font-style:italic;}

  @media print{
    html,body{background:#fff;}
    body{padding:0;}
    .page{max-width:none;margin:0;box-shadow:none;border-radius:0;}
    h2{page-break-after:avoid;break-after:avoid;}
    .tl-row,.note-card{page-break-inside:avoid;break-inside:avoid;}
    @page{size:letter;margin:0.4in;}
  }
</style></head>
<body>
<div class="page">
  <div class="doc-hdr">
    <div class="doc-hdr-top">
      <img class="doc-hdr-logo" src="${logoSrc}" alt="${esc(L.name)}"/>
      <div class="doc-hdr-contact">
        <div>${esc(L.phone)}</div>
        <div>${esc(L.email)}</div>
        <div>${esc(L.website)}</div>
      </div>
    </div>
    <div class="doc-hdr-co">${esc(L.name)}</div>
    <div class="doc-hdr-tag">${tagline}</div>
    <div class="doc-hdr-row">${esc(L.phone)} &nbsp;|&nbsp; ${esc(L.email)} &nbsp;|&nbsp; ${esc(L.website)}${L.address ? ' &nbsp;|&nbsp; ' + esc(L.address) : ''}${serviceArea ? ' &nbsp;|&nbsp; ' + serviceArea : ''}</div>
  </div>

  <div class="doc-title">Customer Report</div>
  <div class="doc-sub">Prepared by ${esc(L.name)} &middot; ${esc(today)}</div>

  <div class="section">
    <h2>Customer</h2>
    <table class="kv"><tbody>${customerRowsFinal}</tbody></table>
  </div>

  ${projectRowsHtml ? `
  <div class="section">
    <h2>Project Details</h2>
    <table class="kv"><tbody>${projectRowsHtml}</tbody></table>
  </div>` : ''}

  <div class="section">
    <h2>Activity Timeline</h2>
    ${timelineRowsHtml || '<div class="tl-empty">No activity recorded yet.</div>'}
  </div>

  ${estimates.length ? `
  <div class="section">
    <h2>Estimates</h2>
    <table class="est">
      <thead><tr><th>Title</th><th>Date</th><th style="text-align:right;">Amount</th></tr></thead>
      <tbody>${estimateRowsHtml}</tbody>
    </table>
  </div>` : ''}

  ${notes.length ? `
  <div class="section">
    <h2>Notes</h2>
    ${notesBlocksHtml}
  </div>` : ''}

  <div class="doc-ftr">
    <span class="ftr-brand">${esc(L.name)}</span>
    <span>${esc(L.phone)} &nbsp;|&nbsp; ${esc(L.email)} &nbsp;|&nbsp; ${esc(L.website)}</span>
    ${disclaimer ? `<span class="ftr-disc">${disclaimer}</span>` : ''}
  </div>
</div>
</body></html>`;
  },

  renderFillFormModal(documentType) {
    const fields = this.getFormFieldsForDocumentType(documentType);
    const docName = this.DOCUMENT_TYPES[documentType]?.name || documentType;
    const self = this;

    // Build auto-fill lead selector if leads available
    let leadOptions = '<option value="">— Fill manually —</option>';
    if (window._leads && window._leads.length) {
      window._leads.forEach(l => {
        const name = ((l.firstName||'')+ ' ' + (l.lastName||'')).trim() || 'Unnamed';
        leadOptions += `<option value="${l.id}">${name} — ${l.address||'No address'}</option>`;
      });
    }

    // Build form fields
    let fieldsHTML = '';
    fields.forEach(f => {
      const id = 'docgen_' + f.name;
      if (f.type === 'textarea') {
        fieldsHTML += `<div style="margin-bottom:14px;"><label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">${f.label}${f.required?'<span style="color:#e8720c;">*</span>':''}</label>
          <textarea id="${id}" rows="3" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;resize:vertical;font-family:inherit;" placeholder="${f.label}"></textarea></div>`;
      } else if (f.type === 'select') {
        const opts = (f.options||[]).map(o => `<option value="${o}">${o.charAt(0).toUpperCase()+o.slice(1)}</option>`).join('');
        fieldsHTML += `<div style="margin-bottom:14px;"><label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">${f.label}</label>
          <select id="${id}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">${opts}</select></div>`;
      } else {
        fieldsHTML += `<div style="margin-bottom:14px;"><label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">${f.label}${f.required?'<span style="color:#e8720c;">*</span>':''}</label>
          <input type="text" id="${id}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;" placeholder="${f.label}"></div>`;
      }
    });

    const modal = document.createElement('div');
    modal.id = 'docgenFillModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10010;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:600px;width:95%;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;">
        <div style="padding:20px 24px;border-bottom:2px solid #eee;display:flex;justify-content:space-between;align-items:center;">
          <div><div style="font-size:10px;color:#1e3a6e;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Generate Document</div>
          <div style="font-size:18px;font-weight:700;color:#1a1a2e;font-family:'Helvetica Neue',Arial,sans-serif;">${docName}</div></div>
          <button data-dg-action="closeFillModal" style="background:none;border:none;font-size:24px;cursor:pointer;color:#999;">&times;</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:20px 24px;">
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">Auto-fill from Lead</label>
            <select id="docgen_leadSelect" onchange="window._docgenAutoFill(this.value)" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">${leadOptions}</select>
          </div>
          <div style="border-top:1px solid #eee;padding-top:16px;">${fieldsHTML}</div>
        </div>
        <div style="padding:16px 24px;border-top:2px solid #eee;display:flex;justify-content:flex-end;gap:10px;">
          <button data-dg-action="closeFillModal" style="background:#6c757d;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;">Cancel</button>
          <button data-dg-action="submit" data-dg-id="${documentType}" style="background:#e8720c;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-weight:600;">Generate Document</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // Auto-fill handler
    window._docgenAutoFill = function(leadId) {
      if (!leadId || !window._leads) return;
      const lead = window._leads.find(l => l.id === leadId);
      if (!lead) return;
      const fullName = ((lead.firstName||'')+' '+(lead.lastName||'')).trim();
      const map = {
        homeownerName: fullName,
        address: lead.address||'',
        phone: lead.phone||'', homeownerPhone: lead.phone||'',
        email: lead.email||'', homeownerEmail: lead.email||'',
        claimNumber: lead.claimNumber||'',
        policyNumber: lead.policyNumber||'',
        insuranceCompany: lead.insCarrier||lead.insuranceCompany||'',
        totalPrice: lead.jobValue||lead.estimateAmount||'',
        contractPrice: lead.jobValue||lead.estimateAmount||'',
        totalAmount: lead.jobValue||lead.estimateAmount||'',
        originalApproved: lead.estimateAmount||lead.jobValue||'',
        estimatedRepairCost: lead.estimateAmount||lead.jobValue||'',
        projectDescription: lead.scopeOfWork||lead.notes||'',
        scopeSummary: lead.scopeOfWork||lead.notes||'',
        workPerformed: lead.scopeOfWork||lead.notes||'',
        workDescription: lead.scopeOfWork||lead.notes||'',
        projectType: lead.jobType||'',
        dateOfLoss: lead.dateOfLoss||'',
        damageType: lead.damageType||'',
        startDate: lead.scheduledDate||'',
        completionDate: lead.completionDate||'',
        inspectorName: lead.assignedTo||'',
        deductibleAmount: lead.deductibleOrOwedByHO||'',
        notes: lead.notes||'',
        warrantyTier: lead.warrantyTier||'best',
        estimatedTimeline: lead.estimatedTimeline||''
      };
      Object.keys(map).forEach(k => {
        const el = document.getElementById('docgen_'+k);
        if (el && map[k]) el.value = map[k].toString().trim();
      });
    };

    // Submit handler
    window._docgenSubmit = function(type) {
      const data = {};
      fields.forEach(f => {
        const el = document.getElementById('docgen_'+f.name);
        if (el) data[f.name] = el.value;
      });
      document.getElementById('docgenFillModal').remove();
      self.generate(type, data);
    };
  },

  /**
   * Get form fields for a document type
   * @private
   * @param {string} type - Document type
   * @returns {array} Field definitions
   */
  getFormFieldsForDocumentType(type) {
    const commonFields = [
      { name: 'homeownerName', label: 'Homeowner Name', required: true },
      { name: 'address', label: 'Property Address', required: true },
      { name: 'phone', label: 'Phone Number', required: false },
      { name: 'email', label: 'Email Address', required: false }
    ];

    const insuranceFields = [
      { name: 'claimNumber', label: 'Claim Number', required: true },
      { name: 'policyNumber', label: 'Policy Number', required: false },
      { name: 'insuranceCompany', label: 'Insurance Company', required: true },
      { name: 'dateOfLoss', label: 'Date of Loss', required: true }
    ];

    const typeSpecificFields = {
      proposal: [
        ...commonFields,
        { name: 'projectDescription', label: 'Project Description', required: true, type: 'textarea' },
        { name: 'totalPrice', label: 'Total Price', required: true },
        { name: 'warrantyTier', label: 'Warranty Tier', required: true, type: 'select', options: ['good', 'better', 'best'] }
      ],
      contract: [
        ...commonFields,
        { name: 'contractPrice', label: 'Contract Price', required: true },
        { name: 'projectDescription', label: 'Scope of Work', required: true, type: 'textarea' },
        { name: 'startDate', label: 'Start Date', required: true },
        { name: 'estimatedCompletion', label: 'Estimated Completion', required: true },
        { name: 'warrantyTier', label: 'Warranty Tier', required: true, type: 'select', options: ['good', 'better', 'best'] }
      ],
      inspectionHomeowner: [
        ...commonFields,
        { name: 'inspectorName', label: 'Inspector Name', required: true },
        { name: 'overallConditionGrade', label: 'Overall Grade', required: true, type: 'select', options: ['A', 'B', 'C', 'D', 'F'] },
        { name: 'damageType', label: 'Type of Damage', required: false },
        { name: 'projectDescription', label: 'Notes / Findings', required: false, type: 'textarea' }
      ],
      inspectionInsurance: [
        ...commonFields,
        ...insuranceFields,
        { name: 'damageType', label: 'Type of Damage', required: true },
        { name: 'estimatedRepairCost', label: 'Estimated Repair Cost', required: true },
        { name: 'inspectorName', label: 'Inspector Name', required: false }
      ],
      warranty_certificate: [
        ...commonFields,
        { name: 'warrantyTier', label: 'Warranty Tier', required: true, type: 'select', options: ['good', 'better', 'best'] },
        { name: 'workPerformed', label: 'Work Performed', required: true, type: 'textarea' },
        { name: 'issueDate', label: 'Issue Date', required: false }
      ],
      supplement_request: [
        ...commonFields,
        ...insuranceFields,
        { name: 'originalApproved', label: 'Original Approved Amount', required: true },
        { name: 'justification', label: 'Justification / Reason', required: true, type: 'textarea' }
      ],
      scope_of_work: [
        ...commonFields,
        { name: 'projectDescription', label: 'Project Description', required: true, type: 'textarea' },
        { name: 'materials', label: 'Material Specifications', required: false, type: 'textarea' },
        { name: 'estimatedTimeline', label: 'Estimated Timeline', required: false },
        { name: 'exclusions', label: 'Exclusions', required: false, type: 'textarea' }
      ],
      work_authorization: [
        ...commonFields,
        { name: 'scopeSummary', label: 'Scope Summary', required: true, type: 'textarea' },
        { name: 'startDate', label: 'Authorized Start Date', required: true },
        { name: 'emergencyContact', label: 'Emergency Contact', required: false },
        { name: 'accessInstructions', label: 'Property Access Instructions', required: false, type: 'textarea' },
        { name: 'isInsurance', label: 'Insurance Job?', required: false, type: 'select', options: ['false', 'true'] },
        { name: 'claimNumber', label: 'Claim Number', required: false },
        { name: 'insuranceCompany', label: 'Insurance Company', required: false }
      ],
      certificate_of_completion: [
        ...commonFields,
        { name: 'scopeSummary', label: 'Work Performed', required: true, type: 'textarea' },
        { name: 'startDate', label: 'Start Date', required: true },
        { name: 'completionDate', label: 'Completion Date', required: true },
        { name: 'inspectorName', label: 'Inspector / Crew Lead', required: false },
        { name: 'warrantyTier', label: 'Warranty Tier', required: false, type: 'select', options: ['good', 'better', 'best'] }
      ],
      change_order: [
        ...commonFields,
        { name: 'originalContractNumber', label: 'Original Contract #', required: true },
        { name: 'originalContractDate', label: 'Original Contract Date', required: false },
        { name: 'changeOrderNumber', label: 'Change Order #', required: true },
        { name: 'changesDescription', label: 'Description of Changes', required: true, type: 'textarea' },
        { name: 'originalTotal', label: 'Original Contract Total', required: true },
        { name: 'scheduleImpact', label: 'Schedule Impact', required: false }
      ],
      invoice: [
        ...commonFields,
        { name: 'homeownerPhone', label: 'Homeowner Phone', required: false },
        { name: 'homeownerEmail', label: 'Homeowner Email', required: false },
        { name: 'invoiceNumber', label: 'Invoice Number', required: true },
        { name: 'dueDate', label: 'Due Date', required: false },
        { name: 'totalAmount', label: 'Total Amount', required: true },
        { name: 'taxRate', label: 'Tax Rate (decimal, e.g. 0.06)', required: false },
        { name: 'paymentsReceived', label: 'Payments Already Received', required: false },
        { name: 'claimNumber', label: 'Claim # (if insurance)', required: false },
        { name: 'insuranceCompany', label: 'Insurance Company', required: false },
        { name: 'notes', label: 'Notes', required: false, type: 'textarea' }
      ],
      company_intro: [],
      before_after_report: [
        ...commonFields,
        { name: 'projectType', label: 'Project Type', required: true },
        { name: 'startDate', label: 'Start Date', required: false },
        { name: 'completionDate', label: 'Completion Date', required: false },
        { name: 'workDescription', label: 'Work Description', required: true, type: 'textarea' }
      ],
      financing_options: [
        { name: 'homeownerName', label: 'Homeowner Name', required: false },
        { name: 'totalPrice', label: 'Project Total', required: true }
      ],
      referral_card: [],
      assignment_of_benefits: [
        ...commonFields,
        ...insuranceFields,
        { name: 'scopeSummary', label: 'Scope of Work Summary', required: true, type: 'textarea' }
      ],
      material_delivery: [
        ...commonFields,
        { name: 'deliveryDate', label: 'Delivery Date', required: true },
        { name: 'deliveryTime', label: 'Delivery Window', required: false },
        { name: 'startDate', label: 'Project Start Date', required: false }
      ],
      storm_checklist: [],
      claim_guide: [],
      door_hanger: [],
      neighborhood_mailer: [
        { name: 'neighborhoodName', label: 'Neighborhood Name', required: true },
        { name: 'projectAddress', label: 'Nearby Project Address', required: false }
      ],
      testimonial_sheet: [],
      thank_you: [
        ...commonFields,
        { name: 'projectType', label: 'Project Type', required: true },
        { name: 'completionDate', label: 'Completion Date', required: false }
      ],
      payment_agreement: [
        ...commonFields,
        { name: 'totalAmount', label: 'Total Contract Amount', required: true },
        { name: 'depositAmount', label: 'Deposit Amount', required: false },
        { name: 'depositDue', label: 'Deposit Due', required: false },
        { name: 'progressAmount', label: 'Progress Payment Amount', required: false },
        { name: 'progressDue', label: 'Progress Payment Due', required: false },
        { name: 'finalAmount', label: 'Final Payment Amount', required: false },
        { name: 'finalDue', label: 'Final Payment Due', required: false },
        { name: 'projectDescription', label: 'Project Description', required: false, type: 'textarea' }
      ]
    };

    return typeSpecificFields[type] || commonFields;
  }

};

// Export to window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = window.NBDDocGen;
}


// ── CSP-safe delegation for 9 data-dg-action attrs in document-generator.js
//    (close window, print, dismiss fill modal, submit doc gen).
(function () {
  if (window._NBD_DG_DELEGATE_BOUND) return;
  window._NBD_DG_DELEGATE_BOUND = true;
  document.addEventListener('click', function (ev) {
    const t = ev.target.closest && ev.target.closest('[data-dg-action]');
    if (!t) return;
    const action = t.dataset.dgAction;
    const id = t.dataset.dgId;
    try {
      switch (action) {
        case 'closeWindow':     window.close(); break;
        case 'print':           window.print(); break;
        case 'closeFillModal':  { const m = document.getElementById('docgenFillModal'); if (m) m.remove(); break; }
        case 'submit':          if (typeof window._docgenSubmit === 'function') window._docgenSubmit(id); break;
        default:                console.warn('[doc-generator] no dispatch for', action);
      }
    } catch (e) { console.error('[doc-generator] dispatch ' + action + ' failed:', e); }
  });
})();
