# Homeowner-site audit B–E — 2026-07-03

Four parallel read-only audits (SEO, performance, accessibility, conversion)
over all 202 homeowner pages, plus fixes shipped the same night. Legend:
✅ shipped tonight · ⏳ queued (verified real, not yet done) · 💬 needs Jo's call.

## ✅ Shipped tonight (the HIGH / critical items)

- **Homepage fabricated testimonials removed** — index.html was the last page
  still rendering invented named reviews (David H./Linda R./Tom M.) under a
  hardcoded score; replaced with the live Google widget (matches /review).
- **Real 5.0 Google rating restored** — verified via Jo's managed Business
  Profile screenshot (5.0, 26 reviews). review.html + index.html now show a
  real "5.0 · Verified on Google" linking to the profile; kept OUT of
  aggregateRating schema (self-serving = ineligible for rich snippets).
- **Orphaned review schema removed** — aggregateRating(5.0/47) + embedded
  Review objects stripped from index.html + review.html JSON-LD (Google policy).
- **Pledge over-promise softened** — 25 area pages no longer say workmanship is
  fixed "no questions asked" (contradicted the-pledge page); now conditional on
  written warranty, matching the canonical voice.
- **Estimate funnel keyboard-operable (WCAG 2.1.1, was completion-blocking)** —
  15 choice tiles are now role=button/tabindex/aria-pressed with Enter/Space
  activation. Playwright-verified.
- **Sticky mobile call/text bar site-wide** — was homepage-only; now on 197
  pages (shared /assets/css/mobile-cta.css). The single biggest lead lift.
- **iOS input-zoom fix** — 16px inputs on the 7 form pages (no more Safari
  zoom on the fields that convert).
- **Accessible names on storm-check/storm-report inputs** (WCAG 1.3.1/4.1.2).
- Star badges (homepage/our-work) now link to /review.

## ⏳ Queued — SEO (lane B), all verified real

- Trailing-slash canonical/sitemap mismatch on `/areas`, `/blog`, `/free-roof`
  (canonicals + sitemap point at redirecting URLs). LOW, clean fix.
- `/inspect` is a true orphan (0 inbound links, sitemap priority 0.9) — link it
  from nav/CTA set alongside /estimate, /storm-check. MED.
- 16 titles >60 chars, 50 meta descriptions >160 chars — SERP truncation. Trim
  the worst (fire-water-smoke-damage desc = 204). MED, tedious.
- 7 images missing width/height (visualizer, estimate, gaf-timberline, lumanail,
  roofivent, the-nbd-build) — CLS. LOW.
- `/services/financing` missing BreadcrumbList (every sibling has one). LOW.
- ~~h2→h4 skip in the shared footer heading (~190 pages) — one template edit.
  LOW.~~ ✅ STALE (verified 2026-08-05): every shared-footer column title
  site-wide is already `<h2 class="footer-col-title">`; the only h4 footer
  survivor was the hand-authored oaks.html, deleted by #1166. Residue: the CSS
  still styles the legacy `footer h4` selector — harmless.
- Thin-blog interlinking (field-notes, gaf-timberline-vs-tamko, etc.). LOW.

## ⏳ Queued — Accessibility (lane D), verified real

- **Skip-links absent site-wide** — the audit found 0 pages have a skip link and
  `<main>` has no id (an earlier pass claimed to add these; it didn't land).
  Add `<a class="skip-link" href="#main">` + `id="main"`. Site-wide codemod. MED.
- Estimate: real fields lack `required`/`aria-required`; error `<div>`s aren't
  `aria-live`/`aria-describedby`/`aria-invalid`. MED.
- Visualizer pills/swatches keyboard-inoperable (same class of bug as the
  estimate tiles just fixed). MED — apply the same role=button + keydown pattern.
- storm-check `sc-tile` groups + estimate tiles: add `role=group`/`radiogroup`
  with accessible group names (aria-pressed on tiles now done). LOW-MED.
- Contrast fails: placeholder `rgba(255,255,255,.25)` on navy (2.2:1), muted
  tile text on navy (3.0:1), `--gray #6b7280` on off-white (4.36:1), `#f08030`
  as text on white (2.68:1 — swap to #B85400). Raise alphas / darken. MED.
- `:focus-visible` weak on storm-alerts/visualizer/storm-report. LOW.
- `prefers-reduced-motion` unhandled on 5 animated pages. LOW.

## ⏳ Queued / 💬 Decisions — Conversion (lane E)

- 💬 **Money pages have no on-page form** — service/area pages bounce "Get My
  Free Estimate" to the homepage `/#contact`, losing page context. Add a short
  embedded form OR pass service/city as URL params that pre-fill the homepage
  form. HIGH value, bigger build — worth doing, needs a design nod.
- 💬 **Estimator gates the price behind SMS-OTP** — heavy friction; recommend
  showing the estimate on name+phone and making OTP optional + a "just have Joe
  call me" escape hatch. MED-HIGH. Product decision.
- Hero CTA overload on hail/area pages (4 stacked buttons on mobile) — trim to
  1 primary + 1 secondary. MED.
- Homepage contact form: merge First+Last, make "Service" optional (2 fewer
  required fields). LOW-MED.

## Performance (lane C) — note
Static recon of the money pages was reassuring: 57–67 KB HTML, images mostly
have dimensions (the 7 exceptions are in lane B above), fonts preloaded on the
homepage, no render-blocking surprises. The highest-impact perf item is the
same width/height gap (CLS) already listed under B. A full Lighthouse pass can
be run if Jo wants Core Web Vitals numbers, but no glaring perf debt surfaced.

## Verified clean (no action)
Alt text 0 missing (291 imgs); duplicate titles/descriptions 0; JSON-LD 0
invalid; NAP consistent; robots.txt + sitemap correct; one h1 per page; no
div/span onclick; nav dropdowns keyboard-reachable; FAQ accordions
runtime-accessible; the 4 primary lead forms (homepage/inspect/storm-alerts/
free-roof) fully labeled.
