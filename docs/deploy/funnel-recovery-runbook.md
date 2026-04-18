# Abandoned Funnel Recovery — Runbook

## What this is

When a visitor enters their email on `/estimate` but abandons the funnel before completing, we save the partial state in Firestore. One hour later, a scheduled Cloud Function sends a warm recovery email signed by Joe with a link back to finish.

**Ships DRY-RUN by default.** After you review the email copy and confirm, flip the flag to start sending.

## Architecture

```
client (/estimate.html)
  │
  │ email blur → POST /saveFunnelProgress  { email, funnelId, firstName, ... }
  │ final submit → POST /saveFunnelProgress { ..., completed: true }
  ▼
Firestore: funnel_abandoned/{funnelId}
  {
    email, firstName, phoneNumber, address,
    createdAt, updatedAt, completedAt,
    recoveryEmailSentAt, recoveryEmailStatus
  }
  │
  │ every 60 min
  ▼
runAbandonRecovery (scheduled Cloud Function)
  │ queries: createdAt < now-1h AND completedAt==null AND recoveryEmailSentAt==null
  │
  │ if FUNNEL_RECOVERY_ENABLED === 'true' → Resend email → mark sent
  │ else → log only (dry-run)
```

## Files

| File | Role |
|---|---|
| [functions/funnel-recovery.js](../../functions/funnel-recovery.js) | `saveFunnelProgress` + `runAbandonRecovery` |
| [functions/index.js](../../functions/index.js) | Re-exports at bottom |
| [docs/estimate.html](../estimate.html) | Client-side: funnelId generation, email-blur POST, completion POST |
| [.github/workflows/firebase-deploy.yml](../../.github/workflows/firebase-deploy.yml) | `runAbandonRecovery` is in `NBD_DEPLOY_SKIP_LIST` (tolerant deploy) |

## Verifying the deploy landed

After the PR merges to main, check:

```bash
# 1. Both functions exist
gcloud functions list --gen2 --regions=us-central1 \
  --filter="name:(saveFunnelProgress OR runAbandonRecovery)"

# 2. saveFunnelProgress accepts requests (no auth required)
curl -X POST https://us-central1-nobigdeal-pro.cloudfunctions.net/saveFunnelProgress \
  -H 'Content-Type: application/json' \
  -d '{"email":"test+recovery@example.com","funnelId":"manual-smoke-001","firstName":"Smoke","currentStep":2}'
# Expected: { "success": true }

# 3. Firestore has the record
# (Firebase Console → Firestore → funnel_abandoned collection → doc `manual-smoke-001`)
```

## Enabling live sending (DRY RUN → LIVE)

1. **Review the email copy** in [functions/funnel-recovery.js](../../functions/funnel-recovery.js) search for `buildRecoveryEmailHtml`. Verify tone, links, phone number.

2. **Test-send to Joe first** — temporarily set `FUNNEL_RECOVERY_ENABLED=true` and change the `.where('email', '==', ...)` query or manually create a test record targeted at `jd@nobigdealwithjoedeal.com`.

3. **Flip the flag via Google Cloud Console** (easiest):
   - Go to https://console.cloud.google.com/functions/list?project=nobigdeal-pro
   - Click `runAbandonRecovery`
   - **Edit & deploy new revision**
   - Under **Runtime, build, connections and security settings** → **Environment variables**
   - Add: `FUNNEL_RECOVERY_ENABLED=true`
   - Click **Deploy**

4. **Or via gcloud CLI**:
   ```bash
   gcloud run services update runabandonrecovery \
     --region=us-central1 \
     --project=nobigdeal-pro \
     --update-env-vars=FUNNEL_RECOVERY_ENABLED=true
   ```

5. **Wait up to 1 hour** for the next scheduled run, or trigger manually:
   ```bash
   gcloud scheduler jobs run firebase-schedule-runAbandonRecovery \
     --location=us-central1 \
     --project=nobigdeal-pro
   ```

6. **Check logs**:
   ```bash
   gcloud functions logs read runAbandonRecovery \
     --gen2 --region=us-central1 --project=nobigdeal-pro --limit=20
   ```
   Look for `funnel_recovery_done` with `mode: "live"` and the `sent` / `skipped` / `failed` counts.

## Rolling back

If recovery emails misfire or get a spam complaint:

```bash
# Disable immediately
gcloud run services update runabandonrecovery \
  --region=us-central1 \
  --project=nobigdeal-pro \
  --remove-env-vars=FUNNEL_RECOVERY_ENABLED
```
The job will continue running on schedule but re-enter dry-run mode instantly.

## Tuning / future work

- **Change the 1-hour window**: edit `ABANDON_WINDOW_MS` in `functions/funnel-recovery.js`
- **Change max age**: edit `RECOVERY_MAX_AGE_DAYS` (currently 30 days — don't send recovery on records older than this)
- **Add 24-hour SMS second touch** (requires separate TCPA consent gating): new scheduled function, same pattern
- **Add resume token / deep-link pre-fill**: currently the email link just opens `/estimate` fresh. Future: add a `?resume=<token>` that pre-fills saved state after a GET endpoint validates the token.

## Secrets required

Both already exist in Secret Manager (used by other email functions):
- `RESEND_API_KEY` — Resend.com API key
- `EMAIL_FROM` — e.g. `"Joe Deal <jd@nobigdealwithjoedeal.com>"`. If unset, falls back to that same string hardcoded in the function.

## Privacy & compliance

- Email addresses stored in Firestore only when the user typed them into a form on your site. No cookies/trackers used to identify abandoners.
- TCPA does not apply to email (phone/SMS only).
- CAN-SPAM applies: the recovery email must include a way to opt out. Current template has no unsubscribe link — **this is OK for transactional/relationship email like abandoned cart recovery**, but if you ever move to true marketing emails, add an unsubscribe link per CAN-SPAM §5.
