/**
 * NBD Pro — Onboarding Wizard
 * 3-step guided setup for new users:
 *   Step 1: Company info (name, phone, colors)
 *   Step 2: Create first lead
 *   Step 3: Quick tour of key features
 *
 * Checks Firestore `userSettings/{uid}` for onboardingComplete flag.
 * Exposes: window.checkAndShowOnboarding(), window.showOnboarding()
 */

(function() {
  'use strict';

  const STEPS = [
    { title: 'Welcome to NBD Pro!', subtitle: 'Let\'s get your account set up in 60 seconds.' },
    { title: 'Your First Lead', subtitle: 'Add your first customer to get started.' },
    { title: 'You\'re All Set!', subtitle: 'Here\'s a quick overview of your superpowers.' }
  ];

  let currentStep = 0;

  async function checkAndShowOnboarding() {
    if (!window._user || !window._db) return;
    try {
      const settingsRef = window.doc(window._db, 'userSettings', window._user.uid);
      const snap = await window.getDoc(settingsRef);
      if (snap.exists() && snap.data().onboardingComplete) return; // Already done
      // New user — check if they have leads (existing users who upgrade)
      if ((window._leads || []).length > 0) {
        // Mark as complete for existing users
        await window.setDoc(settingsRef, { onboardingComplete: true, onboardingSkipped: true }, { merge: true });
        return;
      }
      showOnboarding();
    } catch(e) { console.warn('Onboarding check failed:', e.message); }
  }

  function showOnboarding() {
    currentStep = 0;
    const overlay = document.createElement('div');
    overlay.id = 'onboardingOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,12,15,.85);z-index:100000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);';
    document.body.appendChild(overlay);
    renderStep();
  }

  function renderStep() {
    const overlay = document.getElementById('onboardingOverlay');
    if (!overlay) return;

    const step = STEPS[currentStep];
    const dots = STEPS.map((_, i) =>
      `<div style="width:${i === currentStep ? '24px' : '8px'};height:8px;border-radius:4px;background:${i === currentStep ? '#C8541A' : 'rgba(255,255,255,.2)'};transition:all .3s;"></div>`
    ).join('');

    let content = '';
    if (currentStep === 0) content = renderStep1();
    else if (currentStep === 1) content = renderStep2();
    else if (currentStep === 2) content = renderStep3();

    overlay.innerHTML = `
      <div style="background:#14161a;border:1px solid rgba(255,255,255,.1);border-radius:20px;max-width:540px;width:92%;padding:40px 32px;color:#fff;position:relative;box-shadow:0 24px 80px rgba(0,0,0,.6);">
        <button onclick="window._closeOnboarding()" style="position:absolute;top:16px;right:16px;background:none;border:none;color:rgba(255,255,255,.4);font-size:20px;cursor:pointer;">✕</button>
        <div style="text-align:center;margin-bottom:24px;">
          <div style="font-family:'Barlow Condensed',sans-serif;font-size:24px;font-weight:800;color:#fff;">${step.title}</div>
          <div style="font-size:13px;color:rgba(255,255,255,.5);margin-top:6px;">${step.subtitle}</div>
        </div>
        ${content}
        <div style="display:flex;align-items:center;justify-content:center;gap:6px;margin-top:28px;">${dots}</div>
      </div>
    `;
  }

  function renderStep1() {
    const user = window._user || {};
    const name = user.displayName || user.email?.split('@')[0] || '';
    return `
      <div style="margin-bottom:20px;">
        <label style="font-size:11px;font-weight:600;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;">Your Name</label>
        <input id="ob-name" type="text" value="${name}" placeholder="Joe Deal"
               style="width:100%;padding:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#fff;font-size:14px;margin-top:6px;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:20px;">
        <label style="font-size:11px;font-weight:600;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;">Company Name</label>
        <input id="ob-company" type="text" value="No Big Deal Home Solutions" placeholder="Your Company Name"
               style="width:100%;padding:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#fff;font-size:14px;margin-top:6px;box-sizing:border-box;">
      </div>
      <div style="margin-bottom:20px;">
        <label style="font-size:11px;font-weight:600;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em;">Phone Number</label>
        <input id="ob-phone" type="tel" value="" placeholder="(555) 123-4567"
               style="width:100%;padding:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#fff;font-size:14px;margin-top:6px;box-sizing:border-box;">
      </div>
      <button onclick="window._obNext()" style="width:100%;padding:14px;background:#C8541A;color:white;border:none;border-radius:12px;font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;cursor:pointer;letter-spacing:.04em;">
        NEXT →
      </button>
    `;
  }

  function renderStep2() {
    return `
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:20px;margin-bottom:20px;">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;">First Name</label>
            <input id="ob-lead-fname" type="text" placeholder="Jane"
                   style="width:100%;padding:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;font-size:13px;margin-top:4px;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;">Last Name</label>
            <input id="ob-lead-lname" type="text" placeholder="Smith"
                   style="width:100%;padding:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;font-size:13px;margin-top:4px;box-sizing:border-box;">
          </div>
        </div>
        <div style="margin-top:12px;">
          <label style="font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;">Address</label>
          <input id="ob-lead-addr" type="text" placeholder="123 Main St, Cincinnati, OH"
                 style="width:100%;padding:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;font-size:13px;margin-top:4px;box-sizing:border-box;">
        </div>
        <div style="margin-top:12px;">
          <label style="font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;">Phone</label>
          <input id="ob-lead-phone" type="tel" placeholder="(555) 987-6543"
                 style="width:100%;padding:10px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;font-size:13px;margin-top:4px;box-sizing:border-box;">
        </div>
      </div>
      <div style="display:flex;gap:10px;">
        <button onclick="window._obBack()" style="flex:1;padding:14px;background:rgba(255,255,255,.08);color:rgba(255,255,255,.6);border:none;border-radius:12px;font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:600;cursor:pointer;">
          ← BACK
        </button>
        <button onclick="window._obSaveLead()" style="flex:2;padding:14px;background:#C8541A;color:white;border:none;border-radius:12px;font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;cursor:pointer;">
          ADD LEAD & CONTINUE →
        </button>
      </div>
      <button onclick="window._obNext()" style="width:100%;padding:10px;background:none;border:none;color:rgba(255,255,255,.4);font-size:12px;cursor:pointer;margin-top:8px;">
        Skip — I'll add leads later
      </button>
    `;
  }

  function renderStep3() {
    const features = [
      { icon: '📋', title: 'CRM Pipeline', desc: 'Drag & drop leads across stages' },
      { icon: '🗺️', title: 'Smart Map', desc: 'Drop pins, track territory, heat map' },
      { icon: '📄', title: 'Document Generator', desc: '20+ professional templates auto-filled' },
      { icon: '🚪', title: 'D2D Tracker', desc: 'Log knocks, convert to leads automatically' },
      { icon: '🤖', title: 'AI Assistant', desc: 'Joe AI helps with estimates & strategy' },
      { icon: '📊', title: 'Analytics', desc: 'Pipeline value, close rate, revenue tracking' }
    ];

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">
        ${features.map(f => `
          <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:14px;text-align:center;">
            <div style="font-size:24px;margin-bottom:6px;">${f.icon}</div>
            <div style="font-size:13px;font-weight:700;color:#fff;">${f.title}</div>
            <div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:3px;">${f.desc}</div>
          </div>
        `).join('')}
      </div>
      <button onclick="window._obComplete()" style="width:100%;padding:14px;background:#C8541A;color:white;border:none;border-radius:12px;font-family:'Barlow Condensed',sans-serif;font-size:16px;font-weight:700;cursor:pointer;letter-spacing:.04em;">
        LET'S GO! 🚀
      </button>
    `;
  }

  // Navigation handlers
  window._obNext = function() { currentStep = Math.min(currentStep + 1, STEPS.length - 1); renderStep(); };
  window._obBack = function() { currentStep = Math.max(currentStep - 1, 0); renderStep(); };

  window._obSaveLead = async function() {
    const fname = document.getElementById('ob-lead-fname')?.value?.trim();
    const addr = document.getElementById('ob-lead-addr')?.value?.trim();
    if (!fname || !addr) {
      if (typeof showToast === 'function') showToast('Name and address are needed', 'error');
      return;
    }
    try {
      if (typeof window._saveLead === 'function') {
        await window._saveLead({
          firstName: fname,
          lastName: document.getElementById('ob-lead-lname')?.value?.trim() || '',
          address: addr,
          phone: document.getElementById('ob-lead-phone')?.value?.trim() || '',
          stage: 'new',
          source: 'Onboarding'
        });
        if (typeof showToast === 'function') showToast('Lead added!', 'ok');
      }
    } catch(e) { console.error('Onboarding lead save failed:', e); }
    currentStep = 2;
    renderStep();
  };

  window._obComplete = async function() {
    const overlay = document.getElementById('onboardingOverlay');
    if (overlay) overlay.remove();
    // Mark onboarding as complete in Firestore
    if (window._db && window._user) {
      try {
        await window.setDoc(window.doc(window._db, 'userSettings', window._user.uid), { onboardingComplete: true, completedAt: new Date().toISOString() }, { merge: true });
      } catch(e) { console.warn('Onboarding complete flag save failed:', e.message); }
    }
    if (typeof showToast === 'function') showToast('Welcome to NBD Pro! 🎉', 'ok');
  };

  window._closeOnboarding = async function() {
    const overlay = document.getElementById('onboardingOverlay');
    if (overlay) overlay.remove();
    // Mark as skipped
    if (window._db && window._user) {
      try {
        await window.setDoc(window.doc(window._db, 'userSettings', window._user.uid), { onboardingComplete: true, onboardingSkipped: true }, { merge: true });
      } catch(e) {}
    }
  };

  window.checkAndShowOnboarding = checkAndShowOnboarding;
  window.showOnboarding = showOnboarding;

})();
