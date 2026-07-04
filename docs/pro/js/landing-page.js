    // FAQ Accordion. Questions are real <button>s (keyboard operable) —
    // keep aria-expanded in sync so screen readers hear open/closed state.
    function toggleFAQ(question) {
      const answer = question.nextElementSibling;
      const toggle = question.querySelector('.faq-toggle');

      document.querySelectorAll('.faq-answer').forEach(el => {
        if (el !== answer) {
          el.classList.remove('active');
          el.previousElementSibling.querySelector('.faq-toggle').classList.remove('active');
          el.previousElementSibling.setAttribute('aria-expanded', 'false');
        }
      });

      const open = answer.classList.toggle('active');
      toggle.classList.toggle('active', open);
      question.setAttribute('aria-expanded', String(open));
    }

    // CSP-safe data-pl-action delegate (replaces inline handlers).
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-pl-action]');
      if (!t) return;
      const action = t.getAttribute('data-pl-action');
      if (action === 'goRegister') {
        e.preventDefault();
        const plan = t.getAttribute('data-plan');
        window.location.href = '/pro/register.html' + (plan ? '?plan=' + plan : '');
      } else if (action === 'toggleFAQ') {
        toggleFAQ(t);
      }
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
