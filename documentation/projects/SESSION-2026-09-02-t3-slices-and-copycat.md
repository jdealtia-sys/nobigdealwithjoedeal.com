# Session 2026-09-02 — the T3-M freed 15 converted, the copycat watch learns signal vs noise

One evening, four lanes, everything from the 2026-09-01 handoff's actionable
queue closed. Companion state: [NEXT_SESSION-2026-09-02](NEXT_SESSION-2026-09-02.md).

## 1 · Copycat watch (#1337): the first fire was 100% noise, and the fix is semantic

The monthly watch's first scheduled fire went red with "6 signals" — every one
API noise: five rate-limited fingerprint searches plus the workflow's own
positive control proving the installation token **cannot run global code
search at all** (the header had suspected it; now it is measured).
Forks/stars/watchers read clean at baseline 0/0/0 — no copycat indication of
any kind.

Two defects fixed: `note()` conflated infra failures with signals (split into
`signal()` → red and `infra()` → annotation + a "Channel notes (not signals)"
summary section), and a latent cascade where a failed metadata read set
counters to `err`, which compared unequal to baseline and would have filed a
fake "fork count changed" signal. Code search is now a **declared channel**
gated on a `COPYCAT_CODE_SEARCH_TOKEN` secret (no-scope classic PAT — Jo's
optional call, queued in WEEKLY_CADENCE); absent = named OFF in every
summary, present = the control must see and blindness IS a signal. A
`workflow_dispatch` proof run of the new code went green under the exact
conditions that red-lined the scheduled fire. The doctrine line: an alarm
that cries wolf monthly stops being read — the same failure class as a
silently-green gate, approached from the other side.

## 2 · Dependabot lane closed

#1323 and #1324 came back from their requested rebases clean and merged
19/19 green, sequentially per the handoff's own lockfile rule (merge one,
rebase the other, never fire both). All four of the 09-01 handoff's
dependabot PRs are now in.

## 3 · The T3-M freed 15 — all converted (#1338, #1339, #1340)

The handoff's lane 1, executed evidence-first per the plan's own doctrine
("when a slice is defined by a tool's output, audit the tool before executing
the slice"):

- **A 70-agent derive→prove→refute workflow ran before any edit.** The
  deriver re-derived the freed-name list from the ground (the documented
  15 held, and their measurement record was located in the T3-M session
  note); one prover per name built a full reach inventory (bare cross-file
  calls, generated markup, bracket dispatch, typeof probes, allowlist /
  registry / smoke-pin surfaces); two adversarial refuters per name tried to
  break each proof.
- **The refuters earned their seats twice.** They killed two edit plans that
  would have shipped CI reds: a new registry block placed ahead of
  dashboard-ui's existing one (breaking the smoke `duRegBlock` first-match
  extraction and its 18 pinned names), and adding map-dispatched graduates to
  `T2C2_NAMES` (whose allowlist-absence pin greps ALL of dashboard-state.js —
  where the map VALUES must keep the quoted names). Both refuter pairs
  independently converged on the correct pattern: the bespoke graduate-pin
  block, per the closeMobileInspection precedent.
- **The biggest catch was ownership**: the property-intel modal twins are
  byte-identical in dashboard-ui.js AND property-intel.js, and
  property-intel wins the window slot by load order — converting the
  documented owner alone would have left a silent fallback shadowing the
  registered name. Both dashboard-ui copies are deleted; property-intel is
  sole owner.
- **Each slice shipped with a differential emulator snapshot** (the 08-31
  harness, extended with a `GLOBALS_SNAPSHOT_EXTRA` env input so BEFORE and
  AFTER runs share one name list): converted names `typeof undefined` on
  window, every affected map key flipped "resolved via window" → "resolved
  via registry" with live function hashes, zero drift among the other ~118
  recorded names. Slice 3's map probe kept an IDENTICAL hash — the function
  text itself never changed.
- **Also measured and recorded in the plan's §UPDATE 2026-09-02**: the
  "IIFE-wrapping regions" framing was true only for the dashboard-ui 8;
  eight MORE map names look map-only-convertible (the "still blocked 19"
  overcounts) — a measured next slice; and three blocked names have
  undocumented twin assigners with DISTINCT implementations racing for the
  window slot (closeTaskModal, closeShortcutsPanel, closeCmdPalette) —
  ownership must be resolved before converting any of them.

The score after the slices: **17 of the two maps' 36 entries resolve
registry-only**; the maps' window fallback carries only the genuinely-blocked
names.

> **Same-evening addendum (#1342): the bonus eight followed.** All eight
> ledger-miscounted names converted registry-only across six owner files,
> from their already-upheld proofs — including crm.js's auto-global trap
> (const conversion + dead W93 twin deleted) and the two test-side consumers
> rewired to the registry. Differential: 8/8 off window, 8 map probes
> flipped, zero drift. Final evening score: **25 of 36 registry-only, 23
> names off window in one night.** The peer session ended cleanly and every
> transient worktree was gate-checked and pruned — the repo closed at 2
> worktrees, 2 branches, 0 open PRs.

## 4 · Coordination and housekeeping

- The parallel session picked up the (stale) audit-script migration chip,
  was warned mid-boot, verified independently rather than rebuilding —
  and its verification surfaced a real straggler (#1336, a stale NODE_PATH
  docstring). The built-twice failure mode, avoided from both ends.
- Week's branch accumulation pruned: 11 more git-certified deletions plus
  the peer-offered remote branch; main worktree fast-forwarded.
- One workflow-ops lesson worth keeping: a **resumed** workflow's re-run
  agents execute against the LIVE tree, not the tree the original run saw —
  our post-reset refuters "refuted" proofs as describing a stale baseline
  because the conversions had already landed, which amounted to independent
  post-hoc confirmation. Read resumed verdicts with the tree's motion in
  mind.
