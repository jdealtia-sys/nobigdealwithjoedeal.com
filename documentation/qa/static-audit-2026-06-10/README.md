# Static Bug-Class Audit — 2026-06-10

A multi-agent fan-out audit run while the live sweep was blocked on auth
(Jo's session lost to NEW-D25). Five parallel finders, one per bug class
discovered live earlier the same day, each finding then judged by a
3-skeptic adversarial panel (correctness / reachability / recency lenses;
≥2 refutes kills). 57 agents total over a read-only worktree of
origin/main.

## Bug classes audited
1. **meta-CSP conflicts** (NEW-D27 class) — page `<meta http-equiv=CSP>`
   vs the global `**` header CSP; strictest-per-directive wins. 151
   files / 6 distinct policies mapped.
2. **Latent undeclared identifiers** (NEW-D26 class) — extracted or
   standalone page scripts referencing identifiers no loaded script
   declares. 10 pages, 20+ scripts: clean beyond the already-fixed
   TOKEN/repName.
3. **Dead chrome** — rendered controls with no live handler under
   `script-src-attr 'none'`.
4. **Rules-denied operations** — client Firestore/Storage calls the
   rules can never allow (incl. batch-atomicity poisoning).
5. **pages-a control inventory** (no bug claims) — exhaustive
   control/gate map of estimate-view, photo-review, sign, vault, and
   daily-success, to drive the next live ledger pass.

## Files
- `SYNTHESIS.txt` — ranked report (13 distinct defects, P1→P3, trivial
  vs needs-design split, contradictions/tensions, killed-finding log).
- `FINDINGS.json` — all 44 confirmed entries (16 bug findings with full
  panel verdict reasoning + 28 inventory groups).
- `FINDER-NOTES.json` — per-finder coverage notes (what was checked,
  what couldn't be, incidental observations).

## Outcomes (same-day)
- **P1 NEW-D28** workers.dev AI-proxy header gap → **PR #628** (merged).
- **P1 NEW-D29** Daily Success sync batch poison → **PR #629** (merged).
- Five small confirmed fixes (Turnstile latent metas, estimate-view CTA
  CSS, photo-review location options, /review avatar onerror,
  daily-success welcome/theme cleanup) → **PR #630**.
- **P1 NEW-D30** vault cluster + **P3 NEW-D31** photo-review share-copy
  → BUG-LOG, pending decisions (vault: keep-or-kill; share-copy: dep
  load vs portalUrl rewrite).

The pages-a inventory in FINDINGS.json (entries with
`verdicts: "inventory"`) is the prepared work-list for the remaining 82
pages-a ledger rows once an authed session is available.
