/**
 * alert-health-banner.js — lead-alert delivery health surface.
 *
 * The alert_outbox ledger (functions/lead-alert.js recordAlertOutbox +
 * functions/handlers/invites.js teamInviteEmail) records every alert/invite
 * delivery attempt with per-channel outcomes ('sent' / 'failed:<err>' /
 * 'skipped:<why>'). CI asserts the ROUTING; this banner closes the loop on
 * DELIVERY: if Resend/Twilio starts failing in prod, the ledger records it
 * but nothing looked at it — a dead API key meant alerts silently never
 * arrived while leads kept landing in the CRM. Email can't announce its own
 * outage, so the dashboard (which the owner opens daily) is the surface.
 *
 * Behavior: after boot resolves auth + claims, owners / platform admins /
 * company_admins query the most recent outbox docs (admin: global feed;
 * tenant staff: companyId-scoped — needs the {companyId, createdAt}
 * composite index, firestore.indexes.json). Any 'failed:*' email/SMS status
 * within the last 48h renders a fixed red banner with the count and a
 * dismiss button (dismissal is per-day via localStorage, so a persistent
 * outage re-surfaces tomorrow, not every reload).
 *
 * Fail-quiet by design: any error (rules denial, offline, missing index
 * mid-deploy) logs at debug and renders nothing — this widget must never
 * affect boot.
 */
(function () {
  'use strict';
  const __NBD_LOADED = window.__NBD_LOADED = window.__NBD_LOADED || {};
  if (__NBD_LOADED['alert-health-banner']) return;
  __NBD_LOADED['alert-health-banner'] = true;

  const BANNER_ID = 'nbd-alert-health-banner';
  const WINDOW_MS = 48 * 60 * 60 * 1000;
  const DISMISS_KEY = 'nbd_alert_health_dismissed'; // stores YYYY-MM-DD

  function dismissedToday() {
    try { return localStorage.getItem(DISMISS_KEY) === new Date().toISOString().slice(0, 10); }
    catch (e) { return false; }
  }

  function isFailed(status) {
    return typeof status === 'string' && status.indexOf('failed:') === 0;
  }

  function render(failCount, channels) {
    if (document.getElementById(BANNER_ID)) return;
    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.setAttribute('role', 'alert');
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:calc(var(--z-banner,10006) + 1);' +
      'background:#dc2626;color:#fff;font-size:13px;font-weight:600;' +
      'padding:8px 40px 8px 14px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.25);';
    banner.textContent =
      '⚠ ' + failCount + ' lead-alert deliver' + (failCount === 1 ? 'y' : 'ies') +
      ' failed in the last 48h (' + channels.join(' + ') + '). New leads are safe in the CRM' +
      ' — but notifications are not arriving. Check the Resend/Twilio keys.';
    const close = document.createElement('button');
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss for today');
    close.textContent = '✕';
    close.style.cssText =
      'position:absolute;right:8px;top:50%;transform:translateY(-50%);' +
      'background:none;border:none;color:#fff;font-size:15px;cursor:pointer;padding:4px 8px;';
    close.addEventListener('click', function () {
      try { localStorage.setItem(DISMISS_KEY, new Date().toISOString().slice(0, 10)); } catch (e) {}
      banner.remove();
    });
    banner.appendChild(close);
    document.body.appendChild(banner);
  }

  async function check() {
    const db = window._db;
    const claims = window._userClaims || {};
    const role = claims.role || '';
    const mayView = claims.admin === true || claims.owner === true || role === 'company_admin';
    if (!db || !mayView || dismissedToday()) return;
    if (typeof window.collection !== 'function' || typeof window.getDocs !== 'function') return;

    // Platform admin/owner: global feed (rules allow; single-field createdAt
    // index). Tenant company_admin: must pin companyId for rules provability
    // ({companyId, createdAt} composite).
    let q;
    if (claims.admin === true || claims.owner === true) {
      q = window.query(
        window.collection(db, 'alert_outbox'),
        window.orderBy('createdAt', 'desc'), window.limit(20));
    } else {
      q = window.query(
        window.collection(db, 'alert_outbox'),
        window.where('companyId', '==', claims.companyId || ''),
        window.orderBy('createdAt', 'desc'), window.limit(20));
    }

    const snap = await window.getDocs(q);
    const cutoff = Date.now() - WINDOW_MS;
    let failCount = 0;
    const channels = new Set();
    snap.forEach(function (doc) {
      const d = doc.data() || {};
      const ts = d.createdAt && typeof d.createdAt.toMillis === 'function' ? d.createdAt.toMillis() : 0;
      if (ts < cutoff) return;
      if (isFailed(d.emailStatus)) { failCount++; channels.add('email'); }
      if (isFailed(d.smsStatus)) { failCount++; channels.add('SMS'); }
    });
    if (failCount > 0) render(failCount, Array.from(channels));
  }

  // Boot: claims land asynchronously after auth; retry a few times, then
  // give up quietly (unauthenticated pages redirect away before this matters).
  let attempts = 0;
  function tryCheck() {
    attempts++;
    if (window._db && window._userClaims) {
      check().catch(function (e) {
        if (window.console && console.debug) console.debug('[alert-health] check skipped:', e && e.message);
      });
      return;
    }
    if (attempts < 15) setTimeout(tryCheck, 2000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(tryCheck, 3000); });
  } else {
    setTimeout(tryCheck, 3000);
  }
})();
