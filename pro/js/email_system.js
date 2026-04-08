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
    <div class="modal-content" style="max-width:700px;width:95%;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;background:var(--s);border-radius:12px;">
      <div class="modal-header" style="padding:25px;background:linear-gradient(135deg, #C8541A 0%, #a64516 100%);color:white;">
        <h3 style="margin:0;font-size:22px;">📧 Send Email</h3>
        <button onclick="closeEmailModal()" style="position:absolute;top:20px;right:20px;background:none;border:none;color:white;font-size:28px;cursor:pointer;line-height:1;">&times;</button>
      </div>
      
      <div style="flex:1;overflow-y:auto;padding:25px;">
        <div style="margin-bottom:15px;">
          <label style="display:block;font-weight:600;margin-bottom:6px;">To:</label>
          <input type="email" id="emailTo" value="${to}" placeholder="customer@example.com"
                 style="width:100%;padding:10px;border:1px solid var(--br);border-radius:6px;font-size:14px;">
        </div>
        
        <div style="margin-bottom:15px;">
          <label style="display:block;font-weight:600;margin-bottom:6px;">Subject:</label>
          <input type="text" id="emailSubject" value="${subject}"
                 style="width:100%;padding:10px;border:1px solid var(--br);border-radius:6px;font-size:14px;">
        </div>
        
        <div style="margin-bottom:15px;">
          <label style="display:block;font-weight:600;margin-bottom:6px;">Message:</label>
          <textarea id="emailBody" rows="12"
                    style="width:100%;padding:10px;border:1px solid var(--br);border-radius:6px;font-size:14px;resize:vertical;">${body}</textarea>
        </div>
        
        ${attachmentName ? `
          <div style="background:#f0f9ff;border:2px solid #0ea5e9;border-radius:8px;padding:15px;margin-bottom:15px;">
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="font-size:32px;">📎</div>
              <div style="flex:1;">
                <div style="font-weight:600;color:var(--t);">${attachmentName}</div>
                <div style="font-size:12px;color:var(--m);">Attachment will be included</div>
              </div>
            </div>
          </div>
        ` : ''}
        
        <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:12px;border-radius:4px;font-size:13px;">
          <strong>Note:</strong> This will open your default email client with the message pre-filled. Click "Send Email" to continue.
        </div>
      </div>
      
      <div class="modal-footer" style="padding:20px;border-top:2px solid var(--br);background:var(--s2);display:flex;gap:10px;justify-content:flex-end;">
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
    if(typeof showToast==='function') showToast('Please fill in all fields','error'); else alert('Please fill in all fields');
    return;
  }

  // Validate email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(to)) {
    if(typeof showToast==='function') showToast('Please enter a valid email address','error'); else alert('Please enter a valid email address');
    return;
  }

  try {
    // If NBDComms is available, use Cloud Function to send
    if (window.NBDComms && typeof window.NBDComms.sendEmail === 'function') {
      const result = await window.NBDComms.sendEmail(to, subject, body, {
        leadId: window._emailLeadId,
        html: null
      });

      if (result.success) {
        closeEmailModal();
        return;
      }
      // If NBDComms fails, fall through to mailto fallback
    }

    // Fallback: Log and use mailto
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

    // If attachment exists, download it
    if (window._emailAttachment) {
      alert('⚠️ Email will open with message pre-filled.\n\nThe PDF has been downloaded to your computer.\nPlease attach it manually before sending.');
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
    if(typeof showToast==='function') showToast('Failed to send email. Please try again.','error'); else alert('Failed to send email. Please try again.');
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

// ═══════════════════════════════════════════════════════════════════════
// STAGE-AWARE EMAIL — Auto-selects the right template for the lead's stage
// ═══════════════════════════════════════════════════════════════════════

window.emailSystem.stageTemplates = {
  // ── Insurance pipeline ─────────────────────────────
  contacted: {
    subject: '🏠 Thank You for Choosing NBD Home Solutions',
    body: `Hi {customerName},

Thank you for speaking with me about the damage at {address}. I'm looking forward to helping you through this process.

Here's what happens next:
1. I'll schedule a free inspection of your property
2. We'll document the damage thoroughly
3. I'll walk you through your insurance options

I'll be in touch shortly to set up a convenient time.

Best regards,
Joe Deal
No Big Deal Home Solutions
(859) 420-7382`
  },

  inspected: {
    subject: '🔍 Inspection Complete — {address}',
    body: `Hi {customerName},

I've completed the inspection at {address}. Here's a summary of what I found:

{damageType} damage identified. Based on my assessment, I recommend filing a claim with your insurance company.

Next steps:
1. File the claim with {carrier} (I can assist with this)
2. Schedule the adjuster inspection
3. Review the scope and estimate

Please let me know if you'd like me to walk you through filing the claim, or if you've already started the process.

Joe Deal
No Big Deal Home Solutions
(859) 420-7382`
  },

  claim_filed: {
    subject: '📋 Claim Filed — Next Steps for {address}',
    body: `Hi {customerName},

Good news — the claim has been filed with {carrier}. Your claim number is: {claimNumber}

What happens next:
1. {carrier} will assign an adjuster
2. The adjuster will schedule an inspection (usually within 7-14 days)
3. I'll be present at the adjuster meeting to ensure nothing is missed

I'll keep you updated as things move forward. Don't hesitate to reach out with questions.

Joe Deal
No Big Deal Home Solutions
(859) 420-7382`
  },

  adjuster_meeting_scheduled: {
    subject: '📅 Adjuster Meeting Confirmed — {address}',
    body: `Hi {customerName},

The adjuster meeting has been scheduled for your property at {address}.

What to expect:
- The adjuster will inspect the damage (30-60 minutes)
- I'll be there to walk through the damage with the adjuster
- They'll document findings and take measurements

Please make sure someone is home to provide access if needed. I'll arrive a few minutes early.

If you need to reschedule, let me know ASAP so we can coordinate with the insurance company.

Joe Deal
No Big Deal Home Solutions
(859) 420-7382`
  },

  scope_received: {
    subject: '📄 Scope Received — Reviewing Your Claim',
    body: `Hi {customerName},

We've received the scope of work from {carrier} for your property at {address}.

I'm reviewing the scope now to make sure everything is included. If I find anything that was missed during the adjuster's inspection, I'll prepare a supplement request.

I'll be in touch soon with the details and next steps.

Joe Deal
No Big Deal Home Solutions
(859) 420-7382`
  },

  estimate_submitted: {
    subject: '💰 Estimate Submitted — {address}',
    body: `Hi {customerName},

I've submitted the estimate for your project at {address}. Here are the details:

Estimated Total: {estimateAmount}

The insurance company will review this against their scope. I'm watching for approval and will keep you posted.

If a supplement is needed, I'll handle the documentation and negotiation.

Joe Deal
No Big Deal Home Solutions
(859) 420-7382`
  },

  supplement_requested: {
    subject: '📝 Supplement Filed — Additional Work Needed',
    body: `Hi {customerName},

After reviewing the insurance scope for {address}, I've identified additional items that were missed. I've filed a supplement request with {carrier}.

This is normal — supplements ensure all damage is covered and the job is done right. I'll follow up with the adjuster and keep you updated on the approval.

Joe Deal
No Big Deal Home Solutions
(859) 420-7382`
  },

  contract_signed: {
    subject: '✍️ Contract Signed — Your Project is Scheduled!',
    body: `Hi {customerName},

Congratulations! Your project at {address} is officially moving forward.

Here's what happens next:
1. Permits (if required for your jurisdiction)
2. Materials ordered from our suppliers
3. Crew scheduling — I'll confirm the installation date with you

Estimated timeline: {scheduledDate}

Thank you for trusting No Big Deal Home Solutions. We're going to do a great job for you.

Joe Deal
No Big Deal Home Solutions
(859) 420-7382`
  },

  crew_scheduled: {
    subject: '👷 Crew Scheduled — Installation Date Confirmed',
    body: `Hi {customerName},

Your installation at {address} is scheduled!

Scheduled Date: {scheduledDate}
Crew: {crew}

What to expect on installation day:
- Crew arrives early morning (typically 7-8 AM)
- Work usually takes 1-2 days depending on scope
- We'll keep the area clean and professional throughout

Please make sure vehicles are moved from the driveway. If you have any concerns, let me know before installation day.

Joe Deal
No Big Deal Home Solutions
(859) 420-7382`
  },

  install_complete: {
    subject: '🎉 Installation Complete — {address}',
    body: `Hi {customerName},

Great news — your installation at {address} is complete!

Next steps:
1. Final photos have been taken for documentation
2. Your warranty information is being prepared
3. Final payment details will be sent shortly

I'll swing by for a final walkthrough to make sure everything looks perfect. Please let me know if you notice anything.

Joe Deal
No Big Deal Home Solutions
(859) 420-7382`
  },

  closed: {
    subject: '🏆 Project Complete — Thank You!',
    body: `Hi {customerName},

Your project at {address} is officially complete! Thank you for trusting No Big Deal Home Solutions.

Your warranty certificate is attached for your records. Please keep this in a safe place.

If you know anyone who needs roofing or home exterior work, we'd appreciate the referral. We offer a $200 referral bonus for every job that closes.

It was a pleasure working with you. Don't hesitate to reach out if you need anything in the future.

Best,
Joe Deal
No Big Deal Home Solutions
(859) 420-7382`
  },

  // ── Cash pipeline ──────────────────────────────────
  estimate_sent_cash: {
    subject: '💰 Your Estimate from NBD Home Solutions',
    body: `Hi {customerName},

Thank you for requesting an estimate for your project at {address}.

Your estimate total: {estimateAmount}

This includes all materials, labor, and our workmanship warranty. We offer Good, Better, and Best options to fit your budget.

I'd love to walk you through the options. When's a good time to chat?

Joe Deal
No Big Deal Home Solutions
(859) 420-7382`
  },

  // ── Finance pipeline ───────────────────────────────
  prequal_sent: {
    subject: '🏦 Financing Pre-Qualification — {address}',
    body: `Hi {customerName},

I've sent you a financing pre-qualification link through our partner. This is a soft pull only — it won't affect your credit score.

Click here to check your options: {preQualLink}

Multiple lenders compete for your approval, so you'll see the best rates available. Many of our customers qualify for 0% APR for 12-18 months.

Let me know if you have any questions about the financing options.

Joe Deal
No Big Deal Home Solutions
(859) 420-7382`
  }
};

/**
 * Smart email — auto-selects template based on lead's current stage
 */
window.emailByStage = async function(leadId) {
  const lead = await getLeadData(leadId);
  if (!lead) { if(typeof showToast==='function') showToast('Lead not found','error'); else alert('Lead not found'); return; }

  const stage = lead.stage || 'new';
  const customerName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Customer';
  const email = lead.email || '';

  // Find the right template
  const template = window.emailSystem.stageTemplates[stage];
  if (!template) {
    // Fallback to generic follow-up
    window.emailFollowUp(leadId);
    return;
  }

  // Populate template
  const data = {
    customerName,
    address: lead.address || 'your property',
    damageType: lead.damageType || 'storm/hail',
    carrier: lead.insCarrier || lead.insuranceCarrier || 'your insurance company',
    claimNumber: lead.claimNumber || '[pending]',
    estimateAmount: lead.estimateAmount ? '$' + parseFloat(lead.estimateAmount).toLocaleString() : '[pending]',
    scheduledDate: lead.scheduledDate || '[to be confirmed]',
    crew: lead.crew || 'our installation team',
    preQualLink: lead.preQualLink || '[link will be sent separately]',
  };

  let subject = template.subject;
  let body = template.body;
  Object.keys(data).forEach(key => {
    subject = subject.replace(new RegExp(`\\{${key}\\}`, 'g'), data[key]);
    body = body.replace(new RegExp(`\\{${key}\\}`, 'g'), data[key]);
  });

  window.openEmailModal({
    to: email,
    subject,
    body,
    leadId,
    context: `stage_${stage}`
  });
};

// ═══════════════════════════════════════════════════════════════════════
// EMAILJS INTEGRATION (optional — for real server-side sending)
// Configure in Firebase: users/{uid}/settings/emailjs
// ═══════════════════════════════════════════════════════════════════════

window.emailSystem.config = {
  provider: 'mailto', // 'mailto' | 'emailjs'
  emailjsServiceId: null,
  emailjsTemplateId: null,
  emailjsPublicKey: null,
};

/**
 * Load EmailJS config from Firestore (if configured)
 */
window.emailSystem.loadConfig = async function() {
  try {
    if (!window.db || !window._user) return;
    const configSnap = await window.getDoc(window.doc(window.db, 'users', window._user.uid, 'settings', 'emailjs'));
    if (configSnap.exists()) {
      const data = configSnap.data();
      if (data.serviceId && data.templateId && data.publicKey) {
        this.config.provider = 'emailjs';
        this.config.emailjsServiceId = data.serviceId;
        this.config.emailjsTemplateId = data.templateId;
        this.config.emailjsPublicKey = data.publicKey;
        console.log('✓ EmailJS configured — real email sending enabled');
      }
    }
  } catch (e) {
    console.warn('EmailJS config not found, using mailto fallback');
  }
};

/**
 * Send via EmailJS (when configured) or fall back to mailto
 */
window.emailSystem.send = async function(to, subject, body, options = {}) {
  if (this.config.provider === 'emailjs' && this.config.emailjsPublicKey) {
    try {
      // Load EmailJS SDK if not already loaded
      if (!window.emailjs) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
        document.head.appendChild(script);
        await new Promise(resolve => script.onload = resolve);
        window.emailjs.init(this.config.emailjsPublicKey);
      }

      await window.emailjs.send(this.config.emailjsServiceId, this.config.emailjsTemplateId, {
        to_email: to,
        subject: subject,
        message: body,
        from_name: 'Joe Deal — NBD Home Solutions',
        reply_to: 'jd@nobigdealwithjoedeal.com',
      });

      return { success: true, method: 'emailjs' };
    } catch (e) {
      console.error('EmailJS send failed, falling back to mailto:', e);
    }
  }

  // Fallback: mailto
  const mailtoLink = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailtoLink;
  return { success: true, method: 'mailto' };
};

console.log('✓ Email system loaded (with stage templates + EmailJS support)');
