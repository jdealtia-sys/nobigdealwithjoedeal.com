/**
 * NBD Marketing — shared Firebase bootstrap for every marketing-site page.
 *
 * Replaces the compat SDK pattern:
 *
 *   <script src=".../firebase-app-compat.js"></script>
 *   <script src=".../firebase-firestore-compat.js"></script>
 *   <script>
 *     firebase.initializeApp({ ... });
 *     const db = firebase.firestore();
 *   </script>
 *
 * …with a single external module that:
 *   1. Initializes the `nobigdealwithjoedeal` Firebase project via the
 *      modular v10 SDK.
 *   2. Attaches Firebase App Check (reCAPTCHA Enterprise) so form-write
 *      abuse can be blocked at the infrastructure layer, not just by
 *      firestore.rules shape checks.
 *   3. Exposes a small `submitMarketingLead(data)` helper that every host
 *      page's contact form can call, regardless of how the form is wired
 *      in the surrounding HTML.
 *
 * The legacy `window.db` global is still provided for backwards compat
 * with inline form handlers in host HTML, but all new code should import
 * `submitMarketingLead` from this module.
 *
 * STRICT CSP:
 * This module is loaded via `<script type="module" src=".../marketing-firebase.js">`
 * so no inline `<script>` block is required. The matching `firebase.json`
 * header for marketing-site paths drops `'unsafe-inline'` from script-src.
 *
 * APP CHECK SITE KEY:
 * Joe registers the marketing project for App Check in the Firebase Console
 * and hardcodes the reCAPTCHA Enterprise site key in `MARKETING_RECAPTCHA_SITE_KEY`
 * below. Until that happens the helper initializes without App Check and
 * logs a warning — the Firestore writes will still work because the rules
 * don't yet enforce App Check tokens on the `leads` collection, but Joe
 * should flip App Check enforcement on as soon as the key is set.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js';
import { getFirestore, collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// Marketing project — NOT nobigdeal-pro. These two Firebase projects are
// intentionally separate; do not merge them.
const firebaseConfig = {
  apiKey: 'AIzaSyDmDhacGOipy1JRfprrFcEBqKLfUZ8meYQ',
  authDomain: 'nobigdealwithjoedeal.firebaseapp.com',
  projectId: 'nobigdealwithjoedeal',
  storageBucket: 'nobigdealwithjoedeal.firebasestorage.app',
  messagingSenderId: '140387052359',
  appId: '1:140387052359:web:e95a34024e498e16e6e1a1'
};

// reCAPTCHA Enterprise site key for App Check enforcement. Set this once
// Joe has registered the marketing project in the Firebase Console.
// Until it's set, App Check init is skipped with a console warning.
const MARKETING_RECAPTCHA_SITE_KEY = '';

const app = initializeApp(firebaseConfig);

if (MARKETING_RECAPTCHA_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(MARKETING_RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.warn('marketing App Check init failed:', e);
  }
} else if (typeof console !== 'undefined') {
  console.warn('marketing-firebase: App Check not configured. Set MARKETING_RECAPTCHA_SITE_KEY in docs/sites/js/marketing-firebase.js once reCAPTCHA Enterprise is registered.');
}

const db = getFirestore(app);

// Back-compat global — legacy inline handlers in some host HTML pages
// still reference `window.db.collection('leads').add(...)` via the compat
// API. We cannot provide that exact shape, but we can expose the modular
// db so future code can migrate cleanly.
window._nbdMarketingDb = db;

/**
 * Submit a lead to the marketing-project `leads` collection.
 *
 * `data` should be a plain object — the firestore.rules for the marketing
 * project enforce shape + size + status allowlist. This helper adds:
 *   - `status: 'new'`
 *   - `createdAt: serverTimestamp()`
 *   - a minimal `source: 'website'` fallback if absent
 *
 * Returns the newly-created doc id on success, throws otherwise.
 */
export async function submitMarketingLead(data) {
  if (!data || typeof data !== 'object') throw new Error('data required');

  // Trim every string field to something sane before shipping it to
  // Firestore — avoids accidentally tripping the size caps in the rules.
  const clean = {};
  for (const [k, v] of Object.entries(data)) {
    if (v == null) continue;
    if (typeof v === 'string') clean[k] = v.slice(0, 3900);
    else clean[k] = v;
  }

  const payload = {
    source: 'website',
    status: 'new',
    createdAt: serverTimestamp(),
    ...clean,
  };

  const ref = await addDoc(collection(db, 'leads'), payload);
  return ref.id;
}

// Re-export the raw modular primitives for the odd host page that wants to
// do its own write (eg. a dedicated guide-request form that writes to a
// different collection).
export { db, collection, addDoc, serverTimestamp };
