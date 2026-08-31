# Public-repo copy posture — recon baseline + hardening (2026-08-31)

**Trigger:** a question about whether this public repo had been cloned by a
third party. Answering it took a five-lane sweep of every public signal a
clone could leave; the sweep came back clean, and the useful residue is
this note: the **baseline**, the **fingerprint list**, the **measured
limits of each detection channel**, and the hardening that shipped.

**Outcome in one line:** no evidence anyone has ever cloned, forked,
browsed, or reused this repo — and the repo now says out loud that nobody
may (LICENSE), with a monthly gate re-checking the baseline
(`.github/workflows/copycat-watch.yml`).

## What the sweep checked, and what each channel is actually worth

| Channel | Result at baseline (2026-08-31) | Evidentiary strength |
| --- | --- | --- |
| GitHub traffic API — clones (14-day window) | Clone counts track CI ~1:1 (≈13–18 checkouts per Actions run; matrix jobs each clone). No day shows residue above the CI baseline. | Good for spikes; can't attribute individual cloners. Window is only 14 days. |
| GitHub traffic API — views | **1 unique visitor in 14 days** (25 views, all one day, hitting /commits, a PR, Actions runs — the owner's own self-visit profile). | Strong: an outsider who found the repo through the web UI would register. A direct `git clone` by URL registers **no** view. |
| Forks / stars / watchers | 0 / 0 / 0 — ever. | Strong and real-time. Only catches GitHub-native copies. |
| GitHub user/repo search for related names | No matching account or repo exists. | Near-real-time, name-dependent. |
| GitHub code search for fingerprints | 0 foreign hits — **but see the control failure below.** | Weak when 0; strong when >0. |
| Live-web recon | Nothing deployed anywhere public derives from this codebase (checked candidate hosts and fingerprints; the only third-party lookalike found was an unrelated agency-built static demo sharing zero code — different fonts, palette values, and architecture; overlap limited to generic navy/orange CSS token *names*). | Only covers guessable public URLs. |
| Prod CRM cross-check | The account that prompted the question had one short session, zero data, no return visit. | Rules out in-app scraping as a copy vector (UI exposure only). |

### The control failure worth remembering

`gh api search/code` returned **zero hits for strings occurring 600+ times
in this repo's own default branch** (`q=Roofivent repo:jdealtia-sys/...` →
0, while a `jquery/jquery` control query returned hits). GitHub's
code-search API simply does not index this repo. Consequence: **a zero in
code search proves nothing** — a freshly pushed clone would very likely be
equally unindexed. The copycat-watch gate keeps the code-search checks
anyway because a *hit* is a strong signal; it just never treats a miss as
clearance. (Fifth member of the "guards defeated by their own lists"
family, in spirit: a guard whose empty result gets read as a pass.)

### Fingerprint list (verified present locally at baseline)

Keep `.github/workflows/copycat-watch.yml` in sync with this table.
Counts are repo-wide over tracked files at this PR's HEAD, measured as
`git grep -o -F '<string>' | wc -l` (occurrences) and
`git grep -l -F '<string>' | wc -l` (files) — re-measure the same way or
the diff reads as phantom drift. The new audit note and workflow contain
these strings themselves, so the counts include them.

| String | Occurrences (files) | Notes |
| --- | --- | --- |
| `Roofivent` | 640 (239) | coined word — best single fingerprint |
| `nobigdeal-pro` | 433 (198) | Firebase project id |
| `No Big Deal with Joe Deal` | 74 (71) | phrase — but the legacy code-search API tokenizes (AND-of-words, no exact-phrase), so treat a hit as look-worthy, not proof of verbatim copy |
| `NBD_ESTIMATE_CONFIG` | 29 (20) | estimate config global |
| `nbd_kanban_view` | 10 (7) | prefs key — manual-sweep-only, not in the workflow's TERM list (rate-limit budget) |
| `site_wide_spec_20260410` | 7 (7) | locked-spec comment marker |
| `RealDealAcademy`, `AskJoe` | — | **do not use**: noisy (domain-name lists, word datasets) |

## What shipped (this PR)

- **`LICENSE`** — proprietary, all-rights-reserved, plain English. Names
  the real carve-outs (GitHub-ToS view/fork rights that attach to any
  public repo; viewing the deployed site; the bundled third-party
  libraries under `docs/assets/vendor/` and fonts under
  `docs/assets/fonts/`, which keep their upstream licenses and are not
  NBD's to claim) and claims the brand names. Before this the repo had
  *no* license file — legally already all-rights-reserved by default, but
  silent about it.
- **`README.md`** — "source-visible, not open source" notice up top + a
  License section; licensing contact jd@nobigdealwithjoedeal.com.
- **`tests/package.json`** — `"license": "UNLICENSED"` alongside the
  existing `"private": true`. `functions/package.json` was deliberately
  **left alone** this round: editing it triggers a functions deploy on
  merge (see [DEPLOY-FALSE-GREEN-MODES-2026-08-17](DEPLOY-FALSE-GREEN-MODES-2026-08-17.md)) for a purely cosmetic
  field — add it whenever the next real functions change ships.
- **`.github/workflows/copycat-watch.yml`** — monthly scheduled re-check
  of the baseline (counters vs acknowledged baseline, repo-name search,
  fingerprint code search). Goes red → owner email on any signal; benign
  signals get acknowledged by bumping the baseline env vars in the file.

## The honest limits (what "public" irrevocably means)

- GitHub's ToS grants every user the right to **view and fork** any public
  repo. The LICENSE constrains *use*, not GitHub-forking.
- A `git clone` / ZIP download leaves **no attributable public trace**.
  Detection channels only catch what gets *republished*.
- The live site is scrapeable regardless of the repo's visibility.
- **Enforcement path if a copy ever surfaces:** GitHub DMCA takedown
  (works cleanly against pushed clones precisely because no license was
  ever granted), plus the LICENSE makes the position explicit.

## Options considered — decided 2026-08-31 (same day, Jo's call)

1. **Split the crown jewels out** — move `docs/pro/` + `functions/` to a
   private repo, keep the marketing site public, merge at deploy in CI.
   The only *structural* fix: today the public tree hands any copycat the
   full CRM source, the Firestore data model, and `firestore.rules`.
   **SHELVED on cost — the CI is the cost, not the repo.** Private repos
   are free, but private-repo Actions minutes are metered (2,000
   free/month on this plan) while public-repo minutes are unlimited-free.
   This repo ran **344 workflow runs in 15 days** (Aug 17–31 count from
   the traffic lane) including ~18-minute deploys — the heavy CRM/deploy
   suites are exactly what would move to the metered repo, so the split
   converts currently-free CI into a recurring bill (Actions overage
   ~$0.008/min). Jo's constraint is $0. Revisit only with budget or after
   drastically pruning CI. (Verify current GitHub pricing at that time.)
2. **Make the whole repo private** — rejected: being public is
   deliberate, and the same metered-minutes math applies.
3. **`/*! © */` banner headers in flagship JS** so provenance travels
   inside any copy — **DONE 2026-08-31**, 7 files: `nbd-auth.js`,
   `crm.js`, `dashboard-bootstrap.module.js`, `estimate-logic-engine.js`,
   `estimate-builder-v2.js`, `estimate-catalog-xactimate.js`,
   `estimate-labor-catalog.js`. Deterrence + DMCA evidence, not
   prevention. `functions/index.js` deliberately skipped again (comment
   edit would trigger a functions deploy) — add its banner with the next
   real functions change, same as the manifest field.

## Re-run procedure (manual, any time)

1. `gh workflow run copycat-watch.yml` (or wait for the monthly cron).
2. For a deep re-sweep, re-run the five lanes: traffic
   (`gh api repos/.../traffic/{clones,views}` — remember the 14-day
   window), forks/stars, user+repo-name search, code search per the
   fingerprint table (with the index caveat), and web search for newly
   deployed lookalikes.
3. Baseline to diff against is the table above.
