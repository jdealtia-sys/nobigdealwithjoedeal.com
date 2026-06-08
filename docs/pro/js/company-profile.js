/**
 * NBD Company Profile - shop-wide doc constants the rep can edit from Settings.
 *
 * Stored per tenant at Firestore `companyProfile/{companyId}` (Phase-1 audit
 * fix — was a single global `companyProfile/main` readable+writable by any
 * authenticated user of any tenant). The doc key is the signed-in user's
 * companyId claim, falling back to their uid for solo operators (an owner's
 * uid equals the companyId their invited members carry, so the whole tenant
 * resolves to the same doc). The defaults below match the values that used
 * to be hardcoded inside the doc generator templates, so a rep who never
 * touches Settings gets the same documents they did before this module
 * existed.
 *
 * Exposes:
 *   window.NBD_COMPANY_PROFILE_DEFAULTS — canonical defaults
 *   window._companyProfile              — current merged profile (defaults + remote overrides)
 *   window._loadCompanyProfile()        — fetch from Firestore, set _companyProfile
 *   window._saveCompanyProfile(profile) — write to Firestore + localStorage cache
 */
(function () {
  'use strict';

  const NBD_COMPANY_PROFILE_DEFAULTS = {
    /* ── LETTERHEAD ────────────────────────────────────────────
       Identity fields that appear on every generated document.
       Empty defaults so the rep's own info wins as soon as they
       fill the Settings → Company Profile → Letterhead panel.
       Render functions fall through to NBDDocGen.COMPANY if any
       field is left blank, so docs are never broken. */
    businessName:    '',
    businessPhone:   '',
    businessEmail:   '',
    businessWebsite: '',
    businessAddress: '',
    businessLicense: '',

    /* ── ESTIMATE PRICING (shop-wide overrides) ────────────────────
       Per-tenant overrides for the per-SQ estimate rates. EMPTY by
       default so estimate-config.js (window.NBD_ESTIMATE_CONFIG) supplies
       the numbers; a forthcoming Settings → Estimates → Add-on Rates editor
       (Phase 2b) will write overrides here. The engine resolves
       companyProfile.pricing → config → inline fallback AT CALC TIME
       (estimate-builder-v2.js applyCompanyPricing). This is the INVERSE of the
       L-1 stale-localStorage trap: config is the default, the shop doc is the
       override, a saved localStorage snapshot never touches add-on pricing.
       NOTE: pricing.tierRates, when present, OVERRIDES the tier rate the existing
       Estimates editor writes to localStorage — the two must not both be live for
       the same field without a clear precedence story (resolved in Phase 2b). */
    pricing: {
      addonPrices: {},   // { steepPerSq, verySteepPerSq, ..., chimneyFlash, ... }
      tierRates:   {}     // { good, better, best }
      // dumpFee / tearOffExtraPerSq may also be set here (optional)
    },

    /* ── LEGAL TEXT ────────────────────────────────────────────── */
    cancellationWindowText: 'three (3) business days',
    cancellationStatute: 'Kentucky Revised Statutes § 367.390',
    cancellationContractClause:
      'The Homeowner has the right to cancel this agreement within three (3) business days of signature without penalty, as permitted by Kentucky Revised Statutes § 367.390. Any deposit paid will be refunded within 10 days of cancellation notice.',
    cancellationProposalShort:
      'You have the right to cancel this agreement within 3 days of signature without penalty (KY Residential Finance Law).',

    changeOrderClause:
      'Any changes to the original scope of work must be documented in writing and signed by both parties before work proceeds. All change orders will specify: description of work, cost adjustments, and timeline impacts. NBD reserves the right to adjust pricing and completion dates based on scope changes.',
    changeOrderClauseShort:
      'Any changes to the scope of work must be documented in writing and agreed upon before proceeding. Change orders will adjust pricing and timeline accordingly.',

    disputeResolutionClause:
      'In the event of dispute, both parties agree to attempt resolution through good faith negotiation. If negotiation fails, disputes shall be resolved through mediation or binding arbitration under Kentucky law.',

    insuranceAssignmentClause:
      'If this project is insurance-related, NBD is authorized to accept assignment of insurance proceeds as partial or full payment for work performed. Homeowner agrees to provide proof of insurance coverage and claim number.',

    entireAgreementClause:
      'This contract constitutes the entire agreement between parties and supersedes all prior negotiations, representations, or agreements. Any modifications must be made in writing and signed by both parties.',

    paymentTermsContract:
      'Fifty percent (50%) due upon contract execution; remaining balance due upon substantial completion of work.',
    paymentTermsProposal:
      '50% deposit due upon contract execution; balance due upon project completion. Insurance assignments accepted.',
    paymentMethodsNoCash:
      'All payments must be made by check, ACH transfer, or credit card. No cash payments accepted. Insurance assignment accepted. Material delays may extend timeline.',

    materialsWarrantyDisclaimer:
      'Material warranties are provided by manufacturers and are separate from NBD workmanship warranty. See warranty section below.',

    proposalValidityDays: 30,
    limitationOfLiability:
      "NBD's total liability shall not exceed the contract price. This proposal is valid for 30 days from date of issue.",

    latePaymentChargeText: '1.5% monthly finance charge',

    /* ── FINANCING ─────────────────────────────────────────────── */
    financePartner: 'Improvifi',
    financingTiers: [
      { months: 12, apr: 0,    label: '12 Months', badge: '0% Intro APR', color: '#16a34a' },
      { months: 36, apr: 6.99, label: '36 Months', badge: 'Low Rate',     color: '#0ea5e9' },
      { months: 60, apr: 9.99, label: '60 Months', badge: 'Extended',     color: '#7c3aed' }
    ],

    /* ── MARKETING / BRANDING ──────────────────────────────────── */
    tagline: "No Big Deal — We've Got You Covered",
    serviceArea: 'Greater Cincinnati & Northern Kentucky',
    services: [
      { icon: '🏠',  name: 'Roofing',         desc: 'Full replacements, repairs, and storm damage restoration' },
      { icon: '🧱',  name: 'Siding',          desc: 'Vinyl, fiber cement, LP SmartSide, and board & batten' },
      { icon: '🌧️', name: 'Gutters',         desc: 'Seamless gutters, guards, downspouts, and drainage' },
      { icon: '🪟',  name: 'Windows & Doors', desc: 'Energy-efficient upgrades and storm damage replacement' },
      { icon: '🎨',  name: 'Interior',        desc: 'Water damage repair, paint, drywall, flooring' },
      { icon: '⛈️', name: 'Storm Damage',    desc: 'Full insurance claim management from inspection to completion' }
    ],
    valueProps: [
      { icon: '🛡️', title: 'Warranty Protection',  desc: 'Up to lifetime workmanship warranty plus full manufacturer coverage on all materials.' },
      { icon: '📋',  title: 'Insurance Specialists', desc: 'We handle the entire insurance claim process so you can focus on what matters.' },
      { icon: '⭐',  title: '5-Star Service',        desc: 'Exceptional service from first contact through final walkthrough and beyond.' },
      { icon: '💰',  title: 'Flexible Financing',    desc: 'Affordable monthly payments through our partnership with Improvifi.' }
    ],

    /* ── CODE & JURISDICTION ───────────────────────────────────── */
    codeCycle: '2021 International Building Code (IBC)',
    codeJurisdiction: 'Kentucky Building Code (KBC)',

    /* ── BRAND — TenantContext backbone (Phase A, 2026-06-07) ───────
       The single per-tenant brand source of truth. Every brand-bearing
       surface (doc generators, customer portal, SMS/email copy, doc-number
       prefixes) should resolve from window._brand() / window._tenant().brand
       instead of a hardcoded NBD literal. These are the canonical NBD
       defaults; a tenant's companyProfile.brand override deep-merges on top,
       so NBD stays byte-identical until a tenant sets its own values.
       Fields not yet consumed by any surface are wired in later phases
       (B = brand into the renderers, C = contact.alert* into lead routing). */
    brand: {
      displayName: 'No Big Deal',
      legalName:   'No Big Deal Home Solutions',
      seal:        'NBD',
      docPrefix:   'NBD',   // customer IDs / doc numbers: NBD-0001, NBD-WC-…
      tagline:     "No Big Deal with Joe Deal — seriously, it's in the name.",
      smsSignOff:  'Joe from No Big Deal Roofing',
      logoUrl:     'https://nobigdealwithjoedeal.com/assets/images/nbd-logo.png',
      colors: {
        primary:   '#1E3A6E',  // navy
        secondary: '#142A52',  // navy-dark
        accent:    '#E8720C',  // orange (canonical)
        ink:       '#14181F',  // body text
        charcoal:  '#14181F',
        cream:     '#FAF7F2'
      },
      fonts: {
        display:    'Bebas Neue',       // marketing display
        body:       'Montserrat',       // marketing body
        docDisplay: 'Barlow Condensed', // PDF display
        docBody:    'Barlow'            // PDF body
      },
      contact: {
        phone:      '(859) 420-7382',
        email:      'jd@nobigdealwithjoedeal.com',
        website:    'nobigdealwithjoedeal.com',
        address:    'Greater Cincinnati, OH',
        alertEmail: 'jd@nobigdealwithjoedeal.com', // Phase C: public-lead alert recipient
        alertSms:   '+18594207382',                // Phase C: per-tenant alert SMS
        slackWebhook: ''                           // Phase C: optional per-tenant Slack lead alert (empty = none)
      },
      // Phase C: per-tenant integration endpoints. Empty string = "fall through
      // to the platform/global default" (NBD's global function secrets), so NBD
      // stays byte-identical; a tenant overrides any of these in its
      // companyProfile.brand.integrations. Not yet consumed by a surface beyond
      // documentation — lead routing reads brand.contact.* today.
      integrations: {
        twilioNumber: '',                                   // tenant's own A2P-approved SMS number (else global TWILIO_PHONE_NUMBER)
        resendDomain: 'nobigdealwithjoedeal.com',           // verified sender domain for outbound email
        reviewUrl:    'https://nobigdealwithjoedeal.com/r', // Google review redirect (/r 302)
        calLink:      ''                                    // tenant's Cal.com booking link
      }
    }
  };

  // Deep merge — arrays are replaced wholesale, objects merged key by key.
  // Arrays-as-replace is intentional: editing the services list should set
  // exactly N entries, not graft remote entries onto local defaults.
  function deepMerge(target, source) {
    if (!source || typeof source !== 'object') return target;
    if (Array.isArray(source)) return source.slice();
    const out = Object.assign({}, target);
    Object.keys(source).forEach((k) => {
      const sv = source[k];
      const tv = out[k];
      if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
        out[k] = deepMerge(tv, sv);
      } else if (Array.isArray(sv)) {
        out[k] = sv.slice();
      } else {
        out[k] = sv;
      }
    });
    return out;
  }

  const CACHE_KEY = 'nbd_company_profile_v1';

  // The tenant's RAW (un-merged) brand override, as written to
  // companyProfile/{key}.brand — NOT deep-merged onto the NBD defaults.
  // _brand() uses this to tell "the tenant set this field" from "the field
  // is just NBD's default showing through the merge", so a partially-
  // configured tenant never inherits NBD's phone/email/logo/seal (review M1).
  // null until a keyed load/cache/save populates it (i.e. NBD or pre-auth).
  let _brandOverrideRaw = null;

  // Resolve the per-tenant document key for `companyProfile/{key}`.
  //
  // Priority:
  //   1. window._userClaims.companyId — populated by dashboard-bootstrap
  //      (instant, no network).
  //   2. Live ID-token claims via getIdTokenResult() — works on customer.html
  //      and any page that exposes window.auth / window._user.
  //   3. uid — solo-operator convention (companyId == uid). An owner's uid is
  //      the companyId their invited members carry, so the tenant shares one
  //      doc. Matches `claims.companyId || uid` used across the backend.
  //
  // Returns null when no user is resolvable yet (not signed in / auth not
  // ready). Callers MUST treat null as "skip Firestore, keep defaults/cache"
  // so we never issue a guaranteed-denied read against a bad key.
  async function _resolveCompanyKey() {
    try {
      const cid = window._userClaims && window._userClaims.companyId;
      if (cid) return String(cid);
    } catch (_) { /* ignore */ }
    try {
      const u = (window.auth && window.auth.currentUser) || window._user || null;
      if (u && typeof u.getIdTokenResult === 'function') {
        const tr = await u.getIdTokenResult();
        const claimCid = tr && tr.claims && tr.claims.companyId;
        if (claimCid) return String(claimCid);
        if (u.uid) return u.uid;
      }
      if (u && u.uid) return u.uid;
    } catch (_) { /* ignore */ }
    return null;
  }

  window.NBD_COMPANY_PROFILE_DEFAULTS = NBD_COMPANY_PROFILE_DEFAULTS;
  window._companyProfile = deepMerge({}, NBD_COMPANY_PROFILE_DEFAULTS);

  // Hydrate from localStorage cache for instant render before Firestore
  // round-trips. The cache stores only the rep's overrides, not the full
  // profile, so old cached values survive default tweaks gracefully.
  // The cache is a render optimization only — Firestore rules are the
  // security boundary; the keyed load below overwrites this on auth-ready.
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      window._companyProfile = deepMerge(NBD_COMPANY_PROFILE_DEFAULTS, cached || {});
      _brandOverrideRaw = (cached && cached.brand) || null;
    }
  } catch (_) { /* ignore */ }

  window._loadCompanyProfile = async function () {
    try {
      if (!window.db) return window._companyProfile;
      const key = await _resolveCompanyKey();
      if (!key) return window._companyProfile; // not signed in yet — defaults/cache stand
      const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const snap = await getDoc(doc(window.db, 'companyProfile', key));
      if (snap && snap.exists()) {
        const remote = snap.data() || {};
        window._companyProfile = deepMerge(NBD_COMPANY_PROFILE_DEFAULTS, remote);
        _brandOverrideRaw = (remote && remote.brand) || null;
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(remote)); } catch (_) {}
      }
    } catch (e) {
      console.warn('[company-profile] load failed:', e && e.message);
    }
    return window._companyProfile;
  };

  window._saveCompanyProfile = async function (overrides) {
    const overridesObj = overrides || {};
    window._companyProfile = deepMerge(NBD_COMPANY_PROFILE_DEFAULTS, overridesObj);
    if ('brand' in overridesObj) _brandOverrideRaw = overridesObj.brand || null;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(overridesObj)); } catch (_) {}
    if (!window.db) return window._companyProfile;
    const key = await _resolveCompanyKey();
    if (!key) {
      // No resolvable tenant key — keep the local cache but don't write a
      // mis-keyed (and rules-denied) doc. The next save after auth is ready
      // persists it.
      console.warn('[company-profile] save skipped: no tenant key (auth not ready)');
      return window._companyProfile;
    }
    const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    await setDoc(doc(window.db, 'companyProfile', key), overridesObj, { merge: true });
    return window._companyProfile;
  };

  // ── TenantContext backbone (Phase A, 2026-06-07) ─────────────────
  // The one resolver every brand-bearing surface reads from, so brand is
  // resolved from the ACTIVE TENANT instead of a hardcoded NBD literal.
  //   window._brand()  → the merged brand (NBD defaults + this tenant's
  //                       companyProfile.brand overrides).
  //   window._tenant() → the fuller context later pillars hang off the same
  //                       resolution (lead routing, billing, domains).
  // Both are sync and read window._companyProfile (already merged by the
  // load path). Before auth/load they return NBD defaults — never null —
  // so a consumer can always render a brand.
  // A brand is "NBD" (and renders byte-identical) when it carries no legalName
  // or the canonical NBD legalName. Same gate the doc/PDF/portal consumers use.
  function _isNbdBrand(b) {
    const NBD = NBD_COMPANY_PROFILE_DEFAULTS.brand.legalName;
    return !b || !b.legalName || b.legalName === NBD;
  }

  // Top-level + contact identity fields a tenant must set for itself. For a
  // non-NBD tenant, any of these that the tenant did NOT explicitly provide is
  // blanked rather than left showing NBD's deep-merged default — so NBD's
  // phone/email/logo/seal/tagline can never bleed onto another company's docs,
  // portal, or alerts (review M1). displayName is special-cased to the tenant's
  // own legalName (never blank, never 'No Big Deal'). colors/fonts are cosmetic
  // and may inherit. NBD itself is returned untouched (byte-identical).
  const _IDENTITY_TOP     = ['seal', 'docPrefix', 'tagline', 'smsSignOff', 'logoUrl'];
  const _IDENTITY_CONTACT = ['phone', 'email', 'website', 'address', 'alertEmail', 'alertSms'];

  function _resolveBrand() {
    const profile = window._companyProfile || NBD_COMPANY_PROFILE_DEFAULTS;
    const merged = profile.brand || NBD_COMPANY_PROFILE_DEFAULTS.brand;
    if (_isNbdBrand(merged)) return merged; // NBD / unconfigured → full defaults
    // Non-NBD tenant: keep only what the tenant set itself (raw override),
    // blank the rest of the identity surface.
    const raw = _brandOverrideRaw || {};
    const rawContact = raw.contact || {};
    const out = Object.assign({}, merged);
    out.displayName = ('displayName' in raw) ? merged.displayName : (merged.legalName || '');
    _IDENTITY_TOP.forEach(function (k) { if (!(k in raw)) out[k] = ''; });
    out.contact = Object.assign({}, merged.contact);
    _IDENTITY_CONTACT.forEach(function (k) { if (!(k in rawContact)) out.contact[k] = ''; });
    return out;
  }

  window._tenant = function () {
    const profile = window._companyProfile || NBD_COMPANY_PROFILE_DEFAULTS;
    let companyId = null;
    try { companyId = (window._userClaims && window._userClaims.companyId) || null; } catch (_) { /* ignore */ }
    return {
      companyId: companyId,
      brand: _resolveBrand(),
      profile: profile
    };
  };
  window._brand = function () { return _resolveBrand(); };

  // ── Per-tenant customer-ID minting (loose-end fix) ───────────────
  // Customer IDs were hardcoded 'NBD-####' from a single global
  // counters/customerIds doc. These helpers let each tenant mint its own
  // prefix + sequence WITHOUT changing NBD. The gate is the resolved
  // docPrefix: NBD (and any tenant that hasn't set a docPrefix) → the
  // original shared 'customerIds' doc + 'NBD' prefix, byte-identical and
  // never reset. A configured tenant (e.g. Oaks docPrefix 'OAK') →
  // counters/customerIds_<companyId> + its own prefix, so tenants never
  // share or collide a sequence.
  window._custIdPrefix = function () {
    const b = _resolveBrand();
    return (b && b.docPrefix) ? b.docPrefix : 'NBD';
  };
  window._custCounterId = function (companyId) {
    const p = window._custIdPrefix();
    if (!p || p === 'NBD') return 'customerIds';            // NBD / unconfigured → legacy shared counter
    return 'customerIds_' + String(companyId || p).toLowerCase();
  };

  // The RAW, un-merged tenant brand override (null for NBD / pre-auth). Lets a
  // consumer or a provisioning check see exactly which brand fields the tenant
  // has actually set, with no NBD defaults mixed in (review M1).
  window._brandOverride = function () { return _brandOverrideRaw; };
})();
