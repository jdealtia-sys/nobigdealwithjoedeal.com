# NBD Pro CRM Multi-Tenant Implementation Checklist

This checklist walks you through implementing the multi-tenant company system step-by-step.

## Phase 1: Database & Backend Setup

### Firestore Configuration

- [ ] Read `MULTI_TENANT_INTEGRATION.md` for overview
- [ ] Review company schema in `MULTI_TENANT_INTEGRATION.md`
- [ ] Review seed script: `functions/seed-companies.js`

### Seed Initial Data

- [ ] Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable
- [ ] Run `node functions/seed-companies.js`
- [ ] Verify companies collection exists in Firebase Console
- [ ] Verify two companies created: `nbd` and `oaks`
- [ ] Check each company document has all required fields

### Update User Documents

- [ ] Add `companyId` field to existing user documents
- [ ] Example user structure:
  ```
  {
    email: 'scott@oaksrfc.com',
    companyId: 'oaks',
    role: 'admin',
    name: 'Scott Oaks'
  }
  ```
- [ ] Assign Joe Deal users to `nbd` company
- [ ] Assign Scott Oaks users to `oaks` company

## Phase 2: Frontend - Company Admin Module

### Load Company Admin Module

- [ ] File exists: `pro/js/company-admin.js`
- [ ] Review module structure (IIFE pattern)
- [ ] Module exports: `getCompanyConfig`, `applyBranding`, `getCurrentCompany`, `getCompanyId`, `setCurrentCompany`
- [ ] Add to main HTML template:
  ```html
  <script src="/pro/js/company-admin.js"></script>
  ```

### Test Company Admin Functions

- [ ] Open browser console
- [ ] Test: `CompanyAdmin.getCompanyId()` — should return 'nbd' (default)
- [ ] Test: `await CompanyAdmin.getCompanyConfig('nbd')` — should return company object
- [ ] Test: `await CompanyAdmin.getCurrentCompany()` — should load logged-in user's company

### Add Branding Elements to HTML

Add these data attributes to elements you want to brand:

- [ ] `<h1 data-company-name>` — Company name (will be replaced)
- [ ] `<img data-company-logo>` — Company logo
- [ ] `<button data-color-primary>` — Primary color elements
- [ ] `<a data-color-accent>` — Accent color elements
- [ ] `<nav data-nav>` — Navigation bar background

Example:
```html
<header>
  <img data-company-logo src="/images/default.png" />
  <h1 data-company-name>My CRM</h1>
  <nav data-nav>
    <a href="/">Dashboard</a>
    <a href="/leads">Leads</a>
  </nav>
</header>
```

## Phase 3: Frontend - Auth Enhancement

### Update nbd-auth.js

- [ ] Open `pro/js/nbd-auth.js`
- [ ] Add these methods to NBDAuth module:
  - [ ] `initializeCompanyId()` — Load company ID from user doc
  - [ ] `getCompanyId()` — Return current company ID
  - [ ] `setCompanyId(companyId)` — Set company ID

Code to add (see `nbd-auth-enhancement.js` for full implementation):

```javascript
NBDAuth.initializeCompanyId = async () => {
  const user = firebase.auth().currentUser;
  if (!user) return 'nbd';
  
  const userRef = db.collection('users').doc(user.uid);
  const userSnapshot = await userRef.get();
  
  if (userSnapshot.exists) {
    window._companyId = userSnapshot.data().companyId || 'nbd';
  } else {
    window._companyId = 'nbd';
  }
  
  return window._companyId;
};

NBDAuth.getCompanyId = () => window._companyId || 'nbd';
NBDAuth.setCompanyId = (companyId) => { window._companyId = companyId; };
```

### Hook into Auth State Changes

- [ ] Add auth state listener to nbd-auth.js:
```javascript
firebase.auth().onAuthStateChanged(async (user) => {
  if (user && NBDAuth.initializeCompanyId) {
    await NBDAuth.initializeCompanyId();
  }
});
```

- [ ] Test: Login and check `NBDAuth.getCompanyId()` in console

## Phase 4: Cloud Functions - Company-Aware Notifications

### Update verify-functions.js

- [ ] Open `functions/verify-functions.js`
- [ ] Find `notifyNewLead` function (around line 210)
- [ ] Update destructuring to include `companyId`:
  ```javascript
  const { 
    name, phone, email, address, service, 
    timeline, verified, requestType, companyId 
  } = request.data || {};
  ```

- [ ] Add company lookup logic (after input validation):
  ```javascript
  let notificationPhone = JOE_PHONE.value();
  let notificationEmail = JOE_EMAIL.value();
  
  if (companyId) {
    try {
      const companyRef = db.collection('companies').doc(companyId);
      const companySnapshot = await companyRef.get();
      
      if (companySnapshot.exists) {
        const companyData = companySnapshot.data();
        notificationPhone = companyData.phone;
        notificationEmail = companyData.email;
      }
    } catch (error) {
      console.warn('Could not load company config:', error);
    }
  }
  ```

- [ ] Replace hardcoded `JOE_PHONE` with `notificationPhone` in SMS send:
  ```javascript
  // OLD:
  to: JOE_PHONE
  // NEW:
  to: notificationPhone
  ```

- [ ] Replace hardcoded `JOE_EMAIL` with `notificationEmail` in email send:
  ```javascript
  // OLD:
  to: JOE_EMAIL
  // NEW:
  to: notificationEmail
  ```

- [ ] Deploy Cloud Functions:
  ```bash
  cd functions
  firebase deploy --only functions:notifyNewLead
  ```

## Phase 5: Client Integration

### Initialize Company on Page Load

- [ ] Create dashboard initialization code (see examples in `company-admin-usage-example.js`)
- [ ] Add to your main HTML:
  ```javascript
  <script src="/pro/js/company-admin.js"></script>
  <script>
    firebase.auth().onAuthStateChanged(async (user) => {
      if (user) {
        // Initialize company and branding
        const company = await CompanyAdmin.getCurrentCompany();
        if (company) {
          console.log('Company loaded:', company.name);
        }
      }
    });
  </script>
  ```

### Use Company Data in Forms

- [ ] Review `company-admin-usage-example.js` for patterns
- [ ] When creating leads, pass `companyId`:
  ```javascript
  const createLead = firebase.functions().httpsCallable('createLead');
  const result = await createLead({
    ...leadData,
    companyId: CompanyAdmin.getCompanyId()
  });
  ```

- [ ] Populate service dropdown from company config:
  ```javascript
  const config = await CompanyAdmin.getCompanyConfig(
    CompanyAdmin.getCompanyId()
  );
  config.services.forEach(service => {
    // Add to dropdown
  });
  ```

- [ ] Populate warranty from company config

## Phase 6: Testing

### Manual Testing

- [ ] Create test users:
  - [ ] User A: companyId = 'nbd'
  - [ ] User B: companyId = 'oaks'

- [ ] Login as User A:
  - [ ] Verify correct company name displays
  - [ ] Verify correct company colors applied
  - [ ] Verify services match NBD services
  - [ ] Submit a lead, verify notification goes to NBD contact

- [ ] Login as User B:
  - [ ] Verify correct company name displays
  - [ ] Verify different company colors applied
  - [ ] Verify services match Oaks services
  - [ ] Submit a lead, verify notification goes to Oaks contact

### Data Isolation Testing

- [ ] User A creates a lead, check Firestore has `companyId: 'nbd'`
- [ ] User B creates a lead, check Firestore has `companyId: 'oaks'`
- [ ] (Future) Verify User A cannot see User B's leads

### Browser Console Testing

```javascript
// Should return 'nbd' or 'oaks' depending on logged-in user
NBDAuth.getCompanyId()

// Should return company object
await CompanyAdmin.getCompanyConfig('nbd')

// Should apply branding
await CompanyAdmin.getCurrentCompany()

// Check globals are set
window._companyId
window._companyConfig
```

## Phase 7: Data Isolation (Phase 2 Enhancement)

### Add companyId Filters to Queries

In all Firestore queries, add company filter:

- [ ] Leads: `.where('companyId', '==', currentCompanyId)`
- [ ] Estimates: `.where('companyId', '==', currentCompanyId)`
- [ ] Invoices: `.where('companyId', '==', currentCompanyId)`
- [ ] Tasks: `.where('companyId', '==', currentCompanyId)`

Example:
```javascript
// BEFORE:
db.collection('leads').where('status', '==', 'new')

// AFTER:
db.collection('leads')
  .where('companyId', '==', currentCompanyId)
  .where('status', '==', 'new')
```

- [ ] Create index in Firestore for `companyId + status` compound queries
- [ ] Update all collection queries (see list in Phase 7)

## Phase 8: Advanced Features (Optional)

### Company Settings UI

- [ ] Create admin page to edit company settings
- [ ] Allow custom logo upload
- [ ] Allow custom color selection
- [ ] Persist changes to Firestore

### Multi-Company Admin Dashboard

- [ ] Create admin interface to view all companies
- [ ] Add ability to create new companies
- [ ] Add metrics per company (leads, estimates, revenue)

### Audit Logging

- [ ] Log all user actions with `companyId`
- [ ] Log who accessed what, when
- [ ] Create audit trail reports per company

### Billing Integration

- [ ] Track usage per company
- [ ] Create per-company invoices
- [ ] Implement tiered pricing per subscription level

## Files Created/Modified

### New Files Created

- [x] `pro/js/company-admin.js` (195 lines)
- [x] `pro/js/nbd-auth-enhancement.js` (96 lines)
- [x] `pro/js/company-admin-usage-example.js` (378 lines)
- [x] `functions/seed-companies.js` (123 lines)
- [x] `functions/verify-functions-company-enhancement.js` (128 lines)
- [x] `functions/SEED_COMPANIES_README.md` (284 lines)
- [x] `MULTI_TENANT_INTEGRATION.md` (399 lines)
- [x] `IMPLEMENTATION_CHECKLIST.md` (this file)

### Files to Modify

- [ ] `pro/js/nbd-auth.js` — Add company ID initialization
- [ ] `functions/verify-functions.js` — Add company-aware notifications
- [ ] `pro/index.html` (or main template) — Add branding elements and module loads

### No Changes Needed (Yet)

- Leads, Estimates, Invoices modules — Will need companyId filters in Phase 7
- Cloud Storage — Ready for company-specific logo uploads

## Deployment Steps

### Development Testing

```bash
# 1. Seed database
cd C:\Users\jonat\nobigdealwithjoedeal.com\functions
node seed-companies.js

# 2. Deploy updated functions
firebase deploy --only functions:notifyNewLead

# 3. Test locally
# - Open Firebase Emulator or test against live database
# - Create test users with different companyIds
# - Test branding and notifications
```

### Production Deployment

```bash
# 1. Seed production database (one-time)
set GOOGLE_APPLICATION_CREDENTIALS=production-key.json
node seed-companies.js

# 2. Deploy functions
firebase deploy --only functions

# 3. Update web app
# - Update nbd-auth.js
# - Update verify-functions.js
# - Add company-admin.js to HTML
# - Deploy web assets

# 4. Verify in production
# - Test with actual users
# - Check Firestore for proper companyId values
# - Monitor function logs
```

## Rollback Plan

If issues occur:

1. **Revert Company Admin Module** - Remove `company-admin.js` loads and branding code
2. **Revert nbd-auth.js** - Remove company ID initialization, set `window._companyId = 'nbd'`
3. **Revert verify-functions.js** - Revert to hardcoded Joe contact info
4. **Clear _companyId** - Set `window._companyId = null` in all users' sessions

The system is backward compatible - leads without `companyId` will still work.

## Support & Troubleshooting

See detailed troubleshooting in:
- `MULTI_TENANT_INTEGRATION.md` — General integration issues
- `SEED_COMPANIES_README.md` — Database seeding issues
- `company-admin-usage-example.js` — Code examples for common patterns

## Success Criteria

- [ ] Two companies (NBD and Oaks) are seeded in Firestore
- [ ] Company-specific branding displays correctly per user
- [ ] Leads include companyId when created
- [ ] Notifications go to correct company contact
- [ ] CompanyAdmin API is accessible from browser console
- [ ] No errors in browser console
- [ ] No errors in Cloud Function logs
- [ ] Test users from different companies see their own data/branding

## Next Steps

After completing this checklist:

1. **Phase 7** - Add data isolation queries to all collections
2. **Advanced Features** - Company settings UI, audit logging, etc.
3. **Documentation** - Create internal docs for team
4. **Training** - Train support team on multi-tenant concepts
