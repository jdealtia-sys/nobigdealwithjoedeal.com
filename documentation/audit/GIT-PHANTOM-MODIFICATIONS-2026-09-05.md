# Phantom `functions/` modifications — 2026-09-05

> The 09-05 session left 78 files under `functions/` flagged ` M` in
> `git status` while `git diff` was empty and every one was byte-identical
> to HEAD. The handoff blamed the node test bucket. This note is the
> record of the investigation that refuted that: the writer was the
> session's own `sed -i` sweep, and git flagged the files on their size
> alone. PR: [#1394](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1394). Related: [NEXT_SESSION-2026-09-06](../projects/NEXT_SESSION-2026-09-06.md)
> item 4 · [SESSION-2026-09-05-free-api-wave1](../projects/SESSION-2026-09-05-free-api-wave1.md)
> watch-outs · [STABILITY-AUDIT-2026-09-04](STABILITY-AUDIT-2026-09-04.md).

## Verdict

- **Nothing in the node bucket writes to `functions/`.** The full bucket
  on a clean tree and a 62-suite one-at-a-time bisect both left
  `git status` at zero. There is no test to fix and nothing to redirect
  to a scratch dir.
- **The writer was `sed -i`.** Three minutes before the bucket ran, the
  session swept `functions/*.js` and `functions/integrations/*.js` with a
  `sed -i` substitution to swap the scheduler import for the heartbeat
  drop-in (#1389). Git Bash's GNU sed rewrites every file it touches
  LF-only, whether or not the pattern matched.
- **Git flagged them because of `core.autocrlf=true`, not content.** The
  index remembers each file's checked-out (CRLF) size. A file rewritten
  LF-only is smaller, and a size mismatch makes git report "modified"
  without ever hashing the content.
- **The durable fix is a rule, now in CLAUDE.md:** never `sed -i` across
  a glob of repo files on Windows. Diagnose and clear commands are below.

## The writer, from the session transcript

All times UTC on 2026-09-05; the local clock was 4 hours earlier.

| time | what ran | effect |
|---|---|---|
| 01:14:21 | `for f in functions/*.js; do sed -i "s#^const { onSchedule } = require('firebase-functions/v2/scheduler');#…#" "$f"; done`, then the same loop over `functions/integrations/*.js` | every swept file rewritten LF-only; mtimes 01:14:21–01:14:23 |
| 01:14:43 | `git checkout -- functions/stripe.js` after noticing a 5,276-line no-op diff | the ONE swept file whose blob is CRLF (`i/crlf`) got reverted; the other 78 showed no diff, so nothing looked wrong |
| 01:17:49 | `node scripts/run-test-manifest.js` (the node bucket) | ran on already-rewritten files; wrote nothing |
| 01:19:08 | `git status --short` after staging the heartbeat PR | 107 entries: 29 real (the commit) + 78 phantom |
| 01:19:39 | mtime survey: "most recent first — 21:14:23" | the sweep's timestamp, later remembered as "within the run's two seconds" |
| 01:20:16 | `git checkout -- $(git diff --name-only)` | restored nothing useful: `git diff --name-only` never lists these files (see below) |
| 01:23:13 | `git update-index --really-refresh` → "needs update" ×78 | consistent with the size short-circuit |
| 01:23:48 | `git checkout -f -b fix/secret-stub-reads origin/main` | `-f` rewrote every stat-mismatched entry with CRLF; the mtime on `functions/phone-utils.js` in the main checkout is still 21:23:49 local, this command to the second |

Proof of the sed behaviour, run in a fresh worktree (`sed (GNU sed) 4.9`,
`/usr/bin/sed` from Git for Windows) with a pattern that matches nothing:

```
before:  size=1907  CRs=39   git status: clean
after :  size=1868  CRs=0    git status:  M functions/phone-utils.js
         git diff --name-only: (empty)      git ls-files --eol: i/lf w/lf
```

## Why git flags a byte-identical file

Facts on the clean tree, `functions/phone-utils.js`:

| where | bytes |
|---|---|
| blob in HEAD (LF) | 1868 |
| worktree after checkout (CRLF, `core.autocrlf=true`) | 1907 |
| `git ls-files --debug` → `size:` recorded in the index | 1907 |

The index caches the stat data of the file *as checked out*, so with
autocrlf the cached size is the CRLF size. Rewrite the file LF-only and
its size drops to 1868. `git status` compares cached stat data first
(`ie_match_stat`): a size mismatch sets `DATA_CHANGED`, and `ie_modified`
returns "modified" at that point without reading the file, because for a
file with no content filter a size change *is* a content change. With
autocrlf it is not, and git never checks. Everything else observed follows:

- `git diff` and `git diff --name-only` are empty because `git diff` does
  read the file, runs the clean filter (CRLF→LF, a no-op here), hashes it,
  gets the same blob id, and drops the entry (`skip_stat_unmatch`). That is
  also why `git checkout -- $(git diff --name-only)` could never name these
  files.
- `git hash-object <file>` equals the blob id in the index. Proven:
  `8e461675ac63…` on both sides for `phone-utils.js`.
- `git update-index --really-refresh` says "needs update" because it takes
  the same `ie_modified` shortcut.
- `git checkout -- <path>` DOES clear it when the path is named explicitly
  (verified: back to 1907 bytes, status clean). The handoff's "only
  `git checkout -f` clears it" was an artefact of feeding checkout a list
  that omitted them.
- `git checkout -f` clears it because `-f` rewrites every entry whose stat
  data mismatches.

## Why 78 and not 105

| | files |
|---|---|
| swept: `functions/*.js` + `functions/integrations/*.js`, minus the new `heartbeat.js` | 105 |
| minus the one whose blob is CRLF (`stripe.js` — real diff, reverted by hand at 01:14:43) | 104 |
| minus files the heartbeat commit really changed (their `git add` re-recorded the LF size) | 82 |
| minus files that were already LF-only in the worktree before the sweep, so sed changed nothing measurable (`backup-freshness-logic.js`, `find-secrets.js`, `lead-artifact-paths.js`, `verify-functions-company-enhancement.js` — still `i/lf w/lf` in the main checkout today, never re-checked-out since they were born LF) | **78** |

## What was ruled out

- Full node bucket (`node scripts/run-test-manifest.js`) on a clean
  worktree with `functions/` and `tests/` `node_modules` junctioned in:
  62/62 suites passed in 27 s, `git status --short | wc -l` = 0 before and
  after, `phone-utils.js` still 1907 bytes with 39 CRs.
- Each of the 62 suites run alone (`node tests/<suite>`), `git status`
  checked after every one: 0 every time, all exit 0.
- Static sweep of `tests/*.test.js`, `tests/smoke`, `tests/e2e`,
  `scripts/*.js` and `functions/**/*.js` (excluding `node_modules`) for
  `writeFileSync`, `writeSync`, `copyFileSync`, `renameSync`, `cpSync`,
  `utimesSync`, `createWriteStream`, `fs/promises`: no writer targets
  `functions/`. `check-function-orphans.js` writes one JSON file under
  `os.tmpdir()`; `crm-audit.test.js` writes fixture trees under
  `os.tmpdir()`; `inline-html-scripts.test.js` writes and unlinks temp
  files.

## Diagnose and clear

On Windows with `core.autocrlf=true`, a tracked text file whose worktree
copy is LF-only is either this damage or a file born LF and never
re-checked-out. Either way this lists them:

```bash
git ls-files --eol | grep -E '^i/lf\s+w/lf'
```

Signature of the phantom state: `git status` flags files that
`git diff --name-only` does not list. Clear by naming the paths:

```bash
git checkout -- $(git ls-files --eol | grep -E '^i/lf\s+w/lf' | awk '{print $NF}')
```

or, when the tree holds nothing you want to keep, `git checkout -f`.

## Not done, and why

- **No `.gitattributes` / `eol=lf` change.** It would stop this particular
  symptom (checkouts would be LF, so an LF rewrite changes nothing) but it
  changes every contributor's and CI's checkout and mirrors the problem
  for any tool that writes CRLF. That is a repo-wide EOL policy decision
  for Jo, not a side effect of a bug hunt.
- **No new gate script.** The writer was a one-off shell loop, not code
  in the tree; the guard is the CLAUDE.md rule plus the two commands
  above.

## Corrections made in the same PR

- [NEXT_SESSION-2026-09-06](../projects/NEXT_SESSION-2026-09-06.md) item 4
  marked resolved with the real cause.
- [SESSION-2026-09-05-free-api-wave1](../projects/SESSION-2026-09-05-free-api-wave1.md)
  watch-out corrected in place.
- CLAUDE.md gained the `sed -i` rule and the diagnose/clear commands.
- The session memory "node test bucket rewrites functions files" was
  deleted; the surviving CRLF memory carries the corrected fact.
