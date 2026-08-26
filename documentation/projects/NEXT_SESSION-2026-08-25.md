# NEXT SESSION — 2026-08-25

Handoff from the 2026-08-25 session (branch `claude/website-audit-blog-strategy-y2ze1c`).
Three lanes ran and all closed: a site-wide deep-dive audit, two new blog posts
born from another blog-sourced homeowner call, and — after Jo confirmed he told
that caller "yes, I service Lexington" and the caller committed his business —
the **Central Kentucky territory expansion** (Lexington flagship + 5-city ring;
Part 2 of the [session note](SESSION-2026-08-25-lexington-call-posts.md)).

## What shipped

- **Two Reader Questions posts** from the Lexington, KY call (same
  Duration-vs-HailGuard question as the 08-17 Colorado Springs caller — the blog is
  now demonstrably generating informed phone calls):
  `/blog/is-the-class-4-upgrade-worth-it` (his State Farm agent quoted **12% off**
  for a Class 4 roof; includes the cosmetic-damage-exclusion caveat, new to the site)
  and `/blog/why-wont-roofing-suppliers-sell-to-homeowners` (he tried to buy
  HailGuard himself; SRS/QXO don't carry it, ABC is account-only — first post on
  supplier-channel reality). Fact-sourcing decisions + exact wiring:
  [SESSION-2026-08-25-lexington-call-posts](SESSION-2026-08-25-lexington-call-posts.md).
- **Deep-dive audit, site is clean**: all gates green, 231-page static passes found
  zero broken refs / JSON-LD errors / placeholder text; rendered sweep 229 pages × 2
  viewports, zero style findings. Three metadata nits fixed (careers + tarping meta
  descriptions, partners title); ten flags confirmed deliberate. Full trail:
  [SITE-DEEP-DIVE-2026-08-25](../audit/SITE-DEEP-DIVE-2026-08-25.md).
- Stale-doc correction: WEEKLY_CADENCE "3 blog drafts" → 2 (financing post published
  08-17).

## Jo's queue (nothing blocking)

1. ~~Post A names State Farm — keep or de-name?~~ **RESOLVED 2026-08-25**: Jo
   confirmed the name stays. No action for anyone; rationale recorded in the
   session note.
2. **Close the Lexington caller** — the site now backs up the "yes" you gave him:
   text him `/areas/lexington-ky` + both posts. His job is the first entry on the
   Lexington job list.
3. **Update your Google Business Profile service area** to add Lexington,
   Georgetown, Nicholasville, Winchester, Richmond, Versailles — the site claims
   the territory now, GBP should match (also added to WEEKLY_CADENCE's one-off
   queue).
4. **Before the first Lexington job**: confirm any Lexington–Fayette / local
   permit or licensing requirements for roofing work there — I made no licensing
   claims on the new pages, but the paperwork question is real and yours.
5. **Finish the Cal.com→CRM wiring** (same evening: the whole Cal.com account was
   audited and rebuilt — [CALCOM-INTEGRATION-2026-08-25](../audit/CALCOM-INTEGRATION-2026-08-25.md)):
   (a) set `CALCOM_WEBHOOK_SECRET` in Firebase with the value from chat + redeploy
   the function; (b) NBD Pro → Settings → Profile → Cal.com username `nobigdeal`;
   (c) optional: restrict the "Central Kentucky days" schedule to real trip days;
   (d) revoke the session API key if it has no expiry.
6. Carried from 08-20 if not yet done: **send Scott the CURRENT Oaks zip** (7-Zip,
   not PowerShell Compress-Archive).
7. Still yours from the drafts pipeline: the 2 remaining blog drafts need your
   `JO:` inputs (photos / report screenshots) — [drafts README](../drafts/README.md).

## For the next engineering session

- **Remote-sandbox Playwright recipe** (needed for qc-render-sweep there): the
  container blocks `playwright install`; symlink-shim the preinstalled Chromium
  into a writable `PLAYWRIGHT_BROWSERS_PATH` — details in the audit note's Method §3.
  Also: `/pro/login` + `/pro/register` will time out in that sandbox (they block on
  external Google Fonts CSS) — environment noise, already triaged.
- **Observation filed, decision pending**: `/pro` auth pages still load Google
  Fonts synchronously while the homeowner surface self-hosts — for a future
  Pro-perf session, not a cleanup fix.
- **Blog series runway** (when calls supply facts): Duration FLEX vs HailGuard
  head-to-head; "what a Class 4 certificate looks like" photo post (needs a real
  certificate through the EXIF pipeline).
- **Central KY phase 2** (after Lexington produces jobs): service clusters for the
  5 ring cities (their area pages exist; each city needs the outer-ring trio the
  way Lexington got one), and the first Lexington featured project on /our-work
  the moment a job closes — a real local job photo beats every word on those
  pages. Decisions log is in the session note's Part 2 (incl. why new KY pages
  omit the JSON-LD address block).
- **The scheduled "Lead address audit" workflow is red on every daily fire since
  2026-08-20** (~20s failures, likely a missing Actions secret — pre-existing,
  unrelated to this session's PR). Queued in WEEKLY_CADENCE's agent list.
- Standing rules from 08-20 still stand: verify hosting behavior by following
  redirects on a preview channel, never by reading config; assert the outcome, not
  the precondition.
