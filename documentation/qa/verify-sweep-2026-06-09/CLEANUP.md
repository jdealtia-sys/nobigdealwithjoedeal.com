# Verify-Sweep 2026-06-09-B — Cleanup Manifest

Session: behavioral re-verification of PRs #595–#598/#600 fixes + exhaustive-sweep resume.
Browser: normal Chrome window, tab group OK (last session's PWA-focus blocker cleared by launching a fresh `--new-window`).

## ZZ_QA_ records created
| date | artifact | location | state |
|------|----------|----------|-------|
| 2026-06-09 | Public inspect submit "ZZ_QA_ Inspect Bridge Test2" (223 ZZ_QA Inspect Ln) | `inspect_leads` + bridged CRM lead `inspect_leads__a16mQWo2S1b8Ab5fWZdt` | CRM lead **soft-deleted via NEW-5 round-trip test — verified GONE after reload** (that was the test). The `inspect_leads/a16mQWo2S1b8Ab5fWZdt` public doc may remain in the public collection (same as prior session's note) — optional purge on Jo's OK. |
| 2026-06-09 | Quick-Add "ZZ_QA QuickAdd Test" | — | **never saved** — full modal opened prefilled (CO-L-1 verify) then closed via ✕; lead count unchanged. Zero residue. |

## Prior-session leftover — RESOLVED
- "ZZ_QA_ Inspect Bridge Test" (222 ZZ_QA Inspect Ln): **already absent from the active pipeline at session start** (presumably deleted post-#596-deploy). Nothing to clean.

## Real settings changed → restored
| setting | original | test value | restored? |
|---------|----------|-----------|-----------|
| `nbd_home_tasks` task 1 "Send 3 estimates" | unchecked | checked (NEW-1 round-trip) | ✅ unchecked, verified in LS |
| `nbd_home_widgets` | absent (defaults) | +stage-funnel, then default set | ✅ toggled off via UI, residual default-set key **removed** → back to absent |
| Profile → Weekly Digest | ON | OFF (NEW-2 round-trip) | ✅ ON + saved, verified across reload |
| Daily OS → North Star target | empty | "ZZ_QA test" (NEW-4) | ✅ cleared + saved, verified across reload |
| `nbd_ds_config.northStar` (legacy mirror) | "" (widget showed placeholder) | "Roofing Sales" (side effect of empty-target mirror) | ✅ manually reset to `""`, placeholder render verified. NOTE: any future Daily-OS save by Jo will set it to the category string again (logged as low-sev mirror nit). |
| `nbd_ds_config.floors` (legacy mirror) | stale legacy floors (Workout complete / Journaled / …) | — | **intentionally NOT restored**: Daily-OS save synced legacy key to the CANONICAL floors from `nbd_user_config` (Doors knocked / Workout / Sleep 7+ / Protein goal / 1 big task). This is the #595 mirror working as designed; restoring stale data would undo a correct sync. Home Daily Floors widget now shows canonical labels. |
| Settings → Help hotkey "New Lead" | enabled (no LS key) | disabled (`nbd_hk_disabled_hk_n=1`) | ✅ re-enabled, key cleared |
| Pipeline search box | empty | "co" (CO-M-1) | ✅ cleared |

## Pre-existing test data (unchanged, per prior manifest policy)
"ZZ_WriteDiag DELETE_ME", "Test Signer NBDtest", "Remote Sign E2E Test" remain in the pipeline — flagged for Jo, not owned by this sweep.

## Outbound side effects
- One `lead-alert` email to Jo fired by the ZZ_QA_ Inspect Bridge Test2 public submit (same as the prior sweep's CO-H-1 repro; subject "New lead"). No SMS (Twilio still blocked). No Stripe/billing/account changes. GDPR/dangerous controls untouched this session.
