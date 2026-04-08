/**
 * NBD Pro — SMS Cloud Functions
 * ═══════════════════════════════════════════════════════════════
 *
 * SMS sending via Twilio
 * Webhook handling for incoming SMS replies
 *
 * Functions:
 *   - sendSMS (HTTP)
 *   - sendD2DSMS (HTTP)
 *   - incomingSMS (HTTP webhook — no auth)
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const twilio = require('twilio');

// Secrets
const TWILIO_ACCOUNT_SID = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = defineSecret('TWILIO_PHONE_NUMBER');

// CORS origins
const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
  'http://localhost:5000'
];

// ═══════════════════════════════════════════════════════════════
// SMS TEMPLATES
// ═══════════════════════════════════════════════════════════════

const D2D_SMS_TEMPLATES = {
  interested: {
    label: 'Thanks for Chatting',
    body: 'Hey {name}! This is {rep} from NBD Home Solutions. Great chatting today — I\'d love to take a closer look at your roof. Let me know a good time!'
  },
  appointment: {
    label: 'Appointment Confirmation',
    body: 'Hi {name}! {rep} from NBD confirming our upcoming roof inspection on {appointmentDate} at {appointmentTime}. Looking forward to it!'
  },
  storm_damage: {
    label: 'Storm Damage Alert',
    body: 'Hi {name}, {rep} from NBD. I noticed some storm damage on your roof today. I offer free inspections — would you like me to come take a closer look?'
  },
  ins_has_claim: {
    label: 'Insurance Claim Alert',
    body: 'Hi {name}! {rep} from NBD. I see your roof has damage that your insurance should cover. We help with the claims process at no cost to you. Want to talk?'
  },
  follow_up: {
    label: 'Follow-Up',
    body: 'Hi {name}! Just following up from our conversation last time. Still interested in getting that roof inspected? Give me a call or text back!'
  },
  not_home: {
    label: 'Not Home Follow-Up',
    body: 'Hi {name}! I stopped by but didn\'t catch you home. Would love to chat about your roof. Free inspection — no pressure. Hit me back!'
  }
};

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Validate US phone number format
 */
function isValidPhoneNumber(phone) {
  // Basic validation: 10 digits (US)
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.length === 10 || cleaned.length === 11;
}

/**
 * Format phone number to E.164 format for Twilio
 */
function formatPhoneNumber(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  } else if (cleaned.length === 11) {
    return `+1${cleaned}`;
  }
  return null;
}

/**
 * Log SMS to Firestore
 */
async function logSMSToFirestore(db, to, body, uid, leadId = null, status = 'sent', twilioSid = null) {
  try {
    await db.collection('sms_log').add({
      to,
      body,
      uid,
      leadId: leadId || null,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      status,
      twilioSid: twilioSid || null
    });
  } catch (e) {
    console.warn('Failed to log SMS:', e);
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
    console.error('Auth verification failed:', e);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// CLOUD FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * sendSMS — HTTP function (POST, authenticated)
 * Sends an SMS message to a phone number
 */
exports.sendSMS = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER],
    maxInstances: 10,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Verify Firebase auth
    const decoded = await verifyAuth(req);
    if (!decoded) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { to, body, leadId } = req.body;

    // Validate input
    if (!to || !isValidPhoneNumber(to)) {
      res.status(400).json({ error: 'Invalid phone number format' });
      return;
    }

    if (!body || body.trim().length === 0) {
      res.status(400).json({ error: 'Body cannot be empty' });
      return;
    }

    if (body.length > 1600) {
      res.status(400).json({ error: 'Message too long (max 1600 characters)' });
      return;
    }

    try {
      // Initialize Twilio client
      const client = twilio(
        TWILIO_ACCOUNT_SID.value(),
        TWILIO_AUTH_TOKEN.value()
      );

      const formattedTo = formatPhoneNumber(to);
      const fromPhone = TWILIO_PHONE_NUMBER.value();

      if (!formattedTo) {
        res.status(400).json({ error: 'Could not format phone number' });
        return;
      }

      // Send SMS
      const message = await client.messages.create({
        body,
        from: fromPhone,
        to: formattedTo
      });

      // Log to Firestore
      const db = admin.firestore();
      await logSMSToFirestore(db, to, body, decoded.uid, leadId || null, 'sent', message.sid);

      res.json({
        success: true,
        sid: message.sid
      });

    } catch (e) {
      console.error('SMS send error:', e);

      // Log failure
      const db = admin.firestore();
      await logSMSToFirestore(db, to, body, decoded.uid, leadId || null, 'failed');

      res.status(500).json({
        error: 'Failed to send SMS',
        details: e.message
      });
    }
  }
);

/**
 * sendD2DSMS — HTTP function (POST, authenticated)
 * Sends a D2D-specific SMS using predefined templates
 */
exports.sendD2DSMS = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER],
    maxInstances: 10,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Verify Firebase auth
    const decoded = await verifyAuth(req);
    if (!decoded) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { knockId, templateKey } = req.body;

    if (!knockId || !templateKey) {
      res.status(400).json({ error: 'knockId and templateKey required' });
      return;
    }

    if (!D2D_SMS_TEMPLATES[templateKey]) {
      res.status(400).json({
        error: 'Invalid template key',
        validKeys: Object.keys(D2D_SMS_TEMPLATES)
      });
      return;
    }

    try {
      const db = admin.firestore();

      // Look up knock
      const knockSnap = await db.doc(`d2d_knocks/${knockId}`).get();
      if (!knockSnap.exists()) {
        res.status(404).json({ error: 'Knock not found' });
        return;
      }

      const knock = knockSnap.data();
      const phoneNumber = knock.phone || knock.phoneNumber;

      if (!phoneNumber || !isValidPhoneNumber(phoneNumber)) {
        res.status(400).json({ error: 'Knock has invalid phone number' });
        return;
      }

      // Get template
      const template = D2D_SMS_TEMPLATES[templateKey];

      // Populate template variables
      let body = template.body;
      const variables = {
        name: knock.firstName || knock.name || 'there',
        rep: knock.repName || 'Joe',
        appointmentDate: knock.appointmentDate || '[TBD]',
        appointmentTime: knock.appointmentTime || '[TBD]'
      };

      Object.keys(variables).forEach(key => {
        body = body.replace(new RegExp(`\\{${key}\\}`, 'g'), variables[key]);
      });

      if (body.length > 1600) {
        res.status(400).json({ error: 'Generated message too long' });
        return;
      }

      // Initialize Twilio client
      const client = twilio(
        TWILIO_ACCOUNT_SID.value(),
        TWILIO_AUTH_TOKEN.value()
      );

      const formattedTo = formatPhoneNumber(phoneNumber);
      const fromPhone = TWILIO_PHONE_NUMBER.value();

      if (!formattedTo) {
        res.status(400).json({ error: 'Could not format phone number' });
        return;
      }

      // Send SMS
      const message = await client.messages.create({
        body,
        from: fromPhone,
        to: formattedTo
      });

      // Update knock with lastSmsSent
      await db.doc(`d2d_knocks/${knockId}`).update({
        lastSmsSent: admin.firestore.FieldValue.serverTimestamp()
      });

      // Log to Firestore
      await logSMSToFirestore(db, phoneNumber, body, decoded.uid, knockId, 'sent', message.sid);

      res.json({
        success: true,
        sid: message.sid
      });

    } catch (e) {
      console.error('D2D SMS error:', e);
      res.status(500).json({
        error: 'Failed to send D2D SMS',
        details: e.message
      });
    }
  }
);

/**
 * incomingSMS — HTTP function (POST, no auth)
 * Webhook for Twilio incoming SMS messages
 * Verifies Twilio signature instead of Firebase auth
 */
exports.incomingSMS = onRequest(
  {
    cors: false, // Webhooks don't use CORS
    secrets: [TWILIO_AUTH_TOKEN],
    maxInstances: 10,
    timeoutSeconds: 30,
    memory: '256MiB'
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      // Verify Twilio signature
      const twilioSignature = req.headers['x-twilio-signature'] || '';
      const authToken = TWILIO_AUTH_TOKEN.value();

      // Construct the signed URL for verification
      const url = `https://${req.get('host')}${req.originalUrl}`;

      const params = new URLSearchParams();
      if (req.body && typeof req.body === 'object') {
        Object.keys(req.body).forEach(key => {
          params.append(key, req.body[key]);
        });
      }

      // Verify signature (Twilio utility)
      const isValid = twilio.webhook(authToken, twilioSignature, url, params.toString());

      if (!isValid) {
        console.warn('Twilio webhook signature verification failed');
        res.status(403).json({ error: 'Webhook signature verification failed' });
        return;
      }

      // Parse incoming message
      const {
        From: fromPhone,
        Body: messageBody,
        MessageSid: messageSid
      } = req.body;

      if (!fromPhone || !messageBody) {
        res.status(400).json({ error: 'Missing From or Body' });
        return;
      }

      const db = admin.firestore();

      // Match phone number to a lead in Firestore
      const leadsSnap = await db
        .collection('leads')
        .where('phone', '==', fromPhone)
        .limit(1)
        .get();

      let leadId = null;
      if (!leadsSnap.empty) {
        leadId = leadsSnap.docs[0].id;

        // Create a note on the lead with the incoming SMS
        await db.collection('leads').doc(leadId).collection('notes').add({
          type: 'sms',
          direction: 'incoming',
          from: fromPhone,
          body: messageBody,
          twilioSid: messageSid,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Update lead's lastContactedAt
        await db.doc(`leads/${leadId}`).update({
          lastContactedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Send push notification to the assigned rep
        const lead = leadsSnap.docs[0].data();
        if (lead.assignedTo) {
          // Get rep's FCM token
          const repTokensSnap = await db
            .collection('users')
            .doc(lead.assignedTo)
            .collection('fcmTokens')
            .limit(1)
            .get();

          if (!repTokensSnap.empty) {
            const tokenDoc = repTokensSnap.docs[0];
            const token = tokenDoc.data().token;

            try {
              await admin.messaging().send({
                token,
                notification: {
                  title: `New Message from ${lead.firstName || 'Customer'}`,
                  body: messageBody.substring(0, 100)
                },
                data: {
                  leadId,
                  type: 'incoming_sms',
                  from: fromPhone
                }
              });
            } catch (e) {
              console.warn('Failed to send push notification:', e);
            }
          }
        }
      } else {
        // Phone number not found — log for admin review
        await db.collection('unmatched_sms').add({
          from: fromPhone,
          body: messageBody,
          twilioSid: messageSid,
          receivedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      }

      // Log SMS
      await logSMSToFirestore(db, fromPhone, messageBody, null, leadId, 'received', messageSid);

      // Return TwiML response (empty OK)
      res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
</Response>`);

    } catch (e) {
      console.error('Incoming SMS webhook error:', e);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

console.log('✓ SMS Cloud Functions loaded');
