# Role tightening: viewer is read-only, hard deletes follow the lead (2026-09-25)

**Result.** Two product calls Jo made on the review of #1771 are now enforced
in `firestore.rules` and `storage.rules`, and the CRM client no longer offers a
viewer the writes the rules now refuse. Branch `fix/rules-viewer-readonly`.
Rules deploy on merge (the deploy workflow's rules step runs the same three
rules suites first).

Background: [RULES-DELETE-NULL-RESOURCE-2026-09-25](RULES-DELETE-NULL-RESOURCE-2026-09-25.md)
(#1771) split the `documents` / `warrantyClaims` delete out of `allow write`
and listed both points below as open product calls.

## Jo's decisions (2026-09-25, product owner, final)

> **A.** Hard-deleting signed-contract rows (leads/{id}/documents) and
> warranty-claim rows (leads/{id}/warrantyClaims) is limited to the lead's
> OWNER and a company_admin of the lead's company — the same set that can
> delete the lead itself. Managers lose that delete (they keep create/update
> as today). Soft delete (deleted:true update) is unaffected.

> **B.** The 'viewer' role is READ-ONLY everywhere: a viewer can read what
> their company role allows but cannot create, update or delete any tenant
> data — including rows under leads they own (tasks, notes, drawings,
> documents, warrantyClaims, signatures, activity, and any other subcollection
> or top-level collection where a viewer can write today, e.g. photos,
> estimates, appointments, customers). Exceptions to consider and justify
> explicitly: a viewer's OWN user-scoped docs (userSettings/{uid}, their
> notification prefs, their profile) stay writable; anything a viewer must
> write for the app to boot or sign in stays writable.

`appointments` was already admin-SDK-only (`allow write: if false`), and there
is no `customers` collection in the rules (default deny), so neither needed a
change.

## How roles are represented

- **Custom claims, not member docs.** Every rule reads
  `request.auth.token.role` and `request.auth.token.companyId`, set by the
  admin SDK (claimInvite / provisioning). `companies/{co}/members/*` is a
  roster the Team tab reads; no write rule consults it. `users/{uid}.role` is
  frozen against client writes.
- Roles: `admin` (platform), `company_admin`, `manager`, `sales_rep`,
  `viewer`. A **solo operator has no role claim**, so every role read uses
  `token.get('role', '')` (a bare `token.role` throws on an absent key: NEW-5).
- Role helpers: `isAdmin()`, `isCompanyAdmin()`, `isManager()`,
  `isCompanyStaff()` (= company_admin | manager), `isCompanyReader()`
  (= company_admin | manager | viewer). Only the first four appear in write
  rules; `isCompanyReader()` reaches writes only inside
  `parentLeadInMyCompany()`, which every write ANDs with `isCompanyStaff()`.

### Helpers that granted by ownership with no role check (before)

These are what let a viewer write:

| Grant | Where |
|---|---|
| `isOwner(resource.data.userId)` / `isOwner(createdBy)` | every owner-scoped top-level collection |
| `isOwner(get(leads/$(leadId)).data.userId)` | the owner branch of every lead subcollection |
| `request.resource.data.userId == request.auth.uid` (create) | leads, estimates, expenses, photos, pins, … |
| `companyId == request.auth.uid` ("solo" branch) | `companyProfile` (`cpCanWrite()`), `catalogCosts` |
| `resource.data.ownerId == request.auth.uid` | `companies` |
| `sentBy == token.email` | `emails` |
| `isAuth()` alone | `counters` |
| `isOwner(uid)` on the uid path segment | every Storage prefix |

Only `leads` update/delete, `expenses`/`recurringExpenses`/`suppliers`
update/delete and `invoices` update/delete had a viewer check before.

## The change

- `firestore.rules`: one helper,
  `notViewer() = isAuth() && token.get('role','') != 'viewer'`, ANDed into the
  owner branch (or the whole rule) of every tenant-data write. It is false only
  for `role == 'viewer'`, so no other role gains or loses anything except A.
  The five existing inline viewer checks now call it (same expression). Six
  blocks that shared one `allow read, update, delete` line were split so the
  writes can carry it without touching read.
- `documents` / `warrantyClaims` `allow delete` (#1771's own line, kept
  separate): `isCompanyStaff()` → `isCompanyAdmin()`, plus `notViewer()`.
  The platform admin stays refused here, as in #1771; Jo's "same set" named
  the owner and company_admin, and adding the platform admin would widen it.
- `storage.rules`: `ownerWrites(uid) = isOwner(uid) && token.get('role','') != 'viewer'`
  replaces `isOwner(uid)` on the `write` and `delete` lines of all 11
  client-writable prefixes. Reads unchanged.

A scripted audit of every `allow` statement (the #1771 script, extended) lists
80 write statements carrying `notViewer()` and 32 that do not; the 32 are all
admin-only, `if false`, the codex (one hard-coded uid), or the user-scoped
exceptions below.

## Before / after

"Owner" means the doc's `userId` (or `createdBy`) for top-level collections,
and the parent lead's `userId` for lead subcollections.

| Path | Ops | Who could write before | Who can write after |
|---|---|---|---|
| `leads/{id}` | create | any signed-in user, own userId + own tenant (**viewer included**) | same, **not a viewer** |
| `leads/{id}` | update | owner (not viewer), same-tenant company_admin/manager, platform admin | unchanged |
| `leads/{id}` | delete | owner (not viewer), same-tenant company_admin, platform admin | unchanged |
| `leads/{id}/activity` | create | lead owner (**viewer-owner included**), same-tenant staff (shape-checked) | same, not a viewer |
| `leads/{id}/tasks`, `/notes`, `/drawings` | create/update/delete | lead owner (**viewer-owner included**), same-tenant company_admin/manager | same, not a viewer |
| `leads/{id}/documents`, `/warrantyClaims` | create/update (incl. soft delete) | lead owner (**viewer-owner included**), same-tenant company_admin/manager | same, not a viewer |
| `leads/{id}/documents`, `/warrantyClaims` | **delete** | lead owner (**viewer-owner included**), same-tenant company_admin **and manager** | lead owner (not viewer), same-tenant **company_admin** (decision A) |
| `leads/{id}/signatures` | create/update/delete | lead owner (**viewer-owner included**) | lead owner, not a viewer |
| `leads/{id}/ai_drafts` | update (approve/dismiss) | draft owner (**viewer included**) | same, not a viewer |
| `estimates`, `supplements` | create/update/delete | owner (**viewer included**); platform admin update/delete | owner not a viewer; platform admin unchanged |
| `expenses`, `recurringExpenses`, `suppliers` | create | any signed-in user, own userId + tenant (**viewer included**) | same, not a viewer |
| `expenses`, `recurringExpenses`, `suppliers` | update/delete | owner (not viewer), platform admin | unchanged |
| `invoices` | create | own createdBy + tenant (**viewer included**) | same, not a viewer |
| `invoices` | update/delete | unchanged (already barred viewer-owners) | unchanged |
| `photos`, `knocks`, `territories` | create/update/delete | owner (**viewer included**), platform admin (update/delete) | owner not a viewer; platform admin unchanged |
| `pins`, `zones` | create/update/delete | owner (**viewer included**), platform admin, same-tenant company_admin (update/delete) | owner not a viewer; admin + company_admin unchanged |
| `drawings`, `tasks`, `communications`, `documents`, `products`, `templates`, `lead_documents`, `deal_rooms`, `drip_queue` (top-level) | create/update/delete | owner (**viewer included**), platform admin (update/delete) | owner not a viewer; platform admin unchanged |
| `referrals`, `review_requests` | create/update (delete admin-only) | owner (**viewer included**) | owner not a viewer |
| `reports` | create/delete (update admin-only) | owner (**viewer included**) | owner not a viewer |
| `notes` (top-level) | create | lead owner (**viewer-owner included**), same-tenant staff, platform admin | same, not a viewer |
| `notes` (top-level) | update/delete | author (**viewer included**), platform admin | author not a viewer; admin unchanged |
| `emails` | create | anyone whose token email matches `sentBy` (**viewer included**) | same, not a viewer |
| `counters` | create/update (+1 only) | any signed-in user (**viewer included**) | same, not a viewer |
| `ml_training_data` | create | any signed-in user, own userId (**viewer included**) | same, not a viewer |
| `companyProfile/{uid}`, `catalogCosts/{uid}` | write via the solo branch | the uid owner (**a viewer's orphan doc included**), company_admin, platform admin | uid branch not a viewer; others unchanged |
| `companies/{uid}` | create/update/delete | the uid / ownerId (**viewer included**), platform admin (update/delete) | same, not a viewer |
| Storage `photos/ docs/ portals/ documents/ esign/ deal_rooms/ galleries/ reports/ shared_docs/ audio/ receipts/` `{uid}/**` | write/delete | the uid owner (**viewer included**); platform admin delete | uid owner not a viewer; platform admin delete unchanged |

### Deliberately left writable for a viewer (the exceptions)

Each is keyed to the viewer's own uid or `userId`, is read by nobody else in
the tenant, and is what the app writes to boot or to remember the user's own
settings. None of them is customer data.

| Path | Why it stays |
|---|---|
| `users/{uid}` (+ `settings`, `preferences`, `fcmTokens`, `jobTemplates`, `templates`, `captures`) | profile, UI prefs, push-token registration at boot, personal template forks, personal quick-capture inbox. Privileged fields stay frozen. |
| `userSettings/{uid}` | named in decision B |
| `notifications` (own `userId`) | the bell: marking read / dismissing is the user's own UI state |
| `reps/{uid}` | their own team profile (role/isAdmin/companyId stay frozen) |
| `academy_progress/{uid}`, `daily_entries/{uid}/entries`, `dailyTracker`, `training_sessions` | the user's own training/progress records |
| `estimate_drafts/{uid}` | a per-user scratch draft nobody else can read (not even the platform admin); a viewer cannot turn it into an estimate |

## Client: what a viewer is offered

`docs/pro/js/role-gate.js` (new, loaded `defer` on `customer.html` and
`dashboard.html` before the bootstrap module) is the one place the client knows
the role is read-only. Three layers:

1. **Not offered.** `<html>` gets `nbd-role-viewer` when the claims say
   `role === 'viewer'` (an accessor on `window._userClaims`, so every later
   assignment updates it), and a stylesheet hides the listed write controls.
2. **Not run.** A capture-phase click/keydown guard stops any listed control
   before the pages' bubble-phase `data-action` delegates and shows
   "Your role is view-only — ask an owner or manager to make this change."
3. **Never silent.** `window.addDoc/setDoc/updateDoc/deleteDoc/runTransaction/
   writeBatch().commit/uploadBytes/uploadBytesResumable` are watched through
   accessors: a `permission-denied` / `storage/unauthorized` refusal while the
   user is a viewer shows the same notice. The caller still gets the original
   rejection; nothing is blocked; other roles see no change.

Plus `NBDRole.guard()` at the top of 29 entry points, which covers paths that
are not a click on a listed control (keyboard shortcuts, the command palette,
drag-and-drop, `?new=1`).

**Gated (hidden, or kept visible but blocked, and guarded):**

| Area | Controls |
|---|---|
| Notes | inline composer `#quickNoteWrap`, `quickAddNote`, `openNotesModal`/`saveNote`, dashboard `_mJdQuickAddNote` |
| Tasks | `openTaskModal`/`saveTask`/`saveEvent` (customer), `addTask`/`openTaskModal` (dashboard), kanban `open-tasks` via `openTaskModal`, timeline task rows + checkboxes (visible, blocked) |
| Drawings | `saveDrawingToCustomer`, `saveZone`, `startZoneDraw`, `commitPin`, `importToEstimate` |
| Documents | `openDocCreateModal`, `_pickCustomerDoc`, `generateCustomerDoc`, `openDocUploadModal`/`uploadDocuments`, `uploadSignedDoc`, `deleteCustomerDoc`, dashboard `docgen`, `openUploadDoc`/`saveDocUpload`, photo reports |
| Warranty claims | `WarrantyClaim.promptIntake` / `promptResolution` (the kanban move was already blocked for viewers) |
| Photos | `openUploadModal`/`uploadPhotos`, drag-and-drop onto the customer page, bulk delete, quick phase/severity/cover, editor, share pill (visible, blocked) |
| Estimates | `openEstimateModal`/`saveEstimate` (customer), `saveEstimate` (estimates.js), `newEstimate`/`startNewEstimate`, Edit in Builder / Archive |
| Lead | `openLeadModal`/`saveLead`/`saveQuickLead` (create + edit), `openEditCustomerModal`/`saveCustomerEdits`, `progressStage`, `editCardDetails`, card `edit-lead`/`delete-lead`/`move-card`, bulk actions, import/sample data, next-action chip and job checklist (visible, blocked); the customer-ID mint on page open is skipped for a viewer (a viewer who owned the lead passed `_cidCanWrite`, burned a counter number, then failed the lead stamp) |

**Messaged, not hidden** (the rules refuse; layer 3 explains): every other
write that goes through the `window.*` globals, e.g. D2D knocks, expenses,
invoices from the invoice pipeline, pins from the map sidebar, the insurance
claim editor's saves, review requests from the dashboard. Writes made with a
module's own imported SDK functions (not the globals) fail with the module's
own error handling; the page-open ones are background writes a viewer never
asked for.

`upgrade-price-settings.js` `canEdit()`, the client mirror of `cpCanWrite()`,
now refuses a viewer explicitly, matching the rule's new solo branch (its test
pins the rule body and was updated with it).

## Tests

- `tests/firestore-rules.test.js`
  - **34 (new, collect-all)**: 236 checks. For a viewer on data it OWNS:
    create/update/delete refused on the lead doc, all 7 lead subcollections
    (+ `ai_drafts` update), 24 owner-scoped top-level collections, flat
    `notes`, `emails`, `counters`, and the uid-keyed `companyProfile`,
    `catalogCosts` and `companies` docs. Each refusal is paired with the same
    write by a sales_rep on their own data, which succeeds, so the refusal can
    only be the role. The exceptions above: all 16 allowed for the viewer
    (and a self-promotion still refused). One representative write per other
    role unchanged (company_admin, manager, solo with no claims, no-role
    member, platform admin), manager hard-delete refused, and the viewer can
    still read its own and a teammate's lead and rows.
  - **28d (flipped)**: manager hard-delete of `documents`/`warrantyClaims`
    rows now refused, while the manager's create, update and `deleted:true`
    soft delete still succeed and the row survives; owner and company_admin
    still delete. The two #1771 viewer-owner lines flipped from allowed to
    refused, with co-v staff controls on the same rows.
  - **26 (flipped)**: a viewer creating an expense is now refused (it pinned
    the create as allowed, "matches /leads"); the update/delete denials now run
    against a seeded row so they cannot pass on "no such doc".
- `tests/firestore-rules.cross-tenant.test.js`: 146 of 146 (was 130). Per
  subcollection: same-tenant manager cannot hard-delete, same-tenant
  company_admin can, same-tenant viewer cannot. New section I: a viewer-owned
  lead, written by nobody but its own tenant's staff.
- `tests/storage-rules.test.js` 29: per prefix, a viewer upload, overwrite and
  delete under its own uid are refused, the same upload by a no-role solo
  succeeds, the viewer still reads its object, and the platform admin still
  deletes it. **Not run locally**: the Storage emulator's rules are global to
  the emulator, so loading them on the shared rig would have replaced main's
  Storage rules for every lane. CI runs it (`emulators:exec --only storage`,
  a throwaway emulator).
- `tests/role-gate.test.js` (new, node bucket): 105 checks. role-gate.js in a
  sandbox (class via the accessor, guard, watched writes pass the original
  rejection through and explain only viewer permission refusals, capture
  guard, selector coverage both ways), and all 29 guarded entry points
  extracted from their real files and executed: a viewer returns at the guard
  touching nothing else; a sales_rep goes past it.
- `tests/e2e/pro-authed.spec.js` "Viewer role is read-only (Jo's decision B)
  @shard2": seeds a viewer in a tagged throwaway company through the admin SDK
  (emulator mode only), signs in, and checks the dashboard (no Add Lead, board
  still readable, a real refused write surfaces the notice) and the customer
  page (write controls hidden, read-only banner, task click explains and the
  task stays open). Its only write attempt is one main's rules also refuse,
  so it behaves the same on the shared rig. Cleans up by id and by tag.
- `tests/smoke/*`: four shape assertions that pinned the old rule text now pin
  the new text (`notes` author-only, `estimates` delete, Storage photos
  delete, `pins`/`zones` update).

### Break-tests

**Rules (85 runs).** A runner copied `firestore.rules` and both Firestore suites into a scratch tree, applied ONE mutation, and ran both suites against the shared emulator under a fresh `demo-roles-brk-*` project id per run (the app project was never touched). Mutations: the whole helper neutered (`notViewer()` → `isAuth()`), each decision-A line reverted (`isCompanyAdmin` → `isCompanyStaff`), and `notViewer()` stripped from each of the 80 write statements that carry it, one at a time, plus the `cpCanWrite()` solo branch. Every mutation reddened the assertion written for it; the unmutated control stayed green. Rows name the section and the check that went red (the first-failure sections stop at the first one; 34 and the cross-tenant suite list every red check). `34` rows that list a second or third check after a delete mutation are the same row being gone for later checks.

Two gaps the first pass found and this PR closed before the rerun: `companies` update and delete stayed green (no check had a viewer as `ownerId`), so 34 gained a seeded viewer-owned company doc with solo controls; both now redden. One run of the top-level `drawings` create came back with an emulator error instead of a result; rerun, it reddens `drawings create: viewer`.

| Mutation (one rule piece reverted) | What went red |
|---|---|
| control (unmutated) | GREEN |
| B: notViewer() helper -> isAuth() (all of B reverted) | 23: viewer-owner lead update; cross-tenant: viewer: creates a lead ; viewer-owner: adds a task on own lead ; viewer-owner: edits a contract row ; viewer-owner: deletes a contract row |
| A: documents delete isCompanyAdmin -> isCompanyStaff (manager delete back) | 28d: manager hard-delete; cross-tenant: lead documents: same-tenant MANAGER cannot hard-delete |
| A: warrantyClaims delete isCompanyAdmin -> isCompanyStaff (manager delete back) | 28d: manager hard-delete; cross-tenant: warrantyClaims: same-tenant MANAGER cannot hard-delete |
| B: /leads/{leadId} [update] | 23: viewer-owner lead update |
| B: /leads/{leadId} [delete] | 23: viewer-owner lead delete |
| B: /leads/{leadId} [create] | 34: leads create: viewer; cross-tenant: viewer: creates a lead |
| B: /activity/{activityId} [create] | 34: activity create: viewer-owner |
| B: /tasks/{taskId} [write] | 34: tasks create: viewer-owner ; tasks update: viewer-owner ; tasks delete: viewer-owner; cross-tenant: viewer-owner: adds a task on own lead |
| B: /notes/{noteId} [write] | 34: notes create: viewer-owner ; notes update: viewer-owner ; notes delete: viewer-owner |
| B: /documents/{documentId} [create, update] | 28d: viewer-owner row update; cross-tenant: viewer-owner: edits a contract row |
| B: /documents/{documentId} [delete] | 28d: viewer-owner row delete; cross-tenant: viewer-owner: deletes a contract row |
| B: /warrantyClaims/{claimId} [create, update] | 28d: viewer-owner row update |
| B: /warrantyClaims/{claimId} [delete] | 28d: viewer-owner row delete |
| B: /drawings/{drawingId} [write] | 34: drawings create: viewer-owner ; drawings update: viewer-owner ; drawings delete: viewer-owner |
| B: /ai_drafts/{draftId} [update] | 34: ai_drafts update: viewer-owner |
| B: /signatures/{sigRole} [write] | 34: signatures create: viewer-owner ; signatures update: viewer-owner ; signatures delete: viewer-owner |
| B: /estimates/{estimateId} [delete] | 34: estimates delete: viewer-owner ; platform admin edits any estimate ; viewer reads its own estimate |
| B: /estimates/{estimateId} [update] | 34: estimates update: viewer-owner |
| B: /estimates/{estimateId} [create] | 34: estimates create: viewer |
| B: /supplements/{supplementId} [delete] | 34: supplements delete: viewer-owner |
| B: /supplements/{supplementId} [update] | 34: supplements update: viewer-owner |
| B: /supplements/{supplementId} [create] | 34: supplements create: viewer |
| B: /expenses/{expenseId} [create] | 26: viewer expense create |
| B: /expenses/{expenseId} [update] | 26: viewer expense update |
| B: /expenses/{expenseId} [delete] | 26: viewer expense delete |
| B: /recurringExpenses/{templateId} [create] | 34: recurringExpenses create: viewer |
| B: /recurringExpenses/{templateId} [update] | 34: recurringExpenses update: viewer-owner |
| B: /recurringExpenses/{templateId} [delete] | 34: recurringExpenses delete: viewer-owner |
| B: /suppliers/{supplierId} [create] | 34: suppliers create: viewer |
| B: /suppliers/{supplierId} [update] | 34: suppliers update: viewer-owner |
| B: /suppliers/{supplierId} [delete] | 34: suppliers delete: viewer-owner |
| B: /photos/{photoId} [update] | 34: photos update: viewer-owner |
| B: /photos/{photoId} [delete] | 34: photos delete: viewer-owner |
| B: /photos/{photoId} [create] | 34: photos create: viewer |
| B: /pins/{pinId} [update] | 34: pins update: viewer-owner |
| B: /pins/{pinId} [delete] | 34: pins delete: viewer-owner |
| B: /pins/{pinId} [create] | 34: pins create: viewer |
| B: /zones/{zoneId} [update] | 34: zones update: viewer-owner |
| B: /zones/{zoneId} [delete] | 34: zones delete: viewer-owner |
| B: /zones/{zoneId} [create] | 34: zones create: viewer |
| B: /drawings/{drawingId} [update, delete] | 34: drawings update: viewer-owner ; drawings delete: viewer-owner |
| B: /drawings/{drawingId} [create] | 34: drawings create: viewer |
| B: /tasks/{taskId} [update, delete] | 34: tasks update: viewer-owner ; tasks delete: viewer-owner |
| B: /tasks/{taskId} [create] | 34: tasks create: viewer |
| B: /communications/{commId} [update, delete] | 34: communications update: viewer-owner ; communications delete: viewer-owner |
| B: /communications/{commId} [create] | 34: communications create: viewer |
| B: /emails/{emailId} [create] | 34: emails create: viewer |
| B: /documents/{docId} [update, delete] | 34: documents update: viewer-owner ; documents delete: viewer-owner |
| B: /documents/{docId} [create] | 34: documents create: viewer |
| B: /notes/{noteId} [update, delete] | 34: notes(flat) update: viewer-author ; notes(flat) delete: viewer-author |
| B: /notes/{noteId} [create] | 34: notes(flat) create: viewer |
| B: /counters/{counterId} [create] | 34: counters create: viewer |
| B: /counters/{counterId} [update] | 34: counters update: viewer |
| B: /catalogCosts/{companyId} [write] | 34: catalogCosts/{own uid} write: viewer |
| B: /knocks/{knockId} [create] | 34: knocks create: viewer |
| B: /knocks/{knockId} [update] | 34: knocks update: viewer-owner |
| B: /knocks/{knockId} [delete] | 34: knocks delete: viewer-owner |
| B: /territories/{territoryId} [create] | 34: territories create: viewer |
| B: /territories/{territoryId} [update] | 34: territories update: viewer-owner |
| B: /territories/{territoryId} [delete] | 34: territories delete: viewer-owner |
| B: /products/{productId} [update, delete] | 34: products update: viewer-owner ; products delete: viewer-owner |
| B: /products/{productId} [create] | 34: products create: viewer |
| B: /ml_training_data/{docId} [create] | 34: ml_training_data create: viewer |
| B: /templates/{templateId} [update, delete] | 34: templates update: viewer-owner ; templates delete: viewer-owner |
| B: /templates/{templateId} [create] | 34: templates create: viewer |
| B: /companies/{companyId} [create] | 34: companies/{own uid} create: viewer |
| B: /companies/{companyId} [update] | 34: companies (viewer is ownerId) update: viewer |
| B: /companies/{companyId} [delete] | 34: companies (viewer is ownerId) delete: viewer |
| B: /invoices/{invoiceId} [create] | 34: invoices create: viewer |
| B: /invoices/{invoiceId} [update] | 31: viewer-owner invoice update |
| B: /invoices/{invoiceId} [delete] | 31: viewer-owner invoice delete |
| B: /drip_queue/{docId} [create] | 34: drip_queue create: viewer |
| B: /drip_queue/{docId} [update, delete] | 34: drip_queue update: viewer-owner ; drip_queue delete: viewer-owner |
| B: /lead_documents/{docId} [update, delete] | 34: lead_documents update: viewer-owner ; lead_documents delete: viewer-owner |
| B: /lead_documents/{docId} [create] | 34: lead_documents create: viewer |
| B: /referrals/{docId} [create] | 34: referrals create: viewer |
| B: /referrals/{docId} [update] | 34: referrals update: viewer-owner |
| B: /review_requests/{docId} [create] | 34: review_requests create: viewer |
| B: /review_requests/{docId} [update] | 34: review_requests update: viewer-owner |
| B: /reports/{docId} [create] | 34: reports create: viewer |
| B: /reports/{docId} [delete] | 34: reports delete: viewer-owner |
| B: /deal_rooms/{dealId} [update, delete] | 34: deal_rooms update: viewer-owner ; deal_rooms delete: viewer-owner |
| B: /deal_rooms/{dealId} [create] | 34: deal_rooms create: viewer |
| B: companyProfile cpCanWrite() uid branch | 34: companyProfile/{own uid} create: viewer |

**Client.** `tests/role-gate.test.js`: removing the guard from `openLeadModal` reddens exactly its two lines (viewer stops / sales_rep passes); notifying on any role's refusal reddens "a sales_rep refused for another reason gets no view-only notice" (which first needed a throttle reset, found by this break-test); treating every error as a refusal reddens "a viewer hit by an unrelated error". The E2E block, run locally against this worktree served on :5391 and the shared rig: an empty stylesheet reddens "Add Lead is not offered to a viewer"; no capture-phase click guard reddens the task-click notice; unwatched writes redden "the refusal is explained"; `isViewer()` returning false reddens the <html> class check. Every mutation was restored from a byte copy and compared.

**Storage.** Not break-tested (the Storage emulator is global to the rig; see Tests).

## Left open

- **Callables do not check the role.** Admin-SDK Cloud Functions a viewer's
  browser can call (portal links, `replyToPortalMessage`, `sendSMS`,
  `attachStormProof`, `requestMeasurement`, document rendering, …) write on
  the caller's behalf without a `viewer` check. `sendEmail` and
  `markEmailUnsubscribed` already refuse viewers. The client hides the portal
  reply button and the review/referral SMS; the callables themselves are a
  follow-up.
- A viewer's customer page logs `Invoice load error`: `customer-tasks-ui.js`
  puts `viewer` in the team invoice query, but the `invoices` read rule admits
  only staff. Pre-existing, a read-side mismatch, not touched here.
- The kanban task modal (`tasks.js openTaskModal`) is guarded as a whole, so a
  viewer no longer opens it even to read the list; the customer page timeline
  still shows every task.
- Storage break-tests were not run (see above).
