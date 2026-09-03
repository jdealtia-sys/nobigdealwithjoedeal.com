# Session 2026-09-02 (evening) — the CRM as a daily driver, and three gates that could not fail

Jo asked two things: "look at the state of the CRM in its entirety — where would
you focus the next session?" and "heavy research on free API integrations (maps,
connections) that add ease of use at little or no cost." This note records what
the recon found, what shipped, and the three things that went wrong in the
method. Companion state: [NEXT_SESSION-2026-09-03](NEXT_SESSION-2026-09-03.md).
Research output: [FREE-API-INTEGRATIONS-RESEARCH-2026-09-02](../audit/FREE-API-INTEGRATIONS-RESEARCH-2026-09-02.md).

## 1 · Recon — what "the state of the CRM" actually is

Three code-reading surveys (client, functions + rules, tests/CI/open findings)
and three session designs (risk-first, user-first, leverage-first); every
headline claim below was re-verified by hand before it drove a decision.

- **Momentum had been all refactor + docs** (Globals Tranche 3, vault, copycat
  CI) while the daily driver rotted in small ways: three shipped revenue views
  (`expenses`, `money`, `refrewards`) had no `routeConfig` entry, so deep
  links, hard refresh and Back silently failed (the W160 class, recurred);
  add-lead showed "Lead saved!" after `_saveLead` had returned null on the
  Lite cap / billing gate / dedup-cancel; photo-review bulk Share threw a red
  "Portal module not loaded" on every use; and `offline-manager.js`
  registered `/pro/sw.js?v=13` while the dashboard registered `/pro/sw.js`,
  so every dashboard ↔ customer hop installed a new worker and force-reloaded
  the dashboard (deterministic, not a race).
- **`dashboard.legacy.html` was byte-identical to `dashboard.html`** (`cmp`
  clean) and had been "refreshed" by every dashboard commit including all
  four T3 slices — a rollback snapshot that rolled nothing back, ~6,400
  duplicate lines on every edit, and no `no-store` header.
- **Three gates read green while asserting nothing.** The REQUIRED
  `visual-regression` job had run `--update-snapshots` on every execution
  since it shipped (the baseline dir was never committed) and was promoted on
  a "10/10 streak" of that; `tests/package.json`'s `npm test` skipped 22
  manifest suites including every cost-privacy guard while `BIG_ROCKS` sent
  every session to it; `storage.rules` deployed from `firebase-deploy.yml`
  but its suite ran only in `ci.yml`, which the deploy never waits for.
- **Branch protection on `main` is OFF** (`gh api …/branches/main/protection`
  → 404, rulesets `[]`); `.github/CODEOWNERS` was decorative.
- **The photo-token exposure is real and gated on Jo.** `image-pipeline.js`
  mints a permanent public token for every variant the CRM renders (the 08-18
  audit's "reads go through signImageUrl" premise is true only for originals);
  `signImageUrl` has no fallback without `roles/iam.serviceAccountTokenCreator`,
  which has never been granted, so cutting tokens today blanks every photo.
  Full detail in the handoff.
- Backend is otherwise unusually clean (170 exports reconcile with
  `FUNCTIONS_INDEX.md`, App Check on 58/58 onCall, default-deny rules) but
  carries four unbounded reads, non-durable cron `*_ENABLED` gates (10 of 12
  revert to DRY-RUN on every deploy), and zero tests on the digest/cron family
  and the AI kill switch.

## 2 · What shipped (one evening, nine PRs)

| PR | What | Proof |
|---|---|---|
| #1344 | route `expenses`/`money`/`refrewards` + a two-way view↔route smoke tripwire | smoke 3545/0 |
| #1345 | add-lead: early return when `_saveLead` aborted; validation errors scroll into view + toast | smoke pins |
| #1346 | photo-review defines `window._mintPortalUrl` (same `createPortalToken` contract as the dashboard); emulator hookup for the callable | NEW-D31 → FIXED |
| #1347 | one SW scriptURL; pin scans every `serviceWorker.register()` under docs/pro, requires a dedicated sub-scope for any other worker | pin proven to fail on the old string |
| #1348 | `dashboard.legacy.html` + redirect deleted; `/pro/dashboard.legacy*` → 301; 13 comments + 19 test loops corrected; 6 docs corrected in place | **preview channel**: both legacy URLs 301 → 200, `?legacy=1` → 200 |
| #1349 | 12 CI-rendered baselines committed (each viewed); ci.yml comment corrected; smoke pin on the baseline matrix | the PR's own job logged "baselines committed — compare mode … 12 passed" — the first real comparison ever |
| #1350 | 60 Firestore assertions (`/invoices`, `/supplements`, `/connectAccounts`, `leads/*/portal_messages`) + 27 Storage assertions (`galleries/`, `reports/`, `shared_docs/`, `audio/`); Storage suite joins the deploy gate | both suites green under local emulators |
| #1351 | `npm test` = `smoke.test.js` + manifest node + smoke buckets; node floor 43→44; BIG_ROCKS run-tests line | the smoke battery caught the first cut (it skipped `smoke.test.js`) via a pin that encoded the old chain |
| close-out | this note, the handoff, the research doc, 7 doc-rot corrections, queue updates | `check-vault-index` |

No-PR close-out: `chore/stripe-pin-harden` deleted (its hardening half landed
via #774; root cause was a trailing newline in the secret); **126 merged
remote branches pruned (484 → 358)**; the stray `nul` removed.

## 3 · The research lane, and how it stalled

A 10-category sweep produced 80 candidates; two adversarial refuters per
candidate (pricing/terms against official pages; codebase fit against the
repo) ran to 159/160 verdicts — then **one verifier hung for seven hours
inside a `parallel()` barrier**, the critic and synthesis never ran, and no
completion notification ever arrived. Jo had to ask twice. The run was
stopped and the synthesis done by hand from `journal.jsonl` + the agent
transcripts. 53 candidates survived, 27 were rejected with the refuting fact
recorded. The verified shortlist, the seams, and the rejections are in the
research doc; wave 1 is lane 1 of the handoff.

## 4 · Method lessons (recorded so they are not re-learned)

- **Prove a gate can fail before trusting its streak.** Two pins were run
  against the pre-fix state on purpose (SW URL, baselines) and one no-op
  assertion (`|| true, 'informational'`) was caught in review of my own diff
  and deleted. A streak of a job that cannot fail is not evidence.
- **The hosting emulator applies neither `redirects` nor `headers`** here —
  it 404'd the long-shipped `/pro/landing` rule and sent no CSP. Preview
  channel only. `emulators:exec "<script>"` runs under cmd.exe on Windows
  (no pipes, no single quotes; use a Node probe file); `/tmp` in Git Bash is
  not `C:\tmp` for Node.
- **A hung agent in a workflow barrier is silent.** Check `journal.jsonl`
  (started vs results, mtime) instead of waiting; salvage from the journal;
  cap fan-out in code, not in the prompt (the sweeps ignored "up to 8").
- **Adjacent insertion anchors conflict.** Two PRs both inserting a smoke
  section before the same `section(...)` line would have merge-conflicted;
  one was re-anchored before push.
- **`git add -u` + explicit file lists**, never `-A`: the `nul` device file
  keeps reappearing untracked.

## 5 · Observations parked for later (not fixed here)

- The login page overflows its viewport at 375 and 768 (baselines are 435
  and 828 px wide); the landing page's lazy gallery renders as placeholder
  tiles at `networkidle`.
- Four property-intel forks are shadowed dead code (`dashboard-api.js:180`,
  `:308`, `dashboard-widgets.js:729`, `:795`) — `property-intel.js` wins the
  window slot; the free-geocoder seam is therefore `property-intel.js:731`.
- `invoice-pipeline.js` is the one money surface still doing float math.
- `scripts/crm-audit.js` is clean and wired into no workflow.
- The dead ~120-line background-sync block in `sw.js` stays until a device
  check (boot-wedge history).
- T3 twins are settled by evidence: `ui.js` owns `closeShortcutsPanel` and
  `closeCmdPalette`; `closeTaskModal` is a page-scoping problem, not a race.
