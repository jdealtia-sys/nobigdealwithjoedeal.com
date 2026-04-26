/**
 * smoke.test.js — dependency-free static smoke tests
 *
 * Exercises the critical dashboard JS files without a browser:
 *   - parses cleanly (Node.js syntax check)
 *   - exposes the expected window globals (regex scan)
 *   - bundle maps are internally consistent
 *
 * Intentionally zero deps. Run:
 *   node tests/smoke.test.js
 *
 * Exit code 0 = pass, non-zero = fail. No framework needed.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PRO_JS = path.join(ROOT, 'docs/pro/js');
const FUNCTIONS = path.join(ROOT, 'functions');

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, cond, detail) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + label);
  } else {
    failed++;
    failures.push(label + (detail ? ' — ' + detail : ''));
    console.log('  ✗ ' + label + (detail ? ' — ' + detail : ''));
  }
}

function section(name) { console.log('\n' + name); }

function read(file) { return fs.readFileSync(file, 'utf8'); }

function syntaxCheck(file) {
  try {
    execSync(`node --check "${file}"`, { stdio: 'pipe' });
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e.stderr ? e.stderr.toString() : e.message };
  }
}

// ── Syntax sanity on the files we care about ────────────────
section('Syntax checks');
const syntaxFiles = [
  path.join(PRO_JS, 'script-loader.js'),
  path.join(PRO_JS, 'admin-manager.js'),
  path.join(PRO_JS, 'crm.js'),
  path.join(PRO_JS, 'maps.js'),
  path.join(PRO_JS, 'estimates.js'),
  path.join(PRO_JS, 'estimate-v2-ui.js'),
  path.join(PRO_JS, 'estimate-finalization.js'),
  path.join(PRO_JS, 'nbd-doc-viewer.js'),
  path.join(FUNCTIONS, 'index.js')
];
for (const f of syntaxFiles) {
  const result = syntaxCheck(f);
  assert('parses ' + path.relative(ROOT, f), result.ok, result.err && result.err.split('\n')[0]);
}

// ── ScriptLoader public API ──────────────────────────────────
section('ScriptLoader contract');
{
  const src = read(path.join(PRO_JS, 'script-loader.js'));
  assert('registers window.ScriptLoader', /window\.ScriptLoader\s*=/.test(src));
  assert('exposes load()',            /\bload\s*[,:]/.test(src));
  assert('exposes loadBundle()',      /\bloadBundle\s*[,:]/.test(src));
  assert('exposes preloadForView()',  /\bpreloadForView\s*[,:]/.test(src));
  assert('exposes markLoaded()',      /\bmarkLoaded\s*[,:]/.test(src));
  assert('defines BUNDLES table',     /const\s+BUNDLES\s*=/.test(src));
  assert('defines VIEW_BUNDLES map',  /const\s+VIEW_BUNDLES\s*=/.test(src));

  // Every view in VIEW_BUNDLES must reference a bundle that exists
  const bundleMatch  = src.match(/const BUNDLES\s*=\s*\{([\s\S]*?)\};/);
  const viewsMatch   = src.match(/const VIEW_BUNDLES\s*=\s*\{([\s\S]*?)\};/);
  const bundleNames  = bundleMatch ? [...bundleMatch[1].matchAll(/^\s*(\w+):\s*\[/gm)].map(m => m[1]) : [];
  const viewRefs     = viewsMatch  ? [...viewsMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]).filter(n => !/^[a-z]+_bundles$/.test(n)) : [];
  // Crude but effective: every bareword quoted string in VIEW_BUNDLES that
  // appears AFTER `[` should be a bundle name. Walk each line and compare.
  const orphans = [];
  for (const line of viewsMatch ? viewsMatch[1].split('\n') : []) {
    const inBrackets = line.match(/\[([^\]]*)\]/);
    if (!inBrackets) continue;
    const refs = [...inBrackets[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
    for (const r of refs) if (!bundleNames.includes(r)) orphans.push(r);
  }
  assert('all view bundles reference real bundles', orphans.length === 0, orphans.join(', '));
}

// ── AdminManager public API ──────────────────────────────────
section('AdminManager contract');
{
  const src = read(path.join(PRO_JS, 'admin-manager.js'));
  assert('registers window.AdminManager', /window\.AdminManager\s*=/.test(src));
  for (const fn of ['init', 'refresh', 'openCreate', 'closeCreate', 'submitCreate',
                    'closeEdit', 'submitEdit', 'toggleDeactivate', 'applyGate']) {
    // Match shorthand property (`fn,` or `fn\n  }`) or longhand (`fn: ...`).
    assert('exposes ' + fn + '()', new RegExp('\\b' + fn + '\\s*[,:\\s]*\\}?').test(src));
  }
  assert('invokes listTeamMembers callable', /callable\(['"]listTeamMembers['"]\)/.test(src));
  assert('invokes createTeamMember callable', /callable\(['"]createTeamMember['"]\)/.test(src));
  assert('invokes updateUserRole callable',   /callable\(['"]updateUserRole['"]\)/.test(src));
  assert('invokes deactivateUser callable',   /callable\(['"]deactivateUser['"]\)/.test(src));
}

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

// ── C-1: invite role allowlist ──────────────────────────────
section('C-1: onRepSignup allowlist');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  assert('INVITE_ALLOWED_ROLES set defined',
    /INVITE_ALLOWED_ROLES = new Set\(\[/.test(src));
  assert("INVITE_ALLOWED_ROLES excludes 'admin'",
    /INVITE_ALLOWED_ROLES = new Set\(\['company_admin', 'manager', 'sales_rep', 'viewer'\]\)/.test(src));
  assert('onRepSignup clamps unknown role to sales_rep',
    /INVITE_ALLOWED_ROLES\.has\(requested\)[\s\S]{0,200}role = 'sales_rep'/.test(src));
  assert('onRepSignup fails closed on error (C-5)',
    /onRepSignup error — blocking signup[\s\S]{0,200}throw new HttpsError/.test(src));
}

// ── C-2: NBD-2026 and siblings stripped from shipped HTML ───
section('C-2: access-code hardcodes removed');
{
  const dashboard = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const login     = read(path.join(ROOT, 'docs/pro/login.html'));
  assert('dashboard.html contains no NBD-2026', !dashboard.includes('NBD-2026'));
  assert('login.html contains no NBD-2026',      !login.includes('NBD-2026'));
  const seed = read(path.join(ROOT, 'scripts/seed-access-codes.js'));
  assert('seed script no longer hardcodes NBD-2026 entry',
    !/['"]NBD-2026['"]\s*:\s*\{/.test(seed));
  assert('seed script auto-deactivates legacy codes',
    /LEGACY_IDS\s*=\s*\[[^\]]*'NBD-2026'/.test(seed));
}

// ── C-3: public lead collections locked + gateway present ───
section('C-3: public form gate');
{
  const rules = read(path.join(ROOT, 'firestore.rules'));
  for (const col of ['guide_leads', 'contact_leads', 'estimate_leads', 'storm_alert_subscribers']) {
    assert('rules deny client writes to ' + col,
      new RegExp('match /' + col + '/\\{[^}]+\\}\\s*\\{[\\s\\S]{0,200}allow create, update, delete: if false').test(rules));
  }
  const fn = read(path.join(FUNCTIONS, 'index.js'));
  assert('submitPublicLead uses httpRateLimit',
    /submitPublicLead[\s\S]{0,2000}httpRateLimit\(req, res, 'publicLead:ip'/.test(fn));
  assert('submitPublicLead has honeypot field',
    /honeypot tripped/.test(fn));
}

// ── C-4: App Check init in dashboard ────────────────────────
section('C-4: App Check initialization');
{
  const src = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // Either provider is acceptable. Joe's prod key is reCAPTCHA Enterprise
  // (registered in Google Cloud Console, not the classic v3 admin), so the
  // import + provider must use ReCaptchaEnterpriseProvider, not the v3 one.
  // Test allows either to keep the suite tolerant if the project ever
  // switches back to a classic v3 site key.
  assert('imports initializeAppCheck + reCAPTCHA provider',
    /initializeAppCheck[\s\S]{0,120}ReCaptcha(V3|Enterprise)Provider/.test(src));
  assert('App Check init runs before getAuth',
    /initializeAppCheck[\s\S]{0,2000}getAuth\(app\)/.test(src));
  assert('Configurable via window.__NBD_APP_CHECK_KEY',
    /window\.__NBD_APP_CHECK_KEY/.test(src));
}

// ── H-2: iframe sandbox drops allow-same-origin ─────────────
section('H-2: iframe sandbox');
{
  const src = read(path.join(PRO_JS, 'nbd-doc-viewer.js'));
  assert("sandbox does not contain 'allow-same-origin'",
    !/allow-same-origin/.test(src.match(/sandbox[^'"]*['"][^'"]*['"]/)?.[0] || ''));
  assert('print listener injected via wrapWithPrintListener',
    /function wrapWithPrintListener/.test(src));
  assert('PDF path uses DOMParser (no contentDocument access)',
    /new DOMParser\(\)\.parseFromString/.test(src));
  assert('PDF path scrubs <script> and on* attrs',
    /querySelectorAll\('script, iframe, object, embed'\)[\s\S]{0,200}removeAttribute/.test(src));
}

// ── H-3: tenant-scoped Storage access (now lives on signImageUrl) ──
// R-03 retired imageProxy. The same tenant-scoping matrix moved
// onto signImageUrl — caller must be the path's owner, a platform
// admin, or a manager/company_admin sharing the file-owner's
// companyId. The assertions below pin that behaviour on the
// successor endpoint.
section('H-3: signImageUrl tenant scoping (successor to imageProxy)');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  assert('signImageUrl checks caller role is company_admin or manager',
    /\['manager', 'company_admin'\]\.includes\(callerRole\)/.test(src));
  assert('signImageUrl falls back to Firestore lookup if companyId claim missing',
    /signImageUrl[\s\S]{0,3000}users\/\$\{ownerUid\}/.test(src));
}

// ── H-4: audit triggers wired ───────────────────────────────
section('H-4: audit_log triggers');
{
  assert('audit-triggers.js exists',
    fs.existsSync(path.join(FUNCTIONS, 'audit-triggers.js')));
  const src = read(path.join(FUNCTIONS, 'audit-triggers.js'));
  for (const name of ['audit_users','audit_leads','audit_companies',
                       'audit_company_members','audit_access_codes','audit_subscriptions']) {
    assert('exports ' + name, new RegExp('exports\\.' + name + '\\s*=').test(src));
  }
  assert('redacts PII fields before logging',
    /PII_KEYS\s*=\s*\/[^/]*email[^/]*\//.test(src));
  assert('dedicated alert on invite doc setting role=admin',
    /security_admin_grant_attempt/.test(src));
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('index.js loads audit-triggers module',
    /require\(['"]\.\/audit-triggers['"]\)/.test(idx));
}

// ── H-5: per-company Claude budget ──────────────────────────
section('H-5: per-company Claude budget');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  assert('CLAUDE_COMPANY_BUDGET table exists',
    /CLAUDE_COMPANY_BUDGET\s*=\s*\{/.test(src));
  // M2: per-company budget enforcement moved off the range-scan of
  // api_usage onto a materialized counter (api_usage_daily). The
  // per-call audit write still stamps companyId so drill-downs work.
  assert('claudeProxy uses per-company materialized daily counter (M2)',
    /doc\(`api_usage_daily\/\$\{dayKey\}__co__\$\{callerCompanyId\}`\)/.test(src));
  assert('claudeProxy uses per-uid materialized daily counter (M2)',
    /doc\(`api_usage_daily\/\$\{dayKey\}__uid__\$\{decoded\.uid\}`\)/.test(src));
  assert('claudeProxy stamps companyId on api_usage writes',
    /api_usage[\s\S]{0,400}companyId: callerCompanyId/.test(src));
  assert('api_usage_daily locked to admin SDK in rules (M2)',
    /match \/api_usage_daily\/\{docId\}[\s\S]{0,200}allow read: if isAdmin\(\)[\s\S]{0,80}allow write: if false/
      .test(read(path.join(ROOT, 'firestore.rules'))));
  const idx = read(path.join(ROOT, 'firestore.indexes.json'));
  assert('firestore index for (companyId, timestamp DESC) on api_usage',
    /"collectionGroup":\s*"api_usage"[\s\S]{0,200}"fieldPath":\s*"companyId"[\s\S]{0,200}"fieldPath":\s*"timestamp"[\s\S]{0,100}"order":\s*"DESCENDING"/.test(idx));
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

// ── M-1: email verification gate ────────────────────────────
section('M-1: email verification');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  assert('claudeProxy requires email_verified before AI',
    /email_verified !== true[\s\S]{0,200}Verify your email/.test(src));
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
  assert('dashboard exposes __NBD_SENTRY_DSN slot', /window\.__NBD_SENTRY_DSN/.test(dash));
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

// ────────────────────────────────────────────────────────────
//  UI wire-ins
// ────────────────────────────────────────────────────────────

section('UI-A: HOVER Auto-measure in V2 Builder');
{
  const src = read(path.join(PRO_JS, 'estimate-v2-ui.js'));
  assert('Auto-measure button present', /data-action="auto-measure"/.test(src));
  assert('auto-measure case dispatches autoMeasure()',
    /case 'auto-measure':[\s\S]{0,80}autoMeasure\(\)/.test(src));
  assert('autoMeasure polls measurements/{jobId}',
    /measurements',\s*jobId/.test(src) && /status === 'ready'/.test(src));
  assert('applyMeasurementResult normalizes provider fields',
    /function applyMeasurementResult/.test(src));
}

section('UI-B: BoldSign send-for-signature + badges');
{
  const src = read(path.join(PRO_JS, 'estimate-v2-ui.js'));
  assert('Send-for-signature button present', /data-action="send-for-signature"/.test(src));
  assert('sendForSignature() wired', /async function sendForSignature\(/.test(src));
  assert('stores saved estimate id on window for signature flow',
    /window\._v2SavedEstimateId\s*=\s*savedId/.test(src));
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('signature badge rendered on estimate cards',
    /signatureStatus === 'signed'/.test(dash) && /SIGNED/.test(dash));
  assert('sigTag injected into est-card-chips',
    /leadTag \+ builderTag \+ sigTag/.test(dash));
}

section('UI-C: Regrid wire-in to property-intel');
{
  const src = read(path.join(PRO_JS, 'property-intel.js'));
  assert('_regridToIntel mapper defined', /function _regridToIntel/.test(src));
  assert('fetchPropertyIntel tries NBDIntegrations.lookupParcel',
    /NBDIntegrations\.lookupParcel/.test(src));
  assert('Regrid path short-circuits on hit',
    /renderIntelCard\(targetElId, intel, countyClean, fullAddr\);\s*return;/.test(src));
}

section('UI-D: Hail overlay on D2D + Pipeline badge');
{
  const src = read(path.join(PRO_JS, 'd2d-tracker.js'));
  assert('D2D exposes showHail', /showHail:\s*async/.test(src));
  assert('D2D exposes hideHail', /hideHail:\s*\(\)\s*=>/.test(src));
  assert('Hail button rendered in map controls',
    /onclick="window\._d2dHailLayer/.test(src));
  const crm = read(path.join(PRO_JS, 'crm.js'));
  assert('Kanban card renders hail badge when hailHit.sizeInches present',
    /l\.hailHit && l\.hailHit\.sizeInches/.test(crm));
}

section('UI-E: Cal.com in Settings');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('settingsCalcom input present', /id="settingsCalcom"/.test(dash));
  assert('settingsCalcomPreview anchor present',
    /id="settingsCalcomPreview"/.test(dash));
  assert('_saveSettings persists calcomUsername',
    /calcomUsername/.test(dash) && /setDoc[\s\S]{0,200}users[\s\S]{0,200}calcomUsername/.test(dash));
}

// ────────────────────────────────────────────────────────────
//  FIVE-ITEM PUSH
// ────────────────────────────────────────────────────────────

section('Push-1: public lead forms use submitPublicLead');
{
  const helper = read(path.join(ROOT, 'docs/assets/js/public-lead-submit.js'));
  assert('public-lead-submit helper exposes window.submitPublicLead',
    /window\.submitPublicLead\s*=\s*submitPublicLead/.test(helper));
  // Verify no page still calls addDoc on the four public collections.
  const pages = [
    'docs/index.html',
    'docs/estimate.html',
    'docs/storm-alerts.html',
    'docs/free-guide/index.html'
  ];
  for (const p of pages) {
    const src = read(path.join(ROOT, p));
    assert(p + ' loads public-lead-submit.js',
      /public-lead-submit\.js/.test(src));
    assert(p + ' no longer calls addDoc on public collections',
      !/addDoc\s*\(\s*collection\s*\([^)]*(guide_leads|contact_leads|estimate_leads|storm_alert_subscribers)/.test(src));
  }
}

section('Push-2: measurement pass-through line item');
{
  const src = read(path.join(PRO_JS, 'estimate-v2-ui.js'));
  assert('state.passThru seeded', /passThru: \[\]/.test(src));
  assert('applyMeasurementResult adds SVC MEASURE-RPT',
    /source: 'measurement'/.test(src) && /Aerial measurement report/.test(src));
  assert('getCurrentEstimate appends passThru to estimate.lines',
    /for \(const p of \(state\.passThru \|\| \[\]\)\)/.test(src));
  assert('removeFromScope clears from passThru first',
    /state\.passThru\s*=\s*\(state\.passThru \|\| \[\]\)\.filter/.test(src));
  assert('scope empty guard allows passThru-only quotes',
    /!state\.scope\.length && !\(state\.passThru && state\.passThru\.length\)/.test(src));
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
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('dashboard hydrates _currentRep.calcomUsername on auth',
    /window\._currentRep[\s\S]{0,500}calcomUsername: calVal/.test(dash));
}

section('Push-4: homeowner portal page + token callables');
{
  // L-03: portal handlers now live in functions/portal.js, mounted
  // onto index.js exports via Object.assign. Source-scan assertions
  // read from portal.js; the export-liveness check at the end of
  // this file verifies index.js still re-exposes them.
  const psrc = read(path.join(FUNCTIONS, 'portal.js'));
  for (const fn of ['createPortalToken', 'getHomeownerPortalView']) {
    assert('exports ' + fn, new RegExp('exports\\.' + fn + '\\s*=').test(psrc));
  }
  assert('createPortalToken owner-scopes by lead.userId',
    /lead\.userId !== uid && !isAdmin/.test(psrc));
  assert('getHomeownerPortalView rate-limits by IP',
    /httpRateLimit\(req, res, 'portal:ip'/.test(psrc));
  assert('view response redacts sensitive fields (no claim / notes)',
    /REDACTION:/.test(psrc));
  assert('portal.html exists + reads token from query string',
    fs.existsSync(path.join(ROOT, 'docs/pro/portal.html')));
  const portal = read(path.join(ROOT, 'docs/pro/portal.html'));
  assert('portal.html fetches getHomeownerPortalView',
    /getHomeownerPortalView/.test(portal));
  assert('portal.html embeds Cal.com iframe',
    /cal\.com.*embed=true/.test(portal));
  const rules = read(path.join(ROOT, 'firestore.rules'));
  assert('portal_tokens rule denies all client IO',
    /match \/portal_tokens\/\{token\}[\s\S]{0,200}allow read, write: if false/.test(rules));
  assert('measurements rule allows owner reads only',
    /match \/measurements\/\{jobId\}[\s\S]{0,200}isOwner\(resource\.data\.ownerId\)/.test(rules));
  assert('appointments rule allows owner reads only',
    /match \/appointments\/\{bookingId\}[\s\S]{0,200}isOwner\(resource\.data\.userId\)/.test(rules));
  assert('dashboard Share Portal Link button wired',
    /_sharePortalLink\s*=\s*async function/.test(dash()));
}

function dash() { return read(path.join(ROOT, 'docs/pro/dashboard.html')); }

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

// ────────────────────────────────────────────────────────────
//  WAVE A
// ────────────────────────────────────────────────────────────

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

section('Wave A4: rotateAccessCodes button');
{
  const adm = read(path.join(PRO_JS, 'admin-manager.js'));
  assert('AdminManager.rotateAccessCodes defined',
    /async function rotateAccessCodes/.test(adm));
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('Team Manager header renders rotate button',
    /AdminManager\.rotateAccessCodes\(\)/.test(dash));
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

// ────────────────────────────────────────────────────────────
//  WAVE B
// ────────────────────────────────────────────────────────────

section('Wave B1: portal BoldSign signing embed');
{
  // L-03: portal view lives in portal.js, not index.js.
  const psrc = read(path.join(FUNCTIONS, 'portal.js'));
  assert('portal view requests fresh embed URL when awaiting signature',
    /signatureStatus === 'sent'.+signatureStatus === 'viewed'|signature[Ss]tatus === 'sent' \|\| latest\.signatureStatus === 'viewed'/.test(psrc));
  assert('portal view returns signEmbedUrl field',
    /signEmbedUrl:\s*signEmbedUrl/.test(psrc));
  const p = read(path.join(ROOT, 'docs/pro/portal.html'));
  assert('portal.html renders signing iframe when signEmbedUrl present',
    /awaitingSign && signEmbedUrl/.test(p));
}

section('Wave B2: V2 prefill from lead');
{
  const src = read(path.join(PRO_JS, 'estimate-v2-ui.js'));
  assert('prefillFromLead helper defined', /function prefillFromLead\(leadId\)/.test(src));
  assert('syncCustomerInputs helper defined', /function syncCustomerInputs\(\)/.test(src));
  assert('open() accepts leadId', /function open\(opts\)/.test(src));
  assert('sendForSignature retries prefill before erroring',
    /prefillFromLead\(state\.customer\.leadId\)/.test(src));
}

section('Wave B3: live estimates snapshot');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('onSnapshot imported',    /onSnapshot/.test(dash));
  assert('_subscribeEstimates wired', /window\._subscribeEstimates/.test(dash));
  assert('subscribe called on auth ready',
    /window\._subscribeEstimates\(\)/.test(dash));
}

section('Wave B4+B5: revoke / regenerate portal link');
{
  // L-03: revokePortalToken moved to portal.js.
  const psrc = read(path.join(FUNCTIONS, 'portal.js'));
  assert('revokePortalToken callable exported',
    /exports\.revokePortalToken\s*=/.test(psrc));
  assert('revoke flips expiresAt to past',
    /expiresAt: admin\.firestore\.Timestamp\.fromMillis\(Date\.now\(\) - 1\)/.test(psrc));
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('lead detail has Revoke & Regenerate button',
    /Revoke &amp; Regenerate/.test(dash));
  assert('_revokePortalLink helper defined',
    /window\._revokePortalLink\s*=/.test(dash));
}

section('Wave B6: post-sign booking promotion');
{
  const p = read(path.join(ROOT, 'docs/pro/portal.html'));
  assert('portal promotes booking when signedNow',
    /signedNow[\s\S]{0,200}border-color:var\(--green/.test(p));
}

// ────────────────────────────────────────────────────────────
//  WAVE C
// ────────────────────────────────────────────────────────────

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

section('Wave C3: admin analytics');
{
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('getAdminAnalytics exported', /exports\.getAdminAnalytics\s*=/.test(idx));
  assert('returns signatures + measurements + portal + claude + leads',
    /signatures:[\s\S]{0,500}measurements:[\s\S]{0,500}portal:[\s\S]{0,500}claude:[\s\S]{0,500}leads:/.test(idx));
  const adm = read(path.join(PRO_JS, 'admin-manager.js'));
  assert('loadAnalytics renders KPI tiles', /function loadAnalytics/.test(adm));
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

// ────────────────────────────────────────────────────────────
//  WAVE D — ENTERPRISE-READY HARDENING
// ────────────────────────────────────────────────────────────

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

section('D6: GDPR export-my-data');
{
  const src = read(path.join(FUNCTIONS, 'integrations/compliance.js'));
  assert('exportMyData callable defined', /exports\.exportMyData\s*=/.test(src));
  assert('limited to 2 exports per 24h', /exportMyData:uid[\s\S]{0,100}2,\s*24 \* 3_600_000/.test(src));
  assert('writes signed URL to docs/{uid}/', /docs\/\$\{uid\}\/gdpr-export/.test(src));
}

section('D7: GDPR two-step erasure');
{
  const src = read(path.join(FUNCTIONS, 'integrations/compliance.js'));
  assert('requestAccountErasure + confirmAccountErasure exported',
    /exports\.requestAccountErasure\s*=/.test(src) && /exports\.confirmAccountErasure\s*=/.test(src));
  assert('confirmation token hashed before storage',
    /createHash\('sha256'\)\.update\(token\)\.digest\('hex'\)/.test(src));
  assert('cascade deletes user-owned docs',
    // M-01: query shape is now split across lines in the
    // registry-driven loop; allow whitespace/newlines between tokens.
    /where\(\s*ownerField,\s*'==',\s*uid\s*\)[\s\S]{0,40}\.limit\(500\)/.test(src)
    || /where\('userId',\s*'==',\s*uid\)[\s\S]{0,40}\.limit\(500\)/.test(src));
  assert('disables Auth account + revokes refresh tokens',
    /updateUser\(uid, \{ disabled: true \}\)[\s\S]{0,60}revokeRefreshTokens/.test(src));
  const rules = read(path.join(ROOT, 'firestore.rules'));
  assert('account_erasures collection locked to admin SDK',
    /match \/account_erasures\/\{uid\}[\s\S]{0,120}allow read, write: if false/.test(rules));
  // F-01: confirmAccountErasure GET must be a static page (no state
  // change), POST must be gated behind a per-uid rate limit. Regression
  // would let enterprise mail scanners trigger irreversible deletion.
  assert('F-01: confirmAccountErasure GET does not trigger deletion',
    /if \(req\.method === 'GET'\)[\s\S]{0,2000}res\.status\(200\)\.send/.test(src));
  assert('F-01: confirmAccountErasure rejects non-POST/GET',
    /if \(req\.method !== 'POST'\)[\s\S]{0,100}res\.status\(405\)/.test(src));
  assert('F-01: confirmAccountErasure per-uid rate limit',
    /enforceRateLimit\('confirmErasure:uid'/.test(src));
  assert('F-01: confirmAccountErasure per-ip rate limit',
    /httpRateLimit\([^)]*'confirmErasure:ip'/.test(src));
  assert('F-01: confirmAccountErasure CORS restricted to allowlist',
    /cors: CORS_ORIGINS[\s\S]{0,400}confirmAccountErasure/.test(src) ||
    /confirmAccountErasure[\s\S]{0,400}cors: CORS_ORIGINS/.test(src));
}

section('F-02: measurementWebhook signature verification');
{
  const src = read(path.join(FUNCTIONS, 'integrations/measurement.js'));
  assert('verifyWebhookHmac helper present',
    /function verifyWebhookHmac/.test(src));
  assert('timingSafeEqual compare of hmacs',
    /crypto\.timingSafeEqual/.test(src));
  assert('fails closed on unconfigured secret',
    /reason: 'secret-not-configured'/.test(src) &&
    /secret-not-configured' \? 503/.test(src));
  assert('rejects missing X-Hover-Signature',
    /x-hover-signature/.test(src));
  assert('rejects missing X-EV-Signature',
    /x-ev-signature/.test(src));
  const shared = read(path.join(FUNCTIONS, 'integrations/_shared.js'));
  assert('HOVER_WEBHOOK_SECRET registered',
    /HOVER_WEBHOOK_SECRET:\s*defineSecret\('HOVER_WEBHOOK_SECRET'\)/.test(shared));
  assert('EAGLEVIEW_WEBHOOK_SECRET registered',
    /EAGLEVIEW_WEBHOOK_SECRET:\s*defineSecret\('EAGLEVIEW_WEBHOOK_SECRET'\)/.test(shared));
}

section('F-03/F-04: admin analytics uses custom-claim gate');
{
  const src = read(path.join(ROOT, 'docs/admin/js/pages/analytics.js'));
  assert('F-03: analytics gate uses claims.role === admin',
    /claims\.role !== 'admin'/.test(src));
  assert('F-03: no email equality check survived',
    !/user\.email !==\s*'/.test(src));
  // F-04: the hardcoded admin emails must not appear in executable
  // code. Strip comments first so we don't flag the historical note
  // that explains the old bad pattern.
  const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert('F-04: hardcoded admin emails removed from code',
    !/jdeal@nobigdealsolutions\.com/.test(codeOnly) &&
    !/demo@nbdpro\.com/.test(codeOnly));
}

section('F-06: getHomeownerPortalView is POST-only');
{
  // L-03: moved to portal.js.
  const src = read(path.join(FUNCTIONS, 'portal.js'));
  // Grab the function block and assert GET is not accepted. Window
  // sized to tolerate the R-05 sizing-rationale comment that was
  // added inside the config object.
  const block = src.match(/exports\.getHomeownerPortalView[\s\S]{0,2000}/);
  assert('F-06: function block found', !!block);
  if (block) {
    assert('F-06: rejects non-POST',
      /if \(req\.method !== 'POST'\)[\s\S]{0,80}res\.status\(405\)/.test(block[0]));
    assert('F-06: token sourced from body, not query',
      /const token = \(req\.body && req\.body\.token\)/.test(block[0]));
  }
  const portal = read(path.join(ROOT, 'docs/pro/portal.html'));
  assert('F-06: portal.html uses POST + JSON body',
    /method:\s*'POST'[\s\S]{0,400}body:\s*JSON\.stringify\(\{\s*token\s*\}\)/.test(portal));
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

section('F-09: CSP report-uri + cspReport function');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  assert('F-09: cspReport function exported',
    /exports\.cspReport\s*=\s*onRequest/.test(src));
  const fb = read(path.join(ROOT, 'firebase.json'));
  assert('F-09: report-uri directive wired',
    /report-uri \/cspReport/.test(fb));
  assert('F-09: /cspReport rewrite routes to function',
    /"source":\s*"\/cspReport"[\s\S]{0,200}"functionId":\s*"cspReport"/.test(fb));
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

section('D8 / R-03: imageProxy stub still emits RFC 8594/9745 deprecation signals');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  assert('imageProxy stub sets Deprecation header',
    /imageProxy[\s\S]*?res\.set\('Deprecation', 'true'\)/.test(src));
  assert('imageProxy stub sets Sunset header',
    /imageProxy[\s\S]*?res\.set\('Sunset',/.test(src));
  assert('imageProxy stub sets Link rel=successor-version to /signImageUrl',
    /imageProxy[\s\S]*?rel="successor-version"/.test(src));
  // The old "imageProxy DEPRECATED call" WARN log is obsolete — the
  // stub holds no auth and does no work, so there's no per-call log.
  // Ops visibility comes from the existing cloud_run_revision error-
  // rate alert (monitoring/alert-functions-error-rate.json) filtering
  // on imageProxy.
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
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
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
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('SW bootstrap honors ?nosw=1',  /urlKill = params\.has\('nosw'\)/.test(dash));
  assert('SW bootstrap checks /pro/nosw.txt', /fetch\('\/pro\/nosw\.txt'/.test(dash));
  assert('SW kill unregisters + flushes caches',
    /unregister\(\)[\s\S]{0,200}caches\.delete/.test(dash));
  assert('README-killswitch.md documents the feature',
    fs.existsSync(path.join(ROOT, 'docs/pro/README-killswitch.md')));
}

// ────────────────────────────────────────────────────────────
//  WAVE F — FOLLOW-UP POLISH
// ────────────────────────────────────────────────────────────

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

section('F7: V2 Builder autosave');
{
  const src = read(path.join(PRO_JS, 'estimate-v2-ui.js'));
  assert('saveDraftDebounced called from render',
    /function render\(\)[\s\S]{0,400}saveDraftDebounced\(\)/.test(src));
  assert('collectDraft bundles state',
    /function collectDraft\(\)[\s\S]{0,400}scope:\s*state\.scope/.test(src));
  assert('restoreDraft merges local + remote',
    /function restoreDraft[\s\S]{0,600}estimate_drafts/.test(src));
  assert('clearDraft on successful save',
    /window\._v2SavedEstimateId = savedId[\s\S]{0,200}clearDraft\(\)/.test(src));
  const rules = read(path.join(ROOT, 'firestore.rules'));
  assert('estimate_drafts rules: owner only',
    /match \/estimate_drafts\/\{uid\}[\s\S]{0,200}isOwner\(uid\)/.test(rules));
}

section('F8: Voice memo transcription');
{
  const srv = read(path.join(FUNCTIONS, 'integrations/voice-memo.js'));
  assert('transcribeVoiceMemo callable exported',
    /exports\.transcribeVoiceMemo\s*=/.test(srv));
  assert('rate-limited 20/hour/uid',
    /callable:transcribeVoiceMemo:uid[\s\S]{0,80}20,\s*60 \* 60_000/.test(srv));
  assert('audio size capped',
    /MAX_AUDIO_BYTES\s*=\s*1_500_000/.test(srv));
  assert('writes activity on the lead',
    /type: 'voice_memo'/.test(srv));
  const cli = read(path.join(PRO_JS, 'voice-memo.js'));
  assert('client exposes window.NBDVoiceMemo',
    /window\.NBDVoiceMemo\s*=/.test(cli));
  assert('client uses MediaRecorder',
    /new MediaRecorder/.test(cli));
  const shared = read(path.join(FUNCTIONS, 'integrations/_shared.js'));
  assert('DEEPGRAM_API_KEY in secrets registry',
    /DEEPGRAM_API_KEY:\s*defineSecret\('DEEPGRAM_API_KEY'\)/.test(shared));
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('Record Voice Memo button on lead detail',
    /Record Voice Memo/.test(dash));
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('integrationStatus reports deepgram',
    /deepgram:\s*_hasInt\('DEEPGRAM_API_KEY'\)/.test(idx));
}

section('F9: Feature flags');
{
  const cli = read(path.join(PRO_JS, 'feature-flags.js'));
  assert('client exposes window.NBDFlags',
    /window\.NBDFlags\s*=/.test(cli));
  assert('reads _default + per-uid override',
    /feature_flags.*_default[\s\S]{0,400}window\._user\.uid/.test(cli));
  const rules = read(path.join(ROOT, 'firestore.rules'));
  assert('_default readable by authed users',
    /match \/feature_flags\/_default[\s\S]{0,200}allow read: if isAuth\(\)/.test(rules));
  assert('platform admin is the only writer',
    /match \/feature_flags\/_default[\s\S]{0,300}allow write: if isAdmin\(\)/.test(rules));
}

// ── V2 preview: titleMap key matches button data-arg ─────────
section('V2 preview titleMap alignment');
{
  const src = read(path.join(PRO_JS, 'estimate-v2-ui.js'));
  assert('finalize button data-arg uses internal-view',
    /data-arg="internal-view"/.test(src));
  assert("titleMap has 'internal-view' key (not legacy 'internal')",
    /'internal-view'\s*:/.test(src) && !/'internal'\s*:/.test(src));
  assert('FORMAT_ALIASES maps legacy names',
    /FORMAT_ALIASES\s*=\s*\{[^}]*internal:/.test(src));
  assert('guards formatter exception with try/catch',
    /formatEstimate\s*\(estimate,\s*format,\s*meta\);[\s\S]{0,200}catch/.test(src));
}

// ── Null-guard smoke: hot-spot functions use guards ──────────
section('Null guards on hot paths');
{
  const crm = read(path.join(PRO_JS, 'crm.js'));
  assert('openLeadModal checks modal existence',
    /function openLeadModal[\s\S]{0,200}if \(!modal\) return/.test(crm));
  assert('saveLead guards modal elements',
    /saveLead[\s\S]{0,400}if\s*\(\s*!mErr\s*\|\|\s*!mOk/.test(crm));

  const maps = read(path.join(PRO_JS, 'maps.js'));
  assert('openPinConfirm guards dot/lbl/coord/notes',
    /function openPinConfirm[\s\S]{0,400}if\s*\(\s*dot\s*\)/.test(maps));
  assert('recalcGutters guards total+ds',
    /function recalcGutters[\s\S]{0,300}if\s*\(\s*totalEl\s*\)/.test(maps));

  const est = read(path.join(PRO_JS, 'estimates.js'));
  assert('startNewEstimateOriginal bails on missing builder',
    /startNewEstimateOriginal[\s\S]{0,400}if\s*\(!builder\)/.test(est));
  assert('buildReview guards reviewEl',
    /function buildReview[\s\S]{0,2000}if\s*\(\s*!reviewEl\s*\)/.test(est));
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
    /Accept only known values; unknown string \u2192 fall back/.test(src));

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

section('C0: GDPR erasure cascade covers Storage + collectionGroups (registry-driven)');
{
  const src = read(path.join(FUNCTIONS, 'integrations/compliance.js'));
  // The original C0 assertions pinned inline constants
  // (OWNED_COLLECTIONS / OWNED_COLLECTION_GROUPS / OWNED_STORAGE_PREFIXES).
  // Those moved to the single-source-of-truth registry in M-01/M-02.
  // Forward-looking checks that the cascade STILL reaches each class:
  assert('C0: erasure still runs collectionGroup query for userId==uid',
    /collectionGroup\(groupName\)[\s\S]{0,200}where\('userId', '==', uid\)/.test(src));
  assert('C0: erasure still calls bucket.deleteFiles with uid-keyed prefix',
    /bucket\.deleteFiles\(\s*\{[\s\S]{0,200}prefix:[\s\S]{0,80}uid[\s\S]{0,80}force: true/.test(src));
  // exportMyData now uses the same registry collectionGroup list
  // (COLLECTION_GROUPS_WITH_USERID), exercised in the M-02 section.
  assert('C0: exportMyData covers collectionGroup rows via the registry',
    /for \(const group of COLLECTION_GROUPS_WITH_USERID\)[\s\S]{0,400}collectionGroup\(group\)\.where\('userId', '==', uid\)/.test(src));
}

section('Q1: clientIp XFF parsing (F-13 follow-up)');
{
  // Live-load the function and actually exercise it. This is the one
  // place in smoke.test.js we run real code — clientIp is too
  // security-critical to trust regex on.
  const orig = process.env.NBD_TRUSTED_PROXY_HOPS;
  try {
    // Force the module to evaluate with the default 1-hop config.
    // (Node caches module state, so delete from require cache first.)
    delete process.env.NBD_TRUSTED_PROXY_HOPS;
    delete require.cache[require.resolve(path.join(FUNCTIONS, 'rate-limit.js'))];
    const { clientIp } = require(path.join(FUNCTIONS, 'rate-limit.js'));

    // Google External HTTPS LB appends `<client-ip>,<gfr-ip>` to any
    // inbound XFF. The real client is therefore always at index
    // `length - 2` (TRUSTED_PROXY_HOPS=1 default). Tests model the
    // production shape, not test-harness shapes.
    assert('Q1: two-entry XFF → client is left entry',
      clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } }) === '1.2.3.4');
    assert('Q1: 3-entry XFF (attacker spoofed 1 value) → real client wins',
      clientIp({ headers: { 'x-forwarded-for': 'fake-spoof, 9.9.9.9, 10.0.0.1' } }) === '9.9.9.9');
    assert('Q1: deep spoof attempt still pins real client at LB-appended slot',
      clientIp({ headers: { 'x-forwarded-for': 'a,b,c,d, 5.5.5.5, 10.0.0.1' } }) === '5.5.5.5');
    assert('Q1: short chain (no LB append) falls back to socket IP',
      clientIp({ headers: { 'x-forwarded-for': '1.2.3.4' }, ip: '7.7.7.7' }) === '7.7.7.7');
    assert('Q1: missing XFF falls back to socket IP',
      clientIp({ ip: '7.7.7.7' }) === '7.7.7.7');
    assert('Q1: empty XFF falls back to socket IP',
      clientIp({ headers: { 'x-forwarded-for': '' }, ip: '8.8.8.8' }) === '8.8.8.8');
    assert('Q1: whitespace-only XFF falls back to socket IP',
      clientIp({ headers: { 'x-forwarded-for': '   ' }, ip: '8.8.8.8' }) === '8.8.8.8');

    // Source-level checks — the hop config must be bounded + overridable.
    const rlSrc = read(path.join(FUNCTIONS, 'rate-limit.js'));
    assert('Q1: trusted-hop count is configurable via env',
      /NBD_TRUSTED_PROXY_HOPS/.test(rlSrc));
    assert('Q1: trusted-hop count is clamped to a safe range',
      /v >= 0 && v <= 10/.test(rlSrc));
    assert('Q1: fallback chain reaches socket.remoteAddress',
      /socket\?\.remoteAddress/.test(rlSrc));
  } finally {
    if (orig === undefined) delete process.env.NBD_TRUSTED_PROXY_HOPS;
    else process.env.NBD_TRUSTED_PROXY_HOPS = orig;
  }
}

section('Q4: Turnstile fetch is aborted before handler budget expires');
{
  const src = read(path.join(FUNCTIONS, 'integrations/turnstile.js'));
  assert('Q4: verifyTurnstile passes an AbortSignal to fetch',
    /AbortSignal\.timeout\(\s*5000\s*\)/.test(src));
  assert('Q4: fail-closed on verifier error path preserved',
    /verify-error[\s\S]{0,60}fail CLOSED/i.test(src) ||
    /Fail CLOSED on verifier error/i.test(src));
}

section('Q3: admin MFA enforcement (feature-flag gated)');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  assert('Q3: beforeUserSignedIn imported',
    /beforeUserSignedIn\s*[,}]/.test(src));
  // Q3 trigger body is present but NOT exported — Identity Platform
  // blocking-function registration for beforeUserSignedIn needs a
  // one-time console/IAM action (see SECURITY_SWEEP + in-file
  // runbook). The body is preserved as a private const so
  // re-enablement is a one-line diff.
  assert('Q3: trigger body preserved as private const (not exported)',
    /_beforeAdminSignInHandler\s*=\s*beforeUserSignedIn/.test(src));
  // Strip comments before checking — the runbook text mentions
  // "Uncomment the `exports.beforeAdminSignIn = ...` line below"
  // and we don't want that comment reference to match.
  const codeOnly = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert('Q3: trigger NOT on exports (deploy-unblocking)',
    !/exports\.beforeAdminSignIn\s*=/.test(codeOnly));
  assert('Q3: re-enablement runbook documented in-file',
    /TEMPORARILY DISABLED[\s\S]{0,1500}Re-enablement runbook/.test(src));
  assert('Q3: trigger body early-returns for non-admin sessions',
    /_beforeAdminSignInHandler[\s\S]{0,1500}claims\.role !== 'admin'[\s\S]{0,60}return/.test(src));
  assert('Q3: feature-flag gate via feature_flags/_default doc',
    /feature_flags\/_default[\s\S]{0,200}admin_mfa_required/.test(src));
  assert('Q3: fails SAFE (allow) on feature-flag read error',
    /feature-flag read failed[\s\S]{0,60}return/.test(src));
  assert('Q3: rejects admin with no enrolled MFA factor',
    /factors\.length\s*>\s*0[\s\S]{0,800}throw new HttpsError\(\s*\n?\s*'permission-denied'/.test(src));

  const login = read(path.join(ROOT, 'docs/admin/js/pages/login.js'));
  assert('Q3: login page surfaces MFA-enrolment prompt on block',
    /Admin access requires a second factor/.test(login) &&
    /\/admin\/mfa-enroll\.html/.test(login));
  assert('Q3: login page handles auth/multi-factor-auth-required',
    /auth\/multi-factor-auth-required/.test(login));

  // mfa-enroll surface present + uses TOTP (not SMS — SIM-swap resistant).
  const mfa = read(path.join(ROOT, 'docs/admin/js/pages/mfa-enroll.js'));
  assert('Q3: mfa-enroll uses TotpMultiFactorGenerator',
    /TotpMultiFactorGenerator\.generateSecret/.test(mfa) &&
    /TotpMultiFactorGenerator\.assertionForEnrollment/.test(mfa));
  assert('Q3: mfa-enroll only admits callers with role: admin',
    /claims\.role !== 'admin'/.test(mfa));
  assert('Q3: mfa-enroll generates recovery codes + stores hashes only',
    /crypto\.subtle\.digest\('SHA-256'/.test(mfa) &&
    /mfaRecoveryHashes/.test(mfa));

  const html = read(path.join(ROOT, 'docs/admin/mfa-enroll.html'));
  assert('Q3: mfa-enroll.html noindex + loads the enroll module',
    /noindex, nofollow/.test(html) &&
    /\/admin\/js\/pages\/mfa-enroll\.js/.test(html));
}

section('Q6: deploy bundle excludes seed / find-secrets helpers');
{
  const fb = JSON.parse(read(path.join(ROOT, 'firebase.json')));
  const ignore = (fb.functions && fb.functions[0] && fb.functions[0].ignore) || [];
  // These files are standalone dev helpers — never require()'d by
  // index.js — so excluding them from the deploy bundle is pure
  // hygiene. (verify-functions.js was mistakenly included in this
  // list in commit 0ed6274, which broke the whole deploy batch;
  // it IS require()'d by index.js:1901 and must remain in source.)
  for (const name of ['seed-companies.js', 'seed-demo.js', 'find-secrets.js',
                      'verify-functions-company-enhancement.js']) {
    assert('Q6: functions.ignore contains ' + name, ignore.includes(name));
  }
  // Guard against the original bug: verify-functions.js must NOT
  // be in the ignore list.
  assert('Q6: verify-functions.js NOT in ignore (required by index.js)',
    !ignore.includes('verify-functions.js'));

  // Broader invariant: NOTHING in the ignore list can be require()'d
  // by functions/index.js or the files it loads. Firebase Hosting
  // packages the source with these patterns excluded; a missing
  // file at container startup causes every function in the
  // container to fail with "Failed to update function". Hard to
  // diagnose without the per-function Cloud Build log.
  const fs = require('fs');
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  const requires = Array.from(idx.matchAll(/require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g))
    .map(m => m[1])
    .map(r => r.endsWith('.js') ? r : r + '.js');
  for (const rel of requires) {
    // Match against the ignore glob: simple equality is enough for
    // our single-file ignore patterns. If ignore grows to globs
    // like "scripts/**/*.js" this needs upgrading.
    if (ignore.includes(rel)) {
      assert('Q6: required module ' + rel + ' must not be in deploy-ignore', false);
    }
    // Also sanity: every require()'d module must actually exist
    // relative to functions/.
    if (!fs.existsSync(path.join(FUNCTIONS, rel))) {
      // Sub-path requires like './integrations/foo' are handled
      // by the require walker in index.js; we only scan top-level
      // flat-file requires here. Ignore missing-file results that
      // start with 'integrations/' — those are directories.
      if (!/^integrations\//.test(rel)) {
        assert('Q6: ./' + rel + ' exists in functions/', false);
      }
    }
  }
  assert('Q6: all flat-file requires from index.js resolve + are not ignored', true);
}

// ─────────────────────────────────────────────────────────────
// 2026-04-15 invulnerability roadmap — regression locks for the
// 10-item 72-hour fix plan. Each assertion either pins the fix
// in place or catches the old vulnerable shape reappearing.
// ─────────────────────────────────────────────────────────────
section('C-01: sendD2DSMS IDOR + collection rename + .exists property fix');
{
  const src = read(path.join(FUNCTIONS, 'sms-functions.js'));
  assert('C-01: sms-functions.js no longer references the dead `d2d_knocks` collection',
    !/d2d_knocks/.test(src));
  assert('C-01: sendD2DSMS now reads from `knocks/`',
    /db\.doc\(`knocks\/\$\{knockId\}`\)\.get\(\)/.test(src));
  assert('C-01: knockSnap.exists is used as a property, not a method',
    /knockSnap\.exists\b(?!\()/.test(src) && !/knockSnap\.exists\(\)/.test(src));
  assert('C-01: handler enforces knock.userId ownership check',
    /knock\.userId\s*===\s*decoded\.uid/.test(src)
    && /isOwnKnock/.test(src)
    && /!isPlatformAdmin\s*&&\s*!isOwnKnock/.test(src));
  assert('C-01: handler returns 403 "Not your knock" on IDOR attempt',
    /403[^\n]*Not your knock/.test(src));
  assert('C-01: handler logs the attempt for detection',
    /sendD2DSMS IDOR attempt/.test(src));
  assert('C-01: handler allows same-company manager/company_admin cross-rep access',
    /isManagerInSameCompany/.test(src));
}

section('C-02: SMS subscription + email-verify gate');
{
  const src = read(path.join(FUNCTIONS, 'sms-functions.js'));
  // B2: requirePaidSubscription lives in functions/shared.js now,
  // imported by sms-functions.js. Scan shared.js for the helper
  // shape; scan sms-functions.js for the call sites.
  const shared = read(path.join(FUNCTIONS, 'shared.js'));
  assert('C-02: requirePaidSubscription helper is defined (in shared.js)',
    /async function requirePaidSubscription\s*\(/.test(shared));
  assert('C-02: helper allows admin bypass',
    /decoded\.role\s*===\s*'admin'[\s\S]{0,80}ok:\s*true/.test(shared));
  assert('C-02: helper gates on email_verified',
    /decoded\.email_verified\s*!==\s*true/.test(shared));
  assert('C-02: helper rejects free / missing subscriptions',
    /sub\.plan\s*!==\s*'free'/.test(shared));
  assert('C-02: sms-functions.js imports the helper from shared',
    /require\(['"]\.\/shared['"]\)/.test(src) && /requirePaidSubscription/.test(src));
  // Both handlers must call the gate before the per-uid rate-limit burn.
  // Heuristic: each handler block contains the call at least once.
  const sendSmsCallCount   = (src.match(/exports\.sendSMS\s*=\s*onRequest/g) || []).length;
  const sendD2dCallCount   = (src.match(/exports\.sendD2DSMS\s*=\s*onRequest/g) || []).length;
  const subGateCallCount   = (src.match(/await requirePaidSubscription\(/g) || []).length;
  assert('C-02: both SMS handlers invoke the subscription gate',
    sendSmsCallCount === 1 && sendD2dCallCount === 1 && subGateCallCount >= 2,
    'sendSMS=' + sendSmsCallCount + ' sendD2DSMS=' + sendD2dCallCount + ' gateCalls=' + subGateCallCount);
}

section('C-03 + M-03: claudeProxy transactional budget + starter plan entry');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  assert('C-03: reserveClaudeBudget helper defined',
    /async function reserveClaudeBudget\s*\(/.test(src));
  assert('C-03: reserveClaudeBudget uses a Firestore transaction',
    /db\.runTransaction\b/.test(src));
  assert('C-03: adjustClaudeBudget helper defined',
    /async function adjustClaudeBudget\s*\(/.test(src));
  assert('C-03: estimateInputTokens helper defined',
    /function estimateInputTokens\s*\(/.test(src));
  assert('C-03: reservation ceiling is bounded (CLAUDE_RESERVATION_MAX)',
    /const CLAUDE_RESERVATION_MAX\s*=\s*4\s*\*\s*CLAUDE_MAX_TOKENS_CAP/.test(src));
  assert('C-03: claudeProxy reserves before calling Anthropic',
    // Order-sensitive: the reserve call must appear BEFORE the
    // Anthropic fetch in source order. Use index comparison rather
    // than a greedy regex distance (the span between the two can
    // include a long comment block).
    (() => {
      const r = src.indexOf('await reserveClaudeBudget(');
      const a = src.indexOf("api.anthropic.com/v1/messages");
      return r > 0 && a > r;
    })());
  assert('C-03: refunds reservation on Anthropic fetch failure',
    /adjustClaudeBudget\([^)]*-reservation\)/.test(src));
  assert('C-03: reconciles actual vs reservation after success',
    /const delta\s*=\s*total\s*-\s*reservation/.test(src));
  assert('C-03: old read-then-check branch removed',
    !/consumedUid\s*>=\s*CLAUDE_DAILY_TOKEN_BUDGET/.test(src));
  // M-03: canonical `starter` plan name has an explicit budget entry.
  assert('M-03: CLAUDE_COMPANY_BUDGET includes starter plan (normalized from foundation)',
    /CLAUDE_COMPANY_BUDGET\s*=\s*\{[\s\S]{0,400}starter:\s*50_000/.test(src));
}

section('H-07: claudeProxy message-array + payload-size caps');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  assert('H-07: CLAUDE_MAX_MESSAGES constant defined',
    /const CLAUDE_MAX_MESSAGES\s*=\s*40\b/.test(src));
  assert('H-07: CLAUDE_MAX_PAYLOAD_BYTES constant defined',
    /const CLAUDE_MAX_PAYLOAD_BYTES\s*=\s*200_000/.test(src));
  assert('H-07: messages.length > cap returns 400',
    /messages\.length\s*>\s*CLAUDE_MAX_MESSAGES[\s\S]{0,200}status\(400\)/.test(src));
  assert('H-07: oversize serialized payload returns 413',
    /serializedMessages\.length\s*>\s*CLAUDE_MAX_PAYLOAD_BYTES[\s\S]{0,200}status\(413\)/.test(src));
}

section('H-01 + R-03: signImageUrl portals/ strip (imageProxy retired)');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  // Only signImageUrl still runs path-allowlist regex now that
  // imageProxy is a 410 stub. Assertion guards against portal paths
  // being reintroduced to the signer's alternation.
  const matchRegexes = src.match(/\(photos\|[^)]+\)/g) || [];
  assert('H-01: signImageUrl regex does not include portals',
    matchRegexes.length > 0 && matchRegexes.every(r => !/portals/.test(r)),
    'found ' + matchRegexes.length + ' alternation(s): ' + matchRegexes.join(' | '));
}

section('R-03: imageProxy retired — 410 Gone stub');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  // The old streaming implementation MUST be gone. Its signature
  // tokens were createReadStream, imageProxy:ip rate limit, and the
  // DEPRECATED log warning — none should remain.
  assert('R-03: imageProxy no longer streams via createReadStream',
    !/imageProxy[\s\S]{0,5000}createReadStream\(\)/.test(src));
  assert('R-03: imageProxy no longer consumes the imageProxy:ip rate-limit bucket',
    !/imageProxy:ip/.test(src));
  assert('R-03: imageProxy stub returns 410 Gone',
    /exports\.imageProxy[\s\S]{0,2000}status\(410\)/.test(src));
  assert('R-03: 410 response cites the successor endpoint',
    /successor:\s*['"]\/signImageUrl['"]/.test(src));
  // The stub should be cheap — no auth, no Firestore, low concurrency.
  assert('R-03: stub is cheap (no requireAuth call in the handler body)',
    !/exports\.imageProxy[\s\S]{0,2000}requireAuth\(/.test(src));
}

section('R-03: photo-editor migrated off imageProxy');
{
  const src = read(path.join(PRO_JS, 'photo-editor.js'));
  assert('R-03: photo-editor no longer references the imageProxy URL',
    !/cloudfunctions\.net\/imageProxy/.test(src)
    && !/const PROXY_URL\s*=\s*['"]https?:\/\/[^'"]*imageProxy/.test(src));
  assert('R-03: photo-editor uses window.NBDSignedUrl.get for image loads',
    /window\.NBDSignedUrl\s*\.\s*get\(\s*path\s*\)/.test(src));
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  assert('R-03: customer.html loads signed-image-url.js BEFORE photo-editor.js',
    (() => {
      const helper = customer.indexOf('signed-image-url.js');
      const editor = customer.indexOf('photo-editor.js');
      return helper > 0 && editor > 0 && helper < editor;
    })());
}

section('H-04: getAdminAnalytics admin/company_admin gate + rate limit');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  assert('H-04: isSoloOwner reference removed',
    !/isSoloOwner/.test(src));
  // The new gate throws permission-denied unless isPlatformAdmin||isCompanyAdmin.
  assert('H-04: solo-owner escape hatch no longer exists on getAdminAnalytics',
    /if\s*\(!isPlatformAdmin\s*&&\s*!isCompanyAdmin\)\s*\{\s*throw new HttpsError\('permission-denied'/.test(src));
  assert('H-04: getAdminAnalytics now rate-limits per-uid',
    /callableRateLimit\(request,\s*'getAdminAnalytics'/.test(src));
}

section('H-06: integrationStatus admin-only gate');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  // The role check sits inside the integrationStatus handler block.
  const m = src.match(/exports\.integrationStatus\s*=\s*onCall\s*\([\s\S]+?\}\s*\);/);
  assert('H-06: integrationStatus handler block located', !!m);
  if (m) {
    assert('H-06: handler rejects non-admin / non-company_admin callers',
      /\['admin',\s*'company_admin'\]\.includes\(callerRole\)/.test(m[0])
      && /permission-denied/.test(m[0]));
  }
}

section('M-04: submitPublicLead optional-field allowlist');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  assert('M-04: PUBLIC_LEAD_OPTIONAL_DEFAULTS defined (utm + referrer)',
    /PUBLIC_LEAD_OPTIONAL_DEFAULTS\s*=\s*\[[^\]]*utm_source[^\]]*utm_medium[^\]]*utm_campaign[^\]]*referrer/.test(src));
  assert('M-04: guide kind carries an explicit optional list',
    /guide:\s*\{[\s\S]{0,300}optional:\s*\[/.test(src));
  assert('M-04: submitPublicLead iterates spec.optional, not Object.keys(body)',
    /for\s*\(const key of \(spec\.optional \|\| \[\]\)\)/.test(src));
  assert('M-04: old passthrough loop over Object.keys(body) is gone',
    !/for\s*\(const key of Object\.keys\(body\)\)\s*\{[\s\S]{0,160}spec\.required\.includes/.test(src));
}

section('H-02: nbd-auth demo bypass keyed on custom claim, not email');
{
  const src = read(path.join(ROOT, 'docs/pro/js/nbd-auth.js'));
  assert('H-02: demo@nobigdeal.pro literal removed',
    !/demo@nobigdeal\.pro/.test(src));
  assert('H-02: demo bypass now reads token.claims.demo',
    /tokenResult\.claims\.demo\s*===\s*true/.test(src));
  assert('H-02: demo accounts never receive admin role client-side',
    /_role\s*=\s*'demo_viewer'/.test(src) && !/_role\s*=\s*'admin';\s*\n\s*_subscription\s*=\s*\{\s*plan:\s*'professional'/.test(src));
}

section('H-02 ops: scripts/grant-demo-claim.js provisioner');
{
  const p = path.join(ROOT, 'scripts/grant-demo-claim.js');
  assert('H-02: grant-demo-claim.js exists', fs.existsSync(p));
  if (fs.existsSync(p)) {
    const src = read(p);
    assert('H-02: provisioner sets demo:true custom claim',
      /setCustomUserClaims\([^)]+,\s*next\)/.test(src) && /next\.demo\s*=\s*true/.test(src));
    assert('H-02: provisioner supports --remove flag for claim revocation',
      /--remove/.test(src) && /delete next\.demo/.test(src));
    assert('H-02: provisioner revokes refresh tokens so the claim takes effect',
      /revokeRefreshTokens\(/.test(src));
    assert('H-02: provisioner parses cleanly',
      syntaxCheck(p).ok);
  }
}

section('H-03: nbd-auth fails closed to free on network error');
{
  const src = read(path.join(ROOT, 'docs/pro/js/nbd-auth.js'));
  assert('H-03: localStorage plan cache read removed',
    !/localStorage\.getItem\('nbd_user_plan'\)/.test(src));
  // The setter call survives only in logout() for cleanup of stale keys.
  const setterMatches = (src.match(/localStorage\.setItem\('nbd_user_plan'/g) || []).length;
  assert('H-03: localStorage plan cache write removed (no setItem calls)',
    setterMatches === 0,
    'found ' + setterMatches + ' setItem(nbd_user_plan) call(s)');
  assert('H-03: network-error branch hard-drops to free with _failOpen:false',
    /_userPlan\s*=\s*'free';[\s\S]{0,160}_failOpen:\s*false/.test(src));
}

section('M-01 + M-02: GDPR completeness — canonical user-owned registry');
{
  const regPath = path.join(FUNCTIONS, 'integrations/user-owned.js');
  assert('M-01/M-02: registry module exists', fs.existsSync(regPath));
  if (fs.existsSync(regPath)) {
    assert('M-01/M-02: registry parses cleanly', syntaxCheck(regPath).ok);
    // Load the module and assert the shape — smoke test already uses
    // zero deps other than Node stdlib, and this module is pure
    // constants + a helper fn, so require() is safe.
    const reg = require(regPath);
    assert('M-01/M-02: FLAT_USER_COLLECTIONS has at least 22 entries',
      Array.isArray(reg.FLAT_USER_COLLECTIONS) && reg.FLAT_USER_COLLECTIONS.length >= 22,
      'count=' + (reg.FLAT_USER_COLLECTIONS || []).length);
    assert('M-01/M-02: every flat-collection entry has a name',
      reg.FLAT_USER_COLLECTIONS.every(s => typeof s.name === 'string' && s.name.length > 0));
    // Invoices is the only collection with a non-default ownerField.
    const invoices = reg.FLAT_USER_COLLECTIONS.find(s => s.name === 'invoices');
    assert('M-01/M-02: invoices is registered with ownerField=createdBy',
      invoices && invoices.ownerField === 'createdBy');
    assert('M-01/M-02: COLLECTION_GROUPS_WITH_USERID includes recordings + activity',
      Array.isArray(reg.COLLECTION_GROUPS_WITH_USERID)
      && reg.COLLECTION_GROUPS_WITH_USERID.includes('recordings')
      && reg.COLLECTION_GROUPS_WITH_USERID.includes('activity'));
    assert('M-01/M-02: STORAGE_PREFIXES covers all 8 storage.rules prefixes',
      Array.isArray(reg.STORAGE_PREFIXES)
      && ['audio','photos','docs','portals','galleries','reports','shared_docs','deal_rooms']
          .every(p => reg.STORAGE_PREFIXES.includes(p)));
    assert('M-01/M-02: OWNER_KEYED_DOCS covers the user/sub/settings doc set',
      Array.isArray(reg.OWNER_KEYED_DOCS)
      && ['users','subscriptions','userSettings','leaderboard','reps','estimate_drafts','feature_flags']
          .every(c => reg.OWNER_KEYED_DOCS.includes(c)));
    assert('M-01/M-02: NESTED_LEADS_PATH(uid) returns leads/{uid}',
      typeof reg.NESTED_LEADS_PATH === 'function'
      && reg.NESTED_LEADS_PATH('abc') === 'leads/abc');
    // Audit trails intentionally excluded — prevents a future
    // caller from wiring account_erasures into the cascade and
    // obliterating the very audit record of the operation.
    assert('M-01/M-02: audit trails NOT in owner-keyed erasure scope',
      !reg.OWNER_KEYED_DOCS.includes('account_erasures')
      && !reg.OWNER_KEYED_DOCS.includes('audit_log'));
  }
}

section('M-01: confirmAccountErasure uses the registry + recursiveDelete');
{
  const src = read(path.join(FUNCTIONS, 'integrations/compliance.js'));
  assert('M-01: compliance.js imports the registry module',
    /require\(['"]\.\/user-owned['"]\)/.test(src));
  assert('M-01: cascade iterates FLAT_USER_COLLECTIONS (not an inline list)',
    /for \(const spec of FLAT_USER_COLLECTIONS\)/.test(src));
  assert('M-01: cascade honors per-collection ownerField',
    /spec\.ownerField\s*\|\|\s*'userId'/.test(src));
  assert('M-01: cascade iterates COLLECTION_GROUPS_WITH_USERID',
    /for \(const groupName of COLLECTION_GROUPS_WITH_USERID\)/.test(src));
  assert('M-01: cascade sweeps STORAGE_PREFIXES',
    /for \(const prefix of STORAGE_PREFIXES\)/.test(src));
  assert('M-01: cascade deletes every OWNER_KEYED_DOCS entry',
    /for \(const coll of OWNER_KEYED_DOCS\)/.test(src));
  assert('M-01: nested-leads subtree scrubbed via recursiveDelete',
    /db\.recursiveDelete\(db\.doc\(NESTED_LEADS_PATH\(uid\)\)\)/.test(src));
  // The old inline OWNED_COLLECTIONS constant must be gone.
  assert('M-01: old inline OWNED_COLLECTIONS list removed',
    !/const OWNED_COLLECTIONS\s*=\s*\[/.test(src));
}

section('M-02: exportMyData uses the registry + Storage enumeration');
{
  const src = read(path.join(FUNCTIONS, 'integrations/compliance.js'));
  assert('M-02: export iterates FLAT_USER_COLLECTIONS',
    /exports\.exportMyData[\s\S]{0,5000}for \(const spec of FLAT_USER_COLLECTIONS\)/.test(src));
  assert('M-02: export iterates COLLECTION_GROUPS_WITH_USERID',
    /for \(const group of COLLECTION_GROUPS_WITH_USERID\)/.test(src));
  assert('M-02: export enumerates Storage prefixes (getFiles)',
    /bucket\.getFiles\(\s*\{\s*prefix:/.test(src));
  assert('M-02: export signs 24h download URLs per Storage object',
    /f\.getSignedUrl\([\s\S]{0,160}24\s*\*\s*3_600_000/.test(src));
  assert('M-02: export reads every OWNER_KEYED_DOCS entry',
    /for \(const coll of OWNER_KEYED_DOCS\)/.test(src));
  assert('M-02: export walks nested-leads subtree via listCollections()',
    /NESTED_LEADS_PATH\(uid\)[\s\S]{0,300}listCollections\(\)/.test(src));
  // Backwards compat — clients reading the old shape see the same keys.
  assert('M-02: legacy `profile` + `subscription` aliases preserved',
    /out\.profile\s*=\s*out\.ownerDocs\.users/.test(src)
    && /out\.subscription\s*=\s*out\.ownerDocs\.subscriptions/.test(src));
  // The old inline OWNED constant must be gone.
  assert('M-02: old inline OWNED list removed from export path',
    !/const OWNED\s*=\s*\['leads'/.test(src));
}

section('R-01: rate-limit provider visibility + cold-start misconfig warning');
{
  const adapterPath = path.join(FUNCTIONS, 'integrations/upstash-ratelimit.js');
  const src = read(adapterPath);

  assert('R-01: adapter exports a `provider()` function',
    /^\s*(module\.exports\s*=\s*\{[\s\S]*?\bprovider[\s\S]*?\};?|exports\.provider\s*=)/m.test(src));
  assert('R-01: provider() returns upstash only when env=upstash AND secrets configured',
    /PROVIDERS\.rateLimit\s*===\s*'upstash'\s*&&\s*upstashConfigured\(\)/.test(src));
  assert('R-01: cold-start misconfig logs a structured `rate_limit_provider_drift` WARN',
    /logger\(\)\.warn\(\s*'rate_limit_provider_drift'/.test(src));
  assert('R-01: cold-start drift message cites envPref + active fields',
    /rate_limit_provider_drift[\s\S]{0,400}envPref[\s\S]{0,120}active/.test(src));
  // Live-load the adapter and verify provider() resolves without
  // secrets available (expected: 'firestore' — the test env is
  // unconfigured by design).
  const adapter = require(adapterPath);
  assert('R-01: provider() is a callable function',
    typeof adapter.provider === 'function');
  assert('R-01: provider() returns a string in {upstash, firestore}',
    ['upstash', 'firestore'].includes(adapter.provider()));

  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('R-01: integrationStatus surfaces rateLimitProvider to admin callers',
    /rateLimitProvider:\s*rateLimitProvider\(\)/.test(idx)
    && /require\(['"]\.\/integrations\/upstash-ratelimit['"]\)/.test(idx));

  const runbook = read(path.join(ROOT, '_legacy', 'POST_DEPLOY_CHECKLIST.md'));
  assert('R-01: POST_DEPLOY_CHECKLIST has an Upstash runbook section',
    /##\s*18\.\s*Rate-limit provider/i.test(runbook));
  assert('R-01: runbook walks through secret provisioning',
    /functions:secrets:set UPSTASH_REDIS_REST_URL/.test(runbook)
    && /functions:secrets:set UPSTASH_REDIS_REST_TOKEN/.test(runbook));
  assert('R-01: runbook documents the NBD_RATE_LIMIT_PROVIDER=upstash flip',
    /NBD_RATE_LIMIT_PROVIDER.{0,10}upstash/.test(runbook)
    || /nbd\.rate_limit_provider.{0,10}upstash/.test(runbook));
  assert('R-01: runbook tells ops how to verify the flip post-deploy',
    /integrationStatus[\s\S]{0,400}rateLimitProvider/.test(runbook));
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

section('L-04: confirmAccountErasure GET is rate-limited');
{
  const src = read(path.join(FUNCTIONS, 'integrations/compliance.js'));
  // The GET branch must call httpRateLimit BEFORE emitting the HTML
  // so a bandwidth-DoS hits the 429 path, not the 3KB body.
  assert('L-04: GET branch invokes httpRateLimit on confirmErasureGet:ip',
    // Window sized to tolerate the explanatory comment block added
    // with this fix.
    /if\s*\(req\.method\s*===\s*'GET'\)[\s\S]{0,1200}httpRateLimit\([^)]*confirmErasureGet:ip/.test(src));
  assert('L-04: rate-limit uses per-IP key (60/min)',
    /confirmErasureGet:ip[^)]*,\s*60,\s*60_000/.test(src));
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

// ── Inline HTML <script> syntax ─────────────────────────────
// Guards against the class of bug where an inline <script> inside an
// HTML file has a syntax error (unclosed brace, etc.) — browsers
// silently log it to console and the page renders but every JS
// feature on the page is dead. Full fixture-based suite at
// tests/inline-html-scripts.test.js; we gate on it passing.
try {
  execSync('node ' + JSON.stringify(path.join(__dirname, 'inline-html-scripts.test.js')), {
    stdio: 'inherit',
    cwd: ROOT,
  });
  passed++;
} catch (e) {
  failed++;
  failures.push('inline-html-scripts.test.js — inline <script> in docs/ has syntax error (see output above)');
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

// ── CSP: strict pages stay free of inline event handlers ────
// firebase.json ships tight per-page CSPs (script-src-attr 'none')
// for the pages below. That header BLOCKS any onclick=/onsubmit=/
// onfocus= handler in the HTML — which is what we want, but the
// blocking is silent, so a stray inline handler just breaks the page
// without a visible error. This check refuses to let a new inline
// handler land on those files.
section('CSP: strict-CSP pages have zero inline event handlers');
{
  const STRICT_PAGES = [
    'docs/pro/login.html',
    'docs/pro/register.html',
    'docs/pro/stripe-success.html',
    'docs/pro/analytics.html',
    'docs/pro/leaderboard.html',
    'docs/pro/ask-joe.html',
    'docs/pro/diagnostic.html',
    'docs/pro/understand.html',
    'docs/pro/ai-tree.html',
  ];
  const INLINE_HANDLER_RE = /\son(click|submit|change|input|load|focus|blur|keyup|keydown|mouseover|mouseout|mouseenter|mouseleave|drag|drop|touchstart|touchend)\s*=/;
  for (const p of STRICT_PAGES) {
    const full = path.join(ROOT, p);
    if (!fs.existsSync(full)) continue;
    const html = fs.readFileSync(full, 'utf8');
    const match = html.match(INLINE_HANDLER_RE);
    assert(p + ' has no inline event handlers (strict CSP)',
      !match,
      match ? 'found: ' + match[0] + ' at offset ' + match.index : '');
  }
}

// ── A11y: main landmark + skip-link on public pages ─────────
// These are the pages users touch before authentication. Screen-reader
// and keyboard users need a "skip to main content" target + a
// <main id="main"> landmark to jump to. The test is tight — we only
// gate the public auth-entry pages so adding landmarks to the rest of
// the app can happen incrementally without breaking CI.
section('A11y: main landmark + skip-link on public pages');
{
  const PAGES = ['docs/pro/login.html', 'docs/pro/register.html', 'docs/pro/pricing.html'];
  for (const p of PAGES) {
    const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
    assert(p + ' has <main id="main">',  /<main[^>]*id=["']main["']/.test(html));
    assert(p + ' has skip-to-main link',
      /href=["']#main["']/.test(html) && /Skip to main content/i.test(html));
  }
}

// ── Perf: no new oversized images ───────────────────────────
// Guard against someone dropping an uncompressed PNG/JPEG into the
// build. Anything > 1MB is almost always a mistake (should be a WebP
// under 200KB or a sized JPEG). The existing known offenders
// (roofivent product shots) are whitelisted — the guard is specifically
// for NEW regressions, not for retro-cleaning binaries we can't edit
// in this worktree.
section('Perf: oversized image regression guard');
{
  const MAX_IMAGE_BYTES = 1 * 1024 * 1024;  // 1 MB
  const WHITELIST = new Set([
    // Existing product imagery — documented large, lazy-loaded on
    // /services/roofivent/ below the fold, converted to WebP/AVIF
    // in a follow-up perf pass.
    'docs/assets/roofivent/ivent-roto.png',
    'docs/assets/roofivent/ivent-eco.png',
  ]);
  function walk(dir, out) {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(png|jpg|jpeg|gif|webp|avif)$/i.test(entry.name)) out.push(full);
    }
    return out;
  }
  const imgs = walk(path.join(ROOT, 'docs'), []);
  const offenders = [];
  for (const abs of imgs) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const size = fs.statSync(abs).size;
    if (size > MAX_IMAGE_BYTES && !WHITELIST.has(rel)) {
      offenders.push(rel + ' (' + (size / 1024 / 1024).toFixed(1) + ' MB)');
    }
  }
  assert('Perf: no new image > 1MB (' + imgs.length + ' scanned, ' + WHITELIST.size + ' whitelisted)',
    offenders.length === 0,
    offenders.length ? 'offenders: ' + offenders.join(', ') : '');
}

section('Service worker — cross-origin passthrough');
{
  const sw = read(path.join(ROOT, 'docs/sw.js'));
  // Cache version bump invalidates browser caches of the old broken SW.
  assert('sw.js CACHE_VERSION bumped to 3+ (forces clients to pick up the new SW)',
    /const CACHE_VERSION\s*=\s*[3-9]\d*/.test(sw),
    'must be >= 3 so browsers re-register and drop the broken v2 SW');
  // Cross-origin passthrough — the actual fix.
  assert('sw.js fetch handler bypasses cross-origin requests',
    /url\.origin\s*!==\s*self\.location\.origin\s*\)\s*return/.test(sw),
    'expected an early return for url.origin !== self.location.origin in the fetch listener');
  // The check must come before the cache-strategy branches, otherwise
  // it never fires.
  assert('cross-origin bypass runs before strategies 2-5',
    /url\.origin !== self\.location\.origin\)\s*return;[\s\S]*Strategy 2:/.test(sw),
    'the early return must precede "Strategy 2" so CDN URLs never hit the cache-first branches');
}

section('Customer photo multi-select + batched commit');
{
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  // writeBatch must be imported AND exposed on window so the bulk
  // handlers can invoke it.
  assert('customer.html imports writeBatch from firestore SDK',
    /import \{[^}]*writeBatch[^}]*\}\s*from\s*"https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-firestore\.js"/.test(customer));
  assert('customer.html exposes window.writeBatch',
    /window\.writeBatch\s*=\s*writeBatch/.test(customer));
  // _photoSelected Set + tile checkbox overlay + bulk action bar DOM.
  assert('customer.html declares window._photoSelected Set',
    /window\._photoSelected\s*=\s*window\._photoSelected\s*\|\|\s*new Set/.test(customer));
  assert('photo tile renders the selection checkbox span',
    /class="nbd-photo-checkbox"/.test(customer));
  assert('bulk action bar DOM is in place',
    /id="nbdPhotoBulkBar"[\s\S]{0,1500}id="nbdPhotoBulkCount"[\s\S]{0,2000}id="nbdBulkPhase"[\s\S]{0,2000}id="nbdBulkSeverity"/.test(customer));
  // Bulk handlers exist and use writeBatch (one round-trip for the
  // whole batch — the whole point of this PR).
  assert('applyBulkPhotoUpdate uses writeBatch',
    /window\.applyBulkPhotoUpdate\s*=\s*async function[\s\S]{0,500}window\.writeBatch\(window\.db\)/.test(customer));
  assert('applyBulkPhotoDelete uses writeBatch',
    /window\.applyBulkPhotoDelete\s*=\s*async function[\s\S]{0,500}window\.writeBatch\(window\.db\)[\s\S]{0,500}batch\.delete\(/.test(customer));
  // After a same-field bulk update, surgical updates happen — no full
  // re-render unless the phase changed.
  assert('bulk update prefers surgical updatePhotoTile over full re-render',
    /phaseChanged[\s\S]{0,200}updatePhotoTile\(id\)/.test(customer));
  // Click delegate enters selection mode without opening the quick-edit popup.
  assert('photo grid delegate routes selection-mode clicks to togglePhotoSelection',
    /isPhotoSelectMode\(\)[\s\S]{0,150}togglePhotoSelection\(photoId\)/.test(customer));
}

section('Customer photo upload — background-safe + global widget');
{
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  // Global floating upload widget DOM exists.
  assert('customer.html ships the #nbdUploadWidget DOM',
    /id="nbdUploadWidget"[\s\S]{0,500}id="nbdUploadWidgetBarFill"/.test(customer));
  // updateGlobalUploadStatus drives the widget visibility + bar fill.
  assert('customer.html exports updateGlobalUploadStatus',
    /function updateGlobalUploadStatus\(\)/.test(customer));
  // Surgical per-tick update — kills the per-byte innerHTML thrash.
  assert('uploadSinglePhoto state_changed uses updateUploadPreviewItem',
    /uploadTask\.on\(['"]state_changed['"][\s\S]{0,400}updateUploadPreviewItem\(index\)/.test(customer));
  // Per-tile % label overlay (the "loading circle on each photo").
  assert('preview tile shows centered % label',
    /class="preview-progress-pct"/.test(customer)
    && /\.preview-progress-pct\s*\{[^}]*transform:\s*translate/.test(customer));
  // closeUploadModal must NOT clear the queue while uploads are in flight.
  assert('closeUploadModal preserves queue mid-upload (background-safe)',
    /hasInflight[\s\S]{0,150}return;/.test(customer));
  // Success path is a non-blocking toast, not a JS alert. Negative
  // condition targets the photo path only (_uploadQueue) so the
  // doc-upload alert at line ~1860 (_docUploadQueue) doesn't trigger.
  assert('uploadPhotos success path uses showToast (no alert)',
    /window\.showToast\(['"]✓ Uploaded /.test(customer)
    && !/alert\(`Successfully uploaded \$\{window\._uploadQueue/.test(customer));
}

section('Customer photo grid — surgical render path');
{
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  // _photoById Map for O(1) lookup (was O(n) indexOf inside the render loop).
  assert('customer.html populates window._photoById Map in loadPhotosByPhase',
    /window\._photoById\s*=\s*new Map\(\)/.test(customer));
  // Surgical update entry point — patches one tile's badges in place.
  assert('customer.html exports updatePhotoTile helper',
    /function updatePhotoTile\(photoId\)/.test(customer));
  // Tiles must carry the stable id so updatePhotoTile can find them.
  assert('customer.html photo tiles use data-photo-id (not data-photo-global-idx)',
    /data-photo-id="/.test(customer) && !/data-photo-global-idx/.test(customer));
  // Single delegated click listener — replaces 80 per-tile listeners.
  assert('customer.html photo grid uses delegated click listener',
    /ensurePhotoGridDelegate/.test(customer)
    && /grid\.addEventListener\(['"]click['"]/.test(customer));
  // CSS hover replaces the JS mouseover/mouseout pair (160 listeners on 80 photos).
  assert('customer.html .nbd-phase-photo:hover is CSS, not JS',
    /\.nbd-phase-photo:hover\s*\{\s*transform:\s*scale/.test(customer)
    && !/addEventListener\(['"]mouseover['"]/.test(customer));
  // Per-phase 25-photo cap with show-all toggle.
  assert('customer.html caps each phase to 25 with show-all toggle',
    /PHOTO_PHASE_CAP\s*=\s*25/.test(customer)
    && /toggleShowAllPhase/.test(customer)
    && /nbd-show-all-btn/.test(customer));
  // quickSaveMeta must call updatePhotoTile when the phase didn't
  // change — the whole point of this PR.
  assert('quickSaveMeta calls updatePhotoTile for same-phase edits',
    /updates\.phase === prevPhase[\s\S]{0,80}updatePhotoTile\(photo\.id\)/.test(customer));
}

section('Rock 4 rollback fallback (Phase 3 prep)');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const legacyPath = path.join(ROOT, 'docs/pro/dashboard.legacy.html');
  // 1. dashboard.html ships the ?legacy=1 redirect script.
  assert('dashboard.html has ?legacy=1 redirect to dashboard.legacy.html',
    /URLSearchParams\(location\.search\)\.has\(['"]legacy['"]\)[\s\S]{0,200}location\.replace\(['"]\/pro\/dashboard\.legacy\.html/.test(dash),
    'expected an inline <script> that redirects when ?legacy=1 is present');
  // 2. The redirect's pathname guard prevents an infinite loop on the
  //    legacy snapshot itself. The script must compare against
  //    '/pro/dashboard' (no .legacy suffix) so that location.pathname
  //    of '/pro/dashboard.legacy' fails the check and the page renders.
  assert('dashboard.html redirect guards against /pro/dashboard.legacy loop',
    /p === ['"]\/pro\/dashboard['"]/.test(dash),
    'pathname check must be strict equality with /pro/dashboard (not startsWith)');
  // 3. The legacy snapshot must exist and be non-trivial.
  assert('dashboard.legacy.html exists and is non-empty',
    fs.existsSync(legacyPath) && fs.statSync(legacyPath).size > 100000,
    'expected docs/pro/dashboard.legacy.html with >100KB of content');
}

// ── Summary ─────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
process.exit(0);
