# 08 — Follow-ups (deferred work)

Everything in this PR is shippable today. These are the things I **didn't** do, ordered by impact, so you know what's queued for future sprints.

## Security follow-ups

### H-1 — Inline onclick migration

**Status:** ~500 inline `onclick=` handlers across dashboard.html.
**Why it matters:** until they're gone, the CSP keeps `'unsafe-inline'` in `script-src`. One XSS anywhere can execute arbitrary JS with full user privileges.
**Effort:** 2-3 focused days. Every `onclick="foo(...)"` becomes a `data-action="foo"` + a delegated listener. Template already exists (V2 Builder does it this way).

### Enable Firebase Auth email-enumeration protection

**What:** stops attackers from checking if an email is signed up by probing the reset-password flow.
**How:** Firebase Console → Authentication → Settings → **User Actions** → flip ON **Email enumeration protection**.
**Time:** 30 seconds.

### Turn on Firebase Auth MFA for admins

**What:** platform-admin accounts should require TOTP.
**How:** Firebase Console → Authentication → Sign-in Method → **Multi-factor authentication** → enable TOTP. Then in Team Manager, each admin enrolls a device.
**Time:** 5 minutes.

## Feature follow-ups

### Gmail OAuth send-on-behalf

**What:** reps send estimates from **their own Gmail**, not from Resend. Deliverability jumps ~30%.
**Why deferred:** needs a real OAuth consent dance + refresh-token storage + domain verification. It's a standalone sprint, not a drop-in add.
**When to start:** once you have >10 active reps and deliverability is a measurable issue.

### Full-text lead search

**What:** type "Smith" in a search box → find every lead with that name / address / note.
**Why deferred:** product question — do we host our own (lunr.js in browser, 100k lead ceiling) or pay for Algolia ($50/month)?

### Commission tracker

**What:** per-rep `commissions/{uid}` doc summing % on signed estimates.
**Why deferred:** business decision on commission structure varies per company.

### Photo storage migration to signed URLs

**Status:** DONE (R-03, 2026-04-15). `imageProxy` was retired and replaced
by a 410 Gone stub. Every in-repo caller migrated to `window.NBDSignedUrl`
(docs/pro/js/signed-image-url.js) which wraps `POST /signImageUrl`.
Photo-editor is the only known caller and is live on customer.html.
The stub is safe to delete outright after 7+ days of zero calls in
Cloud Logging.

### Call recording / voice memo playback

**What:** currently Deepgram transcribes but discards audio. Option: save the MP3 alongside the transcript in `docs/{uid}/voice-memos/`.
**Effort:** 1 day.
**When to do:** once reps ask for it — or when you need deal-review tapes.

### Real-time rep presence indicators

**What:** green dot next to each rep in the Team Manager showing if they're online.
**Effort:** half a day with Firebase Realtime Database `.info/connected`.
**Priority:** low — cosmetic.

## Infrastructure follow-ups

### Move hosting from GitHub Pages to Firebase Hosting

**Status:** `firebase.json` is already configured — you just haven't used the hosting deploy yet.
**Why:** GitHub Pages can't set arbitrary response headers (CSP, HSTS). Firebase Hosting can.
**Effort:** 10 minutes; just run `firebase deploy --only hosting`. Then update the DNS CNAME in Cloudflare (or wherever).

### Uptime monitoring

**What:** an external probe hits `/submitPublicLead` every 5 minutes. If it 500s twice, page on-call.
**Recommended:** UptimeRobot (free), Better Uptime, or StatusCake.
**Effort:** 15 minutes signup.

### Sentry Performance monitoring

**Status:** already wired (part 05.1). Default `tracesSampleRate: 0.1` means 10% of requests are tracked.
**Next step:** once you're confident, bump to 1.0 during slow hours to catch the long-tail latency spikes.

## How to pick up a followup

1. Create a GitHub issue titled after the followup (e.g. "H-1: inline onclick migration").
2. Reference this doc in the issue body.
3. Open a branch: `git checkout -b claude/h1-inline-onclick` (or whatever).
4. When ready, open a PR. The template in `.github/pull_request_template.md` enforces a security self-check.

---

Index: [`../../GO_LIVE_CHECKLIST.md`](../../GO_LIVE_CHECKLIST.md)
