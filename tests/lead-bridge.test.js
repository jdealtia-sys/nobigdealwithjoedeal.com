/**
 * tests/lead-bridge.test.js — public-lead → CRM bridge logic (Phase C, H-1).
 *
 * Pure unit test of functions/lead-bridge-logic.js: owner/tenant resolution,
 * field mapping, deterministic idempotency id. Zero deps (no emulator) — the
 * Firestore I/O lives in lead-bridge.js; everything tested here is pure.
 *
 * Run: node tests/lead-bridge.test.js
 */
'use strict';

const path = require('path');
const L = require(path.join(__dirname, '..', 'functions', 'lead-bridge-logic.js'));

let passed = 0, failed = 0; const fails = [];
function ok(name, cond) { if (cond) { passed++; console.log('  ✓ ' + name); } else { failed++; fails.push(name); console.log('  ✗ ' + name); } }

const NBD = '1phDvAVXHSg82wDLegAbQFq14Ci1';        // tenant-zero owner uid
const SCOTT = 'ScottOaksUid000000000000abcd';      // looks-like-uid (28 chars)

console.log('LEAD-BRIDGE — kinds bridged (4 high-intent only)');
ok('contact_leads bridged', !!L.BRIDGE_KINDS.contact_leads);
ok('estimate_leads bridged', !!L.BRIDGE_KINDS.estimate_leads);
ok('inspect_leads bridged', !!L.BRIDGE_KINDS.inspect_leads);
ok('free_roof_entries bridged', !!L.BRIDGE_KINDS.free_roof_entries);
ok('guide_leads NOT bridged (list-builder)', !L.BRIDGE_KINDS.guide_leads);
ok('storm_alert_subscribers NOT bridged', !L.BRIDGE_KINDS.storm_alert_subscribers);

console.log('\nLEAD-BRIDGE — owner/tenant resolution');
{
  // NBD: untagged → tenant-zero owner; solo => companyId == uid (byte-identical).
  const nbd = L.resolveBridgeTarget('', null, { nbdOwnerUid: NBD });
  ok('untagged → NBD owner', nbd && nbd.ownerUid === NBD);
  ok('untagged → companyId == NBD uid (solo)', nbd && nbd.companyId === NBD);

  // Oaks (slug companyId) with an explicit ownerId on the company doc.
  const oaks = L.resolveBridgeTarget('oaks', { ownerId: SCOTT }, { nbdOwnerUid: NBD });
  ok('oaks + ownerId → Scott owner', oaks && oaks.ownerUid === SCOTT);
  ok('oaks keeps companyId "oaks"', oaks && oaks.companyId === 'oaks');

  // Oaks slug but NO ownerId set yet → unresolvable → skip (never guess).
  const oaksNoOwner = L.resolveBridgeTarget('oaks', null, { nbdOwnerUid: NBD });
  ok('oaks w/o ownerId → null (skip, no guess)', oaksNoOwner === null);

  // Solo tenant whose companyId IS their uid (no company doc) → owns itself.
  const soloUid = L.resolveBridgeTarget(SCOTT, null, { nbdOwnerUid: NBD });
  ok('uid-shaped companyId → owns itself', soloUid && soloUid.ownerUid === SCOTT && soloUid.companyId === SCOTT);

  // No nbdOwnerUid configured + untagged → null (defensive).
  ok('untagged w/o nbd owner → null', L.resolveBridgeTarget('', null, {}) === null);

  ok('looksLikeUid: 28-char uid true', L.looksLikeUid(NBD) === true);
  ok('looksLikeUid: "oaks" false', L.looksLikeUid('oaks') === false);
}

console.log('\nLEAD-BRIDGE — idempotency id (deterministic)');
{
  const a = L.bridgeDocId('inspect_leads', 'abc123');
  ok('deterministic id', a === 'inspect_leads__abc123');
  ok('same inputs → same id', a === L.bridgeDocId('inspect_leads', 'abc123'));
  ok('different source → different id', a !== L.bridgeDocId('inspect_leads', 'xyz789'));
}

console.log('\nLEAD-BRIDGE — public lead → CRM leads doc mapping');
{
  // /inspect lead (single `name`, story, photoCount) — NBD untagged.
  const inspect = L.mapPublicLeadToLead({
    collection: 'inspect_leads', sourceId: 'src1',
    ownerUid: NBD, companyId: NBD,
    data: { name: 'Jane Homeowner', phone: '8594207382', address: '12 Oak St, Batavia OH',
            email: 'jane@example.com', story: 'Hail last week', photoCount: 4, source: 'qr-inspect' },
  });
  ok('inspect: userId = owner', inspect.userId === NBD);
  ok('inspect: companyId stamped', inspect.companyId === NBD);
  ok('inspect: firstName split', inspect.firstName === 'Jane');
  ok('inspect: lastName split', inspect.lastName === 'Homeowner');
  ok('inspect: phone mapped', inspect.phone === '8594207382');
  ok('inspect: address mapped', inspect.address === '12 Oak St, Batavia OH');
  ok('inspect: stage New', inspect.stage === 'New');
  ok('inspect: source label', inspect.source === 'Website — Inspection / Storm tool');
  ok('inspect: webLead flag', inspect.webLead === true);
  ok('inspect: provenance kind', inspect.publicLeadKind === 'inspect');
  ok('inspect: provenance collection', inspect.publicLeadCollection === 'inspect_leads');
  ok('inspect: provenance id', inspect.publicLeadId === 'src1');
  ok('inspect: notes carry story', /Hail last week/.test(inspect.notes));
  ok('inspect: notes carry photo count', /4 photo/.test(inspect.notes));
  ok('inspect: no undefined values', Object.values(inspect).every(v => v !== undefined));

  // contact lead already has firstName (no `name`) — Oaks tenant.
  const contact = L.mapPublicLeadToLead({
    collection: 'contact_leads', sourceId: 'src2',
    ownerUid: SCOTT, companyId: 'oaks',
    data: { firstName: 'Bob', phone: '5135550100', source: 'website', companyId: 'oaks' },
  });
  ok('contact: keeps firstName', contact.firstName === 'Bob');
  ok('contact: empty lastName ok', contact.lastName === '');
  ok('contact: Oaks owner + companyId', contact.userId === SCOTT && contact.companyId === 'oaks');
  ok('contact: source label', contact.source === 'Website — Contact form');

  // free_roof nomination — nomineeName + nominator context.
  const roof = L.mapPublicLeadToLead({
    collection: 'free_roof_entries', sourceId: 'src3',
    ownerUid: NBD, companyId: NBD,
    data: { nomineeName: 'Grandma Smith', phone: '5135550111', address: '9 Elm', story: 'She needs it',
            nominatorName: 'Tim', nominatorRelation: 'grandson' },
  });
  ok('free_roof: nominee → firstName/lastName', roof.firstName === 'Grandma' && roof.lastName === 'Smith');
  ok('free_roof: notes carry nominator', /Nominated by Tim \(grandson\)/.test(roof.notes));
  ok('free_roof: notes flag giveaway', /One Free Roof/.test(roof.notes));

  // missing name → safe placeholder, never blank/undefined.
  const blank = L.mapPublicLeadToLead({ collection: 'contact_leads', sourceId: 's', ownerUid: NBD, companyId: NBD, data: {} });
  ok('blank: firstName placeholder', blank.firstName === '(Web lead)');

  // utm passthrough only when present.
  const utm = L.mapPublicLeadToLead({ collection: 'estimate_leads', sourceId: 's', ownerUid: NBD, companyId: NBD,
    data: { address: '1 A St', utm_source: 'google', utm_medium: 'cpc' } });
  ok('utm: source mapped when present', utm.utmSource === 'google');
  ok('utm: campaign absent when not sent', !('utmCampaign' in utm));
}

console.log('\n──────────────────────────────────────────────────');
console.log(`${passed} passed, ${failed} failed`);
if (failed) { console.log('\nFailures:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
console.log('✓ All lead-bridge logic tests passed');
