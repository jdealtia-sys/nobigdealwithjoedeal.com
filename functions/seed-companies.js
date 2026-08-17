/**
 * Seed Script for Firestore Companies Collection
 * 
 * This script seeds the Firestore database with initial company records.
 * Run with: node seed-companies.js
 * 
 * Requires: firebase-admin SDK initialized
 */

const admin = require('firebase-admin');
const { Timestamp, getFirestore } = require('firebase-admin/firestore');
const { getApps } = require('firebase-admin/app');

// Initialize Firebase Admin (ensure this is set up in your environment)
// The script assumes credentials are set via GOOGLE_APPLICATION_CREDENTIALS env var
if (!getApps().length) {
  admin.initializeApp();
}

const db = getFirestore();

/**
 * Company data to seed
 *
 * `siteUrl` is DESCRIPTIVE ONLY — nothing in the codebase reads it. It records
 * where a company's public site lives. Until Jo's 2026-07-04 Pillar 5 cutover
 * that was a hand-authored page under docs/sites/; both entries still pointed
 * at that era (`/sites/oaks.html`, deleted with the retired page, and
 * `/sites/nbd.html`, which never existed on disk at all). Both now name the
 * data-driven tenant microsite at /sites/t/<companyId>.
 *
 * Why `/sites/t/<id>` resolves: getPublicSiteConfig looks the key up as the
 * companies/{id} DOC ID first and only falls back to a siteSlug equality query
 * (functions/handlers/public-site.js:117-121), so the doc id alone is enough.
 *
 * ⚠ RUNNING THIS SEED PUBLISHES THE MICROSITE. getPublicSiteConfig serves any
 * companies/{id} whose `status` is 'active' or ABSENT (public-site.js:126-131),
 * and neither record below sets `status`. So seeding makes /sites/t/nbd and
 * /sites/t/oaks answer to anyone who requests them — the ids are short guessable
 * words, not the unguessable auth uids the endpoint's header assumes. The pages
 * are X-Robots-Tag noindex (firebase.json), which keeps them out of search
 * results but does NOT make them private. A tenant site is a deliberate release
 * to that company; until then set `status` to anything other than 'active' on
 * its record. The payload is a public-marketing whitelist (name, tagline, logo,
 * colors, serviceArea, contact, services) — no lead routing, integrations,
 * pricing, or CRM data — but the tenant's existence and contact details are the
 * disclosure.
 *
 * Do NOT "improve" this by seeding a `siteSlug` here to get a prettier URL.
 * siteSlug is the optional alias and is claimed transactionally against
 * siteSlugs/{slug} by setSiteSlug; writing it directly bypasses the uniqueness
 * claim that exists to stop two owners taking the same slug.
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
      plan: 'growth',
      status: 'active'
    },
    siteUrl: '/sites/t/nbd',
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
      plan: 'growth',
      status: 'active'
    },
    siteUrl: '/sites/t/oaks',
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
