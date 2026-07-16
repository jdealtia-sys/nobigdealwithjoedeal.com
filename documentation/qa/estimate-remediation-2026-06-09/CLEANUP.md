# Cleanup Manifest — estimate-remediation-2026-06-09

Per RULE 5: purge ZZ_QA_ artifacts on Jo's OK. Claude does NOT auto-delete prod data
(deletion is an owner action / explicit-approval step).

## Prod Firestore artifacts created this session (await Jo's OK to purge)
| Collection | Doc id | Customer name | Note |
|---|---|---|---|
| `estimates` | `CAU2i76um2FnnMorettv` | `ZZ_QA_ Canonical Total Test` | per-SQ retail, Better $22,925; used for canonical-total verification. Customer email = Jo's own (jonathandeal459@gmail.com). No envelope sent. |

To purge (Jo, from the estimates list overflow menu → Delete, or console):
`await window._deleteEstimate('CAU2i76um2FnnMorettv')`

## Firebase Storage
- One generated retail-quote PDF was uploaded by the doc preview
  (`NBD-Estimate-ZZ-QA-Canonical-Total-Test-NBD-V2-*.pdf`). Harmless; can be left or deleted with the estimate.

## Browser-session side effects (already reverted / transient)
- `/pro/` service worker was **unregistered + caches cleared** in Jo's browser to recover the dashboard
  boot (the INFRA-1 wedge). It re-registers on next normal load. The `?nosw=1` kill-switch was used on the
  dashboard URL during the session.
- A doc-preview iframe was temporarily `srcdoc`-rendered for the screenshot; reverts on overlay close.

## INFRA-1 fix — git artifacts
- **Worktree:** `C:\Users\jonat\nbd-infra1-worktree` (branch `fix/sw-navigation-stall`, off origin/main @ #591).
  After PR #592 merges, remove with: `git worktree remove C:\Users\jonat\nbd-infra1-worktree`
  (the node_modules junction has already been removed, so this is safe).
- **Branch/PR:** `fix/sw-navigation-stall` → **PR #592** (https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/592).
  CI all green (smoke, rules, syntax, secret-scan, dep-install). Awaiting Jo's merge → auto-deploy.
- **Post-merge:** load `/pro/dashboard` twice (so v30 becomes controller) and confirm full boot + SW-served assets.

## C-1 fix — git artifacts (same worktree, second branch)
- **Branch/PR:** `fix/c1-permit-fallback` → **PR #593** (https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/593).
  V2 permit fail-safe ($0 → $150 for blank/unknown county). ⚠ Changes customer/insurance numbers on
  blank-county estimates — needs blast-radius sign-off before merge. Estimate tests green.
- The worktree `C:\Users\jonat\nbd-infra1-worktree` hosts three pushed branches this session:
  `fix/sw-navigation-stall` (#592), `fix/c1-permit-fallback` (#593), `fix/docviewer-preview` (#594).
  `git worktree remove` it after all three land.

## Doc-preview fix — git artifacts
- **Branch/PR:** `fix/docviewer-preview` → **PR #594** (https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/594).
  NBDDocViewer previews same-origin HTML (was a cross-origin Storage-PDF iframe that Chrome blocked + froze the
  renderer); server PDF moves to the Download action. Render/smoke tests green. No money impact.

## No destructive actions taken
- No real customer estimate was recalculated, re-saved, re-rendered, or sent.
- No e-sign envelope sent. No invoicing. No legacy-data rewrite.
