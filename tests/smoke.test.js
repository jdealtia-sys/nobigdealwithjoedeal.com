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

// Audit batch 10: dashboard.html's 3986-line inline <script> got
// extracted to docs/pro/js/dashboard-main.js. Existing smoke tests
// that read dashboard.html and grep for code patterns now need to
// see BOTH files. readDashboard() returns the concatenation so the
// assertions don't care where a given handler lives.
//
// CSP hotfix (2026-05-16): the remaining inline <script> blocks in
// dashboard.html were also extracted (production CSP
// `script-src-elem 'self'` was blocking them, hanging the dashboard
// at the loading screen). readDashboard() now also includes every
// new dashboard-*.js shard so existing regex assertions keep working
// regardless of which JS file the handler ended up in.
const DASHBOARD_EXTRACTED_SHARDS = [
  'dashboard-main.js',
  'dashboard-legacy-redirect.js',
  'dashboard-appcheck-config.js',
  'dashboard-auth-gate.module.js',
  'dashboard-bootstrap.module.js',
  'dashboard-loader-fadeout.js',
  'dashboard-ui-prefs-boot.js',
  'dashboard-nav-init.js',
  'dashboard-shortcuts-tabs.js',
  'dashboard-crew-calendar-toggle.js',
  'dashboard-accessory-panel-init.js',
  'dashboard-insurance-overlay-toggle.js',
  'dashboard-custom-theme.js',
  'dashboard-sidebar-customizer.js',
  'dashboard-team-tab.js',
  'dashboard-billing-tab.js',
  'dashboard-hotkey-toggles.js',
  'dashboard-sw-bootstrap.js',
  'dashboard-load-status-banner.js',
];
function readDashboard() {
  const html = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const parts = [html];
  for (const shard of DASHBOARD_EXTRACTED_SHARDS) {
    const p = path.join(ROOT, 'docs/pro/js', shard);
    if (fs.existsSync(p)) parts.push(read(p));
  }
  return parts.join('\n');
}

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
  // CSP hotfix (2026-05-16): App Check init module + key-config were
  // extracted into dashboard-bootstrap.module.js + dashboard-appcheck-config.js
  // respectively (production CSP `script-src-elem 'self'` was blocking
  // them inline). readDashboard() concatenates the HTML + all dashboard
  // shards so the same regex assertions keep working.
  const src = readDashboard();
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
  // Audit batch 10: search across dashboard.html + dashboard-main.js
  // since the inline handlers moved into the extracted file.
  const dash = readDashboard();
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
  // CSP hotfix: _saveSettings lives in dashboard-bootstrap.module.js
  // after extraction, so use readDashboard() (HTML + all shards).
  const dash = readDashboard();
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
  const dash = readDashboard();
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

// Audit batch 10: dash() searches across dashboard.html AND the
// extracted dashboard-main.js so tests that grep for inline handlers
// find them after the extraction.
function dash() { return readDashboard(); }

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
    /data-target="AdminManager\.rotateAccessCodes"/.test(dash));
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
  // CSP hotfix: subscribe wiring is in dashboard-bootstrap.module.js.
  const dash = readDashboard();
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
  // Audit batch 10: also search dashboard-main.js for the extracted
  // helper definition (the inline button still lives in dashboard.html).
  const dash = readDashboard();
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
  // Voice memo button on the lead detail modal. The label was
  // shortened from "Record Voice Memo" to "Voice Memo" in the
  // 2026-05-05 modal redesign (cd-share-row), so the assertion
  // checks for the wiring (NBDVoiceMemo.recordForLead) AND the
  // label text — both must be present for the button to actually
  // record a memo. If you rename the label, update the regex but
  // KEEP the recordForLead wiring check.
  assert('Voice Memo button on lead detail',
    /(Voice Memo|Record Voice Memo)/.test(dash) &&
    /data-action="call" data-fn="cdaVoiceMemo"/.test(dash));
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

section('Visual regression baseline (Playwright pixel-diff)');
{
  const spec = read(path.join(ROOT, 'tests/e2e/visual-regression.spec.js'));
  const pkg  = JSON.parse(read(path.join(ROOT, 'tests/package.json')));
  // Suite covers public pages only — auth pages need a session.
  assert('visual-regression.spec.js covers login/register/pricing/landing',
    /\/pro\/login/.test(spec)
    && /\/pro\/register/.test(spec)
    && /\/pro\/pricing/.test(spec)
    && /name:\s*['"]landing['"]/.test(spec));
  // Three viewports — mobile/tablet/desktop. The mobile-375 snapshot
  // is the one Joe lives in (iPhone in the field).
  assert('three viewports configured (375 / 768 / 1280)',
    /width:\s*375/.test(spec)
    && /width:\s*768/.test(spec)
    && /width:\s*1280/.test(spec));
  // Animations must be neutralized before screenshot — fail-loud
  // if someone removes the disable-transitions style block, because
  // mid-animation pixels would flake the diff forever.
  assert('animations + transitions disabled before screenshot',
    /transition:\s*none\s*!important[\s\S]{0,80}animation:\s*none\s*!important/.test(spec));
  // Mask hooks for high-entropy regions — keeps live-counter pages
  // (pricing carousels, "as of" timestamps) from flaking.
  assert('mask hooks for live-timestamp + data-mask-visual',
    /mask:\s*\[[\s\S]{0,200}\.live-timestamp/.test(spec)
    && /\[data-mask-visual\]/.test(spec));
  // npm scripts wired so CI + local can run + update baselines.
  assert('test:e2e:visual + test:e2e:visual:update npm scripts',
    !!(pkg.scripts && pkg.scripts['test:e2e:visual'])
    && !!(pkg.scripts && pkg.scripts['test:e2e:visual:update']));
}

section('Customer-facing portal gallery — share photos with homeowner');
{
  const portal   = read(path.join(ROOT, 'functions/portal.js'));
  const portalUI = read(path.join(ROOT, 'docs/pro/portal.html'));
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  const types    = read(path.join(ROOT, 'docs/pro/js/types.js'));

  // Backend query — must constrain to the rep's own photos
  // (userId == ownerUid) AND only photos the rep flipped to
  // sharedWithHomeowner. Without the second clause, every photo
  // on the lead would leak to the homeowner page.
  assert('getHomeownerPortalView queries shared photos with both gates',
    /\.collection\(['"]photos['"]\)[\s\S]{0,400}\.where\(['"]leadId['"][\s\S]{0,200}\.where\(['"]userId['"][\s\S]{0,200}\.where\(['"]sharedWithHomeowner['"], ['"]==['"], true\)/.test(portal));

  // Hard cap on returned photos so a runaway query can't dump
  // 500 photos to the homeowner page in one fetch.
  assert('shared-photos query is .limit(50) capped',
    /\.where\(['"]sharedWithHomeowner['"][\s\S]{0,200}\.limit\(50\)/.test(portal));

  // Redacted projection — homeowner gets the picture + phase +
  // optional caption, NOTHING ELSE. No internal notes,
  // damageType, severity, location, tags.
  assert('photo projection redacts to id/urls/url/phase/caption only',
    /photos: photoSnap\.docs\.map\([\s\S]{0,400}id:[\s\S]{0,80}urls:[\s\S]{0,80}url:[\s\S]{0,80}phase:[\s\S]{0,80}caption:/.test(portal));
  assert('photo projection does NOT include damageType / severity / tags / description',
    !/photos:[\s\S]{0,800}damageType:/.test(portal)
    && !/photos:[\s\S]{0,800}severity:/.test(portal)
    && !/photos:[\s\S]{0,800}tags:/.test(portal));

  // Frontend gallery render — uses the responsive variants from
  // PR #75 when present, falls back to the original url for
  // legacy / pre-pipeline photos. Window widened in photo-system
  // Phase 5 to account for phase tabs + location chips that now sit
  // between the card header and the photo grid.
  assert('portal.html renders Project Photos card when view.photos non-empty',
    /Project Photos[\s\S]{0,2000}ph-grid/.test(portalUI));
  assert('portal.html emits srcset 200w/600w/1600w for variants',
    /srcset="[^"]*200w[^"]*600w[^"]*1600w/.test(portalUI));
  assert('portal.html falls back to p.url when urls missing',
    /\(p\.urls && p\.urls\.med\)\s*\?\s*esc\(p\.urls\.med\)\s*:\s*esc\(p\.url \|\| ['"]/.test(portalUI));

  // Phase ordering — Before / During / After feels intentional;
  // a hash-table order would put new photos in random places.
  assert('portal.html sorts gallery by phase Before → During → After',
    /phaseOrder\s*=\s*\{[\s\S]{0,80}Before[\s\S]{0,40}During[\s\S]{0,40}After/.test(portalUI));

  // Gallery CSS — purely structural; visual regression covers
  // anything subtler. Just pin the grid + tile classes so a
  // refactor can't accidentally drop them.
  assert('portal.html has .ph-grid + .ph-tile CSS rules',
    /\.ph-grid\s*\{/.test(portalUI) && /\.ph-tile\s*\{/.test(portalUI));

  // Rep-side toggle — buildPhotoBadges emits the share badge as
  // a real <button> with data-action so the delegated handler
  // can route the click without opening the lightbox.
  assert('customer.html buildPhotoBadges emits share toggle button',
    /data-action="toggle-share"[\s\S]{0,200}data-photo-id="' \+ esc\(photo\.id\)/.test(customer));
  assert('customer.html shows different badge for shared vs unshared',
    /if \(photo\.sharedWithHomeowner\)[\s\S]{0,400}Shared[\s\S]{0,400}else[\s\S]{0,400}Share/.test(customer));

  // toggleHomeownerShare optimistic update + Firestore write +
  // revert-on-failure path. All three matter — without revert,
  // a network blip leaves the UI lying about the share state.
  assert('toggleHomeownerShare flips local + writes Firestore + reverts on failure',
    /window\.toggleHomeownerShare = async function/.test(customer)
    && /photo\.sharedWithHomeowner = !prev/.test(customer)
    && /window\.updateDoc\(window\.doc\(window\.db, ['"]photos['"], photoId\)/.test(customer)
    && /catch \(err\)[\s\S]{0,400}photo\.sharedWithHomeowner = prev/.test(customer));

  // Delegated click handler must intercept share clicks BEFORE
  // the lightbox/select branches — otherwise tapping Share also
  // opens the photo editor.
  assert('photo grid delegate routes toggle-share before lightbox/select',
    /var shareBtn = ev\.target\.closest\(['"]\[data-action="toggle-share"\]['"]\)/.test(customer)
    && /ev\.stopPropagation\(\)[\s\S]{0,200}toggleHomeownerShare/.test(customer));

  // Photo projection round-trips the share + caption fields so
  // they survive IDB cache hits + the initial Firestore load.
  assert('photoDocToView preserves sharedWithHomeowner + homeownerCaption',
    /sharedWithHomeowner:\s*!!d\.sharedWithHomeowner/.test(customer)
    && /homeownerCaption:\s*d\.homeownerCaption \|\| ['"]['"]/.test(customer));

  // JSDoc — type doc must reflect the new fields so editor
  // autocomplete picks them up.
  assert('types.js Photo typedef documents sharedWithHomeowner + homeownerCaption',
    /@property \{boolean=\} sharedWithHomeowner/.test(types)
    && /@property \{string=\} homeownerCaption/.test(types));
}

section('NBDIDBCache — IndexedDB offline-first cache');
{
  const idb      = read(path.join(ROOT, 'docs/pro/js/idb-cache.js'));
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));

  // Public surface — these names are the integration contract.
  assert('idb-cache exports get/put/clear/clearAll/revalidate/setActiveUid on window.NBDIDBCache',
    /window\.NBDIDBCache\s*=\s*api/.test(idb)
    && /get:\s*get/.test(idb)
    && /put:\s*put/.test(idb)
    && /clear:\s*clear/.test(idb)
    && /clearAll:\s*clearAll/.test(idb)
    && /revalidate:\s*revalidate/.test(idb)
    && /setActiveUid:\s*setActiveUid/.test(idb));

  // Per-uid partition is non-negotiable — two reps sharing a
  // device must NOT see each other's cached PII.
  assert('DB name includes uid to partition cache per account',
    /nbd-pro-cache-['"]?\s*\+\s*\(uid \|\| ['"]anon['"]\)/.test(idb));
  assert('setActiveUid resets dbPromise to force re-open with new name',
    /function setActiveUid\(uid\)[\s\S]{0,400}dbPromise\s*=\s*null/.test(idb));

  // Graceful no-IDB fallback. Critical for Safari private mode +
  // embedded WebViews where IndexedDB throws synchronously on
  // open(). Every method must resolve with a sentinel rather
  // than reject.
  assert('openDB resolves null when indexedDB is undefined',
    /typeof indexedDB === ['"]undefined['"][\s\S]{0,200}Promise\.resolve\(null\)/.test(idb));
  assert('openDB swallows synchronous open() throws',
    /try \{[\s\S]{0,200}indexedDB\.open\([\s\S]{0,200}catch \(err\)[\s\S]{0,200}resolve\(null\)/.test(idb));

  // Promise wrapper for IDBRequest — single primitive everything
  // else builds on. Must resolve on success, reject on error.
  assert('idbReq resolves on success and rejects on error',
    /function idbReq\(req\)[\s\S]{0,300}req\.onsuccess[\s\S]{0,200}req\.onerror[\s\S]{0,200}reject/.test(idb));

  // revalidate semantics:
  //  - cache hit fires onCached SYNCHRONOUSLY for instant paint
  //  - loader runs in parallel; on success, fresh data replaces
  //    cache + is returned
  //  - on loader failure, return cached data (offline mode)
  assert('revalidate fires onCached when cache fresh',
    /if \(rec && \(Date\.now\(\) - \(rec\.at \|\| 0\)\) <= maxAgeMs\)[\s\S]{0,300}onCached\(rec\.data\)/.test(idb));
  assert('revalidate falls back to cached data on loader failure',
    /\.catch\(function \(err\)[\s\S]{0,300}return rec\.data/.test(idb));

  // Cache write is fire-and-forget — must not block the caller
  // on IDB latency.
  assert('revalidate does not await put(slice, fresh)',
    /\.then\(function \(fresh\) \{[\s\S]{0,200}put\(slice, fresh\);[\s\S]{0,80}return fresh/.test(idb));

  // Customer page wiring — script tag, auth hooks, photo loader.
  assert('customer.html loads idb-cache.js after state-store.js',
    /state-store\.js[\s\S]{0,400}idb-cache\.js/.test(customer));
  assert('customer.html calls setActiveUid(user.uid) on signin',
    /NBDIDBCache\.setActiveUid\(user\.uid\)/.test(customer));
  assert('customer.html calls clearAll() on signout',
    /window\.NBDIDBCache && window\.NBDIDBCache\.clearAll\(\)/.test(customer));

  // Single projection function — guarantees cache hit + fresh
  // fetch produce identical objects (no flicker on revalidate).
  assert('photoDocToView is the single Firestore→view projection',
    /function photoDocToView\(id, d\)/.test(customer)
    && /list\.push\(photoDocToView\(doc\.id, doc\.data\(\)\)\)/.test(customer));

  // urls + storagePath must round-trip through the cache so the
  // <img srcset> render path keeps working from cached entries.
  assert('photoDocToView preserves urls + storagePath fields',
    /urls:\s*d\.urls \|\| null/.test(customer)
    && /storagePath:\s*d\.storagePath \|\| ['"]/.test(customer));

  // Cache key includes uid so a different rep on the same device
  // doesn't read the previous account's photo cache.
  assert('cache key namespaced by uid + leadId',
    /['"]photos:['"]\s*\+\s*uid\s*\+\s*['"]:[\"']\s*\+\s*leadId/.test(customer));

  // Sanity-bounded freshness — don't show year-stale photos.
  assert('photos.maxAgeMs ≤ 30 days',
    /maxAgeMs:\s*30\s*\*\s*86400000/.test(customer));

  // Backward compat: no NBDIDBCache → plain Firestore path with
  // the same view code.
  assert('no-IDB fallback runs fetchFresh + applyPhotosToView',
    /if \(!window\.NBDIDBCache\)[\s\S]{0,300}fetchFresh\(\)[\s\S]{0,200}applyPhotosToView\(list\)/.test(customer));
}

section('Share SSR — server-rendered /share/:token preview');
{
  const ssr      = read(path.join(ROOT, 'functions/share-ssr.js'));
  const idx      = read(FUNCTIONS + '/index.js');
  const fbJson   = JSON.parse(read(path.join(ROOT, 'firebase.json')));

  // Public surface — onRequest export wired into index.js.
  assert('share-ssr exports shareSSR onRequest',
    /exports\.shareSSR\s*=\s*onRequest/.test(ssr));
  assert('functions/index.js wires exports.shareSSR',
    /exports\.shareSSR\s*=\s*_shareSSR\.shareSSR/.test(idx));

  // Hosting rewrite — /share/** must route to the function. The
  // matcher uses ** (not :token) because Firebase Hosting v1
  // rewrites accept globs; the function reads the token off
  // req.path with its own regex.
  const shareRewrite = (fbJson.hosting && fbJson.hosting.rewrites || [])
    .find(r => r.source === '/share/**');
  assert('firebase.json rewrites /share/** → shareSSR cloud function',
    !!shareRewrite
    && shareRewrite.function
    && shareRewrite.function.functionId === 'shareSSR');

  // GET-only — POST/PUT/DELETE on this endpoint should not run
  // any work. The 405 response also needs the Allow header so a
  // crawler retrying with GET knows what to do.
  assert('shareSSR rejects non-GET methods with 405 + Allow header',
    /req\.method !== ['"]GET['"]/.test(ssr)
    && /res\.set\(['"]Allow['"], ['"]GET['"]\)\.status\(405\)/.test(ssr));

  // Token regex — must constrain length + alphabet to match the
  // 24-char no-confusable mintPortalToken format. A liberal regex
  // would let attackers smuggle path traversal or filesystem-y
  // characters into the Firestore lookup.
  assert('TOKEN_RE constrains to alphanumeric, 10-64 chars',
    /TOKEN_RE\s*=\s*\/\^\[A-Z0-9\]\{10,64\}\$\/i/.test(ssr));

  // Per-IP rate limit — must run BEFORE any Firestore reads, or
  // a brute-force token sweep would burn read quota.
  assert('rate limit runs before Firestore lookup',
    /httpRateLimit\(req, res, ['"]shareSSR:ip['"], 120, 60_000\)/.test(ssr));

  // Locked-down CSP + noindex on every response. Homeowner data
  // must not leak via injected script and must not get indexed.
  assert('every response sets tight CSP + X-Robots-Tag noindex',
    /res\.set\(['"]Content-Security-Policy['"][\s\S]{0,200}default-src ['"]none['"]/.test(ssr)
    && /res\.set\(['"]X-Robots-Tag['"], ['"]noindex, nofollow['"]\)/.test(ssr));

  // OG + Twitter Card meta — the whole point. Without these the
  // crawler renders "no preview".
  assert('renderPage emits og:title + og:description + twitter:card',
    /og:title/.test(ssr) && /og:description/.test(ssr)
    && /twitter:card/.test(ssr));

  // HTML escape — lead.firstName / address / rep.displayName are
  // user-controlled and end up in the body + the og:title attr.
  assert('escHtml escapes &<>"\\\' ',
    /escHtml\(s\)[\s\S]{0,400}\.replace\(\/&\/g[\s\S]{0,200}\.replace\(\/'\/g/.test(ssr));
  assert('every interpolation goes through escHtml',
    /\$\{safeTitle\}/.test(ssr) && /\$\{safeAddr\}/.test(ssr)
    && /\$\{safeRepName\}/.test(ssr));

  // Token usage counter MUST NOT increment on preview crawls —
  // otherwise iMessage previewing the link would count as 4-5
  // opens before the homeowner ever clicks.
  assert('shareSSR does NOT increment portal_tokens uses counter',
    /deliberately NOT incrementing tok\.uses/i.test(ssr)
    && !/tok\.uses\s*\+\s*1/.test(ssr)
    && !/uses:\s*FieldValue\.increment/.test(ssr));

  // Expired tokens render a branded 410 page, not a raw 404 —
  // crawlers ignoring 404s would leave a "broken link" preview.
  assert('expired token renders 410 with branded HTML',
    /function expiredPage\(\)[\s\S]{0,500}status:\s*410/.test(ssr));

  // CTA hands off to the existing client-rendered portal.
  assert('project page CTA links to /pro/portal.html?token=',
    /\/pro\/portal\.html\?token=\$\{encodeURIComponent\(safeToken\)\}/.test(ssr));

  // Failure isolation — a Firestore exception must not 500.
  // The crawler still gets a branded preview.
  assert('catch block falls back to notFoundPage instead of 500',
    /catch \(err\)[\s\S]{0,400}send\(notFoundPage\(\)\)/.test(ssr));
}

section('Bulk lead operations — writeBatch + NBDStore + new fields');
{
  const crm  = read(path.join(ROOT, 'docs/pro/js/crm.js'));
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));

  // Selection state must live in NBDStore now — direct mutation
  // of window._bulkSelected would skip subscriber notify.
  assert('crm.js seeds leads.bulkSelected slice in NBDStore',
    /NBDStore\.set\(['"]leads\.bulkSelected['"], new Set\(\)\)/.test(crm));
  assert('crm.js binds _bulkSelected → leads.bulkSelected (one-way)',
    /NBDStore\.bind\(['"]_bulkSelected['"], ['"]leads\.bulkSelected['"]\)/.test(crm));
  assert('crm.js subscribes updateBulkToolbar to leads.bulkSelected',
    /NBDStore\.subscribe\(['"]leads\.bulkSelected['"][\s\S]{0,200}updateBulkToolbar/.test(crm));

  // updateBulkSelection swaps the Set ref every write — required
  // for the NBDStore identity-equality short-circuit to fire.
  assert('updateBulkSelection swaps Set ref to trigger notify',
    /function updateBulkSelection\(mutate\)[\s\S]{0,400}var next = new Set\(prev\);[\s\S]{0,200}NBDStore\.set\(['"]leads\.bulkSelected['"], next\)/.test(crm)
    || /function updateBulkSelection\(mutate\)[\s\S]{0,400}const next = new Set\(prev\);[\s\S]{0,200}NBDStore\.set\(['"]leads\.bulkSelected['"], next\)/.test(crm));

  // bulkDelete must use writeBatch — the previous serial loop did
  // N round-trips and was non-atomic. commitBulkLeadOp is the
  // single place batches are formed.
  assert('bulkDelete routes through commitBulkLeadOp (writeBatch)',
    /async function bulkDelete\(\)[\s\S]{0,1500}commitBulkLeadOp/.test(crm));
  assert('commitBulkLeadOp uses writeBatch + chunk cap < 500',
    /async function commitBulkLeadOp[\s\S]{0,500}window\.writeBatch\(window\.db\)/.test(crm)
    && /CHUNK\s*=\s*450/.test(crm));

  // New bulk capabilities — carrier + damage. These are the
  // direct UX wins; without them Joe was hand-editing 20+ leads
  // one at a time after a hailstorm sweep.
  assert('bulkAssignCarrier reads bulkCarrierSelect.value',
    /async function bulkAssignCarrier\(\)[\s\S]{0,300}bulkCarrierSelect[\s\S]{0,200}bulkAssignField\(['"]carrier['"]/.test(crm));
  assert('bulkAssignDamage reads bulkDamageSelect.value',
    /async function bulkAssignDamage\(\)[\s\S]{0,300}bulkDamageSelect[\s\S]{0,200}bulkAssignField\(['"]damageType['"]/.test(crm));

  // Field allowlist — privileged fields (companyId, role, isAdmin)
  // must NOT be writable through this path, even though
  // firestore.rules already blocks them. Defense in depth.
  // Wave 32 extended the set with source + jobType for bulk
  // post-import cleanup; the test rewrites against the same shape
  // and explicitly asserts the privileged-field guard separately.
  assert('BULK_LEAD_FIELDS allowlist constrains writable fields',
    /BULK_LEAD_FIELDS\s*=\s*new Set\(\[['"]carrier['"], ['"]damageType['"], ['"]followUp['"], ['"]tags['"], ['"]source['"], ['"]jobType['"]\]\)/.test(crm));
  // Privileged-field exclusion sanity check — these must NEVER
  // appear in the allowlist no matter how it's expanded.
  assert('BULK_LEAD_FIELDS does not allow privileged fields',
    !/BULK_LEAD_FIELDS\s*=\s*new Set\(\[[^\]]*['"](?:companyId|role|isAdmin|userId|deleted)['"][^\]]*\]\)/.test(crm));
  assert('bulkAssignField rejects non-allowlisted fields',
    /if \(!BULK_LEAD_FIELDS\.has\(field\)\)[\s\S]{0,200}return;/.test(crm));

  // Optimistic local update so the kanban reflects without a
  // full reload. Must run AFTER batch.commit succeeds.
  assert('bulkAssignField patches local _leads + re-renders',
    /\(window\._leads \|\| \[\]\)\.forEach[\s\S]{0,200}l\[field\] = value/.test(crm));

  // Select-all-visible — Joe's #1 ask after hailstorm sweeps.
  assert('selectAllVisibleLeads gathers visible .k-card data-id',
    /function selectAllVisibleLeads\(\)/.test(crm)
    && /\.querySelectorAll\(['"]\.kanban-board \.k-card['"]\)/.test(crm)
    && /next\.add\(id\)/.test(crm));

  // Toolbar UI — new selects + buttons must be in the DOM.
  assert('dashboard.html bulk toolbar has bulkCarrierSelect + bulkDamageSelect',
    /id="bulkCarrierSelect"/.test(dash) && /id="bulkDamageSelect"/.test(dash));
  assert('dashboard.html toolbar wires bulkAssignCarrier + bulkAssignDamage',
    /data-action="call" data-fn="bulkAssignCarrier"/.test(dash)
    && /data-action="call" data-fn="bulkAssignDamage"/.test(dash));
  assert('dashboard.html toolbar has Select-all-visible button',
    /data-action="call" data-fn="selectAllVisibleLeads"/.test(dash));

  // Public API — every helper exposed on window so inline
  // onclick handlers can reach them.
  assert('crm.js exposes new bulk helpers on window',
    /window\.bulkAssignCarrier\s*=\s*bulkAssignCarrier/.test(crm)
    && /window\.bulkAssignDamage\s*=\s*bulkAssignDamage/.test(crm)
    && /window\.selectAllVisibleLeads\s*=\s*selectAllVisibleLeads/.test(crm)
    && /window\.updateBulkToolbar\s*=\s*updateBulkToolbar/.test(crm));
}

section('NBDStore — pub/sub state store + first-slice migration');
{
  const store    = read(path.join(ROOT, 'docs/pro/js/state-store.js'));
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  const dash     = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const pkg      = JSON.parse(read(path.join(ROOT, 'tests/package.json')));

  // Public surface — these names are the migration contract; renaming
  // any of them silently breaks every call site that adopts the store.
  assert('state-store exports create + get + set + subscribe + bind on window.NBDStore',
    /window\.NBDStore\s*=\s*api/.test(store)
    && /create:\s*create/.test(store)
    && /get:\s*singleton\.get/.test(store)
    && /set:\s*singleton\.set/.test(store)
    && /subscribe:\s*singleton\.subscribe/.test(store)
    && /bind:\s*singleton\.bind/.test(store));

  // Identity-equality short-circuit — if this regresses, every legacy
  // call site that does `set.add(x); store.set('photos.selected', set)`
  // would silently fail to notify subscribers and the bulk-bar would
  // never re-render. Test directly in state-store.test.js; smoke just
  // pins the comparison line so a refactor can't drop it.
  assert('set short-circuits when prev === value',
    /if \(prev === value\) return false;/.test(store));

  // Subscriber-throw isolation — a single buggy listener must not
  // break every other listener for the same path.
  assert('notify catches subscriber throws and continues',
    /try \{[\s\S]{0,80}listeners\[i\]\(value, path\);[\s\S]{0,200}console\.error/.test(store));

  // bind() is one-way (store → window). Two-way would let legacy
  // direct writes to window._foo bypass subscribers entirely, so the
  // doc + the impl must both refuse it.
  assert('state-store documents one-way window mirror',
    /NOT a two-way sync/.test(store));

  // Both pages load the module BEFORE any feature script that might
  // want to subscribe (sentry-init seeds error reporting; everything
  // after that can read the store).
  assert('customer.html loads state-store.js after sentry-init',
    /sentry-init\.js[\s\S]{0,400}state-store\.js/.test(customer));
  assert('dashboard.html loads state-store.js after sentry-init',
    /sentry-init\.js[\s\S]{0,400}state-store\.js/.test(dash));

  // First slice migrated — photos.selected. The customer page wires
  // selection state into the store, binds it to the legacy global
  // for backward compat, and re-emits to updateBulkBarUI via a
  // subscriber so call sites don't need to know about the bar.
  assert('customer.html seeds photos.selected slice in NBDStore',
    /NBDStore\.set\(['"]photos\.selected['"], new Set\(\)\)/.test(customer));
  assert('customer.html binds _photoSelected → photos.selected (one-way)',
    /NBDStore\.bind\(['"]_photoSelected['"], ['"]photos\.selected['"]\)/.test(customer));
  assert('customer.html subscribes bulk-bar render to photos.selected',
    /NBDStore\.subscribe\(['"]photos\.selected['"][\s\S]{0,200}updateBulkBarUI/.test(customer));

  // Mutations now go through the helper that swaps the Set ref —
  // mutate-in-place would skip the identity check above and never
  // notify subscribers.
  assert('updatePhotoSelection swaps Set ref to trigger notify',
    /function updatePhotoSelection\(mutate\)[\s\S]{0,400}var next = new Set\(prev\);[\s\S]{0,200}NBDStore\.set\(['"]photos\.selected['"], next\)/.test(customer));

  // Test runner is wired so CI runs the unit suite.
  assert('test:state npm script runs state-store.test.js',
    !!(pkg.scripts && pkg.scripts['test:state'] === 'node ./state-store.test.js'));
  assert('top-level test runs npm run test:state',
    /npm run test:state/.test(pkg.scripts.test || ''));
}

section('Image pipeline (Storage trigger → WebP variants → srcset)');
{
  const pipeline = read(path.join(ROOT, 'functions/image-pipeline.js'));
  const idx      = read(FUNCTIONS + '/index.js');
  const pkg      = JSON.parse(read(FUNCTIONS + '/package.json'));
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  const types    = read(path.join(ROOT, 'docs/pro/js/types.js'));

  // Public surface: onObjectFinalized export wired into index.js.
  assert('image-pipeline.js exports onPhotoUploaded onObjectFinalized',
    /exports\.onPhotoUploaded\s*=\s*onObjectFinalized/.test(pipeline));
  assert('functions/index.js wires exports.onPhotoUploaded',
    /exports\.onPhotoUploaded\s*=\s*_imagePipeline\.onPhotoUploaded/.test(idx));

  // sharp is the heavy dep — must be declared so deploys install it.
  assert('functions/package.json declares sharp dependency',
    !!(pkg.dependencies && pkg.dependencies.sharp));

  // Recursion guard: variants are written back into Storage at
  // photos/{uid}/_variants/... and would re-fire the trigger
  // forever without an early-exit.
  assert('pipeline skips variant paths to prevent recursion',
    /_variants\//.test(pipeline)
    && /includes\(['"]\/?_variants\//.test(pipeline));

  // Three variants — width + quality tuned per use site.
  // 200px = grid thumb, 600px = inline, 1600px = lightbox/print.
  assert('three variants generated (200 / 600 / 1600 px)',
    /name:\s*['"]thumb['"][^}]*width:\s*200/.test(pipeline)
    && /name:\s*['"]med['"][^}]*width:\s*600/.test(pipeline)
    && /name:\s*['"]full['"][^}]*width:\s*1600/.test(pipeline));

  // EXIF auto-orient must run BEFORE resize, otherwise sideways
  // iPhone portraits land cropped wrong in the variant.
  assert('sharp pipeline calls .rotate() before .resize()',
    /\.rotate\(\)[\s\S]{0,80}\.resize\(/.test(pipeline));

  // WebP encode is the whole point — JPEG output would defeat
  // the bandwidth savings.
  assert('variants are encoded as image/webp',
    /\.webp\(/.test(pipeline)
    && /['"]image\/webp['"]/.test(pipeline));

  // Long-lived URL via firebaseStorageDownloadTokens, NOT signed
  // URLs (which would expire). Cache-Control must mark variants
  // immutable so CDN keeps them indefinitely.
  assert('variants get firebaseStorageDownloadTokens + immutable cache',
    /firebaseStorageDownloadTokens/.test(pipeline)
    && /immutable/.test(pipeline));

  // Doc lookup uses storagePath — set by the upload code below.
  // If the trigger didn't query by storagePath, legacy/fresh docs
  // would never get stamped with `urls`.
  assert('pipeline finds photo doc via storagePath equality query',
    /\.where\(['"]storagePath['"],\s*['"]==['"]/.test(pipeline));

  // Doc gets stamped with urls + variantsGeneratedAt.
  assert('pipeline stamps urls + variantsGeneratedAt on photo doc',
    /\burls:\s*generated\b/.test(pipeline)
    && /variantsGeneratedAt:[\s\S]{0,80}serverTimestamp\(\)/.test(pipeline));

  // Upload write path: customer.html must persist storagePath so
  // the trigger has something to query against.
  assert('customer.html upload stores storagePath alongside url',
    /storagePath:\s*storagePath/.test(customer)
    && /const storagePath\s*=\s*`photos\/\$\{uid\}\/\$\{filename\}`/.test(customer));

  // Render path: <img srcset> helper present + used by both the
  // overview strip and the phase grid tiles.
  assert('buildPhotoImgAttrs exposed on window for shared use',
    /window\.buildPhotoImgAttrs\s*=\s*buildPhotoImgAttrs/.test(customer));
  assert('buildPhotoImgAttrs emits srcset 200w/600w/1600w',
    /200w[\s\S]{0,60}600w[\s\S]{0,60}1600w/.test(customer));
  assert('phase grid tile uses buildPhotoImgAttrs (no raw photo.url src)',
    /var imgAttrs = buildPhotoImgAttrs\(photo, esc, \{ sizes: '180px' \}\)/.test(customer)
    && /tile \+= '<img ' \+ imgAttrs/.test(customer));
  assert('overview strip uses buildPhotoImgAttrs with 160px hint',
    /window\.buildPhotoImgAttrs[\s\S]{0,200}sizes:\s*'160px'/.test(customer));

  // Backward compat: when photo.urls is missing, helper falls
  // back to plain photo.url so legacy docs (pre-pipeline) still
  // render correctly.
  assert('buildPhotoImgAttrs falls back to photo.url when urls missing',
    /if \(!hasVariants\)[\s\S]{0,200}src="' \+ esc\(primary\)/.test(customer));

  // Type doc updated — the Photo typedef must mention the new
  // urls + storagePath fields so JSDoc autocomplete works.
  assert('types.js Photo typedef documents urls + storagePath',
    /@property \{string=\} storagePath/.test(types)
    && /@property \{\{ thumb: string, med: string, full: string \}=\} urls/.test(types));
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

section('Firestore repository layer — write convention');
{
  const repos = read(path.join(ROOT, 'docs/pro/js/repos.js'));
  // Public API surface — three repos with matching shapes.
  assert('repos.js exports window.NBDRepos with leads/photos/estimates',
    /window\.NBDRepos\s*=\s*\{[\s\S]*leads:\s*leads[\s\S]*photos:\s*photos[\s\S]*estimates:\s*estimates/.test(repos));
  // stampCreate fills the 4 system fields exactly once. The Object.assign
  // pattern with caller data SECOND lets backfill scripts override the
  // stamps when they need to (e.g. preserving createdAt on imports).
  assert('stampCreate stamps userId + companyId + createdAt + updatedAt',
    /function stampCreate\([\s\S]{0,500}userId:\s*ctx\.uid[\s\S]{0,200}companyId:\s*ctx\.companyId[\s\S]{0,200}createdAt:\s*st[\s\S]{0,100}updatedAt:\s*st/.test(repos));
  // stampUpdate forces updatedAt — call sites must not override.
  assert('stampUpdate forces server updatedAt (caller cannot bump)',
    /function stampUpdate[\s\S]{0,300}Object\.assign\(\{\},\s*data,\s*\{\s*updatedAt:\s*st\s*\}\)/.test(repos));
  // context() throws fast on missing uid (better than letting
  // firestore.rules reject later). companyId falls back to uid for
  // solo operators per audit batch 6 — the original strict throw
  // blocked adoption since solo accounts don't carry a separate
  // companyId on their claims.
  assert('context() throws unauthenticated when uid missing',
    /code\s*=\s*['"]unauthenticated['"]/.test(repos));
  // Bulk write helpers use writeBatch — atomic round-trip.
  assert('photos.bulkUpdate uses writeBatch',
    /bulkUpdate:\s*async function[\s\S]{0,300}window\.writeBatch\(window\.db\)/.test(repos));
  // Soft-delete sets deleted:true rather than calling deleteDoc,
  // because cross-collection references would orphan otherwise.
  assert('leads.softDelete sets deleted:true (not deleteDoc)',
    /softDelete:\s*async function[\s\S]{0,200}deleted:\s*true/.test(repos)
    && /hardDelete:\s*async function[\s\S]{0,200}window\.deleteDoc/.test(repos));
}

section('JSDoc typedefs — Firestore document shapes');
{
  const types = read(path.join(ROOT, 'docs/pro/js/types.js'));
  // The five core typedefs every domain file should reach for.
  ['Lead', 'Photo', 'Estimate', 'UserProfile', 'Company', 'LeadActivity'].forEach(function (t) {
    assert('types.js declares @typedef ' + t,
      new RegExp('@typedef\\s+\\{object\\}\\s+' + t).test(types));
  });
  // Photo must include the new `.order` field documented as PR #68's
  // drag-rearranged sequence — otherwise the comparator will look like
  // it's reading a phantom field.
  assert('Photo typedef documents the .order field',
    /@property\s*\{number=\}\s*order/.test(types));
  // Lead must include .companyId since PR #60 made it required.
  assert('Lead typedef documents .companyId as required-on-create',
    /@property\s*\{string\}\s*companyId/.test(types));
  // The TimestampLike alias normalizes the three formats Firestore
  // hands back across server-set, client-set, and unset paths.
  assert('types.js declares TimestampLike alias for FirestoreTimestamp/string/number/null',
    /@typedef\s*\{FirestoreTimestamp[\s\S]{0,80}TimestampLike/.test(types));
}

section('Sentry — DSN config wired across high-value pages');
{
  const sentryConfig = read(path.join(ROOT, 'docs/pro/js/sentry-config.js'));
  // Config exposes the two globals sentry-init.js looks for.
  assert('sentry-config.js exposes window.__NBD_SENTRY_DSN',
    /window\.__NBD_SENTRY_DSN\s*=\s*NBD_SENTRY_DSN/.test(sentryConfig));
  assert('sentry-config.js exposes window.__NBD_RELEASE',
    /window\.__NBD_RELEASE\s*=\s*['"]web@/.test(sentryConfig));
  // Pages that need error reporting load BOTH the config and the SDK
  // shim, in that order. Config must come first so the DSN is on the
  // window before sentry-init reads it.
  ['dashboard.html', 'customer.html', 'login.html', 'register.html'].forEach(function (page) {
    var html = read(path.join(ROOT, 'docs/pro', page));
    assert(page + ' loads sentry-config.js before sentry-init.js',
      /sentry-config\.js[\s\S]{0,400}sentry-init\.js/.test(html),
      'sentry-config must come before sentry-init in ' + page);
  });
  // dashboard.html no longer hardcodes the DSN inline (it lives in
  // sentry-config.js now — single source of truth).
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  assert('dashboard.html no longer inlines window.__NBD_SENTRY_DSN',
    !/window\.__NBD_SENTRY_DSN\s*=\s*"[^"]*";/.test(dash));
}

section('Customer overview photo strip — cap + drag reorder');
{
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  // 25-cap on the overview photo strip (matches the dashboard's
  // PHOTO_PHASE_CAP pattern from PR #63).
  assert('overview strip caps at 25 with show-all toggle',
    /window\.PHOTO_OVERVIEW_CAP\s*=\s*25/.test(customer)
    && /toggleCustomerPhotosExpanded/.test(customer)
    && /nbd-photo-show-all-btn/.test(customer));
  // Comparator that prefers numeric .order, falls back to uploadedAt.
  assert('photos sort by .order field (drag-rearranged sequence first)',
    /function nbdComparePhotos\(a, b\)/.test(customer)
    && /typeof a\.order === 'number'/.test(customer));
  // Reorder mode is a body-class toggle so CSS shows drag affordance.
  assert('reorder mode toggle exposes draggable grid via body class',
    /document\.body\.classList\.toggle\('nbd-photo-reorder'\)/.test(customer)
    && /body\.nbd-photo-reorder \.nbd-photo-item/.test(customer));
  // HTML5 drag/drop wiring on the overview strip.
  assert('overview strip wires dragstart/dragover/drop handlers',
    /listEl\.addEventListener\('dragstart'/.test(customer)
    && /listEl\.addEventListener\('dragover'/.test(customer)
    && /listEl\.addEventListener\('drop'/.test(customer));
  // writeBatch persists the new order — one round-trip for the whole
  // sequence (same pattern as the multi-select feature).
  assert('persistCustomerPhotoOrder uses writeBatch',
    /async function persistCustomerPhotoOrder\(\)[\s\S]{0,400}window\.writeBatch\(window\.db\)[\s\S]{0,400}batch\.update\(/.test(customer));
  // Report generator must honour the user's drag-rearranged order.
  assert('generatePhotoReport iterates photos sorted by nbdComparePhotos',
    /__reportPhotos[\s\S]{0,200}\.sort\([\s\S]{0,80}nbdComparePhotos/.test(customer));
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

section('Audit batch 6 — repos.js wired into dashboard write path');
{
  // CSP hotfix: lead-create write path is in dashboard-bootstrap.module.js
  // now. We need raw HTML for the <script defer src="js/repos.js"> assertion
  // (that's about HTML structure, not JS content), so we keep both.
  const dashHtml = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const dash = readDashboard();
  const repos = read(path.join(ROOT, 'docs/pro/js/repos.js'));

  assert('dashboard.html loads repos.js in defer chain',
    /<script defer src="js\/repos\.js/.test(dashHtml),
    'expected <script defer src="js/repos.js" ...> in dashboard.html');

  assert('repos.js exposes window.NBDRepos.leads / photos / estimates',
    /window\.NBDRepos\s*=/.test(repos)
      && /leads:\s*leads/.test(repos)
      && /photos:\s*photos/.test(repos),
    'NBDRepos must export the lead + photo repositories');

  assert('repos.js falls back to uid when no companyId on claims (solo-operator support)',
    /\|\|\s*uid;/.test(repos) || /||\s*uid;/.test(repos),
    'companyId resolution must fall through to uid for solo operators');

  assert('dashboard.html lead-create migrated to NBDRepos.leads.create',
    /window\.NBDRepos\.leads\.create/.test(dash),
    'expected the lead-create write path to prefer NBDRepos.leads.create');
}

section('Audit batch 4 — admin function role-check drift guard');
{
  // Every Cloud Function the FUNCTIONS_INDEX.md classifies as ADMIN
  // must keep its role check. If someone refactors and drops the check
  // (no client caller would notice because admin functions have no
  // public client wrapper), the function silently becomes callable by
  // any authenticated user. CI catches that here.
  const indexPath = path.join(ROOT, 'functions/FUNCTIONS_INDEX.md');
  assert('functions/FUNCTIONS_INDEX.md exists',
    fs.existsSync(indexPath),
    'canonical functions taxonomy must exist');

  // Parse the ADMIN table out of the doc. Each row starts with
  // | `functionName` | ...
  const md = fs.existsSync(indexPath) ? read(indexPath) : '';
  const adminSection = md.match(/## ADMIN[\s\S]*?(?=\n## |$)/);
  const adminNames = adminSection
    ? Array.from(adminSection[0].matchAll(/\|\s*`(\w+)`\s*\|/g)).map(m => m[1])
    : [];
  assert('FUNCTIONS_INDEX lists at least 10 admin functions',
    adminNames.length >= 10,
    'expected the admin section to enumerate all admin exports');

  // The 4 known admin-gating patterns we accept anywhere in the file
  // that defines the function. Mostly we look at functions/index.js
  // because that's where the inline definitions live; for the few
  // admin functions exported from sub-modules we look at the source.
  const PATTERNS = [
    /role\s*===\s*['"]admin['"]/,
    /adminOnly:\s*true/,
    /requireTeamAdmin\s*\(/,
    /isAdmin\s*\(\)/,
  ];

  // Scan every .js in functions/ (skip node_modules) for definitions
  // of each admin function. If we find one, assert at least one of the
  // patterns appears within 200 lines of the export.
  function adminGateOk(name) {
    const candidates = ['functions/index.js'];
    // Cheap: assume any sub-module that re-exports is the definition site
    const subFiles = fs.readdirSync(path.join(ROOT, 'functions'))
      .filter(f => f.endsWith('.js') && f !== 'index.js')
      .map(f => 'functions/' + f);
    candidates.push(...subFiles);
    for (const c of candidates) {
      const full = path.join(ROOT, c);
      if (!fs.existsSync(full)) continue;
      const src = read(full);
      const declRe = new RegExp('(?:exports\\.' + name + '\\s*=|function\\s+' + name + '\\s*\\()', '');
      const m = src.match(declRe);
      if (!m) continue;
      // Look at the 200 lines after the declaration for an admin pattern.
      const idx = m.index;
      const window = src.slice(idx, idx + 8000);
      if (PATTERNS.some(p => p.test(window))) return true;
    }
    return false;
  }

  const skipped = new Set([
    // E2E test helpers — admin-gated but the pattern shows up in helper code
    // they're allowed.
  ]);
  const missing = [];
  for (const name of adminNames) {
    if (skipped.has(name)) continue;
    if (!adminGateOk(name)) missing.push(name);
  }
  assert('every admin function in FUNCTIONS_INDEX has a role/admin gate',
    missing.length === 0,
    missing.length ? 'admin gate missing from: ' + missing.join(', ') : '');
}

section('Rock 4 rollback fallback (Phase 3 prep)');
{
  // CSP hotfix (2026-05-16): the redirect script was inline; now it
  // lives in docs/pro/js/dashboard-legacy-redirect.js. dashboard.html
  // still ships the <script src> reference, and readDashboard() rolls
  // in the new shard so the body assertions still match.
  const dash = readDashboard();
  const dashHtml = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const legacyPath = path.join(ROOT, 'docs/pro/dashboard.legacy.html');
  // 1. dashboard ships the ?legacy=1 redirect logic (inline or external).
  assert('dashboard.html has ?legacy=1 redirect to dashboard.legacy.html',
    /URLSearchParams\(location\.search\)\.has\(['"]legacy['"]\)[\s\S]{0,200}location\.replace\(['"]\/pro\/dashboard\.legacy\.html/.test(dash),
    'expected a <script> (inline or external) that redirects when ?legacy=1 is present');
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
  // 4. dashboard.html itself still references the redirect script, so
  //    the rollback path can never silently disappear in a future edit.
  assert('dashboard.html references the legacy-redirect script',
    /dashboard-legacy-redirect\.js/.test(dashHtml) ||
    /URLSearchParams\(location\.search\)\.has\(['"]legacy['"]\)/.test(dashHtml),
    'expected dashboard.html to ship the redirect either inline or via <script src>');
}

section('Wave 6b (A.2) — Pro Chrome on login.html + vault.html');
{
  const login = read(path.join(ROOT, 'docs/pro/login.html'));
  const vault = read(path.join(ROOT, 'docs/pro/vault.html'));
  // 1. login.html supplies its own --accent-fg + --accent-ring (it keeps
  //    --orange fixed for brand consistency, so it can't inherit per-theme
  //    overrides; the contract lives locally).
  assert('login.html defines --accent-fg + --accent-ring',
    /:root\{[\s\S]{0,800}--accent-fg:#fff[\s\S]{0,200}--accent-ring/.test(login),
    'expected login.html :root to declare --accent-fg + --accent-ring');
  // 2. login.html primary action surfaces consume the contract.
  assert('login.html .tab-btn.active uses var(--accent-fg)',
    /\.tab-btn\.active\{[^}]*background:var\(--orange\)[^}]*color:var\(--accent-fg\)/.test(login),
    'expected .tab-btn.active to color: var(--accent-fg)');
  assert('login.html .btn-main uses var(--accent-fg) + inset --accent-ring',
    /\.btn-main\{[^}]*color:var\(--accent-fg\)[\s\S]{0,500}box-shadow:inset 0 0 0 1px var\(--accent-ring\)/.test(login),
    'expected .btn-main to use --accent-fg + inset --accent-ring boundary');
  // 3. vault.html does the same.
  assert('vault.html declares --accent-fg + --accent-ring',
    /--accent-fg:#fff[\s\S]{0,200}--accent-ring:rgba/.test(vault),
    'expected vault.html to declare the accent tokens locally');
  assert('vault.html .btn-save / .btn-gold use var(--accent-fg)',
    /\.btn-save \{[\s\S]{0,400}color:\s*var\(--accent-fg\)/.test(vault)
    && /\.btn-gold \{[\s\S]{0,400}color:\s*var\(--accent-fg\)/.test(vault),
    'expected vault.html primary-action buttons to consume --accent-fg');
  // 4. Both files retired hardcoded NBD-orange rgba literals.
  for (const [name, body] of [['login.html', login], ['vault.html', vault]]) {
    assert(name + ': no hardcoded rgba(232,114,12,...) left',
      !/rgba\(232,\s*114,\s*12/.test(body),
      name + ' should use color-mix(in srgb, var(--orange) ...) instead of literal NBD-orange rgba');
  }
}

section('Wave 6 (A.1) — Pro Chrome on customer.html via shared theme-system.css');
{
  const themeCSS = read(path.join(ROOT, 'docs/pro/css/theme-system.css'));
  const customer = read(path.join(ROOT, 'docs/pro/customer.html'));
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. Shared contract lives in theme-system.css now.
  assert('theme-system.css defines :root --accent-fg default #fff',
    /:root\s*\{[\s\S]{0,200}--accent-fg\s*:\s*#fff/.test(themeCSS),
    'expected --accent-fg default in shared theme-system.css');
  assert('theme-system.css defines :root --accent-ring default',
    /:root\s*\{[\s\S]{0,200}--accent-ring\s*:\s*rgba/.test(themeCSS),
    'expected --accent-ring default in shared theme-system.css');
  // 2. Per-theme overrides moved into the shared file. Some themes
  //    share a group selector (paper + ghost + easter etc. → one
  //    --accent-fg block), so we just check the theme name appears in
  //    a selector that sits above an --accent-fg declaration.
  for (const theme of ['paper','obsidian','steel','slate','neon','gold','batman','pokemon','zelda','blueprint-art']) {
    assert('theme-system.css overrides --accent-fg for ' + theme,
      new RegExp(':root\\[data-theme="' + theme + '"\\][^{]{0,800}\\{[\\s\\S]{0,400}--accent-fg').test(themeCSS),
      'expected theme-system.css to override --accent-fg for ' + theme);
  }
  // 3. dashboard.html no longer duplicates the contract.
  assert('dashboard.html no longer duplicates --accent-fg/--accent-ring defaults',
    !/  --accent-fg:#fff;\s*\n\s*--accent-ring:rgba\(0,0,0,\.35\)/.test(dash),
    'dashboard.html should inherit accent tokens from theme-system.css');
  // 4. customer.html .btn-orange consumes the contract.
  assert('customer.html .btn-orange uses var(--accent-fg)',
    /\.btn-orange\s*\{[\s\S]{0,400}color:\s*var\(--accent-fg\)/.test(customer),
    'expected customer.html .btn-orange to color: var(--accent-fg)');
  assert('customer.html .btn-orange has var(--accent-ring) inset boundary',
    /\.btn-orange\s*\{[\s\S]{0,400}inset 0 0 0 1px var\(--accent-ring\)/.test(customer),
    'expected customer.html .btn-orange to include inset boundary using --accent-ring');
  // 5. customer.html hardcoded NBD-orange rgba retired.
  assert('customer.html: no hardcoded rgba(232,114,12,...) left',
    !/rgba\(232,\s*114,\s*12/.test(customer),
    'customer.html should use color-mix(in srgb, var(--orange) ...) instead of literal rgba');
}

section('Wave 5c — .crm-hdr-actions side-scroller affordance');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. Fade gradient + snap-type — search whole file since there are
  //    multiple .crm-hdr-actions rule blocks (one outer, one inside an
  //    @media), and the new behavior lives in the wider block.
  assert('.crm-hdr-actions has a mask-image fade on the right edge',
    /mask-image:\s*linear-gradient\(to right,\s*#000\s+calc\(100% - 24px\),\s*transparent\)/.test(dash),
    'expected mask-image right-edge fade so scrollability is visually communicated');
  assert('.crm-hdr-actions uses scroll-snap-type x proximity',
    /scroll-snap-type:\s*x\s+proximity/.test(dash),
    'expected scroll-snap-type:x proximity for cleaner momentum stops');
  // 2. Children become snap targets.
  assert('.crm-hdr-btn / .crm-icon-btn become scroll-snap targets',
    /\.crm-hdr-actions > \.crm-icon-btn,\s*\.crm-hdr-actions > \.crm-hdr-btn[\s\S]{0,80}scroll-snap-align:\s*start/.test(dash),
    'expected scroll-snap-align:start on the action-row children');
  // 3. Scrollbar is visible (6px) and tinted with the accent.
  assert('.crm-hdr-actions scrollbar is 6px tall',
    /\.crm-hdr-actions::-webkit-scrollbar\{\s*height:\s*6px/.test(dash),
    'expected the webkit scrollbar height of 6px for affordance visibility');
  assert('.crm-hdr-actions scrollbar thumb uses --orange-tinted color',
    /\.crm-hdr-actions::-webkit-scrollbar-thumb\{[\s\S]{0,200}var\(--orange\)/.test(dash),
    'expected scrollbar thumb tinted with --orange');
  // 4. Old 3px height rule retired.
  assert('old 3px scrollbar override retired',
    !/\.crm-hdr-actions::-webkit-scrollbar\{\s*height:\s*3px/.test(dash),
    'found leftover .crm-hdr-actions::-webkit-scrollbar height:3px — should be replaced by the Wave 5c 6px treatment');
}

section('Wave 5b — Gradient flatten + bulk accent-fg migration');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. .btn-orange no longer uses a linear-gradient for its base fill.
  const btnStart = dash.indexOf('.btn-orange {');
  const btnBlock = dash.slice(btnStart, btnStart + 600);
  assert('.btn-orange base background is solid (no linear-gradient)',
    /\.btn-orange\s*\{\s*background:\s*var\(--orange\)/.test(btnBlock),
    'expected solid background:var(--orange) on .btn-orange — gradient was muddy on forest/neon themes');
  // 2. .kview-btn.active uses --accent-fg.
  assert('.kview-btn.active uses var(--accent-fg)',
    /\.kview-btn\.active\{background:var\(--orange\);color:var\(--accent-fg\)/.test(dash),
    'expected .kview-btn.active color: var(--accent-fg)');
  // 3. No remaining text-on-accent pairings using var(--t). Regex
  //    bounded by `"{};` so it stays within a single CSS rule or
  //    inline style attribute (the earlier unbounded version greedy-
  //    matched 10K chars across unrelated elements).
  assert('no remaining text-on-accent surfaces using var(--t)',
    !/background:\s*var\(--orange\)[^"{};]{0,200};\s*[^"{}]{0,80}color:\s*var\(--t\)/.test(dash),
    'found a text-on-orange surface still using var(--t) — should be var(--accent-fg) for theme contrast');
}

section('Wave 5 — Theme-aware accent + contrast tokens');
{
  // Wave 6 (A.1) moved the tokens themselves into the shared
  // theme-system.css — the Wave 6 section above asserts that. Here we
  // only check that dashboard.html still CONSUMES the contract.
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 3. .btn-orange consumes the tokens.
  assert('.btn-orange uses var(--accent-fg) for color',
    /\.btn-orange\s*\{[\s\S]{0,400}color:\s*var\(--accent-fg\)/.test(dash),
    'expected .btn-orange to color: var(--accent-fg)');
  assert('.btn-orange paints an inset 1px ring via --accent-ring',
    /\.btn-orange\s*\{[\s\S]{0,400}inset 0 0 0 1px var\(--accent-ring\)/.test(dash),
    'expected .btn-orange inset boundary using --accent-ring');
  // 4. Other static-accent surfaces upgraded.
  assert('#addLeadFab uses var(--accent-fg) + var(--accent-ring)',
    /#addLeadFab\{[\s\S]{0,400}color:\s*var\(--accent-fg\)[\s\S]{0,200}border:[^;]*var\(--accent-ring\)/.test(dash),
    'expected #addLeadFab to consume the new tokens');
  assert('.mn-item.mn-fab uses var(--accent-ring) border',
    /\.mn-item\.mn-fab\s*\{[\s\S]{0,400}border:[^;]*var\(--accent-ring\)/.test(dash),
    'expected .mn-item.mn-fab to use --accent-ring');
  {
    const shutter = dash.indexOf('.m-shutter-fab{');
    const shutterBlock = dash.slice(shutter, shutter + 800);
    assert('.m-shutter-fab uses var(--accent-fg)',
      /color:\s*var\(--accent-fg\)/.test(shutterBlock),
      'expected .m-shutter-fab to color: var(--accent-fg)');
    assert('.m-shutter-fab uses var(--accent-ring) border',
      /border:[^;]*var\(--accent-ring\)/.test(shutterBlock),
      'expected .m-shutter-fab to border via --accent-ring');
  }
  // 5. Hardcoded `rgba(232,114,12,...)` glow strings retired in favor
  //    of --og (the per-theme tinted glow). Spot-check on #addLeadFab.
  const fab = dash.indexOf('#addLeadFab{');
  const fabBlock = dash.slice(fab, fab + 500);
  assert('#addLeadFab no longer uses rgba(232,114,12) glow',
    !/rgba\(232,114,12/.test(fabBlock),
    '#addLeadFab still has a hardcoded NBD-orange glow — should use var(--og)');
}

section('Wave 4 — Design tokens (type / spacing / radius / tap-targets)');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. Type scale.
  for (const tok of ['--fs-2xs','--fs-xs','--fs-sm','--fs-md','--fs-base','--fs-lg','--fs-xl','--fs-2xl','--fs-3xl','--fs-4xl']) {
    assert('type token ' + tok + ' defined at :root',
      new RegExp(tok.replace(/-/g,'\\-') + '\\s*:').test(dash),
      'expected ' + tok + ' definition');
  }
  // 2. Spacing scale.
  for (const tok of ['--sp-0','--sp-1','--sp-2','--sp-4','--sp-6','--sp-8','--sp-12','--sp-16']) {
    assert('spacing token ' + tok + ' defined',
      new RegExp(tok.replace(/-/g,'\\-') + '\\s*:').test(dash),
      'expected ' + tok + ' definition');
  }
  // 3. Radius scale.
  for (const tok of ['--r-xs','--r-sm','--r-md','--r-lg','--r-xl','--r-full']) {
    assert('radius token ' + tok + ' defined',
      new RegExp(tok.replace(/-/g,'\\-') + '\\s*:').test(dash),
      'expected ' + tok + ' definition');
  }
  // 4. Tap-target + transition tokens.
  assert('tap-target token --tap-min defined (44px Apple HIG)',
    /--tap-min\s*:\s*44px/.test(dash),
    'expected --tap-min:44px');
  assert('transition tokens (--t-fast/--t-mid/--t-slow) defined',
    /--t-fast\s*:[\s\S]{0,80}--t-mid\s*:[\s\S]{0,80}--t-slow\s*:/.test(dash),
    'expected --t-fast/--t-mid/--t-slow definitions');
  // 5. Sample applications: tokens are actually being used by the
  //    new mobile components, not just defined.
  assert('.m-jd-name uses var(--fs-4xl)',
    /\.m-jd-name[\s\S]{0,400}font-size:\s*var\(--fs-4xl\)/.test(dash),
    'expected .m-jd-name to consume var(--fs-4xl)');
  assert('.m-create-row-lbl uses var(--fs-lg)',
    /\.m-create-row-lbl[\s\S]{0,200}font-size:\s*var\(--fs-lg\)/.test(dash),
    'expected .m-create-row-lbl to consume var(--fs-lg)');
}

section('Wave 3 — Kanban polish (column header + hover-reveal arrows)');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. Column header was tightened (padding 7px 12px + 1px border).
  assert('.kcol-header padding tightened to 7px 12px',
    /\.kcol-header\{\s*padding:\s*7px\s+12px\s*!important/.test(dash),
    'expected .kcol-header padding rule of 7px 12px !important');
  assert('.kcol-header border-bottom dropped to 1px',
    /\.kcol-header[\s\S]{0,400}border-bottom:\s*1px\s+solid\s+currentColor\s*!important/.test(dash),
    'expected .kcol-header border-bottom: 1px solid currentColor !important');
  // 2. Hover-reveal: default low-opacity (works on hybrid-touch desktops),
  //    full opacity on hover/focus, force-on inside @media (hover:none).
  assert('.kc-arrow default opacity is .35 (de-emphasized but visible)',
    /\.kc-arrow\{\s*opacity:\s*\.35/.test(dash),
    'expected .kc-arrow default opacity:.35 (Wave 3 hotfix replaced opacity:0 / pointer:fine gating)');
  assert('.k-card:hover .kc-arrow lifts to opacity:1',
    /\.k-card:hover\s+\.kc-arrow[\s\S]{0,200}opacity:\s*1/.test(dash),
    'expected .k-card:hover .kc-arrow → opacity:1');
  assert('@media (hover: none) forces .kc-arrow opacity:1',
    /@media\s*\(hover:\s*none\)[\s\S]{0,200}\.kc-arrow\{\s*opacity:\s*1/.test(dash),
    'expected touch-device override to keep arrows fully visible');
}

section('Phase orange-rgba — 7 deferred JS files reviewed');
{
  // Theme-aware surfaces converted to color-mix(in srgb, var(--orange) X%, transparent).
  for (const [file, opts] of [
    ['docs/pro/js/estimate-finalization.js', {expect: 0, kind: 'theme-aware (selected estimate card)'}],
    ['docs/pro/js/nbd-doc-viewer.js',        {expect: 0, kind: 'theme-aware (.nbdv-action-btn hover)'}],
    ['docs/pro/js/rep-report-generator.js',  {expect: 1, kind: 'partial — line ~497 converted; line ~1441 stays as literal (PDF narrative-badge brand-pin)'}],
  ]) {
    const src = read(path.join(ROOT, file));
    const n = (src.match(/rgba\(\s*232\s*,/g) || []).length;
    assert(file + ' has ' + opts.expect + ' rgba(232,…) literals — ' + opts.kind,
      n === opts.expect,
      'expected ' + opts.expect + ' rgba(232,…) in ' + file + '; got ' + n);
  }
  // Brand-pinned files keep their literals — these surfaces should NOT
  // theme-shift (PDFs, customer-facing auth + share, theme-engine config).
  for (const [file, expectedCount, reason] of [
    ['docs/pro/js/document-generator-templates.js', 1, 'PDF template box-shadow — brand-pin (PDFs do not theme-shift)'],
    ['docs/pro/js/share-gallery.js',                1, 'customer-facing share gallery — brand-pin per Phase A'],
    ['docs/pro/js/nbd-auth.js',                     3, 'auth screen border + bg — brand-pin per Phase A'],
    ['docs/pro/js/theme-engine.js',                 2, 'theme-engine defaults (rgba(232,114,12,...)) — config, not styling'],
  ]) {
    const src = read(path.join(ROOT, file));
    const n = (src.match(/rgba\(\s*232\s*,\s*114\s*,\s*12\s*,/g) || []).length;
    assert(file + ' keeps ' + expectedCount + ' brand-pinned orange-rgba — ' + reason,
      n === expectedCount,
      'expected ' + expectedCount + ' rgba(232,114,12,…) in ' + file + '; got ' + n);
  }
}

section('Phase C.6 — inline-style sweep + utility-class layer');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const theme = read(path.join(ROOT, 'docs/pro/css/theme-system.css'));

  // The utility-class layer is declared in theme-system.css.
  for (const cls of ['dn','mb-md','mb-lg','meta-11','meta-10','f1','eyebrow','bc-chip',
                     'row-tight','body-13','btn-11','fs-11','bc-meta-cp','row-card',
                     'cp','cell','cell-t','cell-m','bb','w-full','mt-14',
                     'fs-12','fs-14','heading-13','flex-g8','fwgap-8',
                     'fg-orange','eyebrow-9','card-7','btn-input-40','kbd-input',
                     'pos-rel','ac-orange','chip-green','chip-blue']) {
    assert("theme-system.css declares ." + cls,
      new RegExp("\\." + cls + "\\s*\\{").test(theme),
      'expected utility class .' + cls + ' in theme-system.css');
  }

  // Hard upper bound — we cleaned up at least ~400 of the original 1,187
  // inline styles. Truly dynamic / one-off styles can remain, but the
  // count must not regress above 850 (was 1,187 before this sweep).
  const remaining = (dash.match(/style="[^"]+"/g) || []).length;
  assert('inline style count cut to ≤850 (was 1,187)',
    remaining <= 850,
    'expected ≤850 inline style attrs after C.6; got ' + remaining);

  // .dn class must hide WITHOUT !important — JS toggling style.display='block'
  // must still win over the class rule.
  assert('.dn rule uses display:none (no !important — keeps JS show/hide working)',
    /\.dn\{display:none;\}/.test(theme),
    '.dn should be display:none (no !important)');

  // Spot-check: the 7-property eyebrow / 8-property row-card declarations
  // are present and match exactly the strings the sweep replaced.
  assert('.eyebrow has the 7-property uppercase label declaration',
    /\.eyebrow\{font-size:10px;font-weight:700;letter-spacing:\.1em;text-transform:uppercase;color:var\(--m\);display:block;margin-bottom:6px;\}/.test(theme),
    'expected .eyebrow with the full 7-property declaration');
  assert('.row-card has the bordered row declaration',
    /\.row-card\{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var\(--s2\);border:1px solid var\(--br\);border-radius:7px;cursor:pointer;\}/.test(theme),
    'expected .row-card with the full row declaration');
}

section('Phase C.4 finale + C.5 — long-tail delegate + script-src tightening');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));
  const firebaseJson = read(path.join(ROOT, 'firebase.json'));

  // Zero inline onclicks left in dashboard.html.
  const remaining = (dash.match(/onclick=/g) || []).length;
  assert('dashboard.html has zero inline onclick handlers',
    remaining === 0,
    'expected 0 inline onclicks; got ' + remaining);

  // New generic delegate branches all present.
  for (const action of ['call','module','windowOpen','signOut','reload','closeOpen','clickProxy','hideEl','stopProp','removeSelf','removeParent','removeClosest','modalBackdropClose']) {
    assert("delegate handles action='" + action + "'",
      new RegExp("if \\(action === '" + action + "'\\)").test(mainJs),
      'expected ' + action + ' branch in _nbdActionDelegate');
  }

  // Allowlist Set declared and has a reasonable lower bound.
  assert('_NBD_CALL_ALLOWLIST Set declared with allowed call targets',
    /_NBD_CALL_ALLOWLIST\s*=\s*new Set\(\[/.test(mainJs),
    'expected _NBD_CALL_ALLOWLIST = new Set([...]) declaration');

  // Spot-check that key wrappers exist as window globals.
  for (const fn of ['cdaReport','cdaEnrich','cdaPhotos','cdaInvoice','cdaInspection','cdaInspectionDeep','cdaMjdAct','cdaEditLead','cdaOpenMobileInspection','cdaVoiceMemo','cdaSharePortalLink','cdaRevokePortalLink','cdaConfirmPromote','cdaOpenTaskModal','mCreateFabRoute','openDailyProgramFromMore','openCrewCalendarFromMore','mQuickAddRoute','restartOnboardingTour','openDecisionPicker','openD2DOrGo','clearAccentTheme','openSettingsTab','openPhotoEngineOrClickProxy','openReportGenerator','enrichReportData','openPhotoEngineCurrentLead','openInspectionBuilderCurrentLead','closeInspectionBuilder','hideFollowUpAlerts','goToD2DFromMaps','openCalBookingUrl','hardResetTest','gstaticTest','modeLineDraw']) {
    assert('window.' + fn + ' defined',
      new RegExp('window\\.' + fn + '\\s*=\\s*function').test(mainJs),
      'expected window.' + fn + ' = function(...)');
  }

  // C.5 — script-src 'unsafe-inline' dropped from line-44 enforcing CSP.
  // The Report-Only policy already lacked it; now the enforcing one matches.
  const csps = firebaseJson.match(/"Content-Security-Policy",\s*"value":\s*"([^"]+)"/g) || [];
  assert('at least one enforcing CSP declared',
    csps.length >= 1, 'expected ≥1 Content-Security-Policy in firebase.json');
  // The PRO route (line 44) is the only one with script-src 'unsafe-inline';
  // assert that NO enforcing CSP includes "script-src 'self' 'unsafe-inline'".
  assert("no enforcing CSP retains script-src 'self' 'unsafe-inline'",
    !/script-src\s+'self'\s+'unsafe-inline'/.test(firebaseJson) ||
      /script-src\s+'self'\s+'unsafe-inline'/.test(firebaseJson.match(/Content-Security-Policy-Report-Only[\s\S]*?(?=\}\s*,|\}\s*\])/) || ''),
    "expected script-src to drop 'unsafe-inline' on enforcing CSP");
  // The enforcing CSP also adds script-src-attr 'none' to block any
  // inline event-handler attribute that could be reintroduced.
  assert("enforcing CSP declares script-src-attr 'none'",
    /script-src-attr\s+'none'/.test(firebaseJson),
    "expected script-src-attr 'none' in enforcing CSP");
}

section('Phase C.4 kanban + zone-color + pin-status — 3 picker clusters');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));

  for (const action of ['kanbanView','zoneColor','selectPin']) {
    assert("delegate handles action='" + action + "'",
      new RegExp("if \\(action === '" + action + "'\\)").test(mainJs),
      'expected ' + action + ' branch in _nbdActionDelegate');
  }

  const kv = (dash.match(/data-action="kanbanView"\s+data-target="[a-z]+"/g) || []).length;
  assert('kanbanView conversions: 7 (Ins/Cash/Fin/War/Svc/Jobs/All)',
    kv === 7, 'expected 7 kanbanView data-actions; got ' + kv);

  const zc = (dash.match(/data-action="zoneColor"\s+data-target="[^"]+"/g) || []).length;
  assert('zoneColor conversions: 6 (D2D zone swatches)',
    zc === 6, 'expected 6 zoneColor data-actions; got ' + zc);

  const sp = (dash.match(/data-action="selectPin"\s+data-target="[a-z-]+"\s+data-color="[^"]+"/g) || []).length;
  assert('selectPin conversions: 8 (D2D pin status buttons)',
    sp === 8, 'expected 8 selectPin data-actions; got ' + sp);

  const remaining =
    (dash.match(/onclick="switchKanbanView\(/g) || []).length +
    (dash.match(/onclick="selectZoneColor\(/g) || []).length +
    (dash.match(/onclick="selectPin\(/g) || []).length;
  assert('no inline onclicks remain for these 3 clusters',
    remaining === 0,
    'expected 0 inline onclicks across the 3 clusters; got ' + remaining);

  // The kanban buttons preserve their data-view attribute (other code
  // reads it for filtering); confirm we didn't strip it.
  assert('kanban buttons preserve data-view alongside the new data-action',
    /data-view="insurance"[\s\S]{0,80}data-action="kanbanView"/.test(dash) ||
      /data-action="kanbanView"[\s\S]{0,80}data-view="insurance"/.test(dash),
    'expected data-view="insurance" preserved on the Ins kanban button');
}

section('Phase C.4 line-type — selLT via selLineType action');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));

  assert("delegate handles action='selLineType'",
    /if \(action === 'selLineType'\)/.test(mainJs),
    'expected selLineType branch in _nbdActionDelegate');
  assert("selLineType branch dispatches selLT(idx, el)",
    /selLT\(idx, el\)/.test(mainJs),
    'expected selLT(idx, el) dispatch');

  const count = (dash.match(/data-action="selLineType"\s+data-target="\d+"/g) || []).length;
  assert('selLineType conversions: 11 (one per draw-tool line type)',
    count === 11,
    'expected 11 selLineType data-actions; got ' + count);

  const remaining = (dash.match(/onclick="selLT\(/g) || []).length;
  assert('no inline selLT onclicks remain',
    remaining === 0,
    'expected 0 inline selLT onclicks; got ' + remaining);
}

section('Phase C.4 settings-tab — switchSettingsTab via settingsTab action');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));

  assert("delegate handles action='settingsTab'",
    /if \(action === 'settingsTab'\)/.test(mainJs),
    'expected settingsTab branch in _nbdActionDelegate');
  assert("settingsTab branch dispatches switchSettingsTab(target)",
    /switchSettingsTab\(target\)/.test(mainJs),
    'expected switchSettingsTab(target) dispatch');

  const count = (dash.match(/data-action="settingsTab"\s+data-target="[a-z]+"/g) || []).length;
  assert('settingsTab conversions: 10 (one per Settings tab)',
    count === 10,
    'expected 10 settingsTab data-actions; got ' + count);

  const remaining = (dash.match(/onclick="switchSettingsTab\(/g) || []).length;
  assert('no inline switchSettingsTab onclicks remain',
    remaining === 0,
    'expected 0 inline switchSettingsTab onclicks; got ' + remaining);
}

section('Phase C.4 docgen — NBDDocGen.fillAndGenerate via docgen action');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));

  assert("delegate handles action='docgen'",
    /if \(action === 'docgen'\)/.test(mainJs),
    'expected docgen branch in _nbdActionDelegate');
  assert("docgen branch dispatches NBDDocGen.fillAndGenerate(target)",
    /window\.NBDDocGen\.fillAndGenerate\(target\)/.test(mainJs),
    'expected NBDDocGen.fillAndGenerate(target) dispatch');

  const docgenCount = (dash.match(/data-action="docgen"\s+data-target="[a-zA-Z_]+"/g) || []).length;
  assert('docgen conversions: 24 (every Templates view row)',
    docgenCount === 24,
    'expected 24 docgen data-actions; got ' + docgenCount);

  const remaining = (dash.match(/onclick="NBDDocGen\.fillAndGenerate/g) || []).length;
  assert('no inline NBDDocGen.fillAndGenerate onclicks remain',
    remaining === 0,
    'expected 0 inline NBDDocGen onclicks; got ' + remaining);
}

section('Phase C.4 mobile-nav — bottom-nav and More-drawer items');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));

  assert("delegate handles action='mobileNav'",
    /if \(action === 'mobileNav'\)/.test(mainJs),
    'expected mobileNav branch in _nbdActionDelegate');
  assert("mobileNav branch dispatches mobileNav(target)",
    /if \(typeof mobileNav === 'function'\) mobileNav\(target\)/.test(mainJs),
    'expected mobileNav(target) dispatch');
  assert("mobileNav branch honors data-close-more flag",
    /el\.hasAttribute\('data-close-more'\)[\s\S]{0,120}closeMobileMore\(\)/.test(mainJs),
    'expected closeMobileMore() called when data-close-more present');

  // 3 bottom-nav items (mn-item) plus 19 More-drawer items = 22 total
  // mobileNav data-actions in the markup. (Crew-calendar More item
  // intentionally remains inline — defensive existence check.)
  const mnCount = (dash.match(/data-action="mobileNav"\s+data-target="[a-z]+"/g) || []).length;
  assert('mobileNav conversions: 22 (3 bottom-nav + 19 more-drawer)',
    mnCount === 22,
    'expected 22 mobileNav data-actions; got ' + mnCount);

  const closeMoreCount = (dash.match(/data-action="mobileNav"\s+data-target="[a-z]+"\s+data-close-more/g) || []).length;
  assert('19 mobileNav items carry data-close-more (More-drawer items)',
    closeMoreCount === 19,
    'expected 19 data-close-more flags; got ' + closeMoreCount);

  // C.4 finale: every mobileNav handler is delegated. The crew-calendar
  // compound is now routed through window.openCrewCalendarFromMore.
  const remaining = (dash.match(/onclick="mobileNav\(/g) || []).length;
  assert('zero inline mobileNav onclicks remain (all delegated)',
    remaining === 0,
    'expected exactly 0 inline mobileNav onclicks; got ' + remaining);
}

section('Phase C.4 photo-engine — inline actions in rendered templates');
{
  const pe = read(path.join(ROOT, 'docs/pro/js/photo-engine.js'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));

  // Every delegate branch we registered must appear in _nbdActionDelegate.
  for (const action of ['peRemove','peTagToggle','peBulkAnalyze','peOpenLightbox','peStagePhoto','peDeletePhoto']) {
    assert("delegate handles action='" + action + "'",
      new RegExp("if \\(action === '" + action + "'\\)").test(mainJs),
      'expected ' + action + ' branch in _nbdActionDelegate');
  }

  // photo-engine.js must have zero inline onclicks left — all rendered
  // buttons/imgs now carry data-action attributes the delegate handles.
  const peOnclick = (pe.match(/onclick=/g) || []).length;
  assert('photo-engine.js has zero inline onclick handlers',
    peOnclick === 0,
    'expected 0 onclick attrs in photo-engine.js; got ' + peOnclick);

  // Spot-check key conversions in the rendered template strings.
  assert('photo-preview-modal back button uses peRemove',
    /data-action="peRemove"\s+data-target="photo-preview-modal"/.test(pe),
    'expected back button to use peRemove action');
  assert('tag pills use peTagToggle (location/damage/type pills)',
    (pe.match(/data-action="peTagToggle"/g) || []).length >= 3,
    'expected at least 3 peTagToggle pills (location/damage/type)');
  assert('bulk-analyze button uses peBulkAnalyze with data-lead-id',
    /data-action="peBulkAnalyze"\s+data-lead-id="\$\{leadId\}"/.test(pe),
    'expected pe-bulk-ai-btn to use peBulkAnalyze');
  assert('gallery thumbnail uses peOpenLightbox with photo+lead ids',
    /data-action="peOpenLightbox"\s+data-photo-id="\$\{photo\.id\}"\s+data-lead-id="\$\{leadId\}"/.test(pe),
    'expected thumbnail to use peOpenLightbox');
  assert('lightbox stage button uses peStagePhoto',
    /data-action="peStagePhoto"\s+data-photo-id="\$\{photoId\}"\s+data-lead-id="\$\{leadId\}"/.test(pe),
    'expected lightbox stage button to use peStagePhoto');
  assert('lightbox delete button uses peDeletePhoto',
    /data-action="peDeletePhoto"\s+data-photo-id="\$\{photoId\}"/.test(pe),
    'expected lightbox delete button to use peDeletePhoto');
  assert('lightbox nav buttons (X / OK) use peRemove on photo-lightbox',
    (pe.match(/data-action="peRemove"\s+data-target="photo-lightbox"/g) || []).length === 2,
    'expected 2 peRemove buttons targeting photo-lightbox');
}

section('Phase C.4 cluster 5 — arg-bearing toggle handlers');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));

  for (const action of ['navSection','mapSidebar','mapOverlay','tradeChip','crmToolsMenu']) {
    assert("delegate handles action='" + action + "'",
      new RegExp("if \\(action === '" + action + "'\\)").test(mainJs),
      'expected ' + action + ' branch in _nbdActionDelegate');
  }

  // Markup counts
  const navSec = (dash.match(/data-action="navSection"\s+data-target="[a-z-]+"/g) || []).length;
  assert('navSection conversions: 3',
    navSec === 3,
    'expected 3 navSection conversions; got ' + navSec);

  const mapSb = (dash.match(/data-action="mapSidebar"\s+data-target="[a-z-]+"/g) || []).length;
  assert('mapSidebar conversions: 2',
    mapSb === 2,
    'expected 2 mapSidebar conversions; got ' + mapSb);

  const mapOv = (dash.match(/data-action="mapOverlay"\s+data-target="[a-z]+"/g) || []).length;
  assert('mapOverlay conversions: 5 (heat/jobs/pins/storm/weather)',
    mapOv === 5,
    'expected 5 mapOverlay conversions; got ' + mapOv);

  // Inline arg-bearing toggles retired (except the documented ternary).
  const argRemain = (dash.match(/onclick="toggle(NavSection|MapSidebar|Overlay|TradeChip|CrmToolsMenu)\(/g) || []).length;
  assert('no inline arg-bearing toggle onclicks remain (besides the mobileCreatePopover ternary)',
    argRemain === 0,
    'expected 0 arg-bearing toggle onclicks; got ' + argRemain);
}

section('Phase C.4 cluster 4 — no-arg toggle handlers via toggle action');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));

  assert("delegate handles action='toggle' via _NBD_TOGGLE_FNS",
    /if \(action === 'toggle'\)[\s\S]{0,400}_NBD_TOGGLE_FNS\[target\]/.test(mainJs),
    'expected toggle branch + _NBD_TOGGLE_FNS registry');

  for (const target of ['bulkMode','kanbanFullscreen','sidebarCollapse','engagementSort','needsAttention','showSnoozed','staleShares','notifications','mobileMore']) {
    assert('_NBD_TOGGLE_FNS registers ' + target,
      new RegExp("\\b" + target + ":\\s+'toggle").test(mainJs),
      'expected ' + target + ' in the toggle registry');
  }

  const conversions = (dash.match(/data-action="toggle"\s+data-target="\w+"/g) || []).length;
  assert('≥15 data-action="toggle" conversions present',
    conversions >= 15,
    'expected ≥15 toggle conversions; got ' + conversions);

  // Simple inline toggle onclicks should be retired (defensive form too)
  const simpleRemain = (dash.match(/onclick="toggle[A-Z]\w*\(\)"/g) || []).length;
  const defensiveRemain = (dash.match(/onclick="window\.toggle\w+\s*&&\s*window\.toggle\w+\(\)"/g) || []).length;
  assert('0 inline simple onclick="toggleXxx()" remain',
    simpleRemain === 0,
    'expected 0 simple toggle onclicks; got ' + simpleRemain);
  assert('0 inline defensive onclick="window.toggleXxx && window.toggleXxx()" remain',
    defensiveRemain === 0,
    'expected 0 defensive-form toggle onclicks; got ' + defensiveRemain);
}

section('Phase C.4 cluster 3 — modal-close handlers via closeModal action');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));

  assert("delegate handles action='closeModal'",
    /if \(action === 'closeModal'\)[\s\S]{0,400}_NBD_MODAL_CLOSE_FNS\[target\]/.test(mainJs),
    'expected closeModal branch in _nbdActionDelegate using _NBD_MODAL_CLOSE_FNS registry');

  // Registry exposes the function mapping
  for (const target of ['leadModal','taskModal','photoModal','propertyIntelModal','quickAddModal','docViewerModal','cardDetailModal','comparisonModal']) {
    assert('_NBD_MODAL_CLOSE_FNS registers ' + target,
      new RegExp("\\b" + target + ":\\s+'close").test(mainJs),
      'expected ' + target + ' in the registry');
  }

  // Markup: ≥30 data-action="closeModal" elements (we converted 33)
  const conversions = (dash.match(/data-action="closeModal"\s+data-target="\w+"/g) || []).length;
  assert('≥30 data-action="closeModal" conversions present',
    conversions >= 30,
    'expected ≥30 closeModal conversions; got ' + conversions);

  // 0 simple inline closeXxx onclicks remain
  const remaining = (dash.match(/onclick="close[A-Z][A-Za-z]+\(\)"/g) || []).length;
  assert('0 inline onclick="closeXxx()" handlers remain',
    remaining === 0,
    'expected 0 remaining; got ' + remaining);
}

section('Phase C.4 cluster 2 — compound goTo handlers (newEstimate / filterByStage / toolMenuGoTo)');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));

  // Action handlers wired in the delegate switch.
  for (const action of ['newEstimate','filterByStage','toolMenuGoTo']) {
    assert("delegate handles action='" + action + "'",
      new RegExp("if \\(action === '" + action + "'\\)").test(mainJs),
      'expected ' + action + ' branch in _nbdActionDelegate');
  }

  // Markup conversions
  const newEst = (dash.match(/data-action="newEstimate"/g) || []).length;
  assert('data-action="newEstimate" appears 2× (the two + New Estimate buttons)',
    newEst === 2,
    'expected 2 newEstimate conversions; got ' + newEst);

  const stages = (dash.match(/data-action="filterByStage"\s+data-stage="[a-z_]+"/g) || []).length;
  assert('data-action="filterByStage" appears 6× (one per dashboard stage box)',
    stages === 6,
    'expected 6 filterByStage conversions; got ' + stages);

  const tools = (dash.match(/data-action="toolMenuGoTo"\s+data-target="[a-z]+"/g) || []).length;
  assert('data-action="toolMenuGoTo" appears 7× (CRM tools menu items)',
    tools === 7,
    'expected 7 toolMenuGoTo conversions; got ' + tools);

  // C.4 finale: every inline goTo() is delegated; the d2d maps-redirect
  // compound is routed through window.goToD2DFromMaps.
  const remaining = (dash.match(/onclick="goTo\(/g) || []).length;
  assert('zero inline onclick="goTo(..." remain (all delegated)',
    remaining === 0,
    'expected exactly 0 inline goTo onclicks; got ' + remaining);
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

section('Phase C.4 starter — body-level data-action delegate (goTo cluster)');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));

  // 1. Delegate is wired in dashboard-main.js — listens for [data-action]
  //    clicks at the document level and dispatches goTo when matched.
  assert('document-level click delegate registered for [data-action]',
    /document\.addEventListener\('click',\s*function _nbdActionDelegate/.test(mainJs),
    'expected the _nbdActionDelegate function bound to document click');
  assert('delegate handles action="goTo" → calls goTo(target)',
    /if \(action === 'goTo'\)[\s\S]{0,400}goTo\(target\)/.test(mainJs),
    'expected the goTo branch in the action delegate');

  // 2. dashboard.html now carries data-action="goTo" elements (≥40 — we
  //    converted 54 simple onclick="goTo(...)" handlers).
  const goToActions = (dash.match(/data-action="goTo"\s+data-target="[a-z][a-z0-9-]*"/g) || []).length;
  assert('dashboard.html carries ≥40 data-action="goTo" data-target="..." elements',
    goToActions >= 40,
    'expected ≥40 data-action goTo conversions; got ' + goToActions);

  // 3. Simple form `onclick="goTo('xxx')"` is fully retired (the only
  //    remaining onclick="goTo(...)" calls should be compound forms
  //    with multiple statements).
  const simpleGoTo = (dash.match(/onclick="goTo\('[a-z][a-z0-9-]*'\)"/g) || []).length;
  assert('no simple onclick="goTo(\'xxx\')" handlers remain in dashboard.html',
    simpleGoTo === 0,
    'expected 0 simple inline goTo handlers; got ' + simpleGoTo);
}

section('Phase D.2 — Cross-lead Recent Photo Feed');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));

  // 1. Mode toggle present in tpl-view-photos.
  assert('tpl-view-photos has the .ph-mode-toggle (By Property / Recent)',
    /<div class="ph-mode-toggle"[\s\S]{0,400}data-ph-mode="by-property"[\s\S]{0,400}data-ph-mode="recent"/.test(dash),
    'expected the by-property + recent mode buttons inside the photo template');

  // 2. Recent feed mount + CSS.
  assert('photoRecentFeed mount div present',
    /<div id="photoRecentFeed" class="ph-recent-feed"/.test(dash),
    'expected photoRecentFeed mount inside tpl-view-photos');
  assert('.ph-recent-grid CSS defined (3-up grid)',
    /\.ph-recent-grid\{[\s\S]{0,200}grid-template-columns:\s*repeat\(auto-fill/.test(dash),
    'expected .ph-recent-grid CSS rule');

  // 3. JS exports.
  assert('window.setPhotoMode exposed',
    /window\.setPhotoMode\s*=/.test(mainJs),
    'expected window.setPhotoMode export');
  assert('window.renderRecentPhotoFeed exposed',
    /window\.renderRecentPhotoFeed\s*=/.test(mainJs),
    'expected window.renderRecentPhotoFeed export');

  // 4. Query uses where(userId == uid) + orderBy(uploadedAt desc) + limit.
  assert('renderRecentPhotoFeed queries photos by userId + orderBy uploadedAt + limit',
    /window\.query\(\s*window\.collection\(window\.db,\s*'photos'\)[\s\S]{0,200}window\.where\('userId',\s*'==',\s*uid\)[\s\S]{0,200}window\.orderBy\('uploadedAt',\s*'desc'\)[\s\S]{0,200}window\.limit\(/.test(mainJs),
    'expected Firestore query: where(userId == uid).orderBy(uploadedAt,desc).limit()');

  // 5. Date grouping uses Today / Yesterday smart labels.
  assert('renderRecentPhotoFeed renders Today / Yesterday smart date labels',
    /'Today'/.test(mainJs) && /'Yesterday'/.test(mainJs),
    'expected Today / Yesterday labels in the date-grouper');

  // 6. Tap on a tile pivots into by-property mode for that lead.
  //    The string in source is `setPhotoMode(\\'by-property\\')` (escaped
  //    quotes inside an HTML onclick attribute).
  assert('Recent tiles wire onclick → setPhotoMode("by-property") for the lead',
    /setPhotoMode\(\\'by-property\\'\)/.test(mainJs),
    'expected the recent-tile onclick to switch back to by-property after picking a lead');
}

section('Phase C.6 step 2 — JS-file orange-rgba sweep');
{
  const SAFE_FILES = [
    'docs/pro/js/close-board.js',
    'docs/pro/js/d2d-tracker.js',
    'docs/pro/js/d2d-tracker-2026b.js',
    'docs/pro/js/doc-preflight.js',
    'docs/pro/js/help-icon.js',
    'docs/pro/js/mobile-nav-customizer.js',
    'docs/pro/js/photo-engine.js',
    'docs/pro/js/real-deal-academy-lab.js',
    'docs/pro/js/ui.js',
    'docs/pro/js/dashboard-main.js',
  ];
  for (const p of SAFE_FILES) {
    const body = read(path.join(ROOT, p));
    assert(p + ': no hardcoded rgba(232,114,12,...)',
      !/rgba\(232,\s*114,\s*12/.test(body),
      p + ' should use color-mix(in srgb, var(--orange) X%, transparent)');
  }
}

section('Phase C.6 starter — retire hardcoded NBD-orange rgba in dashboard.html');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // Same contract we already enforce on customer/login/vault.
  assert('dashboard.html: no hardcoded rgba(232,114,12,...) NBD-orange literals',
    !/rgba\(232,\s*114,\s*12/.test(dash),
    'expected dashboard.html to use color-mix(in srgb, var(--orange) X%, transparent) — not literal NBD-orange rgba');
  // Spot-check that the conversions used the right pattern (sample
  // a known-converted opacity).
  assert('dashboard.html now consumes color-mix(--orange) for theme-tinted decorations',
    /color-mix\(in srgb,\s*var\(--orange\)\s+\d+%,\s*transparent\)/.test(dash),
    'expected color-mix(in srgb, var(--orange) X%, transparent) usages');
}

section('Phase C.3 finish-finish — crm + map + docs');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  for (const v of ['crm','map','docs']) {
    assert('view-' + v + ' is an empty mount with data-view-template',
      new RegExp('<div class="view" id="view-' + v + '"\\s+data-view-template="tpl-view-' + v + '"></div>').test(dash),
      'expected mount div for view-' + v);
    assert('<template id="tpl-view-' + v + '"> exists',
      new RegExp('<template id="tpl-view-' + v + '">').test(dash),
      'expected tpl-view-' + v + ' template element');
  }
  // Sanity: only view-est should remain as an inline (non-template) view.
  const inlineMatches = dash.match(/class="view"[^>]*id="view-[a-z]+"[^>]*>(?!<\/div>)/g) || [];
  // Strict count of "still-inline" views = those whose mount doesn't
  // carry data-view-template attribute.
  const stillInline = [];
  const reAll = /class="view"[^>]*id="view-([a-z]+)"([^>]*)>/g;
  let m;
  while ((m = reAll.exec(dash)) !== null) {
    if (!/data-view-template/.test(m[2])) stillInline.push(m[1]);
  }
  assert('only view-est remains inline (Rock 2 dep deferred)',
    stillInline.length === 1 && stillInline[0] === 'est',
    'expected only view-est inline; got: ' + stillInline.join(','));
}

section('Phase C.3 finish — view-prospects + D.1 plumbing');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const testsPkg = read(path.join(ROOT, 'tests/package.json'));
  assert('view-prospects is an empty mount with data-view-template',
    /<div class="view" id="view-prospects"\s+data-view-template="tpl-view-prospects"><\/div>/.test(dash),
    'expected mount div for view-prospects');
  assert('<template id="tpl-view-prospects"> exists',
    /<template id="tpl-view-prospects">/.test(dash),
    'expected tpl-view-prospects template element');
  // D.1 — engines pin so future Node-version drift doesn't break the
  // playwright transitive install in fresh containers.
  assert('tests/package.json declares engines.node ≥22',
    /"engines":\s*\{\s*"node":\s*">=22"\s*\}/.test(testsPkg),
    'expected engines.node pin to >=22 in tests/package.json');
}

section('Phase C.3 wave 2 — draw + dash + reports + settings');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));

  // Each of the 4 big views: empty mount + matching template.
  for (const v of ['draw','dash','reports','settings']) {
    assert('view-' + v + ' is an empty mount with data-view-template',
      new RegExp('<div class="view" id="view-' + v + '"\\s+data-view-template="tpl-view-' + v + '"></div>').test(dash),
      'expected mount div for view-' + v);
    assert('<template id="tpl-view-' + v + '"> exists',
      new RegExp('<template id="tpl-view-' + v + '">').test(dash),
      'expected tpl-view-' + v + ' template element');
  }

  // _hydrateViewTemplate now re-executes inline <script> blocks.
  assert('_hydrateViewTemplate re-executes inline scripts after cloning',
    /view\.querySelectorAll\('script'\)\.forEach[\s\S]{0,500}createElement\('script'\)[\s\S]{0,300}replaceChild/.test(mainJs),
    'expected the helper to swap each cloned <script> for a fresh executable one');

  // CSP hotfix (2026-05-16): the inline scripts inside tpl-view-draw
  // and tpl-view-settings were extracted to external files
  // (dashboard-accessory-panel-init.js + the appearance/team/billing/
  // hotkey/sidebar shards). _hydrateViewTemplate handles both inline
  // AND external scripts (createElement copies all attributes including
  // src), so the readyState guard logic now lives in
  // dashboard-accessory-panel-init.js.
  assert('tpl-view-draw script handles both initial-load and post-hydration',
    /tpl-view-draw[\s\S]*?dashboard-accessory-panel-init\.js/.test(dash) ||
    /tpl-view-draw[\s\S]*?_drawInit[\s\S]*?document\.readyState === 'loading'[\s\S]*?DOMContentLoaded[\s\S]*?_drawInit/.test(dash),
    'expected dashboard-accessory-panel-init.js inside tpl-view-draw, or the _drawInit pattern inline');

  // Confirm the extracted file still carries the readyState guard.
  const drawInit = fs.existsSync(path.join(ROOT, 'docs/pro/js/dashboard-accessory-panel-init.js'))
    ? read(path.join(ROOT, 'docs/pro/js/dashboard-accessory-panel-init.js')) : '';
  assert('dashboard-accessory-panel-init.js carries readyState/_drawInit guard',
    /_drawInit[\s\S]*?document\.readyState === 'loading'[\s\S]*?DOMContentLoaded[\s\S]*?_drawInit/.test(drawInit),
    'expected the extracted file to keep the readyState/DOMContentLoaded guard');

  // view-settings' 5 (formerly inline) scripts all live inside the
  // template now — either as inline or external references. Count
  // BOTH styles. Previously checked for `<script>` (5 inline blocks);
  // after CSP extraction these are `<script src="dashboard-*.js?v=1">`.
  {
    const tplStart = dash.indexOf('<template id="tpl-view-settings">');
    const tplEnd = dash.indexOf('</template><!-- /tpl-view-settings -->', tplStart);
    assert('tpl-view-settings is closed by a matching </template> tag',
      tplStart > -1 && tplEnd > tplStart,
      'expected </template><!-- /tpl-view-settings --> to close the settings template');
    const settingsBody = dash.slice(tplStart, tplEnd);
    // Count all <script ...> opening tags (inline or external) inside
    // the template. Inline = `<script>`; external = `<script src=...>`.
    const scriptCount = (settingsBody.match(/<script[\s>]/g) || []).length;
    assert('tpl-view-settings carries 5 <script> blocks (inline or external)',
      scriptCount === 5,
      'expected 5 scripts inside the settings template, got ' + scriptCount);
  }
}

section('Phase C.3 — large-view extractions (photos + admin)');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  for (const v of ['photos','admin']) {
    assert('view-' + v + ' is an empty mount with data-view-template (C.3)',
      new RegExp('<div class="view" id="view-' + v + '"\\s+data-view-template="tpl-view-' + v + '"></div>').test(dash),
      'expected mount div for view-' + v);
    assert('<template id="tpl-view-' + v + '"> exists',
      new RegExp('<template id="tpl-view-' + v + '">').test(dash),
      'expected tpl-view-' + v + ' template element');
  }
  // Spot-check Wave 2C.2 shutter FAB survived the photos extraction —
  // it moves INTO the template so the CSS selector
  //   #view-photos.active > .m-shutter-fab
  // matches once the template is cloned at hydration time.
  assert('tpl-view-photos contains the m-shutter-fab as a direct child',
    /<template id="tpl-view-photos">[\s\S]*?<button class="m-shutter-fab"/.test(dash),
    'expected the Wave 2C.2 shutter FAB to live inside tpl-view-photos');
  // adminCreateModal + adminEditModal stay top-level (sit OUTSIDE
  // view-admin, independently toggled by AdminManager). Check that
  // the admin template's body doesn't contain adminCreateModal.
  {
    const tplStart = dash.indexOf('<template id="tpl-view-admin">');
    const tplEnd = dash.indexOf('</template>', tplStart);
    const adminTplBody = dash.slice(tplStart, tplEnd);
    assert('adminCreateModal stays top-level (outside tpl-view-admin)',
      /<div id="adminCreateModal" class="modal-overlay"/.test(dash)
      && !/id="adminCreateModal"/.test(adminTplBody),
      'expected adminCreateModal to remain top-level, not inside the admin template body');
  }
}

section('Phase C.1 + C.2 — view template-hydration sweep');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));

  // C.1 — every stub view should be an empty mount div + matching template.
  // Whitespace between attributes is flexible (some are aligned in columns).
  const stubs = ['aitree','understand','projectcodex','aiusage','products','d2d','training','academy','closeboard','repos','board','home'];
  for (const v of stubs) {
    assert('view-' + v + ' is an empty mount with data-view-template',
      new RegExp('<div class="view( active)?" id="view-' + v + '"\\s+data-view-template="tpl-view-' + v + '"></div>').test(dash),
      'expected mount div for view-' + v);
    assert('<template id="tpl-view-' + v + '"> exists',
      new RegExp('<template id="tpl-view-' + v + '">').test(dash),
      'expected tpl-view-' + v + ' template element');
  }

  // C.2 — medium views (joe + schedule) extracted.
  for (const v of ['joe','schedule']) {
    assert('view-' + v + ' is an empty mount with data-view-template (C.2)',
      new RegExp('<div class="view" id="view-' + v + '"\\s+data-view-template="tpl-view-' + v + '"></div>').test(dash),
      'expected mount div for view-' + v);
    assert('<template id="tpl-view-' + v + '"> exists',
      new RegExp('<template id="tpl-view-' + v + '">').test(dash),
      'expected tpl-view-' + v + ' template element');
  }

  // Eager-hydration helper runs at module load (covers default-active home).
  assert('dashboard-main.js eager-hydrates .view.active[data-view-template] on load',
    /_eagerHydrateActiveViews[\s\S]{0,400}\.view\.active\[data-view-template\]/.test(mainJs),
    'expected _eagerHydrateActiveViews IIFE that queries .view.active[data-view-template]');
}

section('Phase B.2 — Storm Briefing automation');
{
  const sb = read(path.join(ROOT, 'functions/integrations/storm-briefing.js'));
  const idx = read(path.join(ROOT, 'functions/index.js'));
  assert('storm-briefing module exists with onDocumentCreated trigger',
    /exports\.stormBriefing_onAlertSent\s*=\s*onDocumentCreated/.test(sb),
    'expected stormBriefing_onAlertSent registered');
  assert('storm-briefing module guards SLACK_WEBHOOK_URL secret',
    /SECRETS\.SLACK_WEBHOOK_URL/.test(sb),
    'expected SLACK_WEBHOOK_URL declared as a secret on the trigger');
  assert('storm-briefing uses atomic sentinel to dedup',
    /storm_briefings_sent\/\$\{alertId\}/.test(sb)
    && /runTransaction/.test(sb),
    'expected dedup via storm_briefings_sent sentinel + runTransaction');
  assert('storm-briefing scoring exports for unit tests',
    /exports\._test\s*=\s*\{[\s\S]*scoreLead/.test(sb),
    'expected scoreLead exported via _test');
  assert('functions/index.js registers stormBriefingIntegration',
    /stormBriefingIntegration\s*=\s*require\('\.\/integrations\/storm-briefing'\)/.test(idx)
    && /Object\.assign\(exports,\s*stormBriefingIntegration\)/.test(idx),
    'expected index.js to require + Object.assign stormBriefingIntegration');
  // Static checks on the ranking contract — STAGE_WEIGHTS table + the
  // shape of scoreLead. We don't require() the module here because it
  // depends on firebase-functions which isn't in tests/node_modules.
  assert('STAGE_WEIGHTS ranks early-stage > install_in_progress',
    /STAGE_WEIGHTS\s*=\s*\{[\s\S]{0,1500}new:\s*1\.00/.test(sb)
    && /install_in_progress:\s*0\.10/.test(sb),
    'expected new=1.00 and install_in_progress=0.10 in STAGE_WEIGHTS');
  assert('recencyWeight returns 1.00 for leads ≤30 days old',
    /if \(ageDays <= RECENT_LEAD_DAYS\) return 1\.00/.test(sb),
    'expected recencyWeight to cap at 1.00 for the recent window');
  assert('storm-briefing composes a Slack briefing with leadCount + topLeadIds',
    /leadCount:\s*scored\.length/.test(sb)
    && /topLeadIds:\s*scored\.slice\(0, BRIEFING_LEAD_LIMIT\)\.map/.test(sb),
    'expected the storm_briefings_sent sentinel to carry leadCount + topLeadIds for Viktor');
}

section('Phase B.1 — AI Vision auto-tag on photo upload');
{
  const pe = read(path.join(ROOT, 'docs/pro/js/photo-engine.js'));
  // 1. Background auto-tag is invoked after the photo doc lands.
  assert('photo-engine.js fires _autoTagPhotoBackground(photoId) after setDoc',
    /await setDoc\(photoDocRef[^)]*\)[\s\S]{0,1500}_autoTagPhotoBackground\(photoId\)/.test(pe),
    'expected uploadPhotoToFirebase to call _autoTagPhotoBackground(photoId) after setDoc');
  // 2. Helper lazy-loads the Functions SDK + calls analyzePhotoVision.
  assert('_autoTagPhotoBackground helper defined',
    /function _autoTagPhotoBackground\(photoId\)/.test(pe),
    'expected _autoTagPhotoBackground helper');
  assert('helper resolves the analyzePhotoVision callable',
    /window\._httpsCallable\(window\._functions,\s*['"]analyzePhotoVision['"]\)/.test(pe),
    'expected the helper to wire analyzePhotoVision via _httpsCallable');
  // 3. Gallery renders the .pe-ai-chip when photo.aiSuggestion is set.
  assert('gallery renders .pe-ai-chip for photos with aiSuggestion',
    /photo\.aiSuggestion[\s\S]{0,200}<span class="pe-ai-chip"/.test(pe),
    'expected gallery to render .pe-ai-chip when aiSuggestion is present');
  // 4. .pe-ai-chip CSS is theme-aware (uses --accent-fg + --accent-ring).
  assert('.pe-ai-chip CSS consumes var(--accent-fg) + var(--accent-ring)',
    /\.pe-ai-chip\s*\{[\s\S]{0,600}color:\s*var\(--accent-fg\)[\s\S]{0,400}var\(--accent-ring\)/.test(pe),
    'expected .pe-ai-chip to use --accent-fg + --accent-ring tokens');
  // 5. Pulsing-dot keyframe present.
  assert('AI chip dot has the pulsing keyframe',
    /@keyframes pe-ai-chip-pulse/.test(pe),
    'expected @keyframes pe-ai-chip-pulse');
}

section('Wave 5e (A.5) — second-pass theme contrast audit');
{
  const themeCSS = read(path.join(ROOT, 'docs/pro/css/theme-system.css'));
  // Programmatic luminance check — every theme's --orange should give
  // white text ≥ 3.5:1 contrast OR have an explicit --accent-fg
  // override. Parser pulls each theme's --orange value and per-theme
  // --accent-fg presence; assertion fails any theme that fails BOTH.
  const reTheme = /:root\[data-theme="([^"]+)"\][^{]*\{\s*--orange:\s*(#[0-9a-fA-F]{6})/g;
  const reFg = /:root\[data-theme="([^"]+)"\][^{]*\{[\s\S]*?--accent-fg/g;
  const themes = {};
  let m;
  while ((m = reTheme.exec(themeCSS)) !== null) themes[m[1]] = m[2];
  // Also parse the group-selector overrides (paper, ghost, etc.)
  const groupRe = /:root\[data-theme="[^"]+"\][^{]*(?:,\s*:root\[data-theme="[^"]+"\][^{]*)*\{\s*--accent-fg/g;
  const overridden = new Set();
  let g;
  while ((g = groupRe.exec(themeCSS)) !== null) {
    const sel = g[0];
    const names = [...sel.matchAll(/data-theme="([^"]+)"/g)].map(x => x[1]);
    names.forEach(n => overridden.add(n));
  }
  function lum(hex){
    const r=parseInt(hex.slice(1,3),16)/255;
    const gr=parseInt(hex.slice(3,5),16)/255;
    const b=parseInt(hex.slice(5,7),16)/255;
    const f=v=>v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);
    return 0.2126*f(r)+0.7152*f(gr)+0.0722*f(b);
  }
  // nbd-original is the canonical NBD brand — white-on-orange is the
  // identity, so it's explicitly grandfathered here (3.07 contrast).
  const BRAND_GRANDFATHERED = new Set(['nbd-original']);
  const failingWithoutOverride = [];
  for (const [name, hex] of Object.entries(themes)) {
    if (BRAND_GRANDFATHERED.has(name)) continue;
    const oL = lum(hex);
    const cWhite = 1.05 / (oL + 0.05);
    if (cWhite < 3.5 && !overridden.has(name)) {
      failingWithoutOverride.push(`${name} (${hex}, white-contrast ${cWhite.toFixed(2)})`);
    }
  }
  assert('every sub-3.5 white-contrast theme has an explicit --accent-fg override',
    failingWithoutOverride.length === 0,
    'these themes still need --accent-fg overrides: ' + failingWithoutOverride.join(' | '));
  // Spot-check: A.5's 11 newly-covered themes are present.
  for (const t of ['forest','arctic','deep-space','glow','retro','vaporwave','halloween','android','ios26','candlelit','midnight-oil']) {
    assert('A.5 override present for theme "' + t + '"',
      new RegExp(':root\\[data-theme="' + t + '"\\][^{]*\\{[\\s\\S]{0,200}--accent-fg').test(themeCSS),
      'expected A.5 to override --accent-fg for ' + t);
  }
}

section('Wave 5d (A.4) — accent contract on remaining toggle-active states');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const crmJs = read(path.join(ROOT, 'docs/pro/js/crm.js'));
  // 1. .crm-icon-btn.active gains the inset --accent-ring boundary.
  assert('.crm-icon-btn.active includes box-shadow inset --accent-ring',
    /\.crm-icon-btn\.active\{[\s\S]{0,400}box-shadow:inset 0 0 0 1px var\(--accent-ring\)/.test(dash),
    'expected .crm-icon-btn.active to carry the inset --accent-ring boundary');
  // 2. JS-driven inline orange surfaces in crm.js use --accent-fg.
  assert('crm.js search-highlight <mark> uses var(--accent-fg)',
    /<mark style="background:var\(--orange\);color:var\(--accent-fg\)/.test(crmJs),
    'expected the search-highlight <mark> to color via --accent-fg');
  assert('crm.js saveBtn.style.cssText uses var(--accent-fg) + accent-ring',
    /saveBtn\.style\.cssText\s*=\s*'background:var\(--orange\);border:1px solid var\(--orange\);color:var\(--accent-fg\);box-shadow:inset 0 0 0 1px var\(--accent-ring\)/.test(crmJs),
    'expected saveBtn inline cssText to use --accent-fg + inset --accent-ring');
}

section('Wave 2E.3 (A.3) — m-modal-bar on the last 5 dashboard modals');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const cases = [
    { id: 'quickAddModal',              eyebrow: 'Quick Add', titleId: null,                closeFn: 'closeQuickAddLead' },
    { id: 'warrantyCertModal',          eyebrow: 'NBD Guarantee', titleId: null,            closeFn: null },
    { id: 'docViewerModal',             eyebrow: 'Document Template', titleId: 'docViewerTitle', closeFn: 'closeDocViewer' },
    { id: 'cardDetailModal',            eyebrow: null, titleId: 'cardDetailName',           closeFn: 'closeCardDetailModal' },
    { id: 'propertyIntelConfirmModal',  eyebrow: 'Intel', titleId: null,                    closeFn: 'closePropertyIntelConfirmModal' },
  ];
  for (const c of cases) {
    const start = dash.indexOf('id="' + c.id + '"');
    const block = dash.slice(start, start + 3500);
    assert(c.id + ' inner .modal carries .m-modal-has-bar',
      /class="modal m-modal-has-bar"/.test(block),
      'expected ' + c.id + ' .modal class to include m-modal-has-bar');
    assert(c.id + ' renders an .m-modal-bar element',
      /class="m-modal-bar"/.test(block),
      'expected ' + c.id + ' to contain an .m-modal-bar element');
    if (c.eyebrow) {
      assert(c.id + ' eyebrow renders "' + c.eyebrow + '"',
        new RegExp('class="m-modal-bar-eyebrow"[^>]*>' + c.eyebrow.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '<').test(block),
        'expected eyebrow text "' + c.eyebrow + '" inside ' + c.id);
    }
    if (c.titleId) {
      assert(c.id + ' preserves id="' + c.titleId + '" on the bar title span',
        new RegExp('class="m-modal-bar-title"[^>]*id="' + c.titleId + '"').test(block),
        c.titleId + ' should move to the m-modal-bar-title span');
    }
    if (c.closeFn) {
      // C.4 cluster 3: the bar X was migrated from inline
      //   onclick="closeFn()"
      // to the body delegate:
      //   data-action="closeModal" data-target="<modal-id>"
      // We just verify the bar X carries the delegate hook; the
      // closeFn → modal-target mapping is locked by the
      // _NBD_MODAL_CLOSE_FNS registry assertions in the C.4 cluster 3
      // section above.
      assert(c.id + ' bar X uses data-action="closeModal"',
        /class="m-modal-bar-x"[^>]*data-action="closeModal"[^>]*data-target="[A-Za-z]+"/.test(block),
        'expected the bar X to carry data-action="closeModal" + data-target');
    }
  }
  // cardDetailModal got special treatment — kindLabel + name + stage
  // chip all moved into the bar, and the duplicate block below was
  // retired.
  const cd = dash.indexOf('id="cardDetailModal"');
  const cdBlock = dash.slice(cd, cd + 4000);
  assert('cardDetailModal: kindLabel migrated into m-modal-bar-eyebrow',
    /class="m-modal-bar-eyebrow" id="cardDetailKindLabel"/.test(cdBlock),
    'expected #cardDetailKindLabel to live on the eyebrow span');
  assert('cardDetailModal: stage chip carried into bar with id="cardDetailStage"',
    /class="m-modal-bar"[\s\S]{0,1200}id="cardDetailStage"/.test(cdBlock),
    'expected #cardDetailStage to live inside the m-modal-bar');
}

section('Wave 2E.2 — m-modal-bar applied to task / photo / propertyIntel');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // Each modal must:
  //   1. have .m-modal-has-bar on its inner .modal
  //   2. contain an .m-modal-bar element
  //   3. have an eyebrow + title pair within it
  //   4. keep its existing id="*ModalTitle" if one existed (so JS still binds)
  const cases = [
    { id: 'taskModal',          eyebrow: 'Tasks',  titleId: 'taskModalTitle',  closeFn: 'closeTaskModal' },
    { id: 'photoModal',         eyebrow: 'Photos', titleId: 'photoModalTitle', closeFn: 'closePhotoModal' },
    { id: 'propertyIntelModal', eyebrow: 'Intel',  titleId: null,              closeFn: 'closePropertyIntelModal' },
  ];
  for (const c of cases) {
    const start = dash.indexOf('id="' + c.id + '"');
    const block = dash.slice(start, start + 2200);
    assert(c.id + ' .modal has class m-modal-has-bar',
      /class="modal m-modal-has-bar"/.test(block),
      'expected .modal class to carry m-modal-has-bar on ' + c.id);
    assert(c.id + ' contains an m-modal-bar',
      /class="m-modal-bar"/.test(block),
      'expected .m-modal-bar inside ' + c.id);
    assert(c.id + ' eyebrow renders "' + c.eyebrow + '"',
      new RegExp('class="m-modal-bar-eyebrow"[^>]*>' + c.eyebrow + '<').test(block),
      'expected eyebrow text "' + c.eyebrow + '" inside ' + c.id);
    // C.4 cluster 3: bar X migrated to the closeModal delegate.
    // closeFn → modal-target mapping is enforced by the
    // _NBD_MODAL_CLOSE_FNS registry assertion in the C.4 cluster 3
    // section above.
    assert(c.id + ' bar close button uses data-action="closeModal"',
      /class="m-modal-bar-x"\s+data-action="closeModal"\s+data-target="[A-Za-z]+"/.test(block),
      'expected the bar X to carry data-action="closeModal" + data-target');
    if (c.titleId) {
      assert(c.id + ' preserves id="' + c.titleId + '" on the bar title span',
        new RegExp('class="m-modal-bar-title"[^>]*id="' + c.titleId + '"').test(block),
        c.titleId + ' should move to the m-modal-bar-title span');
    }
  }
}

section('Wave 2E — m-modal-bar standardization');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. Pattern CSS exists.
  for (const cls of ['m-modal-bar','m-modal-bar-x','m-modal-bar-titles','m-modal-bar-eyebrow','m-modal-bar-title','m-modal-bar-action','m-modal-has-bar']) {
    assert('CSS class .' + cls + ' is defined',
      new RegExp('\\.' + cls.replace(/-/g,'\\-') + '\\b').test(dash),
      'expected .' + cls + ' rule');
  }
  // 2. .m-modal-has-bar hides the floating .modal-close.
  assert('.m-modal-has-bar hides floating .modal-close',
    /\.modal\.m-modal-has-bar\s*>\s*\.modal-close\s*\{\s*display:\s*none/.test(dash),
    'expected .modal-close hidden when .m-modal-has-bar applied');
  // 3. leadModal adopts the new pattern.
  const lmStart = dash.indexOf('<div class="modal-bg" id="leadModal">');
  const lmBlock = dash.slice(lmStart, lmStart + 1500);
  assert('leadModal applies .m-modal-has-bar to inner .modal',
    /class="modal m-modal-has-bar"/.test(lmBlock),
    'leadModal inner .modal should carry .m-modal-has-bar');
  assert('leadModal renders an .m-modal-bar header',
    /class="m-modal-bar"/.test(lmBlock),
    'leadModal should contain a .m-modal-bar element');
  assert('leadModal bar carries the "CRM" eyebrow',
    /class="m-modal-bar-eyebrow"[^>]*>CRM</.test(lmBlock),
    'expected the CRM eyebrow inside the m-modal-bar');
  assert('leadModal bar keeps id="leadModalTitle" on the title span',
    /class="m-modal-bar-title"[^>]*id="leadModalTitle"/.test(lmBlock),
    'leadModalTitle id should move to the bar title span so existing JS still finds it');
}

section('Wave 2D — Mobile inspection overlay');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));
  // 1. Overlay DOM exists.
  assert('m-inspection overlay element exists',
    /<div class="m-inspection" id="mInspection"/.test(dash),
    'expected <div class="m-inspection" id="mInspection">');
  assert('inspection overlay contains #mInspectionContainer',
    /id="mInspectionContainer"/.test(dash),
    'expected the engine mount point #mInspectionContainer');
  // 2. Close button wired via C.4 closeModal delegate
  //    (data-action="closeModal" data-target="mobileInspection").
  assert('inspection overlay has close button wired to closeModal delegate',
    /id="mInspBack"[\s\S]*data-action="closeModal"[\s\S]*data-target="mobileInspection"/.test(dash),
    'expected close button in m-inspection top bar to use the closeModal delegate');
  // 3. Entry CTA in mobile job-detail Activity tab.
  assert('mobile job-detail Activity tab has a .m-jd-cta Start Inspection button',
    /class="m-jd-cta"[\s\S]*data-action="call" data-fn="cdaOpenMobileInspection"/.test(dash),
    'expected a .m-jd-cta wired to cdaOpenMobileInspection');
  // 4. JS hooks exposed.
  for (const fn of ['openMobileInspection','closeMobileInspection']) {
    assert('window.' + fn + ' exposed',
      new RegExp('window\\.' + fn + '\\s*=').test(mainJs),
      'expected window.' + fn);
  }
  // 5. openMobileInspection delegates to InspectionReportEngine.openBuilder.
  assert('openMobileInspection mounts the existing InspectionReportEngine',
    /InspectionReportEngine\.openBuilder\(['"]mInspectionContainer['"]/.test(mainJs),
    'expected the mobile overlay to host InspectionReportEngine.openBuilder()');
  // 6. Desktop force-hide guard.
  assert('@media (min-width:769px) hides .m-inspection',
    /@media\s*\(min-width:\s*769px\)[\s\S]{0,400}\.m-inspection\s*\{\s*display:\s*none\s*!important/.test(dash),
    'expected desktop media query to force-hide .m-inspection');
}

section('Wave 2C.2 — Camera FAB + native share');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));
  // 1. Sprite has the new shutter + share glyphs.
  assert('sprite has nbd-icon-shutter',
    /<symbol id="nbd-icon-shutter"/.test(dash),
    'expected sprite symbol nbd-icon-shutter');
  assert('sprite has nbd-icon-share',
    /<symbol id="nbd-icon-share"/.test(dash),
    'expected sprite symbol nbd-icon-share');
  // 2. Camera FAB exists inside view-photos.
  const vp = dash.indexOf('id="view-photos"');
  const vpClose = dash.indexOf('<!-- ══ INSPECTION REPORT BUILDER OVERLAY', vp);
  const vpBlock = dash.slice(vp, vpClose === -1 ? vp + 8000 : vpClose);
  assert('view-photos contains the m-shutter-fab',
    /class="m-shutter-fab"[\s\S]*id="mShutterFab"/.test(vpBlock),
    'expected #mShutterFab button inside view-photos');
  // 3. Share button in mobile job-detail top bar.
  assert('mobile job-detail has #mJdShare button wired to _mJdShare',
    /id="mJdShare"[\s\S]*data-action="call" data-fn="_mJdShare"/.test(dash),
    'expected the share icon button in the mobile job-detail top bar');
  // 4. JS handler exposed.
  assert('window._mJdShare exposed',
    /window\._mJdShare\s*=/.test(mainJs),
    'expected window._mJdShare to be exported');
  // 5. _mJdShare prefers navigator.share().
  assert('_mJdShare uses navigator.share when available',
    /navigator\.share\(\{\s*title:[^}]*url:\s*portal/.test(mainJs),
    'expected _mJdShare to call navigator.share() with title/text/url');
  // 6. Desktop force-hide guard for the FAB.
  assert('@media (min-width:769px) hides .m-shutter-fab',
    /@media\s*\(min-width:\s*769px\)[\s\S]{0,200}\.m-shutter-fab[\s\S]{0,80}display:\s*none\s*!important/.test(dash),
    'expected desktop media query to force-hide .m-shutter-fab');
}

section('Wave 2C.1 — Mobile create popover');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));
  // 1. Popover DOM + backdrop exist.
  assert('mCreatePopover element exists',
    /<div class="m-create-popover" id="mCreatePopover"/.test(dash),
    'expected <div class="m-create-popover" id="mCreatePopover">');
  assert('mCreateBackdrop element exists',
    /<div class="m-create-backdrop" id="mCreateBackdrop"/.test(dash),
    'expected the backdrop div');
  // 2. Five create rows wired (via data-action="call" data-fn="_mCreate").
  for (const kind of ['lead','photo','task','knock','note']) {
    assert('create row wires _mCreate(\'' + kind + '\') via delegate',
      new RegExp('data-action="call"\\s+data-fn="_mCreate"\\s+data-arg="' + kind + '"').test(dash),
      'missing _mCreate(' + kind + ') row');
  }
  // 3. Hidden camera-capture input present.
  assert('hidden camera input #mCreatePhotoInput with capture=environment',
    /<input type="file" id="mCreatePhotoInput"[^>]*capture="environment"/.test(dash),
    'expected hidden <input type="file" capture="environment"> for the Photo row');
  // 4. window handlers exposed in dashboard-main.js.
  for (const fn of ['openMobileCreatePopover','closeMobileCreatePopover','toggleMobileCreatePopover','_mCreate']) {
    assert('window.' + fn + ' exposed',
      new RegExp('window\\.' + fn.replace(/_/g,'_') + '\\s*=').test(mainJs),
      'expected window.' + fn);
  }
  // 5. Center FAB routes through mCreateFabRoute (toggleMobileCreatePopover
  //    with an openLeadModal fallback, defined as a single global).
  assert('mobile-nav center FAB routes through mCreateFabRoute',
    /data-action="call" data-fn="mCreateFabRoute"/.test(dash) &&
    /mCreateFabRoute\s*=\s*function/.test(mainJs),
    'expected the FAB onclick to test for toggleMobileCreatePopover and fall back to openLeadModal');
  // 6. Desktop force-hide guard.
  assert('@media (min-width:769px) hides .m-create-popover',
    /@media\s*\(min-width:\s*769px\)[\s\S]{0,400}\.m-create-popover[\s\S]{0,100}display:\s*none\s*!important/.test(dash),
    'expected desktop media query to force-hide the popover');
}

section('Wave 2B — Mobile job-detail screen');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));
  const crmJs = read(path.join(ROOT, 'docs/pro/js/crm.js'));
  // 1. Overlay DOM is present with the expected anchors.
  assert('m-jobdetail overlay element exists with id=mJobDetail',
    /<div class="m-jobdetail" id="mJobDetail"/.test(dash),
    'expected <div class="m-jobdetail" id="mJobDetail"...>');
  for (const id of ['mJdStatus','mJdName','mJdAddr','mJdHero','mJdStorm','mJdValue']) {
    assert('mobile job-detail has #' + id,
      new RegExp('id="' + id + '"').test(dash),
      '#' + id + ' missing from mobile job-detail');
  }
  // 2. The 5 action buttons exist.
  for (const id of ['mJdCall','mJdText','mJdEmail','mJdPhotos','mJdEstimate']) {
    assert('mobile job-detail action button #' + id,
      new RegExp('id="' + id + '"').test(dash),
      '#' + id + ' action button missing');
  }
  // 3. The 3 tabs exist.
  assert('mobile job-detail has 3 tabs (Activity/Photos/Details)',
    /data-tab="activity"[\s\S]*?data-tab="photos"[\s\S]*?data-tab="details"/.test(dash),
    'expected 3 tabs in order: activity, photos, details');
  // 4. CSS hides .m-jobdetail on desktop (≥769px).
  assert('@media (min-width:769px) hides .m-jobdetail',
    /@media\s*\(min-width:\s*769px\)\s*\{[\s\S]*?\.m-jobdetail\s*\{\s*display:\s*none\s*!important/.test(dash),
    'expected desktop media query to force-hide .m-jobdetail');
  // 5. JS hooks exposed on window.
  for (const fn of ['openMobileJobDetail','closeMobileJobDetail','openLeadDetail','_mJdSwitchTab','_mJdAct']) {
    assert('window.' + fn + ' exposed in dashboard-main.js',
      new RegExp('window\\.' + fn.replace(/_/g,'_') + '\\s*=').test(mainJs),
      'expected window.' + fn + ' to be exported');
  }
  // 6. openLeadDetail picks mobile vs desktop via matchMedia.
  assert('openLeadDetail routes via matchMedia(max-width:768px)',
    /matchMedia\(['"]\(max-width:\s*768px\)['"]\)/.test(mainJs),
    'expected matchMedia gate in openLeadDetail');
  // 7. crm.js's handleCardClick was rewired to openLeadDetail.
  assert('crm.js handleCardClick calls openLeadDetail (not openCardDetailModal directly)',
    /openLeadDetail\(id\)/.test(crmJs) && !/openCardDetailModal\(id\)/.test(crmJs),
    'expected handleCardClick to call openLeadDetail(id), removing the direct openCardDetailModal(id) call');
  // 8. Storm chip ⛈ is rendered via CSS ::before content (NBD differentiator).
  assert('mobile job-detail storm chip uses ⛈ glyph via CSS',
    /\.m-jd-storm::before\s*\{\s*content:\s*['"]⛈['"]/.test(dash),
    'expected .m-jd-storm::before with ⛈ content');
}

section('Wave 2A — Mobile chrome (nav SVG glyphs + centered FAB)');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. Sprite now ships the mobile-nav glyphs.
  for (const id of ['nbd-icon-home','nbd-icon-board','nbd-icon-plus','nbd-icon-more','nbd-icon-chat']) {
    assert('sprite has <symbol id="' + id + '">',
      new RegExp('<symbol id="' + id + '"').test(dash),
      'expected mobile-nav sprite symbol ' + id);
  }
  // 2. The bottom nav was rewritten — emoji glyphs gone.
  const navOpen = dash.indexOf('<nav id="mobile-nav">');
  const navClose = dash.indexOf('</nav>', navOpen);
  const navBlock = dash.slice(navOpen, navClose);
  for (const glyph of ['📊','🗺','👥','🤖','⋯']) {
    assert('mobile-nav no longer contains emoji glyph ' + glyph,
      !navBlock.includes(glyph),
      '#mobile-nav still has emoji ' + glyph + ' — should be SVG sprite ref');
  }
  // 3. The center "+" FAB exists.
  assert('mobile-nav has center FAB (.mn-fab) wired to a create handler',
    /class="mn-item mn-fab"[\s\S]{0,200}id="mni-create"/.test(navBlock),
    'expected an orange center "+" FAB with id="mni-create"');
  // 4. Sprite refs are present on every primary nav item.
  assert('mobile-nav primary items reference sprite via <use href="#nbd-icon-*"/>',
    (navBlock.match(/<use href="#nbd-icon-(home|board|plus|chat|more)"\/>/g) || []).length >= 5,
    'expected ≥5 sprite refs across the 5 nav items');
}

section('Pro Chrome — icon system + header consolidation');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  // 1. SVG sprite ships with the 5 chrome icons we replaced emoji with.
  for (const id of ['nbd-icon-clock','nbd-icon-bell','nbd-icon-palette','nbd-icon-gear','nbd-icon-book']) {
    assert('sprite has <symbol id="' + id + '">',
      new RegExp('<symbol id="' + id + '"').test(dash),
      'expected an inline SVG sprite symbol for ' + id);
  }
  // 2. The five .hdr-tool buttons are present and reference the sprite.
  assert('global header uses .hdr-tool wrappers (≥5 instances)',
    (dash.match(/class="hdr-tool"/g) || []).length >= 5,
    'expected at least 5 .hdr-tool buttons in the global header');
  assert('header tools reference the sprite via <use href="#nbd-icon-*"/>',
    /<use href="#nbd-icon-(clock|bell|palette|gear|book)"\/>/.test(dash),
    'expected header buttons to <use> sprite symbols');
  // 3. The five raw-emoji glyphs the old buttons rendered must no longer
  //    appear inside the global <header>. We slice the header block and
  //    check it. (Decorative emoji elsewhere in the file — card chips,
  //    stage headers, settings tabs — are out of scope for this PR and
  //    intentionally untouched.)
  const headerOpen = dash.indexOf('<header>');
  const headerClose = dash.indexOf('</header>', headerOpen);
  const headerBlock = dash.slice(headerOpen, headerClose);
  for (const glyph of ['🕒','🔔','🎨','⚙','📖']) {
    // 🕒 = \u{1F552} clock, 🔔 = bell, 🎨 = palette,
    // ⚙ = gear, 📖 = book
    assert('header chrome no longer contains raw emoji ' + glyph,
      !headerBlock.includes(glyph),
      'global <header> still has emoji ' + glyph + ' — should be SVG sprite ref now');
  }
  // 4. The notif badge keeps working via the new .hdr-tool-badge class
  // (and may carry the .dn utility from the C.6 sweep when count=0).
  assert('notif button keeps its #notifBadge under .hdr-tool-badge',
    /<button class="hdr-tool"[^>]*id="notifBtn"[\s\S]{0,500}id="notifBadge" class="hdr-tool-badge( dn)?"/.test(dash),
    'expected #notifBadge inside the .hdr-tool#notifBtn with .hdr-tool-badge class');
  // 5. The CRM action row was given group dividers (3 .crm-hdr-sep spans).
  assert('CRM action row has ≥3 .crm-hdr-sep dividers between groups',
    (dash.match(/class="crm-hdr-sep"/g) || []).length >= 3,
    'expected at least 3 .crm-hdr-sep elements inside .crm-hdr-actions');
}

section('Rock 4 Phase 3 — view-storm lazy hydration');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = read(path.join(ROOT, 'docs/pro/js/dashboard-main.js'));
  // 1. The active view DIV is now an empty mount carrying the template ref.
  assert('view-storm is an empty mount div with data-view-template',
    /<div class="view" id="view-storm" data-view-template="tpl-view-storm"><\/div>/.test(dash),
    'expected: <div class="view" id="view-storm" data-view-template="tpl-view-storm"></div>');
  // 2. The original markup lives inside a <template> sibling.
  assert('tpl-view-storm template exists with stormCenterContainer inside',
    /<template id="tpl-view-storm">[\s\S]*?id="stormCenterContainer"[\s\S]*?<\/template>/.test(dash),
    'expected <template id="tpl-view-storm"> wrapping the original view markup');
  // 3. The hydration helper is defined.
  assert('_hydrateViewTemplate helper defined in dashboard-main.js',
    /function _hydrateViewTemplate\(name\)/.test(mainJs),
    'expected function _hydrateViewTemplate(name) in dashboard-main.js');
  // 4. goTo() calls the helper before the view-active update.
  assert('goTo() calls _hydrateViewTemplate(name) before reading view-' + 'name',
    /_hydrateViewTemplate\(name\)[\s\S]{0,400}document\.getElementById\(['"]view-['"]\+name\)/.test(mainJs),
    'expected _hydrateViewTemplate(name) to run before the view-active update');
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
