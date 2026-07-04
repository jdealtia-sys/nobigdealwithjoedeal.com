================================================================================
NBD PRO CRM - MULTI-TENANT ARCHITECTURE
================================================================================

Last updated: 2026-07-04 (June ops-audit item 7 refresh).
Corrections in this pass:
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


================================================================================
END OF ARCHITECTURE DOCUMENTATION
================================================================================
