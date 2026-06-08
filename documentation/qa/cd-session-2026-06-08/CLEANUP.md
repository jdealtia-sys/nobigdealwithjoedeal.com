# Cleanup Manifest — ZZ_QA artifacts (purge on Jo's OK)

> RULE 0.7: every `ZZ_QA_` tenant / lead / record created this session is logged here with how to purge it.
> All test leads use `ZZ_QA_` prefixes; all test recipients are Jo's own contact (NBD) or a test contact (Oaks) —
> never a real customer.

## Test tenants
| companyId | owner account | companies/{id}.ownerId | subscription | created by | purge |
|-----------|---------------|------------------------|--------------|------------|-------|
| `oaks` (test) | `zz-qa-oaks-owner@nobigdealwithjoedeal.com` uid `VuXj6xUYoEVYwL7mhl1hFSN1XRx1` | `VuXj6xUYoEVYwL7mhl1hFSN1XRx1` | `subscriptions/VuXj6x…` plan professional (seeded) | `scripts/provision-tenant.js` — **PROVISIONED in prod 2026-06-08** | when re-pointing Oaks to a real owner: delete auth user `VuXj6x…` + `subscriptions/VuXj6x…`; re-`--owner` companies/oaks to the real uid |

> NOTE: `companyProfile/oaks` (brand) + `companies/oaks` doc are intentionally KEPT (real Oaks tenant config, reused
> when a real owner takes over — only `--owner` is re-pointed). Only the throwaway OWNER account + its subscription
> are test artifacts to purge.
> SA-KEY HYGIENE: a short-lived `firebase-adminsdk-fbsvc` key (id `024…`) was minted to run the provisioning and
> **deleted + revoked immediately after** (file removed + `gcloud iam service-accounts keys delete`). No lingering key.

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
