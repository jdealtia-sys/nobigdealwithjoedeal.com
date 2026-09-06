# NEXT SESSION — 2026-09-08

Prior session: 2026-09-06, Instant Roofer + public-funnel measurement + Turnstile.
Session note: [SESSION-2026-09-06-instantroofer-adapter](SESSION-2026-09-06-instantroofer-adapter.md) ·
runbooks: [INSTANTROOFER-SETUP](../runbooks/INSTANTROOFER-SETUP.md), [TURNSTILE-SETUP](../runbooks/TURNSTILE-SETUP.md)

Five PRs merged: **#1420** (Instant Roofer adapter), **#1424** (the public
funnel measures the roof), **#1425** (Turnstile wired), **#1429** (this
handoff), **#1434** (bill the $75 pass-through on AI measures too).

**#1434 landed after this handoff was first written and amends #1424's
behaviour.** Every measurement is now `passThruEligible` — AI measures, 90-day
reuse copies and web-lead auto-measures included. The original exclusion was
mine, on the reasoning that a $3 internal cost with no deliverable should not
carry a $75 line; Jo's call is that the measurement is work performed either
way. What survived is the wording: a `passThruHasDocument` flag makes the quote
line read "Aerial measurement report" only when a document actually exists
(HOVER/EagleView PDF, human report) and "Aerial roof measurement" otherwise, so
no invoice claims a report that could never be produced. **Do not merge those
two strings** — the wording and its reasoning comment are both pinned by
`tests/instantroofer-measurement.test.js`. Verified deployed: run 34054579976
succeeded and `requestMeasurement`'s revision updated 19:47 UTC, after the
19:20 merge.

---

## §0 — Jo's queue

1. **Nothing, until Sunday.** Two scheduled tasks are already booked: a day-1
   sanity check (2026-09-07 14:00) and the **7-day Turnstile token-rate report
   (2026-09-13 14:00)**, which is the go/no-go on setting `TURNSTILE_SECRET`.
   Scheduled tasks only run while the app is open; if it is closed they fire on
   next launch.
2. **Try the thing.** Open any CRM lead with an address → V2 builder → 📐
   Auto-measure. It works now for the first time since April. 9 free AI
   measurements remain, then $3 each.
3. **Optional:** check the Instant Roofer Billing page after the first 404
   ("roof not found") or 422 ("too large or irregular") — nobody knows yet
   whether those are billed, and the runbook has a hole where that fact goes.

## §1 — What is live

| Thing | State |
|---|---|
| Instant Roofer adapter, rep-facing | **LIVE, verified on the deployed revisions** — `requestMeasurement` and `measurementWebhook` carry `INSTANTROOFER_API_KEY` / `INSTANTROOFER_WEBHOOK_SECRET` |
| Human-report webhook | Configured in their dashboard (PDF format, 10 payload fields, bearer token); secret set and verified 43 chars |
| Automated web-lead measurement | **LIVE and verified** — deploy 34049215929 succeeded and `measureNewWebLead` carries `INSTANTROOFER_API_KEY` on the deployed revision |
| Turnstile site key | **LIVE and verified** by curl against the real URL, despite its own deploy being cancelled — see §2 |
| `TURNSTILE_SECRET` | **Deliberately NOT set.** Step 4 of 4, gated on the Sunday report |
| $75 pass-through on every measurement | **LIVE and verified deployed** (#1434) — wording varies by `passThruHasDocument` |

## §2 — Both "is it actually running?" checks came back CLEAN

Both were the same failure shape — merged code that looks fine and does
nothing — and both were verified before this handoff was written. Kept here as
the recipe, because it is the check this repo keeps needing.

**(a) ~~`measureNewWebLead` must carry `INSTANTROOFER_API_KEY`.~~ CONFIRMED.**
Deploy 34049215929 completed successfully and the deployed revision carries the
key. `publicRoofMeasure` shows no secrets, which is **correct** — it is
read-only and declares none by design.

```bash
gcloud functions describe measureNewWebLead --region us-central1 \
  --project nobigdeal-pro --gen2 \
  --format="value(serviceConfig.secretEnvironmentVariables)"
```

If the key were ever absent, `hasSecret()` reads an unbound `process.env`, the
adapter returns `notConfigured`, and **every public estimate lead silently goes
unmeasured while the logs say "not configured" forever.** Fix: re-run the
deploy workflow (`scope=functions`).

**(b) ~~The Turnstile site key must actually be serving.~~ CONFIRMED LIVE** —
`curl` against the real URL returns `SITEKEY = "0x4AAAAAAEqcVVOXW3xyusXQ"`.
Worth knowing anyway: its own deploy run (34049872527) was **cancelled**
(`concurrency: firebase-deploy` + `cancel-in-progress: false` keeps exactly one
pending run, so a third merge drops the middle one) and a later deploy carried
it. "Merged" is not "served" here; re-check with that curl if in doubt.

## §2b — The live-page token probe came back EMPTY. Read this before Sunday.

After the key went live, `window.nbdTurnstileExecute()` was run on the real
`https://nobigdealwithjoedeal.com/estimate` in an automated browser. It
returned **no token** in 6.7 s. Do not panic and do not dismiss it — the
evidence points one way but is not proof:

- The console shows `[Cloudflare Turnstile] Error: 600010` — a **challenge**
  failure. It is NOT `110200` ("domain not allowed") and not a sitekey error.
- The Turnstile script loaded (the warnings come from it), the widget
  container rendered, and `__NBD_TURNSTILE_SITEKEY` read back correctly.

So the wiring and hostname config look right, and the most likely explanation
is Turnstile correctly refusing a **CDP-automated browser** — i.e. bot
detection doing its job on the probe itself. The earlier local probe got tokens
only because Cloudflare's *test* keys always pass regardless of signals; the
real key applies real detection.

**What this does NOT establish:** that a real human on a real browser gets a
token. Only live traffic answers that, which is exactly what the 7-day watch
is for. **Do not set `TURNSTILE_SECRET` on the strength of "the code looks
right"** — if the true cause were a config fault rather than bot detection,
every public lead would 403.

Small real defect noticed in the same console output, not fixed: the client
calls `turnstile.render()` (which auto-executes an invisible widget) and then
`turnstile.execute(id)` again, producing `Call to execute() on a widget that is
already executing`. Benign today — the widget still runs — but it is a
reset()-vs-execute() bug in `docs/assets/js/public-lead-submit.js` worth
tidying when someone is next in that file.

## §3 — Open follow-ups, in the order I would take them

1. **Set `TURNSTILE_SECRET`** — after Sunday's report, and only if the token
   rate justifies it. The trade is real: once set, a visitor whose browser
   blocks `challenges.cloudflare.com` gets a 403 and loses their lead. At
   ~1 lead/day a 10% false-negative rate is a customer every ten days.
   Rollback is instant (blank the secret, redeploy).
2. **Human report CSV → linear feet.** The webhook delivers a file URL only;
   the AI measure has no ridge/hip/valley/eave/rake. Jo chose to wait — their
   announced **API V3** adds those to the AI response and has already dropped
   raw LiDAR, which may make this obsolete. Watch for the migration doc before
   building it.
3. **Measurement before contact capture** (the "instant" experience Instant
   Roofer sells). Needs Turnstile *enforced* first, plus a CSP `img-src` entry
   or a re-host for the roof-outline image — `firebase.json:89` lists no
   instantroofer host, so the image is silently blocked today.
4. **Company-scoped `measurements/` rules.** Today read is uid-owner or platform
   admin, which is why the 90-day reuse copies a doc rather than pointing at it.
5. **Let reps use V2 Auto-measure.** `integrationStatus` is admin-only, so the
   gate reports "not set up" to ordinary reps. The D2D button bypasses it and
   works for everyone — the two entry points have different auth behaviour.

## §4 — Traps this session paid for

- **A squash-merged branch cannot be built on.** Committing on top of the
  already-merged branch produced a PR that would have **reverted 3,008 lines**
  of other people's work. Fix: branch fresh from `origin/main` and cherry-pick.
  The handoff commit sitting on main at the time literally warned about this.
- **`gh pr checks --watch` exits while runs are still queuing.** It reported
  "not all passed" when nothing had failed. Poll for `pending == 0 && failing
  == 0` instead.
- **`esc()` is not defined in `crm-pipeline.js`.** Using it in the kanban card
  would have thrown and blanked every card. Server-side sanitising to a
  digits-only shape is the pattern that file can actually support.
- **A green deploy is not a bound secret, and a merged file is not a served
  file.** Both were checked against the deployed revision and the live URL this
  session and both came back clean (§2) — but only because they were checked.
  Two of this session's deploys were cancelled mid-queue by concurrent merges.
- **The measurement lane had been dark since April** — all three legacy
  provider keys were the deploy's `__unset__` stub, created 2026-04-14 within
  three seconds of each other. `GOOGLE_GEOCODING_API_KEY`, `REGRID_API_TOKEN`
  and `TURNSTILE_SECRET` are the same stub. Assume nothing is configured
  without checking Secret Manager version metadata.
