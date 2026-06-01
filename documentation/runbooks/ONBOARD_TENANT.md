# Runbook — Onboard a new tenant (contractor)

**Goal:** provision a new contractor company (like Oaks Roofing) end-to-end so
their owner can log in, their data is tenant-isolated, and billing is live.

> Tenancy model: every doc carries a `companyId`; every user has custom claims
> `{ role, companyId }`; Firestore rules enforce
> `request.auth.token.companyId == resource.data.companyId`. Get the company
> doc + claims right and isolation follows. (The white-label **microsite** under
> `docs/sites/` is a separate effort — out of scope here.)

---

## 0. Decide the basics
- `companyId` — short, stable, lowercase slug (e.g. `oaks`). **Immutable** once
  data exists; pick carefully.
- Owner's email, company name, phone, address, plan tier (`starter`/`growth`/…).

## 1. Create the company profile doc
`companyProfile/{companyId}` (shape per `scripts/seed-emulator.js`):
```
companyProfile/oaks = {
  companyId: "oaks",
  name: "Oaks Roofing",
  ownerUid: "<set after step 2>",
  phone: "...", email: "office@oaks...", address: "...",
  createdAt: <serverTimestamp>
}
```
(`functions/seed-companies.js` is the pattern for batch-seeding companies with
an admin SDK credential.)

## 2. Create the owner user + set claims
The owner must end up with claims `{ role: 'company_admin', companyId: 'oaks' }`.

- **Preferred (self-serve):** owner signs up; `onRepSignup`
  (`functions/handlers/auth.js`, a `beforeUserCreated` hook) stamps claims. Confirm
  it mapped them to the right company.
- **Admin-driven:** from an authenticated **platform-admin** session, call the
  `createTeamMember` callable (`functions/handlers/admin.js:430`) with the
  owner's email + role — it creates the Auth user, sets claims, and ensures the
  company doc exists.
- **Manual (last resort):** set claims with the Admin SDK
  (`admin.auth().setCustomUserClaims(uid, { role: 'company_admin', companyId: 'oaks' })`)
  then **revoke refresh tokens** so they take effect (see
  `scripts/grant-admin-claim.js` for the credential/setup pattern — that script
  is for the *platform* admin role; mirror its mechanics, not its role value).

Then backfill `companyProfile/oaks.ownerUid` with the owner's uid.

> Platform `admin` role can NEVER be granted via callable/access-code — only the
> offline `grant-admin-claim.js`. Tenants get `company_admin`, not `admin`.

## 3. Stand up billing
Create the subscription so the billing gate passes:
```
subscriptions/{ownerUid} = { plan: "starter", status: "active",
                             companyId: "oaks", stripeCustomerId: "cus_…" }
```
For real billing, run the owner through the Stripe checkout
(`createCheckoutSession`) so `stripeWebhook` writes this doc itself. Seed it
manually only for a comp/beta tenant.

## 4. Access codes (homeowner portal)
From an admin session, call `rotateAccessCodes` (`functions/handlers/admin.js:369`)
— or seed with `scripts/seed-access-codes.js` — so the tenant's homeowner
portal codes exist. Never reuse another tenant's codes.

## 5. Add the rest of the team
Owner (company_admin) adds reps/viewers via `createTeamMember` (roles:
`company_admin`, `sales_rep`, `viewer`). Each inherits `companyId: 'oaks'`.

## 6. Verify isolation (do not skip)
- Log in as the new owner → dashboard loads, pipeline empty, branding correct.
- Confirm they **cannot** read another tenant's leads (cross-tenant isolation is
  covered by `tests/firestore-rules.cross-tenant.test.js` — the live check is
  that a cross-companyId read is denied).
- Confirm a `sales_rep` sees only their own leads; a `viewer` is read-only.
- Create one test lead → confirm it's stamped `companyId: 'oaks'`.

## 7. Hand-off
Send the owner the login URL + a 2-line "add your team / import leads" note.
Watch their first week in Cloud Logging for permission-denied spikes (a claims
misconfig shows up there).
