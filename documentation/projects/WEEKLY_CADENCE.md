# Weekly Cadence — the Monday-morning note

> **Standing note — open this every week** (created 2026-08-10, consolidated
> from the local-SEO playbook, MANUAL-FOR-JO, and the session handoffs; those
> stay the source docs, this is the working checklist). Sessions: keep this
> note current — when a one-off below gets done, check it off here AND note it
> in the next session handoff; when a new recurring task appears, add it here.
>
> How to use in Obsidian: duplicate the "This week" block into your daily
> note, or just check boxes here and un-check them Monday.

---

## This week — Jo (≈45 min total, phone is fine)

### Content & marketing (the highest-leverage 30 minutes — [playbook](../marketing/local-seo-playbook-2026-07.md))

- [ ] **1 GBP post** (Tue/Wed morning). Rotate: seasonal/storm tip → finished-job
      photo → offer/proof. Four ready-to-paste drafts live in the
      [citation kit](../marketing/citation-kit-2026-07.md). Attach 1–3 real job
      photos; button = "Call now" or link `/inspect`.
- [ ] **2–3 job photos → GBP** with the town in the caption ("Roof replacement
      in Mason, OH") — same shots the /our-work pipeline uses.
- [ ] **Post completed jobs to the site** — paste the phone template from
      [PUBLISH-PROJECT](../runbooks/PUBLISH-PROJECT.md) into a Claude session,
      one per job. It lands on /our-work AND the matching service page strip
      (labeled by service — roof repair vs replacement, siding, gutters,
      storm). Siding/gutter/repair strips are running on empty-state CTAs
      until you feed them — the first siding job you post lights that page up.
- [ ] **Review asks**: at every completed job ask in person, then text the `/r`
      QR link same-day (CRM texting panel). Steady 2–4/month beats bursts.
- [ ] **Reply to every new review within 48h** — including old ones and bad
      ones; response rate is a ranking input and sales copy.
- [ ] **One citation claim** (until the list is done): follow the sequenced
      sprint in [rush-week-2026-08](../marketing/rush-week-2026-08.md) with the
      exact NAP block from [citation-kit](../marketing/citation-kit-2026-07.md).
      Day 1–2 first: GAF locator, TAMKO Pro Gold locator, James Hardie, Bing
      Places + Bing Webmaster Tools, Apple. Then append each live profile URL
      to the site's `sameAs` (procedure in the rush-week doc).
- [ ] **Search Console glance**: impressions/clicks on "roof repair covington",
      "roofing companies mason oh", the shingle-comparison cluster.

### Site & prod watch (5 min, until each gate clears)

- [ ] **Prod deprecation log**: zero `[estimates.js DEPRECATED]
      startNewEstimateOriginal` warns = classic-wizard deletion gate
      ([BIG_ROCKS](BIG_ROCKS.md) Rock 2). A `calcTierPrices` hit only means a
      rep reopened a pre-V2 doc.
      *(2026-08-31 correction — where to look and when the clock starts:
      until today these warns NEVER left the rep's browser — Sentry had no
      console capture, so a solo `console.warn` only rode along as a
      breadcrumb if an unrelated error fired. "Zero warns" was vacuous.
      Fixed: `_warnDeprecatedOnce` now also ships a real Sentry **warning
      event**. Check Sentry → Issues, filter `estimates.js DEPRECATED`.
      The 30-day zero-warn clock starts at this fix's deploy date, not
      earlier.)*
- [ ] **`/cspReport` sink skim** (Cloud Logging) — STEP 0 of the
      [CSP generated-docs audit](../../docs/dev/csp-generated-docs-audit.md).

## This week — agent session (kick one off and paste this list)

- [x] Run the cheap drift gates and report:
      `apply-partials --check --diff` · `build-projects.mjs --check` ·
      `build-sitemap.js` (dry-run) · `check-site-integrity --quiet` ·
      `check-inline-html-scripts` · `marketing-polish-contract.test.js`
      *(2026-08-10 audit session: all green at baseline and post-fix; a new
      gate joined the list — `check-image-privacy.js`)*
      *(2026-08-31 sweep: all 8 gates green at baseline; staged dates none;
      dependabot #1301/#1302 merged 19/19 green; both visible main-CI reds
      were the already-diagnosed pair — no new rot. Full record:
      [SESSION-2026-08-31](SESSION-2026-08-31-sweep-rocks-and-four-cards.md).)*
- [x] **~~Check main's CI streaks for the advisory jobs~~ BAR REACHED —
      FLIPPED 2026-08-26 (PR #1279).** (`@engines` shard, `public-e2e`,
      `visual-brand-tokens`, `visual-regression` — the rest of authed-E2E
      is already REQUIRED): ~10 green runs → open the
      `continue-on-error` flip PR ([handoff](NEXT_SESSION-2026-08-07.md)).
      *(2026-08-10: streak is 3/10 — all job-level green since #1194; not
      ready, keep counting)*
      *(2026-08-26: streak is **8/10** — job-level conclusions pulled for all
      8 main runs since the 08-19 Playwright-CDN cancellations (#1268 →
      #1276): all four advisory jobs green in every one. The cancellations
      reset the count on purpose — a required job that hangs on a CDN stall
      is a blocked merge, which is exactly what the streak bar is protecting
      against (#1269 since capped that risk at 20 min). Two more green main
      merges reach the bar.)*
      *(2026-08-26, later: #1277 and #1278 both merged with all four
      advisory jobs green at job level — **10/10, bar reached**. The flip
      PR removes ALL FIVE `continue-on-error` flags in ci.yml: the four
      ledgered jobs above PLUS `qc-render-sweep`, which shipped 2026-08-18
      with its own "promote once it has a green streak" note in ci.yml and
      is green on every completed main run since introduction, including
      the entire post-cancellation window this ledger was recounted over
      (9 completed runs checked #1263→#1278, 9 green). Every job in ci.yml
      is now blocking; the advisory tier is empty. If a promoted job starts
      flaking, the doctrine holds: fix the race at the source — re-parking
      a job requires recording WHY in ci.yml, as the @stranger note does.)*
- [x] Any staged `published` date passed? *(2026-08-10: none)*
- [x] Any red PR / open post-a-job request from Jo? Land it.
      *(2026-08-10: dependabot #1196 green → merged; issue #546 verified
      long-done → closed; tracker at zero)*
- [x] **~~Lead address audit workflow is red daily~~ DIAGNOSED 2026-08-26 —
      now a Jo item.** The "missing Actions secret" guess above was wrong
      twice over: an unset secret makes the workflow skip *green*, and the
      red is the audit **correctly failing** on the same 4 records it
      inventoried the day it shipped. Record IDs, fix paths and the 08-25
      trendline:
      [CRM-ADDRESS-INTEGRITY-2026-08-18](../audit/CRM-ADDRESS-INTEGRITY-2026-08-18.md)
      §2026-08-26. Moved to Jo's one-off queue below; agent lane closed.
- [x] **~~firebase-deploy wholesale-guard misclassification~~ FIX SHIPPED
      same night (2026-08-26)**: chunk 2 of 3 lost exactly one function to a
      GCP transient — `onAiDraftApproved`'s Cloud Run operation poll hit
      "Deadline Exceeded", so the CLI reported the failure only as a
      trailing "Functions deploy had errors with the following functions:"
      block, with no per-function ✖ line. The guard's regex missed that
      shape → recorded WHOLESALE ("nothing or almost nothing was deployed")
      while 166/167 functions verifiably updated. The fix parses that
      trailing block into the parsed-failure set, so the shape now feeds
      the straggler retry instead of a fatal wholesale record; 3 new F-10b
      "mode 1b" test pins; parse simulated against the actual run-32925767669
      bytes plus loud-failure/dedupe, genuine-wholesale, and codebase-prefix
      shapes. Details: [DEPLOY-FALSE-GREEN-MODES-2026-08-17](../audit/DEPLOY-FALSE-GREEN-MODES-2026-08-17.md)
      §2026-08-26.

---

## One-off queue — Jo (decisions & console; newest first, check off here when done)

- [ ] **Grant `roles/iam.serviceAccountTokenCreator` on the compute SA (~2 min,
      GCP Console → IAM)** — the same item as the older "IAM fix" below, now
      the highest-leverage console task there is: `signImageUrl` has no
      fallback without it, so the public-photo-token fix (every photo variant
      carries a permanent public URL) cannot start until it lands. Then tell a
      session; it probes `POST /signImageUrl` and starts the cutover.
      Context: [NEXT_SESSION-2026-09-03](NEXT_SESSION-2026-09-03.md).
- [ ] **Turn on branch protection for `main` (~2 min)** — verified OFF on
      2026-09-02 (`gh api …/branches/main/protection` → 404, no rulesets), so
      CODEOWNERS enforces nothing and every merge deploys immediately.
      Require at least the `Smoke tests` and `Firestore rules tests` checks.
- [ ] **Cloud Storage backup (OPS_AUDIT P0 #2)** — Object Versioning on
      `nobigdeal-pro.firebasestorage.app` + a daily Storage Transfer to a
      second bucket; photos and signed contracts are unrecoverable today.
      Also: which of the two Firestore backup buckets is canonical
      (`nobigdeal-pro-backups` vs `nobigdeal-pro-firestore-backups`)?
- [ ] **Free-API wave 1 prerequisites (all free)** — Healthchecks.io and
      Better Stack accounts; a Census API key (instant); enable the Solar API
      on the GCP project; **start Meta App Review** for Lead Ads and the
      **GBP API access request** now (both have review queues). Optional:
      an ArcGIS Location Platform free key.
      Context: [FREE-API-INTEGRATIONS-RESEARCH-2026-09-02](../audit/FREE-API-INTEGRATIONS-RESEARCH-2026-09-02.md).
- [ ] **Which payment handles belong on invoices?** Zelle is deliberately
      `info@`; PayPal/Venmo are absent. Needed before the invoice block is touched.
- [ ] **Copycat watch: optionally enable the code-search channel (~3 min,
      or decide to skip)** — the monthly watch's first fire (2026-09-01)
      proved the built-in Actions token cannot run global code search, so
      that channel is now gated on a `COPYCAT_CODE_SEARCH_TOKEN` repo
      secret: GitHub → Settings → Developer settings → classic PAT with
      **no scopes** → repo Settings → Secrets → Actions. Skipping is
      legitimate (weakest channel; forks/stars/watchers/repo-name stay
      fully watched) — the run summary simply names it OFF each month.
      Context: [PUBLIC-REPO-COPY-POSTURE-2026-08-31](../audit/PUBLIC-REPO-COPY-POSTURE-2026-08-31.md)
      §2026-09-01.
- [x] **~~🔴 UNBLOCK PROD DEPLOYS~~ RESOLVED 2026-08-11 ~01:47 UTC.**
      Post-mortem: the hosting-storage `429` was a SYMPTOM — the real root
      cause was **billing disabled on the `nobigdeal-pro` GCP project**
      (lapsed ~2026-08-08/10), which dropped the project to free-tier
      limits: the 1 GB release-storage cap killed deploys, and the daily
      bandwidth cap caused the glitchy half-loaded live pages. Jo set
      release retention AND restored billing; deploy run #1284 attempt 3
      then went green end-to-end (hosting + rules + all functions — first
      live pass of the wholesale-failure guard). **Standing lesson: if
      deploys 429 or the site half-loads, check GCP billing first.**
      Billing notices did not reach the monitored Gmail — while in the
      console, confirm the billing account's contact email + card expiry.
- [x] **~~Clear the address-audit gate~~ DONE 2026-08-27, Jo-delegated to a
      session.** The four $0 leads retired (recoverable soft-delete, reason
      stamped); Galfrey turned out to be blocked by a one-letter road-name
      typo (Murdoch → **Murdock**) — corrected, geocoded unambiguously, and
      written FULLY mailable (`10595 Cozaddale-Murdock Rd, Goshen, OH
      45122`), not just state-patched. Replicated gate scan confirms
      `legacyMangled: 0, blank: 0` → the 11:00Z fire self-greens.
      Details: [CRM-ADDRESS-INTEGRITY-2026-08-18](../audit/CRM-ADDRESS-INTEGRITY-2026-08-18.md)
      §2026-08-27.
- [ ] **Delete the 7 retired functions in the Firebase console (~3 min)** —
      code retired 2026-08-11 (Jo-approved, dead-surface lane): Console →
      Functions → delete `sendEstimateEmail`, `sendDripEmail`,
      `triggerProcessRecording`, `reprocessRecording`,
      `auditCustomerDataIntegrity`, `backfillCustomerData`,
      `migratePinsToKnocks`. They're auth-gated meanwhile; deleting stops
      the idle billing + attack surface. (Deploys don't remove them — the
      CI deploy targets only current exports.)
- [ ] **Re-enter your cost basis in Estimate Settings (~1 min, now that the
      2026-08-10 audit PR is deployed)** — the three v2cost fields (good/
      better/best per-SQ). The real numbers were removed from the public
      code ([audit](../audit/SITE-AUDIT-LOOSE-ENDS-2026-08-10.md) §6);
      until you enter them the Internal View margin shows an em-dash. If
      you ever saved V2 settings on your phone, your saved values carry
      over — nothing to do.
- [ ] **Swath activation (~5 min, most time-sensitive)** — signup, set
      `SWATH_API_KEY` + `SWATH_WEBHOOK_SECRET`, optional provider flips —
      [SWATH-SETUP](../runbooks/SWATH-SETUP.md)
- [ ] **Turnstile, in this order**: mint sitekey → populate
      `docs/assets/js/inline/7cd8e505ab.js` → deploy → THEN set
      `TURNSTILE_SECRET` (reverse order 403s every public lead)
- [x] **~~Bless the 12 visual-regression baselines~~ DONE 2026-09-02 (#1349)**
      — a session downloaded the artifact, viewed all 12, committed them, and
      pinned the matrix in smoke; the job compared for the first time on that
      PR. (Found on the way: the login page overflows at 375/768 — fix and
      re-bless together.)
- [ ] **First priced project on /our-work** (~10 min) — all 12 seed cards are
      unpriced; also confirm the agent's service labels on the 2 commercial
      apartment entries + the A-frame metal roof (labeled roof-replacement
      for now) — [PUBLISH-PROJECT](../runbooks/PUBLISH-PROJECT.md)
- [ ] **Backfill real cities on the 12 seeds** ("Greater Cincinnati, OH" ×11 →
      real towns where consent allows)
- [ ] **Edit the 2 remaining blog drafts** — `JO:` markers (photos, storm
      anecdote, report screenshots) — [drafts README](../drafts/README.md);
      each cleared post = one agent publish session *(was "3 drafts": the
      financing post published 2026-08-17, PR #1224; corrected 2026-08-25)*
- [ ] **TAMKO real pricing** — 8 SKUs still carry GAF-mirrored placeholders
- [ ] **kie.ai visualizer flip** (config-only) —
      [VISUALIZER-KIE-PROVIDER](../runbooks/VISUALIZER-KIE-PROVIDER.md)
- [ ] **www → apex 301** (~2 min) then **DMARC** `p=none` + rua, tighten after
      2–4 weeks — [MANUAL-FOR-JO](../qa/seo-hardening-2026-07/MANUAL-FOR-JO.md) §2, §5
- [ ] **Lead-engine switches** — funnel-recovery dry-run review → enable;
      Twilio A2P 10DLC (texts silently dropped until done); verify
      `RESEND_API_KEY`; decide `LEAD_ACK_SMS` / homeowner auto-text (TCPA);
      then `STORM_TEXT_ENABLED` — MANUAL-FOR-JO §8–9
- [ ] **IAM fix**: `roles/iam.serviceAccountTokenCreator` on the compute SA
      (prod access-code signup fails without it) — MANUAL-FOR-JO §10
- [ ] **Theme/maps lazy-bundle field check** on a real phone (saved theme
      applies, map view opens, d2d loads) — [handoff](NEXT_SESSION-2026-08-07.md)
- [ ] **Decisions**: Firestore offline persistence (lead PII in IndexedDB —
      unlocks a half-day agent task) · ~~pre-V2 migration / `?legacy=1`
      retirement (gates wizard deletion)~~ *(both settled: pre-V2 docs stay
      read-only per Jo 2026-08-31; `?legacy=1` retired 2026-09-02 — the
      snapshot was a byte-identical duplicate)* · public pricing-table gap
      (verify still live first) · Pillar 4 billing calls

## Agent-session backlog (ranked — pick one per session)

1. **ROTATE the three published cost baselines** — NOT a migration. Nothing
   can be stripped from `estimate-builder-v2.js` (28), `estimate-catalog-
   xactimate.js` (276) or `estimate-labor-catalog.js` (66): those figures ARE
   the pricing and removing them turns the estimator off. The override paths
   shipped 2026-08-19, so all that remains is Jo filling a worksheet and one
   import per catalog. **This is the only forcing function there is** — no
   test can see a Firestore write, so nothing in CI will ever nag about it,
   deliberately (a scheduled red on the cost-privacy guard is a countdown on
   the guard). Every run prints `ROTATION OUTSTANDING — 3 of 3`; the state
   lives in `tests/cost-basis-ledger.js`.
   ```
   node scripts/cost-rotation.js --catalog all --worksheet
   node scripts/cost-rotation.js --catalog <id> --apply .local/rotation-<id>.json
   node scripts/import-cost-rotation.js --catalog <id> --company <id> --yes
   ```
   The last command prints the `rotation:` block to paste into the ledger, and
   pasting it is what closes the item ([Phase-2
   brief](PHASE2-PUBLISHED-COST-BASIS-BRIEF-2026-08-18.md) ·
   [audit 2026-08-10](../audit/SITE-AUDIT-LOOSE-ENDS-2026-08-10.md))
2. **Lexington launch ops (Jo, ~15 min)** — the site claims Central KY as of
   2026-08-25: **PARTIALLY DONE, verified 2026-09-17** — (a) GBP service
   area: **PARTIAL, unconfirmed** — the profile was at the 20/20 hard cap, so
   only Lexington was added (swapped for Hyde Park, 2026-08-31); the five ring
   towns (Georgetown, Nicholasville, Winchester, Richmond, Versailles) were
   never added (cap-blocked, deliberate — they stay website-only) and even
   the Lexington edit's Google "pending" review was never confirmed
   afterward ([POSTING-LOG](../marketing/POSTING-LOG.md) 2026-08-31 entry ·
   [gbp-services-2026-09-03](../marketing/gbp-services-2026-09-03.md)'s
   "carried item": "Nobody has confirmed it since" — still true, nothing
   later touches it); (b) confirm Lexington–Fayette / local permit or
   licensing requirements before the first job — **STILL OPEN**,
   [LEXINGTON-CONTRACTOR-SETUP](../runbooks/LEXINGTON-CONTRACTOR-SETUP.md)'s
   5-item checklist is 0/5 checked and the one open legal question (permit
   needed for a like-for-like reroof?) is unanswered — no call to Building
   Inspection (859-258-3770) recorded; (c) text the Lexington caller
   `/areas/lexington-ky` + the two posts — **STILL OPEN**, carried unstruck
   through the 08-25 and 08-26 Jo queues, then dropped from every later
   handoff with no DONE mark ([session note Part
   2](SESSION-2026-08-25-lexington-call-posts.md))
3. Jobs-posting **phase 2**: admin "Post a Job" form + PR bot (roadmap in
   [NEXT_SESSION-2026-08-10](NEXT_SESSION-2026-08-10.md)) — **re-verified
   2026-09-17, still open**: none of the roadmap's deliverables exist
   (`docs/admin/post-job.html`, a `draftProjectPR` function, a restamp-bot
   workflow) and the roadmap's own gate — "only build it once the phone-
   template habit proves posting volume (>1-2/month) justifies it" — has no
   evidence of being passed.
4. ~~**Dead-functions wire-or-retire lane**~~ **DONE, verified 2026-09-17** —
   the 7 named functions (plus an 8th, `sendTeamInviteEmail`, retired
   separately) went through both steps of the CL8 playbook already: source
   retired 2026-08-11 (PR #1200, "retire 7 dead functions") and the actual
   deployed Cloud Run instances console-deleted 2026-09-04 on Jo's
   instruction ([STABILITY-AUDIT-2026-09-04](../audit/STABILITY-AUDIT-2026-09-04.md)
   — fleet 179→171, re-confirmed zero-orphan in `functions/FUNCTIONS_INDEX.md`'s
   2026-09-14 re-enumeration). This line was the last place the resolution
   hadn't been reflected.
5. Firestore offline persistence (after Jo's decision)
6. Classic-wizard deletion (once Jo's gates clear)
7. ~~**Rules-test coverage** — zero assertions for /invoices, /storm_proofs,
   /supplements, /portal_messages, /connectAccounts + Storage
   audio/galleries/reports/shared_docs~~ **DONE 2026-09-02 (#1350: 87
   assertions; Storage suite gates the deploy)** — still open from that item:
   #12-guard cases for the 12 newly guarded creates (2026-08-10 audit)
7b. ~~**Free-API wave 1**~~ **DONE 2026-09-05** — all five rows of the
   [research note](../audit/FREE-API-INTEGRATIONS-RESEARCH-2026-09-02.md)
   shipped as PRs #1385–#1392; see [NEXT_SESSION-2026-09-06](NEXT_SESSION-2026-09-06.md).
7c. ~~**Photo tokens, engineering half**~~ **DONE, verified 2026-09-17** —
   `functions/lead-artifact-cleanup.js`'s `onLeadDeleted` reaps photo
   originals/variants/thumbs/docs, and `functions/pdf-render-retention.js`
   is a live 30-day `pdf-renders/` reaper (both exist on `main` today).
7d. ~~**Cron-gate durability**~~ **DONE, PR #1628 (2026-09-17)** —
   `functions/cron-gates.js` is now the canonical list of all 12 gate names
   (11 `*_ENABLED` + `MONTHLY_OVERHEAD_ALERT_DISABLED`), health-digest.js
   renders live on/off state from it, and `tests/cron-gate-drift.test.js`
   fails if the registry and the real `process.env.*` reads it describes
   ever diverge (verified non-vacuous: a removed entry redded it).
   **Correction to the item's own wording**: not all 12 belong in
   `functions/.env.nobigdeal-pro` — most are deliberately withheld pending
   Jo's decision (TCPA-gated SMS sends, storm texts, etc.), so the registry
   tracks all 12 without forcing them into the deploy env file.
7e. ~~**Bound the four unbounded reads** + tests for storm-watch / data-export /
   killswitch + `invoice-pipeline.js` onto cents + wire `crm-audit.js` into CI~~
   **Re-verified 2026-09-17 — mostly already done, one real item fixed in
   PR #1628**: `crm-audit.js` has been a blocking CI step since 2026-09-04
   (`ci.yml:222`); `health-digest.js`'s `stripe_events` read already carries
   a Firestore-level `.where()` + `.limit(2000)` (the comment at its call
   site is explaining why the *old* unbounded shape was wrong, not
   describing a live bug); `tests/storm-watch-active-subscriber-2026-09-16.test.js`,
   `tests/data-export.test.js`, and `tests/voice-portal-draft-killswitch.test.js`
   already cover those three files; `invoice-pipeline.js` **does not exist**
   under `functions/` (this exact claim was already flagged false by the
   2026-09-04 recon — don't re-open it a third time); the two handler files
   this item originally named were themselves corrected to "not unbounded"
   in [NEXT_SESSION-2026-09-04](NEXT_SESSION-2026-09-04.md) §2. The one
   survivor — `functions/monthly-overhead-alert.js`'s `expenses` query had
   no `.limit()` — is fixed in PR #1628 alongside 7d.
8. ~~**Admin AI-usage endpoint**~~ **DONE, PR #1631 (2026-09-17)** — new
   `functions/handlers/ai-usage-analytics.js` (`getAiUsageAnalytics`,
   platform-admin gated, rate-limited) aggregates the real `api_usage`
   collection `claudeProxy` was already writing; `/admin/analytics.html`
   now renders it instead of the `SAMPLE DATA` mock. `errors`/`rateLimits`
   have no real backing data (only successes are persisted) and are
   reported as untracked rather than faked.
9. Functions cold-start increment 2 (lazy export proxies) — **investigated
   2026-09-17, one safe slice peeled off and shipped**: `functions/esign-stamp.js`
   required `pdf-lib` unconditionally at module scope even though only the
   e-sign stamping path uses it; PR #1635 lazy-memoizes the `require()` behind
   a `pdfLib()` accessor, verified via `require.cache` inspection (zero pdf-lib
   files loaded until `stampPdf`/`readPdfGeometry` actually run) + full smoke
   green. The bigger export-proxy migration this item is really about (making
   the top-level `functions/index.js` re-exports themselves lazy) still needs
   a live deploy to verify cold-start deltas — not done from this sandbox.
10. Inline-CSS dedup phase 2 (~2.86 MB across 17 distinct duplicated blocks,
    real count from a 2026-09-17 marker-by-marker census — not the earlier
    "~2.7 MB, needs generator design" estimate). **Slice 1 shipped 2026-09-17**:
    the nav base dropdown/mobile-nav/hamburger show-hide block (269 pages,
    ~513 KB, the single biggest chunk) moved from a per-page injected
    `<style>` to `docs/assets/css/nbd-nav-base.css`, mirroring the icon-CSS
    inject-to-link migration (`ensure-icon-css.js`/`nbd-icons.css`).
    `ensure-nav-css.js` now checks for the link OR the marker (any content —
    the field-notes blog post's deliberate variant stays untouched) OR the
    own-CSS escape hatch, and `--write` migrates a byte-exact legacy block.
    Verified: real headless-Chromium screenshots of the dropdown-open and
    mobile-drawer states (byte-identical rendering before/after); one test
    fix needed in `marketing-polish-contract.test.js`'s "nav collapse at
    1024" check, which only scanned inline page text — now also accepts the
    link.
    **Slice 2 shipped 2026-09-17** (same day, different session turn):
    deleted the dead `.nav-logo-text`-scoped declarations from 3 of the
    blocks flagged above (nav-logo text color, nav-logo layout, nav-wordmark
    guard) across all 220 pages that carry them —
    `scripts/strip-dead-nav-logo-text.js`, a one-shot script (not CI-wired,
    same class as the historical `fix-*.js` migration scripts), byte-exact
    matched (zero variants in any of the 3 blocks, confirmed against the
    census) so no fuzzy-match risk. **Correction to slice 1's own
    write-up**: "DELETE rather than extract — bigger win, zero behavior
    risk" undersold the danger. It is NOT a whole-block delete — each of
    the 3 blocks mixes dead `.nav-logo-text` rules with LIVE plain
    `.nav-logo` rules (real markup), and some pages (e.g. `our-work.html`)
    carry a SECOND, competing hand-authored `.nav-logo`/`.nav-logo img`
    definition with different pixel values that the injected block's
    `!important` + higher specificity currently wins over — a blind block
    delete would have silently changed which definition renders. The script
    strips only the `.nav-logo-text`-scoped lines, leaves every
    `.nav-logo`-scoped line exactly where it was, and separately verifies
    (post-transform) that no targeted marker's byte-exact block failed to
    match. Verified: full local gate suite green + real headless-Chromium
    screenshots at desktop and the 768px breakpoint (confirmed the
    surviving `.nav-logo img{height:50px!important}` mobile-shrink rule
    still computes to 50px).
    **A 4th and 5th `.nav-logo-text` location remain, deliberately
    untouched**: a `typography-normalize` block's `@media(min-width:1025px)
    and (max-width:1440px)` section also carries 2 dead `.nav-logo-text`
    rules (that block has 3 minor-drift variant groups — not safe for
    byte-exact matching without more work, see below), and several pages
    (e.g. `careers.html`) carry their own hand-authored base
    `.nav-logo-badge`/`.nav-logo-text` styles in their page-specific
    `<style>` block (also dead, also out of scope — not marker-delimited,
    so not part of this census at all).
    **Genuine "which definition currently wins" question for a future
    session, not this one**: the live `.nav-logo`/`.nav-logo img` rules left
    behind in blocks 1-2 are STILL duplicated (~197-220 copies) and could in
    principle also be consolidated into `nbd-nav-base.css` — but only after
    resolving the competing-definition overlap with pages' own hand-authored
    NAV sections (which currently lose the cascade fight silently). Treat as
    its own slice with its own verification, not a quick follow-on.
    **14 more blocks (of the original 17) surveyed, not yet touched**: 3
    more small no-conflict blocks (nav-collapse normalize, a11y
    focus/reduced-motion, iOS-zoom fix; ~117 KB) are still a plausible next
    mechanical slice. Five blocks (footer contrast, footer social icons,
    sitewide readability v2, trust-icon fix, blog-template shim) already
    have one-shot INJECT-ONLY generator scripts from when they first
    shipped (not CI-wired) — extracting them needs those scripts updated
    too, so treat as a separate slice. The typography-normalize block has
    3 minor-drift variant groups (not a clean single canonical text). The
    biggest single chunk (~928 KB, `/* unified-nav injected */`, hail/
    roof-replacement/roof-repair/siding/gutter service templates + blog) is
    NOT one block — 15-19 distinct per-template shapes needing 5-6 separate
    extracted files, not a universal one; also stacks with blocks #1/#9/#13
    on the SAME pages (overlapping nav-styling mechanisms — consolidation
    needs to watch for that, not just dedupe each marker in isolation). The
    per-template `:root` variable subsets (~231 pages) and a few
    accessibility-motivated per-page overrides (`docs/inspect.html`'s
    `--orange-dark`, `the-pledge`/`free-tools`/`book`/`free-roof`'s extra
    tokens) need human design review before touching, not just automation.
11. ~~/our-work/<slug> detail pages~~ **DONE, PR #1632 (2026-09-17)** —
    `scripts/build-projects.mjs` generates one standalone page per live
    project with its own Service/BreadcrumbList JSON-LD, wired into
    `build-sitemap.js`. **The Haiku blurb drafter half had no real
    target**: checked all 45 live projects — every description is already
    specific, real copy, not placeholder text; the only actual gap (7
    projects missing a price range) needs Jo's real numbers, not drafted
    prose, and is already tracked in this file's one-off queue.
12. **Globals Tranche 3** ~~plan~~ **RESUMED 2026-09-17** — the
    dependency-ordered plan
    ([globals-tranche3-plan.md](../../docs/dev/globals-tranche3-plan.md),
    2026-08-31, PR #1304) shipped T3-0, T3-A slice 1, T3-M + the "freed
    15"/"bonus eight" (PRs #1316/#1319/#1326/#1338–#1342 through 2026-09-02:
    25/36 map-dispatch names now registry-only), then sat with zero `T3-`
    commits until this session opened **PR #1637** with a first slice of
    each of the next two bands: **T3-B** (`maps.js`'s 12-name twin-assigner
    re-export block deleted — every name already an auto-global on `window`
    from its real owner file, so the guarded re-export was pure `window.X =
    window.X`) and **T3-C** (6 of the 7 `dashboard-bootstrap.module.js` →
    `ui.js` edge names graduated to `__NBD_CALL_REGISTRY`; the 7th,
    `_loadEstimateDefaultsV2`, deliberately excluded — it has 2 more
    internal self-references than its MUST-STAY comment claimed, plus a
    derived `window._loadEstimateDefaults` alias, so it needs its own slice).
    **2026-09-18, PR #1642** shipped two more T3-C edges: `crm-portal-
    bridge.js` (5 of 5 names) and `rep-report-generator.js` (3 of the
    listed 4 — the 4th, `_reports`, is a data cache and doesn't convert; it
    now has its own local `_reportsCache` instead). The listed 3rd edge,
    `crm-pipeline.js`, was re-derived to **zero** real candidates (they're
    misattributed `crm-stages.js` re-exports) plus a `_dragId` bare-global
    landmine flagged for its own slice — see the plan doc's 2026-09-18
    update. **Same day, a second PR** shipped the
    `customer-bootstrap.module.js` → `customer-tasks-ui.js` edge on
    `customer.html` (re-derived to 8 candidates, not the table's "5"; 4 real
    callables converted — `_fetchPhotosRaw`, `loadPhotos`,
    `setLightboxSource`, `_nbdTsToDate` — the other 4 are shared data, not
    callables, left on window same as `_reports`). This is the first use of
    `__NBD_CALL_REGISTRY` on `customer.html`. The REVERSE direction
    (`customer-tasks-ui.js` → `customer-bootstrap.module.js`, the table's
    other "6") was investigated and found NOT to be a safe T3-C shape —
    `customer-tasks-ui.js` has no IIFE wrapping, so its top-level functions
    are already auto-globals; converting the explicit `window.X =` form
    there wouldn't actually take anything off `window`. See the plan doc's
    2026-09-18 update for both. **Same day, a third PR** shipped two more
    long-tail T3-C edges off `dashboard-bootstrap.module.js`: the pins CRUD
    pair (`_savePin`/`_deletePin`, consumed by `maps-overlays.js`) and the
    zones CRUD pair (`_saveZone`/`_deleteZone`, consumed by
    `dashboard-actions.js`) — 4 more names converted, `_zones` and
    `_DASH_DOC_PREREQUISITES` left on window (data, not callables, same
    `_reports` reasoning). Found but NOT fixed: `dashboard-actions.js`'s
    `deleteZone` defaults its delete-confirmed flag to fail-OPEN
    (`let ok = true`) if its guard ever fails, unlike `deletePin`'s
    fail-CLOSED default — pre-existing, not introduced by this PR, flagged
    for a one-line fix later. **A fourth PR same day** shipped the estimate
    CRUD edge: `_deleteEstimate`/`_renameEstimate`/`_assignEstimateToLead`,
    consumed by `estimate-crm-ops.js` (loads on both dashboard.html and
    customer.html). `_assignEstimateToLead`'s ~96-line money/pipeline stamp-
    back body (jobValue guard, primaryEstimateId, the re-assign un-dangle
    pass) verified byte-identical pre/post by two independent reviewers.
    Surfaced (spawned as its own background task, not fixed here): the
    live "👤 Assign" button on customer.html's estimate hub calls
    `_assignEstimateToLead`, which only ever exists on dashboard.html —
    silently no-ops on a customer page today, pre-existing bug. **A fifth
    PR same day** shipped the cleanest slice yet: `filterStageDropdownByJobType`/
    `getSelectedTrades`, consumed by `crm-leads.js` — zero HTML hits, zero
    prior test coverage, one self-reference guard simplified to a bare call
    (safe — traced every caller, none can fire before module parse
    completes). **A sixth PR same day** shipped a new edge shape:
    `missingClaimFields`/`subTypeLabel`/`subTypeOptionsFor`, consumed by
    `warranty-claim.js` — these are imported bindings from `crm-stages.js`,
    not local declarations, bridged to `window` only for classic-script
    reach; corrected a stale "exposed for crm.js" comment (crm.js reads
    none of that 14-name block). `warranty-claim.js` also loads on
    customer.html where these 3 were already unavailable before this PR
    too — already gracefully guarded, unchanged. **A seventh PR same day**
    shipped the most structurally varied edge yet: `applyPipelineConfig`
    (a named function expression), `resolvePipelineConfig` (a crm-stages.js
    import), and `STAGE_ROLE` (a genuine rename-on-export — imported as
    `ROLE`, registered as `STAGE_ROLE`), consumed by `pipeline-builder.js`
    (Settings → Pipelines, a real tenant-facing feature). Two reviewers
    traced all 4 real user flows (open Settings, change a stage role, the
    bug-fix-sensitive Reset-to-defaults ordering, save→live-board-update)
    end to end — clean. **An eighth PR same day** shipped the dashboard's
    lead-detail photo modal edge (`_uploadPhoto`/`_getPhotos`, distinct
    from the customer.html photo pipeline converted earlier) and surfaced
    a **structural census blind spot**: `globals-xref.js` only scans
    `docs/pro/**`, so `tests/e2e/pro-authed.spec.js` — a Playwright spec
    reading `window._uploadPhoto` directly — was invisible to it. Fixed
    (both the spec and the doc's own "per-name proof" checklist, which now
    says to grep `tests/e2e/` too). **A ninth PR same day** shipped the
    first edge whose owner file wasn't a `*-bootstrap.module.js`:
    `dashboard-actions.js`'s `_mJdTeardownRealtimeTabs` (real IIFE-scoped
    declaration, joined an already-existing registry block in the same
    IIFE) — but only 1 of that edge's 4 census candidates converted; the
    other 3 sit in a top-level GAP between `dashboard-actions.js`'s
    several separate IIFEs, needing T3-A-style IIFE-wrapping first, not a
    quick add-on. Two more candidates ruled out the same round:
    `dashboard-api.js` has no IIFE anywhere (same trap); `dashboard-load-
    status-banner.js`'s `__nbdGstaticTest`/`__nbdHardReset` are
    deliberate devtools-console recovery tools per the file's own header
    comment — added to the permanent Keep-as-API list, never convert.
    T3-B has ~171 names left, T3-C has ~124ish (22 more converted across
    today's 9 PRs, table miscounts corrected in multiple directions —
    read the plan doc's table, not this number, before starting the next
    slice); T3-D (131-name band → NBD-prefixed APIs) and T3-E (spine-
    disposition docs) remain fully
    untouched. **A tenth PR same day (PR #1655)** was the session's first
    genuine **T3-A** slice — new-IIFE-wrapping, not just re-registering
    inside a scope that already existed — picking up the 3 names flagged
    by the ninth PR (`toggleProspectHidden`, `viewProspectOnMap`,
    `absoluteDeleteProspect`) plus a 4th in the same top-level gap
    (`confirmPromoteProspect`). Wrapped the whole gap in a new IIFE;
    found and fixed a stale `__NBD_CALL_ALLOWLIST` entry for
    `confirmPromoteProspect` (real markup dispatch goes through
    `cdaConfirmPromote`, an already-registered wrapper in a different,
    pre-existing IIFE) and a stale test comment wrongly calling
    `viewProspectOnMap` "MUST-STAY" (the same comment also still listed
    `_mJdSwitchTab`, already converted in an earlier tranche — proof the
    comment had rotted). Two reviewers re-derived the new IIFE's
    boundaries from `git show HEAD`, byte-diffed the destructive-delete
    guard as untouched, and traced the registry-before-allowlist
    resolver precedence in `dashboard-ui.js` to confirm the allowlist
    removal is a provable no-op, not just an absence of grep hits.
    T3-C long-tail now ~123 names; T3-A candidate count reduced by 4.
    **An eleventh PR same day (PR #1656)** was the session's first
    WHOLE-FILE IIFE wrap — `dashboard-connect-tab.js` (432 lines) had
    zero existing IIFE structure at all, unlike every prior T3-A edge
    (which wrapped a narrow gap between two pre-existing IIFEs). Re-
    derived the T3-A census from 7 names to 13; only `renderConnectCard`
    and `loadConnectStatus` needed a `__NBD_CALL_REGISTRY` entry (their
    only outside reference is `tests/stripe-connect-ui.test.js`'s
    `vm`-sandboxed test harness calling them directly), the other 11 have
    zero consumers anywhere and stay fully private. Explicitly verified
    re-execution safety (the file re-runs when its hydrated-template tab
    is opened) — every piece of state that must persist across runs is
    already an explicit `window.*` read/write, untouched by the wrap.
    Two reviewers independently re-derived the hydration mechanism from
    `dashboard-ui.js` source, grepped the whole repo incl. `tests/e2e/`
    for the 11 private names (zero hits), and actually ran
    `tests/stripe-connect-ui.test.js` themselves (101/101 green) rather
    than trusting a claimed count. `tests/smoke.test.js` now 4184/4184.
    Scoping is already underway for the SECOND, much bigger whole-file
    candidate — `customer-tasks-ui.js` (2521 lines, target functions
    scattered from line 40 to 2411) — a background census agent is
    building the full consumer inventory before any edit is attempted.
    · **404
    full-chrome** **DONE, PR #1636 (2026-09-17)** — `docs/404.html` now
    carries real `nbd:partial nav-standard`/`mobile-nav-standard`/
    `footer-extended` chrome instead of a bespoke centered card ·
    **emulator widening** (unchanged — `ci.yml:773,791` still gates
    `NBD_EMU_FUNCTIONS` to `@stranger`/`@gauntlet` only, 2 of 6 shards;
    comment still calls it "future work once boot cost is addressed") ·
    **Swath admin UI** (unchanged — `getSwathReport`/`getSwathUsage` in
    `functions/integrations/swath.js` have zero callers under `docs/pro/`;
    the 2026-09-17 handoff confirms "explicitly deferred")
13. Blog publish sessions (one per draft, after Jo's edits) — **1 of 3 DONE
    2026-08-17** (financing post, PR #1224 — now
    `docs/blog/roof-financing-cincinnati-explained.html`); the other 2 are
    **blocked on Jo, not on a session**: `documentation/drafts/what-hail-
    damage-looks-like-cincinnati.html` (9 unresolved `JO:` markers — needs 3
    inspection photos + storm anecdote) and `documentation/drafts/what-a-
    real-roof-inspection-report-looks-like.html` (10 unresolved `JO:`
    markers — needs 3 redacted report screenshots); see
    [drafts README](../drafts/README.md).

*(2026-08-10: "rate-limit-policy adopt-vs-delete" left this list — ADOPTED;
guardHttp/guardCallable now live on claudeProxy, validateAccessCode,
getGoogleReviews, adminAI.)*

*(2026-09-17: items 7b–7e re-verified earlier the same day; items 2, 3, 4,
5, 6, 9, 10, 12, 13 re-verified in a second pass, all against `main` with
direct code/test evidence, not just re-reading old handoffs. Four items (2,
4, 12, 13) turned out to need correcting — 4 was fully resolved and never
checked off (exactly the rot this list exists to prevent), 2/12/13 were
each partially — not fully — done. Five items (3, 5, 6, 9, 10) were checked
and confirmed accurate as already worded, no change needed. Items 1, 8, and
11 were NOT re-verified this pass — 1 is tracked live in the cost-rotation
ledger, 8 and 11 are queued for this same session's build lane — don't
assume this edit vouches for them beyond that.)*

---

*Sources: [local-seo-playbook-2026-07](../marketing/local-seo-playbook-2026-07.md) ·
[citation-kit-2026-07](../marketing/citation-kit-2026-07.md) ·
[MANUAL-FOR-JO](../qa/seo-hardening-2026-07/MANUAL-FOR-JO.md) ·
[NEXT_SESSION-2026-08-07](NEXT_SESSION-2026-08-07.md) ·
[BIG_ROCKS](BIG_ROCKS.md). Where docs disagreed (GBP monthly vs weekly), the
newer playbook won: weekly.*
