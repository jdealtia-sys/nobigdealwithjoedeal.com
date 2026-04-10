# Archived JS Modules

These modules were orphaned — they existed in `docs/pro/js/` but were never loaded by any HTML page. The code audit (session 2026-04-10) identified them as dead code that was confusing the architecture.

## Archived files (32)

### Truly dead — no HTML references
- `academy-admin.js` — academy admin panel (never wired)
- `academy-courses.js` — course content (replaced by real-deal-academy.js)
- `academy-insurance-tree.js` — insurance process tree (218KB)
- `academy-retail-tree.js` — retail process tree
- `advanced_builder_selector.js` — advanced estimate builder selector
- `advanced_builder_ui.js` — advanced estimate builder UI (40KB)
- `advanced_pdf_generator.js` — jsPDF-based advanced PDF (replaced by browser print)
- `ai_review_system.js` — AI code review utility
- `company-admin.js` — company admin panel
- `company-admin-usage-example.js` — usage example
- `crew-calendar.js` — crew scheduling calendar
- `daily-tracker.js` — daily tracker (replaced by daily-success/)
- `email-drip.js` — email drip campaign manager
- `estimate-templates.js` — estimate template library
- `material-calculator.js` — material calculator
- `material_catalog.js` — material catalog
- `nbd-auth-enhancement.js` — auth enhancement overlay
- `nbd-comms.js` — unified email/SMS comms module
- `onboarding.js` — onboarding wizard (45KB, dead — DOM was never built)
- `perf-monitor.js` — performance monitoring
- `pricing_database_manager.js` — pricing DB manager
- `push-notifications.js` — push notification handler
- `report-export.js` — report export utility
- `reporting-dashboard.js` — reporting dashboard
- `script-loader.js` — lazy script loader (never used — all scripts are in HTML tags)
- `storm-alerts.js` — storm alerts (replaced by storm-center.js)
- `stripe-billing.js` — Stripe billing UI (replaced by Cloud Function)
- `supplier-pricing.js` — supplier pricing database
- `template_library.js` — document template library
- `theme-builder.js` — theme builder UI
- `theme-gx-panel.js` — theme GX control panel

### Architecturally orphaned
- `crm-leads.js` — was at `/pro/crm-leads.js` (wrong path, never imported)

## Why archived instead of deleted?
Preserving the code in case any feature is revived later. These files can be:
1. Deleted entirely if confirmed never-needed
2. Moved back to `js/` and script tags added to load them
3. Refactored into other modules

## Do NOT load these files
They are not production code. If you need a feature from one of these, review the code first, then move it back properly.
