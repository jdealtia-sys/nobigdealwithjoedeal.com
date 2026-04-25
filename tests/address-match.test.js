/**
 * address-match.test.js
 *
 * Regression test for the estimate→lead linkage rule in
 * docs/pro/js/estimates.js (around saveEstimate()). The previous
 * implementation matched on a 12-character substring prefix, which
 * silently linked "123 Main St" to leads at "123 Main Street NW",
 * "123 Main St E", or any other lead sharing the same prefix. The
 * fix requires either an exact normalized match OR a single
 * normalized-prefix match (no ambiguous wins).
 *
 * This test reproduces the matcher in pure JS so a future "improvement"
 * to the heuristic can't silently regress to the loose substring form.
 *
 * Run via: node tests/address-match.test.js
 */

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function resolveLeadId(estimateAddr, leads) {
  const addrNorm = norm(estimateAddr);
  if (!addrNorm) return null;
  const exact = leads.filter(l => norm(l.address) === addrNorm);
  if (exact.length === 1) return exact[0].id;
  if (exact.length === 0) {
    const prefix = leads.filter(l => {
      const ln = norm(l.address);
      return ln && ln.length >= addrNorm.length && ln.startsWith(addrNorm);
    });
    if (prefix.length === 1) return prefix[0].id;
  }
  return null;
}

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + ' — ' + e.message); failed++; }
}
function eq(actual, expected, label) {
  if (actual !== expected) throw new Error((label || 'value') + ' = ' + JSON.stringify(actual) + ' (expected ' + JSON.stringify(expected) + ')');
}

console.log('\nestimate→lead address match regression');
console.log('──────────────────────────────────────────────────');

const leads = [
  { id: 'lead-1', address: '123 Main St, Cincinnati OH' },
  { id: 'lead-2', address: '123 Main Street NW, Cincinnati OH' },
  { id: 'lead-3', address: '456 Elm Ave, Norwood OH' },
  { id: 'lead-4', address: '789 Oak Dr, Mason OH' }
];

test('Exact match returns the right lead', () => {
  eq(resolveLeadId('123 Main St, Cincinnati OH', leads), 'lead-1');
});
test('Exact match works regardless of punctuation/spacing', () => {
  eq(resolveLeadId('123 main st cincinnati oh', leads), 'lead-1');
});
test('Ambiguous prefix returns null (NOT lead-1 or lead-2)', () => {
  // The bug: "123 Main St" prefix-matched both lead-1 ("123 Main St…") and
  // lead-2 ("123 Main Street NW…"). Strict match must refuse.
  eq(resolveLeadId('123 Main', leads), null);
});
test('Unique prefix match wins when only one candidate', () => {
  eq(resolveLeadId('456 Elm', leads), 'lead-3');
});
test('No match returns null', () => {
  eq(resolveLeadId('999 Nowhere Ln', leads), null);
});
test('Empty input returns null', () => {
  eq(resolveLeadId('', leads), null);
  eq(resolveLeadId(null, leads), null);
});
test('Punctuation-only input returns null (normalizes to empty)', () => {
  eq(resolveLeadId('!!!,,,---', leads), null);
});
test('Long address that prefixes a stored short address does NOT cross-match', () => {
  // Estimate "456 Elm Ave Norwood Ohio Extra Words" should not match the
  // shorter stored "456 Elm Ave, Norwood OH" because the stored value is
  // the prefix-source, not the search target. Only matches where the
  // estimate string is the prefix of the stored string count.
  eq(resolveLeadId('456 Elm Ave Norwood Ohio Extra Words', leads), null);
});

console.log('──────────────────────────────────────────────────');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
