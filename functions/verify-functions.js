/**
 * NBD — Estimate Funnel Verification & Lead Notification Functions
 * ═══════════════════════════════════════════════════════════════════
 *
 * Functions for the multi-step estimate funnel:
 *   - sendVerificationCode (callable) — Twilio Verify OTP send
 *   - verifyCode (callable) — Twilio Verify OTP check
 *   - notifyNewLead (callable) — Email + SMS notification to Joe
 *
 * SETUP:
 *   1. Create a Twilio Verify Service in Twilio Console:
 *      Console → Verify → Services → Create new service
 *      Name: "NBD Estimate Verification"
 *   2. Set the secret:
 *      firebase functions:secrets:set TWILIO_VERIFY_SID
 *      (paste the Verify Service SID, starts with VA...)
 *   3. Deploy:
 *      firebase deploy --only functions
 *
 * IMPORTANT - Twilio A2P 10DLC Registration:
 *   For SMS to work reliably in the US, you need to register your
 *   Twilio phone number for A2P 10DLC messaging:
 *   1. Go to Twilio Console → Messaging → Compliance
 *   2. Register your business (Brand Registration)
 *   3. Create a Campaign (use "Mixed" or "Marketing" use case)
 *   4. Link your phone number to the Campaign
 *   This process takes 1-5 business days for approval.
 */
const { onCall } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const twilio = require('twilio');

// Secrets (some already defined in sms-functions.js — Firebase deduplicates)
const TWILIO_ACCOUNT_SID = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = defineSecret('TWILIO_PHONE_NUMBER');
const TWILIO_VERIFY_SID = defineSecret('TWILIO_VERIFY_SID');
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const EMAIL_FROM = defineSecret('EMAIL_FROM');

// Joe's contact info for notifications
const JOE_PHONE = '+18594207382';
const JOE_EMAIL = 'jonathandeal459@gmail.com';

/**
 * Format phone to E.164
 */
function formatPhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) return '+1' + cleaned;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return '+' + cleaned;
  if (phone.startsWith('+') && cleaned.length >= 10) return '+' + cleaned;
  return null;
}
/**
 * Rate limit check — prevents abuse of OTP sends
 * Max 3 OTP requests per phone per 10 minutes
 */
async function checkOTPRateLimit(db, phone) {
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000);
  const snap = await db.collection('otp_requests')
    .where('phone', '==', phone)
    .where('requestedAt', '>', tenMinAgo)
    .get();

  return snap.size < 3;
}

// ═══════════════════════════════════════════════════════════════════
// sendVerificationCode — Send OTP via Twilio Verify
// ═══════════════════════════════════════════════════════════════════

exports.sendVerificationCode = onCall(
  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SID],
    maxInstances: 10,
    timeoutSeconds: 15,
    memory: '256MiB',
    // No enforceAppCheck since homeowners aren't authenticated
  },
  async (request) => {
    const { phone } = request.data || {};
    if (!phone) {
      return { success: false, error: 'Phone number required' };
    }

    const formatted = formatPhone(phone);
    if (!formatted) {
      return { success: false, error: 'Invalid phone number format' };
    }

    try {
      const db = admin.firestore();

      // Rate limit check
      const allowed = await checkOTPRateLimit(db, formatted);
      if (!allowed) {
        return { success: false, error: 'Too many verification attempts. Please wait 10 minutes.' };
      }

      // Log the OTP request
      await db.collection('otp_requests').add({
        phone: formatted,
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        ip: request.rawRequest?.ip || 'unknown'
      });

      // Send verification via Twilio Verify
      const client = twilio(
        TWILIO_ACCOUNT_SID.value(),
        TWILIO_AUTH_TOKEN.value()
      );
      const verification = await client.verify.v2
        .services(TWILIO_VERIFY_SID.value())
        .verifications.create({
          to: formatted,
          channel: 'sms'
        });

      console.log(`OTP sent to ${formatted}, status: ${verification.status}`);

      return {
        success: true,
        status: verification.status
      };

    } catch (e) {
      console.error('Send OTP error:', e);
      return {
        success: false,
        error: 'Failed to send verification code. Please try again.'
      };
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// verifyCode — Check OTP via Twilio Verify
// ═══════════════════════════════════════════════════════════════════

exports.verifyCode = onCall(  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_VERIFY_SID],
    maxInstances: 10,
    timeoutSeconds: 15,
    memory: '256MiB',
  },
  async (request) => {
    const { phone, code } = request.data || {};

    if (!phone || !code) {
      return { success: false, error: 'Phone and code required' };
    }

    const formatted = formatPhone(phone);
    if (!formatted) {
      return { success: false, error: 'Invalid phone number' };
    }

    if (!/^\d{4,8}$/.test(code)) {
      return { success: false, error: 'Invalid code format' };
    }

    try {
      const client = twilio(
        TWILIO_ACCOUNT_SID.value(),
        TWILIO_AUTH_TOKEN.value()
      );
      const check = await client.verify.v2
        .services(TWILIO_VERIFY_SID.value())
        .verificationChecks.create({
          to: formatted,
          code: code
        });

      console.log(`OTP check for ${formatted}: ${check.status}`);

      if (check.status === 'approved') {
        // Log successful verification
        const db = admin.firestore();
        await db.collection('verified_phones').doc(formatted).set({
          verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          phone: formatted
        }, { merge: true });

        return { success: true, status: 'approved' };
      } else {
        return { success: false, error: 'Invalid code. Please try again.' };
      }

    } catch (e) {
      console.error('Verify OTP error:', e);

      // Twilio returns 404 if verification expired
      if (e.status === 404) {
        return { success: false, error: 'Code expired. Please request a new one.' };
      }
      return {
        success: false,
        error: 'Verification failed. Please try again.'
      };
    }
  }
);

// ═══════════════════════════════════════════════════════════════════
// notifyNewLead — Email + SMS to Joe when a new lead comes in
// ═══════════════════════════════════════════════════════════════════

exports.notifyNewLead = onCall(
  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, RESEND_API_KEY, EMAIL_FROM],
    maxInstances: 10,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request) => {
    const { name, phone, email, address, service, timeline, verified, requestType } = request.data || {};

    if (!name || !phone) {
      return { success: false, error: 'Name and phone required' };
    }

    const serviceLabels = {
      'roof-replacement': 'Roof Replacement',
      'roof-repair': 'Roof Repair',      'siding': 'Siding',
      'gutters': 'Gutters',
      'storm-damage': 'Storm Damage Inspection'
    };

    const timelineLabels = {
      'asap': '🔥 ASAP',
      '1-3months': '1-3 Months',
      'exploring': 'Just Exploring'
    };

    const serviceName = serviceLabels[service] || service || 'Unknown';
    const timelineName = timelineLabels[timeline] || timeline || 'Unknown';
    const verifiedBadge = verified ? '✅ VERIFIED' : '⚠️ Unverified';
    const urgencyFlag = timeline === 'asap' ? '🚨 URGENT — ' : '';
    const requestLabels = {
      'inspection': 'Wants Inspection',
      'call': 'Wants to Talk',
      'email-estimate': 'Email Estimate Only'
    };
    const requestLabel = requestLabels[requestType] || '';

    try {
      // ── SMS to Joe ──
      let smsBody = `${urgencyFlag}NEW LEAD 🏠\n` +
        `${name} — ${serviceName}\n` +
        `📞 ${phone} ${verifiedBadge}\n` +
        `📍 ${address || 'No address'}\n` +
        `⏱ ${timelineName}\n` +
        `📧 ${email || 'No email'}`;
        if (requestLabel) smsBody += `\n${requestLabel}`;

      const client = twilio(
        TWILIO_ACCOUNT_SID.value(),
        TWILIO_AUTH_TOKEN.value()
      );
      await client.messages.create({
        body: smsBody.substring(0, 1600),
        from: TWILIO_PHONE_NUMBER.value(),
        to: JOE_PHONE
      });

      console.log(`Lead notification SMS sent to Joe for: ${name}`);

      // ── Email to Joe ──
      const { Resend } = require('resend');
      const resend = new Resend(RESEND_API_KEY.value());
      const fromEmail = EMAIL_FROM.value() || 'noreply@nobigdealwithjoedeal.com';

      const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; padding: 20px; }
  .card { max-width: 500px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }
  .header { background: linear-gradient(135deg, #1e3a6e, #0c1e3a); color: white; padding: 24px; text-align: center; }
  .header h1 { margin: 0; font-size: 22px; }
  .content { padding: 24px; }
  .field { margin-bottom: 14px; }
  .field .label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #888; margin-bottom: 3px; }
  .field .value { font-size: 16px; font-weight: 600; color: #1e3a6e; }
  .badge { display: inline-block; padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 700; }  .badge.verified { background: #dcfce7; color: #16a34a; }
  .badge.unverified { background: #fef3c7; color: #d97706; }
  .badge.urgent { background: #fee2e2; color: #dc2626; }
  .cta { display: block; text-align: center; padding: 14px; background: #e8720c; color: white; text-decoration: none; font-weight: 700; border-radius: 8px; margin: 20px 24px 24px; font-size: 16px; }
  .footer { text-align: center; padding: 16px; font-size: 12px; color: #999; }
</style></head>
<body>
<div class="card">
  <div class="header">
    <h1>🏠 New Estimate Lead</h1>
  </div>
  <div class="content">
    ${timeline === 'asap' ? '<div style="margin-bottom:14px;"><span class="badge urgent">🚨 URGENT — ASAP Timeline</span></div>' : ''}
    <div class="field">
      <div class="label">Name</div>
      <div class="value">${name}</div>
    </div>
    <div class="field">
      <div class="label">Phone ${verified ? '<span class="badge verified">✅ Verified</span>' : '<span class="badge unverified">⚠️ Unverified</span>'}</div>
      <div class="value"><a href="tel:${phone.replace(/\\D/g, '')}" style="color:#e8720c;text-decoration:none;">${phone}</a></div>
    </div>
    <div class="field">
      <div class="label">Email</div>
      <div class="value"><a href="mailto:${email || ''}" style="color:#e8720c;text-decoration:none;">${email || 'Not provided'}</a></div>
    </div>
    <div class="field">
      <div class="label">Address</div>
      <div class="value">${address || 'Not provided'}</div>
    </div>    <div class="field">
      <div class="label">Service</div>
      <div class="value">${serviceName}</div>
    </div>
    <div class="field">
      <div class="label">Timeline</div>
      <div class="value">${timelineName}</div>
    </div>
    ${requestLabel ? `<div class="field">
      <div class="label">Request Type</div>
      <div class="value">${requestLabel}</div>
    </div>` : ''}
  </div>
  <a href="tel:${phone.replace(/\\D/g, '')}" class="cta">📞 Call ${name.split(' ')[0]} Now</a>
  <div class="footer">Lead from nobigdealwithjoedeal.com/estimate</div>
</div>
</body>
</html>`;

      await resend.emails.send({
        from: fromEmail,
        to: JOE_EMAIL,
        subject: `${urgencyFlag}New Lead: ${name} — ${serviceName}`,
        html: emailHtml
      });

      console.log(`Lead notification email sent to Joe for: ${name}`);

      return { success: true };

    } catch (e) {
      console.error('Lead notification error:', e);
      // Don't fail the estimate — notification is non-critical
      return { success: false, error: 'Notification delivery issue' };
    }
  }
);

console.log('✅ Verify & Lead Notification Functions loaded');