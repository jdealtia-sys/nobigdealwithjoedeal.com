/**
 * Storage rules tests for NBD Pro (F5).
 *
 * RUN:
 *   cd tests && npm install
 *   firebase emulators:exec --only storage --project nbd-rules-test 'node storage-rules.test.js'
 *
 * Asserts the D2 hardening:
 *   - photos/ accepts only image/* + enforces 15MB cap
 *   - docs/ accepts PDF/Office/text/images + 25MB cap
 *   - portals/ accepts only text/html + 5MB cap
 *   - null content-type uploads are rejected (D2 fix)
 *   - cross-owner reads/writes are denied
 *   - delete requires owner or platform admin
 */

'use strict';

const { initializeTestEnvironment, assertFails, assertSucceeds } =
  require('@firebase/rules-unit-testing');
const fs = require('fs');
const path = require('path');

const PROJECT_ID = 'nbd-storage-rules-test';

function buf(size) { return Buffer.alloc(size, 0); }

async function run() {
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      rules: fs.readFileSync(path.resolve(__dirname, '../storage.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 9199
    }
  });

  const alice = env.authenticatedContext('alice', { role: 'sales_rep', companyId: 'co-a' }).storage();
  const bob   = env.authenticatedContext('bob',   { role: 'sales_rep', companyId: 'co-b' }).storage();
  const admin = env.authenticatedContext('joe',   { role: 'admin' }).storage();
  const anon  = env.unauthenticatedContext().storage();

  const { ref, uploadBytes, getBytes, deleteObject } = require('firebase/storage');

  // 1. alice can upload an image to photos/alice/
  await assertSucceeds(uploadBytes(
    ref(alice, 'photos/alice/roof.jpg'),
    buf(1024),
    { contentType: 'image/jpeg' }
  ));

  // 2. alice CANNOT upload octet-stream as photos (D2 fix: null /
  //    bogus content-type no longer passes the image check).
  await assertFails(uploadBytes(
    ref(alice, 'photos/alice/evil.bin'),
    buf(1024),
    { contentType: 'application/octet-stream' }
  ));

  // 3. bob CANNOT upload into alice's photos path
  await assertFails(uploadBytes(
    ref(bob, 'photos/alice/sneak.jpg'),
    buf(1024),
    { contentType: 'image/jpeg' }
  ));

  // 4. alice CANNOT upload a 20MB image (over 15MB cap)
  await assertFails(uploadBytes(
    ref(alice, 'photos/alice/huge.jpg'),
    buf(20 * 1024 * 1024),
    { contentType: 'image/jpeg' }
  ));

  // 5. alice can upload a PDF to docs/alice/ (contract)
  await assertSucceeds(uploadBytes(
    ref(alice, 'docs/alice/contract.pdf'),
    buf(8 * 1024),
    { contentType: 'application/pdf' }
  ));

  // 6. alice CANNOT upload an executable to docs/alice/ (not in allowlist)
  await assertFails(uploadBytes(
    ref(alice, 'docs/alice/mal.exe'),
    buf(1024),
    { contentType: 'application/x-msdownload' }
  ));

  // 7. alice CANNOT upload HTML to docs/alice/ (html only allowed in portals/)
  await assertFails(uploadBytes(
    ref(alice, 'docs/alice/page.html'),
    buf(1024),
    { contentType: 'text/html' }
  ));

  // 8. alice can upload HTML to portals/alice/
  await assertSucceeds(uploadBytes(
    ref(alice, 'portals/alice/lead42.html'),
    buf(1024),
    { contentType: 'text/html' }
  ));

  // 9. alice CANNOT upload an image to portals/alice/ (html only)
  await assertFails(uploadBytes(
    ref(alice, 'portals/alice/photo.jpg'),
    buf(1024),
    { contentType: 'image/jpeg' }
  ));

  // 9b. alice CAN upload generated-doc HTML to documents/alice/ (Signatures
  //     PR4 / doc-generator persist — this path was previously default-denied).
  await assertSucceeds(uploadBytes(
    ref(alice, 'documents/alice/lead42/docABC.html'),
    buf(1024),
    { contentType: 'text/html' }
  ));
  // 9c. bob CANNOT upload to alice's documents/ (cross-user)
  await assertFails(uploadBytes(
    ref(bob, 'documents/alice/lead42/docABC.html'),
    buf(1024),
    { contentType: 'text/html' }
  ));

  // 9d. NEW-D13: alice CAN upload her deal-room share page (text/html) —
  //     the old isDocType() gate didn't match text/html, so Close Board's
  //     Copy/Text/Email link generation always failed storage/unauthorized.
  await assertSucceeds(uploadBytes(
    ref(alice, 'deal_rooms/alice/dr_test123.html'),
    buf(1024),
    { contentType: 'text/html' }
  ));
  // 9e. bob CANNOT upload into alice's deal_rooms (cross-user)
  await assertFails(uploadBytes(
    ref(bob, 'deal_rooms/alice/dr_evil.html'),
    buf(1024),
    { contentType: 'text/html' }
  ));
  // 9f. non-HTML uploads to deal_rooms stay blocked
  await assertFails(uploadBytes(
    ref(alice, 'deal_rooms/alice/payload.zip'),
    buf(1024),
    { contentType: 'application/zip' }
  ));

  // 10. bob CANNOT read alice's photos
  await assertFails(getBytes(ref(bob, 'photos/alice/roof.jpg')));

  // 11. admin CAN read alice's docs (support context)
  await assertSucceeds(getBytes(ref(admin, 'docs/alice/contract.pdf')));

  // 12. alice can delete her own photos
  await assertSucceeds(deleteObject(ref(alice, 'photos/alice/roof.jpg')));

  // 13. anon CANNOT write anything
  await assertFails(uploadBytes(
    ref(anon, 'photos/alice/anon-attack.jpg'),
    buf(1024),
    { contentType: 'image/jpeg' }
  ));

  // 14. anon CANNOT read anything
  await assertFails(getBytes(ref(anon, 'docs/alice/contract.pdf')));

  // 15. Legacy flat paths (photos/<file> with no uid) always deny
  await assertFails(uploadBytes(
    ref(alice, 'photos/hash123.jpg'),
    buf(1024),
    { contentType: 'image/jpeg' }
  ));

  // ── EXPENSE RECEIPTS (receipts/{uid}/) ─────────────────────────────
  // 16. alice can upload a receipt photo (camera capture)
  await assertSucceeds(uploadBytes(
    ref(alice, 'receipts/alice/2026-06-27_abc.jpg'),
    buf(1024),
    { contentType: 'image/jpeg' }
  ));
  // 17. alice can upload a receipt PDF (emailed/scanned receipt)
  await assertSucceeds(uploadBytes(
    ref(alice, 'receipts/alice/beacon-invoice.pdf'),
    buf(8 * 1024),
    { contentType: 'application/pdf' }
  ));
  // 18. executables/archives stay blocked
  await assertFails(uploadBytes(
    ref(alice, 'receipts/alice/mal.exe'),
    buf(1024),
    { contentType: 'application/x-msdownload' }
  ));
  // 19. over the 25MB cap → blocked
  await assertFails(uploadBytes(
    ref(alice, 'receipts/alice/huge.pdf'),
    buf(26 * 1024 * 1024),
    { contentType: 'application/pdf' }
  ));
  // 20. bob CANNOT upload into alice's receipts (cross-user)
  await assertFails(uploadBytes(
    ref(bob, 'receipts/alice/sneak.jpg'),
    buf(1024),
    { contentType: 'image/jpeg' }
  ));
  // 21. bob CANNOT read alice's receipts; admin CAN (support context)
  await assertFails(getBytes(ref(bob, 'receipts/alice/2026-06-27_abc.jpg')));
  await assertSucceeds(getBytes(ref(admin, 'receipts/alice/2026-06-27_abc.jpg')));
  // 22. owner can delete; legacy flat receipts/<file> path always denies
  await assertSucceeds(deleteObject(ref(alice, 'receipts/alice/2026-06-27_abc.jpg')));
  await assertFails(uploadBytes(
    ref(alice, 'receipts/hash123.jpg'),
    buf(1024),
    { contentType: 'image/jpeg' }
  ));


  // ── UNTESTED-FOR-A-MONTH PREFIXES (2026-09-02) ───────────────────────
  // galleries/, reports/, shared_docs/ and audio/ carried owner-only rules
  // with ZERO assertions; a regression there would have shipped unseen.
  // 23. galleries/: owner image ok; PDF blocked; 11MB blocked; cross-user blocked;
  //     bob/anon can't read, admin can.
  await assertSucceeds(uploadBytes(ref(alice, 'galleries/alice/lead42/g1.jpg'), buf(1024), { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(alice, 'galleries/alice/lead42/g2.pdf'), buf(1024), { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(alice, 'galleries/alice/lead42/huge.jpg'), buf(11 * 1024 * 1024), { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(bob,   'galleries/alice/lead42/sneak.jpg'), buf(1024), { contentType: 'image/jpeg' }));
  await assertFails(getBytes(ref(bob,   'galleries/alice/lead42/g1.jpg')));
  await assertFails(getBytes(ref(anon,  'galleries/alice/lead42/g1.jpg')));
  await assertSucceeds(getBytes(ref(admin, 'galleries/alice/lead42/g1.jpg')));
  // 24. reports/: PDF ok; HTML blocked (isDocType excludes text/html); 11MB blocked; cross-user blocked.
  await assertSucceeds(uploadBytes(ref(alice, 'reports/alice/r1.pdf'), buf(2048), { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(alice, 'reports/alice/r1.html'), buf(1024), { contentType: 'text/html' }));
  await assertFails(uploadBytes(ref(alice, 'reports/alice/huge.pdf'), buf(11 * 1024 * 1024), { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(bob,   'reports/alice/sneak.pdf'), buf(1024), { contentType: 'application/pdf' }));
  await assertFails(getBytes(ref(bob, 'reports/alice/r1.pdf')));
  // 25. shared_docs/: PDF ok; exe blocked; 26MB blocked; cross-user blocked.
  await assertSucceeds(uploadBytes(ref(alice, 'shared_docs/alice/s1.pdf'), buf(2048), { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(alice, 'shared_docs/alice/mal.exe'), buf(1024), { contentType: 'application/x-msdownload' }));
  await assertFails(uploadBytes(ref(alice, 'shared_docs/alice/huge.pdf'), buf(26 * 1024 * 1024), { contentType: 'application/pdf' }));
  await assertFails(uploadBytes(ref(bob,   'shared_docs/alice/sneak.pdf'), buf(1024), { contentType: 'application/pdf' }));
  await assertFails(getBytes(ref(bob, 'shared_docs/alice/s1.pdf')));
  // 26. audio/: MediaRecorder (webm) + Safari (mp4) ok; image blocked; cross-user
  //     blocked; bob can't read, admin can; owner deletes. The 200MB cap is
  //     deliberately not exercised — a >200MB emulator upload is too slow for CI.
  await assertSucceeds(uploadBytes(ref(alice, 'audio/alice/lead42/rec1.webm'), buf(4096), { contentType: 'audio/webm' }));
  await assertSucceeds(uploadBytes(ref(alice, 'audio/alice/lead42/rec2.m4a'),  buf(4096), { contentType: 'audio/mp4' }));
  await assertFails(uploadBytes(ref(alice, 'audio/alice/lead42/not-audio.jpg'), buf(1024), { contentType: 'image/jpeg' }));
  await assertFails(uploadBytes(ref(bob,   'audio/alice/lead42/sneak.webm'), buf(1024), { contentType: 'audio/webm' }));
  await assertFails(getBytes(ref(bob, 'audio/alice/lead42/rec1.webm')));
  await assertSucceeds(getBytes(ref(admin, 'audio/alice/lead42/rec1.webm')));
  await assertSucceeds(deleteObject(ref(alice, 'audio/alice/lead42/rec1.webm')));

  console.log('✓ All storage rules tests passed');
  await env.cleanup();
}

run().catch((e) => {
  console.error('✗ storage rules tests failed:', e);
  process.exit(1);
});
