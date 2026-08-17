================================================================================
NBD PRO CRM - MULTI-TENANT ARCHITECTURE
================================================================================

Last updated: 2026-07-05 (post-merge refresh: PRs #839/#840/#841 + the
functions dependency majors).
Added in this pass (2026-07-05) — new sections at the end of this doc:
  - BILLING, PLANS & TRIALS: canonical plan keys (free/starter/growth/
    enterprise) with permanent read-boundary aliases for the legacy
    vocabulary; access-code lifecycle (atomic redemption, read-time trial
    expiry, single-writer trialEndsAt); the dashboard's requiredPlan:'free'
    gate; Stripe trial countdown from currentPeriodEnd.
  - TESTING & CI: 16 hermetic authed E2E journeys (incl. the signup funnel itself) on emulators.
  - DASHBOARD SHELL (ROCK 4): Phases 1-5 complete, ~6,080 lines, zero
    inline onclick handlers.
  - DATA MIGRATIONS, PUBLIC B2B SURFACE & SEO, OPS & DEPENDENCY BASELINE.
Previous pass (2026-07-04, June ops-audit item 7 refresh):
  - Cloud Functions summary aligned to functions/index.js; the maintained
    per-function catalog is functions/FUNCTIONS_INDEX.md.
  - The claim that notifyNewLead (functions/verify-functions.js) does
    per-company routing was removed — it never shipped that way; tenant
    alert routing lives in functions/lead-alert.js.
  - companyId-scoped Firestore rules enforcement is LIVE (firestore.rules),
    no longer a planned "Phase 2".
  - Single-tenant-era claims updated for the shipped Pillar 1-5 work:
    createCompany self-serve provisioning, team invites, company-level
    billing, tenant microsites at /sites/t/<slug>.
Note: module names inside the ASCII diagrams below (company-admin.js,
nbd-auth-enhancement.js, window._companyId = 'nbd') are historical design
sketches — see the corrected notes inside each section for what shipped.

SYSTEM OVERVIEW
================================================================================

┌─────────────────────────────────────────────────────────────────────────────┐
│                        NBD PRO CRM - MULTI-TENANT SYSTEM                    │
│                    Multiple Companies, One CRM Platform                     │
└─────────────────────────────────────────────────────────────────────────────┘

                          ┌──────────────────────┐
                          │   Web Browser/App    │
                          │   (Company User)     │
                          └──────────────────────┘
                                    │
                   ┌────────────────┼────────────────┐
                   │                │                │
          ┌────────▼─────────┐      │      ┌────────▼─────────┐
          │  Load company-   │      │      │  Load nbd-auth   │
          │  admin.js        │      │      │  enhancement.js  │
          └────────┬─────────┘      │      └────────┬─────────┘
                   │                │                │
                   └────────────────┼────────────────┘
                                    │
                    ┌───────────────▼────────────────┐
                    │   firebase.auth().onAuthStateChanged()   │
                    │   Initialize Company ID from User Doc    │
                    └───────────────┬────────────────┘
                                    │
                    ┌───────────────▼────────────────┐
                    │  window._companyId = 'nbd'     │
                    │  window._companyConfig = {...} │
                    └───────────────┬────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
     ┌──────▼──────┐         ┌──────▼──────┐         ┌──────▼──────┐
     │  Load from  │         │  Apply      │         │  Render UI  │
     │  Firestore  │         │  Branding   │         │  with Data  │
     │  companies/ │         │  to DOM     │         │  from DB    │
     │  {id}       │         │  (colors,   │         │  (filtered  │
     │             │         │   logo,     │         │   by co.)   │
     └──────┬──────┘         │   name)     │         └──────┬──────┘
            │                └──────┬──────┘                │
            │                       │                       │
            └───────────────────────┼───────────────────────┘
                                    │
                    ┌───────────────▼────────────────┐
                    │  User sees company branding    │
                    │  User creates leads/estimates  │
                    │  All tagged with companyId     │
                    └───────────────┬────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
     ┌──────▼──────────┐    ┌──────▼──────────┐    ┌──────▼──────┐
     │   Create Lead   │    │   notifyNewLead │    │  Query Data │
     │   + companyId   │    │   + companyId   │    │  where      │
     │                 │    │                 │    │  companyId  │
     │  → Firestore    │    │  → Look up co.  │    │  == current │
     └─────────────────┘    │  → Send to co.  │    └─────────────┘
                            │    owner phone  │
                            │    + email      │
                            └─────────────────┘


COMPONENT ARCHITECTURE
================================================================================

┌──────────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND COMPONENTS                                │
└──────────────────────────────────────────────────────────────────────────────┘

  [CORRECTED 2026-07-04] The two module boxes below describe a design that
  was never shipped: pro/js/company-admin.js and pro/js/nbd-auth-enhancement.js
  do not exist in the repo. As built:
    - docs/pro/js/nbd-auth.js reads the Firebase Auth custom claims on login;
      a user's tenant is claims.companyId || uid (a solo owner's uid IS the
      companyId their invited members carry). Subscription lookups key
      subscriptions/{companyId || uid} (company-level billing, Pillar 4).
    - docs/pro/js/company-profile.js loads/saves per-tenant config from
      companyProfile/{companyId} into window._companyProfile (branding,
      contacts, document constants).
    - There is no client-side fallback to the 'nbd' tenant; a missing claim
      resolves to the caller's own uid.
  The boxes are retained for historical context only.

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                        COMPANY ADMIN MODULE                             │
  │           (pro/js/company-admin.js — NOT SHIPPED, see note above)       │
  │─────────────────────────────────────────────────────────────────────────│
  │                                                                          │
  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐    │
  │  │ getCompanyConfig │  │ applyBranding    │  │ getCurrentCompany│    │
  │  │ (companyId)      │  │ (config)         │  │ (user)           │    │
  │  │                  │  │                  │  │                  │    │
  │  │ → Firestore      │  │ → CSS vars       │  │ → User doc       │    │
  │  │ → Cache          │  │ → DOM elements   │  │ → getCompanyId   │    │
  │  └──────────────────┘  └──────────────────┘  └──────────────────┘    │
  │                                                                          │
  │  ┌──────────────────┐  ┌──────────────────┐                           │
  │  │ getCompanyId()   │  │ setCurrentCompany│                           │
  │  │                  │  │ (admin)          │                           │
  │  │ → window._id     │  │ → Switch context │                           │
  │  └──────────────────┘  └──────────────────┘                           │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                    NBD AUTH ENHANCEMENT MODULE                          │
  │      (pro/js/nbd-auth-enhancement.js — NOT SHIPPED, see note above)     │
  │─────────────────────────────────────────────────────────────────────────│
  │                                                                          │
  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐    │
  │  │ initializeCompany│  │ getCompanyId     │  │ setCompanyId     │    │
  │  │ Id()             │  │ ()               │  │ (companyId)      │    │
  │  │                  │  │                  │  │                  │    │
  │  │ → Read user doc  │  │ → Return window  │  │ → Set window     │    │
  │  │ → Set global var │  │   ._companyId    │  │   ._companyId    │    │
  │  │ → Fallback 'nbd' │  │                  │  │                  │    │
  │  └──────────────────┘  └──────────────────┘  └──────────────────┘    │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────────────┐
│                        BACKEND/DATABASE COMPONENTS                           │
└──────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                         FIRESTORE COLLECTIONS                           │
  │─────────────────────────────────────────────────────────────────────────│
  │                                                                          │
  │  ┌─────────────────────────────┐  ┌──────────────────────────────┐   │
  │  │  companies/{companyId}      │  │  users/{uid}                 │   │
  │  │  ─────────────────────────  │  │  ───────────────────────────  │   │
  │  │  • id: 'nbd', 'oaks'        │  │  • email: '...'              │   │
  │  │  • name: 'Company Name'     │  │  • companyId: 'nbd' [NEW]    │   │
  │  │  • owner: 'Name'            │  │  • role: 'admin'             │   │
  │  │  • phone: '(555) 555-5555'  │  │  • name: '...'               │   │
  │  │  • email: '...'             │  │  • ...                       │   │
  │  │  • address: '...'           │  │                              │   │
  │  │  • logo: null or URL        │  │  Link via companyId ─────────────┤
  │  │  • colors:                  │  │                              │   │
  │  │    - primary: '#0066cc'     │  │                              │   │
  │  │    - accent: '#ff6600'      │  │                              │   │
  │  │    - navBg: '#003366'       │  │                              │   │
  │  │  • services: [...]          │  │                              │   │
  │  │  • serviceAreas: [...]      │  │                              │   │
  │  │  • warranty: '...'          │  │                              │   │
  │  │  • subscription: {...}      │  │                              │   │
  │  │  • createdAt: Timestamp     │  │                              │   │
  │  │  • siteUrl: '/sites/...'    │  │                              │   │
  │  └─────────────────────────────┘  └──────────────────────────────┘   │
  │                                                                          │
  │  ┌─────────────────────────────┐  ┌──────────────────────────────┐   │
  │  │  leads/{leadId}             │  │  estimates/{estId}           │   │
  │  │  ─────────────────────────  │  │  ──────────────────────────   │   │
  │  │  • name: 'Customer'         │  │  • estimateId: '...'         │   │
  │  │  • phone: '...'             │  │  • leadId: '...'             │   │
  │  │  • email: '...'             │  │  • companyId: 'nbd' [NEW]    │   │
  │  │  • service: '...'           │  │  • companyId: 'nbd' [NEW]    │   │
  │  │  • companyId: 'nbd' [NEW]   │  │  • amount: 5000              │   │
  │  │  • status: 'new'            │  │  • status: 'draft'           │   │
  │  │  • createdAt: Timestamp     │  │  • createdAt: Timestamp      │   │
  │  │  • ...                      │  │  • ...                       │   │
  │  └─────────────────────────────┘  └──────────────────────────────┘   │
  │                                                                          │
  │  All data collections carry companyId; tenant scoping is ENFORCED by   │
  │  firestore.rules (live — see SECURITY & ISOLATION below). Companies    │
  │  are created self-serve via the createCompany callable; a company's    │
  │  siteSlug field drives its tenant microsite at /sites/t/<slug>.        │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                    DATABASE SEEDING SCRIPT                              │
  │           (functions/seed-companies.js - 123 lines)                     │
  │─────────────────────────────────────────────────────────────────────────│
  │                                                                          │
  │  Setup: set GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json            │
  │  Run:   node seed-companies.js                                          │
  │                                                                          │
  │  Creates:                                                               │
  │  • companies/nbd → No Big Deal Home Solutions                           │
  │  • companies/oaks → Oaks Roofing & Construction                        │
  │                                                                          │
  │  Status: Executable, ready to run                                       │
  │                                                                          │
  │  [2026-07-04] Dev/bootstrap tool only. Production companies are        │
  │  provisioned self-serve via the createCompany callable                 │
  │  (functions/handlers/provisioning.js); team members join via           │
  │  createTeamInvite / claimInvite (functions/handlers/invites.js).       │
  │                                                                          │
  └──────────────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────────────┐
│                      CLOUD FUNCTIONS INTEGRATION                             │
└──────────────────────────────────────────────────────────────────────────────┘

  [Updated 2026-07-04]

  functions/index.js is the single deploy entrypoint. As of 2026-07-04 it
  exports 148 deployed Cloud Function endpoints (onCall / onRequest /
  Firestore + Storage triggers / scheduled crons), plus a handful of
  test-only helper exports (underscore-prefixed and push/Slack helpers).
  The per-function catalog — with the admin/rep/public/background
  classification and the auth gate each category requires — is maintained
  in functions/FUNCTIONS_INDEX.md. That file is canonical; keep it updated
  rather than duplicating the list here.

  Lead notification routing (correcting an earlier version of this doc):

  - notifyNewLead (functions/verify-functions.js) IS deployed, but it is
    NBD-only: the OTP-verified estimate-funnel notifier that always alerts
    Joe's phone/email. It takes NO companyId parameter and does no
    per-tenant lookup — the company-routing behavior this section used to
    describe was never shipped in that function.

  - Tenant-scoped alerts are handled by the leadAlert* Firestore triggers
    (functions/lead-alert.js): resolveAlertTarget(companyId) reads
    companyProfile/{companyId}.brand.contact (alertEmail / alertSms) and
    routes the alert to the tenant's own contacts. Tenants without
    configured alert contacts — and NBD itself — fall back to Joe's
    defaults, so notifications always go out.

  - Public tenant leads enter via submitPublicLead (rate-limited,
    honeypot-protected), stamped with the tenant's companyId, so they land
    in that tenant's pipeline and alert inbox. This is the intake path
    used by the /sites/t/<slug> tenant microsites (getPublicSiteConfig +
    submitPublicLead, functions/handlers/public-site.js and
    functions/handlers/integrations.js).


DATA FLOW DIAGRAMS
================================================================================

1. USER LOGIN & COMPANY INITIALIZATION  [corrected 2026-07-04]
   ────────────────────────────────────

   User Logs In
        │
        ▼
   firebase.auth().onAuthStateChanged()  (docs/pro/js/nbd-auth.js)
        │
        ├─→ user.getIdTokenResult() → custom claims
        │
        ├─→ companyId = claims.companyId || user.uid
        │   (no default to 'nbd' — a missing claim means solo owner,
        │    whose uid IS the tenant id)
        │
        ├─→ role = users/{uid}.role || claims.role
        │
        ├─→ subscription = subscriptions/{companyId || uid}
        │   (company-level billing, Pillar 4)
        │
        ▼
   company-profile.js loads companyProfile/{companyId}
        │
        ├─→ window._companyProfile = {...} (defaults + remote overrides)
        │
        ▼
   Branding / contacts / document constants applied from the profile
        │
        ▼
   User sees their tenant's configuration


2. LEAD CREATION WITH COMPANY  [corrected 2026-07-04]
   ──────────────────────────

   Tenant microsite (/sites/t/<slug>) or CRM lead form
        │
        ▼
   submitPublicLead (public path) or authed CRM write —
   lead stamped with the tenant's companyId
        │
        ▼
   Lead document created in Firestore
   (firestore.rules requires a non-empty companyId pinned
    to the caller's tenant on create)
        │
        ▼
   leadAlert* Firestore trigger fires (functions/lead-alert.js)
        │
        ├─→ resolveAlertTarget(companyId)
        │   ├─→ companyProfile/{companyId}.brand.contact configured:
        │   │   └─→ alert email/SMS to the TENANT's contacts
        │   └─→ not configured (or no companyId):
        │       └─→ fall back to NBD defaults (Joe)
        │
        ▼
   Company owner receives notification

   (The NBD marketing funnel separately calls notifyNewLead —
    OTP-gated, Joe-only, no tenant routing.)


3. DATA QUERY WITH COMPANY ISOLATION
   ──────────────────────────────────

   User views leads list
        │
        ▼
   Get companyId (claims.companyId || uid, via nbd-auth.js)
        │
        ▼
   Query: db.collection('leads')
          .where('companyId', '==', companyId)
          .where('status', '==', 'new')
          .get()
        │
        ▼
   Return only leads for user's company
        │
        ▼
   Render UI with company-filtered data


INTEGRATION SEQUENCE  [corrected 2026-07-04 — as shipped]
================================================================================

Step 1: Pages load the auth module
  <script src="/pro/js/nbd-auth.js"></script>   (docs/pro/js/nbd-auth.js)

Step 2: Initialize on auth change
  nbd-auth reads the ID token custom claims:
  companyId = claims.companyId || user.uid; role = claims.role
  (solo owner: companyId == uid; team members carry the owner's uid)

Step 3: Per-tenant config
  docs/pro/js/company-profile.js loads companyProfile/{companyId}
  into window._companyProfile (branding, contacts, doc constants)

Step 4: Data operations carry companyId
  Every lead/estimate write stamps companyId (claims.companyId || uid);
  firestore.rules rejects creates without a valid tenant-pinned companyId

Step 5: Backend routes per tenant
  leadAlert* triggers resolve the tenant's alert contacts from
  companyProfile/{companyId} (functions/lead-alert.js)


FALLBACK & ERROR HANDLING
================================================================================

Scenario: Company ID claim missing  [corrected 2026-07-04]
  User's token has no companyId custom claim
    │
    ▼
  Tenant resolves to the user's OWN uid (solo-owner model)
    │
    ▼
  No cross-tenant default — nothing ever falls back to 'nbd'

Scenario: Tenant alert contact not configured  [corrected 2026-07-04]
  leadAlert trigger finds no companyProfile alert contact for companyId
    │
    ▼
  Fallback to: NBD defaults (Joe's email + SMS)
    │
    ▼
  Notification still goes out

Scenario: Firestore read fails
  Network error, quota exceeded, etc.
    │
    ▼
  Error logged to console
    │
    ▼
  Fallback defaults applied
    │
    ▼
  System continues to function


SECURITY & ISOLATION — LIVE (updated 2026-07-04)
================================================================================

companyId-scoped Firestore rules enforcement is DEPLOYED in firestore.rules —
this is no longer a planned "Phase 2":
  ✓ Data tagged with companyId
  ✓ Notifications routed per tenant (leadAlert* triggers)
  ✓ Firestore Security Rules ENFORCE tenant isolation:
      - reads require request.auth.token.companyId == resource.data.companyId
        with BOTH values non-null (a user missing the claim can never match
        a legacy doc whose companyId was never set)
      - creates require a non-empty string companyId pinned to the caller's
        own tenant (claims.companyId, or the caller's uid for solo owners)
  ✓ Query filters on every read
  ✓ Write restrictions per company
  ✓ Audit logging with companyId (audit triggers)

Actual rule shape (see firestore.rules for the authoritative text):
  allow read: if request.auth.token.companyId != null
              && resource.data.companyId != null
              && resource.data.companyId == request.auth.token.companyId;
  allow create: if request.resource.data.companyId is string
              && request.resource.data.companyId.size() > 0
              && (request.resource.data.companyId == myCompanyId()
                  || request.resource.data.companyId == request.auth.uid);


PERFORMANCE CONSIDERATIONS
================================================================================

Caching Strategy:
  • company-profile.js caches the merged profile (memory + localStorage)
  • Reduces Firestore reads
  • Cache invalidated on manual set

Query Optimization:
  • Add composite index for common queries
  • (companyId, status, createdAt)

Connection Pooling:
  • Firestore handles connections
  • No additional tuning needed at this stage

Firestore Limits:
  • No changes to current limits
  • companyId field adds ~20 bytes per document
  • No significant impact on quota

Recommendations:
  • Monitor Firestore usage in Firebase Console
  • Add metrics per company (Phase 3)
  • Consider read-only replicas for reports


BILLING, PLANS & TRIALS (added 2026-07-05)
================================================================================

Plan keys — canonical internally, aliased at read boundaries:

  The internal plan vocabulary is CANONICAL everywhere as of PR #841:
  free / starter / growth / enterprise. The legacy vocabulary
  (lite / foundation / blueprint / professional) survives ONLY as
  read-boundary aliases:
    - docs/pro/js/nbd-auth.js — PLAN_ALIASES + _normalizePlan(); PLAN_LEVELS
      is canonical; requiredPlan / hasAccess() / showUpgradeWall() normalize
      their input so legacy callers still gate correctly.
    - docs/pro/js/billing-gate.js — its own PLAN_ALIASES mirror; `_plan` and
      getPlan().plan are always canonical after loadSubscription(); legacy
      alias rows are kept in PLANS as belt-and-braces.
    - functions/billing.js — PLAN_LIMITS carries alias rows
      (foundation == starter caps, professional == growth caps) so the
      server meter accepts legacy plan values.
  Resolution happens ONCE, at these read boundaries. New writes emit
  canonical keys only — including access-code grants in
  functions/handlers/portal.js (code docs may carry either vocabulary on
  input; the grant writes starter/growth). The alias maps are PERMANENT by
  design: production subscriptions/* docs and Stripe metadata carry the
  legacy values forever, so never "clean up" the alias resolution.
  'lite' is kept as a distinct internal state ("free because a code trial
  expired", never persisted) — see PLAN_LEVELS in nbd-auth.js.

Access-code lifecycle (validateAccessCode, functions/handlers/portal.js):

  - Redemption is TRANSACTIONAL: validate + reserve a use atomically
    (db.runTransaction checks active/expiry/maxUses and increments useCount
    in one shot — closes the TOCTOU double-redeem of one-time codes); if
    the downstream side effects fail, the catch releases the reservation.
  - The register page no longer advertises a public code (the old UI
    printed "NBD-PRO" to every visitor; no such code is seeded).
  - Codes NEVER grant admin (role clamped to manager/member).
  - Trial expiry is enforced at READ time: a subscription doc with
    source:'access_code' whose trialEndsAt is in the past gates as the
    FREE plan in both the server meter (functions/billing.js trackUsage)
    and the client gate (billing-gate.js). Nothing rewrites the doc.
  - trialEndsAt has exactly ONE writer: validateAccessCode. The Stripe
    webhook never writes it. This is a documented invariant with a
    smoke-test lock (single-writer scan across functions/).

Free tier & the dashboard gate:

  - The dashboard IS the free product. docs/pro/js/dashboard-auth-gate.module.js
    runs NBDAuth.init with requiredPlan:'free' (auth still required — the
    signed-out branch redirects regardless). Before PR #841 it required
    'foundation', which full-screen-walled every fresh free signup.
  - Feature limits are billing-gate.js's SOFT gate (warn at 80%, modal at
    100%); the server-authoritative monthly meter is trackUsage
    (functions/billing.js). Premium pages (vault, AI tools, analytics)
    keep higher requiredPlan gates ('starter'/'growth').
  - Stripe trialers get a REAL countdown: the webhook writes status
    'trialing' verbatim plus currentPeriodEnd (never trialEndsAt);
    nbd-auth derives trial days from currentPeriodEnd (trial_end ==
    current_period_end while trialing) and isTrialExpired requires a
    KNOWN end — an unknown end never renders as "trial ended".

Stripe plumbing:

  - All Stripe calls go through a shared getStripe() client
    (functions/stripe.js, PR #774): trims the secret key (a trailing
    newline in the secret looked like a Stripe outage) and configures
    retries. Handlers never instantiate their own client.
  - Subscription docs live at subscriptions/{companyId || uid}
    (company-level billing, Pillar 4 — see the login flow above).


TESTING & CI (added 2026-07-05)
================================================================================

  - Authed E2E (Rock 3): 16 hermetic journeys (money paths + the signup funnel) in
    tests/e2e/pro-authed.spec.js — login/persistence, save-lead
    (companyId + customerId), stage move (timeline + stageStartedAt),
    estimate parity (browser V2 math vs the Node engine), invoice
    (totals + deposit + balanceDue), photo upload (original + thumb via
    the STORAGE emulator; since 2026-08-16 the same journey also runs
    the dashboard quick-upload and pins its NESTED
    photos/{uid}/{leadId}/... storagePath shape — the shape the
    image pipeline's doc lookup keys on), doc generation (metadata +
    rendered HTML),
    D2D knock (transaction-guarded auto-convert: exactly one linked
    lead), scheduling (date-only scheduledDate, no UTC day-shift), and
    expenses (integer cents + IRS-rate mileage).
  - The suite is hermetic: CI job e2e-authed-emulator
    (.github/workflows/ci.yml) runs `npm run test:e2e:authed:emu`, which
    boots the auth + firestore + storage + hosting emulators, seeds a
    known tenant (tests/e2e/fixtures/seed-emulator.js — mirrors what
    createCompany writes), and drives http://127.0.0.1:5000. No prod
    credentials; nbd-emulator-connect.js points the client SDK at the
    emulators automatically. continue-on-error until proven stable.
  - Rules tests (firestore + cross-tenant + storage) run against
    emulators in the same workflow and remain authoritative for the
    security boundaries described above.


DASHBOARD SHELL — ROCK 4 DECOMPOSITION (status 2026-07-05)
================================================================================

  docs/pro/dashboard.html is DECOMPOSED: Phases 1-5 of the Rock 4 plan are
  complete. ~6,080 lines (from 14,425); every view — including view-est,
  the deliberate last holdout — is an empty mount + <template> hydrated on
  first goTo(); inline onclick count is ZERO (416 → a body-level
  data-action delegate); CSS and boot/body scripts moved to
  docs/pro/js/*.js + dashboard-*.module.js. `?legacy=1` still serves the
  pre-decomposition rollback snapshot (refreshed 2026-07-04).
  Remaining: Phase 6 (drop 'unsafe-inline' from script-src — blocked on
  the Rock 1 DNS cutover being authoritative for CSP) and the per-view
  module pattern for window.* globals. The maintained status + manifest is
  docs/dev/dashboard-decomposition-plan.md — that file is canonical.


DATA MIGRATIONS
================================================================================

  Versioned migration runner: functions/migrations/runner.js with scripts
  in functions/migrations/scripts/ (001 noop-init, 002 backfill
  stageStartedAt, 003 stamp timestamp-less leads so they join the dormant
  window). A stale-migrations-tick alert policy exists in monitoring/.


PUBLIC B2B SURFACE & SEO (added 2026-07-05)
================================================================================

  - Terms of Service page at /pro/terms (docs/pro/terms.html), linked from
    the register page alongside the privacy policy.
  - /sitemap-pro.xml (docs/sitemap-pro.xml) is a separate B2B sitemap for
    the SaaS front door, referenced from docs/robots.txt alongside the
    homeowner sitemap.
  - Canonical + og:url tags on the funnel pages (landing, pricing,
    register, …) point at the SERVED extensionless URLs
    (e.g. https://nobigdealwithjoedeal.com/pro/pricing).


OPS & DEPENDENCY BASELINE (added 2026-07-05)
================================================================================

  - Tenant-microsite alert policy: monitoring/alert-tenant-microsite-errors.json
    pages on getPublicSiteConfig 500s (> 3 in 15m) — every /sites/t/<slug>
    microsite renders from that endpoint, and since the 2026-07-04 Oaks
    cutover that includes a live paying-tenant site.
  - functions/ dependency majors move TOGETHER: firebase-admin ^13 +
    firebase-functions ^7 + twilio ^6. firebase-admin 14 is peer-blocked
    by every published firebase-functions release — do not bump admin
    alone (supersedes the single-package dependabot PRs).
  - /tests fixtures use the MODULAR firebase-admin API (admin ^14 in
    tests/package.json) — the tests tree and functions tree intentionally
    differ on admin majors.


================================================================================
END OF ARCHITECTURE DOCUMENTATION
================================================================================
