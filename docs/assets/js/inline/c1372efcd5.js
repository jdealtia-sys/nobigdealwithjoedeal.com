/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: c1372efcd5.  Do not edit by hand. */
async function submitForm(e) {
      e.preventDefault();
      const data = {
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        zip: document.getElementById('zip').value,
        service: document.getElementById('service').value,
        message: document.getElementById('message').value,
        companyId: 'oaks',
        companyName: 'Oaks Roofing & Construction',
        source: 'website',
        page: window.location.pathname,
        createdAt: new Date(),
        status: 'new'
      };
      try {
        const btn = document.querySelector('.form-submit');
        btn.textContent = 'Sending...';
        btn.disabled = true;
        if (typeof window._nbdSubmitLead !== 'function') {
          throw new Error('marketing Firebase helper not loaded');
        }
        await window._nbdSubmitLead(data);
        document.getElementById('leadForm').style.display = 'none';
        document.getElementById('formSuccess').style.display = 'block';
      } catch (err) {
        console.error('Form error:', err);
        alert('Something went wrong. Please call us at (513) 827-5297.');
      }
    }

    // Active nav highlight on scroll
    const navLinks = document.querySelectorAll('.nav-links a[href^="#"]');
    window.addEventListener('scroll', () => {
      const sections = document.querySelectorAll('section[id]');
      let current = '';
      sections.forEach(s => {
        if (window.scrollY >= s.offsetTop - 100) current = s.getAttribute('id');
      });
      navLinks.forEach(l => {
        l.parentElement.classList.remove('active');
        if (l.getAttribute('href') === '#' + current) l.parentElement.classList.add('active');
      });
    });
