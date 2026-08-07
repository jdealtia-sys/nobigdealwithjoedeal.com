/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: 72f02d79d0.  Do not edit by hand. */
// ── ANNOUNCEMENT BAR: long/short text swap ──
// Single span with data-long/data-short — avoids duplicate text in DOM
// that previously leaked "personallyNBD Lifetime Pledge" into SEO snippets.
(function(){
  const mq = window.matchMedia('(max-width:600px)');
  const sync = () => {
    document.querySelectorAll('.ann-text').forEach(el => {
      const want = mq.matches ? (el.dataset.short || el.dataset.long) : el.dataset.long;
      if (want && el.textContent !== want) el.textContent = want;
    });
  };
  sync();
  if (mq.addEventListener) mq.addEventListener('change', sync);
  else if (mq.addListener) mq.addListener(sync);
})();

// ── ANNOUNCEMENT BAR ROTATION ──
(function(){
  const slides = document.querySelectorAll('.ann-slide');
  let current = 0;
  if(slides.length < 2) return;
  setInterval(()=>{
    slides[current].classList.remove('active');
    slides[current].classList.add('exit');
    const prev = current;
    current = (current + 1) % slides.length;
    slides[current].classList.add('active');
    slides[current].classList.remove('exit');
    setTimeout(()=> slides[prev].classList.remove('exit'), 600);
  }, 4000);
})();

// ── SCROLL REVEALS ──
// Content is visible by default (see .reveal CSS). We only hide pre-animation
// when JS is ready AND the user has not requested reduced motion. If JS fails
// or IntersectionObserver is unavailable, every section stays visible.
if('IntersectionObserver' in window){
  document.documentElement.classList.add('js-reveal-ready');
  const observer = new IntersectionObserver((entries)=>{
    entries.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('visible'); observer.unobserve(e.target); }});
  },{threshold:0.12});
  document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));
}

// ── BACK TO TOP ──
window.addEventListener('scroll',()=>{
  const btn = document.getElementById('backTop');
  if(btn) btn.classList.toggle('visible', window.scrollY > 400);
});

// ── MOBILE NAV ──
function toggleMobileNav(){
  const nav = document.getElementById('mobileNav');
  const hb = document.getElementById('hamburger');
  const open = nav.classList.toggle('open');
  const bars = hb.querySelectorAll('span');
  if(open){
    bars[0].style.cssText='transform:rotate(45deg) translate(5px,5px)';
    bars[1].style.cssText='opacity:0';
    bars[2].style.cssText='transform:rotate(-45deg) translate(5px,-5px)';
  } else {
    bars.forEach(b=>b.style.cssText='');
  }
}
function closeMobileNav(){
  document.getElementById('mobileNav').classList.remove('open');
  document.getElementById('hamburger').querySelectorAll('span').forEach(b=>b.style.cssText='');
}

// ── SMOOTH SCROLL ──
document.querySelectorAll('a[href^="#"]').forEach(link=>{
  link.addEventListener('click',e=>{
    const href = link.getAttribute('href');
    if(href==='#') return;
    const target = document.querySelector(href);
    if(target){
      e.preventDefault();
      const navH = document.getElementById('mainNav')?.offsetHeight || 70;
      const y = target.getBoundingClientRect().top + window.scrollY - navH - 12;
      window.scrollTo({top:y, behavior:'smooth'});
      closeMobileNav();
    }
  });
});

// Service cards are now full-card anchors linking to /services/* detail pages.
// (The old pre-fill-form intercept was removed so the detail pages finally get traffic.)

// ── CONTACT FORM — CRM capture primary, FormSubmit backup ──
// The CRM capture (window._captureContactLead → submitPublicLead) is the
// gate for the user-visible success card. FormSubmit.co still emails a
// copy to jd@nobigdealwithjoedeal.com but is fire-and-forget — its
// failure is ignored. If the CRM bridge never loaded, we fall back to
// gating on the FormSubmit response so the form keeps working.

// Inline accessible errors (2026-08-07) — replaces the old alert() modals.
// Mirrors quick-lead-form.js: role="alert" slot + aria-invalid + focus the
// first invalid field. Only first name + phone are enforced; the markup
// stars match (the other fields are optional).
function _formShowError(html, invalidEls){
  const slot = document.getElementById('formError');
  document.querySelectorAll('#formFields [aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
  (invalidEls || []).forEach(el => el && el.setAttribute('aria-invalid', 'true'));
  if (slot) { slot.innerHTML = html; slot.hidden = false; }
  const focusTarget = (invalidEls && invalidEls[0]);
  if (focusTarget) focusTarget.focus();
  else if (slot && slot.focus) slot.focus();
}
function _formClearError(){
  const slot = document.getElementById('formError');
  if (slot) { slot.hidden = true; slot.textContent = ''; }
  document.querySelectorAll('#formFields [aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
}

async function submitForm(){
  const firstEl = document.getElementById('fieldFirst');
  const phoneEl = document.getElementById('fieldPhone');
  const first   = firstEl?.value.trim();
  const last    = document.getElementById('fieldLast')?.value.trim();
  const phone   = phoneEl?.value.trim();
  const email   = document.getElementById('fieldEmail')?.value.trim();
  const address = document.getElementById('fieldAddress')?.value.trim();
  const service = document.getElementById('fieldService')?.value;
  const message = document.getElementById('fieldMessage')?.value.trim();

  // Honeypot — if filled, it's a bot. Stays SILENT on purpose (no visible
  // error — that's the trap). (fieldNbdHp since 2026-08-05 — an id
  // containing "website" gets autofilled)
  const hp = document.getElementById('fieldNbdHp')?.value;
  if(hp) { console.warn('Bot detected'); return; }

  if(!first || !phone){
    const invalid = [];
    if(!first) invalid.push(firstEl);
    if(!phone) invalid.push(phoneEl);
    _formShowError('Please enter at least your first name and phone number so Joe can reach you.', invalid);
    return;
  }
  _formClearError();

  const btn = document.querySelector('.form-submit');
  btn.textContent = 'Sending…';
  btn.disabled = true;

  // Backup email relay — fire-and-forget; failures are ignored.
  const body = new FormData();
  body.append('name',    `${first} ${last}`.trim());
  body.append('phone',   phone);
  body.append('email',   email || '(not provided)');
  body.append('address', address || '(not provided)');
  body.append('service', service || '(not selected)');
  body.append('message', message || '(no message)');
  body.append('_subject', `New Estimate Request — ${service || 'General'} — ${first} ${last}`);
  body.append('_captcha', 'false');
  body.append('_template', 'table');
  const relay = fetch('https://formsubmit.co/jd@nobigdealwithjoedeal.com', {
    method: 'POST',
    body
  }).catch(() => null);

  // Primary gate — the lead must land in the CRM.
  let captured = false;
  if (window._captureContactLead) {
    try {
      captured = await window._captureContactLead({
        firstName: first, lastName: last, phone, email,
        address, service, message
      });
    } catch(err){
      captured = false;
    }
  } else {
    // CRM bridge missing entirely — legacy behavior: gate on the relay.
    const res = await relay;
    captured = !!(res && res.ok);
  }

  if(captured){
    document.getElementById('formFields').style.display = 'none';
    const success = document.getElementById('formSuccess');
    success.style.display = 'block';
    // Move focus to the success card so screen readers land on the
    // confirmation instead of the vanished form.
    success.setAttribute('tabindex', '-1');
    success.focus();
  } else {
    btn.textContent = 'Get My Free Estimate →';
    btn.disabled = false;
    // Static string — no user data reaches this innerHTML.
    _formShowError('Something went wrong. Please call or text Joe directly at <a href="tel:+18594207382">(859)&nbsp;420-7382</a>.', []);
  }
}
