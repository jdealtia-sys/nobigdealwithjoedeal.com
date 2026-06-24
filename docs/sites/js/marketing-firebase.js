/**
 * NBD Marketing — lead submission shim.
 *
 * HISTORY: this module used to initialize a SEPARATE `nobigdealwithjoedeal`
 * Firebase project and write leads straight into its `leads` collection via
 * the modular Firestore SDK. That collection accepted unauthenticated public
 * writes gated ONLY by firestore.rules shape checks — no App Check, no
 * Turnstile, no rate limit (App Check was never registered for the marketing
 * project, so MARKETING_RECAPTCHA_SITE_KEY stayed empty). Anyone could POST
 * unlimited leads straight to Firestore.
 *
 * Every marketing lead now flows through the SAME hardened gateway the main
 * site + Oaks microsite already use: the `submitPublicLead` Cloud Function on
 * nobigdeal-pro, which enforces App Check + Turnstile + per-IP rate limit +
 * honeypot server-side, and bridges the lead into the CRM pipeline + operator
 * alerts. The standalone `nobigdealwithjoedeal` marketing project has since
 * been retired, so its old `leads` collection no longer accepts writes.
 *
 * The exported helper keeps its original name + contract (resolves with the
 * new lead id, throws on failure) so existing callers — sites/js/sites-landing.js
 * and the company-site template (assets/js/inline/a480f74bc8.js), both via
 * window._nbdSubmitLead — need no change.
 */

const PUBLIC_LEAD_SUBMIT_SRC = '/assets/js/public-lead-submit.js';

let _loadPromise = null;
function ensureGateway() {
  if (typeof window.submitPublicLead === 'function') return Promise.resolve(window.submitPublicLead);
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PUBLIC_LEAD_SUBMIT_SRC;   // same-origin; satisfies script-src 'self'
    s.onload = () => (typeof window.submitPublicLead === 'function'
      ? resolve(window.submitPublicLead)
      : reject(new Error('submitPublicLead unavailable after load')));
    s.onerror = () => reject(new Error('failed to load public-lead-submit.js'));
    document.head.appendChild(s);
  });
  return _loadPromise;
}

// The gateway's `contact` kind accepts: firstName, phone, source (required) +
// lastName, email, address, zip, service, message (optional allowlist), plus a
// registry-validated companyId. Marketing forms collect a slightly different
// shape (a full `name`, and the SaaS sales form adds company/plan/area/services),
// so we normalise here and fold any extra context into `message` — nothing the
// homeowner/operator typed is dropped, and no new server-side field is needed.
function toContactPayload(data) {
  const d = data || {};
  const firstName = String(d.firstName || d.name || '').trim();

  // Preserve context (company/plan/service-area/etc.) that has no dedicated
  // field on the homeowner contact schema by appending it to `message`.
  const extras = [];
  if (d.company)     extras.push('Company: ' + d.company);
  if (d.companyName) extras.push('Site: ' + d.companyName);
  if (d.plan)        extras.push('Plan: ' + d.plan);
  if (d.area)        extras.push('Area: ' + d.area);
  if (d.services)    extras.push('Services: ' + d.services);
  if (d.type)        extras.push('Type: ' + d.type);
  const baseMsg = String(d.message || '');
  const message = extras.length
    ? ((baseMsg ? baseMsg + '\n\n' : '') + '— ' + extras.join(' | '))
    : baseMsg;

  const payload = {
    firstName,
    phone:  String(d.phone || ''),
    email:  String(d.email || ''),
    source: String(d.source || 'website'),
  };
  if (d.lastName) payload.lastName = String(d.lastName);
  if (d.service)  payload.service = String(d.service);
  if (d.zip)      payload.zip = String(d.zip);
  if (message)    payload.message = message.slice(0, 1500);
  // companyId is validated against the companies registry by the gateway; an
  // unknown id is simply dropped there (lead falls back to Joe).
  if (d.companyId) payload.companyId = String(d.companyId);
  return payload;
}

/**
 * Submit a marketing lead through the hardened submitPublicLead gateway.
 * Returns the new lead id on success; throws on failure (same contract as the
 * legacy direct-write helper this replaces).
 */
export async function submitMarketingLead(data) {
  if (!data || typeof data !== 'object') throw new Error('data required');
  const submit = await ensureGateway();
  const out = await submit('contact', toContactPayload(data));
  if (!out || !out.ok) {
    throw new Error((out && out.reason) || 'submission failed');
  }
  return out.id || null;
}
