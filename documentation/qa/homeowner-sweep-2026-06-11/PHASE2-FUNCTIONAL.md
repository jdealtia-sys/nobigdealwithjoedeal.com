# Phase 2 — Functional Deep QC (tools, forms, lead flow)

> Method: full interactive walks in headless Chromium (390px mobile-first) against the local
> Firebase-semantics server, with ALL external endpoints intercepted at the network boundary
> (geocoder, Cloud Functions, AI proxy, mesonet/NWS, formsubmit.co). Outbound payloads captured
> and inspected. **No request left the machine — zero real leads, zero SMS, zero subscriber
> records were created.** All test identities used the `ZZ_QA_` / `zzqa+…@` firewall convention
> anyway. CRM-arrival verification (live round-trip through the Phase C bridge) is NOT possible
> under this session's network policy — covered instead by payload-vs-server-allowlist code
> verification below; flagged for a live spot-check.

## What was exercised and PASSED

| Surface | Walks | Result |
|---|---|---|
| **Estimator** `/estimate` | roof-replacement (AI + AI-fail fallback), gutter-replacement, storm-damage; typical size; full 5-step funnel incl. OTP + TCPA consent + submit + results + tier switching | Funnel works end-to-end. Step-4 ballpark math verified exact vs the page's PRICING table ($8,400–$10,400 = $420–520 × 20 sq; storm = $500–$2,500 deductible framing). Fallback estimate renders with honest "live engine unreachable" note. OTP UI flow correct (mocked verify). Validation gates correct (submit disabled until name+phone+email+consent+verified). |
| **Storm check** `/storm-check` | full 6-step quiz → contact gate → verdict | Verdict + official-records data line render correctly from (mocked) IEM data; lead captured BEFORE result render; explicit "couldn't auto-save, call Joe" warning path exists; consent label proper ("I agree NBD can contact me… not a condition of purchase"). |
| **Storm report** `/storm-report` | happy path + API-500 variant | Teaser → gate → full report with event rows. API failure degrades gracefully (still offers inspection, still captures lead). |
| **Homepage contact** | formsubmit-OK + formsubmit-FAIL variants | Success UI shows on OK; CRM capture fires in BOTH cases. See F-3 below for the failure-UX finding. |
| **/inspect (+UTM)** | submit with `?utm_source/medium/campaign` | UTMs stamped into hidden fields and verified present in the captured payload → server allowlist passes them → **UTM integrity to the lead record: VERIFIED (code+payload)**. |
| **/storm-alerts** | invalid phone, invalid zip, valid submit | Bad 10-digit phone rejected ✓, bad zip rejected ✓, honeypot present ✓, "STOP to unsubscribe" present, payload shape matches server `storm` allowlist exactly (name/phone/zip/source/active). |
| **/free-roof** | nomination submit | Confirmation UX renders; payload matches `free_roof` allowlist. |
| **/review** | — | No form (reviews landing). QR/UTM tracking for reviews flows via the `/r` 302 which passes UTMs to Google per firebase.json — by design. |
| **Buttons/CTAs** | 41 pages (all uniques + 9 family samples) | **0 dead buttons, 0 dead anchors, 0 hook-less controls.** |

## FINDINGS — tabled for Jo (all propose-only territory)

### F-1 (P1) — Estimator lead record arrives in the CRM with NO contact info
`submitPublicLead` kind `estimate` allowlist (functions/handlers/integrations.js:153-158) accepts
ONLY `address` + `source` (+UTM/referrer). The estimator client sends firstName, lastName, phone,
email, service, roofType, timeline, ballpark, estimateData, requestType — **all silently dropped
server-side**. The `estimate_leads` doc (and anything lead-bridge builds from it) is an address
with no human attached.
Mitigations that currently save the day: (a) `notifyNewLead` SMS+email alert to Joe carries the
contact info — but it's transient, rate-limited (10/hr/IP), and not persisted; (b)
`saveFunnelProgress` persists name/phone/email into `funnel_progress` at email-blur. If the alert
is missed and nobody joins `funnel_progress` to the lead, **the lead's contact info is
effectively lost**. Recommended fix: extend the `estimate` kind allowlist (firstName, lastName,
phone, email, service, roofType, timeline + bounded lengths). Blast radius: one server file +
deploy; client already sends the fields. Effort: small. RISK OF DOING NOTHING: highest-intent
leads (completed the whole funnel, verified phone) are the ones affected.

### F-2 (P1) — Homeowner estimator pricing vs CRM engine: −24% to −39% on the headline tier
Homeowner tool: asphalt Better $420–520/sq, flat squares, no waste, no minimum, (page-internal
consistency is fine). CRM engines (estimate-config.js / estimate-builder-v2.js, locked spec):
**$545/$595/$660 per square + pitch waste (1.12–1.25×) + $2,500 min + $25 rounding**.
Typical example (20 sq footprint, 6/12 pitch → ×1.15 = 23 SQ):
| Tier | Homeowner tool shows | CRM engine produces | Gap |
|---|---|---|---|
| Good | $6,400–$7,600 | $12,535 | −39% to −49% |
| Better (headline) | $8,400–$10,400 | $13,685 | −24% to −39% |
| Best | $11,600–$15,000 | $15,180 | −1% to −24% |
A homeowner who anchors on $8,400–$10,400 and then receives a $13,685 contract quote is a
credibility problem in the kitchen. DECISION FOR JO: either (a) raise the public PRICING table
toward the locked rates (shrinks lead volume, raises lead quality + close-rate honesty), or
(b) keep teaser pricing deliberately low but reframe copy ("starting from…"), or (c) accept the
gap knowingly. NOT changed inline per fix authority — pricing copy decides what a homeowner is
told about price.

### F-3 (P2) — Homepage contact: success/failure UX gated on formsubmit.co, not on the CRM write
The CRM capture (`submitPublicLead('contact')`) is fire-and-forget "backup"; the user-visible
outcome depends entirely on the external formsubmit.co email relay. Verified live in both
directions: relay OK → success card; relay blocked → "Something went wrong, call Joe" alert EVEN
THOUGH the lead was captured (double-submit/duplicate-call risk, needless lost confidence). Also
the CSP `connect-src` must keep formsubmit.co forever. Recommend: make `submitPublicLead` the
primary gate for the success card; treat the email relay as the backup. Effort: small (one inline
handler), but it's form-handling logic → Jo's call.

### F-4 (P2) — "Email My Estimate" claims "Sent! Check your inbox ✓" but nothing sends an email
`emailEstimate()` (estimate page) sets the button to "Sent! Check your inbox ✓" and saves a lead
doc of type `email_estimate_request` — but **no Cloud Function handles that type and no email is
ever sent** (searched functions/: zero hits for `email_estimate_request` / `estimateSummary`).
Worse, combined with F-1, the saved record has no email address in it. Options: wire a real
email (Resend template exists in funnel-recovery), or change the button to "Joe will text it to
you" honesty. Evidence: `evidence/estimator-*-emailclaim-390px.png`.

### F-5 (P3) — Estimator results screen shows ROOF tiers for non-roof services
Step-4 ballpark is service-aware (gutters $2,400–$4,400; storm = deductible). But the step-5 AI
prompt + fallback are roof-only: a storm-damage walk ended on "3-Tab/Architectural/Designer
$8,400–$15,000" tier tabs after a step-4 "$500–$2,500 deductible" framing. Confusing jump for
every non-roof-replacement service (verified live on gutter + storm walks; evidence
`evidence/estimator-storm-typical-ai-*.png`).

### F-6 (P3) — Estimator never sends UTMs; 4 lead docs per completed funnel
(a) The `estimate` allowlist accepts utm_* but the estimator client never reads them from the URL
(unlike /inspect) — paid-traffic attribution on the centerpiece tool is lost. (b) One completed
funnel fires `submitPublicLead('estimate')` up to 4× (initial save, estimate_result, cta_click,
email_estimate_request) → 4 separate `estimate_leads` docs per homeowner; whatever dedupes
downstream should be confirmed. (c) `resetFunnel()` omits `homeSize`/`insuranceClaim` from the
fresh state object (first run defaults homeSize='typical', post-reset it's undefined) — benign
today because of `|| 'typical'` fallbacks, but the size tile becomes required only after reset
(inconsistent UX).

## Round-trip status (firewall log)
- Test records created in production: **NONE** (all endpoints mocked; network egress blocked).
- ZZ_QA_ cleanup required at Phase 5: **nothing to clean** unless a live form spot-check is run later.
- Live verification still owed (needs network or manual): one real `ZZ_QA_` submit per form
  → confirm doc in `contact_leads`/`estimate_leads`/`inspect_leads`/`storm_alert_subscribers`/
  `free_roof_entries` + bridge into CRM leads, then delete.

## Evidence
`evidence/estimator-*-step4-390px.png`, `evidence/estimator-*-results-390px.png`,
`evidence/estimator-*-emailclaim-390px.png`, `evidence/storm-check-result-390px.png`,
`evidence/storm-report*-390px.png`, `evidence/homepage-contact-after-submit-390px.png`,
`evidence/inspect-after-submit-390px.png`, `evidence/storm-alerts-after-submit-390px.png`,
`evidence/free-roof-after-submit-390px.png`.
