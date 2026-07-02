/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: c5a2295382.  Edited 2026-07 (T4f): alert() dialogs replaced with the
   inline #sa-error live region + aria-invalid/focus on the offending input. */
function showAlertError(msg, input) {
  const box = document.getElementById('sa-error');
  if (box) {
    box.textContent = msg;
    box.classList.add('show');
  }
  if (input) {
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  }
}

function clearAlertError() {
  const box = document.getElementById('sa-error');
  if (box) {
    box.textContent = '';
    box.classList.remove('show');
  }
  ['alertName', 'alertPhone', 'alertZip'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.removeAttribute('aria-invalid');
  });
}

async function submitAlert() {
  const nameInput = document.getElementById('alertName');
  const phoneInput = document.getElementById('alertPhone');
  const zipInput = document.getElementById('alertZip');
  const name = nameInput.value.trim();
  const phone = phoneInput.value.trim();
  const zip = zipInput.value.trim();
  const concern = document.getElementById('alertConcern').value;
  const hp = document.getElementById('alertHoneypot').value;

  if (hp) return; // Bot
  clearAlertError();
  if (!name || !phone || !zip) {
    showAlertError('Please fill in your name, phone, and zip code.',
      !name ? nameInput : !phone ? phoneInput : zipInput);
    return;
  }
  // Clean and validate phone
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  if (cleanPhone.length < 10) {
    showAlertError('Please enter a valid 10-digit phone number with area code.', phoneInput);
    return;
  }
  if (!/^\d{5}$/.test(zip)) {
    showAlertError('Please enter a valid 5-digit zip code.', zipInput);
    return;
  }

  const btn = document.querySelector('.signup-btn');
  btn.disabled = true;
  btn.textContent = 'Signing you up...';

  const saved = await window._saveStormAlert?.({ name, phone: cleanPhone, zip, concern });

  if (saved) {
    document.getElementById('formState').style.display = 'none';
    document.getElementById('successState').style.display = 'block';
  } else {
    btn.disabled = false;
    btn.textContent = '🔔 Sign Me Up — Free';
    showAlertError("Sorry — we couldn't sign you up just now. Please try again, or call or text Joe at (859) 420-7382.");
  }
}
