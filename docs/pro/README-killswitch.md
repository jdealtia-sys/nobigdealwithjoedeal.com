# Service-worker kill switch (E4)

Two independent ways to disable the Pro service worker in an emergency.

## Per-user (instant)

Send the user a URL like:

```
https://nobigdealwithjoedeal.com/pro/dashboard.html?nosw=1
```

**Corrected 2026-09-14** — this doc used to give `/pro/?nosw=1`. That URL
never worked: `/pro/index.html` loads none of the SW-registering scripts
at all (an anonymous visitor has no SW to kill), and a signed-in visitor
is bounced to `/pro/dashboard.html` via `window.location.replace(...)`
(`pro-index-auth-redirect.module.js`), which drops the query string —
so the kill-switch check on the destination page never even saw it.

`?nosw=1` is now checked in all three places `/pro/sw.js` gets
registered from, so any of these also work:
`/pro/dashboard.html?nosw=1`, `/pro/customer.html?nosw=1`,
`/pro/login.html?nosw=1` (all three load `offline-manager.js`), or any of
the static "simple" pages that load `pages/sw-register.js` (leaderboard,
diagnostic). Dashboard is still the one to hand out by default — it's
where most users land.

That query string triggers an unregister + cache flush on first page load. No deploy needed.

## Site-wide (next-reload)

Deploy a file to `docs/pro/nosw.txt` with any content (even empty).
Every one of the three registration sites above makes a
`HEAD /pro/nosw.txt` on every page load; a 200 OK means "kill SW" there
too. The file ships via the next hosting deploy and takes effect on the
user's next navigation, on every page.

```bash
echo "sw disabled $(date)" > docs/pro/nosw.txt
firebase deploy --only hosting
```

To re-enable SW site-wide:

```bash
git rm docs/pro/nosw.txt
firebase deploy --only hosting
```

After redeploy, the HEAD returns 404 and the bootstrap resumes normal SW registration.
