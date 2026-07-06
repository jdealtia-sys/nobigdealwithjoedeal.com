#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# NBD Pro — one-shot production ops setup.
#
# Finishes the manual GCP steps from the 2026-07 session that can't be
# done from code: the IAM signer grant, the backup bucket, the 10 alert
# policies, and a read-only owner-claims check. Idempotent — safe to
# re-run; each step no-ops if already applied.
#
# RUN FROM A REAL TERMINAL (laptop), not a phone:
#     gcloud auth login          # pick the account that OWNS nobigdeal-pro
#     bash scripts/ops-setup.sh
#
# If you don't have the repo locally:
#     git clone https://github.com/jdealtia-sys/nobigdealwithjoedeal.com nbd
#     cd nbd && bash scripts/ops-setup.sh
# ─────────────────────────────────────────────────────────────
set -uo pipefail
PROJECT="nobigdeal-pro"
BUCKET="gs://${PROJECT}-firestore-backups"

echo "▶ Confirming access to ${PROJECT} ..."
if ! gcloud projects list --filter="projectId:${PROJECT}" --format="value(projectId)" | grep -q "${PROJECT}"; then
  echo "✗ The signed-in account can't see ${PROJECT}."
  echo "  Run 'gcloud auth login' and choose the account that owns the Firebase project, then re-run."
  echo "  (Your accounts: $(gcloud auth list --format='value(account)' | paste -sd, ))"
  exit 1
fi
gcloud config set project "${PROJECT}" >/dev/null
echo "✓ Access confirmed."

echo "▶ [1/4] IAM: serviceAccountTokenCreator (fixes access-code login + PDF signed URLs) ..."
SA=$(gcloud functions list --gen2 --format="value(serviceConfig.serviceAccountEmail)" --limit=1)
if [ -n "${SA}" ]; then
  gcloud iam service-accounts add-iam-policy-binding "${SA}" \
    --member="serviceAccount:${SA}" --role="roles/iam.serviceAccountTokenCreator" --quiet \
    && echo "✓ Granted to ${SA}" || echo "… already granted (or grant failed — see above)"
else
  echo "✗ Couldn't resolve the functions service account — is Functions deployed?"
fi

echo "▶ [2/4] Backup bucket ..."
if gcloud storage buckets describe "${BUCKET}" >/dev/null 2>&1; then
  echo "✓ ${BUCKET} already exists"
else
  LOC=$(gcloud firestore databases describe --format="value(locationId)")
  gcloud storage buckets create "${BUCKET}" --location="${LOC}" \
    && echo "✓ Created ${BUCKET} in ${LOC}" || echo "✗ Bucket create failed — see above"
fi

echo "▶ [3/4] Alert policies + channel wiring ..."
CREATED=0
for f in monitoring/alert-*.json; do
  NAME=$(python3 -c "import json,sys;print(json.load(open('$f')).get('displayName',''))" 2>/dev/null)
  if [ -n "${NAME}" ] && gcloud alpha monitoring policies list --format="value(displayName)" | grep -qxF "${NAME}"; then
    continue  # already exists
  fi
  gcloud alpha monitoring policies create --policy-from-file="$f" >/dev/null 2>&1 && CREATED=$((CREATED+1))
done
echo "✓ ${CREATED} new policies created (existing ones skipped)"
CHANNELS=$(gcloud beta monitoring channels list --format="value(name)" | paste -sd,)
if [ -n "${CHANNELS}" ]; then
  for p in $(gcloud alpha monitoring policies list --format="value(name)"); do
    gcloud alpha monitoring policies update "$p" --add-notification-channels="${CHANNELS}" --quiet >/dev/null 2>&1
  done
  echo "✓ Attached $(echo "${CHANNELS}" | tr ',' '\n' | wc -l | tr -d ' ') channel(s) to every policy"
else
  echo "✗ No notification channels found — create at least one in the console first."
fi

echo "▶ [4/4] Owner-claims check (read-only — the #845 merge gate) ..."
npx -y firebase-tools auth:export /tmp/nbd-users.json --project "${PROJECT}" >/dev/null 2>&1
if [ -f /tmp/nbd-users.json ]; then
  python3 - <<'PY'
import json
u = json.load(open('/tmp/nbd-users.json')).get('users', [])
targets = {'jd@nobigdealwithjoedeal.com', 'jonathandeal459@gmail.com'}
found = False
for x in u:
    if (x.get('email') or '').lower() in targets:
        found = True
        claims = x.get('customAttributes', 'NONE')
        methods = ','.join(p.get('providerId','') for p in x.get('providerUserInfo', [])) or '(password only)'
        owner = '"owner":true' in (claims or '')
        print(f"  {'✓' if owner else '✗'} {x['email']:36s} owner={owner}  methods={methods}")
if not found:
    print("  ✗ Neither founder account has ever signed into the dashboard (no auth records).")
print()
print("  → If BOTH show owner=true: reply 'merge 845' to your assistant.")
print("  → If an account is missing or owner=false: sign into /pro/dashboard as that")
print("    account once (the mint trigger fires on sign-in), then re-run this script.")
PY
else
  echo "✗ auth:export failed — check firebase-tools auth (it uses your gcloud login)."
fi

echo ""
echo "▶ REMAINING (not scriptable — 30 seconds in a browser):"
echo "  • Shadow flag: console.firebase.google.com → ${PROJECT} → Firestore →"
echo "    feature_flags/_default → add boolean field serverAggregatesShadow = true"
echo "✓ ops-setup complete."
