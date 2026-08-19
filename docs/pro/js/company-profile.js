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

    /* ── JOB BUDGET ALERTS ─────────────────────────────────────
       Per-tenant thresholds for the Expenses view's per-job cost
       flags. Mirrors ExpenseConfig.BUDGET (docs/pro/js/expense-config.js)
       so unconfigured tenants keep the 65/30 industry defaults;
       budgetStatus() falls back per-field on any invalid value. */
    budgetDefaults: {
      directCostPctWarn: 65,   // amber ⚠ when direct cost ≥ this % of contract value
      marginFloorPct:    30    // red ⚠ when projected gross margin < this %
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
    financePartner: 'Acorn Finance',
    // apr 0 = "rate set by the lender" sentinel (see renderFinancingOptions in
    // document-generator-templates.js): the Acorn marketplace doesn't give the
    // contractor fixed terms, so defaults must not fabricate APRs or badges on
    // customer paper. Enter real APRs only for a genuine fixed-rate program.
    financingTiers: [
      { months: 12, apr: 0, label: '12 Months', badge: 'Short Term', color: '#16a34a' },
      { months: 36, apr: 0, label: '36 Months', badge: 'Mid Term',   color: '#0ea5e9' },
      { months: 60, apr: 0, label: '60 Months', badge: 'Long Term',  color: '#7c3aed' }
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
      { icon: '💰',  title: 'Flexible Financing',    desc: 'Affordable monthly payments through our partnership with Acorn Finance.' }
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
      // The tagline documents actually carry. Was "No Big Deal with Joe Deal —
      // seriously, it's in the name.", which matched neither the document
      // generator's literal nor the stored companyProfile — stale default.
      tagline:     "No Big Deal — We've Got You Covered",
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
        // The DOCUMENTS/portal address, not the marketing one. NBD runs two on
        // purpose: jd@ is the public marketing contact (docs/ pages, lead
        // alerts), info@ is what customer documents carry — including the Zelle
        // payment instruction on invoices. Do not unify these.
        email:      'info@nobigdealwithjoedeal.com',
        website:    'nobigdealwithjoedeal.com',
        // Documents have never printed a company address; keep that. The
        // letterhead address lives on companyProfile.businessAddress and feeds
        // the public microsite payload, not the document letterhead.
        address:    '',
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
  // The cache is tenant-SCOPED (CACHE_KEY + ':' + tenantKey). A single global
  // key bled the last tenant's legal text / financing APRs / budgetDefaults into
  // the next tenant's generated documents when two tenants share a browser
  // (e.g. Jo testing NBD then signing in as Oaks). Only ever read/write the
  // keyed variant, and only once the tenant key is known.
  function _cacheKeyFor(k) { return CACHE_KEY + ':' + k; }

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
  // Exported so per-tenant writers outside this module (e.g. the custom-
  // jurisdictions full-replace in dashboard-bootstrap) target the SAME doc
  // key as _saveCompanyProfile — a divergent key means the merge-write and
  // the replace-write hit different docs and deleted rows resurrect.
  window._resolveCompanyKey = _resolveCompanyKey;

  window.NBD_COMPANY_PROFILE_DEFAULTS = NBD_COMPANY_PROFILE_DEFAULTS;
  window._companyProfile = deepMerge({}, NBD_COMPANY_PROFILE_DEFAULTS);

  // Do NOT hydrate from cache here: at module-parse time the tenant key isn't
  // known yet, so reading a cache would risk loading the PREVIOUS tenant's
  // overrides into this session's documents. _loadCompanyProfile hydrates the
  // tenant-keyed cache once the key resolves. Purge any legacy un-keyed cache.
  try { localStorage.removeItem(CACHE_KEY); } catch (_) { /* ignore */ }

  window._loadCompanyProfile = async function () {
    try {
      if (!window.db) return window._companyProfile;
      const key = await _resolveCompanyKey();
      if (!key) return window._companyProfile; // not signed in yet — defaults stand
      // Reset to defaults, then hydrate THIS tenant's cache (instant render)
      // before the network read — so a prior tenant's in-memory or cached
      // overrides can't survive into this tenant's session.
      window._companyProfile = deepMerge({}, NBD_COMPANY_PROFILE_DEFAULTS);
      _brandOverrideRaw = null;
      try {
        const cachedRaw = localStorage.getItem(_cacheKeyFor(key));
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw) || {};
          window._companyProfile = deepMerge(NBD_COMPANY_PROFILE_DEFAULTS, cached);
          _brandOverrideRaw = cached.brand || null;
        }
      } catch (_) { /* ignore */ }
      const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      // QA 2026-06-21 #1: on a cold boot the Firestore WebChannel can still be
      // establishing, so this first getDoc throws "client is offline" and the
      // feature silently fell back to localStorage/defaults until a reload.
      // Retry the transient before giving up. nbdRetryOffline is defined
      // idempotently here so boot-script load order can't matter.
      window.nbdRetryOffline = window.nbdRetryOffline || async function (fn, tries, delay) {
        tries = tries || 3; delay = delay || 800;
        for (let i = 0; ; i++) {
          try { return await fn(); }
          catch (e) {
            const m = ((e && (e.code || e.message)) || '') + '';
            if (i >= tries - 1 || !/offline|unavailable|deadline|backend|network/i.test(m)) throw e;
            await new Promise(r => setTimeout(r, delay * (i + 1)));
          }
        }
      };
      const snap = await window.nbdRetryOffline(() => getDoc(doc(window.db, 'companyProfile', key)));
      if (snap && snap.exists()) {
        const remote = snap.data() || {};
        window._companyProfile = deepMerge(NBD_COMPANY_PROFILE_DEFAULTS, remote);
        _brandOverrideRaw = (remote && remote.brand) || null;
        try { localStorage.setItem(_cacheKeyFor(key), JSON.stringify(remote)); } catch (_) {}
      }
      // Hydration is DEFINITIVE only once the doc read succeeded (exists or
      // not). Destructive per-tenant writes (the custom-jurisdictions
      // full-replace) gate on this flag so a pre-hydration empty render can
      // never be saved as a tenant-wide wipe. A failed read leaves it unset.
      window._companyProfileLoaded = true;
    } catch (e) {
      console.warn('[company-profile] load failed:', e && e.message);
    }
    return window._companyProfile;
  };

  window._saveCompanyProfile = async function (overrides) {
    const overridesObj = overrides || {};
    // Resolve the tenant key up front so the cache read/write below is
    // tenant-scoped (no cross-tenant bleed).
    const key = window.db ? await _resolveCompanyKey() : null;
    // Merge onto the EXISTING remote overrides (this tenant's cache, not bare
    // defaults) so a PARTIAL save — e.g. just { pricing } from the Add-on Rates
    // editor — can't clobber unrelated fields (brand / legal / letterhead). This
    // mirrors the Firestore { merge:true } write below so in-memory matches server.
    let prevRemote = {};
    if (key) { try { prevRemote = JSON.parse(localStorage.getItem(_cacheKeyFor(key)) || '{}') || {}; } catch (_) {} }
    const mergedRemote = deepMerge(prevRemote, overridesObj);
    window._companyProfile = deepMerge(NBD_COMPANY_PROFILE_DEFAULTS, mergedRemote);
    if ('brand' in overridesObj) _brandOverrideRaw = overridesObj.brand || null;
    if (key) { try { localStorage.setItem(_cacheKeyFor(key), JSON.stringify(mergedRemote)); } catch (_) {} }
    if (!window.db) return window._companyProfile;
    if (!key) {
      // No resolvable tenant key — keep in-memory but don't write a mis-keyed
      // (rules-denied) doc or an un-keyed cache. The next save after auth is
      // ready persists it.
      console.warn('[company-profile] save skipped: no tenant key (auth not ready)');
      return window._companyProfile;
    }
    const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    // brand.docPrefix / brand.seal are the tenant's globally-reserved customer-ID
    // prefix — they're set ONLY by the reserveCompanyPrefix callable (admin SDK)
    // and are immutable to client writes (firestore.rules). A full-profile "save
    // everything" round-trip carries the loaded docPrefix back here; strip it from
    // the write so the (deep-merge) setDoc never touches it — otherwise the rules
    // guard would deny the whole save. In-memory/localStorage keep the value (the
    // mint helpers read it); only the Firestore payload is scrubbed.
    const writePayload = _stripReservedBrandKeys(overridesObj);
    await setDoc(doc(window.db, 'companyProfile', key), writePayload, { merge: true });
    return window._companyProfile;
  };

  // Returns a shallow clone of the overrides with brand.docPrefix / brand.seal
  // removed (they're callable-managed + client-immutable). Non-mutating.
  function _stripReservedBrandKeys(overridesObj) {
    if (!overridesObj || !overridesObj.brand || typeof overridesObj.brand !== 'object') return overridesObj;
    const brand = Object.assign({}, overridesObj.brand);
    if (!('docPrefix' in brand) && !('seal' in brand)) return overridesObj;
    delete brand.docPrefix;
    delete brand.seal;
    return Object.assign({}, overridesObj, { brand: brand });
  }

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

  // ── Per-tenant LEGAL text resolver (gauntlet Batch 3) ────────────
  // The top-level companyProfile legal/jurisdiction DEFAULTS (cancellation
  // statute, dispute governing law, building-code jurisdiction, service area,
  // and the clauses that name "NBD" as the contracting party) are deep-merged
  // for EVERY tenant — the brand-blanking in _resolveBrand() only covers
  // brand.*, never these top-level fields. Left alone, a stranger (non-NBD)
  // tenant's generated contract/proposal cites a Kentucky statute, binds
  // disputes to Kentucky law, references the Kentucky Building Code, and names
  // "NBD" as the contractor. _legal() returns the profile with those fields
  // made STATE-NEUTRAL (never jurisdictionally wrong — the 3-day rescission
  // RIGHT is preserved, only the KY citation is dropped) and the literal "NBD"
  // party-name substituted with the tenant's legalName — but ONLY for a
  // non-NBD tenant that did NOT override the field itself (a tenant override in
  // Settings > Legal Text always wins). NBD — and any unconfigured tenant whose
  // brand is still NBD — gets the profile untouched → byte-identical docs.
  //
  // "The tenant set this field" == its merged value differs from the NBD
  // default (value-diff). Every field handled here is a string, so === is safe.
  // Value-diff also SELF-HEALS a doc that a pre-fix Settings "save everything"
  // had frozen with the NBD/KY defaults as explicit overrides: an override that
  // merely echoes the default is indistinguishable from no override, and both
  // get the neutral variant — which is exactly what a non-NBD tenant wants.
  const _NEUTRAL_LEGAL = {
    cancellationStatute: '',
    cancellationContractClause:
      'The Homeowner has the right to cancel this agreement within three (3) business days of signature without penalty, as permitted by applicable state law. Any deposit paid will be refunded within 10 days of cancellation notice.',
    cancellationProposalShort:
      'You have the right to cancel this agreement within 3 days of signature without penalty, as permitted by applicable state law.',
    disputeResolutionClause:
      'In the event of dispute, both parties agree to attempt resolution through good faith negotiation. If negotiation fails, disputes shall be resolved through mediation or binding arbitration under the laws of the state in which the work is performed.',
    codeJurisdiction: 'applicable state and local building codes',
    serviceArea: ''
  };
  // Clauses whose NBD default names the literal "NBD" as the contracting party.
  // For a non-NBD tenant that kept the default, swap "NBD" for their legalName.
  const _PARTY_NAME_CLAUSES = [
    'changeOrderClause', 'insuranceAssignmentClause',
    'materialsWarrantyDisclaimer', 'limitationOfLiability'
  ];

  function _resolveLegal() {
    const profile = window._companyProfile || NBD_COMPANY_PROFILE_DEFAULTS;
    const brand = profile.brand || NBD_COMPANY_PROFILE_DEFAULTS.brand;
    if (_isNbdBrand(brand)) return profile; // NBD / unconfigured → untouched (byte-identical)
    const D = NBD_COMPANY_PROFILE_DEFAULTS;
    const tenantName = (brand && brand.legalName) || '';
    const out = Object.assign({}, profile);
    // Jurisdiction neutralization — only where the tenant kept the NBD default.
    Object.keys(_NEUTRAL_LEGAL).forEach(function (k) {
      if (out[k] === D[k]) out[k] = _NEUTRAL_LEGAL[k];
    });
    // Party-name substitution — only where the tenant kept the NBD default.
    if (tenantName) {
      _PARTY_NAME_CLAUSES.forEach(function (k) {
        if (out[k] === D[k]) out[k] = String(D[k]).replace(/\bNBD\b/g, tenantName);
      });
    }
    return out;
  }
  window._legal = function () { return _resolveLegal(); };

  // ── Per-tenant customer-ID minting (loose-end fix) ───────────────
  // Customer IDs were hardcoded 'NBD-####' from a single global
  // counters/customerIds doc. These helpers let each tenant mint its own
  // prefix + sequence WITHOUT changing NBD. The gate is the resolved
  // docPrefix: NBD (and any tenant that hasn't set a docPrefix) → the
  // original shared 'customerIds' doc + 'NBD' prefix, byte-identical and
  // never reset. A configured tenant (e.g. Oaks docPrefix 'OAK') →
  // counters/customerIds_<companyId> + its own prefix, so tenants never
  // share or collide a sequence.
  // Fallback docPrefix for a NON-NBD tenant that hasn't formally reserved one
  // (skipped onboarding / blanked the seal). Byte-identical to onboarding.js
  // deriveSeal so a later reserveCompanyPrefix yields the SAME prefix and no
  // customerId reformats mid-stream. Never 'NBD' (the platform sentinel) and
  // never '' — falls back to 'CUS' so the companyId-derived _custIdSalt suffix
  // still yields a globally-unique, non-NBD-branded ID.
  function _deriveCustPrefix() {
    const b = _resolveBrand();
    const words = String((b && b.legalName) || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
    let seal = words.map(function (w) { return w[0]; }).join('').slice(0, 4);
    if (seal.length < 2 && words[0]) seal = words[0].slice(0, 3);
    if (!seal || seal === 'NBD') seal = 'CUS';
    return seal;
  }
  // The gate is now "is this the NBD platform tenant?" (via _isNbdBrand), NOT
  // "does the resolved prefix STRING equal 'NBD'?". A non-NBD tenant that never
  // reserved a prefix used to resolve prefix 'NBD' + the shared 'customerIds'
  // counter — minting NBD-branded IDs from NBD's own sequence. Now only the
  // real NBD tenant touches the legacy shared counter / un-salted 'NBD-####';
  // every stranger mints from its own counter with a derived, salted prefix.
  window._custIdPrefix = function () {
    const b = _resolveBrand();
    if (_isNbdBrand(b)) return 'NBD';                       // ONLY the NBD platform tenant
    if (b && b.docPrefix) return b.docPrefix;               // a reserved prefix wins
    return _deriveCustPrefix();                             // non-NBD, unreserved → derived (never 'NBD')
  };
  window._custCounterId = function (companyId) {
    const b = _resolveBrand();
    if (_isNbdBrand(b)) return 'customerIds';               // NBD → legacy shared counter (unchanged)
    return 'customerIds_' + String(companyId || window._custIdPrefix() || '').toLowerCase();
  };

  // ── Customer-ID salt (defense-in-depth against prefix collision) ──
  // The prefix registry (docPrefixes/{PREFIX}, enforced by reserveCompanyPrefix)
  // makes prefixes globally unique, which alone makes every customerId unique.
  // The salt is a SECOND layer: a short, deterministic, companyId-derived suffix
  // baked into the ID string itself, so even if a prefix reservation were somehow
  // bypassed, two tenants can never mint the same customerId (and the public
  // referral endpoint — which resolves a lead by exact customerId match — can
  // never misroute across tenants). FNV-1a/32 → base36 → 4 upper-alnum chars.
  // MUST stay byte-identical to functions/customer-id.js:custIdSalt (server mints
  // the same IDs via the backfill). NBD keeps its legacy un-salted 'NBD-####'.
  window._custIdSalt = function (companyId) {
    const s = String(companyId || '');
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h >>> 0).toString(36).toUpperCase().padStart(4, '0').slice(-4);
  };
  // Canonical customer-ID formatter. Every mint site (dashboard + customer
  // bootstrap, server backfill) routes through this so the format never drifts.
  // NBD prefix → 'NBD-0001' (legacy, un-salted, NEVER changed). Any other
  // (registered) prefix → 'OAK-0001-K3P9'.
  window._formatCustomerId = function (prefix, seq, companyId) {
    const p = prefix || 'NBD';
    const base = p + '-' + String(seq).padStart(4, '0');
    return (p === 'NBD') ? base : base + '-' + window._custIdSalt(companyId);
  };

  // The RAW, un-merged tenant brand override (null for NBD / pre-auth). Lets a
  // consumer or a provisioning check see exactly which brand fields the tenant
  // has actually set, with no NBD defaults mixed in (review M1).
  window._brandOverride = function () { return _brandOverrideRaw; };
})();
