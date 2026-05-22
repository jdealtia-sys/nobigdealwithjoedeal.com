/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: a480f74bc8.  Do not edit by hand. */
// ── Firebase is initialized by /sites/js/marketing-firebase-init.js.
    //    The modular SDK helper is exposed on window._nbdSubmitLead for
    //    form submissions; nothing else in this template needs direct
    //    db access. COMPANY_CONFIG.firebaseConfig is ignored on this
    //    migrated template because every instance targets the same
    //    marketing project (nobigdealwithjoedeal). Revisit if multi-
    //    tenant per-project isolation is ever re-introduced.

    // ── Apply CSS custom properties from config ──
    function applyTheme() {
      const C = COMPANY_CONFIG.colors;
      const root = document.documentElement;
      root.style.setProperty('--primary', C.primary);
      root.style.setProperty('--accent', C.accent);
      root.style.setProperty('--accent-hover', C.accentHover);
      root.style.setProperty('--dark', C.dark);
      root.style.setProperty('--light', C.light);
    }

    // ── Render from Config ──
    function renderSite() {
      const C = COMPANY_CONFIG;
      applyTheme();

      // Page title
      document.title = `${C.name} | ${C.address}`;

      // Nav
      document.getElementById('navBrand').textContent = C.shortName;

      // Hero
      document.getElementById('heroHeadline').innerHTML = C.heroHeadline;
      document.getElementById('heroSub').textContent = C.heroSub;
      const phoneDigits = C.phone.replace(/\D/g, '');
      document.getElementById('heroPhone').href = `tel:${phoneDigits}`;

      // Services
      const grid = document.getElementById('servicesGrid');
      C.services.forEach(s => {
        const card = document.createElement('div');
        card.className = 'service-card reveal';
        card.innerHTML = `<div class="service-icon">${s.icon}</div><h3>${s.name}</h3><p>${s.desc}</p>`;
        grid.appendChild(card);
      });

      // Service dropdown
      const sel = document.getElementById('leadService');
      C.services.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.name;
        opt.textContent = s.name;
        sel.appendChild(opt);
      });

      // Why Us
      const wg = document.getElementById('whyGrid');
      C.whyUs.forEach(w => {
        const card = document.createElement('div');
        card.className = 'why-card reveal';
        card.innerHTML = `<h3>${w.title}</h3><p>${w.desc}</p>`;
        wg.appendChild(card);
      });
      document.getElementById('whyTitle').textContent = `Why Choose ${C.shortName}?`;

      // Areas
      const al = document.getElementById('areasList');
      C.serviceAreas.forEach(a => {
        const tag = document.createElement('span');
        tag.className = 'area-tag reveal';
        tag.textContent = a;
        al.appendChild(tag);
      });

      // Contact info
      document.getElementById('contactPhone').textContent = C.phone;
      document.getElementById('contactPhone').href = `tel:${phoneDigits}`;
      document.getElementById('contactEmail').textContent = C.email;
      document.getElementById('contactAddress').textContent = C.address;
      document.getElementById('warrantyBadge').textContent = C.warranty;

      // Footer
      document.getElementById('footerYear').textContent = new Date().getFullYear();
      document.getElementById('footerCompany').textContent = C.name;
    }

    // ── Scroll Reveal ──
    function initReveal() {
      const obs = new IntersectionObserver((entries) => {
        entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
      }, { threshold: 0.15 });
      document.querySelectorAll('.reveal').forEach(el => obs.observe(el));
    }

    // ── Mobile Nav ──
    document.getElementById('mobileToggle').addEventListener('click', () => {
      document.getElementById('navLinks').classList.toggle('open');
    });
    document.querySelectorAll('.nav-links a').forEach(a => {
      a.addEventListener('click', () => document.getElementById('navLinks').classList.remove('open'));
    });

    // ── Lead Form Submission ──
    async function submitLead(e) {
      e.preventDefault();
      const btn = document.getElementById('submitBtn');
      const msg = document.getElementById('formMsg');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      msg.textContent = '';
      msg.className = 'form-msg';

      const data = {
        name: document.getElementById('leadName').value.trim(),
        phone: document.getElementById('leadPhone').value.trim(),
        email: document.getElementById('leadEmail').value.trim(),
        service: document.getElementById('leadService').value,
        message: document.getElementById('leadMessage').value.trim(),
        companyId: COMPANY_CONFIG.id,
        companyName: COMPANY_CONFIG.name,
        source: 'company-site'
        // createdAt + status are added by submitMarketingLead().
      };

      try {
        if (typeof window._nbdSubmitLead !== 'function') {
          throw new Error('marketing Firebase helper not loaded');
        }
        await window._nbdSubmitLead(data);
        // Lead notification is now handled by the Stripe/lead webhooks on
        // the main nobigdeal-pro project, not the marketing project.
        // The old client-side `notifyNewLead` callable has moved to
        // require App Check and an OTP-verified phone — see
        // functions/verify-functions.js. Client-side call is removed.
        msg.textContent = 'Thank you! We\'ll be in touch shortly.';
        msg.className = 'form-msg success';
        e.target.reset();
      } catch (err) {
        console.error('Lead submission error:', err);
        msg.textContent = 'Something went wrong. Please call us directly.';
        msg.className = 'form-msg error';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Request Free Estimate';
      }
    }

    // ── Init ──
    renderSite();
    setTimeout(initReveal, 100);
