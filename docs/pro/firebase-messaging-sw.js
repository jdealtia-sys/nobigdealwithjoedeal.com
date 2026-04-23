/**
 * Firebase Cloud Messaging Service Worker
 * ======================================
 * Handles background push notifications and click events.
 * 
 * This service worker must be registered by your main app with:
 *   navigator.serviceWorkerContainer.register('/pro/firebase-messaging-sw.js', {
 *     scope: '/pro/'
 *   });
 */

// Import Firebase scripts (compatibility version for service workers)
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

// Firebase Configuration (same as in main app)
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDTrotINzl2YjdGbH25BpC-FPv8i_fXNvg",
  authDomain: "nobigdeal-pro.firebaseapp.com",
  projectId: "nobigdeal-pro",
  storageBucket: "nobigdeal-pro.firebasestorage.app",
  messagingSenderId: "717435841570",
  appId: "1:717435841570:web:c2338e11052c96fde02e7b"
};

// Initialize Firebase in the service worker
firebase.initializeApp(FIREBASE_CONFIG);

// Get the messaging instance
const messaging = firebase.messaging();

/**
 * Handle background messages when the app is closed or in the background
 * Customize notification display and appearance
 */
messaging.onBackgroundMessage((payload) => {
  console.log('[FCM-SW] Background message received:', payload);
  
  const { notification, data } = payload;
  const title = notification?.title || 'NBD Pro';
  const body = notification?.body || 'New notification';
  
  // Default notification options
  const notificationOptions = {
    body: body,
    // Audit #22: prior path /pro/images/icon-192x192.png 404'd — real icons
    // live under /pro/img/ with a different naming scheme. A missing icon
    // causes the OS to render a blank/generic bell on Android/iOS PWA.
    icon: '/pro/img/nbd-icon-192.png',
    badge: '/pro/img/nbd-icon-192.png',
    tag: data?.notificationId || 'nbd-notification',
    requireInteraction: data?.requireInteraction === 'true' || false,
    actions: getNotificationActions(data?.type),
    data: {
      ...data,
      clickUrl: getClickUrl(data),
      type: data?.type || 'default'
    },
    dir: 'auto'
  };
  
  // Different styles based on notification type
  switch (data?.type) {
    case 'newLead':
      notificationOptions.tag = 'new-lead';
      break;
    case 'appointmentReminder':
      notificationOptions.tag = 'appointment-reminder';
      notificationOptions.requireInteraction = true;
      break;
    case 'followUpDue':
      notificationOptions.tag = 'follow-up-due';
      break;
    case 'claimUpdate':
      notificationOptions.tag = 'claim-update';
      break;
    case 'teamActivity':
      notificationOptions.tag = 'team-activity';
      break;
    case 'd2dStreak':
      notificationOptions.tag = 'd2d-streak';
      break;
  }
  
  // Show the notification
  self.registration.showNotification(title, notificationOptions);
});

/**
 * Handle notification clicks
 * Navigate to the appropriate page based on notification data
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const { data } = event.notification;
  const clickUrl = data?.clickUrl || '/pro/dashboard.html';
  
  console.log('[FCM-SW] Notification clicked:', data?.type, clickUrl);
  
  // Focus or open the app window
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Check if NBD Pro is already open
        for (let i = 0; i < windowClients.length; i++) {
          const client = windowClients[i];
          if (client.url.includes('/pro/')) {
            // Focus the existing window
            client.focus();
            // Navigate to the appropriate page
            client.navigate(clickUrl);
            return client;
          }
        }
        // If not open, open a new window
        return clients.openWindow(clickUrl);
      })
  );
});

/**
 * Get the URL to navigate to based on notification type and data
 */
function getClickUrl(data = {}) {
  const baseUrl = '/pro/';
  
  switch (data.type) {
    case 'newLead':
      return `${baseUrl}dashboard.html?tab=leads&leadId=${data.leadId || ''}`;
    
    case 'appointmentReminder':
      return `${baseUrl}dashboard.html?tab=calendar&appointmentId=${data.appointmentId || ''}`;
    
    case 'followUpDue':
      return `${baseUrl}dashboard.html?tab=d2d&followUpId=${data.followUpId || ''}`;
    
    case 'claimUpdate':
      return `${baseUrl}customer.html?leadId=${data.leadId || ''}`;
    
    case 'teamActivity':
      return `${baseUrl}dashboard.html?tab=team`;
    
    case 'd2dStreak':
      return `${baseUrl}dashboard.html?tab=d2d`;
    
    default:
      return `${baseUrl}dashboard.html`;
  }
}

/**
 * Get action buttons for notification based on type
 */
function getNotificationActions(type) {
  const commonActions = [
    { action: 'view', title: 'View' }
  ];
  
  switch (type) {
    case 'appointmentReminder':
    case 'followUpDue':
      return [
        ...commonActions,
        { action: 'dismiss', title: 'Dismiss' }
      ];
    
    default:
      return commonActions;
  }
}

/**
 * Service Worker Install Event
 */
self.addEventListener('install', (event) => {
  console.log('[FCM-SW] Service Worker installing...');
  self.skipWaiting();
});

/**
 * Service Worker Activate Event
 */
self.addEventListener('activate', (event) => {
  console.log('[FCM-SW] Service Worker activating...');
  event.waitUntil(clients.claim());
});
