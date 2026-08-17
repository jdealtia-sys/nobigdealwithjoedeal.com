# Tenant-lifecycle security & correctness audit — 2026-07-03

Three parallel adversarial audits of everything shipped this week (self-serve
provisioning, onboarding wizard, team invites, company billing, tenant
microsites, Settings surfaces). Every finding below was verified against the
code by hand before classification — auditors flag plausible-but-wrong bugs,
so unconfirmed items are marked.

## FIXED this round (PR: tenant-lifecycle hardening)

| # | Sev | What | Fix |
|---|-----|------|-----|
| P1 | HIGH | `submitPublicLead` lowercased the `companyId` tag; `companies/{id}` is keyed by the case-sensitive Firebase uid, so every real tenant's microsite lead misrouted to Joe instead of the tenant. Never caught because the only prior caller (Oaks) used the lowercase literal `'oaks'`. | integrations.js: case-preserving `^[A-Za-z0-9_-]{1,64}$` validation (matches public-site KEY_RE); legacy `'oaks'` still works. |
| C1 | HIGH | The **Save Address** button (microsite slug) was a silent no-op — `_saveSiteSlug` was never added to `_NBD_CALL_ALLOWLIST`, so the delegate dropped it. Whole feature inoperative. | dashboard-state.js: allowlist entry added. |
| C2 | HIGH | `createCompany`'s profile seed used `set()` without merge. The onboarding wizard writes the brand, THEN calls createCompany as a self-heal — so the recovery path wiped everything the tenant just configured. | provisioning.js: seed is `set(..., {merge:true})` — additive, still no NBD values. |
| CL3 | MED-HIGH | `claimInvite` hardcoded `plan:'growth'` into the merged claims, clobbering a paid solo owner's real plan claim. (Post-Pillar-4 the plan claim is telemetry-only, but the clobber still violated merge-don't-replace + mislabeled Sentry.) | invites.js: drop `plan` from the claim; billing resolves from `subscriptions/{companyId}`. |
| P2 | MED-HIGH | `setSiteSlug` uniqueness was check-then-write on different company docs → two owners could claim the same slug (no write-write conflict). | Transactional `siteSlugs/{slug}` claim doc (racers contend on the same doc; loser fails). Admin-SDK-only, explicit deny rule added. |
| C3 | MED | Onboarding wizard always wrote `brand.colors` (a color input always has a value), pinning the default `#E8720C` — NBD's own orange — as an explicit override on every tenant (M1 violation). | onboarding.js: `colorsTouched` flag; colors omitted unless a swatch is changed; re-run prefill preserves prior colors. |
| C4 | MED | `claimInvite` client hook set the `nbd_invite_checked` flags BEFORE `getIdToken(true)`; a refresh failure stranded the rep in stale solo scope for ~1h with the re-check blocked. | dashboard-bootstrap.js: refresh first, then set flags + reload. |
| P4 | MED | `getPublicSiteConfig` error responses (404/429/500) inherited the global `**` `max-age=300` header → a cached 429 = a 5-min per-edge tenant-site blackout. | public-site.js: `Cache-Control: no-store` up front; 200 path re-sets its cacheable value. |
| P7 | LOW | `colors.*` weren't hex-validated server-side; `colors.secondary` was served but never applied. | public-site.js: `hex()` validator; dropped unused `secondary`. |

## DEFERRED — needs its own focused PR + rules-test coverage

These are real but require transactional callables and careful re-enable-flow
handling; batching them with the above would bloat the diff and the risk.

- **CL1 / C6 — claims not cleared on remove — ✅ FIXED (follow-up PR).**
  New `removeMember` callable (functions/handlers/admin.js) strips the
  member's `companyId`/`role` claims (merge-preserving billing) and revokes
  their tokens BEFORE deleting the roster doc; the team tab's Cancel/Remove
  now route through it instead of a client `deleteDoc`. firestore.rules
  members block is now fully server-mediated: `create/update/delete: if
  isAdmin()` — clients can't write member docs at all, so the bypass is
  closed at the rules layer too. Stripping the claim also makes a removed
  user correctly un-reactivatable without a fresh invite. Rules tests updated
  (owner client member writes now DENIED; admin-SDK path unaffected).
  NOTE: `deactivateUser` (temporary Disable) deliberately keeps the claim so
  Reactivate works; its revoke+disable already blocks a disabled user from
  minting a new token. The inherent ≤1h existing-ID-token window on disable
  is standard Firebase and unchanged — closing it fully would require
  claim-gating every rule (out of scope).
- **CL4 — `createTeamInvite` seat check is TOCTOU (MED) — ACCEPTED, won't fix.**
  Count-check-write isn't atomic; two invites for distinct emails fired in the
  same ~100ms window can both pass a 5-seat gate → 6 seats. A transaction alone
  can't fix it (the two writes hit different member docs, so no write-write
  conflict; a query read doesn't lock phantom inserts). The only correct fix is
  a maintained `companies/{id}.seatCount` incremented in a transaction — but
  that counter must be kept in lockstep across createTeamInvite (+1),
  deactivateUser (−1 / +1), and removeMember (−1), plus a backfill. A drifted
  counter fails the WRONG way: it wrongly BLOCKS legitimate invites, which is
  worse than the bug it fixes. Given the impact (a tenant one seat over their
  OWN cap via a deliberate race; rate-limited 30/hr; not a security/data
  issue), the counter's cost + drift risk exceed the benefit. Documented and
  accepted.
- **CL5 — re-invite delete+recreate races claimInvite (MED) — ✅ FIXED.**
  invites.js: the re-invite delete is now transaction-guarded — it re-reads the
  member doc inside a txn and aborts if a concurrent `claimInvite` flipped it to
  `active` (so a just-joined teammate can't be demoted back to `invited` and
  have their seat re-consumed). The recreate stays a separate `set()` so the
  `teamInviteEmail` onDocumentCreated resend trigger still fires.
- **CL6 — re-inviting a `deactivated` member doesn't re-enable Auth (MED) — ✅ FIXED.**
  invites.js: createTeamInvite now refuses a re-invite when the member is
  `deactivated` (their Auth is disabled — a fresh `invited` row would be
  unclaimable and stuck) and directs the owner to the Re-enable action instead.

## FLAGGED for Jo — pre-existing or product/architectural calls (not fixed)

- **P3 — `submitPublicLead` App Check is a no-op (MED, pre-existing) —
  ✅ RESOLVED 2026-08-02 (#1170).** The dead `enforceAppCheck` option was
  removed repo-wide from `onRequest` handlers and the real gate hardened;
  `tests/appcheck-onrequest-contract.test.js` (wired into CI 2026-08-05)
  keeps the no-op config from coming back. The gateway's stated posture is
  now per-IP rate limit + Turnstile-when-configured + honeypot + field
  allowlist + CORS origin allowlist.
- **P5 — slug lookup discloses the tenant's Firebase uid (LOW) —
  ✅ RESOLVED 2026-08-06 (indirection, per Jo).** `getPublicSiteConfig` now
  returns `siteKey` (the slug when configured) instead of `companyId`; the
  template tags leads with it and `submitPublicLead` resolves it server-side
  through the same exported `resolveCompanyByKey` the config endpoint uses
  (doc id OR slug, active-status check) — the resolved id, never the client
  string, is what persists. Strictly harder than the legacy client-companyId
  tag (which stays for cached pages but loses to a resolved siteKey): a
  suspended tenant now stops resolving at the gateway too. A slug-less
  tenant is reachable only by uid URL, so echoing the caller's own key
  discloses nothing new. Pinned by the siteKey block in
  `tests/public-intake.test.js`.
- **P6 — honeypot named `website` can be autofilled by browsers (LOW) —
  ✅ FIXED 2026-08-05.** The coordinated pass landed: every emitter
  (quick-lead-form.js ×153 pages, tenant microsite, free-roof, free-guide ×2,
  homepage) renames the honeypot to `nbd_hp` / `fieldNbdHp`, and the gateway
  (`functions/handlers/integrations.js`) checks BOTH `nbd_hp` and the legacy
  `website` key indefinitely — new pages no longer render an input named
  `website`, so autofill can't populate what isn't there, while bots replaying
  the old shape still trip. Pinned by
  `tests/honeypot-autofill-contract.test.js` (chain + smoke CI) and the
  both-keys cases in `tests/public-intake.test.js`.
- **P8 — tenant sites shipped NBD's favicon (LOW) — ✅ FIXED (favicon).**
  docs/sites/t/ now ships a neutral slate house-glyph favicon
  (`site-icon.svg`) instead of NBD's `/favicon.svg`, closing the browser-tab
  brand bleed. The roofing-trade FALLBACK_SERVICES are intentionally kept —
  NBD PRO is a roofing-focused platform, so roofing defaults are appropriate
  for an unconfigured tenant.
- **CL8 — legacy `sendTeamInviteEmail` + `invites/{token}` collection (LOW) —
  ✅ RESOLVED 2026-08-06 (#1190).** The dead endpoint (zero callers anywhere in
  docs/, tests/, or workflows) was deleted along with its pre-claims role
  vocabulary — the lingering `'owner'` refs lived inside it (the
  prospects.js / ai-texting-persona.js files named here no longer exist under
  those names). The `invites/{token}` deny-all rule stays as an annotated
  tombstone over historical docs; the live flow remains the `createTeamInvite`
  callable. Prod deletion deployed cleanly in run #1274.

## Verified clean (no action)

`buildPublicConfig` whitelist (no alert/integrations/pricing/legal leak, object
guards defeat prototype tricks, logoUrl https-anchored); site.js rendering
(all textContent/.src/.value — zero innerHTML, XSS-probed); submitPublicLead
`contact`-kind allowlist matches the template payload; CSP (no inline
scripts/handlers in the new pages); escaping via `_nbdEscHtml`; no dead element
ids; `purgeAccountStorage` KEEP set; `INVITE_ALLOWED_ROLES` fail-down (invite
can't mint `admin`); claimInvite verified-email + platform-admin + foreign-company
guards; no reload loop in the claimInvite hook.
