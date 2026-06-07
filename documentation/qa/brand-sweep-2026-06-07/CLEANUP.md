# CLEANUP.md — ZZ_QA_ artifact manifest

> Every throwaway artifact created during this sweep, both tenants. Purge only
> after Jo signs off. Read-only on all real data; observation-only on Oaks public.

## ✅ NOTHING TO CLEAN UP

This sweep created **zero artifacts and mutated zero real data**:
- Phases 0/3/4 were **code-inspection** (Jo chose code-inspection over live PDF gen).
- Phases 1/2 were **read-only live browsing** — no forms submitted on either NBD or
  Oaks public sites; the Oaks contact form and NBD `/inspect` form were screenshotted
  in place, never filled or sent.
- No CRM login, no `ZZ_QA_` job, no PDF render, no Firestore write.

| Date | Tenant | Type | Location / ID | Status |
|------|--------|------|---------------|--------|
| — | — | — | none created | n/a |

Only writes this run: the report files under `documentation/qa/brand-sweep-2026-06-07/`.
