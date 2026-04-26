/**
 * share-ssr.js — server-rendered preview for /share/:token
 *
 * Why this exists
 * ───────────────
 * Joe SMSes a portal link to a homeowner. iMessage / Messenger /
 * WhatsApp / Facebook all fetch the URL and render a preview card
 * (OG / oEmbed / Twitter Card protocols). Today /pro/portal.html
 * is fully client-rendered: the crawler sees an empty <body> with
 * a couple of <link> tags and falls back to "no preview", which
 * looks like spam to a homeowner who's already wary of an
 * unsolicited link from a contractor.
 *
 * Fix: a Cloud Function at /share/:token that:
 *   1. Validates the token (same `portal_tokens/{token}` doc the
 *      existing portal flow uses).
 *   2. Loads minimal lead + rep data (admin SDK, server-side).
 *   3. Renders a static HTML page with proper og: + twitter:
 *      meta tags so social/messaging crawlers get a real preview
 *      card — rep name, company, "Your roofing project at <addr>".
 *   4. Above-the-fold body is visible HTML before any JS runs:
 *      a homeowner on a 1-bar LTE connection sees the page
 *      instantly instead of staring at a spinner.
 *   5. Includes a "View full project" button that hands off to
 *      the existing client-rendered /pro/portal.html?token=<t>
 *      for the rich interactive view (estimate, photos, signing).
 *
 * What this is NOT
 * ────────────────
 * - Not the full portal. Estimate detail, signing, photo gallery
 *   stay in /pro/portal.html. SSR is the welcome card.
 * - Does NOT increment `uses` on the token. The token's open
 *   counter is for actual portal opens (the POST in
 *   getHomeownerPortalView), not preview crawls — otherwise an
 *   iMessage preview followed by a real homeowner click would
 *   double-count.
 * - Does NOT bypass token expiry — expired tokens render a
 *   neutral "this link has expired" page (still with branded
 *   meta) rather than 404, because crawlers ignoring 404 pages
 *   would leave a "broken link" preview in the conversation.
 *
 * Security
 * ────────
 * - Public GET endpoint. No auth header. Rate-limited per IP at
 *   120/min — generous to absorb messaging-app preview swarms
 *   (a single iMessage thread can fetch from 4-5 datacenter IPs).
 * - HTML escape every interpolated value. lead.firstName /
 *   lead.address / rep.displayName are user-controlled and end
 *   up in the page body + the og:title attribute.
 * - The CSP for this response is locked down to
 *   `default-src 'none'; img-src 'self' data:; style-src
 *   'self' 'unsafe-inline'`. No remote scripts, no remote
 *   images — anything richer goes through portal.html.
 * - X-Robots-Tag: noindex,nofollow — homeowner data must not be
 *   indexed by search engines even when the token is valid.
 *
 * Hosting wiring
 * ──────────────
 * firebase.json `rewrites` maps `/share/:token` →
 * `shareSSR` cloud function. The Hosting layer caches at the
 * edge for 60s on token-existence misses (404) and 30s on hits;
 * private homeowner data must not sit in shared CDN cache for
 * long, but a brief cache absorbs the messaging-app burst.
 */

'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { httpRateLimit } = require('./integrations/upstash-ratelimit');

const TOKEN_RE = /^[A-Z0-9]{10,64}$/i;

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPage({ title, description, body, status, cacheSeconds }) {
  const safeTitle = escHtml(title || 'Your Project — No Big Deal');
  const safeDesc  = escHtml(description || '');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<meta name="description" content="${safeDesc}">
<meta name="robots" content="noindex, nofollow">
<meta property="og:type" content="website">
<meta property="og:title" content="${safeTitle}">
<meta property="og:description" content="${safeDesc}">
<meta property="og:site_name" content="No Big Deal Home Solutions">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${safeTitle}">
<meta name="twitter:description" content="${safeDesc}">
<style>
  :root { color-scheme: light; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif;
    background: #f7f7f7;
    color: #1a1a1a;
    line-height: 1.5;
  }
  .wrap { max-width: 560px; margin: 0 auto; padding: 32px 20px 64px; }
  .card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,.06), 0 8px 32px rgba(0,0,0,.04);
    padding: 28px 24px;
  }
  .brand {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: .12em;
    color: #e8720c;
    font-weight: 700;
    margin-bottom: 8px;
  }
  h1 { font-size: 22px; margin: 0 0 8px; line-height: 1.25; }
  .addr { color: #5b6068; font-size: 15px; margin: 0 0 18px; }
  .rep {
    display: flex; gap: 12px; align-items: center;
    padding: 12px 14px; background: #f4f5f7; border-radius: 8px;
    margin-bottom: 22px;
  }
  .rep-name { font-weight: 600; }
  .rep-role { color: #5b6068; font-size: 13px; }
  .cta {
    display: inline-block; padding: 14px 22px; background: #e8720c;
    color: #fff; text-decoration: none; font-weight: 600;
    border-radius: 8px; font-size: 15px;
  }
  .cta:hover { background: #d76509; }
  .foot {
    margin-top: 28px; font-size: 12px; color: #888; text-align: center;
  }
  .expired { color: #b34800; font-size: 13px; margin-top: 12px; }
</style>
</head>
<body>
<div class="wrap">
${body}
<div class="foot">Powered by No Big Deal Home Solutions</div>
</div>
</body>
</html>`;
  return { html, status: status || 200, cacheSeconds: cacheSeconds == null ? 30 : cacheSeconds };
}

function expiredPage() {
  return renderPage({
    title: 'Link expired — No Big Deal',
    description: 'This project link has expired. Contact your rep for a new one.',
    status: 410,
    cacheSeconds: 60,
    body: `
      <div class="card">
        <div class="brand">No Big Deal Home Solutions</div>
        <h1>This link has expired</h1>
        <p class="addr">Contact your rep for a fresh link to your project page.</p>
      </div>`,
  });
}

function notFoundPage() {
  return renderPage({
    title: 'Project not found — No Big Deal',
    description: 'We couldn\'t find a project for this link. Please double-check the URL.',
    status: 404,
    cacheSeconds: 60,
    body: `
      <div class="card">
        <div class="brand">No Big Deal Home Solutions</div>
        <h1>Project not found</h1>
        <p class="addr">If your rep just sent this link, give it a moment and try again — or ask them to resend.</p>
      </div>`,
  });
}

function invalidTokenPage() {
  return renderPage({
    title: 'Invalid link — No Big Deal',
    description: 'This link looks malformed. Please double-check or ask your rep to resend.',
    status: 400,
    cacheSeconds: 60,
    body: `
      <div class="card">
        <div class="brand">No Big Deal Home Solutions</div>
        <h1>Invalid link</h1>
        <p class="addr">Please double-check the URL or ask your rep to resend it.</p>
      </div>`,
  });
}

function projectPage({ lead, rep, token }) {
  const firstName = lead.firstName || '';
  const lastName  = lead.lastName  || '';
  const fullName  = (firstName + ' ' + lastName).trim() || 'Your home';
  const addr      = lead.address || '';
  const repName   = rep.displayName || rep.firstName || 'Your rep';
  const company   = rep.companyName || 'No Big Deal Home Solutions';
  const title     = `${fullName} — ${company}`;
  const desc      = addr
    ? `${repName} at ${company} prepared your roofing project at ${addr}. View your estimate and project details.`
    : `${repName} at ${company} prepared your project. View your estimate and project details.`;

  const safeFullName = escHtml(fullName);
  const safeAddr     = escHtml(addr);
  const safeRepName  = escHtml(repName);
  const safeCompany  = escHtml(company);
  const safeToken    = escHtml(token);

  return renderPage({
    title,
    description: desc,
    status: 200,
    cacheSeconds: 30,
    body: `
      <div class="card">
        <div class="brand">${safeCompany}</div>
        <h1>Your roofing project${safeFullName !== 'Your home' ? ', ' + safeFullName : ''}</h1>
        ${safeAddr ? `<p class="addr">${safeAddr}</p>` : ''}
        <div class="rep">
          <div>
            <div class="rep-name">${safeRepName}</div>
            <div class="rep-role">Your rep at ${safeCompany}</div>
          </div>
        </div>
        <a class="cta" href="/pro/portal.html?token=${encodeURIComponent(safeToken)}">View full project →</a>
      </div>`,
  });
}

exports.shareSSR = onRequest(
  {
    region: 'us-central1',
    cors: false,
    // Sized to absorb messaging-app preview swarms — iMessage,
    // Messenger, WhatsApp, and Facebook each fetch independently
    // when a homeowner gets the link in a group thread.
    maxInstances: 40,
    concurrency: 80,
    timeoutSeconds: 8,
    memory: '256MiB',
  },
  async (req, res) => {
    if (req.method !== 'GET') {
      res.set('Allow', 'GET').status(405).end();
      return;
    }

    // Rate-limit per IP to make a brute-force token sweep
    // expensive. 120/min/IP is well above any legitimate
    // messaging-app preview burst.
    if (!(await httpRateLimit(req, res, 'shareSSR:ip', 120, 60_000))) return;

    // Token comes off the URL via Hosting rewrite — Firebase
    // Hosting passes the matched URL through to the function in
    // req.path. e.g. /share/ABCD1234 → req.path === '/share/ABCD1234'.
    const m = String(req.path || '').match(/^\/share\/([^\/?#]+)/);
    const rawToken = m ? decodeURIComponent(m[1]) : '';

    // Always set a tight CSP + noindex on this response — homeowner
    // PII must not leak to a rogue script and must not get indexed.
    res.set('Content-Security-Policy',
      "default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer');

    function send(page) {
      res.set('Cache-Control', `public, max-age=0, s-maxage=${page.cacheSeconds}`);
      res.status(page.status).type('text/html; charset=utf-8').send(page.html);
    }

    if (!TOKEN_RE.test(rawToken)) {
      send(invalidTokenPage());
      return;
    }

    try {
      const db = admin.firestore();
      const tokSnap = await db.doc(`portal_tokens/${rawToken}`).get();
      if (!tokSnap.exists) { send(notFoundPage()); return; }
      const tok = tokSnap.data();

      if (tok.expiresAt && tok.expiresAt.toMillis && tok.expiresAt.toMillis() < Date.now()) {
        send(expiredPage());
        return;
      }
      // Note: deliberately NOT incrementing tok.uses here. The
      // share preview is the welcome card; opens are counted in
      // getHomeownerPortalView when the homeowner actually loads
      // /pro/portal.html. Otherwise crawler previews would
      // exhaust maxUses before the homeowner ever clicked.

      const [leadSnap, repSnap] = await Promise.all([
        db.doc(`leads/${tok.leadId}`).get(),
        db.doc(`users/${tok.ownerUid}`).get(),
      ]);

      if (!leadSnap.exists) { send(notFoundPage()); return; }
      const lead = leadSnap.data();
      const rep = repSnap.exists ? repSnap.data() : {};

      send(projectPage({ lead, rep, token: rawToken }));
    } catch (err) {
      logger.error('shareSSR_failed', { err: String(err) });
      // Fail safe: render a neutral page rather than 500 so the
      // crawler still gets branded preview meta.
      send(notFoundPage());
    }
  }
);
