================================================================================
NBD PRO CRM - MULTI-TENANT ARCHITECTURE
================================================================================

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

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                        COMPANY ADMIN MODULE                             │
  │                  (pro/js/company-admin.js - 195 lines)                  │
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
  │              (pro/js/nbd-auth-enhancement.js - 96 lines)                │
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
  │  All data collections support companyId filtering (Phase 2)            │
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
  └──────────────────────────────────────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────────────────────┐
│                      CLOUD FUNCTIONS INTEGRATION                             │
└──────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────┐
  │                    notifyNewLead Function [UPDATED]                     │
  │              (functions/verify-functions.js)                            │
  │─────────────────────────────────────────────────────────────────────────│
  │                                                                          │
  │  Receives:                                                               │
  │  ┌───────────────────────────────────────────────────────────────────┐ │
  │  │ {                                                                 │ │
  │  │   name: 'John Doe',                                               │ │
  │  │   phone: '(513) 555-1234',                                        │ │
  │  │   email: 'john@example.com',                                      │ │
  │  │   service: 'Roof Replacement',                                    │ │
  │  │   companyId: 'nbd' ← [NEW]                                        │ │
  │  │ }                                                                 │ │
  │  └───────────────────────────────────────────────────────────────────┘ │
  │                           │                                             │
  │                           ▼                                             │
  │  ┌──────────────────────────────────────────────────────────────────┐  │
  │  │ if (companyId) {                                                 │  │
  │  │   lookup: db.collection('companies').doc(companyId)              │  │
  │  │   notificationPhone = company.phone                              │  │
  │  │   notificationEmail = company.email                              │  │
  │  │ } else {                                                         │  │
  │  │   notificationPhone = JOE_PHONE                                  │  │
  │  │   notificationEmail = JOE_EMAIL                                  │  │
  │  │ }                                                                │  │
  │  └──────────────────────────────────────────────────────────────────┘  │
  │                           │                                             │
  │        ┌──────────────────┼──────────────────┐                         │
  │        │                  │                  │                         │
  │        ▼                  ▼                  ▼                         │
  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐               │
  │  │ Save lead    │  │ Send SMS     │  │ Send Email   │               │
  │  │ + companyId  │  │ to company   │  │ to company   │               │
  │  │ to Firestore │  │ via Twilio   │  │ via Resend   │               │
  │  └──────────────┘  └──────────────┘  └──────────────┘               │
  │                                                                       │
  └──────────────────────────────────────────────────────────────────────┘


DATA FLOW DIAGRAMS
================================================================================

1. USER LOGIN & COMPANY INITIALIZATION
   ────────────────────────────────────

   User Logs In
        │
        ▼
   firebase.auth().onAuthStateChanged()
        │
        ▼
   NBDAuth.initializeCompanyId()
        │
        ├─→ firebase.auth().currentUser
        │
        ├─→ db.collection('users').doc(uid).get()
        │
        ├─→ userData.companyId (or default 'nbd')
        │
        ├─→ window._companyId = 'nbd' (or 'oaks', etc.)
        │
        ▼
   CompanyAdmin.getCurrentCompany()
        │
        ├─→ CompanyAdmin.getCompanyConfig(window._companyId)
        │
        ├─→ db.collection('companies').doc(companyId).get()
        │
        ├─→ window._companyConfig = {...}
        │
        ▼
   CompanyAdmin.applyBranding(config)
        │
        ├─→ Update page title
        ├─→ Apply CSS colors
        ├─→ Display company logo
        ├─→ Update navigation background
        │
        ▼
   User sees branded interface


2. LEAD CREATION WITH COMPANY
   ──────────────────────────

   User fills lead form
        │
        ▼
   Extract form data + CompanyAdmin.getCompanyId()
        │
        ▼
   Call: firebase.functions().httpsCallable('createLead')({
     name, phone, email, service,
     companyId: CompanyAdmin.getCompanyId()  ← Added
   })
        │
        ▼
   Cloud Function notifyNewLead()
        │
        ├─→ Save to Firestore with companyId tag
        │
        ├─→ If companyId provided:
        │   └─→ Load company from db.collection('companies')
        │       ├─→ notificationPhone = company.phone
        │       └─→ notificationEmail = company.email
        │   else:
        │   └─→ notificationPhone = JOE_PHONE
        │       notificationEmail = JOE_EMAIL
        │
        ├─→ Send SMS to notificationPhone
        │
        ├─→ Send Email to notificationEmail
        │
        ▼
   Company owner receives notification


3. DATA QUERY WITH COMPANY ISOLATION
   ──────────────────────────────────

   User views leads list
        │
        ▼
   Get companyId = CompanyAdmin.getCompanyId()
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


INTEGRATION SEQUENCE
================================================================================

Step 1: Load Core Modules (HTML/Index)
  <script src="/pro/js/company-admin.js"></script>
  <script src="/pro/js/nbd-auth-enhancement.js"></script>

Step 2: Initialize on Auth Change
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      // Company ID initialized
      // Branding applied
      // Ready to use
    }
  });

Step 3: Use in Application
  const companyId = CompanyAdmin.getCompanyId();
  const config = await CompanyAdmin.getCompanyConfig(companyId);
  // Use config for forms, dropdowns, display

Step 4: Pass with Data Operations
  createLead({ ...data, companyId: CompanyAdmin.getCompanyId() })

Step 5: Backend Handles Company Logic
  notifyNewLead looks up company and routes notification


FALLBACK & ERROR HANDLING
================================================================================

Scenario: Company ID not found
  User doc missing companyId field
    │
    ▼
  Default to: window._companyId = 'nbd'
    │
    ▼
  No error, just use default company

Scenario: Company document not found
  notifyNewLead gets unknown companyId
    │
    ▼
  Fallback to: JOE_PHONE and JOE_EMAIL
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


SECURITY & ISOLATION (Phase 2)
================================================================================

Current State (Phase 1):
  ✓ Data tagged with companyId
  ✓ Notifications routed correctly
  ✗ No enforcement of data isolation

Phase 2 Enhancements:
  ✓ Firestore Security Rules enforcement
  ✓ Query filters on every read
  ✓ Write restrictions per company
  ✓ Audit logging with companyId

Firestore Rules Example:
  match /leads/{leadId} {
    allow read: if request.auth.token.companyId 
               == resource.data.companyId;
    allow write: if request.auth.token.companyId 
                == request.resource.data.companyId;
  }


PERFORMANCE CONSIDERATIONS
================================================================================

Caching Strategy:
  • CompanyAdmin caches config in memory
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
