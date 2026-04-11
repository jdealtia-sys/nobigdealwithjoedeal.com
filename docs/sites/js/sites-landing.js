/**
 * docs/sites/index.html — landing page form handler.
 * Extracted from inline <script> + migrated off the compat Firestore API
 * onto the shared modular submitMarketingLead() helper.
 */
(function () {
  async function submitSiteLead(e) {
    e.preventDefault();
    const form = e.target;
    const data = {
      name: form.name.value,
      company: form.company.value,
      email: form.email.value,
      phone: form.phone.value,
      services: form.services.value,
      area: form.area.value,
      plan: form.plan.value,
      message: form.message.value,
      source: 'nbd-sites-landing',
      type: 'site-inquiry',
    };
    const btn = form.querySelector('.form-submit');
    try {
      if (btn) { btn.textContent = 'Sending...'; btn.disabled = true; }
      if (typeof window._nbdSubmitLead !== 'function') {
        throw new Error('marketing Firebase helper not loaded');
      }
      await window._nbdSubmitLead(data);
      form.style.display = 'none';
      const ok = document.getElementById('formSuccess');
      if (ok) ok.style.display = 'block';
    } catch (err) {
      console.error('Form error:', err);
      alert('Something went wrong. Please call us at (859) 420-7382.');
      if (btn) { btn.textContent = 'Send'; btn.disabled = false; }
    }
  }

  window._nbdSubmitSiteLead = submitSiteLead;

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('siteLeadForm');
    if (form) form.addEventListener('submit', submitSiteLead);
  });
})();
