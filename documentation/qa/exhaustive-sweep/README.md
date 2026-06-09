# NBD Pro — Exhaustive Functional QA (Inventory-Driven, Resumable)

**Goal:** provable completeness. Enumerate **every interactive element** in the live CRM, then verify each one **actually works** — not that it renders. A button does what it claims; a toggle flips **on AND off** with the change taking effect; a setting **saves, survives reload, and demonstrably changes behavior.** Looking good but doing nothing = **FAIL.**

**Target:** https://nobigdealwithjoedeal.com/pro — LIVE prod, tenant zero (Jo Deal / "JD"). Coverage reported as a hard number: **N of M verified.**

---

## The spine — these files ARE the campaign

| File | Role |
|------|------|
| `COVERAGE-LEDGER.json` | Master checklist. One row per interactive element. **Source of truth. Never reset.** |
| `COVERAGE-SUMMARY.md` | Running N-of-M tally by page + the explicit **RESUME POINT**. |
| `BUG-LOG.md` | Ranked failures (repro + screenshot + likely file) for a separate remediation pass. |
| `carryover.json` | Open bugs + re-verify items + gotchas distilled from prior QA runs. |
| `ledger-fragments/*.json` | Per-surface inventory fragments (merged into the ledger). |
| `screens/` | `page__element__state.png` evidence (before/after for state-changers). |

### Ledger row schema
```
{ id, page, route, selector, label,
  type: button|toggle|setting|input|select|link|menu|tab,
  expected_behavior, reveal_state, danger, priority,
  source_ref, status, evidence, notes, session }
```
`status`: `UNTESTED | PASS | FAIL | BLOCKED | FIXED`

---

## How to resume (every session)
1. Read `COVERAGE-SUMMARY.md` → RESUME POINT.
2. Load `COVERAGE-LEDGER.json`; work the `UNTESTED` / `BLOCKED` rows in priority order (P1 daily-driver first).
3. For each element, apply the **strict bar** (below). Update the row (status + evidence path). Screenshot before/after for state-changers.
4. Trivial bug → fix inline (smoke-gated). Everything else → `BUG-LOG.md`.
5. Restore any real setting you changed. Checkpoint: re-write the ledger + summary to disk. **Coverage only ever goes up.**

## Strict bar (per element)
- **Button/action:** click → performs its stated function (before+after). Dangerous → driven to confirm dialog, screenshotted "reachable," **cancelled**.
- **Toggle/checkbox:** ON → effect happens **and persists across reload**; OFF → reverts **and persists**. Both directions required.
- **Setting:** change → save → reload → confirm persisted → confirm it **changes behavior**. Saves-but-no-effect = FAIL. Then **restore original**.
- **Input:** accepts valid, **rejects invalid**, saves.
- **Link/nav:** lands on correct destination, loads clean.
- **Every page:** capture console errors + failed network — a clean-looking screen throwing errors is a finding.

## Safety firewall (RULE 0)
- `ZZ_QA_` throwaway records only for create/mutate; real customer records are **view-only**.
- Delete/send/e-sign/charge/publish → drive to the confirm boundary, screenshot, **cancel**. Never fire on real data.
- Record originals of real settings before changing; **restore** after. Leave NBD's account as found.
- Sends → `ZZ_QA_` recipient (Jo's own). Email: `jonathandeal459@gmail.com`. SMS (Jo's own cells): `859-420-7382` and `513-315-2406`. Or stop at boundary. No real charges.
- SMS caveat: prior runs noted SMS blocked at Twilio A2P / trial. If a send fails, distinguish **handler works but blocked at Twilio (BLOCKED/infra)** from **UI no-op (FAIL)** — read the network/console to tell which.
- Claude never types a credential. Jo logs in + hands off.

## Notes
- QA artifacts here are kept **on-disk / untracked** (matching prior `live-qa-*` convention) so they survive across sessions without polluting feature-branch diffs. Durability = the files on disk, not a git commit.
- Source-code trivial fixes land via a clean worktree off `origin/main` (repo auto-deploys on main push).
