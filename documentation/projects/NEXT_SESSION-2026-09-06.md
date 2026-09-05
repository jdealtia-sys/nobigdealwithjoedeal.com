# Next session — brief as of the end of 2026-09-05

> Supersedes [NEXT_SESSION-2026-09-05](NEXT_SESSION-2026-09-05.md).
> Session record: [SESSION-2026-09-05-free-api-wave1](SESSION-2026-09-05-free-api-wave1.md)
> — the facts learned by measuring, the three refutations and the new
> watch-outs live there; this brief carries only what is still live.

## Start here

**Eight PRs merged (#1385–#1392); every one carries a new node-bucket suite
that was proven able to fail.** Free-API wave 1 is complete — all five rows
of [FREE-API-INTEGRATIONS-RESEARCH-2026-09-02](../audit/FREE-API-INTEGRATIONS-RESEARCH-2026-09-02.md)
— plus handoff items 3, 5 and 6 from the previous brief. Squash-merged:
verify by content in `origin/main`, not by ancestry.

**Nothing changes at run time until Jo flips a switch**, by design: Groq
dictation is live only because `GROQ_API_KEY` was already set; SWDI waits
on `NBD_HAIL_PROVIDER=swdi`; heartbeats no-op until
`HEALTHCHECKS_PING_KEY` is set; the consent widening only ever *allows* a
text on a document that carries `tcpaConsent === true`, and
`LEAD_ACK_SMS_ENABLED` is untouched.

## What shipped (2026-09-05)

| PR | | run-time effect today |
|---|---|---|
| #1385 | dictate on Groq free tier, Deepgram fallback | live (key was set) |
| #1386 | NCEI SWDI radar hail provider, 31-day chunking | dark until env switch |
| #1387 | Wayback slider fixed (never worked) + KY 3-inch D2D basemap + CSP hosts | live on next dashboard load |
| #1388 | NWS rain chip on Today's Schedule | live |
| #1389 | Healthchecks heartbeat from all 25 crons | no-op until secret set |
| #1390 | `__unset__` stub never passes as configured (17 files) | "not configured" paths instead of vendor calls with the literal |
| #1391 | GA4 on 174 landing pages | live after deploy |
| #1392 | three funnels persist TCPA consent; label says "text" | consent recorded on new inspect_leads from those forms |

## Do not rebuild on these — refuted 2026-09-05

1. **"Sentry DSN and Turnstile test truthiness."** FALSE — both gate on
   `hasSecret()`. The audit's four-function list was the accurate one; all
   four plus 21 more reads are now stub-safe (#1390), and
   `tests/secret-stub-guard.test.js` forbids the pattern repo-wide.
2. **"SWDI has no date-range cap."** FALSE — 744 hours per request, end date
   exclusive at midnight UTC. Corrected in the research note.
3. **"The 09-03 cancelled deploy runs are unexplained."** EXPLAINED — GitHub
   keeps one *pending* run per concurrency group; a rapid merge cancels the
   queued run and the newest carries everything. Verify the LAST deploy of
   a burst succeeded; the middle ones are supposed to cancel.

## Top of the list

1. **Google reviews still blank** — both Places secrets are `__unset__`.
   Only Jo can supply them (`firebase functions:secrets:set
   GOOGLE_PLACES_API_KEY`, then `NBD_PLACE_ID`). After #1390 the endpoint's
   error reads "not configured" instead of a failed Google call.
2. **Set `HEALTHCHECKS_PING_KEY` and create checks by slug** — ten minutes,
   [HEALTHCHECKS-SETUP](../runbooks/HEALTHCHECKS-SETUP.md). This is the fix
   for "`migrationsTick` cannot be alerted on as an absence": a check with a
   1-day period and 12 h grace on `migrations-tick`. Until the key is set
   nothing pings.
3. **Alerting — Jo's call**, unchanged: nine proven-deployable policies,
   zero live.
4. ~~**Find what rewrites 78 files under `functions/` during the node test
   bucket**~~ — **RESOLVED 2026-09-05** ([#1394](https://github.com/jdealtia-sys/nobigdealwithjoedeal.com/pull/1394)). It was never the test bucket: a
   clean-tree run and a 62-suite bisect both left `git status` at zero. The
   writer was this session's own `for f in functions/*.js; do sed -i …`
   sweep for #1389, three minutes before the bucket ran — Git Bash's sed
   rewrites every file LF-only, match or not, and with
   `core.autocrlf=true` git flags the size change without re-hashing.
   Mechanism, count reconciliation and the diagnose/clear commands:
   [GIT-PHANTOM-MODIFICATIONS-2026-09-05](../audit/GIT-PHANTOM-MODIFICATIONS-2026-09-05.md). The rule
   is now in CLAUDE.md. `git checkout -- <named paths>` does clear it;
   only `git checkout -- $(git diff --name-only)` cannot, because
   `git diff` never lists these files. The policy change that would retire
   the whole class is item 9.
5. **Wave 2 of the research note** — in the order the note ranks them:
   generic tokenized inbound-lead webhook (makes Zapier/Make/n8n a config
   task), Telegram alert bot, GA4 Data API + Search Console into the
   marketing report, the read-only `.ics` feed (bonus row; M), Geoapify
   autocomplete to replace the Nominatim typeahead the public funnels use
   against Nominatim's policy.
6. **Switch the hail cron to SWDI** once `hailMatchCron` has a week of
   real runs on record (it first scored leads on 2026-09-05; #1386 left it
   on its own fetcher on purpose, pinned by test).
7. **`/inspect` has no consent checkbox** — its `inspect_leads` are never
   texted. Adding the box is a conversion-form decision for Jo; T30 in
   `tests/tcpa-consent.test.js` will demand the payload change with it.
8. ~20 stale local branches remain squash-merged and deletable; the
   `nbd-wt-ledger-recon` worktree still holds `main`.

9. **Adopt a repo-wide LF policy — Jo's call, but the work is done.**
   `.gitattributes` carrying `* text=auto eol=lf` ends the line-ending class
   item 4 was about. Measured end to end on 2026-09-05 in a throwaway clone,
   never in a live checkout — full evidence in
   [GIT-PHANTOM-MODIFICATIONS-2026-09-05](../audit/GIT-PHANTOM-MODIFICATIONS-2026-09-05.md)
   §The LF policy, measured. **Recommendation: adopt, when the tree is quiet.**

   - **The commit is four files.** `git add --renormalize .` stages the policy
     plus the only three files carrying CRLF in the repo
     (`docs/assets/vendor/leaflet/leaflet.css`, `firestore.indexes.json`,
     `functions/stripe.js`). The index is already 99.9% LF — 1459 of 2264
     tracked files.
   - **Three drift gates stop lying.** `build-sitemap.js`, `build-feed.mjs`
     (CI-enforced) and `build-projects.mjs --check` exit 1 on *every* clean
     Windows checkout for line endings alone; on the migrated tree all three
     exit 0. Those are the only three fragile gates of the four that compare
     generated output to disk — `apply-partials.js --check` is already
     EOL-adaptive, which is why it alone passes today. No gate can newly fail:
     CI has always been the LF case. The node bucket is 60/60 on Windows + LF
     and no suite is EOL-sensitive.
   - **It repairs a file that is corrupt on disk today.** `docs/lead-magnet.pdf`
     contains no NUL byte at all, so git classifies it as *text* and autocrlf
     injects 716 CR bytes on checkout. Every Windows worktree holds a copy whose
     `startxref` lands inside a compressed stream instead of the cross-reference
     table. The shipped copy is fine — CI checks out LF — and most readers
     auto-repair a broken xref, so the user-visible impact may well be nil;
     what is certain is that the local copy of the lead magnet
     `docs/sites/free-guide/index.html` hands to customers is not the file that
     ships, and no one on Windows has been reviewing the real bytes. Nine
     tracked `.sh` files check out CRLF for the same reason.
   - **Generators become idempotent.** `build-projects.mjs --write` churns ten
     files on a CRLF tree and zero on an LF one. Not hypothetical:
     `docs/our-work.html` carries genuinely mixed endings in the main checkout
     right now. No script under `scripts/` preserves the input EOL and sixty
     call `writeFileSync`, so the CLAUDE.md `sed -i` rule closes one door of
     several.
   - **Almost nothing shipped changes.** The blobs are already LF and CI
     deploys from a Linux checkout, so Hosting serves the same bytes. No CSP
     hash, no SRI, no content-keyed cache, no checksum in any workflow. The one
     exception is `docs/assets/vendor/leaflet/leaflet.css`, the only file under
     `docs/` committed as CRLF: its served blob shrinks by 661 bytes, purely
     cosmetically. It is cached shell-first by `docs/pro/sw.js`, so pair the
     change with a `CACHE_VERSIONS.shell` bump if field byte-uniformity matters.

   **The caveat, stated plainly:** this inverts the failure rather than
   deleting it. On an LF tree a CRLF-writing tool produces the same
   ` M`-with-empty-diff signature. The common trigger becomes a no-op; the
   rare one (PowerShell `Out-File`) remains.

   **The order matters, and the obvious order is a trap.** Adding `*.pdf binary`
   in the *same* step as `git add --renormalize .`, run from a Windows worktree,
   stages the corrupt 64,283-byte PDF over today's valid 63,567-byte blob and
   ships a broken download to production. Verified. Do it in this order instead,
   each step checked:

   1. Land **only** `* text=auto eol=lf` together with its 3-file renormalize.
      With no binary overrides the renormalize is CR-only and safe to generate
      from a CRLF worktree.
   2. Refresh each checkout — commit or stash first, then
      `git rm --cached -r . && git reset --hard`, then restore. This destroys
      uncommitted *tracked* work; untracked files and `node_modules` survive.
   3. **Only once the worktree is LF**, add the `*.pdf`/image/font `binary`
      rules in a second commit. On a refreshed tree that commit stages nothing.

   Or sidestep the whole trap by generating the renormalize commit on Linux.
   Never force `text` on an extension: seven text-extension files here carry no
   line endings at all and `text=auto` correctly leaves them be.

   **A pull alone is a no-op, in both directions.** An existing Windows checkout
   that pulls the policy sees *zero* modified files — `text=auto` deliberately
   refuses to renormalize what was committed as CRLF, and a CRLF working file
   still cleans to the same blob. So there is no storm to fear, but no benefit
   either: the gates stay red until that checkout is refreshed, with nothing to
   signal why. Three checkouts need it independently
   (`C:/Users/jonat/nobigdealwithjoedeal.com`, `C:/Users/jonat/nbd-wt-ledger-recon`,
   any live session worktree) — they share one `.git` but each has its own index.
   A clone made *after* the policy lands gets the benefit for free. Rebase #1373
   (74 files) first, and pair the commit with a `.git-blame-ignore-revs`: it
   rewrites 8,269 lines, 5,278 of them in a payments file.

   **Landable today either way:** give `build-sitemap.js`, `build-feed.mjs` and
   `build-projects.mjs` the destination-EOL sniff `apply-partials.js` already
   uses. That fixes the three red gates on any checkout with zero blast radius,
   and it is the right move even if the policy is declined.

   **If declined,** record it in CLAUDE.md so the next session stops
   re-deriving the question, land the gate fix above, and re-encode the PDF as
   a one-off — the corrupt local copy is real regardless of the policy call.

## Watch tomorrow

- **The first Groq-transcribed dictations.** `[dictate] used fallback
  transcriber` in the logs means Groq failed and Deepgram carried it — a
  429 is the free tier saying slow down, not a bug.
- **GA4 Realtime** should show `/services/*` and `/areas/*` page_views for
  the first time.
- **`hailMatchCron` at 09:00 Central** — its second-ever real run.

## Watch-outs (new this session)

- **CRLF is everywhere under `docs/` and much of `functions/`.** `sed -i`
  rewrites them wholesale (stripe.js: 5,276-line no-op diff). Edit with
  Node, detect the EOL per file. Never inline JS through a bash heredoc —
  regex backslashes were stripped twice.
- **`handlers/_shared.js` ≠ `integrations/_shared.js`.** Same basename; a
  handler that adds a registry helper to its `require('./_shared')` loads
  fine and throws at call time. The guard test now checks import sources.
- **Adding a collection to `CONSENT_COLLECTIONS` fails T20 on purpose.**
  Re-pin it with the rationale; do not loosen the assertion.
- **`gh pr checks` output contains "✗" inside passing labels.** Test the
  exit code, not the glyph.
- **The deploy after #1389 binds a new secret to 25 functions**, which
  redeploys all 25 — the run took well over half an hour end to end.
  Expect a long deploy whenever a registry secret is added, and let the
  queue's cancellations of the middle runs stand.
