/**
 * NBD — Visualizer Image Generation (FLUX.1 Kontext Max via Replicate)
 * ═══════════════════════════════════════════════════════════════
 *
 * Generates a real AI-edited image of the user's home showing their
 * selected roofing / siding / gutter choices. ~$0.08 per call via
 * Replicate's FLUX.1 Kontext Max model.
 *
 * Why this model: we started with Gemini 2.5 Flash Image ("Nano
 * Banana") but it refused to commit to material swaps (asphalt →
 * metal came back as tinted asphalt, no matter how aggressive the
 * prompt). FLUX.1 Kontext Max is purpose-built for image editing
 * and consistently commits to substantive changes — including
 * material and texture swaps on real architectural photos.
 *
 * The Claude-based text analysis (publicVisualizerAI in index.js)
 * still runs in parallel — it returns Joe's written assessment.
 * This function just returns the edited image.
 *
 * Safety:
 *   - Gated by VISUALIZER_IMAGEGEN_ENABLED env flag (default OFF).
 *     When disabled, returns 503 and frontend falls back to the
 *     legacy canvas color filter.
 *   - Rate limit 15/hour per IP during initial tuning; tighten to
 *     5/hour after launch (~$0.40/hour worst case per abuser).
 *
 * Model swap history:
 *   2026-04-18: Gemini 2.5 Flash Image (too conservative, color-only)
 *   2026-04-18: FLUX.1 Kontext Max via Replicate (current)
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions/v2');

// Shared with other functions — re-use the same rate limiter
const { httpRateLimit } = require('./rate-limit');

// ───────────────────────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────────────────────

// New secret for the Replicate backend. GOOGLE_AI_API_KEY stays
// declared elsewhere in case a future feature uses Gemini again.
const REPLICATE_API_TOKEN = defineSecret('REPLICATE_API_TOKEN');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://nobigdeal-pro.web.app',
];

// Replicate endpoint for black-forest-labs/flux-kontext-max. The
// model-name path auto-selects the latest version, so we don't have
// to hardcode a version hash that eventually gets deprecated.
const REPLICATE_ENDPOINT =
  'https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-max/predictions';

// Max input image — match the text endpoint's cap so the frontend can
// use one resize path for both requests.
const MAX_B64_BYTES = 1_500_000; // ~1.1 MB raw before base64 inflation

// Prompt fragments for each material/style option. Kept as a dict so
// unknown selections fall back cleanly instead of leaking raw tile IDs
// into the prompt.

// Each style/color label includes (a) the human-readable material name
// and (b) an explicit hex color so Gemini can't drift from the target.
// Hexes are picked to match the swatches shown in the UI.

const ROOF_STYLE_LABELS = {
  architectural: 'architectural dimensional asphalt shingles',
  '3-tab': 'traditional 3-tab asphalt shingles',
  luxury: 'luxury designer asphalt shingles',
  metal: 'standing-seam metal roofing panels',
  slate: 'natural slate tile',
};

const ROOF_COLOR_LABELS = {
  charcoal:        { name: 'charcoal black-gray',       hex: '#3a3a3a' },
  'weathered-wood':{ name: 'weathered-wood warm brown', hex: '#5c4a3a' },
  driftwood:       { name: 'driftwood tan',             hex: '#8b7355' },
  onyx:            { name: 'deep onyx black',           hex: '#1a1a1a' },
  sand:            { name: 'sand beige',                hex: '#c8b89a' },
  pewter:          { name: 'pewter gray',               hex: '#6b7280' },
  'rustic-red':    { name: 'rich rustic barn red',      hex: '#8b3a3a' },
  'hunter-green':  { name: 'deep hunter green',         hex: '#3d5a3e' },
};

const SIDING_STYLE_LABELS = {
  'dutch-lap': 'dutch-lap vinyl siding',
  'board-batten': 'board-and-batten vertical siding',
  shake: 'cedar-shake-style siding',
  horizontal: 'horizontal lap siding',
  'fiber-cement': 'James Hardie fiber-cement lap siding',
};

const SIDING_COLOR_LABELS = {
  cream:          { name: 'warm cream',         hex: '#f5f0e8' },
  linen:          { name: 'soft linen white',   hex: '#e8e0d0' },
  'slate-gray':   { name: 'slate gray',         hex: '#6b7280' },
  'charcoal-blue':{ name: 'charcoal blue-gray', hex: '#374151' },
  navy:           { name: 'deep navy blue',     hex: '#1e3a6e' },
  cedar:          { name: 'cedar brown',        hex: '#78350f' },
  forest:         { name: 'forest green',       hex: '#065f46' },
  black:          { name: 'matte black',        hex: '#1c1917' },
};

const GUTTER_COLOR_LABELS = {
  white:        { name: 'crisp white',            hex: '#ffffff' },
  bronze:       { name: 'dark bronze',            hex: '#3c2a20' },
  black:        { name: 'matte black',            hex: '#1c1917' },
  brown:        { name: 'warm brown',             hex: '#57392a' },
  'match-trim': { name: 'a color matching trim',  hex: null },
};

function sanitizeString(value, maxLen = 400) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

function resolveColor(map, key, fallbackKey) {
  return map[key] || (fallbackKey ? map[fallbackKey] : null) || { name: key || 'neutral', hex: null };
}

function buildPrompt(selections) {
  const instructions = [];

  if (selections.features.includes('roof')) {
    const styleKey = selections.roofStyle;
    const style = ROOF_STYLE_LABELS[styleKey] || 'architectural dimensional asphalt shingles';
    const color = resolveColor(ROOF_COLOR_LABELS, selections.roofColor, 'charcoal');
    const hexClause = color.hex ? ` (exactly color ${color.hex})` : '';

    // Per-material surface descriptions force Gemini to commit to a visibly
    // different TEXTURE, not just a color tint. Without this, swaps like
    // asphalt→metal came back as the original asphalt with a color shift.
    let textureNote = '';
    if (styleKey === 'metal') {
      textureNote = ' The new surface is smooth, flat metal panels with visible STANDING SEAMS running down each slope and crisp ridge cap trim — NOT asphalt shingle courses. If the input photo shows asphalt shingles, those must be entirely replaced with flat metal panels. The surface must read as metal, not as tinted shingles.';
    } else if (styleKey === 'slate') {
      textureNote = ' The new surface is layered natural slate tiles with clean straight bottom edges and slight color variation between individual tiles — NOT asphalt shingles. Replace any existing shingles entirely with slate tiles.';
    } else if (styleKey === 'luxury' || styleKey === 'architectural') {
      textureNote = ' The new surface has deep dimensional shadow lines between every course, thick laminated shingle tabs, and crisp staggered edges — a noticeable upgrade in texture from flat 3-tab shingles.';
    } else if (styleKey === '3-tab') {
      textureNote = ' The new surface is flat traditional 3-tab asphalt shingles with clean horizontal cut lines — simple, uniform, no dimensional shadowing.';
    }

    instructions.push(
      `RE-ROOF THIS HOUSE: Replace every visible section of the existing roof with brand-new ${style} in ${color.name}${hexClause}.` +
      textureNote +
      ` The new roof must look installed, not filtered — show the material texture, the courses, the ridge caps, and the cut edges at hips and valleys. ` +
      `Make the change unmistakably visible. This is the whole point of the image — a ${styleKey || 'new'} roof in ${color.name} where the old roof used to be.`
    );
  }

  if (selections.features.includes('siding')) {
    const style = SIDING_STYLE_LABELS[selections.sidingStyle] || 'horizontal lap siding';
    const color = resolveColor(SIDING_COLOR_LABELS, selections.sidingColor, 'cream');
    const hexClause = color.hex ? ` (exactly color ${color.hex})` : '';
    instructions.push(
      `RE-SIDE THIS HOUSE: Replace every exterior wall with brand-new ${style} in ${color.name}${hexClause}. ` +
      `Show the panel lines, the trim transitions, and consistent color saturation across every wall. ` +
      `The siding change must be clearly visible, not a subtle tint.`
    );
  }

  if (selections.features.includes('gutters')) {
    const color = resolveColor(GUTTER_COLOR_LABELS, selections.gutterColor, 'white');
    const hexClause = color.hex ? ` (exactly color ${color.hex})` : '';
    instructions.push(
      `Replace the gutters and downspouts with clean seamless K-style in ${color.name}${hexClause}.`
    );
  }

  if (selections.features.includes('windows')) instructions.push('Freshen the window frames with clean modern trim.');
  if (selections.features.includes('garage'))  instructions.push('Update the garage door to a modern paneled design (same size and placement).');
  if (selections.features.includes('shutters'))instructions.push('Add or refresh exterior shutters in a color that complements the new trim.');
  if (selections.features.includes('doors'))   instructions.push('Freshen the front door with a color that complements the new exterior palette.');

  if (!instructions.length) {
    instructions.push('No specific exterior changes were selected — return the image essentially unchanged.');
  }

  const notes = sanitizeString(selections.notes, 300);
  if (notes) instructions.push(`Homeowner\'s extra notes: ${notes}`);

  // Keep-unchanged list is kept TIGHT — we only call out the things
  // Gemini might otherwise re-invent (sky, vehicles, neighboring homes).
  // We intentionally do NOT say "preserve every detail" — that wording
  // made 2.5 Flash Image under-edit the roof.
  const keepUnchanged = [
    'The house\'s silhouette, window placement, door placement, and overall geometry.',
    'The sky, trees, lawn, driveway, sidewalks, vehicles, and any neighboring properties or power lines.',
    'The camera angle, perspective, and time of day (same sun direction, same shadows).',
    'Any people or pets visible in the photo.',
  ];

  const outputRules = [
    'Output ONE photorealistic image showing the SAME house from the SAME angle, with the exterior changes above actually performed — not a color filter, not a tint, actually re-roofed / re-sided.',
    'Do not add watermarks, logos, text, signage, or floating labels.',
    'Keep the result believable. Match lighting, shadow direction, and material realism so it looks like a professional photograph.',
  ];

  return [
    'You are generating an exterior-remodel preview for a real homeowner. They want to see what their house would look like after the following renovation work:',
    '',
    instructions.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    '',
    'Keep the following unchanged from the input photo:',
    keepUnchanged.map((s) => `- ${s}`).join('\n'),
    '',
    'Output rules:',
    outputRules.map((s) => `- ${s}`).join('\n'),
  ].join('\n');
}

// ───────────────────────────────────────────────────────────────
// visualizerImageGen — HTTP endpoint
// ───────────────────────────────────────────────────────────────
//
// Request body:
//   {
//     imageBase64:  string (required, raw b64 no data-URL prefix),
//     mediaType:    'image/jpeg' | 'image/png' | 'image/webp',
//     features:     string[],  // ['roof','siding','gutters','windows','garage','shutters','doors']
//     roofStyle:    string,
//     roofColor:    string,
//     sidingStyle:  string,
//     sidingColor:  string,
//     gutterColor:  string,
//     notes?:       string
//   }
//
// Response (success):
//   { imageBase64: string, mediaType: 'image/png' }
//
// Response (error):
//   { error: 'descriptive_token' }  — HTTP 400 | 413 | 429 | 503 | 500

exports.visualizerImageGen = onRequest(
  {
    cors: CORS_ORIGINS,
    secrets: [REPLICATE_API_TOKEN],
    maxInstances: 5,
    concurrency: 10,
    timeoutSeconds: 120, // Replicate sync wait can take up to 60s + our own overhead
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'method_not_allowed' });
      return;
    }

    // Feature flag — keeps this off until Joe confirms quality + cost
    if (process.env.VISUALIZER_IMAGEGEN_ENABLED !== 'true') {
      res.status(503).json({ error: 'disabled' });
      return;
    }

    // Rate limit per IP. Bumped to 15/hour during initial prompt tuning
    // so Joe can iterate on outputs. Tighten back to 5/hour after launch
    // (image gen is ~$0.08 per call via FLUX Kontext Max; 15/hr caps each
    // IP at roughly $1.20/hour worst case).
    if (!(await httpRateLimit(req, res, 'visualizerImageGen:ip', 15, 3_600_000))) return;

    try {
      const body = req.body || {};
      const imageBase64 = sanitizeString(body.imageBase64, MAX_B64_BYTES * 2);
      if (!imageBase64 || imageBase64.length === 0) {
        res.status(400).json({ error: 'imageBase64 required' });
        return;
      }
      if (imageBase64.length > MAX_B64_BYTES) {
        res.status(413).json({ error: 'image_too_large' });
        return;
      }

      const allowedMedia = new Set(['image/jpeg', 'image/png', 'image/webp']);
      const mediaType = allowedMedia.has(body.mediaType) ? body.mediaType : 'image/jpeg';

      const selections = {
        features: Array.isArray(body.features) ? body.features.slice(0, 10).map((s) => sanitizeString(s, 40)) : ['roof'],
        roofStyle:   sanitizeString(body.roofStyle, 40),
        roofColor:   sanitizeString(body.roofColor, 40),
        sidingStyle: sanitizeString(body.sidingStyle, 40),
        sidingColor: sanitizeString(body.sidingColor, 40),
        gutterColor: sanitizeString(body.gutterColor, 40),
        notes:       sanitizeString(body.notes, 300),
      };

      const prompt = buildPrompt(selections);
      const inputDataUrl = 'data:' + mediaType + ';base64,' + imageBase64;

      // FLUX.1 Kontext Max input schema:
      //   prompt            (string, required)   — natural-language edit instruction
      //   input_image       (string, required)   — image URL or data-URL
      //   aspect_ratio      (string, optional)   — "match_input_image" preserves source dimensions
      //   output_format     ("jpg"|"png", opt)   — we want jpg for bandwidth
      //   safety_tolerance  (int 1-6, optional)  — 2 is default (strict-ish)
      const replicateBody = {
        input: {
          prompt,
          input_image: inputDataUrl,
          aspect_ratio: 'match_input_image',
          output_format: 'jpg',
          safety_tolerance: 2,
        },
      };

      const response = await fetch(REPLICATE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + REPLICATE_API_TOKEN.value(),
          // Replicate returns as soon as the prediction completes OR after
          // this many seconds, whichever comes first. FLUX Kontext Max
          // typically returns in 8-15s.
          'Prefer': 'wait=60',
        },
        body: JSON.stringify(replicateBody),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        logger.warn('visualizerImageGen: upstream error', {
          status: response.status,
          body: errText.slice(0, 2000),
        });
        res.status(502).json({
          error: 'upstream_error',
          upstream_status: response.status,
        });
        return;
      }

      const data = await response.json();

      // When Prefer: wait completes within the window, status is
      // 'succeeded' and output contains the result. If the model took
      // longer than 60s, we get 'processing' and would need to poll
      // (we don't — we surface it as a timeout).
      if (data.status !== 'succeeded') {
        logger.warn('visualizerImageGen: not succeeded', {
          status: data.status,
          error: data.error,
        });
        res.status(504).json({
          error: 'prediction_timeout_or_failed',
          prediction_status: data.status,
        });
        return;
      }

      // FLUX Kontext returns output as either a string URL or an array
      // with one URL. Normalize.
      const output = Array.isArray(data.output) ? data.output[0] : data.output;
      if (!output || typeof output !== 'string') {
        logger.warn('visualizerImageGen: no output in response', {
          outputType: typeof output,
          keys: Object.keys(data),
        });
        res.status(502).json({ error: 'no_image_returned' });
        return;
      }

      // The output is an HTTPS URL pointing at Replicate's CDN. We fetch
      // it server-side and return base64 to the client, matching the
      // original response shape so the frontend doesn't change.
      const imgResp = await fetch(output);
      if (!imgResp.ok) {
        logger.warn('visualizerImageGen: output fetch failed', {
          status: imgResp.status,
          url: output,
        });
        res.status(502).json({ error: 'output_fetch_failed' });
        return;
      }
      const imgBuf = Buffer.from(await imgResp.arrayBuffer());
      const outMediaType = imgResp.headers.get('content-type') || 'image/jpeg';

      res.json({
        imageBase64: imgBuf.toString('base64'),
        mediaType: outMediaType,
      });
    } catch (e) {
      logger.error('visualizerImageGen error', { err: e && e.message, stack: e && e.stack });
      res.status(500).json({ error: 'server_error' });
    }
  }
);
