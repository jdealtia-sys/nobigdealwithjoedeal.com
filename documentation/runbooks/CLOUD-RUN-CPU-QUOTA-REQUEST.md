# Runbook — Cloud Run CPU quota increase (us-central1)

**Status as of 2026-08-18:** not yet submitted. This is a **Jo action** — it
requires the Cloud Console and goes to Google for review, so it cannot be done
from CI or from a session.

**Why it matters:** every deploy of the ~168-function fleet trips this ceiling,
and the workaround costs us a chunked wave-1 deploy
(`NBD_DEPLOY_WAVE1_MAX: "60"` in `.github/workflows/firebase-deploy.yml`).
When the increase lands, set that back to `"0"`.

## The quota

| Field | Value |
| --- | --- |
| Project | `nobigdeal-pro` (number `717435841570`) |
| Region | `us-central1` |
| Metric | `run.googleapis.com/cpu_allocation` — "Total CPU allocation" |
| Limit name | `/min/project/region`, unit `1/min/{project}/{region}` |
| Current | **200,000** — `defaultLimit` == `effectiveLimit`, **no override ever applied** |
| Request | **500,000** |

Verified 2026-08-17 via the Service Usage API. Every other region shows the
same flat 200,000 default, so this is a first request, not an escalation.

## Where to submit

Cloud Console → **IAM & Admin → Quotas & System Limits** → Service =
`Cloud Run Admin API`, Quota = **Total CPU allocation** → tick the
`us-central1` row → **Edit Quotas**.

If the form caps a single request, ask for 400,000 first — that still clears
the measured peak.

## Justification (paste this)

> This project runs 176 Cloud Run services in us-central1, every one of them a
> Cloud Functions Gen 2 backend, and every one allocated 1 vCPU (1000 mCPU).
> If each service holds a single instance, steady-state demand is 176,000 mCPU
> — 88% of our current 200,000 limit before any deployment or autoscaling
> activity.
>
> We deploy the full set from CI on every merge to main. During a rolling
> deploy, Cloud Run necessarily holds the outgoing and incoming revisions
> concurrently while the new revision passes its container healthcheck, so peak
> demand approaches 352,000 mCPU. That is well above the ceiling, and we are
> hitting it: on deploy run 32083185787 (2026-08-18T00:19Z), 81 distinct
> services failed to roll out with
>
>     Could not create or update Cloud Run service <name>, Container
>     Healthcheck failed. Revision '<name>-00997-wut' is not ready and
>     cannot serve traffic. Quota exceeded for total allowable CPU per
>     project per region.
>
> This is not a burst of new capacity — these are updates to services that
> already exist and already hold their own allocation. The failures are
> non-deterministic (a different subset each deploy), which is consistent with
> racing a project-wide ceiling rather than a per-service problem.
>
> Four services additionally run with minimum instances configured (8 warm
> instances total) to keep latency down on customer-facing paths — PDF
> rendering, payment/subscription status, and signed image URLs — so that
> capacity is held continuously and is not reclaimable.
>
> We have already mitigated this on our side: our deploy pipeline now chunks
> releases into batches of 60 rather than deploying all services at once, which
> adds time to every deploy and triples our exposure to transient failures
> mid-deploy (each additional batch is an independent point of failure). We
> would prefer to remove that workaround.
>
> 500,000 mCPU covers the concurrent old+new revision peak (352,000) plus
> headroom for autoscaling under production traffic and for planned growth in
> service count.

## Numbers behind it (reference — do not paste)

| Fact | Value | Verified by |
| --- | --- | --- |
| Cloud Run services, us-central1 | 176 | `gcloud run services list` |
| CPU per service | 1 vCPU (1000 mCPU), **all 176** | same, `resources.limits.cpu` |
| minInstances services | 4 — `claudeproxy` 3, `getsubscriptionstatus` 2, `signimageurl` 2, `renderpdf` 1 (8 warm) | `autoscaling.knative.dev/minScale` |
| Current quota | 200,000, no override | Service Usage API `consumerQuotaMetrics` |
| Distinct services hitting the error | **81** (run 32083185787) | Cloud Logging, cloudfunctions audit entries |
| Deploy failures reported, same run | 75 (retried 75 → 3 → 0, run went green) | GitHub Actions log |

**Quote 81, not 75.** 81 services logged the quota error; 75 were still failing
when firebase-tools gave up on the pass. Some recovered inside the same wave.
81 is the count that actually hit the ceiling.

**The 352,000 figure is an upper bound, not a measurement.** firebase-tools
rolls out with an internal queue concurrency of 40, so the true simultaneous
peak is likely lower than "all 176 doubled" — but it clearly exceeds 200,000,
because 81 services got the error. The justification says "approaches", which is
defensible. If a reviewer challenges the arithmetic, the 81-service error count
stands on its own.

## After it lands

1. Set `NBD_DEPLOY_WAVE1_MAX` back to `"0"` in
   `.github/workflows/firebase-deploy.yml` and reclaim the chunking time. The
   comment next to the variable says the same.
2. Watch one deploy for CPU-quota healthcheck failures. If they are gone, the
   straggler-retry rounds should drop to near zero as well.

## Related

- [BLOCKING-TRIGGERS-NOT-GCIP-2026-08-17](../audit/BLOCKING-TRIGGERS-NOT-GCIP-2026-08-17.md)
- [DEPLOY-FALSE-GREEN-MODES-2026-08-17](../audit/DEPLOY-FALSE-GREEN-MODES-2026-08-17.md)
- [NEXT_SESSION-2026-08-18](../projects/NEXT_SESSION-2026-08-18.md)
