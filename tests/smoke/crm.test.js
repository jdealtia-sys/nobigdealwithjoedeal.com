/**
 * tests/smoke/crm.test.js — bulk lead operations, NBDIDBCache, customer
 * photo strip/grid/multi-select/upload, cross-lead photo feed, Firestore
 * repository layer, JSDoc typedefs, view template-hydration sweep.
 */

'use strict';

const path = require('path');
const { ROOT, read, readCustomer, readDashboardMain, readDashboardStyles, readCrm } = require('./_shared');

module.exports.run = function run(ctx) {
  const { assert, section } = ctx;

section('NBDIDBCache — IndexedDB offline-first cache');
{
  const idb      = read(path.join(ROOT, 'docs/pro/js/idb-cache.js'));
  const customer = readCustomer();

  // Public surface — these names are the integration contract.
  assert('idb-cache exports get/put/clear/clearAll/revalidate/setActiveUid on window.NBDIDBCache',
    /window\.NBDIDBCache\s*=\s*api/.test(idb)
    && /get:\s*get/.test(idb)
    && /put:\s*put/.test(idb)
    && /clear:\s*clear/.test(idb)
    && /clearAll:\s*clearAll/.test(idb)
    && /revalidate:\s*revalidate/.test(idb)
    && /setActiveUid:\s*setActiveUid/.test(idb));

  // Per-uid partition is non-negotiable — two reps sharing a
  // device must NOT see each other's cached PII.
  assert('DB name includes uid to partition cache per account',
    /nbd-pro-cache-['"]?\s*\+\s*\(uid \|\| ['"]anon['"]\)/.test(idb));
  assert('setActiveUid resets dbPromise to force re-open with new name',
    /function setActiveUid\(uid\)[\s\S]{0,400}dbPromise\s*=\s*null/.test(idb));

  // Graceful no-IDB fallback. Critical for Safari private mode +
  // embedded WebViews where IndexedDB throws synchronously on
  // open(). Every method must resolve with a sentinel rather
  // than reject.
  assert('openDB resolves null when indexedDB is undefined',
    /typeof indexedDB === ['"]undefined['"][\s\S]{0,200}Promise\.resolve\(null\)/.test(idb));
  assert('openDB swallows synchronous open() throws',
    /try \{[\s\S]{0,200}indexedDB\.open\([\s\S]{0,200}catch \(err\)[\s\S]{0,200}resolve\(null\)/.test(idb));

  // Promise wrapper for IDBRequest — single primitive everything
  // else builds on. Must resolve on success, reject on error.
  assert('idbReq resolves on success and rejects on error',
    /function idbReq\(req\)[\s\S]{0,300}req\.onsuccess[\s\S]{0,200}req\.onerror[\s\S]{0,200}reject/.test(idb));

  // revalidate semantics:
  //  - cache hit fires onCached SYNCHRONOUSLY for instant paint
  //  - loader runs in parallel; on success, fresh data replaces
  //    cache + is returned
  //  - on loader failure, return cached data (offline mode)
  assert('revalidate fires onCached when cache fresh',
    /if \(rec && \(Date\.now\(\) - \(rec\.at \|\| 0\)\) <= maxAgeMs\)[\s\S]{0,300}onCached\(rec\.data\)/.test(idb));
  assert('revalidate falls back to cached data on loader failure',
    /\.catch\(function \(err\)[\s\S]{0,300}return rec\.data/.test(idb));

  // Cache write is fire-and-forget — must not block the caller
  // on IDB latency.
  assert('revalidate does not await put(slice, fresh)',
    /\.then\(function \(fresh\) \{[\s\S]{0,200}put\(slice, fresh\);[\s\S]{0,80}return fresh/.test(idb));

  // Customer page wiring — script tag, auth hooks, photo loader.
  assert('customer.html loads idb-cache.js after state-store.js',
    /state-store\.js[\s\S]{0,400}idb-cache\.js/.test(customer));
  assert('customer.html calls setActiveUid(user.uid) on signin',
    /NBDIDBCache\.setActiveUid\(user\.uid\)/.test(customer));
  assert('customer.html calls clearAll() on signout',
    /window\.NBDIDBCache && window\.NBDIDBCache\.clearAll\(\)/.test(customer));

  // Single projection function — guarantees cache hit + fresh
  // fetch produce identical objects (no flicker on revalidate).
  assert('photoDocToView is the single Firestore→view projection',
    /function photoDocToView\(id, d\)/.test(customer)
    && /list\.push\(photoDocToView\(doc\.id, doc\.data\(\)\)\)/.test(customer));

  // urls + storagePath must round-trip through the cache so the
  // <img srcset> render path keeps working from cached entries.
  assert('photoDocToView preserves urls + storagePath fields',
    /urls:\s*d\.urls \|\| null/.test(customer)
    && /storagePath:\s*d\.storagePath \|\| ['"]/.test(customer));

  // Cache key includes uid so a different rep on the same device
  // doesn't read the previous account's photo cache.
  assert('cache key namespaced by uid + leadId',
    /['"]photos:['"]\s*\+\s*uid\s*\+\s*['"]:[\"']\s*\+\s*leadId/.test(customer));

  // Sanity-bounded freshness — don't show year-stale photos.
  assert('photos.maxAgeMs ≤ 30 days',
    /maxAgeMs:\s*30\s*\*\s*86400000/.test(customer));

  // Backward compat: no NBDIDBCache → plain Firestore path with
  // the same view code.
  assert('no-IDB fallback runs fetchFresh + applyPhotosToView',
    /if \(!window\.NBDIDBCache\)[\s\S]{0,300}fetchFresh\(\)[\s\S]{0,200}applyPhotosToView\(list\)/.test(customer));
}

section('Bulk lead operations — writeBatch + NBDStore + new fields');
{
  // Step 4b: crm.js was split into 4 modules + a shim — concat them
  // via readCrm() so the bulk-section assertions below find their
  // patterns regardless of which split file the code landed in.
  const crm  = readCrm();
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));

  // Selection state must live in NBDStore now — direct mutation
  // of window._bulkSelected would skip subscriber notify.
  assert('crm.js seeds leads.bulkSelected slice in NBDStore',
    /NBDStore\.set\(['"]leads\.bulkSelected['"], new Set\(\)\)/.test(crm));
  assert('crm.js binds _bulkSelected → leads.bulkSelected (one-way)',
    /NBDStore\.bind\(['"]_bulkSelected['"], ['"]leads\.bulkSelected['"]\)/.test(crm));
  assert('crm.js subscribes updateBulkToolbar to leads.bulkSelected',
    /NBDStore\.subscribe\(['"]leads\.bulkSelected['"][\s\S]{0,200}updateBulkToolbar/.test(crm));

  // updateBulkSelection swaps the Set ref every write — required
  // for the NBDStore identity-equality short-circuit to fire.
  assert('updateBulkSelection swaps Set ref to trigger notify',
    /function updateBulkSelection\(mutate\)[\s\S]{0,400}var next = new Set\(prev\);[\s\S]{0,200}NBDStore\.set\(['"]leads\.bulkSelected['"], next\)/.test(crm)
    || /function updateBulkSelection\(mutate\)[\s\S]{0,400}const next = new Set\(prev\);[\s\S]{0,200}NBDStore\.set\(['"]leads\.bulkSelected['"], next\)/.test(crm));

  // bulkDelete must use writeBatch — the previous serial loop did
  // N round-trips and was non-atomic. commitBulkLeadOp is the
  // single place batches are formed.
  assert('bulkDelete routes through commitBulkLeadOp (writeBatch)',
    /async function bulkDelete\(\)[\s\S]{0,1500}commitBulkLeadOp/.test(crm));
  // Window widened 500→1600 (2026-07-06): the ownership pre-filter for
  // team visibility (staff kanbans can select teammate-owned cards whose
  // writes are rules-denied — one denied doc voids an atomic batch) sits
  // between the function head and the writeBatch call.
  assert('commitBulkLeadOp uses writeBatch + chunk cap < 500',
    /async function commitBulkLeadOp[\s\S]{0,2400}window\.writeBatch\(window\.db\)/.test(crm)
    && /CHUNK\s*=\s*450/.test(crm));

  // New bulk capabilities — carrier + damage. These are the
  // direct UX wins; without them Joe was hand-editing 20+ leads
  // one at a time after a hailstorm sweep.
  assert('bulkAssignCarrier reads bulkCarrierSelect.value',
    /async function bulkAssignCarrier\(\)[\s\S]{0,300}bulkCarrierSelect[\s\S]{0,200}bulkAssignField\(['"]carrier['"]/.test(crm));
  assert('bulkAssignDamage reads bulkDamageSelect.value',
    /async function bulkAssignDamage\(\)[\s\S]{0,300}bulkDamageSelect[\s\S]{0,200}bulkAssignField\(['"]damageType['"]/.test(crm));

  // Field allowlist — privileged fields (companyId, role, isAdmin)
  // must NOT be writable through this path, even though
  // firestore.rules already blocks them. Defense in depth.
  // Wave 32 extended the set with source + jobType for bulk
  // post-import cleanup; the test rewrites against the same shape
  // and explicitly asserts the privileged-field guard separately.
  assert('BULK_LEAD_FIELDS allowlist constrains writable fields',
    /BULK_LEAD_FIELDS\s*=\s*new Set\(\[['"]carrier['"], ['"]damageType['"], ['"]followUp['"], ['"]tags['"], ['"]source['"], ['"]jobType['"]\]\)/.test(crm));
  // Privileged-field exclusion sanity check — these must NEVER
  // appear in the allowlist no matter how it's expanded.
  assert('BULK_LEAD_FIELDS does not allow privileged fields',
    !/BULK_LEAD_FIELDS\s*=\s*new Set\(\[[^\]]*['"](?:companyId|role|isAdmin|userId|deleted)['"][^\]]*\]\)/.test(crm));
  assert('bulkAssignField rejects non-allowlisted fields',
    /if \(!BULK_LEAD_FIELDS\.has\(field\)\)[\s\S]{0,200}return;/.test(crm));

  // Optimistic local update so the kanban reflects without a
  // full reload. Must run AFTER batch.commit succeeds.
  assert('bulkAssignField patches local _leads + re-renders',
    /\(window\._leads \|\| \[\]\)\.forEach[\s\S]{0,200}l\[field\] = value/.test(crm));

  // Select-all-visible — Joe's #1 ask after hailstorm sweeps.
  assert('selectAllVisibleLeads gathers visible .k-card data-id',
    /function selectAllVisibleLeads\(\)/.test(crm)
    && /\.querySelectorAll\(['"]\.kanban-board \.k-card['"]\)/.test(crm)
    && /next\.add\(id\)/.test(crm));

  // Toolbar UI — new selects + buttons must be in the DOM.
  assert('dashboard.html bulk toolbar has bulkCarrierSelect + bulkDamageSelect',
    /id="bulkCarrierSelect"/.test(dash) && /id="bulkDamageSelect"/.test(dash));
  assert('dashboard.html toolbar wires bulkAssignCarrier + bulkAssignDamage',
    /data-action="call" data-fn="bulkAssignCarrier"/.test(dash)
    && /data-action="call" data-fn="bulkAssignDamage"/.test(dash));
  assert('dashboard.html toolbar has Select-all-visible button',
    /data-action="call" data-fn="selectAllVisibleLeads"/.test(dash));

  // Public API — every helper exposed on window so inline
  // onclick handlers can reach them. Globals Tranche 2c-3 (2026-07-07):
  // the markup-only bulk handlers now REGISTER in __NBD_CALL_REGISTRY
  // (crm-portal-bridge.js is IIFE-wrapped) instead of living on window;
  // updateBulkToolbar keeps its window export (internal + cross-file
  // callers). The dashboard.test.js Tranche 2c section pins the full
  // registration + allowlist-removal + off-window surface.
  assert('bulk toolbar handlers register in __NBD_CALL_REGISTRY (Tranche 2c-3)',
    /bulkAssignCarrier:\s*bulkAssignCarrier/.test(crm)
    && /bulkAssignDamage:\s*bulkAssignDamage/.test(crm)
    && /selectAllVisibleLeads:\s*selectAllVisibleLeads/.test(crm));
  assert('updateBulkToolbar stays window-exported (internal + cross-file callers)',
    /window\.updateBulkToolbar\s*=\s*updateBulkToolbar/.test(crm));
}

section('Firestore repository layer — write convention');
{
  const repos = read(path.join(ROOT, 'docs/pro/js/repos.js'));
  // Public API surface — three repos with matching shapes.
  assert('repos.js exports window.NBDRepos with leads/photos/estimates',
    /window\.NBDRepos\s*=\s*\{[\s\S]*leads:\s*leads[\s\S]*photos:\s*photos[\s\S]*estimates:\s*estimates/.test(repos));
  // stampCreate fills the 4 system fields exactly once. The Object.assign
  // pattern with caller data SECOND lets backfill scripts override the
  // stamps when they need to (e.g. preserving createdAt on imports).
  assert('stampCreate stamps userId + companyId + createdAt + updatedAt',
    /function stampCreate\([\s\S]{0,500}userId:\s*ctx\.uid[\s\S]{0,200}companyId:\s*ctx\.companyId[\s\S]{0,200}createdAt:\s*st[\s\S]{0,100}updatedAt:\s*st/.test(repos));
  // stampUpdate forces updatedAt — call sites must not override.
  assert('stampUpdate forces server updatedAt (caller cannot bump)',
    /function stampUpdate[\s\S]{0,300}Object\.assign\(\{\},\s*data,\s*\{\s*updatedAt:\s*st\s*\}\)/.test(repos));
  // context() throws fast on missing uid (better than letting
  // firestore.rules reject later). companyId falls back to uid for
  // solo operators per audit batch 6 — the original strict throw
  // blocked adoption since solo accounts don't carry a separate
  // companyId on their claims.
  assert('context() throws unauthenticated when uid missing',
    /code\s*=\s*['"]unauthenticated['"]/.test(repos));
  // Bulk write helpers use writeBatch — atomic round-trip.
  assert('photos.bulkUpdate uses writeBatch',
    /bulkUpdate:\s*async function[\s\S]{0,300}window\.writeBatch\(window\.db\)/.test(repos));
  // Soft-delete sets deleted:true rather than calling deleteDoc,
  // because cross-collection references would orphan otherwise.
  assert('leads.softDelete sets deleted:true (not deleteDoc)',
    /softDelete:\s*async function[\s\S]{0,200}deleted:\s*true/.test(repos)
    && /hardDelete:\s*async function[\s\S]{0,200}window\.deleteDoc/.test(repos));
}

section('JSDoc typedefs — Firestore document shapes');
{
  const types = read(path.join(ROOT, 'docs/pro/js/types.js'));
  // The five core typedefs every domain file should reach for.
  ['Lead', 'Photo', 'Estimate', 'UserProfile', 'Company', 'LeadActivity'].forEach(function (t) {
    assert('types.js declares @typedef ' + t,
      new RegExp('@typedef\\s+\\{object\\}\\s+' + t).test(types));
  });
  // Photo must include the new `.order` field documented as PR #68's
  // drag-rearranged sequence — otherwise the comparator will look like
  // it's reading a phantom field.
  assert('Photo typedef documents the .order field',
    /@property\s*\{number=\}\s*order/.test(types));
  // Lead must include .companyId since PR #60 made it required.
  assert('Lead typedef documents .companyId as required-on-create',
    /@property\s*\{string\}\s*companyId/.test(types));
  // The TimestampLike alias normalizes the three formats Firestore
  // hands back across server-set, client-set, and unset paths.
  assert('types.js declares TimestampLike alias for FirestoreTimestamp/string/number/null',
    /@typedef\s*\{FirestoreTimestamp[\s\S]{0,80}TimestampLike/.test(types));
}

section('Customer overview photo strip — cap + drag reorder');
{
  const customer = readCustomer();
  // 25-cap on the overview photo strip (matches the dashboard's
  // PHOTO_PHASE_CAP pattern from PR #63).
  assert('overview strip caps at 25 with show-all toggle',
    /window\.PHOTO_OVERVIEW_CAP\s*=\s*25/.test(customer)
    && /toggleCustomerPhotosExpanded/.test(customer)
    && /nbd-photo-show-all-btn/.test(customer));
  // Comparator that prefers numeric .order, falls back to uploadedAt.
  assert('photos sort by .order field (drag-rearranged sequence first)',
    /function nbdComparePhotos\(a, b\)/.test(customer)
    && /typeof a\.order === 'number'/.test(customer));
  // Reorder mode is a body-class toggle so CSS shows drag affordance.
  assert('reorder mode toggle exposes draggable grid via body class',
    /document\.body\.classList\.toggle\('nbd-photo-reorder'\)/.test(customer)
    && /body\.nbd-photo-reorder \.nbd-photo-item/.test(customer));
  // HTML5 drag/drop wiring on the overview strip.
  assert('overview strip wires dragstart/dragover/drop handlers',
    /listEl\.addEventListener\('dragstart'/.test(customer)
    && /listEl\.addEventListener\('dragover'/.test(customer)
    && /listEl\.addEventListener\('drop'/.test(customer));
  // writeBatch persists the new order — one round-trip for the whole
  // sequence (same pattern as the multi-select feature).
  assert('persistCustomerPhotoOrder uses writeBatch',
    /async function persistCustomerPhotoOrder\(\)[\s\S]{0,400}window\.writeBatch\(window\.db\)[\s\S]{0,400}batch\.update\(/.test(customer));
  // Report generator must honour the user's drag-rearranged order.
  assert('generatePhotoReport iterates photos sorted by nbdComparePhotos',
    /__reportPhotos[\s\S]{0,200}\.sort\([\s\S]{0,80}nbdComparePhotos/.test(customer));
}

section('Customer photo multi-select + batched commit');
{
  const customer = readCustomer();
  // writeBatch must be imported AND exposed on window so the bulk
  // handlers can invoke it.
  assert('customer.html imports writeBatch from firestore SDK',
    /import \{[^}]*writeBatch[^}]*\}\s*from\s*"https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.2\/firebase-firestore\.js"/.test(customer));
  assert('customer.html exposes window.writeBatch',
    /window\.writeBatch\s*=\s*writeBatch/.test(customer));
  // _photoSelected Set + tile checkbox overlay + bulk action bar DOM.
  assert('customer.html declares window._photoSelected Set',
    /window\._photoSelected\s*=\s*window\._photoSelected\s*\|\|\s*new Set/.test(customer));
  assert('photo tile renders the selection checkbox span',
    /class="nbd-photo-checkbox"/.test(customer));
  assert('bulk action bar DOM is in place',
    /id="nbdPhotoBulkBar"[\s\S]{0,1500}id="nbdPhotoBulkCount"[\s\S]{0,2000}id="nbdBulkPhase"[\s\S]{0,2000}id="nbdBulkSeverity"/.test(customer));
  // Bulk handlers exist and use writeBatch (one round-trip for the
  // whole batch — the whole point of this PR).
  assert('applyBulkPhotoUpdate uses writeBatch',
    /window\.applyBulkPhotoUpdate\s*=\s*async function[\s\S]{0,500}window\.writeBatch\(window\.db\)/.test(customer));
  // NEW-C1 added a nbdConfirm gate before the batch (PWA confirm patch),
  // widening the gap from `async function` to writeBatch — bound bumped 500→900.
  assert('applyBulkPhotoDelete uses writeBatch',
    /window\.applyBulkPhotoDelete\s*=\s*async function[\s\S]{0,900}window\.writeBatch\(window\.db\)[\s\S]{0,500}batch\.delete\(/.test(customer));
  // After a same-field bulk update, surgical updates happen — no full
  // re-render unless the phase changed.
  assert('bulk update prefers surgical updatePhotoTile over full re-render',
    /phaseChanged[\s\S]{0,200}updatePhotoTile\(id\)/.test(customer));
  // Click delegate enters selection mode without opening the quick-edit popup.
  assert('photo grid delegate routes selection-mode clicks to togglePhotoSelection',
    /isPhotoSelectMode\(\)[\s\S]{0,150}togglePhotoSelection\(photoId\)/.test(customer));
}

section('Customer photo upload — background-safe + global widget');
{
  const customer = readCustomer();
  // Global floating upload widget DOM exists.
  assert('customer.html ships the #nbdUploadWidget DOM',
    /id="nbdUploadWidget"[\s\S]{0,500}id="nbdUploadWidgetBarFill"/.test(customer));
  // updateGlobalUploadStatus drives the widget visibility + bar fill.
  assert('customer.html exports updateGlobalUploadStatus',
    /function updateGlobalUploadStatus\(\)/.test(customer));
  // Surgical per-tick update — kills the per-byte innerHTML thrash.
  assert('uploadSinglePhoto state_changed uses updateUploadPreviewItem',
    /uploadTask\.on\(['"]state_changed['"][\s\S]{0,400}updateUploadPreviewItem\(index\)/.test(customer));
  // Per-tile % label overlay (the "loading circle on each photo").
  assert('preview tile shows centered % label',
    /class="preview-progress-pct"/.test(customer)
    && /\.preview-progress-pct\s*\{[^}]*transform:\s*translate/.test(customer));
  // closeUploadModal must NOT clear the queue while uploads are in flight.
  assert('closeUploadModal preserves queue mid-upload (background-safe)',
    /hasInflight[\s\S]{0,150}return;/.test(customer));
  // Success path is a non-blocking toast, not a JS alert. Negative
  // condition targets the photo path only (_uploadQueue) so the
  // doc-upload alert at line ~1860 (_docUploadQueue) doesn't trigger.
  assert('uploadPhotos success path uses showToast (no alert)',
    /window\.showToast\(['"]✓ Uploaded /.test(customer)
    && !/alert\(`Successfully uploaded \$\{window\._uploadQueue/.test(customer));
}

section('Customer photo grid — surgical render path');
{
  const customer = readCustomer();
  // _photoById Map for O(1) lookup (was O(n) indexOf inside the render loop).
  assert('customer.html populates window._photoById Map in loadPhotosByPhase',
    /window\._photoById\s*=\s*new Map\(\)/.test(customer));
  // Surgical update entry point — patches one tile's badges in place.
  assert('customer.html exports updatePhotoTile helper',
    /function updatePhotoTile\(photoId\)/.test(customer));
  // Tiles must carry the stable id so updatePhotoTile can find them.
  assert('customer.html photo tiles use data-photo-id (not data-photo-global-idx)',
    /data-photo-id="/.test(customer) && !/data-photo-global-idx/.test(customer));
  // Single delegated click listener — replaces 80 per-tile listeners.
  assert('customer.html photo grid uses delegated click listener',
    /ensurePhotoGridDelegate/.test(customer)
    && /grid\.addEventListener\(['"]click['"]/.test(customer));
  // CSS hover replaces the JS mouseover/mouseout pair (160 listeners on 80 photos).
  assert('customer.html .nbd-phase-photo:hover is CSS, not JS',
    /\.nbd-phase-photo:hover\s*\{\s*transform:\s*scale/.test(customer)
    && !/addEventListener\(['"]mouseover['"]/.test(customer));
  // Per-phase 25-photo cap with show-all toggle.
  assert('customer.html caps each phase to 25 with show-all toggle',
    /PHOTO_PHASE_CAP\s*=\s*25/.test(customer)
    && /toggleShowAllPhase/.test(customer)
    && /nbd-show-all-btn/.test(customer));
  // quickSaveMeta must call updatePhotoTile when the phase didn't
  // change — the whole point of this PR.
  assert('quickSaveMeta calls updatePhotoTile for same-phase edits',
    /updates\.phase === prevPhase[\s\S]{0,80}updatePhotoTile\(photo\.id\)/.test(customer));
}

section('Phase D.2 — Cross-lead Recent Photo Feed');
{
  const dash = readDashboardStyles(); // html + extracted css (Rock 4 Phase 2b-d)
  const mainJs = readDashboardMain();

  // 1. Mode toggle present in tpl-view-photos.
  assert('tpl-view-photos has the .ph-mode-toggle (By Property / Recent)',
    /<div class="ph-mode-toggle"[\s\S]{0,400}data-ph-mode="by-property"[\s\S]{0,400}data-ph-mode="recent"/.test(dash),
    'expected the by-property + recent mode buttons inside the photo template');

  // 2. Recent feed mount + CSS.
  assert('photoRecentFeed mount div present',
    /<div id="photoRecentFeed" class="ph-recent-feed"/.test(dash),
    'expected photoRecentFeed mount inside tpl-view-photos');
  assert('.ph-recent-grid CSS defined (3-up grid)',
    /\.ph-recent-grid\{[\s\S]{0,200}grid-template-columns:\s*repeat\(auto-fill/.test(dash),
    'expected .ph-recent-grid CSS rule');

  // 3. JS exports.
  assert('window.setPhotoMode exposed',
    /window\.setPhotoMode\s*=/.test(mainJs),
    'expected window.setPhotoMode export');
  assert('window.renderRecentPhotoFeed exposed',
    /window\.renderRecentPhotoFeed\s*=/.test(mainJs),
    'expected window.renderRecentPhotoFeed export');

  // 4. Query uses where(userId == uid) + orderBy(createdAt desc) + limit.
  //    createdAt is the canonical /photos ordering field (every write path
  //    stamps it) — ordering by the photo-engine-only uploadedAt silently
  //    excluded quick-upload / annotation photos from the feed.
  assert('renderRecentPhotoFeed queries photos by userId + orderBy createdAt + limit',
    /window\.query\(\s*window\.collection\(window\.db,\s*'photos'\)[\s\S]{0,200}window\.where\('userId',\s*'==',\s*uid\)[\s\S]{0,200}window\.orderBy\('createdAt',\s*'desc'\)[\s\S]{0,200}window\.limit\(/.test(mainJs),
    'expected Firestore query: where(userId == uid).orderBy(createdAt,desc).limit()');

  // 5. Date grouping uses Today / Yesterday smart labels.
  assert('renderRecentPhotoFeed renders Today / Yesterday smart date labels',
    /'Today'/.test(mainJs) && /'Yesterday'/.test(mainJs),
    'expected Today / Yesterday labels in the date-grouper');

  // 6. Tap on a tile pivots into by-property mode for that lead.
  //    The string in source is `setPhotoMode(\\'by-property\\')` (escaped
  //    quotes inside an HTML onclick attribute).
  assert('Recent tiles wire data-dw-action=openPhotoTile (delegated → setPhotoMode by-property)',
    /data-dw-action="openPhotoTile"/.test(mainJs) && /setPhotoMode\('by-property'\)/.test(mainJs),
    'expected recent-tile data-dw-action + delegate that calls setPhotoMode("by-property")');
}

section('Phase C.1 + C.2 — view template-hydration sweep');
{
  const dash = read(path.join(ROOT, 'docs/pro/dashboard.html'));
  const mainJs = readDashboardMain();

  // C.1 — every stub view should be an empty mount div + matching template.
  // Whitespace between attributes is flexible (some are aligned in columns).
  const stubs = ['aitree','understand','projectcodex','aiusage','products','d2d','training','academy','closeboard','repos','board','home'];
  for (const v of stubs) {
    assert('view-' + v + ' is an empty mount with data-view-template',
      new RegExp('<div class="view( active)?" id="view-' + v + '"\\s+data-view-template="tpl-view-' + v + '"></div>').test(dash),
      'expected mount div for view-' + v);
    assert('<template id="tpl-view-' + v + '"> exists',
      new RegExp('<template id="tpl-view-' + v + '">').test(dash),
      'expected tpl-view-' + v + ' template element');
  }

  // C.2 — medium views (joe + schedule) extracted.
  for (const v of ['joe','schedule']) {
    assert('view-' + v + ' is an empty mount with data-view-template (C.2)',
      new RegExp('<div class="view" id="view-' + v + '"\\s+data-view-template="tpl-view-' + v + '"></div>').test(dash),
      'expected mount div for view-' + v);
    assert('<template id="tpl-view-' + v + '"> exists',
      new RegExp('<template id="tpl-view-' + v + '">').test(dash),
      'expected tpl-view-' + v + ' template element');
  }

  // Eager-hydration helper runs at module load (covers default-active home).
  assert('dashboard-main.js eager-hydrates .view.active[data-view-template] on load',
    /_eagerHydrateActiveViews[\s\S]{0,400}\.view\.active\[data-view-template\]/.test(mainJs),
    'expected _eagerHydrateActiveViews IIFE that queries .view.active[data-view-template]');
}

section('backfill — leads.stageRole one-off (freeform-pipeline classification)');
{
  const fs = require('fs');
  const p = path.join(ROOT, 'scripts/backfill-lead-stageRole.js');
  assert('scripts/backfill-lead-stageRole.js exists', fs.existsSync(p));
  if (fs.existsSync(p)) {
    const bf = read(p);
    // Reuse the SHARED server role map so the backfill can't drift from runtime.
    assert('backfill imports the shared roleFromKey (no drift vs functions/stage-roles)',
      /require\(['"]\.\.\/functions\/stage-roles['"]\)/.test(bf) && /roleFromKey\(/.test(bf));
    assert('stageRole backfill is dry-run-by-default + --apply needs --yes',
      /APPLY && !YES/.test(bf) && /--apply --yes/.test(bf));
    // The persisted role is authoritative — only FILL gaps, never overwrite.
    assert('stageRole backfill is idempotent (skips docs with a valid stageRole)',
      /VALID_ROLES\.has\(data\.stageRole\)/.test(bf));
    // A tenant's custom-stage role (companyProfile.pipelines) must win over the
    // key-map guess — that's the whole point (custom stages classify wrong
    // under the key map alone).
    assert('stageRole backfill resolves a tenant custom-stage role from companyProfile.pipelines',
      /companyProfile/.test(bf)
      && /cfg\.stages\[stageKey\]/.test(bf)
      && /return roleFromKey\(stageKey\)/.test(bf));
  }
  // Legacy-pin companyId backfill — makes teammates' pre-scoping pins team-visible.
  const pp = path.join(ROOT, 'scripts/backfill-pins-companyId.js');
  assert('scripts/backfill-pins-companyId.js exists', fs.existsSync(pp));
  if (fs.existsSync(pp)) {
    const bf = read(pp);
    assert('pins backfill is dry-run-by-default + --apply needs --yes',
      /APPLY && !YES/.test(bf) && /--apply --yes/.test(bf));
    assert('pins backfill is idempotent (skips pins with a companyId)',
      /if \(data\.companyId\) \{ alreadyOk\+\+; continue; \}/.test(bf));
    assert('pins backfill derives companyId: linked lead → user map → company claim → own uid',
      /byLead\.has\(data\.leadId\)/.test(bf)
      && /userToCompany\.has\(data\.userId\)/.test(bf)
      && /companyId = claimCid; via = 'claim'/.test(bf)
      && /companyId = data\.userId; via = 'ownUid'/.test(bf));
  }
}

section('Pipelines builder — drag-to-reorder stages');
{
  const pb = read(path.join(ROOT, 'docs/pro/js/pipeline-builder.js'));
  // Draggable grip + drop-target rows carrying view + stage context.
  assert('builder renders a draggable grip per stage row',
    /class="pb-grip" draggable="true"/.test(pb)
    && /class="pb-stage-row" data-view="/.test(pb),
    'expected a draggable .pb-grip inside a .pb-stage-row with data-view/data-stage');
  // Delegated DnD handlers (CSP-safe — no inline ondrag* attributes).
  assert('builder wires delegated dragstart/dragover/drop on the root',
    /addEventListener\('dragstart', onDragStart\)/.test(pb)
    && /addEventListener\('dragover', onDragOver\)/.test(pb)
    && /addEventListener\('drop', onDrop\)/.test(pb),
    'expected delegated drag handlers on the builder root');
  assert('builder has no inline ondrag* handlers (CSP-safe)',
    !/ondragstart=|ondragover=|ondrop=/.test(pb),
    'drag handlers must be delegated, not inline');
  // Reorder is constrained to a single pipeline and splices the working config.
  assert('drop reorders within the same view only',
    /getAttribute\('data-view'\) !== _drag\.view/.test(pb),
    'expected onDragOver to bail when the row is in a different view');
  assert('drop splices the stage into the view order (before/after by pointer)',
    /arr\.splice\(from, 1\)/.test(pb)
    && /arr\.splice\(after \? to \+ 1 : to, 0, payload\.stage\)/.test(pb),
    'expected the dropped stage to be removed then re-inserted at the target');
  // Per-stage hide/show (eye) toggle → config `hidden` flag.
  assert('builder has a hide/show eye toggle writing the hidden flag',
    /data-pb-action="togglehide"/.test(pb)
    && /action === 'togglehide'[\s\S]{0,160}setStageField\(key, 'hidden', !cur\)/.test(pb),
    'expected a togglehide action that flips the stage hidden flag');

  // The board renderer must honour the LIVE (tenant-overridden) config — this
  // was a real end-to-end gap: buildKanbanColumns read module-local consts, so
  // custom views / renames / custom / reordered / hidden stages never showed.
  const boot = read(path.join(ROOT, 'docs/pro/js/dashboard-bootstrap.module.js'));
  assert('buildKanbanColumns reads window.KANBAN_VIEWS / window.STAGE_META overrides',
    /const VIEWS = window\.KANBAN_VIEWS \|\| KANBAN_VIEWS/.test(boot)
    && /const META = window\.STAGE_META \|\| STAGE_META/.test(boot),
    'expected the board builder to prefer the applied config over the default consts');
  assert('buildKanbanColumns skips stages flagged hidden',
    /\.filter\(k => !\(META\[k\] && META\[k\]\.hidden\)\)/.test(boot),
    'expected hidden stages to be dropped from the rendered columns');
  assert('applyPipelineConfig rebuilds the columns (not just re-renders cards)',
    /window\.buildKanbanColumns\(window\._currentViewKey \|\| vk\)/.test(boot),
    'expected applyPipelineConfig to call buildKanbanColumns so config changes show live');
  // ── Round-2 audit regression guards ──
  assert('applyPipelineConfig restores defaults on an empty config (Reset works without reload)',
    /const hasCfg = raw && typeof raw === 'object'[\s\S]{0,140}Object\.keys\(raw\.stages\)\.length/.test(boot)
    && /resolvePipelineConfig\(hasCfg \? raw : null\)/.test(boot),
    'expected applyPipelineConfig to resolve null (defaults) when there is no real config');
  assert('Reset to defaults force-clears the in-memory config + re-applies',
    /window\._companyProfile\.pipelines = \{\};[\s\S]{0,160}applyPipelineConfig\(\)/.test(pb),
    'expected the reset branch to clear window._companyProfile.pipelines and re-apply');
  assert('buildKanbanColumns never blanks the board (hide-all fallback)',
    /if \(!stages\.length && _all\.length\) stages = _all\.slice\(\)/.test(boot),
    'expected a fallback so hiding every stage does not render zero columns');
  // ── Round-4 audit regression guard ──
  // The builder's eye-toggle writes ov.hidden for custom stages too, but
  // resolvePipelineConfig's custom-stage branch dropped the flag — so a hidden
  // custom column kept rendering (the board filter reads META[k].hidden). The
  // built-in branch already honours ov.hidden; the custom branch must match.
  {
    const stagesSrc = read(path.join(ROOT, 'docs/pro/js/crm-stages.js'));
    assert('resolvePipelineConfig honours hidden for CUSTOM stages (eye-toggle works)',
      /custom: true,[\s\S]{0,400}hidden: ov\.hidden === true,/.test(stagesSrc),
      'expected the custom-stage meta literal to carry hidden: ov.hidden === true so custom stages can be hidden');
  }
  // ── Round-5 audit regression guards ──
  // Hiding a stage removes its column; its leads must NOT be rebucketed into the
  // first column by resolveColumn's viewStages[0] fallback (which would mislabel
  // them, inflate that column's count/$ badges, and let a drag re-stage them).
  // Instead they're partitioned into a `hidden` bucket — single source of truth
  // partitionLeadsByColumn, shared by the board, the chip, and the unit test —
  // and surfaced on the board via the hidden-stage chip, so their count + $ stay
  // visible instead of silently vanishing from the pipeline. (#921 QA follow-up.)
  {
    const stagesSrc = read(path.join(ROOT, 'docs/pro/js/crm-stages.js'));
    assert('partitionLeadsByColumn diverts hidden-stage leads to a `hidden` bucket (no rebucket into first column)',
      /function partitionLeadsByColumn[\s\S]{0,1200}if \(meta\[hk\] && meta\[hk\]\.hidden\) \{ hidden\.push\(l\); return; \}/.test(stagesSrc),
      'expected partitionLeadsByColumn to push a hidden-stage lead to `hidden` and return before resolve() rebuckets it');
    const pipe = read(path.join(ROOT, 'docs/pro/js/crm-pipeline.js'));
    assert('renderLeads collects the hidden-stage leads from partitionLeadsByColumn',
      /window\.partitionLeadsByColumn\(list, stageKeys[\s\S]{0,240}_hiddenStageLeads = _part\.hidden/.test(pipe),
      'expected renderLeads to bucket via partitionLeadsByColumn and keep _part.hidden');
    assert('renderLeads surfaces hidden-stage leads via the chip instead of silently dropping them',
      /renderHiddenStageChip\(_hiddenStageLeads\)/.test(pipe)
      && /function renderHiddenStageChip\(leads\)/.test(pipe),
      'expected renderLeads to pass the hidden leads to renderHiddenStageChip');
  }
  // The kanban stage label is tenant-config text rendered into board.innerHTML —
  // escape it (defence-in-depth behind the prod CSP).
  assert('kanban stage label is HTML-escaped before board.innerHTML',
    /const _escLbl = window\.nbdEsc \|\|[\s\S]{0,400}const label = _escLbl\(meta\.label \|\| stageKey\);/.test(boot),
    'expected buildKanbanColumns to escape the tenant-controlled stage label');
  assert('_saveLeadCoords does not bump updatedAt (passive backfill)',
    /updateDoc\(doc\(db,'leads',id\), \{ lat, lng \}\)/.test(boot)
    && !/updateDoc\(doc\(db,'leads',id\), \{ lat, lng, updatedAt/.test(boot),
    'expected _saveLeadCoords to write only lat/lng, no updatedAt');
  // Backfill hardening
  const stageRoleBf = read(path.join(ROOT, 'scripts/backfill-lead-stageRole.js'));
  assert('stageRole backfill checks the tenant override via normalized key too',
    /\bnormKey\b[\s\S]{0,40}require\('\.\.\/functions\/stage-roles'\)/.test(stageRoleBf)
    && /cfg\.stages\[stageKey\] \|\| \(nk !== stageKey \? cfg\.stages\[nk\]/.test(stageRoleBf),
    'expected resolveRole to try cfg.stages[normKey(stage)] before the key map');
  const pinsBf = read(path.join(ROOT, 'scripts/backfill-pins-companyId.js'));
  assert('pins backfill skips ambiguous multi-company users (no wrong-tenant guess)',
    /if \(hist\.size > 1\) ambiguousUsers\.add\(uid\)/.test(pinsBf)   // flags multi-company users
    && /} else if \(ambiguousUsers\.has\(data\.userId\)\) \{/.test(pinsBf) // skip branch before the user-map guess
    && /ambiguous\+\+;/.test(pinsBf),
    'expected leadless pins of multi-company users to be skipped, not guessed');
  // A company rep who door-knocked but never created a lead is absent from the
  // leads-book maps, so the ownUid fallback would mis-stamp companyId = uid and
  // their leadless pins would fail the /pins sameCompanyAsResource() read rule
  // (invisible to the team). Resolve their real tenant from the companyId custom
  // claim (admin auth) before falling back to uid.
  assert('pins backfill resolves a leadless company rep via their companyId claim before the uid fallback',
    /const claimCid = await claimCompanyFor\(data\.userId\)/.test(pinsBf)  // claim lookup in the else branch
    && /u\.customClaims && u\.customClaims\.companyId/.test(pinsBf)         // reads the companyId claim via admin auth
    && /if \(claimCid\) \{[\s\S]{0,120}via = 'claim'/.test(pinsBf),        // uses the claim before ownUid
    'expected a leadless company rep\'s pins to be stamped with their claim companyId, not their uid');
}

section('Review engine — role-aware nudges, tenant-safe copy, Settings-sourced link');
{
  const rev = read(path.join(ROOT, 'docs/pro/js/review-engine.js'));

  // Won detection is role-based: persisted stageRole wins, isWonStage covers
  // key classification. The old hardcoded closedStages allowlist missed
  // final_payment/final_photos/deductible_collected and custom won stages —
  // it must not come back.
  assert('review nudge classifies won by persisted stageRole, then isWonStage',
    /l\.stageRole \|\| l\._stageRole/.test(rev)
    && /window\.isWonStage/.test(rev)
    && !/const closedStages\s*=/.test(rev),
    'expected isWonLead(stageRole → isWonStage) and no hardcoded closedStages list');

  // Recency keys off entering the won stage — updatedAt resets on any edit.
  assert('review nudge recency uses stageStartedAt (updatedAt fallback only)',
    /l\.stageStartedAt \|\| l\.updatedAt/.test(rev));

  // Review link resolves from the SAME Settings field the homeowner portal
  // reads, and the deep-merged NBD /r default never leaks to another tenant.
  assert('review link prefers users/{uid}.googleReviewUrl over legacy localStorage',
    /googleReviewUrl/.test(rev)
    && /nobigdealwithjoedeal\.com\/r/.test(rev)
    && /!== NBD_DEFAULT_REVIEW_URL \|\| \(b\.seal \|\| ''\) === 'NBD'/.test(rev),
    'expected getReviewLink: Settings field first + NBD-default leak guard');

  // Copy surfaces resolve the tenant brand, not NBD literals (TenantContext
  // Phase B). The BRAND const may remain only as the no-profile fallback.
  assert('review SMS/email copy resolves window._brand() (tenant-safe)',
    /window\._brand/.test(rev)
    && /brandName\(\)/.test(rev)
    && /brandSignOff\(\)/.test(rev)
    && !/Joe & the No Big Deal team/.test(rev),
    'expected brandName()/brandSignOff() in message bodies, no hardcoded NBD sign-off');

  // The senders await the async link resolution — a bare sync read would
  // silently revert to the legacy localStorage-only behavior.
  assert('review senders are async and await getReviewLink()',
    /async function sendReviewRequestSMS/.test(rev)
    && /async function sendReviewRequestEmail/.test(rev)
    && /await getReviewLink\(\)/.test(rev));
}

section('Team visibility: lead-activity notes readable across the lead (rules + client)');
{
  const rules = read(path.join(ROOT, 'firestore.rules'));
  // lastIndexOf → the TOP-LEVEL /notes match (the subcollection one is earlier).
  const notesBlock = rules.slice(rules.lastIndexOf('match /notes/'),
                                rules.lastIndexOf('match /notes/') + 700);
  // Read is scoped to the PARENT LEAD (owner or same-company), not the note
  // author — so a lead owner sees a manager's stage-change note on their lead.
  assert('top-level /notes read is scoped to the parent lead (owner or same-company)',
    /allow read:[\s\S]{0,260}leads\/\$\(resource\.data\.leadId\)[\s\S]{0,140}parentLeadInMyCompany\(resource\.data\.leadId\)/.test(notesBlock));
  assert('/notes update+delete stay author-only',
    /allow update, delete:\s*if isOwner\(resource\.data\.userId\) \|\| isAdmin\(\);/.test(notesBlock));

  // Client: timeline + report note reads query by leadId ONLY (no author
  // filter), so teammates' notes appear; the rule authorizes it.
  const cust = read(path.join(ROOT, 'docs/pro/js/customer-bootstrap.module.js'));
  assert('customer timeline reads notes by leadId only (no userId filter)',
    /collection\(window\.db, 'notes'\), where\('leadId', '==', leadId\)\)/.test(cust) &&
    !/collection\(window\.db, 'notes'\), where\('leadId', '==', leadId\), where\('userId'/.test(cust));
  const rpt = read(path.join(ROOT, 'docs/pro/js/customer-photo-report-generator.js'));
  assert('notes panel reads by leadId only (no userId filter)',
    /collection\(db, 'notes'\), where\('leadId', '==', leadId\)\)/.test(rpt) &&
    !/collection\(db, 'notes'\), where\('leadId', '==', leadId\), where\('userId'/.test(rpt));
}

};
