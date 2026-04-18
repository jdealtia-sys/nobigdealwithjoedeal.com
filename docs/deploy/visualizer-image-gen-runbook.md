# Visualizer Image Generation — Runbook

## What this is

The `/visualizer` tool now uses **Google Gemini 2.5 Flash Image** (aka "Nano Banana") to generate a real AI-edited photo of the user's home showing their selected roofing, siding, and gutter choices.

**Before:** A canvas color filter painted over the original photo (looked fake, washed out, grainy).
**After:** An actual photorealistic image with the selected materials swapped in.

**Ships DISABLED by default.** After you register a Google AI API key and verify output quality, flip the flag to go live.

## Architecture

```
client (/visualizer)
  │
  │ On "Generate" click, fires BOTH requests in parallel:
  │
  ├─► POST /publicVisualizerAI  (Claude text assessment — already live)
  │     returns { text }  — Joe's written take on the selections
  │
  └─► POST /visualizerImageGen  (NEW — Gemini image gen, gated off)
        returns { imageBase64, mediaType }  — real edited JPEG/PNG
  │
  │ Promise.allSettled: one failure doesn't crash the other path.
  │
  ▼
Render:
  • If image gen succeeded → draw generated image on canvas
  • If image gen failed (incl. "disabled") → legacy canvas color-filter
```

## Cost

~$0.02-$0.04 per visualization.

Gemini 2.5 Flash Image charges per output token; an image is about 1290 tokens. At scale:
- 100 visualizer uses/month → ~$3
- 500 visualizer uses/month → ~$15
- 2000 visualizer uses/month → ~$60

Rate limit is 3 generations per IP per hour (tighter than text endpoint's 5/hour since images are more expensive). Worst-case abuser cost: ~$0.12/hour.

## Files

| File | Role |
|---|---|
| [functions/visualizer-image-gen.js](../../functions/visualizer-image-gen.js) | The `visualizerImageGen` Cloud Function |
| [functions/index.js](../../functions/index.js) | Re-exports at bottom |
| [docs/visualizer.html](../visualizer.html) | `runVisualizer` fires both endpoints in parallel, renders generated image |

## Step 1 — Get a Google AI API key

1. Go to https://aistudio.google.com/apikey
2. Sign in with the Google account you want to bill (probably `jd@nobigdealwithjoedeal.com` — same account tied to your Firebase project `nobigdeal-pro`)
3. Click **Create API key** → select project **nobigdeal-pro**
4. Copy the key (starts with `AIza...`)
5. **Do not commit it anywhere.** It goes straight into Firebase Secret Manager next.

## Step 2 — Add the secret to Firebase

```bash
# One-time: add the secret via Firebase CLI (or the Cloud Console)
echo -n "PASTE_AIza_KEY_HERE" | firebase functions:secrets:set GOOGLE_AI_API_KEY --project nobigdeal-pro

# Confirm it exists
firebase functions:secrets:access GOOGLE_AI_API_KEY --project nobigdeal-pro | head -c 20
```

Or via Cloud Console:
- https://console.cloud.google.com/security/secret-manager?project=nobigdeal-pro
- Click **Create Secret** → name: `GOOGLE_AI_API_KEY` → value: paste the key
- Grant the Cloud Function runtime service account `roles/secretmanager.secretAccessor`

## Step 3 — Deploy

A push to main will auto-deploy. The first deploy will create the `visualizerImageGen` function but it will respond with 503 until the feature flag is set (step 4).

```bash
# Force re-deploy if needed
firebase deploy --only functions:visualizerImageGen --project nobigdeal-pro
```

## Step 4 — Enable the feature flag

Set `VISUALIZER_IMAGEGEN_ENABLED=true` on the function revision.

Via Cloud Console (easiest):
1. https://console.cloud.google.com/functions/list?project=nobigdeal-pro
2. Click `visualizerImageGen`
3. **Edit & deploy new revision**
4. Expand **Runtime, build, connections and security settings** → **Environment variables**
5. Add: `VISUALIZER_IMAGEGEN_ENABLED=true`
6. Click **Deploy** (takes ~2 min)

Via gcloud CLI:
```bash
gcloud run services update visualizerimagegen \
  --region=us-central1 \
  --project=nobigdeal-pro \
  --update-env-vars=VISUALIZER_IMAGEGEN_ENABLED=true
```

## Step 5 — Smoke test

After the revision deploys:

```bash
# Quick endpoint test (server should now return 400 "imageBase64 required" instead of 503)
curl -s -X POST https://us-central1-nobigdeal-pro.cloudfunctions.net/visualizerImageGen \
  -H 'Content-Type: application/json' -d '{}'
# Expected: {"error":"imageBase64 required"}
```

Then open https://nobigdealwithjoedeal.com/visualizer in an incognito tab, upload a real house photo, pick a roof color, and click Generate. You should see:
- Joe's written assessment on the right (Claude) — same as before
- A real AI-edited photo on the left (Gemini) — the new part

## Rolling back

If the output quality is bad, cost is too high, or anything else blows up:

```bash
# Disable immediately — users fall back to the legacy canvas color filter
gcloud run services update visualizerimagegen \
  --region=us-central1 \
  --project=nobigdeal-pro \
  --remove-env-vars=VISUALIZER_IMAGEGEN_ENABLED
```

The frontend handles 503 from this endpoint gracefully — users still see Joe's text assessment and the legacy canvas filter. Nothing breaks.

## Monitoring

```bash
# Tail live logs
gcloud functions logs read visualizerImageGen \
  --gen2 --region=us-central1 --project=nobigdeal-pro --limit=20 --follow
```

Google AI Studio has a usage dashboard:
- https://aistudio.google.com/ → Usage

Set a billing alert at $50/month or whatever cap feels right.

## Prompt tuning

The image-generation prompt is built in `functions/visualizer-image-gen.js` → `buildPrompt()`. If Gemini is producing bad outputs (wrong region changes, added vehicles, lost architectural detail), tune the "guardrails" section at the bottom of that function. The current guardrails:
- "This is a real homeowner's property — be photorealistic and accurate."
- "Do NOT change the house shape, the landscaping, the sky, the ground, neighboring properties, vehicles, or any people."
- "Preserve the original photo's perspective, lighting direction, and shadow angles."
- "Do not add text, watermarks, logos, or signage."
- "Output a single photorealistic JPEG image."

If Gemini ignores a specific guardrail repeatedly, add a stronger line to it.

## Future work

- Caching: same input → same output. Could hash `(imageHash, selections)` and cache Gemini responses in Firestore to avoid re-billing for identical requests. Unlikely to matter at small scale.
- A/B test: half the traffic gets Gemini, half gets the old canvas filter. Compare estimate funnel conversion after 30 days of data.
- SMS delivery: offer "Text this visualization to yourself" button in the results view. Trivial add-on once this is live.
