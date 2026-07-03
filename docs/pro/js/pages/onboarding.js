/**
 * NBD Pro — /pro/onboarding.html controller (PILLAR1 Phase 4).
 *
 * Post-signup wizard: a new self-serve tenant (createCompany, Phase 2) sets
 * its own brand — name, contact, seal/prefix, colors, logo — in one guided
 * pass, so the tenant is "real" (branded docs, correctly-routed lead alerts)
 * without Jo touching Firestore and without the rep hunting for Settings.
 *
 * Write shape matches Settings → Company Profile exactly:
 *   companyProfile/{companyId||uid} ← { letterhead top-levels, brand:{...} }
 * via setDoc(..., {merge:true}) — the same doc _saveCompanyProfile targets.
 * Empty fields are OMITTED, not written as '' — the M1 brand resolver
 * (company-profile.js _resolveBrand) treats "key present in the raw
 * override" as "the tenant set this", and blanks absent identity fields so
 * NBD's phone/logo/seal can never bleed onto another company's surfaces.
 *
 * Who never sees this page (redirected to the dashboard):
 *   - Joe's owner accounts (their brand IS the default),
 *   - invited reps (companyId claim points at someone else's tenant —
 *     the owner configures brand),
 *   - anyone already onboarded (users/{uid}.onboarded, set here; ?redo=1
 *     bypasses for QA/re-runs).
 */
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { connectEmulatorsIfLocal } from "../nbd-emulator-connect.js"; // localhost-only, no-op in prod

const firebaseConfig = {
  apiKey:            "AIzaSyDTrotINzl2YjdGbH25BpC-FPv8i_fXNvg",
  authDomain:        "nobigdeal-pro.firebaseapp.com",
  projectId:         "nobigdeal-pro",
  storageBucket:     "nobigdeal-pro.firebasestorage.app",
  messagingSenderId: "717435841570",
  appId:             "1:717435841570:web:c2338e11052c96fde02e7b"
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
try {
  if (typeof window.__NBD_APP_CHECK_KEY === 'string' && window.__NBD_APP_CHECK_KEY) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(window.__NBD_APP_CHECK_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  }
} catch (_) {}

const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
await connectEmulatorsIfLocal({ auth, db, functions });

// Mirror of dashboard-bootstrap's owner bypass — Joe's accounts ARE the NBD
// default brand; the wizard would only tempt an accidental brand override
// onto the production NBD profile.
const OWNER_EMAILS = ['jd@nobigdealwithjoedeal.com', 'jonathandeal459@gmail.com'];

const state = {
  user: null,
  claims: {},
  step: 1,
  sealTouched: false, // stop auto-deriving once the rep edits the seal
};

const $ = (id) => document.getElementById(id);
const toDashboard = () => window.location.replace('/pro/dashboard.html');

function showErr(msg) { const el = $('wizErr'); if (el) el.textContent = msg || ''; }

function setStep(n) {
  state.step = n;
  [1, 2, 3].forEach((i) => {
    const panel = $('step' + i);
    if (panel) panel.classList.toggle('active', i === n);
    const dot = $('dot' + i);
    if (dot) dot.classList.toggle('active', i <= n);
  });
  const labels = { 1: 'Company basics', 2: 'Your brand', 3: 'Review & finish' };
  const label = $('stepLabel');
  if (label) label.innerHTML = '<strong>Step ' + n + ' of 3</strong> — ' + labels[n];
  showErr('');
  if (n === 3) renderReview();
  try { window.scrollTo(0, 0); } catch (_) {}
}

// ── field readers ─────────────────────────────────────────────
const val = (id) => (($(id) && $(id).value) || '').trim();

function phoneDigits() {
  const d = val('obPhone').replace(/[^\d]/g, '');
  if (d.length === 10) return d;
  if (d.length === 11 && d[0] === '1') return d.slice(1);
  return '';
}

function deriveSeal(name) {
  const words = String(name || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  let seal = words.map(w => w[0]).join('').slice(0, 4);
  if (seal.length < 2 && words[0]) seal = words[0].slice(0, 3);
  return seal;
}

// ── validation per step ───────────────────────────────────────
function validateStep1() {
  const name = val('obName').replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 80) return 'Company name must be 2–80 characters.';
  const rawPhone = val('obPhone');
  if (rawPhone && !phoneDigits()) return 'Business phone should be a 10-digit US number.';
  return '';
}

function validateStep2() {
  const seal = val('obSeal').toUpperCase();
  if (seal) {
    if (!/^[A-Z0-9]{2,4}$/.test(seal)) return 'Initials must be 2–4 letters or digits.';
    // 'NBD' is the platform sentinel — lead routing and doc counters treat it
    // as Joe's own brand, so no tenant may claim it.
    if (seal === 'NBD') return "'NBD' is reserved — pick your own company's initials.";
  }
  const logo = val('obLogoUrl');
  if (logo && !/^https:\/\/.+/i.test(logo)) return 'Logo URL must start with https://';
  return '';
}

// ── review panel ──────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderReview() {
  const rows = [];
  const add = (k, v, swatch) => {
    if (!v) return;
    rows.push('<div class="review-row"><div class="rk">' + esc(k) + '</div><div class="rv">' + esc(v)
      + (swatch ? '<span class="swatch" style="background:' + esc(swatch) + '"></span>' : '')
      + '</div></div>');
  };
  add('Company', val('obName'));
  add('Display name', val('obDisplayName') || val('obName'));
  add('Phone', val('obPhone'));
  add('Email', val('obEmail'));
  add('Website', val('obWebsite'));
  add('Address', val('obAddress'));
  add('Service area', val('obServiceArea'));
  add('Seal / prefix', val('obSeal').toUpperCase());
  add('Tagline', val('obTagline'));
  add('Logo', val('obLogoUrl'));
  add('Primary color', val('obColorPrimary'), val('obColorPrimary'));
  add('Accent color', val('obColorAccent'), val('obColorAccent'));
  const list = $('reviewList');
  if (list) list.innerHTML = rows.join('');
}

// ── the write ─────────────────────────────────────────────────
function buildOverrides() {
  const name = val('obName').replace(/\s+/g, ' ');
  const display = (val('obDisplayName') || name).replace(/\s+/g, ' ');
  const phone = val('obPhone');
  const digits = phoneDigits();
  const email = val('obEmail').toLowerCase();
  const website = val('obWebsite').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  const address = val('obAddress');
  const serviceArea = val('obServiceArea');
  const seal = val('obSeal').toUpperCase();
  const tagline = val('obTagline');
  const logoUrl = val('obLogoUrl');

  // brand.contact — only the keys the rep actually set (M1: present = "mine").
  const contact = {};
  if (phone)  contact.phone = phone;
  if (email)  { contact.email = email; contact.alertEmail = email; }
  if (website) contact.website = website;
  if (address) contact.address = address;
  if (digits) contact.alertSms = '+1' + digits;

  const brand = {
    legalName: name,
    displayName: display,
    colors: {
      primary: val('obColorPrimary') || '#1E3A6E',
      accent:  val('obColorAccent')  || '#E8720C',
    },
  };
  if (seal)    { brand.seal = seal; brand.docPrefix = seal; }
  if (tagline)   brand.tagline = tagline;
  if (logoUrl)   brand.logoUrl = logoUrl;
  if (Object.keys(contact).length) brand.contact = contact;

  // Letterhead top-levels — what the doc generators and the Settings →
  // Company Profile panel read today. Kept in lockstep with brand.contact.
  const overrides = { brand, businessName: name };
  if (phone)   overrides.businessPhone = phone;
  if (email)   overrides.businessEmail = email;
  if (website) overrides.businessWebsite = website;
  if (address) overrides.businessAddress = address;
  if (serviceArea) overrides.serviceArea = serviceArea;
  return overrides;
}

async function finish() {
  const err1 = validateStep1();
  if (err1) { setStep(1); showErr(err1); return; }
  const err2 = validateStep2();
  if (err2) { setStep(2); showErr(err2); return; }

  const btn = $('finishBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  showErr('');
  try {
    const uid = state.user.uid;
    const companyKey = String(state.claims.companyId || uid);
    const overrides = buildOverrides();

    await setDoc(doc(db, 'companyProfile', companyKey), overrides, { merge: true });
    await setDoc(doc(db, 'users', uid), {
      onboarded: true,
      onboardedAt: serverTimestamp(),
      company: overrides.businessName,
    }, { merge: true });

    // Provisioning self-heal: if the register-page createCompany call didn't
    // land (offline, App Check hiccup), this account has no companyId claim
    // yet. Retry here — idempotent, and it refuses invited reps server-side.
    if (!state.claims.companyId) {
      try {
        const createCompanyFn = httpsCallable(functions, 'createCompany');
        await createCompanyFn({
          name: overrides.businessName,
          phone: val('obPhone'),
          serviceArea: val('obServiceArea'),
        });
        await state.user.getIdToken(true);
      } catch (e) {
        console.warn('createCompany retry failed (profile still saved):', e && e.message);
      }
    }
    toDashboard();
  } catch (e) {
    console.warn('onboarding save failed:', e);
    showErr('Could not save your setup — check your connection and try again. Nothing is lost; your answers are still on this page.');
    if (btn) { btn.disabled = false; btn.textContent = 'Finish Setup →'; }
  }
}

async function skip() {
  try {
    await setDoc(doc(db, 'users', state.user.uid), {
      onboarded: true,
      onboardedAt: serverTimestamp(),
      onboardingSkipped: true,
    }, { merge: true });
  } catch (_) { /* never trap the rep on this page */ }
  toDashboard();
}

// ── prefill ───────────────────────────────────────────────────
function setIfEmpty(id, value) {
  const el = $(id);
  if (el && !el.value && value) el.value = value;
}

async function prefill() {
  const uid = state.user.uid;
  setIfEmpty('obEmail', state.user.email || '');
  try {
    const uSnap = await getDoc(doc(db, 'users', uid));
    if (uSnap.exists()) {
      const u = uSnap.data() || {};
      setIfEmpty('obName', u.company || '');
    }
  } catch (_) {}
  if (!val('obName') && state.user.displayName) setIfEmpty('obName', state.user.displayName);
  try {
    const key = String(state.claims.companyId || uid);
    const pSnap = await getDoc(doc(db, 'companyProfile', key));
    if (pSnap.exists()) {
      const p = pSnap.data() || {};
      const b = p.brand || {};
      const c = b.contact || {};
      setIfEmpty('obName', b.legalName || p.businessName || '');
      setIfEmpty('obDisplayName', b.displayName || '');
      setIfEmpty('obPhone', c.phone || p.businessPhone || '');
      setIfEmpty('obEmail', c.email || p.businessEmail || '');
      setIfEmpty('obWebsite', c.website || p.businessWebsite || '');
      setIfEmpty('obAddress', c.address || p.businessAddress || '');
      setIfEmpty('obServiceArea', b.serviceArea || p.serviceArea || '');
      if (b.seal && b.seal !== 'NBD') { setIfEmpty('obSeal', b.seal); state.sealTouched = true; }
      setIfEmpty('obTagline', b.tagline || '');
      setIfEmpty('obLogoUrl', b.logoUrl || '');
    }
  } catch (_) {}
  if (!state.sealTouched && !val('obSeal')) {
    const el = $('obSeal');
    if (el) el.value = deriveSeal(val('obName'));
  }
}

// ── boot ──────────────────────────────────────────────────────
function wireEvents() {
  const s1 = $('step1');
  if (s1) s1.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = validateStep1();
    if (err) { showErr(err); return; }
    if (!state.sealTouched && !val('obSeal')) {
      const el = $('obSeal');
      if (el) el.value = deriveSeal(val('obName'));
    }
    setIfEmpty('obDisplayName', val('obName'));
    setStep(2);
  });

  const s2 = $('step2');
  if (s2) s2.addEventListener('submit', (e) => {
    e.preventDefault();
    const err = validateStep2();
    if (err) { showErr(err); return; }
    setStep(3);
  });

  const sealEl = $('obSeal');
  if (sealEl) sealEl.addEventListener('input', () => {
    state.sealTouched = true;
    sealEl.value = sealEl.value.toUpperCase();
  });

  document.addEventListener('click', (e) => {
    const btn = e.target && e.target.closest && e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (action === 'back') setStep(parseInt(btn.getAttribute('data-to'), 10) || 1);
    else if (action === 'skip') skip();
    else if (action === 'finish') finish();
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { window.location.replace('/pro/login.html'); return; }
  state.user = user;

  const emailLower = (user.email || '').trim().toLowerCase();
  if (OWNER_EMAILS.includes(emailLower)) { toDashboard(); return; }

  try {
    const tokenResult = await user.getIdTokenResult();
    state.claims = (tokenResult && tokenResult.claims) || {};
  } catch (_) { state.claims = {}; }

  // Invited rep — their owner configures the brand, not them.
  if (state.claims.companyId && state.claims.companyId !== user.uid) { toDashboard(); return; }

  // Already onboarded → dashboard, unless explicitly re-running (?redo=1).
  const redo = /[?&]redo=1/.test(window.location.search);
  if (!redo) {
    try {
      const uSnap = await getDoc(doc(db, 'users', user.uid));
      if (uSnap.exists() && (uSnap.data() || {}).onboarded === true) { toDashboard(); return; }
    } catch (_) { /* on read failure, show the wizard — it's harmless */ }
  }

  await prefill();
  const boot = $('bootMsg');
  if (boot) boot.style.display = 'none';
  setStep(1);
});

wireEvents();
