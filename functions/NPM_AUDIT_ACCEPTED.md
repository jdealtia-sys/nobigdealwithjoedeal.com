# Accepted npm audit advisories

Last reviewed: 2026-04-23 (by CI audit triage)

`npm audit` currently reports 12 vulnerabilities in `functions/`
(2 LOW, 10 MODERATE). Every one is transitive through the Google
Cloud / Firebase Admin SDK chain — we do not depend on any of these
packages directly, and none of the vulnerable code paths are
reachable from our function handlers. CI therefore gates on HIGH+
advisories, with this file documenting every accepted lower-tier
finding.

## Dependency chain (all transitive, all from Firebase Admin)

```
firebase-admin
  ├── @google-cloud/firestore
  │     └── google-gax ──┬── gaxios          ← uuid (moderate)
  │                      ├── retry-request    ← teeny-request ← http-proxy-agent ← @tootallnate/once (low)
  │                      └── uuid (moderate)
  └── @google-cloud/storage
        ├── fast-xml-parser (moderate)
        └── teeny-request     ← uuid (moderate)
```

## Advisories

### LOW — GHSA-vpq2-c234-7xj6 (@tootallnate/once < 3.0.1)

- Incorrect Control Flow Scoping (CWE-705).
- CVSS 3.1 `AV:L/AC:L/PR:L/UI:N/S:U/C:N/I:N/A:L` = **3.3 LOW**.
- Requires LOCAL code execution. A Cloud Functions runtime is not
  a shell environment; reaching this code path requires the attacker
  to have already compromised the function process.
- `@tootallnate/once` is abandoned upstream. Fix requires a fresh
  release of `http-proxy-agent` that drops the dep, then propagation
  through `teeny-request`, `retry-request`, `google-gax`, and
  `@google-cloud/firestore`. That upstream chain has not completed.

### MODERATE — GHSA-w5hq-g745-h8pq (uuid < 11.1.0 in v3/v5/v6)

- `uuid.v3/v5/v6` with a custom `buf` argument skips a bounds check
  and can write past the buffer end.
- **Not reachable from our code.** Grep of `functions/` for
  `require('uuid')` and `uuid.v[3-6]` returns zero hits. The
  vulnerable entry points are only called internally by
  `google-gax` / `gaxios` / `teeny-request`, none of which invoke
  v3/v5/v6 with a caller-supplied buffer.
- Upstream fix shipped in `uuid@11.1.0`. The Google Cloud SDK chain
  has not yet picked it up — `firebase-admin@13.x` still resolves
  `uuid@9.x`. Downgrading `firebase-admin` to 10.1.0 (the only
  version `npm audit fix --force` offers) would regress multi-tenant
  and App Check APIs.

### MODERATE — GHSA fast-xml-parser XMLBuilder injection

- XML comment / CDATA injection via unescaped delimiters in
  `fast-xml-parser`'s XMLBuilder API.
- **Not reachable from our code.** We do not import
  `fast-xml-parser` directly; it is only used by
  `@google-cloud/storage` to parse GCS REST XML responses, which
  are trusted server-to-server payloads. We never hand user input
  to any XMLBuilder.

### (informational) follow-redirects was already patched

`follow-redirects@1.15.11` in the lockfile post-dates the fix for
GHSA-r4q5-vmmm-2653 (patched in 1.15.4).

## CI gate

CI runs `npm audit --audit-level=high` in `functions/`. Any HIGH
or CRITICAL advisory fails the build. MODERATE and LOW advisories
listed above are accepted and tracked here.

If a new MODERATE+ advisory appears that is NOT in this file:

1. Check if the vulnerable code path is reachable from our
   handlers (grep `functions/` for the package name; trace the
   call chain from dep-tree root).
2. If unreachable, add it to this file with a short justification
   and the exploitability analysis.
3. If reachable, treat as a P1 — even MODERATE can be exploitable
   when the code path is in-band.
4. On the next dependency-review sprint, re-run `npm audit` and
   remove entries that have upstream fixes picked up.
