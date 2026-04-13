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
  assert('claudeProxy queries api_usage by companyId',
    /where\('companyId', '==', callerCompanyId\)/.test(src));
  assert('claudeProxy stamps companyId on api_usage writes',
    /api_usage[\s\S]{0,400}companyId: callerCompanyId/.test(src));
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

// ── Summary ─────────────────────────────────────────────────
console.log('\n' + '─'.repeat(50));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
process.exit(0);
