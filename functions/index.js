/**
 * Firebase Cloud Functions — NBD Pro API Proxy (thin aggregator).
 *
 * Step 4c (2026-05-16): inline handlers extracted to functions/handlers/
 * to keep this file tractable. The single export contract that Firebase
 * deploy reads from `exports.*` is preserved — every Cloud Function name
 * that used to live in this file is still exported by name, either via
 * an explicit re-export of a handler module property, or via
 * `Object.assign(exports, require(...))` for sibling modules that
 * already owned their own exports.
 *
 * Where the inline handlers went:
 *   handlers/ai.js          — claudeProxy, publicVisualizerAI
 *   handlers/photo.js       — analyzeRoofPhoto, signImageUrl, imageProxy, setStorageCors
 *   handlers/admin.js       — getAdminAnalytics, backfillCustomerData,
 *                             auditCustomerDataIntegrity, createTeamMember,
 *                             updateUserRole, deactivateUser, listTeamMembers,
 *                             rotateAccessCodes
 *   handlers/auth.js        — onRepSignup, activateInvitedRep,
 *                             provisionE2ETestUser, cleanupE2ETestData
 *   handlers/migrations.js  — backfillAnalytics, migratePinsToKnocks
 *   handlers/integrations.js— integrationStatus, submitPublicLead
 *   handlers/portal.js      — validateAccessCode (the inline access-code
 *                             callable; NOT the sibling functions/portal.js)
 *   handlers/monitoring.js  — cspReport
 *   handlers/_shared.js     — CORS_ORIGINS, Claude budget consts +
 *                             helpers, requireTeamAdmin, normalizeRole,
 *                             normalizeEmail, parseAddress, reverseGeocode,
 *                             _generateE2EPassword, E2E_TEST_USER_EMAIL,
 *                             PROVISION_OWNER_EMAILS, INVITE_ALLOWED_ROLES,
 *                             TEAM_ROLES, LEGACY_ACCESS_CODES
 *
 * Sibling modules that already lived in their own files (portal.js,
 * stripe.js, push-functions.js, integrations/*, etc.) were NOT touched.
 *
 * SETUP:
 *   1. cd functions && npm install
 *   2. firebase functions:secrets:set ANTHROPIC_API_KEY
 *      (paste your sk-ant-... key when prompted)
 *   3. firebase deploy --only functions
 *
 * CLIENT USAGE:
 *   const result = await fetch('https://us-central1-nobigdeal-pro.cloudfunctions.net/claudeProxy', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer <firebase-id-token>' },
 *     body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, messages: [...] })
 *   });
 */

'use strict';

const admin = require('firebase-admin');
admin.initializeApp();

// Rate limiter: adapter module picks Upstash vs Firestore at call time
// based on NBD_RATE_LIMIT_PROVIDER + whether Upstash secrets are set.
// Falls back to the Firestore limiter automatically.
require('./integrations/upstash-ratelimit');
require('./integrations/sentry');

// B2: callableRateLimit + requirePaidSubscription + requireAuth
// live in functions/shared.js so every module gets the same
// implementation. Inlined copies across this file + portal.js +
// sms-functions.js have been removed.
require('./shared');

// ═══════════════════════════════════════════════════════════════
// STEP 4c — inline handlers re-exported from functions/handlers/*.
//
// Order doesn't matter for the export contract; we group thematically
// so audits like grep'ing for an export name land on a single line.
// ═══════════════════════════════════════════════════════════════

// AI proxies (Claude proxy + public homeowner visualizer)
const aiHandlers = require('./handlers/ai');
exports.claudeProxy        = aiHandlers.claudeProxy;
exports.publicVisualizerAI = aiHandlers.publicVisualizerAI;

// Photo / image (signed URLs, vision analysis, CORS bootstrap)
const photoHandlers = require('./handlers/photo');
exports.setStorageCors  = photoHandlers.setStorageCors;
exports.signImageUrl    = photoHandlers.signImageUrl;
exports.imageProxy      = photoHandlers.imageProxy;
exports.analyzeRoofPhoto = photoHandlers.analyzeRoofPhoto;

// Admin / team-management callables
const adminHandlers = require('./handlers/admin');
exports.getAdminAnalytics          = adminHandlers.getAdminAnalytics;
exports.auditCustomerDataIntegrity = adminHandlers.auditCustomerDataIntegrity;
exports.backfillCustomerData       = adminHandlers.backfillCustomerData;
exports.rotateAccessCodes          = adminHandlers.rotateAccessCodes;
exports.createTeamMember           = adminHandlers.createTeamMember;
exports.updateUserRole             = adminHandlers.updateUserRole;
exports.deactivateUser             = adminHandlers.deactivateUser;
exports.listTeamMembers            = adminHandlers.listTeamMembers;

// T-3: per-rep AI texting analytics (collectionGroup scan over ai_drafts).
const aiTextingStatsHandlers = require('./handlers/ai-texting-stats');
exports.getAiTextingStats          = aiTextingStatsHandlers.getAiTextingStats;

// Auth / identity triggers + callables
// NOTE: onRepSignup is in NBD_DEPLOY_SKIP_LIST per
// .github/workflows/firebase-deploy.yml — DO NOT remove its export.
// The skip-list is applied at deploy time, not at code time.
const authHandlers = require('./handlers/auth');
exports.onRepSignup          = authHandlers.onRepSignup;
exports.activateInvitedRep   = authHandlers.activateInvitedRep;
exports.provisionE2ETestUser = authHandlers.provisionE2ETestUser;
exports.cleanupE2ETestData   = authHandlers.cleanupE2ETestData;

// Owner-callable migrations (NOT the versioned admin runner — that
// stays in functions/migrations/runner.js, re-exported below).
const migrationsHandlers = require('./handlers/migrations');
exports.backfillAnalytics   = migrationsHandlers.backfillAnalytics;
exports.migratePinsToKnocks = migrationsHandlers.migratePinsToKnocks;

// Integration-facing endpoints (status readout + public lead ingest)
const integrationsHandlers = require('./handlers/integrations');
exports.integrationStatus = integrationsHandlers.integrationStatus;
exports.submitPublicLead  = integrationsHandlers.submitPublicLead;

// Inline access-code callable. Distinct from functions/portal.js
// (which owns createPortalToken / revokePortalToken /
// getHomeownerPortalView and is loaded below via Object.assign).
const portalHandlersInline = require('./handlers/portal');
exports.validateAccessCode = portalHandlersInline.validateAccessCode;

// Browser monitoring (CSP violation report sink)
const monitoringHandlers = require('./handlers/monitoring');
exports.cspReport = monitoringHandlers.cspReport;

// ═══════════════════════════════════════════════════════════════
// PUSH NOTIFICATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════
const pushFunctions = require('./push-functions');
Object.assign(exports, pushFunctions);

// ═══════════════════════════════════════════════════════════════
// EMAIL FUNCTIONS
// ═══════════════════════════════════════════════════════════════
const emailFunctions = require('./email-functions');
Object.assign(exports, emailFunctions);

// Public storm-history proxy for the /storm-report page (additive; no CRM coupling).
const stormReportFn = require('./storm-report');
Object.assign(exports, stormReportFn);

// Homeowner follow-up email when a /storm-report lead is captured (additive trigger).
const stormReportEmailFn = require('./storm-report-email');
Object.assign(exports, stormReportEmailFn);

// Text + email Joe the moment any public marketing lead lands (additive triggers).
const leadAlertFns = require('./lead-alert');
Object.assign(exports, leadAlertFns);

// Mirror each high-intent public lead into the tenant's CRM `leads` pipeline
// (Phase C, H-1 fix). Additive triggers; tenant-aware routing; idempotent.
const leadBridgeFns = require('./lead-bridge');
Object.assign(exports, leadBridgeFns);

// ═══════════════════════════════════════════════════════════════
// SMS FUNCTIONS
// ═══════════════════════════════════════════════════════════════
const smsFunctions = require('./sms-functions');
Object.assign(exports, smsFunctions);

// ═══════════════════════════════════════════════════════════════
// AUDIT LOG TRIGGERS (H-4)
// Loaded from a sibling module to keep index.js tractable.
// ═══════════════════════════════════════════════════════════════
const auditTriggers = require('./audit-triggers');
Object.assign(exports, auditTriggers);

// ═══════════════════════════════════════════════════════════════
// INTEGRATIONS — every adapter is a no-op when its secret is unset.
// Add more to functions/integrations/ and register them here.
// ═══════════════════════════════════════════════════════════════
const slackIntegration       = require('./integrations/slack');
const measurementIntegration = require('./integrations/measurement');
const esignIntegration       = require('./integrations/esign');
const parcelIntegration      = require('./integrations/parcel');
const hailIntegration        = require('./integrations/hail');
const calcomIntegration      = require('./integrations/calcom');
const hailCron               = require('./integrations/hail-cron');
const complianceIntegration  = require('./integrations/compliance');
const deviceAlertIntegration = require('./integrations/device-alert');
const emailQueueWorker       = require('./integrations/email-queue-worker');
const voiceMemoIntegration   = require('./integrations/voice-memo');
const voiceIntelligenceIntegration = require('./integrations/voice-intelligence');
// W129: NBD Whisper unified dictate (transcribe + clean/summarize/extract-tasks)
const dictateIntegration     = require('./dictate');
// Phase B.2 — Storm Briefing automation (rep-facing companion to the
// customer SMS pipeline). Fires once per unique alertId via Firestore
// trigger + atomic sentinel dedup. See functions/integrations/storm-
// briefing.js for the call-order scoring formula.
const stormBriefingIntegration = require('./integrations/storm-briefing');
Object.assign(exports, slackIntegration);
Object.assign(exports, measurementIntegration);
Object.assign(exports, esignIntegration);
Object.assign(exports, parcelIntegration);
Object.assign(exports, hailIntegration);
Object.assign(exports, calcomIntegration);
Object.assign(exports, hailCron);
Object.assign(exports, complianceIntegration);
Object.assign(exports, deviceAlertIntegration);
Object.assign(exports, emailQueueWorker);
Object.assign(exports, voiceMemoIntegration);
Object.assign(exports, voiceIntelligenceIntegration);
Object.assign(exports, dictateIntegration);
Object.assign(exports, stormBriefingIntegration);

// ═══════════════════════════════════════════════════════════════
// HOMEOWNER PORTAL (createPortalToken, revokePortalToken,
// getHomeownerPortalView) — extracted to functions/portal.js
// (L-03). portal.js is self-contained: it imports admin, secrets,
// and the rate-limit adapter directly. Loading + Object.assign here
// preserves the existing Firebase-deploy export shape, so no CI
// workflow change is needed.
// ═══════════════════════════════════════════════════════════════
const portalFunctions = require('./portal');
Object.assign(exports, portalFunctions);

// Signatures PR4/5: canvas remote signing (doc_sign_tokens + public
// homeowner endpoints). Same token-auth model as portal.js.
const remoteSigningFunctions = require('./remote-signing');
Object.assign(exports, remoteSigningFunctions);

// L-03 cont.: Stripe handlers (createCheckoutSession, stripeWebhook,
// createCustomerPortalSession, getSubscriptionStatus,
// createStripePaymentLink, invoiceWebhook) live in functions/stripe.js.
// Extracted verbatim; see `git log --follow functions/stripe.js`.
const stripeFunctions = require('./stripe');
Object.assign(exports, stripeFunctions);

// Automated Firestore daily backup + retention. No deploy infra
// required beyond a one-time bucket + IAM setup documented in
// functions/firestore-backup.js. Both functions are scheduled-only.
const firestoreBackup = require('./firestore-backup');
Object.assign(exports, firestoreBackup);

// ── Verification Functions (SMS OTP + Lead Notifications) ──
const verifyFunctions = require('./verify-functions');
Object.assign(exports, verifyFunctions);

// ── Audit log triggers ──
const auditLog = require('./audit-log');
Object.assign(exports, auditLog);

// ═══════════════════════════════════════════════════════════════
// MIGRATIONS — versioned runner + scheduled tick
// see functions/migrations/runner.js
// ═══════════════════════════════════════════════════════════════
const _migrations = require('./migrations/runner');
exports.runMigrations  = _migrations.runMigrations;
exports.migrationsTick = _migrations.migrationsTick;

// ═══════════════════════════════════════════════════════════════
// IMAGE PIPELINE — Storage onObjectFinalized trigger that writes
// 200 / 600 / 1600 px WebP variants for every photo upload, then
// stamps the photo doc with `urls: { thumb, med, full }` so the
// CRM render code can switch on `<img srcset>`.
// see functions/image-pipeline.js
// ═══════════════════════════════════════════════════════════════
const _imagePipeline = require('./image-pipeline');
exports.onPhotoUploaded = _imagePipeline.onPhotoUploaded;

// ═══════════════════════════════════════════════════════════════
// SHARE SSR — server-rendered preview at /share/:token. Renders
// a static HTML page with og: + twitter: meta so iMessage /
// Messenger / WhatsApp / Facebook show a real preview card when
// Joe SMSes the link to a homeowner. Hands off to
// /pro/portal.html for the rich client-side full view.
// see functions/share-ssr.js
// ═══════════════════════════════════════════════════════════════
const _shareSSR = require('./share-ssr');
exports.shareSSR = _shareSSR.shareSSR;

// ═══════════════════════════════════════════════════════════════
// ABANDONED FUNNEL RECOVERY — /estimate partial-state + hourly sender
// ═══════════════════════════════════════════════════════════════
//
// Re-exports from functions/funnel-recovery.js:
//   - saveFunnelProgress (onRequest) — client saves partial state
//   - runAbandonRecovery (onSchedule) — hourly recovery email sender
//
// Ships DRY-RUN by default. Set FUNNEL_RECOVERY_ENABLED=true on the
// runAbandonRecovery Cloud Run revision to go live.
const funnelRecovery = require('./funnel-recovery');
exports.saveFunnelProgress = funnelRecovery.saveFunnelProgress;
exports.runAbandonRecovery = funnelRecovery.runAbandonRecovery;

// ═══════════════════════════════════════════════════════════════
// WEEKLY DIGEST EMAIL — Wave 16
// ═══════════════════════════════════════════════════════════════
// Scheduled Mon 7am ET. Sends each rep a recap of the previous 7
// days (new leads, won deals + revenue, lost deals, active pipeline,
// top 5 new leads). Per-user opt-out via users/{uid}.
// weeklyDigestEnabled === false. E2E test accounts always skipped.
//
// Ships DRY-RUN by default. Set WEEKLY_DIGEST_ENABLED=true on the
// weeklyDigest Cloud Run revision to go live.
const weeklyDigest = require('./weekly-digest');
exports.weeklyDigest = weeklyDigest.weeklyDigest;

// ═══════════════════════════════════════════════════════════════
// DORMANT LEAD NUDGE — Wave 27
// ═══════════════════════════════════════════════════════════════
// Scheduled Wednesday 8am ET. Companion to weeklyDigest. Finds
// leads stuck >30 days at non-terminal stages and emails the rep
// a focused list with click-through links to each customer's page.
// Wednesday timing gives the rep two business days to act before
// the week's gone.
//
// Per-user opt-out via users/{uid}.dormantNudgeEnabled === false.
// E2E test accounts always skipped. Skipped when user has nothing
// dormant — empty inbox is not the goal.
//
// Ships DRY-RUN by default. Set DORMANT_NUDGE_ENABLED=true on the
// dormantLeadNudge Cloud Run revision to go live.
const dormantLeads = require('./dormant-leads');
exports.dormantLeadNudge = dormantLeads.dormantLeadNudge;

// ═══════════════════════════════════════════════════════════════
// PRINT RENDER ENGINE — server-side Puppeteer PDF generation
// ═══════════════════════════════════════════════════════════════
//
// D-1: Replaces every html2canvas+jsPDF "screenshot" PDF in the
// platform with real Chromium-rendered vector PDFs. One template
// registry, one shared design system, real PDF fonts, native page
// breaks, multi-page running headers/footers.
//
// Client calls `renderPdf({ template, payload, filename })` →
// returns `{ url, path, filename, bytes, timing }`. The URL is a
// signed Storage read URL good for 7 days.
//
// Templates whitelisted in functions/render-pdf.js TEMPLATES map.
// Pilot ships warranty; D-2..D-5 add inspection, estimate, photo
// report, invoice, contract, change order, receipt.
//
// Memory: 2GiB (Chromium needs real headroom for multi-page docs
// with photo galleries). minInstances:1 keeps one warm so reps
// don't see cold-start latency end-of-job.
const renderPdfMod = require('./render-pdf');
exports.renderPdf = renderPdfMod.renderPdf;

// ═══════════════════════════════════════════════════════════════
// ANNIVERSARY AUTO-TOUCH — daily 1-year customer touch nudge
// ═══════════════════════════════════════════════════════════════
//
// Daily 8am Eastern scan for customers whose install anniversary
// falls in the 360-380 day window. Writes an `anniversary_due`
// activity row on each match (the CRM bell catches it regardless
// of email mode) and emails the owning rep a morning digest with
// a drop-in SMS script + deep links to each customer record.
//
// We don't auto-send to the homeowner — TCPA / CAN-SPAM compliance
// on a 1-year-later message is outside the original transaction's
// consent. Rep stays in the loop and taps one button in the CRM
// to send the touch.
//
// Idempotent: writes lead.anniversaryTouchedAt after each successful
// email send so manual re-runs don't double-touch.
//
// Per-user opt-out: users/{uid}.anniversaryTouchEnabled === false.
// Ships DRY-RUN by default. Set ANNIVERSARY_TOUCH_ENABLED=true
// on the anniversaryAutoTouch Cloud Run revision to go live.
const anniversaryTouch = require('./anniversary-touch');
exports.anniversaryAutoTouch = anniversaryTouch.anniversaryAutoTouch;

// ═══════════════════════════════════════════════════════════════
// REFERRAL CAPTURE — public POST from /refer.html
// ═══════════════════════════════════════════════════════════════
//
// Past customer shares a link (?ref=NBD-0001) with a friend; friend
// fills out /refer.html; this endpoint creates a new lead on the
// source customer's rep's book with referredByLeadId / customerId /
// Name fields populated, writes a `referral_sent` activity on the
// source customer's lead, and notifies the rep via /notifications.
//
// Anti-spam: per-IP rate limit (5/10min) and per-source-customer cap
// (10 referrals/24h). Phone+email validation; at least one required.
// No portal token needed — customerId is public and the friend self-
// identifies in the form.
const referrals = require('./referrals');
exports.submitReferral = referrals.submitReferral;

// ═══════════════════════════════════════════════════════════════
// VISUALIZER IMAGE GENERATION — Gemini 2.5 Flash Image
// ═══════════════════════════════════════════════════════════════
//
// Real AI-edited image of the user's home (replaces the old canvas
// color-filter fake "visualization"). ~$0.02-$0.04 per call.
//
// Ships DISABLED by default. Set VISUALIZER_IMAGEGEN_ENABLED=true on
// the visualizerImageGen Cloud Run revision to go live (requires the
// GOOGLE_AI_API_KEY secret populated first).
const visualizerImageGen = require('./visualizer-image-gen');
exports.visualizerImageGen = visualizerImageGen.visualizerImageGen;

// ═══════════════════════════════════════════════════════════════
// GOOGLE REVIEWS — Places API proxy with 6-hour Firestore cache
// ═══════════════════════════════════════════════════════════════
//
// Public onRequest endpoint. Keeps the Places API key server-side,
// serves cached review data to /review and any embedded widgets.
// See functions/google-reviews.README.md for setup.
const googleReviews = require('./google-reviews');
exports.getGoogleReviews = googleReviews.getGoogleReviews;

// Photo-vision classifier (Phase 3 of the photo system rebuild).
// Single-photo Claude Vision call with $10/lead + $50/uid-month caps
// and sha256(url) cache. Surfaces suggestions in photo.aiSuggestion
// for the Review UI (Phase 4) to render as 1-tap-accept chips.
const photoVision = require('./photo-vision');
exports.analyzePhotoVision = photoVision.analyzePhotoVision;

// Server-side plan-usage tracking (Audit A follow-up, Batch 3 of the
// audit-driven rollups). Closes the KNOWN GAP where client-side
// trackUsage in billing-gate.js silently 403'd because rules block
// client writes to subscriptions/{uid}. Now atomic + cross-device.
const billing = require('./billing');
exports.trackUsage = billing.trackUsage;

// Customer-side audit log (audit batch 7). Token-validated event
// capture so the rep can see exactly which photos / estimates the
// homeowner opened and when — useful at adjuster-dispute time.
const customerAudit = require('./customer-audit');
exports.recordCustomerEvent = customerAudit.recordCustomerEvent;

// Daily health digest email (audit batch 12). Aggregates Vision spend,
// Stripe webhook activity, Anthropic token usage, and homeowner-portal
// engagement; drops into email_queue → emailQueueWorker delivers.
// Gated on HEALTH_DIGEST_ENABLED env var ('true' to enable).
const healthDigest = require('./health-digest');
exports.healthDigestCron = healthDigest.healthDigestCron;
