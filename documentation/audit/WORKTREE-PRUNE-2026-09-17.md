# Worktree prune — 2026-09-17

Jo: "check the work trees as long as they serve no real purpose we can prune
them." 37 stale directories removed from this machine (`C:\Users\jonat\`),
2 kept — one intentionally (still in active use), one flagged as containing
real, unmerged value.

## Method

`git branch --merged` misreports squash-merged branches as unmerged in this
repo (see [[squash-merge-defeats-ancestry-checks]] in memory) — every merge
here squashes, so that check alone is worthless. Verification instead:

1. For each `git worktree list` entry with a named branch, matched the
   worktree's local tip SHA against `gh pr list --state all`'s
   `headRefOid` for that exact branch name.
2. For an exact SHA match on a `MERGED` PR: safe, no further check needed
   (the branch never moved past what merged).
3. For a branch name with no matching PR (all named `tmp-*` or similarly):
   diffed the branch's real source files (not just `scripts/run-test-manifest.js`/
   `tests/ci-manifest.json`, which drift harmlessly on every commit via the
   FLOORS counter) against `origin/main`, file by file. A diff with content
   ONLY on main's side (no `<` lines, i.e. the branch is purely *missing*
   later changes) confirms the branch has zero unique content. A diff with
   real content on the branch's side (`<` lines) got read in full before any
   prune decision.
4. For the three `.claude/worktrees/*` (detached-HEAD, Claude Code's own
   scratch worktrees): checked each tip commit's file content against main
   byte-for-byte, or via `git merge-base --is-ancestor`.
5. For directories that appeared on disk but were absent from
   `git worktree list`: confirmed they were truly orphaned (no `.git` file,
   or a `.git` pointer file whose target `.git/worktrees/<name>` admin
   directory no longer exists on the main repo's side — i.e. dangling, not
   a live worktree git itself still tracks) before deleting as plain
   directories, not via `git worktree remove`.

## Pruned (26 registered worktrees — `git worktree remove --force`)

**20 SHA-exact-matched to a merged PR** (tip commit identical to what
actually shipped): `nbd-wt-admclaim` (#1584), `nbd-wt-copy` (#1536),
`nbd-wt-crmflow` (#1581), `nbd-wt-custaudit` (#1586), `nbd-wt-docstatus`
(#1612), `nbd-wt-esignsteer` (#1614), `nbd-wt-favicon` (#1534), `nbd-wt-forms`
(#1539), `nbd-wt-gdpr` (#1508), `nbd-wt-invemail` (#1520), `nbd-wt-isolate`
(#1538), `nbd-wt-logofix` (#1611), `nbd-wt-mobiledocs` (#1616), `nbd-wt-monitor`
(#1547), `nbd-wt-photo` (#1507), `nbd-wt-photoreport` (#1499),
`nbd-wt-pushshape` (#1546), `nbd-wt-tiersource` (#1615), `nbd-wt-ts4s`
(#1548), `nbd-wt-turnstile` (#1542).

**4 no-PR / oddly-named branches**, each confirmed zero unique content vs
`origin/main` (source files either byte-identical or differing only by
later, unrelated main-side additions):
- `nbd-wt-adjboard` (`tmp-adjboard`) — `dashboard-bootstrap.module.js`'s
  32-line diff was 100% "missing later main additions" (this session's own
  #1616/#1619 work landed after this branch was cut); its actual test file
  (`analytics-card-cache-account-switch.test.js`) was byte-identical.
- `nbd-wt-annitouch` (`tmp-annitouch`) — matches the earlier-documented
  "stale tmp-annitouch merge attempt" from the #1585 resolution; both real
  source files (`functions/anniversary-touch.js`, `functions/stage-roles.js`)
  byte-identical to main.
- `nbd-wt-esignfix` (`tmp-esignfix`) — matches the earlier-documented
  "stale tmp-esignfix merge attempt" from the #1588 resolution; the one
  non-zero diff in `esign-setup.js` was an object-literal line later
  extended with more properties on main, not unique content.
- `nbd-wt-funnelfix` (`tmp-funnelfix`) — `functions/funnel-recovery.js` and
  its test file both byte-identical to main.

## Pruned (3 orphaned `.claude/worktrees/*`, detached HEAD)

- `intelligent-mestorf-a42208` — tip was one of the two independent,
  now-superseded early attempts at the #1608 CRLF mutation-gate fix
  (hardcoded `\r\n` in the target string — the exact bug the real fix
  corrected). Confirmed inferior/superseded, not unique.
- `nifty-euclid-45395f` — tip's `warranty-claim.test.js` byte-identical to
  main's (the other early #1608 attempt).
- `optimistic-wozniak-3edb7b` — tip commit `954e7331` is a direct ancestor
  of `origin/main` (confirmed via `git merge-base --is-ancestor`).

## Pruned (11 fully orphaned directories — not registered as worktrees at all)

Found on disk under `C:\Users\jonat\` and `.claude/worktrees/` but absent
from `git worktree list`; each had either no `.git` file at all, or a `.git`
pointer file targeting a `.git/worktrees/<name>` admin directory that no
longer exists in the main repo. All were empty or near-empty and 4–70+ days
stale (oldest: `nbd-wt-portalai`, 2026-07-22): `nbd-wt-974`,
`nbd-wt-decisions`, `nbd-wt-docstd`, `nbd-wt-emptyfail`, `nbd-wt-oaks`,
`nbd-wt-portalai`, `nbd-wt-reviews`, `nbd-wt-seats`, `nbd-wt-tripwire`,
`.claude/worktrees/agent-a3f1c88c16ab38eb4`,
`.claude/worktrees/nervous-stonebraker-ca83ce`. Removed as plain
directories (`Remove-Item -Recurse`), then `git worktree prune -v` run to
clear any remaining stale git-side admin references.

## Kept — 1 flagged for real, unmerged value

**`nbd-wt-bridge`** (branch `test/push-bridge-executing`) — NOT pruned. Its
tip commit ("run the page bridge instead of regex-matching its origin
check") rewrites the weakest part of `tests/push-notification-actions.test.js`:
main's current version only checks that `push-actions.js` *contains* the
strings `NBD_PUSH_ACTION` and `location.origin` — the same shape of check
that let #1541's digit-deleting phone regex pass while broken. This branch
replaces that with a real `vm.createContext` execution of `push-actions.js`,
feeding it the exact message shape the service worker posts and asserting
on what `window.location` actually did: an in-app path navigates, a
same-origin absolute URL resolves by path (not the full URL), and — the
part that matters — `https://evil.example/...`, `//evil.example/...`,
`/\evil.example/...`, and `javascript:alert(1)` are all refused, a
same-origin page outside `/pro/` is refused, and a `window` message from
another origin is ignored (only `navigator.serviceWorker` messages are
trusted). **None of this exists on main today** — the open-redirect/XSS
guard (`safePath()` in `docs/pro/js/push-actions.js`) has no behavioral
test at all right now, only the weak existence-regex. Worth a follow-up
session: pull the current `push-notification-actions.test.js` from main,
graft this branch's "THE PAGE BRIDGE" section back in (its own server-half
section is now stale — main already replaced that with a pointer to
`push-lead-call-phone.test.js`, which should stay), and ship it as its own
PR.
