/**
 * Seed Script for Firestore Companies Collection
 * 
 * This script seeds the Firestore database with initial company records.
 * Run with: node seed-companies.js
 * 
 * Requires: firebase-admin SDK initialized
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin (ensure this is set up in your environment)
// The script assumes credentials are set via GOOGLE_APPLICATION_CREDENTIALS env var
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const Timestamp = admin.firestore.Timestamp;

/**
 * Company data to seed
 */
const companiesData = [
  {
    id: 'nbd',
    name: 'No Big Deal Home Solutions',
    owner: 'Joe Deal',
    phone: '(513) 827-5297',
    email: 'joe@nobigdeals.com',
    address: 'Cincinnati, OH',
    logo: null,
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
    subscription: {
      plan: 'professional',
      status: 'active'
    },
    siteUrl: '/sites/nbd.html',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  },
  {
    id: 'oaks',
    name: 'Oaks Roofing & Construction',
    owner: 'Scott Oaks',
    phone: '(513) 827-5297',
    email: 'joe@oaksrfc.com',
    address: 'Goshen, OH',
    logo: null,
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
    subscription: {
      plan: 'professional',
      status: 'active'
    },
    siteUrl: '/sites/oaks.html',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  }
];

/**
 * Seeds the companies collection
 */
async function seedCompanies() {
  console.log('🌱 Starting company data seeding...\n');

  try {
    for (const company of companiesData) {
      const docRef = db.collection('companies').doc(company.id);
      await docRef.set(company);
      console.log(`✅ Seeded company: ${company.name} (${company.id})`);
    }

    console.log('\n✅ All companies seeded successfully!');
    console.log('\nSeeded companies:');
    companiesData.forEach(c => {
      console.log(`  - ${c.name} (ID: ${c.id})`);
      console.log(`    Owner: ${c.owner}`);
      console.log(`    Email: ${c.email}`);
      console.log(`    Phone: ${c.phone}`);
    });

  } catch (error) {
    console.error('❌ Error seeding companies:', error);
    process.exit(1);
  }

  // Close the database connection
  await db.terminate();
  process.exit(0);
}

// Run the seed function
seedCompanies();
