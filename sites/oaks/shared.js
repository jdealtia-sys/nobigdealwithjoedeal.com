/* ═══════════════════════════════════════════════════
   OAKS ROOFING & CONSTRUCTION — Shared Nav/Footer
   Injected on every page via shared.js
   ═══════════════════════════════════════════════════ */

const BASE = '/sites/oaks';

const LOGO_SVG = `<svg class="logo-icon" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M30 8c-8 0-18 6-18 16 0 8 6 14 13 16v12h10V40c7-2 13-8 13-16 0-10-10-16-18-16z" fill="#e8720c"/>
  <rect x="27" y="38" width="6" height="14" rx="2" fill="#e8720c"/>
  <path d="M22 52h16" stroke="#e8720c" stroke-width="3" stroke-linecap="round"/>
</svg>`;

// Determine active page from URL
const path = window.location.pathname;
function isActive(page) {
  if (page === 'index' && (path.endsWith('/oaks/') || path.endsWith('/oaks/index.html'))) return 'active';
  if (path.includes(page)) return 'active';
  return '';
}
function isServiceActive() {
  return path.includes('/services/') ? 'active' : '';
}

// ═══ TOP BANNER ═══
function renderBanner() {
  const el = document.getElementById('site-banner');
  if (!el) return;
  el.innerHTML = `
    <div class="top-banner" id="topBanner">
      <i class="fa-solid fa-gear"></i>
      Enjoy a 5-Year Labor Warranty on All Installs
      <button class="banner-close" onclick="document.getElementById('topBanner').style.display='none'"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
}

// ═══ NAV ═══
function renderNav() {
  const el = document.getElementById('site-nav');
  if (!el) return;
  el.innerHTML = `
    <nav class="site-nav">
      <div class="nav-inner">
        <a href="${BASE}/" class="nav-logo">
          ${LOGO_SVG}
          <div class="logo-text">Oaks Roofing &<br>Construction</div>
        </a>
        <ul class="nav-links">
          <li class="${isActive('index')}"><a href="${BASE}/">Home</a></li>
          <li class="${isActive('about')}"><a href="${BASE}/about.html">About</a></li>
          <li class="has-dropdown ${isServiceActive()}">
            <a href="${BASE}/services/roof-replacement.html">Services <i class="fa-solid fa-chevron-down dropdown-arrow"></i></a>
            <div class="dropdown-menu">
              <a href="${BASE}/services/roof-replacement.html">Roof Replacement</a>
              <a href="${BASE}/services/roof-repair.html">Roof Repair</a>
              <a href="${BASE}/services/siding-replacement.html">Siding Replacement</a>
              <a href="${BASE}/services/siding-repair.html">Siding Repair</a>
              <a href="${BASE}/services/gutter-replacement.html">Gutter Replacement</a>
            </div>
          </li>
          <li class="${isActive('gallery')}"><a href="${BASE}/gallery.html">Our Work</a></li>
          <li class="${isActive('service-areas')}"><a href="${BASE}/service-areas.html">Service Areas</a></li>
          <li class="${isActive('contact')}"><a href="${BASE}/contact.html">Contact Us</a></li>
        </ul>
        <button class="nav-toggle" onclick="document.getElementById('mobileMenu').classList.toggle('open')">
          <i class="fa-solid fa-bars"></i>
        </button>
      </div>
    </nav>
    <div class="mobile-menu" id="mobileMenu">
      <a href="${BASE}/" onclick="this.parentElement.classList.remove('open')">Home</a>
      <a href="${BASE}/about.html" onclick="this.parentElement.classList.remove('open')">About</a>
      <a href="${BASE}/services/roof-replacement.html" onclick="this.parentElement.classList.remove('open')">Services</a>
      <a href="${BASE}/services/roof-replacement.html" class="sub-link" onclick="this.parentElement.classList.remove('open')">Roof Replacement</a>
      <a href="${BASE}/services/roof-repair.html" class="sub-link" onclick="this.parentElement.classList.remove('open')">Roof Repair</a>
      <a href="${BASE}/services/siding-replacement.html" class="sub-link" onclick="this.parentElement.classList.remove('open')">Siding Replacement</a>
      <a href="${BASE}/services/siding-repair.html" class="sub-link" onclick="this.parentElement.classList.remove('open')">Siding Repair</a>
      <a href="${BASE}/services/gutter-replacement.html" class="sub-link" onclick="this.parentElement.classList.remove('open')">Gutter Replacement</a>
      <a href="${BASE}/gallery.html" onclick="this.parentElement.classList.remove('open')">Our Work</a>
      <a href="${BASE}/service-areas.html" onclick="this.parentElement.classList.remove('open')">Service Areas</a>
      <a href="${BASE}/contact.html" onclick="this.parentElement.classList.remove('open')">Contact Us</a>
    </div>`;
}

// ═══ FOOTER ═══
function renderFooter() {
  const el = document.getElementById('site-footer');
  if (!el) return;
  el.innerHTML = `
    <footer class="site-footer">
      <div class="container">
        <div class="footer-top">
          <svg width="50" height="50" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M30 8c-8 0-18 6-18 16 0 8 6 14 13 16v12h10V40c7-2 13-8 13-16 0-10-10-16-18-16z" fill="#e8720c"/>
            <rect x="27" y="38" width="6" height="14" rx="2" fill="#e8720c"/>
            <path d="M22 52h16" stroke="#e8720c" stroke-width="3" stroke-linecap="round"/>
          </svg>
          <div class="footer-brand">Oaks Roofing & Construction</div>
          <div class="footer-contact-row">
            <div class="footer-contact-item"><i class="fa-solid fa-phone"></i> <a href="tel:5138275297">(513) 827-5297</a></div>
            <div class="footer-contact-item"><i class="fa-solid fa-location-dot"></i> Goshen, OH</div>
          </div>
          <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:4px"><span class="g-icon">G</span></div>
          <a href="#" class="review-btn">Leave Us a Review</a>
        </div>
        <div class="footer-columns">
          <div class="footer-col">
            <h4>Services</h4>
            <ul>
              <li><a href="${BASE}/services/roof-replacement.html">Roof Replacement</a></li>
              <li><a href="${BASE}/services/roof-repair.html">Roof Repair</a></li>
              <li><a href="${BASE}/services/siding-replacement.html">Siding Replacement</a></li>
              <li><a href="${BASE}/services/siding-repair.html">Siding Repair</a></li>
              <li><a href="${BASE}/services/gutter-replacement.html">Gutter Replacement</a></li>
            </ul>
          </div>
          <div class="footer-col">
            <h4>Quick Links</h4>
            <ul>
              <li><a href="${BASE}/">Home</a></li>
              <li><a href="${BASE}/about.html">Who We Are</a></li>
              <li><a href="${BASE}/services/roof-replacement.html">Services</a></li>
              <li><a href="${BASE}/service-areas.html">Service Areas</a></li>
              <li><a href="${BASE}/gallery.html">Our Work</a></li>
              <li><a href="${BASE}/contact.html">Contact Us</a></li>
            </ul>
          </div>
        </div>
        <div class="footer-bottom">
          &copy;2026, Oaks Roofing & Construction, All Rights Reserved. <a href="#">Privacy Policy</a>
        </div>
      </div>
    </footer>
    <div class="powered-by">Powered by <a href="https://nobigdealwithjoedeal.com" target="_blank">NBD Pro</a></div>`;
}

// ═══ QUOTE FORM (reusable) ═══
function renderQuoteForm(containerId, heading, desc) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="quote-form">
      <h3>${heading || 'Request a Quote Today'}</h3>
      <p class="form-desc">${desc || 'Fill out the form below and we\'ll get back to you within 24 hours.'}</p>
      <form id="leadForm-${containerId}" onsubmit="return submitLead(event, '${containerId}')">
        <div class="form-row">
          <div class="form-group"><label>First Name</label><input type="text" name="firstName" placeholder="John" required></div>
          <div class="form-group"><label>Last Name</label><input type="text" name="lastName" placeholder="Smith"></div>
        </div>
        <div class="form-group"><label>Email</label><input type="email" name="email" placeholder="john@smith.com" required></div>
        <div class="form-group"><label>Phone Number</label><input type="tel" name="phone" placeholder="(123) 456-7890"></div>
        <div class="form-group"><label>Zip Code</label><input type="text" name="zip" placeholder="12345"></div>
        <div class="form-group">
          <label>Service</label>
          <select name="service">
            <option value="">--Please choose an option--</option>
            <option>Roof Replacement</option>
            <option>Roof Repair</option>
            <option>Siding Replacement</option>
            <option>Siding Repair</option>
            <option>Gutter Replacement</option>
            <option>Storm Damage</option>
            <option>Inspection</option>
            <option>Other</option>
          </select>
        </div>
        <div class="form-group"><label>Message</label><textarea name="message" placeholder="Tell us how we can help"></textarea></div>
        <button type="submit" class="form-submit">Send Message</button>
      </form>
      <div class="form-success" id="formSuccess-${containerId}">
        <i class="fa-solid fa-circle-check" style="font-size:2rem;color:#22c55e;margin-bottom:12px;display:block;"></i>
        Thank you! We'll be in touch soon.
      </div>
    </div>`;
}

// ═══ CTA BANNER (reusable) ═══
function renderCTA(containerId, heading, text) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `
    <div class="cta-banner">
      <div class="container">
        <h2>${heading || 'Reach Out to Schedule Your Service Today'}</h2>
        <p>${text || "We're here to deliver lasting results with honest service and a focus on customer satisfaction."}</p>
        <div class="cta-actions">
          <a href="tel:5138275297" class="btn-primary"><i class="fa-solid fa-phone"></i> (513) 827-5297</a>
          <a href="${BASE}/contact.html" class="btn-outline"><i class="fa-solid fa-file-lines"></i> Request a Quote</a>
        </div>
      </div>
    </div>`;
}

// ═══ FORM SUBMISSION ═══
async function submitLead(e, containerId) {
  e.preventDefault();
  const form = e.target;
  const data = {
    firstName: form.firstName.value,
    lastName: form.lastName.value,
    email: form.email.value,
    phone: form.phone.value,
    zip: form.zip.value,
    service: form.service.value,
    message: form.message.value,
    companyId: 'oaks',
    companyName: 'Oaks Roofing & Construction',
    source: 'website',
    page: window.location.pathname,
    createdAt: new Date(),
    status: 'new'
  };
  try {
    const btn = form.querySelector('.form-submit');
    btn.textContent = 'Sending...';
    btn.disabled = true;
    await db.collection('leads').add(data);
    form.style.display = 'none';
    document.getElementById('formSuccess-' + containerId).style.display = 'block';
  } catch (err) {
    console.error('Form error:', err);
    alert('Something went wrong. Please call us at (513) 827-5297.');
  }
}

// ═══ INIT ═══
document.addEventListener('DOMContentLoaded', () => {
  renderBanner();
  renderNav();
  renderFooter();
});
