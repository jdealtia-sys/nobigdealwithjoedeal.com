# nobigdealwithjoedeal.com

A roofing-contractor CRM for residential roofing operations — sales pipeline,
GAF shingle estimates, insurance claim handling, crew scheduling, and a
customer portal that walks homeowners through the install lifecycle.

Live at https://nobigdealwithjoedeal.com.

## Tech stack

- **Frontend** — vanilla JavaScript + HTML/CSS, served as static assets from
  Firebase Hosting (no bundler, no framework runtime)
- **Backend** — Firebase Cloud Functions (Node.js) for callable endpoints,
  Firestore triggers, and scheduled jobs
- **Data** — Cloud Firestore for transactional data, Cloud Storage for photos
  and uploaded documents
- **Auth** — Firebase Authentication with App Check (reCAPTCHA Enterprise)
- **Mapping** — Google Maps Platform (D2D canvassing, hail-overlay routing)

## Status

Live production single-product. See `documentation/projects/BIG_ROCKS.md`
for the active roadmap and `documentation/archive/` for prior-phase notes.

## Key directories

| Path | What's in it |
| --- | --- |
| `docs/` | Everything served by Firebase Hosting — public marketing site, the `/pro/` operator dashboard, customer portal |
| `functions/` | Cloud Functions source (handlers, integrations, scheduled jobs) |
| `tests/` | Smoke harness (regex-grep static checks) + Firestore/Storage rules emulator tests + end-to-end specs |
| `monitoring/` | Synthetic uptime probes and alert routing |
| `scripts/` | One-shot maintenance / deploy / seed scripts |
| `documentation/` | Internal docs — architecture, runbooks, brand voice, project planning |

## Run smoke tests locally

```
cd tests && node ./smoke.test.js
```

The harness is regex-based and runs against the working tree (no emulator
required). Expected: all tests pass, 0 failures. Anything red blocks the
merge.

## Further reading

- `documentation/ARCHITECTURE.md` — system overview
- `documentation/QUICK_START.md` — local-dev setup walkthrough
- `documentation/runbooks/SECRET_ROTATION.md` — secret rotation procedure
- `SECURITY.md` — security policy and disclosure contact
