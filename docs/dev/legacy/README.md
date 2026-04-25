# Legacy status docs

These files captured deploy plans, build checklists, and security sweeps at
specific points in time. They are kept for historical reference and out of
the repo root, where they were inevitably stale within a session of being
written.

If you're looking for current state:

- **What's running**: `git log` and the deployed dashboard.
- **Spec / north star**: `memory/site_wide_spec_20260410.md` (auto-loaded
  into Claude sessions) and the live `ARCHITECTURE.txt` at the repo root.
- **Live ops**: see `monitoring/`, the Firebase console, and the active
  Cloud Function in `functions/`.

When something here gets touched again, either bring it back to the repo
root with a date-stamped filename or fold the still-true bits into the
canonical docs.
