# Big-Fix Proposals — Homeowner QC Sweep 2026-06-11

> Every propose-only finding from Phases 1–4, ranked by homeowner/revenue impact.
> Nothing here was changed; everything inline-fixable was already fixed and committed.
> Evidence references: PHASE1-SWEEP.md, PHASE2-FUNCTIONAL.md, PHASE3-VISUAL.md,
> PHASE4-SEO-PERF.md, evidence/.

## P1 — revenue path

### 1. Estimator leads reach the CRM with no contact info (F-1)
- **Evidence:** `functions/handlers/integrations.js:153-158` — `estimate` kind allowlist =
  `address`,`source` (+UTM/referrer) only. Client sends firstName/lastName/phone/email/service/
  roofType/timeline/ballpark/estimateData — all silently dropped. Verified by walking the live
  funnel and diffing captured payload vs allowlist.
- **Why it matters:** these are the highest-intent leads on the site (completed funnel, verified
  phone). Today their contact info survives only in the transient notifyNewLead SMS/email and
  the `funnel_progress` side table. Miss the text → lead is an address with no human.
- **Fix:** extend the `estimate` allowlist (firstName 200, lastName 200, phone 30, email 200,
  service 200, roofType 50, timeline 50; optionally requestType/type 50 for the event records).
  Optionally have lead-bridge map them into the CRM lead.
- **Blast radius:** one server file + functions deploy. Client unchanged. Tests:
  `tests/public-intake.test.js` needs the new fields.
- **Effort:** S (hour incl. tests).

### 2. Public estimator under-quotes the CRM engine 24–39% on the headline tier (F-2)
- **Evidence:** homeowner PRICING (docs/assets/js/inline/4053149b2f.js:52) asphalt Better
  $420–520/sq flat; CRM locked spec $545/$595/$660 + pitch waste 1.12–1.25 + $2,500 min +
  $25 rounding (docs/pro/js/estimate-config.js, estimate-builder-v2.js, tests/estimate-pricing).
  Typical 20-sq home @6/12: site shows $8,400–$10,400; contract engine ≈ $13,685.
- **Why it matters:** the homeowner anchors on the low number; Joe walks in with one ~30%
  higher. Credibility hit at the kitchen table, or pressure to discount.
- **Options (Jo decides):** (a) raise public PRICING toward locked rates; (b) keep teaser but
  reframe ("most homeowners invest from $X…"); (c) accept knowingly.
- **Blast radius:** one PRICING table (ballpark + AI prompt + fallback all read it — good
  design, single edit). Copy framing optional.
- **Effort:** S for numbers, M if copy reframed.

### 3. /inspect: noindex AND sitemap priority 0.9 (P-SEO-1)
- **Evidence:** `docs/inspect.html:11` `noindex,follow` (present since page creation —
  deliberate QR-only design); `docs/sitemap.xml` lists it at 0.9 (added later). Lighthouse SEO
  69. Contradictory signals to Google.
- **Fix:** pick one. Index it (drop the meta — it's a strong "free roof inspection Cincinnati"
  page) or drop the sitemap line. One line either way.
- **Effort:** XS. Needs Jo's intent on whether /inspect is search-visible or print-only.

## P2 — trust & operations

### 4. "Email My Estimate" claims "Sent! Check your inbox ✓" — no email exists (F-4)
- **Evidence:** `emailEstimate()` (4053149b2f.js:954) flips the button text and saves a lead doc
  type `email_estimate_request`; zero server handlers for that type (searched functions/).
  Combined with #1, the saved doc doesn't even contain their email.
  Screenshots: `evidence/estimator-*-emailclaim-390px.png`.
- **Fix:** either wire a real email (Resend infra + template already exist in
  funnel-recovery.js) or change the claim to honest copy ("Joe will text/email it to you").
- **Blast radius:** small client change; email option adds one function.
- **Effort:** XS (copy) / M (real email).

### 5. Homepage form success gated on formsubmit.co, not the CRM write (F-3)
- **Evidence:** submitForm (72f02d79d0.js:95) — CRM capture is fire-and-forget; success card
  shows only if the external relay 200s. Verified both directions live: relay down → user told
  "something went wrong" even though the lead WAS captured (double-submit/duplicate-call risk).
- **Fix:** gate success on `submitPublicLead` result; treat the relay as the backup channel.
- **Blast radius:** one inline handler on index.html. **Effort:** S.

### 6. Template scaffolds shipped to production
- **Evidence:** `/our-work/_TEMPLATE-last-job` (publicly reachable; carries the site's ONLY dead
  links + 404 images: TODO-slug × 5) and `/sites/template` (robots-blocked but reachable).
- **Fix:** delete from docs/ (keep under dev/ or documentation/) — page deletion = Jo's sign-off.
- **Effort:** XS.

### 7. scripts/build-sitemap.js silently regresses the sitemap
- **Evidence:** running it produces 185 URLs vs live 195 — drops /inspect, /storm-check,
  /the-pledge, /free-roof, all 6 directory-based service pages, /areas/ + /blog/ hubs,
  /storm-report; adds private /pro + /pro/dashboard. Executes on ANY invocation (no arg guard) —
  confirmed in a scratch run this session (restored from git immediately).
- **Fix:** regenerate the generator from the current sitemap structure (CORE_PAGES list, dir-page
  support, hub entries, drop /pro) + add a `--write` guard.
- **Effort:** M. Until then: **nobody run it.**

## P3 — quality

### 8. Estimator results show roof tiers for non-roof services (F-5)
  Step-4 ballpark is service-aware; step-5 AI prompt + fallback are roof-only. A storm-damage
  walk ends on shingle tiers $8,400–$15,000 after a "$500–2,500 deductible" step 4 (evidence:
  `evidence/estimator-storm-typical-ai-*`). Fix: service-aware results (estimator logic — propose).
  Effort: M.
### 9. Estimator attribution + record hygiene (F-6)
  (a) never reads UTMs (paid-traffic attribution lost on the centerpiece tool — /inspect does it
  right, copy the pattern); (b) up to 4 `estimate_leads` docs per completion (confirm downstream
  dedupe); (c) `resetFunnel()` omits homeSize/insuranceClaim (benign; fallbacks catch). Effort: S.
### 10. Blog copy-paste defect (V-1 / brand-sweep N1)
  `/blog/how-much-does-roof-cost-cincinnati-2026` — intro under the byline is verbatim the
  hail-insurance post's opener, under a cost H1. Needs a rewritten intro in Joe's voice. Effort: S (Joe writes).
### 11. A11y design items (P-A11Y-1/2)
  Orange-on-navy CTA contrast (brand-token decision; #f08030 exists for this), no <main>
  landmarks, h4-after-h2 on storm-alerts, footer links color-only. Remaining ~6-12 a11y points
  on the baseline. Effort: M (template-level).
### 12. Tap-target pattern (Phase 3 #4)
  Breadcrumb/footer/announcement inline links 11–25px tall on phone across ~34 pages. One shared
  padding rule. Effort: S.
### 13. Image weight pass (P-PERF-1)
  8 images 324–556KB → WebP + srcset (~70% savings; /areas/mason-oh mobile LCP 3.5s benefits
  most). Image pipeline = propose-only. Effort: M.

## P4 / info
- Sub-11px fine print normalize pass (1–6 els/page).
- /free-roof intentionally chrome-less — confirm intent (carry-in N2).
- Blog-index Blog/ItemList schema nice-to-have.
- GAF swatch probes 404 by design (manifest would silence; cosmetic).
- External-link liveness (246 URLs/26 hosts) untestable from this environment — needs a
  network-enabled pass or manual spot-check.
- Live form round-trip (one ZZ_QA_ submit per form → Firestore → CRM bridge → delete) still owed
  for the same reason; client-side + server-allowlist verification done in Phase 2.
