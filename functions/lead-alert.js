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
const admin = require('firebase-admin');

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const EMAIL_FROM = defineSecret('EMAIL_FROM');
const TWILIO_ACCOUNT_SID = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = defineSecret('TWILIO_PHONE_NUMBER');
const SECRETS = [RESEND_API_KEY, EMAIL_FROM, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER];

const ALERT_EMAILS = ['jd@nobigdealwithjoedeal.com', 'jonathandeal459@gmail.com'];
const ALERT_SMS = '+18594207382'; // Joe's cell — default when a lead has no tenant contact

// Resolve who gets the alert for a lead's tenant (Phase C, TenantContext).
// NBD — and any lead without a configured tenant alert contact — falls back to
// Joe, so this is byte-identical until a tenant sets companyProfile.brand.contact
// .alertEmail / .alertSms. A configured tenant gets its leads routed to itself.
async function resolveAlertTarget(companyId) {
  const fallback = { emails: ALERT_EMAILS, sms: ALERT_SMS, name: 'No Big Deal Home Solutions', seal: 'NBD' };
  if (!companyId) return fallback;
  try {
    const snap = await admin.firestore().collection('companyProfile').doc(String(companyId)).get();
    if (snap.exists) {
      const b = (snap.data() || {}).brand || {};
      const c = b.contact || {};
      if (c.alertEmail || c.alertSms) {
        return {
          emails: c.alertEmail ? [c.alertEmail] : null,
          sms: c.alertSms || null,
          name: b.legalName || fallback.name,
          seal: b.seal || b.displayName || fallback.seal,
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
};

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Pull the human-meaningful fields, tolerant of the per-kind field names.
function summarize(d) {
  const name = d.name || d.firstName || d.nomineeName || '(no name given)';
  const phone = d.phone || '(no phone)';
  const address = d.address || d.zip || '';
  const email = d.email || '';
  const story = d.story || d.message || d.details || '';
  return { name, phone, address, email, story };
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
        ${row('Message', s.story)}
      </table>
      ${telDigits ? `<p style="text-align:center;margin:22px 0 6px"><a href="tel:${telDigits}" style="display:inline-block;background:#C8541A;color:#fff;padding:13px 30px;border-radius:6px;text-decoration:none;font-weight:700;font-size:16px">Call ${esc(s.phone)}</a></p>` : ''}
      <p style="color:#9ca3af;font-size:12px;text-align:center;margin-top:16px">Lead ID: ${esc(leadId)} · ${esc(name)}</p>
    </div>
  </div>
</body></html>`;
}

function smsBody(label, source, s, seal) {
  const lines = [`🔔 ${seal} lead — ${label}${source ? ` (${source})` : ''}`, `${s.name} · ${s.phone}`];
  if (s.address) lines.push(s.address);
  if (s.story) lines.push(String(s.story).slice(0, 200));
  return lines.join('\n').slice(0, 480);
}

async function alertJoe(collection, d, leadId) {
  const label = KIND_LABEL[collection] || collection;
  const source = d.source || '';
  const s = summarize(d);
  // Route to the lead's tenant (Oaks → Scott); NBD / unset → Joe (default).
  const target = await resolveAlertTarget(d.companyId);

  // Text via Twilio (works once the number is A2P 10DLC approved). Skip when
  // the tenant configured no alert SMS — never fall back to Joe's cell.
  if (target.sms) try {
    const client = twilio(TWILIO_ACCOUNT_SID.value(), TWILIO_AUTH_TOKEN.value());
    const msg = await client.messages.create({
      to: target.sms,
      from: TWILIO_PHONE_NUMBER.value(),
      body: smsBody(label, source, s, target.seal),
    });
    logger.info('leadAlert: sms queued', { collection, leadId, sid: msg.sid });
  } catch (e) {
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
    logger.info('leadAlert: email sent', { collection, leadId, id: (resp && resp.data && resp.data.id) || null });
  } catch (e) {
    logger.error('leadAlert: email failed', { collection, leadId, err: e.message });
  }
}

function makeTrigger(collection) {
  return onDocumentCreated(
    {
      region: 'us-central1',
      document: `${collection}/{leadId}`,
      secrets: SECRETS,
      maxInstances: 10,
      memory: '256MiB',
      timeoutSeconds: 30,
    },
    async (event) => {
      const snap = event.data;
      if (!snap) return;
      await alertJoe(collection, snap.data() || {}, event.params && event.params.leadId);
    }
  );
}

exports.leadAlertContact = makeTrigger('contact_leads');
exports.leadAlertEstimate = makeTrigger('estimate_leads');
exports.leadAlertInspect = makeTrigger('inspect_leads');
exports.leadAlertFreeRoof = makeTrigger('free_roof_entries');
