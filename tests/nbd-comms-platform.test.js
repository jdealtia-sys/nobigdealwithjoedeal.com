/**
 * tests/nbd-comms-platform.test.js — platform-first NBDComms contract.
 *
 * nbd-comms.js is a browser IIFE. We assert the source contract so CI
 * catches a regression that reverts to client-only mailto / client
 * audit writes (rules deny client sms_log/email_log writes).
 *
 * Zero deps. Run: node tests/nbd-comms-platform.test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/nbd-comms.js'), 'utf8');
const INV = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/invoice-pipeline.js'), 'utf8');
const CP = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/claude-proxy.js'), 'utf8');
const SF = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/smart-followup.js'), 'utf8');
const PANEL = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/customer-smart-followup-panel.js'), 'utf8');

let passed = 0, failed = 0;
const fails = [];
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✓ ' + name); }
  else { failed++; fails.push(name); console.log('  ✗ ' + name); }
}

console.log('NBDCOMMS PLATFORM — source contract');

ok('posts to Cloud Function sendEmail',
  /FUNCTIONS_BASE\s*\+\s*['"]\/['"]\s*\+\s*fnName/.test(SRC)
  && /_platformPost\(\s*['"]sendEmail['"]/.test(SRC));

ok('posts to Cloud Function sendSMS',
  /_platformPost\(\s*['"]sendSMS['"]/.test(SRC));

ok('attaches Authorization Bearer + X-Firebase-AppCheck when available',
  /Authorization['"]\s*:\s*['"]Bearer /.test(SRC)
  && /X-Firebase-AppCheck/.test(SRC)
  && /__NBD_APP_CHECK/.test(SRC));

ok('does NOT write client audit to emails/sms_log collections',
  !/logAudit\s*\(/.test(SRC)
  && !/addDoc\([^)]*['"]sms_log['"]/.test(SRC)
  && !/addDoc\([^)]*['"]emails['"]/.test(SRC)
  && !/collection\([^)]*['"]sms_log['"]/.test(SRC));

ok('returns mode platform on success',
  /mode:\s*['"]platform['"]/.test(SRC));

ok('falls back to mailto and sms: protocol handoffs',
  /mailto:/.test(SRC) && /sms:/.test(SRC));

ok('respects forceHandoff for callers that want native client only',
  /forceHandoff/.test(SRC));

ok('403/opt-out does not open device Messages for SMS',
  /status === 403/.test(SRC)
  && /opted out|Cannot text/i.test(SRC));

// invoice pipeline passes leadId so server logs thread correctly
ok('invoice sendEmail/sendSMS pass leadId',
  /NBDComms\.sendEmail\(\{[\s\S]{0,400}leadId:\s*invoice\.leadId/.test(INV)
  && /NBDComms\.sendSMS\(\{[\s\S]{0,400}leadId:\s*invoice\.leadId/.test(INV));

// App Check instance exposed from bootstrap sites
const boot = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/dashboard-bootstrap.module.js'), 'utf8');
const auth = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/nbd-auth.js'), 'utf8');
ok('dashboard + nbd-auth expose window.__NBD_APP_CHECK from initializeAppCheck',
  /window\.__NBD_APP_CHECK\s*=\s*initializeAppCheck/.test(boot)
  && /window\.__NBD_APP_CHECK\s*=\s*initializeAppCheck/.test(auth));

// Claude proxy App Check header (W114 AI enrichment needs this in prod)
ok('claude-proxy attaches X-Firebase-AppCheck',
  /X-Firebase-AppCheck/.test(CP) && /__NBD_APP_CHECK/.test(CP));

// Smart follow-up one-tap send
ok('SmartFollowup.executeSuggestion exists and uses NBDComms',
  /function executeSuggestion/.test(SF)
  && /NBDComms\.sendEmail/.test(SF)
  && /NBDComms\.sendSMS/.test(SF)
  && /executeSuggestion,/.test(SF));

ok('customer smart-followup panel uses executeSuggestion for SMS/email',
  /executeSuggestion/.test(PANEL)
  && /data-csf-draft/.test(PANEL));

// Wave: CRM loop complete (items 3–5, 9–10)
const PLH = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/portal-link-helpers.js'), 'utf8');
const CB = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/close-board.js'), 'utf8');
const AJP = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/ask-joe-proactive.js'), 'utf8');
const CTL = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/customer-tasks-ui.js'), 'utf8');
const ES = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/email_system.js'), 'utf8');
const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const IDX = fs.readFileSync(path.join(__dirname, '..', 'firestore.indexes.json'), 'utf8');
const SMSF = fs.readFileSync(path.join(__dirname, '..', 'functions/sms-functions.js'), 'utf8');
const EMF = fs.readFileSync(path.join(__dirname, '..', 'functions/email-functions.js'), 'utf8');
const AID = fs.readFileSync(path.join(__dirname, '..', 'docs/pro/js/customer-ai-drafts-panel.js'), 'utf8');

ok('PortalLinkHelpers SMS/email use NBDComms platform path',
  /NBDComms\.sendSMS/.test(PLH) && /NBDComms\.sendEmail/.test(PLH)
  && /nbd-portal-link-helpers-v2/.test(PLH));

ok('close-board deal send uses NBDComms',
  /NBDComms\.sendSMS/.test(CB) && /NBDComms\.sendEmail/.test(CB));

ok('EmailDrip Send now + buildStageEmail exist',
  /sendStageEmail/.test(SRC) && /buildStageEmail/.test(ES) && /sendStageNow/.test(SRC));

ok('Comm Log supports team companyId query for staff',
  /teamThread/.test(CTL) && /companyId/.test(CTL));

ok('email_log/sms_log rules allow company readers with same companyId',
  /match \/email_log/.test(RULES)
  && /isCompanyReader\(\) && sameCompanyAsResource\(\)/.test(RULES));

ok('indexes include leadId+companyId+date for both logs',
  /"collectionGroup": "email_log"[\s\S]{0,200}"companyId"/.test(IDX)
  && /"collectionGroup": "sms_log"[\s\S]{0,200}"companyId"/.test(IDX));

ok('server log writers stamp companyId',
  /companyId/.test(EMF) && /row\.companyId = companyId/.test(EMF)
  && /companyId/.test(SMSF));

ok('morning briefing injects SmartFollowup actions',
  /smart_followup/.test(AJP) && /SmartFollowup\.computeSuggestion/.test(AJP)
  && /enrichSuggestionAI/.test(AJP));

ok('AI draft send refreshes Comm Log + fires nbd:data-refreshed (smart-followup listens)',
  /loadCommunicationLog/.test(AID) && /nbd:data-refreshed/.test(AID)
  && /ai-draft-sent/.test(AID));

ok('SMS platform errors surface A2P/Twilio guidance',
  /A2P|Twilio/.test(SRC) && /nbd:sms-platform-error/.test(SRC));

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) {
  console.log('\nFailures:');
  fails.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
