# Operational Maturity Audit (#4) — NBD Pro

**Scope:** operations, resilience, observability, cost, scaling, operability of
the live `nobigdeal-pro` platform. **Date:** 2026-06. **Rule 0 honored** —
nothing was run against production; all execution was emulator/dry-run.

---

## 1. Operational Maturity Scorecard

| Dimension | Rating | One-line reason |
|---|---|---|
| **Recoverability** | 🟠 Amber | Firestore restore now **proven** (emulator) + runbook + pruner safety-floor; but **Cloud Storage binaries have no backup** (P0 open) and the backup split-brain needs a console call. |
| **Reliability** (bg jobs) | 🟢 Green | Every scheduled job idempotent + bounded; email reaper, migration lease, SMS run/day caps, anniversary idempotency, heartbeats all shipped. |
| **Observability** | 🟠 Amber | Per-alert runbooks + Sentry on crash-prone fns + latency/staleness policies added — **but alert notification channels are still placeholders**; until wired to a phone, nothing pages Jo. |
| **Cost** | 🟢 Green | Strong per-feature hard caps; **one-button AI kill-switch** + plan-aware vision cap + per-day SMS cap + spend runbook shipped. |
| **Scaling** | 🟠 Amber | Server-side jobs optimized; the client's **load-all-leads-into-`window._leads`** model is the remaining cliff (needs a refactor, not a patch). |
| **Operability** | 🟢 Green | 6 runbooks (was 1); rollback documented; deploy now gates on the smoke suite; docs largely current. |

**Headline:** the platform moved from "untested backups, silent failures, no
spend brake, no runbooks" to "proven restore, loud jobs, capped+kill-switchable
spend, on-call runbooks." The two things that keep it off all-green are
**operator/console actions** (wire alert channels; protect Storage) and one
**architectural refactor** (client lead pagination).

---

## 2. Ranked remediation punch list

Ranked by (impact × likelihood) ÷ effort. **P0 = data-loss / silent-critical /
runaway-cost.**

### OPEN — do these next
| Rank | Item | Sev | Effort | Why |
|---|---|---|---|---|
| 1 | **Wire alert notification channels to a phone** (replace `NOTIFICATION_CHANNEL_ID` in every `monitoring/*.json`; verify enabled) | **P0** | S (console) | Every alert built in this audit fires into the void until this is done. |
| 2 | **Back up Cloud Storage** (Object Versioning + daily Storage Transfer to a 2nd, ideally cross-region bucket) | **P0** | M | Photos / signed contract PDFs / recordings are currently **unrecoverable** — the evidence the product sells. |
| 3 | **Resolve the backup split-brain** (confirm canonical bucket in console → retire the duplicate export → repoint alert + `verify-backup.sh`) | **P0** | S–M | Monitored bucket isn't pruned; pruned bucket isn't monitored. Gated on a console check (failure-mode: retiring the wrong one deletes the only backup). |
| 4 | **Client lead pagination refactor** (server-side KPIs/search + list virtualization) | P1 | L | The dashboard loads *all* of a rep's leads every visit; breaks first at scale. Needs browser-tested refactor. |
| 5 | **Dormant/weekly digest query optimization** (introduce a reliable `lastActivityAt`/`stageStartedAt`-always-set convention → date-windowed queries) | P1 | M | Removes read-amplification + the >2000-lead silent truncation (now at least logged). |
| 6 | **Add HSTS + `X-Content-Type-Options: nosniff`** to `firebase.json` headers | P2 | S | The two residual security-header gaps. |
| 7 | **Refresh `ARCHITECTURE.md`** (drop `verify-functions.js` ref; reflect ~41 exports; mark companyId rules enforcement as live) | P2 | S | Doc currency. |
| 8 | Code-split heavy dashboard modules behind tab activation | P2 | M | Faster first paint; needs runtime verification. |

### DONE in this audit (shipped to `claude/nbd-pro-ops-audit-sinpn`)
- **DR:** restore drill (emulator-proven) + `RESTORE_FROM_BACKUP.md`; backup pruner **safety floor** (can't zero backups).
- **Reliability:** email-queue **reaper** + index; **migration runner lease**; **storm SMS per-run + per-day caps**; **anniversary idempotency** (dry-run no longer re-spams); **user pagination** across 3 digests; cron **heartbeats** + 2 staleness alert policies.
- **Observability:** server **Sentry** wired on `claudeProxy`/`renderPdf`/`analyzePhotoVision` (skips expected HttpsErrors); **latency** alert policy; `ALERT_RESPONSE.md` (per-alert runbook); README alert docs completed.
- **Cost:** **global AI kill-switch** (`feature_flags/global.aiDisabled`); **plan-aware photo-vision cap**; **per-day SMS cap**; `SPEND_KILLSWITCH.md`.
- **Scaling:** **anniversary query** server-filtered (index added; emulator-verified identical result, fewer reads); digest truncation now logged.
- **Operability:** `ROLLBACK.md`, `ONBOARD_TENANT.md`; **deploy now gates on the smoke suite**; `BIG_ROCKS` ROCK 1 corrected.

---

## 3. Console Verification Checklist (only Jo can confirm)

The in-repo work is done; these are the live-console confirmations that close
out the audit. "Healthy" value given for each.

| # | Check | Where | Healthy |
|---|---|---|---|
| 1 | Each `monitoring/*.json` policy is **created, enabled, wired to a PHONE/SMS channel** (not just email) | Cloud Monitoring → Alerting | 11 policies green, real channel, recent test alert received |
| 2 | Both backup buckets — which exist + newest folder each | GCS (`nobigdeal-pro-firestore-backups`, `nobigdeal-pro-backups`) | one canonical, fresh (today/yesterday) folder **with** `*.overall_export_metadata`; retire the dead one |
| 3 | Backup bucket region == Firestore region | GCS bucket details | both `us-central1` (cheap/fast restore) |
| 4 | Cloud Scheduler last-success per job | Cloud Scheduler | every job ran in its window; no chronic failures |
| 5 | Run the **scratch-project restore drill** once | per `RESTORE_FROM_BACKUP.md` §2 | import succeeds; record the real RTO |
| 6 | `SENTRY_DSN_FUNCTIONS` set + project ingesting fn events; client `__NBD_SENTRY_DSN` set | Sentry + Firebase secrets | events arriving with release tags |
| 7 | Stripe webhook **delivery success rate** | Stripe → Developers → Webhooks | ~100%; failure alert configured |
| 8 | Budgets/backstops exist | GCP Billing ($50/day→phone); Twilio spend trigger; Anthropic limit | all set + reach Jo |
| 9 | Per-tenant cost vs price | Stripe revenue vs GCP/Anthropic/Twilio usage | each tenant's cost < plan price (watch photo-vision) |
| 10 | `feature_flags/global` kill-switch works | Firestore console | setting `aiDisabled:true` returns 503 from claudeProxy within ~60s |

---

*Generated by Audit #4. Every change above was made on
`claude/nbd-pro-ops-audit-sinpn` with sign-off; nothing was run against
production.*
