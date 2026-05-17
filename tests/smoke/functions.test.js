/**
 * tests/smoke/functions.test.js — Cloud Functions exports, all
 * integrations (Slack, Turnstile, Upstash, measurement, BoldSign, parcel,
 * hail, Cal.com), Stripe webhook hardening, GDPR cron/backup/retention,
 * CI workflow, CODEOWNERS, service-worker kill switch, email queue,
 * TCPA, deploy runbook, Voice Intel pipeline (C1–C5), per-route rate
 * limit policy, registry drift, migration framework, Push-3/Push-5,
 * Phase D.3, L-01/L-02/L-03/B2 module extractions, M1 admin CSP,
 * SEO sitemap, service worker stub, R-05 hot-path sizing.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, PRO_JS, FUNCTIONS, read, readDashboard, syntaxCheck } = require('./_shared');

module.exports.run = function run(ctx) {
  const { assert, section } = ctx;

// ── Cloud Functions contract ─────────────────────────────────
section('Cloud Functions exports');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  for (const fn of ['createTeamMember', 'updateUserRole', 'deactivateUser',
                    'listTeamMembers', 'rotateAccessCodes', 'submitPublicLead']) {
    assert('exports ' + fn, new RegExp('exports\\.' + fn + '\\s*=').test(src));
  }
  assert('requireTeamAdmin helper defined', /function requireTeamAdmin\s*\(/.test(src));
  assert('normalizeRole rejects platform admin unconditionally',
    /if \(r === 'admin'\) return null/.test(src));
  assert('TEAM_ROLES excludes platform admin',
    /TEAM_ROLES = \['company_admin'[^\]]*\]/.test(src));
}

// ── H-6: Stripe webhook hardening ───────────────────────────
section('H-6: Stripe webhook raw body + replay');
{
  // L-03 cont.: Stripe handlers moved to functions/stripe.js.
  const src = read(path.join(FUNCTIONS, 'stripe.js'));
  assert('stripeWebhook rejects when rawBody is not a Buffer',
    /stripeWebhook missing rawBody[\s\S]{0,200}Buffer\.isBuffer/.test(src) ||
    /!Buffer\.isBuffer\(req\.rawBody\)[\s\S]{0,100}stripeWebhook/.test(src) ||
    // robust form: look for both the guard and the explicit tolerance
    (/!Buffer\.isBuffer\(req\.rawBody\)/.test(src) &&
     /constructEvent\(req\.rawBody,\s*sig,\s*webhookSecret,\s*300\)/.test(src)));
  assert('invoiceWebhook passes explicit 300s tolerance',
    /constructEvent\(\s*req\.rawBody,\s*signature,\s*STRIPE_WEBHOOK_SECRET\.value\(\),\s*300\s*\)/.test(src));
}

// ────────────────────────────────────────────────────────────
//  INTEGRATIONS
// ────────────────────────────────────────────────────────────

section('Integration module skeleton');
{
  const dir = path.join(FUNCTIONS, 'integrations');
  for (const f of ['_shared.js','sentry.js','slack.js','turnstile.js',
                    'upstash-ratelimit.js','measurement.js','esign.js',
                    'parcel.js','hail.js','calcom.js']) {
    assert('integrations/' + f + ' present', fs.existsSync(path.join(dir, f)));
  }
  const shared = read(path.join(dir, '_shared.js'));
  assert('_shared exposes SECRETS registry', /const SECRETS\s*=\s*\{/.test(shared));
  assert('_shared exposes PROVIDERS map', /const PROVIDERS\s*=\s*\{/.test(shared));
  assert('_shared has hasSecret + notConfigured helpers',
    /function hasSecret\(/.test(shared) && /function notConfigured\(/.test(shared));
}

section('Sentry');
{
  const srv = read(path.join(FUNCTIONS, 'integrations/sentry.js'));
  assert('withSentry helper exported', /module\.exports\s*=\s*\{[\s\S]*withSentry/.test(srv));
  assert('PII redaction in beforeSend',
    /beforeSend[\s\S]{0,500}email\|phone\|address/.test(srv));
  const cli = read(path.join(PRO_JS, 'sentry-init.js'));
  assert('client registers window.NBDSentry', /window\.NBDSentry\s*=/.test(cli));
  assert('client redacts email + phone + Bearer tokens',
    /\[email\]/.test(cli) && /\[phone\]/.test(cli) && /\[token\]/.test(cli));
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('index.js imports withSentry', /require\(['"]\.\/integrations\/sentry['"]\)/.test(idx));
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('dashboard loads sentry-init.js', /sentry-init\.js/.test(dash));
  // DSN slot moved out of inline <script> and into js/sentry-config.js
  // (single source of truth across pages — see "Sentry — DSN config
  // wired across high-value pages" section below).
  assert('dashboard loads sentry-config.js (DSN slot)',
    /sentry-config\.js/.test(dash));
}

section('Slack alerts');
{
  const src = read(path.join(FUNCTIONS, 'integrations/slack.js'));
  for (const name of ['slack_onLeadWon','slack_onAdminGrantAttempt','slack_onStormAlert']) {
    assert('exports ' + name, new RegExp('exports\\.' + name + '\\s*=').test(src));
  }
  assert('Slack helper fails silent on missing webhook',
    /hasSecret\('SLACK_WEBHOOK_URL'\)[\s\S]{0,120}return \{ posted: false/.test(src));
}

section('Turnstile');
{
  const src = read(path.join(FUNCTIONS, 'integrations/turnstile.js'));
  assert('verifyTurnstile exported', /module\.exports\s*=\s*\{\s*verifyTurnstile\s*\}/.test(src));
  assert('fails closed on verifier error',
    /Fail CLOSED/i.test(src) && /'verify-error'/.test(src));
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('submitPublicLead invokes verifyTurnstile',
    /verifyTurnstile\(\s*\(req\.body && req\.body\.turnstileToken\)/.test(idx));
}

section('Upstash rate limiter adapter');
{
  const src = read(path.join(FUNCTIONS, 'integrations/upstash-ratelimit.js'));
  assert('exports enforceRateLimit + httpRateLimit',
    /module\.exports\s*=\s*\{[\s\S]*enforceRateLimit[\s\S]*httpRateLimit/.test(src));
  assert('falls back to Firestore limiter when not configured',
    /firestoreLimiter\.enforceRateLimit/.test(src));
  assert('uses pipeline INCR + EXPIRE NX',
    /\['INCR', key\][\s\S]{0,100}\['EXPIRE', key/.test(src));
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('index.js now requires the adapter',
    /require\(['"]\.\/integrations\/upstash-ratelimit['"]\)/.test(idx));
}

section('Measurement adapter');
{
  const src = read(path.join(FUNCTIONS, 'integrations/measurement.js'));
  for (const name of ['requestMeasurement','measurementWebhook']) {
    assert('exports ' + name, new RegExp('exports\\.' + name + '\\s*=').test(src));
  }
  assert('supports hover + eagleview + nearmap',
    /requestHOVER/.test(src) && /requestEagleView/.test(src) && /requestNearmap/.test(src));
  assert('provider selection driven by PROVIDERS.measurement',
    /PROVIDERS\.measurement/.test(src));
}

section('E-sign (BoldSign)');
{
  const src = read(path.join(FUNCTIONS, 'integrations/esign.js'));
  for (const name of ['sendEstimateForSignature','esignWebhook']) {
    assert('exports ' + name, new RegExp('exports\\.' + name + '\\s*=').test(src));
  }
  assert('HMAC-verifies BoldSign webhook signature',
    /createHmac\('sha256', getSecret\('BOLDSIGN_WEBHOOK_SECRET'\)\)/.test(src));
  assert('verifies caller owns the estimate before sending',
    /est\.userId !== uid[\s\S]{0,100}'admin'/.test(src));
}

section('Parcel (Regrid)');
{
  const src = read(path.join(FUNCTIONS, 'integrations/parcel.js'));
  assert('exports lookupParcel', /exports\.lookupParcel\s*=/.test(src));
  assert('caches lookups in parcel_cache',
    /parcel_cache\/\$\{key\}/.test(src));
  assert('90-day TTL constant', /CACHE_TTL_MS\s*=\s*90/.test(src));
}

section('Hail (HailTrace + NOAA SPC)');
{
  const src = read(path.join(FUNCTIONS, 'integrations/hail.js'));
  assert('exports getHailHistory', /exports\.getHailHistory\s*=/.test(src));
  assert('uses NOAA/IEM JSON endpoint',
    /mesonet\.agron\.iastate\.edu/.test(src));
  assert('falls back to NOAA if HailTrace fails',
    /noaa-fallback/.test(src));
}

section('Cal.com webhook');
{
  const src = read(path.join(FUNCTIONS, 'integrations/calcom.js'));
  assert('exports calcomWebhook', /exports\.calcomWebhook\s*=/.test(src));
  assert('HMAC-verifies X-Cal-Signature-256',
    /x-cal-signature-256[\s\S]{0,300}createHmac\('sha256'/.test(src));
  assert('creates appointments + tasks docs',
    /appointments\/\$\{bookingId\}/.test(src) && /collection\('tasks'\)\.add/.test(src));
}

section('Unified client + status endpoint');
{
  const src = read(path.join(PRO_JS, 'integrations-client.js'));
  assert('exposes window.NBDIntegrations', /window\.NBDIntegrations\s*=/.test(src));
  for (const fn of ['requestMeasurement','sendForSignature','lookupParcel','getHailHistory']) {
    assert('NBDIntegrations.' + fn, new RegExp('async function ' + fn + '\\(').test(src));
  }
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('integrationStatus callable exported', /exports\.integrationStatus\s*=/.test(idx));
}

section('Push-3: booking-link SMS uses calcomUsername');
{
  const src = read(path.join(PRO_JS, 'crm.js'));
  assert('_repBookingUrl helper defined',
    /window\._repBookingUrl\s*=\s*function/.test(src));
  assert('sendBookingSMS uses _repBookingUrl',
    /sendBookingSMS[\s\S]{0,300}window\._repBookingUrl\(\)/.test(src));
  assert('sendFollowUpSMS uses _repBookingUrl',
    /sendFollowUpSMS[\s\S]{0,500}window\._repBookingUrl\(\)/.test(src));
  const dash = readDashboard();
  assert('dashboard hydrates _currentRep.calcomUsername on auth',
    /window\._currentRep[\s\S]{0,500}calcomUsername: calVal/.test(dash));
}

section('Push-5: measurement webhook auto-attaches to lead');
{
  const src = read(path.join(FUNCTIONS, 'integrations/measurement.js'));
  assert('webhook writes task on ready transition',
    /measurement_ready[\s\S]{0,5}|collection\('tasks'\)\.add/.test(src));
  assert('webhook writes activity entry',
    /collection\(`leads\/\$\{leadId\}\/activity`\)\.add/.test(src));
  assert('webhook sets lead.measurementReady flag',
    /measurementReady: true/.test(src));
  assert('idempotency guard: checks previous status before writing',
    /wasReadyAlready = measurementData\.status === 'ready'/.test(src));
  const crm = read(path.join(PRO_JS, 'crm.js'));
  assert('kanban card renders measurement chip when l.measurementReady',
    /l\.measurementReady \?/.test(crm));
}

section('Wave A1: deploy runbook');
{
  assert('scripts/deploy-runbook.sh exists',
    fs.existsSync(path.join(ROOT, 'scripts/deploy-runbook.sh')));
  const src = read(path.join(ROOT, 'scripts/deploy-runbook.sh'));
  assert('runbook preflights firebase login',
    /firebase projects:list/.test(src));
  assert('runbook deploys rules + indexes before functions',
    /firestore:rules,firestore:indexes[\s\S]{0,400}firebase deploy --only functions/.test(src));
  assert('runbook runs smoke tests before deploy',
    /Running smoke tests/i.test(src));
  assert('runbook lists required + optional secrets',
    /SECRETS_REQUIRED_FOR_CORE/.test(src) && /SECRETS_RECOMMENDED/.test(src));
}

section('Wave A2: Turnstile widgets');
{
  const helper = read(path.join(ROOT, 'docs/assets/js/public-lead-submit.js'));
  assert('helper loads Turnstile API on demand',
    /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/.test(helper));
  assert('helper attaches turnstileToken to payload',
    /turnstileToken/.test(helper));
  assert('nbdTurnstileExecute exposed on window', /window\.nbdTurnstileExecute/.test(helper));
  const pages = ['docs/index.html','docs/estimate.html','docs/storm-alerts.html','docs/free-guide/index.html'];
  for (const p of pages) {
    assert(p + ' exposes __NBD_TURNSTILE_SITEKEY slot',
      /window\.__NBD_TURNSTILE_SITEKEY/.test(read(path.join(ROOT, p))));
  }
}

section('Wave A3: privacy sub-processor disclosure');
{
  const pv = read(path.join(ROOT, 'docs/privacy.html'));
  for (const vendor of ['Resend','Twilio','Anthropic','BoldSign','HOVER','EagleView','Nearmap','Regrid','HailTrace','Cal.com','Sentry','Cloudflare Turnstile']) {
    assert('privacy lists ' + vendor, new RegExp(vendor.replace('.','\\.'), 'i').test(pv));
  }
}

section('Wave A5: firestore rules tests cover new collections');
{
  const t = read(path.join(ROOT, 'tests/firestore-rules.test.js'));
  for (const coll of ['portal_tokens','parcel_cache','measurements','appointments','audit_log']) {
    assert('rules test covers ' + coll, new RegExp(coll).test(t));
  }
  assert('negative test on public lead direct writes',
    /assertFails\(setDoc\(doc\(anon, 'contact_leads/.test(t));
  assert('company_admin alone cannot write members without ownerId match',
    /Carol has role: company_admin[\s\S]{0,300}assertFails/.test(t));
}

section('Wave C1: signImageUrl replaces imageProxy streaming');
{
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('signImageUrl onRequest exported', /exports\.signImageUrl\s*=/.test(idx));
  assert('signImageUrl issues 15-min signed URL',
    /getSignedUrl[\s\S]{0,200}Date\.now\(\) \+ 15 \* 60_000/.test(idx));
  assert('signImageUrl reuses tenant scoping logic',
    /exports\.signImageUrl[\s\S]*?\['manager', 'company_admin'\]\.includes\(callerRole\)/.test(idx));
  const client = read(path.join(PRO_JS, 'signed-image-url.js'));
  assert('client helper exposes window.NBDSignedUrl', /window\.NBDSignedUrl/.test(client));
  assert('client helper caches signed URLs', /CACHE_TTL_MS/.test(client));
}

section('Wave C2: hail cron');
{
  const src = read(path.join(FUNCTIONS, 'integrations/hail-cron.js'));
  assert('onSchedule declared', /onSchedule\(/.test(src));
  assert('daily schedule', /schedule:\s*'every day/.test(src));
  assert('slack summary posted when newHits > 0',
    /newHits\.length > 0[\s\S]{0,400}postSlackSummary/.test(src));
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('index.js registers hail-cron', /require\(['"]\.\/integrations\/hail-cron['"]\)/.test(idx));
}

section('Wave C4: SMS rate limits');
{
  const src = read(path.join(FUNCTIONS, 'sms-functions.js'));
  assert('sms-functions.js uses Upstash-first adapter',
    /require\(['"]\.\/integrations\/upstash-ratelimit['"]\)/.test(src));
  assert('sendSMS enforces per-recipient cap',
    /sendSMS:to[\s\S]{0,200}toDigits/.test(src));
  assert('sendD2DSMS enforces per-recipient cap',
    /sendD2DSMS[\s\S]{0,2500}sendSMS:to/.test(src));
}

section('Wave C5: Stripe invoice auto-generation');
{
  const src = read(path.join(FUNCTIONS, 'integrations/esign.js'));
  assert('createStripeInvoiceForEstimate defined',
    /async function createStripeInvoiceForEstimate/.test(src));
  assert('webhook calls invoice helper on signed transition',
    /justSigned[\s\S]{0,200}createStripeInvoiceForEstimate/.test(src));
  assert('invoice created as draft (no auto_advance)',
    /auto_advance: false/.test(src));
  assert('idempotent: skips when stripeInvoiceId already set',
    /est\.stripeInvoiceId/.test(src));
}

section('Wave C6: per-lead Claude cost attribution');
{
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('api_usage writes now include leadId', /leadId,\s*\/\/ C6/.test(idx));
  assert('api_usage writes now include feature',
    /feature,\s*\/\/ e\.g\. 'ask-joe'/.test(idx));
  const cp = read(path.join(PRO_JS, 'claude-proxy.js'));
  assert('client auto-attaches leadId from card detail / V2',
    /window\._cardDetailLeadId/.test(cp));
  const ix = read(path.join(ROOT, 'firestore.indexes.json'));
  assert('index for (leadId, timestamp) on api_usage',
    /"collectionGroup":\s*"api_usage"[\s\S]{0,400}"fieldPath":\s*"leadId"[\s\S]{0,200}"fieldPath":\s*"timestamp"[\s\S]{0,100}"order":\s*"DESCENDING"/.test(ix));
}

section('D1: mutation callables rate-limited');
{
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  // B2: callableRateLimit is defined in functions/shared.js and
  // imported by index.js + portal.js. Check both: the helper lives
  // in shared.js, and index.js imports it.
  const shared = read(path.join(FUNCTIONS, 'shared.js'));
  assert('callableRateLimit helper defined (in shared.js)',
    /async function callableRateLimit/.test(shared));
  assert('callableRateLimit imported by index.js',
    /require\(['"]\.\/shared['"]\)/.test(idx) && /callableRateLimit/.test(idx));
  // L-03: portal handlers moved to portal.js (which has its own
  // inlined callableRateLimit). Resolve each function's rate-limit
  // site by searching BOTH files.
  const psrc = read(path.join(FUNCTIONS, 'portal.js'));
  for (const name of ['createPortalToken','revokePortalToken','createTeamMember','updateUserRole','deactivateUser']) {
    const re = new RegExp("callableRateLimit\\(request, '" + name + "'");
    assert(name + ' rate-limited', re.test(idx) || re.test(psrc));
  }
  const meas = read(path.join(FUNCTIONS, 'integrations/measurement.js'));
  assert('requestMeasurement rate-limited',
    /callable:requestMeasurement:uid/.test(meas));
  const es = read(path.join(FUNCTIONS, 'integrations/esign.js'));
  assert('sendEstimateForSignature rate-limited',
    /callable:sendEstimateForSignature:uid/.test(es));
}

section('D2: Storage rules — content-type + size guards');
{
  const src = read(path.join(ROOT, 'storage.rules'));
  assert('isImage helper rejects null content-type',
    /contentType != null[\s\S]{0,200}image\/\(jpeg\|png/.test(src));
  assert('isDocType allowlist covers PDF + Office + text',
    /application\/pdf/.test(src) && /openxmlformats-officedocument/.test(src));
  assert('isHtmlOnly applied to portals path',
    /match \/portals\/\{uid\}\/\{allPaths=\*\*\}[\s\S]{0,300}isHtmlOnly\(\)/.test(src));
  assert('delete rule requires owner or admin on photos',
    /match \/photos\/\{uid\}\/\{allPaths=\*\*\}[\s\S]{0,400}allow delete: if isOwner\(uid\) \|\| isAdmin\(\)/.test(src));
}

section('D3: leads/*/activity subcollection rules');
{
  const src = read(path.join(ROOT, 'firestore.rules'));
  assert('flat-path activity subcollection rule present',
    /match \/activity\/\{activityId\}[\s\S]{0,400}allow create: if isAuth\(\)/.test(src));
  // F-05: rule body grew to include type allowlist + financial-field
  // reject list, so the window widened. `allow update, delete: if false`
  // is still the terminal statement of the match block.
  assert('activity writes restrict update/delete',
    /match \/activity\/\{activityId\}[\s\S]{0,2000}allow update, delete: if false/.test(src));
  assert('activity type allowlist enforced (F-05)',
    /request\.resource\.data\.type in \[[\s\S]*?'note'[\s\S]*?\]/.test(src));
  assert('activity rejects financial webhook fields (F-05)',
    /hasAny\(\[[\s\S]*?'stripeInvoiceId'[\s\S]*?'amountCents'[\s\S]*?\]\)/.test(src));
}

section('D4: audit_log retention cron');
{
  const src = read(path.join(FUNCTIONS, 'integrations/compliance.js'));
  assert('auditLogRetentionCron on a schedule', /exports\.auditLogRetentionCron/.test(src) && /onSchedule/.test(src));
  assert('retention default is 7 years', /7 \* 365/.test(src));
  assert('pages in 500-doc batches', /limit\(500\)/.test(src));
}

section('D5: nightly Firestore backup cron');
{
  const src = read(path.join(FUNCTIONS, 'integrations/compliance.js'));
  assert('nightlyFirestoreBackup on a schedule',
    /exports\.nightlyFirestoreBackup/.test(src) && /every day 04:00/.test(src));
  assert('exports to GCS bucket', /BACKUP_BUCKET/.test(src) && /:exportDocuments/.test(src));
}

section('F-07: Stripe webhook idempotency is atomic');
{
  // L-03 cont.: Stripe handlers moved to functions/stripe.js.
  const src = read(path.join(FUNCTIONS, 'stripe.js'));
  assert('F-07: eventRef.create used for idempotency',
    /eventRef\.create\(\{[\s\S]{0,200}processedAt:/.test(src));
  assert('F-07: ALREADY_EXISTS code handled',
    /e\.code === 6[\s\S]{0,200}duplicate_event/.test(src));
}

section('F-08: Stripe plan derived from price id, not metadata');
{
  // L-03 cont.: Stripe handlers moved to functions/stripe.js.
  const src = read(path.join(FUNCTIONS, 'stripe.js'));
  assert('F-08: in-code PRICE_TO_PLAN map exists',
    /PRICE_TO_PLAN\s*=\s*\{[\s\S]{0,400}STRIPE_PRICE_FOUNDATION[\s\S]{0,200}STRIPE_PRICE_PROFESSIONAL/.test(src));
  assert('F-08: price.metadata.plan no longer trusted for tier',
    !/plan = subscription\.items\.data\[0\]\.price\.metadata\.plan/.test(src));
  assert('F-08: stripeWebhook declares price secrets',
    /stripeWebhook[\s\S]{0,400}secrets:[\s\S]{0,200}STRIPE_PRICE_FOUNDATION[\s\S]{0,100}STRIPE_PRICE_PROFESSIONAL/.test(src));
}

section('F-10: deploy workflow fails loudly on rules/functions errors');
{
  const wf = read(path.join(ROOT, '.github/workflows/firebase-deploy.yml'));
  // Functions deploy must no longer wrap in set +e + exit 0.
  const funcBlock = wf.match(/Deploy Cloud Functions[\s\S]{0,2000}/);
  assert('F-10: functions block found', !!funcBlock);
  if (funcBlock) {
    assert('F-10: functions deploy is NOT wrapped in set +e',
      !/set \+e[\s\S]{0,200}deploy --only functions[\s\S]{0,300}exit 0/.test(funcBlock[0]));
  }
  const storageBlock = wf.match(/Deploy Storage rules[\s\S]{0,1500}/);
  assert('F-10: storage-rules block found', !!storageBlock);
  if (storageBlock) {
    assert('F-10: storage-rules deploy fails loudly',
      !/set \+e[\s\S]{0,200}deploy --only storage[\s\S]{0,300}exit 0/.test(storageBlock[0]));
  }
}

section('D9: new-device sign-in alert');
{
  const src = read(path.join(FUNCTIONS, 'integrations/device-alert.js'));
  assert('registerDeviceFingerprint callable defined',
    /exports\.registerDeviceFingerprint\s*=/.test(src));
  assert('fingerprint is salted hash (uid included)',
    /uid \+ '::' \+ String/.test(src));
  assert('writes audit_log on new device',
    /type: 'new_device_sign_in'/.test(src));
  const rules = read(path.join(ROOT, 'firestore.rules'));
  assert('user_devices locked to admin SDK',
    /match \/user_devices\/\{uid\}[\s\S]{0,200}allow read, write: if false/.test(rules));
  const dash = readDashboard();
  assert('dashboard invokes registerDeviceFingerprint on auth',
    /registerDeviceFingerprint/.test(dash));
}

section('E1: Stripe dunning on payment failed');
{
  // L-03 cont.: Stripe handlers moved to functions/stripe.js.
  const src = read(path.join(FUNCTIONS, 'stripe.js'));
  assert('dunning enqueues email on payment_failed',
    /invoice\.payment_failed[\s\S]{0,3000}email_queue/.test(src));
  assert('dunning writes activity entry when leadId present',
    /invoice\.payment_failed[\s\S]{0,3500}stripe_payment_failed/.test(src));
  assert('dunning posts to Slack',
    /invoice\.payment_failed[\s\S]{0,4000}postSlack/.test(src));
}

section('E2: CI workflow present');
{
  const ci = read(path.join(ROOT, '.github/workflows/ci.yml'));
  assert('CI runs smoke tests',           /node tests\/smoke\.test\.js/.test(ci));
  assert('CI runs firestore rules tests', /firestore-rules\.test\.js/.test(ci));
  assert('CI does a syntax pass',         /node --check/.test(ci));
  assert('CI secret-scans for private keys',
    /PRIVATE KEY/.test(ci) && /sk-ant-/.test(ci) && /sk_live_/.test(ci));
}

section('E3: CODEOWNERS + PR template + Dependabot');
{
  assert('CODEOWNERS exists',      fs.existsSync(path.join(ROOT, '.github/CODEOWNERS')));
  assert('PR template exists',     fs.existsSync(path.join(ROOT, '.github/pull_request_template.md')));
  assert('Dependabot config exists', fs.existsSync(path.join(ROOT, '.github/dependabot.yml')));
  const co = read(path.join(ROOT, '.github/CODEOWNERS'));
  assert('CODEOWNERS covers firestore.rules + storage.rules',
    /firestore\.rules/.test(co) && /storage\.rules/.test(co));
  assert('CODEOWNERS covers functions/integrations/',
    /functions\/integrations\//.test(co));
  const pr = read(path.join(ROOT, '.github/pull_request_template.md'));
  assert('PR template has security self-check',
    /Security self-check/i.test(pr) && /enforceAppCheck/.test(pr));
}

section('E4: service-worker kill switch');
{
  // CSP hotfix: SW bootstrap was inline; now lives in
  // dashboard-sw-bootstrap.js. Use readDashboard() so the regex
  // matches whichever file the kill-switch logic lives in.
  const dash = readDashboard();
  assert('SW bootstrap honors ?nosw=1',  /urlKill = params\.has\('nosw'\)/.test(dash));
  assert('SW bootstrap checks /pro/nosw.txt', /fetch\('\/pro\/nosw\.txt'/.test(dash));
  assert('SW kill unregisters + flushes caches',
    /unregister\(\)[\s\S]{0,200}caches\.delete/.test(dash));
  assert('README-killswitch.md documents the feature',
    fs.existsSync(path.join(ROOT, 'docs/pro/README-killswitch.md')));
}

section('F1: email queue worker');
{
  const src = read(path.join(FUNCTIONS, 'integrations/email-queue-worker.js'));
  assert('emailQueueWorker on a schedule',
    /exports\.emailQueueWorker[\s\S]{0,200}schedule:\s*'every 1 minutes'/.test(src));
  assert('claims rows transactionally',
    /runTransaction[\s\S]{0,400}status:\s*'sending'/.test(src));
  assert('retries up to MAX_ATTEMPTS then marks failed',
    /MAX_ATTEMPTS\s*=\s*5/.test(src) && /'failed'/.test(src));
  const ix = read(path.join(ROOT, 'firestore.indexes.json'));
  assert('index covers email_queue (status, createdAt)',
    /"collectionGroup":\s*"email_queue"[\s\S]{0,300}"fieldPath":\s*"status"[\s\S]{0,200}"fieldPath":\s*"createdAt"/.test(ix));
}

section('F2 / M3: webhooks fail closed (every HTTP webhook signed)');
{
  const es = read(path.join(FUNCTIONS, 'integrations/esign.js'));
  assert('esignWebhook rejects unsigned requests when secret unset',
    /BOLDSIGN_WEBHOOK_SECRET not set[\s\S]{0,200}res\.status\(503\)/.test(es));
  assert('esignWebhook uses timingSafeEqual',
    /crypto\.timingSafeEqual/.test(es));

  const cal = read(path.join(FUNCTIONS, 'integrations/calcom.js'));
  assert('calcomWebhook rejects unsigned requests when secret unset',
    /CALCOM_WEBHOOK_SECRET not set[\s\S]{0,200}res\.status\(503\)/.test(cal));
  assert('calcomWebhook uses timingSafeEqual',
    /crypto\.timingSafeEqual/.test(cal));

  const sms = read(path.join(FUNCTIONS, 'sms-functions.js'));
  assert('incomingSMS verifies Twilio signature via validateRequest',
    /twilio\.validateRequest\(authToken,\s*twilioSignature/.test(sms));
  assert('incomingSMS 403s on signature failure',
    /signature verification failed[\s\S]{0,200}res\.status\(403\)/.test(sms));

  // M3: measurementWebhook completed the sweep — ensure the fix sticks.
  const m = read(path.join(FUNCTIONS, 'integrations/measurement.js'));
  assert('measurementWebhook verifies HMAC (F-02 + M3 regression guard)',
    /verifyWebhookHmac\(provider,\s*req\.rawBody/.test(m));

  // Stripe webhooks: both stripeWebhook and invoiceWebhook must verify.
  // L-03 cont.: Stripe handlers moved to functions/stripe.js.
  const stripeSrc = read(path.join(FUNCTIONS, 'stripe.js'));
  assert('stripeWebhook calls stripe.webhooks.constructEvent',
    /exports\.stripeWebhook[\s\S]{0,4000}stripe\.webhooks\.constructEvent/.test(stripeSrc));
  assert('invoiceWebhook calls stripe.webhooks.constructEvent',
    /exports\.invoiceWebhook[\s\S]{0,4000}stripe\.webhooks\.constructEvent/.test(stripeSrc));
  assert('stripeWebhook requires rawBody Buffer',
    /stripeWebhook[\s\S]{0,2000}!Buffer\.isBuffer\(req\.rawBody\)/.test(stripeSrc));
  assert('invoiceWebhook requires rawBody Buffer',
    /invoiceWebhook[\s\S]{0,2000}!Buffer\.isBuffer\(req\.rawBody\)/.test(stripeSrc));
}

section('F3: TCPA STOP/HELP + opt-out list');
{
  const sms = read(path.join(FUNCTIONS, 'sms-functions.js'));
  assert('STOP keyword adds to sms_opt_outs',
    /STOP_WORDS[\s\S]{0,300}sms_opt_outs\//.test(sms));
  assert('HELP keyword replies with compliance message',
    /HELP_WORDS[\s\S]{0,500}Msg & data rates may apply/.test(sms));
  assert('START keyword resumes (deletes opt-out doc)',
    /START_WORDS[\s\S]{0,300}\.delete\(\)/.test(sms));
  assert('sendSMS checks opt-out list before sending',
    /sms_opt_outs\/'\s*\+ toDigits[\s\S]{0,400}replied STOP/.test(sms));
  const rules = read(path.join(ROOT, 'firestore.rules'));
  assert('sms_opt_outs rules deny client access',
    /match \/sms_opt_outs\/\{phone\}[\s\S]{0,200}allow read, write: if false/.test(rules));
}

section('F4: deploy runbook checks browser keys');
{
  const src = read(path.join(ROOT, 'scripts/deploy-runbook.sh'));
  assert('runbook inspects __NBD_APP_CHECK_KEY',
    /check_browser_key "__NBD_APP_CHECK_KEY"/.test(src));
  assert('runbook inspects __NBD_SENTRY_DSN',
    /check_browser_key "__NBD_SENTRY_DSN"/.test(src));
  assert('runbook inspects __NBD_TURNSTILE_SITEKEY on all public pages',
    /check_browser_key "__NBD_TURNSTILE_SITEKEY"/.test(src));
}

section('F5: Storage rules tests');
{
  assert('storage-rules.test.js exists',
    fs.existsSync(path.join(ROOT, 'tests/storage-rules.test.js')));
  const src = read(path.join(ROOT, 'tests/storage-rules.test.js'));
  assert('tests reject non-image uploads to photos/',
    /assertFails\(uploadBytes[\s\S]{0,200}application\/octet-stream/.test(src));
  assert('tests cross-owner photo reads fail',
    /bob.*photos\/alice|assertFails.*getBytes.*photos\/alice/.test(src));
  const pkg = read(path.join(ROOT, 'tests/package.json'));
  assert('npm run test:storage wired', /test:storage/.test(pkg));
  const ci = read(path.join(ROOT, '.github/workflows/ci.yml'));
  assert('CI runs storage rules tests',
    /storage-rules\.test\.js/.test(ci));
}

section('F6: SECURITY.md');
{
  assert('SECURITY.md exists',
    fs.existsSync(path.join(ROOT, 'SECURITY.md')));
  const src = read(path.join(ROOT, 'SECURITY.md'));
  assert('SECURITY.md has reporting SLA', /First response/i.test(src));
  assert('SECURITY.md documents in-scope surfaces',
    /In scope/i.test(src) && /nobigdeal-pro/.test(src));
  assert('SECURITY.md has key-rotation procedure',
    /Key rotation/i.test(src) && /functions:secrets:set/.test(src));
}

section('C5: Voice Intel retention cron + monitoring + feature flag');
{
  const src = read(path.join(FUNCTIONS, 'integrations/voice-intelligence.js'));
  const client = read(path.join(ROOT, 'docs/pro/js/voice-intelligence.js'));
  const indexes = JSON.parse(read(path.join(ROOT, 'firestore.indexes.json')));

  // Scheduled function
  assert('C5: recordingRetentionCron exported as onSchedule',
    /exports\.recordingRetentionCron\s*=\s*onSchedule/.test(src));
  assert('C5: schedule runs daily at 05:00 (1h after backup cron)',
    /schedule:\s*'every day 05:00'/.test(src));
  assert('C5: two-phase retention — soft-delete then hard-delete',
    /Phase 1: soft-delete[\s\S]{0,3000}Phase 2: hard-delete/.test(src));
  assert('C5: default retention is 90 days',
    /RETENTION_DEFAULT_DAYS = 90/.test(src));
  assert('C5: 30-day grace between soft + hard delete',
    /HARD_DELETE_GRACE_DAYS = 30/.test(src));
  assert('C5: per-company recordingRetentionDays override (bounded 7-3650)',
    /recordingRetentionDays[\s\S]{0,400}d >= 7 && d <= 3650/.test(src));
  assert('C5: hard-delete removes Storage payload BEFORE deleting Firestore doc',
    /bucket\.file\(rec\.audioPath\)\.delete[\s\S]{0,200}d\.ref\.delete\(\)/.test(src));
  assert('C5: hard-delete tolerates missing Storage files (ignoreNotFound)',
    /ignoreNotFound: true/.test(src));

  // Composite indexes for the retention queries
  const byStatusRecordedAt = indexes.indexes.find(i =>
    i.collectionGroup === 'recordings' &&
    i.fields.length === 2 &&
    i.fields[0].fieldPath === 'status' &&
    i.fields[1].fieldPath === 'recordedAt');
  const byStatusHardDeleteAt = indexes.indexes.find(i =>
    i.collectionGroup === 'recordings' &&
    i.fields.length === 2 &&
    i.fields[0].fieldPath === 'status' &&
    i.fields[1].fieldPath === 'hardDeleteAt');
  assert('C5: index (status ASC, recordedAt ASC) for soft-delete sweep', !!byStatusRecordedAt);
  assert('C5: index (status ASC, hardDeleteAt ASC) for hard-delete sweep', !!byStatusHardDeleteAt);

  // Feature flag gate (client module)
  assert('C5: client checks feature_flags/_default.voice_intelligence_enabled',
    /feature_flags[\s\S]{0,200}voice_intelligence_enabled/.test(client));
  assert('C5: per-uid feature_flags override takes precedence',
    /getDoc\(doc\(db, 'feature_flags', uid\)\)[\s\S]{0,400}getDoc\(doc\(db, 'feature_flags', '_default'\)\)/.test(client));
  assert('C5: feature flag fails CLOSED on read error',
    /Fail-CLOSED[\s\S]{0,400}Could not check feature availability/.test(client));
  assert('C5: cleanup plumbs through async mount (mutable closure)',
    /let realCleanup = null;[\s\S]{0,800}realCleanup = instance && instance\.cleanup/.test(client));

  // Monitoring alert
  const alertPath = path.join(ROOT, 'monitoring/alert-voice-processing-failures.json');
  const alert = JSON.parse(read(alertPath));
  assert('C5: monitoring alert policy file valid JSON + displayName',
    alert.displayName && /Voice Intel/.test(alert.displayName));
  assert('C5: alert filter targets onAudioUploaded service',
    (alert.conditions[0].conditionThreshold.filter || '').includes('onAudioUploaded'));
  assert('C5: alert notification channel placeholder present',
    Array.isArray(alert.notificationChannels) && alert.notificationChannels[0].includes('NOTIFICATION_CHANNEL_ID'));
}

section('C4: Voice Intel tab mounted in customer.html');
{
  const html = read(path.join(ROOT, 'docs/pro/customer.html'));
  const css  = read(path.join(ROOT, 'docs/pro/css/voice-intelligence.css'));

  // Jump nav includes the tab
  assert('C4: Voice Intel link in jump-nav',
    /href="#voiceTab"[\s\S]{0,40}Voice Intel/.test(html));
  // Tab content block exists
  assert('C4: voiceTab content div present',
    /id="voiceTab"[\s\S]{0,200}data-label="Voice Intel"/.test(html));
  assert('C4: mount point voiceIntelRoot present',
    /id="voiceIntelRoot"/.test(html));

  // Module script block (ES module import)
  assert('C4: ES module imports initVoiceIntel',
    /import\s*\{\s*initVoiceIntel\s*\}\s*from\s*'\/pro\/js\/voice-intelligence\.js'/.test(html));
  assert('C4: whenReady polls for auth + db + storage + _customerId',
    /window\._customerId[\s\S]{0,200}window\.auth[\s\S]{0,200}window\.db[\s\S]{0,200}window\.storage[\s\S]{0,200}auth\.currentUser/.test(html));
  assert('C4: cleanup wired to beforeunload',
    /beforeunload[\s\S]{0,80}cleanup && cleanup\(\)/.test(html));

  // Stylesheet linked
  assert('C4: voice-intelligence.css linked',
    /css\/voice-intelligence\.css/.test(html));

  // CSS contains the per-status class hooks the module emits
  assert('C4: CSS defines nbd-voice-status-complete',
    /\.nbd-voice-status-complete\s*\{/.test(css));
  assert('C4: CSS defines quarantined_consent status class',
    /\.nbd-voice-status-quarantined_consent\s*\{/.test(css));
  assert('C4: CSS defines consent modal overlay',
    /\.nbd-voice-modal-overlay\s*\{[\s\S]{0,600}position:\s*fixed/.test(css));
  assert('C4: CSS consent modal uses role=dialog compatible z-index',
    /\.nbd-voice-modal-overlay[\s\S]{0,400}z-index:\s*10000/.test(css));
}

section('C3b: Voice Intel client module — UI layer');
{
  const src = read(path.join(ROOT, 'docs/pro/js/voice-intelligence.js'));

  // Recorder state machine
  assert('C3b: createRecorder wraps MediaRecorder',
    /function createRecorder\([\s\S]{0,100}onEvent[\s\S]{0,2000}new MediaRecorder\(/.test(src));
  assert('C3b: recorder releases microphone tracks on stop',
    /releaseStream\(\)[\s\S]{0,200}stream\.getTracks\(\)\.forEach\(t => t\.stop\(\)\)/.test(src));
  assert('C3b: recorder emits typed events (state, tick, error, done)',
    /type: 'state'/.test(src) &&
    /type: 'tick'/.test(src) &&
    /type: 'error'/.test(src) &&
    /type: 'done'/.test(src));
  assert('C3b: recorder checks isTypeSupported before picking MIME',
    /MediaRecorder\.isTypeSupported\(t\)/.test(src));
  assert('C3b: recorder handles NotAllowedError with actionable message',
    /NotAllowedError[\s\S]{0,200}Microphone access was denied/.test(src));
  assert('C3b: recorder requests dataavailable every 1s (no data loss on crash)',
    /rec\.start\(1000\)/.test(src));

  // Consent modal
  assert('C3b: showConsentModal skips for one_party',
    /CONSENT_MODES\.ONE_PARTY[\s\S]{0,100}resolve\(true\)/.test(src));
  assert('C3b: two_party_attested shows checkbox',
    /CONSENT_MODES\.TWO_PARTY_ATTESTED[\s\S]{0,400}nbd-voice-consent-check/.test(src));
  assert('C3b: two_party_verbal shows instruction (not just checkbox)',
    /verbal[\s\S]{0,400}first 20 seconds/i.test(src));
  assert('C3b: modal supports keyboard cancel via click-outside',
    /e\.target === overlay[\s\S]{0,100}close\(false\)/.test(src));

  // DOM / accessibility
  assert('C3b: modal sets role=dialog + aria-modal',
    /role[\s\S]{0,40}dialog[\s\S]{0,100}aria-modal[\s\S]{0,40}true/.test(src));
  assert('C3b: all HTML output escaped via escHtml',
    /function escHtml\(s\)[\s\S]{0,300}&amp;/.test(src));
  assert('C3b: file input accepts audio only',
    /accept="audio\/\*"/.test(src));

  // Main factory
  assert('C3b: initVoiceIntel validates required args',
    /client-init-bad-args[\s\S]{0,200}initVoiceIntel requires/.test(src));
  assert('C3b: initVoiceIntel returns cleanup + getCurrentCallType',
    /cleanup\(\)[\s\S]{0,400}getCurrentCallType\(\)/.test(src));
  assert('C3b: cleanup unsubscribes Firestore listener + cancels active recorder',
    /cleanup\(\)[\s\S]{0,400}unsubscribe && unsubscribe\(\)[\s\S]{0,300}activeRecorder && activeRecorder\.cancel\(\)/.test(src));

  // Recording list render — key fields present
  assert('C3b: list renderer shows status badge + cost + duration',
    /nbd-voice-status[\s\S]{0,2000}fmtSec\(d\.audioDurationSec\)[\s\S]{0,800}fmtCost\(d\.costCents\)/.test(src));
  assert('C3b: complete recordings show summary + transcript details',
    /status === 'complete'[\s\S]{0,4000}nbd-voice-transcript/.test(src));
  assert('C3b: quarantined_consent status is shown with label',
    /quarantined_consent:\s*'Quarantined[\s\S]{0,50}consent/.test(src));
  assert('C3b: insurance details render all four fields when present',
    /insuranceBlock[\s\S]{0,600}carrier[\s\S]{0,200}claimNumber[\s\S]{0,200}adjuster[\s\S]{0,200}deductible/.test(src));
  assert('C3b: red flags rendered with dedicated class (visual distinction)',
    /fieldList\('Red flags',[\s\S]{0,40}'red'\)/.test(src));

  // No window.* pollution, all events addEventListener
  assert('C3b: no inline onclick/onchange in rendered HTML',
    !/onclick=|onchange=|onsubmit=/.test(src));
  assert('C3b: no window.* globals assigned',
    !/window\.[a-zA-Z_]+\s*=/.test(src));
}

section('C3a: Voice Intel client module — data layer');
{
  const src = read(path.join(ROOT, 'docs/pro/js/voice-intelligence.js'));
  // ES module — imports Firebase v10.12.2 modular SDK
  assert('C3a: module imports modular Firestore SDK (not compat)',
    /from 'https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-firestore\.js'/.test(src));
  assert('C3a: module imports modular Storage SDK',
    /from 'https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-storage\.js'/.test(src));

  // Consent mode constants match the server-side rule + pipeline
  assert('C3a: CONSENT_MODES exports all three modes',
    /ONE_PARTY:\s*'one_party'/.test(src) &&
    /TWO_PARTY_ATTESTED:\s*'two_party_attested'/.test(src) &&
    /TWO_PARTY_VERBAL:\s*'two_party_verbal'/.test(src));
  assert('C3a: default consent mode is the SAFE two_party_attested',
    /CONSENT_MODES\.TWO_PARTY_ATTESTED;\s*\/\/\s*safest default/.test(src));
  assert('C3a: unknown consentMode values fall back (no blind trust)',
    /Accept only known values; unknown string → fall back/.test(src));

  // Path shape matches storage.rules
  assert('C3a: uploader builds audio/{uid}/{leadId}/{recordingId}.{ext} path',
    /'audio\/' \+ uid \+ '\/' \+ leadId \+ '\/' \+ recordingId \+ '\.' \+ ext/.test(src));
  assert('C3a: uploader uses uploadBytesResumable (mobile-flake tolerant)',
    /uploadBytesResumable\(/.test(src));

  // Client-side caps mirror server + rule caps
  assert('C3a: MAX_AUDIO_BYTES = 200MB matches server cap',
    /MAX_AUDIO_BYTES = 200 \* 1024 \* 1024/.test(src));
  assert('C3a: MIME allowlist matches isAudioType() in storage.rules',
    /ALLOWED_AUDIO_MIME[\s\S]{0,400}'audio\/webm'[\s\S]{0,400}'audio\/mp4'[\s\S]{0,200}'audio\/m4a'/.test(src));
  assert('C3a: client rejects oversize blob BEFORE upload (fail fast)',
    /blob\.size > MAX_AUDIO_BYTES/.test(src));
  assert('C3a: client rejects non-audio MIME BEFORE upload',
    /ALLOWED_AUDIO_MIME\.some\(/.test(src));

  // Live subscription — order by recordedAt DESC + onSnapshot.
  assert('C3a: recordings query ordered by recordedAt desc',
    /orderBy\('recordedAt', 'desc'\)/.test(src));
  assert('C3a: subscribeToRecordings uses onSnapshot',
    /export function subscribeToRecordings[\s\S]{0,600}onSnapshot\(/.test(src));

  // Server-authoritative note documented
  assert('C3a: code documents that server is still authoritative on consent',
    /SERVER is still authoritative/.test(src));

  // Typed error class
  assert('C3a: VoiceClientError class exported with code field',
    /class VoiceClientError extends Error[\s\S]{0,200}this\.code = code/.test(src));

  // Random ID generator uses crypto
  assert('C3a: newRecordingId uses crypto.getRandomValues',
    /newRecordingId[\s\S]{0,400}crypto\.getRandomValues/.test(src));
}

section('C2: Recording rules + Storage audio path + composite index');
{
  const rules = read(path.join(ROOT, 'firestore.rules'));
  const storage = read(path.join(ROOT, 'storage.rules'));
  const indexes = JSON.parse(read(path.join(ROOT, 'firestore.indexes.json')));

  // Firestore: flat-path recordings subcollection, admin-SDK-only writes.
  assert('C2: /leads/{leadId}/recordings/{recordingId} rule present',
    /match \/recordings\/\{recordingId\}/.test(rules));
  assert('C2: recordings allow read scoped to owner + admin + same-company manager',
    /match \/recordings\/\{recordingId\}[\s\S]{0,500}resource\.data\.userId[\s\S]{0,300}isManager\(\)[\s\S]{0,300}resource\.data\.companyId == myCompanyId\(\)/.test(rules));
  assert('C2: recordings writes blocked at the rule layer (admin SDK only)',
    /match \/recordings\/\{recordingId\}[\s\S]{0,800}allow write: if false/.test(rules));

  // Storage: audio/{uid}/** with mime + size caps.
  assert('C2: audio Storage path owner-keyed',
    /match \/audio\/\{uid\}\/\{allPaths=\*\*\}[\s\S]{0,400}allow read: if isOwner\(uid\)/.test(storage));
  assert('C2: audio upload size capped at 200MB',
    /audio\/\{uid\}\/\{allPaths=\*\*\}[\s\S]{0,500}request\.resource\.size\s*<\s*200\s*\*\s*1024\s*\*\s*1024/.test(storage));
  assert('C2: audio content-type allowlist rejects non-audio uploads',
    /function isAudioType\(\)[\s\S]{0,400}audio\/\(webm\|mpeg\|mp3\|mp4\|m4a\|ogg\|wav\|x-m4a\|aac\)/.test(storage));

  // Composite index: collectionGroup on recordings.
  const recIdx = indexes.indexes.find(i =>
    i.collectionGroup === 'recordings' && i.queryScope === 'COLLECTION_GROUP');
  assert('C2: recordings collectionGroup composite index present',
    !!recIdx);
  if (recIdx) {
    const fieldPaths = recIdx.fields.map(f => f.fieldPath).join(',');
    assert('C2: collectionGroup index is (userId ASC, recordedAt DESC)',
      fieldPaths === 'userId,recordedAt' &&
      recIdx.fields[0].order === 'ASCENDING' &&
      recIdx.fields[1].order === 'DESCENDING');
  }
  // Make sure we didn't re-introduce the single-field COLLECTION index
  // that failed portal_tokens deploy in commit 0c589e5.
  const singleFieldRecIdx = indexes.indexes.find(i =>
    i.collectionGroup === 'recordings' &&
    i.queryScope === 'COLLECTION' &&
    i.fields.length === 1);
  assert('C2: no single-field COLLECTION index on recordings (auto-indexed)',
    !singleFieldRecIdx);
}

section('C1: Voice Intelligence backend pipeline');
{
  const src = read(path.join(FUNCTIONS, 'integrations/voice-intelligence.js'));
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  const shared = read(path.join(FUNCTIONS, 'integrations/_shared.js'));

  // Secrets + provider registry
  assert('C1: GROQ_API_KEY registered in _shared SECRETS',
    /GROQ_API_KEY:\s*defineSecret\('GROQ_API_KEY'\)/.test(shared));
  assert('C1: PROVIDERS.voiceTranscription defaults to groq',
    /voiceTranscription[\s\S]{0,200}NBD_VOICE_TRANSCRIPTION_PROVIDER[\s\S]{0,40}'groq'/.test(shared));

  // State-machine + handlers
  assert('C1: processRecording state machine present',
    /async function processRecording\(/.test(src));
  assert('C1: onAudioUploaded Storage trigger exported',
    /exports\.onAudioUploaded\s*=\s*onObjectFinalized/.test(src));
  assert('C1: triggerProcessRecording admin-only callable',
    /exports\.triggerProcessRecording\s*=\s*onCall[\s\S]{0,500}role !== 'admin'/.test(src));
  assert('C1: reprocessRecording admin-only callable',
    /exports\.reprocessRecording\s*=\s*onCall[\s\S]{0,500}role !== 'admin'/.test(src));

  // Critical idempotency + fail-closed behaviour
  assert('C1: idempotent on already-complete recording',
    /status === 'complete' && !forceReanalyze[\s\S]{0,120}skipped: 'already_complete'/.test(src));
  assert('C1: consent-check failure quarantines the recording',
    /catch \(e\)[\s\S]{0,600}status: 'quarantined_consent'[\s\S]{0,400}quarantined: true/.test(src));
  assert('C1: Storage trigger swallows uncaught errors (no retry storm)',
    /swallowing to prevent retry storm/.test(src));

  // Cost + budget plumbing
  assert('C1: budget gate writes status:failed with actionable message',
    /overBudget[\s\S]{0,400}status: 'failed'[\s\S]{0,200}voice budget exhausted/.test(src));
  assert('C1: usage counters bumped on complete (M2 pattern)',
    /incrementVoiceUsage\(db,\s*\{[\s\S]{0,200}audioSec[\s\S]{0,200}analysisTokens[\s\S]{0,200}costCents/.test(src));
  assert('C1: Claude model pinned to haiku (no Opus drift)',
    /VOICE_ANALYSIS_MODEL\s*=\s*'claude-haiku-4-5-20251001'/.test(src));

  // Wire-up
  assert('C1: voice-intelligence required in index.js',
    /require\('\.\/integrations\/voice-intelligence'\)/.test(idx));
  assert('C1: voice-intelligence exports Object.assign\'d into exports',
    /Object\.assign\(exports,\s*voiceIntelligenceIntegration\)/.test(idx));
}

section('R-05: hot-path Cloud Function sizing for 10k-user spike');
{
  // L-03 cont.: Stripe handlers moved to functions/stripe.js. Scan
  // both files so hot-path sizing asserts work no matter which
  // module owns the handler today.
  const src = read(path.join(FUNCTIONS, 'index.js'))
    + '\n' + read(path.join(FUNCTIONS, 'stripe.js'));

  // Helper: extract the {…} config-object immediately following
  // `exports.FNAME = onRequest(` in source order. We match the
  // literal lines rather than invoking the function so this stays
  // dependency-free.
  function configOf(fnName) {
    const re = new RegExp(
      'exports\\.' + fnName
      + '\\s*=\\s*onRequest\\(\\s*\\{([\\s\\S]*?)\\}\\s*,',
      'm'
    );
    const m = src.match(re);
    return m ? m[1] : null;
  }
  function intField(block, field) {
    if (!block) return null;
    // Strip line comments so we don't match commentary numbers
    // like "Old 100×80 = 8k".
    const clean = block.replace(/\/\/[^\n]*/g, '');
    const m = clean.match(new RegExp('\\b' + field + ':\\s*(\\d+)'));
    return m ? Number(m[1]) : null;
  }

  const claude = configOf('claudeProxy');
  assert('R-05: claudeProxy maxInstances >= 200 (quota cap: us-central1 200k mCPU; request quota increase to raise)',
    intField(claude, 'maxInstances') >= 200,
    'got ' + intField(claude, 'maxInstances'));
  assert('R-05: claudeProxy minInstances >= 3 (cold-start absorption)',
    intField(claude, 'minInstances') >= 3,
    'got ' + intField(claude, 'minInstances'));
  assert('R-05: claudeProxy concurrency still 80',
    intField(claude, 'concurrency') === 80);

  const sign = configOf('signImageUrl');
  assert('R-05: signImageUrl maxInstances >= 200 (photo-render spike)',
    intField(sign, 'maxInstances') >= 200,
    'got ' + intField(sign, 'maxInstances'));
  assert('R-05: signImageUrl minInstances >= 2',
    intField(sign, 'minInstances') >= 2);
  assert('R-05: signImageUrl concurrency >= 80',
    intField(sign, 'concurrency') >= 80);

  const subStatus = configOf('getSubscriptionStatus');
  assert('R-05: getSubscriptionStatus maxInstances >= 200 (page-load spike)',
    intField(subStatus, 'maxInstances') >= 200,
    'got ' + intField(subStatus, 'maxInstances'));
  assert('R-05: getSubscriptionStatus minInstances >= 2',
    intField(subStatus, 'minInstances') >= 2);

  // L-03: getHomeownerPortalView moved to portal.js. Look there
  // first; fall back to the index.js helper if a future refactor
  // moves it back.
  const portalSrc = read(path.join(FUNCTIONS, 'portal.js'));
  const portalRe = /exports\.getHomeownerPortalView\s*=\s*onRequest\(\s*\{([\s\S]*?)\}\s*,/m;
  const portalMatch = portalSrc.match(portalRe);
  const portal = portalMatch ? portalMatch[1] : configOf('getHomeownerPortalView');
  assert('R-05: getHomeownerPortalView maxInstances >= 80 (email-blast burst)',
    intField(portal, 'maxInstances') >= 80);

  const checkout = configOf('createCheckoutSession');
  assert('R-05: createCheckoutSession maxInstances >= 50 (conversion funnel)',
    intField(checkout, 'maxInstances') >= 50);

  const stripe = configOf('stripeWebhook');
  assert('R-05: stripeWebhook maxInstances >= 20 (bulk billing / retries)',
    intField(stripe, 'maxInstances') >= 20);

  // Anti-brute endpoints must STAY tight — bumping these defeats
  // the rate-limit floor they enforce.
  const vcode = configOf('validateAccessCode');
  if (vcode) {
    assert('R-05: validateAccessCode stays tight (maxInstances <= 10)',
      intField(vcode, 'maxInstances') <= 10,
      'got ' + intField(vcode, 'maxInstances') + ' — loosening defeats anti-brute');
  }
}

section('L-01: admin/index.html markup no longer advertises an admin surface');
{
  const src = read(path.join(ROOT, 'docs/admin/index.html'));
  assert('L-01: title is generic (not "NBD Admin")',
    !/<title>\s*NBD Admin\s*<\/title>/i.test(src));
  assert('L-01: og:url admin path removed',
    !/<meta property="og:url"[^>]*\/admin/i.test(src));
  // The noindex signal still has to be present at the markup level
  // (Firebase Hosting also sets X-Robots-Tag but the meta survives
  // if someone views-source in devtools).
  assert('L-01: noindex,nofollow meta preserved',
    /<meta name="robots" content="noindex,\s*nofollow"/i.test(src));
}

section('L-02: retired Cloudflare Worker stub removed from repo');
{
  assert('L-02: workers/nbd-ai-proxy.js is gone',
    !fs.existsSync(path.join(ROOT, 'workers/nbd-ai-proxy.js')));
  assert('L-02: workers/wrangler.toml is gone',
    !fs.existsSync(path.join(ROOT, 'workers/wrangler.toml')));
  assert('L-02: workers/ directory is gone (no stray files)',
    !fs.existsSync(path.join(ROOT, 'workers')));
  const sec = read(path.join(ROOT, 'SECURITY.md'));
  assert('L-02: SECURITY.md documents the retirement + CF-dashboard ops step',
    /Retired surfaces[\s\S]{0,600}nbd-ai-proxy[\s\S]{0,600}Cloudflare dashboard/.test(sec));
}

section('L-03: portal handlers extracted to functions/portal.js');
{
  const portalPath = path.join(FUNCTIONS, 'portal.js');
  assert('L-03: functions/portal.js exists', fs.existsSync(portalPath));
  if (fs.existsSync(portalPath)) {
    assert('L-03: portal.js parses cleanly', syntaxCheck(portalPath).ok);
    const psrc = read(portalPath);
    assert('L-03: portal.js exports createPortalToken',
      /exports\.createPortalToken\s*=\s*onCall/.test(psrc));
    assert('L-03: portal.js exports revokePortalToken',
      /exports\.revokePortalToken\s*=\s*onCall/.test(psrc));
    assert('L-03: portal.js exports getHomeownerPortalView',
      /exports\.getHomeownerPortalView\s*=\s*onRequest/.test(psrc));
    assert('L-03: portal.js is self-contained (does not require ../index)',
      !/require\(['"]\.\.\/index['"]\)/.test(psrc));
  }
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('L-03: index.js loads portal.js via require + Object.assign',
    /require\(['"]\.\/portal['"]\)/.test(idx)
    && /Object\.assign\(exports,\s*portalFunctions\)/.test(idx));
  // The portal handlers must NOT be defined inline in index.js any
  // more — duplicate exports would cause Firebase deploy to collide.
  assert('L-03: createPortalToken no longer defined inline in index.js',
    !/exports\.createPortalToken\s*=\s*onCall/.test(idx));
  assert('L-03: revokePortalToken no longer defined inline in index.js',
    !/exports\.revokePortalToken\s*=\s*onCall/.test(idx));
  assert('L-03: getHomeownerPortalView no longer defined inline in index.js',
    !/exports\.getHomeownerPortalView\s*=\s*onRequest/.test(idx));
}

section('B2: shared authz + rate-limit helpers');
{
  const sharedPath = path.join(FUNCTIONS, 'shared.js');
  assert('B2: functions/shared.js exists', fs.existsSync(sharedPath));
  if (fs.existsSync(sharedPath)) {
    const ssrc = read(sharedPath);
    assert('B2: shared.js parses cleanly', syntaxCheck(sharedPath).ok);
    assert('B2: shared.js exports callableRateLimit',
      /exports\.callableRateLimit\s*=|module\.exports\s*=\s*\{[\s\S]*?callableRateLimit/.test(ssrc));
    assert('B2: shared.js exports requirePaidSubscription',
      /exports\.requirePaidSubscription\s*=|module\.exports\s*=\s*\{[\s\S]*?requirePaidSubscription/.test(ssrc));
    // Live-load the module and verify the functions are callable.
    const s = require(sharedPath);
    assert('B2: callableRateLimit is a function', typeof s.callableRateLimit === 'function');
    assert('B2: requirePaidSubscription is a function', typeof s.requirePaidSubscription === 'function');
    // callableRateLimit on an unauthenticated request should no-op
    // (uid is missing → early return, no throw). Exercises the guard.
    (async () => {
      try {
        await s.callableRateLimit({ auth: null }, 'test', 1, 1000);
      } catch (e) {
        assert('B2: callableRateLimit is a no-op on unauth', false, 'threw ' + e.message);
      }
    })();
    // requirePaidSubscription on an unauthenticated caller returns
    // {ok:false, 401} without touching Firestore.
    (async () => {
      const stubDb = { doc: () => { throw new Error('Firestore should not be touched for unauth'); } };
      const res = await s.requirePaidSubscription(stubDb, null);
      assert('B2: requirePaidSubscription rejects unauth before Firestore',
        res && res.ok === false && res.status === 401);
    })();
  }

  // Migration: the three callers (index.js, portal.js, sms-functions.js)
  // must now import from shared, NOT define their own inline copies.
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('B2: index.js imports callableRateLimit from ./shared',
    /require\(['"]\.\/shared['"]\)[\s\S]{0,200}callableRateLimit/.test(idx)
    || /\{[^}]*callableRateLimit[^}]*\}\s*=\s*require\(['"]\.\/shared['"]\)/.test(idx));
  assert('B2: index.js no longer defines callableRateLimit inline',
    !/async function callableRateLimit\s*\(/.test(idx));

  const psrc = read(path.join(FUNCTIONS, 'portal.js'));
  assert('B2: portal.js imports callableRateLimit from ./shared',
    /require\(['"]\.\/shared['"]\)/.test(psrc)
    && /callableRateLimit/.test(psrc));
  assert('B2: portal.js no longer defines callableRateLimit inline',
    !/async function callableRateLimit\s*\(/.test(psrc));

  const sms = read(path.join(FUNCTIONS, 'sms-functions.js'));
  assert('B2: sms-functions.js imports requirePaidSubscription from ./shared',
    /require\(['"]\.\/shared['"]\)[\s\S]{0,200}requirePaidSubscription/.test(sms)
    || /\{[^}]*requirePaidSubscription[^}]*\}\s*=\s*require\(['"]\.\/shared['"]\)/.test(sms));
  assert('B2: sms-functions.js no longer defines requirePaidSubscription inline',
    !/async function requirePaidSubscription\s*\(/.test(sms));
}

section('L-03 cont.: Stripe handlers extracted to functions/stripe.js');
{
  const stripePath = path.join(FUNCTIONS, 'stripe.js');
  assert('Stripe: functions/stripe.js exists', fs.existsSync(stripePath));
  if (fs.existsSync(stripePath)) {
    assert('Stripe: stripe.js parses cleanly', syntaxCheck(stripePath).ok);
    const s = read(stripePath);
    for (const name of [
      'createCheckoutSession', 'stripeWebhook', 'createCustomerPortalSession',
      'getSubscriptionStatus', 'createStripePaymentLink', 'invoiceWebhook',
    ]) {
      assert('Stripe: stripe.js exports ' + name,
        new RegExp('exports\\.' + name + '\\s*=\\s*onRequest').test(s));
    }
    assert('Stripe: stripe.js is self-contained (no require("../index"))',
      !/require\(['"]\.\.\/index['"]\)/.test(s));
    assert('Stripe: stripe.js imports requireAuth from ./shared',
      /require\(['"]\.\/shared['"]\)/.test(s) && /requireAuth/.test(s));
    assert('Stripe: stripe.js imports httpRateLimit from the upstash adapter',
      /require\(['"]\.\/integrations\/upstash-ratelimit['"]\)/.test(s));
  }
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('Stripe: index.js loads stripe.js via require + Object.assign',
    /require\(['"]\.\/stripe['"]\)/.test(idx)
    && /Object\.assign\(exports,\s*stripeFunctions\)/.test(idx));
  // None of the six handlers may be defined inline in index.js any
  // more — duplicate exports would make Firebase deploy collide.
  for (const name of [
    'createCheckoutSession', 'stripeWebhook', 'createCustomerPortalSession',
    'getSubscriptionStatus', 'createStripePaymentLink', 'invoiceWebhook',
  ]) {
    assert('Stripe: ' + name + ' no longer defined inline in index.js',
      !new RegExp('exports\\.' + name + '\\s*=\\s*onRequest').test(idx));
  }
}

section('M1 pilot: /admin/index.html drops unsafe-inline (script-src + style-src)');
{
  const fb = JSON.parse(read(path.join(ROOT, 'firebase.json')));
  // Find the per-page CSP header for /admin/index.html. Hosting
  // applies the most-specific source's header value; this entry
  // overrides the global **/*.html CSP for this exact path.
  const entry = (fb.hosting.headers || [])
    .find(h => h.source === '/admin/index.html');
  assert('M1: per-page CSP entry exists for /admin/index.html', !!entry);
  if (entry) {
    const csp = (entry.headers || [])
      .find(h => h.key === 'Content-Security-Policy');
    assert('M1: /admin/index.html has a Content-Security-Policy header', !!csp);
    if (csp) {
      // Parse out the directives so a future header reorder doesn't
      // false-pass the assertions.
      const directives = Object.fromEntries(csp.value
        .split(';')
        .map(s => s.trim())
        .filter(Boolean)
        .map(d => {
          const [name, ...vals] = d.split(/\s+/);
          return [name, vals];
        }));
      assert('M1: script-src has no \'unsafe-inline\'',
        Array.isArray(directives['script-src'])
        && !directives['script-src'].includes("'unsafe-inline'"));
      assert('M1: style-src has no \'unsafe-inline\'',
        Array.isArray(directives['style-src'])
        && !directives['style-src'].includes("'unsafe-inline'"));
      assert('M1: object-src is locked to none',
        Array.isArray(directives['object-src'])
        && directives['object-src'].includes("'none'"));
      assert('M1: base-uri is locked to none',
        Array.isArray(directives['base-uri'])
        && directives['base-uri'].includes("'none'"));
    }
  }
  // The page itself must not regress to inline-script / inline-style
  // usage — those would silently break under the strict CSP.
  const page = read(path.join(ROOT, 'docs/admin/index.html'));
  assert('M1: /admin/index.html still has zero inline <script> bodies',
    !/<script[^>]*>[^\s<]/.test(page));
  assert('M1: /admin/index.html still has zero on*= event handlers',
    !/\bon[a-z]+=/.test(page));
  assert('M1: /admin/index.html still has zero style="..." attrs',
    !/style="/.test(page));
  assert('M1: /admin/index.html still has zero <style> blocks',
    !/<style[ >]/.test(page));
}

section('Registry drift: every owner-keyed rule has a FLAT_USER_COLLECTIONS entry');
{
  // M-01/M-02 follow-up. The canonical user-owned registry at
  // functions/integrations/user-owned.js is consumed by both the
  // erasure cascade and the GDPR export. Any new top-level Firestore
  // collection added with `isOwner(resource.data.userId)` (or
  // .createdBy) authorization must also land in the registry — or
  // erasure leaves the user's data behind, and Article-20 export
  // misses it entirely.
  //
  // This sweep fails CI if any owner-keyed top-level match block in
  // firestore.rules names a collection that isn't in either the
  // registry's FLAT_USER_COLLECTIONS or the explicit exclusion list
  // below. Adding an exclusion is a deliberate design decision —
  // document the reason inline so a future reader sees the intent.

  const rules = read(path.join(ROOT, 'firestore.rules'));
  const registry = require(path.join(FUNCTIONS, 'integrations/user-owned.js'));
  const registered = new Set(registry.FLAT_USER_COLLECTIONS.map(s => s.name));

  // Top-level match blocks live at indent depth 4 (the
  // `match /databases/.../documents {` block opens at depth 2).
  // Capture each `    match /COLL/{<id>} {` line and its body, where
  // the body runs until the matching close-brace at the same indent.
  const lines = rules.split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^    match \/([a-zA-Z_]+)\/\{[a-zA-Z]+\}\s*\{?\s*$/);
    if (!m) continue;
    const coll = m[1];
    // Walk forward to find the closing brace at the same indent.
    let depth = 1;
    let j = i + 1;
    for (; j < lines.length; j++) {
      const opens = (lines[j].match(/\{/g) || []).length;
      const closes = (lines[j].match(/\}/g) || []).length;
      depth += opens - closes;
      if (depth <= 0) break;
    }
    blocks.push({ coll, body: lines.slice(i, j + 1).join('\n') });
  }

  // Every top-level rule whose authz consults resource.data.userId
  // or resource.data.createdBy belongs to a user-owned collection.
  const ownerKeyedColls = blocks
    .filter(b => /isOwner\(resource\.data\.(userId|createdBy)\)/.test(b.body))
    .map(b => b.coll);

  // Intentional exclusions: collections whose authz uses owner-keyed
  // shape but that we deliberately do NOT include in the GDPR registry.
  // Audit trails + admin-only writes survive erasure on purpose.
  // None today; placeholder list documents the exclusion mechanism for
  // future schema additions.
  const REGISTRY_EXCLUSIONS = new Set([
    // Example shape (uncomment and document if a real exclusion appears):
    // 'audit_log_writes', // append-only audit trail; survives erasure by design
  ]);

  const missing = ownerKeyedColls.filter(c =>
    !registered.has(c) && !REGISTRY_EXCLUSIONS.has(c));

  assert('Registry: every owner-keyed top-level rule has a FLAT_USER_COLLECTIONS entry',
    missing.length === 0,
    missing.length
      ? 'missing from registry: ' + missing.join(', ')
        + '. Add to FLAT_USER_COLLECTIONS in functions/integrations/user-owned.js'
        + ' OR add to REGISTRY_EXCLUSIONS in this test with a documented reason.'
      : '');

  // Sanity: our sweep should be finding SOMETHING. If the regex breaks
  // or rules.txt format changes, this catches a silently-empty result.
  assert('Registry: sweep observed at least 15 owner-keyed collections',
    ownerKeyedColls.length >= 15,
    'observed ' + ownerKeyedColls.length + ' (regex may be broken)');

  // Inverse direction (informational only — does not fail CI):
  // collections in the registry that no longer have a matching rule.
  // A registry entry without a rule isn't dangerous (erasure just
  // queries an empty/non-existent collection), but it's a stale-list
  // signal worth surfacing for a future cleanup.
  const stale = registry.FLAT_USER_COLLECTIONS
    .map(s => s.name)
    .filter(name => !blocks.some(b => b.coll === name));
  if (stale.length > 0) {
    console.log('  ℹ  Registry has ' + stale.length
      + ' entries with no matching rule (informational): '
      + stale.join(', '));
  }
}

// ── SEO: every blog post appears in sitemap.xml ─────────────
// Blog posts are the top-of-funnel SEO engine — a new post that
// doesn't land in the sitemap stays uncrawled by Google until
// someone notices (weeks later). This check keeps sitemap.xml
// honest against docs/blog/*.html and fails loud the moment a
// post lands in one without the other.
section('SEO: every /docs/blog/*.html has a sitemap entry');
{
  const sitemapPath = path.join(ROOT, 'docs/sitemap.xml');
  if (fs.existsSync(sitemapPath)) {
    const sitemap = fs.readFileSync(sitemapPath, 'utf8');
    const blogDir = path.join(ROOT, 'docs/blog');
    const posts = fs.readdirSync(blogDir)
      .filter(f => f.endsWith('.html') && f !== 'index.html');
    for (const file of posts) {
      const slug = file.replace(/\.html$/, '');
      assert('sitemap has /blog/' + slug, sitemap.includes('/blog/' + slug));
    }
  } else {
    assert('sitemap.xml exists at docs/sitemap.xml', false);
  }
}

section('Service worker — root /sw.js is a self-unregistering stub');
{
  // /sw.js (root scope `/`) is INTENTIONALLY a stub that unregisters
  // itself on activate. Devices that registered the old broken SW back
  // when it was a full caching SW are evicted here; the only SW we
  // maintain now is /pro/sw.js (scope `/pro/`). The previous version of
  // these tests checked for CACHE_VERSION + a cross-origin fetch bypass,
  // but those patterns belong to the OLD architecture and were removed
  // deliberately when /sw.js was stubbed out (see the comment at the
  // top of the file). These tests now verify the stub is intact.
  const sw = read(path.join(ROOT, 'docs/sw.js'));
  assert('root /sw.js skipWaiting() on install (so the new stub takes over fast)',
    /addEventListener\(['"]install['"][\s\S]{0,200}skipWaiting/.test(sw),
    'install handler must call self.skipWaiting()');
  assert('root /sw.js clears caches + unregisters on activate',
    /addEventListener\(['"]activate['"][\s\S]*caches\.delete[\s\S]*registration\.unregister/.test(sw),
    'activate handler must delete all caches and unregister this SW');
  assert('root /sw.js has NO fetch handler (passthrough by design)',
    !/addEventListener\(['"]fetch['"]/.test(sw),
    'a fetch handler would defeat the purpose of the unregister stub');
}

section('Per-route rate-limit policy');
{
  const policy = read(path.join(ROOT, 'functions/rate-limit-policy.js'));
  // Public surface: declarative ROUTES table + two wrappers.
  assert('rate-limit-policy exports ROUTES + guardCallable + guardHttp',
    /module\.exports\s*=\s*\{[\s\S]*ROUTES,[\s\S]*guardCallable,[\s\S]*guardHttp/.test(policy));
  // Default policy: when a route name isn't in ROUTES, the wrapper
  // applies a safe default AND emits a structured warning so the gap
  // shows up in Cloud Logging instead of going unenforced.
  assert('policyFor falls back to DEFAULT_POLICY + emits structured warning',
    /logger\(\)\.warn\(['"]rate_limit_no_policy['"]/.test(policy)
    && /DEFAULT_POLICY/.test(policy));
  // Both ceilings are enforced — per-IP first (cheaper denial), then
  // per-uid. Specifically: the wrapper must NOT skip uid enforcement
  // when an IP check passes. The :ip enforce call must precede :uid.
  {
    const guardBody = (policy.match(/function guardCallable[\s\S]+?\n\}/) || ['',''])[0];
    const ipPos  = guardBody.indexOf("enforceRateLimit(name + ':ip'");
    const uidPos = guardBody.indexOf("enforceRateLimit(name + ':uid'");
    assert('guardCallable enforces per-IP THEN per-uid (both, not either-or)',
      ipPos > -1 && uidPos > -1 && ipPos < uidPos,
      'expected ip enforce to appear before uid enforce in guardCallable');
  }
  // 429 path on the HTTP wrapper sets Retry-After honestly.
  assert('guardHttp 429 path sets Retry-After header',
    /Retry-After[\s\S]{0,200}retryAfterMs/.test(policy));
  // High-risk routes have explicit ceilings (claudeProxy +
  // submitPublicLead must never silently fall to the default).
  assert('high-risk routes have explicit policy entries',
    /claudeProxy:\s*\{/.test(policy)
    && /submitPublicLead:\s*\{/.test(policy)
    && /publicVisualizerAI:\s*\{/.test(policy)
    && /validateAccessCode:\s*\{/.test(policy));
  // Anonymous CSP report sink must not be uid-locked (uidLimit:0 →
  // bypass the uid branch since unauthenticated browsers POST it).
  assert('cspReport policy is per-IP only (uidLimit:0)',
    /cspReport:\s*\{[^}]*uidLimit:\s*0/.test(policy));
  // The matrix accessor returns a frozen snapshot — caller can't
  // mutate live policy at runtime.
  assert('getRateLimitMatrix returns Object.freeze snapshot',
    /function getRateLimitMatrix[\s\S]{0,300}Object\.freeze/.test(policy));
}

section('Migration framework — versioned runner');
{
  const runner = read(path.join(ROOT, 'functions/migrations/runner.js'));
  const idx = read(FUNCTIONS + '/index.js');
  const m001 = read(path.join(ROOT, 'functions/migrations/scripts/001-noop-init.js'));

  // Public Cloud Function exports — manual + scheduled.
  assert('runner exposes runMigrations onCall + migrationsTick onSchedule',
    /exports\.runMigrations\s*=\s*onCall/.test(runner)
    && /exports\.migrationsTick\s*=\s*onSchedule/.test(runner));
  // index.js wires them up so they actually deploy.
  assert('functions/index.js wires runMigrations + migrationsTick',
    /exports\.runMigrations\s*=\s*_migrations\.runMigrations/.test(idx)
    && /exports\.migrationsTick\s*=\s*_migrations\.migrationsTick/.test(idx));
  // The state doc + history collection paths are stable — migrations
  // depend on them. Pinning here so a typo in runner gets caught.
  assert('runner uses /system/migrations as the state doc',
    /STATE_DOC_PATH\s*=\s*['"]system\/migrations['"]/.test(runner));
  // 001 must be the seed migration so the first deploy doesn't fail
  // trying to run real-data migrations against an empty state doc.
  assert('001 noop-init scaffolds the migration framework',
    /exports\.version\s*=\s*1[\s\S]{0,100}exports\.name\s*=\s*['"]noop-init['"]/.test(m001));
  // Loader rejects duplicates + bad shape — defensive against a
  // future migration committed without all three required fields.
  assert('runner rejects duplicate versions + bad shape',
    /Duplicate migration version/.test(runner)
    && /must export \{ version:/.test(runner));
  // backfillField helper is the canonical "for every doc in coll X,
  // set Y if missing" pattern (the PR #56 companyId backfill shape).
  assert('runner exposes idempotent backfillField helper',
    /async function backfillField\(db, collectionPath, fieldName/.test(runner)
    && /data\[fieldName\] !== undefined && data\[fieldName\] !== null/.test(runner));
  // Failure path: stops the chain, persists lastError for ops review,
  // does NOT advance appliedVersion — next tick retries from the
  // failed migration.
  assert('runner stops on first failure + records lastError',
    /lastFailedVersion:\s*m\.version/.test(runner)
    && /break;/.test(runner));
}

section('Phase D.3 — integrationStatus secret-readout completeness');
{
  const idx = read(path.join(ROOT, 'functions/index.js'));
  const sh = read(path.join(ROOT, 'functions/integrations/_shared.js'));
  // Every secret declared in _shared.js SECRETS should appear in the
  // integrationStatus.configured map (or be intentionally aggregated
  // into a parent key like upstash). Lists every secret name + the
  // rule.
  const declared = (sh.match(/[A-Z_]+:\s*defineSecret\('([A-Z_]+)'\)/g) || [])
    .map(s => s.match(/'([A-Z_]+)'/)[1]);
  const configuredBlock = (idx.match(/configured:\s*\{[\s\S]*?\},?\s*rateLimitProvider/) || [''])[0];
  // These are intentionally aggregated under a single key.
  const AGGREGATED = new Set(['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN']);
  const missing = declared.filter(name => {
    if (AGGREGATED.has(name)) return false;
    return !configuredBlock.includes("'" + name + "'");
  });
  assert('integrationStatus.configured covers every declared secret',
    missing.length === 0,
    'expected every secret in _shared.js to appear in the configured readout; missing: ' + missing.join(', '));
  // Spot-check the new D.3 additions
  for (const k of ['hoverWebhook','eagleviewWebhook','boldsignWebhook','groq']) {
    assert('configured.' + k + ' present in integrationStatus',
      new RegExp('\\b' + k + ':\\s+_hasInt').test(idx),
      'expected configured.' + k);
  }
  assert('integrationStatus exposes rotationRunbook URL',
    /rotationRunbook:\s*'https:\/\/github\.com\/jdealtia-sys\/nobigdealwithjoedeal\.com\/blob\/main\/SECRET_ROTATION\.md'/.test(idx),
    'expected rotationRunbook URL in the response so admin UI can deep-link');
}

};
