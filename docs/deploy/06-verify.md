# 06 — Verify everything works (15 min)

After you merge the PR and the auto-deploy finishes (or after you run `scripts/deploy-runbook.sh`), walk through this list. Each takes ~1 minute.

## A. Cloud Functions are reachable

```bash
curl -i -X POST https://us-central1-nobigdeal-pro.cloudfunctions.net/submitPublicLead \
  -H 'Content-Type: application/json' \
  -d '{"kind":"__healthcheck","website":""}'
```

**Expected:** `HTTP/2 400` with body `{"error":"Invalid submission"}`.
**If you see 404:** the function didn't deploy. Re-run `firebase deploy --only functions`.
**If you see 403 with `"Verification failed"`:** Turnstile is configured and rejecting curl. That's the correct behavior — move on.

## B. Auth works

1. Open https://nobigdealwithjoedeal.com/pro/login.html in a fresh browser window.
2. Sign in with your account.
3. Dashboard loads. Left sidebar shows the regular views. No red errors in DevTools console.

If you see **"App Check not configured"** in console:
- Re-check `docs/pro/dashboard.html` has the reCAPTCHA site key pasted.
- Hard-refresh.

## C. App Check is enforcing

Open DevTools → **Network** tab → reload the dashboard.
Look for requests to `firestore.googleapis.com`. Each one should include a request header:
```
X-Firebase-AppCheck: eyJhbGci...
```
If that header is missing, App Check isn't initializing. See part 03.

## D. Pipeline renders + card details open

1. Click **Pipeline** in the left nav. Kanban columns render.
2. Click any lead card. Detail modal opens.
3. All the action buttons work: **📸 Photos**, **📄 Documents**, **✓ Tasks**, **🔗 Share Homeowner Portal Link**.

## E. Homeowner portal works (end-to-end, the big one)

1. On a lead detail, click **🔗 Share Homeowner Portal Link**.
2. Toast confirms "Portal link copied to clipboard." SMS app may open with the URL pre-filled.
3. Paste that URL in a **private browser window** (so you're not signed in as a rep).
4. Portal loads with the lead's first name + address in the hero.
5. If there's a V2 estimate on the lead, it shows up under "Your Estimate" with the total.
6. A Cal.com embed loads at the bottom (only if you set `calcomUsername` in rep settings).

## F. V2 Builder autosaves

1. Open the V2 Estimate Builder.
2. Type `123 Test St` into the address field. Pick a pitch. Add a line item.
3. Close the modal without saving.
4. Re-open it. Toast: "Restored unsaved draft." Your typed values are back.

## G. Admin analytics loads (admin accounts only)

1. Navigate to **Team Manager** (🛡 icon — only visible to admins).
2. The "Last 30 Days" panel shows 5 KPI tiles:
   - Estimates signed
   - Measurements ready
   - Portal links minted
   - Leads created
   - AI spend
3. At least four should show numbers (measurements will be 0 until you wire HOVER).

## H. Audit log is filling

1. Firebase Console → Firestore → `audit_log` collection.
2. Should have entries from the last few minutes — any time you edited a lead, signed in, or rotated an access code.

## I. Smoke test CI (post-merge)

After merging PR #2 into main, the **CI workflow** runs. Check:

1. GitHub → **Actions** tab → latest run on `main`.
2. All 5 jobs should be green:
   - Smoke tests
   - Node syntax check
   - Firestore rules tests
   - Functions parse + dep install
   - Secret scan

If any red, open the run and read the log. The most common cause is a missing dep (re-run install step) or a new test that hits a rule that changed.

## J. Firebase-deploy auto-ran

Also under GitHub **Actions** tab:

1. `Firebase deploy` workflow should be green.
2. Click it → see summary at the bottom:
   > ✓ Firebase deploy complete
   > | Firestore rules | nobigdeal-pro | deployed |
   > | Storage rules | nobigdeal-pro | deployed |
   > | Cloud Functions | nobigdeal-pro | deployed |
   > | Hosting | nobigdeal-pro | deployed |

If it says "skipped — secret not configured," you haven't set `FIREBASE_SERVICE_ACCOUNT` yet. See part 08 or do it manually via `scripts/deploy-runbook.sh`.

## Done when

- All 10 checks above return the expected green / 200 / "works" signal.
- The Cal.com embed loads on a homeowner portal page.
- A test pipeline card → detail modal → share portal → homeowner sees it flow works end to end.

---

Next: [`07-ongoing-maintenance.md`](07-ongoing-maintenance.md)
