# Cleanup Manifest — ZZ_QA artifacts (purge on Jo's OK)

> RULE 0.7: every `ZZ_QA_` tenant / lead / record created this session is logged here with how to purge it.
> All test leads use `ZZ_QA_` prefixes; all test recipients are Jo's own contact (NBD) or a test contact (Oaks) —
> never a real customer.

## Test tenants
| companyId | owner account | companies/{id}.ownerId | subscription | created by | purge |
|-----------|---------------|------------------------|--------------|------------|-------|
| `oaks` (test) | `zz-qa-oaks-owner@nobigdealwithjoedeal.com` (uid printed by the script) | = test owner uid | `subscriptions/{uid}` plan professional (seeded) | `scripts/provision-tenant.js` (Jo runs) — PLANNED | when re-pointing Oaks to a real owner: delete the test auth user + its `subscriptions/{uid}`; re-`--owner` companies/oaks to the real uid |

> NOTE: `companyProfile/oaks` (brand) is intentionally KEPT (it's real Oaks brand, reused when a real owner takes over).
> Only the throwaway OWNER account + its subscription are test artifacts to purge.

## Test leads (public submits + bridged CRM leads)
| ZZ_QA id / name | source collection | bridged leads/{id} | tenant | created | purge |
|------------------|-------------------|--------------------|--------|---------|-------|
| _(none yet)_ | | | | | |

## Stripe test-mode objects (Phase D)
| object | id | tenant | purge |
|--------|----|--------|-------|
| _(none yet)_ | | | |

## Purge procedure (run after sign-off)
- Bridged CRM leads: delete `leads` where `webLead == true && firstName/name startsWith 'ZZ_QA'`.
- Public-collection leads: delete `*_leads` docs with `ZZ_QA` fields.
- Test tenants: delete `companies/<ZZ_QA>`, `companyProfile/<ZZ_QA>`, and the test auth user(s).
- Stripe: delete test-mode customers/subscriptions (test mode only — never touch live).
