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
```

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

## Ongoing monitoring

You should check these dashboards at least daily for the first 30 days after
deploy:
- **Cloud Logging** — `resource.type="cloud_run_revision"` with
  `severity>=WARNING`
- **Cloud Monitoring** — Alert Policies list (should be green)
- **Twilio Console** — Usage → last 7 days
- **Anthropic Console** — Usage → last 7 days
- **Stripe Dashboard** — Payments + Disputes
