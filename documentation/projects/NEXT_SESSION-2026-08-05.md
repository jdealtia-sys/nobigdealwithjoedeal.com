# Next Session — after the 2026-08-05 hardening + coverage sweep

> Cold-start brief, 2026-08-05. Written after full recon of the repo, docs,
> CI, and PR backlog. Self-contained: a fresh agent can pick this up cold.
> Predecessors ([NEXT_SESSION](NEXT_SESSION.md), the Stranger Test era) are
> fully executed — do not re-run them.

## What this session shipped

- **PR backlog cleared:** merged #1166 (retired Oaks page deletion) + 6
  dependabot bumps (functions non-major ×41, tests deps, CI actions incl.
  setup-node 5→7 and upload-artifact 4→7 majors — verified safe: PR CI
  exercised them; upload-artifact only uploads failure traces). #1161 /
  #1175 were conflicted by sibling lockfile merges; dependabot rebases
  requested — check they landed.
- **16 orphaned test suites wired into the chain + CI** (they ran NOWHERE:
  money/legal-path guards included; all pass). `check-inline-html-scripts.js`
  itself now gates in site-integrity. First-wiring flushed a real seam: a
  dummy `TURNSTILE_SECRET` in the CI emulator env fail-closes the lead
  gateway — the generation step now excludes it.
- **Honeypot autofill fix (audit P6):** `name="website"` → `nbd_hp` on all
  5 emitters + both-keys gateway check; pinned by
  `tests/honeypot-autofill-contract.test.js` + 3 public-intake cases.
- **Blog footer cohort → `footer-blog` partial** (24 pages: 21 EXACT,
  3 NEAR converged to canonical, regaining the GAF Timberline footer link).
  Partial coverage now 131 regions.
- **Docs:** kie.ai flip runbook (`runbooks/VISUALIZER-KIE-PROVIDER.md`),
  stale-comment fixes (ci.yml @gauntlet note, e2e README), audit
  annotations (P3/P6 tenant-lifecycle, h2→h4 footer line).

## Deferred queue (ranked; verified open as of 2026-08-05)

1. **Rock 2 PR 6 — delete/stub classic `estimates.js` (STALLED since
   ~Jul 18).** PRs 2–5 shipped; the deletion never did (no draft PR was
   ever opened — verified via PR search). `estimates.js` is 1,613 lines and
   still lazy-loaded (`script-loader.js:152`). The plan requires reading
   prod deprecation-warn field logs first, then a DRAFT PR for Jo — never
   auto-delete. The warn bake period has long elapsed.
2. **Partial conversion, next cohorts:** 26 area pages, 28 service
   hub/plain pages, 5 root pages, the-pledge, sites/free-guide. Nav
   variants (`nav-standard`, `nav-blog`, mobile twins) are pre-declared in
   `apply-partials.js` REQUIRED_MARKUP — the partial files just don't exist
   yet. Higher value, slightly riskier (dead-controls failure mode).
3. **A11y lane D** (homeowner-site-audit-B-C-D-E): site-wide skip-link
   codemod; visualizer pills keyboard-inoperable; aria/contrast/
   focus-visible items.
4. **SEO lane B leftovers:** trailing-slash canonical mismatch on /areas,
   /blog, /free-roof; 16 long titles + 50 long meta descriptions; 7 images
   missing width/height; /services/financing BreadcrumbList.
5. **Globals residual:** zone-draw unwind (`maps.js` unguarded window
   assignments) + `damagNearMe` 4-way dedup. Tranche 3 (~515 globals)
   needs its own dependency-ordered plan first.
6. **Tenant-lifecycle audit tail:** CL8 (retire legacy `sendTeamInviteEmail`
   + dead `invites/{token}` collection); P5 uid disclosure (accept-or-ask);
   CL4 seat TOCTOU is ACCEPTED-won't-fix.
7. **Functions emulator widening** to @shard1/@shard2/@audit — explicitly
   parked on boot cost (ci.yml comment).
8. `tests/public-intake.test.js` runs in the chain but not CI — candidate
   for the referral-trigger job (needs the no-TURNSTILE dummy env, already
   in place).

## Parked on Jo (decisions / console actions — not agent work)

- kie.ai visualizer flip: `runbooks/VISUALIZER-KIE-PROVIDER.md` (15 min +
  quality QA). Feature flag `VISUALIZER_IMAGEGEN_ENABLED` stays separate.
- Money-page on-page forms + estimator SMS-OTP gating (conversion lane E —
  both HIGH-value product calls).
- GBP/reviews checklist, www→apex 301 spot-check, DMARC tightening
  (seo-hardening MANUAL-FOR-JO, unchecked boxes remain).
- Blog drafts: 3 complete posts in `documentation/drafts/` with 25 `JO:`
  markers to fill.
- TAMKO Pro Gold artwork from the TAMKO portal (consistency-audit tail).

## Environment notes for the next agent (hard-won this session)

- This sandbox's `firebase-tools` routes even 127.0.0.1 API calls through
  `HTTPS_PROXY` and the proxy 403s them ("denied by policy"). Run emulator
  suites with the proxy env scrubbed for the child process only:
  `env -u HTTPS_PROXY -u https_proxy -u HTTP_PROXY -u http_proxy npx firebase-tools emulators:exec …`
  (GitHub CI is unaffected — no proxy there.)
- Dummy-secret generation for emulator runs must exclude
  `TURNSTILE_SECRET` (present ⇒ configured ⇒ fail-closed 403 on every
  tokenless `submitPublicLead`). The ci.yml step already does.
- A local `npm install` in tests/ adds a `proxy-agent-negotiate` package to
  the lockfile — environment-induced; don't commit that drift.
