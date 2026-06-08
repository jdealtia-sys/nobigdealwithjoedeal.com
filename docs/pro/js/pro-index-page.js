    // FAQ Accordion. Toggles the .active answer + keeps aria-expanded in
    // sync on the role="button" question for screen readers.
    function toggleFAQ(question) {
      const answer = question.nextElementSibling;
      const toggle = question.querySelector('.faq-toggle');

      document.querySelectorAll('.faq-answer').forEach(el => {
        if (el !== answer) {
          el.classList.remove('active');
          const q = el.previousElementSibling;
          q.querySelector('.faq-toggle').classList.remove('active');
          q.setAttribute('aria-expanded', 'false');
        }
      });

      const open = answer.classList.toggle('active');
      toggle.classList.toggle('active');
      question.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    // CSP-safe data-pi-action delegate (replaces inline handlers).
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-pi-action]');
      if (!t) return;
      const action = t.getAttribute('data-pi-action');
      if (action === 'goRegister') {
        e.preventDefault();
        const plan = t.getAttribute('data-plan');
        window.location.href = '/pro/register.html' + (plan ? '?plan=' + plan : '');
      } else if (action === 'toggleFAQ') {
        toggleFAQ(t);
      }
    });

    // Keyboard activation for the role="button" FAQ questions (Enter/Space).
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      const t = e.target.closest('[data-pi-action="toggleFAQ"]');
      if (!t) return;
      e.preventDefault();
      toggleFAQ(t);
    });

    // Scroll Animation Observer
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
        }
      });
    }, observerOptions);

    document.querySelectorAll('.animate').forEach(el => {
      observer.observe(el);
    });

    // Mobile nav menu toggle
    const navLinks = document.querySelector('.nav-links');
    const navToggle = document.querySelector('.nav-toggle');

    if (navToggle) {
      navToggle.addEventListener('click', () => {
        navLinks.style.display = navLinks.style.display === 'flex' ? 'none' : 'flex';
      });
    }
