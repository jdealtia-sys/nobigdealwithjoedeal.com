(function () {
  'use strict';
  const FUNCTIONS_BASE = 'https://us-central1-nobigdeal-pro.cloudfunctions.net';

  function getRef() {
    try {
      const p = new URLSearchParams(location.search);
      return (p.get('ref') || '').trim().toUpperCase();
    } catch (e) { return ''; }
  }

  function show(el) { el.style.display = 'block'; }
  function hide(el) { el.style.display = 'none'; }

  const ref = getRef();
  const form = document.getElementById('referForm');
  const empty = document.getElementById('emptyState');
  const done = document.getElementById('doneState');
  const statusEl = document.getElementById('status');
  const btn = document.getElementById('submitBtn');

  if (!ref) {
    show(empty);
    return;
  }
  show(form);

  function setStatus(msg, kind) {
    if (!msg) { hide(statusEl); statusEl.className = 'status'; return; }
    statusEl.textContent = msg;
    statusEl.className = 'status ' + (kind || '');
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    setStatus('');
    const firstName = document.getElementById('firstName').value.trim();
    const lastName  = document.getElementById('lastName').value.trim();
    const phone     = document.getElementById('phone').value.trim();
    const email     = document.getElementById('email').value.trim();
    const address   = document.getElementById('address').value.trim();
    const notes     = document.getElementById('notes').value.trim();

    if (!firstName) { setStatus('First name is required.', 'error'); return; }
    const digits = phone.replace(/\D/g, '');
    if (!digits && !email) { setStatus('Phone or email is required.', 'error'); return; }
    if (digits && digits.length < 10) { setStatus('Phone needs at least 10 digits.', 'error'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus('Email looks invalid.', 'error'); return;
    }

    btn.disabled = true;
    const origLabel = btn.textContent;
    btn.textContent = 'Sending…';

    try {
      const res = await fetch(FUNCTIONS_BASE + '/submitReferral', {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref, firstName, lastName, phone, email, address, notes }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(json.error || 'Could not send your info. Try again.', 'error');
        btn.disabled = false;
        btn.textContent = origLabel;
        return;
      }
      hide(form);
      show(done);
    } catch (err) {
      setStatus('Network error — please try again.', 'error');
      btn.disabled = false;
      btn.textContent = origLabel;
    }
  });
})();
