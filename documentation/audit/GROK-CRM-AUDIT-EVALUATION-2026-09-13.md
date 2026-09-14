# Grok Pro/CRM audit — evaluation, decisions, and outcome (2026-09-13/14)

Grok's private audit repo (`jdealtia-sys/nbd-audits-2026`) held a brand cut
list (already in flight as Lanes A–E of `NEXT_SESSION-2026-09-13.md`) and a
Pro CRM "freeze / containment spec." This note evaluates the CRM spec claim
by claim against the tree and production, records what Grok missed, records
Jo's decisions, and records the PR set and Jo's ops queue that closed it.

Grok's north star was accepted: **containment is the work — delete, freeze,
document; don't build.** Every code change below either fixes a defect on
the dogfood path, fixes a paying-seat break, makes a claim true, or removes
exposure. No new Cloud Function, collection, or engine.

**Method:** inline verification against `origin/main` (re-grepped, not
assumed — `main` had moved 13 commits since the evaluation began), then a
read-only workflow (56 skeptics over 28 verdicts, 33 gap findings from 6
finders with 2 refuters each, 3 independent planners). Skeptics narrowed 22
verdicts and overturned none outright; refuters confirmed most gap findings
and killed a few as stale or already-tracked. Three independent planners
(containment-first, Joe's-next-job-first, security-first orderings)
converged strongly on the same PR set — cross-validation, not three
separate opinions.

## Outcome (added 2026-09-14, after execution)

| PR | What | Where |
|---|---|---|
| [#1549](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1549) | Pro copy honesty — pricing/trial/demo/register/login/how-to/sandbox claims, ESX-export removal | `fix/pro-copy-honesty` |
| [#1550](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1550) | Team plan billing coherence, cap-blocked convert, access-code-over-live-sub guard | `fix/team-plan-billing-coherence` |
| [#1551](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1551) | Money-path honesty — invoice balance line, min-job hydration, deal-acceptance atomicity | `fix/money-path-honesty` |
| [#1552](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1552) | Customer-page photo uploads go through the durable queue | `fix/customer-photo-queue-durability` |
| [#1553](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1553) | `homeowner-uploads/` storage rule + `signImageUrl` allowlist | `fix/homeowner-uploads-storage-rules` |
| [#1554](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1554) | Nav/footer logo crop + resize (unrelated ask, same session) | `fix/nav-logo-crop-and-resize` |
| [#1555](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1555) | Security-docs accuracy — hosts, webhooks, worker status, `/pro/privacy` route, killswitch URL, CORS typo | `fix/security-docs-and-hosts` |
| [#1556](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1556) | Sentry release stamped with git SHA on every deploy | `ci/sentry-release-stamp` |
| [#1557](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1557) | Boot-weight containment — `maps-routing.js` + `talk-tank.js` made lazy | `chore/pro-boot-weight-containment` |
| this PR | Vault write-up (this note), `COST-ROTATION.md` runbook + worksheets, stale-doc corrections, handoff | `docs/grok-crm-audit-evaluation` |

**Deliberately not shipped in code**, per decision 9 below: gating the
voice-memo button behind a Deepgram-configured check. Secret Manager shows
`DEEPGRAM_API_KEY` with exactly one un-rotated version created 2026-04-14
(the same day the code first referenced the key) and 90 days of Cloud
Logging show zero real invocations of `transcribeVoiceMemo` — both
consistent with "still the deploy stub," neither conclusive without reading
the actual secret value. Flagged to Jo rather than guessed; see Part 3,
ops item 10.

Every new/extended test in the PRs above was proven able to fail against
the pre-fix tree (stash the fix, rerun, confirm the target assertion
reddens, restore) before being trusted — this repo's standing convention,
re-affirmed rather than assumed for each PR.

## Jo's decisions (2026-09-13) — do not relitigate

1. **Starter cap:** keep 50 leads; copy becomes "Solo operator. The same
   tools I run NBD on every day." No billing/Stripe change.
2. **Fake ESX export:** remove the dashboard button; function stays in
   `maps-routing.js`; add the honest line "Carrier estimates stay in
   Xactimate" where the drawing-tool exports live.
3. **Cost basis:** schedule the rotation. Claude prepares the three
   worksheets + runbook (`COST-ROTATION.md`, this PR); Jo fills real
   figures and runs the import in a live session. Ledger keeps
   `rotation: null` until then.
4. **Paid checkout:** self-serve Stripe checkout stays live. Distribution
   capped by not advertising. (Not a new call — consistent with a recorded
   2026-07-04 decision, `PILLAR1-PROVISIONING-PLAN.md:100`,
   `PILLAR4-BILLING-PLAN.md:55`.)
5. **Report/AI caps:** drop the counts from every pricing card ("Reports +
   AI assistant included, fair-use"). No metering built.
6. **Pro privacy:** 301 `/pro/privacy` → `/privacy` + an "NBD Pro software"
   section on `/privacy` (controller/processor sentence + missing
   processors). The June policy on `phase-d-build` is not revived.
7. **Public repo:** stays public this quarter; recorded in `SECURITY.md` +
   this note.
8. **Boot weight:** bundling explicitly deferred; take the two lazy moves
   (`maps-routing.js` → `drawtool` bundle, `talk-tank.js` → `talktank`
   bundle).
9. **Voice memo button:** check `DEEPGRAM_API_KEY`'s presence in Secret
   Manager first. If unset, hide behind the integration gate. If set,
   trace the real call path instead of hiding a working feature. **Outcome:
   inconclusive without reading the secret's actual value (this session
   does not do that) — flagged to Jo, not built either way.**
10. **Register copy:** reorder to pipeline → estimates → photos → property
    intel → door-knock map; fix the county-records claim.
11. **Review nudge:** flip `REVIEW_NUDGE_ENABLED=true` in
    `functions/.env.nobigdeal-pro`.
12. **Team plan:** fix the `nbd-auth.js` PLAN_LEVELS gap + the four server
    budget maps now.
13. **Sandbox tiers:** reopen the 2026-09-09 GBB-audit ruling that called
    this out of scope. Relabel the sandbox's 10/15/25-yr Good/Better/Best
    chips and the `/pro` landing alt text to Standard/Preferred/Elite
    lifetime language.

Standing (from prior briefs, unchanged by this pass): no `TURNSTILE_SECRET`;
seat add-on stays dark; no FLUX; Pro stays on this domain; no ROCK 2
deletion before the 30-day zero-Sentry-warn clock (~2026-09-30) and Jo
naming it.

## Part 1 — Verdicts on Grok's CRM claims

| # | Grok said | Verdict | What is actually true (skeptic-corrected) |
|---|---|---|---|
| 1 | `/pro` hero sells Free + Enterprise only | Wrong, never true | Five cards at `docs/pro/index.html:1717-1823` since #1010; hero names no tier; JSON-LD offerCount 5. |
| 2 | Starter "exact setup I run my business on" vs 50-lead cap | Real (structural), **fixed #1549** | `pricing.html:147` (1st person) + `index.html:1746` (3rd person). Joe carries `owner:true` → enterprise defaults, so he is never on Starter's setup. Non-owner cap is a client-only hard stop on new-lead creation; server `trackUsage` never blocks. |
| 3 | Trial FAQ says Growth only; Team+Growth CTAs | Real, wider, **fixed #1549** | Code: both tiers get `trial_period_days:14`, card collected. Stale Growth-only copy across four files. |
| 4 | billing-gate header + ARCHITECTURE omit Team | Real, and executable, **fixed #1550** | `nbd-auth.js` PLAN_LEVELS omitted team → `_normalizePlan('team')` = `'free'` → walled Team off 7 pages + showed the free banner. Four server budget maps also omitted team → Team got the free allowance. |
| 5 | `/pro/privacy` 404; need software policy | Partial — scope not routing, **fixed #1555** | Nothing linked `/pro/privacy` (footers already went via `/privacy.html` → 301 → 200), but `/privacy` was scoped "Website" and missed Groq, Deepgram, Replicate, Google Maps/Nominatim/Census, Upstash, Thumbtack. |
| 6 | `functions/.env.nobigdeal-pro` public — rotate | Not a risk | One non-secret key, header says so. Right place for `REVIEW_NUDGE_ENABLED` — **added #1550**. |
| 7 | Xactimate catalog public w/ mat+lab; confirm coverage | Covered; leak real by the repo's own ledger | `catalog-cost-privacy.test.js` clean, but `cost-basis-ledger.js` shows all three catalogs `rotation: null` — worksheets + runbook now prepared (this PR), rotation itself is Jo's. |
| 8 | `nbd-ai-proxy` still live | Real, and wider | Cloudflare account holds **four** workers, not one. Empty-Origin CORS bypass on `nbd-ai-proxy` confirmed live. Two "deleted" in a prior audit are actually route-disabled, not deleted — **corrected this PR** in `REMOTE-BRANCH-CLEANUP-2026-09-05.md` and `INDEX.md`. |
| 9 | Nightly backup + 7 dead exports may still be live | Stale | Deleted by hand 09-04/09-05; `check-function-orphans.js` runs on every deploy; fleet matches code exactly. **`FUNCTIONS_INDEX.md`'s "console deletion queued" note corrected in a prior PR (#1555's predecessor pass on that file).** |
| 10 | `onRepSignup` exported but never deployed | Wrong | It IS deployed and active; never *invoked* because the GCIP blocking-function registration 400s on every deploy. Corrected in `FUNCTIONS_INDEX.md`. |
| 11 | Confirm orphan sweep + pdf-renders tokens | Done, with a residual | `pdfRenderRetention` running; prefix absent from the bucket. Residual: bucket versioning with no lifecycle rule leaves noncurrent generations (unfetchable, 403 both ways). |
| 12 | Sentry release stamp stale | Real, **fixed #1556** | Placeholder tag since PR #81; now stamped `web@<date>-<sha>` on every deploy, runner-local only. |
| 13 | Extra hosts; SECURITY.md lists `nbd-pro.web.app` | Real w/ corrections, **fixed #1555** | Three live origins are apex, `nobigdeal-pro.web.app`, `nobigdeal-pro.firebaseapp.com` (authDomain). `nbd-pro.web.app` never existed — the typo also survived in two functions' CORS allowlists, fixed. |
| 14 | Seat add-on dark | Server-dark, client-visible | Gate holds server-side, but the stepper shows to every card-billed owner and fails with a server toast rather than staying hidden. Corrected in `SEAT_BILLING_ACTIVATION.md` (this PR). |
| 15 | Wire reviews to Joe's GBP | Done same day (#1545) | Places secrets live 09-13; `/api/google-reviews` returns 29 reviews, 5.0. |
| 16 | Register copy leads D2D/Ask Joe/Daily Success | Half right, **fixed #1549** | Real lead order was different from the brief; also `register.html` still claimed "from county records" — fixed. |
| 17 | Don't imply ESX | Grok under-called it, **fixed #1549** | Dashboard button wrote an invented `<XactimateClaim>` XML `.esx` and toasted "import into Xactimate." Removed; honest line added. |
| 18 | ROCK 2: 3 engines; wait 30 days | Real, PR status stale, **corrected this PR** | `BIG_ROCKS.md` said "PRs 3-5 remaining" — actually PRs 2-5 are ALL done; only PR 6 part 2 (delete the classic wizard + a read-only pre-V2 viewer) remains. Clock from the 08-31 deploy → earliest 2026-09-30. `NBD_ENGINE_V2` flag prescribed in the doc never existed. |
| 19 | "500+ contractors" unverifiable | Real, brand lane | `docs/sites/free-guide/index.html`, ×4, plus "$2M" — not under `/pro`, Lane C territory, not this evaluation's scope. |
| 20 | 263 files / 8.01 MB; 170 deployed | Grok exact for its scope | Functions re-enumerated: 208 keys = 184 deployed + 24 helpers, cross-checked against `check-function-orphans.js`'s own live count — corrected in `FUNCTIONS_INDEX.md`. |
| 21 | Free includes 186 themes; load-time tax | Half stale | No plan gate (10 achievement-locked, 176 usable). "Load tax" stale since #1194 — theme bundle is lazy, but boot-fetched for anyone with a saved theme. |
| 22 | `measureNewWebLead` only spender; flag exists | Narrow-true, **corrected this PR** | Only spender of the $3 measure, never executed. Two OTHER unattended metered triggers (`onAudioUploaded`, `onPortalMessageDraft`) have no kill switch at all — now documented in `SPEND_KILLSWITCH.md`. |
| 23 | FLUX flag default OFF | Code-default OFF, **corrected #1555** | `visualizerImageGen`'s rate limit was documented as 15/hr — actually tightened to 5/hr after launch; model description now names the two-tier pro/max split. |
| 24 | (brand) www serves stale copy | Stale by 4 weeks | www → 301 apex since #1217. |
| 25 | Sandbox = pipeline + 8 themes | Plus a static tier picker, **fixed #1549** | Tier labels used the retired 10/15/25-yr model — relabeled to Standard/Preferred/Elite lifetime. |
| 26 | `homeowner-uploads/` no rules block | Real, plus a re-sign gap, **fixed #1553** | Fell to catch-all deny; the rep gallery lost homeowner photos after the 7-day signed URL (the homeowner portal itself already re-signs). |
| 27 | Keep paid invite-shaped | Decision → keep self-serve | Access codes + Stripe checkout both live. |
| 28 | D2D vs homeowner brand | Decision → Pro pages only | D2D never on homeowner pages. |

## Part 2 — What Grok missed (verified by two refuters each unless marked)

**Honesty (customer/prospect-facing) — all fixed in #1549 unless noted:**
- Fake ESX export (row 17).
- Cap modal said "we won't lock you out mid-cycle" while `enforceGate`
  hard-blocked new leads — reworded.
- Report/AI-call caps on every pricing card were never metered — dropped
  per decision 5.
- `demo.html` "9 e-sign ready" / "expire after 7 days" (code: 3 and 14);
  A2P one-time-registration copy (still roadmap); Growth-only trial copy.
- `how-to.html` claimed signing auto-advances the lead stage + pushes a
  notification — no code did either; removed.
- `sandbox.html` sold retired 10/15/25-yr tiers.
- `login.html` "Live lead pipeline with real data" — it's the seeded DEMO
  account; reworded to "sample data".
- In-app "Looking up county records…" strings across six files while the
  pull is an AI estimate (Regrid token is a stub) — reworded to "Estimating
  property profile…".
- Grok credited Turnstile + the new-device Slack alert as working
  controls; both are dark (Turnstile secret unset by design, Slack webhook
  unset AND its one client caller removed) — corrected in `SECURITY.md`
  (#1555).

**Paying-seat correctness — fixed in #1550 unless noted:**
- Team plan breaks (row 4).
- D2D `convertToLead` discarded `_saveLead`'s null at the cap, stamped the
  knock converted and toasted success anyway — now bails on null.
- Access-code grant merged over a live Stripe sub with no guard — now
  refuses when the existing doc has a live `stripeSubscriptionId`.
- Seat stepper visible-but-broken (row 14, corrected in doc only —
  see `SEAT_BILLING_ACTIVATION.md`; no code fix scoped here since the
  failure mode is a safe, visible toast, not silent data loss).

**Dogfood path (Grok §20) — fixed in #1551/#1552 unless noted:**
- Emailed/printed invoice printed "Deposit due $X" then "Balance Due:
  $total" from a condition that was always true — **fixed #1551**.
- Reopening a minimum-job estimate dropped the "Minimum Job Charge
  Adjustment" row — **fixed #1551**.
- `submitDealAcceptance` burned the single-use token, then warn-swallowed
  the `deal_rooms` write and returned ok — **fixed #1551**, both writes now
  share one transaction.
- Customer-page photo uploads bypassed the durable queue — **fixed
  #1552**.
- Installed-PWA link interceptor cancelled `blob:` download anchors —
  CSV/backup exports failed silently in the home-screen app. Not fixed
  this pass (materiality: standalone-only, backup-exports-only) — flagged
  for a follow-up, not built. **Correction, 2026-09-14 later same day:**
  fixed anyway, as a drive-by in PR #1552 / commit `adc6a48` (that PR's
  own item 4) — see `NEXT_SESSION-2026-09-14.md` §1 item 2.
- Not proven in production this pass (Jo's ops queue, Part 3): any
  `[renderPdf] ok` log line; any real invoice → payment-link → paid loop.

**Security/ops — fixed in #1555 unless noted:**
- Four Cloudflare workers (row 8); empty-Origin bypass on the live proxy.
- Monitoring: closed by another session the same evening (#1547,
  docs-only) — not this evaluation's work.
- `homeowner-uploads/` rule + `signImageUrl` allowlist (row 26) — **fixed
  #1553**.
- `SECURITY.md` in-scope webhooks omitted `swathWebhook`,
  `thumbtackWebhook`, `stripeConnectWebhook` — added.
- New-device Slack alert dead twice over (stub secret + removed client
  caller) — documented as dark, not resurrected.
- `README-killswitch.md`'s per-user URL never reached the kill code — the
  auth redirect drops the query string before `offline-manager.js` ever
  sees it — corrected to `/pro/dashboard.html?nosw=1`; the third blind
  spot (`pages/sw-register.js`, the only one of three registration sites
  that had never honored `?nosw=1`/`nosw.txt`) fixed alongside.
- Voice-memo button — decision 9's outcome above; flagged, not built.

**Doc drift (this PR):** `ARCHITECTURE.md` (E2E "continue-on-error" —
false, six shards block since 2026-08-26; CSP Phase 6 — done; admin ^13 —
actually ^14, peer-block resolved; function count — 148 → 208);
`BIG_ROCKS.md` (123-suite count stale — read the manifest's own FLOORS
constant instead; PR 3-5 status — see row 18); `SEAT_BILLING_ACTIVATION.md`
(self-hides claim — see row 14); `REMOTE-BRANCH-CLEANUP-2026-09-05.md` +
`INDEX.md` (two workers "deleted" — actually route-disabled, still exist);
`NEXT_SESSION-2026-09-13.md` Lane D line (Places secrets — done same day);
`functions/portal.js`'s stale re-sign comment (left as a follow-up, not
chased this pass); `NBD-PRO-PRODUCT-AUDIT-2026-07.md` (trial note — see
row 3).

**Freeze-list measurement (no build) — fixed #1557:** `dashboard.html` was
measured at 135 static tags / 3,134.3 KiB against `main@665dd408` (its own
09-13 measurement of 135/3,068.8 KiB had already drifted +65.5 KiB across
13 more commits). `maps-routing.js` (171.6 KiB, #2 largest static file) and
`talk-tank.js` (14.8 KiB) both moved to lazy `ScriptLoader` bundles,
verified safe three ways (existing `waitForMapFn` poller, no cross-file
top-level dependency, a vm-sandboxed dry-run with no Leaflet global
defined) — see `documentation/audit/BOOT-WEIGHT-2026-09-06.md`'s
2026-09-14 section for the full before/after and the one real gap it
caught (a bare, unguarded `drawMap` read).

Grok's "largest 20 files" list mixed lazy and static files without
distinguishing them; annotating it here rather than re-deriving a fresh
top-20: of the files Grok's own audit named as large, `maps-routing.js`
(now lazy, this pass), `maps-core.js`/`maps-overlays.js`/`maps-customers.js`
(static — part of the eager maps chain, load-bearing for the theme/font
engine that shares their scope), and the doc-generation/estimate-engine/
academy/training clusters (already lazy via `ScriptLoader` bundles well
before this evaluation) sit on opposite sides of that line; a byte count
alone can't tell them apart without checking `script-loader.js`'s
`BUNDLES`/`VIEW_BUNDLES` maps, which is what this evaluation did file by
file rather than trusting the raw ranking.

## Part 3 — Jo's ops queue (only Jo can do; evidence of done in brackets)

1. **Cloudflare, this week:** delete all four workers (`nbd-ai-proxy`,
   `nbd-ai-visualizer`, `nbd-mailerlite`, `nbd-stripe-webhook`) and rotate
   the Anthropic key `nbd-ai-proxy` binds (the original, never rotated).
   [Re-run `workers_list` → 0 NBD workers; probe returns the 404/17B
   control for all four.]
2. **Cost rotation live session:** worksheets + runbook are ready
   (`documentation/runbooks/COST-ROTATION.md`, `.local/rotation-*.json`,
   this PR). Fill real figures, apply, import, paste the printed record
   into `tests/cost-basis-ledger.js`. Labor (66 rows) first if time is
   short. [Guard stops printing "ROTATION OUTSTANDING — 3 of 3".]
3. **renderPdf proof:** render one estimate PDF from the live dashboard;
   check Cloud Logging for `[renderPdf] ok`. [Log line exists.]
4. **One real invoice:** create → send → pay a $1+ invoice on a real job;
   read `invoices/{id}.status === 'paid'`.
5. **Monitoring:** done 09-13 evening by another session (#1547) — nothing
   left here beyond merging it if not already merged.
6. **Stripe prices:** confirm `STRIPE_PRICE_FOUNDATION/TEAM/PROFESSIONAL`
   resolve to live recurring prices (one Team test checkout).
7. **Grok §20 dogfood:** last 10 real NBD jobs in the live dashboard, five
   checks each. Failures become the only backlog after this evaluation.
8. **Brand lane, not this evaluation's scope:** "500+ contractors" ×4 and
   "$2M" on `/sites/free-guide` (Lane C territory).
9. Optional: `SLACK_WEBHOOK_URL` if the new-device alert is wanted;
   otherwise it stays documented as dark.
10. **Deepgram check:** `gcloud secrets versions access latest
    --secret=DEEPGRAM_API_KEY | head -c 9` compared against `__unset__`
    (never print the real value). Circumstantial evidence from this
    session (one un-rotated Secret Manager version from 2026-04-14, zero
    real invocations logged in 90 days) leans "still the stub" but isn't
    conclusive. If unset → hide the voice-memo button behind the
    integration gate. If set → the button should already work; trace the
    real call path instead of hiding a working feature.

## Part 4 — Explicitly deferred / do not do

- Bundler / esbuild (decision 8: deferred, recorded). No framework
  rewrite.
- ROCK 2 PR 6 part 2 (classic-wizard deletion) before ≥2026-09-30
  zero-Sentry-`[estimates.js DEPRECATED]`-warn AND Jo naming it; then with
  the pre-V2 read-only viewer.
- Seat add-on activation; FLUX on; `TURNSTILE_SECRET`; `syncGbpReviews`
  OAuth (five secrets); the Deepgram key (pending item 10 above).
- Any new Cloud Function, Firestore collection, or `docs/pro/js/*.js` file
  this evaluation didn't already list (test files only, beyond that).
- More appearance/theme/academy/D2D/AI-surface work.
- Second domain, Lexington, next Oaks, contractor blog posts.
- Reviving the June Pro privacy policy (decision 6); metering reports/AI
  (decision 5).
- ~~Wiring `onAudioUploaded` / `onPortalMessageDraft` into
  `feature_flags/global`~~ — **done**, PR #1560 (`voiceIntelDisabled` /
  `portalDraftDisabled`, mirroring `webLeadMeasureDisabled`).
- ~~The installed-PWA `blob:` download-interceptor fix~~ — **done**, PR
  #1552 / commit `adc6a48` (see correction above).

## Evidence commands (no secret values printed)

```bash
# Function fleet vs code
node scripts/check-function-orphans.js

# Accurate deployed/helper split
GCLOUD_PROJECT=nobigdeal-pro node -e "
  const idx = require('./functions/index.js');
  const keys = Object.keys(idx);
  let deployed=0, helper=0;
  for (const k of keys) { if (idx[k] && idx[k].__endpoint) deployed++; else helper++; }
  console.log('total', keys.length, 'deployed', deployed, 'helper', helper);
"

# Cloudflare worker status (read-only)
# via the Cloudflare MCP: workers_list, workers_get_worker per name

# Boot-weight tag count/bytes (see documentation/audit/BOOT-WEIGHT-2026-09-06.md
# for the full measurement script this evaluation used)

# Secret existence WITHOUT reading its value
gcloud secrets versions list <SECRET_NAME> --project nobigdeal-pro
```
