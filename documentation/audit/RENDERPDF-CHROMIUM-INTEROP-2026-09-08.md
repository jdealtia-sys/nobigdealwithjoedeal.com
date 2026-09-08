# renderPdf: every server-rendered document has failed since June

**2026-09-08** · project `nobigdeal-pro` · fixed in this session

Every server-side PDF render — warranty, estimate, invoice, contract, change
order, receipt, inspection, photo report — has failed at `stage: launch` since
the `@sparticuz/chromium` 148 → 149 bump. The callable threw
`HttpsError('internal', 'PDF render failed at stage: launch')` every time and
the client silently fell back to its `html2canvas` path, so customers kept
receiving *a* document and nothing ever surfaced as broken.

Nothing alerted for the entire window.

---

## 1. The finding, re-verified

```bash
gcloud logging read 'jsonPayload.message=~"renderPdf"' --project=nobigdeal-pro \
  --limit=60 --format="value(timestamp,jsonPayload.stage,jsonPayload.err)" --freshness=30d
```

22 entries in the retention window. **Every one a failure. Not one
`[renderPdf] ok` line.** All identical:

```
stage: launch
err:   chromium.executablePath is not a function
```

Newest 2026-09-07T17:42Z, oldest 2026-08-16T23:53Z — the start of retention,
not the start of the problem.

## 2. Root cause — an ESM-only republish, no code change

`functions/render-pdf.js` `getBrowser()` did:

```js
const chromium = require('@sparticuz/chromium');
_browser = await puppeteer.launch({
  args: chromium.args,
  executablePath: await chromium.executablePath(),   // ← threw
});
```

Both package versions were installed and inspected directly rather than
reasoned about:

| | `exports` shape | `require()` returns | `executablePath` |
|---|---|---|---|
| **148.0.0** | dual, with a `"require"` condition → `build/cjs/index.cjs` | the module itself, **no `.default` at all** | direct property ✓ |
| **149.0.0** | `{".":{"types":…,"default":"./build/index.js"}}`, `"type":"module"` | the **ESM namespace** `{ __esModule, default, inflate, setupLambdaEnvironment }` | on `.default` ✗ |

149 dropped its CommonJS build. On the `nodejs22` runtime `require()` takes the
`require(esm)` path and hands back the module namespace; the real API is a class
sitting on `.default`. Reading `.executablePath` off the namespace gives
`undefined`, and `await undefined()` is the error in the logs.

The runtime detail matters: on a Node without `require(esm)` this would have
been a loud `ERR_REQUIRE_ESM` at load. Because the runtime *does* support it,
the failure degraded into a property read returning `undefined` — which is why
it looked like a code bug rather than a packaging change.

**No code changed to cause this.** The pin moved in
`deps(functions): bump @sparticuz/chromium 148->149 + puppeteer-core 24->25.1.0 (#712)`
on **2026-06-24**, and that alone broke it.

### Corrected timeline

The brief that opened this session said "at least three weeks". That was the
*retention window*, not the outage. The pin has been `149.0.0` since
2026-06-24, so the real figure is **roughly eleven weeks** — 2026-06-24 to
2026-09-08. Logs older than 30 days are gone, so the earlier stretch cannot be
shown directly; the version history is the evidence.

### Neither suspected PR was involved

- **#1483** (photo report) — already **merged** at `ac8f7e69`. It touches
  `render-pdf.js` but not `getBrowser()`, and did not cause or fix this.
- **#1456** (dependabot, 17 updates) — still **open**, therefore not deployed
  and not implicated.

## 3. The part the symptom hid: `args` was undefined too

`chromium.args` read off the same namespace, so it was `undefined` as well —
the error just surfaced on `executablePath` first because that one is *called*.

A fix that only unwrapped the throwing call would have launched Chromium with
**no flags at all**, dropping all 22 including `--no-sandbox` and
`--single-process`, and failed again one line further down. Both reads are
fixed, and a regression test pins them as a pair
(`tests/render-pdf-chromium-interop.test.js`, break 2).

## 4. The fix

`resolveChromium(mod)` probes for the API instead of reaching for `.default`
unconditionally — the latter would resolve fine today but regress the moment
the package ships CJS again, since 148 had no `.default`. An unrecognised shape
now throws a message naming the package and the keys it actually saw, so the
next packaging change identifies itself rather than reappearing as
"is not a function".

## 5. Why nobody knew — and what now watches it

This is the more important half. A 100% failure rate on a customer-facing
document path ran for eleven weeks in silence, because **the client fallback
is indistinguishable from success from the outside.**

### 5a. Not one alert policy is deployed — a finding well past renderPdf

`monitoring/alert-functions-error-rate.json` *does* list `renderpdf` in its
service regex, so on paper this path was covered. Two independent reasons it
was never going to fire:

**It is not deployed. Nor is any other policy.**

```bash
gcloud alpha monitoring policies list --project=nobigdeal-pro --format=json
# []
```

Ten policy definitions live in `monitoring/`; **zero exist in the project.**
Verified with a positive control on the same API surface — `channels list`
returns the two channels (email + sms) those very files reference, so the
credentials and the API are fine and the empty result is real, not a format
quirk. `monitoring/README.md` documents applying each one by hand with
`gcloud alpha monitoring policies create`; that appears never to have happened,
or they were removed later. Everything the repo believes it is watching is
unwatched:

`backup-cron-stale`, `claude-budget-exceeded`, `email-queue-worker-stale`,
`function-latency`, `functions-error-rate`, `migrations-tick-stale`,
`rate-limit-spike`, `tenant-microsite-errors`, `validateAccessCode-bruteforce`,
`voice-processing-failures`.

**And even deployed, it could not have caught this.** The condition is
`> 50` errors with a `300s` `ALIGN_RATE` window — a *spike* detector. renderPdf
produced **22 failures in three weeks**. A total, sustained, 100% outage on a
low-volume path is precisely the shape a spike threshold cannot see; the
threshold alone is more than double the entire failure volume of the outage.

That is the second, independent argument for the digest signal below keying on
a **missing success** rather than a failure count — and it holds whether or not
anyone deploys the policies.

**Recommended, not done here** (a prod change, and Jo's call): apply the ten
policies, then re-run the `list` above to confirm they exist. Deploying them is
worth doing, but it would not by itself have caught this outage.

`functions/render-pdf.js` now writes `metrics/renderPdf` on both outcomes
(lifetime `okCount` / `failCount`, last ok/fail timestamps, last stage and
error), and `functions/health-digest.js` reports it in the daily digest — in
the **subject line**, not only the body, because a warning that only exists
inside an unread email is not a warning.

**The signal is a missing success, not a rising failure count.** This path saw
22 calls in three weeks; any "N failures in 24 hours" threshold either sleeps
through a total outage or fires constantly. "Renders were attempted and not one
succeeded" trips on the first digest after a break, at any volume. A read
failure degrades to silence rather than a false alarm, matching the other
gatherers.

## 6. Verified, and not

**Verified here.** Both packaging shapes installed and inspected; the resolved
object exposes `executablePath()` and a 22-flag `args`; `executablePath()`
resolves to a path. Both new suites were **proven able to fail** — the interop
suite against three separate breaks (full revert; the `args`-only half-fix; an
unconditional `.default` unwrap that regresses the CJS direction), the digest
suite against four (a volume threshold, a removed signal, a false alarm on a
healthy renderer, and dropped HTML escaping) — with the reddened assertions
checked each time, not just the exit code.

**Not verified here.** Chromium cannot actually be launched off Linux —
`@sparticuz/chromium` ships a Linux x64 binary — so *that the browser boots in
the deployed function* is not proven by anything in this repo. Since this path
has never once succeeded on 149, a second failure further down the launch
sequence is possible. **Confirm after deploy**: render any document and look
for a `[renderPdf] ok` line, which has not existed in production since June.

## 7. Loose end

The brief cited `documentation/audit/PDF-RENDER-RETENTION-2026-09-08.md`
("Still open", item 1) as recording this finding in full. **That file does not
exist** — not in this worktree, not on `origin/main`, not anywhere in history.
Either it was never written or it lives in a session that has not landed. This
note stands in for it; if that document does appear, its item 1 is resolved
here.

---

## Files

- `functions/render-pdf.js` — `resolveChromium()`; both `args` and
  `executablePath` read from the resolved object; `recordRenderOutcome()`
  on the success and failure paths
- `functions/health-digest.js` — `gatherRenderPdf()`, `renderPdfBroken()`,
  `renderPdfSection()`, wired into the digest body, subject and structured log
- `tests/render-pdf-chromium-interop.test.js` — new, zero-dep
- `tests/health-digest-render-pdf-signal.test.js` — new, zero-dep
- `tests/ci-manifest.json`, `scripts/run-test-manifest.js` — both suites
  registered; ratchet floors raised 65→67 smoke, 186→188 disk

Related: [DEPLOY-RETRY-FILTER-2026-09-07](DEPLOY-RETRY-FILTER-2026-09-07.md)
(the other recent case of a deploy-shaped failure nothing was watching) and
[SUITE-COUNT-FLOORS-2026-09-08](SUITE-COUNT-FLOORS-2026-09-08.md) (the ratchet
whose floors this session raised).
