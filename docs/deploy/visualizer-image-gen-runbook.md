# Visualizer Image Generation — Runbook

## Current stack

- **Text assessment** (Joe's written take): Claude Haiku 4.5 via Anthropic API — `publicVisualizerAI` in `functions/index.js`
- **Image generation** (the edited "after" photo): **FLUX.1 Kontext Max** via Replicate — `visualizerImageGen` in `functions/visualizer-image-gen.js`

Both fire in parallel from the frontend via `Promise.allSettled`. One failing doesn't block the other.

## Why FLUX, not Gemini

Started with Gemini 2.5 Flash Image. It's cheap (~$0.04/image) and fast (~5s), but wouldn't commit to material swaps on real home photos — asphalt→metal came back as the same asphalt shingles with a slight tint. Spent multiple prompt iterations trying to fix it (temperature=1.0, image-first ordering, explicit "standing seams NOT asphalt courses" instructions, hex colors). It's a known limitation of 2.5 Flash Image for this kind of heavy edit.

Replaced with FLUX.1 Kontext Max — purpose-built for image editing, consistently commits to material/style changes including architectural re-roofs and re-sides. Cost is ~$0.08/image (2× Gemini) — still trivial at this scale.

## Cost

- **~$0.08 per visualization** (FLUX Kontext Max on Replicate)
- Rate limit 15/hour/IP during tuning → tighten to 5/hour after launch
- At 500 uses/month: ~$40/month
- At 2000 uses/month: ~$160/month
- Set a Replicate billing alert at whatever monthly cap feels right

## Step 1 — Create Replicate API token (2 min)

1. Go to https://replicate.com/signin and sign in (or create an account — use `jd@nobigdealwithjoedeal.com`)
2. After sign-in, go to https://replicate.com/account/api-tokens
3. Click **Create token** → name it `nbd-pro-functions` → copy the value (starts with `r8_...`)
4. Replicate requires a credit card for paid models (FLUX Kontext Max is paid). Add one under https://replicate.com/account/billing

## Step 2 — Add it to Firebase Secret Manager (1 min)

Fastest via Cloud Console:
- https://console.cloud.google.com/security/secret-manager?project=nobigdeal-pro
- Click **Create Secret** (or if `REPLICATE_API_TOKEN` already exists from the auto-deploy stub, click into it and add a new version)
- **Name:** `REPLICATE_API_TOKEN`
- **Secret value:** paste the `r8_...` token
- Click **Create Secret** (or **Add new version**)

Or via CLI:
```bash
echo -n "r8_YOUR_TOKEN_HERE" | firebase functions:secrets:set REPLICATE_API_TOKEN --project nobigdeal-pro
```

## Step 3 — Deploy

Push to main auto-deploys. The function will wait for the first request; first request after a cold start adds ~2s startup overhead.

If you need to force re-deploy:
```bash
firebase deploy --only functions:visualizerImageGen --project nobigdeal-pro
```

## Step 4 — Flip (or keep) the feature flag

`VISUALIZER_IMAGEGEN_ENABLED=true` should already be set from earlier Gemini testing. If you re-deploy and it's gone, add it back via Cloud Console or:

```bash
gcloud run services update visualizerimagegen \
  --region=us-central1 --project=nobigdeal-pro \
  --update-env-vars=VISUALIZER_IMAGEGEN_ENABLED=true
```

## Step 5 — Also switch the secret reference

Because I swapped the `defineSecret()` call from `GOOGLE_AI_API_KEY` to `REPLICATE_API_TOKEN`, the Cloud Run revision will need the new secret attached and the old one can be detached. Firebase deploy usually does this automatically, but if the first call fails with "secret not attached":

1. https://console.cloud.google.com/functions/list?project=nobigdeal-pro → `visualizerImageGen` → **Edit & deploy new revision**
2. **Variables & Secrets** tab → **Secrets exposed as environment variables**
3. Confirm `REPLICATE_API_TOKEN` is listed, pointing to **`latest`** (not a specific version number — that caused a headache last time)
4. Remove the old `GOOGLE_AI_API_KEY` row if still present
5. Deploy

## Smoke test

```bash
curl -s -X POST https://us-central1-nobigdeal-pro.cloudfunctions.net/visualizerImageGen \
  -H 'Content-Type: application/json' \
  -d '{}'
# Expected: {"error":"imageBase64 required"}
# If instead: {"error":"disabled"} → flag not set
# If instead: HTTP 500 + "server_error" → secret not attached, check Step 5
```

Then open https://nobigdealwithjoedeal.com/visualizer in an incognito tab, upload a real house photo, pick a roof material + color, click Generate. Expected: visibly re-roofed house (metal panels where there used to be shingles, etc.) within ~15s.

## Rolling back

```bash
# Disable the function (legacy canvas filter takes over)
gcloud run services update visualizerimagegen \
  --region=us-central1 --project=nobigdeal-pro \
  --remove-env-vars=VISUALIZER_IMAGEGEN_ENABLED
```

## Monitoring

```bash
gcloud functions logs read visualizerImageGen \
  --gen2 --region=us-central1 --project=nobigdeal-pro --limit=20 --follow
```

Replicate dashboard for usage + cost: https://replicate.com/account/billing

## Prompt tuning

The edit prompt is built in `functions/visualizer-image-gen.js` → `buildPrompt()`. If outputs are off (wrong materials, ignored colors), tune the per-style `textureNote` strings or the `instructions`/`keepUnchanged`/`outputRules` blocks at the bottom of that function. FLUX Kontext is much more literal than Gemini — simple direct prompts work better than elaborate ones.

## Fallback chain

If FLUX fails (disabled, rate-limited, or Replicate down), the frontend falls back to the legacy canvas color filter so users always see SOMETHING. The text assessment from Claude is independent and shows up either way.

## Deferred for future

- Response caching: hash `(image bytes, selections)` → cache the output for 24h. Avoids re-billing for identical requests. Worth adding if costs climb.
- A/B test: 50% FLUX / 50% canvas for a week; compare estimate funnel conversion.
- "Text this visualization to me" SMS button in the results view.
