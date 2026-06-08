/**
 * scripts/backfill-oaks-brand.js — Phase A (TenantContext) Oaks brand backfill.
 *
 * Writes Oaks's real brand into `companyProfile/oaks.brand` so the TenantContext
 * resolver (window._brand() in docs/pro/js/company-profile.js) returns OAKS
 * branding for Oaks-tenant users instead of the NBD defaults. Deep-merges over
 * the NBD defaults client-side, so only the fields set here change for Oaks.
 *
 * ⚠ THIS WRITES TO PROD FIRESTORE. Jo runs this (Claude does not write prod).
 *   Auth: GOOGLE_APPLICATION_CREDENTIALS env var (same as seed-companies.js).
 *   Run:  node scripts/backfill-oaks-brand.js
 *
 * Tenant key note: `companyProfile/{companyId}`. Oaks users carry companyId
 * 'oaks' (companies/oaks). If Oaks's owner is a solo operator whose claim is
 * their uid instead, change OAKS_KEY to that uid.
 */
'use strict';

const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp();

const OAKS_KEY = 'oaks';

// Oaks's real brand, extracted from the live microsite (docs/sites/oaks/).
// NOTE: accent is #C2410C (burnt orange) — deliberately distinct from NBD's
// #E8720C per the 2026-06-07 brand-sweep decision. Swap if you/Scott prefer a
// different Oaks accent. The Oaks PUBLIC microsite (docs/sites/oaks/style.css)
// still uses #E8720C — changing the live partner site's color needs Scott's
// OK, so that's left for a separate call (this only affects generated docs).
const OAKS_BRAND = {
  brand: {
    displayName: 'Oaks Roofing & Construction',
    legalName:   'Oaks Roofing & Construction',
    seal:        'ORC',
    docPrefix:   'OAK',   // customer IDs / doc numbers: OAK-0001, OAK-WC-…
    tagline:     'Roofing, Siding, Gutters — 5-Year Labor Warranty on All Installs',
    smsSignOff:  'Scott from Oaks Roofing',
    logoUrl:     'https://nobigdealwithjoedeal.com/sites/oaks/logo-orange.svg',
    colors: {
      primary:   '#333333',  // charcoal (Oaks)
      secondary: '#1A1A1A',  // near-black (nav/hero)
      accent:    '#C2410C',  // Oaks burnt-orange — distinct from NBD's #E8720C (sweep decision)
      ink:       '#222222',
      charcoal:  '#1A1A1A',
      cream:     '#F5F5F5'
    },
    fonts: {
      display:    'Montserrat',
      body:       'Open Sans',
      docDisplay: 'Montserrat',
      docBody:    'Open Sans'
    },
    contact: {
      phone:      '(513) 827-5297',
      email:      'joe@oaksrfc.com',
      website:    'oaksroofingandconstruction.com',
      address:    'Goshen, OH',
      alertEmail: 'joe@oaksrfc.com',  // Phase C: route Oaks public leads to Scott, not Joe
      alertSms:   '+15138275297',     // Phase C: Oaks alert SMS (verify Scott's number)
      slackWebhook: ''                // Phase C: optional Oaks Slack lead alert
    },
    // Phase C: Oaks integration endpoints. TODO values are placeholders until
    // Oaks provisions its own. Empty/absent = fall through to the platform default.
    integrations: {
      twilioNumber: '',               // TODO: Oaks's own A2P-approved SMS number
      resendDomain: 'oaksrfc.com',    // Oaks sender domain (verify in Resend before relying on it)
      reviewUrl:    '',               // TODO: Oaks Google review link
      calLink:      ''                // TODO: Oaks Cal.com booking link
    }
  }
};

(async () => {
  const db = admin.firestore();
  await db.collection('companyProfile').doc(OAKS_KEY).set(OAKS_BRAND, { merge: true });
  console.log(`✅ Backfilled companyProfile/${OAKS_KEY}.brand (Oaks)`);
  await db.terminate();
  process.exit(0);
})().catch((e) => { console.error('❌ backfill failed:', e); process.exit(1); });
