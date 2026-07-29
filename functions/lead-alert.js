/**
 * NBD — New public-lead alert to Joe
 * ═══════════════════════════════════════════════════════════════
 *
 * The public marketing forms (contact / instant-estimate / inspect+storm-tools
 * / free-roof) write straight to Firestore and nothing surfaced them — leads
 * could sit unseen. These onCreate triggers fire the moment a lead lands and
 * alert Joe by **text (Twilio SMS) + email (Resend)**.
 *
 * SMS status: the Twilio number must complete A2P 10DLC registration before US
 * carriers will deliver (otherwise carrier error 30034 — message accepted but
 * dropped). Once the campaign is approved, texts start flowing automatically —
 * no code change needed. Email works regardless and is the reliable backstop.
 *
 * Both sends are independent try/catch so a failure never blocks lead capture.
 * Additive — does not touch submitPublicLead or the lead pipeline.
 */

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');
const { Resend } = require('resend');
const twilio = require('twilio');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const L = require('./lead-bridge-logic');

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const EMAIL_FROM = defineSecret('EMAIL_FROM');
const TWILIO_ACCOUNT_SID = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = defineSecret('TWILIO_PHONE_NUMBER');
const SECRETS = [RESEND_API_KEY, EMAIL_FROM, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER];

const ALERT_EMAILS = ['jd@nobigdealwithjoedeal.com', 'jonathandeal459@gmail.com'];
const ALERT_SMS = '+18594207382'; // Joe's cell — default when a lead has no tenant contact

// Platform-tenant gate (same convention as render-pdf.js NBD_OWNER_UID): the
// "is this NBD's lead" signal must be the lead's companyId, NOT the resolved
// seal — the old fallback carried seal 'NBD' for an UNRESOLVED tenant lead
// too, so that tenant's homeowner got Joe's ack email/SMS (NBD-leak audit
// 2026-07-29).
const NBD_OWNER_UID = process.env.NBD_OWNER_UID || '1phDvAVXHSg82wDLegAbQFq14Ci1';

// Resolve who gets the alert for a lead's tenant (Phase C, TenantContext).
// NBD — and any lead without a configured tenant alert contact — falls back to
// Joe, so this is byte-identical until a tenant sets companyProfile.brand.contact
// .alertEmail / .alertSms. A configured tenant gets its leads routed to itself.
// isNbd rides along so the homeowner-ack gates key on WHOSE lead it is rather
// than which brand string happened to resolve.
async function resolveAlertTarget(companyId) {
  const isNbd = !companyId || String(companyId) === NBD_OWNER_UID;
  const fallback = isNbd
    ? { emails: ALERT_EMAILS, sms: ALERT_SMS, name: 'No Big Deal Home Solutions', seal: 'NBD', isNbd: true }
    // Unresolved NON-NBD tenant: keep Joe's ROUTING as the backstop (the lead
    // must not vanish unseen) but never his brand — per the #1129 convention
    // the tenant arm gets empty strings, and isNbd:false keeps the homeowner
    // acks (Joe-branded copy) from firing at another company's customer.
    : { emails: ALERT_EMAILS, sms: ALERT_SMS, name: '', seal: '', isNbd: false };
  if (isNbd) return fallback;
  try {
    const snap = await getFirestore().collection('companyProfile').doc(String(companyId)).get();
    if (snap.exists) {
      const b = (snap.data() || {}).brand || {};
      const c = b.contact || {};
      if (c.alertEmail || c.alertSms) {
        return {
          emails: c.alertEmail ? [c.alertEmail] : null,
          sms: c.alertSms || null,
          // Configured tenant → its own name/seal, never NBD's. (b is the RAW
          // companyProfile.brand: b.displayName is undefined here, so the old
          // `b.seal || b.displayName || fallback.seal` fell through to 'NBD' for
          // a tenant that set alert routing but no seal — an NBD bleed. M1.)
          name: b.legalName || '',
          seal: b.seal || '',
          isNbd: false,
        };
      }
    }
  } catch (e) {
    logger.error('leadAlert: tenant resolve failed', { companyId, err: e && e.message });
  }
  return fallback;
}

const KIND_LABEL = {
  contact_leads: 'Contact form',
  estimate_leads: 'Instant Estimate',
  inspect_leads: 'Inspection / Storm tool',
  free_roof_entries: 'Free Roof entry',
  storm_alert_subscribers: 'Storm — homeowner reports damage',
};

// Human labels for the storm form's "What are you most concerned about?" field.
const CONCERN_LABEL = {
  hail: 'Hail damage to roof',
  wind: 'Wind damage',
  general: 'General severe weather',
  insurance: 'Already has damage — waiting on insurance',
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Pull the human-meaningful fields, tolerant of the per-kind field names.
function summarize(d) {
  const name = d.name || [d.firstName, d.lastName].filter(Boolean).join(' ') || d.nomineeName || '(no name given)';
  const phone = d.phone || '(no phone)';
  const address = d.address || d.zip || '';
  const email = d.email || '';
  const story = d.story || d.message || d.details || '';
  const concern = d.concern || '';
  return { name, phone, address, email, story, concern };
}

function emailHtml(label, source, s, leadId, name) {
  const telDigits = String(s.phone).replace(/[^\d]/g, '');
  const row = (k, v) => v ? `<tr><td style="padding:6px 12px;color:#6b7280;font-weight:600;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 12px;color:#111">${esc(v)}</td></tr>` : '';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:'Barlow','Segoe UI',Roboto,sans-serif;background:#f5f5f5;margin:0;color:#333">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
    <div style="background:linear-gradient(135deg,#C8541A,#a64516);color:#fff;padding:22px 20px;text-align:center">
      <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;opacity:.9">New Lead — Act Fast</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px">${esc(label)}</div>
      ${source ? `<div style="font-size:13px;opacity:.9;margin-top:2px">from ${esc(source)}</div>` : ''}
    </div>
    <div style="padding:22px 20px">
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        ${row('Name', s.name)}
        ${row('Phone', s.phone)}
        ${row('Address', s.address)}
        ${row('Email', s.email)}
        ${row('Concern', s.concern ? (CONCERN_LABEL[s.concern] || s.concern) : '')}
        ${row('Message', s.story)}
      </table>
      ${telDigits ? `<p style="text-align:center;margin:22px 0 6px"><a href="tel:${telDigits}" style="display:inline-block;background:#C8541A;color:#fff;padding:13px 30px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px">Call ${esc(s.phone)}</a></p>` : ''}
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:16px">Lead ID: ${esc(leadId)} · ${esc(name)}</p>
    </div>
  </div>
</body></html>`;
}

function smsBody(label, source, s, seal) {
  // Suppress the seal token when the tenant has none — never render a bare
  // gap, and never substitute 'NBD' on a tenant's alert.
  const lines = [`🔔 ${seal ? seal + ' ' : ''}lead — ${label}${source ? ` (${source})` : ''}`, `${s.name} · ${s.phone}`];
  if (s.address) lines.push(s.address);
  if (s.concern) lines.push('Concern: ' + (CONCERN_LABEL[s.concern] || s.concern));
  if (s.story) lines.push(String(s.story).slice(0, 200));
  return lines.join('\n').slice(0, 480);
}

// ── Homeowner acknowledgment (speed-to-lead, half of the loop) ──────────
// Joe gets paged the second a lead lands; until now the HOMEOWNER got
// nothing — no confirmation their request went anywhere, which is exactly
// when they keep shopping and fill out a competitor's form. This sends a
// short "got it — here's what happens next" email signed by Joe.
//
// V1 is EMAIL-ONLY by design: an auto-SMS to the homeowner needs express
// texting consent on the forms (TCPA) — that's Jo's call and a copy change,
// not a code constraint. Guards: valid email required; NBD leads only
// (configured tenants must opt in with their own copy before we speak to
// their customers); independent try/catch so a failure never touches lead
// capture or Joe's alert.
const ACK_FIRST_LINE = {
  contact_leads: 'Got your message.',
  estimate_leads: 'Got your estimate request.',
  inspect_leads: 'Got your inspection request.',
  free_roof_entries: 'Your Free Roof entry is in.',
  storm_alert_subscribers: 'Got your storm damage report.',
};

function ackEmailHtml(collection, firstName) {
  const hi = firstName ? `Hi ${esc(firstName)},` : 'Hi,';
  const first = ACK_FIRST_LINE[collection] || 'Got your request.';
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:'Barlow','Segoe UI',Roboto,sans-serif;background:#f5f5f5;margin:0;color:#333">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.1)">
    <div style="background:linear-gradient(135deg,#1e3a6e,#142a52);color:#fff;padding:22px 20px;text-align:center">
      <div style="font-size:22px;font-weight:700">${esc(first)}</div>
      <div style="font-size:13px;opacity:.85;margin-top:4px">No Big Deal Home Solutions</div>
    </div>
    <div style="padding:24px 22px;font-size:15px;line-height:1.65">
      <p style="margin:0 0 14px">${hi}</p>
      <p style="margin:0 0 14px">This is Joe. Your request just hit my phone — not a call center, not a queue. I personally look at every one and I'll reach out shortly (same day during work hours).</p>
      <p style="margin:0 0 14px">If it's urgent — active leak, storm damage getting worse — don't wait on me:</p>
      <p style="text-align:center;margin:20px 0"><a href="tel:8594207382" style="display:inline-block;background:#e8720c;color:#fff;padding:13px 30px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px">Call or text (859) 420-7382</a></p>
      <p style="margin:0">— Joe Deal<br><span style="color:#6b7280;font-size:13px">Owner &amp; Operator, No Big Deal Home Solutions</span></p>
    </div>
  </div>
</body></html>`;
}

function ackEmailText(collection, firstName) {
  const first = ACK_FIRST_LINE[collection] || 'Got your request.';
  return `${first}\n\n${firstName ? 'Hi ' + firstName + ',' : 'Hi,'}\n\nThis is Joe. Your request just hit my phone — not a call center, not a queue. I personally look at every one and I'll reach out shortly (same day during work hours).\n\nIf it's urgent — active leak, storm damage getting worse — call or text me directly: (859) 420-7382.\n\n— Joe Deal\nOwner & Operator, No Big Deal Home Solutions`;
}

async function ackHomeowner(collection, d, leadId, target) {
  // NBD leads only — a tenant's homeowners are not ours to email. Gate on
  // WHOSE lead it is (isNbd from the companyId), not on the resolved seal:
  // the old seal check also matched an UNRESOLVED tenant's fallback target,
  // sending Joe-branded acks to another company's customer (audit 2026-07-29).
  if (!target || target.isNbd !== true) return;
  const email = String(d.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
  try {
    const resend = new Resend(RESEND_API_KEY.value());
    const firstName = String(d.firstName || d.name || '').trim().split(/\s+/)[0] || '';
    await resend.emails.send({
      from: 'Joe Deal <jd@nobigdealwithjoedeal.com>',
      to: email,
      reply_to: 'jd@nobigdealwithjoedeal.com',
      subject: "Got it — Joe here. What happens next",
      html: ackEmailHtml(collection, firstName),
      text: ackEmailText(collection, firstName),
      headers: { 'X-NBD-Campaign': 'lead-ack-v1' },
    });
    logger.info('leadAck: email sent', { collection, leadId });
    if (leadId) {
      await getFirestore().collection(collection).doc(String(leadId))
        .update({ ackEmailSentAt: FieldValue.serverTimestamp() })
        .catch(() => {});
    }
  } catch (e) {
    logger.error('leadAck: email failed', { collection, leadId, err: e.message });
  }
}

// ── Alert outbox ledger (2026-07-06, punch item 6) ──────────────────────
// One doc per alert attempt recording the RESOLVED routing decision +
// per-channel outcomes. Two consumers:
//   - CI: the Stranger E2E asserts the alert for a tenant's public lead
//     TARGETED the tenant (companyProfile alertEmail/alertSms), never
//     Joe — the notification half of lead routing was previously
//     unassertable because Resend/Twilio secrets don't exist in the rig
//     and delivery failed silently server-side.
//   - Prod: an audit trail of who was alerted for which lead (readable
//     by platform admin + the lead's own tenant readers; see
//     firestore.rules /alert_outbox).
// Best-effort by design: an outbox write failure never blocks the alert.
async function recordAlertOutbox(collection, leadId, d, target, outcomes) {
  try {
    await getFirestore().collection('alert_outbox').add({
      kind: 'lead-alert',
      collection,
      leadId: leadId || null,
      companyId: (d && d.companyId) || null,
      target: {
        emails: target.emails || null,
        sms: target.sms || null,
        name: target.name || '',
        seal: target.seal || '',
      },
      emailStatus: outcomes.email,
      smsStatus: outcomes.sms,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    logger.warn('leadAlert: outbox write failed', { collection, leadId, err: e && e.message });
  }
}

async function alertJoe(collection, d, leadId) {
  const label = KIND_LABEL[collection] || collection;
  const source = d.source || '';
  const s = summarize(d);
  // Route to the lead's tenant (Oaks → Scott); NBD / unset → Joe (default).
  const target = await resolveAlertTarget(d.companyId);
  const outcomes = { email: 'skipped:no-target', sms: 'skipped:no-target' };

  // Text via Twilio (works once the number is A2P 10DLC approved). Skip when
  // the tenant configured no alert SMS — never fall back to Joe's cell.
  if (target.sms) try {
    const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
    const msg = await client.messages.create({
      to: target.sms,
      from: TWILIO_PHONE_NUMBER.value(),
      body: smsBody(label, source, s, target.seal),
    });
    outcomes.sms = 'sent';
    logger.info('leadAlert: sms queued', { collection, leadId, sid: msg.sid });
  } catch (e) {
    outcomes.sms = 'failed:' + String(e && e.message || e).slice(0, 200);
    logger.error('leadAlert: sms failed', { collection, leadId, err: e.message });
  }

  // Detailed email → the tenant's alert inbox(es). Skip when none configured.
  if (target.emails && target.emails.length) try {
    const resend = new Resend(RESEND_API_KEY.value());
    const from = EMAIL_FROM.value() || 'noreply@nobigdealwithjoedeal.com';
    const resp = await resend.emails.send({
      from,
      to: target.emails,
      subject: `🔔 New lead — ${label}${s.name && s.name[0] !== '(' ? `: ${s.name}` : ''}`,
      html: emailHtml(label, source, s, leadId, target.name),
      reply_to: s.email || undefined,
    });
    outcomes.email = 'sent';
    logger.info('leadAlert: email sent', { collection, leadId, id: (resp && resp.data && resp.data.id) || null });
  } catch (e) {
    outcomes.email = 'failed:' + String(e && e.message || e).slice(0, 200);
    logger.error('leadAlert: email failed', { collection, leadId, err: e.message });
  }

  // Ledger the routing decision + outcomes (see recordAlertOutbox above).
  await recordAlertOutbox(collection, leadId, d, target, outcomes);

  // Close the loop with the homeowner (independent; never blocks the alert).
  await ackHomeowner(collection, d, leadId, target);
  await ackHomeownerSms(collection, d, leadId, target);
}

// ── Homeowner ack TEXT — gated, estimate funnel only ────────────────────
// Same idea as the ack email but SMS converts harder. Fires ONLY when:
//  - LEAD_ACK_SMS_ENABLED=true on the trigger services (Jo's flip, same
//    pattern as FUNNEL_RECOVERY_ENABLED — default OFF), and
//  - collection is estimate_leads: the /estimate funnel's submit button is
//    hard-disabled until the TCPA consent box ("...follow-up communication
//    ... Reply STOP to opt out") is checked, so every completed estimate
//    lead has express written consent by construction. No other form
//    collects texting consent yet, so no other collection texts.
// Delivery still requires the Twilio number's A2P 10DLC approval.
async function ackHomeownerSms(collection, d, leadId, target) {
  if (process.env.LEAD_ACK_SMS_ENABLED !== 'true') return;
  if (collection !== 'estimate_leads') return;
  // Same isNbd gate as ackHomeowner — never text another company's customer.
  if (!target || target.isNbd !== true) return;
  const digits = String(d.phone || d.phoneNumber || '').replace(/[^\d]/g, '');
  if (digits.length !== 10 && !(digits.length === 11 && digits[0] === '1')) return;
  const to = '+1' + digits.slice(-10);
  try {
    const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
    const firstName = String(d.firstName || '').trim();
    const msg = await client.messages.create({
      to,
      from: TWILIO_PHONE_NUMBER.value(),
      body: `${firstName ? firstName + ' — g' : 'G'}ot your estimate request. This is Joe with No Big Deal Home Solutions — I'll call you shortly. Urgent? Call/text me at (859) 420-7382. Reply STOP to opt out.`,
    });
    logger.info('leadAck: sms queued', { collection, leadId, sid: msg.sid });
    if (leadId) {
      await getFirestore().collection(collection).doc(String(leadId))
        .update({ ackSmsSentAt: FieldValue.serverTimestamp() })
        .catch(() => {});
    }
  } catch (e) {
    logger.error('leadAck: sms failed', { collection, leadId, err: e.message });
  }
}

const TRIGGER_OPTS = {
  region: 'us-central1',
  secrets: SECRETS,
  maxInstances: 10,
  memory: '256MiB',
  timeoutSeconds: 30,
};

function onLeadAlert(collection) {
  return async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    // The /estimate funnel writes follow-up EVENT docs (results shown / CTA
    // click / email request) into estimate_leads alongside the initial lead.
    // Each is a fresh create → without this skip, one completed funnel fires
    // up to 4 duplicate alert emails for the same homeowner. lead-bridge.js
    // already skips these for the CRM mirror; mirror that here so the alert
    // path agrees with the bridge on what counts as a new lead.
    if (L.isFollowUpEvent(collection, data)) {
      logger.info('leadAlert: follow-up event doc — not a new lead, skipping', { collection, type: data.type });
      return;
    }
    await alertJoe(collection, data, event.params && event.params.leadId);
  };
}

// Most storm-alert signups are a marketing LIST, so the bulk must NOT page
// Joe. But a homeowner who deliberately flags real damage (insurance / wind /
// general — anything other than the form's PRE-SELECTED 'hail' default) is a
// hot, ready-to-hire lead. Alert on those AND mirror them into the CRM pipeline
// (see onStormBridge in lead-bridge.js). Both gates share the SAME
// HIGH_INTENT_STORM_CONCERNS set so the lead that pages Joe is the lead that
// lands in his pipeline. (2026-06-25: widened from ['insurance'] per Jo.)
const STORM_ALERT_CONCERNS = L.HIGH_INTENT_STORM_CONCERNS;
function onStormAlert() {
  return async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data() || {};
    const concern = String(data.concern || '').toLowerCase();
    if (!STORM_ALERT_CONCERNS.includes(concern)) {
      logger.info('leadAlert: storm signup is list-only (no high-intent concern) — no alert', { concern });
      return;
    }
    await alertJoe('storm_alert_subscribers', data, event.params && event.params.leadId);
  };
}

// IMPORTANT: each export assigns onDocumentCreated(...) DIRECTLY (not via a
// makeTrigger() wrapper). The CI auto-deploy builds its --only allowlist by
// grepping `^exports.<name> = (onRequest|onCall|onDocumentCreated|...)` in
// .github/workflows/firebase-deploy.yml — a `= makeTrigger(...)` RHS does NOT
// match, so these alert triggers were silently dropped from the deploy and a
// fix pushed to main only shipped via a manual full `firebase deploy`. Keep the
// RHS a literal factory call, mirroring the proven lead-bridge.js pattern.
exports.leadAlertContact  = onDocumentCreated({ ...TRIGGER_OPTS, document: 'contact_leads/{leadId}' },     onLeadAlert('contact_leads'));
exports.leadAlertEstimate = onDocumentCreated({ ...TRIGGER_OPTS, document: 'estimate_leads/{leadId}' },    onLeadAlert('estimate_leads'));
exports.leadAlertInspect  = onDocumentCreated({ ...TRIGGER_OPTS, document: 'inspect_leads/{leadId}' },     onLeadAlert('inspect_leads'));
exports.leadAlertFreeRoof = onDocumentCreated({ ...TRIGGER_OPTS, document: 'free_roof_entries/{leadId}' }, onLeadAlert('free_roof_entries'));
exports.leadAlertStorm    = onDocumentCreated({ ...TRIGGER_OPTS, document: 'storm_alert_subscribers/{leadId}' }, onStormAlert());
