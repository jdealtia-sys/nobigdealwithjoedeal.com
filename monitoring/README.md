# Cloud Monitoring alert policies — NBD Pro

These policies detect abuse and spend anomalies across the `nobigdeal-pro`
Firebase project. Apply each one in Google Cloud Monitoring either through
the console or the `gcloud` CLI.

## Importing via gcloud

Authenticated as a project owner / monitoring admin:

```bash
# Brute-force detection on validateAccessCode
gcloud alpha monitoring policies create \
  --policy-from-file=monitoring/alert-validateAccessCode-bruteforce.json \
  --project=nobigdeal-pro

# Cloud Functions 5xx / error-rate spike
gcloud alpha monitoring policies create \
  --policy-from-file=monitoring/alert-functions-error-rate.json \
  --project=nobigdeal-pro

# Anthropic daily token budget exceeded
gcloud alpha monitoring policies create \
  --policy-from-file=monitoring/alert-claude-budget-exceeded.json \
  --project=nobigdeal-pro

# Rate-limit 429 spike
gcloud alpha monitoring policies create \
  --policy-from-file=monitoring/alert-rate-limit-spike.json \
  --project=nobigdeal-pro

# Backup cron stale (nightly Firestore export missing > 26h)
gcloud alpha monitoring policies create \
  --policy-from-file=monitoring/alert-backup-cron-stale.json \
  --project=nobigdeal-pro

# Voice-intelligence processing failure rate
gcloud alpha monitoring policies create \
  --policy-from-file=monitoring/alert-voice-processing-failures.json \
  --project=nobigdeal-pro

# emailQueueWorker stale > 30m (silent stop = no GDPR/dunning emails)
gcloud alpha monitoring policies create \
  --policy-from-file=monitoring/alert-email-queue-worker-stale.json \
  --project=nobigdeal-pro

# migrationsTick stale > 26h (daily migration tick stopped firing)
gcloud alpha monitoring policies create \
  --policy-from-file=monitoring/alert-migrations-tick-stale.json \
  --project=nobigdeal-pro
```

> **Scheduled-job staleness (Audit #4):** the `*-stale` policies use
> `conditionAbsent` against a per-run heartbeat log. `emailQueueWorker` and
> `migrationsTick` emit a heartbeat on **every** run (even no-op/skipped
> runs) precisely so a silent stop is detectable. If you add a new critical
> cron, give it an unconditional success log and a matching staleness policy.

Before running, edit each JSON file and replace `NOTIFICATION_CHANNEL_ID` with
Joe's Cloud Monitoring notification channel ID (SMS or email). You can list
channels with:

```bash
gcloud alpha monitoring channels list --project=nobigdeal-pro
```

## Individual alerts

### 1. `alert-validateAccessCode-bruteforce.json`
Fires when `validateAccessCode` logs `access_code_invalid` more than **20
times in 5 minutes**. Indicates someone is brute-forcing codes.

### 2. `alert-functions-error-rate.json`
Fires when Cloud Functions log `severity >= ERROR` more than **50 events
in 5 minutes**. Catches any function-wide regression.

### 3. `alert-claude-budget-exceeded.json`
Fires on the first instance of the `Daily AI budget exceeded` response in
claudeProxy logs. Tells you a user is either legitimately heavy or being
abused.

### 4. `alert-rate-limit-spike.json`
Fires when any rate-limit namespace emits more than **200 denials in
10 minutes** (publicVisualizerAI, claudeProxy, validateAccessCode, etc).
Catches sustained abuse.

### 5. Billing budget (set in Cloud Billing console, not here)
In Cloud Billing → Budgets, set a **$50/day** budget on the project with a
50%/90%/100% threshold. Email + SMS to Joe.

> ⚠️ A Cloud Billing budget **alerts** — it does **not** stop spend. It is
> not a kill-switch. See the cost section of the Audit #4 report.

### 6. `alert-backup-cron-stale.json`
Fires when the daily Firestore backup hasn't logged success in **> 26h**
(two missed runs). Restore capability may be compromised — see
`documentation/runbooks/RESTORE_FROM_BACKUP.md`.

### 7. `alert-voice-processing-failures.json`
Fires when `onAudioUploaded` (voice-intelligence) writes `failed`/
`quarantined_consent` at **> 5% over 1h**. Usually a missing/rotated
`GROQ_API_KEY`/`ANTHROPIC_API_KEY` or a client audio regression.

### 8. `alert-email-queue-worker-stale.json`
Fires when `emailQueueWorker` misses its heartbeat for **> 30m**. The worker
runs every minute; a gap means GDPR-erasure confirmations and Stripe dunning
emails have silently stopped sending.

### 9. `alert-migrations-tick-stale.json`
Fires when `migrationsTick` misses its heartbeat for **> 26h**. Pending
schema migrations would no longer apply (and a half-applied migration would
never get its retry).

## Ongoing monitoring

You should check these dashboards at least daily for the first 30 days after
deploy:
- **Cloud Logging** — `resource.type="cloud_run_revision"` with
  `severity>=WARNING`
- **Cloud Monitoring** — Alert Policies list (should be green)
- **Twilio Console** — Usage → last 7 days
- **Anthropic Console** — Usage → last 7 days
- **Stripe Dashboard** — Payments + Disputes
