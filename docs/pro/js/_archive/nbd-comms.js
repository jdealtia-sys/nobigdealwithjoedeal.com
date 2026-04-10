// ═══════════════════════════════════════════════════════════════════════════
// NBD COMMUNICATIONS MODULE - Unified Email, SMS, and Team Invite System
// Bridges UI components to Cloud Functions for reliable delivery
// ═══════════════════════════════════════════════════════════════════════════

(function() {
  'use strict';

  const CLOUD_FUNCTION_BASE = 'https://us-central1-nobigdeal-pro.cloudfunctions.net';
  const OPERATIONS_TIMEOUT = 30000; // 30 seconds for Cloud Function calls

  // ═══════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get Firebase ID token for authentication
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
   * Show toast notification
   */
  function showToast(message, type = 'info') {
    if (typeof window.showToast === 'function') {
      window.showToast(message, type);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  }

  /**
   * Format US phone number: add +1 prefix if missing, strip non-digits
   */
  function formatPhoneNumber(phone) {
    if (!phone) return '';
    const cleaned = phone.replace(/[^0-9+]/g, '');
    if (!cleaned.startsWith('+')) {
      return '+1' + cleaned.slice(-10); // Take last 10 digits for US
    }
    return cleaned;
  }

  /**
   * Generic Cloud Function caller with error handling
   */
  async function callCloudFunction(endpoint, data) {
    try {
      const token = await getAuthToken();
      if (!token) {
        console.warn('No auth token available — using fallback method');
        return { success: false, fallback: true };
      }

      const url = `${CLOUD_FUNCTION_BASE}/${endpoint}`;
      const response = await Promise.race([
        fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(data)
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Cloud Function timeout')), OPERATIONS_TIMEOUT)
        )
      ]);

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`Cloud Function error (${response.status}):`, errorText);
        return { success: false, fallback: true };
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.warn('Cloud Function call failed:', error.message);
      return { success: false, fallback: true };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // EMAIL OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Send email via Cloud Function
   * Falls back to mailto if Cloud Function unavailable
   */
  async function sendEmail(to, subject, body, opts = {}) {
    if (!to || !subject || !body) {
      showToast('Email requires to, subject, and body', 'error');
      return { success: false };
    }

    const emailData = {
      to,
      subject,
      body,
      html: opts.html || null,
      replyTo: opts.replyTo || null,
      leadId: opts.leadId || null
    };

    // Try Cloud Function first
    const result = await callCloudFunction('sendEmail', emailData);

    if (result.success) {
      showToast('Email sent successfully', 'ok');

      // Update lead activity if leadId provided
      if (opts.leadId && window.db && window.addDoc) {
        try {
          await window.addDoc(window.collection(window.db, 'email_log'), {
            leadId: opts.leadId,
            to,
            subject,
            sentAt: window.serverTimestamp(),
            sentBy: window._user?.email || 'system',
            method: 'cloud_function'
          });
        } catch (err) {
          console.warn('Failed to log email:', err);
        }
      }

      return { success: true, method: 'cloud' };
    }

    // Fallback: mailto link
    console.log('Falling back to mailto for email delivery');
    const mailtoLink = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;

    if (opts.leadId && window.db && window.addDoc) {
      try {
        await window.addDoc(window.collection(window.db, 'email_log'), {
          leadId: opts.leadId,
          to,
          subject,
          sentAt: window.serverTimestamp(),
          sentBy: window._user?.email || 'system',
          method: 'mailto'
        });
      } catch (err) {
        console.warn('Failed to log email:', err);
      }
    }

    return { success: true, method: 'mailto' };
  }

  /**
   * Send estimate email
   */
  async function sendEstimateEmail(leadId, estimateHtml, subject) {
    if (!leadId || !estimateHtml) {
      showToast('Missing required parameters for estimate email', 'error');
      return { success: false };
    }

    const result = await callCloudFunction('sendEstimateEmail', {
      leadId,
      estimateHtml,
      subject
    });

    if (result.success) {
      showToast('Estimate sent to customer', 'ok');
      return { success: true };
    } else {
      showToast('Failed to send estimate. Please try again.', 'error');
      return { success: false };
    }
  }

  /**
   * Send team member invitation email
   */
  async function sendTeamInvite(email, role, inviterName) {
    if (!email || !role) {
      showToast('Missing email or role for team invite', 'error');
      return { success: false };
    }

    const result = await callCloudFunction('sendTeamInvite', {
      email,
      role,
      inviterName
    });

    if (result.success) {
      showToast(`Invitation sent to ${email}`, 'ok');
      return { success: true };
    } else {
      showToast('Failed to send invite. Please try again.', 'error');
      return { success: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SMS OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Send SMS via Cloud Function
   * Falls back to sms: link if Cloud Function unavailable
   */
  async function sendSMS(to, body, leadId) {
    if (!to || !body) {
      showToast('SMS requires phone and message body', 'error');
      return { success: false };
    }

    const phone = formatPhoneNumber(to);

    const smsData = {
      phone,
      body,
      leadId: leadId || null
    };

    // Try Cloud Function first
    const result = await callCloudFunction('sendSMS', smsData);

    if (result.success) {
      showToast('Text sent successfully', 'ok');

      // Log SMS if Firestore available
      if (leadId && window.db && window.addDoc) {
        try {
          await window.addDoc(window.collection(window.db, 'sms_log'), {
            leadId,
            phone,
            body: body.substring(0, 100), // Store first 100 chars
            sentAt: window.serverTimestamp(),
            sentBy: window._user?.email || 'system',
            method: 'cloud_function'
          });
        } catch (err) {
          console.warn('Failed to log SMS:', err);
        }
      }

      return { success: true, method: 'cloud' };
    }

    // Fallback: sms: link
    console.log('Falling back to sms: link for SMS delivery');
    const smsLink = `sms:${phone}?body=${encodeURIComponent(body)}`;
    window.open(smsLink, '_blank');

    if (leadId && window.db && window.addDoc) {
      try {
        await window.addDoc(window.collection(window.db, 'sms_log'), {
          leadId,
          phone,
          body: body.substring(0, 100),
          sentAt: window.serverTimestamp(),
          sentBy: window._user?.email || 'system',
          method: 'sms_link'
        });
      } catch (err) {
        console.warn('Failed to log SMS:', err);
      }
    }

    return { success: true, method: 'sms_link' };
  }

  /**
   * Send D2D tracker SMS using template
   */
  async function sendD2DSMS(knockId, templateKey) {
    if (!knockId || !templateKey) {
      showToast('Missing knock ID or template key', 'error');
      return { success: false };
    }

    const result = await callCloudFunction('sendD2DSMS', {
      knockId,
      templateKey
    });

    if (result.success) {
      showToast('Text sent to contact', 'ok');
      return { success: true };
    } else {
      showToast('Failed to send text. Please try again.', 'error');
      return { success: false };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // LOGGING & HISTORY
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Fetch email log from Firestore
   */
  async function getEmailLog(limit = 50) {
    if (!window.db || !window.query || !window.collection || !window.getDocs) {
      console.warn('Firestore not available');
      return [];
    }

    try {
      const q = window.query(
        window.collection(window.db, 'email_log'),
        window.orderBy('sentAt', 'desc'),
        window.limit(limit)
      );
      const snap = await window.getDocs(q);
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Failed to fetch email log:', error);
      return [];
    }
  }

  /**
   * Fetch SMS log from Firestore
   */
  async function getSMSLog(limit = 50) {
    if (!window.db || !window.query || !window.collection || !window.getDocs) {
      console.warn('Firestore not available');
      return [];
    }

    try {
      const q = window.query(
        window.collection(window.db, 'sms_log'),
        window.orderBy('sentAt', 'desc'),
        window.limit(limit)
      );
      const snap = await window.getDocs(q);
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (error) {
      console.error('Failed to fetch SMS log:', error);
      return [];
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SETTINGS UI
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Render communications settings panel
   */
  async function renderCommsSettings(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`Container ${containerId} not found`);
      return;
    }

    const emailLog = await getEmailLog(10);
    const smsLog = await getSMSLog(10);

    const emailCount = emailLog.length || 0;
    const smsCount = smsLog.length || 0;

    const html = `
      <div style="padding:20px;font-family:system-ui,sans-serif;">
        <h3 style="margin:0 0 20px 0;font-size:18px;color:var(--t);">📡 Communications Settings</h3>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:30px;">
          <!-- Email Status -->
          <div style="border:2px solid var(--br);border-radius:8px;padding:15px;background:var(--s2);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
              <span style="font-size:20px;">📧</span>
              <h4 style="margin:0;font-size:14px;font-weight:600;color:var(--t);">Email</h4>
            </div>
            <div style="font-size:12px;color:var(--m);margin-bottom:8px;">
              Status: <span style="color:var(--green);font-weight:600;">Active</span>
            </div>
            <div style="font-size:12px;color:var(--m);">
              Sent today: ${emailCount}
            </div>
            ${emailCount > 0 ? `
              <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--br);font-size:11px;">
                <div style="color:var(--m);margin-bottom:6px;font-weight:600;">Recent:</div>
                ${emailLog.slice(0, 3).map(e => `
                  <div style="margin-bottom:4px;color:var(--m);">
                    ✓ To ${e.to?.substring(0, 20)}...
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>

          <!-- SMS Status -->
          <div style="border:2px solid var(--br);border-radius:8px;padding:15px;background:var(--s2);">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
              <span style="font-size:20px;">💬</span>
              <h4 style="margin:0;font-size:14px;font-weight:600;color:var(--t);">SMS</h4>
            </div>
            <div style="font-size:12px;color:var(--m);margin-bottom:8px;">
              Status: <span style="color:var(--green);font-weight:600;">Active</span>
            </div>
            <div style="font-size:12px;color:var(--m);">
              Sent today: ${smsCount}
            </div>
            ${smsCount > 0 ? `
              <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--br);font-size:11px;">
                <div style="color:var(--m);margin-bottom:6px;font-weight:600;">Recent:</div>
                ${smsLog.slice(0, 3).map(s => `
                  <div style="margin-bottom:4px;color:var(--m);">
                    ✓ ${s.phone || 'Unknown'}
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        </div>

        <!-- Info Box -->
        <div style="background:#e3f2fd;border-left:4px solid #2196f3;padding:12px;border-radius:4px;font-size:12px;color:var(--t);">
          <strong>Cloud-Based Delivery:</strong> Emails and SMS are sent via secure Cloud Functions. If Cloud Functions are unavailable, messages fall back to native apps (mailto/sms links).
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PUBLIC API - Expose as window.NBDComms
  // ═══════════════════════════════════════════════════════════════════════

  window.NBDComms = {
    // Email operations
    sendEmail,
    sendEstimateEmail,
    sendTeamInvite,

    // SMS operations
    sendSMS,
    sendD2DSMS,

    // Logging
    getEmailLog,
    getSMSLog,

    // UI
    renderCommsSettings,

    // Utilities (exposed for testing)
    formatPhoneNumber,
    getAuthToken
  };

  console.log('✓ NBD Communications module loaded (email, SMS, team invites)');
})();
