/**
 * tests/login-plan-intent.test.js — post-login destination for plan intent.
 *
 * login.js is an ES module (Firebase CDN imports). We don't execute it here;
 * we assert the source contract so a regression can't re-drop nbd_plan_intent
 * on LOGIN (the post-sprint funnel UX chip): register/onboarding resume intent,
 * login must too.
 *
 * Zero deps. Run: node tests/login-plan-intent.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/pages/login.js'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name); }
}

console.log('LOGIN PLAN INTENT — source contract');

ok('defines PLAN_INTENTS including team',
  /PLAN_INTENTS\s*=\s*\[[^\]]*['"]team['"]/.test(SRC));

ok('POST_LOGIN_DEST still honors redirect=pricing',
  /params\.get\(['"]redirect['"]\)\s*===\s*['"]pricing['"]/.test(SRC));

ok('stashes ?plan= into nbd_plan_intent',
  /sessionStorage\.setItem\(\s*['"]nbd_plan_intent['"]/.test(SRC));

ok('routes to pricing when sessionStorage already holds plan intent',
  /sessionStorage\.getItem\(\s*['"]nbd_plan_intent['"]\s*\)/.test(SRC)
  && /PLAN_INTENTS\.includes\(existing\)/.test(SRC)
  && /\/pro\/pricing\.html/.test(SRC));

ok('routes to pricing for bare ?plan= without requiring redirect=pricing',
  /PLAN_INTENTS\.includes\(qPlan\)/.test(SRC));

ok('default destination remains dashboard when no intent',
  /return\s+['"]\/pro\/dashboard\.html['"]/.test(SRC));

// register.html defer note: App Check + Sentry stay before the module queue
const reg = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/register.html'), 'utf8');
ok('register.html loads sentry/appcheck with defer (paint win, order preserved)',
  /script\s+defer\s+src="js\/sentry-config\.js/.test(reg)
  && /script\s+defer\s+src="js\/dashboard-appcheck-config\.js/.test(reg)
  && /type="module"\s+src="js\/pages\/register\.js"/.test(reg));

// billing tab must not render Free when plan not loaded
const tab = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/dashboard-billing-tab.js'), 'utf8');
ok('billing tab guards on info.loaded before painting plan cards',
  /if\s*\(\s*!info\.loaded\s*\)/.test(tab)
  && /Loading plan/.test(tab));

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
