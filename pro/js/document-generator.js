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
    email: 'info@nobigdeal.pro',
    website: 'nobigdealwithjoedeal.com',
    tagline: 'No Big Deal — We\'ve Got You Covered',
    address: '', // Optional
    colors: {
      primary: '#C8541A',    // Burnt orange
      secondary: '#1a1a2e',  // Dark navy
      accent: '#C8541A',
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
    proposal: { name: 'Proposal/Estimate', template: 'renderProposal' },
    contract: { name: 'Roofing Contract', template: 'renderContract' },
    inspectionHomeowner: { name: 'Inspection Report (Homeowner)', template: 'renderInspectionHomeowner' },
    inspectionInsurance: { name: 'Inspection Report (Insurance)', template: 'renderInspectionInsurance' }
  },

  // ============================================================================
  // SECTION 2: CORE ENGINE METHODS
  // ============================================================================

  /**
   * Generate document and open in new window with print button
   * @param {string} type - Document type (proposal, contract, inspectionHomeowner, inspectionInsurance)
   * @param {object} data - Merge field data
   */
  generate(type, data = {}) {
    const html = this.getHTML(type, data);
    if (!html) {
      alert('Error: Document type not found.');
      return;
    }
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
  },

  /**
   * Get raw HTML string for document (without opening window)
   * @param {string} type - Document type
   * @param {object} data - Merge field data
   * @returns {string} Complete HTML document
   */
  getHTML(type, data = {}) {
    const template = this[this.DOCUMENT_TYPES[type]?.template];
    if (!template) {
      console.error(`Unknown document type: ${type}`);
      return null;
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
          border-top: 8px solid ${this.COMPANY.colors.primary};
          border-bottom: 2px solid ${this.COMPANY.colors.borderGray};
          padding-bottom: 0.3in;
          margin-bottom: 0.3in;
        }

        .header-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 0.15in;
        }

        .header-logo {
          flex: 1;
        }

        .header-logo svg {
          height: 60px;
        }

        .header-info {
          font-size: 11px;
          text-align: right;
          color: #666;
          line-height: 1.4;
        }

        .header-company-name {
          font-size: 18px;
          font-weight: bold;
          color: ${this.COMPANY.colors.secondary};
          font-family: 'Helvetica Neue', Arial, sans-serif;
          margin: 0.1in 0;
        }

        .header-contact-row {
          font-size: 11px;
          color: #666;
          margin-top: 0.1in;
          border-top: 1px solid ${this.COMPANY.colors.borderGray};
          padding-top: 0.1in;
        }

        .document-title {
          font-size: 24px;
          font-weight: bold;
          color: ${this.COMPANY.colors.secondary};
          text-align: center;
          font-family: 'Helvetica Neue', Arial, sans-serif;
          margin: 0.2in 0;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .document-subtitle {
          font-size: 12px;
          text-align: center;
          color: #666;
          margin-bottom: 0.2in;
        }

        .document-content {
          flex: 1;
          overflow: hidden;
          font-size: 11px;
        }

        .section {
          margin-bottom: 0.25in;
          padding-left: 0.15in;
          border-left: 3px solid ${this.COMPANY.colors.primary};
          padding: 0.15in;
          padding-left: 0.15in;
        }

        .section-title {
          font-size: 13px;
          font-weight: bold;
          color: ${this.COMPANY.colors.secondary};
          font-family: 'Helvetica Neue', Arial, sans-serif;
          margin-bottom: 0.1in;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-bottom: 1px solid ${this.COMPANY.colors.primary};
          padding-bottom: 0.05in;
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
          color: ${this.COMPANY.colors.primary};
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
          color: ${this.COMPANY.colors.primary};
          font-weight: bold;
        }

        /* WARRANTY BADGE */
        .warranty-badge {
          display: inline-block;
          padding: 0.15in 0.25in;
          background-color: ${this.COMPANY.colors.primary};
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
          border-top: 2px solid ${this.COMPANY.colors.borderGray};
          border-bottom: 4px solid ${this.COMPANY.colors.primary};
          padding: 0.15in;
          text-align: center;
          font-size: 9px;
          color: #999;
          margin-top: auto;
        }

        .footer-page-number {
          display: inline-block;
          margin: 0 0.2in;
        }

        .footer-credit {
          display: block;
          font-size: 8px;
          margin-top: 0.05in;
        }

        /* PRINT BUTTON */
        .print-button-container {
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 1000;
        }

        .print-button {
          background-color: ${this.COMPANY.colors.primary};
          color: white;
          border: none;
          padding: 0.4in 0.6in;
          border-radius: 4px;
          font-size: 12px;
          font-weight: bold;
          cursor: pointer;
          box-shadow: 0 2px 6px rgba(0,0,0,0.2);
          transition: background-color 0.2s;
        }

        .print-button:hover {
          background-color: #a83f15;
        }

        /* PRINT MEDIA */
        @media print {
          body {
            margin: 0;
            padding: 0;
            background: white;
          }

          .print-button-container {
            display: none;
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
   * Render NBD text logo as inline SVG
   * @private
   * @returns {string} SVG string
   */
  renderNBDLogo() {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" style="height: 60px; width: auto;">
        <!-- NBD Text -->
        <text x="100" y="45" font-family="Arial, sans-serif" font-size="48" font-weight="bold" text-anchor="middle" fill="${this.COMPANY.colors.secondary}">
          NBD
        </text>
        <rect x="135" y="25" width="15" height="30" fill="${this.COMPANY.colors.primary}" rx="2"/>

        <!-- NO BIG DEAL -->
        <text x="100" y="70" font-family="Arial, sans-serif" font-size="11" font-weight="bold" text-anchor="middle" fill="${this.COMPANY.colors.secondary}" letter-spacing="1">
          NO BIG DEAL
        </text>

        <!-- HOME SOLUTIONS -->
        <text x="100" y="85" font-family="Arial, sans-serif" font-size="9" text-anchor="middle" fill="${this.COMPANY.colors.primary}">
          HOME SOLUTIONS
        </text>
      </svg>
    `;
  },

  /**
   * Render branded document header
   * @param {object} data - Header data
   * @returns {string} HTML
   */
  renderHeader(data = {}) {
    const address = data.address || this.COMPANY.address;
    const showAddress = address ? `<div>${address}</div>` : '';

    return `
      <div class="document-header">
        <div class="header-top">
          <div class="header-logo">
            ${this.renderNBDLogo()}
          </div>
          <div class="header-info">
            <div>${this.COMPANY.phone}</div>
            <div>${this.COMPANY.email}</div>
            <div>${this.COMPANY.website}</div>
          </div>
        </div>
        <div class="header-company-name">${this.COMPANY.name}</div>
        <div class="header-contact-row">
          <strong>${this.COMPANY.phone}</strong> | ${this.COMPANY.email} | ${this.COMPANY.website}
          ${showAddress}
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
    const pageNum = data.pageNumber || '';
    const pageText = pageNum ? `<span class="footer-page-number">Page ${pageNum}</span>` : '';

    return `
      <div class="document-footer">
        ${pageText}
        <span class="footer-credit">Generated by NBD Pro</span>
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
    // Merge with defaults
    const merged = {
      homeownerName: 'John Smith',
      address: '123 Main Street, Lexington, KY 40507',
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
      totalPrice: '$11,050.00',
      warrantyTier: 'better',
      photos: null,
      ...data
    };

    // Build line items table
    let lineItemsHTML = '<table><thead><tr><th>Item</th><th style="width: 8%;">Qty</th><th style="width: 10%;">Unit</th><th style="width: 12%;">Unit Price</th><th class="price-column" style="width: 12%;">Total</th></tr></thead><tbody>';

    let total = 0;
    merged.lineItems.forEach(item => {
      const totalAmount = item.total || (item.qty * item.unitPrice);
      total += totalAmount;
      lineItemsHTML += `
        <tr>
          <td>${item.description}</td>
          <td style="text-align: center;">${item.qty}</td>
          <td style="text-align: center;">${item.unit}</td>
          <td class="price-column">$${item.unitPrice.toFixed(2)}</td>
          <td class="price-column">$${totalAmount.toFixed(2)}</td>
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
      scopeHTML += `<li>${item}</li>`;
    });
    scopeHTML += '</ul>';

    // Standard terms
    const termsHTML = `
      <div style="font-size: 10px; line-height: 1.4; color: #555;">
        <strong>Payment Terms:</strong> 50% deposit due upon contract execution; balance due upon project completion. Insurance assignments accepted.
        <br/><br/>
        <strong>Change Orders:</strong> Any changes to the scope of work must be documented in writing and agreed upon before proceeding. Change orders will adjust pricing and timeline accordingly.
        <br/><br/>
        <strong>Cancellation Rights:</strong> You have the right to cancel this agreement within 3 days of signature without penalty (KY Residential Finance Law).
        <br/><br/>
        <strong>Warranty Disclaimer:</strong> Material warranties are provided by manufacturers and are separate from NBD workmanship warranty. See warranty section below.
        <br/><br/>
        <strong>Limitation of Liability:</strong> NBD's total liability shall not exceed the contract price. This proposal is valid for 30 days from date of issue.
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
          <button class="print-button" onclick="window.print()">Print / Save as PDF</button>
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
    const merged = {
      homeownerName: 'John Smith',
      homeownerAddress: '123 Main Street, Lexington, KY 40507',
      contractorName: this.COMPANY.name,
      contractorPhone: this.COMPANY.phone,
      contractPrice: '$11,050.00',
      startDate: 'Upon contract execution',
      estimatedCompletion: '5-7 business days',
      projectDescription: 'Complete roofing system replacement including removal of existing materials, installation of new premium asphalt shingles, underlayment, flashing, and gutters.',
      warrantyTier: 'better',
      paymentSchedule: 'Fifty percent (50%) due upon contract execution; remaining balance due upon substantial completion of work.',
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
          <button class="print-button" onclick="window.print()">Print / Save as PDF</button>
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
                All payments must be made by check, ACH transfer, or credit card. No cash payments accepted.
                Insurance assignment accepted. Material delays may extend timeline.
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
                Any changes to the original scope of work must be documented in writing and signed by both parties before work proceeds. All change orders will specify: description of work, cost adjustments, and timeline impacts. NBD reserves the right to adjust pricing and completion dates based on scope changes.
              </div>
            </div>

            <!-- CANCELLATION CLAUSE -->
            <div class="section">
              <div class="section-title">Cancellation & Rescission Rights</div>
              <div style="margin: 0.1in 0; font-size: 9px;">
                The Homeowner has the right to cancel this agreement within three (3) business days of signature without penalty, as permitted by Kentucky Revised Statutes § 367.390. Any deposit paid will be refunded within 10 days of cancellation notice.
              </div>
            </div>

            <!-- DISPUTE RESOLUTION -->
            <div class="section">
              <div class="section-title">Dispute Resolution</div>
              <div style="margin: 0.1in 0; font-size: 9px;">
                In the event of dispute, both parties agree to attempt resolution through good faith negotiation. If negotiation fails, disputes shall be resolved through mediation or binding arbitration under Kentucky law.
              </div>
            </div>

            <!-- INSURANCE CLAUSE -->
            <div class="section">
              <div class="section-title">Insurance Assignment</div>
              <div style="margin: 0.1in 0; font-size: 9px;">
                If this project is insurance-related, NBD is authorized to accept assignment of insurance proceeds as partial or full payment for work performed. Homeowner agrees to provide proof of insurance coverage and claim number.
              </div>
            </div>

            <!-- ENTIRE AGREEMENT -->
            <div class="section">
              <div class="section-title">Entire Agreement</div>
              <div style="margin: 0.1in 0; font-size: 9px;">
                This contract constitutes the entire agreement between parties and supersedes all prior negotiations, representations, or agreements. Any modifications must be made in writing and signed by both parties.
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
      homeownerName: 'John Smith',
      address: '123 Main Street, Lexington, KY 40507',
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
          <button class="print-button" onclick="window.print()">Print / Save as PDF</button>
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
    const merged = {
      claimantName: 'John Smith',
      claimNumber: 'CLM-2026-0001',
      dateOfLoss: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      propertyAddress: '123 Main Street, Lexington, KY 40507',
      inspectionDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
      inspectorName: 'NBD Damage Assessor',
      damageType: 'Wind Damage',
      estimatedRepairCost: '$11,050.00',
      photos: null,
      ...data
    };

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
          <button class="print-button" onclick="window.print()">Print / Save as PDF</button>
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
                <strong>Current Code Requirements:</strong> All repairs performed in accordance with 2021 International Building Code (IBC) and Kentucky Building Code (KBC). Work complies with manufacturer specifications and NRCA guidelines.
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
        fieldsHTML += `<div style="margin-bottom:14px;"><label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">${f.label}${f.required?'<span style="color:#C8541A;">*</span>':''}</label>
          <textarea id="${id}" rows="3" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;resize:vertical;font-family:inherit;" placeholder="${f.label}"></textarea></div>`;
      } else if (f.type === 'select') {
        const opts = (f.options||[]).map(o => `<option value="${o}">${o.charAt(0).toUpperCase()+o.slice(1)}</option>`).join('');
        fieldsHTML += `<div style="margin-bottom:14px;"><label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">${f.label}</label>
          <select id="${id}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">${opts}</select></div>`;
      } else {
        fieldsHTML += `<div style="margin-bottom:14px;"><label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">${f.label}${f.required?'<span style="color:#C8541A;">*</span>':''}</label>
          <input type="text" id="${id}" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;" placeholder="${f.label}"></div>`;
      }
    });

    const modal = document.createElement('div');
    modal.id = 'docgenFillModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:10010;';
    modal.innerHTML = `
      <div style="background:#fff;border-radius:12px;max-width:600px;width:95%;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;">
        <div style="padding:20px 24px;border-bottom:2px solid #eee;display:flex;justify-content:space-between;align-items:center;">
          <div><div style="font-size:10px;color:#C8541A;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Generate Document</div>
          <div style="font-size:18px;font-weight:700;color:#1a1a2e;font-family:'Helvetica Neue',Arial,sans-serif;">${docName}</div></div>
          <button onclick="document.getElementById('docgenFillModal').remove();" style="background:none;border:none;font-size:24px;cursor:pointer;color:#999;">&times;</button>
        </div>
        <div style="flex:1;overflow-y:auto;padding:20px 24px;">
          <div style="margin-bottom:16px;">
            <label style="display:block;font-weight:600;font-size:13px;margin-bottom:4px;">Auto-fill from Lead</label>
            <select id="docgen_leadSelect" onchange="window._docgenAutoFill(this.value)" style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">${leadOptions}</select>
          </div>
          <div style="border-top:1px solid #eee;padding-top:16px;">${fieldsHTML}</div>
        </div>
        <div style="padding:16px 24px;border-top:2px solid #eee;display:flex;justify-content:flex-end;gap:10px;">
          <button onclick="document.getElementById('docgenFillModal').remove();" style="background:#6c757d;color:#fff;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;">Cancel</button>
          <button onclick="window._docgenSubmit('${documentType}')" style="background:#C8541A;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-weight:600;">Generate Document</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    // Auto-fill handler
    window._docgenAutoFill = function(leadId) {
      if (!leadId || !window._leads) return;
      const lead = window._leads.find(l => l.id === leadId);
      if (!lead) return;
      const map = { homeownerName:(lead.firstName||'')+' '+(lead.lastName||''),
        address:lead.address||'', phone:lead.phone||'', email:lead.email||'',
        claimNumber:lead.claimNumber||'', insuranceCompany:lead.insuranceCompany||'',
        totalPrice:lead.jobValue||'', contractPrice:lead.jobValue||'',
        projectDescription:lead.notes||'', scopeSummary:lead.notes||'',
        dateOfLoss:lead.dateOfLoss||'', damageType:lead.damageType||'' };
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
      { name: 'email', label: 'Email Address', required: false },
      { name: 'date', label: 'Document Date', required: true }
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
        { name: 'overallConditionGrade', label: 'Overall Grade', required: true, type: 'select', options: ['A', 'B', 'C', 'D', 'F'] }
      ],
      inspectionInsurance: [
        ...commonFields,
        { name: 'claimNumber', label: 'Claim Number', required: true },
        { name: 'dateOfLoss', label: 'Date of Loss', required: true },
        { name: 'damageType', label: 'Type of Damage', required: true },
        { name: 'estimatedRepairCost', label: 'Estimated Repair Cost', required: true }
      ]
    };

    return typeSpecificFields[type] || commonFields;
  }

};

// Export to window
if (typeof module !== 'undefined' && module.exports) {
  module.exports = window.NBDDocGen;
}
