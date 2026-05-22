/* @generated — extracted from inline <script> by audit-homeowner-2026-05-22.
   Hash: 3117b8ac17.  Do not edit by hand. */
// Optional: Add MailerLite endpoint for email marketing (leads already save to Firestore)
        // Replace with your MailerLite form URL to also add leads to your email list
        const FORM_ACTION_URL = 'FORM_ACTION_URL';

        // Mobile menu toggle
        function toggleMobileNav() {
            const mobileNav = document.getElementById('mobileNav');
            mobileNav.classList.toggle('open');
        }

        // Close mobile nav when a link is clicked
        document.querySelectorAll('.mobile-nav a').forEach(link => {
            link.addEventListener('click', () => {
                document.getElementById('mobileNav').classList.remove('open');
            });
        });

        // Form submission handler
        function setupFormHandler(formId, successStateId) {
            const form = document.getElementById(formId);
            const successState = document.getElementById(successStateId);

            if (!form) return;

            form.addEventListener('submit', async (e) => {
                e.preventDefault();

                // Honeypot check
                const hp = form.querySelector('input[name="website"]');
                if (hp && hp.value) { console.warn('Bot detected'); return; }

                // Get form data
                const nameInput = form.querySelector('input[name="name"]');
                const emailInput = form.querySelector('input[name="email"]');

                const formData = {
                    name: nameInput.value.trim(),
                    email: emailInput.value.trim()
                };

                try {
                    // Always capture to Firestore (even if email service is configured)
                    if (window._captureGuideLeads) {
                        await window._captureGuideLeads(formData.name, formData.email);
                    }

                    // Send to form endpoint if configured
                    if (FORM_ACTION_URL !== 'FORM_ACTION_URL') {
                        const response = await fetch(FORM_ACTION_URL, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(formData)
                        });
                    }

                    // Show success state
                    form.style.display = 'none';
                    successState.classList.add('active');

                    // Reset form after 2 seconds
                    setTimeout(() => {
                        form.reset();
                    }, 2000);

                } catch (error) {
                    // Handle network errors gracefully
                    console.error('Form submission error:', error);
                    form.style.display = 'none';
                    successState.classList.add('active');
                }
            });
        }

        // Setup both forms
        setupFormHandler('optinForm', 'successState');
        setupFormHandler('optinForm2', 'successState2');
