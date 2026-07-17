/**
 * functions/customer-id.js — canonical customer-ID formatting (server side).
 * ═══════════════════════════════════════════════════════════════
 * The customerId is a tenant's short, human-facing handle for a customer
 * (e.g. 'OAK-0002-K3P9'). It is minted from a per-tenant counter and a
 * globally-reserved prefix (see docPrefixes/{PREFIX} + reserveCompanyPrefix).
 *
 * This module MUST stay byte-identical to the client mint helpers in
 * docs/pro/js/company-profile.js (window._custIdSalt / window._formatCustomerId)
 * — both the client and the server (backfillCustomerData) mint IDs, and they
 * must agree on format, or the same logical customer could get two different IDs.
 *
 *   custIdSalt(companyId)  → 4 upper-alnum chars, FNV-1a/32(companyId) in base36.
 *   formatCustomerId(...)  → 'NBD-0001' for the NBD prefix (legacy, un-salted,
 *                            NEVER changed) | 'OAK-0001-K3P9' for any other prefix.
 *
 * Why salt at all: the prefix registry already makes prefixes — and therefore
 * customerIds — globally unique. The salt is defense-in-depth: it bakes tenant
 * entropy into the ID string itself, so even a bypassed reservation can't
 * produce a cross-tenant customerId collision (which the public referral
 * endpoint resolves by exact match — a collision there misroutes a lead's PII
 * into the wrong tenant's CRM).
 */

'use strict';

// FNV-1a 32-bit → base36 → uppercase → 4 chars. Deterministic from companyId,
// no storage. Math.imul keeps the multiply in 32-bit two's-complement exactly
// as the browser does, so client + server produce identical output.
function custIdSalt(companyId) {
  const s = String(companyId || '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(4, '0').slice(-4);
}

// prefix: the reserved docPrefix ('NBD' for the platform tenant). seq: the next
// counter value (int). companyId: used only to derive the salt for non-NBD IDs.
function formatCustomerId(prefix, seq, companyId) {
  const p = prefix || 'NBD';
  const base = p + '-' + String(seq).padStart(4, '0');
  return (p === 'NBD') ? base : base + '-' + custIdSalt(companyId);
}

// ── Mint routing (gauntlet Batch 3) ─────────────────────────────────────
// Which (prefix, counter) a tenant mints from is gated on "is this the NBD
// platform tenant?" — NOT on whether the resolved prefix string is 'NBD'. A
// non-NBD tenant that never reserved a prefix used to resolve prefix 'NBD' +
// the shared 'customerIds' counter, minting NBD-branded IDs from NBD's own
// sequence. These three helpers are the server mirror of the client
// docs/pro/js/company-profile.js gate (_isNbdBrand / _deriveCustPrefix /
// _custIdPrefix / _custCounterId) and MUST stay byte-identical to it.
const NBD_LEGAL_NAME = 'No Big Deal Home Solutions';

// A brand is NBD (→ legacy shared counter + un-salted 'NBD-####') iff it
// carries no legalName or the canonical NBD legalName. Mirrors _isNbdBrand.
function isNbdBrand(brand) {
  return !brand || !brand.legalName || brand.legalName === NBD_LEGAL_NAME;
}

// Fallback docPrefix for a non-NBD tenant with no reserved prefix. Byte-
// identical to onboarding.js deriveSeal / client _deriveCustPrefix. Never
// 'NBD', never '' (→ 'CUS'), so the companyId salt still yields a unique,
// non-NBD-branded ID even before a formal reservation.
function deriveCustPrefix(brand) {
  const words = String((brand && brand.legalName) || '').toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  let seal = words.map(function (w) { return w[0]; }).join('').slice(0, 4);
  if (seal.length < 2 && words[0]) seal = words[0].slice(0, 3);
  if (!seal || seal === 'NBD') seal = 'CUS';
  return seal;
}

// Resolve { prefix, counterId } for a tenant, given its companyProfile.brand
// doc and companyId. NBD → { 'NBD', 'customerIds' } (legacy shared, unchanged);
// any non-NBD tenant → its reserved-or-derived prefix + a per-tenant counter.
function resolveCustMint(brand, companyId) {
  if (isNbdBrand(brand)) return { prefix: 'NBD', counterId: 'customerIds' };
  const prefix = (brand && brand.docPrefix) ? brand.docPrefix : deriveCustPrefix(brand);
  return { prefix: prefix, counterId: 'customerIds_' + String(companyId || prefix || '').toLowerCase() };
}

module.exports = { custIdSalt, formatCustomerId, isNbdBrand, deriveCustPrefix, resolveCustMint };
