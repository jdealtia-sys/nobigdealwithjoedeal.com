# NBD Pro — Engineering Knowledge Base

Map of content for the `documentation/` corpus (~115 files) plus the other places engineering truth lives in this repo. Built as the home note for an **Obsidian vault opened at the repo root** — every link below is a plain relative path, so it works identically on GitHub.

> **Vault setup (one time):** Obsidian → Open folder as vault → this repo. Then Settings → Files & Links → set **Excluded files** to `.claude/worktrees, node_modules, docs, tests/node_modules, functions/node_modules` (`.claude/worktrees` contains a full duplicate of this tree; `docs/` is the hosting root, not notes). `.obsidian/` is gitignored — your workspace config stays local.

---

## Standing notes — open these weekly

- [WEEKLY_CADENCE](projects/WEEKLY_CADENCE.md) — the Monday-morning checklist: Jo's weekly content/marketing loop, the agent weekly sweep, and the consolidated one-off queue (sessions keep it current)
- [BIG_ROCKS](projects/BIG_ROCKS.md) — the standing priority list
- Current handoff: [NEXT_SESSION-2026-08-17](projects/NEXT_SESSION-2026-08-17.md)
- Posting a job: [runbooks/PUBLISH-PROJECT](runbooks/PUBLISH-PROJECT.md) — phone-paste template inside

## Start here

- [../CLAUDE.md](../CLAUDE.md) — session ground rules incl. the vault-logging convention (deep audits → dated notes here)
- [ARCHITECTURE](ARCHITECTURE.md) — system overview
- [QUICK_START](QUICK_START.md) — orientation for a new session
- [../SECURITY.md](../SECURITY.md) — public security posture (repo root)
- [../functions/FUNCTIONS_INDEX.md](../functions/FUNCTIONS_INDEX.md) — canonical Cloud Functions taxonomy (CI-enforced)

## Architecture & product

- [MULTI-TENANT-ARCHITECTURE](architecture/MULTI-TENANT-ARCHITECTURE.md)
- [NBD-PRO-PRODUCT-AUDIT-2026-07](architecture/NBD-PRO-PRODUCT-AUDIT-2026-07.md)
- [RAILWAY-EVAL-2026-08](architecture/RAILWAY-EVAL-2026-08.md) — Railway hosting evaluated and deferred (trigger conditions inside)
- Pillar plans: [1 — Provisioning](architecture/PILLAR1-PROVISIONING-PLAN.md) · [4 — Billing](architecture/PILLAR4-BILLING-PLAN.md) · [5 — Domains & Sites](architecture/PILLAR5-DOMAINS-SITES-PLAN.md)
- [THUMBTACK-WEBHOOK-2026-08](architecture/THUMBTACK-WEBHOOK-2026-08.md) — marketplace lead/message/review ingest; LIVE in prod since 2026-08-16, real leads flowing
- [EMAIL-INGEST-2026-08](architecture/EMAIL-INGEST-2026-08.md) — business-mailbox → CRM lane (IMAP poller, Junk coverage, attach-vs-create matching); SCOPED 2026-08-17, not built

## Runbooks (ops — read before touching prod)

- [ALERT_RESPONSE](runbooks/ALERT_RESPONSE.md)
- [ROLLBACK](runbooks/ROLLBACK.md)
- [RESTORE_FROM_BACKUP](runbooks/RESTORE_FROM_BACKUP.md)
- [SECRET_ROTATION](runbooks/SECRET_ROTATION.md) — linked from the admin integrationStatus readout
- [SPEND_KILLSWITCH](runbooks/SPEND_KILLSWITCH.md)
- [ONBOARD_TENANT](runbooks/ONBOARD_TENANT.md)
- [TENANT-CUSTOM-DOMAINS](runbooks/TENANT-CUSTOM-DOMAINS.md)
- [VISUALIZER-KIE-PROVIDER](runbooks/VISUALIZER-KIE-PROVIDER.md) — flip image-gen to kie.ai (config-only, Jo action)
- [SWATH-SETUP](runbooks/SWATH-SETUP.md) — Swath API (storm-verified property intel): signup, secrets, coverage monitor, provider flags, credit model (Jo action)
- [PUBLISH-PROJECT](runbooks/PUBLISH-PROJECT.md) — add a Featured Project to /our-work (prices, photos, consent rules)

## Projects & planning

- [BIG_ROCKS](projects/BIG_ROCKS.md) — the standing priority list
- [WEEKLY_CADENCE](projects/WEEKLY_CADENCE.md) — standing weekly checklist (see "Standing notes" above)
- [KANBAN_CUSTOMER_MAP](projects/KANBAN_CUSTOMER_MAP.md)
- Session handoffs: [NEXT_SESSION-2026-08-17](projects/NEXT_SESSION-2026-08-17.md) (current — start here; backlinks/AEO rush: Jo's off-site sprint + post-merge sweep + AirOps lane) · [SESSION-2026-08-17-photos-followups](projects/SESSION-2026-08-17-photos-followups.md) (d2d knock photos wired to WebP variants incl. two race-heal fixes, digest orphan watch, --include-legacy sweep) · [SESSION-2026-08-17-deploy-list-drift-and-verification](projects/SESSION-2026-08-17-deploy-list-drift-and-verification.md) (auto-deploy silently excluded ALL onObjectFinalized functions — onAudioUploaded had never deployed; fixed #1210, photos-variants lane closed with prod verification) · [SESSION-2026-08-17-backlinks-aeo-rush](projects/SESSION-2026-08-17-backlinks-aeo-rush.md) (Reader Questions posts + FAQ schema wave + RSS/IndexNow + rush-week kit, PR #1205) · [SESSION-2026-08-17-icloud-mail-sweep](projects/SESSION-2026-08-17-icloud-mail-sweep.md) (iCloud mailbox sweep: 5 stalled-money customer replies drafted to Drive kit, 9 CRM records enriched, email-ingest lane proposed) · [NEXT_SESSION-2026-08-16](projects/NEXT_SESSION-2026-08-16.md) (lead-data/CRM-load/channel-rebalance session: Thumbtack webhook live, CRM = system of record, Jo action queue — Stripe key roll + Aug 24 budget deadline inside) · [SESSION-2026-08-16-photos-variants-backfill](projects/SESSION-2026-08-16-photos-variants-backfill.md) (§2.2 backfill script for legacy photos: storagePath repair + direct WebP variant generation — apply executed, convergence verified 2026-08-17: 71/71 stamped) · [SESSION-2026-08-16-image-pipeline-nested-shapes](projects/SESSION-2026-08-16-image-pipeline-nested-shapes.md) (WebP-variant pipeline now accepts nested photos/{uid}/... upload shapes; upload-surface inventory + backfill follow-ups inside) · [NEXT_SESSION-2026-08-15](projects/NEXT_SESSION-2026-08-15.md) (designer-audit verification + GA4/privacy/pro-funnel fix wave, PR #1202) · [SESSION-2026-08-13-american-operator-badge](projects/SESSION-2026-08-13-american-operator-badge.md) (Locally Owned & Operated cert badge rollout — footers site-wide + homepage card + About chip) · [NEXT_SESSION-2026-08-11](projects/NEXT_SESSION-2026-08-11.md) (site-wide audit + security fix wave — engineering lanes still open) · [NEXT_SESSION-2026-08-10](projects/NEXT_SESSION-2026-08-10.md) (jobs-board taxonomy + hub strips + posting flow) · [NEXT_SESSION-2026-08-07](projects/NEXT_SESSION-2026-08-07.md) (deferred queue — mostly absorbed into WEEKLY_CADENCE 2026-08-11) · [SESSION-2026-08-06-swath-api-setup](projects/SESSION-2026-08-06-swath-api-setup.md) (Swath API integration — Jo's 5-min secrets to-do inside) · [NEXT_SESSION-2026-08-06](projects/NEXT_SESSION-2026-08-06.md) · [SESSION-2026-08-06-our-work-featured-projects](projects/SESSION-2026-08-06-our-work-featured-projects.md) · [NEXT_SESSION-2026-08-05](projects/NEXT_SESSION-2026-08-05.md) · [NEXT_SESSION](projects/NEXT_SESSION.md) · [NEXT_SESSION-2c4a](projects/NEXT_SESSION-2c4a.md) (all executed)

## Audits

- [ICON-CASCADE-REGRESSION-2026-08-17](audit/ICON-CASCADE-REGRESSION-2026-08-17.md) — invisible orange icon chips on the homepage (nbd-icons.css end-of-head link out-cascaded the per-page white-icon fix, #1194 regression) + nav-base CSS missing on 18 hand-built pages (dropdown splatter on /the-pledge etc.; new ensure-nav-css.js gate) (newest)
- [DESIGNER-AUDIT-VERIFICATION-2026-08-15](audit/DESIGNER-AUDIT-VERIFICATION-2026-08-15.md) — claim-by-claim verification of the external designer-handoff audit: schema claim false, real gaps are conversion analytics / privacy tool-disclosure / area-page sameness; pro-visibility take
- [SITE-AUDIT-LOOSE-ENDS-2026-08-10](audit/SITE-AUDIT-LOOSE-ENDS-2026-08-10.md) — site-wide loose-ends & security audit + fix wave: EXIF-GPS P0, rate-limit adoption, rules #12 extension, CI hardening
- [SYSTEM-STABILITY-PERF-2026-08-07](audit/SYSTEM-STABILITY-PERF-2026-08-07.md) — full-system stability/perf/accuracy audit + fix wave
- [AUDIT_REPORT](audit/AUDIT_REPORT.md) · [LIVE_VERIFICATION](audit/LIVE_VERIFICATION.md)
- [OPS_AUDIT_2026-06](audit/OPS_AUDIT_2026-06.md) · [PROD_HOMEWORK_VERIFICATION_2026-07](audit/PROD_HOMEWORK_VERIFICATION_2026-07.md)
- Themes: [THEME_SYSTEM_AUDIT_2026-06](audit/THEME_SYSTEM_AUDIT_2026-06.md) · [THEME_PHASE3_DURABILITY](audit/THEME_PHASE3_DURABILITY.md)

## Brand, marketing & rebrand

- [VOICE_BIBLE](brand/VOICE_BIBLE.md) — the writing voice for every customer-facing word
- [drafts/README](drafts/README.md) — the blog-draft pipeline (3 drafts awaiting Jo's `JO:` marker edits; one publish session each)
- [rush-week-2026-08](marketing/rush-week-2026-08.md) — the sequenced off-site placement sprint (baseline, manufacturer claims, Bing/IndexNow, pitch templates, Reader Questions pipeline) — **work from this one**
- [local-seo-playbook-2026-07](marketing/local-seo-playbook-2026-07.md) · [citation-kit-2026-07](marketing/citation-kit-2026-07.md) — strategy + paste-ready copy (both carry 2026-08-17 addenda)
- [gaf-tamko-rebrand-plan](rebrand/gaf-tamko-rebrand-plan.md) · [gaf-tamko-BUILD-BRIEF](rebrand/gaf-tamko-BUILD-BRIEF.md)

## QA sweeps (dated campaign folders)

Standalone reports: [tenant-lifecycle-audit-2026-07](qa/tenant-lifecycle-audit-2026-07.md) · [homeowner-content-audit-2026-07](qa/homeowner-content-audit-2026-07.md) · [homeowner-consistency-audit-2026-07-15](qa/homeowner-consistency-audit-2026-07-15.md) · [homeowner-site-audit-B-C-D-E-2026-07](qa/homeowner-site-audit-B-C-D-E-2026-07.md)

Campaign folders (each has its own STATUS / BUG-LOG / CLEANUP):

- [brand-sweep-2026-06-07](qa/brand-sweep-2026-06-07/STATUS.md)
- [theme-sweep-2026-06-07](qa/theme-sweep-2026-06-07/BUG-LOG.md)
- [live-qa-2026-06-07](qa/live-qa-2026-06-07/STATUS-MATRIX.md)
- [estimate-qa-2026-06-08](qa/estimate-qa-2026-06-08/SUMMARY.md) → [remediation-2026-06-09](qa/remediation-2026-06-09/REMEDIATION-LOG.md) → [estimate-remediation-2026-06-09](qa/estimate-remediation-2026-06-09/VERIFICATION.md)
- [cd-session-2026-06-08](qa/cd-session-2026-06-08/STATUS.md) · [verify-sweep-2026-06-09](qa/verify-sweep-2026-06-09/CLEANUP.md)
- [static-audit-2026-06-10](qa/static-audit-2026-06-10/README.md)
- [homeowner-sweep-2026-06-11](qa/homeowner-sweep-2026-06-11/STATUS.md)
- [untested-surface-drive-2026-06-22](qa/untested-surface-drive-2026-06-22/FINDINGS.md)
- [exhaustive-sweep](qa/exhaustive-sweep/COVERAGE-SUMMARY.md)
- [seo-hardening-2026-07](qa/seo-hardening-2026-07/REVISED-PLAN.md) — includes [MANUAL-FOR-JO](qa/seo-hardening-2026-07/MANUAL-FOR-JO.md)

## Dev notes elsewhere in the repo

- [../docs/dev/](../docs/dev/) — CRM internals: [dashboard-decomposition-plan](../docs/dev/dashboard-decomposition-plan.md) · [globals-decomposition-HANDOFF](../docs/dev/globals-decomposition-HANDOFF.md) · [dashboard-actions-globals-audit](../docs/dev/dashboard-actions-globals-audit.md) · [estimate-engines-audit](../docs/dev/estimate-engines-audit.md) · [crm-responsive-map](../docs/dev/crm-responsive-map.md) · [csp-generated-docs-audit](../docs/dev/csp-generated-docs-audit.md) · [rock-4-handoff](../docs/dev/rock-4-handoff.md)
- [../monitoring/README.md](../monitoring/README.md) · [../scripts/README.md](../scripts/README.md) · [../tests/e2e/README.md](../tests/e2e/README.md) · [../tests/visual/README.md](../tests/visual/README.md)
- Functions-adjacent: [NPM_AUDIT_ACCEPTED](../functions/NPM_AUDIT_ACCEPTED.md) · [SEAT_BILLING_ACTIVATION](../functions/SEAT_BILLING_ACTIVATION.md) · [SEED_COMPANIES_README](../functions/SEED_COMPANIES_README.md) · [google-reviews.README](../functions/google-reviews.README.md)

## Archive (historical — do not action)

- [WAVES](archive/WAVES.md) — the original wave log
- [archive/legacy/](archive/legacy/README.md) — pre-multi-tenant era docs (12 files), kept for context only

---

*Maintenance: when a new doc lands in `documentation/`, add it to the matching section here. This file is a navigation aid, not a registry — no CI enforcement.*
