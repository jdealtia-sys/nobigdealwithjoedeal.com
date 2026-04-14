/**
 * integrations/measurement.js — aerial roof measurement adapter
 *
 * The #1 cost for a roofer today: $30–50/property for HOVER or
 * EagleView measurements. Integrating those APIs turns this from
 * a cost center into a margin opportunity — we can pass-through
 * bill and mark it up on the estimate.
 *
 * Supported providers (selected via NBD_MEASUREMENT_PROVIDER env):
 *   - hover    (default) — cleanest API, best mobile UX
 *   - eagleview           — most coverage, older/stricter API
 *   - nearmap             — best for storm verification (temporal imagery)
 *
 * SETUP (pick one):
 *   firebase functions:secrets:set HOVER_API_KEY
 *   firebase functions:secrets:set EAGLEVIEW_API_KEY
 *   firebase functions:secrets:set NEARMAP_API_KEY
 *
 * CALLABLE: requestMeasurement({ address, leadId })
 *   Creates a Firestore `measurements/{jobId}` doc with status
 *   'pending', fires the async vendor job, then returns {jobId}.
 *   A separate onRequest webhook endpoint receives vendor callbacks
 *   and updates the doc to 'ready' + populates measurement fields.
 *
 * The V2 estimate builder reads from `measurements/{jobId}` to
 * pre-fill rawSqft, ridge, eave, hip, valley, pitch.
 */

'use strict';

const { onCall, HttpsError, onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { getSecret, hasSecret, PROVIDERS, notConfigured, SECRETS } = require('./_shared');

const CORS_ORIGINS = [
  'https://nobigdealwithjoedeal.com',
  'https://www.nobigdealwithjoedeal.com',
  'https://nbd-pro.web.app'
];

// ─── Provider adapters ─────────────────────────────────────
// Each returns a shape {ok, jobId, estimatedMinutes} or
// {ok:false, reason}. We ALWAYS write a Firestore row first so the
// UI has something to poll — the vendor call can fill it in later.

async function requestHOVER(address, callerUid) {
  if (!hasSecret('HOVER_API_KEY')) return notConfigured('hover');
  const apiKey = getSecret('HOVER_API_KEY');
  try {
    const res = await fetch('https://api.hover.to/v2/jobs', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        address,
        measurement_type: 'roof',
        webhook_url: `https://us-central1-nobigdeal-pro.cloudfunctions.net/measurementWebhook?provider=hover`,
        reference_id: callerUid
      })
    });
    if (!res.ok) {
      const t = await res.text();
      logger.warn('HOVER job create failed', { status: res.status, body: t.slice(0, 200) });
      return { ok: false, reason: 'vendor-error', status: res.status };
    }
    const data = await res.json();
    return {
      ok: true,
      jobId: data.id || data.job_id,
      estimatedMinutes: data.estimated_turnaround_minutes || 30,
      provider: 'hover'
    };
  } catch (e) {
    logger.error('HOVER request error:', e.message);
    return { ok: false, reason: 'network' };
  }
}

async function requestEagleView(address, callerUid) {
  if (!hasSecret('EAGLEVIEW_API_KEY')) return notConfigured('eagleview');
  const apiKey = getSecret('EAGLEVIEW_API_KEY');
  try {
    const res = await fetch('https://apis.eagleview.com/property-measurements/v3/orders', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        address,
        product: 'premium_residential',
        deliveryMethod: 'webhook',
        webhookUrl: `https://us-central1-nobigdeal-pro.cloudfunctions.net/measurementWebhook?provider=eagleview`,
        customerReference: callerUid
      })
    });
    if (!res.ok) {
      return { ok: false, reason: 'vendor-error', status: res.status };
    }
    const data = await res.json();
    return { ok: true, jobId: data.orderId, estimatedMinutes: 240, provider: 'eagleview' };
  } catch (e) {
    return { ok: false, reason: 'network' };
  }
}

async function requestNearmap(address, callerUid) {
  if (!hasSecret('NEARMAP_API_KEY')) return notConfigured('nearmap');
  // Nearmap AI Feature Pack doesn't have a "job" concept the way
  // HOVER does — it's synchronous. Call the AI endpoint directly.
  const apiKey = getSecret('NEARMAP_API_KEY');
  try {
    const res = await fetch(
      `https://api.nearmap.com/ai/features/v4/features.json?address=${encodeURIComponent(address)}&apikey=${apiKey}`,
      { method: 'GET' }
    );
    if (!res.ok) return { ok: false, reason: 'vendor-error', status: res.status };
    const data = await res.json();
    // Nearmap returns features directly — mint our own jobId so the
    // downstream shape is consistent.
    return {
      ok: true,
      jobId: 'nearmap-' + Date.now(),
      estimatedMinutes: 0,
      provider: 'nearmap',
      synchronousData: data
    };
  } catch (e) {
    return { ok: false, reason: 'network' };
  }
}

function selectProvider() {
  const p = PROVIDERS.measurement;
  if (p === 'hover')     return requestHOVER;
  if (p === 'eagleview') return requestEagleView;
  if (p === 'nearmap')   return requestNearmap;
  return requestHOVER; // default
}

// ─── Callable: requestMeasurement ──────────────────────────
exports.requestMeasurement = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB',
    secrets: [
      SECRETS.HOVER_API_KEY, SECRETS.EAGLEVIEW_API_KEY, SECRETS.NEARMAP_API_KEY
    ]
  },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');

    // D1: measurement jobs cost real money per provider API call.
    // Cap at 20/hour/uid so a runaway loop or malicious caller
    // can't $-bomb us.
    const { enforceRateLimit } = require('./upstash-ratelimit');
    try {
      await enforceRateLimit('callable:requestMeasurement:uid', uid, 20, 60 * 60_000);
    } catch (e) {
      if (e.rateLimited) {
        throw new HttpsError('resource-exhausted',
          'Measurement rate limit — try again in an hour (or contact support).');
      }
      throw e;
    }

    const address = typeof request.data?.address === 'string'
      ? request.data.address.trim() : '';
    if (!address || address.length < 5 || address.length > 500) {
      throw new HttpsError('invalid-argument', 'Valid address required');
    }
    const leadId = typeof request.data?.leadId === 'string' ? request.data.leadId : null;

    const providerFn = selectProvider();
    const result = await providerFn(address, uid);

    if (!result.ok) {
      if (result.configured === false) {
        throw new HttpsError('failed-precondition',
          `Measurement provider '${result.provider}' not configured. Contact support.`);
      }
      throw new HttpsError('internal', 'Measurement request failed: ' + (result.reason || 'unknown'));
    }

    const db = admin.firestore();
    const doc = {
      ownerId: uid,
      leadId: leadId,
      address,
      provider: result.provider,
      externalJobId: result.jobId,
      status: result.synchronousData ? 'ready' : 'pending',
      estimatedMinutes: result.estimatedMinutes,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(result.synchronousData ? parseSync(result.synchronousData) : {})
    };
    const ref = await db.collection('measurements').add(doc);
    return {
      jobId: ref.id,
      externalJobId: result.jobId,
      provider: result.provider,
      status: doc.status,
      estimatedMinutes: result.estimatedMinutes
    };
  }
);

// Normalize synchronous provider data (Nearmap) into our own shape.
function parseSync(data) {
  if (!data || !Array.isArray(data.features)) return {};
  const roof = data.features.find(f => f.classId && /roof/i.test(f.classId)) || {};
  return {
    measurements: {
      rawSqft: roof.areaSqft || null,
      pitch:   roof.pitch    || null,
      // Nearmap doesn't always return ridge/eave separately.
      source: 'nearmap-ai'
    }
  };
}

// ─── Webhook: provider pushes completed job ─────────────────
// Configure each vendor to POST back to
//   https://us-central1-nobigdeal-pro.cloudfunctions.net/measurementWebhook?provider=hover
exports.measurementWebhook = onRequest(
  {
    region: 'us-central1',
    maxInstances: 10,
    timeoutSeconds: 15,
    memory: '256MiB'
  },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).end(); return; }
    const provider = String(req.query.provider || '');
    const body = req.body || {};

    // TODO: verify vendor signature — each provider has its own.
    // HOVER: X-Hover-Signature HMAC SHA-256 over rawBody.
    // EagleView: signed JWT in X-EV-Signature.
    // We accept unsigned for now but restrict the path shape.

    // Normalize to our fields.
    let externalJobId, measurements, status;
    if (provider === 'hover') {
      externalJobId = body.job_id || body.id;
      status = body.status === 'completed' ? 'ready' : 'pending';
      measurements = body.measurements ? {
        rawSqft: body.measurements.total_facets_area_sqft,
        ridge:   body.measurements.ridge_linear_feet,
        eave:    body.measurements.eave_linear_feet,
        hip:     body.measurements.hip_linear_feet,
        valley:  body.measurements.valley_linear_feet,
        rake:    body.measurements.rake_linear_feet,
        pitch:   body.measurements.predominant_pitch,
        reportUrl: body.report_url || null
      } : null;
    } else if (provider === 'eagleview') {
      externalJobId = body.orderId;
      status = body.status === 'Completed' ? 'ready' : 'pending';
      const m = body.measurementReport || {};
      measurements = m ? {
        rawSqft: m.totalRoofArea,
        ridge:   m.totalRidges,
        eave:    m.totalEaves,
        hip:     m.totalHips,
        valley:  m.totalValleys,
        rake:    m.totalRakes,
        pitch:   m.predominantPitch,
        reportUrl: body.documentUrl || null
      } : null;
    } else {
      res.status(400).json({ error: 'Unknown provider' });
      return;
    }

    if (!externalJobId) { res.status(400).json({ error: 'Missing job id' }); return; }

    try {
      const db = admin.firestore();
      const snap = await db.collection('measurements')
        .where('externalJobId', '==', externalJobId)
        .limit(1)
        .get();
      if (snap.empty) {
        logger.warn('measurementWebhook: no matching job', { externalJobId, provider });
        res.status(200).json({ ok: true, matched: false }); // ack to stop retries
        return;
      }
      const measurementDoc = snap.docs[0];
      const measurementData = measurementDoc.data() || {};
      await measurementDoc.ref.update({
        status,
        ...(measurements ? { measurements } : {}),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // ─── Auto-attach to lead on ready ────────────────────
      // If the measurement was requested from a specific lead and
      // the vendor just flipped it to 'ready', drop a task on the
      // rep's list + write an activity entry so the rep sees the
      // alert inside the CRM without polling the V2 Builder.
      //
      // Idempotent: the update above fires only once per job, and
      // we guard on a previousStatus snapshot so retried webhooks
      // don't duplicate the task.
      const wasReadyAlready = measurementData.status === 'ready';
      if (status === 'ready' && !wasReadyAlready && measurementData.leadId && measurementData.ownerId) {
        const repUid = measurementData.ownerId;
        const leadId = measurementData.leadId;
        const addr = measurementData.address || '(address unknown)';
        const providerLabel = provider.toUpperCase();

        // Task: one-liner the rep sees in their inbox. Due now.
        await db.collection('tasks').add({
          userId: repUid,
          leadId,
          title: 'Aerial measurement ready — ' + addr,
          description: providerLabel + ' returned measurements for this property. Open the V2 Builder to load into an estimate.',
          source: 'measurement',
          provider,
          measurementJobId: measurementDoc.id,
          dueAt: admin.firestore.Timestamp.now(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          done: false
        });

        // Activity: structured timeline entry on the lead. Rules
        // already allow the rep to read this subcollection.
        await db.collection(`leads/${leadId}/activity`).add({
          userId: repUid,
          type: 'measurement_ready',
          label: providerLabel + ' measurement ready',
          provider,
          measurementJobId: measurementDoc.id,
          reportUrl: (measurements && measurements.reportUrl) || null,
          summary: measurements
            ? (measurements.rawSqft ? Math.round(measurements.rawSqft) + ' SF roof, ' : '')
              + (measurements.pitch ? 'pitch ' + measurements.pitch + ', ' : '')
              + (measurements.ridge ? measurements.ridge + ' LF ridge' : '')
            : null,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Also bump a lead field so the kanban card can show
        // "📐 Measurement ready" without a join query.
        await db.doc(`leads/${leadId}`).set({
          measurementReady: true,
          measurementJobId: measurementDoc.id,
          measurementProvider: provider,
          measurementReadyAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        logger.info('measurementWebhook: attached to lead', {
          leadId, measurementJobId: measurementDoc.id, provider
        });
      }

      res.status(200).json({ ok: true, matched: true });
    } catch (e) {
      logger.error('measurementWebhook error:', e.message);
      res.status(500).json({ error: 'write failed' });
    }
  }
);

module.exports = exports;
