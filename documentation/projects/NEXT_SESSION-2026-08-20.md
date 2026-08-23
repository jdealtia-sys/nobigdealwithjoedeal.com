# NEXT SESSION — 2026-08-20

Handoff from the 2026-08-19 evening session. **Nothing is mid-flight.** Every branch is
pushed, every PR merged, every deploy succeeded, and production is verified.

---

## Start here

Two lanes closed on 2026-08-19, both merged and deployed:

- **[SESSION-2026-08-19-oaks-microsite-rebuild](SESSION-2026-08-19-oaks-microsite-rebuild.md)**
  — Scott's site rebuilt from archived PDFs. §8b is the final live state; §4g is the
  post-launch regressions and, more usefully, the false-green pattern behind them.
- **PR #1263**, the 83-finding design & brand consistency sweep, merged as `d99caa88`.
  Its `check-chrome-governance.js` now runs on main and closes the gate hole that let
  22 marketing pages sit outside every chrome check for three months.

## The one action still outstanding, and it is Jo's

**Send Scott the current Oaks zip.** An earlier bundle was handed over *before* the fixes
and must not be the one that ships — it carries the stretched footer logo, a fabricated
`aggregateRating reviewCount:13`, a form that serialises the customer's name/email/phone
into the URL when JS is unavailable, and no 404 page. Rebuild from
`docs/sites/oaks/` with `7z a -tzip -mx=9 out.zip .` (7-Zip, **not** PowerShell
`Compress-Archive` — PS 5.1 writes backslash entry names that extract as literal filenames
off Windows).

## Open, none blocking

1. **Oaks launch checklist.** When Scott points his own domain at it, **three things drop
   together or none of them works**: the two `/sites/oaks` `X-Robots-Tag` rules in
   `firebase.json`, the `<meta name="robots">` in all 11 pages, and the
   `Disallow: /sites/oaks/` lines in `docs/robots.txt`. The Disallow currently stops
   crawlers *fetching* the pages, so removing only the meta tag achieves nothing. Also
   uncomment `canonical` / `og:url` / `og:image` and make `og:image` **absolute**.
2. **`/sites/oaks/home` is a preview-only URL.** It exists because a directory index served
   at a slash-less URL breaks relative paths. Scott's own host serves `index.html` at his
   domain root and needs none of it — see [[cleanurls-directory-index-relative-paths]],
   which now records all three failed attempts.
3. **More gallery photos.** Nine is thin for a roofer; the archived PDFs held no more.
   `docs/sites/oaks/README.md` tells him how to add them (760×570 thumb + full).
4. **`/sites/t/oaks` still 301s to `/sites/oaks`.** The universal tenant template is
   untouched and still correct for tenant #3+; Oaks simply no longer uses it.

## The thing worth carrying forward

Two production bugs shipped in this session, both from **reasoning about Firebase URL
semantics instead of exercising them**, and three more defects were sitting in output my
own tooling had already printed. The standing rules that came out of it:

- **Never validate hosting behaviour by reading config.** Deploy to a preview channel and
  *follow* the redirects: `npx firebase-tools hosting:channel:deploy <name> --project
  nobigdeal-pro --expires 1d`, then `curl -sIL --max-redirs 5`. Header checks pass on a
  looping site because headers only ever show ONE hop.
- **Assert the outcome, not the precondition.** "The background is inert" is not "the
  buttons work"; "the selector matched" is not "the contrast passes". Every check should
  perform the user's action. Verify a new assertion FAILS against the broken build before
  trusting it.
- `scripts/verify-deploy.sh` now follows redirects to a real 200 and checks the Oaks 404.
- `qc-render-sweep` is CI-only and **absent from CLAUDE.md's pre-push list**, yet it is the
  only gate that can compute a rendered style. Run it for any page-heavy change:
  `npx http-server docs -p 5000 -c-1 --silent &` then
  `node scripts/qc-render-sweep.js --base http://localhost:5000` (~4 min).

## Housekeeping

- `C:\Users\jonat\nbd-wt-oaks` is a leftover worktree from this session on a merged branch.
  Safe to remove: `git worktree remove C:/Users/jonat/nbd-wt-oaks` — unlink
  `functions/node_modules` (a junction) first.
- ~60 local branches carry unpushed commits from earlier sessions. Pre-existing, unrelated
  to this work, and untouched here.
