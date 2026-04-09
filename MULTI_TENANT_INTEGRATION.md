# NBD Pro CRM - Multi-Tenant Company System Integration Guide

This guide explains how to integrate the multi-tenant company system into your NBD Pro CRM. The system allows multiple roofing companies to use the same CRM with their own branding and data isolation.

## Overview

The multi-tenant system consists of:

1. **Company Admin Module** (`pro/js/company-admin.js`) - Branding and configuration
2. **Auth Enhancement** (`pro/js/nbd-auth-enhancement.js`) - Company ID in user auth
3. **Firestore Seed Script** (`functions/seed-companies.js`) - Initial company data
4. **Verify Functions Enhancement** (`functions/verify-functions-company-enhancement.js`) - Company-aware notifications

## File Structure

```
C:\Users\jonat\nobigdealwithjoedeal.com\
├── pro/js/
│   ├── company-admin.js              [NEW] Company config & branding module
│   ├── nbd-auth-enhancement.js       [NEW] Auth company ID integration
│   ├── nbd-auth.js                   [EXISTING] Update to include enhancement
│   └── ... other files ...
├── functions/
│   ├── seed-companies.js             [NEW] Database seeding script
│   ├── verify-functions.js           [EXISTING] Update for company notifications
│   ├── verify-functions-company-enhancement.js [NEW] Integration instructions
│   └── ... other files ...
└── MULTI_TENANT_INTEGRATION.md       [THIS FILE]
```

## Firestore Data Schema

### Companies Collection

```javascript
// companies/{companyId}
{
  id: 'nbd',                    // Unique company identifier
  name: 'No Big Deal Home Solutions',
  owner: 'Joe Deal',
  phone: '(513) 827-5297',
  email: 'joe@nobigdeals.com',
  address: 'Cincinnati, OH',
  logo: null,                   // Cloud Storage URL (optional)
  colors: {
    primary: '#0066cc',         // Primary brand color
    accent: '#ff6600',          // Accent color
    navBg: '#003366'            // Navigation background
  },
  services: [
    'Roof Replacement',
    'Roof Repair',
    'Siding Replacement',
    'Siding Repair',
    'Gutter Replacement',
    'Storm Damage'
  ],
  serviceAreas: [
    'Cincinnati',
    'Northern Kentucky',
    'Southwest Ohio'
  ],
  warranty: '10-Year Labor Warranty on All Installs',
  subscription: {
    plan: 'professional',
    status: 'active'
  },
  siteUrl: '/sites/nbd.html',
  createdAt: Timestamp,
  updatedAt: Timestamp
}
```

### Users Collection Updates

Add `companyId` field to user documents:

```javascript
// users/{uid}
{
  email: 'scott@oaksrfc.com',
  companyId: 'oaks',              // [NEW] Link to company
  role: 'admin',
  name: 'Scott Oaks',
  // ... other user fields ...
}
```

## Step-by-Step Integration

### Step 1: Seed Companies Data

Before you proceed, seed the Firestore database with the initial companies:

```bash
cd C:\Users\jonat\nobigdealwithjoedeal.com\functions

# Set Firebase credentials (if not already done)
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json

# Run the seed script
node seed-companies.js
```

This creates two companies:
- **NBD** (nbd) - No Big Deal Home Solutions
- **Oaks** (oaks) - Oaks Roofing & Construction

### Step 2: Update nbd-auth.js

In `pro/js/nbd-auth.js`:

1. At the end of the file (after the main NBDAuth module is defined), add:

```javascript
// Import company ID enhancement
// This adds getCompanyId(), setCompanyId(), and initializeCompanyId() to NBDAuth

// Hook into auth state changes to initialize company ID
firebase.auth().onAuthStateChanged(async (user) => {
  if (user && typeof NBDAuth !== 'undefined' && NBDAuth.initializeCompanyId) {
    const companyId = await NBDAuth.initializeCompanyId();
    console.log(`✅ Company ID initialized for ${user.email}: ${companyId}`);
  }
});
```

2. Add these methods to the NBDAuth module's public API:

```javascript
// Add to NBDAuth return object:
{
  // ... existing methods ...
  
  /**
   * Initialize company ID from user document
   * @returns {Promise<string>} Company ID
   */
  initializeCompanyId: async () => {
    try {
      const user = firebase.auth().currentUser;
      if (!user) {
        window._companyId = 'nbd';
        return 'nbd';
      }

      const userRef = db.collection('users').doc(user.uid);
      const userSnapshot = await userRef.get();

      if (userSnapshot.exists) {
        const userData = userSnapshot.data();
        window._companyId = userData.companyId || 'nbd';
      } else {
        window._companyId = 'nbd';
      }

      return window._companyId;
    } catch (error) {
      console.error('Error initializing company ID:', error);
      window._companyId = 'nbd';
      return 'nbd';
    }
  },

  /**
   * Get current company ID
   * @returns {string} Company ID
   */
  getCompanyId: () => window._companyId || 'nbd',

  /**
   * Set company ID (for testing/manual assignment)
   * @param {string} companyId - Company ID to set
   */
  setCompanyId: (companyId) => {
    window._companyId = companyId;
  }
}
```

### Step 3: Load Company Admin Module

In your main HTML file or dashboard initialization:

```html
<!-- Load company admin module BEFORE your dashboard code -->
<script src="/pro/js/company-admin.js"></script>

<script>
// After auth is ready and user is authenticated:
firebase.auth().onAuthStateChanged(async (user) => {
  if (user) {
    // Initialize company branding
    const currentCompany = await CompanyAdmin.getCurrentCompany();
    if (currentCompany) {
      console.log(`✅ Loaded company: ${currentCompany.name}`);
    }
  }
});
</script>
```

### Step 4: Update verify-functions.js

In `functions/verify-functions.js`, around line 210-220:

1. Update the destructuring to include `companyId`:

```javascript
// OLD:
const { name, phone, email, address, service, timeline, verified, requestType } = request.data || {};

// NEW:
const { name, phone, email, address, service, timeline, verified, requestType, companyId } = request.data || {};
```

2. After input validation (around line 220), add company-aware notification:

```javascript
// Get company config for notifications
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
      console.log(`✅ Using company contact for notifications: ${companyData.name}`);
    }
  } catch (error) {
    console.warn(`⚠️  Could not load company config: ${error.message}`);
  }
}
```

3. Replace hardcoded JOE_PHONE and JOE_EMAIL with variables:

```javascript
// When sending SMS, change:
//   to: JOE_PHONE
// To:
//   to: notificationPhone

// When sending email, change:
//   to: JOE_EMAIL
// To:
//   to: notificationEmail
```

### Step 5: Apply Branding to Dashboard

Add data attributes to your HTML elements to apply company branding:

```html
<!-- Company name -->
<h1 data-company-name>No Big Deal Home Solutions</h1>

<!-- Company logo -->
<img data-company-logo src="/images/default-logo.png" />

<!-- Elements for color customization -->
<button data-color-primary>Primary Color Button</button>
<a data-color-accent>Accent Color Link</a>
<nav data-nav>Navigation</nav>
```

The `CompanyAdmin.applyBranding(config)` function will automatically update these elements.

## Client-Side API

### CompanyAdmin Module

```javascript
// Load company configuration
const config = await CompanyAdmin.getCompanyConfig(companyId);

// Apply company branding to DOM
CompanyAdmin.applyBranding(config);

// Get current user's company
const currentCompany = await CompanyAdmin.getCurrentCompany();

// Get current company ID
const companyId = CompanyAdmin.getCompanyId();

// Switch to different company (admin use)
await CompanyAdmin.setCurrentCompany(newCompanyId);
```

### NBDAuth Extensions

```javascript
// Initialize company ID after user authentication
const companyId = await NBDAuth.initializeCompanyId();

// Get current company ID
const companyId = NBDAuth.getCompanyId();

// Manually set company ID (testing/admin)
NBDAuth.setCompanyId(newCompanyId);
```

## Future Enhancements

### 1. Data Isolation (Phase 2)

Add companyId filter to all queries:

```javascript
// Before: db.collection('leads').where('status', '==', 'new')
// After:
db.collection('leads')
  .where('companyId', '==', currentCompanyId)
  .where('status', '==', 'new')
```

### 2. Company Settings UI

Create admin interface for:
- Custom colors and branding
- Logo upload
- Service configuration per company
- Team member management

### 3. Billing Integration

Track usage by company:
- Leads created per month
- Estimates generated
- Invoices sent

### 4. Audit Logging

Log all actions with companyId:
- Who accessed what
- When leads were created
- Who modified estimates

## Troubleshooting

### Company Config Not Loading

- Check Firestore companies collection exists
- Verify company documents have all required fields
- Check browser console for errors

### Branding Not Applied

- Ensure HTML elements have correct data attributes
- Check that CompanyAdmin.applyBranding() is called
- Verify company colors are in valid hex format

### Notifications Going to Wrong Contact

- Verify company document has correct phone/email
- Check that companyId is being passed to notifyNewLead
- Test with seed company data first

## Testing

### Manual Testing Checklist

```
[ ] Seed companies with seed-companies.js
[ ] Create users with different companyIds
[ ] Login as each user
[ ] Verify company name displays correctly
[ ] Verify branding colors are applied
[ ] Submit lead and verify notification goes to correct contact
[ ] Check that leads are tagged with companyId in Firestore
[ ] Test company switching in admin interface
```

### Test Companies

**No Big Deal (nbd)**
- Owner: Joe Deal
- Phone: (513) 827-5297
- Email: joe@nobigdeals.com
- Colors: Blue (#0066cc) / Orange (#ff6600)

**Oaks Roofing (oaks)**
- Owner: Scott Oaks
- Phone: (513) 827-5297
- Email: joe@oaksrfc.com
- Colors: Dark Gray (#333333) / Orange (#e8720c)

## Questions?

Refer to:
- `pro/js/company-admin.js` - Detailed comments on each function
- `functions/seed-companies.js` - Database schema documentation
- `functions/verify-functions-company-enhancement.js` - Integration examples
