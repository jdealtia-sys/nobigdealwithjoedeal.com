# Remote branch cleanup — 381 → 15 (2026-09-05)

The remote carried **381 branches**. 366 were deleted; 15 kept. Every deleted
branch was verified present on `main` first. Every tip SHA is recorded in
[REMOTE-BRANCH-MANIFEST-2026-09-05.txt](REMOTE-BRANCH-MANIFEST-2026-09-05.txt),
so any row is one command from coming back:

```
git push origin <sha>:refs/heads/<name>
```

The manifest was committed **before** the deletion, deliberately. A restore
manifest that only exists in a temp directory is not a restore manifest.

Companion to handoff item 8, which did the same job for *local* branches on
2026-09-05 and left the remote untouched — 381 branches is what "local-only
cleanup" leaves behind.

## Why the obvious method would have been wrong

**This repo *mostly* squash-merges** — 1144 of 1341 merged PRs have a
`(#N)`-suffixed squash commit on `main`, but `main` also carries **220 merge
commits**, 130 of them titled `Merge PR #NNN: …`. (An earlier draft of this
note said "squash-merges every PR". That is false, and the adversarial audit
caught it — see §Where my own reasoning was wrong.) A squash merge creates a
new commit on `main` with a new SHA and no ancestry link back to the branch.
So:

- `git branch --merged` / `git merge-base --is-ancestor` reports **1 of 381**
  branches as merged. Trusting it would have deleted almost nothing.
- Its inverse is the dangerous half: "not an ancestor" looks like "unmerged
  work" for 380 branches, 365 of which were fully merged.

Handoff item 8 hit this and recorded the fix; this note is the remote-side
application of it.

## Classification, in evidence order

| # | evidence | meaning |
|---|---|---|
| 335 | branch tip SHA **==** the `headRefOid` of a MERGED PR for that name | the exact commits GitHub squashed |
| 17 | every commit reachable from tip but not `main` has a subject matching one on `main` **after stripping a trailing ` (#NNN)`** | stacked branches whose tips are squash commits |
| 1 | tip is a literal ancestor of `main` | trivially merged |
| 13 | judged SUPERSEDED/OBSOLETE by agent assessment **and** survived adversarial refutation | content re-landed by another route, or deliberately abandoned |
| **366** | **deleted** | |
| 13 | carry work absent from `main` | **kept** — see below |
| 2 | `main`, `master` | protected |

### The ` (#NNN)` detail

GitHub's squash appends the PR number to the commit subject. `feat(d-1):
server-side PDF renderer` on a branch is `feat(d-1): server-side PDF renderer
(#355)` on `main`. Without normalising that suffix, subject matching scores
**zero** and 17 fully-merged branches look like unique work. With it, all 17
resolve cleanly.

## What the adversarial pass caught

Three agents attacked the 353-branch delete list on separate lenses — reused
branch names, subject collisions, and non-commit file content. **None found a
blocking hole.** Two findings worth keeping:

- **A latent weakness in the subject rule.** `main` carries **26 duplicated
  subjects** (`Add files via upload` ×19, `fix: geo cleanup` ×6, …), so subject
  matching is not sound in general. Verified independently: **zero** of the 17
  relied on a duplicated subject, so it fired zero times here. Anyone reusing
  this method on a different set must re-check that.
- **A benign pre-CSP draft.** The `step*` branches' tips are not patch-identical
  to their `main` twins: they render the GPS button as
  `onclick="qaUseMyLocation()"`, while `main` ships the CSP-safe
  `data-action="call" data-fn="qaUseMyLocation"`. The branch-only text is a
  draft that this repo's `script-src-attr 'none'` invariant would reject
  outright. Superseded, not lost.

**Adversarial refutation changed the outcome.** Of 18 held branches an assessor
judged safe, a second agent prompted to *refute* flipped **5** back to
real-work: `nbd-pro-session-verify-5fwriw`, `owner-claims-phase2-pf6ei4`,
`crm-batch2-consolidations`, `stripe-key-trim`, `phase-d-foundation`. A single
assessment pass would have deleted all five. The cost asymmetry is the whole
argument: a wrong "safe" is permanent, a wrong "keep" is one surviving branch.

Two SUPERSEDED rulings were additionally re-verified by hand rather than taken
on trust — `t1-ai-texting-foundation` (a 261-line draft at
`functions/ai-texting.js`; `main` carries 612 lines across three
`functions/handlers/ai-texting*.js`) and `siteurl-seed-repoint` (patches
`functions/seed-companies.js`, which `main` deleted deliberately in #1236).

## Where my own reasoning was wrong

The deletions were right; two load-bearing claims behind them were not. Both
were found by the adversarial audit, and both are recorded here because the
next cleanup will be tempted by the same shortcuts.

**1. "Squash-merges every PR" — false.** `main` carries 220 merge commits, 130
titled `Merge PR #NNN: …`, and only 1144 of 1341 merged PRs have a `(#N)`
squash commit. The ancestry point survives (1 of 381 branches is an ancestor of
`main`), but "every" did not.

**2. "Tip == a MERGED PR's headRefOid" does not by itself prove the work is on
`main`.** **17 merged PRs had a base other than `main`** — two stacked chains
(`d1→d2→d2.5→d2.6→d2.7→d3→d4→d5`, PRs #355-362, and
`step1→step2→…→step5→step13→…→step17`, PRs #345-354), each PR merging into the
*next branch down*, not into `main`. 16 of those head branches were in the
delete set. For them the rule proved only "merged somewhere".

Checked separately, and they are safe: every commit in both chains is on `main`
under its own squash commit — `feat(d-1): … (#355)` through
`feat(d-5): … (#362)`, `feat(step-1): … (#345)` through
`feat(step-17): … (#354)`. The chains did land; the rule just didn't show it.

**A method note for whoever repeats this.** A tempting bulk check —
"for each branch, do the files it touched still differ from `main`?" — is
useless in both directions. It is over-inclusive because `main` legitimately
moved on (344 of 353 deleted branches "differ" for that reason alone), and it
silently under-reports if run with a pathspec from a directory that git treats
as a *subdirectory* of the repo, where `-- docs/…` matches nothing and every
branch reads as identical. One audit agent hit exactly that and reported 342
branches clean; re-run from a real worktree root the same command gives 9. Use
merged-PR identity and commit-subject matching, not file diffs against a moving
`main`.

## The 13 kept — work that is NOT on main

| branch | flipped by refutation | what it holds |
|---|---|---|
| `claude/security-audit-stress-test-EuTga` | no | **`CLOUDFLARE_WORKER_FINDING.md` (267 lines) — an unremediated, unfiled security audit of four live Cloudflare workers.** See below. |
| `claude/naughty-carson-eeb685` | no | ~3,138 lines of unmerged CRM feature code (weekly recap, review funnel, inspection capture, daily brief) |
| `v3-foundation` | no | a complete greenfield "NBD Pro V3.0" rewrite — Turborepo + pnpm monorepo, a stack `main` uses nowhere |
| `phase-d-build` | no | `docs/pro/privacy.html`, a 611-line SaaS privacy policy for the CRM product |
| `claude/review-chat-transcription-P0O3V` | no | 899 lines of Ask-Joe doctrine/domain content |
| `claude/owner-claims-phase2-pf6ei4` | **yes** | Phase-2 server-side owner-claims hardening (`functions/handlers/_shared.js`) |
| `fix/crm-batch2-consolidations` | **yes** | the KPI modifier-class system in `docs/pro/css/dashboard-app.css` |
| `phase-d-foundation` | **yes** | `documentation/PRICING.md` + seats/perSeat plan config |
| `fix/stripe-key-trim` | **yes** | `createStripePaymentLink` catch-block error classification |
| `claude/nbd-pro-session-verify-5fwriw` | **yes** | a 112-line dated takeover-verification note |
| `fix/qa-sweep-2026-06` | no | `scripts/local-serve.js` (105 lines) and a second file on no other ref |
| `claude/fix-kanban-map-loading-rsxqC` | no | two live fixes, incl. an `enforceRateLimit` call-signature bug |
| `claude/xenodochial-gould-8b6a02` | no | the ~25-line iOS auth-restore grace window (`REDIRECT_GRACE_MS`) |

**These are decisions, not chores.** Each is real work someone stopped
mid-flight. Landing or explicitly abandoning them is a judgment call for Jo —
the cleanup deliberately did not make it.

### Flagged: an unremediated security finding

`claude/security-audit-stress-test-EuTga` holds a 267-line audit of four live
Cloudflare workers under `jonathandeal459.workers.dev` that was never filed as
an issue or a vault note, and never remediated. It is the one kept branch whose
content is time-sensitive rather than merely unfinished, and it should be read
before it is a year old.

## Branch protection, re-confirmed (not a new finding)

Checked before deleting, since a protection rule could have blocked it: `main`
has protection **ON** with 7 required status checks (Smoke tests, Unit suites,
Site integrity, Node syntax check, Secret scan, Firestore rules tests, Functions
parse + dep install), verified via the API on 2026-09-05. There are no
repository rulesets and the rule is `main`-scoped, so it did not affect branch
deletion.

This is **not** news — Jo enabled it on 2026-09-03 and INDEX already records it.
Noting it here only because one older doc still says the opposite:
[NEXT_SESSION-2026-08-26](../projects/NEXT_SESSION-2026-08-26.md) line 17 reads
"No required checks on main (`--auto` merges …)". That line is stale; `--auto`
is now a real gate. Left in place as dated history rather than edited, since
it was true when written.
