/**
 * Inspection Report Engine - NBD Pro Roofing CRM
 * Comprehensive report generation for roofing inspections
 *
 * Depends on:
 * - window._db (Firestore)
 * - window._user, window._auth, window._storage (Firebase)
 * - window._leads (array of lead objects)
 * - window.PhotoEngine (photo management) - gracefully degrades if unavailable
 * - window.showToast(msg, type) - toast notifications
 * - CSS variables: --s, --s2, --t, --m, --br, --orange
 *
 * Exposes: window.InspectionReportEngine
 */

(function() {
  'use strict';

  // Brand constants
  const BRAND = {
    name: 'No Big Deal Home Solutions',
    phone: '(859) 420-7382',
    email: 'info@nobigdeal.pro',
    website: 'nobigdealwithjoedeal.com',
    colors: {
      navy: '#1e3a6e',
      orange: '#C8541A'
    }
  };

  // Template definitions
  const TEMPLATES = {
    FULL_INSPECTION: {
      id: 'full-inspection',
      name: 'Full Roof Inspection Report',
      description: 'Comprehensive roof inspection with components checklist',
      icon: '📋'
    },
    STORM_DAMAGE: {
      id: 'storm-damage',
      name: 'Storm Damage Assessment',
      description: 'Hail/wind damage documentation and insurance claim support',
      icon: '⛈️'
    },
    SUPPLEMENT: {
      id: 'supplement',
      name: 'Insurance Supplement Request',
      description: 'Additional scope items discovered after initial estimate',
      icon: '📝'
    },
    COMPLETION: {
      id: 'completion',
      name: 'Project Completion Report',
      description: 'Work performed, materials used, before/after photos',
      icon: '✅'
    }
  };

  // Roof components for Full Inspection
  const ROOF_COMPONENTS = [
    'Shingles/Material', 'Ridge Caps', 'Hip Caps', 'Starter Strip',
    'Drip Edge', 'Flashing (Wall)', 'Flashing (Chimney)', 'Flashing (Valley)',
    'Flashing (Pipe Boots)', 'Valleys', 'Gutters', 'Downspouts', 'Fascia',
    'Soffit', 'Ridge Vent', 'Box Vents', 'Soffit Vents', 'Skylights',
    'Chimney', 'Satellite Dishes/Mounts', 'Decking'
  ];

  // Condition ratings
  const CONDITIONS = ['Good', 'Fair', 'Poor', 'Critical'];
  const SEVERITY_LEVELS = [1, 2, 3, 4, 5];

  // Report storage
  const REPORTS_COLLECTION = 'reports';
  const STORAGE_KEY_DRAFT = 'nbd_report_draft_';

  /**
   * Main Engine Object
   */
  const Engine = {
    /**
     * Get all available templates
     */
    getTemplates() {
      return Object.values(TEMPLATES);
    },

    /**
     * Get a specific template by ID
     */
    getTemplate(templateId) {
      return Object.values(TEMPLATES).find(t => t.id === templateId);
    },

    /**
     * Get reports for a lead
     */
    async getReports(leadId) {
      try {
        if (!window._db) return [];

        const { collection, getDocs, query, where, orderBy } = await import(
          'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
        );

        const q = query(
          collection(window._db, REPORTS_COLLECTION),
          where('leadId', '==', leadId),
          orderBy('createdAt', 'desc')
        );

        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
      } catch (err) {
        console.error('Error fetching reports:', err);
        return [];
      }
    },

    /**
     * Save a report to Firestore
     */
    async saveReport(leadId, templateId, reportData) {
      try {
        if (!window._db || !window._user) {
          showToast('Database or user not available', 'error');
          return null;
        }

        const { collection, doc, setDoc, serverTimestamp } = await import(
          'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
        );

        const reportId = `report_${Date.now()}`;
        const reportDoc = {
          leadId,
          templateId,
          type: this.getTemplate(templateId)?.name,
          status: 'complete',
          createdAt: serverTimestamp(),
          createdBy: window._user.uid,
          html: reportData.html,
          data: reportData.data,
          photoIds: reportData.photoIds || [],
          metadata: {
            propertyAddress: reportData.propertyAddress,
            inspectorName: reportData.inspectorName,
            inspectionDate: reportData.inspectionDate
          }
        };

        await setDoc(doc(window._db, REPORTS_COLLECTION, reportId), reportDoc);
        showToast('Report saved successfully', 'success');
        return reportId;
      } catch (err) {
        console.error('Error saving report:', err);
        showToast('Failed to save report', 'error');
        return null;
      }
    },

    /**
     * Delete a report
     */
    async deleteReport(reportId) {
      try {
        if (!window._db) return false;

        const { collection, doc, deleteDoc } = await import(
          'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
        );

        await deleteDoc(doc(window._db, REPORTS_COLLECTION, reportId));
        showToast('Report deleted', 'success');
        return true;
      } catch (err) {
        console.error('Error deleting report:', err);
        showToast('Failed to delete report', 'error');
        return false;
      }
    },

    /**
     * Generate report HTML from template and data
     */
    generateReport(leadId, templateId, data) {
      const template = this.getTemplate(templateId);
      if (!template) {
        showToast('Invalid template', 'error');
        return null;
      }

      let html = '';
      switch (templateId) {
        case 'full-inspection':
          html = this._generateFullInspection(leadId, data);
          break;
        case 'storm-damage':
          html = this._generateStormDamage(leadId, data);
          break;
        case 'supplement':
          html = this._generateSupplement(leadId, data);
          break;
        case 'completion':
          html = this._generateCompletion(leadId, data);
          break;
      }

      return html;
    },

    /**
     * Generate Full Inspection Report
     */
    _generateFullInspection(leadId, data) {
      const lead = this._getLead(leadId);
      if (!lead) return '';

      const {
        roofType, roofAge, totalSquares, slopes,
        components = {}, damageAssessment = {}, recommendations = '',
        inspectorName, inspectionDate, estimatedWork = []
      } = data;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Roof Inspection Report</title>
          <style>
            ${this._getPrintStyles()}
          </style>
        </head>
        <body>
          <div class="report-container">
            <!-- COVER PAGE -->
            <div class="page cover-page">
              <div class="cover-header">
                <div class="brand-logo" style="font-size: 28px; font-weight: bold; color: ${BRAND.colors.navy};">
                  🏠 ${BRAND.name}
                </div>
                <div class="cover-title">FULL ROOF INSPECTION REPORT</div>
              </div>

              <div class="cover-content">
                <div class="cover-section">
                  <h3>Property Address</h3>
                  <p>${this._escapeHtml(lead.address || 'N/A')}</p>
                </div>

                <div class="cover-section">
                  <h3>Property Owner</h3>
                  <p>${this._escapeHtml(lead.name || 'N/A')}</p>
                </div>

                <div class="cover-section">
                  <h3>Inspection Date</h3>
                  <p>${inspectionDate || new Date().toLocaleDateString()}</p>
                </div>

                <div class="cover-section">
                  <h3>Inspector</h3>
                  <p>${this._escapeHtml(inspectorName || 'N/A')}</p>
                </div>
              </div>

              <div class="cover-footer">
                <p>${BRAND.phone} | ${BRAND.email}</p>
                <p>${BRAND.website}</p>
              </div>
            </div>

            <!-- PROPERTY OVERVIEW -->
            <div class="page">
              <h1>Property Overview</h1>

              <table class="info-table">
                <tr>
                  <td><strong>Address:</strong></td>
                  <td>${this._escapeHtml(lead.address || 'N/A')}</td>
                </tr>
                <tr>
                  <td><strong>Owner Name:</strong></td>
                  <td>${this._escapeHtml(lead.name || 'N/A')}</td>
                </tr>
                <tr>
                  <td><strong>Phone:</strong></td>
                  <td>${this._escapeHtml(lead.phone || 'N/A')}</td>
                </tr>
                <tr>
                  <td><strong>Email:</strong></td>
                  <td>${this._escapeHtml(lead.email || 'N/A')}</td>
                </tr>
                <tr>
                  <td><strong>Roof Type:</strong></td>
                  <td>${this._escapeHtml(roofType || 'N/A')}</td>
                </tr>
                <tr>
                  <td><strong>Approximate Age:</strong></td>
                  <td>${roofAge ? roofAge + ' years' : 'N/A'}</td>
                </tr>
                <tr>
                  <td><strong>Total Squares:</strong></td>
                  <td>${totalSquares || 'N/A'}</td>
                </tr>
                <tr>
                  <td><strong>Number of Slopes:</strong></td>
                  <td>${slopes || 'N/A'}</td>
                </tr>
              </table>
            </div>

            <!-- ROOF COMPONENTS CHECKLIST -->
            <div class="page">
              <h1>Roof Components Checklist</h1>

              <table class="checklist-table">
                <thead>
                  <tr>
                    <th>Component</th>
                    <th>Condition</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  ${ROOF_COMPONENTS.map(component => {
                    const compData = components[component] || {};
                    return `
                      <tr>
                        <td><strong>${component}</strong></td>
                        <td><span class="condition-badge condition-${compData.condition?.toLowerCase() || 'unknown'}">${compData.condition || '—'}</span></td>
                        <td>${this._escapeHtml(compData.notes || '')}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>

            <!-- DAMAGE ASSESSMENT -->
            ${damageAssessment.type ? `
            <div class="page">
              <h1>Damage Assessment</h1>

              <table class="info-table">
                <tr>
                  <td><strong>Damage Type:</strong></td>
                  <td>${this._escapeHtml(damageAssessment.type)}</td>
                </tr>
                <tr>
                  <td><strong>Severity (1-5):</strong></td>
                  <td>${damageAssessment.severity || '—'}</td>
                </tr>
                <tr>
                  <td><strong>Affected Area:</strong></td>
                  <td>${damageAssessment.area ? damageAssessment.area + ' sq ft' : '—'}</td>
                </tr>
                <tr>
                  <td><strong>Location on Roof:</strong></td>
                  <td>${this._escapeHtml(damageAssessment.location || '—')}</td>
                </tr>
              </table>

              ${damageAssessment.description ? `
              <h2 style="margin-top: 20px;">Details</h2>
              <p>${this._escapeHtml(damageAssessment.description)}</p>
              ` : ''}
            </div>
            ` : ''}

            <!-- PHOTOS -->
            ${data.photos && data.photos.length > 0 ? `
            <div class="page">
              <h1>Photo Documentation</h1>
              <div class="photo-grid">
                ${data.photos.map(photo => `
                  <div class="photo-item">
                    <img src="${this._escapeHtml(photo.url)}" alt="Inspection photo">
                    ${photo.description ? `<p class="photo-caption">${this._escapeHtml(photo.description)}</p>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
            ` : ''}

            <!-- RECOMMENDATIONS -->
            ${recommendations ? `
            <div class="page">
              <h1>Recommendations</h1>
              <p>${this._escapeHtml(recommendations)}</p>
            </div>
            ` : ''}

            <!-- ESTIMATED SCOPE OF WORK -->
            ${estimatedWork && estimatedWork.length > 0 ? `
            <div class="page">
              <h1>Estimated Scope of Work</h1>

              <table class="work-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${estimatedWork.map(item => `
                    <tr>
                      <td>${this._escapeHtml(item.description || '')}</td>
                      <td>${item.qty || '—'}</td>
                      <td>${this._escapeHtml(item.unit || '')}</td>
                      <td>${item.total || '—'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
            ` : ''}

            <!-- SIGNATURE PAGE -->
            <div class="page">
              <h1>Inspector Certification</h1>

              <div style="margin-top: 40px;">
                <p><strong>Inspector Name:</strong> ${this._escapeHtml(inspectorName || '________')}</p>
                <p style="margin-top: 30px;"><strong>Signature:</strong> _________________________ <strong>Date:</strong> _______________</p>
              </div>

              <hr style="margin: 40px 0;">

              <h2>Disclaimer</h2>
              <p style="font-size: 11px; line-height: 1.6;">
                This inspection report is based on visual observation only and does not constitute a warranty or guarantee.
                Opinions expressed are those of the inspector and may be subject to change upon further investigation.
                This report does not provide structural engineering analysis or estimate future maintenance costs.
                For detailed analysis, consult with a professional engineer or contractor.
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

      return html;
    },

    /**
     * Generate Storm Damage Assessment
     */
    _generateStormDamage(leadId, data) {
      const lead = this._getLead(leadId);
      if (!lead) return '';

      const {
        stormDate, stormType, hailSize, windSpeed,
        roofDamage = {}, sidingDamage = {}, gutterDamage = {},
        windowDamage = {}, screenDamage = {}, interiorDamage = {},
        testSquare = {}, collateralDamage = {}, notes = '',
        inspectorName, recommendations = ''
      } = data;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Storm Damage Assessment</title>
          <style>
            ${this._getPrintStyles()}
          </style>
        </head>
        <body>
          <div class="report-container">
            <!-- COVER PAGE -->
            <div class="page cover-page">
              <div class="cover-header">
                <div class="brand-logo" style="font-size: 28px; font-weight: bold; color: ${BRAND.colors.navy};">
                  🏠 ${BRAND.name}
                </div>
                <div class="cover-title">STORM DAMAGE ASSESSMENT</div>
              </div>

              <div class="cover-content">
                <div class="cover-section">
                  <h3>Property Address</h3>
                  <p>${this._escapeHtml(lead.address || 'N/A')}</p>
                </div>

                <div class="cover-section">
                  <h3>Storm Date</h3>
                  <p>${stormDate || 'N/A'}</p>
                </div>

                <div class="cover-section">
                  <h3>Storm Type</h3>
                  <p>${this._escapeHtml(stormType || 'N/A')}</p>
                </div>

                <div class="cover-section">
                  <h3>Inspector</h3>
                  <p>${this._escapeHtml(inspectorName || 'N/A')}</p>
                </div>
              </div>

              <div class="cover-footer">
                <p>${BRAND.phone} | ${BRAND.email}</p>
              </div>
            </div>

            <!-- STORM EVENT INFO -->
            <div class="page">
              <h1>Storm Event Information</h1>

              <table class="info-table">
                <tr>
                  <td><strong>Date of Storm:</strong></td>
                  <td>${stormDate || 'N/A'}</td>
                </tr>
                <tr>
                  <td><strong>Type of Storm:</strong></td>
                  <td>${this._escapeHtml(stormType || 'N/A')}</td>
                </tr>
                ${hailSize ? `
                <tr>
                  <td><strong>Hail Size:</strong></td>
                  <td>${this._escapeHtml(hailSize)}</td>
                </tr>
                ` : ''}
                ${windSpeed ? `
                <tr>
                  <td><strong>Wind Speed:</strong></td>
                  <td>${this._escapeHtml(windSpeed)}</td>
                </tr>
                ` : ''}
              </table>
            </div>

            <!-- EXTERIOR INSPECTION SUMMARY -->
            <div class="page">
              <h1>Exterior Inspection Summary</h1>

              ${this._renderDamageSection('Roof', roofDamage)}
              ${this._renderDamageSection('Siding', sidingDamage)}
              ${this._renderDamageSection('Gutters & Downspouts', gutterDamage)}
              ${this._renderDamageSection('Windows', windowDamage)}
              ${this._renderDamageSection('Screens', screenDamage)}
            </div>

            <!-- TEST SQUARE RESULTS -->
            ${testSquare.location ? `
            <div class="page">
              <h1>Test Square Results</h1>

              <table class="info-table">
                <tr>
                  <td><strong>Location:</strong></td>
                  <td>${this._escapeHtml(testSquare.location)}</td>
                </tr>
                <tr>
                  <td><strong>Dimensions:</strong></td>
                  <td>${testSquare.dimensions || 'N/A'}</td>
                </tr>
                <tr>
                  <td><strong>Hits Counted:</strong></td>
                  <td>${testSquare.hits || 'N/A'}</td>
                </tr>
                <tr>
                  <td><strong>Measurements:</strong></td>
                  <td>${this._escapeHtml(testSquare.measurements || 'N/A')}</td>
                </tr>
              </table>
            </div>
            ` : ''}

            <!-- INTERIOR DAMAGE -->
            ${Object.keys(interiorDamage).length > 0 ? `
            <div class="page">
              <h1>Interior Damage Assessment</h1>

              <table class="info-table">
                ${interiorDamage.waterStains ? `
                <tr>
                  <td><strong>Water Stains:</strong></td>
                  <td>${interiorDamage.waterStains}</td>
                </tr>
                ` : ''}
                ${interiorDamage.activeLeaks ? `
                <tr>
                  <td><strong>Active Leaks:</strong></td>
                  <td>${interiorDamage.activeLeaks}</td>
                </tr>
                ` : ''}
                ${interiorDamage.atticObservations ? `
                <tr>
                  <td><strong>Attic Observations:</strong></td>
                  <td>${this._escapeHtml(interiorDamage.atticObservations)}</td>
                </tr>
                ` : ''}
              </table>
            </div>
            ` : ''}

            <!-- COLLATERAL DAMAGE -->
            ${Object.keys(collateralDamage).length > 0 ? `
            <div class="page">
              <h1>Collateral Damage Evidence</h1>

              <p style="margin-bottom: 15px;">Additional damage found at property:</p>
              <ul>
                ${collateralDamage.acUnits ? `<li>AC Units: ${collateralDamage.acUnits}</li>` : ''}
                ${collateralDamage.vents ? `<li>Vents: ${collateralDamage.vents}</li>` : ''}
                ${collateralDamage.mailbox ? `<li>Mailbox: ${collateralDamage.mailbox}</li>` : ''}
                ${collateralDamage.fencing ? `<li>Fencing: ${collateralDamage.fencing}</li>` : ''}
                ${collateralDamage.vehicles ? `<li>Vehicles: ${collateralDamage.vehicles}</li>` : ''}
                ${collateralDamage.landscaping ? `<li>Landscaping: ${collateralDamage.landscaping}</li>` : ''}
              </ul>
            </div>
            ` : ''}

            <!-- PHOTOS -->
            ${data.photos && data.photos.length > 0 ? `
            <div class="page">
              <h1>Damage Documentation Photos</h1>
              <div class="photo-grid">
                ${data.photos.map(photo => `
                  <div class="photo-item">
                    <img src="${this._escapeHtml(photo.url)}" alt="Damage photo">
                    ${photo.description ? `<p class="photo-caption">${this._escapeHtml(photo.description)}</p>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
            ` : ''}

            <!-- INSURANCE RECOMMENDATION & NEXT STEPS -->
            <div class="page">
              <h1>Insurance Recommendation</h1>

              <p><strong>File Insurance Claim:</strong> ${recommendations.fileClaim ? 'YES' : 'NO'}</p>

              ${recommendations.estimatedScope ? `
              <h2 style="margin-top: 20px;">Estimated Scope</h2>
              <p>${this._escapeHtml(recommendations.estimatedScope)}</p>
              ` : ''}

              ${recommendations.nextSteps ? `
              <h2 style="margin-top: 20px;">Recommended Next Steps</h2>
              <p>${this._escapeHtml(recommendations.nextSteps)}</p>
              ` : ''}

              ${notes ? `
              <h2 style="margin-top: 20px;">Inspector Notes</h2>
              <p>${this._escapeHtml(notes)}</p>
              ` : ''}
            </div>

            <!-- ADJUSTER MEETING NOTES -->
            <div class="page">
              <h1>Adjuster Meeting Notes</h1>

              <p style="margin-bottom: 15px;"><strong>Adjuster Name:</strong> ___________________________</p>
              <p style="margin-bottom: 30px;"><strong>Meeting Date:</strong> ___________________________</p>

              <div style="border: 1px solid #ccc; padding: 20px; height: 300px; background: #fafafa;">
                <!-- Space for notes -->
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      return html;
    },

    /**
     * Generate Insurance Supplement Report
     */
    _generateSupplement(leadId, data) {
      const lead = this._getLead(leadId);
      if (!lead) return '';

      const {
        claimNumber, policyNumber, originalItems = [],
        supplementalItems = [], inspectorName, notes = ''
      } = data;

      const supplementTotal = (supplementalItems || []).reduce((sum, item) => {
        const lineTotal = (parseFloat(item.unitCost || 0) * parseFloat(item.quantity || 0)) || 0;
        return sum + lineTotal;
      }, 0);

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Insurance Supplement Request</title>
          <style>
            ${this._getPrintStyles()}
          </style>
        </head>
        <body>
          <div class="report-container">
            <!-- HEADER PAGE -->
            <div class="page cover-page">
              <div class="cover-header">
                <div class="brand-logo" style="font-size: 28px; font-weight: bold; color: ${BRAND.colors.navy};">
                  🏠 ${BRAND.name}
                </div>
                <div class="cover-title" style="color: ${BRAND.colors.orange}; margin-top: 40px;">SUPPLEMENT REQUEST</div>
              </div>

              <div class="cover-content">
                <div class="cover-section">
                  <h3>Property Address</h3>
                  <p>${this._escapeHtml(lead.address || 'N/A')}</p>
                </div>

                ${claimNumber ? `
                <div class="cover-section">
                  <h3>Claim Number</h3>
                  <p>${this._escapeHtml(claimNumber)}</p>
                </div>
                ` : ''}

                ${policyNumber ? `
                <div class="cover-section">
                  <h3>Policy Number</h3>
                  <p>${this._escapeHtml(policyNumber)}</p>
                </div>
                ` : ''}
              </div>
            </div>

            <!-- ORIGINAL ESTIMATE SUMMARY -->
            ${originalItems && originalItems.length > 0 ? `
            <div class="page">
              <h1>Original Estimate Summary</h1>

              <table class="work-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Unit</th>
                    <th>Qty</th>
                    <th>Unit Cost</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${originalItems.map(item => {
                    const lineTotal = (parseFloat(item.unitCost || 0) * parseFloat(item.qty || 0)) || 0;
                    return `
                      <tr>
                        <td>${this._escapeHtml(item.description || '')}</td>
                        <td>${this._escapeHtml(item.unit || '')}</td>
                        <td>${item.qty || '—'}</td>
                        <td>$${parseFloat(item.unitCost || 0).toFixed(2)}</td>
                        <td>$${lineTotal.toFixed(2)}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
            ` : ''}

            <!-- SUPPLEMENTAL ITEMS -->
            <div class="page">
              <h1>Supplemental Items</h1>

              <table class="work-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Reason</th>
                    <th>Qty</th>
                    <th>Unit Cost</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${supplementalItems.map(item => {
                    const lineTotal = (parseFloat(item.unitCost || 0) * parseFloat(item.quantity || 0)) || 0;
                    return `
                      <tr>
                        <td>
                          <strong>${this._escapeHtml(item.description || '')}</strong>
                          ${item.xactCode ? `<br><small>Xact Code: ${this._escapeHtml(item.xactCode)}</small>` : ''}
                        </td>
                        <td>${this._escapeHtml(item.reason || '')}</td>
                        <td>${item.quantity || '—'}</td>
                        <td>$${parseFloat(item.unitCost || 0).toFixed(2)}</td>
                        <td>$${lineTotal.toFixed(2)}</td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>

              <div style="text-align: right; margin-top: 20px; font-weight: bold; font-size: 16px;">
                <p>Total Supplement Amount: <span style="color: ${BRAND.colors.orange};">$${supplementTotal.toFixed(2)}</span></p>
              </div>
            </div>

            <!-- PHOTOS -->
            ${data.photos && data.photos.length > 0 ? `
            <div class="page">
              <h1>Supporting Photo Evidence</h1>
              <div class="photo-grid">
                ${data.photos.map(photo => `
                  <div class="photo-item">
                    <img src="${this._escapeHtml(photo.url)}" alt="Evidence photo">
                    ${photo.description ? `<p class="photo-caption">${this._escapeHtml(photo.description)}</p>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
            ` : ''}

            <!-- INSPECTOR NOTES & SIGN-OFF -->
            <div class="page">
              <h1>Inspector Certification</h1>

              ${notes ? `
              <h2>Inspector Notes</h2>
              <p>${this._escapeHtml(notes)}</p>
              ` : ''}

              <div style="margin-top: 40px;">
                <p><strong>Inspector Name:</strong> ${this._escapeHtml(inspectorName || '________')}</p>
                <p style="margin-top: 30px;"><strong>Signature:</strong> _________________________ <strong>Date:</strong> _______________</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      return html;
    },

    /**
     * Generate Project Completion Report
     */
    _generateCompletion(leadId, data) {
      const lead = this._getLead(leadId);
      if (!lead) return '';

      const {
        startDate, endDate, crewInfo,
        materials = {}, workCompleted = {},
        warrantyInfo = {}, maintenanceTips = '',
        inspectorName
      } = data;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>Project Completion Report</title>
          <style>
            ${this._getPrintStyles()}
          </style>
        </head>
        <body>
          <div class="report-container">
            <!-- COVER PAGE -->
            <div class="page cover-page">
              <div class="cover-header">
                <div class="brand-logo" style="font-size: 28px; font-weight: bold; color: ${BRAND.colors.navy};">
                  🏠 ${BRAND.name}
                </div>
                <div class="cover-title">PROJECT COMPLETION REPORT</div>
              </div>

              <div class="cover-content">
                <div class="cover-section">
                  <h3>Property Address</h3>
                  <p>${this._escapeHtml(lead.address || 'N/A')}</p>
                </div>

                <div class="cover-section">
                  <h3>Project Timeline</h3>
                  <p>
                    ${startDate || 'N/A'} to ${endDate || 'N/A'}
                  </p>
                </div>

                <div class="cover-section">
                  <h3>Property Owner</h3>
                  <p>${this._escapeHtml(lead.name || 'N/A')}</p>
                </div>
              </div>

              <div class="cover-footer">
                <p>${BRAND.phone} | ${BRAND.email}</p>
              </div>
            </div>

            <!-- PROJECT SUMMARY -->
            <div class="page">
              <h1>Project Summary</h1>

              <table class="info-table">
                <tr>
                  <td><strong>Property Address:</strong></td>
                  <td>${this._escapeHtml(lead.address || 'N/A')}</td>
                </tr>
                <tr>
                  <td><strong>Owner:</strong></td>
                  <td>${this._escapeHtml(lead.name || 'N/A')}</td>
                </tr>
                <tr>
                  <td><strong>Start Date:</strong></td>
                  <td>${startDate || 'N/A'}</td>
                </tr>
                <tr>
                  <td><strong>Completion Date:</strong></td>
                  <td>${endDate || 'N/A'}</td>
                </tr>
                ${crewInfo ? `
                <tr>
                  <td><strong>Crew Information:</strong></td>
                  <td>${this._escapeHtml(crewInfo)}</td>
                </tr>
                ` : ''}
              </table>
            </div>

            <!-- MATERIALS USED -->
            ${materials && Object.keys(materials).length > 0 ? `
            <div class="page">
              <h1>Materials Used</h1>

              <table class="info-table">
                ${materials.manufacturer ? `
                <tr>
                  <td><strong>Manufacturer:</strong></td>
                  <td>${this._escapeHtml(materials.manufacturer)}</td>
                </tr>
                ` : ''}
                ${materials.productLine ? `
                <tr>
                  <td><strong>Product Line:</strong></td>
                  <td>${this._escapeHtml(materials.productLine)}</td>
                </tr>
                ` : ''}
                ${materials.color ? `
                <tr>
                  <td><strong>Color:</strong></td>
                  <td>${this._escapeHtml(materials.color)}</td>
                </tr>
                ` : ''}
                ${materials.warranty ? `
                <tr>
                  <td><strong>Warranty:</strong></td>
                  <td>${this._escapeHtml(materials.warranty)}</td>
                </tr>
                ` : ''}
              </table>
            </div>
            ` : ''}

            <!-- BEFORE/AFTER PHOTOS -->
            ${data.beforeAfterPhotos && data.beforeAfterPhotos.length > 0 ? `
            <div class="page">
              <h1>Before &amp; After Comparison</h1>
              <div class="before-after-grid">
                ${data.beforeAfterPhotos.map(pair => `
                  <div class="photo-pair">
                    ${pair.before ? `
                    <div class="photo-item">
                      <img src="${this._escapeHtml(pair.before.url)}" alt="Before">
                      <p class="photo-caption"><strong>Before</strong></p>
                    </div>
                    ` : ''}
                    ${pair.after ? `
                    <div class="photo-item">
                      <img src="${this._escapeHtml(pair.after.url)}" alt="After">
                      <p class="photo-caption"><strong>After</strong></p>
                    </div>
                    ` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
            ` : ''}

            <!-- WORK COMPLETED CHECKLIST -->
            <div class="page">
              <h1>Work Completed Checklist</h1>

              <table class="checklist-table">
                <thead>
                  <tr>
                    <th>Work Item</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${[
                    'Tear-off', 'Decking repair/replacement', 'Ice & water shield',
                    'Synthetic underlayment', 'Drip edge', 'Starter strip', 'Field shingles',
                    'Ridge caps', 'Pipe boots', 'Wall flashing', 'Chimney flashing',
                    'Valley metal', 'Ventilation', 'Gutters', 'Cleanup', 'Final inspection'
                  ].map(item => {
                    const status = workCompleted[item];
                    return `
                      <tr>
                        <td>${item}</td>
                        <td>
                          ${status === 'complete' ? '✓ Completed' : status === 'na' ? 'N/A' : '— Not recorded'}
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>

            <!-- WARRANTY INFORMATION -->
            ${warrantyInfo && Object.keys(warrantyInfo).length > 0 ? `
            <div class="page">
              <h1>Warranty Information</h1>

              <table class="info-table">
                ${warrantyInfo.materialWarranty ? `
                <tr>
                  <td><strong>Material Warranty:</strong></td>
                  <td>${this._escapeHtml(warrantyInfo.materialWarranty)}</td>
                </tr>
                ` : ''}
                ${warrantyInfo.laborWarranty ? `
                <tr>
                  <td><strong>Labor Warranty:</strong></td>
                  <td>${this._escapeHtml(warrantyInfo.laborWarranty)}</td>
                </tr>
                ` : ''}
                ${warrantyInfo.registrationNumber ? `
                <tr>
                  <td><strong>Registration Number:</strong></td>
                  <td>${this._escapeHtml(warrantyInfo.registrationNumber)}</td>
                </tr>
                ` : ''}
              </table>
            </div>
            ` : ''}

            <!-- POST-INSTALL CARE TIPS -->
            ${maintenanceTips ? `
            <div class="page">
              <h1>Post-Installation Care Tips</h1>
              <p>${this._escapeHtml(maintenanceTips)}</p>
            </div>
            ` : ''}

            <!-- CUSTOMER SIGN-OFF -->
            <div class="page">
              <h1>Project Sign-Off</h1>

              <div style="margin-top: 30px;">
                <p style="margin-bottom: 20px;">
                  <strong>I certify that all work described in this report has been completed to my satisfaction.</strong>
                </p>

                <p style="margin-bottom: 5px;"><strong>Property Owner:</strong></p>
                <p style="margin-bottom: 30px;">Name: _____________________________ Signature: _______________</p>

                <p style="margin-bottom: 5px;"><strong>Project Manager:</strong></p>
                <p style="margin-bottom: 30px;">Name: ${this._escapeHtml(inspectorName || '___________________________')} Signature: _______________</p>

                <p><strong>Date:</strong> _______________</p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

      return html;
    },

    /**
     * Render a damage assessment section (helper for storm damage)
     */
    _renderDamageSection(title, damageData) {
      if (!damageData || Object.keys(damageData).length === 0) return '';

      return `
        <h2>${title}</h2>
        <table class="damage-table">
          <tr>
            <td><strong>Damage Found:</strong></td>
            <td>${damageData.found ? 'Yes' : 'No'}</td>
          </tr>
          ${damageData.severity ? `
          <tr>
            <td><strong>Severity:</strong></td>
            <td>${damageData.severity}</td>
          </tr>
          ` : ''}
          ${damageData.notes ? `
          <tr>
            <td><strong>Notes:</strong></td>
            <td>${this._escapeHtml(damageData.notes)}</td>
          </tr>
          ` : ''}
        </table>
      `;
    },

    /**
     * Get print-optimized CSS
     */
    _getPrintStyles() {
      return `
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          font-size: 11pt;
          line-height: 1.6;
          color: #333;
          background: white;
        }

        .report-container {
          width: 8.5in;
          height: 11in;
          margin: auto;
        }

        .page {
          width: 8.5in;
          height: 11in;
          padding: 0.5in;
          page-break-after: always;
          display: flex;
          flex-direction: column;
          border: 1px solid #ddd;
          background: white;
          overflow: hidden;
        }

        .cover-page {
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          padding: 1in;
          background: linear-gradient(135deg, ${BRAND.colors.navy} 0%, #2c4a8d 100%);
          color: white;
        }

        .cover-header {
          text-align: center;
          margin-bottom: 40px;
        }

        .brand-logo {
          margin-bottom: 20px;
        }

        .cover-title {
          font-size: 32pt;
          font-weight: bold;
          color: white;
          margin-bottom: 20px;
        }

        .cover-content {
          flex: 1;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .cover-section {
          margin-bottom: 30px;
          background: rgba(255,255,255,0.1);
          padding: 15px;
          border-radius: 5px;
        }

        .cover-section h3 {
          font-size: 11pt;
          margin-bottom: 8px;
          opacity: 0.9;
        }

        .cover-section p {
          font-size: 14pt;
          font-weight: 500;
        }

        .cover-footer {
          text-align: center;
          font-size: 10pt;
          opacity: 0.9;
          padding-top: 20px;
          border-top: 1px solid rgba(255,255,255,0.2);
        }

        h1 {
          font-size: 18pt;
          margin-bottom: 15px;
          color: ${BRAND.colors.navy};
          border-bottom: 2px solid ${BRAND.colors.orange};
          padding-bottom: 8px;
        }

        h2 {
          font-size: 13pt;
          margin-top: 20px;
          margin-bottom: 10px;
          color: ${BRAND.colors.navy};
        }

        h3 {
          font-size: 11pt;
          margin-bottom: 8px;
          color: #555;
        }

        p {
          margin-bottom: 10px;
          text-align: justify;
        }

        .info-table, .checklist-table, .work-table, .damage-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 15px;
          font-size: 10pt;
        }

        .info-table td, .damage-table td {
          border-bottom: 1px solid #e0e0e0;
          padding: 8px 12px;
        }

        .info-table tr:nth-child(even),
        .damage-table tr:nth-child(even) {
          background: #f9f9f9;
        }

        .checklist-table th, .work-table th {
          background: ${BRAND.colors.navy};
          color: white;
          padding: 10px 12px;
          text-align: left;
          font-weight: 600;
          font-size: 10pt;
        }

        .checklist-table td, .work-table td {
          border-bottom: 1px solid #e0e0e0;
          padding: 8px 12px;
        }

        .checklist-table tr:nth-child(even),
        .work-table tr:nth-child(even) {
          background: #f9f9f9;
        }

        .condition-badge {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 9pt;
          font-weight: 600;
          text-transform: uppercase;
        }

        .condition-good {
          background: #d4edda;
          color: #155724;
        }

        .condition-fair {
          background: #fff3cd;
          color: #856404;
        }

        .condition-poor {
          background: #f8d7da;
          color: #721c24;
        }

        .condition-critical {
          background: #f5c6cb;
          color: #721c24;
          font-weight: bold;
        }

        .condition-unknown {
          background: #e2e3e5;
          color: #383d41;
        }

        .photo-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 15px;
          margin-bottom: 15px;
        }

        .photo-item {
          text-align: center;
        }

        .photo-item img {
          max-width: 100%;
          height: auto;
          max-height: 300px;
          border: 1px solid #ddd;
          border-radius: 4px;
        }

        .photo-caption {
          font-size: 9pt;
          margin-top: 5px;
          color: #666;
          font-style: italic;
        }

        .before-after-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 20px;
        }

        .photo-pair {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
        }

        hr {
          border: none;
          border-top: 1px solid #ddd;
          margin: 20px 0;
        }

        ul {
          margin-left: 20px;
          margin-bottom: 15px;
        }

        li {
          margin-bottom: 8px;
        }

        @media print {
          body {
            margin: 0;
            padding: 0;
          }
          .report-container {
            margin: 0;
            border: none;
          }
          .page {
            border: none;
            box-shadow: none;
          }
        }
      `;
    },

    /**
     * Open the report builder UI
     */
    async openBuilder(containerId, leadId, templateId) {
      const container = document.getElementById(containerId);
      if (!container) {
        console.error('Container not found:', containerId);
        return;
      }

      const lead = this._getLead(leadId);
      if (!lead) {
        showToast('Lead not found', 'error');
        return;
      }

      // Initialize wizard state
      const state = {
        leadId,
        templateId: templateId || null,
        currentStep: 0,
        data: this._loadDraft(leadId) || {},
        photos: []
      };

      // Render the wizard interface
      container.innerHTML = this._renderBuilderUI(state);

      // Attach event listeners
      this._attachBuilderListeners(container, state, lead);
    },

    /**
     * Render the wizard UI
     */
    _renderBuilderUI(state) {
      return `
        <div class="report-builder">
          <style>
            ${this._getBuilderStyles()}
          </style>

          <div class="builder-header">
            <h2>Create Inspection Report</h2>
            <p>Step ${state.currentStep + 1} of 5</p>
          </div>

          <div class="builder-progress">
            <div class="progress-bar" style="width: ${((state.currentStep + 1) / 5) * 100}%"></div>
          </div>

          <div class="builder-content" id="builder-content">
            ${this._renderBuilderStep(state)}
          </div>

          <div class="builder-footer">
            <button class="btn-secondary" id="btn-prev" style="display: ${state.currentStep === 0 ? 'none' : 'inline-block'};">
              ← Previous
            </button>
            <button class="btn-primary" id="btn-next">
              ${state.currentStep === 4 ? 'Generate Report' : 'Next →'}
            </button>
          </div>
        </div>
      `;
    },

    /**
     * Render current step
     */
    _renderBuilderStep(state) {
      const step = state.currentStep;

      if (step === 0) {
        return this._renderTemplateSelection(state);
      } else if (step === 1) {
        return this._renderPropertyInfo(state);
      } else if (step === 2) {
        return this._renderInspectionDetails(state);
      } else if (step === 3) {
        return this._renderPhotoSelection(state);
      } else if (step === 4) {
        return this._renderPreviewAndGenerate(state);
      }

      return '';
    },

    /**
     * Render template selection
     */
    _renderTemplateSelection(state) {
      const templates = this.getTemplates();

      return `
        <div class="step-content">
          <h3>Choose a Report Template</h3>
          <div class="template-grid">
            ${templates.map(template => `
              <div class="template-card ${state.templateId === template.id ? 'selected' : ''}"
                   data-template="${template.id}">
                <div class="template-icon">${template.icon}</div>
                <h4>${template.name}</h4>
                <p>${template.description}</p>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    },

    /**
     * Render property info step
     */
    _renderPropertyInfo(state) {
      const lead = this._getLead(state.leadId);

      return `
        <div class="step-content">
          <h3>Property Information</h3>
          <form id="property-form">
            <div class="form-group">
              <label>Property Address</label>
              <input type="text" name="address" value="${this._escapeHtml(lead?.address || '')}" required>
            </div>
            <div class="form-group">
              <label>Owner Name</label>
              <input type="text" name="ownerName" value="${this._escapeHtml(lead?.name || '')}" required>
            </div>
            <div class="form-group">
              <label>Phone</label>
              <input type="tel" name="phone" value="${this._escapeHtml(lead?.phone || '')}">
            </div>
            <div class="form-group">
              <label>Email</label>
              <input type="email" name="email" value="${this._escapeHtml(lead?.email || '')}">
            </div>
            <div class="form-group">
              <label>Inspector Name</label>
              <input type="text" name="inspectorName" value="${this._escapeHtml(state.data.inspectorName || window._user?.displayName || '')}" required>
            </div>
            <div class="form-group">
              <label>Inspection Date</label>
              <input type="date" name="inspectionDate" value="${state.data.inspectionDate || new Date().toISOString().split('T')[0]}" required>
            </div>
          </form>
        </div>
      `;
    },

    /**
     * Render inspection details step (varies by template)
     */
    _renderInspectionDetails(state) {
      const templateId = state.templateId;

      if (templateId === 'full-inspection') {
        return this._renderFullInspectionDetails(state);
      } else if (templateId === 'storm-damage') {
        return this._renderStormDamageDetails(state);
      } else if (templateId === 'supplement') {
        return this._renderSupplementDetails(state);
      } else if (templateId === 'completion') {
        return this._renderCompletionDetails(state);
      }

      return '';
    },

    /**
     * Render full inspection details
     */
    _renderFullInspectionDetails(state) {
      const { roofType = '', roofAge = '', totalSquares = '', slopes = '' } = state.data;

      return `
        <div class="step-content">
          <h3>Roof Information</h3>
          <form id="details-form">
            <div class="form-group">
              <label>Roof Type</label>
              <input type="text" name="roofType" value="${this._escapeHtml(roofType)}" placeholder="e.g., Asphalt Shingle">
            </div>
            <div class="form-group">
              <label>Approximate Age (years)</label>
              <input type="number" name="roofAge" value="${roofAge}" min="0">
            </div>
            <div class="form-group">
              <label>Total Squares</label>
              <input type="number" name="totalSquares" value="${totalSquares}" step="0.1" placeholder="e.g., 35.5">
            </div>
            <div class="form-group">
              <label>Number of Slopes</label>
              <input type="number" name="slopes" value="${slopes}" min="1">
            </div>
          </form>

          <h3 style="margin-top: 30px;">Damage Assessment (Optional)</h3>
          <form id="damage-form">
            <div class="form-group">
              <label>Damage Type</label>
              <input type="text" name="damageType" value="${this._escapeHtml(state.data.damageAssessment?.type || '')}" placeholder="e.g., Hail damage">
            </div>
            <div class="form-group">
              <label>Severity (1-5)</label>
              <select name="severity">
                <option value="">Select...</option>
                ${[1,2,3,4,5].map(n => `<option value="${n}" ${state.data.damageAssessment?.severity === n ? 'selected' : ''}>${n}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Affected Area (sq ft)</label>
              <input type="number" name="area" value="${state.data.damageAssessment?.area || ''}" step="0.1">
            </div>
            <div class="form-group">
              <label>Location on Roof</label>
              <input type="text" name="location" value="${this._escapeHtml(state.data.damageAssessment?.location || '')}" placeholder="e.g., North side">
            </div>
            <div class="form-group">
              <label>Description</label>
              <textarea name="description" rows="4" placeholder="Detailed description of damage...">${this._escapeHtml(state.data.damageAssessment?.description || '')}</textarea>
            </div>
          </form>

          <h3 style="margin-top: 30px;">Recommendations</h3>
          <form id="recommendations-form">
            <div class="form-group">
              <label>Recommended Action</label>
              <textarea name="recommendations" rows="4" placeholder="Repair vs replace recommendation with reasoning...">${this._escapeHtml(state.data.recommendations || '')}</textarea>
            </div>
          </form>
        </div>
      `;
    },

    /**
     * Render storm damage details
     */
    _renderStormDamageDetails(state) {
      const { stormDate = '', stormType = '', hailSize = '', windSpeed = '' } = state.data;

      return `
        <div class="step-content">
          <h3>Storm Event Information</h3>
          <form id="details-form">
            <div class="form-group">
              <label>Date of Storm</label>
              <input type="date" name="stormDate" value="${stormDate}">
            </div>
            <div class="form-group">
              <label>Storm Type</label>
              <select name="stormType">
                <option value="">Select...</option>
                <option value="Hail" ${stormType === 'Hail' ? 'selected' : ''}>Hail</option>
                <option value="Wind" ${stormType === 'Wind' ? 'selected' : ''}>Wind</option>
                <option value="Tornado" ${stormType === 'Tornado' ? 'selected' : ''}>Tornado</option>
                <option value="Heavy Rain" ${stormType === 'Heavy Rain' ? 'selected' : ''}>Heavy Rain</option>
              </select>
            </div>
            <div class="form-group">
              <label>Hail Size (if applicable)</label>
              <input type="text" name="hailSize" value="${this._escapeHtml(hailSize)}" placeholder="e.g., 1.5 inch">
            </div>
            <div class="form-group">
              <label>Wind Speed (if known)</label>
              <input type="text" name="windSpeed" value="${this._escapeHtml(windSpeed)}" placeholder="e.g., 75 mph">
            </div>
          </form>

          <h3 style="margin-top: 30px;">Damage Summary</h3>
          <form id="damage-summary">
            <div class="damage-section">
              <h4>Roof Damage</h4>
              <label><input type="checkbox" name="roofDamageFound" ${state.data.roofDamage?.found ? 'checked' : ''}> Damage Found</label>
              <input type="text" name="roofNotes" value="${this._escapeHtml(state.data.roofDamage?.notes || '')}" placeholder="Notes" style="width: 100%; margin-top: 8px;">
            </div>
            <div class="damage-section">
              <h4>Siding Damage</h4>
              <label><input type="checkbox" name="sidingDamageFound" ${state.data.sidingDamage?.found ? 'checked' : ''}> Damage Found</label>
              <input type="text" name="sidingNotes" value="${this._escapeHtml(state.data.sidingDamage?.notes || '')}" placeholder="Notes" style="width: 100%; margin-top: 8px;">
            </div>
          </form>
        </div>
      `;
    },

    /**
     * Render supplement details
     */
    _renderSupplementDetails(state) {
      const lead = this._getLead(state.leadId);

      return `
        <div class="step-content">
          <h3>Supplement Information</h3>
          <form id="details-form">
            <div class="form-group">
              <label>Claim Number</label>
              <input type="text" name="claimNumber" value="${this._escapeHtml(lead?.claimNumber || state.data.claimNumber || '')}" required>
            </div>
            <div class="form-group">
              <label>Policy Number</label>
              <input type="text" name="policyNumber" value="${this._escapeHtml(lead?.policyNumber || state.data.policyNumber || '')}">
            </div>
            <div class="form-group">
              <label>Notes/Explanation</label>
              <textarea name="notes" rows="4" placeholder="Why these items were missed or are now necessary...">${this._escapeHtml(state.data.notes || '')}</textarea>
            </div>
          </form>

          <h3 style="margin-top: 30px;">Add Supplemental Line Items</h3>
          <div id="supplemental-items-container">
            ${(state.data.supplementalItems || []).map((item, idx) => `
              <div class="line-item" data-index="${idx}">
                <input type="text" placeholder="Description" value="${this._escapeHtml(item.description || '')}" class="item-description">
                <input type="text" placeholder="Xact Code" value="${this._escapeHtml(item.xactCode || '')}" class="item-code">
                <input type="number" placeholder="Qty" value="${item.quantity || ''}" class="item-qty" step="0.01">
                <input type="number" placeholder="Unit Cost" value="${item.unitCost || ''}" class="item-cost" step="0.01">
                <input type="text" placeholder="Reason" value="${this._escapeHtml(item.reason || '')}" class="item-reason">
                <button type="button" class="btn-remove-item">×</button>
              </div>
            `).join('')}
          </div>
          <button type="button" id="btn-add-item" class="btn-secondary" style="margin-top: 10px;">+ Add Item</button>
        </div>
      `;
    },

    /**
     * Render completion details
     */
    _renderCompletionDetails(state) {
      return `
        <div class="step-content">
          <h3>Project Information</h3>
          <form id="details-form">
            <div class="form-group">
              <label>Start Date</label>
              <input type="date" name="startDate" value="${state.data.startDate || ''}">
            </div>
            <div class="form-group">
              <label>Completion Date</label>
              <input type="date" name="endDate" value="${state.data.endDate || ''}">
            </div>
            <div class="form-group">
              <label>Crew Information</label>
              <textarea name="crewInfo" rows="3" placeholder="Names and roles of crew members...">${this._escapeHtml(state.data.crewInfo || '')}</textarea>
            </div>
          </form>

          <h3 style="margin-top: 30px;">Materials Used</h3>
          <form id="materials-form">
            <div class="form-group">
              <label>Manufacturer</label>
              <input type="text" name="manufacturer" value="${this._escapeHtml(state.data.materials?.manufacturer || '')}">
            </div>
            <div class="form-group">
              <label>Product Line</label>
              <input type="text" name="productLine" value="${this._escapeHtml(state.data.materials?.productLine || '')}">
            </div>
            <div class="form-group">
              <label>Color</label>
              <input type="text" name="color" value="${this._escapeHtml(state.data.materials?.color || '')}">
            </div>
            <div class="form-group">
              <label>Material Warranty</label>
              <input type="text" name="materialWarranty" value="${this._escapeHtml(state.data.warrantyInfo?.materialWarranty || '')}" placeholder="e.g., 25-year">
            </div>
            <div class="form-group">
              <label>Labor Warranty</label>
              <input type="text" name="laborWarranty" value="${this._escapeHtml(state.data.warrantyInfo?.laborWarranty || '')}" placeholder="e.g., 5-year">
            </div>
          </form>

          <h3 style="margin-top: 30px;">Post-Installation Care Tips</h3>
          <form id="care-form">
            <div class="form-group">
              <label>Maintenance Recommendations</label>
              <textarea name="maintenanceTips" rows="4" placeholder="Tips for ongoing maintenance...">${this._escapeHtml(state.data.maintenanceTips || '')}</textarea>
            </div>
          </form>
        </div>
      `;
    },

    /**
     * Render photo selection step
     */
    _renderPhotoSelection(state) {
      return `
        <div class="step-content">
          <h3>Select Photos for Report</h3>
          <p>Choose photos to include in your report. You can drag to reorder.</p>

          <div id="photo-preview" class="photo-preview-grid">
            <!-- Photos will be loaded here -->
          </div>

          <div style="margin-top: 20px; padding: 15px; background: #f0f0f0; border-radius: 4px;">
            <p style="font-size: 12px; color: #666;">
              Photos tagged for this report will appear automatically.
              Additional photos from this lead can be selected below.
            </p>
          </div>
        </div>
      `;
    },

    /**
     * Render preview and generate step
     */
    _renderPreviewAndGenerate(state) {
      return `
        <div class="step-content">
          <h3>Review & Generate</h3>
          <p>Your report is ready to generate. Click the button below to create the report.</p>

          <div id="report-summary" style="background: #f9f9f9; padding: 15px; border-radius: 4px; margin-top: 20px;">
            <p><strong>Template:</strong> ${this._escapeHtml(this.getTemplate(state.templateId)?.name || '')}</p>
            <p><strong>Lead:</strong> ${this._escapeHtml(this._getLead(state.leadId)?.name || '')}</p>
            <p><strong>Inspector:</strong> ${this._escapeHtml(state.data.inspectorName || '')}</p>
          </div>

          <div style="margin-top: 20px;">
            <label><input type="checkbox" id="save-to-db"> Save report to database</label>
          </div>
        </div>
      `;
    },

    /**
     * Get builder CSS
     */
    _getBuilderStyles() {
      return `
        .report-builder {
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          overflow: hidden;
        }

        .builder-header {
          background: linear-gradient(135deg, ${BRAND.colors.navy}, #2c4a8d);
          color: white;
          padding: 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .builder-header h2 {
          margin: 0;
          font-size: 20px;
        }

        .builder-header p {
          margin: 0;
          opacity: 0.9;
          font-size: 14px;
        }

        .builder-progress {
          height: 4px;
          background: #e0e0e0;
          position: relative;
        }

        .progress-bar {
          height: 100%;
          background: ${BRAND.colors.orange};
          transition: width 0.3s ease;
        }

        .builder-content {
          padding: 30px;
          min-height: 500px;
        }

        .step-content {
          max-width: 600px;
        }

        .step-content h3 {
          color: ${BRAND.colors.navy};
          margin-bottom: 20px;
          font-size: 16px;
        }

        .step-content h4 {
          font-size: 13px;
          color: #333;
          margin-top: 15px;
          margin-bottom: 10px;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-group label {
          display: block;
          margin-bottom: 6px;
          font-weight: 500;
          color: #333;
          font-size: 13px;
        }

        .form-group input,
        .form-group textarea,
        .form-group select {
          width: 100%;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-family: inherit;
          font-size: 13px;
        }

        .form-group textarea {
          resize: vertical;
        }

        .template-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 20px;
          margin-top: 20px;
        }

        .template-card {
          border: 2px solid #e0e0e0;
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .template-card:hover {
          border-color: ${BRAND.colors.orange};
          background: #f9f9f9;
        }

        .template-card.selected {
          border-color: ${BRAND.colors.navy};
          background: #f0f4ff;
        }

        .template-icon {
          font-size: 40px;
          margin-bottom: 10px;
        }

        .template-card h4 {
          margin: 10px 0 8px 0;
          color: ${BRAND.colors.navy};
        }

        .template-card p {
          margin: 0;
          font-size: 12px;
          color: #666;
        }

        .damage-section {
          margin-bottom: 20px;
          padding: 15px;
          background: #f9f9f9;
          border-radius: 4px;
        }

        .damage-section label {
          margin-bottom: 10px;
        }

        .damage-section input[type="checkbox"] {
          margin-right: 8px;
        }

        .line-item {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr 1fr 1fr 40px;
          gap: 10px;
          margin-bottom: 10px;
          padding: 10px;
          background: #f9f9f9;
          border-radius: 4px;
          align-items: center;
        }

        .line-item input {
          padding: 8px;
          border: 1px solid #ddd;
          border-radius: 3px;
          font-size: 12px;
        }

        .btn-remove-item {
          background: #ff4444;
          color: white;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          padding: 8px;
          font-size: 16px;
          line-height: 1;
        }

        .btn-remove-item:hover {
          background: #cc0000;
        }

        .photo-preview-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 15px;
          margin-top: 20px;
        }

        .photo-preview-item {
          position: relative;
          background: #f0f0f0;
          border-radius: 4px;
          overflow: hidden;
          aspect-ratio: 1;
          cursor: move;
        }

        .photo-preview-item img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .photo-preview-item.selected {
          border: 3px solid ${BRAND.colors.orange};
        }

        .builder-footer {
          padding: 20px 30px;
          background: #f9f9f9;
          border-top: 1px solid #e0e0e0;
          display: flex;
          justify-content: space-between;
          gap: 10px;
        }

        .btn-primary, .btn-secondary {
          padding: 12px 24px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s ease;
        }

        .btn-primary {
          background: ${BRAND.colors.orange};
          color: white;
        }

        .btn-primary:hover {
          background: #a83e13;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }

        .btn-secondary {
          background: white;
          color: ${BRAND.colors.navy};
          border: 2px solid ${BRAND.colors.navy};
        }

        .btn-secondary:hover {
          background: ${BRAND.colors.navy};
          color: white;
        }
      `;
    },

    /**
     * Attach event listeners to builder
     */
    _attachBuilderListeners(container, state, lead) {
      const nextBtn = container.querySelector('#btn-next');
      const prevBtn = container.querySelector('#btn-prev');

      nextBtn?.addEventListener('click', () => this._handleNextStep(container, state, lead));
      prevBtn?.addEventListener('click', () => this._handlePrevStep(container, state));

      // Step-specific listeners
      if (state.currentStep === 0) {
        container.querySelectorAll('.template-card').forEach(card => {
          card.addEventListener('click', (e) => {
            container.querySelectorAll('.template-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            state.templateId = card.dataset.template;
          });
        });
      }
    },

    /**
     * Handle next step
     */
    async _handleNextStep(container, state, lead) {
      // Collect data from current step
      const forms = container.querySelectorAll('form');
      let valid = true;

      forms.forEach(form => {
        if (!form.checkValidity()) {
          valid = false;
        }
        // Collect form data
        const formData = new FormData(form);
        for (let [key, value] of formData.entries()) {
          state.data[key] = value;
        }
      });

      if (!valid) {
        showToast('Please fill in required fields', 'warning');
        return;
      }

      if (state.currentStep === 4) {
        // Generate report
        await this._generateAndOpen(state);
      } else {
        state.currentStep++;
        container.innerHTML = this._renderBuilderUI(state);
        this._attachBuilderListeners(container, state, lead);
      }
    },

    /**
     * Handle previous step
     */
    _handlePrevStep(container, state) {
      if (state.currentStep > 0) {
        state.currentStep--;
        container.innerHTML = this._renderBuilderUI(state);
      }
    },

    /**
     * Generate and open the report
     */
    async _generateAndOpen(state) {
      const html = this.generateReport(state.leadId, state.templateId, state.data);
      if (!html) {
        showToast('Failed to generate report', 'error');
        return;
      }

      // Save draft
      this._saveDraft(state.leadId, state.data);

      // Open in new window for printing
      const win = window.open('', '_blank');
      win.document.write(html);
      win.document.close();

      showToast('Report generated! Use Print or Save as PDF from the browser.', 'success');
    },

    /**
     * Render list of reports
     */
    async renderReportList(containerId, leadId) {
      const container = document.getElementById(containerId);
      if (!container) return;

      container.innerHTML = '<p>Loading reports...</p>';

      const reports = await this.getReports(leadId);

      container.innerHTML = `
        <div style="padding: 20px;">
          <h2 style="color: ${BRAND.colors.navy}; margin-bottom: 20px;">
            Reports for this Lead (${reports.length})
          </h2>

          ${reports.length === 0 ? `
            <p style="color: #666;">No reports generated yet.</p>
          ` : `
            <div style="display: grid; gap: 15px;">
              ${reports.map(report => `
                <div style="border: 1px solid #ddd; border-radius: 4px; padding: 15px; display: flex; justify-content: space-between; align-items: center;">
                  <div>
                    <h3 style="margin: 0 0 5px 0; color: ${BRAND.colors.navy};">${this._escapeHtml(report.type)}</h3>
                    <p style="margin: 0; font-size: 12px; color: #666;">
                      ${new Date(report.createdAt?.toDate?.() || report.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div style="display: flex; gap: 10px;">
                    <button class="btn-open-report" data-report-id="${report.id}" style="padding: 8px 16px; background: ${BRAND.colors.orange}; color: white; border: none; border-radius: 3px; cursor: pointer;">
                      View
                    </button>
                    <button class="btn-delete-report" data-report-id="${report.id}" style="padding: 8px 16px; background: #ccc; color: #333; border: none; border-radius: 3px; cursor: pointer;">
                      Delete
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      `;

      // Attach listeners
      container.querySelectorAll('.btn-open-report').forEach(btn => {
        btn.addEventListener('click', (e) => this._openReport(e.currentTarget.dataset.reportId));
      });

      container.querySelectorAll('.btn-delete-report').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          if (confirm('Delete this report?')) {
            await this.deleteReport(e.currentTarget.dataset.reportId);
            this.renderReportList(containerId, leadId);
          }
        });
      });
    },

    /**
     * Open a saved report
     */
    async _openReport(reportId) {
      try {
        if (!window._db) return;

        const { doc, getDoc } = await import(
          'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
        );

        const reportDoc = await getDoc(doc(window._db, REPORTS_COLLECTION, reportId));
        if (!reportDoc.exists()) {
          showToast('Report not found', 'error');
          return;
        }

        const report = reportDoc.data();
        const win = window.open('', '_blank');
        win.document.write(report.html);
        win.document.close();
      } catch (err) {
        console.error('Error opening report:', err);
        showToast('Failed to open report', 'error');
      }
    },

    /**
     * Save draft to localStorage
     */
    _saveDraft(leadId, data) {
      const key = STORAGE_KEY_DRAFT + leadId;
      localStorage.setItem(key, JSON.stringify(data));
    },

    /**
     * Load draft from localStorage
     */
    _loadDraft(leadId) {
      const key = STORAGE_KEY_DRAFT + leadId;
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    },

    /**
     * Get lead from window._leads
     */
    _getLead(leadId) {
      if (!window._leads) return null;
      return window._leads.find(lead => lead.id === leadId);
    },

    /**
     * Escape HTML
     */
    _escapeHtml(text) {
      if (!text) return '';
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return String(text).replace(/[&<>"']/g, m => map[m]);
    }
  };

  // Export to window
  window.InspectionReportEngine = Engine;

  // Make showToast available if not already
  if (typeof window.showToast !== 'function') {
    window.showToast = (msg, type = 'info') => {
      console.log(`[${type.toUpperCase()}] ${msg}`);
    };
  }

})();
