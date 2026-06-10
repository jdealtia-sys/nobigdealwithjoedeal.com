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

## portal pass (2026-06-10) — BLOCKED by Firestore 503 outage
| artifact | state |
|----------|-------|
| Lead "ZZ_QA Portal Test" (K8uRGekxr8gictxDZSLr) + its portal token (HU4ATZQ4646U7UHTKUR38Z7K) | Created to test portal.html. **The portal never loaded — all Firestore reads returned HTTP 503 (transient Google Firestore backend outage, ~12:30–12:35Z 2026-06-10) — degraded the whole app, not a portal bug.** Soft-delete was issued but during the 503 window, so it removed from local cache (count 22) yet the write may not have persisted. ⚠ **Verify this lead is gone (and the portal_tokens/HU4… doc) once Firestore recovers; re-delete if it reappears.** |
| **UPDATE 2026-06-10 (later):** soft-delete HAD persisted (`deleted:true` verified on the doc once Firestore recovered) — and the REAL portal blocker turned out to be NEW-D23 (CSP-refused inline boot script), not the outage. Lead **deliberately RESTORED** via `restoreDeletedLead()` so the existing HU4… token works for the portal-surface pass. | ⚠ **OPEN: re-soft-delete "ZZ_QA Portal Test" (K8uRGekxr8gictxDZSLr) when the portal pass completes.** |

## d4-estimate pass (2026-06-10) — created & cleaned
| artifact | state |
|----------|-------|
| Leftover "UNTITLED ESTIMATE" ($0, Jun 10) from a prior estimate-qa session | renamed to "ZZ_QA Renamed" then **DELETED** (list 7→6 — one fewer leftover test estimate). |
| Duplicate "ZZ_QA Renamed (copy)" created by the Duplicate test | **DELETED** (cleanup). |
| Classic ZZ_QA test estimate (999 ZZ_QA Est Test St, $20,575) built to verify the 4-step flow | **never saved** — discarded by navigating away (list count unchanged at 6). |
| V2 builder edits (preset loads, scope add/remove, claim fields) on the leftover ZZ_QA ServerPDF estimate | **not saved** — closed without Save; the underlying estimate retains its prior saved state. |

## gap-carddetail pass (2026-06-10) — created & cleaned
| artifact | state |
|----------|-------|
| Lead "ZZ_QA CardDetail Test" (qkMxuoxX26LoAZH8DF3E) | **soft-deleted → Deleted bin** (count 23→22). Its task subdoc was deleted directly during the NEW-D22 investigation; a portal token (KT8ZCGHBHTYL8NR) was minted by the Share-Portal test (admin-SDK collection, points at the deleted lead — harmless). |
| Home widget layout (quote-widget remove test) | toggled then **restored** (nbd_home_widgets key removed → defaults). |
| Notification dismiss/read/queue keys (clear-all test) | snapshotted + **restored** to before-values. |
| ZZ_QA test toast | transient, auto/✕-dismissed. |

## #611 live-verify + gap-prospects pass (2026-06-10) — created & cleaned
| artifact | state |
|----------|-------|
| Lead "ZZ_QA EstFix Test" (ZRVt65rIK5j7HdP6prAi) + its $4,800 estimate (created to verify #611 estimate-save) | **soft-deleted → Deleted bin** (count 23→22). Estimate doc lives under the deleted lead; purge with the lead if desired. |
| Close Board "New Deal" insurance fields | typed into the form only; **never submitted** (no deal created). |
| Prospects filters (followup/hidden/age/attempts) + analytics collapsible | all toggled during testing then **restored** (6 cards, all filters off, verified). No prospect promoted/hidden/deleted (boundaries deferred). |

## customer.html pass (2026-06-10) — created & cleaned
| artifact | state |
|----------|-------|
| Lead "ZZ_QA CustPage Test" (HWfAcHhMJ03iZPKabVHi) + its notes/task/costs/claim-stage | **soft-deleted → Deleted bin** (count 23→22). Optional permanent purge from the bin on Jo's OK. |
| Portal storage page portals/{uid}/HWfAcHhMJ03iZPKabVHi-photos.html | **deleted** (deleteObject confirmed — follow-up delete returned object-not-found; listAll lag is cosmetic). |
| Portal tokens possibly minted server-side for the test portals | admin-SDK-only collection — cannot verify/purge from client; harmless (point at a deleted lead). |
| Deal "ZZ_QA ShareFix Test" (#610 verification) | **deleted** from LS + its deal_rooms storage HTML **deleted**. |
| Stuck saved report from the prior pass | **DELETED** — #609 deploy made owner-delete work; deletion doubled as the live verification. CLEANUP ITEM CLOSED. |
| Customer Report generated during 009 test | viewed in-preview only; persisted copy (if any) targets the now-deleted lead — purge with the lead if desired. |

## ✅ CLEANUP EXECUTED (2026-06-10, after Jo re-logged in) — ALL CLEAR
| artifact | final state |
|----------|-------------|
| 9× "ZZ_QA_HomeTest Sweep" bridged contact leads + "ZZ_QA_ReferTest" + "ZZ_WriteDiag DELETE_ME" (pre-existing, name says delete me) | **ALL soft-deleted** (deleted:true verified; pipeline 33→22). First delete batch hit a CO-H-3-style FIRESTORE INTERNAL ASSERTION (session-poisoned SDK) — full reload recovered, all writes then succeeded. |
| Lead "ZZ_QA Portal Test" (K8uRGekxr8gictxDZSLr) | **soft-deleted** (deleted:true verified) AFTER serving its final purposes: portal-002 live-banner test (PASS) + the photo-review row pass post-#634. Its photo/message/callbacks/portal tokens ride with the deleted lead. |
| Photo-review writes (location 'Front Slope', severity 'Minor') | On the ZZ_QA photo of the now-deleted lead — gone with it. |
| Products/Training/docgen tests | All boundaries CANCELLED (Reset/Archive confirms declined, product modal closed without save, invoice doc viewed in-preview only — one more purgeable server-PDF artifact in Storage `pdf-renders`). |
| Onboarding tour | nbd-tour-force consumed; complete-key currently unset → the tour will pop ONCE the next time the dashboard tab is foregrounded. Take it or skip — either re-marks complete (self-restoring). |
| Pre-existing pipeline test data | "Test Signer NBDtest" + "Remote Sign E2E Test" remain (flagged in the original manifest, not owned by this sweep). |

## portal + pages-b + public pass (2026-06-10 cont.) — created & flagged
| artifact | state |
|----------|-------|
| Lead "ZZ_QA Portal Test" (K8uRGekxr8gictxDZSLr) | **STILL RESTORED** (un-deleted for the portal pass). Now carries: 1 homeowner photo upload ("zz-qa-portal-test.png", caption "ZZ_QA sweep test photo — ignore"), 1 portal message ("ZZ_QA sweep test message — ignore"), 1 callback request ("Tomorrow morning" / "ZZ_QA sweep — ignore"). ⚠ **Re-soft-delete the lead (photo/message/callback go with it) once Jo is logged back in.** |
| Referral lead "ZZ_QA_ReferTest" (via /pro/refer?ref=NBD-0044 submit) | Created in the public referral collection + bridged to CRM; 1 lead-alert email to Jo fired. ⚠ **Soft-delete from CRM after login.** |
| Homepage contact capture "ZZ_QA_HomeTest" (×3-4 — submitForm ran during NEW-D27 diagnosis + the final post-#626 re-verify) | `_captureContactLead` → submitPublicLead docs (+ bridged CRM lead(s)) + lead-alert email(s). The final re-verify ALSO sent one real formsubmit.co email to jd@ (subject "New Estimate Request — … ZZ_QA_HomeTest Sweep") — that email sending is the FIX working; ignore/delete it. ⚠ **Soft-delete the CRM lead(s) after login.** |
| 2nd ZZ_QA callback request on the portal lead (post-#624 re-verify, "Tomorrow morning") | Same cleanup as the lead — both callback requests go when the lead is re-deleted. |
| Estimate-funnel partial (ZZ_QA_EstFunnel, step-5 contact + failed OTP) | OTP send failed (Twilio-blocked) → NO lead created; funnel reset to step 1. Possible abandoned-funnel recovery doc keyed on zz-qa@example.com — harmless, purge if found. |
| Password-reset request (zz-qa-nonexistent-sweep@example.com) | Nonexistent account — Firebase sends nothing. Zero residue. |
| **⚠ Jo's signed-in session in the QA Chrome profile** | **LOST** — NEW-D25 repro (failed login with remember-me unchecked downgraded the existing session's persistence). **Jo must log back in**; no credentials were typed or stored by the sweep. |
| Free-roof + register + inspect forms | Honeypot/validation boundaries only — nothing submitted for real. Zero residue. |

## Continuation pass (d9 + storm/closeboard/repos) — created & cleaned
| artifact | state |
|----------|-------|
| Storm zone "Flood Advisory — Lucas, OH" (sz_17810583703) + its canvass plan | **deleted** via StormCenter.deleteZone — zones 1→0 verified |
| Close Board deal "ZZ_QA Deal Test" (dr_mq7g8y7hcgeton) | **deleted** from LS (`nbd_deal_rooms` → 0). Firestore copy could not be verified/deleted from the client (deal_rooms is default-denied — NEW-D14); the sync write was most likely ALSO denied, so probably no orphan. If one exists, purge `deal_rooms/dr_mq7g8y7hcgeton` via admin SDK. |
| Saved report "Pipeline Health Check — May 11→Jun 10, 2026" (reports/17nHTzHzE7…) | **STUCK** — saved-report delete is rules-denied (NEW-D11). Delete via the My Reports 🗑 after **PR #609** deploys. |
| Ask Joe | one quick-chip AI message on Jo's key (tiny token cost); chat transcript left as-is (New Chat doesn't clear — NEW-D16). Key untouched. |
| Reports generator | narrative checkbox toggled during test; generator panel re-inits per open (no persisted state). Enrich Data confirm CANCELLED (no enrichment ran). Dashboard period restored to 30 days. |
