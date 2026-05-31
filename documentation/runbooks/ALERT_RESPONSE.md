# Runbook — Alert response (on-call one-pager)

One section per Cloud Monitoring alert policy in `monitoring/`. Format:
**symptom → likely cause → first action → escalation.** Jo is the whole
rotation, so every alert here must be *actionable at 2am* without reading code.

> **PRECONDITION (do this once, or none of these page you):** every policy in
> `monitoring/*.json` ships with a placeholder `NOTIFICATION_CHANNEL_ID`.
> Until you replace it with a real channel that reaches your *phone*, these
> alerts fire into the void. Verify in **Cloud Monitoring → Alerting → Policies**
> that each is enabled and wired to an SMS/phone channel — not just email.
> `gcloud alpha monitoring channels list --project=nobigdeal-pro`

---

## 1. validateAccessCode brute force
- **Symptom:** >20 `access_code_invalid` in 5 min.
- **Likely cause:** someone enumerating homeowner portal access codes.
- **First action:** Cloud Logging → filter `jsonPayload.message="access_code_invalid"`; grab the source IP. Block at Cloudflare/App Check. Confirm rate-limit is denying (it should auto-throttle).
- **Escalation:** if codes are being *guessed successfully*, rotate access codes (`rotateAccessCodes` callable / `scripts/seed-access-codes.js`) and review `firestore.rules` portal paths.

## 2. Cloud Functions error-rate spike
- **Symptom:** >50 ERROR logs in 5 min across the critical function set.
- **Likely cause:** a bad deploy, or an upstream outage (Stripe/Twilio/Anthropic/Resend).
- **First action:** Logging → group by `resource.labels.service_name` to find which function; read the top error. If it started right after a deploy → **roll back** (see ROLLBACK runbook). If upstream → check that vendor's status page.
- **Escalation:** if a single function, redeploy last-good or disable it; if widespread, consider the kill-switch.

## 3. Claude daily token budget exceeded
- **Symptom:** a uid/company hit its daily AI token cap (`_shared.js` caps).
- **Likely cause:** legitimate heavy use, OR credential-stuffing / a runaway client loop.
- **First action:** Logging → is it **one** uid (likely legit power user) or **many at once** (likely abuse / stuffing)? The cap already *hard-stops* further spend for that uid/company, so this is informational unless it's many uids.
- **Escalation:** many uids → suspect compromised creds; force token revoke + review App Check. One uid abusing → lower their company cap in `CLAUDE_COMPANY_BUDGET`.

## 4. Rate-limit denial spike
- **Symptom:** sustained `rate_limit_denied` (>200/10min).
- **Likely cause:** attacker, bot, broken client, or a bad deploy hammering an endpoint.
- **First action:** Logging → `jsonPayload.namespace` tells you which endpoint/identity; correlate the source IP. Block if malicious.
- **Escalation:** if a *legit* client is tripping it (deploy bug), the limits are in `rate-limit-policy.js` — adjust and redeploy.

## 5. Backup cron stale > 26h
- **Symptom:** no daily Firestore backup success log in 26h.
- **Likely cause:** scheduler disabled, function crash, or the export SA lost IAM.
- **First action:** `./scripts/verify-backup.sh`; `gcloud functions logs read <backupFn> --gen2 --limit 50`; `gcloud scheduler jobs list | grep -i backup`. Confirm the SA still has `datastore.importExportAdmin` + `storage.objectAdmin` on the bucket.
- **Escalation:** **this is a restore-capability outage — treat as P0.** Fix and manually trigger one export. See `RESTORE_FROM_BACKUP.md`.
- **Note:** confirm whether this watches the *canonical* bucket (Audit #4 found a daily-vs-nightly split — finding 1.1/1.5).

## 6. Voice processing failures > 5%
- **Symptom:** `onAudioUploaded` writing `failed`/`quarantined_consent` above 5%/1h.
- **Likely cause:** `GROQ_API_KEY`/`ANTHROPIC_API_KEY` unset/rotated, budget exhausted, Groq outage, or a client audio regression.
- **First action:** `gcloud functions logs read onAudioUploaded --gen2 --limit 100`; read the `[<code>]` breadcrumb. `groq-not-configured`/`analysis-*` → set/rotate the secret. `audio-*` spike → roll back the client `voice-intelligence.js`.
- **Escalation:** if Groq is down, nothing to do but wait; comms to affected reps.

## 7. emailQueueWorker stale > 30m
- **Symptom:** no worker heartbeat in 30 min (runs every minute).
- **Likely cause:** worker crash, scheduler disabled, or a deploy broke it.
- **First action:** `gcloud functions logs read emailQueueWorker --gen2 --limit 50`. Inspect `email_queue` for a pile-up of `pending`/`sending`. The 2.2 reaper auto-reclaims stuck `sending` rows once the worker runs again.
- **Escalation:** **GDPR-erasure confirmations + Stripe dunning emails are not sending** while this is down — restore the worker promptly. If `RESEND_API_KEY`/`EMAIL_FROM` were rotated, re-set the secrets.

## 8. migrationsTick stale > 26h
- **Symptom:** no daily migration heartbeat in 26h.
- **Likely cause:** scheduler disabled, or a migration is failing/looping.
- **First action:** read `system/migrations` (`lastError`, `lastFailedVersion`) and `system/migrations_lock` (a healthy lease self-expires in 15m; a far-future `expiresAt` = stuck holder). `gcloud functions logs read migrationsTick --gen2 --limit 50`.
- **Escalation:** fix the failing migration script; let the next tick retry, or run `runMigrations` manually (admin only). Low urgency unless a deploy depends on a pending migration.

## 9. Billing budget ($50/day)
- **Symptom:** Cloud Billing budget threshold (50/90/100%) crossed.
- **⚠️ Reality:** a billing budget **alerts only — it does not stop spend.** There is no automatic spend kill-switch (Audit #4 cost finding).
- **First action:** identify the cost driver fast — GCP Billing → Reports (by SKU/service), Anthropic console, Twilio console. AI = per-uid/company caps already hard-stop; SMS = `STORM_MAX_SMS_PER_RUN` caps storm fan-out.
- **Escalation:** to actually halt spend you must manually act: disable the offending function (`gcloud functions delete`/redeploy without it), pull the relevant secret, or set the feature's `*_ENABLED` flag off. See the Audit #4 kill-switch recommendation.

---

## Coverage gaps (no alert exists yet — Audit #4 Phase 3)
These critical paths are **not** covered by any policy above; add them:
- **Stripe webhook non-delivery** (signature failures / endpoint down emit no logs → invisible). Watch Stripe Dashboard → Developers → Webhooks, or add a "no `stripeWebhook` success in N h" heartbeat alert.
- **Function latency / timeout** (error-rate only catches thrown errors, not slow/timed-out calls).
- **Firestore quota / read-volume** spikes (cost + throttle risk).
- **Storm/digest/retention cron staleness** (only backup/email/migrations have heartbeat alerts so far).
