# Next Session — after the 2026-08-10/11 site-wide loose-ends & security audit

> Cold-start brief, written at session end. Self-contained. Read the repo-root
> [CLAUDE.md](../../CLAUDE.md) first. The full findings/fixes record is
> [audit/SITE-AUDIT-LOOSE-ENDS-2026-08-10](../audit/SITE-AUDIT-LOOSE-ENDS-2026-08-10.md).
> [NEXT_SESSION-2026-08-10](NEXT_SESSION-2026-08-10.md) still carries the
> jobs-board/posting-lane roadmap; [NEXT_SESSION-2026-08-07](NEXT_SESSION-2026-08-07.md)'s
> deferred queue is now MOSTLY absorbed here and into
> [WEEKLY_CADENCE](WEEKLY_CADENCE.md) — the standing checklist is current.

## What this session did (branch `claude/site-audit-loose-ends-xl91fj`)

Repo hygiene first: merged green dependabot #1196, closed issue #546 (was
done since 2026-07-02, never closed) — **tracker at zero**. Verified the
advisory-CI streak (3/10 — don't flip yet). Then a 7-lens audit (with
adversarial verification) and a fix wave — 10 commits. Highlights:

- **P0**: 3 published gallery JPEGs carried EXIF GPS (2 with full customer
  lat/lon). Stripped losslessly + NEW gate `scripts/check-image-privacy.js`
  in ci.yml and the CLAUDE.md pre-push list.
- **Money-path landmine**: /pro/stripe-success CSP blocked reCAPTCHA
  Enterprise → App Check token minting failed exactly for new paying
  customers. Fixed (mirrors /pro/register grants).
- **rate-limit-policy ADOPTED** (was 0-consumer dead code): guardHttp on
  claudeProxy (new per-IP backstop), adminAI, getGoogleReviews (was the ONLY
  unlimited public endpoint); guardCallable on validateAccessCode; cspReport
  advisory-limit bug fixed; ROUTES phantom/retired/drifted entries corrected;
  all cross-pinned by ~18 new smoke assertions.
- **Cost privacy**: EBv2's real per-SQ cost basis zeroed out of the public
  tree (tenant enters it in Settings now); xactimate catalog's 276 mat/lab
  costs caught by a widened sweep + tracked in KNOWN_UNMIGRATED; demo.js
  identities fictionalized; guard header no longer restates real figures.
- **Firestore rules**: #12 own-uid guard extended from 2 to 14 collections
  (member-hides-doc-from-rollup evasion). Emulator-verified locally (main
  suite green + cross-tenant 116/116).
- **CI**: firebase-deploy wholesale-failure guard (deploy exit code was
  never checked!); anti-orphan tripwire extended to smoke/, e2e specs,
  shard tags, and workflow presence; apply-partials dangling-marker guard
  (both directions, mutation-proven).
- **Dead surface**: 7 orphan inline JS files deleted, dead codemod deleted,
  theme-audit harness moved out of docs/, Ask-Joe sk-ant key-collection UI
  retired (no reachable consumer), dead markup/no-op handlers fixed,
  /pro/how-to "coming soon" promises reworded.

## Jo actions (new — full queue in WEEKLY_CADENCE)

1. Review/merge the audit PR from this branch.
2. **After deploy: re-enter cost basis in Estimate Settings** (3 fields,
   ~1 min) — Internal View margin shows "—" until then (device-saved
   settings carry over if you ever saved V2 settings).
3. Everything already queued (Turnstile order-of-operations, Swath secrets,
   visual-regression bless, …) is unchanged in WEEKLY_CADENCE.

## Next session candidates (ranked in WEEKLY_CADENCE backlog)

1. Phase-2 tenant-owned cost book (EBv2 CATALOG + xactimate — both pinned).
2. Dead-functions wire-or-retire (7 exports, list in the audit note).
3. Rules-test coverage for the untested branches + #12-guard cases.
4. Admin AI-usage endpoint (page currently labeled SAMPLE DATA).
5. Advisory-CI flip once the streak hits ~10 (3/10 now).

## Watch-outs

- The rules change tightens creates: a claim-carrying member stamping
  companyId=own-uid is now DENIED (was allowed). All shipped clients stamp
  `claims.companyId || uid` off the same token, so nothing legit breaks —
  but if a stale/cached client somehow stamps uid-with-claim, its create
  fails loudly. Watch Sentry/logs the first days after deploy.
- claudeProxy 429 body changed shape slightly (message text + code field;
  same {error} key). adminAI's uid rate counters restarted (namespace
  change — old scope embedded the uid).
- The image-privacy gate accepts the 4 no-GPS lumanail EXIF files; any new
  image under docs/assets/images/projects/ must be pipeline-clean or CI
  fails (that's the point).
- Sandbox notes from 2026-08-07 still hold (authed e2e can't run here;
  `npm install` not `npm ci` in tests/; scrub proxy env for emulator
  suites — the firestore-rules suites DO run locally that way).
