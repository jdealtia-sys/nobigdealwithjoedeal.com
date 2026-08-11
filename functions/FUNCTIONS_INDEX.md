# NBD Pro — Cloud Functions Taxonomy

Single canonical index of every export from `functions/`. Refreshed 2026-08-11 by re-enumerating `require('./index.js')` (184 exported keys = **165 deployed Cloud Functions + 19 helper/test-only exports**; 7 dead exports retired 2026-08-11 — sendEstimateEmail, sendDripEmail, triggerProcessRecording, reprocessRecording, auditCustomerDataIntegrity, backfillCustomerData, migratePinsToKnocks (dead-surface lane, Jo-approved; console deletion queued in WEEKLY_CADENCE); the 2026-08-05 count of 189 predated Swath's +3 (#1193) and CL8's −1 `sendTeamInviteEmail` retirement (#1190)). A CI tripwire (tests/smoke/dashboard.test.js "every index.js export appears in FUNCTIONS_INDEX") now fails when an export is added without a row here — the 2026-07-04→08-05 gap was 21 undocumented exports, including the whole Stripe Connect + seat-billing money path.

Classification matters because:
- **Admin** functions must enforce `request.auth.token.role === 'admin'` (or `requireAuth({ adminOnly: true })` for `onRequest`). If one silently loses that gate, the smoke test below catches it.
- **Public** functions intentionally accept unauthenticated traffic (Stripe webhook, portal token POST, public lead form). They must compensate with signature verification, rate limiting, or token-bound access.
- **Rep** functions are the normal client surface — App Check + auth required, owner-scoped reads/writes.
- **Background/trigger** functions don't take client traffic; they fire on Firestore writes, Storage uploads, or scheduled cron.

Blanket posture note (re-verified 2026-08-05): **every `onCall` export sets `enforceAppCheck: true`** — no exceptions. `onRequest` endpoints do NOT carry the option any more: `enforceAppCheck` is silently ignored on `onRequest` (honoured only inside `onCall` — vendored SDK `lib/v2/providers/https.js`), so the dead config was removed 2026-08-02 (#1170). Authed `onRequest` endpoints gate on ID-token verification + rate limits in the handler body; public ones on signatures/tokens/rate limits per the PUBLIC table.

If you add a new export, list it here so the next audit doesn't have to re-derive the picture.

---

## REP (normal client surface — App Check + Firebase auth, owner-scoped)

| Export | Type | Purpose |
|---|---|---|
| `claudeProxy` | onRequest | Server-side Anthropic relay with daily budget reservation (Bearer ID token); rate-limited per-uid + per-IP via `guardHttp` (rate-limit-policy.js pilot, 2026-08-10) |
| `signImageUrl` | onRequest | Signed Storage URL for owner/manager-scoped photo reads |
| `imageProxy` | onRequest | **Deprecated 410 stub** (H-01 stored-XSS fix) — fails loudly for stale clients; "safe to delete outright after 7+ days of zero calls in Cloud Logs" |
| `analyzeRoofPhoto` | onRequest | Vision over a single photo (rep view) |
| `analyzePhotoVision` | onCall | Per-photo Claude Vision classifier ($10/lead + $50/uid-month caps, sha256 cache) |
| `extractReceiptData` | onCall | Receipt OCR — Claude-vision extraction into structured expense-form fields |
| `validateAccessCode` | onCall | Login flow — exchanges access code for trial access; rate-limited per-IP + per-uid via `guardCallable` (rate-limit-policy.js pilot, 2026-08-10) |
| `activateInvitedRep` | onCall | Team-invite acceptance (legacy access-code path) |
| `claimInvite` | onCall | Pillar 1 phase 3 — claim a team invite on first dashboard load (replaces the never-deployable onRepSignup blocking trigger) |
| `mintOwnerClaims` | onCall | Stamps `{ owner: true, role: 'admin' }` on the founder accounts in `handlers/_shared.js` `OWNER_EMAILS` (the single server-side owner list); called by nbd-auth.js at login when the owner claim is missing |
| `createCompany` | onCall | Pillar 1 phase 2 — self-serve tenant provisioning (companies/{uid} + companyProfile seed + owner claims) |
| `setSiteSlug` | onCall | Pillar 5 — tenant sets a human slug for their public microsite (validated + reserved-word list) |
| `createPortalToken` | onCall | Mints a portal-share token for a lead |
| `revokePortalToken` | onCall | Revokes outstanding portal tokens |
| `replyToPortalMessage` | onCall | Rep reply to a homeowner message |
| `createSignRequest` | onCall | Remote signing — rep mints a doc_sign_token + emails the homeowner the sign link |
| `createDealAcceptToken` | onCall | Close Board — rep mints a deal_accept_token for a deal room they own |
| `createReportShareToken` | onCall | Rep mints a no-login view link for a saved inspection report |
| `trackUsage` | onCall | Plan-usage increment (atomic, server-side) |
| `lookupParcel` | onCall | Parcel lookup w/ 90-day cache — Regrid (default) or Swath per `NBD_PARCEL_PROVIDER`, other provider is the fallback |
| `requestMeasurement` | onCall | Hover / EagleView / Nearmap measurement request |
| `sendEstimateForSignature` | onCall | BoldSign embedded-signing flow (was listed here as `sendForSignature` — actual export name is `sendEstimateForSignature`) |
| `getHailHistory` | onCall | Storm history within radius — NOAA (default) / HailTrace / Swath per `NBD_HAIL_PROVIDER`, NOAA fallback (routes through shared `lookupHail`) |
| `getSwathReport` | onCall | Swath per-property exposure report — quote-first (`confirm:true` required to spend credits), **admin/company_admin gate in-body**, 30-day Firestore cache (integrations/swath.js) |
| `getSwathUsage` | onCall | Swath month-to-date credit meter — **admin/company_admin gate in-body**, 10/hr limiter (integrations/swath.js) |
| `transcribeVoiceMemo` | onCall | Deepgram audio transcription |
| `dictate` | onCall | Whisper unified transcribe + AI cleanup |
| `renderPdf` | onCall | Server-side Puppeteer PDF render (warranty/inspection/estimate/etc.), 2GiB + minInstances:1 |
| `sendVerificationCode` | onCall | SMS OTP via Twilio Verify (per-phone attempt cap) |
| `verifyCode` | onCall | Verifies a Twilio Verify OTP |
| `notifyNewLead` | onCall | Email + SMS to Joe when a new lead comes in |
| `registerDeviceFingerprint` | onCall | Device-alert integration — registers a device fingerprint, Slack-pings on anomaly |
| `getAiTextingStats` | onCall | T-3 per-rep AI texting analytics (collectionGroup scan over ai_drafts) |
| `previewAiPersona` | onCall | T-4 live persona preview for Settings → AI Texting |
| `resolveAddress` | onCall | D2D address engine — geocode/normalize a knocked address (handlers/geocode.js) |
| `attachStormProof` | onCall | Attaches hail/wind history proof to the caller's lead (handlers/storm-proof.js) |
| `getAdjusterTacticBoard` | onCall | Adjuster tactic board read for the caller's claim (handlers/adjuster-board.js, #1137) |
| `reserveCompanyPrefix` | onCall | Pillar 1 — reserves the tenant's unique customer-ID doc prefix (handlers/provisioning.js, claims-scoped) |
| `sendEmail` | onRequest | Generic Resend email send — ID-token verified + 60/hr/IP rate limit |
| `sendSMS` | onRequest | Twilio SMS send — ID-token verified, paid-subscription gate, 30/hr/IP + 100/day/uid |
| `sendD2DSMS` | onRequest | Door-to-door SMS send — ID-token verified + rate limits |
| `createCheckoutSession` | onRequest | Stripe Checkout session (ID-token verified) |
| `createCustomerPortalSession` | onRequest | Stripe billing-portal session (ID-token verified) |
| `getSubscriptionStatus` | onRequest | Reads caller's Stripe subscription status (ID-token verified) |
| `createStripePaymentLink` | onRequest | Stripe payment link for invoices (ID-token verified) |

## PUBLIC (no Firebase auth, compensating controls)

| Export | Type | Compensating control |
|---|---|---|
| `stripeWebhook` | onRequest | Stripe signature verification + idempotency via `stripe_events/{eventId}` |
| `invoiceWebhook` | onRequest | Stripe signature verification (payment_intent.succeeded credit; phase-3 dispute auto-reversal + refund/decline visibility) |
| `esignWebhook` | onRequest | BoldSign webhook-secret verification |
| `measurementWebhook` | onRequest | Hover/EagleView webhook-secret verification |
| `calcomWebhook` | onRequest | Cal.com HMAC verification |
| `swathWebhook` | onRequest | Swath `storm.verified` alerts — Stripe-style HMAC (`t=…,v1=…`, ±300s replay window, fails closed when secret unset), idempotent `storm_events/{id}` ingest + Slack ping |
| `incomingSMS` | onRequest | Twilio inbound-SMS webhook — X-Twilio-Signature verified (also feeds T-1 AI-texting draft generation) |
| `submitPublicLead` | onRequest | Turnstile token + per-IP rate limit (IPv6 /64) + honeypot + M-04 field allowlist (NO App Check — onRequest can't enforce it, see posture note) |
| `publicVisualizerAI` | onRequest | 5/hr/IP, model locked to Haiku, server-owned prompt, 1.5 MB image cap (NO App Check — see posture note) |
| `publicFunnelAI` | onRequest | Per-IP rate limit; replaces the open `nbd-ai-proxy` CF Worker; Haiku forced, tokens capped, text-only (NO App Check — see posture note) |
| `visualizerImageGen` | onRequest | FLUX.1 Kontext Max via Replicate (~$0.08/call); gated by `VISUALIZER_IMAGEGEN_ENABLED` (default OFF), 15/hr/IP |
| `saveFunnelProgress` | onRequest | Anonymous funnel-step persistence (rate-limited; feeds runAbandonRecovery) |
| `getHomeownerPortalView` | onRequest | Portal token validation, IP rate-limit, length check |
| `getEstimateForView` | onRequest | Portal token validation; stamps first/last-viewed engagement fields |
| `uploadHomeownerPhoto` | onRequest | Portal token; 10 photos/lead/day, 8 MB cap, jpeg/png/webp only |
| `sendPortalMessage` | onRequest | Portal token; 30 msgs/token/day, 2000-char cap, per-IP limit |
| `getPortalMessages` | onRequest | Portal token; latest 50 messages, marks rep messages read |
| `requestCallback` | onRequest | Portal token; 3 requests/token/day, 280-char note cap, slot whitelist |
| `submitCustomerRating` | onRequest | Portal token; one rating per lead lifetime (write-once), star whitelist |
| `recordCustomerEvent` | onRequest | Portal-token-validated homeowner audit-event capture (which photos/estimates were opened) |
| `getSignDocument` | onRequest | Remote signing: ~120-bit single-use token, 7-day expiry, per-IP rate limit |
| `submitSignature` | onRequest | Remote signing: burns token atomically, signed-HTML size cap |
| `getDealRoom` | onRequest | Deal acceptance: ~120-bit single-use token, 14-day expiry, served same-origin via `/deal/**` rewrite |
| `submitDealAcceptance` | onRequest | Deal acceptance: burns token, records tier + signature, notifies rep |
| `getSharedReport` | onRequest | Report share: ~120-bit REUSABLE token, 30-day default expiry, per-IP rate limit (view-only) |
| `getPublicSiteConfig` | onRequest | Pillar 5 tenant-microsite config read — strict public-marketing whitelist, active-tenant check, rate-limited |
| `submitReferral` | onRequest | Per-IP (5/10min) + per-source-customer (10/24h) rate limit, phone/email validation |
| `stormReport` | onRequest | Public IEM storm-history proxy for /storm-report — server-side yearly chunking + Firestore cache (no API key needed) |
| `getGoogleReviews` | onRequest | Cached Google Places reviews proxy (6-hour Firestore cache; keeps API key server-side); 60/min/IP via `guardHttp` (2026-08-10 — previously the ONLY unlimited public endpoint) |
| `shareSSR` | onRequest | Server-rendered share-link preview HTML with og:/twitter: meta (token-authed lookup) |
| `cspReport` | onRequest | Logs only, no side effects; 60/min/IP (boolean honored 2026-08-10 — was advisory-only) |
| `stripeConnectWebhook` | onRequest | Stripe **Connect** webhook — signature verified (`STRIPE_CONNECT_WEBHOOK_SECRET`), fails closed, dedupes, drops livemode mismatches (handlers/stripe-connect.js) |
| `onRepSignup` | beforeUserCreated | Auth blocker — **exported but never deployed**: it is the sole entry in `NBD_DEPLOY_SKIP_LIST` (.github/workflows/firebase-deploy.yml). Do NOT remove the export; the skip is applied at deploy time. |

## ADMIN (role check required)
Verified by the smoke test "every admin function in FUNCTIONS_INDEX has a role/admin gate" which greps the function body for one of: `role === 'admin'`, `adminOnly: true`, `requireTeamAdmin(`, `isAdmin()`.

| Export | Type | Auth gate | Notes |
|---|---|---|---|
| `setStorageCors` | onRequest | `requireAuth({ adminOnly: true })` | One-time CORS config |
| `integrationStatus` | onCall | `claims.role === 'admin'` | Integration health check (depends on every integration secret) |
| `getAdminAnalytics` | onCall | `claims.role === 'admin'` | Cross-tenant analytics |
| `rotateAccessCodes` | onCall | `requireTeamAdmin` | Access-code rotation |
| `createTeamMember` | onCall | `requireTeamAdmin` (admin / company_admin / owner) | Team management |
| `createTeamInvite` | onCall | `requireTeamAdmin` | Pillar 4 — server-side invite create so plan seat limits hold |
| `updateUserRole` | onCall | `requireTeamAdmin` | Team management |
| `deactivateUser` | onCall | `requireTeamAdmin` | Team management |
| `removeMember` | onCall | `requireTeamAdmin` + `callerMayManageTarget` | Removes roster doc AND strips companyId/role claims + revokes tokens (fixes claim-persistence hole of client-side delete) |
| `listTeamMembers` | onCall | `requireTeamAdmin` | Team management |
| `assignSeats` | onCall | `requireTeamAdmin` | Pillar 4 — seat assignment across the roster (handlers/invites.js) |
| `setCompanySeatCount` | onCall | `requireTeamAdmin` (**ownerOnly** — non-owner company_admins refused) | Buys/sets the paid seat count via Stripe; seat money is the bill-payer's call alone (handlers/seats.js) |
| `createConnectAccount` | onCall | `requireTeamAdmin` | Stripe Connect — creates the tenant's Express account (handlers/stripe-connect.js) |
| `createConnectOnboardingLink` | onCall | `requireTeamAdmin` | Stripe Connect — mints the hosted-onboarding link |
| `createConnectDashboardLink` | onCall | `requireTeamAdmin` | Stripe Connect — mints the Express-dashboard login link |
| `getConnectStatus` | onCall | `requireTeamAdmin` | Stripe Connect — reads capability/charges state (fail-closed bools) |
| `reverifyCompanyKnocks` | onCall | `requireTeamAdmin` | D2D — re-geocodes/verifies the company's knock addresses (540s sweep) |
| `convertUnmatchedSms` | onCall | `isOwnerCaller` or `role === 'admin'` | Turns an `unmatched_sms` triage row into a real lead + AI draft (handlers/inbound-sms-convert.js) |

Two further exports are admin-gated but deliberately NOT rows in the table above, because the drift-guard smoke test's pattern-window heuristic can't see their gates and would fail CI:

- **adminAI** (onRequest, handlers/ai.js) — verifies a Firebase ID token then requires `ADMIN_AI_ROLES.has(role)` with roles {admin, company_admin, manager}. Claude relay for the admin tools (project-codex assistant, vault session-parsers); model forced to Haiku, 60k-char prompt / 2048-token caps; per-uid + per-IP rate limits via `guardHttp` (rate-limit-policy.js, 2026-08-10).
- **runMigrations** (onCall, migrations/runner.js) — `req.auth?.token?.role !== 'admin'` → permission-denied. Listed in the MIGRATIONS section below. (The smoke test doesn't scan `functions/migrations/`.)

## REP UTILITY (authed but expensive — strong rate limits compensate for lack of admin gate)
These operate on the **caller's own data** (owner-scoped Firestore queries inside the function body), so the rate limit is the real protection, not a role check. If a future change widens their blast radius beyond the caller, they should move to ADMIN.

| Export | Type | Rate limit | Notes |
|---|---|---|---|
| `backfillAnalytics` | onCall | 1 / 10 min / uid | Backfills computed fields on caller's leads |

## E2E TEST HELPERS (deployed, but env-gated)
| Export | Type | Gate |
|---|---|---|
| `provisionE2ETestUser` | onCall | E2E env gate + owner claim (`token.owner === true`) with deprecated `OWNER_EMAILS` fallback |
| `cleanupE2ETestData` | onCall | E2E env gate — deletes only the fixed E2E test account's data |

## GDPR / MIGRATIONS (M-01 / M-02)
| Export | Type | Auth gate | Notes |
|---|---|---|---|
| `exportMyData` | onCall | Self (authenticated uid) | GDPR Article 20 export |
| `requestAccountErasure` | onCall | Self; 3/24h/uid rate limit | Step 1 of two-step erasure: mints 24h confirmation token, emails account-on-file |
| `confirmAccountErasure` | onRequest | Emailed token (POST body) + per-IP/per-uid rate limits | Step 2: verifies token, cascade delete + Auth disable. GET serves a static confirm page (60/min/IP). Was listed as onCall — it is onRequest. |
| `runMigrations` | onCall | `role === 'admin'` (see ADMIN note) | Manual versioned-migration trigger (was mislabeled "scheduler-triggered" in the previous index) |
| `migrationsTick` | scheduled (every 24h) | n/a (server-only) | Idempotent daily migration cron (also listed in SCHEDULED) |

## SCHEDULED CRONS (server-only, no client traffic) — 24
| Export | Schedule | Purpose |
|---|---|---|
| `weeklyDigest` | Mon 07:00 ET | Rep recap of previous 7 days; opt-out `users/{uid}.weeklyDigestEnabled === false`; DRY-RUN unless `WEEKLY_DIGEST_ENABLED=true` |
| `dormantLeadNudge` | Wed 08:00 ET | Leads stuck >30 days at non-terminal stages → rep email; opt-out per user; DRY-RUN unless `DORMANT_NUDGE_ENABLED=true` |
| `anniversaryAutoTouch` | daily 08:00 ET | 1-year install-anniversary digest + `anniversary_due` activity write (rep sends the touch, not us — TCPA); DRY-RUN unless `ANNIVERSARY_TOUCH_ENABLED=true` |
| `runAbandonRecovery` | hourly | Funnel-drop recovery email sender; DRY-RUN unless `FUNNEL_RECOVERY_ENABLED=true` |
| `dailyLeadDigest` | daily 07:00 ET | Summary of the last 24h of public leads |
| `leadFollowUpSweep` | every 3h | One follow-up email to 20-48h-old leads whose bridged CRM card is untouched |
| `stormWatch` | every 30 min | NWS/IEM Local Storm Reports watcher; always alerts Joe; subscriber texting gated by `STORM_TEXT_ENABLED` |
| `checkStormAlerts` | every 30 min | (sms-functions.js) Polls NWS **weather alerts** for subscriber zips → Twilio SMS. Distinct from `stormWatch`, which polls storm *reports* |
| `monthlyMarketingReport` | 1st of month 07:00 ET | Marketing rollup email |
| `healthDigestCron` | daily 14:00 UTC | Ops health digest (Vision spend, Stripe webhooks, Anthropic tokens, portal engagement); gated on `HEALTH_DIGEST_ENABLED` |
| `emailQueueWorker` | every 1 min | Drains `email_queue/` via Resend |
| `hailMatchCron` | daily 09:00 | HailTrace/NOAA storm-match sweep + Slack notify — deliberately never uses the Swath provider (a 500-lead sweep would burn the credit budget; see hail-cron.js) (was listed as `hailCron` — actual export name is `hailMatchCron`) |
| `onAppointmentReminder` | every 15 min | Push notification 15 min before appointments |
| `onFollowUpDue` | daily 08:00 | Push notification for due follow-ups |
| `migrationsTick` | every 24h | Idempotent versioned-migration runner tick |
| `auditLogRetentionCron` | daily 03:30 | Prunes `audit_log` rows past retention (keys on `ts`) |
| `recordingRetentionCron` | daily 05:00 | Prunes aged voice-intelligence recordings |
| `dailyFirestoreBackup` | daily 03:15 ET | Full Firestore export to `gs://nobigdeal-pro-firestore-backups/YYYY-MM-DD/` (firestore-backup.js) |
| `firestoreBackupRetention` | daily 03:45 ET | Prunes backups older than 30 days (firestore-backup.js) |
| `nightlyFirestoreBackup` | daily 04:00 CT | **Second, overlapping** Firestore export (compliance.js "D5") to `gs://nobigdeal-pro-backups` — see Flags below |
| `enforceLapsedSeats` | daily 09:00 | Pillar 4 — deactivates members past their seat lapse grace window (lapse-enforcement.js) |
| `reviewRequestNudge` | daily 08:15 ET | Google-review request nudge emails for recently-won jobs (review-request-nudge.js) |
| `syncGbpReviews` | daily 06:00 ET | Pulls Google Business Profile reviews into the reviews widget cache (gbp-reviews-sync.js) |
| `monthlyOverheadAlertCron` | 1st of month 09:00 | Emails the overhead-vs-margin summary for the month just ended (monthly-overhead-alert.js) |

## FIRESTORE / STORAGE TRIGGERS (no direct client traffic) — 34 Firestore + 2 Storage
| Export | Watches | Purpose |
|---|---|---|
| `onPhotoUploaded` | Storage finalize (`nobigdeal-pro.appspot.com`) | 200/600/1600 px WebP variant pipeline; stamps `photo.urls` |
| `onAudioUploaded` | Storage finalize (`nobigdeal-pro.firebasestorage.app`) | Voice intelligence — recording → transcribe + analyze (was listed as `voiceIntelligenceTrigger`) |
| `onNewLead` | `leads/{leadId}` created | Push notification to assigned rep |
| `onClaimStageChange` | `leads/{leadId}` updated | Push notification on claim-stage transitions |
| `onAiDraftApproved` | `leads/{leadId}/ai_drafts/{draftId}` updated | Sends approved AI-drafted SMS via Twilio (pending→approved transition only; idempotent) |
| `estimateEmail` | `estimate_leads/{id}` created | Emails homeowner their estimate on `email_estimate_request`; LIVE by default (2026-07-18), `ESTIMATE_EMAIL_ENABLED=false` forces DRY-RUN |
| `stormReportEmail` | `inspect_leads/{leadId}` created | Homeowner follow-up email for /storm-report leads |
| `teamInviteEmail` | `companies/{companyId}/members/{memberId}` created | Sends the invite email when a roster invite doc is created |
| `leadAlertContact` / `leadAlertEstimate` / `leadAlertFreeRoof` / `leadAlertInspect` / `leadAlertStorm` | `contact_leads` / `estimate_leads` / `free_roof_entries` / `inspect_leads` / `storm_alert_subscribers` created | Text + email Joe the moment a public marketing lead lands |
| `leadBridgeContact` / `leadBridgeEstimate` / `leadBridgeFreeRoof` / `leadBridgeInspect` / `leadBridgeStorm` | same five collections | Mirror each high-intent public lead into the tenant's CRM `leads` pipeline (tenant-aware, idempotent) |
| `slack_onLeadWon` | `leads/{leadId}` written | Slack ping on won deal |
| `onReferralLeadWrite` | `leads/{leadId}` written | Referral-code redemption: attribute a redeemed `redeemReferralCode` to its referrer, then record the $200 bonus as OWED + notify the rep when the referred project reaches a closed stage (idempotent) |
| `slack_onStormAlert` | `storm_alerts_sent/{id}` created | Slack ping on storm alert |
| `slack_onAdminGrantAttempt` | `audit_log/{id}` created | Slack ping on admin-grant attempts (was collectively listed as `slackPing`, which no longer exists) |
| `stormBriefing_onAlertSent` | `storm_alerts_sent/{id}` created | Phase B.2 rep-facing storm briefing (call-order scoring; once per alertId via atomic sentinel) |
| `audit_users` / `audit_leads` / `audit_companies` / `audit_company_members` / `audit_access_codes` / `audit_subscriptions` | respective collections, written | H-4 canonical audit_log writers (PII-redacted compact diffs, stamp `ts` for retention). Was collectively listed as `auditTriggers` |
| `auditInvoices` | `invoices/{invoiceId}` written | audit-log.js — the only live writer left in that module (`invoices/*` is not covered by audit-triggers.js) |
| `auditUsers` / `auditCompanies` / `auditAccessCodes` / `auditSubscriptions` | (no-ops) | **Retained dead exports** from audit-log.js — superseded by `audit_*` on 2026-06-08. Kept because the name-scoped CI deploy cannot prune orphaned functions; deleting the exports would leave old double-writing revisions live. Remove via `firebase functions:delete ...` when prod access allows. |
| `onPortalMessageDraft` | `leads/{leadId}/portal_messages/{msgId}` created | T-series — AI reply draft for an inbound homeowner portal message (source:'homeowner' only; safe-dark when secret unset) |
| `voiceConsumer` | `leads/{leadId}/recordings/{recordingId}` written | Turns a completed call recording's structured summary into lead field updates (voice-consumer.js) |
| `onEstimateViewedStrike` | `customerAuditEvents/{eventId}` created | Engagement scoring — estimate-view strike counter for the almost-there widget (customer-audit.js) |

## TEST-ONLY / HELPER EXPORTS (19 — NOT Cloud Functions, never deployed)
Exported for unit tests or internal reuse; they carry no `__endpoint` and Firebase deploy ignores them.

- `_test` (storm-watch.js and integrations/storm-briefing.js each export one), `_constants`, `_bridgeCollections` (lead-bridge.js)
- `lookupHail` — plain async hail-history helper (integrations/hail.js) shared by `getHailHistory` + `attachStormProof` (handlers/storm-proof.js); not a Cloud Function. (2026-08-06 correction: previously said "storm briefing", but storm-briefing.js never imports it.)
- Swath helpers `fetchSwathHail` / `querySwathProperty` / `verifySwathSignature` / `_test` — module exports of integrations/swath.js consumed by hail.js, parcel.js, and tests/smoke/swath-signature.test.js. Deliberately NOT mounted on index.js (it mounts the three Swath Cloud Functions selectively).
- Voice-intelligence internals: `_VoiceError`, `_analyzeTranscript`, `_checkBudget`, `_checkVerbalConsent`, `_getCompanyContext`, `_incrementVoiceUsage`, `_parseAudioPath`, `_processRecording`, `_transcribeAudio`
- Push-notification helpers (plain async functions): `sendTeamNotification`, `sendStreakNotification`, `sendCustomNotification`
- Slack helper: `postSlack`
- **Dead keys**: `sendPushNotification` and `getUserFCMTokens` are exported from push-functions.js as `undefined` (its `module.exports` references `exports.sendPushNotification` / `exports.getUserFCMTokens`, which are never assigned). Harmless to deploy, but they should be removed from the export map.

---

## Flags / ambiguities (2026-07-04 refresh)

1. **Two overlapping Firestore backup pipelines**: `dailyFirestoreBackup` + `firestoreBackupRetention` (functions/firestore-backup.js, 03:15/03:45 ET → `gs://nobigdeal-pro-firestore-backups`, 30-day retention) AND `nightlyFirestoreBackup` (integrations/compliance.js "D5", 04:00 CT → `gs://nobigdeal-pro-backups`, no retention job). Both are deployed. Consolidation candidate.
2. **`checkStormAlerts` vs `stormWatch`** both run every 30 minutes in the storm domain but are distinct: `checkStormAlerts` polls NWS *forecast alerts* per subscriber zip; `stormWatch` polls IEM *Local Storm Reports* (observed hail/wind/tornado).
3. **`verify-functions-company-enhancement.js`** defines its own `notifyNewLead` but is **not required by index.js** — dead file; the deployed `notifyNewLead` comes from verify-functions.js.
4. `getRecording` (listed in the 2026-05-13 index) is no longer exported; voice-intelligence's manual kicks (`triggerProcessRecording` / `reprocessRecording`) were retired 2026-08-11. `dunningEmailQueue` and `voiceMemoTrigger` from the old index also no longer exist as exports.
5. ~~`enforceAppCheck: true` is set on many `onRequest` options~~ — **resolved 2026-08-02 (#1170)**: the option is silently ignored on `onRequest` (onCall-only in firebase-functions), so it was removed from every onRequest export. The handler-body gates (ID token / signature / rate limit) were always the real control and remain.

## Maintenance

Adding a new export?

1. Pick the category above and list it.
2. Admin-only exports MUST have one of:
   - `request.auth.token.role === 'admin'` check in the handler
   - `requireAuth(req, { adminOnly: true })` for `onRequest`
   - `requireTeamAdmin(...)` for team-scoped admin
3. The smoke test `admin functions enforce role check` (see `tests/smoke.test.js`) greps for that string in the function body. If you add an admin export without a check, CI will fail.
3b. A second smoke tripwire (`every index.js export appears in FUNCTIONS_INDEX`) fails CI whenever an export reachable from index.js — directly or via one level of `Object.assign(exports, require(...))` — has no mention in this file. Add the row in the same PR as the export.
4. Quick re-enumeration: `cd functions && GCLOUD_PROJECT=nobigdeal-pro FIREBASE_CONFIG='{"projectId":"nobigdeal-pro","storageBucket":"nobigdeal-pro.appspot.com"}' node -e "console.log(Object.keys(require('./index.js')).join('\n'))"` (exports with `__endpoint` are deployable functions; the rest are helpers).
