# 07 — Ongoing maintenance

One-time steps are done. These are the recurring things.

## Rotate secrets every 90 days

Pick a day on the calendar (first Monday of every quarter is a good anchor). Run:

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY   --project nobigdeal-pro
firebase functions:secrets:set STRIPE_SECRET_KEY   --project nobigdeal-pro
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project nobigdeal-pro
firebase functions:secrets:set RESEND_API_KEY      --project nobigdeal-pro
firebase functions:secrets:set TWILIO_AUTH_TOKEN   --project nobigdeal-pro
firebase deploy --only functions --project nobigdeal-pro
```

For each:
1. Get a fresh key from the vendor dashboard.
2. Paste when prompted.
3. After the deploy succeeds, **revoke the old key on the vendor dashboard.**

Full procedure + incident-response steps in [`SECURITY.md`](../../SECURITY.md).

## Monitor the dashboards

Put these on a regular tab-checking habit:

- **Firebase Console** → `nobigdeal-pro` → **Functions** → watch for error spikes.
- **Sentry** (if wired) → new-issue alerts land in email or Slack.
- **Stripe Dashboard** → look for failed-payment trends.
- **GitHub Actions** → every PR run should be green.

## Weekly: glance at audit_log

Once a week, Firebase Console → Firestore → `audit_log` collection →
filter by `type=security_admin_grant_attempt`. Should be empty.
Any entry there means someone tried to mint an admin invite from the CRM.

Also scan `type=gdpr_erasure_confirmed` — those are customers who asked for their data deleted. Good to know the pipeline is working.

## Monthly: user count + storage

Firebase Console → Firestore → `users` → document count. Compare month-over-month.
Firebase Console → Storage → usage graph. If you're approaching quota, upgrade the plan or start pruning old photos.

## Every PR: the CODEOWNERS review

`.github/CODEOWNERS` auto-requires a review from `@jdealtia-sys` on any change to:
- `firestore.rules` / `storage.rules` / `firebase.json`
- `functions/**`
- `.github/workflows/**`
- `docs/privacy.html`
- `SECURITY.md`

Don't bypass this. Even small changes to rules have non-obvious implications.

## Every 6 months: dependency review

Dependabot opens PRs automatically for most deps (`.github/dependabot.yml`). Skim and merge the non-major ones. For major bumps (e.g. `firebase-admin 12 → 13`), open an issue first to plan.

Run `npm audit` manually every quarter:
```bash
cd functions && npm audit
cd ../tests && npm audit
```

## Keep a log

Track material changes in a simple running doc somewhere (Notion, `CHANGELOG.md`, whatever). The PR template and `audit_log` already capture the detail; this is your "what happened this quarter" summary.

---

Next: [`08-followups.md`](08-followups.md)
