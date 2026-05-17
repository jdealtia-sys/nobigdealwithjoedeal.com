// Centralized Auth Gate (extracted from inline <script type="module"> in
// dashboard.html for CSP compliance — see hotfix(csp) commit).
//
// Dashboard does its own heavy Firebase init in
// dashboard-bootstrap.module.js — NBDAuth just provides the access gate
// and exposes window.NBDAuth for plan badges / feature checks. Module
// scripts are implicitly deferred so this still runs in document order
// before the bootstrap module.
import { NBDAuth } from '/pro/js/nbd-auth.js';

window._nbdAuth = NBDAuth.init({
  requiredPlan: 'foundation',
  onReady: (user) => {
    console.log('NBDAuth gate passed — plan:', NBDAuth.userPlan);
    // ── Trial countdown banner ──
    // Dismissals were permanent (this.parentElement.remove()) which made
    // the warning vanish for the entire session if Joe accidentally
    // tapped × on a small screen. We now scope the suppression to the
    // current calendar day (sessionStorage), so each day's first dashboard
    // load re-surfaces the banner — and the user can still dismiss it
    // again until tomorrow.
    const _trialDismissKey = 'nbd_trial_banner_dismissed_' + new Date().toISOString().slice(0,10);
    const _trialDismissedToday = (() => { try { return sessionStorage.getItem(_trialDismissKey) === '1'; } catch { return false; } })();
    const _dismissTrial = (btn) => {
      try { sessionStorage.setItem(_trialDismissKey, '1'); } catch {}
      const b = btn?.closest?.('#trial-banner') || document.getElementById('trial-banner');
      if (b) b.remove();
    };
    window._nbdDismissTrial = _dismissTrial;
    if (NBDAuth.isTrialUser && !NBDAuth.isTrialExpired) {
      const days = NBDAuth.trialDaysLeft;
      // Always show when ≤ 2 days, regardless of dismissal — too critical
      // to suppress. Otherwise honour the per-day dismissal.
      if (days <= 7 && (days <= 2 || !_trialDismissedToday)) {
        const urgency = days <= 2 ? 'trial-urgent' : 'trial-warning';
        const msg = days <= 2
          ? `⚠️ Your Pro trial ends in ${days} day${days===1?'':'s'}! Your data is safe — upgrade now to keep all features.`
          : `Your Pro trial has ${days} days left. Upgrade to $79/mo to keep full access.`;
        const banner = document.createElement('div');
        banner.id = 'trial-banner';
        banner.className = urgency;
        banner.innerHTML = `<span>${msg}</span><a href="/pro/register.html?plan=pro" style="color:var(--t);background:var(--orange);padding:5px 14px;border-radius:5px;font-size:11px;font-weight:700;text-decoration:none;white-space:nowrap;">Upgrade Now →</a><button data-action="call" data-fn="_nbdDismissTrial" data-pass-el style="background:none;border:none;color:var(--m);cursor:pointer;font-size:14px;padding:0 4px;">✕</button>`;
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
