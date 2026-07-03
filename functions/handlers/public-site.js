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

const { onRequest, onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { httpRateLimit } = require('../integrations/upstash-ratelimit');
const { CORS_ORIGINS, requireTeamAdmin } = require('./_shared');
const { callableRateLimit } = require('../shared');

const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

function s(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

// Only serve a value that is a real hex color. The client already re-validates
// before installing it as a CSS custom property, but validating server-side
// too means no future consumer can be handed a `url(...)`-style payload in a
// colors.* field. Non-hex → '' (the template falls back to its neutral default).
function hex(v) {
  const c = s(v, 20);
  return /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '';
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
      primary: hex(colors.primary),
      accent: hex(colors.accent),
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
    // The global firebase.json '**' header stamps `public, max-age=300` on
    // every hosting response, INCLUDING function rewrites. Left as-is, a 404/
    // 429/500 from this endpoint would be edge-cached for 5 minutes — a
    // cached 429 is a per-edge tenant-site blackout. Force no-store up front;
    // the 200 path re-sets its own cacheable value below.
    res.set('Cache-Control', 'no-store');
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

// ───────────────────────────────────────────────────────────────
// setSiteSlug — Settings surface for the pretty microsite URL.
// Server-side because slugs must be validated against a reserved
// list and checked for uniqueness across ALL tenants — neither is
// enforceable from a client write.
// ───────────────────────────────────────────────────────────────
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;
// Names that collide with real routes/surfaces or the platform brand.
const RESERVED_SLUGS = new Set([
  't', 'oaks', 'template', 'nbd', 'nbdpro', 'api', 'admin', 'pro', 'www',
  'sites', 'free-guide', 'blog', 'assets', 'estimate', 'storm', 'contact',
  'index', 'site', 'app', 'help', 'support',
]);

// Exported for unit tests.
function validateSlug(raw) {
  const slug = String(raw || '').trim().toLowerCase();
  if (!slug) return { slug: '' }; // empty = clear
  if (slug.length < 3 || slug.length > 40 || !SLUG_RE.test(slug)) {
    return { error: 'Use 3-40 lowercase letters, numbers, and hyphens (no leading/trailing hyphen).' };
  }
  if (RESERVED_SLUGS.has(slug)) return { error: 'That name is reserved — pick another.' };
  return { slug };
}

exports.setSiteSlug = onCall(
  {
    region: 'us-central1',
    cors: CORS_ORIGINS,
    enforceAppCheck: true,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request) => {
    await callableRateLimit(request, 'setSiteSlug', 10, 3_600_000);
    const { uid, companyId } = await requireTeamAdmin(request);

    const v = validateSlug(request.data && request.data.slug);
    if (v.error) throw new HttpsError('invalid-argument', v.error);

    const db = getFirestore();
    const coRef = db.doc(`companies/${companyId}`);

    // Uniqueness via a claim doc `siteSlugs/{slug}` inside a transaction.
    // A plain check-then-write on companies.siteSlug does NOT close the race:
    // two owners claiming the same slug write DIFFERENT company docs, so
    // Firestore sees no write-write conflict and both commit. Contending on
    // the SAME siteSlugs/{slug} doc makes exactly one win; the loser retries,
    // sees it occupied, and fails. companies.siteSlug stays authoritative for
    // getPublicSiteConfig's lookup; the claim doc is admin-SDK-only (default
    // deny) and exists purely as the lock + reverse index.
    const slugRef = v.slug ? db.doc(`siteSlugs/${v.slug}`) : null;

    await db.runTransaction(async (tx) => {
      const coSnap = await tx.get(coRef);
      if (!coSnap.exists && companyId !== uid) {
        throw new HttpsError('failed-precondition', 'Company not found.');
      }
      const prevSlug = coSnap.exists ? (coSnap.data() || {}).siteSlug : null;

      if (slugRef) {
        const claim = await tx.get(slugRef);
        if (claim.exists && (claim.data() || {}).companyId !== companyId) {
          throw new HttpsError('already-exists', 'That name is taken — pick another.');
        }
      }

      // Pre-Phase-2 solo owner with no company doc yet — create it.
      if (!coSnap.exists) {
        tx.set(coRef, {
          ownerId: uid,
          name: request.auth.token.name || 'My Company',
          status: 'active',
          plan: 'free',
          source: 'slug-ensure',
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      // Release the previous slug's claim if it's changing/clearing.
      if (prevSlug && prevSlug !== v.slug) {
        tx.delete(db.doc(`siteSlugs/${prevSlug}`));
      }
      if (slugRef) {
        tx.set(slugRef, { companyId, updatedAt: FieldValue.serverTimestamp() });
      }
      tx.set(coRef, v.slug
        ? { siteSlug: v.slug, siteSlugUpdatedAt: FieldValue.serverTimestamp() }
        : { siteSlug: FieldValue.delete(), siteSlugUpdatedAt: FieldValue.serverTimestamp() },
        { merge: true });
    });

    logger.info('setSiteSlug', { companyId, slug: v.slug || '(cleared)' });
    return { ok: true, slug: v.slug, url: '/sites/t/' + (v.slug || companyId) };
  }
);

exports._test = { buildPublicConfig, validateSlug };
