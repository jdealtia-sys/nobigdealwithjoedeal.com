  import { NBDAuth } from '/pro/js/nbd-auth.js';
  // Dashboard does its own heavy Firebase init below — NBDAuth just provides
  // the access gate and exposes window.NBDAuth for plan badges / feature checks
  window._nbdAuth = NBDAuth.init({
    requiredPlan: 'foundation',
    onReady: (user) => {
      console.log('NBDAuth gate passed — plan:', NBDAuth.userPlan);
      // ── Trial countdown banner ──
      if (NBDAuth.isTrialUser && !NBDAuth.isTrialExpired) {
        const days = NBDAuth.trialDaysLeft;
        if (days <= 7) {
          const urgency = days <= 2 ? 'trial-urgent' : 'trial-warning';
          const msg = days <= 2
            ? `⚠️ Your Pro trial ends in ${days} day${days===1?'':'s'}! Your data is safe — upgrade now to keep all features.`
            : `Your Pro trial has ${days} days left. Upgrade to $79/mo to keep full access.`;
          const banner = document.createElement('div');
          banner.id = 'trial-banner';
          banner.className = urgency;
          banner.innerHTML = `<span>${msg}</span><a href="/pro/register.html?plan=pro" style="color:var(--t);background:var(--orange);padding:5px 14px;border-radius:5px;font-size:11px;font-weight:700;text-decoration:none;white-space:nowrap;">Upgrade Now →</a><button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--m);cursor:pointer;font-size:14px;padding:0 4px;">✕</button>`;
          document.body.prepend(banner);
        }
      } else if (NBDAuth.isTrialExpired) {
        const banner = document.createElement('div');
        banner.id = 'trial-banner';
        banner.className = 'trial-expired';
        banner.innerHTML = `<span>⚡ Your Pro trial has ended. You're on the free Lite plan (25 leads). Upgrade to unlock everything.</span><a href="/pro/register.html?plan=pro" style="color:var(--t);background:var(--orange);padding:5px 14px;border-radius:5px;font-size:11px;font-weight:700;text-decoration:none;white-space:nowrap;">Go Pro — $79/mo →</a>`;
        document.body.prepend(banner);
      }
    }
  });
