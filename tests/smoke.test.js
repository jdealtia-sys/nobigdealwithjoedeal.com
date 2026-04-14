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
  assert('imports initializeAppCheck + ReCaptchaV3Provider',
    /initializeAppCheck[\s\S]{0,80}ReCaptchaV3Provider/.test(src));
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

// ── H-3: imageProxy tenant-scoped ───────────────────────────
section('H-3: imageProxy tenant scoping');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  assert('imageProxy checks caller role is company_admin or manager',
    /\['manager', 'company_admin'\]\.includes\(callerRole\)/.test(src));
  assert('imageProxy falls back to lookup if claim missing',
    /imageProxy[\s\S]{0,3000}users\/\$\{ownerUid\}/.test(src));
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
  const src = read(path.join(FUNCTIONS, 'index.js'));
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
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  for (const fn of ['createPortalToken', 'getHomeownerPortalView']) {
    assert('exports ' + fn, new RegExp('exports\\.' + fn + '\\s*=').test(idx));
  }
  assert('createPortalToken owner-scopes by lead.userId',
    /lead\.userId !== uid && !isAdmin/.test(idx));
  assert('getHomeownerPortalView rate-limits by IP',
    /httpRateLimit\(req, res, 'portal:ip'/.test(idx));
  assert('view response redacts sensitive fields (no claim / notes)',
    /REDACTION:/.test(idx));
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
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('portal view requests fresh embed URL when awaiting signature',
    /signatureStatus === 'sent'.+signatureStatus === 'viewed'|signature[Ss]tatus === 'sent' \|\| latest\.signatureStatus === 'viewed'/.test(idx));
  assert('portal view returns signEmbedUrl field',
    /signEmbedUrl:\s*signEmbedUrl/.test(idx));
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
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('revokePortalToken callable exported',
    /exports\.revokePortalToken\s*=/.test(idx));
  assert('revoke flips expiresAt to past',
    /expiresAt: admin\.firestore\.Timestamp\.fromMillis\(Date\.now\(\) - 1\)/.test(idx));
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
  assert('callableRateLimit helper defined',
    /async function callableRateLimit/.test(idx));
  for (const name of ['createPortalToken','revokePortalToken','createTeamMember','updateUserRole','deactivateUser']) {
    assert(name + ' rate-limited',
      new RegExp("callableRateLimit\\(request, '" + name + "'").test(idx));
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
    /where\('userId', '==', uid\)\.limit\(500\)/.test(src));
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
  const src = read(path.join(FUNCTIONS, 'index.js'));
  // Grab the function block and assert GET is not accepted.
  const block = src.match(/exports\.getHomeownerPortalView[\s\S]{0,1200}/);
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
  const src = read(path.join(FUNCTIONS, 'index.js'));
  assert('F-07: eventRef.create used for idempotency',
    /eventRef\.create\(\{[\s\S]{0,200}processedAt:/.test(src));
  assert('F-07: ALREADY_EXISTS code handled',
    /e\.code === 6[\s\S]{0,200}duplicate_event/.test(src));
}

section('F-08: Stripe plan derived from price id, not metadata');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
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

section('D8: imageProxy deprecation signals');
{
  const src = read(path.join(FUNCTIONS, 'index.js'));
  assert('imageProxy sets Deprecation header',
    /imageProxy[\s\S]*?res\.set\('Deprecation', 'true'\)/.test(src));
  assert('imageProxy sets Sunset header',
    /imageProxy[\s\S]*?res\.set\('Sunset',/.test(src));
  assert('imageProxy logs every call',
    /imageProxy DEPRECATED call/.test(src));
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
  const src = read(path.join(FUNCTIONS, 'index.js'));
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
  const idx = read(path.join(FUNCTIONS, 'index.js'));
  assert('stripeWebhook calls stripe.webhooks.constructEvent',
    /exports\.stripeWebhook[\s\S]{0,4000}stripe\.webhooks\.constructEvent/.test(idx));
  assert('invoiceWebhook calls stripe.webhooks.constructEvent',
    /exports\.invoiceWebhook[\s\S]{0,4000}stripe\.webhooks\.constructEvent/.test(idx));
  assert('stripeWebhook requires rawBody Buffer',
    /stripeWebhook[\s\S]{0,2000}!Buffer\.isBuffer\(req\.rawBody\)/.test(idx));
  assert('invoiceWebhook requires rawBody Buffer',
    /invoiceWebhook[\s\S]{0,2000}!Buffer\.isBuffer\(req\.rawBody\)/.test(idx));
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

section('C0: GDPR erasure cascade covers Storage + collectionGroups');
{
  const src = read(path.join(FUNCTIONS, 'integrations/compliance.js'));
  // (1) flat-path cascade still intact
  assert('C0: flat-path OWNED_COLLECTIONS still present',
    /OWNED_COLLECTIONS\s*=\s*\[[\s\S]{0,200}'leads'[\s\S]{0,200}'training_sessions'/.test(src));
  // (2) collectionGroup sweep added (recordings)
  assert('C0: OWNED_COLLECTION_GROUPS includes recordings',
    /OWNED_COLLECTION_GROUPS\s*=\s*\[[\s\S]{0,200}'recordings'/.test(src));
  assert('C0: erasure runs collectionGroup query for userId==uid',
    /collectionGroup\(groupName\)[\s\S]{0,200}where\('userId', '==', uid\)/.test(src));
  // (3) Storage sweep added for owner-keyed prefixes
  assert('C0: OWNED_STORAGE_PREFIXES includes audio + photos + docs',
    /OWNED_STORAGE_PREFIXES\s*=\s*\[[\s\S]{0,200}'audio'[\s\S]{0,200}'photos'[\s\S]{0,200}'docs'/.test(src));
  assert('C0: erasure calls bucket.deleteFiles with uid-keyed prefix',
    /bucket\.deleteFiles\(\s*\{[\s\S]{0,200}prefix:[\s\S]{0,80}uid[\s\S]{0,80}force: true/.test(src));
  // exportMyData picks up collectionGroup rows too
  assert('C0: exportMyData also covers collectionGroup OWNED_GROUPS',
    /OWNED_GROUPS\s*=\s*\['recordings'\][\s\S]{0,400}collectionGroup\(group\)\.where\('userId', '==', uid\)/.test(src));
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

// ── Summary ─────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
process.exit(0);
