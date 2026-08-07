# Next Session — after the 2026-08-07 stability/perf/accuracy power session

> Cold-start brief, written 2026-08-07 at session end. Self-contained.
> Predecessor [NEXT_SESSION-2026-08-06](NEXT_SESSION-2026-08-06.md) is fully
> executed (corrections stamped at its top). Read the repo-root
> [CLAUDE.md](../../CLAUDE.md) first. The full findings/fixes record is
> [audit/SYSTEM-STABILITY-PERF-2026-08-07](../audit/SYSTEM-STABILITY-PERF-2026-08-07.md).

## What this session shipped (one PR, 16 commits on `claude/system-stability-performance-muhs1l`)

Stability: daily build-projects CI time-bomb defused · maps.js sibling
re-exports guarded (theme/font engine can no longer be silently killed) ·
damagNearMe deduped to the good implementation · functions
unhandledRejection→Sentry · Anthropic fetch timeouts · Turnstile client/server
contract pinned by test. Accuracy: V2 estimate engine moved to integer-cents
money math (behavior-preserving, 17 suites green unchanged, drift fixtures
added) · blog structured-data fixes · 4 standing docs corrected in place.
Performance: theme + Leaflet lazy bundles (~390 KB off CRM boot) · stripe +
twilio lazy requires (884→695 ms index require, all 170 functions) · shared
icon stylesheet (−12,078 duplicated lines) · GA out of the LCP race. Ease of
use: homepage form inline validation + honest 2-required policy · mobile-nav
Escape · carousel keyboard support + lightbox focus trap · 404 recovery row.
CI: manifest registry wires 36 formerly-orphaned suites with an anti-orphan
tripwire; @engines shard, public-e2e, brand-tokens, visual-regression jobs
land ADVISORY.

## Jo actions (decisions / console — not agent work)

1. **Turnstile wiring order** (the landmine is now guarded but still needs the
   real key): mint the sitekey, populate
   `docs/assets/js/inline/7cd8e505ab.js`, deploy, **then** set
   `TURNSTILE_SECRET`. Reverse order 403s every public lead. The stub file
   carries this warning.
2. **Visual-regression bless**: after the PR's CI run, download the
   `visual-regression-output` artifact, eyeball the 12 baselines, commit them
   under `tests/e2e/visual-regression.spec.js-snapshots/`. The job flips to
   compare mode automatically.
3. Unchanged from 2026-08-06: first priced project on /our-work · kie.ai
   visualizer flip · TAMKO placeholder pricing · blog drafts (25 `JO:`
   markers) · GBP/DMARC checklist · **prod deprecation-log check** (gates
   classic-wizard deletion) · read the `/cspReport` Cloud Logging sink
   (STEP 0 of the CSP generated-docs audit).

## Advisory-job promotion checklist (the repo bar: prove green, then block)

- `@engines` shard, `public-e2e`, `visual-brand-tokens`: after ~10 green runs
  on main, flip `continue-on-error` (the matrix uses an expression; the jobs
  use a literal). Any flake: fix the race first, per the ci.yml doctrine.
- `visual-regression`: needs the bless step (Jo action 2) before its streak
  can start.

## Deferred queue (ranked)

1. **Theme/maps lazy-bundle field verification** — the surgery is covered by
   smoke + theme suites + CI shards, but a human eyeball on a real phone
   (saved engine theme applies after boot; map view opens; d2d loads) is the
   honest final check. If anything regresses: each bundle is one revert
   (`theme` kick in dashboard-state.js / `mapvendor` in VIEW_BUNDLES).
2. **Firestore offline persistence decision brief** — the CRM queues writes
   offline but has NO offline read cache (`initializeFirestore` without
   `localCache`; a rep in a dead zone sees an empty pipeline). Adding
   `persistentLocalCache` is a few lines; the decision is lead-PII-in-
   IndexedDB + cache-clear-on-signout. Needs Jo's call, then ~half a day.
3. **rate-limit-policy.js adopt-vs-delete** — zero consumers; either wire
   `guardCallable` into `claudeProxy` / `submitPublicLead` /
   `validateAccessCode` as a pilot (closes the documented per-uid-only gap)
   or delete the module + its shape-only smoke assertions.
4. **Classic-wizard deletion (Rock 2 PR 6 part 2)** — STILL GATED on Jo's
   prod logs + pre-V2 migration decision, and now explicitly on the
   dashboard.legacy.html call: the "snapshot" rides the live js/ directory at
   562 markup diff-lines adrift, so deleting the wizard breaks `?legacy=1`
   unless the snapshot is refreshed or `?legacy=1` is retired first.
5. **functions cold-start increment 2** — per-module lazy export proxies for
   index.js (needs firebase-functions v7 discovery verification; increment 1
   deliberately left index.js untouched).
6. **Inline-CSS dedup phase 2** — the icon beachhead shipped; ~2.7 MB of
   byte-identical page CSS remains (the `.nav`/hero/footer blocks). Needs a
   generator design, not a hand sweep.
7. **404 full chrome conversion** — bespoke-CSS design pass (see audit note).
8. **Globals Tranche 3** (~515 middle-band globals) — zone-draw unblocked by
   this session's maps.js guards; still needs its own dependency-ordered plan.
9. **Functions emulator widening to all E2E shards** — parked on boot cost
   (unchanged).

## Environment notes (new learnings this session)

- The remote sandbox CANNOT run the authed e2e login flow (identical failure
  at a pre-change baseline commit — environment, not product). Don't burn
  time on it; CI is the arbiter.
- Sandbox Chromium revision differs from pinned Playwright expectations —
  bridging symlinks under `/opt/pw-browsers/` works for non-authed specs.
- `npm ci` fails in `tests/` (lockfile vs sandbox npm env); use
  `npm install --silent` like CI does, then discard lockfile drift.
- Emulator suites still need the proxy env scrubbed; TURNSTILE_SECRET still
  excluded from dummy-secret generation (unchanged from 2026-08-05).
