/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: 0a1da782e5.  Do not edit by hand. */
window._captureGuideLeads = async (name, email) => {
        const res = await window.submitPublicLead('guide', {
          name, email, source: 'free-guide'
        });
        if (!res.ok) console.warn('Lead capture failed:', res.reason);
        return res;
      };
