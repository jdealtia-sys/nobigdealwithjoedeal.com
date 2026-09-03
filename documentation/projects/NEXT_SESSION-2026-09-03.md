# Next session — brief as of the end of 2026-09-02

> Supersedes [NEXT_SESSION-2026-09-02](NEXT_SESSION-2026-09-02.md) (whose
> morning lanes closed) — this evening's session record:
> [SESSION-2026-09-02-daily-driver-and-honest-gates](SESSION-2026-09-02-daily-driver-and-honest-gates.md).
> Research output: [FREE-API-INTEGRATIONS-RESEARCH-2026-09-02](../audit/FREE-API-INTEGRATIONS-RESEARCH-2026-09-02.md).

## State of the world

- **Daily-driver fixes are live** (#1344–#1347): three revenue views route
  again (deep link / refresh / Back), add-lead no longer celebrates an aborted
  save and its validation errors are visible on a phone, photo-review bulk
  Share no longer throws, and the dashboard stops reloading itself on every
  customer-page hop (one SW scriptURL).
- **`dashboard.legacy.html` is gone** (#1348). It was byte-identical to the
  live page. `/pro/dashboard.legacy*` 301s to `/pro/dashboard` (proven on a
  preview channel); `?legacy=1` is ignored. Rollback is `git revert`.
- **Three gates are honest now.** Visual-regression compares against 12
  committed baselines (#1349 — its own run was the first real comparison);
  `npm test` runs the smoke battery + the manifest's node and smoke buckets
  (#1351); the Storage rules suite gates the deploy (#1350), and the four
  Firestore collections + four Storage prefixes with zero assertions have 87.
- **Branch protection on `main` is OFF** (verified via API). Every merge
  still deploys immediately; poll checks yourself.
- Housekeeping: 126 merged remote branches pruned (484 → 358),
  `chore/stripe-pin-harden` deleted (superseded by #774), `nul` removed.
- Rock 2's Sentry clock still runs to ~2026-09-30. Rock 4 T3 stands at 25/36
  registry-only; twin ownership is settled (see §5 of the session note).

## Lanes, in priority order

1. **Free-API integrations, wave 1** — five PRs, all verified free at this
   scale, all on existing seams (details + evidence in the research doc):
   (a) fix the broken Wayback historical-imagery slider
   (`maps-routing.js:2404-2413` keys + `wayback.maptiles.arcgis.com` in
   `img-src`) and add KyFromAbove 3-inch aerials on the D2D tracker first;
   (b) dictation off Deepgram onto Groq Whisper (`dictate.js:111-133`; the
   key and the `groq` default already exist); (c) NWS rain-day chip on the
   smart calendar (no key; there is no `windGust` field); (d) NCEI SWDI
   radar-hail provider behind `NBD_HAIL_PROVIDER=swdi` (`hail.js` fetchers
   map + `preferredHailProvider()`); (e) Healthchecks.io pings on the 24
   crons + Better Stack uptime/status page. If time remains: the read-only
   `.ics` calendar feed.
2. **Photo tokens, the engineering half** — `onLeadDeleted` reaps photo
   originals + `_variants/*.webp` + thumbs + docs (`lead-artifact-cleanup.js:37-42`
   skips `photos/` on a false premise) and a 30-day `pdf-renders/` reaper.
   The signed-URL cutover itself waits on Jo's IAM grant (queue item 1).
3. **Cron-gate durability** — all 12 `*_ENABLED` names with explicit values
   in `functions/.env.nobigdeal-pro`, a smoke drift pin, a gate table in the
   health digest. Forces one guarded full redeploy; merge last on a quiet
   evening.
4. **Bound the four unbounded reads** (`monthly-overhead-alert.js:59`,
   `health-digest.js:114`, `handlers/adjuster-board.js:55`,
   `handlers/ai-texting-stats.js:52`); tests for `storm-watch.js`,
   `data-export.js`, `integrations/killswitch.js`; `invoice-pipeline.js` onto
   cents; wire `scripts/crm-audit.js` into CI.
5. **T3 next slice** with the twin evidence; delete the four shadowed
   property-intel forks after a snapshot proof. **Rock 2** wizard deletion
   after 2026-09-30 if Sentry shows zero `startNewEstimateOriginal` events.

## Jo's queue — the precise asks (newest first)

1. **Grant `roles/iam.serviceAccountTokenCreator` on the compute SA** (~2 min,
   GCP Console → IAM). This unblocks signed photo URLs, `renderPdf` signed
   URLs and the whole token migration — the highest-leverage console item
   there is. Then say so, and a session will probe `POST /signImageUrl`.
2. **Turn on branch protection for `main`** (~2 min): require at least the
   `Smoke tests` and `Firestore rules tests` checks. Verified OFF today.
3. **Cloud Storage backup**: Object Versioning on
   `nobigdeal-pro.firebasestorage.app` + a daily Storage Transfer to a second
   bucket (OPS_AUDIT P0 #2 — photos and contracts are unrecoverable today);
   and tell a session which of the two Firestore backup buckets is canonical.
4. **For wave 1 (all free, some have review queues)**: a Healthchecks.io
   account and a Better Stack account; a Census API key (instant); enable the
   Solar API on the GCP project; **start Meta App Review** for Lead Ads
   (mandatory, days-to-weeks) and the **GBP API access request** (never
   approved; blocks Local Posts) so wave 2 is not blocked. Optional: an
   ArcGIS Location Platform free key to put the Esri imagery already in use
   on licensed footing.
5. Which payment handles belong on invoices (Zelle is deliberately `info@`;
   PayPal/Venmo absent) — needed before touching the invoice block.
6. Unchanged: seat price + `STRIPE_PRICE_SEAT`, App Check console enforce,
   delete the 7 retired functions, cost-basis rotation, Turnstile order,
   Copycat PAT (optional), Cal.com real booking.

## Watch-outs (carried + new)

- `main` is held by the `nbd-wt-ledger-recon` worktree — branch from
  `origin/main`, never check out `main` in the primary checkout. Commit with
  explicit file lists or `git add -u`; `nul` reappears untracked.
- **The hosting emulator applies neither redirects nor headers.** Any
  `firebase.json` hosting change: preview channel, Node probe, delete the
  channel. `emulators:exec "<script>"` runs under cmd.exe on Windows.
- **Visual-regression now compares.** A PR that changes login, register,
  pricing or the landing page must delete
  `tests/e2e/visual-regression.spec.js-snapshots/` in the same PR and commit
  that PR's artifact (the smoke pin will tell you). Login overflows at 375/768
  — fix and re-bless together.
- **`npm test` in tests/ is now the real thing** (smoke battery + 109 manifest
  suites, ~40 s after deps). The per-suite `test:*` scripts still exist.
- **Workflow runs can stall silently** on one hung agent in a barrier — check
  the journal's mtime before waiting on a notification.
- Two PRs inserting a smoke section before the same `section(...)` line will
  merge-conflict; anchor new sections on distinct neighbours.
- **#1351** merged at close after two CI rounds: a Playwright-install flake
  on the first run, then the smoke battery's own pin caught that the first
  cut of `npm test` had dropped `smoke.test.js` — the gate did its job.
