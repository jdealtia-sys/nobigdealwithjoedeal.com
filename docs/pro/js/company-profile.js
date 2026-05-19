/**
 * NBD Company Profile - shop-wide doc constants the rep can edit from Settings.
 *
 * Singleton stored at Firestore `companyProfile/main`. The defaults below
 * match the values that used to be hardcoded inside the doc generator
 * templates, so a rep who never touches Settings gets the same documents
 * they did before this module existed.
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
    codeJurisdiction: 'Kentucky Building Code (KBC)'
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

  window.NBD_COMPANY_PROFILE_DEFAULTS = NBD_COMPANY_PROFILE_DEFAULTS;
  window._companyProfile = deepMerge({}, NBD_COMPANY_PROFILE_DEFAULTS);

  // Hydrate from localStorage cache for instant render before Firestore
  // round-trips. The cache stores only the rep's overrides, not the full
  // profile, so old cached values survive default tweaks gracefully.
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const cached = JSON.parse(raw);
      window._companyProfile = deepMerge(NBD_COMPANY_PROFILE_DEFAULTS, cached || {});
    }
  } catch (_) { /* ignore */ }

  window._loadCompanyProfile = async function () {
    try {
      if (!window.db) return window._companyProfile;
      const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const snap = await getDoc(doc(window.db, 'companyProfile', 'main'));
      if (snap && snap.exists()) {
        const remote = snap.data() || {};
        window._companyProfile = deepMerge(NBD_COMPANY_PROFILE_DEFAULTS, remote);
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
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(overridesObj)); } catch (_) {}
    if (!window.db) return window._companyProfile;
    const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    await setDoc(doc(window.db, 'companyProfile', 'main'), overridesObj, { merge: true });
    return window._companyProfile;
  };
})();
