# Runbook — grant `serviceAccountTokenCreator` (unblocks PDF signed-URLs + access-code login)

**Who runs this:** Jo / devops. **Claude must NOT run it** — it's an access-control (IAM) change, outside Claude's allowed actions.
**Project:** `nobigdeal-pro` · **Risk:** low (adds one role to the runtime SA; reversible).

## Why
Two prod issues share one root cause — the **Cloud Functions runtime service account lacks the `iam.serviceAccountTokenCreator` role**, so it can't call Google's `signBlob`:

1. **`renderPdf` signed URLs** — `file.getSignedUrl()` throws → the function falls back to a **non-expiring Firebase download-token URL** (works, but the URL never expires). With the role it auto-upgrades to **7-day expiring signed URLs** (the render-pdf.js code already prefers signed → falls back to token).
2. **Access-code / demo login** — `admin.auth().createCustomToken()` needs the same `signBlob` permission. Without it, **every access-code login (demo + member) fails in prod** (see [[access-code-login-iam-gap]]).

## The grant

### 1. Find the runtime service account
Cloud Functions Gen2 default runtime SA is the **compute** SA:
```bash
PROJECT=nobigdeal-pro
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
echo "$SA"
```
> If functions were deployed with an explicit `serviceAccount` (check the Functions console → a function → Details → "Service account"), use that email instead.

### 2. Grant the role (self-binding: the SA can mint tokens AS itself)
```bash
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --member="serviceAccount:$SA" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="$PROJECT"
```

### 3. Verify
```bash
gcloud iam service-accounts get-iam-policy "$SA" --project="$PROJECT" \
  --format='table(bindings.role,bindings.members)' | grep -i tokenCreator
```
No redeploy needed — IAM changes take effect within ~1–2 minutes.

## Verify it worked (in the app, after ~2 min)
- **Access-code login:** open `/pro/login`, enter the demo access code → should sign in (was failing). Demo code seeded via `scripts/seed-demo-access.js`.
- **renderPdf signed URLs:** generate a Retail Quote → Download PDF. The server PDF URL should now be a `...&X-Goog-Signature=...` signed URL (expiring) rather than a `?alt=media&token=` download-token URL. (Functionally both work; this just restores expiry.)

## Follow-up (after the grant lands)
- In `functions/render-pdf.js`, the non-expiring download-token fallback branch can be dropped or TTL'd once signed URLs are confirmed working (it was added as the workaround for this exact gap).
- `onRepSignup` is a *separate* blocker — it's a blocking-auth trigger that needs the project on **GCIP** (or a refactor to a Firestore trigger); see [[onrepsignup-gcip-gap]]. This IAM grant does NOT unblock it.

## Rollback (if ever needed)
```bash
gcloud iam service-accounts remove-iam-policy-binding "$SA" \
  --member="serviceAccount:$SA" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="$PROJECT"
```
