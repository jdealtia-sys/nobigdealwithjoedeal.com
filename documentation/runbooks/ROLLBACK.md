# Runbook — Rollback a bad deploy

**When:** you (or CI) shipped a deploy and prod is broken — error-rate alert
firing, a function throwing, the dashboard white-screening. It's 9pm and you
need prod back to last-good **now**.

> Deploys are **forward-only** (`firebase-deploy.yml` has no rollback step).
> This page is the recovery path. Identify *what* you shipped first:
> Hosting? Functions? Rules/Indexes? Each rolls back differently.

---

## 0. Triage (30 seconds)
- **What changed?** Look at the last merged PR / the deploy run. Hosting-only?
  Functions? Rules?
- **Is it one function or everything?** Cloud Logging → group by
  `service_name`. One function → do the fast per-function rollback (§2). Broad
  → roll the whole deploy back (§4).

---

## 1. Hosting (white-screen, bad JS/HTML)

**Fastest — Firebase console:** Hosting → Release history → find the previous
good release → **Rollback**. Instant, no deploy. This is the 9pm move.

**CLI / git:** redeploy hosting from the last-good commit:
```bash
git checkout <last-good-sha> -- docs firebase.json
npx firebase-tools deploy --only hosting --project nobigdeal-pro
```
(Then restore your working tree: `git checkout HEAD -- docs firebase.json`.)

Service-worker stuck serving bad cached app? Use the SW kill-switch
(`docs/pro/README-killswitch.md`): `?nosw=1` per user, or ship `docs/pro/nosw.txt`.

## 2. A single bad Cloud Function (v2 / Cloud Run) — fast rollback

v2 functions are Cloud Run services that keep prior **revisions**. Route
traffic back to the last-good revision without a rebuild:
```bash
gcloud run revisions list --service <fnName> --region us-central1 --project nobigdeal-pro
gcloud run services update-traffic <fnName> --region us-central1 \
  --project nobigdeal-pro --to-revisions <PREVIOUS_GOOD_REVISION>=100
```
Takes effect in seconds. Re-deploy the real fix later.

## 3. Firestore rules / indexes

No native rollback — redeploy the previous version from git:
```bash
git checkout <last-good-sha> -- firestore.rules firestore.indexes.json
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project nobigdeal-pro
git checkout HEAD -- firestore.rules firestore.indexes.json
```
> Indexes only **add**; a rolled-back index set won't delete a live index, so
> rules are the urgent part. A too-strict rules deploy that locks users out is
> the classic case — redeploy the prior rules immediately.

## 4. Roll the whole deploy back (broad breakage)

**Preferred — revert on `main`, let CI redeploy clean:**
```bash
git revert <bad-merge-sha>     # or: git revert -m 1 <bad-merge-commit>
git push origin main           # CI (firebase-deploy.yml) redeploys last-good
```
**Manual — deploy everything from last-good SHA** (when CI is also broken):
```bash
git checkout <last-good-sha>
./scripts/deploy-runbook.sh    # rules+indexes → functions → hosting, in order
git checkout <your-branch>
```

## 5. Verify recovery
```bash
./scripts/verify-deploy.sh     # smoke-tests the live URLs
```
Confirm the error-rate alert clears and a real tenant can log in + see their
pipeline.

## 6. After action
- Note what shipped and why CI didn't catch it. **The functions deploy does
  NOT gate on the smoke suite** (Audit #4 finding) — if a code regression got
  through, that's the root cause; add the gate.
- If a migration ran as part of the bad deploy, check `system/migrations`
  state and whether data needs the restore runbook.
