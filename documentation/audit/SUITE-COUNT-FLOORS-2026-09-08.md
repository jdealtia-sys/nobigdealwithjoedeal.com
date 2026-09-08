# Suite-count floors — the ratchet that could not tighten

**2026-09-08.** Landed as [#1481](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1481),
[#1482](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1482) and
[#1487](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1487) (main green at each step).

## What was wrong

`scripts/run-test-manifest.js` carries `FLOORS`, an anti-shrink ratchet: a bucket may grow
but never silently shrink. It read `54/65/133` against real counts of `96/65/179`.

That is 42 node suites and 46 disk entries gating nothing. Verified rather than reasoned:
deleting a suite outright — **file and manifest entry both** — still exited 0. Removing only
the manifest entry does not reach the floors, because the completeness tripwire fires first;
that is why the slack had never been noticed.

## The shape of the drift (the useful part)

The line was **not** neglected. It was edited three times since it last matched reality, each
time incremented by **one** for the suite that author was adding, while the real count had
already moved well past it:

| `FLOORS` written | actual at that commit | commit |
|---|---|---|
| 43/65/122 | 43/65/122 ✓ | `16a79e24` 08-23 |
| 51/65/130 | 51/65/130 ✓ | `e0eb64b6` 09-03 |
| 52/65/131 | **66**/65/**145** | `30e7a23a` 09-05 |
| 53/65/132 | **73**/65/**156** | `10047cdb` 09-06 |
| 54/65/133 | **75**/65/**158** | `4e5e5b19` 09-06 |

A `+1` looks like maintenance and buys nothing. The floor was already 21 low on the day it was
last "raised". 31 suite-adding commits followed `e0eb64b6`.

**So the rule is SET, not increment** — and the error message now prints the whole `FLOORS`
literal to paste, never a delta, because pasting a delta is the bug above.

## What changed

- Floors set to the measured counts, `96/65/179`.
- **The ratchet now fails in both directions.** Over the floor is a failure too: the gap is
  precisely how many suites gate nothing, so drift reddens on the commit that opens it instead
  of sitting quiet for 31 commits.
- Floors stay **literal, not derived**. A floor computed from the live manifest always equals
  the count it is compared against, so `n < floor` could never be true and the ratchet would be
  structurally incapable of failing — the silently-green gate this file exists to prevent.
- Three copies of the same count were rotting in three files. All removed; `FLOORS` is the one
  copy, and it is now enforced.

## Proven, not assumed

- **Suite added, floor untouched** → red, names `node` + `disk`, prints
  `const FLOORS = { node: 97, smoke: 65, disk: 180 };`
- **Suite deleted (file + entry)** → red, the original under-floor branch.
- **Clean tree** → green.
- The unchanged `smoke: 65` floor was break-tested **separately** — an untouched floor is
  exactly the one nobody thinks to prove.
- **Retro-check:** putting `54/65/133` back against the 09-08 tree reports `stale by 42` /
  `stale by 46`, so this would have fired on `30e7a23a`, the commit that opened the gap.

## Consequence to expect

Adding a test suite now reddens `--check` until `FLOORS` moves in the **same commit**. That is
the point, and the error carries the exact line to paste — but it means a suite-adding PR and a
floor-touching PR conflict by design. If a suite lands between a branch's last green run and its
merge, that branch's floor is stale on arrival. **Re-run `--check` immediately before merging**
rather than trusting an older CI run.

## Corrected in passing

- `.github/workflows/ci.yml` claimed the node bucket held "44" suites (stale by 52) **and**
  "43 at wiring on 2026-08-07". The second was wrong too: the wiring commit `caab17ec` carried
  **32**, and the same comment block already said "All 32 verified green at wiring time". 43 was
  the 2026-08-23 figure.
- `tests/ci-manifest.json`'s `"//"` header claimed wired-individually had "10 left after the
  2026-08-23 collapse". It holds **14**.
- [WAVE2-IMPLEMENTATION-MAPS-2026-09-05](WAVE2-IMPLEMENTATION-MAPS-2026-09-05.md) told a future
  implementer "FLOORS node:51 … — growing is fine", which this change makes false. Corrected in
  place.

In every case the live number was **removed** rather than updated to today's figure — writing
`96` into a comment just restarts the rot.

## Checked and deliberately NOT changed — do not re-derive this

`tests/cost-basis-registry.test.js:81` carries a similar-looking
`FLOORS = { labor: 60, xact: 250, v2: 25 }`. Measured against the real catalogs:

| catalog | actual | floor | slack |
|---|---|---|---|
| labor | 66 | 60 | 9% |
| xact | 277 | 250 | 10% |
| v2 | 28 | 25 | 11% |

Tight, and **not** the same defect. That guard is a *non-vacuity* check — "a loader that
silently returns nothing cannot make every assertion below pass" — not an anti-deletion ratchet.
Catalog rows legitimately disappear when a line item is discontinued, so an exact-match ratchet
there would fire on ordinary business edits. A ~10% band is the right tolerance. **Left alone on
purpose.**

## Tooling note

Node's `execSync` shells out to **cmd.exe** on Windows, where `^` is the escape character. A
script computing "how many commits added a suite" used `git show <sha>^:file`, so every `<sha>^`
resolved to `<sha>` — each commit diffed against itself — and it reported a confident
`0 of 31 commits`, flatly contradicting a bucket that had grown 51 → 96. **Use `~1`, never `^`,
in any revision passed through `execSync`.** Same family as
[GIT-PHANTOM-MODIFICATIONS-2026-09-05](GIT-PHANTOM-MODIFICATIONS-2026-09-05.md): a shell eats a
metacharacter, the failure is silent, and the wrong answer looks plausible.

Related: [STABILITY-AUDIT-2026-09-04](STABILITY-AUDIT-2026-09-04.md) on gates that cannot fail.
