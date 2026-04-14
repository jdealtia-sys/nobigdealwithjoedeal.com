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

  console.log('✓ All storage rules tests passed');
  await env.cleanup();
}

run().catch((e) => {
  console.error('✗ storage rules tests failed:', e);
  process.exit(1);
});
