# 03 — App Check (20 min)

Goal: prove every request to your Cloud Functions came from your real website, not from a random script or curl.

**Why this matters:** every Cloud Function declares `enforceAppCheck: true`. Until you complete this file, they either (a) accept everything because enforcement isn't configured yet, or (b) reject every real user because the client hasn't been given a site key to mint tokens with. Either way, this step closes the loop.

## Step 1 — Register reCAPTCHA v3 (5 min)

1. Open https://www.google.com/recaptcha/admin/create
2. Sign in with the same Google account that owns Firebase.
3. Fill in:
   - **Label:** `NBD Pro`
   - **reCAPTCHA type:** `reCAPTCHA v3`
   - **Domains:**
     ```
     nobigdealwithjoedeal.com
     nobigdealwithjoedeal.com
     nbd-pro.web.app
     ```
   - Accept the terms.
4. Click **Submit**. You'll see two keys:
   - **Site key** (starts with `6Lc...`) — goes in the browser code. Not secret.
   - **Secret key** (also starts with `6Lc...`) — only used by Google server-side.

**Copy the Site key.** You'll paste it into a file in the next step.

## Step 2 — Register the App in Firebase App Check (5 min)

1. Open https://console.firebase.google.com → pick **nobigdeal-pro**.
2. Left sidebar → **Build** → **App Check**.
3. Click the **Web App** tab (there should be one app listed — something like "nbd-pro web").
4. Click the app, then **reCAPTCHA v3**.
5. Paste the **Site key** from Step 1.
6. Set the TTL to **1 day** (default).
7. Click **Save**.

## Step 3 — Paste the Site key into the code (3 min)

Open the file `docs/pro/dashboard.html` in your editor.

Find this line near the top:

```html
<script>window.__NBD_APP_CHECK_KEY = "";</script>
```

Paste the site key between the quotes:

```html
<script>window.__NBD_APP_CHECK_KEY = "6Lc...yourkey";</script>
```

Commit the change:

```bash
git add docs/pro/dashboard.html
git commit -m "chore(app-check): paste production site key"
git push
```

## Step 4 — Turn enforcement ON (5 min)

**Important:** only do this step AFTER Step 3 has been deployed. Otherwise your own browser will start getting rejected.

1. Firebase Console → App Check → **APIs** tab.
2. For each of these APIs, click it and flip **Enforcement** to ON:
   - **Cloud Functions**
   - **Cloud Firestore**
   - **Cloud Storage**

Firebase will show a warning like "unverified requests will be rejected." That's the goal.

## Step 5 — Smoke-test it

In a fresh browser window:

1. Open https://nobigdealwithjoedeal.com/pro/dashboard.html → sign in → open the Pipeline. Leads should load normally.
2. In a terminal:
   ```bash
   curl -X POST https://us-central1-nobigdeal-pro.cloudfunctions.net/claudeProxy \
     -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"hi"}]}'
   ```
   Should return `{"error":"Missing authorization token"}` or `401`. The fact that App Check didn't block it at this stage is fine — App Check only rejects when the call has a bad attestation token, not no token. Real browsers get validated automatically.

## If you paste the key but the app still says "App Check not configured"

- Hard-refresh the page (Cmd+Shift+R / Ctrl+Shift+R).
- If still broken, open the browser console and look for a red error mentioning "App Check" — usually it's a CSP issue. Our Hosting config already allows `google.com` + `recaptcha.net` in CSP, but confirm by checking **Network** tab → look for a failed request to `recaptchaenterprise.googleapis.com`.

## Done when

- reCAPTCHA v3 site key is registered in Google and Firebase.
- `docs/pro/dashboard.html` has the key pasted in the `__NBD_APP_CHECK_KEY` slot.
- Firebase Console → App Check → APIs shows **Enforced** next to Functions, Firestore, Storage.
- You can sign into the dashboard and load the Pipeline without a console error.

---

Next: [`04-rotate-access-codes.md`](04-rotate-access-codes.md)
