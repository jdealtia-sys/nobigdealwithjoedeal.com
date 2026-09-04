# Stability + integration audit — 2026-09-04

> Two adversarial workflows (632 and 407 agents) swept the marketing site, the
> CRM client and `functions/` for live defects, then had every finding attacked
> by three independent refuters. This note is the durable record.
>
> Session PRs: [#1377](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1377) (TCPA consent) ·
> [#1378](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1378) (216-page SEO gate).
> Related: [FREE-API-INTEGRATIONS-RESEARCH-2026-09-02](FREE-API-INTEGRATIONS-RESEARCH-2026-09-02.md).

## Read this before using the lists below

**77 findings were never verified, and the workflow reported them as refuted.**

Both runs hit the session token limit partway through the verify phase — 441 of
632 agents in the stability run, 285 of 407 in the integration run, all dying
with `You've hit your session limit`. The scripts computed survival as
`refutedCount < ceil(votes/2)` over *surviving* votes, so a finding whose three
verifiers all died scored zero votes and fell into the killed bucket carrying an
empty reason string. It looked identical to a finding that had been argued down.

The honest split:

| | stability | integration |
|---|---|---|
| verified and survived 3 refuters | **47** | **6** |
| genuinely refuted (a real verifier said so) | 14 | 34 |
| **never verified — status unknown** | **47** | **30** |

Both unverified lists are reproduced in full below. Treat them as leads, not
findings. Several look serious on their face and cost nothing to re-check.

**Workflow lesson, worth carrying forward.** `survives` must distinguish *refuted*
from *unverified*. A finding with zero surviving votes is not refuted — it is
un-adjudicated, and silently binning it is the same species of false-green this
repo keeps catching in its own gates. Compute `survives` only when
`votes.length > 0` and carry an explicit `unverified` bucket:

```js
const good = votes.filter(Boolean);
const verdict = good.length === 0
  ? 'unverified'
  : (good.filter(v => v.refuted).length < Math.ceil(good.length / 2) ? 'survives' : 'refuted');
```

## Already fixed this session

- **The /estimate funnel's consent record never persisted.** `submitPublicLead`'s
  M-04 allowlist drops non-strings and never listed `tcpaConsent`, so the boolean
  was discarded on every submission; `ackHomeownerSms` then inferred consent from
  the collection name rather than reading the record. Both halves fixed in #1377
  — plus the funnel's *second* submit button (`skipOtpAndRequestCall`), which
  gates on the checkbox and never sent the field. That one was found by this
  audit *after* the gate was written, which is exactly the window in which the
  bug class ships.
- **216-page SEO gate** (#1378) — a 404 page that was indexable, a 117 KB eager
  JPEG hero, and a WebP file served as `image/jpeg`. Also two bugs in the gate
  itself, both caught by using it: `[\b]` is a backspace character rather than a
  word boundary, and length checks that counted raw HTML bytes scored `&#39;` as
  five characters.

## Confirmed stability findings (47)

Each survived three independent refuters. Grouped by the severity the finder
assigned; `needs deploy` means the fix touches `functions/` and must wait for a
Cloud Functions window.

### CRITICAL (10)

- **The sms_opt_outs record is written under an 11-digit key and read under a 10-digit key, so STOP is never honoured on any rep- or AI-initiated text**
  `functions/sms-functions.js:621` · S · needs deploy · silent-failure
  Homeowner (859) 555-0134 replies STOP. incomingSMS receives Twilio's `From: +18595550134`; line 619 computes `phoneDigits = '18595550134'` (11 digits, country code kept) and line 621 writes `sms_opt_outs/18595550134`. The homeowner gets the TwiML "You've been unsubscribed from NBD Pro SMS". Next day
- **checkStormAlerts blasts marketing SMS to storm subscribers every 30 minutes with no opt-out check of any kind**
  `functions/sms-functions.js:1048` · M · needs deploy · compliance
  A homeowner signs up at /storm-alerts, gets a storm text, replies STOP and is told "You've been unsubscribed from NBD Pro SMS". incomingSMS writes sms_opt_outs and returns — it never touches their `storm_alert_subscribers` doc, whose `active` flag is set server-side to true at signup (handlers/integ
- **submitDealAcceptance burns the single-use token in a transaction, then warn-swallows the write that stores the tier, price and signature — and still returns ok:true**
  `functions/deal-acceptance.js:296` · M · needs deploy · data-loss
  Homeowner opens the deal room and taps Accept. The transaction at :260-275 atomically flips deal_accept_tokens/{token}.status from 'pending' to 'accepted'. The very next write — deal_rooms/{dealId}.set({acceptedTier, acceptedPrice, acceptedFinancing, acceptedSignature, scheduledInstallDate}) at :286
- **enforceLapseForCompany stamps lapseEnforced:true even when zero seats were actually paused, and the scan query permanently excludes it afterwards**
  `functions/lapse-enforcement.js:75` · S · needs deploy · silent-failure
  A tenant's subscription is cancelled; 14 days later enforceLapsedSeats picks it up. For each active member the loop calls getAuth().updateUser(uid, {disabled:true}) at :59. If that Auth call throws for every member — an Auth outage, a quota blip, a service-account permission regression — the catch a
- **Voice Intelligence's Anthropic calls can never be configured — ANTHROPIC_API_KEY is not in the _shared SECRETS registry, so hasSecret() is hard-coded false**
  `functions/integrations/voice-intelligence.js:276` · S · needs deploy · dead-wiring
  A rep records a call and the audio lands under the voice prefix. onAudioUploaded fires, transcribeGroq succeeds (GROQ_API_KEY *is* in the registry) and the doc moves to status:'analyzing'. analyzeTranscript -> callClaudeJson -> hasSecret('ANTHROPIC_API_KEY') evaluates SECRETS['ANTHROPIC_API_KEY'] wh
- **The V2 catalog/Job-Template estimate path never passes the tenant's Overhead %, Profit %, Material Markup %, Round-To or Minimum Job settings to the pricing engine — every such estimate silently prices at the engine's hardcoded 25/10/10**
  `docs/pro/js/estimate-v2-ui.js:1712` · M · silent-mispricing
  Owner sets Settings → Estimates to Material Markup 40%, Overhead 15%, Profit 15% (dashboard.html:3403-3405; saved by dashboard-bootstrap.module.js:4488-4490 into nbd_est_settings_v3 and userSettings). Rep builds a catalog (line-item) estimate — the DEFAULT mode (state.mode:'line-item', estimate-v2-u
- **createSignRequest trusts the client-written htmlPath, so getSignDocument serves another tenant's contract HTML to an unauthenticated token holder**
  `functions/remote-signing.js:195` · S · needs deploy · cross-tenant-read
  A `viewer`-role user in tenant A opens a teammate's customer page. firestore.rules:377-379 lets any isCompanyReader (company_admin/manager/**viewer**) READ leads/{teammateLead}/documents/{docId}, so they copy its htmlPath, e.g. `documents/<teammateUid>/<teammateLeadId>/<docId>.html`. They then creat
- **Every Resend send failure is recorded as a success — the SDK returns {data:null,error} instead of throwing, and all 19 call sites only catch throws**
  `functions/email-functions.js:391` · M · needs deploy · silent-failure
  Resend rejects a send with any non-2xx (unverified from-domain, 429 rate limit, suspended account, 422 validation, 5xx). sendEmail's try block completes normally: email_log gets status:'sent', and the HTTP response is {success:true, id:undefined} -> nbd-comms.js:259 toasts 'Email sent' to the rep. T
- **STOP opt-outs are stored under an 11-digit key but every send-path checks a 10-digit key, so TCPA opt-outs are silently ignored**
  `functions/sms-functions.js:619` · S · needs deploy · key-shape-mismatch
  A homeowner whose lead phone is stored as "(513) 555-0123" replies STOP. incomingSMS receives Twilio's `From` = "+15135550123" and writes the opt-out doc at `sms_opt_outs/15135550123` (leading country-code 1 kept). Later the rep taps Text; NBDComms.sendSMS posts `to` = the lead's raw stored phone, s
- **The documented SMS spend kill-switch is a no-op: setting STORM_MAX_SMS_PER_DAY/RUN to 0 silently restores the default cap**
  `functions/sms-functions.js:1009` · S · needs deploy · dead-kill-switch
  Twilio spend is running away during a multi-county severe-weather event. The operator opens SPEND_KILLSWITCH.md, reads "Set either to `0` on the checkStormAlerts revision to halt storm fan-out without a deploy", and sets STORM_MAX_SMS_PER_DAY=0 (and/or STORM_MAX_SMS_PER_RUN=0) on the revision. Numbe

### HIGH (20)

- **checkStormAlerts' per-run pacing exceeds its own function timeout, so any real storm fan-out is force-killed at roughly a third of its stated cap**
  `functions/sms-functions.js:1073` · S · needs deploy · correctness
  A Severe hail warning covers three counties and 300 active subscribers match. The fan-out sleeps 1100 ms after every send (line 1073) on top of the Twilio round-trip and the `storm_alerts_sent` write, so ~1.4-1.8 s per subscriber. The declared ceiling MAX_SMS_PER_RUN is 250, which needs at least 275
- **C5 auto-invoice writes its only idempotency guard last and passes no Stripe idempotency key, inside a 15-second webhook the provider retries — a signed contract can mint duplicate draft invoices**
  `functions/integrations/esign.js:443` · M · needs deploy · money
  BoldSign posts a 'completed' event. esignWebhook (timeoutSeconds: 15, :198) updates the estimate to signed at :276, then calls createStripeInvoiceForEstimate at :284. That function's ONLY duplicate guard is `if (est.stripeInvoiceId) return` at :336, and stripeInvoiceId is not written until :443 — af
- **hailMatchCron matches zero leads — `.where('deleted','==',false)` is the only such query in the repo and no live lead-create path writes the field**
  `functions/integrations/hail-cron.js:119` · S · needs deploy · dead-wiring
  The nightly 09:00 America/Chicago sweep runs, queries leads where deleted == false, and Firestore returns 0 docs because equality filters skip documents that lack the field entirely. Every lead-create path omits it: docs/pro/js/repos.js:77-86 stampCreate() writes only userId/companyId/createdAt/upda
- **Every non-admin rep sees all integrations as "not set up" — the client short-circuits integrationStatus to an empty map and requireConfigured() then fails closed for measurement, e-signature and parcel**
  `docs/pro/js/integrations-client.js:62` · M · needs deploy · dead-wiring
  A rep whose role is 'member' (the default from nbd-auth.js:521) opens an estimate and taps Send for Signature. status() sees _isAdminCaller() false, populates state.status = { configured: {}, providers: {} } without ever calling the server, and requireConfigured('boldsign','E-signature') reads state
- **Emailed and printed invoices show "Balance Due" equal to the FULL total right below "Deposit due", so the homeowner reads deposit + balance as more than the invoice total**
  `docs/pro/js/invoice-pipeline.js:1321` · S · customer-facing-money
  Per-SQ V2 estimate, grandTotal $14,200 → est.deposit = round((14200×0.5)/25)×25 = $7,100 (estimate-v2-ui.js:1791-1793). createInvoiceFromEstimate writes depositAmount 7100, total 14200 and balanceDue: total (14200). The deposit block's gate (depositAmount > 0 && depositAmount < total) passes, so the
- **A pass-through-only estimate throws a TypeError in renderScope — the shell object returned when the catalog scope is empty has no `internal` block**
  `docs/pro/js/estimate-v2-ui.js:2307` · S · crash
  Default builder state is mode:'line-item' (estimate-v2-ui.js:63) with an empty scope. Rep opens the V2 builder and clicks Auto-measure; applyMeasurementResult auto-adds the $75 'SVC MEASURE-RPT' pass-through (:1403-1414) and calls render(). getCurrentEstimate takes the `items.length ? ... : shell` b
- **companies/{id} update freezes only plan+ownerId, so an owner can client-write siteSlug and bypass the siteSlugs uniqueness lock — hijacking another tenant's microsite URL and its inbound leads**
  `firestore.rules:1236` · S · cross-tenant-hijack
  setSiteSlug (functions/handlers/public-site.js:254-288) is the ONLY path that enforces slug uniqueness, via the admin-SDK-only claim doc siteSlugs/{slug}. But firestore.rules:1236 lets the company doc's owner write any field except plan/ownerId directly. From devtools an attacker who owns companies/
- **onAudioUploaded treats a client-chosen Storage path segment as a lead id with no tenancy check, planting a recording inside another tenant's lead and reading that lead's homeowner name back to the uploader**
  `functions/integrations/voice-intelligence.js:450` · S · needs deploy · cross-tenant-write
  storage.rules:168-174 lets any authenticated user write `audio/{theirOwnUid}/{anything}/{anything}.webm` — the second and third path segments are entirely attacker-chosen. parseAudioPath (line 68-77) maps them to {uid, leadId, recordingId} and processRecording uses leadId verbatim with no check that
- **/photos never constrains leadId, and the docLeadInMyCompany read clause keys on it — so a photo can be injected into another tenant's customer-page gallery**
  `firestore.rules:666` · M · cross-tenant-write
  The 2026-08-02 audit froze userId+companyId on /photos update specifically to stop 'planting an image in that company's shared gallery', but leadId was left free on BOTH create and update — and the read rule's second clause resolves tenancy through leadId, not companyId. So the same injection still 
- **reply_to: is silently dropped by the Resend SDK (it only reads replyTo) — 7 call sites send no Reply-To header at all**
  `functions/lead-alert.js:302` · S · needs deploy · dead-wiring
  A homeowner submits the public contact form. leadAlertContact emails Joe with reply_to set to the homeowner's address so he can hit Reply and be in their inbox. parseEmailToApiOptions builds the API body from a fixed allowlist that reads only `email.replyTo`; the `reply_to` key is not in the allowli
- **The TCPA STOP gate never matches: opt-outs are keyed on 11 digits (E.164 From) but every outbound check looks up 10 digits (rep-typed phone)**
  `functions/sms-functions.js:619` · S · needs deploy · compliance
  A homeowner texts STOP. incomingSMS computes phoneDigits from Twilio's From ('+18594207382') with a plain non-digit strip -> '18594207382' and writes sms_opt_outs/18594207382, then replies 'You've been unsubscribed'. Later a rep texts that lead from the CRM; nbd-comms.js passes lead.phone through ve
- **checkStormAlerts fans out SMS without ever consulting sms_opt_outs, and a STOP never deactivates the storm subscriber — the message's own 'Reply STOP' promise is unenforced**
  `functions/sms-functions.js:1042` · S · needs deploy · compliance
  A homeowner subscribes to storm alerts on the public site, gets one alert whose body ends 'Reply STOP to unsubscribe.', and replies STOP. incomingSMS writes sms_opt_outs/<digits> and confirms the unsubscribe. The next distinct NWS alertId (a new storm, hours later) produces a new dedupeKey `${alertI
- **Three of the four push-notification triggers are gated on lead.assignedTo, a field no write path in the repo ever sets — they have never fired**
  `functions/push-functions.js:219` · S · needs deploy · dead-wiring
  A rep enables 'New Lead' push and adds a lead in the CRM. onNewLead reads leadData.assignedTo, finds undefined, logs '[Push] No assigned rep for lead' and returns — no push, ever. Same for onClaimStageChange:472 (a claim moving to 'Adjuster Scheduled' notifies nobody) and onFollowUpDue:410 (the 08:0
- **Two live /photos write paths omit `createdAt`, and both gallery queries orderBy('createdAt') — Firestore silently excludes those photos**
  `docs/pro/js/customer-bootstrap.module.js:2462` · S · needs deploy · silent-exclusion
  A rep uploads a photo from the customer page's quick-upload. The photo doc gets `date` and `uploadedAt` but no `createdAt`. It renders in the customer photo strip (that query has no orderBy), so the rep believes it saved — but the Photos tab gallery (photo-engine getPhotosForLead) and the dashboard 
- **submitSignature stamps signedAt + signedSha256 even when the signed HTML failed to upload, leaving a burned token and a contract record that claims a signature nobody stored**
  `functions/remote-signing.js:456` · M · needs deploy · partial-write
  A homeowner signs remotely. The token is burned inside the transaction (pending -> signed). The next step, saving the signed HTML over `info.htmlPath`, hits a transient Storage 5xx/timeout — caught and logged as a warning. Execution continues and the documents doc is stamped signedAt / signedRemotel
- **onLeadDeleted reaps only the `documents` subcollection — ai_drafts, tasks and portal_messages survive a hard delete and keep feeding the collectionGroup analytics**
  `functions/lead-artifact-cleanup.js:188` · M · needs deploy · orphaned-children
  A rep permanently deletes a prospect (dashboard-actions.js:1858, three confirmations plus a typed DELETE). onLeadDeleted reaps Storage prefixes, /photos and the `documents` subcollection — but Firestore cascades nothing, and leads/{id}/ai_drafts, /tasks and /portal_messages are never touched. Those 
- **The customer-page photo delete removes only the Firestore doc, orphaning the Storage original, thumb and three variants beyond any future sweep**
  `docs/pro/js/customer-tasks-ui.js:1567` · M · orphaned-storage
  A rep deletes a photo from the customer page (single delete, or the multi-select bulk delete at :913). Only the /photos doc goes; `storagePath`, the thumb, and the three image-pipeline variants at `photos/{uid}/{leadId}/_variants/{base}_{thumb,med,full}.webp` all stay in the bucket. Because image-pi
- **The daily health digest's Anthropic token section reads a field nothing writes, so AI token spend always renders as 0**
  `functions/health-digest.js:118` · S · needs deploy · silent-failure
  A compromised account or a runaway client loop burns through the 200k/uid/day Claude budget across many users. The next morning's health digest — the one daily artifact that lands in Jo's inbox — renders 'Anthropic Token Usage (today): 0 tokens reserved across all users' and a table of uids each sho
- **verify-backup.sh — the first command in the P0 backup runbook — defaults to the bucket that was deliberately abandoned and never created**
  `scripts/verify-backup.sh:28` · S · broken-runbook
  Backups have stopped. The operator opens ALERT_RESPONSE.md §5 ('Backup cron stale > 26h ... this is a restore-capability outage — treat as P0') and runs its stated first action, `./scripts/verify-backup.sh`, with no BACKUP_BUCKET exported. It defaults to gs://nobigdeal-pro-backups — the bucket FUNCT
- **The health digest's Stripe webhook counter reads an arbitrary 200-doc slice by document ID, so it undercounts toward zero as the collection grows**
  `functions/health-digest.js:95` · S · needs deploy · silent-failure
  stripe_events is keyed by the Stripe event id (`stripe_events/${event.id}` — evt_<random>), so a query with `.limit(200)` and no orderBy returns the 200 lexicographically-lowest document IDs, a fixed arbitrary slice frozen early in the project's life. Once the collection exceeds 200 docs, a newly-wr

### MEDIUM (17)

- **A STOP/HELP/START reply returns before the lead match and before the sms_log write, so an opt-out leaves no trace anywhere in the CRM**
  `functions/sms-functions.js:634` · M · needs deploy · silent-failure
  Homeowner replies STOP. The handler writes the opt-out doc and returns at line 634 — above the MessageSid idempotency claim (657), above the phoneDigits lead lookup (700-715), above the `leads/{id}/notes` inbound-note write (762), and above the terminal `logSMSToFirestore(... 'received' ...)` at 895
- **The STOP and HELP auto-replies are hardcoded with NBD's brand and support number on a long code that serves every tenant**
  `functions/sms-functions.js:631` · M · needs deploy · multi-tenant-leak
  One shared Twilio number serves all tenants — the file's own header at 40-43 says so ("one shared Twilio number serves every tenant"), and sendD2DSMS goes to the trouble of resolving `companyProfile/{tenantKey}.brand.legalName` at 458-471 and rewriting 'NBD Home Solutions' out of the template body p
- **The approved-AI-draft outbound text logs to sms_log without companyId, so it is invisible in the team Communication Log while its inbound half is visible**
  `functions/sms-functions.js:1275` · S · needs deploy · silent-failure
  A company_admin or manager opens a customer record. customer-tasks-ui.js takes the team-thread branch and queries sms_log with `where('leadId','==',leadId)` AND `where('companyId','==',companyId)`. logSMSToFirestore only writes the field when it is truthy (`if (companyId) row.companyId = companyId;`
- **The estimate funnel's "skip verification" path checks the TCPA box but never sends tcpaConsent, so those leads will fail the new consent gate that the rest of the funnel passes**
  `docs/assets/js/inline/4053149b2f.js:816` · S · dead-wiring
  Two buttons write into estimate_leads. `submitAndGetEstimate` includes `tcpaConsent: document.getElementById('tcpaConsent').checked` in its payload (line 955). `skipOtpAndRequestCall` — the "Skip verification — just have Joe call me" escape hatch — reads the same checkbox at line 773 and refuses to 
- **transcribeVoiceMemo returns success:true with the transcript after the write that persists it to the lead timeline has failed — and writes nothing at all, with no log, when the transcript comes back empty**
  `functions/integrations/voice-memo.js:149` · S · needs deploy · silent-failure
  A rep records a voice memo on a lead. Deepgram is billed and returns a transcript. The only durable output of this feature is the leads/{leadId}/activity row written at :137-145 — but it is wrapped in a try whose catch at :146 logs logger.warn('voice-memo activity write failed') and swallows. Execut
- **Voice pipeline accepts a 200 MB upload into a 512 MiB instance and then hands it to Groq, whose documented cap is 25 MB — burns the download and dies**
  `functions/integrations/voice-intelligence.js:60` · S · needs deploy · silent-failure
  A rep uploads a 40 MB WAV/MP3 recording of a long adjuster meeting. MAX_AUDIO_BYTES is 200 MB so the size gate at :195 passes. transcribeGroq calls file.download() into a Buffer, then copies it into `new Blob([buffer])`, then again into FormData — roughly 3x the file in resident memory on an instanc
- **`Number(null) === 0` defeats the documented 50% deposit fallback — every V2 line-item estimate invoices with a $0 deposit while its terms still read "50% deposit due upon scheduling"**
  `docs/pro/js/invoice-pipeline.js:499` · S · silent-failure
  V2 catalog/line-item estimates never set estimate.deposit — it is assigned only inside the per-SQ overlay (estimate-v2-ui.js:1791). _buildSavePayload therefore persists `deposit: null` (estimate-v2-ui.js:2868: `(estimate.deposit != null ? Number(estimate.deposit) : null)`). In createInvoiceFromEstim
- **The homeowner's rendered estimate PDF states a 25% deposit — hardcoded, and contradicted by the 50% the CRM actually persists, invoices and prints everywhere else**
  `docs/pro/js/estimate-v2-ui.js:2727` · S · customer-facing-money
  Rep finalises a $14,200 per-SQ cash estimate. estimate-v2-ui stamps estimate.deposit = $7,100 (50%, :1791-1793), _buildSavePayload persists deposit: 7100, estimate-finalization.js:757-768 prints "Deposit (50% — Upon signing) $7,100.00", and the invoice terms say "50% deposit due upon scheduling" (in
- **Reopening a minimum-job estimate drops the "Minimum Job Charge Adjustment" row — the regenerated scope prints Subtotal + Tax that don't reach the stated RCV**
  `docs/pro/js/estimate-v2-ui.js:2942` · S · customer-facing-money
  Rep builds a small insurance/line-item scope: retailBeforeOHP $400, O&P $80, subtotal $480, tax $0 → resolveEstimate floors total to the $2,500 job minimum and returns minJobApplied: true (estimate-logic-engine.js:956-960). Printed live, estimate-finalization.js:539-541 adds a "Minimum Job Charge Ad
- **Zero-value scope rows that every preset persists make createStripePaymentLink reject the whole invoice with 400 before it ever reaches the totals reconciliation**
  `functions/stripe.js:1184` · S · needs deploy · dead-wiring
  The 'standard-reroof' preset deliberately loads all three dumpster sizes; the engine's sq-gated formulas (estimate-logic-engine.js:724-727) resolve two of them to qty 0. _buildSavePayload maps ALL estimate.lines (estimate-v2-ui.js:2825), unfiltered, so those two rows persist with quantity 0 / total 
- **deal_rooms update does not freeze userId, so a rep can hand a fabricated deal card to another tenant's Close Board**
  `firestore.rules:1502` · S · cross-tenant-write
  Every other owner-keyed collection in this file freezes provenance on update after the 2026-07-08 /pins fix (/pins:709, /zones:734, /knocks:1152, /territories:1188, /training_sessions:1286, /photos:667 all carry `didNotChange(['userId', ...])`). /deal_rooms was missed. An authenticated user creates 
- **The lead-alert triggers have no idempotency claim, so an at-least-once redelivery re-sends Joe's alert email + SMS and a duplicate Joe-branded ack to the homeowner**
  `functions/lead-alert.js:379` · M · needs deploy · trigger-idempotency
  Firestore onDocumentCreated is at-least-once. A duplicate delivery of the same estimate_leads create (Eventarc redelivery, or a container that is killed after alertJoe's sends but before the platform records the ack) re-enters onLeadAlert with the same document. isFollowUpEvent does not suppress it,
- **The email-queue reaper re-queues stale 'sending' rows with no MAX_ATTEMPTS ceiling, so the duplicate-send loop its own comment calls 'bounded by MAX_ATTEMPTS' is actually unbounded**
  `functions/integrations/email-queue-worker.js:79` · S · needs deploy · unbounded-retry
  A row is claimed (status:'sending'), Resend accepts and delivers the message, but the tick is killed before the `status:'sent'` write lands (240s timeout while draining 25 rows sequentially, or an OOM at 256MiB). Ten minutes later the reaper flips it back to 'pending' and bumps attempts. The next ti
- **incomingSMS writes its dedupe claim before doing any work, so a tick that fails mid-processing loses the homeowner's text permanently — the retry is swallowed as a duplicate**
  `functions/sms-functions.js:663` · M · needs deploy · data-loss
  A customer texts back. incomingSMS creates sms_inbound_seen/<MessageSid> first, then does the lead match, note write, generateAIDraft (an Anthropic call with a 10s internal budget, inside a 30s function), and the FCM push. If anything after the claim throws or the function times out, control reaches
- **Deleting a D2D knock orphans its photos and audio in Storage with no reaper anywhere**
  `docs/pro/js/d2d-tracker-core-2026b.js:2146` · M · needs deploy · orphaned-storage
  A rep deletes a knock from the D2D tracker. The knocks doc is removed and nothing else. Knock photos live at `photos/{uid}/d2d/{knockId}/{ts}_{name}` with image-pipeline variants beside them, and knock voice memos at `audio/{uid}/d2d/{knockId}_{ts}.webm`. There is no onDocumentDeleted for knocks (im
- **A homeowner accepting a deal whose deal room was deleted resurrects a userId-less zombie doc, and the acceptance plus signature become unreachable**
  `functions/deal-acceptance.js:286` · M · needs deploy · partial-write
  A rep deletes a deal room from the Close Board (close-board.js:251 deleteDoc). Nothing revokes the outstanding `deal_accept_tokens` — that collection is admin-SDK-only and no delete path touches it. The homeowner opens the still-valid /deal/<token> link and accepts. The transaction burns the token, 
- **removeMember writes a team member's raw email address into Cloud Logging, in the same file that hashes it for createTeamMember**
  `functions/handlers/admin.js:838` · S · needs deploy · pii-in-logs
  A company admin removes any team member. The callable writes that person's plaintext email address into Cloud Logging, where it sits for the log bucket's full retention and is readable by anyone with roles/logging.viewer on the project. The identical concern was already recognised and fixed 275 line

## Integration + leverage survivors (6)

- **Kentucky 3-inch aerials on the D2D tracker: nothing exists yet, and it shares a CSP line with the Wayback fix** — status: `not-built`, effort S, needs CSP
  - Seam: docs/pro/js/d2d-tracker-core-2026b.js:186-191 (add a fifth BASEMAPS entry) + firebase.json:84-85 img-src — the same two CSP lines the Wayback fix edits, so sequence them in one PR
- **One alert file is deployable right now and is the fastest possible move from zero alarms to one** — status: `built-but-dead`, effort S
  - Seam: monitoring/alert-function-latency.json:32 (swap the placeholder for the two real channel IDs), then gcloud monitoring policies create
  - **Jo must:** Confirm +1 513-315-2406 is still the phone he wants woken up, and reply to the first test SMS so he knows the channel actually delivers — I can create the policy but cannot prove Google's SMS reaches 
- **When a customer texts you back, the alert goes to one arbitrarily-picked device — and if that token is dead, you never find out** — status: `partly-built`, effort S, needs deploy
  - Seam: functions/sms-functions.js:830-860 — replace the hand-rolled block with `require('./push-functions').sendCustomNotification(notifyUid, title, body, {leadId, type:'incoming_sms', from})` (push-functions.js:590).
  - **Jo must:** After it ships, confirm on the phone that notifications are actually granted for the installed PWA — nothing in the repo can prove that from here.
- **The HEIC photo parser was written, shipped, and is blocked by your own CSP — it has never run once** — status: `built-but-dead`, effort S
  - Seam: docs/pro/js/photo-smart-ingest.js:73 — replace the skypack URL with a vendored copy under docs/assets/vendor/exifr/<version>/, which needs NO firebase.json change at all. Adding cdn.skypack.dev to the CSP would also work
- **Dependabot security alerts are switched OFF, and the config file states in writing that they are on** — status: `built-but-dead`, effort S
  - Seam: GitHub repo Settings > Advanced Security > Dependabot alerts (+ Dependabot security updates). Then correct the now-true-again comment at .github/dependabot.yml:4-6.
  - **Jo must:** Yes — repo-owner settings toggle, cannot be done from the codebase or by CI.
- **The restore path has never been run against real GCP — and a full drill costs well under a dollar** — status: `partly-built`, effort M
  - Seam: documentation/runbooks/RESTORE_FROM_BACKUP.md §2 already contains the exact working recipe (gcloud firestore databases create, the gcp-sa-firestore IAM binding, gcloud firestore import). Run it once against gs://nobigdea
  - **Jo must:** Yes, and only Jo — creating a GCP project and granting the Firestore service-agent IAM role are owner-level actions on real infrastructure.

## NEVER VERIFIED — stability (47)

Leads, not findings. Each was reported by a finder and then lost all three
verifiers to the session limit.

- [dead-wiring-crm] Photo-upload preview ✕ button always deletes the FIRST queued photo — `+ i +` is inside the string literal, so data-arg ships as literal text
- [dead-wiring-crm] Customer photo-upload metadata UI does not exist — three getElementById reads and two window-exported selectors are orphaned, so every photo saves with empty damageType/location and phase hardcoded to 'During'
- [dead-wiring-crm] Settings → 'Secondary Toolbar' toggle is a no-op that toasts success — applyCrmSecHeaderState bails on #crmSecRestoreBtn, which exists in no HTML
- [dead-wiring-crm] The Pro Tips & D2D Tricks modal is unreachable — openTips() has zero callers anywhere in the repo
- [dead-wiring-crm] Settings → Appearance 'Reset to Default' accent button changes nothing on screen — it clears saved state but never removes the inline --orange override or resets the swatch (wrong element id)
- [dead-wiring-crm] After '✓ Apply Theme', the theme grid keeps the ✓ / accent border on the OLD theme — the refresh hook targets #te-theme-sections, which does not exist
- [dead-wiring-crm] Rep OS weather card and the D2D storm-alert banner are permanently dead — both gate on localStorage 'nbd_weather_key', which nothing in the repo ever writes
- [dead-wiring-crm] 'Solar Analysis' always falls back to a latitude-only guess and tells the user to configure a key that has no UI — 'nbd_google_solar_key' is read once and written nowhere
- [scheduled-crons] Both storm SMS crons ignore the sms_opt_outs STOP register, so a homeowner who replies STOP keeps getting storm blasts
- [scheduled-crons] hailMatchCron's `where('deleted','==',false)` matches almost no real leads -- neither lead-create path writes the field
- [scheduled-crons] onFollowUpDue reads two lead fields that no code in the repo ever writes -- the daily 08:00 follow-up push has never fired
- [scheduled-crons] weeklyDigest reports any merely-EDITED won lead as "won this week", inflating the Monday revenue number
- [scheduled-crons] migrationsTick and runMigrations both inherit the 60s default timeout, and the heartbeat that the staleness alert watches is only logged after the work finishes
- [scheduled-crons] hailMatchCron reads the same first 500 leads every day -- the "larger tenants roll over to the next day run" comment describes a cursor that does not exist
- [scheduled-crons] runAbandonRecovery's 200-doc cap over a 30-day window is filled oldest-first by already-recovered rows, starving new abandoners
- [scheduled-crons] stormWatch reads the subscriber list without the `active == true` filter that checkStormAlerts uses, re-texting numbers the system already deactivated
- [money-and-estimates] The invoice a tenant previews and prints is branded "NBD ROOFING" for every company — the one surface the white-label sweep of this file missed
- [client-runtime-errors] prefs-sync can never push a pref DELETION to Firestore, so turning "Show Prospects"/"Show Snoozed" off silently reverts on the next load
- [client-runtime-errors] Broken string concatenation puts the literal text " + i + " in data-arg, so the photo-queue remove button always deletes the FIRST staged photo
- [client-runtime-errors] The CRM "Secondary toolbar" setting is still a no-op: every apply path bails on #crmSecRestoreBtn, an element that exists nowhere in the repo
- [client-runtime-errors] HEIC/HEIF/TIFF/AVIF photos silently lose all EXIF (GPS + capture time): the exifr lazy-load hits cdn.skypack.dev, which is absent from every CSP script directive
- [client-runtime-errors] The public Storm Check tool's storm-report fetch is CSP-blocked: mesonet.agron.iastate.edu is in img-src but not connect-src, so the evidence-backed verdict never fires
- [client-runtime-errors] Property Intel's US Census enrichment is dead — geocoding.geo.census.gov is not in connect-src, so the AI prompt never gets a census tract
- [client-runtime-errors] The map's Weather overlay toasts "Live weather overlay active" and renders nothing — tilecache.rainviewer.com is absent from img-src
- [client-runtime-errors] The service worker's 500-tile eviction cap is unreachable: ESRI satellite tiles route to handleCDNRequest and accumulate uncapped in the same cache as the app's JS/CSS
- [test-honesty] The classic↔V2 estimate "parity" gate re-implements the code under test and never reads estimates.js — the D-2 half cannot fail
- [test-honesty] The "inline-script gate" in CI checks zero inline scripts and only validates syntax — it does not enforce the no-inline-script CSP invariant it is believed to enforce
- [test-honesty] The EXIF/GPS privacy gate never inspects PNG (or any non-JPEG/WebP) images, but reports a scan count that reads as complete coverage
- [test-honesty] The tripwire that guards the two aggregated buckets only inspects the STEP block and stops at the first workflow file, so all 116 gating suites can be de-gated while it prints "workflow coverage clean"
- [test-honesty] job-templates.test.js keeps a soft-skip that exits 0 with no assertions, and the aggregated runner's failure scanner cannot see it
- [test-honesty] A test in the required public-e2e job is permanently skipped — the page it targets does not exist in the repo
- [public-site] /storm-check's storm-data lookup is blocked by the site CSP — the tool silently reports "no storm history" for every visitor
- [public-site] Admin Project Codex: four session-log fields are silently saved as empty because their ids are duplicated by search-filter buttons earlier in the document
- [public-site] GA4 is not loaded on any of the 163 service/area pages that host the quick lead form — every conversion on the SEO landing surface is invisible
- [public-site] Three public tools hard-gate submission on a TCPA texting-consent checkbox, then discard it — the consent is never sent and the collection is not consent-bearing
- [public-site] 15 indexed pages ship FAQPage structured data whose Q&A text appears nowhere on the page
- [public-site] /inspect accepts photo uploads that are never transmitted — only the filenames are sent, and the success card doesn't say so
- [public-site] /review hero shows a hardcoded "5.0 ★★★★★ Verified on Google" that is never invalidated when the live reviews feed fails
- [public-site] A blog post's og:url points at a different article, so every social/messaging share of it resolves to the wrong post
- [pwa-offline-sw] isOnAuthGatedPath() lists only .html paths, but cleanUrls makes every real /pro pathname extensionless — the forced post-deploy reload never fires on customer.html or login.html
- [pwa-offline-sw] standalone link interceptor preventDefaults every in-DOM <a download> blob anchor — CSV/photo exports navigate the installed app to a just-revoked blob instead of downloading
- [pwa-offline-sw] standalone window.open() resolves relative URLs against location.origin instead of the document URL — the dashboard Help buttons send the installed app to a 404 at /how-to.html
- [pwa-offline-sw] FCM notificationclick calls client.navigate() on a window controlled by a different service worker registration — it always rejects, so a tapped push focuses the app but never opens the record
- [pwa-offline-sw] Every push deep link carries query params nothing in the app reads; the claimUpdate link uses ?leadId= where customer.html reads ?id=, so the notification opens an empty customer page
- [pwa-offline-sw] standalone-compat injects body{padding-top: env(safe-area-inset-top)} on top of the header rule that already reserves the notch, double-counting the inset on a border-box 100dvh flex body
- [pwa-offline-sw] D2D offline-knock background sync is dead wiring: the page registers tag 'nbd-d2d-sync' but sw.js only handles 'nbd-sync-queue', and the FLUSH_OFFLINE_QUEUE message it listens for is posted by no service worker
- [pwa-offline-sw] FCM notificationclick never inspects event.action, so the 'Dismiss' action button on appointment/follow-up notifications opens and focuses the CRM instead of dismissing

## NEVER VERIFIED — integration (30)

- [dead-integrations] Your Google reviews are blank on all 15 marketing pages right now — the key is a placeholder
- [dead-integrations] The mic buttons in the CRM cannot work — dictation is wired to a key that was never set, while the key that IS set sits 300 lines away
- [dead-integrations] Four money-touching automations run every day and throw the email away — the on-switch was never set on any deployed function
- [dead-integrations] Server-side crash reporting is dark — the SDK is installed, the browser half is live, only the DSN is a placeholder
- [dead-integrations] Ten ready-to-run alert policies sit in the repo and zero are live, on a project where alerting is free
- [dead-integrations] The bot-blocker on the public lead forms is off at both ends — and its CDN host is already allowed by CSP
- [dead-integrations] '__unset__' is a truthy string, so three functions believe they are configured when they are not
- [dead-integrations] resolveAddress is deployed, rate-limited, App Check-gated, and structurally incapable of returning an address
- [dead-integrations] NBD_ESIGN_PROVIDER is a switch wired to nothing, and BoldSign behind it has no key either
- [dead-integrations] Three Slack triggers are deployed and mute — but a solo operator may not want a Slack workspace at all
- [dead-integrations] stripeConnectWebhook 500s every delivery — its signing secret is a placeholder
- [dead-integrations] Every provider switch in the codebase is running on its compiled-in default — no NBD_*_PROVIDER is set anywhere
- [ops-monitoring-zero-cost] Six of the ten alert files in monitoring/ physically cannot be deployed — Google rejects their filters
- [ops-monitoring-zero-cost] Nothing tells Jo when a function starts throwing — one free policy fixes that for every function at once
- [ops-monitoring-zero-cost] Error Reporting is already on, already grouping five months of failures, and nobody has ever opened it
- [ops-monitoring-zero-cost] The billing budget is live and firing — but only into a Gmail inbox, never to his phone
- [ops-monitoring-zero-cost] Both notification channels already exist and work — the last mile is not the problem
- [ops-monitoring-zero-cost] Jo is not actually at zero alarms — two homegrown ones are live and delivering email today
- [ops-monitoring-zero-cost] migrationsTick has silently not run since Aug 31 — and the policy meant to catch it is one of the six dead ones
- [ops-monitoring-zero-cost] Uptime checks are free at Jo's scale — but the one endpoint that matters would have passed green all four months
- [ops-monitoring-zero-cost] Healthchecks.io and Better Stack both lose to what Jo already has free — do not sign up
- [ops-monitoring-zero-cost] Do not create user-defined log-based metrics — they are the one chargeable option and the free system metric already covers it
- [missed-opportunities] Your storm-check page has never once shown the "official records show hail near you" line — CSP blocks it in production
- [missed-opportunities] Every review on the homepage and all 12 service pages is blank right now, and the robot that asks customers for reviews is in dry-run
- [missed-opportunities] Five finished money-recovery robots have been running every day since they shipped and silently doing nothing
- [missed-opportunities] Anyone can send email as jd@nobigdealwithjoedeal.com today — the domain publishes no anti-spoofing policy at all
- [missed-opportunities] Find out how many people actually tapped "Call" on your Google listing — free, on OAuth credentials the repo is already built to hold
- [missed-opportunities] Ten alarms are written, committed and switched off — including the one that would have caught the migration cron dying five days ago
- [missed-opportunities] The door-knocking tracker's weather panel needs a paid key you don't have and is CSP-blocked anyway — the free government one is already allowed
- [missed-opportunities] The CRM already knows every address you drove to this year but still makes you type the miles by hand

## Method

Each lane read the real files, returned its 8 strongest findings against a JSON
schema, and every finding was then attacked by three refuters with distinct
lenses — *reproduce* (trace the path, construct the failing input),
*already-handled* (find the guard, caller check, test or CI gate that prevents
it), and *citation* (does the cited line actually say what the finding claims).
Refuters were instructed to default to refuted when uncertain.

Both runs were seeded with the fourteen claims the 2026-09-03 session had
already disproved, plus the known-open list from that session's handoff, so
neither set reappears here as a new discovery.

## UPDATE 2026-09-04 (evening) — "8 stale functions" was wrong; they were orphans

The 2026-09-03 handoff said eight functions were *"three weeks stale"* and
that *"their live code is behind main."* Both halves are false, and the truth
is a worse problem with an easier fix.

`sendEstimateEmail`, `sendTeamInviteEmail`, `sendDripEmail`,
`auditCustomerDataIntegrity`, `backfillCustomerData`, `migratePinsToKnocks`,
`triggerProcessRecording` and `reprocessRecording` were **deliberately retired
from source** on 2026-08-06 and 2026-08-11 (the dead-surface and
tenant-lifecycle lanes, `d419bf76` / `c4eb886e`, Jo-approved). Their live code is
not behind main — it does not exist in main at all. `updateTime 2026-08-11` is
the retirement date, not evidence of drift.

They were never undeployed. They had been serving frozen code for four months
across many green deploys.

**Why no deploy ever removed them.** Firebase only detects an orphan on an
UNFILTERED `deploy --only functions`. This workflow names every target
explicitly (`--only functions:NAME` — its own comment above `_deploy_only()` says
so), and anything absent from that list is simply not considered. The comment
at `firebase-deploy.yml:626` claimed *"--force auto-confirms deletion of orphan
functions"* — describing something that structurally cannot happen here.
Corrected in place.

**A source comment was also lying.** `sendEstimateEmail`'s retirement note read
*"Prod instance deleted via console — see WEEKLY_CADENCE."* It had not been.

**Not a security incident, stated plainly.** Six of the eight were invokable by
`allUsers` at the Cloud Run layer, including a data migration and a
customer-data backfill. Every one was checked before that was characterised:
all are `onCall` with a real `request.auth` guard, and `triggerProcessRecording` /
`reprocessRecording` additionally require `role === 'admin'`. The `allUsers` binding
is the standard Firebase callable arrangement, not a hole. What they actually
cost was frozen dependencies, live secret bindings, and fleet count.

**Resolved.** All eight deleted 2026-09-04 on Jo's explicit instruction, after
confirming zero callers under `docs/` and that all eight were HTTP/callable with
no event triggers (so nothing could be orphaned downstream). Pre-delete state
captured first. Read back: all eight absent from `gcloud functions list`, their
underlying Cloud Run services gone too. **Fleet 179 → 171.**

That fleet number matters beyond tidiness: the 2026-09-03 CPU-quota analysis
was argued over service counts, and eight of the services in that count were
dead.

### The durable lesson

**Retiring an export does not undeploy it.** Deleting the code is half the job;
`gcloud functions delete <name> --region=us-central1` is the other half, and
nothing in CI does it or notices it was skipped. A retirement that does not
name the deletion as a separate, verified step leaves a live endpoint behind.

Still unbuilt, and the obvious next step: a post-deploy orphan detector that
diffs deployed function names against the exports in `functions/` and fails —
this was found by hand, and nothing would have found it otherwise.
