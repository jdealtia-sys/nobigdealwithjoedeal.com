# Site-wide loose-ends & security audit — 2026-08-10/11

> Session goal (Jo): "look into where the site as a whole stands now and tie up
> any and all loose ends … so nothing is left open as a security risk or
> vulnerability as well as incomplete tools, systems, functions, wiring."
> Method: 7 parallel audit lenses (CSP/inline, secrets/PII, client wiring,
> functions, CI gates, docs drift, rules/tenancy) with adversarial
> verification, plus hand-verification of every finding before fixing.
> Branch: `claude/site-audit-loose-ends-xl91fj`.

## Repo-hygiene state at session start

- CI on main: fully green, including all advisory jobs at the job level.
- **Advisory-promotion streak: 3 of ~10** (the advisory jobs only exist since
  #1194 landed 2026-08-07; all 3 main runs since are 18/18 green). Do NOT
  flip `continue-on-error` yet — recheck next session.
- Open PRs: only dependabot #1196 (functions lockfile patches incl. `ws`) —
  all 18 checks green → **merged** per the WEEKLY_CADENCE standing rule.
- Open issues: only #546 (customer.html inline scripts + CSP) — verified
  **done since 2026-07-02** (firebase.json line ~132 resolution record; 73
  script tags all external; global CSP has no `unsafe-inline` script-src)
  → **closed with evidence**. Issue tracker is now at zero.
- All cheap drift gates green at baseline (471 js / 206 pages / 549 regions /
  199 sitemap URLs / 12 projects / 8 strips / 42 cost-privacy / 51 polish /
  3305 smoke).

## Confirmed findings → FIXED this session (commit order)

1. **Hail hub `footer-extended` region unclosed** (`b82f903`) — the
   NEXT_SESSION-2026-08-10 watch-out. Opening marker with no closer meant the
   region silently left generator governance (REGION_RE only matches complete
   pairs). Stamped the closer (body was byte-identical to the partial source;
   549→550 governed regions) and made dangling markers a **fatal `--check`
   failure** in apply-partials.js. Follow-up (`0e51dbb`-era commit): the
   prefilter itself skipped files whose only marker is an orphan **closer** —
   proven with a synthetic page, prefilter loosened to the bare token.
2. **rate-limit-policy.js had ZERO consumers** (deferred-queue #3, decided:
   ADOPT). `guardHttp('claudeProxy')` (uid 20/min unchanged — was
   CLAUDE_PER_MIN_LIMIT — + NEW 60/min-per-/64 IP backstop closing the
   documented refresh-bot gap), `guardCallable('validateAccessCode')` (ip
   5/5min unchanged + new uid layer). submitPublicLead deliberately stays
   hand-rolled (richer fail-open + Turnstile interleave) with its ROUTES entry
   corrected to record the real gate. Policy module now rides the
   provider-aware upstash adapter and buckets IPv6 by /64.
3. **P0 — 3 published gallery JPEGs carried EXIF GPS**
   (completed-colonial-spring + commercial-apartment-underlayment with FULL
   lat/lon; active-culdescac-crew with GPS refs). Lossless APP1 strip
   (pixel-identical, verified via sharp), and a NEW zero-dep gate
   `scripts/check-image-privacy.js` wired into ci.yml + the CLAUDE.md
   pre-push list (fails on GPS anywhere under docs/, any APP1 in the
   pipeline-owned projects dir, WebP EXIF/XMP; `--fix` = lossless strip).
4. **16 dead inline hover handlers in dashboard.html** — never executed under
   `script-src-attr 'none'` and every hover fired a violation report into the
   /cspReport sink Jo skims. Converted to `.hov-*` CSS utilities.
5. **`/pro/stripe-success` per-page CSP blocked reCAPTCHA Enterprise** — the
   page initializes App Check with ReCaptchaEnterpriseProvider but its CSP
   lacked the four origin grants `/pro/register` already carries, so every
   `enforceAppCheck` callable from the buy-first provisioning page was set to
   fail for a NEW PAYING CUSTOMER. Mirrored the register grants. Plus:
   `defer` added to public-lead-submit.js on the 6 pages missing it.
6. **Shop's real per-SQ cost basis published in EBv2**
   (DEFAULT_COST_BASIS 340/385/430 beside public tier rates 545/595/660 —
   world-readable margin). Shipped defaults are ZEROS now = "not configured";
   engine nulls margin fields, Internal View shows "— set cost basis in
   Settings", settings-form fallbacks zeroed; 3 cost-privacy pins added.
   **JO ACTION: enter your cost basis once in Estimate Settings after deploy**
   (saved device settings carry over if you ever saved V2 settings).
7. **Rate-limit wave 2**: cspReport's limit was ADVISORY (httpRateLimit
   boolean ignored — flood still logged + double response) → honored;
   getGoogleReviews was the ONLY unlimited public endpoint (billable Places
   API) → guardHttp 60/min/IP; adminAI joins guardHttp (uid 60/hr unchanged +
   IP backstop); ROUTES phantom (`resetSubscriptionByEmail`) and retired
   (`imageProxy`) entries deleted, drifted entries synced to the real gates
   (publicVisualizerAI's entry was ~36x looser than reality);
   FUNCTIONS_INDEX.md corrected (retired row, 189→191 count, false App Check
   claims on 3 public rows stripped).
8. **Dead-surface sweep**: 7 zero-referrer generated files under
   docs/assets/js/inline/ deleted; ensure-nav-base-css.js (dangerous
   pre-partials codemod) deleted; theme-audit.js moved out of the public
   tree to scripts/; admin vault view-session no-op now opens the detail
   view; admin AI-analytics page honestly labeled "SAMPLE DATA" (endpoint
   was never built); dead #tierBadge / #submitError markup removed;
   /pro/how-to "coming soon" promises reworded to describe reality.
9. **CI hardening**: firebase-deploy.yml could report "✓ All functions
   deployed" on a WHOLESALE deploy failure (exit code never checked, only
   per-function line parsing) → wholesale-failure guard added.
   run-test-manifest.js tripwire extended: smoke/ aggregator coverage
   (mutation-tested), e2e spec wiring + shard-tag checks, and
   workflow-presence checks for the self-attesting buckets.
10. **Cost-book debt tracked + sweep hardened**: estimate-catalog-xactimate.js
    (276 mat/lab unit costs, supplier-derived, served unauthenticated) evaded
    the cost-privacy sweep via abbreviated keys — sweep now catches
    `mat:/lab:`, file added to KNOWN_UNMIGRATED beside the EBv2 CATALOG for
    the Phase-2 tenant-owned cost-book migration.
11. **Ask Joe key-collection UI retired** — it solicited `sk-ant` secrets
    into browser storage that NO reachable path could use (direct path
    opt-in-disabled + CSP-blocked). Server proxy is the only transport;
    clearJoeKey kept for cleanup.
12. **Firestore rules: #12 guard extended to all rollup-feeding creates** —
    a MEMBER with a companyId claim could stamp `companyId=own-uid` on
    create and hide the doc from company_admin/manager rollups. The guard
    existed only on /expenses + /recurringExpenses; now also on /leads,
    /estimates, /suppliers, photos, /pins, /zones, /knocks, /reps,
    /territories, /training_sessions, /invoices, /reports (11 bare
    fallbacks + the suppliers variant).

13. **Docs-drift sweep** (all verified against code before editing):
    QUICK_START.md rewritten (was the legacy bolt-on guide referencing files
    that no longer exist, billed as the read-first orientation); BIG_ROCKS
    Rock 2 broken links fixed + PR 1/PR 2 marked done + Rock 3 banner
    corrected (authed-E2E is REQUIRED except @engines; suite is ~48 test
    blocks, not 15); WEEKLY_CADENCE advisory-job list corrected;
    SECRET_ROTATION workers/-stub claim corrected (dir removed from repo);
    2026-08-10 handoff's hail watch-out stamped fixed; INDEX gained the
    orphaned RAILWAY-EVAL-2026-08 + drafts/README links and an honest
    corpus count (~115); demo.js identities fictionalized; personal cell
    redacted from the exhaustive-sweep README; privacy-guard header no
    longer restates real figures.

## Known-accepted (verified, deliberately NOT changed)

- Retail prices under docs/ (deliberate), firebase web apiKey (public by
  design), permit-fee tables (public government data).
- Jo's Gmail in QA docs as the documented QA-safe recipient (public repo —
  it's baked into git history regardless; scrubbing HEAD wouldn't unpublish).
- 4 lumanail product-pack JPEGs carry benign no-GPS camera EXIF (accepted by
  the new gate, listed under --verbose).
- `?legacy=1` snapshot drift — already tracked (BIG_ROCKS Rock 2 gate);
  the legacy snapshot also keeps its 16 inline hover handlers + old key UI
  (frozen rollback artifact — folded into the parked legacy-retirement
  decision).
- Broken links inside `archive/legacy/` docs and the dated 2026-06 QA
  campaign folders (root-relative link style, ~29 targets) — historical,
  INDEX marks the archive "do not action"; not worth the churn.

## Open items → next sessions (ranked)

1. **Phase-2 tenant-owned cost book** — migrate EBv2 CATALOG (28 entries)
   AND estimate-catalog-xactimate.js (276 entries) out of the public tree
   (both now pinned in KNOWN_UNMIGRATED). Design: catalogCosts/{companyId}
   hydration like the product-data migration.
2. **7 deployed dead client-surface functions** (no caller anywhere:
   sendEstimateEmail, sendDripEmail, triggerProcessRecording,
   reprocessRecording, auditCustomerDataIntegrity, backfillCustomerData,
   migratePinsToKnocks) — per-function wire-the-UI vs retire (CL8 playbook:
   delete export + `firebase functions:delete` + FUNCTIONS_INDEX row). Jo
   call per function; the two email relays are the highest-value retire.
3. **Rules-test coverage gaps** (P3): zero assertions for /invoices,
   /storm_proofs, /supplements, /portal_messages, /connectAccounts and
   Storage audio/galleries/reports/shared_docs branches. Also: add
   emulator tests for the #12 guard class (member stamping own-uid on the
   12 newly guarded collections).
4. **Admin AI-usage endpoint** — the analytics page is sample data;
   claudeProxy already logs real usage server-side, needs an aggregation
   endpoint + page wiring.
5. **Advisory-CI promotion** — flip `continue-on-error` at ~10 green main
   runs (3/10 as of this session; all job-level green).
6. Everything already queued in [WEEKLY_CADENCE](../projects/WEEKLY_CADENCE.md)
   (Turnstile order-of-operations, visual-regression bless, Swath secrets,
   offline-persistence decision, wizard-deletion gates, …).

## Verification

Cheap gates all green post-fix (site-integrity 206 pages / 0 fail;
apply-partials 550 regions clean + both dangling-marker directions proven;
sitemap zero-diff; build-projects 12+8 clean; inline-scripts 0/203;
image-privacy 52 scanned 0 fail; js-syntax 463 files). Smoke 3321/3321.
All 9 estimate engine suites green (parity 74, render 74, v2-payload 90,
pricing 52, profit 54, money-ladder 21, formula-eval 20, customer-rows 37,
cost-privacy 48). Functions index.js loads clean (191 exports). Firestore
rules suite: see PR CI (required job) — plus local emulator run noted in the
session log if the sandbox allowed it.
