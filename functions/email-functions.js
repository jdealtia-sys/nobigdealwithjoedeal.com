/**
 * NBD Pro — Email Cloud Functions
 * ═══════════════════════════════════════════════════════════════
 *
 * Email sending via Resend provider
 * Functions:
 *   - sendEmail (HTTP)
 *   - sendEstimateEmail (HTTP)
 *   - sendDripEmail (callable)
 *   - sendTeamInviteEmail (HTTP)
 */

const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { Resend } = require('resend');
const { enforceRateLimit, httpRateLimit } = require('./rate-limit');

// Secrets
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const EMAIL_FROM = defineSecret('EMAIL_FROM');

// CORS origins
const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];

// ═══════════════════════════════════════════════════════════════
// EMAIL TEMPLATES — Branded HTML emails
// ═══════════════════════════════════════════════════════════════

const TEMPLATE_STYLES = `
  body {
    font-family: 'Barlow', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    line-height: 1.6;
    color: #333;
    background-color: #f5f5f5;
  }
  .container {
    max-width: 600px;
    margin: 0 auto;
    background-color: #ffffff;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  }
  .header {
    background: linear-gradient(135deg, #C8541A 0%, #a64516 100%);
    color: white;
    padding: 30px 20px;
    text-align: center;
  }
  .header h1 {
    margin: 0;
    font-size: 28px;
    font-weight: 600;
  }
  .content {
    padding: 30px 20px;
    color: #333;
  }
  .content h2 {
    color: #1e3a6e;
    margin-top: 0;
    margin-bottom: 15px;
    font-size: 20px;
  }
  .footer {
    background-color: #1e3a6e;
    color: white;
    padding: 20px;
    text-align: center;
    font-size: 12px;
  }
  .footer a {
    color: #C8541A;
    text-decoration: none;
  }
  .cta-button {
    display: inline-block;
    background-color: #C8541A;
    color: white;
    padding: 12px 30px;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
    margin: 20px 0;
  }
  .cta-button:hover {
    background-color: #a64516;
  }
`;

const BRANDED_EMAIL_TEMPLATE = (subject, content) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${TEMPLATE_STYLES}</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>No Big Deal Home Solutions</h1>
    </div>
    <div class="content">
      ${content}
    </div>
    <div class="footer">
      <p>No Big Deal Home Solutions | (859) 420-7382 | jd@nobigdealwithjoedeal.com</p>
      <p><a href="https://nobigdealwithjoedeal.com">Visit our website</a></p>
    </div>
  </div>
</body>
</html>
`;

const DRY_TEMPLATES = {
  welcome: {
    subject: 'Welcome to No Big Deal Pro!',
    html: BRANDED_EMAIL_TEMPLATE(
      'Welcome',
      `<h2>Welcome to NBD Pro!</h2>
       <p>Hi {firstName},</p>
       <p>You're all set to start managing your roofing pipeline. Here's what you can do:</p>
       <ul>
         <li>Track leads and appointments</li>
         <li>Generate professional estimates</li>
         <li>Log door-to-door activity</li>
         <li>Manage claims and insurance</li>
       </ul>
       <p><a href="https://nobigdeal-pro.web.app/pro/dashboard" class="cta-button">Go to Dashboard</a></p>
       <p>If you have any questions, reply to this email or call us at (859) 420-7382.</p>`
    )
  },
  inspectionScheduled: {
    subject: 'Inspection Scheduled — {address}',
    html: BRANDED_EMAIL_TEMPLATE(
      'Inspection Scheduled',
      `<h2>Inspection Confirmed</h2>
       <p>Hi {customerName},</p>
       <p>This confirms your inspection appointment:</p>
       <p><strong>Date:</strong> {inspectionDate}<br>
          <strong>Time:</strong> {inspectionTime}<br>
          <strong>Location:</strong> {address}</p>
       <p>I'll conduct a thorough assessment and provide recommendations. The inspection typically takes 30-45 minutes.</p>
       <p>See you then!</p>
       <p>Joe Deal<br>No Big Deal Home Solutions</p>`
    )
  },
  claimFiled: {
    subject: 'Claim Filed — Next Steps',
    html: BRANDED_EMAIL_TEMPLATE(
      'Claim Filed',
      `<h2>Claim Has Been Filed</h2>
       <p>Hi {customerName},</p>
       <p>Good news — the claim has been filed with {carrier}. Your claim number is: <strong>{claimNumber}</strong></p>
       <p><strong>What happens next:</strong></p>
       <ol>
         <li>{carrier} will assign an adjuster</li>
         <li>The adjuster will schedule an inspection (usually within 7-14 days)</li>
         <li>I'll be present at the adjuster meeting to ensure nothing is missed</li>
       </ol>
       <p>I'll keep you updated as things move forward. Don't hesitate to reach out with questions.</p>`
    )
  },
  approved: {
    subject: 'Estimate Approved — Let\'s Move Forward!',
    html: BRANDED_EMAIL_TEMPLATE(
      'Estimate Approved',
      `<h2>Great News!</h2>
       <p>Hi {customerName},</p>
       <p>Your estimate has been approved by {carrier}. Total: <strong>{estimateAmount}</strong></p>
       <p>Next steps:</p>
       <ol>
         <li>Sign the contract</li>
         <li>Schedule installation</li>
         <li>Prepare your property</li>
       </ol>
       <p>Let's get your project completed and get you back to normal!</p>`
    )
  },
  installScheduled: {
    subject: 'Installation Scheduled — {address}',
    html: BRANDED_EMAIL_TEMPLATE(
      'Installation Scheduled',
      `<h2>Your Installation is Scheduled!</h2>
       <p>Hi {customerName},</p>
       <p><strong>Installation Date:</strong> {scheduledDate}<br>
          <strong>Crew Lead:</strong> {crew}<br>
          <strong>Location:</strong> {address}</p>
       <p><strong>What to expect:</strong></p>
       <ul>
         <li>Crew arrives early morning (typically 7-8 AM)</li>
         <li>Work usually takes 1-2 days depending on scope</li>
         <li>We'll keep the area clean and professional throughout</li>
       </ul>
       <p>Please make sure vehicles are moved from the driveway. If you have any concerns, let me know before installation day.</p>`
    )
  },
  followUpGeneric: {
    subject: 'Following Up on Your Project',
    html: BRANDED_EMAIL_TEMPLATE(
      'Follow-Up',
      `<h2>Checking In</h2>
       <p>Hi {customerName},</p>
       <p>I wanted to follow up on the project at {address}.</p>
       <p>Do you have any questions or need any updates? I'm happy to help!</p>
       <p>Feel free to reach out anytime at (859) 420-7382.</p>`
    )
  },
  reviewRequest: {
    subject: 'We\'d Love Your Feedback!',
    html: BRANDED_EMAIL_TEMPLATE(
      'Leave a Review',
      `<h2>Please Share Your Experience</h2>
       <p>Hi {customerName},</p>
       <p>Thank you for choosing No Big Deal Home Solutions for your project at {address}. We'd love to hear about your experience!</p>
       <p><a href="https://google.com/maps/search/No+Big+Deal+Home+Solutions" class="cta-button">Leave a Review</a></p>
       <p>Your feedback helps us serve you and others better.</p>`
    )
  },
  referralCode: {
    subject: 'Your Referral Code — Earn $200!',
    html: BRANDED_EMAIL_TEMPLATE(
      'Refer & Earn',
      `<h2>Share No Big Deal & Get Rewarded</h2>
       <p>Hi {customerName},</p>
       <p>We appreciate your business! Want to earn $200?</p>
       <p><strong>Your referral code:</strong> <code style="background:#f0f0f0;padding:8px 12px;border-radius:4px;">{referralCode}</code></p>
       <p>Share this code with friends and family. For every job that closes, you'll receive a $200 bonus!</p>
       <p>Thank you for recommending us!</p>`
    )
  }
};

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Validate email address format
 */
function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}

/**
 * Populate template with variables
 */
function populateTemplate(template, variables) {
  let html = template.html;
  Object.keys(variables).forEach(key => {
    const value = variables[key] || '';
    html = html.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  });
  return html;
}

/**
 * Log email to Firestore
 */
async function logEmailToFirestore(db, to, subject, uid, status = 'sent') {
  try {
    await db.collection('email_log').add({
      to,
      subject,
      uid,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      status
    });
  } catch (e) {
    logger.warn('email_log_write_failed', { err: e.message });
  }
}

/**
 * Verify Firebase ID token
 */
async function verifyAuth(req) {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!idToken) return null;

  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (e) {
    logger.warn('email_auth_verify_failed', { err: e.message });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// CLOUD FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * sendEmail — HTTP function (POST, authenticated)
 * Sends a generic email via Resend
 */
exports.sendEmail = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [RESEND_API_KEY, EMAIL_FROM],
    enforceAppCheck: true,
    maxInstances: 20,
    concurrency: 40,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    if (!(await httpRateLimit(req, res, 'sendEmail:ip', 60, 3_600_000))) return;

    // Verify Firebase auth
    const decoded = await verifyAuth(req);
    if (!decoded) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      await enforceRateLimit('sendEmail:uid', decoded.uid, 200, 86_400_000);
    } catch (e) {
      if (e.rateLimited) { res.status(429).json({ error: 'Daily email limit exceeded' }); return; }
      throw e;
    }

    const { to, subject, body, html, replyTo, attachments } = req.body;

    // Validate input
    if (!to || !isValidEmail(to)) {
      res.status(400).json({ error: 'Invalid recipient email' });
      return;
    }

    if (!subject || subject.trim().length === 0) {
      res.status(400).json({ error: 'Subject cannot be empty' });
      return;
    }

    if (!body && !html) {
      res.status(400).json({ error: 'Body or HTML required' });
      return;
    }

    try {
      const resend = new Resend(RESEND_API_KEY.value());
      const fromEmail = EMAIL_FROM.value() || 'noreply@nobigdealwithjoedeal.com';

      const response = await resend.emails.send({
        from: fromEmail,
        to,
        subject,
        html: html || `<p>${body}</p>`,
        reply_to: replyTo,
        attachments: attachments || []
      });

      // Log to Firestore
      const db = admin.firestore();
      await logEmailToFirestore(db, to, subject, decoded.uid, 'sent');

      res.json({
        success: true,
        id: response.data?.id || response.id
      });

    } catch (e) {
      logger.error('sendEmail error', { err: e.message });

      // Log failure
      const db = admin.firestore();
      await logEmailToFirestore(db, to, subject, decoded.uid, 'failed');

      res.status(500).json({
        error: 'Failed to send email',
        details: e.message
      });
    }
  }
);

/**
 * sendEstimateEmail — HTTP function (POST, authenticated)
 * Sends an estimate email with branded template
 */
exports.sendEstimateEmail = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [RESEND_API_KEY, EMAIL_FROM],
    enforceAppCheck: true,
    maxInstances: 20,
    concurrency: 40,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    if (!(await httpRateLimit(req, res, 'sendEstimateEmail:ip', 60, 3_600_000))) return;

    // Verify Firebase auth
    const decoded = await verifyAuth(req);
    if (!decoded) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { leadId, estimateHtml, subject } = req.body;

    if (!leadId || !estimateHtml) {
      res.status(400).json({ error: 'leadId and estimateHtml required' });
      return;
    }

    try {
      const db = admin.firestore();

      // Look up lead
      const leadSnap = await db.doc(`leads/${leadId}`).get();
      if (!leadSnap.exists()) {
        res.status(404).json({ error: 'Lead not found' });
        return;
      }

      const lead = leadSnap.data();
      const to = lead.email;
      const customerName = `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Customer';

      if (!to || !isValidEmail(to)) {
        res.status(400).json({ error: 'Lead email is invalid' });
        return;
      }

      // Wrap estimate HTML in branded template
      const html = BRANDED_EMAIL_TEMPLATE(
        subject,
        `<h2>Estimate for ${lead.address || 'Your Property'}</h2>
         <p>Hi ${customerName},</p>
         <p>Your estimate is ready for review. Please see the details below:</p>
         ${estimateHtml}
         <p>If you have any questions, please reach out!</p>`
      );

      // Send via Resend
      const resend = new Resend(RESEND_API_KEY.value());
      const fromEmail = EMAIL_FROM.value() || 'noreply@nobigdealwithjoedeal.com';

      const response = await resend.emails.send({
        from: fromEmail,
        to,
        subject: subject || `Estimate for ${lead.address || 'Your Property'}`,
        html
      });

      // Update lead with lastEmailSent
      await db.doc(`leads/${leadId}`).update({
        lastEmailSent: admin.firestore.FieldValue.serverTimestamp()
      });

      // Log to Firestore
      await logEmailToFirestore(db, to, subject || 'Estimate', decoded.uid, 'sent');

      res.json({
        success: true,
        id: response.data?.id || response.id
      });

    } catch (e) {
      logger.error('sendEstimateEmail error', { err: e.message });
      res.status(500).json({
        error: 'Failed to send estimate email',
        details: e.message
      });
    }
  }
);

/**
 * sendDripEmail — Callable function (not HTTP)
 * Internal helper for drip campaign automation
 */
exports.sendDripEmail = onCall(
  {
    secrets: [RESEND_API_KEY, EMAIL_FROM],
    enforceAppCheck: true,
    maxInstances: 20,
    concurrency: 20,
  },
  async (request) => {
    const { to, templateId, variables } = request.data || {};

    // Verify auth (user calling this function)
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Unauthorized');
    }
    // Per-uid daily drip cap.
    try {
      await enforceRateLimit('sendDripEmail:uid', request.auth.uid, 500, 86_400_000);
    } catch (e) {
      if (e.rateLimited) throw new HttpsError('resource-exhausted', 'Daily drip limit exceeded');
      throw e;
    }

    if (!to || !isValidEmail(to)) {
      throw new HttpsError('invalid-argument', 'Invalid recipient email');
    }

    if (!templateId || !DRY_TEMPLATES[templateId]) {
      throw new Error('Invalid template ID');
    }

    try {
      const template = DRY_TEMPLATES[templateId];
      const html = populateTemplate(template, variables || {});

      const resend = new Resend(RESEND_API_KEY.value());
      const fromEmail = EMAIL_FROM.value() || 'noreply@nobigdealwithjoedeal.com';

      const response = await resend.emails.send({
        from: fromEmail,
        to,
        subject: template.subject,
        html
      });

      // Log to Firestore — owner is ALWAYS the authenticated caller.
      const db = admin.firestore();
      await logEmailToFirestore(db, to, template.subject, request.auth.uid, 'sent');

      return {
        success: true,
        id: response.data?.id || response.id
      };

    } catch (e) {
      logger.error('sendDripEmail error', { uid: request.auth?.uid, err: e.message });
      throw new HttpsError('internal', 'Failed to send drip email');
    }
  }
);

/**
 * sendTeamInviteEmail — HTTP function (POST, authenticated)
 * Sends a team invitation email with a unique invite link
 */
exports.sendTeamInviteEmail = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [RESEND_API_KEY, EMAIL_FROM],
    enforceAppCheck: true,
    maxInstances: 10,
    concurrency: 20,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    if (!(await httpRateLimit(req, res, 'sendTeamInviteEmail:ip', 20, 3_600_000))) return;

    // Verify Firebase auth
    const decoded = await verifyAuth(req);
    if (!decoded) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { email, role, inviterName } = req.body;

    if (!email || !isValidEmail(email)) {
      res.status(400).json({ error: 'Invalid email address' });
      return;
    }

    if (!role || !['admin', 'rep', 'crew'].includes(role)) {
      res.status(400).json({ error: 'Invalid role' });
      return;
    }

    try {
      const db = admin.firestore();

      // Generate invite token
      const token = require('crypto').randomBytes(32).toString('hex');
      const inviteRef = db.collection('invites').doc(token);

      await inviteRef.set({
        email,
        role,
        inviterUid: decoded.uid,
        inviterName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt: admin.firestore.Timestamp.fromDate(
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        ),
        used: false
      });

      // Send invite email
      const inviteUrl = `https://nobigdeal-pro.web.app/pro/register.html?invite=${token}&role=${role}`;

      const html = BRANDED_EMAIL_TEMPLATE(
        'Team Invitation',
        `<h2>You're Invited to Join NBD Pro!</h2>
         <p>Hi,</p>
         <p>${inviterName} has invited you to join their No Big Deal Home Solutions team as a <strong>${role}</strong>.</p>
         <p><a href="${inviteUrl}" class="cta-button">Accept Invitation</a></p>
         <p>This invitation will expire in 7 days.</p>
         <p>If you have any questions, contact ${inviterName} or our support team.</p>`
      );

      const resend = new Resend(RESEND_API_KEY.value());
      const fromEmail = EMAIL_FROM.value() || 'noreply@nobigdealwithjoedeal.com';

      const response = await resend.emails.send({
        from: fromEmail,
        to: email,
        subject: `${inviterName} Invited You to NBD Pro`,
        html
      });

      // Log to Firestore
      await logEmailToFirestore(db, email, 'Team Invite', decoded.uid, 'sent');

      res.json({
        success: true,
        id: response.data?.id || response.id,
        token
      });

    } catch (e) {
      logger.error('sendTeamInviteEmail error', { err: e.message });
      res.status(500).json({
        error: 'Failed to send team invite',
        details: e.message
      });
    }
  }
);

logger.info('email_functions_loaded');
