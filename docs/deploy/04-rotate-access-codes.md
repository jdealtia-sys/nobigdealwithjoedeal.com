# 04 — Rotate access codes (5 min)

Goal: invalidate the old hardcoded `NBD-2026` access code (and siblings) and mint fresh, random ones.

**Why:** The code `NBD-2026` was hardcoded into the shipped HTML before the security sprint. Anyone who ever viewed source could use it to mint a free Growth-plan account. The security audit fixed the HTML and deactivated the code on rotate — but you still have to actually run the rotate.

## Two tiny steps

### Step A — Disable the legacy codes via the dashboard

1. Sign in to the dashboard with your platform-admin account (the one whose user doc has the `admin` custom claim — Joe's main account).
2. Open **Team Manager** from the left sidebar.
3. Click the **🔐 Rotate Access Codes** button in the top-right of the page.
4. Confirm the prompt.

A toast will tell you how many legacy codes got deactivated. If it says "No legacy codes to rotate" → they're already off, nothing to do.

### Step B — Mint new codes from your laptop

```bash
cd /path/to/nobigdealwithjoedeal.com
export GOOGLE_APPLICATION_CREDENTIALS=~/.nbd/nobigdeal-pro-sa.json
BETA_COUNT=5 DEMO_COUNT=2 node scripts/seed-access-codes.js
```

You'll see output like:

```
✗ deactivated legacy code NBD-2026
✗ deactivated legacy code DEAL-2026
...
=============================================
 NEW ACCESS CODES — COPY NOW, NOT RECOVERABLE
=============================================

 NBD-7K3M4X2P9L    beta  expires in 90d
 NBD-A8B5C9D3EF    beta  expires in 90d
 ...
 DEMO-QR3S5T8U9V   demo  expires in 14d
 ...
```

**Copy these into your password manager (1Password, Bitwarden, or a sealed note in Notion). The script prints them ONCE and they are not recoverable.**

If `$GOOGLE_APPLICATION_CREDENTIALS` isn't set yet:

1. Firebase Console → Project Settings → Service Accounts.
2. **Generate new private key** → download the JSON.
3. Move it somewhere safe: `mkdir -p ~/.nbd && mv ~/Downloads/nobigdeal-pro-*.json ~/.nbd/nobigdeal-pro-sa.json`
4. Set the env var as shown above.

This service-account JSON is the same thing you'd use for the GitHub Action auto-deploy (see `docs/deploy/08-followups.md`). Treat it like a password — if it leaks, anyone can admin your Firebase project.

## Done when

- Team Manager toast confirms the rotate succeeded (or "nothing to rotate").
- You have 5 beta codes + 2 demo codes copied somewhere safe.
- Old codes (`NBD-2026`, `NBD-DEMO`, `TRYIT`, `DEAL-2026`, `ROOFCON26`, `NBD-STORM`) no longer work when someone tries to sign up with them — try one on the login page; you should see "Code not recognized."

---

Next: [`05-optional-integrations.md`](05-optional-integrations.md)
