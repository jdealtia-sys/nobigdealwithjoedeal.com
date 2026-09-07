/* booking-events.js — the multi-event booking catalog plus tenant-safe URL
 * resolution, shared by the rep-side customer page and the homeowner portal.
 *
 * Why this file exists
 * ────────────────────
 * Until now every surface resolved exactly one booking URL: the rep's
 * cal.com username + a single `calcomEventSlug` (defaulting to
 * 'roof-inspection'). The NBD account actually publishes six event types,
 * so "Book Inspection" texted a homeowner holding a signed estimate the
 * same link as a cold lead, and a gutter job booked a roof inspection.
 *
 * Tenancy is the tricky part. crm-portal-bridge.js's _repBookingUrl()
 * already learned this the hard way: returning the house account
 * unconditionally meant a contractor who never configured Cal.com texted
 * his homeowner the PLATFORM OWNER's calendar, and every booking landed
 * there. That guard lived in exactly one file — customer-bootstrap.module.js
 * still did `calSettings.username || 'nobigdeal'` with no tenant check at
 * all. Both paths now come through here.
 *
 * Resolution order for a given `kind`, highest first:
 *   1. rep.calcomEventSlugs[kind]  — explicit per-kind config, any tenant.
 *   2. kind === 'inspection'       — the rep's existing single
 *                                    calcomEventSlug (or the legacy
 *                                    localStorage cache). This keeps every
 *                                    tenant's current behaviour byte-identical.
 *   3. NBD tenant only             — the house catalog slug below.
 *   4. ''                          — unavailable; callers must decline to
 *                                    send rather than invent a link.
 *
 * The upshot: a non-NBD tenant that has configured nothing extra sees
 * exactly one option (their inspection link), never an NBD slug. NBD sees
 * all six. A tenant that fills in calcomEventSlugs gets their own.
 */
(function () {
  'use strict';

  /* The NBD house catalog. `kind` is the stable key surfaces reason about;
   * `slug` is the cal.com event slug on the NBD account. Order is the order
   * pickers render in. */
  var KINDS = [
    {
      kind: 'inspection',
      slug: 'roof-inspection',
      label: 'Free Roof Inspection',
      meta: '30 min · At the home',
      blurb: 'The standard first visit — I get on the roof and check everything.'
    },
    {
      kind: 'question',
      slug: 'roof-question-call',
      label: '15-Minute Question Call',
      meta: '15 min · Phone',
      blurb: 'Quick answers on a quote or a claim. Nobody has to come out.'
    },
    {
      kind: 'adjuster',
      slug: 'adjuster-meeting',
      label: 'Insurance Adjuster Meeting',
      meta: '60 min · At the home',
      blurb: 'Meet the adjuster on the roof and document the damage with them.'
    },
    {
      kind: 'estimate',
      slug: 'estimate-walkthrough',
      label: 'Estimate Walkthrough',
      meta: '30 min · Phone',
      blurb: 'Go through the estimate line by line. Nothing to sign.'
    },
    {
      kind: 'gutters',
      slug: 'gutter-siding-estimate',
      label: 'Gutters & Siding Estimate',
      meta: '30 min · At the home',
      blurb: 'Gutters, guards, siding, wood trim — no roof work required.'
    },
    {
      kind: 'lexington',
      slug: 'roof-inspection-lexington',
      label: 'Lexington & Central KY',
      meta: '30 min · At the home',
      blurb: 'Same inspection, batched onto Central Kentucky days.'
    }
  ];

  var NBD_LEGAL_NAME = 'No Big Deal Home Solutions';

  function byKind(kind) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].kind === kind) return KINDS[i];
    return null;
  }

  /* Same test the rest of the CRM uses (crm-portal-bridge.js, the SMS
   * sign-off helpers): no brand, or a brand whose legalName is NBD's. On
   * the homeowner portal there is no window._brand, so callers pass the
   * company name off the server-rendered view instead. */
  function isNbdTenant(ctx) {
    if (ctx && typeof ctx.isNbd === 'boolean') return ctx.isNbd;
    if (ctx && ctx.companyName) return ctx.companyName === NBD_LEGAL_NAME;
    try {
      var b = (typeof window._brand === 'function') ? (window._brand() || null) : null;
      return !b || !b.legalName || b.legalName === NBD_LEGAL_NAME;
    } catch (e) {
      return true; /* same fall-through the existing helper uses */
    }
  }

  function legacyCal() {
    try { return JSON.parse(localStorage.getItem('nbd_cal_settings') || '{}') || {}; }
    catch (e) { return {}; }
  }

  function repOf(ctx) {
    if (ctx && ctx.rep) return ctx.rep;
    return window._currentRep || {};
  }

  function calUsername(ctx) {
    var rep = repOf(ctx);
    var u = String(rep.calcomUsername || '').trim();
    if (u) return u;
    var l = legacyCal();
    if (l.username) return String(l.username).trim();
    /* House account is NBD-only. A tenant with nothing configured gets ''
     * so callers decline to send — see the !url guards in dashboard-ui.js
     * shareCalViaSMS / shareCalViaEmail and sendBookingSMS. */
    return isNbdTenant(ctx) ? 'nobigdeal' : '';
  }

  function slugFor(kind, ctx) {
    var rep = repOf(ctx);
    var map = rep.calcomEventSlugs || {};
    if (map[kind]) return String(map[kind]).trim();

    if (kind === 'inspection') {
      var single = String(rep.calcomEventSlug || legacyCal().eventSlug || '').trim();
      if (single) return single;
    }

    if (isNbdTenant(ctx)) {
      var entry = byKind(kind);
      if (entry) return entry.slug;
    }
    return '';
  }

  function urlFor(kind, ctx) {
    var user = calUsername(ctx);
    var slug = slugFor(kind, ctx);
    if (!user || !slug) return '';
    return 'https://cal.com/' + encodeURIComponent(user) + '/' + encodeURIComponent(slug);
  }

  /* Every kind this rep can actually offer, deduped by resolved URL. A
   * tenant whose single slug answers for several kinds must not render the
   * same link six times under six different names. */
  function options(ctx) {
    var seen = {};
    var out = [];
    for (var i = 0; i < KINDS.length; i++) {
      var k = KINDS[i];
      var url = urlFor(k.kind, ctx);
      if (!url || seen[url]) continue;
      seen[url] = true;
      out.push({ kind: k.kind, label: k.label, meta: k.meta, blurb: k.blurb, url: url });
    }
    return out;
  }

  /* Which visit fits where this job actually is. Returns a kind key; the
   * caller still has to check urlFor() is non-empty for this tenant. */
  function suggest(lead) {
    var l = lead || {};
    var stage = String(l.stage || '').toLowerCase();
    var damage = String(l.damageType || l.jobType || '').toLowerCase();

    /* Estimate is out and unsigned — the next conversation is about the
     * estimate, not another visit. */
    var sig = String((l.estimate && l.estimate.signatureStatus) || l.signatureStatus || '').toLowerCase();
    if (sig && sig !== 'signed' && sig !== 'none') return 'estimate';
    if (stage.indexOf('estimate') !== -1) return 'estimate';

    /* A claim is live but nobody has been on the roof yet — the adjuster
     * visit is the one that matters. */
    var hasClaim = !!(l.insCarrier || l.insuranceCarrier || l.claimNumber || l.claimStatus);
    if (hasClaim && stage !== 'complete' && stage !== 'closed') return 'adjuster';

    if (/gutter|siding|trim|soffit|fascia/.test(damage)) return 'gutters';

    return 'inspection';
  }

  window.NBDBooking = {
    KINDS: KINDS,
    byKind: byKind,
    urlFor: urlFor,
    options: options,
    suggest: suggest,
    isNbdTenant: isNbdTenant
  };

  /* Thin CRM-side alias so callers read the same as the existing
   * window._repBookingUrl() they sit next to. */
  window._repBookingUrlFor = function (kind) { return urlFor(kind); };
})();
