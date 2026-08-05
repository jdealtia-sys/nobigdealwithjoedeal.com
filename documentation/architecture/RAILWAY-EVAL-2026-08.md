# Railway Evaluation — 2026-08-05

**Verdict: defer.** Nothing in the current workload is blocked by Firebase Functions, and Railway would add a second deploy surface, a second secret store, and a second failure domain for a solo operator. Revisit only when one of the trigger conditions at the bottom actually fires.

## What Railway is (for this repo's purposes)

Container hosting with git-push deploys — long-running Node processes, no execution-time ceiling, memory to 32 GB, background workers and cron built in. The pitch relative to Cloud Functions gen2: no 540s scheduled-function ceiling, no cold starts, cheaper sustained compute for always-on workers.

## Current state (verified 2026-08-05)

- **No container infrastructure exists**: zero Dockerfiles, no docker-compose, no Procfile, no non-Firebase server code anywhere in the repo. Everything is Firebase Hosting (`docs/`) + Cloud Functions (`functions/`, gen2, Node 22).
- All background work is 24 `onSchedule` crons + Firestore/Storage triggers. Queueing is Firestore-collection polling (`email_queue` drained every minute by `emailQueueWorker`).

## Candidates that would move first (ranked)

| Candidate | Why it strains Functions | Today's reality |
|---|---|---|
| `renderPdf` (functions/render-pdf.js) | puppeteer-core + @sparticuz/chromium at **2GiB**, cold-start heavy | Works; minInstances keeps it warm. Cost is the pain, not capability |
| `emailQueueWorker` (integrations/email-queue-worker.js) | A polling queue implemented as a 1-minute cron — the shape that wants a real worker process | Fine at current volume (single-tenant-ish scale) |
| Voice Intelligence (integrations/voice-intelligence.js) | Three functions at the **540s max**: download + transcribe + LLM analyze | No observed timeouts yet |
| `runMigrations` / backfills (handlers/migrations.js) | Explicitly sized to the 540s ceiling — "~5k docs per run" | Chunked reruns work; annoying, not blocking |
| Compliance/backup crons | Four 540s jobs, one at 1GiB | Working |

## What a move would actually cost

1. **A Dockerfile + Node server harness** for each moved workload (Express wrapper, health endpoint) — new code to own.
2. **Secret duplication**: RESEND/TWILIO/ANTHROPIC/STRIPE keys re-provisioned in Railway's env store, plus a service account JSON for Firestore/Storage access (today the functions get ambient ADC — a leaked Railway SA key is a new risk class).
3. **Network egress + latency**: every Firestore read crosses the public internet instead of Google's backbone.
4. **A second deploy pipeline** outside the existing merge-to-main → firebase-deploy flow, outside the release-gate contract, outside `NBD_DEPLOY_SKIP_LIST` semantics.
5. **Observability split**: Cloud Logging + the health digest currently see everything; Railway workloads would need their own log shipping into Sentry/Slack.
6. **Monthly floor**: an always-on worker bills 24/7; the current crons bill seconds per day. For today's volume, Railway is likely a cost *increase*.

## Revisit triggers (any one of these makes it worth a day)

- A migration/backfill genuinely can't be chunked under 540s (e.g. a full multi-tenant reshape at >100k docs).
- `renderPdf` cold-start or cost becomes a rep-visible complaint at real multi-tenant volume.
- Voice Intelligence starts hitting the 540s wall on long recordings (>45 min calls).
- Email/SMS queue volume makes 1-minute polling latency a product problem (needs a real worker + pub/sub).
- A feature needs WebSockets or server-sent events (Functions gen2 can't hold connections).

If a trigger fires: move **one** workload (renderPdf is the natural first), keep Firestore as the only state store, deploy from a `railway/` subdirectory in this same repo so CI still sees the code, and wire its logs into the existing Sentry DSN before taking traffic.

---
*Written 2026-08-05 as part of the integrations evaluation (kie.ai shipped dark in #1181; Obsidian vault index landed alongside this doc). No infra was provisioned.*
