# Go-Live Checklist

Beginner-level, step-by-step. Follow in order. Each part is its own short file under `docs/deploy/`.

| # | File | Time | What it is |
|---|---|---|---|
| 1 | [01-preflight.md](docs/deploy/01-preflight.md) | 5 min | Make sure your local repo is clean and tests pass before you touch production |
| 2 | [02-required-secrets.md](docs/deploy/02-required-secrets.md) | 15 min | The 5 secrets the app can't run without |
| 3 | [03-app-check.md](docs/deploy/03-app-check.md) | 20 min | Register reCAPTCHA v3, paste the key, turn enforcement on |
| 4 | [04-rotate-access-codes.md](docs/deploy/04-rotate-access-codes.md) | 5 min | Kill the legacy hardcoded `NBD-2026` code and mint fresh ones |
| 5 | [05-optional-integrations.md](docs/deploy/05-optional-integrations.md) | pick-and-choose | BoldSign, HOVER, Sentry, Slack, Turnstile, Cal.com, Regrid, Upstash, Deepgram |
| 6 | [06-verify.md](docs/deploy/06-verify.md) | 15 min | Smoke-test the deployed app via curl + click-through |
| 7 | [07-ongoing-maintenance.md](docs/deploy/07-ongoing-maintenance.md) | ongoing | Key rotation, monitoring, audit review |
| 8 | [08-followups.md](docs/deploy/08-followups.md) | future | Deferred security + feature work not in this PR |

## What "live" means after you finish

- Firebase project `nobigdeal-pro` has the latest rules, indexes, functions, and hosting.
- `https://nobigdealwithjoedeal.com` serves the dashboard, portal, and public forms.
- Every security guard from the PR is enforced: App Check, tenant-scoped rules, rate limits, audit log, Storage content-type caps, GDPR flows.
- At least one integration is live enough to demo. The rest can follow on your schedule.

## Glossary (one-liner each)

- **Firebase** — Google's backend platform. Hosts the app (Hosting), the database (Firestore), file storage (Storage), and serverless functions (Cloud Functions).
- **Cloud Function** — A piece of server code that runs on demand. Our functions handle auth, Stripe webhooks, AI proxy, portal tokens, etc.
- **Firestore rules** — Server-enforced permission rules. They decide who can read/write which database documents.
- **Storage rules** — Same idea but for file uploads (photos, PDFs).
- **Secret** — An API key (like the Stripe secret) that lives in Firebase Secret Manager, never in the repo.
- **Custom claim** — A role label attached to a user's auth token: `admin`, `company_admin`, `manager`, `sales_rep`, `viewer`.
- **App Check** — Cloudflare for Firebase. Proves a request came from your real website, not a script.
- **Webhook** — A URL a vendor (Stripe, BoldSign, etc.) calls when something happens on their side.
- **PR** — Pull request. On GitHub, the page where a branch is proposed for merging into `main`. Ours is #2.

## If you get stuck

1. Re-read the part you're on. Every command works standalone.
2. Check `SECURITY.md` for threat-model context.
3. The `scripts/deploy-runbook.sh` script is the automated version of parts 1–2; read it if a manual command isn't working.

---

Next: open [`docs/deploy/01-preflight.md`](docs/deploy/01-preflight.md).
