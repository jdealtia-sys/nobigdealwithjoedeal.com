// ═══════════════════════════════════════════════════════════════════════
// EMAIL INTEGRATION SYSTEM - Send estimates, reports, and follow-ups
// ═══════════════════════════════════════════════════════════════════════

// Email service configuration (using EmailJS or similar)
// For now, we'll use mailto: links with pre-populated content
// In production, integrate with SendGrid, Mailgun, or AWS SES

window.emailSystem = {
  // Template library
  templates: {
    estimateReady: {
      subject: '📋 Your Estimate from No Big Deal Home Solutions',
      body: `Hi {customerName},

Thank you for choosing No Big Deal Home Solutions for your {damageType} project.

Your estimate is ready for review. Please see the attached PDF for full details.

Project: {projectName}
Total: {total}

We're committed to providing the highest quality work at fair prices. If you have any questions or would like to discuss the estimate, please don't hesitate to reach out.

Best regards,
Joe Deal
No Big Deal Home Solutions
(859) 420-7382
jd@nobigdealwithjoedeal.com`
    },
    
    photoReportReady: {
      subject: '📸 Property Photo Report - {address}',
      body: `Hi {customerName},

Attached is the comprehensive photo report for your property at {address}.

This report includes:
- {photoCount} high-resolution photos
- Detailed documentation of damage/conditions
- Professional annotations and notes

Please review and let me know if you need any additional documentation.

Best regards,
Joe Deal
No Big Deal Home Solutions
(859) 420-7382
jd@nobigdealwithjoedeal.com`
    },
    
    followUp: {
      subject: 'Following up on your estimate',
      body: `Hi {customerName},

I wanted to follow up on the estimate I sent for your {damageType} project at {address}.

Do you have any questions about the scope of work or pricing? I'm happy to walk through the details or make any adjustments needed.

Our schedule is filling up, so please let me know if you'd like to move forward.

Best regards,
Joe Deal
No Big Deal Home Solutions
(859) 420-7382
jd@nobigdealwithjoedeal.com`
    },
    
    inspectionScheduled: {
      subject: '🔍 Inspection Scheduled - {address}',
      body: `Hi {customerName},

This confirms your inspection appointment:

Date: {inspectionDate}
Time: {inspectionTime}
Location: {address}

I'll conduct a thorough assessment and provide recommendations. The inspection typically takes 30-45 minutes.

See you then!

Joe Deal
No Big Deal Home Solutions
(859) 420-7382
jd@nobigdealwithjoedeal.com`
    }
  },
  
  // Populate template with customer data
  populateTemplate(templateKey, data) {
    const template = this.templates[templateKey];
    if (!template) return null;
    
    let subject = template.subject;
    let body = template.body;
    
    // Replace placeholders
    Object.keys(data).forEach(key => {
      const value = data[key] || '';
      subject = subject.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
      body = body.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    });
    
    return { subject, body };
  }
};

// ═══════════════════════════════════════════════════════════════════════
// EMAIL MODAL - Compose and send emails
// ═══════════════════════════════════════════════════════════════════════

window.openEmailModal = function(options = {}) {
  const {
    to = '',
    subject = '',
    body = '',
    attachmentName = '',
    attachmentData = null, // PDF blob or data
    leadId = null,
    context = 'general' // 'estimate', 'photoReport', 'followUp'
  } = options;
  
  // Store attachment data globally for access
  window._emailAttachment = attachmentData;
  window._emailLeadId = leadId;
  window._emailContext = context;
  
  const modal = document.createElement('div');
  modal.id = 'emailModal';
  modal.className = 'modal';
  modal.style.cssText = 'display:flex;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;align-items:center;justify-content:center;';
  
  modal.innerHTML = `
    <div class="modal-content" style="max-width:700px;width:95%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;background:white;border-radius:12px;">
      <div class="modal-header" style="padding:25px;background:linear-gradient(135deg, #C8541A 0%, #a64516 100%);color:white;">
        <h3 style="margin:0;font-size:22px;">📧 Send Email</h3>
        <button onclick="closeEmailModal()" style="position:absolute;top:20px;right:20px;background:none;border:none;color:white;font-size:28px;cursor:pointer;line-height:1;">&times;</button>
      </div>
      
      <div style="flex:1;overflow-y:auto;padding:25px;">
        <div style="margin-bottom:15px;">
          <label style="display:block;font-weight:600;margin-bottom:6px;">To:</label>
          <input type="email" id="emailTo" value="${to}" placeholder="customer@example.com" 
                 style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
        </div>
        
        <div style="margin-bottom:15px;">
          <label style="display:block;font-weight:600;margin-bottom:6px;">Subject:</label>
          <input type="text" id="emailSubject" value="${subject}" 
                 style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;">
        </div>
        
        <div style="margin-bottom:15px;">
          <label style="display:block;font-weight:600;margin-bottom:6px;">Message:</label>
          <textarea id="emailBody" rows="12" 
                    style="width:100%;padding:10px;border:1px solid #ddd;border-radius:6px;font-size:14px;resize:vertical;">${body}</textarea>
        </div>
        
        ${attachmentName ? `
          <div style="background:#f0f9ff;border:2px solid #0ea5e9;border-radius:8px;padding:15px;margin-bottom:15px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="font-size:32px;">📎</div>
              <div style="flex:1;">
                <div style="font-weight:600;color:#0c4a6e;">${attachmentName}</div>
                <div style="font-size:12px;color:#666;">Attachment will be included</div>
              </div>
            </div>
          </div>
        ` : ''}
        
        <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:12px;border-radius:4px;font-size:13px;">
          <strong>Note:</strong> This will open your default email client with the message pre-filled. Click "Send Email" to continue.
        </div>
      </div>
      
      <div class="modal-footer" style="padding:20px;border-top:2px solid #eee;background:#f9f9f9;display:flex;gap:10px;justify-content:flex-end;">
        <button onclick="closeEmailModal()" class="btn" style="background:#6c757d;border-color:#6c757d;color:#fff;">
          Cancel
        </button>
        <button onclick="sendEmail()" class="btn btn-orange" style="display:flex;align-items:center;gap:8px;">
          <span>📧 Send Email</span>
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  document.getElementById('emailTo').focus();
};

window.closeEmailModal = function() {
  const modal = document.getElementById('emailModal');
  if (modal) modal.remove();
  window._emailAttachment = null;
  window._emailLeadId = null;
};

window.sendEmail = async function() {
  const to = document.getElementById('emailTo').value.trim();
  const subject = document.getElementById('emailSubject').value.trim();
  const body = document.getElementById('emailBody').value.trim();
  
  if (!to || !subject || !body) {
    alert('Please fill in all fields');
    return;
  }
  
  // Validate email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(to)) {
    alert('Please enter a valid email address');
    return;
  }
  
  try {
    // Log email to Firestore
    if (window._emailLeadId && window.db) {
      await window.addDoc(window.collection(window.db, 'emails'), {
        leadId: window._emailLeadId,
        to: to,
        subject: subject,
        body: body,
        context: window._emailContext || 'general',
        hasAttachment: !!window._emailAttachment,
        sentAt: window.serverTimestamp(),
        sentBy: window.auth?.currentUser?.email || 'Unknown'
      });
    }
    
    // If attachment exists, we need to handle it differently
    if (window._emailAttachment) {
      // For now, download the attachment and inform user to attach manually
      // In production, use SendGrid/Mailgun API
      alert('⚠️ Email will open with message pre-filled.\n\nThe PDF has been downloaded to your computer.\nPlease attach it manually before sending.');
      
      // Download attachment
      const link = document.createElement('a');
      link.href = URL.createObjectURL(window._emailAttachment);
      link.download = `attachment_${Date.now()}.pdf`;
      link.click();
      URL.revokeObjectURL(link.href);
    }
    
    // Open mailto link
    const mailtoLink = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailtoLink;
    
    // Close modal after short delay
    setTimeout(() => {
      closeEmailModal();
      
      // Show success message
      if (typeof showToast === 'function') {
        showToast('✅ Email client opened', 'success');
      }
    }, 500);
    
  } catch (error) {
    console.error('Email error:', error);
    alert('Failed to send email. Please try again.');
  }
};

// ═══════════════════════════════════════════════════════════════════════
// QUICK EMAIL FUNCTIONS - Trigger from various contexts
// ═══════════════════════════════════════════════════════════════════════

// Email estimate PDF
window.emailEstimatePDF = async function(estimateData, pdfBlob) {
  const lead = estimateData.customerId ? await getLeadData(estimateData.customerId) : null;
  
  const customerName = lead ? `${lead.firstName || ''} ${lead.lastName || ''}`.trim() : 'Customer';
  const email = lead?.email || '';
  
  const emailData = window.emailSystem.populateTemplate('estimateReady', {
    customerName: customerName,
    damageType: lead?.damageType || 'restoration',
    projectName: estimateData.projectName || 'Project',
    total: `$${(estimateData.total || 0).toLocaleString()}`
  });
  
  window.openEmailModal({
    to: email,
    subject: emailData.subject,
    body: emailData.body,
    attachmentName: `Estimate_${estimateData.projectName}.pdf`,
    attachmentData: pdfBlob,
    leadId: estimateData.customerId,
    context: 'estimate'
  });
};

// Email photo report
window.emailPhotoReport = async function(pdfBlob, leadId) {
  const lead = await getLeadData(leadId);
  
  const customerName = lead ? `${lead.firstName || ''} ${lead.lastName || ''}`.trim() : 'Customer';
  const email = lead?.email || '';
  const address = lead?.address || 'your property';
  const photoCount = window._customerPhotos?.length || 0;
  
  const emailData = window.emailSystem.populateTemplate('photoReportReady', {
    customerName: customerName,
    address: address,
    photoCount: photoCount
  });
  
  window.openEmailModal({
    to: email,
    subject: emailData.subject,
    body: emailData.body,
    attachmentName: `Photo_Report_${customerName}.pdf`,
    attachmentData: pdfBlob,
    leadId: leadId,
    context: 'photoReport'
  });
};

// Quick follow-up email
window.emailFollowUp = async function(leadId) {
  const lead = await getLeadData(leadId);
  
  const customerName = lead ? `${lead.firstName || ''} ${lead.lastName || ''}`.trim() : 'Customer';
  const email = lead?.email || '';
  
  const emailData = window.emailSystem.populateTemplate('followUp', {
    customerName: customerName,
    damageType: lead?.damageType || 'project',
    address: lead?.address || 'your property'
  });
  
  window.openEmailModal({
    to: email,
    subject: emailData.subject,
    body: emailData.body,
    leadId: leadId,
    context: 'followUp'
  });
};

// Helper: Get lead data from Firestore
async function getLeadData(leadId) {
  if (!leadId || !window.db) return null;
  
  try {
    const leadSnap = await window.getDoc(window.doc(window.db, 'leads', leadId));
    return leadSnap.exists() ? leadSnap.data() : null;
  } catch (error) {
    console.error('Error fetching lead:', error);
    return null;
  }
}

console.log('✓ Email system loaded');
