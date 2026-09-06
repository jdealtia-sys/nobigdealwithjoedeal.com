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
| `claude/security-audit-stress-test-EuTga` | no | `CLOUDFLARE_WORKER_FINDING.md` (267 lines) — an unfiled 2026-04-11 audit of four Cloudflare workers, **plus** a full migration off them. Mostly overtaken by events; **one worker is still live and exposed.** See below. |
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

### The Cloudflare worker finding — read 2026-09-05, mostly stale, one live gap

`claude/security-audit-stress-test-EuTga` holds `CLOUDFLARE_WORKER_FINDING.md`,
a 267-line audit dated **2026-04-11** of four workers under
`jonathandeal459.workers.dev`, plus a single commit migrating every AI caller
off them. It was never filed as an issue or a vault note.

**Corrects this note's own first draft**, which called it "unremediated". Read
and probed on 2026-09-05 (reachability + CORS preflight only — no exploit
payloads, no forged Stripe event, no DALL-E call). Most of it has been overtaken
by events:

| worker | audit finding (2026-04-11) | state 2026-09-05 |
|---|---|---|
| `nbd-stripe-webhook` | **highest severity** — no Stripe signature check, forged `checkout.session.completed` grants free Pro; embedded Firebase service-account JSON | **deleted** |
| `nbd-mailerlite` | wildcard CORS, no auth/rate limit, list-write API key | **deleted** |
| `nbd-ai-proxy` | wide-open CORS with an `origin === ''` bypass; holds an Anthropic key | **live, but CORS now locked** to `https://nobigdealwithjoedeal.com` |
| `nbd-ai-visualizer` | `ACAO: *`, no auth, DALL-E 3 HD at $0.08/image → ~$69k/day exposure | **live and unchanged — still returns `ACAO: *` to an arbitrary origin** |

Deleted-vs-live was established against a control: a worker name that never
existed returns byte-identical `error code: 1042` / 404 / 17 bytes, which is
what the two "deleted" rows return. The two live ones answer with their own
worker headers (405 + their own CORS), which a missing worker cannot do.

**The one open item: delete `nbd-ai-visualizer`.** Nothing in `docs/` calls it —
`publicVisualizerAI` in `functions/handlers/ai.js` is the hardened replacement
and is live on `main`. Deleting it is a dashboard action with no site impact.
`nbd-ai-proxy` is second: no browser can reach it cross-origin any more and
nothing calls it, but it still holds an Anthropic key, so deleting it and
rotating that key is cleanup rather than an emergency.

### Vendor billing (audit step 13) — OpenAI, Gemini and Anthropic all checked

Checked in the OpenAI console on 2026-09-05 (the audit's step 13, for one of its
four vendors). **Spend over the last 90 days: $0.00 — and none ever.**

- Usage: $0.00, **0 tokens, 0 requests**; September spend $0.00
- Billing history: **no invoices, ever**
- Billing overview: **Free trial**, still prompting "Add payment details" — no
  payment method on file
- Credit grants: **none**
- One organisation, one project, and exactly one API key — the one this worker
  uses — whose **"Last used" reads `Never`**, five months after it was created
  on 2026-04-05

That last line is the direct evidence, not an inference from a spend total: the
key was never exercised once. And the endpoint could not have run up a bill even
if it had been hammered — with no credits and no payment method, every call
would have failed at OpenAI on quota. **The April audit's "~$69k/day" figure
assumed a funded account; this one never was.**

So `nbd-ai-visualizer` is **housekeeping, not an exposure**. It is still an
unauthenticated public endpoint answering `ACAO: *`, and this repo is public —
which now documents that fact — so delete it rather than leave it advertised.

**Update 2026-09-05 — three of the four vendors are now checked, and the answer
is consistent: none of the exposed workers was ever actually exploited.**

| vendor | verdict | evidence |
|---|---|---|
| **OpenAI** (`nbd-ai-visualizer`) | clean, and could not have been billed | $0.00 ever; no invoices, no credits, no payment method; its one API key reads "Last used: **Never**" |
| **Gemini / Google Cloud** (same worker) | **inert** | the **Gemini API is not enabled** on `nobigdeal-pro` — the console offers an "Enable" button — and 90 days of billing carries no Generative Language or Vertex AI line at all |
| **Anthropic** (`nbd-ai-proxy`) | no abuse — **but the key was never rotated** | see below |
| **MailerLite** | still unchecked | its worker is already deleted |

Google Cloud was the one expected to matter, since unlike OpenAI it is a funded
account ($260.54 over the same 90 days). It carries no Gemini spend whatsoever;
the whole bill was Cloud Run Functions, Secret Manager and Cloud Scheduler.

### Anthropic: no abuse, one thing outstanding

90-day cost is **~$1.32** ($0.58 + $0.61 + $0.13 across three windows — the
console caps a range at 31 days). Lifetime consumption is about **$1.69**: a
single $5.30 credit grant on 2026-04-08 is the only invoice the account has ever
issued, with $3.61 still on it. Auto-reload is **off**, so usage stops dead at
the balance whatever the $1,000 monthly limit says.

Every window is **Claude Haiku 4.5 only**. That is the load-bearing detail
rather than the total: `nbd-ai-proxy` permitted **Opus** and a 4096-token cap,
and nobody exploiting it would have picked Haiku.

**But the key was never rotated.** Exactly one API key exists on the account,
created **2026-04-08** — three days *before* the audit that told Jo to rotate
it. A rotation would have left a newer key and retired that one. So the
credential that sat in a wide-open Cloudflare worker is still the live key
today. Low severity now (the worker's CORS is locked to the site origin,
nothing calls it, and the numbers show it was never touched) but it is still a
publicly-exposed credential that remains valid.

**Corrects a claim made earlier in this session:** that `ANTHROPIC_API_KEY`
version 1 in Secret Manager was a superseded credential still retrievable. Since
only **one** Anthropic key has ever existed, v1 and v2 — created an hour apart
on 2026-04-08 — cannot be two different keys; v1 was almost certainly a bad
paste replaced the same hour. Disabling it is tidiness, not the closing of a
second live secret.

**The branch's code changes are obsolete — do not merge it.** Every client
migration in it landed by another route: `claudeProxy`, `stripeWebhook` and
`publicVisualizerAI` are real exports on `main`; no page calls a worker URL (the
three surviving `nbd-ai-proxy` mentions under `docs/` are comments recording the
migration); `docs/estimate.html` makes no AI call at all, so the branch's
`publicEstimateAI` is moot; and the localStorage-key fallback in
`docs/pro/js/claude-proxy.js` is already disabled by default behind an explicit
`window.NBD_ALLOW_DIRECT_ANTHROPIC` opt-in. What survives is the finding
document and the vendor-key rotation list, which is why the branch is kept.

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
