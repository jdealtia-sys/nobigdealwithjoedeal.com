# 01 — Preflight (5 min)

Goal: prove your local repo is in a clean, testable state before you touch production.

## What you need installed

Open a terminal. Run each:

```bash
node --version   # should be 22.x or higher
npm --version    # should be 10.x or higher
git --version    # any recent version
firebase --version  # should be 13.x or higher
```

If `firebase` is missing:

```bash
npm install -g firebase-tools
```

If `node` is missing: download from [nodejs.org](https://nodejs.org/) — pick the **LTS** version.

## Get the code

```bash
cd ~/code   # or wherever you keep projects
git clone https://github.com/jdealtia-sys/nobigdealwithjoedeal.com.git
cd nobigdealwithjoedeal.com
```

Already cloned? Just update:

```bash
cd nobigdealwithjoedeal.com
git checkout main
git pull
```

## Sign into Firebase

```bash
firebase login
```

A browser opens. Log in with the Google account that owns the `nobigdeal-pro` Firebase project. When the "Success" page appears, close the tab.

Check it worked:

```bash
firebase projects:list
```

You should see `nobigdeal-pro` in the list.

## Run the automated check

We have a script that does every safety check at once:

```bash
scripts/deploy-runbook.sh --dry-run
```

**What "dry run" means:** the script prints every command it *would* run without actually running any of them. Safe to use any time.

What you should see at the bottom:

```
▸ Secret inventory
  ✓ required: ANTHROPIC_API_KEY
  ...
  ! optional: SLACK_WEBHOOK_URL (adapter will be no-op)
  ...
```

Warnings about **optional** secrets are fine. Errors about **required** secrets mean you haven't set them yet — that's what part 2 is for.

## If the script complains about a dirty tree

```bash
git status
```

Commit or stash anything that's listed. The deploy script refuses to run with uncommitted changes (on purpose — you don't want to deploy code that isn't on a branch anyone can find later).

## Done when

- `node --version` prints `v22.*`
- `firebase projects:list` includes `nobigdeal-pro`
- `scripts/deploy-runbook.sh --dry-run` prints its post-deploy checklist at the end without stopping on a red error
- `git status` shows "nothing to commit, working tree clean"

---

Next: [`02-required-secrets.md`](02-required-secrets.md)
