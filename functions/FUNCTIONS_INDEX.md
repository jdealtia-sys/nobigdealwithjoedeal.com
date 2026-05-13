# NBD Pro — Cloud Functions Taxonomy

Single canonical index of every export from `functions/`. Updated 2026-05-13 during the audit-driven rollup batch.

Classification matters because:
- **Admin** functions must enforce `request.auth.token.role === 'admin'` (or `requireAuth({ adminOnly: true })` for `onRequest`). If one silently loses that gate, the smoke test below catches it.
- **Public** functions intentionally accept unauthenticated traffic (Stripe webhook, portal token POST, public lead form). They must compensate with signature verification, rate limiting, or token-bound access.
- **Rep** functions are the normal client surface — App Check + auth required, owner-scoped reads/writes.
- **Background/trigger** functions don't take client traffic; they fire on Firestore writes, Storage uploads, or scheduled cron.

If you add a new export, list it here so the next audit doesn't have to re-derive the picture.

---

## REP (normal client callable, owner-scoped)
| Export | Type | Purpose |
|---|---|---|
| `claudeProxy` | onRequest | Server-side Anthropic relay with daily budget reservation |
| `signImageUrl` | onRequest | Signed Storage URL for owner/manager-scoped photo reads |
| `analyzeRoofPhoto` | onRequest | Vision over a single photo (rep view) |
| `validateAccessCode` | onCall | Login flow — exchanges access code for trial access |
| `activateInvitedRep` | onCall | Team-invite acceptance |
| `submitPublicLead` | onRequest | Public lead form (rate-limited, honeypot) |
| `createPortalToken` | onCall | Mints a portal-share token for a lead |
| `revokePortalToken` | onCall | Revokes outstanding portal tokens |
| `replyToPortalMessage` | onCall | Rep reply to a homeowner message |
| `uploadHomeownerPhoto` | onRequest | Homeowner uploads via portal (token-authed) |
| `analyzePhotoVision` | onCall | Per-photo Claude Vision classifier (cost-capped) |
| `trackUsage` | onCall | Plan-usage increment (atomic) |
| `lookupParcel` | onCall | Regrid parcel lookup w/ 90-day cache |
| `requestMeasurement` | onCall | EagleView / RoofRoof measurement request |
| `sendForSignature` | onCall | BoldSign embedded-signing flow |
| `getHailHistory` | onCall | HailTrace storm history within radius |
| `transcribeVoiceMemo` | onCall | Deepgram audio transcription |
| `dictate` | onCall | Whisper unified transcribe + AI cleanup |
| `getRecording` | onCall | Voice intel playback |
| `getGoogleReviews` | onRequest | Cached Google reviews proxy |
| `saveFunnelProgress` | onCall | Anonymous funnel-step persistence |
| `getEstimateForView` | onRequest | Homeowner estimate-view payload (token-authed) |
| `renderPdf` | onCall | Server-side Puppeteer PDF render (warranty/inspection/estimate/etc.) |

## PUBLIC (no auth, compensating controls)
| Export | Type | Compensating control |
|---|---|---|
| `stripeWebhook` | onRequest | Stripe signature verification + idempotency via `stripe_events/{eventId}` |
| `getHomeownerPortalView` | onRequest | Portal token validation, IP rate-limit, length check |
| `cspReport` | onRequest | Logs only, no side effects |
| `onRepSignup` | beforeUserCreated | Auth blocker — runs before user create |
| `shareSSR` | onRequest | Returns rendered share-link HTML (token-authed lookup) |

## ADMIN (role check required)
Verified by the smoke test "every admin function in FUNCTIONS_INDEX has a role/admin gate" which greps the function body for one of: `role === 'admin'`, `adminOnly: true`, `requireTeamAdmin(`, `isAdmin()`.

| Export | Type | Auth gate | Notes |
|---|---|---|---|
| `setStorageCors` | onRequest | `requireAuth({ adminOnly: true })` | One-time CORS config |
| `integrationStatus` | onCall | `claims.role === 'admin'` | Integration health check |
| `getAdminAnalytics` | onCall | `claims.role === 'admin'` | Cross-tenant analytics |
| `rotateAccessCodes` | onCall | `requireTeamAdmin` | Access-code rotation |
| `createTeamMember` | onCall | `requireTeamAdmin` (admin / company_admin / owner) | Team management |
| `updateUserRole` | onCall | `requireTeamAdmin` | Team management |
| `deactivateUser` | onCall | `requireTeamAdmin` | Team management |
| `listTeamMembers` | onCall | `requireTeamAdmin` | Team management |

## REP UTILITY (authed but expensive — strong rate limits compensate for lack of admin gate)
These were initially miscategorized as admin during the audit. They operate on the **caller's own data** (owner-scoped Firestore queries inside the function body), so the rate limit is the real protection, not a role check. If a future change widens their blast radius beyond the caller, they should move to ADMIN.

| Export | Type | Rate limit | Notes |
|---|---|---|---|
| `backfillAnalytics` | onCall | 1 / 10 min / uid | Backfills computed fields on caller's leads |
| `migratePinsToKnocks` | onCall | rate-limited | One-off migration on caller's data |
| `auditCustomerDataIntegrity` | onCall | rate-limited | Read-only audit of caller's leads |
| `backfillCustomerData` | onCall | rate-limited | Backfill on caller's data |
| `publicVisualizerAI` | onRequest | 5 / hour / IP | Public marketing endpoint, no auth |
| `provisionE2ETestUser` | onCall | E2E env gated | Test helper |
| `cleanupE2ETestData` | onCall | E2E env gated | Test helper |

## GDPR (M-01 / M-02 — self-callable or team admin)
| Export | Type | Auth gate | Notes |
|---|---|---|---|
| `confirmAccountErasure` | onCall | Self or `requireTeamAdmin` | GDPR Article 17 erasure |
| `exportMyData` | onCall | Self or `requireTeamAdmin` | GDPR Article 20 export |
| `runMigrations` | onCall | scheduler-triggered | Migration runner |
| `migrationsTick` | scheduler | n/a (server-only) | Hourly migration cron |

## BACKGROUND / TRIGGERS / CRONS (no direct client traffic)
| Export | Type | Trigger |
|---|---|---|
| `onPhotoUploaded` | Storage onFinalize | New photo in `photos/{uid}/...` → variant pipeline |
| `weeklyDigest` | scheduler | Weekly rep digest email |
| `dormantLeadNudge` | scheduler | Stale-lead notification |
| `runAbandonRecovery` | scheduler | Funnel-drop recovery |
| `visualizerImageGen` | onCall | Visualizer AI image gen (rate-limited per session) |
| `dunningEmailQueue` | Firestore onWrite | Stripe payment_failed → dunning |
| `hailCron` | scheduler | Storm-alert subscriber notification |
| `voiceMemoTrigger` | Storage onFinalize | Voice memo upload → transcribe |
| `voiceIntelligenceTrigger` | Storage onFinalize | Recording → transcribe + analyze |
| `emailQueueWorker` | scheduler | Drains `email_queue/` |
| `auditTriggers` | Firestore onWrite | Audit-log capture |
| `complianceTrigger` | Firestore onWrite | Compliance event capture |
| `deviceAlertTrigger` | Firestore onWrite | Device-alert routing |
| `calcomWebhook` | onRequest | Cal.com booking webhook (HMAC verified) |
| `slackPing` | onCall (admin) | Slack health ping |

---

## Maintenance

Adding a new export?

1. Pick the category above and list it.
2. Admin-only exports MUST have one of:
   - `request.auth.token.role === 'admin'` check in the handler
   - `requireAuth(req, { adminOnly: true })` for `onRequest`
   - `requireTeamAdmin(...)` for team-scoped admin
3. The smoke test `admin functions enforce role check` (see `tests/smoke.test.js`) greps for that string in the function body. If you add an admin export without a check, CI will fail.
