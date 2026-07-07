/**
 * functions/prefix-reservation.js — pure logic for reserveCompanyPrefix.
 * ═══════════════════════════════════════════════════════════════
 * Dependency-free (no firebase-* requires) so both the callable
 * (handlers/provisioning.js) and the unit tests can import it. The callable
 * supplies the Firestore transaction I/O; this module owns the DECISIONS:
 *   - validateSeal:      shape + reserved-word check for the requested prefix.
 *   - decideReservation: given the current registry + profile state, what should
 *                        the transaction do (claim / idempotent / reject)?
 *
 * Keeping the decision pure means the exact cross-tenant collision guarantee —
 * "a prefix already held by another company is rejected" — is unit-testable
 * without a functions emulator.
 */

'use strict';

// A customer-ID prefix is 2–4 upper alnum chars. 'NBD' is the platform sentinel
// (Joe's own brand + the legacy shared counter) and is never claimable via
// self-serve — it is seeded to the NBD tenant by migrate-docprefixes.js.
function validateSeal(raw) {
  const seal = String(raw || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,4}$/.test(seal)) {
    return { error: 'Initials must be 2-4 letters or digits.' };
  }
  if (seal === 'NBD') {
    return { error: "'NBD' is reserved - pick your own company's initials." };
  }
  return { seal };
}

/**
 * Decide what the reservation transaction should do.
 *
 * @param {object} state
 * @param {boolean} state.prefixExists   docPrefixes/{SEAL} already exists?
 * @param {string=} state.prefixOwner    companyId that owns it (if it exists)
 * @param {string=} state.existingPrefix this tenant's current brand.docPrefix
 * @param {string}  state.companyId       the caller's companyId (== uid for solo)
 * @param {string}  state.seal            the requested prefix (already validated)
 * @returns {{action:'claim'|'idempotent'|'reject', code?:string}}
 *   - 'claim'      → free slot, write the reservation + stamp the profile
 *   - 'idempotent' → already ours, no-op (re-stamp profile defensively)
 *   - 'reject' with code 'already-exists'      → held by a DIFFERENT tenant
 *   - 'reject' with code 'failed-precondition' → this tenant already holds a
 *                                                DIFFERENT prefix (no rotation)
 */
function decideReservation(state) {
  const { prefixExists, prefixOwner, existingPrefix, companyId, seal } = state;
  if (prefixExists) {
    if (prefixOwner === companyId) return { action: 'idempotent' };
    return { action: 'reject', code: 'already-exists' };
  }
  if (existingPrefix && existingPrefix !== seal) {
    return { action: 'reject', code: 'failed-precondition' };
  }
  return { action: 'claim' };
}

module.exports = { validateSeal, decideReservation };
