/**
 * NBD PRO — public tenant-site config (Pillar 5 phase 1)
 * ═══════════════════════════════════════════════════════════════
 * getPublicSiteConfig: the read path behind /sites/t/ — the data-driven
 * tenant microsite that replaces hand-authoring a docs/sites/<tenant>/
 * folder per company (the way docs/sites/oaks/ was built). The template
 * is one static page; THIS endpoint supplies everything tenant-specific,
 * resolved live from companies/{id} + companyProfile/{id}.
 *
 * Why a server endpoint instead of a client Firestore read: companyProfile
 * is rules-scoped to the tenant's own team — a public site can't (and
 * shouldn't) read the raw doc. This endpoint reads it server-side and
 * returns a strict PUBLIC-MARKETING whitelist:
 *   name/displayName, tagline, logoUrl, colors, serviceArea,
 *   contact { phone, email, website, address }, services[]
 * and NEVER: alertEmail/alertSms (lead routing), integrations (Twilio/
 * Cal/Slack endpoints), pricing, legal text, doc numbering.
 *
 * Lookup key: the companyId itself (an unguessable auth uid) or a
 * human slug via companies/{id}.siteSlug (equality query, auto-indexed).
 * Only companies with status 'active' (or legacy docs with no status)
 * are served — a tenant superseded by a team invite stops resolving.
 *
 * The raw companyProfile doc stores only what the tenant actually set
 * (Pillar 2 override semantics), so nothing NBD-branded can leak into
 * another company's site: absent fields simply aren't in the payload
 * and the template renders its own neutral fallbacks.
 */

'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const { getFirestore } = require('firebase-admin/firestore');
const { httpRateLimit } = require('../integrations/upstash-ratelimit');

const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

function s(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// Pure whitelist builder — exported for unit tests. Takes the RAW
// companies/{id} + companyProfile/{id} docs and returns exactly the
// public payload (no alert routing, no integrations, no pricing).
function buildPublicConfig(companyId, companyDoc, profileDoc) {
  const co = companyDoc || {};
  const p = profileDoc || {};
  const b = p.brand || {};
  const c = b.contact || {};

  const services = Array.isArray(p.services)
    ? p.services.slice(0, 12).map((sv) => ({
        icon: s(sv && sv.icon, 8),
        name: s(sv && sv.name, 80),
        desc: s(sv && sv.desc, 200),
      })).filter((sv) => sv.name)
    : [];

  const colors = b.colors || {};
  return {
    ok: true,
    companyId,
    name: s(b.legalName, 80) || s(co.name, 80),
    displayName: s(b.displayName, 80) || s(b.legalName, 80) || s(co.name, 80),
    tagline: s(b.tagline, 160),
    logoUrl: /^https:\/\//.test(String(b.logoUrl || '')) ? s(b.logoUrl, 300) : '',
    colors: {
      primary: s(colors.primary, 20),
      secondary: s(colors.secondary, 20),
      accent: s(colors.accent, 20),
    },
    serviceArea: s(b.serviceArea, 120) || s(p.serviceArea, 120),
    contact: {
      phone: s(c.phone, 30) || s(p.businessPhone, 30),
      email: s(c.email, 200) || s(p.businessEmail, 200),
      website: s(c.website, 200) || s(p.businessWebsite, 200),
      address: s(c.address, 300) || s(p.businessAddress, 300),
    },
    services,
  };
}

exports.getPublicSiteConfig = onRequest(
  {
    region: 'us-central1',
    maxInstances: 10,
    memory: '256MiB',
    timeoutSeconds: 15,
  },
  async (req, res) => {
    if (req.method !== 'GET') { res.status(405).json({ ok: false }); return; }
    if (!(await httpRateLimit(req, res, 'siteConfig:ip', 60, 60_000))) return;

    const key = String(req.query.company || '').trim();
    if (!KEY_RE.test(key)) { res.status(400).json({ ok: false, reason: 'bad_key' }); return; }

    try {
      const db = getFirestore();
      let companyId = key;
      let coSnap = await db.doc(`companies/${key}`).get();
      if (!coSnap.exists) {
        const slugSnap = await db.collection('companies')
          .where('siteSlug', '==', key).limit(1).get();
        if (slugSnap.empty) { res.status(404).json({ ok: false, reason: 'not_found' }); return; }
        coSnap = slugSnap.docs[0];
        companyId = coSnap.id;
      }
      const co = coSnap.data() || {};
      // Superseded / disabled tenants stop resolving; legacy docs with no
      // status field still serve.
      if (co.status && co.status !== 'active') {
        res.status(404).json({ ok: false, reason: 'not_found' });
        return;
      }

      const pSnap = await db.doc(`companyProfile/${companyId}`).get();
      const cfg = buildPublicConfig(companyId, co, pSnap.exists ? pSnap.data() : {});
      if (!cfg.name) { res.status(404).json({ ok: false, reason: 'not_found' }); return; }

      // Edge/browser cacheable — brand edits show up within 5 minutes.
      res.set('Cache-Control', 'public, max-age=300');
      res.status(200).json(cfg);
    } catch (e) {
      logger.error('getPublicSiteConfig failed', { err: e.message });
      res.status(500).json({ ok: false, reason: 'internal' });
    }
  }
);

exports._test = { buildPublicConfig };
