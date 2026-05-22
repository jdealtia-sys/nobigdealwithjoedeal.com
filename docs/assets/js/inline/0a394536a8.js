/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: 0a394536a8.  Do not edit by hand. */
(function(){
  const form = document.getElementById('freeRoofForm');
  const btn  = document.getElementById('fr-submit');
  const out  = document.getElementById('fr-result');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    out.className = 'form-result';
    out.textContent = '';

    const fd = new FormData(form);
    // Honeypot — if the hidden field is filled, silently pretend success.
    if ((fd.get('website') || '').toString().trim() !== '') {
      out.className = 'form-result success';
      out.textContent = 'Thanks — entry received.';
      form.reset();
      return;
    }

    const payload = {};
    for (const [k, v] of fd.entries()) {
      if (k === 'website') continue;
      payload[k] = (v || '').toString().trim();
    }

    btn.disabled = true;
    btn.textContent = 'Submitting…';

    try {
      const res = await window.submitPublicLead('free_roof', payload);
      if (res && res.ok) {
        out.className = 'form-result success';
        out.textContent = 'Entry received. I read every one personally — if I have questions I\'ll call.';
        form.reset();
      } else {
        out.className = 'form-result error';
        out.textContent = 'Something went wrong. Text Joe at (859) 420-7382 if this keeps happening.';
      }
    } catch (err) {
      out.className = 'form-result error';
      out.textContent = 'Couldn\'t reach the server. Please try again or text Joe at (859) 420-7382.';
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M3 11 L12 3 L21 11"/><path d="M5 10 V20 H19 V10"/></svg> Submit Entry';
    }
  });
})();
