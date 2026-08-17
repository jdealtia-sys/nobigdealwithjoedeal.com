# Next Session — after the designer-audit verification + fix wave (2026-08-15)

> Cold-start brief. Read repo-root [CLAUDE.md](../../CLAUDE.md) first. Full
> record: [audit/DESIGNER-AUDIT-VERIFICATION-2026-08-15](../audit/DESIGNER-AUDIT-VERIFICATION-2026-08-15.md).
> Previous handoff [NEXT_SESSION-2026-08-11](NEXT_SESSION-2026-08-11.md) still
> carries the loose-ends-audit context; WEEKLY_CADENCE remains the standing
> queue.

## What this session did (branch `claude/site-audit-review-izjmzj`)

Jo received an external "Designer Handoff" audit; we verified it
claim-by-claim (its #1 item — "no schema markup" — is false; 206/250 pages
carry JSON-LD), then Jo approved and we shipped the real gaps:

- **GA4 conversion events** (the actual biggest gap): central
  `generate_lead` in `docs/assets/js/public-lead-submit.js`, plus
  `estimate_phone_verified`, `visualizer_result`, and a new
  `tool_click` tracker on /free-tools (page previously had no GA4).
- **privacy.html**: Roof Score + OTP/SMS-verification data collection
  now disclosed; Last Updated bumped.
- **Homepage**: in-body Free Tools band after "How It Works" (hub was
  nav-chrome-only on the homepage).
- **review.html**: schema-policy comment corrected (Review JSON-LD is
  present by design; AggregateRating deliberately omitted).
- **Pro funnel plumbing**: quiet footer pro door extended to
  footer-standard/footer-area (142 pages restamped); free guide now
  linked from all pro blog surfaces (was only reachable from
  /pro/landing); "Masterclass" nav labels for the landing relabeled;
  /pro/sandbox noindexed (was indexable by accident).

## Jo actions

1. Review/merge the PR (#1202).
2. **Turnstile sitekey is still `""`** (`docs/assets/js/inline/7cd8e505ab.js`)
   — already queued in WEEKLY_CADENCE (order-of-operations item); the
   free-guide opt-in depends on the server not enforcing until then.
3. Decide: index `/sites/free-guide` (add to sitemap-pro + drop meta
   noindex) or keep it dark-social only. It's the top of the B2B funnel;
   currently noindexed by design.
4. In GA4, mark `generate_lead` as a key event (console-side, ~1 min).

## Next session candidates

1. **Visible Google review count on /review** — `getGoogleReviews`
   function already exists (rate-limited); needs a small external JS
   fetch + count line. Decide AggregateRating stance stays as-is.
2. **Location-page depth drip** — area pages are ~96% template (24/600
   lines unique). Add real neighborhoods/landmarks to top-traffic cities
   first (Cincinnati, Mason, West Chester); 2-3 pages per session.
   Storm-risk prose is already unique — don't touch it.
3. **Schema nice-to-haves**: HowTo on homepage "How It Works";
   Service/FAQPage on area pages (service-page siblings have them).
4. `drone-completed-brick.webp` (427KB — larger than its jpg siblings)
   recompress; verify `addressLocality: "Goshen"` hardcoded in all 25
   area pages' JSON-LD is intended (HQ) vs copy-paste.
5. Standing queue in [WEEKLY_CADENCE](WEEKLY_CADENCE.md) unchanged.

## Watch-outs

- The new homepage band + footer lines went through
  `apply-partials.js` restamp — footer edits belong in
  `site-src/partials/`, never in the stamped regions.
- `free-tools-clicks.js` relies on GA4's sendBeacon to survive
  navigation; if tool_click volumes look implausibly low vs pageviews,
  that's the first suspect.
- The pro blog remains deliberately noindexed (brand separation,
  firebase.json:221) — the free-guide links added there serve direct
  readers, not SEO. Don't "fix" the noindex without Jo's call on the
  bigger question (separate pro domain, Pillar 5).
