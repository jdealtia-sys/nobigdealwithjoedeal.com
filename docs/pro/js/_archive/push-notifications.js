/**
 * NBD Pro — Firebase Cloud Messaging (FCM) Push Notification Manager
 * ===================================================================
 * Client-side FCM initialization, permission handling, token management,
 * notification preferences, and settings UI.
 *
 * USAGE (in your main page):
 *   <script type="module">
 *     import { PushNotifications } from '/pro/js/push-notifications.js';
 *     await PushNotifications.init();
 *     await PushNotifications.requestPermission();
 *     PushNotifications.renderSettingsPanel('notification-settings-container');
 *   </script>
 */

import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// Module State
let messaging = null;
let db = null;
let auth = null;
let currentToken = null;
let initialized = false;

// Default notification preferences
const DEFAULT_PREFS = {
  newLead: true,
  appointmentReminder: true,
  followUpDue: true,
  claimUpdate: true,
  teamActivity: true,
  d2dStreak: true
};

// Labels and descriptions
const PREF_LABELS = {
  newLead: 'New Lead Assigned',
  appointmentReminder: 'Appointment Reminders',
  followUpDue: 'Follow-Up Reminders',
  claimUpdate: 'Claim Updates',
  teamActivity: 'Team Activity',
  d2dStreak: 'D2D Streak Notifications'
};

const PREF_DESCRIPTIONS = {
  newLead: 'Get notified when a new lead is assigned to you',
  appointmentReminder: 'Reminders 30 minutes before appointments',
  followUpDue: 'Daily reminders for due follow-ups',
  claimUpdate: 'Stage changes and updates for your claims',
  teamActivity: 'Team messages and collaboration updates',
  d2dStreak: 'Celebrate your door-to-door knock streaks'
};

/**
 * Initialize FCM on the client
 */
const init = async () => {
  if (initialized) return;
  
  // Wait for Firebase app to be initialized
  let attempts = 0;
  while (!window._firebaseApp && attempts < 50) {
    await new Promise(r => setTimeout(r, 100));
    attempts++;
  }
  
  if (!window._firebaseApp) {
    console.error('[FCM] Firebase app not available at window._firebaseApp');
    return;
  }
  
  try {
    messaging = getMessaging(window._firebaseApp);
    db = getFirestore(window._firebaseApp);
    auth = getAuth(window._firebaseApp);
    initialized = true;
    
    // Set up foreground message handler
    setupForegroundMessageHandler();
    
    // Listen for token refresh
    messaging.onTokenRefresh(() => {
      getAndStoreFCMToken();
    });
    
    console.log('[FCM] Initialization complete');
  } catch (err) {
    console.error('[FCM] Initialization failed:', err);
  }
};

/**
 * Set up handler for messages in the foreground
 */
const setupForegroundMessageHandler = () => {
  if (!messaging) return;
  
  onMessage(messaging, (payload) => {
    console.log('[FCM] Foreground message received:', payload);
    
    const { notification, data } = payload;
    const title = notification?.title || 'NBD Pro';
    const body = notification?.body || 'New notification';
    
    // Show toast notification
    if (typeof showToast === 'function') {
      showToast(title, body, 'info', 5000);
    } else {
      console.log('[FCM] Toast:', title, body);
    }
    
    // Update notification bell count if available
    updateNotificationBellCount();
    
    // Dispatch custom event for app to handle
    window.dispatchEvent(new CustomEvent('fcm-foreground-message', { 
      detail: { title, body, data } 
    }));
  });
};

/**
 * Request notification permission and get FCM token
 */
const requestPermission = async () => {
  if (!initialized) await init();
  if (!messaging || !auth.currentUser) {
    console.warn('[FCM] Not ready: messaging or user not available');
    return null;
  }
  
  try {
    // Request browser notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('[FCM] Notification permission denied');
      return null;
    }
    
    // Get FCM token
    const token = await getAndStoreFCMToken();
    return token;
  } catch (err) {
    console.error('[FCM] Permission request failed:', err);
    return null;
  }
};

/**
 * Get FCM token and store it in Firestore
 */
const getAndStoreFCMToken = async () => {
  if (!messaging || !auth.currentUser || !db) {
    console.warn('[FCM] Cannot get token: requirements not met');
    return null;
  }
  
  try {
    const token = await getToken(messaging, {
      vapidKey: 'BHU2kMz_qqp_TKfkwf6BQOLDPt4oUgfX0vIXbmVRx1Zg_C-OJc6V5PK2N3aX5yZ7X0T4aZ5bY3_eX2Z3_W4'
    });
    
    if (token) {
      currentToken = token;
      
      // Store in Firestore: users/{uid}/fcmTokens/{tokenHash}
      const uid = auth.currentUser.uid;
      const tokenHash = hashToken(token);
      const device = getDeviceInfo();
      
      const tokenRef = doc(db, 'users', uid, 'fcmTokens', tokenHash);
      await setDoc(tokenRef, {
        token: token,
        device: device,
        createdAt: serverTimestamp(),
        lastActive: serverTimestamp()
      }, { merge: true });
      
      console.log('[FCM] Token stored:', tokenHash);
      return token;
    }
  } catch (err) {
    console.error('[FCM] Failed to get/store token:', err);
  }
  
  return null;
};

/**
 * Get current FCM token
 */
const getTokenValue = async () => {
  if (currentToken) return currentToken;
  
  if (!initialized) await init();
  return await getAndStoreFCMToken();
};

/**
 * Update notification bell count
 */
const updateNotificationBellCount = async () => {
  if (!auth.currentUser) return;
  
  try {
    const bellElement = document.querySelector('[data-notification-bell]');
    if (bellElement) {
      const currentCount = parseInt(bellElement.dataset.count || '0', 10);
      bellElement.dataset.count = currentCount + 1;
    }
  } catch (err) {
    console.error('[FCM] Error updating bell count:', err);
  }
};

/**
 * Get notification preferences for the current user
 */
const getPreferences = async () => {
  if (!auth.currentUser || !db) return DEFAULT_PREFS;
  
  try {
    const uid = auth.currentUser.uid;
    const userRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userRef);
    
    if (userDoc.exists()) {
      return userDoc.data().notificationPrefs || DEFAULT_PREFS;
    }
  } catch (err) {
    console.error('[FCM] Error getting preferences:', err);
  }
  
  return DEFAULT_PREFS;
};

/**
 * Set notification preferences
 */
const setPreferences = async (prefs) => {
  if (!auth.currentUser || !db) return;
  
  try {
    const uid = auth.currentUser.uid;
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      notificationPrefs: prefs,
      updatedAt: serverTimestamp()
    });
    
    console.log('[FCM] Preferences saved');
  } catch (err) {
    console.error('[FCM] Error saving preferences:', err);
  }
};

/**
 * Render notification settings panel
 */
const renderSettingsPanel = async (containerId) => {
  const container = document.getElementById(containerId);
  if (!container) {
    console.warn('[FCM] Container not found:', containerId);
    return;
  }
  
  if (!auth.currentUser) {
    container.innerHTML = '<p style="color: var(--m);">Please log in to manage notifications</p>';
    return;
  }
  
  const prefs = await getPreferences();
  
  const html = `
    <div class="notification-settings-panel">
      <style>
        .notification-settings-panel {
          background: var(--s);
          border: 1px solid var(--br);
          border-radius: 4px;
          padding: 1.5rem;
          max-width: 500px;
        }
        .notification-settings-panel h3 {
          margin: 0 0 1.5rem 0;
          font-size: 1.1rem;
          color: var(--t);
          font-weight: 600;
        }
        .pref-group {
          margin-bottom: 1.5rem;
          padding-bottom: 1.5rem;
          border-bottom: 1px solid var(--br);
        }
        .pref-group:last-child {
          border-bottom: none;
          margin-bottom: 0;
          padding-bottom: 0;
        }
        .pref-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.5rem;
        }
        .pref-label {
          font-weight: 500;
          color: var(--t);
          user-select: none;
        }
        .toggle-switch {
          position: relative;
          display: inline-block;
          width: 48px;
          height: 26px;
        }
        .toggle-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .toggle-slider {
          position: absolute;
          cursor: pointer;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: var(--m);
          transition: 0.3s;
          border-radius: 26px;
        }
        .toggle-slider:before {
          position: absolute;
          content: "";
          height: 20px;
          width: 20px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: 0.3s;
          border-radius: 50%;
        }
        input:checked + .toggle-slider {
          background-color: var(--orange);
        }
        input:checked + .toggle-slider:before {
          transform: translateX(22px);
        }
        .pref-description {
          font-size: 0.85rem;
          color: var(--m);
          margin: 0;
        }
        .save-button {
          background: var(--orange);
          color: white;
          border: none;
          padding: 0.75rem 1.5rem;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          margin-top: 1.5rem;
          width: 100%;
          transition: opacity 0.2s;
        }
        .save-button:hover {
          opacity: 0.9;
        }
      </style>
      
      <h3>Notification Preferences</h3>
      
      ${Object.keys(DEFAULT_PREFS).map(key => `
        <div class="pref-group">
          <div class="pref-header">
            <label class="pref-label" for="pref-${key}">
              ${PREF_LABELS[key] || key}
            </label>
            <label class="toggle-switch">
              <input 
                type="checkbox" 
                id="pref-${key}" 
                data-pref-key="${key}"
                ${prefs[key] ? 'checked' : ''}
              >
              <span class="toggle-slider"></span>
            </label>
          </div>
          <p class="pref-description">${PREF_DESCRIPTIONS[key] || ''}</p>
        </div>
      `).join('')}
      
      <button class="save-button" id="save-prefs-btn">Save Preferences</button>
    </div>
  `;
  
  container.innerHTML = html;
  
  // Set up save button
  const saveBtn = container.querySelector('#save-prefs-btn');
  saveBtn.addEventListener('click', async () => {
    const newPrefs = {};
    container.querySelectorAll('[data-pref-key]').forEach(input => {
      newPrefs[input.dataset.prefKey] = input.checked;
    });
    
    await setPreferences(newPrefs);
    showToast('Preferences Saved', 'Your notification settings have been updated', 'success', 3000);
  });
};

/**
 * Helper: Hash token for storage
 */
const hashToken = (token) => {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const char = token.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
};

/**
 * Helper: Get device info
 */
const getDeviceInfo = () => {
  const ua = navigator.userAgent;
  const browser = ua.includes('Chrome') ? 'Chrome' 
               : ua.includes('Firefox') ? 'Firefox'
               : ua.includes('Safari') ? 'Safari'
               : ua.includes('Edge') ? 'Edge'
               : 'Unknown';
  
  const os = ua.includes('Windows') ? 'Windows'
          : ua.includes('Mac') ? 'macOS'
          : ua.includes('Linux') ? 'Linux'
          : ua.includes('Android') ? 'Android'
          : ua.includes('iPhone') ? 'iOS'
          : 'Unknown';
  
  return {
    browser,
    os,
    timestamp: new Date().toISOString()
  };
};

/**
 * Helper: Show toast notification
 */
const showToast = (title, body, type = 'info', duration = 5000) => {
  if (window.showToast && typeof window.showToast === 'function') {
    window.showToast(title + ': ' + body);
  } else {
    console.log('[Toast]', title, body);
  }
};

/**
 * Export module API
 */
export const PushNotifications = {
  init,
  requestPermission,
  getToken: getTokenValue,
  getPreferences,
  setPreferences,
  renderSettingsPanel
};

// Expose globally
window.PushNotifications = PushNotifications;
