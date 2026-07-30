/**
 * tests/stripe-connect-ui.test.js — Connect phase 2: the Settings → Billing
 * payouts card.
 *
 * Phase 1 (#1143) shipped five callables with NO caller. This is the caller, so
 * these are the first assertions that anything user-facing touches Connect.
 *
 * Four things are load-bearing here, and each has burned this repo before:
 *
 *  1. THE HONESTY GATE. The #1123 platform-only payment gate is still closed, so
 *     finishing Stripe onboarding grants a contractor nothing — while Express
 *     onboarding collects SSN + bank details. So the card is OWNER-ONLY and every
 *     connected state carries a "payments are still off" note. If a future change
 *     reveals this to tenants while the gate stands, that is asking people for
 *     their SSN under false pretences. These tests exist to make that loud.
 *
 *  2. TEMPLATE RE-EXECUTION. The module ships inside the lazily-hydrated
 *     tpl-view-settings template and runs AGAIN at hydration, after DCL. A bare
 *     top-level `const` throws on the second run; a bare DCL listener never
 *     installs; an unguarded delegate double-fires — and a double-fired
 *     "create my Stripe account" is the exact race phase 1's idempotency key
 *     exists to survive.
 *
 *  3. THE BLANK-SETTINGS HAZARD. switchSettingsTab() hides EVERY .stab-panel and
 *     shows one only `if (panel)`, so a URL-supplied tab name that doesn't exist
 *     leaves the user on an empty Settings screen. The deep link must allowlist.
 *
 *  4. APP CHECK. All five callables set enforceAppCheck:true, so they must be
 *     invoked via the callable SDK (which attaches the token) from a page that
 *     initialises App Check. A raw fetch() 401s — silently, in a catch.
 *
 * Zero deps.  Run: node tests/stripe-connect-ui.test.js
 */
'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
// Negative assertions MUST run against this, not the raw source: the comments in
// these files legitimately mention fetch(), localStorage, onclick and
// companyProfile while explaining why they are absent. (Learned the hard way in
// tests/stripe-connect.test.js.)
const decomment = (s) => s.split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

console.log('STRIPE CONNECT phase 2 — Settings → Billing payouts card');

const MOD_PATH = 'docs/pro/js/dashboard-connect-tab.js';
const SRC = read(MOD_PATH);
const CODE = decomment(SRC);
const HTML = read('docs/pro/dashboard.html');
const BOOT = read('docs/pro/js/dashboard-bootstrap.module.js');
const BOOT_CODE = decomment(BOOT);

// ── Part 1: it is actually wired into the page ────────────────────────
{
  ok('the module exists', fs.existsSync(path.join(ROOT, MOD_PATH)));
  ok('dashboard.html loads it', /<script src="js\/dashboard-connect-tab\.js/.test(HTML));
  ok('the card container exists', /id="connectPayoutsCard"/.test(HTML));
  ok('the card body exists', /id="connectPayoutsBody"/.test(HTML));

  // Both must sit inside the settings template, or the module never runs at all
  // (and this whole suite would be testing dead code).
  const tplAt = HTML.indexOf('id="tpl-view-settings"');
  const tplEnd = tplAt > -1 ? HTML.indexOf('</template>', tplAt) : -1;
  const cardAt = HTML.indexOf('id="connectPayoutsCard"');
  const scriptAt = HTML.indexOf('<script src="js/dashboard-connect-tab.js');
  ok('card + script live inside tpl-view-settings',
    tplAt > -1 && tplEnd > tplAt && cardAt > tplAt && cardAt < tplEnd
      && scriptAt > tplAt && scriptAt < tplEnd,
    'if they moved out of the template the re-execution guards below stop being about anything');

  // It must ship hidden: renderConnectCard() is what reveals it, and only for
  // the owner. A card that starts visible is visible to every tenant for the
  // moment before JS runs.
  const cardTag = HTML.slice(cardAt - 200, cardAt + 200);
  ok('the card starts display:none', /style="display:none;?"/.test(cardTag),
    'must not flash for non-owners before render');
}

// ── Part 2: the honesty gate (owner-only + no false promises) ──────────
{
  ok('visibility keys on the OWNER claim',
    /_userClaims\s*&&\s*window\._userClaims\.owner === true/.test(CODE)
    || /window\._userClaims\.owner === true/.test(CODE),
    'strict === true: a truthy string must not reveal it');

  // Three independent places must respect it, because each is a separate way in.
  ok('render hides the card for non-owners',
    /if \(!_nbdConnectVisible\(\)\) \{ card\.style\.display = 'none'; return; \}/.test(CODE));
  ok('status loading refuses to run for non-owners',
    /async function loadConnectStatus[\s\S]{0,260}?if \(!_nbdConnectVisible\(\)\)[\s\S]{0,80}?return;/.test(CODE),
    'a non-owner must never even call getConnectStatus');

  // "Claims absent" and "claims not loaded yet" are different answers. Deciding
  // on the unloaded state hides the card from the owner with no error — the
  // profile-hydration trap that wiped company pricing in #1139.
  ok('the visibility decision waits for claims to load',
    /async function _nbdConnectAwaitClaims/.test(CODE)
    && /await _nbdConnectAwaitClaims\(\);/.test(CODE),
    'an unpopulated _userClaims must not read as "not the owner"');
  ok('the claims wait is bounded',
    /_nbdConnectAwaitClaims[\s\S]{0,240}?for \(var i = 0; i < [1-9]\d*; i\+\+\)/.test(CODE));

  // The note that keeps the card honest while #1123 stands.
  ok('a "payments are still off" note exists',
    /_nbdConnectGateNote/.test(CODE)
    && /still switched off/i.test(CODE));

  // It must appear in EVERY state that could read as "you're done". Count CALL
  // sites — `function _nbdConnectGateNote()` matches a naive /name\(\)/ too, so
  // the definition inflates the count and a deleted call still "passes".
  // (Same trap as the adjuster-board test regex.)
  const noteCalls = (CODE.match(/(?:^|[^\w])_nbdConnectGateNote\(\)/g) || [])
    .filter((m) => !/function/.test(m)).length
    - (/function _nbdConnectGateNote\(\)/.test(CODE) ? 1 : 0);
  ok('the note is used by all three connected-ish states', noteCalls >= 3,
    'found ' + noteCalls + ' CALL sites (definition excluded); ready + verifying + payouts_paused each need it');

  // The whole point of the gate: never tell anyone online collection works.
  ok('the card never claims card payments are enabled',
    !/you can now (accept|take|collect)/i.test(CODE)
    && !/payments are (now )?(live|enabled|on)\b/i.test(CODE));
  ok('Mark Paid is still named as the actual way to get paid',
    /Mark Paid/.test(SRC));

  // onlinePaymentsEnabled is hard-false server-side in phase 1; the UI must not
  // treat it as a capability switch.
  ok('the UI does not gate anything on onlinePaymentsEnabled',
    !/if\s*\([^)]*onlinePaymentsEnabled/.test(CODE),
    'that field is hard-coded false in phase 1 — branching on it invents a state');
}

// ── Part 3: template re-execution safety ──────────────────────────────
{
  // A top-level let/const throws SyntaxError on the second execution, killing
  // the whole script — including the tab hook.
  const topLevelDecl = CODE.split('\n').filter((l) => /^\s{0,8}(let|const)\s/.test(l));
  ok('no top-level let/const (script re-executes at hydration)',
    topLevelDecl.length === 0,
    topLevelDecl.length ? 'found: ' + topLevelDecl.slice(0, 3).map((s) => s.trim()).join(' | ') : '');

  ok('readyState guard installs the hook post-DCL',
    /document\.readyState === 'loading'/.test(CODE)
    && /document\.addEventListener\('DOMContentLoaded', _nbdInstallConnectHook\)/.test(CODE)
    && /\} else \{\s*_nbdInstallConnectHook\(\);/.test(CODE),
    'a bare DCL listener never fires for a template hydrated after DCL');

  ok('the click delegate is flag-guarded',
    /if \(!window\._NBD_CONNECT_DELEGATE\) \{\s*window\._NBD_CONNECT_DELEGATE = true;/.test(CODE),
    'double-install fires every action twice, including account creation');
  ok('the tab hook is flag-guarded',
    /window\._NBD_CONNECT_TAB_HOOK/.test(CODE));

  // Six other modules wrap switchSettingsTab. Replacing instead of chaining
  // silently kills the Appearance/Team/Billing tab renderers.
  ok('the tab hook CHAINS the previous switchSettingsTab',
    /var _prevSwitch = window\.switchSettingsTab/.test(CODE)
    && /_prevSwitch\(tab\)/.test(CODE),
    'must call the previous implementation, not replace it');

  // Re-entrancy on the button itself: the delegate disables before dispatch.
  ok('a clicked action button is disabled before dispatch',
    /if \(t\.disabled\) return;\s*t\.disabled = true;/.test(CODE));

  // _nbdInstallConnectHook bails without claiming the guard when
  // switchSettingsTab isn't defined yet. Without a retry that's a permanent
  // "Loading payout status…" and no console error.
  ok('the hook bails BEFORE claiming its guard (so a retry can still install)',
    /if \(typeof _prevSwitch !== 'function'\) return;\s*if \(window\._NBD_CONNECT_TAB_HOOK\) return;\s*window\._NBD_CONNECT_TAB_HOOK = true;/.test(CODE),
    'claiming the guard before the readiness check would wedge it forever');
  // Pin the CONDITION, not just the flag name: `if (false) { … _HOOK_RETRY = true
  // … }` leaves every identifier in place while disabling the whole retry.
  ok('a bounded, single-instance install retry exists',
    /if \(!window\._NBD_CONNECT_TAB_HOOK && !window\._NBD_CONNECT_HOOK_RETRY\) \{\s*window\._NBD_CONNECT_HOOK_RETRY = true;/.test(CODE)
    && /setInterval\(/.test(CODE)
    && /clearInterval\(_nbdConnectHookIv\)/.test(CODE)
    && /_nbdConnectHookTries > [1-9]\d*/.test(CODE)
    && /_nbdInstallConnectHook\(\);\s*if \(window\._NBD_CONNECT_TAB_HOOK/.test(CODE),
    'must actually retry (live guard), must stop, and must not stack one interval per hydration');
}

// ── Part 4: CSP + App Check ───────────────────────────────────────────
{
  ok('no inline event handlers are generated',
    !/\son[a-z]+=/.test(CODE),
    '/pro forbids inline handlers; actions go through data-connect-action');
  ok('actions are dispatched by data-connect-action',
    /data-connect-action="/.test(CODE)
    && /closest\('\[data-connect-action\]'\)/.test(CODE));

  // enforceAppCheck:true on all five callables => callable SDK, not fetch.
  ok('calls go through the callable SDK',
    /window\._httpsCallable\(window\._functions, name\)/.test(CODE));
  ok('the module never raw-fetches a cloudfunctions URL',
    !/fetch\(\s*['"]https:\/\/us-central1/.test(CODE),
    'a raw fetch to an onCall+enforceAppCheck function 401s');
  ok('it self-provisions the functions SDK when absent',
    /import\('https:\/\/www\.gstatic\.com\/firebasejs\/[\d.]+\/firebase-functions\.js'\)/.test(CODE),
    'the globals are set lazily and may be missing at click time');

  // Per-page App Check rule: an enforceAppCheck callable page that never inits
  // App Check gets a 401 on every call.
  ok('dashboard.html initialises App Check',
    /dashboard-appcheck-config\.js/.test(HTML));

  // All four callables actually referenced by name.
  ['getConnectStatus', 'createConnectAccount', 'createConnectOnboardingLink', 'createConnectDashboardLink']
    .forEach((fn) => {
      ok('calls ' + fn, new RegExp("_nbdConnectCallable\\('" + fn + "'\\)").test(CODE));
    });
}

// ── Part 5: the onboarding link is treated as a credential ────────────
{
  // AccountLinks authenticate the account holder. Persisting, emailing or
  // sharing one hands over the Stripe account.
  ok('the onboarding link is redirected to, not stored',
    /window\.location\.href = url;/.test(CODE));
  ok('the module never persists anything to storage',
    !/localStorage|sessionStorage|setItem/.test(CODE),
    'a stored AccountLink is a stored credential');
}

// ── Part 6: the deep link (?settings=…&connect=…) ─────────────────────
{
  ok('bootstrap handles the settings deep link',
    /urlParams\.get\('settings'\)/.test(BOOT_CODE));

  // The blank-Settings hazard.
  ok('the tab name is ALLOWLISTED, not passed through',
    /SETTINGS_TABS\s*=\s*\[/.test(BOOT_CODE)
    && /SETTINGS_TABS\.indexOf\(wantTab\) !== -1/.test(BOOT_CODE),
    'switchSettingsTab hides every panel then shows one only if it exists — an unknown tab = blank screen');

  // And the allowlist must match reality, or a legitimate deep link silently
  // does nothing.
  const realTabs = Array.from(new Set(
    (HTML.match(/id="stab-panel-([a-z0-9-]+)"/g) || [])
      .map((m) => m.replace(/.*stab-panel-/, '').replace('"', ''))
  )).sort();
  const listed = (BOOT_CODE.match(/SETTINGS_TABS\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1]
    .split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort();
  ok('the allowlist matches the real stab-panel ids',
    realTabs.length > 0 && JSON.stringify(realTabs) === JSON.stringify(listed),
    'real: ' + realTabs.join(',') + ' | listed: ' + listed.join(','));
  ok('billing is deep-linkable (the Connect return URL depends on it)',
    listed.indexOf('billing') !== -1);

  // The return/refresh contract with the module.
  ok('connect=return|refresh forces a live status re-read',
    /connectParam === 'return' \|\| connectParam === 'refresh'/.test(BOOT_CODE)
    && /window\._nbdConnectPendingRefresh = true/.test(BOOT_CODE),
    'the account.updated webhook may not have landed when Stripe redirects back');
  ok('the module CONSUMES that flag on billing-tab open',
    /window\._nbdConnectPendingRefresh/.test(CODE)
    && /window\._nbdConnectPendingRefresh = false/.test(CODE),
    'flag not call: bootstrap runs before the hydrated template script exists');
  ok('connect=refresh is surfaced as an expired link',
    /connectParam === 'refresh'\) window\._nbdConnectLinkExpired = true/.test(BOOT_CODE)
    && /_nbdConnectLinkExpired/.test(CODE));

  // An auto-minted replacement link on ?connect=refresh is an infinite bounce
  // if minting keeps failing.
  ok('bootstrap does NOT auto-mint a replacement onboarding link',
    !/createConnectOnboardingLink/.test(BOOT_CODE),
    'refresh must show a button, not redirect in a loop');

  // Lazy hydration means a fixed delay is a race. Assert INSIDE the deep-link
  // branch only: bootstrap is 2000+ lines and contains plenty of unrelated
  // `for (let i = 0; …)` loops, so a whole-file regex passes even after the poll
  // is deleted. (Same loose-window trap as the esign `return;` check.)
  const branchAt = BOOT_CODE.indexOf("urlParams.get('settings')");
  const BRANCH = branchAt > -1 ? BOOT_CODE.slice(branchAt, branchAt + 2600) : '';
  ok('the deep-link branch was located for scoped assertions', BRANCH.length > 500);
  ok('it polls for switchSettingsTab instead of guessing a delay',
    /for \(let i = 0; i < [1-9]\d*; i\+\+\)/.test(BRANCH)
    && /typeof window\.switchSettingsTab === 'function'[\s\S]{0,140}?getElementById\('stab-panel-' \+ wantTab\)/.test(BRANCH)
    && /await new Promise\(\(r\) => setTimeout\(r, \d+\)\)/.test(BRANCH),
    'openSettingsTab()\'s fixed 200ms is exactly this bug');
  ok('the poll bound is a real number of attempts (not zero)',
    /i < ([1-9]\d*);/.test(BRANCH) && Number((BRANCH.match(/i < (\d+);/) || [, 0])[1]) >= 10,
    'a zero/one-iteration loop is a fixed delay wearing a loop costume');
}

// ── Part 7: escaping ──────────────────────────────────────────────────
{
  ok('an escaper exists',
    /function _nbdConnectEsc/.test(CODE)
    && /replace\(\/&\/g, '&amp;'\)/.test(CODE));
  // Stripe-supplied strings that reach innerHTML.
  ['disabledReason', 'accountId'].forEach((f) => {
    ok(f + ' is escaped before innerHTML',
      new RegExp('_nbdConnectEsc\\(st\\.' + f + '\\)').test(CODE));
  });
  ok('requirement names are escaped',
    /_nbdConnectEsc\(_nbdConnectPrettyReq\(r\)\)/.test(CODE));
  ok('the status label is escaped',
    /_nbdConnectEsc\(st\.label/.test(CODE));
}

// ── Part 8: the phase-3 tripwire ──────────────────────────────────────
{
  // Phase 3 must move the gate and the visibility check together. If someone
  // widens visibility while the platform-only gate still stands, that is the
  // SSN-for-nothing scenario — fail loudly and explain.
  const gateStillClosed = /ONLINE_PAYMENTS_UNAVAILABLE/.test(read('functions/stripe.js'));
  const ownerOnly = /owner === true/.test(CODE);
  ok('owner-only visibility and the #1123 gate agree',
    gateStillClosed === ownerOnly,
    gateStillClosed
      ? 'the platform-only payment gate is still closed, so this card must stay OWNER-ONLY — '
        + 'revealing it to tenants asks them for SSN + bank details for a capability they will not get'
      : 'the gate is gone (phase 3): widen visibility deliberately and rewrite this assertion');
}

// ── Part 9: BEHAVIOUR — actually run the renderer ─────────────────────
// Everything above is a source-pattern assertion, which proves the code was
// written a certain way, not that it does the right thing. This part executes
// the module in a sandbox with a fake DOM and inspects the HTML it produces for
// each status the server can return.
{
  const vm = require('vm');

  function mkEnv(claims, state) {
    const els = {};
    function el(id) {
      if (!els[id]) els[id] = { id: id, style: {}, innerHTML: '', disabled: false };
      return els[id];
    }
    el('connectPayoutsCard');
    el('connectPayoutsBody');
    const sandbox = {
      console: { log() {}, warn() {}, error() {} },
      setTimeout: () => 0,
      clearTimeout: () => {},
      setInterval: () => 0,
      clearInterval: () => {},
      Promise,
      document: {
        readyState: 'complete',
        getElementById: (id) => (els[id] || null),
        addEventListener: () => {},
      },
      _els: els,
    };
    sandbox.window = sandbox;          // window.x and bare x are the same binding
    vm.createContext(sandbox);
    vm.runInContext(SRC, sandbox);
    sandbox.window._userClaims = claims;
    sandbox.window._nbdConnectState = state;
    return sandbox;
  }
  function renderWith(claims, state) {
    const s = mkEnv(claims, state);
    s.renderConnectCard();
    return {
      card: s._els.connectPayoutsCard,
      html: s._els.connectPayoutsBody.innerHTML,
    };
  }

  const OWNER = { owner: true };

  // Sanity: the module even loads and exposes its renderer.
  let loaded = true;
  try { mkEnv(OWNER, null); } catch (e) { loaded = false; console.log('    (load error: ' + e.message + ')'); }
  ok('the module executes standalone and exposes renderConnectCard', loaded
    && typeof mkEnv(OWNER, null).renderConnectCard === 'function');

  // Non-owner: hidden, and nothing rendered into the body.
  const nonOwner = renderWith({ owner: false }, { status: 'ready', label: 'Connected', connected: true });
  ok('BEHAVIOUR: a non-owner gets the card hidden', nonOwner.card.style.display === 'none');
  ok('BEHAVIOUR: a non-owner gets no card content', nonOwner.html === '');
  const noClaims = renderWith(undefined, { status: 'ready', label: 'Connected', connected: true });
  ok('BEHAVIOUR: missing claims also hide the card', noClaims.card.style.display === 'none');

  // Owner + each status.
  const r1 = renderWith(OWNER, { status: 'not_started', label: 'Not connected', connected: false });
  ok('BEHAVIOUR: not_started offers "Set up payouts"',
    /data-connect-action="start"/.test(r1.html) && /Set up payouts/.test(r1.html));
  ok('BEHAVIOUR: not_started is revealed to the owner', r1.card.style.display === '');

  const r2 = renderWith(OWNER, {
    status: 'onboarding_incomplete', label: 'Finish setup', connected: true, accountId: 'acct_x',
    requirementsCurrentlyDue: ['individual.ssn_last_4', 'external_account'],
  });
  ok('BEHAVIOUR: onboarding_incomplete offers "Finish setup"',
    /data-connect-action="link"/.test(r2.html) && /Finish setup/.test(r2.html));
  ok('BEHAVIOUR: requirement field NAMES are listed, humanised',
    /ssn last 4/.test(r2.html) && /External account/.test(r2.html));

  const r3 = renderWith(OWNER, { status: 'verifying', label: 'Verification in progress', connected: true, accountId: 'acct_x' });
  ok('BEHAVIOUR: verifying carries the payments-are-off note',
    /still switched off/i.test(r3.html));
  ok('BEHAVIOUR: verifying does NOT push another onboarding link',
    !/data-connect-action="link"/.test(r3.html),
    'the fix-it path for a verifying account is the Express dashboard, not a new link');

  const r4 = renderWith(OWNER, {
    status: 'payouts_paused', label: 'Connected — payouts on hold', connected: true,
    accountId: 'acct_x', disabledReason: 'requirements.past_due',
    requirementsPastDue: ['individual.verification.document'],
  });
  ok('BEHAVIOUR: payouts_paused shows Stripe\'s reason', /requirements\.past_due/.test(r4.html));
  ok('BEHAVIOUR: payouts_paused carries the note', /still switched off/i.test(r4.html));

  const r5 = renderWith(OWNER, {
    status: 'ready', label: 'Connected', connected: true, accountId: 'acct_live1',
    livemode: true, chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true,
  });
  ok('BEHAVIOUR: ready still carries the note (the whole honesty point)',
    /still switched off/i.test(r5.html),
    'a fully-onboarded account must NOT read as "you can take payments now"');
  ok('BEHAVIOUR: ready offers the Express dashboard',
    /data-connect-action="dashboard"/.test(r5.html));
  ok('BEHAVIOUR: livemode renders a LIVE badge', />LIVE</.test(r5.html));

  const r6 = renderWith(OWNER, {
    status: 'ready', label: 'Connected', connected: true, accountId: 'acct_test1', livemode: false,
  });
  ok('BEHAVIOUR: test-mode renders a TEST badge', />TEST</.test(r6.html),
    'the runbook is test-mode-first; the owner must be able to tell which account this is');

  // An unrecognised status from a newer server must not be silently rendered as
  // one of the good states.
  const r7 = renderWith(OWNER, { status: 'brand_new_code', label: 'Whatever', connected: true });
  ok('BEHAVIOUR: an unknown status degrades to "could not interpret"',
    /could not be interpreted/i.test(r7.html)
    && !/data-connect-action="start"/.test(r7.html),
    'never guess a state that governs money');

  // XSS: Stripe strings are not user input today, but they land in innerHTML.
  const r8 = renderWith(OWNER, {
    status: 'payouts_paused', label: '<img src=x onerror=alert(1)>', connected: true,
    accountId: '"><script>alert(2)</script>', disabledReason: '<svg onload=alert(3)>',
    requirementsPastDue: ['<b>boom</b>'],
  });
  ok('BEHAVIOUR: hostile label/accountId/reason/requirements are all escaped',
    !/<img/.test(r8.html) && !/<script/.test(r8.html) && !/<svg/.test(r8.html) && !/<b>/.test(r8.html)
    && /&lt;img/.test(r8.html) && /&lt;svg/.test(r8.html),
    'raw markup reached innerHTML');

  // Busy + error states render instead of a stale card.
  const sBusy = mkEnv(OWNER, { status: 'ready', label: 'Connected', connected: true });
  sBusy.window._nbdConnectBusy = 'Creating your Stripe account…';
  sBusy.renderConnectCard();
  ok('BEHAVIOUR: a busy state replaces the card body',
    /Creating your Stripe account/.test(sBusy._els.connectPayoutsBody.innerHTML)
    && !/data-connect-action="dashboard"/.test(sBusy._els.connectPayoutsBody.innerHTML),
    'leaving live buttons under a busy message invites a double submit');

  const sErr = mkEnv(OWNER, null);
  sErr.window._nbdConnectError = 'Could not read payout status: boom';
  sErr.renderConnectCard();
  ok('BEHAVIOUR: an error state is shown with a retry',
    /boom/.test(sErr._els.connectPayoutsBody.innerHTML)
    && /data-connect-action="refresh"/.test(sErr._els.connectPayoutsBody.innerHTML));

  // The expired-link banner from ?connect=refresh.
  const sExp = mkEnv(OWNER, { status: 'onboarding_incomplete', label: 'Finish setup', connected: true });
  sExp.window._nbdConnectLinkExpired = true;
  sExp.renderConnectCard();
  ok('BEHAVIOUR: connect=refresh surfaces an expired-link notice',
    /expired/i.test(sExp._els.connectPayoutsBody.innerHTML));
}

console.log('\n──────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
