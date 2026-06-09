# Exhaustive QA — Cleanup Manifest

Track every `ZZ_QA_` artifact created on live prod + every real setting changed, so the tenant-zero account is left exactly as found. Purge `ZZ_QA_` artifacts on Jo's OK.

## ZZ_QA_ records created
| date | artifact | location | state | action needed |
|------|----------|----------|-------|---------------|
| 2026-06-09 | Lead "ZZ_QA_ C1 Verify DELETE" (999 ZZ_QA Verify Ln) | CRM leads | **soft-deleted → Deleted bin** (during delete-flow test) | optional permanent purge from Deleted bin (CRM header → trash) on Jo's OK |
| 2026-06-09 | Leads: Gate Test (777 ZZ_QA Gate), D3 Reuse (555 ZZ_QA Reuse), Dedup A+B (888 ZZ_QA Dedup), Customer Page Test (444 ZZ_QA Customer) | CRM leads | **all soft-deleted → Deleted bin** | optional permanent purge on Jo's OK |
| — | **0 ZZ_QA leads remain in the ACTIVE pipeline** (verified). ⚠ Active lead count is 22 (was ~19 at session start) — **none are ZZ_QA**; likely real public-intake leads arrived during the long session (or baseline drift). Jo: confirm the ~3 extra leads are legitimate, not strays. | | review |

## ⚠ Needs Jo cleanup (couldn't delete via UI)
| date | artifact | location | why | action |
|------|----------|----------|-----|--------|
| 2026-06-09 | Lead "ZZ_QA_ Inspect Bridge Test" (222 ZZ_QA Inspect Ln) + its `inspect_leads` public record | CRM pipeline (stage New) + `inspect_leads` collection | created via /inspect for the CO-H-1 bridge re-verify; CRM delete failed (NEW-5). **ROOT CAUSE FOUND + FIXED in PR #596: it was the firestore.rules throw, not a bridge re-sync — the soft-delete was being PERMISSION_DENIED.** | **Once PR #596 deploys**, deleting this lead via the normal CRM delete flow will work (no longer re-syncs/reappears). Until then it persists. The `inspect_leads/<publicLeadId>` public doc may still want a separate purge if you want it gone from the public collection too. |

## Real settings changed → restored
| setting | original | test value | restored? |
|---------|----------|-----------|-----------|
| `nbd_monthly_goal` (revenue goal) | null (default $50k) | 77777 | ✅ restored to null |
| `nbd_home_tasks` (task checklist) | 4 default tasks | +1 ZZ_QA task | ✅ restored to original |
| `nbd_home_widgets` (home layout) | null (defaults) | toggled/reset during picker tests | ✅ restored to null |
| `nav-tools`/`nav-insights`/`nav-ai-tools` (sidebar collapse) | absent (default open) | toggled | ✅ keys removed |
| theme (`data-theme`) | `ios` (Jo's saved) | none applied (picker only opened) | ✅ unchanged |

## Pre-existing test data (NOT created by this campaign — do not assume ownership)
Other `ZZ_`/test leads already in the pipeline from prior sessions: "ZZ_WriteDiag DELETE_ME", "Test Signer NBDtest", "Remote Sign E2E Test", plus various "Test St/Way" leads. Flag for Jo; not cleaned by this sweep.

## No outbound / no charges
No SMS/email sent; no Stripe/charge fired. All delete/send tests stopped at the confirm boundary except the ZZ_QA lead soft-delete (own throwaway).
