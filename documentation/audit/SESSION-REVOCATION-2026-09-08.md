# "Sign Out Everywhere" signed out one browser — 2026-09-08

Found by the 2026-09-08 adversarial claims audit that checked every `/pro`
marketing and help claim against the code. It was the most severe of 14
surviving findings, and the only one where the product told a user they had
performed a security action they had not performed.

Fixed on `claude/priceless-feynman-540948`.

---

## 1. The defect

`docs/pro/dashboard.html` shipped a red **"Sign Out Everywhere"** button in
Settings → Security. `docs/pro/how-to.html` told users, in two places, that if
they suspected a compromised password they should "change it and sign out of
all devices".

The dispatch chain:

| Step | Location | What it did |
| --- | --- | --- |
| Button | `docs/pro/dashboard.html:4113` | `data-action="signOut"` |
| Delegate | `docs/pro/js/dashboard-ui.js:597-600` | `window._signOut()` |
| Implementation | `docs/pro/js/dashboard-bootstrap.module.js:1978-1991` | localStorage sweep + `signOut(auth)` |

`signOut(auth)` is a **purely local** Firebase sign-out. It clears this
browser's persistence and nothing else. An attacker holding a session on
another device kept refreshing it indefinitely — and the victim had just been
told they were safe.

### Why no one caught it

`revokeRefreshTokens` was present in the tree five times, so any grep-shaped
check for "do we revoke tokens?" answered yes. Every one of those five is an
admin or enforcement path acting on **somebody else**:

- `functions/handlers/admin.js:651` — `updateUserRole` (platform/company admin)
- `functions/handlers/admin.js:725` — `deactivateUser`
- `functions/handlers/admin.js:839` — member management
- `functions/handlers/invites.js:661` — member removal
- `functions/integrations/compliance.js:679`
- `functions/lapse-enforcement.js:60` — billing lapse

There was **no self-service path**. The account holder could not reach any of
them.

---

## 2. What shipped

### `revokeMySessions` — `functions/handlers/auth.js`

An App Check-enforced `onCall` that revokes the **caller's** refresh tokens.

**Self-scoped by construction.** The uid comes from the verified token and the
handler takes no target parameter at all. A `uid` in `request.data` is ignored.
This matters more than it looks: a callable that revoked whatever uid arrived
in the payload would let any signed-in user log out any other user on the
platform, with none of `requireTeamAdmin`'s checks. That is a
privilege-escalation hole one careless parameter away, so the test suite
executes the handler with a hostile payload and asserts the caller's uid was
the one revoked.

**A failed revoke throws.** The sibling admin paths swallow revoke failures
with `logger.warn`, and they are right to — there, revocation is a
nice-to-have after the real action (the role change, the deactivation) already
succeeded. Here revocation **is** the action. A swallowed failure would report
success to someone mid-breach whose attacker still has a live session, so this
throws `internal` with a message saying nothing changed. The client
correspondingly does **not** sign out locally when the call fails; it leaves
the user signed in so they can retry.

The `tokensValidAfterTime` read-back after the revoke is deliberately
non-fatal — the revoke already landed, and failing the whole call there would
be the mirror-image lie.

### Rate limit — `functions/rate-limit-policy.js`

```
revokeMySessions: { uidLimit: 5, uidWindow: HOUR, ipLimit: 20, ipWindow: HOUR }
```

Wired with `guardCallable`, matching `validateAccessCode` in
`handlers/portal.js`. One click is the genuine burst need. The per-IP ceiling
is 4× the per-uid one on purpose: a whole office rotating credentials after a
breach is the exact moment this button matters most, and one NAT must not
wedge the fifth person.

Note the trap the suite pins: `uidLimit: 0` reads like "no cap" but makes
`guardCallable` **skip** the per-uid check entirely.

### `docs/pro/js/session-revoke.js` — new deferred external script

Registered in `__NBD_CALL_REGISTRY`, which `_nbdResolveCall` consults before
the allowlist/window fallback, so it needs no allowlist edit and no global.
No inline script, no `on*=` attribute.

**Kept deliberately separate from `_signOut`.** `data-action="signOut"` is on
**three** buttons: the header "Sign Out →" (`:378`), Danger Zone's plain "Sign
Out" (`:3138`), and the Security panel's "Sign Out Everywhere" (`:4113`).
Teaching `_signOut` to revoke would have made every ordinary sign-out log the
user out of their own phone and tablet — a worse bug than the one being fixed,
and the tempting one-line "fix". The suite asserts both directions: the
everywhere button no longer uses the local action, **and** the other two still
do.

---

## 3. The part that is still true after the fix

`revokeRefreshTokens` kills **refresh** tokens. An ID token already in another
device's memory stays valid until it expires — up to an hour. This is a
Firebase Auth trait, and `updateUserRole`'s own comment in `handlers/admin.js`
documents it.

So the honest promise, which the confirm dialog and both help-copy sites now
make, is:

> Devices lose access the next time their session refreshes, **within an hour
> at most**.

Not "instantly". Promising instant lockout would be the same class of overclaim
this change exists to remove, and the suite has an assertion that fails if the
copy starts saying it.

**If instant lockout is ever wanted**, it needs a `tokensValidAfterTime` check
in `firestore.rules` against `request.auth.token.auth_time` — every rule, not
just one. That is a much bigger and riskier change than this one and was
deliberately not attempted here.

---

## 4. Testing

`tests/session-revocation.test.js` — 55 assertions, node bucket,
dependency-free.

**It executes rather than greps.** A `/revokeRefreshTokens/` regex passed
against this tree on the morning of the audit — the string was in five files.
Shape-matching is how this repo has shipped bugs under green tests before, so
the handler and the client action are both **loaded and run** against stubs
(`new Function` with every `require` stubbed, which also keeps the suite
runnable with `functions/node_modules` absent — 8 other node suites are red
here for exactly that reason).

The two assertions that matter cannot be written as string matches at all:

- a uid in `request.data` must not redirect the revoke;
- a **failed** revoke must not sign the user out.

Absence assertions run against comment-stripped source, because both files
under test quote the old `data-action="signOut"` defect verbatim while
explaining the fix — a naive absence regex fails on the correct file.

### What the suite missed on the first push

CI's smoke job caught what 55 local assertions did not: **every `index.js`
export needs a row in `functions/FUNCTIONS_INDEX.md`**, and
`revokeMySessions` had none. The gate did its job
(`tests/smoke/dashboard.test.js`, "every index.js export appears in
FUNCTIONS_INDEX — undocumented exports: revokeMySessions").

Worth recording for two reasons. First, this suite claims to gate the whole
change, so the missing row was a real hole in it — a 56th assertion now pins
the row locally, break-tested. Second, the near-miss while fixing it: the
break-test was reverted with `git checkout -- functions/FUNCTIONS_INDEX.md`
while the new row was still **uncommitted**, so the restore silently deleted
the fix along with the break. `git checkout --` reverts the whole file, not
your hunk. Commit before break-testing, every time.

### Break-tests — eight, each hitting the intended assertion

| # | Break | Reddened |
| --- | --- | --- |
| 1 | Client signs out anyway in the `catch` | "when revocation FAILS the user is NOT signed out locally" (1 only) |
| 2 | Handler reads `request.data.uid` | the two self-scoping assertions |
| 3 | Swallow the revoke failure with `logger.warn` (the sibling-admin shape) | all 5 failure-handling assertions |
| 4 | Delete the ROUTES entry | all 5 policy assertions |
| 5 | Revert the button to `data-action="signOut"` | the 4 markup assertions |
| 6 | Restore the old help copy | the 2 copy assertions |
| 7 | Teach `_signOut` to revoke (the over-correction) | "window._signOut itself was not turned into a revoker" |
| 8 | `uidLimit: 0` (entry still present) | "per-uid ceiling is enforced at all" |

Breaks 7 and 8 exist because both are green under a presence-only test.

---

## 5. What was NOT verified, and why

**No end-to-end emulator run.** `functions/node_modules` is absent in this
worktree, and installing it was refused on purpose: `npm install` in
`functions/` strips `sharp`'s glibc pins, and the `tests/` install drags
`proxy-agent-negotiate` lockfile drift. So the callable has never been invoked
against a live Auth emulator from this branch. What *is* proven is that the
handler body and the client action behave correctly when executed — the
sandbox runs the real code, not a mirror of it.

The remaining unproven link is the deploy-and-invoke round trip, which the
post-deploy `check-function-orphans.js` step will exercise for existence.

---

## 6. Also corrected in place

`docs/pro/how-to.html` — the task brief said a separate PR was already
correcting this copy to stop promising the capability. **It was not**: no open
PR and no merged commit touched it (checked across all six open PRs and the
branch list on 2026-09-08). The brief was stale, so the copy fix landed here.
Rather than removing the promise, the copy now states the capability plainly,
because after this change it is true.

`documentation/INDEX.md` — dropped a stale `(newest)` marker that sat on the
09-07 audit row while a 09-08 row was already above it.

---

## Related

- [SUITE-COUNT-FLOORS-2026-09-08](SUITE-COUNT-FLOORS-2026-09-08.md) — why the
  FLOORS line had to be SET from a measurement on the merged tree here, not
  incremented by one. This branch and the photo-report lane both raised it and
  collided in rebase.
- [STABILITY-AUDIT-2026-09-04](STABILITY-AUDIT-2026-09-04.md) — the earlier
  sweep that established "prove a gate can fail before trusting it".
