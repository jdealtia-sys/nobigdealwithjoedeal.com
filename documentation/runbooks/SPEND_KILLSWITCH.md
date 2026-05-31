# Runbook — Emergency spend kill-switch

**When:** the Cloud Billing budget alert fired, or you see runaway AI / SMS /
infra spend and need to **stop the bleeding now**.

> ⚠️ The Cloud **Billing budget alerts — it does NOT stop spend.** And
> `docs/pro/README-killswitch.md` is the *service-worker* kill-switch (disables
> the PWA), **not** a spend control. This page is the actual spend kill-switch.
> There is no single global button yet (see "Proposed" below) — you pull the
> lever for whichever cost driver is running hot.

First: **identify the driver** (1 minute) — GCP Billing → Reports (group by
service/SKU), Anthropic console, Twilio console. Then pull the matching lever.

---

## AI (Anthropic / claudeProxy, photo-vision, visualizer) — fastest first

Per-uid (200k tok/day) and per-company (plan-tiered) token caps already
hard-stop *individual* abusers. Use these only for a *platform-wide* event
(e.g. many compromised accounts at once):

1. **Instant, blunt — pull the key.** Remove the Anthropic secret so every AI
   call fails closed:
   ```bash
   firebase functions:secrets:destroy ANTHROPIC_API_KEY --project nobigdeal-pro
   # (re-set it later: firebase functions:secrets:set ANTHROPIC_API_KEY)
   ```
   Takes effect on the next cold start / new secret version binding. Also
   rotate the key in the Anthropic console to kill in-flight use immediately.
2. **Disable the visualizer image-gen** (the ~$0.08/call surface) without
   touching the rest: set `VISUALIZER_IMAGEGEN_ENABLED=false` on the
   `visualizerImageGen` revision (it ships disabled by default anyway).
3. **Tighten a single abuser:** lower that company's cap in
   `CLAUDE_COMPANY_BUDGET` (`functions/handlers/_shared.js`) and redeploy.

## SMS (Twilio / checkStormAlerts, verification, D2D)

1. **Per-run cap already exists:** `STORM_MAX_SMS_PER_RUN` (default 250).
   Drop it to `0` on the `checkStormAlerts` revision to halt storm fan-out
   without a deploy.
2. **Instant, blunt — pull Twilio creds:** destroy `TWILIO_AUTH_TOKEN` (all
   SMS sends fail closed), and/or pause the number / set a spend limit in the
   Twilio console (Twilio also supports an account-level spend trigger — set
   one up as a backstop).

## Email (Resend / emailQueueWorker, digests)

- Destroy `RESEND_API_KEY`, or flip the digest flags off
  (`WEEKLY_DIGEST_ENABLED`, `DORMANT_NUDGE_ENABLED`, `ANNIVERSARY_TOUCH_ENABLED`,
  `HEALTH_DIGEST_ENABLED`, `FUNNEL_RECOVERY_ENABLED`) on those revisions.

## Firebase infra (function invocations / Firestore reads)

- A runaway *function* (loop, retry storm): `gcloud functions delete <fn>
  --project nobigdeal-pro` (redeploy from the branch when fixed), or pause its
  Cloud Scheduler job: `gcloud scheduler jobs pause <job> --project nobigdeal-pro`.
- Vendor metered calls (HOVER/Regrid/Groq): destroy the corresponding secret —
  each integration is a no-op when its secret is unset.

## Set the backstop budgets (do once, now)

- **GCP Billing → Budgets:** $50/day with 50/90/100% → **phone** alert.
- **Twilio:** account spend trigger / monthly cap.
- **Anthropic:** workspace spend limit.
- **Resend / Groq / vendors:** plan caps where offered.

---

## Proposed (not yet built) — a real one-button switch

Add a single `feature_flags/global` Firestore doc (or `AI_GLOBAL_DISABLE`
env) checked at the top of `claudeProxy` / `analyzePhotoVision` /
`visualizerImageGen` so you can halt *all* billable AI in one write without a
deploy or secret rotation. Tracked as a P1 in the Audit #4 punch list.
