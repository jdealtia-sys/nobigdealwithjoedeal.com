/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: c5a2295382.  Do not edit by hand. */
async function submitAlert() {
  const name = document.getElementById('alertName').value.trim();
  const phone = document.getElementById('alertPhone').value.trim();
  const zip = document.getElementById('alertZip').value.trim();
  const concern = document.getElementById('alertConcern').value;
  const hp = document.getElementById('alertHoneypot').value;

  if (hp) return; // Bot
  if (!name || !phone || !zip) {
    alert('Please fill in your name, phone, and zip code.');
    return;
  }
  // Clean and validate phone
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  if (cleanPhone.length < 10) {
    alert('Please enter a valid 10-digit phone number with area code.');
    return;
  }
  if (!/^\d{5}$/.test(zip)) {
    alert('Please enter a valid 5-digit zip code.');
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
    alert("Sorry — we couldn't sign you up just now. Please try again, or text Joe at (859) 420-7382.");
  }
}
