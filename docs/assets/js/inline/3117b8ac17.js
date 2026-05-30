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

        // Inline error — never leave the user thinking it worked when the lead
        // didn't actually save (server rejected it, or the network failed).
        function showFormError(form) {
            let p = form.querySelector('.nbd-form-error');
            if (!p) {
                p = document.createElement('p');
                p.className = 'nbd-form-error';
                p.setAttribute('role', 'alert');
                p.style.cssText = 'margin-top:12px;padding:12px 14px;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.35);border-radius:8px;color:#7f1d1d;font-size:.9rem;line-height:1.4';
                form.appendChild(p);
            }
            p.textContent = "Hmm — that didn't save. Please call or text Joe at (859) 420-7382 and he'll get your guide right to you.";
        }

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
                    // Capture via the hardened submitPublicLead pipeline.
                    // _captureGuideLeads returns the result object; a non-ok
                    // result (rate limit, validation, Turnstile/App Check) must
                    // NOT be reported to the user as success.
                    let res = { ok: true };
                    if (window._captureGuideLeads) {
                        res = await window._captureGuideLeads(formData.name, formData.email);
                    }
                    if (!res || !res.ok) { showFormError(form); return; }

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
                    // Network/JS error — surface it instead of faking success.
                    console.error('Form submission error:', error);
                    showFormError(form);
                }
            });
        }

        // Setup both forms
        setupFormHandler('optinForm', 'successState');
        setupFormHandler('optinForm2', 'successState2');
