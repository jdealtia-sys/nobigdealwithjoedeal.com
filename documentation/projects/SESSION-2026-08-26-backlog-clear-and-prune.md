# Session 2026-08-26 — PR backlog cleared, advisory tier emptied, repo pruned to zero rot

Six lanes in one session, run largely inside a GitHub Actions **major outage**
(database-primary failover, began ~15:05Z) that froze the merge queue — which
turned out to be productive scheduling: everything below was built and locally
verified while waiting, and lands in one sequenced merge pass at recovery
([NEXT_SESSION-2026-08-26](NEXT_SESSION-2026-08-26.md) §0 is that sequence).

State at close: **five open engineering PRs, all locally green, none
CI-checked** — #1279 (advisory flip), #1253 (storage-orphan rescue), #1255
(quota runbook salvage), #1280 (pro auth fonts), #1281 (ci-suite-runner) —
plus #1282, this archive. #1273 (dependabot) merged before the outage; its
post-merge CI/deploy run sat queued when this note was written. Every
checkable claim below was verified against live git/gh state by a six-agent
workflow before the archive shipped (34 confirmed, 0 wrong).

---

## 1 · The PR backlog (three rescues, one merge)

- **#1273** (functions non-major deps, 27 updates) — 19/19 green, squash-merged
  per house dependabot style. firebase-admin now 14.3.0.
- **#1253 rescued** after 8 days and 128 commits of drift. The conflict was
  architectural, not textual: main's 08-18 consolidation had moved the whole
  documents surface into `customer-documents.js`, and the PR's tokenless-View
  fix was written into the old file. Resolution: take main's structure, port
  the intent — normalize() prefers the authed `getDocumentHtml` callable
  whenever a row carries `htmlPath` (falling back to the legacy permanent-token
  `htmlUrl` only for rows that never recorded a path), a CSP-safe delegated
  `data-doc-view` button, `viewGeneratedDoc()` verbatim. Both original CI reds
  diagnosed: **Unit suites** failed because the PR's new
  `orphan-sweep-parser.test.js` was never classified in `tests/ci-manifest.json`
  (the completeness gate doing its job); **Site integrity** was stale-base
  (passes clean on the merged tree). The rescue review also found a real hole:
  `onLeadDeleted` deleted client-written `htmlPath`/`archivePath` **verbatim
  over the admin SDK** — plant any bucket path in your own lead's documents
  subcollection, hard-delete the lead, and the trigger deletes an object
  Storage rules would never let you touch. Now confined to lead-artifact
  prefixes referencing the deleted lead, mirroring `getDocumentHtml`'s read
  confinement. Store guard extended to 50 assertions (tokenless shape +
  both-fields-prefer-callable). FUNCTIONS_INDEX re-enumerated at merge:
  **189 keys = 170 deployed + 19 helper** (base had drifted +3 while the PR
  sat open); stale header count corrected in place.
- **#1255 rescoped, not closed.** Main had independently grown its own
  (shorter, since-annotated) `NEXT_SESSION-2026-08-18.md`, which every later
  doc links — so the PR's longer twin was dropped in main's favor. What main
  never got is the piece Jo's open quota decision actually references:
  `runbooks/CLOUD-RUN-CPU-QUOTA-REQUEST.md`. The PR is now that runbook + its
  INDEX line, docs-only.

## 2 · The advisory tier is empty (#1279)

The WEEKLY_CADENCE streak ledger reached its bar: 8/10 as counted in #1278,
plus #1277 and #1278 themselves — job-level conclusions verified for all four
ledgered jobs in both. **#1279 removes all five `continue-on-error` flags**
(the `@engines` matrix expression + four job literals), including
`qc-render-sweep`, which was never in the ledger (born after the item was
written) but carries its own "promote once green" note in ci.yml and is green
on every completed main run since introduction — the one judgment call,
flagged in the PR body.

**The flip shipped incomplete and was caught in-session** — by reviving the
ci-suite-runner lane (§6), whose commit message pins the flag count. Both
promotion pins (`tests/gauntlet-regressions.test.js` + its deliberate twin in
`tests/smoke/functions.test.js` — "a change here needs the same change there")
still asserted the @engines expression exists and counted exactly 4 literals;
#1279's own CI would have failed at recovery. Both pin pairs collapsed into
the strictly stronger **zero pin** (per the files' own 2026-07-28 assert-by-
intent reasoning), then tightened to line-anchored `/^\s*continue-on-error:/m`
after the dry-run merge showed the substring form counting the lane's doctrine
*comment* as a violation. Re-parking a flaking job stays legitimate at the
documented price: a dated WHY in ci.yml plus both pins.

## 3 · /pro auth pages self-host their fonts (#1280)

The deferred Pro-perf item from 08-25. `/pro/login` and `/pro/register`
render-blocked on external `fonts.googleapis.com` CSS (also the documented
cause of their E2E timeouts in CDN-less sandboxes — this fix removes that
noise source for both pages). 22 woff2 files (Barlow 400–700, Barlow
Condensed 400–900, DM Mono 400+500; latin + latin-ext) in
`docs/assets/fonts/`, declared in `docs/assets/css/nbd-fonts-pro.css`.
Decisions worth keeping:

- **Hosted weights = requested ∩ used.** Browsers only download faces the CSS
  actually sets, so weights in the css2 URL but absent from the page's rules
  were never fetched before — omitting them is byte-identical behavior. These
  are STATIC families; the Montserrat variable-font collapse doesn't apply.
- Login's css2 URL requested **Bebas Neue that no rule on the page uses** — a
  dead request, dropped rather than migrated.
- One deliberate upgrade: register sets Barlow ≥700 but its css2 URL topped
  out at 600 (synthesized bold before); the shared file provides the real 700.
- The two **page-scoped CSP blocks** in firebase.json drop their now-dead
  `fonts.gstatic`/`fonts.googleapis` allowances (`font-src 'self'`). Global
  CSP unchanged — ~25 other /pro pages still load external fonts (follow-up
  lane; the long tail is the theme-preview pages).

Verified against local `firebase serve`: every face 200 same-origin,
`document.fonts` zero failures, zero external font requests, console clean,
headers suite 60/60, site-integrity clean, rendered sweep green — its lone
`/sites/oaks` finding is the known **`firebase serve` ignores-redirects
artifact** (CI's emulator-based sweep is authoritative and green on main).

## 4 · The prune: 13 worktrees → 4 (→ 3 after §6), ~140 local branches deleted

Jo-directed. Worktrees removed after per-tree cleanliness checks: audit0805,
connect3, css2, d2d, insp-save, pro-landing + the three `.claude/worktrees`
leftovers. Survivors: primary, `nbd-wt-ledger-recon` (main), `nbd-wt-enable-step`
(#1255) — and ciglob was later retired too when its lane moved to the primary
checkout (§6). Branch deletion ran in **descending evidence tiers**, ~140
deleted:

1. plain `git branch -d` — git-certified merged (73);
2. exact tip SHA = head of a **MERGED** PR, via one `gh pr list` join (38);
3. every unlanded commit's subject present in main's squash history (19);
4. individually adjudicated: 3 workflow copies fully contained in
   `feat/connect-phase3`, which itself merged **as #1145 from that very
   branch** (retitled at merge — why subject-matching missed it) with its one
   extra commit patch-id-identical inside merged #1146.

Then the **six-straggler triage** (Jo-directed), each closed on content-level
evidence — the added-lines-present-in-main measurement, then targeted
verification of the misses:

| Branch | Verdict |
|---|---|
| prov-fix | 222/222 lines on main — landed |
| cjur | overlay reshaped by the August cost work; its own test suite green on main |
| dux-fix | mobile-spotlight coverage landed in evolved form |
| inv-fix | its "missing" lines were the OLD copy — main's has the post-/pro/landing-retirement URL |
| microsite-publication-gate | gate/test/runbook landed; seed chore targets a file main deleted (#1236) |
| adoring-tharp-54f2e6 | the per-payment money ledger is on main **in superior form** |

**The lesson that justifies the method** (recorded for the next revival
temptation): the July money-ledger branch used field vocabulary
(`receivedAt`/`source`) that main's landed reader (`at`/`method`, remainder-
aware) silently skips — merging that stale branch would have *caused* the
month-jumping bug it was written to fix. "No PR at this SHA" ≠ unmerged, and
subject-match ≠ content-match; only content-level checks close a branch
honestly. (An earlier false alarm the same way: "0 ledger refs in
invoice-pipeline" was a grep artifact — `invoice.payments` vs `inv.payments`.)

## 5 · The junction incident (self-inflicted, recovered, memorialized)

Retiring the ciglob worktree, the reparse scan **found** a
`functions/node_modules` junction — but `git worktree remove` was chained in
the same command and ran anyway. Git deleted **through the junction** and
emptied the primary checkout's real `functions/node_modules` (ignored files
don't block removal; git's recursive delete followed the reparse point).
Collateral was contained (tests/, docs/ untouched); recovery was one
lockfile-faithful `npm ci`. The memory
(`worktree-path-length-limit`) now records the confirmed mechanism and the
operational rule the incident actually teaches: **scan-then-remove must be two
gated steps** — scan, read the output, unlink, verify the target, then remove.

## 6 · ci-suite-runner revived (#1281)

The parked 2026-08-23 lane (never PR'd): the smoke job's 65 hand-written steps
— where the first red step hid the other 64 results — collapse into
`run-test-manifest.js --bucket smoke` with per-suite `::group::`, per-failure
`::error`, a job-summary table, enforced non-empty per-suite docs, and the
FLOORS ratchet in the script rather than self-attesting JSON. Rebased onto
main as a **clean replay** (zero drift in all four files since its base).
Battery: smoke bucket 65/65, node 43/43, manifest completeness clean (122
suites), gauntlet 257/0, full smoke.test.js 3433/0, workflows parse.

Because it collides semantically with #1279, a **throwaway dry-run merge**
(lane × flip) was executed and verified: ci.yml auto-merges; the one gauntlet
conflict resolves as *flip's zero pin + lane's two-fact bucket assertions*
(both superseded forms dropped); merged state passed gauntlet 256/0, both
buckets, manifest check, YAML parse, zero flag keys. That resolution is
documented in the PR body — merge time is mechanical. The dry-run is also what
caught the substring-pin false positive (§2).

---

**Merge sequencing, reconciliations, and Jo's carried queue:**
[NEXT_SESSION-2026-08-26](NEXT_SESSION-2026-08-26.md).
