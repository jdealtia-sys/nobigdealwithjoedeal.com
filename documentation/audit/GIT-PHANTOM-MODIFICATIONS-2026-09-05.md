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

## The LF policy, measured (2026-09-05)

The note above closes the incident. This section answers the question it left
open — whether to adopt `.gitattributes` with `* text=auto eol=lf` — by
measuring it rather than arguing it. Every number below was produced in a
throwaway clone at a short path (`C:/Users/jonat/nbd-eol-test`), never in a
live checkout. The decision itself is Jo's; it is carried as item 9 of
[NEXT_SESSION-2026-09-06](../projects/NEXT_SESSION-2026-09-06.md).

### What the repo looks like today

`git ls-files --eol` over 2264 tracked files in a fresh Windows checkout:

| index / worktree | files | meaning |
|---|---|---|
| `i/lf w/crlf` | 1459 | LF in the repo, CRLF on disk — autocrlf working normally |
| `i/-text w/-text` | 791 | no line endings to convert |
| `i/none w/none` | 10 | no line endings to convert |
| `i/crlf w/crlf` | 3 | **CRLF committed into the repo** |
| `i/mixed` | 0 | nothing has mixed endings committed |

The index is already 99.9% LF. The three anomalies are
`docs/assets/vendor/leaflet/leaflet.css`, `firestore.indexes.json` and
`functions/stripe.js`. No `.bat`, `.cmd`, `.ps1`, `.sln` or `.reg` file is
tracked, so nothing in the tree needs CRLF to function.

Of the 791 "no endings to convert", seven are text files that simply have no
line breaks — three minified TAMKO SVGs, `vendor/emailjs/email.min.js`, two
search-console verification files and an empty fixture. None contains a NUL
byte. That is the reason to prefer the bare `* text=auto eol=lf` over any
variant that forces `text` on an extension: `text=auto` reads content and
leaves those alone, a forced `*.js text` would not.

### What the migration actually does

```bash
printf '* text=auto eol=lf\n' > .gitattributes
git add .gitattributes && git add --renormalize .
```

stages **exactly four files** — `.gitattributes` plus the three `i/crlf` files,
the same three the census predicts. Its diff reads 4134 insertions and 4133
deletions (`stripe.js` alone is 5276 lines) while being content-identical:
**the migration commit looks exactly like the damage this note is about**, which
is worth saying out loud before a reviewer sees it.

After committing and running `git rm --cached -r . && git reset --hard`, the
census becomes 1460 `i/lf w/lf`, zero `i/crlf`, and `git status` is clean.

### What it fixes, measured on the migrated tree

| gate | before | after |
|---|---|---|
| `build-sitemap.js` | exit 1 | **exit 0** — "Zero diff — nothing to do" |
| `build-feed.mjs` (CI-enforced) | exit 1 | **exit 0** — "docs/feed.xml is current (27 items)" |
| `build-projects.mjs --check` | exit 1 | **exit 0** — "all stamped surfaces clean" |
| `apply-partials.js --check` | exit 0 | exit 0 |
| `check-js-syntax.js` | exit 0 | exit 0 |
| `check-site-integrity.js` | exit 0 | exit 0 |
| `check-inline-html-scripts.js` | exit 0 | exit 0 |
| `check-vault-index.js` | exit 0 | exit 0 |

`node scripts/run-test-manifest.js` on Windows with an LF worktree: **60/60 node
suites passed**, exit 0, tree clean afterwards. All 801 files with no endings to
convert verified byte-identical to their blobs — zero corrupted.

The two fixed gates matter more than they look. They exit 1 on *every* clean
Windows checkout, for line endings alone, and have done since at least
2026-08-19. A gate that is always red teaches everyone to ignore it — the same
class of harm as a gate that cannot go red, which this repo has been bitten by
before.

### The recurrence this closes

`build-projects.mjs` in write mode rewrites ten files as pure ending-churn on a
CRLF tree and **zero** on an LF one. No script under `scripts/` preserves the
input EOL — there is not one use of the `includes('\r\n')` idiom — while sixty
call `writeFileSync`. So the churn is produced by the repo's own generators, not
only by `sed -i`, and the CLAUDE.md rule closes one door of several.

It is not hypothetical. In the main checkout right now, `docs/our-work.html`
(an `OURWORK-*` generated file) and
`documentation/audit/ORPHANED-STORAGE-ARTIFACTS-2026-08-18.md` are `i/lf w/mixed`
— genuinely mixed endings inside a single file, from a generator writing LF
regions into a CRLF host.

### A corrupt file the current state creates

`docs/lead-magnet.pdf` contains no NUL byte in its first 8 KB, so git's text
heuristic classifies it as text (`i/lf w/crlf`) and autocrlf injects 716 CR
bytes on checkout. Measured:

| | bytes | CRs | `startxref` target |
|---|---|---|---|
| committed blob (what CI ships) | 63567 | 0 | `xref\n0 77\n00` — **valid** |
| Windows worktree copy | 64283 | 716 | `F'^c&Cl64g$` — **corrupt** |

The live file is fine, because the deploy checks out LF on a Linux runner. But
every Windows worktree holds a structurally broken PDF, and
`docs/sites/free-guide/index.html` hands that file to customers — so nobody
working on Windows has been reviewing the real bytes. Most PDF readers auto-repair
a broken xref by rescanning objects, so the user-visible impact today may be nil —
the byte corruption is certain, the reader-level breakage is not.

The bare `eol=lf` policy repairs it. Because git believes the file is text, an LF
checkout writes the blob verbatim; measured, after the worktree refresh the file is
back to 63567 bytes and its `startxref` resolves again. An explicit `*.pdf binary`
rule is still worth adding — not to fix this file but to protect the next one — and
it **must** come after the refresh, for the reason in §Cost of adopting. Nine tracked
`.sh` files check out CRLF for the same reason and would break under a POSIX shell.

Do not force `text` on an extension: seven text-extension files here carry no line
endings at all and `text=auto` correctly leaves them alone.

### The honest caveat: inverted, not eliminated

Verified in a throwaway repo. With `* text=auto eol=lf` in force, writing CRLF
into the LF worktree produces ` M file` in `git status` with an **empty**
`git diff` — the identical signature, mirrored. The class does not disappear; the
trigger changes hands:

- **today** LF-writing tools trip it — `sed -i`, all sixty `writeFileSync`
  scripts, the editor. The common case.
- **after** CRLF-writing tools trip it — PowerShell `Out-File`/`Set-Content` is
  the known one in this environment. The rare case.

Also verified: `.gitattributes` overrides the machine-global
`core.autocrlf=true` at `file:C:/Program Files/Git/etc/gitconfig`. The whole
policy rests on that precedence.

### What does not change

Nothing that ships. The committed blobs are already LF, so Firebase Hosting
serves the same bytes either way. There is no CSP `sha256-` hash, no SRI
`integrity=` attribute, no content-keyed service-worker cache and no checksum or
byte comparison in any workflow — searched and found empty. CI is Linux and
already checks out LF, so every suite green in CI is already proof of LF safety.

### Cost of adopting

- **The obvious ordering ships a broken file.** Adding `*.pdf binary` in the
  same step as `git add --renormalize .`, from a Windows worktree, stages the
  CRLF-corrupted 64,283-byte `docs/lead-magnet.pdf` over the valid 63,567-byte
  blob — laundering the local corruption into production. Land the bare
  `eol=lf` policy and its 3-file renormalize first, refresh the worktrees, and
  only then add the binary rules in a second commit (which stages nothing on a
  refreshed tree). Generating the renormalize commit on Linux avoids the trap
  entirely.
- Committing `.gitattributes` does **not** convert an existing worktree. Neither
  `git checkout .`, `git checkout -f .` nor `git add --renormalize .` does it —
  the clean filter maps CRLF to the same blob, so git sees nothing to do. The
  only incantation that converts a live tree is
  `git rm --cached -r . && git reset --hard`, which destroys uncommitted tracked
  work (untracked files and `node_modules` survive). Every checkout must
  therefore be clean first: `C:/Users/jonat/nobigdealwithjoedeal.com`,
  `C:/Users/jonat/nbd-wt-ledger-recon` and any live session worktree under
  `.claude/worktrees/`. They share one `.git` directory but each has its own
  index, so each needs the refresh independently.
- **There is no "storm", and that is the problem.** A pre-existing checkout that
  pulls the policy reports zero modified files, because `text=auto` refuses to
  renormalize what was committed as CRLF. Nothing looks wrong, nothing warns,
  and the drift gates simply stay red until someone refreshes that worktree by
  hand. A clone made after the policy lands needs no manual step at all.
- The renormalize commit rewrites 8,269 lines across three files, 5,278 of them
  in `functions/stripe.js`. Pair it with a `.git-blame-ignore-revs` so blame on
  a payments file survives.
- One served file's bytes change: `docs/assets/vendor/leaflet/leaflet.css`, the
  only file under `docs/` committed as CRLF, shrinks 14806 → 14145. Nothing
  hashes or size-checks it, but `docs/pro/sw.js` caches it shell-first, so a
  returning CRM user holds the old copy until `CACHE_VERSIONS.shell` is bumped.
- `functions/stripe.js` is a payments file whose every line the policy rewrites
  in the index. It deserves its own reviewable commit, not burial in a bulk
  renormalization.
- Any branch open across the change wants a rebase; #1373 carries 74 files.
- The rollout's own diff looks like the bug, as noted above.

## Not done, and why

- **No `.gitattributes` / `eol=lf` change — in this PR.** It was out of scope
  for a bug hunt, and it is a repo-wide policy decision for Jo. It has since
  been measured end to end rather than argued: see §The LF policy, measured
  above, and item 9 of the handoff.
- **No new gate script.** The writer was a one-off shell loop, not code
  in the tree; the guard is the CLAUDE.md rule plus the two commands
  above.
- **The three fragile drift gates were not repaired here.** Giving
  `build-sitemap.js`, `build-feed.mjs` and `build-projects.mjs` the
  destination-EOL sniff `apply-partials.js` already uses would fix them on any
  checkout, independently of the policy decision, with no blast radius. It is
  the right move whichever way item 9 goes, and it belongs in its own PR.

## Corrections made in the same PR

- [NEXT_SESSION-2026-09-06](../projects/NEXT_SESSION-2026-09-06.md) item 4
  marked resolved with the real cause.
- [SESSION-2026-09-05-free-api-wave1](../projects/SESSION-2026-09-05-free-api-wave1.md)
  watch-out corrected in place.
- CLAUDE.md gained the `sed -i` rule and the diagnose/clear commands.
- The session memory "node test bucket rewrites functions files" was
  deleted; the surviving CRLF memory carries the corrected fact.
