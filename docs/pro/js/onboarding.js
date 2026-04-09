/**
 * NBD Pro — 7-Step Onboarding Wizard
 * Comprehensive guided setup for new users
 *
 * Steps:
 *   1. Welcome & Profile (name, company, phone, service area, brand color)
 *   2. Your First Lead (lead info + damage type)
 *   3. Territory Setup (home base address, service radius)
 *   4. Camera Test (detect camera, test if available)
 *   5. Notification Setup (toggle new leads, follow-ups, appointments, payments)
 *   6. Academy Preview (show 3 course tiles, explore button)
 *   7. Completion (score, checklist, confetti, launch dashboard)
 *
 * Exposes: window.checkAndShowOnboarding(), window.showOnboarding(), window.restartOnboarding()
 * All Firestore ops save to userSettings/{uid}
 */

(function() {
  'use strict';

  // Confetti animation helper
  function fireConfetti() {
    if (typeof confetti !== 'function') return;
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  }

  // Track completion (1-indexed steps that are done: 1,3,5,7 = profile, territory, notifications, completion)
  let completedSteps = new Set();
  let currentStep = 0;
  let userData = {
    name: '',
    company: '',
    phone: '',
    serviceArea: '',
    brandColor: '#C8541A',
    leadAdded: false,
    cameraAvailable: false,
    notificationsRequested: false,
    academyExplored: false
  };

  const STEPS = [
    { num: 1, title: 'Welcome & Profile', subtitle: 'Tell us about your business' },
    { num: 2, title: 'Your First Lead', subtitle: 'Add a customer to get started' },
    { num: 3, title: 'Territory Setup', subtitle: 'Define your service area' },
    { num: 4, title: 'Camera Test', subtitle: 'Check your device camera' },
    { num: 5, title: 'Notifications', subtitle: 'Stay updated on important events' },
    { num: 6, title: 'Academy Preview', subtitle: 'Explore our training courses' },
    { num: 7, title: 'You\'re Ready!', subtitle: 'Launch your dashboard' }
  ];

  const BRAND_COLORS = [
    { name: 'Orange', hex: '#C8541A' },
    { name: 'Blue', hex: '#2563EB' },
    { name: 'Green', hex: '#10B981' },
    { name: 'Purple', hex: '#8B5CF6' },
    { name: 'Red', hex: '#EF4444' }
  ];

  const DAMAGE_TYPES = [
    'Roof - Hail Damage',
    'Roof - Wind Damage',
    'Siding',
    'Gutters',
    'Full Exterior'
  ];

  // Initialize styles
  function injectStyles() {
    if (document.getElementById('onboardingStyles')) return;
    const style = document.createElement('style');
    style.id = 'onboardingStyles';
    style.textContent = `
      @keyframes slideInRight {
        from { transform: translateX(40px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      @keyframes slideOutLeft {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(-40px); opacity: 0; }
      }
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      #onboardingOverlay {
        animation: fadeIn 0.3s ease-out;
      }
      .obStep {
        animation: slideInRight 0.4s ease-out;
      }
      .obBtn {
        min-height: 48px;
        transition: all 0.2s;
      }
      .obBtn:active {
        transform: scale(0.98);
      }
    `;
    document.head.appendChild(style);
  }

  async function checkAndShowOnboarding() {
    if (!window._user || !window._db) return;
    try {
      const { getDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const settingsRef = doc(window._db, 'userSettings', window._user.uid);
      const snap = await getDoc(settingsRef);
      if (snap.exists() && snap.data().onboardingComplete) return;
      if ((window._leads || []).length > 0) {
        // Existing user with leads — skip
        const { setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        await setDoc(settingsRef, { onboardingComplete: true, onboardingSkipped: true }, { merge: true });
        return;
      }
      showOnboarding();
    } catch(e) {
      console.warn('Onboarding check failed:', e.message);
    }
  }

  function showOnboarding() {
    injectStyles();
    currentStep = 0;
    completedSteps.clear();
    userData = {
      name: (window._user?.displayName || window._user?.email?.split('@')[0] || '').trim(),
      company: '',
      phone: '',
      serviceArea: '',
      brandColor: '#C8541A',
      leadAdded: false,
      cameraAvailable: false,
      notificationsRequested: false,
      academyExplored: false
    };

    const overlay = document.createElement('div');
    overlay.id = 'onboardingOverlay';
    overlay.style.cssText = `
      position: fixed;
      top:0;right:0;bottom:0;left:0;
      background: rgba(10, 12, 15, 0.92);
      z-index: 100000;
      display: flex;
      align-items: center;
      justify-content: center;
      -webkit-backdrop-filter:blur(20px);backdrop-filter: blur(8px);
    `;
    document.body.appendChild(overlay);
    renderStep();
  }

  function renderStep() {
    const overlay = document.getElementById('onboardingOverlay');
    if (!overlay) return;

    const step = STEPS[currentStep];
    const progressPercent = ((currentStep + 1) / STEPS.length) * 100;

    // Progress bar
    const progressBar = `
      <div style="
        position: absolute;
        top: 0;
        left: 0;
        height: 4px;
        width: ${progressPercent}%;
        background: #C8541A;
        border-radius: 20px;
        transition: width 0.3s ease;
      "></div>
    `;

    // Step dots
    const dots = STEPS.map((_, i) => `
      <div style="
        width: ${i === currentStep ? '28px' : '10px'};
        height: 10px;
        border-radius: 5px;
        background: ${i === currentStep ? '#C8541A' : 'rgba(255, 255, 255, 0.15)'};
        transition: all 0.3s;
        cursor: pointer;
      " onclick="window._obGoToStep(${i})"></div>
    `).join('');

    let content = '';
    if (currentStep === 0) content = renderStep1();
    else if (currentStep === 1) content = renderStep2();
    else if (currentStep === 2) content = renderStep3();
    else if (currentStep === 3) content = renderStep4();
    else if (currentStep === 4) content = renderStep5();
    else if (currentStep === 5) content = renderStep6();
    else if (currentStep === 6) content = renderStep7();

    overlay.innerHTML = `
      <div style="
        background: linear-gradient(135deg, #14161A 0%, #1a1e26 100%);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 24px;
        max-width: 580px;
        width: 92%;
        max-height: 92vh;
        overflow-y: auto;
        padding: 0;
        color: #fff;
        position: relative;
        box-shadow: 0 32px 120px rgba(0, 0, 0, 0.8);
      ">
        ${progressBar}

        <div style="padding: 40px 32px;">
          <button onclick="window._closeOnboarding()" style="
            position: absolute;
            top: 16px;
            right: 16px;
            background: none;
            border: none;
            color: rgba(255, 255, 255, 0.4);
            font-size: 24px;
            cursor: pointer;
            padding: 4px;
            transition: color 0.2s;
          " onmouseover="this.style.color='rgba(255,255,255,0.7)'" onmouseout="this.style.color='rgba(255,255,255,0.4)'">✕</button>

          <div style="text-align: center; margin-bottom: 32px;">
            <div style="
              font-family: 'Barlow Condensed', sans-serif;
              font-size: 28px;
              font-weight: 800;
              color: #fff;
              letter-spacing: -0.02em;
            ">${step.title}</div>
            <div style="
              font-size: 14px;
              color: rgba(255, 255, 255, 0.5);
              margin-top: 8px;
              font-weight: 400;
            ">${step.subtitle}</div>
          </div>

          <div class="obStep">${content}</div>

          <div style="
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            margin-top: 32px;
          ">${dots}</div>
        </div>
      </div>
    `;
  }

  function renderStep1() {
    return `
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <div>
          <label style="
            font-size: 11px;
            font-weight: 700;
            color: rgba(255, 255, 255, 0.5);
            text-transform: uppercase;
            letter-spacing: 0.08em;
          ">Your Name</label>
          <input id="ob-name" type="text" value="${userData.name}" placeholder="Joe Deal"
            style="
              width: 100%;
              padding: 13px 14px;
              background: rgba(255, 255, 255, 0.06);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 10px;
              color: #fff;
              font-size: 14px;
              margin-top: 6px;
              box-sizing: border-box;
              transition: all 0.2s;
            "
            onfocus="this.style.borderColor='rgba(255,255,255,0.3)'"
            onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
          />
        </div>

        <div>
          <label style="
            font-size: 11px;
            font-weight: 700;
            color: rgba(255, 255, 255, 0.5);
            text-transform: uppercase;
            letter-spacing: 0.08em;
          ">Company Name</label>
          <input id="ob-company" type="text" value="${userData.company}" placeholder="Your Company Name"
            style="
              width: 100%;
              padding: 13px 14px;
              background: rgba(255, 255, 255, 0.06);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 10px;
              color: #fff;
              font-size: 14px;
              margin-top: 6px;
              box-sizing: border-box;
              transition: all 0.2s;
            "
            onfocus="this.style.borderColor='rgba(255,255,255,0.3)'"
            onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
          />
        </div>

        <div>
          <label style="
            font-size: 11px;
            font-weight: 700;
            color: rgba(255, 255, 255, 0.5);
            text-transform: uppercase;
            letter-spacing: 0.08em;
          ">Phone Number</label>
          <input id="ob-phone" type="tel" value="${userData.phone}" placeholder="(555) 123-4567"
            style="
              width: 100%;
              padding: 13px 14px;
              background: rgba(255, 255, 255, 0.06);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 10px;
              color: #fff;
              font-size: 14px;
              margin-top: 6px;
              box-sizing: border-box;
              transition: all 0.2s;
            "
            onfocus="this.style.borderColor='rgba(255,255,255,0.3)'"
            onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
          />
        </div>

        <div>
          <label style="
            font-size: 11px;
            font-weight: 700;
            color: rgba(255, 255, 255, 0.5);
            text-transform: uppercase;
            letter-spacing: 0.08em;
          ">Primary Service Area</label>
          <input id="ob-area" type="text" value="${userData.serviceArea}" placeholder="e.g., Cincinnati, OH"
            style="
              width: 100%;
              padding: 13px 14px;
              background: rgba(255, 255, 255, 0.06);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 10px;
              color: #fff;
              font-size: 14px;
              margin-top: 6px;
              box-sizing: border-box;
              transition: all 0.2s;
            "
            onfocus="this.style.borderColor='rgba(255,255,255,0.3)'"
            onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
          />
        </div>

        <div>
          <label style="
            font-size: 11px;
            font-weight: 700;
            color: rgba(255, 255, 255, 0.5);
            text-transform: uppercase;
            letter-spacing: 0.08em;
            display: block;
            margin-bottom: 12px;
          ">Brand Color</label>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            ${BRAND_COLORS.map(color => `
              <div style="
                width: 50px;
                height: 50px;
                border-radius: 10px;
                background: ${color.hex};
                cursor: pointer;
                border: 3px solid ${userData.brandColor === color.hex ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.1)'};
                transition: all 0.2s;
              " onclick="window._obSetBrandColor('${color.hex}')" title="${color.name}"></div>
            `).join('')}
          </div>
        </div>

        <button onclick="window._obSaveProfile()" class="obBtn" style="
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #C8541A 0%, #a13d14 100%);
          color: white;
          border: none;
          border-radius: 12px;
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          letter-spacing: 0.04em;
          margin-top: 16px;
        ">NEXT →</button>
      </div>
    `;
  }

  function renderStep2() {
    return `
      <div style="display: flex; flex-direction: column; gap: 18px;">
        <div style="
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 20px;
        ">
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
            <div>
              <label style="font-size: 10px; color: rgba(255,255,255,0.4); text-transform: uppercase; font-weight: 700;">First Name</label>
              <input id="ob-lead-fname" type="text" placeholder="Jane"
                style="
                  width: 100%;
                  padding: 11px 12px;
                  background: rgba(255, 255, 255, 0.06);
                  border: 1px solid rgba(255, 255, 255, 0.1);
                  border-radius: 8px;
                  color: #fff;
                  font-size: 13px;
                  margin-top: 5px;
                  box-sizing: border-box;
                  transition: all 0.2s;
                "
                onfocus="this.style.borderColor='rgba(255,255,255,0.3)'"
                onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
              />
            </div>
            <div>
              <label style="font-size: 10px; color: rgba(255,255,255,0.4); text-transform: uppercase; font-weight: 700;">Last Name</label>
              <input id="ob-lead-lname" type="text" placeholder="Smith"
                style="
                  width: 100%;
                  padding: 11px 12px;
                  background: rgba(255, 255, 255, 0.06);
                  border: 1px solid rgba(255, 255, 255, 0.1);
                  border-radius: 8px;
                  color: #fff;
                  font-size: 13px;
                  margin-top: 5px;
                  box-sizing: border-box;
                  transition: all 0.2s;
                "
                onfocus="this.style.borderColor='rgba(255,255,255,0.3)'"
                onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
              />
            </div>
          </div>

          <div style="margin-bottom: 12px;">
            <label style="font-size: 10px; color: rgba(255,255,255,0.4); text-transform: uppercase; font-weight: 700;">Address</label>
            <input id="ob-lead-addr" type="text" placeholder="123 Main St, Cincinnati, OH"
              style="
                width: 100%;
                padding: 11px 12px;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                color: #fff;
                font-size: 13px;
                margin-top: 5px;
                box-sizing: border-box;
                transition: all 0.2s;
              "
              onfocus="this.style.borderColor='rgba(255,255,255,0.3)'"
              onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
            />
          </div>

          <div style="margin-bottom: 12px;">
            <label style="font-size: 10px; color: rgba(255,255,255,0.4); text-transform: uppercase; font-weight: 700;">Phone</label>
            <input id="ob-lead-phone" type="tel" placeholder="(555) 987-6543"
              style="
                width: 100%;
                padding: 11px 12px;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                color: #fff;
                font-size: 13px;
                margin-top: 5px;
                box-sizing: border-box;
                transition: all 0.2s;
              "
              onfocus="this.style.borderColor='rgba(255,255,255,0.3)'"
              onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
            />
          </div>

          <div>
            <label style="font-size: 10px; color: rgba(255,255,255,0.4); text-transform: uppercase; font-weight: 700;">Damage Type</label>
            <select id="ob-damage-type" style="
              width: 100%;
              padding: 11px 12px;
              background: rgba(255, 255, 255, 0.06);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 8px;
              color: #fff;
              font-size: 13px;
              margin-top: 5px;
              box-sizing: border-box;
              transition: all 0.2s;
              cursor: pointer;
            ">
              <option value="" style="background: #111418;">Select damage type...</option>
              ${DAMAGE_TYPES.map(dt => `<option value="${dt}" style="background: #111418;">${dt}</option>`).join('')}
            </select>
          </div>

          <div style="margin-top: 12px;">
            <label style="font-size: 10px; color: rgba(255,255,255,0.4); text-transform: uppercase; font-weight: 700;">Notes</label>
            <textarea id="ob-lead-notes" placeholder="Any additional details..."
              style="
                width: 100%;
                padding: 11px 12px;
                background: rgba(255, 255, 255, 0.06);
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 8px;
                color: #fff;
                font-size: 13px;
                margin-top: 5px;
                box-sizing: border-box;
                resize: vertical;
                min-height: 60px;
                transition: all 0.2s;
              "
              onfocus="this.style.borderColor='rgba(255,255,255,0.3)'"
              onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
            ></textarea>
          </div>
        </div>

        <div style="display: flex; gap: 10px;">
          <button onclick="window._obBack()" class="obBtn" style="
            flex: 1;
            padding: 14px;
            background: rgba(255, 255, 255, 0.08);
            color: rgba(255, 255, 255, 0.7);
            border: none;
            border-radius: 12px;
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
          " onmouseover="this.style.background='rgba(255,255,255,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">← BACK</button>
          <button onclick="window._obSaveLead()" class="obBtn" style="
            flex: 2;
            padding: 14px;
            background: linear-gradient(135deg, #C8541A 0%, #a13d14 100%);
            color: white;
            border: none;
            border-radius: 12px;
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
          ">ADD LEAD & CONTINUE →</button>
        </div>

        <button onclick="window._obNext()" style="
          width: 100%;
          padding: 10px;
          background: none;
          border: none;
          color: rgba(255, 255, 255, 0.4);
          font-size: 13px;
          cursor: pointer;
          margin-top: 4px;
          transition: color 0.2s;
        " onmouseover="this.style.color='rgba(255,255,255,0.6)'" onmouseout="this.style.color='rgba(255,255,255,0.4)'">Skip for now →</button>
      </div>
    `;
  }

  function renderStep3() {
    return `
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <div>
          <label style="
            font-size: 11px;
            font-weight: 700;
            color: rgba(255, 255, 255, 0.5);
            text-transform: uppercase;
            letter-spacing: 0.08em;
          ">Home Base Address</label>
          <input id="ob-territory-addr" type="text" value="" placeholder="Your office address"
            style="
              width: 100%;
              padding: 13px 14px;
              background: rgba(255, 255, 255, 0.06);
              border: 1px solid rgba(255, 255, 255, 0.1);
              border-radius: 10px;
              color: #fff;
              font-size: 14px;
              margin-top: 6px;
              box-sizing: border-box;
              transition: all 0.2s;
            "
            onfocus="this.style.borderColor='rgba(255,255,255,0.3)'"
            onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
          />
        </div>

        <div>
          <label style="
            font-size: 11px;
            font-weight: 700;
            color: rgba(255, 255, 255, 0.5);
            text-transform: uppercase;
            letter-spacing: 0.08em;
          ">Service Radius</label>
          <select id="ob-radius" style="
            width: 100%;
            padding: 13px 14px;
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            color: #fff;
            font-size: 14px;
            margin-top: 6px;
            box-sizing: border-box;
            cursor: pointer;
            transition: all 0.2s;
          ">
            <option value="" style="background: #111418;">Select radius...</option>
            <option value="5" style="background: #111418;">5 miles</option>
            <option value="10" style="background: #111418;">10 miles</option>
            <option value="25" style="background: #111418;">25 miles</option>
            <option value="50" style="background: #111418;">50 miles</option>
            <option value="unlimited" style="background: #111418;">Unlimited</option>
          </select>
        </div>

        <div style="
          background: linear-gradient(135deg, rgba(200, 84, 26, 0.15) 0%, rgba(200, 84, 26, 0.08) 100%);
          border: 1px solid rgba(200, 84, 26, 0.2);
          border-radius: 12px;
          padding: 16px;
          margin-top: 12px;
        ">
          <div style="font-size: 13px; color: rgba(255,255,255,0.7); line-height: 1.5;">
            📍 Set your territory to control which leads appear on your map and in your CRM.
          </div>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 12px;">
          <button onclick="window._obBack()" class="obBtn" style="
            flex: 1;
            padding: 14px;
            background: rgba(255, 255, 255, 0.08);
            color: rgba(255, 255, 255, 0.7);
            border: none;
            border-radius: 12px;
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
          " onmouseover="this.style.background='rgba(255,255,255,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">← BACK</button>
          <button onclick="window._obSaveTerritory()" class="obBtn" style="
            flex: 2;
            padding: 14px;
            background: linear-gradient(135deg, #C8541A 0%, #a13d14 100%);
            color: white;
            border: none;
            border-radius: 12px;
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
          ">CONTINUE →</button>
        </div>
      </div>
    `;
  }

  function renderStep4() {
    const cameraStatus = userData.cameraAvailable
      ? 'Camera detected! Ready to test.'
      : 'No camera detected. (Desktop? No problem, skip for now.)';

    return `
      <div style="display: flex; flex-direction: column; gap: 24px;">
        <div style="
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 24px;
          text-align: center;
        ">
          <div style="font-size: 48px; margin-bottom: 16px;">📷</div>
          <div style="font-size: 14px; color: rgba(255,255,255,0.7); line-height: 1.6;">
            ${cameraStatus}
          </div>
        </div>

        <div style="display: flex; gap: 10px;">
          <button onclick="window._obBack()" class="obBtn" style="
            flex: 1;
            padding: 14px;
            background: rgba(255, 255, 255, 0.08);
            color: rgba(255, 255, 255, 0.7);
            border: none;
            border-radius: 12px;
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
          " onmouseover="this.style.background='rgba(255,255,255,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">← BACK</button>
          ${userData.cameraAvailable ? `
            <button onclick="window._obTestCamera()" class="obBtn" style="
              flex: 1.5;
              padding: 14px;
              background: linear-gradient(135deg, #10B981 0%, #059669 100%);
              color: white;
              border: none;
              border-radius: 12px;
              font-family: 'Barlow Condensed', sans-serif;
              font-size: 15px;
              font-weight: 700;
              cursor: pointer;
            ">TEST CAMERA</button>
          ` : ''}
          <button onclick="window._obNext()" class="obBtn" style="
            flex: 1;
            padding: 14px;
            background: linear-gradient(135deg, #C8541A 0%, #a13d14 100%);
            color: white;
            border: none;
            border-radius: 12px;
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
          ">NEXT →</button>
        </div>
      </div>
    `;
  }

  function renderStep5() {
    const toggles = [
      { id: 'newLeads', label: 'New Lead Alerts', desc: 'Get notified when new leads arrive' },
      { id: 'followUps', label: 'Follow-ups', desc: 'Reminders for follow-up tasks' },
      { id: 'appointments', label: 'Appointments', desc: 'Alerts for scheduled meetings' },
      { id: 'payments', label: 'Payments', desc: 'Notifications for received payments' }
    ];

    return `
      <div style="display: flex; flex-direction: column; gap: 14px;">
        ${toggles.map(toggle => `
          <div style="
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 16px;
            display: flex;
            align-items: center;
            justify-content: space-between;
          ">
            <div>
              <div style="font-weight: 700; color: #fff; font-size: 14px;">${toggle.label}</div>
              <div style="font-size: 12px; color: rgba(255,255,255,0.4); margin-top: 4px;">${toggle.desc}</div>
            </div>
            <label style="
              position: relative;
              display: inline-block;
              width: 50px;
              height: 28px;
              cursor: pointer;
            ">
              <input type="checkbox" id="ob-notif-${toggle.id}" style="display: none;" />
              <span onclick="window._obToggleNotif('${toggle.id}')" style="
                position: absolute;
                cursor: pointer;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 14px;
                transition: 0.3s;
                border: 1px solid rgba(255, 255, 255, 0.15);
              " id="ob-toggle-${toggle.id}">
                <span style="
                  position: absolute;
                  content: '';
                  height: 22px;
                  width: 22px;
                  left: 3px;
                  bottom: 3px;
                  background: white;
                  border-radius: 50%;
                  transition: 0.3s;
                " id="ob-slider-${toggle.id}"></span>
              </span>
            </label>
          </div>
        `).join('')}

        <div style="display: flex; gap: 10px; margin-top: 12px;">
          <button onclick="window._obBack()" class="obBtn" style="
            flex: 1;
            padding: 14px;
            background: rgba(255, 255, 255, 0.08);
            color: rgba(255, 255, 255, 0.7);
            border: none;
            border-radius: 12px;
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
          " onmouseover="this.style.background='rgba(255,255,255,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">← BACK</button>
          <button onclick="window._obSaveNotifications()" class="obBtn" style="
            flex: 2;
            padding: 14px;
            background: linear-gradient(135deg, #C8541A 0%, #a13d14 100%);
            color: white;
            border: none;
            border-radius: 12px;
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
          ">CONTINUE →</button>
        </div>
      </div>
    `;
  }

  function renderStep6() {
    const courses = [
      { icon: '🏠', title: 'Insurance Restoration', lessons: '5 Courses' },
      { icon: '🛖', title: 'Retail Roofing', lessons: '4 Courses' },
      { icon: '📚', title: 'Advanced Selling', lessons: '6 Courses' }
    ];

    return `
      <div style="display: flex; flex-direction: column; gap: 18px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 8px;">
          ${courses.map(course => `
            <div style="
              background: linear-gradient(135deg, rgba(200, 84, 26, 0.2) 0%, rgba(200, 84, 26, 0.1) 100%);
              border: 1px solid rgba(200, 84, 26, 0.2);
              border-radius: 12px;
              padding: 20px;
              text-align: center;
            ">
              <div style="font-size: 32px; margin-bottom: 10px;">${course.icon}</div>
              <div style="font-weight: 700; color: #fff; font-size: 13px; margin-bottom: 6px;">${course.title}</div>
              <div style="font-size: 11px; color: rgba(255,255,255,0.5);">${course.lessons}</div>
            </div>
          `).join('')}
        </div>

        <div style="
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 16px;
          text-align: center;
        ">
          <div style="font-size: 13px; color: rgba(255,255,255,0.6); line-height: 1.5;">
            🎓 Complete courses to level up your skills and close more deals.
          </div>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 8px;">
          <button onclick="window._obBack()" class="obBtn" style="
            flex: 1;
            padding: 14px;
            background: rgba(255, 255, 255, 0.08);
            color: rgba(255, 255, 255, 0.7);
            border: none;
            border-radius: 12px;
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
          " onmouseover="this.style.background='rgba(255,255,255,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">← BACK</button>
          <button onclick="window._obExploreAcademy()" class="obBtn" style="
            flex: 1;
            padding: 14px;
            background: rgba(255, 255, 255, 0.08);
            color: rgba(255, 255, 255, 0.7);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 12px;
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s;
          " onmouseover="this.style.background='rgba(255,255,255,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.08)'">EXPLORE 📚</button>
          <button onclick="window._obNext()" class="obBtn" style="
            flex: 1;
            padding: 14px;
            background: linear-gradient(135deg, #C8541A 0%, #a13d14 100%);
            color: white;
            border: none;
            border-radius: 12px;
            font-family: 'Barlow Condensed', sans-serif;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
          ">NEXT →</button>
        </div>
      </div>
    `;
  }

  function renderStep7() {
    const completedCount = completedSteps.size;
    const maxScore = 6; // profile, lead, territory, notifications, camera (optional), academy = 6
    const scorePercent = Math.round((completedCount / maxScore) * 100);

    let encouragement = '👍 Good start!';
    if (completedCount === maxScore) encouragement = '🔥 PERFECT!';
    else if (completedCount >= 4) encouragement = '💪 Great setup!';

    const checklist = [
      { step: 'Profile Setup', done: completedSteps.has(1) },
      { step: 'First Lead Added', done: completedSteps.has(2) },
      { step: 'Territory Mapped', done: completedSteps.has(3) },
      { step: 'Notifications Enabled', done: completedSteps.has(5) },
      { step: 'Camera Ready', done: completedSteps.has(4) },
      { step: 'Academy Started', done: completedSteps.has(6) }
    ];

    return `
      <div style="display: flex; flex-direction: column; gap: 20px;">
        <div style="
          background: linear-gradient(135deg, rgba(200, 84, 26, 0.2) 0%, rgba(200, 84, 26, 0.1) 100%);
          border: 1px solid rgba(200, 84, 26, 0.2);
          border-radius: 12px;
          padding: 24px;
          text-align: center;
        ">
          <div style="font-size: 14px; color: rgba(255,255,255,0.5); margin-bottom: 12px;">Your Setup Score</div>
          <div style="
            font-size: 48px;
            font-weight: 800;
            color: #C8541A;
            font-family: 'Barlow Condensed', sans-serif;
            letter-spacing: -0.02em;
            margin-bottom: 8px;
          ">${scorePercent}%</div>
          <div style="font-size: 16px; font-weight: 700; color: #fff;">${encouragement}</div>
        </div>

        <div style="
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 12px;
          padding: 16px;
        ">
          <div style="font-size: 12px; font-weight: 700; color: rgba(255,255,255,0.5); text-transform: uppercase; margin-bottom: 12px; letter-spacing: 0.04em;">Setup Checklist</div>
          ${checklist.map(item => `
            <div style="
              display: flex;
              align-items: center;
              gap: 10px;
              padding: 8px 0;
              font-size: 13px;
              color: rgba(255,255,255,0.7);
            ">
              <span style="
                font-size: 16px;
                font-weight: 700;
              ">${item.done ? '✓' : '—'}</span>
              ${item.step}
            </div>
          `).join('')}
        </div>

        <button onclick="window._obLaunchDashboard()" class="obBtn" style="
          width: 100%;
          padding: 16px;
          background: linear-gradient(135deg, #C8541A 0%, #a13d14 100%);
          color: white;
          border: none;
          border-radius: 12px;
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 16px;
          font-weight: 700;
          cursor: pointer;
          letter-spacing: 0.04em;
          margin-top: 12px;
        ">LAUNCH DASHBOARD 🚀</button>
      </div>
    `;
  }

  // Handler functions
  window._obSetBrandColor = function(hex) {
    userData.brandColor = hex;
    renderStep();
  };

  window._obSaveProfile = async function() {
    const name = (document.getElementById('ob-name')?.value || '').trim();
    const company = (document.getElementById('ob-company')?.value || '').trim();
    const phone = (document.getElementById('ob-phone')?.value || '').trim();
    const area = (document.getElementById('ob-area')?.value || '').trim();

    if (!name || !company) {
      if (typeof showToast === 'function') showToast('Name and company are required', 'error');
      return;
    }

    userData.name = name;
    userData.company = company;
    userData.phone = phone;
    userData.serviceArea = area;
    completedSteps.add(1);

    try {
      const { setDoc, doc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      await setDoc(
        doc(window._db, 'userSettings', window._user.uid),
        {
          displayName: name,
          company,
          phone,
          serviceArea: area,
          brandColor: userData.brandColor,
          profileCompletedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch(e) {
      console.warn('Profile save failed:', e.message);
    }

    currentStep++;
    renderStep();
  };

  window._obSaveLead = async function() {
    const fname = (document.getElementById('ob-lead-fname')?.value || '').trim();
    const addr = (document.getElementById('ob-lead-addr')?.value || '').trim();
    const damageType = document.getElementById('ob-damage-type')?.value || '';

    if (!fname || !addr) {
      if (typeof showToast === 'function') showToast('Name and address are required', 'error');
      return;
    }

    completedSteps.add(2);
    userData.leadAdded = true;

    try {
      const { addDoc, collection, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      await addDoc(collection(window._db, 'leads'), {
        userId: window._user.uid,
        firstName: fname,
        lastName: (document.getElementById('ob-lead-lname')?.value || '').trim(),
        address: addr,
        phone: (document.getElementById('ob-lead-phone')?.value || '').trim(),
        damageType,
        notes: (document.getElementById('ob-lead-notes')?.value || '').trim(),
        stage: 'new',
        source: 'Onboarding',
        createdAt: serverTimestamp()
      });
      if (typeof showToast === 'function') showToast('Lead added! 🎉', 'ok');
      fireConfetti();
    } catch(e) {
      console.error('Lead save failed:', e);
      if (typeof showToast === 'function') showToast('Failed to save lead', 'error');
      return;
    }

    currentStep++;
    renderStep();
  };

  window._obSaveTerritory = async function() {
    const addr = (document.getElementById('ob-territory-addr')?.value || '').trim();
    const radius = document.getElementById('ob-radius')?.value || '';

    if (!addr || !radius) {
      if (typeof showToast === 'function') showToast('Address and radius are required', 'error');
      return;
    }

    completedSteps.add(3);

    try {
      const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      await setDoc(
        doc(window._db, 'userSettings', window._user.uid),
        {
          territoryAddress: addr,
          serviceRadius: radius === 'unlimited' ? null : parseInt(radius),
          territoryCompletedAt: new Date().toISOString()
        },
        { merge: true }
      );
    } catch(e) {
      console.warn('Territory save failed:', e.message);
    }

    currentStep++;
    renderStep();
  };

  window._obTestCamera = async function() {
    if (typeof window.PhotoEngine?.openCamera === 'function') {
      try {
        await window.PhotoEngine.openCamera('test');
      } catch(e) {
        console.warn('Camera test failed:', e.message);
      }
    }
  };

  window._obToggleNotif = function(id) {
    const toggle = document.getElementById(`ob-toggle-${id}`);
    const slider = document.getElementById(`ob-slider-${id}`);
    const input = document.getElementById(`ob-notif-${id}`);

    if (input.checked) {
      input.checked = false;
      toggle.style.background = 'rgba(255, 255, 255, 0.1)';
      slider.style.left = '3px';
    } else {
      input.checked = true;
      toggle.style.background = 'rgba(200, 84, 26, 0.5)';
      slider.style.left = '25px';
    }
  };

  window._obSaveNotifications = async function() {
    const settings = {
      newLeadsAlert: (document.getElementById('ob-notif-newLeads')?.checked || false),
      followUpAlert: (document.getElementById('ob-notif-followUps')?.checked || false),
      appointmentAlert: (document.getElementById('ob-notif-appointments')?.checked || false),
      paymentAlert: (document.getElementById('ob-notif-payments')?.checked || false)
    };

    completedSteps.add(5);
    userData.notificationsRequested = true;

    try {
      const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      await setDoc(
        doc(window._db, 'userSettings', window._user.uid),
        { notificationSettings: settings, notificationsSetupAt: new Date().toISOString() },
        { merge: true }
      );

      if (typeof window.PushNotifications?.requestPermission === 'function' && Object.values(settings).some(v => v)) {
        try {
          await window.PushNotifications.requestPermission();
        } catch(e) {
          console.warn('Push permission request failed:', e.message);
        }
      }
    } catch(e) {
      console.warn('Notification save failed:', e.message);
    }

    currentStep++;
    renderStep();
  };

  window._obExploreAcademy = function() {
    completedSteps.add(6);
    userData.academyExplored = true;
    if (typeof window.goTo === 'function') {
      window.goTo('academy');
    }
  };

  window._obNext = function() {
    // Auto-detect camera availability before moving to step 4
    if (currentStep === 3) {
      checkCameraAvailability().then(() => {
        currentStep = Math.min(currentStep + 1, STEPS.length - 1);
        renderStep();
      });
    } else {
      currentStep = Math.min(currentStep + 1, STEPS.length - 1);
      renderStep();
    }
  };

  window._obBack = function() {
    currentStep = Math.max(currentStep - 1, 0);
    renderStep();
  };

  window._obGoToStep = function(step) {
    currentStep = Math.max(0, Math.min(step, STEPS.length - 1));
    renderStep();
  };

  window._obLaunchDashboard = async function() {
    const overlay = document.getElementById('onboardingOverlay');
    if (overlay) overlay.remove();

    fireConfetti();

    try {
      const { setDoc, doc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      await setDoc(
        doc(window._db, 'userSettings', window._user.uid),
        {
          onboardingComplete: true,
          completedAt: serverTimestamp(),
          onboardingScore: Math.round((completedSteps.size / 6) * 100)
        },
        { merge: true }
      );
    } catch(e) {
      console.warn('Completion save failed:', e.message);
    }

    if (typeof showToast === 'function') showToast('Welcome to NBD Pro! 🚀', 'ok');
    if (typeof window.goTo === 'function') {
      setTimeout(() => window.goTo('dashboard'), 600);
    }
  };

  window._closeOnboarding = async function() {
    const overlay = document.getElementById('onboardingOverlay');
    if (overlay) overlay.remove();

    try {
      const { setDoc, doc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      await setDoc(
        doc(window._db, 'userSettings', window._user.uid),
        { onboardingComplete: true, onboardingSkipped: true },
        { merge: true }
      );
    } catch(e) {}
  };

  async function checkCameraAvailability() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      userData.cameraAvailable = devices.some(device => device.kind === 'videoinput');
      if (userData.cameraAvailable) completedSteps.add(4);
    } catch(e) {
      userData.cameraAvailable = false;
    }
  }

  window.checkAndShowOnboarding = checkAndShowOnboarding;
  window.showOnboarding = showOnboarding;
  window.restartOnboarding = function() {
    const overlay = document.getElementById('onboardingOverlay');
    if (overlay) overlay.remove();
    showOnboarding();
  };

})();
