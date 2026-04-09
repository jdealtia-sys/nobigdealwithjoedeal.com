# Seeding Company Data

This guide explains how to seed the Firestore database with initial company records for the NBD Pro CRM multi-tenant system.

## Prerequisites

1. **Firebase Admin SDK** - Already in your project dependencies
2. **Service Account Key** - Downloaded from Firebase Console
3. **Node.js** - Installed on your system

## Files Involved

- `seed-companies.js` - The seeding script
- `functions/package.json` - Ensure firebase-admin is listed

## Quick Start

### 1. Setup Environment

```bash
cd C:\Users\jonat\nobigdealwithjoedeal.com\functions

# Set your Google Application Credentials
# On Windows CMD:
set GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\serviceAccountKey.json

# On Windows PowerShell:
$env:GOOGLE_APPLICATION_CREDENTIALS='C:\path\to\serviceAccountKey.json'
```

### 2. Run the Seed Script

```bash
node seed-companies.js
```

### 3. Verify in Firebase Console

Go to your Firebase Console → Firestore Database → Collections and verify:

1. A new `companies` collection exists
2. Two documents: `nbd` and `oaks`
3. Each document contains the company configuration

## Getting Your Service Account Key

If you don't have a service account key:

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Go to **Project Settings** (gear icon)
4. Click the **Service Accounts** tab
5. Click **Generate New Private Key**
6. Save the JSON file securely

## What Gets Seeded

### Company: No Big Deal Home Solutions (nbd)

```javascript
{
  id: 'nbd',
  name: 'No Big Deal Home Solutions',
  owner: 'Joe Deal',
  phone: '(513) 827-5297',
  email: 'joe@nobigdeals.com',
  address: 'Cincinnati, OH',
  colors: {
    primary: '#0066cc',
    accent: '#ff6600',
    navBg: '#003366'
  },
  services: [
    'Roof Replacement',
    'Roof Repair',
    'Siding Replacement',
    'Siding Repair',
    'Gutter Replacement',
    'Storm Damage'
  ],
  serviceAreas: ['Cincinnati', 'Northern Kentucky', 'Southwest Ohio'],
  warranty: '10-Year Labor Warranty on All Installs',
  subscription: { plan: 'professional', status: 'active' }
}
```

### Company: Oaks Roofing & Construction (oaks)

```javascript
{
  id: 'oaks',
  name: 'Oaks Roofing & Construction',
  owner: 'Scott Oaks',
  phone: '(513) 827-5297',
  email: 'joe@oaksrfc.com',
  address: 'Goshen, OH',
  colors: {
    primary: '#333333',
    accent: '#e8720c',
    navBg: '#1a1a1a'
  },
  services: [
    'Roof Replacement',
    'Roof Repair',
    'Siding Replacement',
    'Siding Repair',
    'Gutter Replacement',
    'Storm Damage'
  ],
  serviceAreas: ['Goshen', 'Milford', 'Batavia'],
  warranty: '5-Year Labor Warranty on All Installs',
  subscription: { plan: 'professional', status: 'active' }
}
```

## Modifying the Seed Data

To add or modify companies, edit `seed-companies.js`:

```javascript
const companiesData = [
  {
    id: 'your-company-id',
    name: 'Your Company Name',
    owner: 'Owner Name',
    phone: '(XXX) XXX-XXXX',
    email: 'email@example.com',
    address: 'City, State',
    logo: null,  // URL to logo image or null
    colors: {
      primary: '#0066cc',
      accent: '#ff6600',
      navBg: '#003366'
    },
    services: ['Service 1', 'Service 2', 'Service 3'],
    serviceAreas: ['Area 1', 'Area 2', 'Area 3'],
    warranty: 'Warranty description',
    subscription: {
      plan: 'professional',
      status: 'active'
    },
    siteUrl: '/sites/company-id.html'
  }
];
```

Then run the script again:

```bash
node seed-companies.js
```

**Note:** Running the script will overwrite existing companies with the same ID. If you want to preserve existing data, modify the script to check if documents exist before writing.

## Troubleshooting

### "Error: Service account JSON not found"

- Check that GOOGLE_APPLICATION_CREDENTIALS environment variable is set correctly
- Verify the path to your service account key is correct
- On Windows, use backslashes in paths or wrap in single quotes

### "Error: Permission denied"

- Ensure your Firestore security rules allow writes
- Default rules in development allow all reads/writes
- Check that service account has proper permissions in IAM

### "Error: Cannot find module 'firebase-admin'"

```bash
cd C:\Users\jonat\nobigdealwithjoedeal.com\functions
npm install firebase-admin
```

### Script exits without output

- The script may have completed successfully but console output isn't showing
- Check Firestore Console to verify data was written
- Run with more verbose output:

```bash
node --trace-warnings seed-companies.js
```

## Resetting Company Data

To completely reset the companies collection:

1. Go to Firebase Console
2. Open Firestore Database
3. Click on the `companies` collection
4. Select each document and delete it
5. Re-run the seed script

Or modify the script to delete first:

```javascript
async function seedCompanies() {
  // Delete existing companies
  const batch = db.batch();
  const snapshot = await db.collection('companies').get();
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  
  // Then seed new data...
}
```

## Advanced: Custom Company Configuration

You can create a configuration file for easier management:

**companies-config.json:**

```json
[
  {
    "id": "nbd",
    "name": "No Big Deal Home Solutions",
    "owner": "Joe Deal",
    "phone": "(513) 827-5297",
    "email": "joe@nobigdeals.com",
    "address": "Cincinnati, OH"
  },
  {
    "id": "oaks",
    "name": "Oaks Roofing & Construction",
    "owner": "Scott Oaks",
    "phone": "(513) 827-5297",
    "email": "joe@oaksrfc.com",
    "address": "Goshen, OH"
  }
]
```

Then modify seed-companies.js to load from the config file:

```javascript
const companiesConfig = require('./companies-config.json');

const companiesData = companiesConfig.map(company => ({
  ...company,
  colors: { /* ... */ },
  services: [ /* ... */ ]
}));
```

## Automation: Seed on Deployment

To automatically seed companies when deploying to Firebase:

1. Add script to `package.json`:

```json
{
  "scripts": {
    "seed": "node seed-companies.js",
    "deploy": "npm run seed && firebase deploy"
  }
}
```

2. Run deployment:

```bash
npm run deploy
```

## Next Steps

After seeding companies:

1. Create users and assign them to companies (via Firestore user documents with `companyId` field)
2. Load `company-admin.js` in your web app
3. Initialize branding with `CompanyAdmin.getCurrentCompany()`
4. Test by logging in as different company users

## Questions?

See the main integration guide: `MULTI_TENANT_INTEGRATION.md`
