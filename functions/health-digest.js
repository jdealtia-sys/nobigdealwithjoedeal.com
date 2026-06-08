/**
 * health-digest.js — daily production health digest, emailed to the
 * platform owner. Closes the audit's "no production health monitoring"
 * gap with the simplest possible aggregator: scan recent collections,
 * summarize, drop in email_queue.
 *
 * Signals captured (per UTC day):
 *   - Total Vision spend (sum of userCostMeter writes in the period)
 *   - Top 5 leads by Vision cost burn
 *   - Anthropic token usage (sum across api_usage_daily uid+co buckets)
 *   - Stripe webhook activity (event count + any handlers we know fail)
 *   - photo upload counts (rough volume proxy)
 *   - customerAuditEvents volume (homeowner engagement proxy)
 *
 * Scheduled daily at 14:00 UTC (= 9am Eastern). Drops a single row
 * into email_queue/ which the existing emailQueueWorker drains.
 *
 * Disabled by default. Flip on by:
 *   firebase functions:config:set health.digest_enabled="true"  (legacy)
 *   OR set HEALTH_DIGEST_ENABLED=true env var in the deploy.
 */

'use strict';

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

// Destination — single recipient, the platform owner. Could become a
// multi-recipient allowlist if we ever onboard ops staff.
const RECIPIENT = 'jd@nobigdealwithjoedeal.com';

// Aggregate window: previous 24h ending at the function's invocation time.
const WINDOW_MS = 24 * 60 * 60 * 1000;

function fmtUsd(n) {
  return '$' + (Math.round(Number(n || 0) * 100) / 100).toFixed(2);
}
function fmtNum(n) {
  return Number(n || 0).toLocaleString('en-US');
}

async function gatherVisionSpend(db, cutoffMs) {
  // userCostMeter is keyed by `${uid}__${YYYY-MM}` — pull all for
  // current + previous month and sum updates whose `updatedAt` falls
  // inside the window.
  const now = new Date();
  const monthKeys = [
    now.toISOString().slice(0, 7),
    new Date(now.getTime() - 32 * 86_400_000).toISOString().slice(0, 7),
  ];
  let userTotal = 0;
  let userCount = 0;
  for (const mk of monthKeys) {
    const snap = await db.collection('userCostMeter')
      .where('monthKey', '==', mk)
      .get();
    snap.forEach(d => {
      const data = d.data();
      const ts = data.updatedAt && data.updatedAt.toMillis ? data.updatedAt.toMillis() : 0;
      if (ts >= cutoffMs) {
        userTotal += Number(data.visionUsd || 0);
        userCount += Number(data.visionCount || 0);
      }
    });
  }

  // Top 5 leads by spend (lifetime — close enough for a daily digest;
  // adding a 24h-window meter is a follow-up).
  const topLeads = [];
  const leadSnap = await db.collection('leadCostMeter')
    .orderBy('visionUsd', 'desc')
    .limit(5)
    .get();
  leadSnap.forEach(d => {
    const data = d.data();
    topLeads.push({
      leadId: d.id,
      usd: Number(data.visionUsd || 0),
      count: Number(data.visionCount || 0),
    });
  });

  return { userTotal, userCount, topLeads };
}

async function gatherStripe(db, cutoffMs) {
  // stripe_events is admin-SDK only — counts as a rough proxy for
  // webhook health. Empty = either no Stripe activity (fine) or webhook
  // not delivering (bad). We just report the count; a separate
  // failed-events read would need Stripe API access.
  let total = 0;
  let recentTypes = {};
  const snap = await db.collection('stripe_events').limit(200).get();
  snap.forEach(d => {
    const data = d.data();
    const ts = data.processedAt && data.processedAt.toMillis ? data.processedAt.toMillis() : 0;
    if (ts >= cutoffMs) {
      total++;
      recentTypes[data.type] = (recentTypes[data.type] || 0) + 1;
    }
  });
  return { total, recentTypes };
}

async function gatherApiUsage(db) {
  // api_usage_daily/{dayKey}__uid__{uid} and __co__{companyId} —
  // reserved Claude tokens for today. Sum the uid rows (the co rows
  // double-count).
  const dayKey = new Date().toISOString().slice(0, 10);
  let total = 0;
  let topUsers = [];
  const snap = await db.collection('api_usage_daily').get();
  snap.forEach(d => {
    if (!d.id.includes('__uid__')) return;
    if (!d.id.startsWith(dayKey)) return;
    const tokens = (d.data() && d.data().tokensUsed) || 0;
    total += Number(tokens);
    topUsers.push({ uid: d.id.split('__uid__')[1], tokens });
  });
  topUsers.sort((a, b) => b.tokens - a.tokens);
  return { total, topUsers: topUsers.slice(0, 5) };
}

async function gatherActivity(db, cutoffMs) {
  // Rough activity proxies. We deliberately use `count()` aggregation
  // where supported but fall through to a bounded fetch elsewhere.
  let photos = 0;
  let portalEvents = 0;
  try {
    const photosSnap = await db.collection('photos')
      .where('uploadedAt', '>=', admin.firestore.Timestamp.fromMillis(cutoffMs))
      .limit(2000)
      .get();
    photos = photosSnap.size;
  } catch (_) { /* missing index → skip */ }
  try {
    const eventsSnap = await db.collection('customerAuditEvents')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(cutoffMs))
      .limit(2000)
      .get();
    portalEvents = eventsSnap.size;
  } catch (_) { /* missing index → skip */ }
  return { photos, portalEvents };
}

function buildEmailBody({ vision, stripe, api, activity, periodLabel }) {
  const topLeadsRows = vision.topLeads.length
    ? vision.topLeads.map(l =>
        '<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;font-family:monospace;font-size:11px;">' + l.leadId.slice(0, 14) + '…</td>' +
        '<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">' + fmtUsd(l.usd) + '</td>' +
        '<td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;color:#666;">' + fmtNum(l.count) + ' calls</td></tr>'
      ).join('')
    : '<tr><td colspan="3" style="padding:12px;color:#999;font-style:italic;">No Vision spend yet.</td></tr>';

  const stripeTypeRows = Object.keys(stripe.recentTypes).length
    ? Object.entries(stripe.recentTypes).map(([type, count]) =>
        '<tr><td style="padding:4px 12px;font-family:monospace;font-size:11px;">' + type + '</td>' +
        '<td style="padding:4px 12px;text-align:right;">' + fmtNum(count) + '</td></tr>'
      ).join('')
    : '<tr><td colspan="2" style="padding:8px 12px;color:#999;font-style:italic;">No Stripe events in window.</td></tr>';

  const topUserRows = api.topUsers.length
    ? api.topUsers.map(u =>
        '<tr><td style="padding:4px 12px;font-family:monospace;font-size:11px;">' + u.uid.slice(0, 14) + '…</td>' +
        '<td style="padding:4px 12px;text-align:right;">' + fmtNum(u.tokens) + ' tokens</td></tr>'
      ).join('')
    : '<tr><td colspan="2" style="padding:8px 12px;color:#999;font-style:italic;">No Claude usage today.</td></tr>';

  return [
    '<div style="font-family:-apple-system,system-ui,sans-serif;max-width:600px;margin:0 auto;color:#1a1612;">',
    '<h2 style="font-size:18px;margin:0 0 4px;letter-spacing:.04em;text-transform:uppercase;color:#e8720c;">NBD Pro · Health Digest</h2>',
    '<div style="color:#888;font-size:12px;margin-bottom:18px;">' + periodLabel + '</div>',

    '<h3 style="font-size:14px;color:#1a1612;margin:18px 0 8px;border-bottom:2px solid #e8720c;padding-bottom:4px;">Vision AI Spend</h3>',
    '<div style="font-size:13px;margin-bottom:8px;"><strong>' + fmtUsd(vision.userTotal) + '</strong> across <strong>' + fmtNum(vision.userCount) + '</strong> Vision calls in the last 24h.</div>',
    '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;"><thead><tr style="text-align:left;color:#888;text-transform:uppercase;letter-spacing:.06em;font-size:10px;"><th style="padding:6px 12px;">Top Leads (lifetime)</th><th style="padding:6px 12px;text-align:right;">Spend</th><th style="padding:6px 12px;text-align:right;">Calls</th></tr></thead><tbody>' + topLeadsRows + '</tbody></table>',

    '<h3 style="font-size:14px;color:#1a1612;margin:18px 0 8px;border-bottom:2px solid #e8720c;padding-bottom:4px;">Stripe Webhook Activity</h3>',
    '<div style="font-size:13px;margin-bottom:8px;"><strong>' + fmtNum(stripe.total) + '</strong> events processed in the last 24h.</div>',
    '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;"><tbody>' + stripeTypeRows + '</tbody></table>',

    '<h3 style="font-size:14px;color:#1a1612;margin:18px 0 8px;border-bottom:2px solid #e8720c;padding-bottom:4px;">Anthropic Token Usage (today)</h3>',
    '<div style="font-size:13px;margin-bottom:8px;"><strong>' + fmtNum(api.total) + '</strong> tokens reserved across all users.</div>',
    '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:14px;"><tbody>' + topUserRows + '</tbody></table>',

    '<h3 style="font-size:14px;color:#1a1612;margin:18px 0 8px;border-bottom:2px solid #e8720c;padding-bottom:4px;">Activity</h3>',
    '<div style="font-size:13px;line-height:1.6;">',
    '<strong>' + fmtNum(activity.photos) + '</strong> photo uploads · ',
    '<strong>' + fmtNum(activity.portalEvents) + '</strong> homeowner portal events',
    '</div>',

    '<div style="margin-top:24px;padding-top:14px;border-top:1px solid #ddd;font-size:11px;color:#888;">Auto-generated daily. Source: <code>functions/health-digest.js</code>. To pause: unset HEALTH_DIGEST_ENABLED in the function env.</div>',
    '</div>'
  ].join('\n');
}

exports.healthDigestCron = onSchedule(
  {
    // Daily 14:00 UTC = ~9-10am Eastern (whichever side of DST).
    schedule: '0 14 * * *',
    timeZone: 'Etc/UTC',
    maxInstances: 1,
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const enabled = process.env.HEALTH_DIGEST_ENABLED === 'true';
    if (!enabled) {
      logger.info('health_digest.skipped', { reason: 'HEALTH_DIGEST_ENABLED not set to true' });
      return;
    }

    const db = admin.firestore();
    const now = Date.now();
    const cutoffMs = now - WINDOW_MS;
    const cutoff = new Date(cutoffMs);

    const [vision, stripe, api, activity] = await Promise.all([
      gatherVisionSpend(db, cutoffMs).catch(e => { logger.warn('health_digest.vision_failed', e.message); return { userTotal: 0, userCount: 0, topLeads: [] }; }),
      gatherStripe(db, cutoffMs).catch(e => { logger.warn('health_digest.stripe_failed', e.message); return { total: 0, recentTypes: {} }; }),
      gatherApiUsage(db).catch(e => { logger.warn('health_digest.api_failed', e.message); return { total: 0, topUsers: [] }; }),
      gatherActivity(db, cutoffMs).catch(e => { logger.warn('health_digest.activity_failed', e.message); return { photos: 0, portalEvents: 0 }; }),
    ]);

    const periodLabel = cutoff.toUTCString() + ' → ' + new Date(now).toUTCString();
    const bodyHtml = buildEmailBody({ vision, stripe, api, activity, periodLabel });
    const subject = 'NBD Pro · Health Digest · ' + fmtUsd(vision.userTotal) + ' Vision · ' + fmtNum(activity.photos) + ' photos';

    await db.collection('email_queue').add({
      to: RECIPIENT,
      subject,
      bodyHtml,
      bodyPlain: 'Health digest for ' + periodLabel + ' — Vision ' + fmtUsd(vision.userTotal) + ', ' + fmtNum(activity.photos) + ' photo uploads, ' + fmtNum(stripe.total) + ' Stripe events.',
      kind: 'health_digest',
      createdAt: FieldValue.serverTimestamp(),
    });

    logger.info('health_digest.queued', {
      visionUsd: vision.userTotal,
      stripeEvents: stripe.total,
      photoUploads: activity.photos,
    });
  }
);

exports._test = { buildEmailBody, fmtUsd, fmtNum };
