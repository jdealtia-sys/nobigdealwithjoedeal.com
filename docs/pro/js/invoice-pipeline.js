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
   * Get Firestore db reference (v9 modular SDK instance exposed on window._db).
   * Throws if Firestore SDK not loaded or window globals not exposed.
   */
  function getDb() {
    if (!window._db || !window.doc || !window.collection) {
      throw new Error('Firestore (v9) not initialized — window._db missing');
    }
    return window._db;
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
      // Read estimate from Firestore (v9 modular)
      const estRef = window.doc(db, 'estimates', estimateId);
      const estSnap = await window.getDoc(estRef);

      if (!estSnap.exists()) {
        // Try window._estimates cache
        const cached = window._estimates?.find(e => e.id === estimateId);
        if (!cached) throw new Error('Estimate not found');
      }

      const est = estSnap.exists() ? estSnap.data() : window._estimates?.find(e => e.id === estimateId);

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

      const invoiceRef = await window.addDoc(window.collection(db, 'invoices'), invoiceData);
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

      // Update invoice with stripe info (v9 modular)
      const db = getDb();
      await window.updateDoc(window.doc(db, 'invoices', invoiceId), {
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
      const invRef = window.doc(db, 'invoices', invoiceId);
      const invSnap = await window.getDoc(invRef);

      if (!invSnap.exists()) throw new Error('Invoice not found');

      const invoice = invSnap.data();

      // ── Idempotency guard ──────────────────────────────────
      // Refuse to re-send an invoice that's already been sent. Without
      // this, a flaky network — where the email goes out but the
      // followup `status:'sent'` write fails — left the invoice in
      // 'draft' so the next "Send" tap delivered the same invoice
      // twice to the customer. Even more important: an in-flight send
      // (status:'sending') blocks concurrent taps from doubling up.
      if (invoice.status === 'sent') {
        const sentDate = invoice.sentAt?.toDate?.() || invoice.sentAt;
        const niceDate = sentDate ? new Date(sentDate).toLocaleString() : 'previously';
        if (window.showToast) {
          window.showToast('Invoice already sent ' + niceDate + '. Use "Resend" to override.', 'info');
        }
        throw new Error('Invoice already sent');
      }
      if (invoice.status === 'sending') {
        const startedAt = invoice.sendingAt?.toDate?.() || invoice.sendingAt;
        const ageMs = startedAt ? (Date.now() - new Date(startedAt).getTime()) : 0;
        // Stale sending lock (>2 min) means the prior attempt died
        // before completing — release it. Otherwise refuse to
        // double-send.
        if (ageMs > 0 && ageMs < 120000) {
          if (window.showToast) {
            window.showToast('Already sending — wait a moment before retrying.', 'info');
          }
          throw new Error('Send already in progress');
        }
      }

      // Take the lock before any side-effect. If two tabs race here,
      // Firestore serializes the writes — both will succeed but the
      // second one's status check above will catch it on the next
      // call attempt. For tighter guarantees we'd use a transaction;
      // this lock is sufficient for the iPhone/desktop double-tap case.
      try {
        await window.updateDoc(invRef, {
          status: 'sending',
          sendingAt: new Date(),
          updatedAt: new Date()
        });
      } catch (lockErr) {
        console.warn('sendInvoice lock acquire failed, proceeding cautiously:', lockErr && lockErr.message);
      }

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
        // Update lead + mark invoice sent atomically — if the lead
        // write fails the invoice should NOT show as sent. Otherwise
        // the customer record claims the invoice is delivered while
        // the invoice itself is still draft and never reached them.
        if (invoice.leadId && window.writeBatch) {
          const batch = window.writeBatch(db);
          batch.update(window.doc(db, 'leads', invoice.leadId), {
            invoices: window.arrayUnion(invoiceId),
            updatedAt: new Date()
          });
          batch.update(invRef, {
            status: 'sent',
            sentAt: new Date(),
            updatedAt: new Date()
          });
          await batch.commit();
          return;
        }
      }

      // Email/SMS branches (and portal-without-lead): mark invoice sent
      // only after the outbound side-effect above resolved.
      await window.updateDoc(invRef, {
        status: 'sent',
        sentAt: new Date(),
        updatedAt: new Date()
      });

    } catch (error) {
      console.error('sendInvoice error:', error);
      // Release the 'sending' lock on failure so the user can retry.
      // Don't blindly reset 'sent' status though — the idempotency
      // check at the top owns those branches.
      try {
        const invRef2 = window.doc(db, 'invoices', invoiceId);
        const snap2 = await window.getDoc(invRef2);
        if (snap2.exists() && snap2.data().status === 'sending') {
          await window.updateDoc(invRef2, {
            status: 'draft',
            sendingAt: null,
            lastSendError: (error && error.message) ? error.message.slice(0, 200) : 'unknown',
            updatedAt: new Date()
          });
        }
      } catch (releaseErr) {
        console.warn('sendInvoice lock release failed:', releaseErr && releaseErr.message);
      }
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
      const invRef = window.doc(db, 'invoices', invoiceId);
      const invSnap = await window.getDoc(invRef);

      if (!invSnap.exists()) throw new Error('Invoice not found');

      const invoice = invSnap.data();
      const newBalanceDue = Math.max(0, (invoice.balanceDue || 0) - amount);

      // Update invoice
      await window.updateDoc(invRef, {
        depositPaid: amount >= (invoice.depositAmount || 0) || invoice.depositPaid,
        balanceDue: newBalanceDue,
        status: newBalanceDue === 0 ? 'paid' : invoice.status,
        paidAt: newBalanceDue === 0 ? new Date() : invoice.paidAt,
        updatedAt: new Date()
      });

      // If fully paid, advance lead stage. Use 'Approved' — a real stage from the
      // pipeline (New/Inspected/Estimate Sent/Approved/In Progress/Complete/Lost).
      // The previous 'Job Scheduled' value was a phantom stage and silently
      // orphaned the lead from the Kanban board.
      if (newBalanceDue === 0 && invoice.leadId) {
        await window.updateDoc(window.doc(db, 'leads', invoice.leadId), {
          stage: 'Approved',
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
      // Fetch invoices for lead (v9 modular; requires leadId+createdAt composite index)
      const q = window.query(
        window.collection(db, 'invoices'),
        window.where('leadId', '==', leadId),
        window.orderBy('createdAt', 'desc')
      );
      const snap = await window.getDocs(q);

      const invoices = snap.docs.map(d => ({ id: d.id, ...d.data() }));

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
      const snap = await window.getDoc(window.doc(db, 'invoices', invoiceId));
      if (!snap.exists()) throw new Error('Invoice not found');

      const inv = snap.data();
      const _esc = (s) => String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
      const _escJs = (s) => String(s == null ? '' : s)
        .replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"')
        .replace(/</g,'\\x3c').replace(/>/g,'\\x3e').replace(/\n/g,'\\n');

      let html = `
        <div class="invoice-detail" style="padding:20px;background:#fff;border-radius:8px;max-width:900px;margin:0 auto;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">
            <div>
              <div style="font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:700;color:var(--orange);">NBD ROOFING</div>
              <div style="font-size:12px;color:var(--m);">Invoice ${_esc(invoiceId)}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:32px;font-weight:700;color:var(--orange);">${formatCurrency(inv.total)}</div>
              <div style="font-size:11px;color:var(--m);text-transform:uppercase;letter-spacing:.05em;font-weight:700;">${_esc(inv.status)}</div>
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
                <div><strong>Status:</strong> ${_esc((inv.status||'').toString().toUpperCase())}</div>
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
            <td style="padding:8px;">${_esc(item.description)}</td>
            <td style="text-align:right;padding:8px;">${_esc(item.quantity)}</td>
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
            <button onclick="window.InvoicePipeline.sendInvoiceUI('${_escJs(invoiceId)}')" style="padding:8px 16px;background:var(--orange);color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:700;">Send to Customer</button>
            ${inv.stripePaymentLink ? `<button onclick="navigator.clipboard.writeText('${_escJs(inv.stripePaymentLink)}'); if(typeof showToast==='function')showToast('Payment link copied!','ok');else alert('Payment link copied!')" style="padding:8px 16px;background:var(--blue);color:#fff;border:none;border-radius:5px;cursor:pointer;font-weight:700;">Copy Payment Link</button>` : ''}
          </div>

          <div style="background:var(--s2);padding:12px;border-radius:5px;font-size:11px;color:var(--m);">
            <strong>Terms:</strong> ${_esc(inv.terms)}
          </div>
          ${inv.notes ? `<div style="background:var(--s2);padding:12px;border-radius:5px;font-size:11px;color:var(--m);margin-top:8px;"><strong>Notes:</strong> ${_esc(inv.notes)}</div>` : ''}
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
      // v9 modular; requires createdBy+createdAt composite index
      const q = window.query(
        window.collection(db, 'invoices'),
        window.where('createdBy', '==', window._auth?.currentUser?.uid || 'system'),
        window.orderBy('createdAt', 'desc'),
        window.limit(50)
      );
      const snap = await window.getDocs(q);

      const invoices = snap.docs.map(d => ({ id: d.id, ...d.data() }));

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
    // Escape every interpolated user-controlled field — this builder
    // composes the EMAIL BODY sent to homeowners. PR #28 fixed
    // renderInvoiceDetail (the in-app preview) but missed this
    // builder, leaving an XSS sink that lands in the customer's
    // mail client where our CSP doesn't apply.
    const _esc = (s) => String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    // For URL-bearing attributes (the Stripe link) reject anything
    // that doesn't look like an http(s) URL. javascript:/data: URIs
    // would otherwise execute when the customer clicks "Pay Online".
    const _safeUrl = (u) => {
      const s = String(u || '');
      return /^https?:\/\//i.test(s) ? s : '';
    };
    const items = (invoice.items || [])
      .map(item => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee;">${_esc(item.description)}</td>
          <td style="text-align:right;padding:8px;border-bottom:1px solid #eee;">${_esc(item.quantity)}</td>
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
            .header { border-bottom: 3px solid #e8720c; padding-bottom: 15px; margin-bottom: 20px; }
            .brand { font-size: 20px; font-weight: 700; text-transform: uppercase; color: #e8720c; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            .total { text-align: right; font-weight: 700; }
            .cta { background: #e8720c; color: #fff; padding: 12px 24px; border-radius: 5px; text-decoration: none; display: inline-block; margin-top: 20px; }
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
                <tr style="border-bottom: 2px solid #e8720c;">
                  <th style="text-align: left; padding: 10px;">DESCRIPTION</th>
                  <th style="text-align: right; padding: 10px;">QTY</th>
                  <th style="text-align: right; padding: 10px;">PRICE</th>
                  <th style="text-align: right; padding: 10px;">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                ${items}
                <tr style="border-top: 2px solid #e8720c;">
                  <td colspan="3" style="text-align: right; padding: 10px; font-weight: 700;">Total:</td>
                  <td style="text-align: right; padding: 10px; font-weight: 700; font-size: 16px;">${formatCurrency(invoice.total)}</td>
                </tr>
              </tbody>
            </table>
            <p><strong>Payment Terms:</strong> ${_esc(invoice.terms)}</p>
            ${_safeUrl(invoice.stripePaymentLink) ? `<a href="${_esc(_safeUrl(invoice.stripePaymentLink))}" class="cta">Pay Online</a>` : ''}
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
    overlay.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(10,12,15,.85);z-index:100000;display:flex;align-items:center;justify-content:center;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);';
    overlay.innerHTML = `
      <div style="background:#14161a;border:1px solid rgba(255,255,255,.1);border-radius:16px;max-width:420px;width:92%;padding:28px;color:#fff;">
        <div style="font-family:'Barlow Condensed',sans-serif;font-size:18px;font-weight:700;margin-bottom:16px;">Create Invoice from Estimate</div>
        <label style="font-size:10px;font-weight:600;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;">Estimate ID</label>
        <input id="nbd-inv-est-id" type="text" placeholder="Select or enter estimate ID..." style="width:100%;padding:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:14px;margin-top:6px;box-sizing:border-box;">
        <div style="display:flex;gap:8px;margin-top:20px;">
          <button id="nbd-inv-cancel" style="flex:1;padding:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;cursor:pointer;font-weight:600;">Cancel</button>
          <button id="nbd-inv-create" style="flex:1;padding:12px;background:#e8720c;border:none;border-radius:8px;color:#fff;cursor:pointer;font-weight:700;">Create Invoice</button>
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
    overlay.style.cssText = 'position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(10,12,15,.85);z-index:100000;display:flex;align-items:center;justify-content:center;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);';
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
