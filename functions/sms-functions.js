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
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const twilio = require('twilio');
// C4: use the Upstash-first rate-limit adapter so busy SMS windows
// don't hammer the shared Firestore rate_limits doc. Falls back to
// the Firestore limiter when Upstash isn't configured.
const { enforceRateLimit, httpRateLimit, clientIp } = require('./integrations/upstash-ratelimit');

// Minimal HTML escaper for values we store from untrusted SMS webhooks.
function escForStore(s) {
  return String(s == null ? '' : s)
    .replace(/[<>]/g, ch => ({ '<':'&lt;','>':'&gt;' }[ch]))
    .slice(0, 4000);
}

// Secrets
const TWILIO_ACCOUNT_SID = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = defineSecret('TWILIO_PHONE_NUMBER');

// CORS origins
const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
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
 * Validate US/Canada phone number format. We explicitly REJECT international
 * numbers — international SMS is a toll-fraud ("SMS pumping") target.
 */
function isValidPhoneNumber(phone) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  if (cleaned.length === 10) return true;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return true;
  return false;
}

/**
 * Format phone number to E.164 — US/Canada only. Returns null for anything else.
 */
function formatPhoneNumber(phone) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
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
    logger.warn('sms_log_write_failed', { err: e.message });
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
    logger.warn('sms_auth_verify_failed', { err: e.message });
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

    // Per-IP cap: 30 SMS/hour from a single IP.
    if (!(await httpRateLimit(req, res, 'sendSMS:ip', 30, 3_600_000))) return;

    // Verify Firebase auth
    const decoded = await verifyAuth(req);
    if (!decoded) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Per-uid cap: 100 SMS/day.
    try {
      await enforceRateLimit('sendSMS:uid', decoded.uid, 100, 86_400_000);
    } catch (e) {
      if (e.rateLimited) { res.status(429).json({ error: 'Daily SMS limit exceeded' }); return; }
      throw e;
    }

    const { to, body, leadId } = req.body;

    // Validate input
    if (!to || !isValidPhoneNumber(to)) {
      res.status(400).json({ error: 'Invalid phone number format' });
      return;
    }

    // C4: per-recipient cap — even if a rep has budget remaining,
    // no single phone number should receive >5 SMS/day from this
    // app across ALL reps. Anti-harassment + TCPA defense.
    const toDigits = String(to).replace(/\D/g, '');
    try {
      await enforceRateLimit('sendSMS:to', toDigits, 5, 86_400_000);
    } catch (e) {
      if (e.rateLimited) {
        res.status(429).json({
          error: 'This recipient has received the maximum SMS for today. Try tomorrow or contact them directly.'
        });
        return;
      }
      throw e;
    }

    // F3: TCPA. If the recipient replied STOP, we must not message
    // them again — civil penalties per message are steep. Store
    // lookup is fast (single doc get).
    if (toDigits) {
      const optOut = await admin.firestore().doc('sms_opt_outs/' + toDigits).get();
      if (optOut.exists) {
        res.status(403).json({
          error: 'This recipient has opted out of SMS (replied STOP). Contact them by phone or email.'
        });
        return;
      }
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
      logger.error('sendSMS error', { err: e.message });

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

    if (!(await httpRateLimit(req, res, 'sendD2DSMS:ip', 60, 3_600_000))) return;

    // Verify Firebase auth
    const decoded = await verifyAuth(req);
    if (!decoded) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      await enforceRateLimit('sendD2DSMS:uid', decoded.uid, 200, 86_400_000);
    } catch (e) {
      if (e.rateLimited) { res.status(429).json({ error: 'Daily SMS limit exceeded' }); return; }
      throw e;
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

      // C4: per-recipient cap — 5/day across all reps.
      const toDigits = String(phoneNumber).replace(/\D/g, '');
      try {
        await enforceRateLimit('sendSMS:to', toDigits, 5, 86_400_000);
      } catch (e) {
        if (e.rateLimited) {
          res.status(429).json({
            error: 'This recipient has received the max SMS for today.'
          });
          return;
        }
        throw e;
      }
      // F3: TCPA — check opt-out list before sending.
      if (toDigits) {
        const optOut = await admin.firestore().doc('sms_opt_outs/' + toDigits).get();
        if (optOut.exists) {
          res.status(403).json({
            error: 'This number has opted out of SMS (replied STOP).'
          });
          return;
        }
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
      logger.error('sendD2DSMS error', { err: e.message });
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
      // Verify Twilio signature using the ACTUAL validator. The previous code
      // called `twilio.webhook(...)` which is an Express middleware FACTORY —
      // it returns a function, not a boolean, so the `if (!isValid)` branch
      // was never taken and the signature check was effectively off.
      const twilioSignature = req.headers['x-twilio-signature'] || '';
      const authToken = TWILIO_AUTH_TOKEN.value();
      const url = `https://${req.get('host')}${req.originalUrl}`;

      // Twilio signs the sorted set of POSTed form fields as an object.
      const params = (req.body && typeof req.body === 'object') ? req.body : {};

      const isValid = twilio.validateRequest(authToken, twilioSignature, url, params);
      if (!isValid) {
        logger.warn('incomingSMS signature verification failed', {
          host: req.get('host'),
          ip: clientIp(req),
        });
        res.status(403).json({ error: 'Webhook signature verification failed' });
        return;
      }

      // Extract + sanitize fields.
      const fromPhone    = escForStore(req.body.From);
      const messageBody  = escForStore(req.body.Body);
      const messageSid   = escForStore(req.body.MessageSid);

      if (!fromPhone || !messageBody) {
        res.status(400).json({ error: 'Missing From or Body' });
        return;
      }

      const db = admin.firestore();

      // F3: TCPA compliance. Any of the opt-out keywords
      // (per CTIA Short Code Monitoring Handbook § 5.2) must be
      // honored on the same day. We add the phone to
      // sms_opt_outs/{digits} and respond with TwiML confirming
      // the opt-out. The sendSMS + sendD2DSMS functions check
      // this collection before sending.
      const opt = String(messageBody || '').trim().toUpperCase();
      const STOP_WORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
      const HELP_WORDS = new Set(['HELP', 'INFO']);
      const START_WORDS = new Set(['START', 'YES', 'UNSTOP']);
      const phoneDigits = String(fromPhone).replace(/\D/g, '');
      if (phoneDigits && STOP_WORDS.has(opt)) {
        await db.doc('sms_opt_outs/' + phoneDigits).set({
          phone: fromPhone,
          optedOutAt: admin.firestore.FieldValue.serverTimestamp(),
          keyword: opt,
          twilioSid: messageSid
        });
        // TwiML reply confirming opt-out. Twilio sends this back.
        res.set('Content-Type', 'text/xml');
        res.status(200).send(
          '<?xml version="1.0" encoding="UTF-8"?><Response>' +
          '<Message>You\'ve been unsubscribed from NBD Pro SMS. ' +
          'Reply START to resume, HELP for help.</Message></Response>'
        );
        return;
      }
      if (phoneDigits && HELP_WORDS.has(opt)) {
        res.set('Content-Type', 'text/xml');
        res.status(200).send(
          '<?xml version="1.0" encoding="UTF-8"?><Response>' +
          '<Message>NBD Pro: Msg & data rates may apply. Reply STOP to ' +
          'unsubscribe. Support: (859) 420-7382.</Message></Response>'
        );
        return;
      }
      if (phoneDigits && START_WORDS.has(opt)) {
        // Resume — delete the opt-out record so the phone is live again.
        await db.doc('sms_opt_outs/' + phoneDigits).delete().catch(() => {});
        res.set('Content-Type', 'text/xml');
        res.status(200).send(
          '<?xml version="1.0" encoding="UTF-8"?><Response>' +
          '<Message>Welcome back to NBD Pro SMS. Reply STOP anytime to ' +
          'unsubscribe.</Message></Response>'
        );
        return;
      }

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
              logger.warn('push_notification_failed', { err: e.message });
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
      logger.error('incomingSMS error', { err: e.message });
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  }
);

logger.info('sms_functions_loaded');

// ═══════════════════════════════════════════════════════════════
// STORM ALERT SMS — Scheduled weather check
// ═══════════════════════════════════════════════════════════════

const { onSchedule } = require('firebase-functions/v2/scheduler');

/**
 * checkStormAlerts — Scheduled function (every 30 minutes)
 * Polls NWS weather alerts for subscriber zip codes
 * Sends SMS when severe weather is detected
 *
 * Setup: firebase deploy --only functions
 * Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER secrets
 */
exports.checkStormAlerts = onSchedule(
  {
    schedule: 'every 30 minutes',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER],
    maxInstances: 1,
    timeoutSeconds: 120,
    memory: '256MiB'
  },
  async (event) => {
    const db = admin.firestore();

    try {
      // Get all active subscribers
      const subsSnap = await db.collection('storm_alert_subscribers')
        .where('active', '==', true)
        .get();

      if (subsSnap.empty) {
        logger.info('storm_alerts_no_subscribers');
        return;
      }

      // Group subscribers by zip
      const byZip = {};
      subsSnap.docs.forEach(doc => {
        const data = doc.data();
        if (!byZip[data.zip]) byZip[data.zip] = [];
        byZip[data.zip].push({ id: doc.id, ...data });
      });

      const uniqueZips = Object.keys(byZip);
      logger.info('storm_alerts_scan_start', { zips: uniqueZips.length, subscribers: subsSnap.size });

      const alertUrl = 'https://api.weather.gov/alerts/active?area=OH,KY&severity=Severe,Extreme';
      const alertResp = await fetch(alertUrl, {
        headers: { 'User-Agent': 'NBDHomeStormAlerts/1.0 (jd@nobigdealwithjoedeal.com)' }
      });
      if (!alertResp.ok) { logger.error('NWS API error', { status: alertResp.status }); return; }

      const alertData = await alertResp.json();
      const features = alertData.features || [];

      const stormKeywords = ['hail', 'tornado', 'severe thunderstorm', 'wind'];
      const relevantAlerts = features.filter(f => {
        const event = (f.properties?.event || '').toLowerCase();
        const desc = (f.properties?.description || '').toLowerCase();
        return stormKeywords.some(k => event.includes(k) || desc.includes(k));
      });
      if (relevantAlerts.length === 0) { logger.info('storm_alerts_none'); return; }

      // Load zip → county/city mapping (static, packaged with the function).
      // Falls back to empty map if the file is missing, in which case we
      // REFUSE to send rather than blasting every subscriber (the old bug).
      let zipToAreas = {};
      try {
        zipToAreas = require('./data/zip-to-county.json');
      } catch (e) {
        logger.error('zip-to-county mapping missing — refusing to fan out');
        return;
      }

      // Dedup by (alertId, subscriberId).
      const alreadySent = new Set();
      const recentSent = await db.collection('storm_alerts_sent')
        .where('sentAt', '>', new Date(Date.now() - 48 * 60 * 60 * 1000))
        .get();
      recentSent.docs.forEach(d => {
        const r = d.data();
        if (r.alertId && r.subscriberId) alreadySent.add(`${r.alertId}::${r.subscriberId}`);
      });

      const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
      const fromPhone = TWILIO_PHONE_NUMBER.value();
      let totalSent = 0;

      // Helper: does subscriber's zip fall inside this alert's areaDesc?
      function zipMatchesArea(zip, areaDescLower) {
        const areas = zipToAreas[zip];
        if (!Array.isArray(areas) || areas.length === 0) return false;
        return areas.some(name => areaDescLower.includes(String(name).toLowerCase()));
      }

      // Respect Twilio 1-per-second per-number pacing.
      async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

      for (const alert of relevantAlerts) {
        const alertId = alert.properties?.id || alert.id;
        if (!alertId) continue;

        const event = alert.properties?.event || 'Severe Weather';
        const headline = alert.properties?.headline || '';
        const areasLower = (alert.properties?.areaDesc || '').toLowerCase();
        if (!areasLower) continue;

        for (const zip of uniqueZips) {
          if (!zipMatchesArea(zip, areasLower)) continue; // <-- the real fix
          for (const sub of byZip[zip]) {
            const dedupKey = `${alertId}::${sub.id}`;
            if (alreadySent.has(dedupKey)) continue;

            const phone = formatPhoneNumber(sub.phone);
            if (!phone) continue;

            const body = `⛈️ NBD Storm Alert: ${event} reported near ${zip}. ${String(headline).substring(0, 120)} — Free roof inspection: nobigdealwithjoedeal.com or call Joe (859) 420-7382. Reply STOP to unsubscribe.`;

            try {
              await client.messages.create({
                body: body.substring(0, 1600),
                from: fromPhone,
                to: phone,
              });
              totalSent++;
              alreadySent.add(dedupKey);

              await db.collection('storm_alerts_sent').add({
                alertId,
                subscriberId: sub.id,
                event,
                headline,
                areas: areasLower,
                zip,
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
              });
            } catch (e) {
              logger.warn('storm_alert_sms_failed', { sub: sub.id, err: e.message });
              if (e.code === 21211 || e.code === 21614) {
                await db.doc(`storm_alert_subscribers/${sub.id}`).update({ active: false });
              }
            }

            // Twilio default per-number cap is 1 msg/sec.
            await sleep(1100);
          }
        }
      }

      logger.info('storm_alerts_complete', { totalSent });

    } catch (e) {
      logger.error('checkStormAlerts error', { err: e.message });
    }
  }
);
