/**
 * integrations-client.js — thin client wrappers around the server
 * callable functions. Exposes window.NBDIntegrations so any view can
 * trigger a HOVER measurement, send an estimate for signature, look
 * up a parcel, or pull hail history.
 *
 * Every call:
 *   1. Lazy-imports the Firebase Functions SDK (reuses window._functions
 *      if rep-report-generator / admin-manager already bootstrapped it).
 *   2. Checks window._integrationStatus cache so disabled providers
 *      show a toast instead of a cryptic 400.
 *   3. Falls back gracefully — every method returns a { ok, … } shape.
 *
 * Public API:
 *   NBDIntegrations.requestMeasurement({ address, leadId })
 *   NBDIntegrations.sendForSignature({ estimateId, html, signerName, signerEmail, title })
 *   NBDIntegrations.lookupParcel(address)
 *   NBDIntegrations.getHailHistory(lat, lng, { radiusMi, daysBack })
 *   NBDIntegrations.status()       // forces reload of the status cache
 */

(function () {
  'use strict';

  if (window.NBDIntegrations && window.NBDIntegrations.__sentinel === 'nbd-int-v1') return;

  async function callable(name) {
    if (!window._functions || !window._httpsCallable) {
      const mod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
      window._functions = mod.getFunctions();
      window._httpsCallable = mod.httpsCallable;
    }
    return window._httpsCallable(window._functions, name);
  }

  function toast(msg, kind) {
    if (typeof window.showToast === 'function') window.showToast(msg, kind || 'info');
  }

  const state = { status: null, statusFetchedAt: 0 };
  const STATUS_TTL_MS = 5 * 60 * 1000;

  async function status(force) {
    if (!force && state.status && (Date.now() - state.statusFetchedAt) < STATUS_TTL_MS) {
      return state.status;
    }
    try {
      const fn = await callable('integrationStatus');
      const res = await fn({});
      state.status = res.data || { configured: {} };
      state.statusFetchedAt = Date.now();
      window._integrationStatus = state.status;
    } catch (e) {
      state.status = { configured: {}, error: e.message };
    }
    return state.status;
  }

  function requireConfigured(key, humanName) {
    // Fail CLOSED on missing status: allowing calls through pretends the
    // integration is configured, which surfaces cryptic server errors
    // mid-flow (and quietly bills against API quotas). A short "still
    // checking" toast + false is a much better UX and forces the caller
    // to retry after the background status() fetch lands.
    if (!state.status) {
      toast(humanName + ' integration status still loading — try again in a second.', 'info');
      return false;
    }
    if (!state.status.configured || !state.status.configured[key]) {
      toast(humanName + ' integration not set up. Contact support.', 'error');
      return false;
    }
    return true;
  }

  async function requestMeasurement({ address, leadId }) {
    await status();
    const chosen = state.status?.providers?.measurement || 'hover';
    if (!requireConfigured(chosen, 'Roof measurement')) return { ok: false };
    try {
      const fn = await callable('requestMeasurement');
      const res = await fn({ address, leadId: leadId || null });
      toast('Measurement requested — ready in ~' + (res.data.estimatedMinutes || 30) + ' minutes', 'success');
      return { ok: true, ...res.data };
    } catch (e) {
      toast(e.message || 'Measurement request failed', 'error');
      return { ok: false, error: e.message };
    }
  }

  async function sendForSignature({ estimateId, html, signerName, signerEmail, title }) {
    await status();
    if (!requireConfigured('boldsign', 'E-signature')) return { ok: false };
    try {
      const fn = await callable('sendEstimateForSignature');
      const res = await fn({ estimateId, html, signerName, signerEmail, title });
      toast('Contract sent for signature', 'success');
      return { ok: true, ...res.data };
    } catch (e) {
      toast(e.message || 'Send-for-signature failed', 'error');
      return { ok: false, error: e.message };
    }
  }

  async function lookupParcel(address) {
    await status();
    if (!requireConfigured('regrid', 'Parcel intel')) return { ok: false };
    try {
      const fn = await callable('lookupParcel');
      const res = await fn({ address });
      return { ok: true, ...res.data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  async function getHailHistory(lat, lng, opts) {
    opts = opts || {};
    try {
      const fn = await callable('getHailHistory');
      const res = await fn({
        lat: Number(lat), lng: Number(lng),
        radiusMi: Number(opts.radiusMi) || 3,
        daysBack: Number(opts.daysBack) || 365
      });
      return { ok: true, ...res.data };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  window.NBDIntegrations = {
    __sentinel: 'nbd-int-v1',
    status,
    requestMeasurement,
    sendForSignature,
    lookupParcel,
    getHailHistory
  };

  // Kick off a status fetch once auth is live so later UI interactions
  // have the cache warm.
  let authTries = 0;
  const t = setInterval(() => {
    authTries++;
    if (window._user) { clearInterval(t); status(true); }
    else if (authTries > 40) { clearInterval(t); }
  }, 250);
})();
