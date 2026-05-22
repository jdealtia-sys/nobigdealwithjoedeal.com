/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: e9b498fbd3.  Do not edit by hand. */
window._saveStormAlert = async (data) => {
  const res = await window.submitPublicLead('storm', Object.assign({
    source: 'storm-alerts-page',
    active: 'true'
  }, data || {}));
  if (!res.ok) console.warn('Storm alert signup failed:', res.reason);
  return !!res.ok;
};
