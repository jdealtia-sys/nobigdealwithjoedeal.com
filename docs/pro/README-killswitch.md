# Service-worker kill switch (E4)

Two independent ways to disable the Pro service worker in an emergency.

## Per-user (instant)

Send the user a URL like:

```
https://nobigdealwithjoedeal.com/pro/?nosw=1
```

That query string triggers an unregister + cache flush on first page load. No deploy needed.

## Site-wide (next-reload)

Deploy a file to `docs/pro/nosw.txt` with any content (even empty).
The bootstrap code makes a `HEAD /pro/nosw.txt` on every page load;
a 200 OK means "kill SW". The file ships via the next hosting deploy
and takes effect on the user's next navigation.

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
