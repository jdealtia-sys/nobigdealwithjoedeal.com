# Accepted npm audit advisories

Last reviewed: 2026-04-14 (by security audit sweep)

After `npm update` to the caret-maxima of every direct dependency
(firebase-admin@12.7, firebase-functions@5.1, stripe@14.25,
resend@3.5, twilio@5.13, @sentry/node@7.120, google-auth-library@9.15),
`npm audit` reports 9 LOW-severity vulnerabilities. Every one is
a transitive dependency rooted in the Google Cloud SDK chain:

```
firebase-admin
  └── @google-cloud/firestore
        └── google-gax
              └── retry-request
                    └── teeny-request
                          └── http-proxy-agent
                                └── @tootallnate/once  ← root cause
```

## Advisory

- **GHSA-vpq2-c234-7xj6** — `@tootallnate/once` <3.0.1 — Incorrect Control Flow Scoping (CWE-705)
- CVSS 3.1: `AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L` = **3.3 LOW**

The vector is `AV:L` — **local** code execution required. The Cloud
Functions runtime is not a shell environment; an attacker would need
to have already compromised the function's process to reach this
code path, at which point this vulnerability is the least of our
problems. This is not a network-exploitable issue.

## Why we can't fix it right now

`@tootallnate/once` is abandoned upstream. The fix requires a
release of `http-proxy-agent` that removes the dependency, which
then requires `teeny-request`, `retry-request`, `google-gax`, and
`@google-cloud/firestore` to each release versions that pick up the
new transitive. As of 2026-04-14 that upstream chain has not
completed.

## What we do instead

- Track this file in version control so the acceptance is
  auditable.
- CI `npm audit --audit-level=moderate` would fail on a MODERATE
  or higher vuln; LOW ones are acceptable.
- On the next dependency-review sprint, re-run `npm audit` and
  remove advisories that have upstream fixes. If a HIGH or
  CRITICAL appears, treat as a P1.

## follow-redirects (advisory already patched)

`follow-redirects@1.15.11` is in the lockfile. GHSA-r4q5-vmmm-2653
was fixed in 1.15.4. The `npm audit` output that surfaced this as
a hit was reading an out-of-date advisory metadata entry; the
installed version is safe.
