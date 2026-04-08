// ═══════════════════════════════════════════════════════════════════════════
// NBD Pro — invoice-pipeline.js
// Estimate → Invoice → Payment Pipeline
// Connects estimates to Stripe for invoicing and payment collection
// ═══════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  const CLOUD_FUNCTION_BASE = 'https://us-central1-nobigdeal-pro.cloudfunctions.net';

  // ═══════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get Firebase ID token for Cloud Function calls
   */
  async function getAuthToken() {
    try {
      if (window._auth?.currentUser) {
        return await window._auth.currentUser.getIdToken(true);
      }
      return null;
    } catch (error) {
      console.error('Failed to get auth token:', error);
      return null;
    }
  }

  /**
   * Call Cloud Function with auth
   */
  async function callCloudFunction(endpoint, data) {
    const token = await getAuthToken();
    if (!token) {
      throw new Error('Not authenticated');
    }

    const response = await fetch(`${CLOUD_FUNCTION_BASE}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      const errData = await response.json();
      throw new Error(errData.error || `API ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Format currency
   */
  function formatCurrency(amount) {
    return '$' + parseFloat(amount).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  /**
   * Get Firestore db reference
   */
  function getDb() {
    if (!window._firebaseApp) {
      throw new Error('Firebase not initialized');
    }
    return window._firebaseApp.firestore?.() || firebase.firestore();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CORE INVOICE FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Create invoice from estimate
   * @param {string} estimateId - Firestore estimate ID
   * @returns {Promise<string>} invoiceId
   */
  async function createInvoiceFromEstimate(estimateId) {
    const db = getDb();

    try {
      // Read estimate from Firestore
      const estRef = db.collection('estimates').doc(estimateId);
      const estSnap = await estRef.get();

      if (!estSnap.exists) {
        // Try window._estimates cache
        const est = window._estimates?.find(e => e.id === estimateId);
        if (!est) throw new Error('Estimate not found');
      }

      const est = estSnap.exists ? estSnap.data() : window._estimates?.find(e => e.id === estimateId);

      // Build invoice from estimate
      const items = (est.rows || []).map(row => ({
        description: row.desc || row.description || '',
        quantity: parseFloat(row.qty) || 1,
        unitPrice: parseFloat(row.rate) || 0,
        total: parseFloat(row.total) || 0
      }));

      const subtotal = items.reduce((sum, item) => sum + item.total, 0);
      const taxRate = 0.075; // 7.5% Ohio sales tax
      const tax = subtotal * taxRate;
      const total = subtotal + tax;
      const depositAmount = total * 0.5; // Default 50% deposit

      // Create invoice doc
      const invoiceData = {
        leadId: est.leadId || null,
        estimateId: estimateId,
        customerId: est.customerId || null,
        status: 'draft',
        items: items,
        subtotal: subtotal,
        tax: tax,
        taxRate: taxRate,
        total: total,
        depositAmount: depositAmount,
        depositPaid: false,
        balanceDue: total - depositAmount,
        stripeInvoiceId: null,
        stripePaymentLink: null,
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days
        sentAt: null,
        paidAt: null,
        viewedAt: null,
        notes: '',
        terms: 'Net 14. 50% deposit due upon scheduling.',
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: window._auth?.currentUser?.uid || 'system'
      };

      const invoiceRef = await db.collection('invoices').add(invoiceData);
      return invoiceRef.id;

    } catch (error) {
      console.error('createInvoiceFromEstimate error:', error);
      throw error;
    }
  }

  /**
   * Generate Stripe Payment Link for invoice
   * @param {string} invoiceId
   * @returns {Promise<{url: string, paymentLinkId: string}>}
   */
  async function generateStripePaymentLink(invoiceId) {
    try {
      const result = await callCloudFunction('createStripePaymentLink', {
        invoiceId: invoiceId
      });

      // Update invoice with stripe info
      const db = getDb();
      await db.collection('invoices').doc(invoiceId).update({
        stripePaymentLink: result.url,
        stripeInvoiceId: result.paymentLinkId,
        updatedAt: new Date()
      });

      return result;

    } catch (error) {
      console.error('generateStripePaymentLink error:', error);
      throw error;
    }
  }

  /**
   * Send invoice to customer
   * @param {string} invoiceId
   * @param {string} method - 'email' | 'sms' | 'portal'
   */
  async function sendInvoice(invoiceId, method) {
    const db = getDb();

    try {
      const invRef = db.collection('invoices').doc(invoiceId);
      const invSnap = await invRef.get();

      if (!invSnap.exists) throw new Error('Invoice not found');

      const invoice = invSnap.data();

      if (method === 'email') {
        // Build invoice HTML
        const invoiceHtml = buildInvoiceHtml(invoice);

        // Send via NBDComms
        if (window.NBDComms?.sendEmail) {
          await window.NBDComms.sendEmail({
            to: invoice.customerEmail || '',
            subject: `Invoice ${invoiceId} from NBD Roofing`,
            html: invoiceHtml
          });
        } else {
          throw new Error('Email service not available');
        }

      } else if (method === 'sms') {
        const link = invoice.stripePaymentLink || '';
        const message = `Your NBD Roofing invoice is ready. Payment link: ${link}`;

        if (window.NBDComms?.sendSMS) {
          await window.NBDComms.sendSMS({
            to: invoice.customerPhone || '',
            message: message
          });
        } else {
          throw new Error('SMS service not available');
        }

      } else if (method === 'portal') {
        // Update customer portal
        if (invoice.leadId) {
          await db.collection('leads').doc(invoice.leadId).update({
            invoices: firebase.firestore.FieldValue.arrayUnion(invoiceId),
            updatedAt: new Date()
          });
        }
      }

      // Update invoice status
      await invRef.update({
        status: 'sent',
        sentAt: new Date(),
        updatedAt: new Date()
      });

    } catch (error) {
      console.error('sendInvoice error:', error);
      throw error;
    }
  }

  /**
   * Mark invoice as paid
   * @param {string} invoiceId
   * @param {number} amount
   * @param {string} method - 'cash' | 'check' | 'stripe'
   */
  async function markPaid(invoiceId, amount, method) {
    const db = getDb();

    try {
      const invRef = db.collection('invoices').doc(invoiceId);
      const invSnap = await invRef.get();

      if (!invSnap.exists) throw new Error('Invoice not found');

      const invoice = invSnap.data();
      const newBalanceDue = Math.max(0, invoice.balanceDue - amount);

      // Update invoice
      await invRef.update({
        depositPaid: amount >= invoice.depositAmount || invoice.depositPaid,
        balanceDue: newBalanceDue,
        status: newBalanceDue === 0 ? 'paid' : invoice.status,
        paidAt: newBalanceDue === 0 ? new Date() : invoice.paidAt,
        updatedAt: new Date()
      });

      // If fully paid, update lead stage
      if (newBalanceDue === 0 && invoice.leadId) {
        await db.collection('leads').doc(invoice.leadId).update({
          stage: 'Job Scheduled',
          updatedAt: new Date()
        });
      }

      // Send receipt
      if (window.NBDComms?.sendEmail && invoice.customerEmail) {
        await window.NBDComms.sendEmail({
          to: invoice.customerEmail,
          subject: `Payment Received - NBD Roofing Invoice ${invoiceId}`,
          html: `<p>Thank you! We received your payment of ${formatCurrency(amount)}.</p><p>Your invoice is now ${newBalanceDue === 0 ? 'fully paid' : 'partially paid'}.</p>`
        });
      }

    } catch (error) {
      console.error('markPaid error:', error);
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UI RENDERING
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Render invoice panel (list of invoices for a lead)
   */
  async function renderInvoicePanel(containerId, leadId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const db = getDb();

    try {
      // Fetch invoices for lead
      const snap = await db.collection('invoices')
        .where('leadId', '==', leadId)
        .orderBy('createdAt', 'desc')
        .get();

      const invoices = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      let html = `
        <div class="invoice-panel" style="padding:16px;background:var(--s1);border-radius:8px;border:1px solid var(--br);">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="margin:0;font-size:14px;font-weight:700;">Invoices</h3>
            <button onclick="window.InvoicePipeline.createInvoiceUI('${leadId}')" style="padding:6px 12px;background:var(--orange);color:#fff;border:none;border-radius:5px;font-size:11px;font-weight:700;cursor:pointer;">+ New Invoice</button>
          </div>
      `;

      if (invoices.length === 0) {
        html += `<div style="color:var(--m);font-size:12px;padding:12px;text-align:center;">No invoices yet</div>`;
      } else {
        html += `<div style="display:grid;gap:8px;">`;
        invoices.forEach(inv => {
          const statusBg = inv.status === 'paid' ? 'var(--green)' : inv.status === 'sent' ? 'var(--blue)' : 'var(--m)';
          const statusTxt = inv.status.charAt(0).toUpperCase() + inv.status.slice(1);
          html += `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px;background:var(--s2);border-radius:5px;border-left:3px solid ${statusBg};">
              <div style="flex:1;">
                <div style="font-weight:700;font-size:12px;">${formatCurrency(inv.total)}</div>
                <div style="font-size:11px;color:var(--m);">${statusTxt}</div>
              </div>
              <div style="display:flex;gap:6px;">
                <button onclick="window.InvoicePipeline.renderInvoiceDetail('inv-detail', '${inv.id}')" style="padding:4px 10px;font-size:10px;background:var(--blue);color:#fff;border:none;border-radius:3px;cursor:pointer;">View</button>
                <button onclick="window.InvoicePipeline.sendInvoiceUI('${inv.id}')" style="padding:4px 10px;font-size:10px;background:var(--orange);color:#fff;border:none;border-radius:3px;cursor:pointer;">Send</button>
              </div>
            </div>
          `;
        });
        html += `</div>`;
      }

      html += `</div>`;
      container.innerHTML = html;

    } catch (error) {
      console.error('renderInvoicePanel error:', error);
      container.innerHTML = `<div style="color:var(--red);padding:12px;">Failed to load invoices</div>`;
    }
  }

  /**
   * Render full invoice detail view
   */
  async function renderInvoiceDetail(containerId, invoiceId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const db = getDb();

    try {
      const snap = await db.collection('invoices').doc(invoiceId).get();
      if (!snap.exists) throw new Error('Invoice not found');

      const inv = snap.data();

      let html = `
        <div class="invoice-detail" style="padding:20px;background:#fff;border-radius:8px;max-width:900px;margin:0 auto;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
            <div>
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:700;color:var(--orange);">NBD ROOFING</div>
              <div style="font-size:12px;color:var(--m);">Invoice ${invoiceId}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:32px;font-weight:700;color:var(--orange);">${formatCurrency(inv.total)}</div>
              <div style="font-size:11px;color:var(--m);text-transform:uppercase;letter-spacing:.05em;font-weight:700;">${inv.status}</div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
            <div>
              <div style="font-size:10px;color:var(--m);text-transform:uppercase;font-weight:700;margin-bottom:4px;">Bill To</div>
              <div style="font-size:14px;font-weight:700;">Customer Name</div>
              <div style="font-size:12px;color:var(--m);">customer@example.com</div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--m);text-transform:uppercase;font-weight:700;margin-bottom:4px;">Invoice Details</div>
              <div style="display:grid;gap:4px;font-size:12px;">
                <div><strong>Date:</strong> ${new Date(inv.createdAt?.toDate?.() || inv.createdAt).toLocaleDateString()}</div>
                <div><strong>Due Date:</strong> ${new Date(inv.dueDate?.toDate?.() || inv.dueDate).toLocaleDateString()}</div>
                <div><strong>Status:</strong> ${inv.status.toUpperCase()}</div>
              </div>
            </div>
          </div>

          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <thead>
              <tr style="border-bottom:2px solid var(--br);">
                <th style="text-align:left;padding:8px;font-weight:700;font-size:11px;">DESCRIPTION</th>
                <th style="text-align:right;padding:8px;font-weight:700;font-size:11px;">QUANTITY</th>
                <th style="text-align:right;padding:8px;font-weight:700;font-size:11px;">UNIT PRICE</th>
                <th style="text-align:right;padding:8px;font-weight:700;font-size:11px;">TOTAL</th>
              </tr>
            </thead>
            <tbody>
      `;

      inv.items?.forEach(item => {
        html += `
          <tr style="border-bottom:1px solid var(--br);">
            <td style="padding:8px;">${item.description}</td>
            <td style="text-align:right;padding:8px;">${item.quantity}</td>
            <td style="text-align:right;padding:8px;">${formatCurrency(item.unitPrice)}</td>
            <td style="text-align:right;padding:8px;font-weight:700;">${formatCurrency(item.total)}</td>
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>

          <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
            <div style="width:300px;">
              <div style="display:flex;justify-content:space-between;padding:8px;border-bottom:1px solid var(--br);font-size:12px;">
                <span>Subtotal:</span>
                <span>${formatCurrency(inv.subtotal)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;padding:8px;border-bottom:1px solid var(--br);font-size:12px;">
                <span>Tax (${(inv.taxRate * 100).toFixed(1)}%):</span>
                <span>${formatCurrency(inv.tax)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;padding:8px;font-size:14px;font-weight:700;">
                <span>Total:</span>
                <span>${formatCurrency(inv.total)}</span>
              </div>
            </div>
          </div>

          <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;">
            <button onclick="window.print()" style="padding:8px 16px;background:var(--s2);border:1px solid var(--br);border-radius:5px;cursor:pointer;font-weight:700;">Print Invoice</button>
            <button onclick="window.InvoicePipeline.sendInvoiceUI('${invoiceId}')" style="padding:8px 16px;background:var(--orange);color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:700;">Send to Customer</button>
            ${inv.stripePaymentLink ? `<button onclick="navigator.clipboard.writeText('${inv.stripePaymentLink}'); if(typeof showToast==='function')showToast('Payment link copied!','ok');else alert('Payment link copied!')" style="padding:8px 16px;background:var(--blue);color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:700;">Copy Payment Link</button>` : ''}
          </div>

          <div style="background:var(--s2);padding:12px;border-radius:5px;font-size:11px;color:var(--m);">
            <strong>Terms:</strong> ${inv.terms}
          </div>
        </div>
      `;

      container.innerHTML = html;

    } catch (error) {
      console.error('renderInvoiceDetail error:', error);
      container.innerHTML = `<div style="color:var(--red);padding:12px;">Failed to load invoice</div>`;
    }
  }

  /**
   * Render invoice list (all invoices)
   */
  async function renderInvoiceList(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const db = getDb();

    try {
      const snap = await db.collection('invoices')
        .where('createdBy', '==', window._auth?.currentUser?.uid || 'system')
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();

      const invoices = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Calculate total outstanding
      const totalOutstanding = invoices
        .filter(inv => inv.status !== 'paid')
        .reduce((sum, inv) => sum + (inv.balanceDue || 0), 0);

      let html = `
        <div class="invoice-list" style="padding:16px;">
          <div style="background:var(--s2);padding:12px;border-radius:8px;margin-bottom:16px;">
            <div style="font-size:12px;color:var(--m);">Total Outstanding</div>
            <div style="font-size:28px;font-weight:700;color:var(--orange);">${formatCurrency(totalOutstanding)}</div>
          </div>

          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;">
              <thead>
                <tr style="border-bottom:2px solid var(--br);">
                  <th style="text-align:left;padding:10px;font-weight:700;font-size:11px;">INVOICE</th>
                  <th style="text-align:left;padding:10px;font-weight:700;font-size:11px;">CUSTOMER</th>
                  <th style="text-align:right;padding:10px;font-weight:700;font-size:11px;">AMOUNT</th>
                  <th style="text-align:right;padding:10px;font-weight:700;font-size:11px;">DUE DATE</th>
                  <th style="padding:10px;font-weight:700;font-size:11px;">STATUS</th>
                  <th style="padding:10px;font-weight:700;font-size:11px;">ACTION</th>
                </tr>
              </thead>
              <tbody>
      `;

      invoices.forEach(inv => {
        const dueDate = new Date(inv.dueDate?.toDate?.() || inv.dueDate);
        const isOverdue = dueDate < new Date() && inv.status !== 'paid';
        const statusBg = inv.status === 'paid' ? 'var(--green)' : isOverdue ? 'var(--red)' : 'var(--blue)';

        html += `
          <tr style="border-bottom:1px solid var(--br);">
            <td style="padding:10px;font-weight:700;font-size:12px;">${inv.id.slice(0, 8)}</td>
            <td style="padding:10px;font-size:12px;">Customer</td>
            <td style="text-align:right;padding:10px;font-size:12px;font-weight:700;">${formatCurrency(inv.total)}</td>
            <td style="text-align:right;padding:10px;font-size:12px;">${dueDate.toLocaleDateString()}</td>
            <td style="padding:10px;">
              <span style="background:${statusBg};color:#fff;padding:3px 8px;border-radius:3px;font-size:10px;font-weight:700;text-transform:uppercase;">${inv.status}</span>
            </td>
            <td style="padding:10px;">
              <button onclick="window.InvoicePipeline.renderInvoiceDetail('inv-detail-modal', '${inv.id}')" style="padding:4px 10px;font-size:10px;background:var(--blue);color:#fff;border:none;border-radius:3px;cursor:pointer;">View</button>
            </td>
          </tr>
        `;
      });

      html += `
              </tbody>
            </table>
          </div>
        </div>
      `;

      container.innerHTML = html;

    } catch (error) {
      console.error('renderInvoiceList error:', error);
      container.innerHTML = `<div style="color:var(--red);padding:12px;">Failed to load invoices</div>`;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // UI HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Build invoice HTML for email
   */
  function buildInvoiceHtml(invoice) {
    const items = (invoice.items || [])
      .map(item => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee;">${item.description}</td>
          <td style="text-align:right;padding:8px;border-bottom:1px solid #eee;">${item.quantity}</td>
          <td style="text-align:right;padding:8px;border-bottom:1px solid #eee;">${formatCurrency(item.unitPrice)}</td>
          <td style="text-align:right;padding:8px;border-bottom:1px solid #eee;font-weight:700;">${formatCurrency(item.total)}</td>
        </tr>
      `)
      .join('');

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <style>
            body { font-family: Barlow, sans-serif; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { border-bottom: 3px solid #C8541A; padding-bottom: 15px; margin-bottom: 20px; }
            .brand { font-size: 20px; font-weight: 700; text-transform: uppercase; color: #C8541A; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            .total { text-align: right; font-weight: 700; }
            .cta { background: #C8541A; color: #fff; padding: 12px 24px; border-radius: 5px; text-decoration: none; display: inline-block; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="brand">NBD Roofing</div>
              <p style="margin:5px 0 0 0;color:#999;">Your Invoice is Ready</p>
            </div>
            <p>Hello,</p>
            <p>Your roofing estimate has been converted to an invoice. Please review the details below.</p>
            <table>
              <thead>
                <tr style="border-bottom: 2px solid #C8541A;">
                  <th style="text-align: left; padding: 10px;">DESCRIPTION</th>
                  <th style="text-align: right; padding: 10px;">QTY</th>
                  <th style="text-align: right; padding: 10px;">PRICE</th>
                  <th style="text-align: right; padding: 10px;">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                ${items}
                <tr style="border-top: 2px solid #C8541A;">
                  <td colspan="3" style="text-align: right; padding: 10px; font-weight: 700;">Total:</td>
                  <td style="text-align: right; padding: 10px; font-weight: 700; font-size: 16px;">${formatCurrency(invoice.total)}</td>
                </tr>
              </tbody>
            </table>
            <p><strong>Payment Terms:</strong> ${invoice.terms}</p>
            ${invoice.stripePaymentLink ? `<a href="${invoice.stripePaymentLink}" class="cta">Pay Online</a>` : ''}
            <p style="margin-top: 30px; font-size: 12px; color: #999;">Thank you for choosing NBD Roofing!</p>
          </div>
        </body>
      </html>
    `;
  }

  /**
   * UI: Create invoice from estimate dialog (modal instead of prompt for Safari compat)
   */
  async function createInvoiceUI(leadId) {
    // Build inline modal instead of using prompt()
    const existing = document.getElementById('nbd-invoice-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'nbd-invoice-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,12,15,.85);z-index:100000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);';
    overlay.innerHTML = `
      <div style="background:#14161a;border:1px solid rgba(255,255,255,.1);border-radius:16px;max-width:420px;width:92%;padding:28px;color:#fff;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;margin-bottom:16px;">Create Invoice from Estimate</div>
        <label style="font-size:10px;font-weight:600;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;">Estimate ID</label>
        <input id="nbd-inv-est-id" type="text" placeholder="Select or enter estimate ID..." style="width:100%;padding:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:14px;margin-top:6px;box-sizing:border-box;">
        <div style="display:flex;gap:8px;margin-top:20px;">
          <button id="nbd-inv-cancel" style="flex:1;padding:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;cursor:pointer;font-weight:600;">Cancel</button>
          <button id="nbd-inv-create" style="flex:1;padding:12px;background:#C8541A;border:none;border-radius:8px;color:#fff;cursor:pointer;font-weight:700;">Create Invoice</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Populate estimate dropdown if leads have estimates
    const input = document.getElementById('nbd-inv-est-id');
    if (leadId && window._leads) {
      const lead = window._leads.find(l => l.id === leadId);
      if (lead?.estimateId) input.value = lead.estimateId;
    }
    input.focus();

    return new Promise((resolve) => {
      document.getElementById('nbd-inv-cancel').onclick = () => { overlay.remove(); resolve(); };
      overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(); } };
      document.getElementById('nbd-inv-create').onclick = async () => {
        const estimateId = input.value.trim();
        if (!estimateId) { if (typeof showToast === 'function') showToast('Enter an estimate ID', 'error'); return; }
        overlay.remove();
        try {
          showToast('Creating invoice...', 'info');
          const invoiceId = await createInvoiceFromEstimate(estimateId);
          await generateStripePaymentLink(invoiceId);
          showToast('Invoice created successfully', 'success');
          renderInvoicePanel('invoice-panel', leadId);
        } catch (error) {
          showToast(`Error: ${error.message}`, 'error');
        }
        resolve();
      };
    });
  }

  /**
   * UI: Send invoice dialog (modal instead of prompt for Safari compat)
   */
  async function sendInvoiceUI(invoiceId) {
    const existing = document.getElementById('nbd-send-invoice-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'nbd-send-invoice-modal';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,12,15,.85);z-index:100000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);';
    overlay.innerHTML = `
      <div style="background:#14161a;border:1px solid rgba(255,255,255,.1);border-radius:16px;max-width:380px;width:92%;padding:28px;color:#fff;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;margin-bottom:16px;">Send Invoice</div>
        <div style="font-size:12px;color:rgba(255,255,255,.5);margin-bottom:16px;">How would you like to send this invoice?</div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button class="nbd-send-method" data-method="email" style="padding:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;cursor:pointer;font-weight:600;text-align:left;font-size:14px;">📧 Send via Email</button>
          <button class="nbd-send-method" data-method="sms" style="padding:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;cursor:pointer;font-weight:600;text-align:left;font-size:14px;">💬 Send via SMS</button>
          <button class="nbd-send-method" data-method="portal" style="padding:14px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;cursor:pointer;font-weight:600;text-align:left;font-size:14px;">🌐 Share Customer Portal Link</button>
        </div>
        <button id="nbd-send-cancel" style="width:100%;padding:12px;background:none;border:1px solid rgba(255,255,255,.12);border-radius:8px;color:rgba(255,255,255,.5);cursor:pointer;margin-top:12px;font-size:12px;">Cancel</button>
      </div>
    `;
    document.body.appendChild(overlay);

    return new Promise((resolve) => {
      document.getElementById('nbd-send-cancel').onclick = () => { overlay.remove(); resolve(); };
      overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(); } };
      overlay.querySelectorAll('.nbd-send-method').forEach(btn => {
        btn.onclick = async () => {
          const method = btn.dataset.method;
          overlay.remove();
          try {
            showToast(`Sending invoice via ${method}...`, 'info');
            await sendInvoice(invoiceId, method);
            showToast('Invoice sent successfully', 'success');
          } catch (error) {
            showToast(`Error: ${error.message}`, 'error');
          }
          resolve();
        };
      });
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // EXPORTS
  // ═══════════════════════════════════════════════════════════════════════

  window.InvoicePipeline = {
    createInvoiceFromEstimate,
    generateStripePaymentLink,
    sendInvoice,
    markPaid,
    renderInvoicePanel,
    renderInvoiceDetail,
    renderInvoiceList,
    createInvoiceUI,
    sendInvoiceUI
  };

})();
