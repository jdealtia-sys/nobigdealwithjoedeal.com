# 09 — Hosting cutover: GitHub Pages → Firebase

**Status:** Ready to execute. Pre-flight verified 2026-04-25.

The public domain `nobigdealwithjoedeal.com` currently serves from GitHub
Pages (`build_type: legacy`, source = `main:/docs`). GitHub Pages ignores
every header in `firebase.json`, so the Referrer-Policy / Permissions-Policy
/ COOP / CORP / CSP / X-Frame-Options / X-Content-Type-Options work from
PRs #28–#42 is dead code on the live domain.

The Firebase deploy at `nobigdeal-pro.web.app` already serves the same
content with all headers applied. This runbook flips DNS so the public
domain inherits that work.

> **Risk class: LOW.** No app code changes. Rollback = revert DNS.
> **Time:** ~60 min agent + 30 min Joe (DNS edit + cert wait).

---

## 0. Pre-flight verification (do NOT skip)

Run these before touching DNS. All four must pass.

```bash
# 0.1 — Live domain is GitHub Pages today
curl -sI https://nobigdealwithjoedeal.com | grep -i "^server"
# Expect: Server: GitHub.com

# 0.2 — Firebase mirror is live with headers
curl -sI https://nobigdeal-pro.web.app/pro/js/ai.js | grep -iE "^(referrer-policy|x-content-type-options)"
# Expect both headers present.

# 0.3 — Pages build_type is legacy (DNS, not workflow)
gh api repos/jdealtia-sys/nobigdealwithjoedeal.com/pages | grep build_type
# Expect: "build_type":"legacy"

# 0.4 — Firebase deploy is wired and the secret is set
gh api repos/jdealtia-sys/nobigdealwithjoedeal.com/actions/secrets \
  | grep -o '"name":"FIREBASE_SERVICE_ACCOUNT"'
# Expect a match. (Without the secret, the workflow would be skipping
# every push and main:/docs on Firebase would be stale.)
```

If any of those fail, STOP and resolve before continuing.

---

## 1. Add custom domains in Firebase Console

Joe action.

1. Open <https://console.firebase.google.com/project/nobigdeal-pro/hosting/main>
2. Click **Add custom domain**
3. Enter `nobigdealwithjoedeal.com` → **Continue**
4. Firebase shows a TXT record for ownership verification. Copy it.
5. **Do NOT click "Verify" yet** — finish step 2 first so both domains
   verify in one DNS pass.
6. Click **Add custom domain** again, enter `www.nobigdealwithjoedeal.com`
7. Copy the second TXT record.

Keep the Firebase Console tab open. You'll come back to it after DNS
propagates.

---

## 2. Add ownership-verification TXT records at the registrar

Joe action. Registrar = whichever DNS provider currently hosts
`nobigdealwithjoedeal.com` (likely Cloudflare or GoDaddy — check by running
`dig +short ns nobigdealwithjoedeal.com`).

For each domain:

| Type | Name | Value | TTL |
|---|---|---|---|
| TXT | `@` (apex) | (TXT value from Firebase step 1.4) | 300 |
| TXT | `www` | (TXT value from Firebase step 1.7) | 300 |

Wait 5–10 minutes for propagation, then back in Firebase Console click
**Verify** on each row. Both should turn green.

---

## 3. Replace A/AAAA records (THE actual cutover)

Once verification is green, Firebase issues four A records (and IPv6 AAAA
records). It will look like this in the Firebase UI:

```
A    @     151.101.x.x
A    @     151.101.y.y
AAAA @     2a04:4e42:...
AAAA @     2a04:4e42:...
```

(Firebase's IPs change over time — use whatever the Console shows,
not the values in this doc.)

At the registrar, **REMOVE the GitHub Pages records:**

```
A    @     185.199.108.153
A    @     185.199.109.153
A    @     185.199.110.153
A    @     185.199.111.153
AAAA @     2606:50c0:8000::153
AAAA @     2606:50c0:8001::153
AAAA @     2606:50c0:8002::153
AAAA @     2606:50c0:8003::153
CNAME www  jdealtia-sys.github.io
```

And **ADD the Firebase records** (apex + AAAA + CNAME for www):

```
A     @    (from Firebase Console)
A     @    (from Firebase Console)
AAAA  @    (from Firebase Console)
AAAA  @    (from Firebase Console)
CNAME www  nobigdeal-pro.web.app.
```

> If the registrar is **Cloudflare**, leave the orange-cloud proxy ON
> — it works fine with Firebase Hosting and gives you Cloudflare's WAF
> on top. Set SSL/TLS mode to **Full (strict)** to require Firebase's
> Let's Encrypt cert end-to-end.

TTL: 300 (5 min) for the cutover. Bump back to 3600+ once stable.

---

## 4. Wait for SSL provisioning

Firebase issues a Let's Encrypt cert automatically once it sees the new A
records resolve. **Takes 15–60 minutes.** During this window the site
will return cert errors — the same domain is briefly served by both
Firebase (no cert yet) and GitHub Pages (still answering on its IPs from
DNS cache). Pick a low-traffic window for the swap.

Watch the Firebase Console "Status" column. It progresses
`Pending → Setting up → Connected`.

You can also monitor from the command line:

```bash
# Loop until Firebase serves the live domain with a valid cert
until curl -sI https://nobigdealwithjoedeal.com 2>/dev/null \
      | grep -qi "^vary: x-fh-requested-host"; do
  echo "Still on GitHub Pages or no cert yet — retry in 60s"
  sleep 60
done
echo "✓ Firebase is now answering with a valid cert."
```

---

## 5. Disable GitHub Pages

Once SSL is connected and you've confirmed the site is healthy on
Firebase, stop GitHub Pages from continuing to serve:

```bash
# Disable Pages via the GitHub API
gh api -X DELETE repos/jdealtia-sys/nobigdealwithjoedeal.com/pages

# Verify
gh api repos/jdealtia-sys/nobigdealwithjoedeal.com/pages 2>&1 | head -3
# Expect 404 — Pages is off.
```

Or via the UI: Repo → Settings → Pages → Source = **None**.

---

## 6. Remove the Pages CNAME marker

`docs/CNAME` exists for GitHub Pages domain mapping. Firebase ignores it,
so it's harmless, but removing it documents the cutover. Open a follow-up
PR:

```bash
git rm docs/CNAME
git commit -m "chore(hosting): remove GitHub Pages CNAME marker — Firebase serves live domain now"
```

Don't bundle this into the cutover PR — keep it as a separate post-cutover
PR so any rollback step doesn't have to revert it.

---

## 7. Post-cutover verification

```bash
# 7.1 — Server header is now Google, not GitHub
curl -sI https://nobigdealwithjoedeal.com | grep -iE "^(vary|x-served-by|x-cache)"
# Expect: Vary: x-fh-requested-host (Firebase signature)
# Should NOT see: Server: GitHub.com

# 7.2 — Security headers present on HTML
curl -sI https://nobigdealwithjoedeal.com/ | grep -iE \
  "^(referrer-policy|x-content-type-options|content-security-policy|x-frame-options|strict-transport-security|permissions-policy)"
# Expect: all six.

# 7.3 — Security headers present on JS assets
curl -sI https://nobigdealwithjoedeal.com/pro/js/ai.js | grep -iE \
  "^(referrer-policy|x-content-type-options|cache-control)"
# Expect: all three.

# 7.4 — _legacy/ remains 404 (it's outside docs/, was 404 on Pages too)
curl -sI https://nobigdealwithjoedeal.com/_legacy/POST_DEPLOY_CHECKLIST.md | head -1
# Expect: HTTP/1.1 404

# 7.5 — Cloud Functions reachable through hosting rewrites
curl -sI https://nobigdealwithjoedeal.com/api/google-reviews | head -3
# Expect: 200 or 4xx (function-level), not 404 (would mean rewrite broken).

# 7.6 — All 31 smoke tests still pass
cd tests && npm test
# Expect: 31 passed, 0 failed.
```

If any check fails, see Rollback below.

---

## 8. Rollback

If the cutover goes sideways:

1. **Revert DNS at the registrar** to the GitHub Pages records listed in
   Step 3. Keep the Firebase records around as commented backup.
2. **Re-enable GitHub Pages** (only needed if Step 5 already ran):
   ```bash
   gh api -X POST repos/jdealtia-sys/nobigdealwithjoedeal.com/pages \
     -f source[branch]=main -f source[path]=/docs
   ```
3. Wait 5–15 min for DNS to converge.
4. Open a postmortem issue with the failing curl from Step 7.

The Firebase deploy at `nobigdeal-pro.web.app` keeps working through all
of this — no app downtime, just a domain-routing question.

---

## Known limitations (file as follow-ups, not blockers)

1. **Path-specific CSP overrides in `firebase.json`** (login, register,
   stripe-success, etc.) target patterns like `/pro/login.html`. Since
   `cleanUrls: true` rewrites incoming requests to `/pro/login`, those
   overrides currently never fire — pages get the default CSP from the
   `**` block, which is more permissive. Tightening is a follow-up:
   either change every path-specific source to match the cleanUrl form
   (`/pro/login` instead of `/pro/login.html`) or both.

2. **`docs/dev/`** ignore in `firebase.json` was added as a defense in
   depth back when GitHub Pages might have served it. Pages-as-source =
   `main:/docs` so any `.md` under `docs/dev/*` was technically public.
   With Firebase + `dev/**` ignored at deploy, those files now stay
   private. No action needed; just verify §7.4 works.

3. **Service worker (`sw.js`)** is at `docs/sw.js`. Cache-Control on
   service workers should be `no-cache` so updates roll out fast — current
   `firebase.json` doesn't set it. Worth a separate small PR if/when
   service-worker bugs surface.

---

## Files touched by the pre-flight PR

- `docs/deploy/09-hosting-cutover.md` (this file)
- `firebase.json` — change `**/*.html` source to `**` so security headers
  match cleanUrl-rewritten request paths, not just file-extension paths

That's it. No app code, no Firestore rules, no Functions changes.
