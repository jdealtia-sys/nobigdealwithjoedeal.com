/**
 * Firebase Cloud Functions — Push Notification System
 * =====================================================
 * Sends push notifications via FCM for various events:
 * - New leads assigned
 * - Appointment reminders (15-min before)
 * - Follow-up due reminders (daily)
 * - Claim stage changes
 *
 * SETUP:
 *   1. In functions/index.js, import and spread this:
 *      const pushFunctions = require('./push-functions');
 *      module.exports = { ...pushFunctions, ...otherFunctions };
 *
 * FIRESTORE SCHEMA EXPECTATIONS:
 *   - users/{uid}/notificationPrefs { newLead, appointmentReminder, followUpDue, claimUpdate, teamActivity, d2dStreak }
 *   - users/{uid}/fcmTokens/{tokenHash} { token, device, createdAt, lastActive }
 *   - leads/{leadId} { assignedTo, claim_stage, createdAt, d2dKnocks: [], ... }
 *   - leads/{leadId}/appointments/{apptId} { startTime, title, ... }
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

const db = admin.firestore();
const messaging = admin.messaging();

// ══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ══════════════════════════════════════════════════════════════

/**
 * Check if user has enabled this notification category
 */
async function isNotificationEnabled(uid, category) {
  try {
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) return true; // Default to enabled
    
    const prefs = userDoc.data().notificationPrefs || {};
    return prefs[category] !== false;
  } catch (err) {
    console.error('[Push] Error checking notification preference:', err);
    return true; // Default to enabled on error
  }
}

/**
 * Get all FCM tokens for a user from Firestore
 */
async function getUserFCMTokens(uid) {
  try {
    const tokensRef = db.collection('users').doc(uid).collection('fcmTokens');
    const tokensSnap = await tokensRef.get();
    
    const tokens = [];
    const invalidTokens = [];
    
    tokensSnap.forEach(doc => {
      const tokenData = doc.data();
      if (tokenData.token) {
        tokens.push({
          token: tokenData.token,
          docId: doc.id,
          lastActive: tokenData.lastActive
        });
      }
    });
    
    return { tokens, invalidTokens };
  } catch (err) {
    console.error('[Push] Error getting FCM tokens:', err);
    return { tokens: [], invalidTokens: [] };
  }
}

/**
 * Send push notification to a user via all their FCM tokens
 * Handles token cleanup for invalid tokens
 */
async function sendPushNotification(uid, title, body, data = {}) {
  if (!uid || !title || !body) {
    console.warn('[Push] Missing required parameters');
    return { sent: 0, failed: 0, errors: [] };
  }
  
  try {
    const { tokens } = await getUserFCMTokens(uid);
    
    if (tokens.length === 0) {
      console.log('[Push] No FCM tokens for user:', uid);
      return { sent: 0, failed: 0, errors: [] };
    }
    
    // Build multicast message
    const message = {
      notification: {
        title: title,
        body: body
      },
      data: {
        ...data,
        sentAt: new Date().toISOString(),
        uid: uid
      },
      webpush: {
        notification: {
          title: title,
          body: body,
          icon: 'https://nobigdeal-pro.web.app/pro/images/icon-192x192.png',
          badge: 'https://nobigdeal-pro.web.app/pro/images/badge-72x72.png',
          tag: data.notificationId || 'nbd-notification',
          requireInteraction: data.requireInteraction === 'true'
        },
        data: {
          ...data,
          clickUrl: data.clickUrl || '/pro/dashboard.html'
        }
      }
    };
    
    // Send to all tokens
    const tokensList = tokens.map(t => t.token);
    const response = await messaging.sendEachForMulticast({
      tokens: tokensList,
      ...message
    });
    
    // Log results
    console.log('[Push] Sent:', response.successCount, 'Failed:', response.failureCount);
    
    // Handle failures and clean up invalid tokens
    const failureErrors = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        failureErrors.push(resp.error.message);
        
        // Remove invalid tokens
        const token = tokens[idx];
        if (resp.error.code === 'messaging/invalid-registration-token' ||
            resp.error.code === 'messaging/registration-token-not-registered') {
          
          const userRef = db.collection('users').doc(uid);
          userRef.collection('fcmTokens').doc(token.docId).delete()
            .catch(err => console.error('[Push] Error deleting token:', err));
        }
      }
    });
    
    return {
      sent: response.successCount,
      failed: response.failureCount,
      errors: failureErrors
    };
  } catch (err) {
    console.error('[Push] Error sending notification:', err);
    return { sent: 0, failed: 0, errors: [err.message] };
  }
}

/**
 * Log notification sent for analytics
 */
async function logNotificationSent(uid, notificationType, details = {}) {
  try {
    const logsRef = db.collection('users').doc(uid).collection('notificationLogs');
    await logsRef.add({
      type: notificationType,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      details: details,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Push] Error logging notification:', err);
  }
}

// ══════════════════════════════════════════════════════════════
// CLOUD FUNCTIONS
// ══════════════════════════════════════════════════════════════

/**
 * TRIGGER: New lead created
 * ACTION: Send notification to assigned rep
 */
exports.onNewLead = onDocumentCreated('leads/{leadId}', async (event) => {
  const leadData = event.data.data();
  const leadId = event.params.leadId;
  
  if (!leadData || !leadData.assignedTo) {
    console.log('[Push] No assigned rep for lead:', leadId);
    return;
  }
  
  const uid = leadData.assignedTo;
  
  // Check if notifications enabled
  const enabled = await isNotificationEnabled(uid, 'newLead');
  if (!enabled) {
    console.log('[Push] New lead notifications disabled for user:', uid);
    return;
  }
  
  const title = 'New Lead Assigned';
  const body = `${leadData.name || 'A new lead'} in ${leadData.address || 'your area'} has been assigned to you.`;
  
  const result = await sendPushNotification(uid, title, body, {
    type: 'newLead',
    leadId: leadId,
    name: leadData.name,
    address: leadData.address,
    clickUrl: `/pro/dashboard.html?tab=leads&leadId=${leadId}`,
    notificationId: `lead-${leadId}`,
    requireInteraction: 'true'
  });
  
  if (result.sent > 0) {
    await logNotificationSent(uid, 'newLead', { leadId, sent: result.sent });
  }
});

/**
 * TRIGGER: Appointment time updated
 * ACTION: Send reminder 30 minutes before
 */
exports.onAppointmentReminder = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'America/Chicago'
  },
  async (context) => {
    const now = new Date();
    const in30min = new Date(now.getTime() + 30 * 60 * 1000);
    
    console.log('[Push] Checking for appointments between', now, 'and', in30min);
    
    try {
      // Find all leads with appointments in the next 30 minutes
      const leadsRef = db.collection('leads');
      const leadsSnap = await leadsRef.get();
      
      const sendPromises = [];
      
      leadsSnap.forEach(leadDoc => {
        const leadData = leadDoc.data();
        const leadId = leadDoc.id;
        
        if (!leadData.assignedTo) return;
        
        // Check for appointments
        if (leadData.appointments && Array.isArray(leadData.appointments)) {
          leadData.appointments.forEach(appt => {
            if (!appt.startTime) return;
            
            const apptTime = new Date(appt.startTime);
            
            // Send reminder if appointment is in next 30 minutes
            if (apptTime > now && apptTime <= in30min) {
              sendPromises.push(
                (async () => {
                  const uid = leadData.assignedTo;
                  const enabled = await isNotificationEnabled(uid, 'appointmentReminder');
                  
                  if (!enabled) return;
                  
                  const title = 'Appointment Reminder';
                  const body = `${leadData.name || 'Your appointment'} starts in 30 minutes`;
                  
                  const result = await sendPushNotification(uid, title, body, {
                    type: 'appointmentReminder',
                    leadId: leadId,
                    appointmentId: appt.id || appt.title,
                    appointmentTitle: appt.title,
                    clickUrl: `/pro/dashboard.html?tab=calendar&leadId=${leadId}`,
                    notificationId: `appt-${leadId}-${appt.title}`,
                    requireInteraction: 'true'
                  });
                  
                  if (result.sent > 0) {
                    await logNotificationSent(uid, 'appointmentReminder', { leadId });
                  }
                })()
              );
            }
          });
        }
      });
      
      await Promise.all(sendPromises);
      console.log('[Push] Appointment reminder check complete');
      
    } catch (err) {
      console.error('[Push] Error checking appointments:', err);
    }
  }
);

/**
 * TRIGGER: Daily follow-up reminder
 * ACTION: Send reminder for D2D knocks with autoFollowUp date = today
 */
exports.onFollowUpDue = onSchedule(
  {
    schedule: 'every day 08:00',
    timeZone: 'America/Chicago'
  },
  async (context) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    console.log('[Push] Checking for follow-ups due on:', today.toDateString());
    
    try {
      const leadsRef = db.collection('leads');
      const leadsSnap = await leadsRef.get();
      
      const sendPromises = [];
      
      leadsSnap.forEach(leadDoc => {
        const leadData = leadDoc.data();
        const leadId = leadDoc.id;
        
        if (!leadData.assignedTo) return;
        if (!leadData.d2dKnocks || !Array.isArray(leadData.d2dKnocks)) return;
        
        // Check for knockswith auto follow-up due today
        leadData.d2dKnocks.forEach((knock, idx) => {
          if (!knock.autoFollowUp) return;
          
          const followUpDate = new Date(knock.autoFollowUp);
          followUpDate.setHours(0, 0, 0, 0);
          
          if (followUpDate.getTime() === today.getTime()) {
            sendPromises.push(
              (async () => {
                const uid = leadData.assignedTo;
                const enabled = await isNotificationEnabled(uid, 'followUpDue');
                
                if (!enabled) return;
                
                const title = 'Follow-Up Due Today';
                const body = `${leadData.name || 'A lead'} has a follow-up due today`;
                
                const result = await sendPushNotification(uid, title, body, {
                  type: 'followUpDue',
                  leadId: leadId,
                  followUpId: `knock-${idx}`,
                  name: leadData.name,
                  clickUrl: `/pro/dashboard.html?tab=d2d&leadId=${leadId}`,
                  notificationId: `followup-${leadId}`
                });
                
                if (result.sent > 0) {
                  await logNotificationSent(uid, 'followUpDue', { leadId });
                }
              })()
            );
          }
        });
      });
      
      await Promise.all(sendPromises);
      console.log('[Push] Follow-up reminder check complete');
      
    } catch (err) {
      console.error('[Push] Error checking follow-ups:', err);
    }
  }
);

/**
 * TRIGGER: Claim stage changes
 * ACTION: Send notification to rep about stage update
 */
exports.onClaimStageChange = onDocumentUpdated('leads/{leadId}', async (event) => {
  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();
  const leadId = event.params.leadId;
  
  // Check if claim_stage changed
  if (beforeData.claim_stage === afterData.claim_stage) {
    return;
  }
  
  const uid = afterData.assignedTo;
  if (!uid) return;
  
  const enabled = await isNotificationEnabled(uid, 'claimUpdate');
  if (!enabled) {
    console.log('[Push] Claim update notifications disabled for user:', uid);
    return;
  }
  
  const title = 'Claim Status Update';
  const newStage = afterData.claim_stage || 'Unknown';
  const body = `Claim for ${afterData.name || 'your lead'} moved to: ${newStage}`;
  
  const result = await sendPushNotification(uid, title, body, {
    type: 'claimUpdate',
    leadId: leadId,
    newStage: newStage,
    previousStage: beforeData.claim_stage,
    name: afterData.name,
    clickUrl: `/pro/customer.html?leadId=${leadId}`,
    notificationId: `claim-${leadId}`
  });
  
  if (result.sent > 0) {
    await logNotificationSent(uid, 'claimUpdate', { leadId, newStage });
  }
});

/**
 * TRIGGER: Team message or comment
 * ACTION: Broadcast to team members
 * 
 * Note: This would be called manually from your API when a team message is created
 */
exports.sendTeamNotification = async (teamId, title, body, data = {}) => {
  try {
    const teamRef = db.collection('teams').doc(teamId);
    const teamDoc = await teamRef.get();
    
    if (!teamDoc.exists) {
      console.warn('[Push] Team not found:', teamId);
      return [];
    }
    
    const team = teamDoc.data();
    const members = team.members || [];
    
    const sendPromises = members.map(uid =>
      (async () => {
        const enabled = await isNotificationEnabled(uid, 'teamActivity');
        if (!enabled) return { uid, sent: 0 };
        
        const result = await sendPushNotification(uid, title, body, {
          type: 'teamActivity',
          teamId: teamId,
          ...data,
          clickUrl: `/pro/dashboard.html?tab=team`,
          notificationId: `team-${teamId}`
        });
        
        if (result.sent > 0) {
          await logNotificationSent(uid, 'teamActivity', { teamId });
        }
        
        return { uid, sent: result.sent };
      })()
    );
    
    return await Promise.all(sendPromises);
  } catch (err) {
    console.error('[Push] Error sending team notification:', err);
    return [];
  }
};

/**
 * TRIGGER: D2D Streak milestone
 * ACTION: Celebrate with notification
 * 
 * Note: This would be called manually when a streak is reached
 */
exports.sendStreakNotification = async (uid, streakCount) => {
  const enabled = await isNotificationEnabled(uid, 'd2dStreak');
  if (!enabled) return { sent: 0 };
  
  let title, body;
  if (streakCount >= 100) {
    title = '100+ Knock Streak!';
    body = `Amazing work! You've reached ${streakCount} consecutive knocks!`;
  } else if (streakCount >= 50) {
    title = '50+ Knock Streak!';
    body = `Great momentum! ${streakCount} consecutive knocks!`;
  } else if (streakCount >= 10) {
    title = 'Streak Going Strong';
    body = `${streakCount} consecutive knocks - keep it up!`;
  } else {
    title = 'Streak Started!';
    body = `You've started a ${streakCount}-knock streak!`;
  }
  
  const result = await sendPushNotification(uid, title, body, {
    type: 'd2dStreak',
    streakCount: streakCount.toString(),
    clickUrl: `/pro/dashboard.html?tab=d2d`,
    notificationId: `streak-${uid}-${streakCount}`
  });
  
  if (result.sent > 0) {
    await logNotificationSent(uid, 'd2dStreak', { streakCount });
  }
  
  return result;
};

/**
 * TRIGGER: Manual push notification (for admin or custom events)
 * Called via API when you need to send a custom notification
 */
exports.sendCustomNotification = async (uid, title, body, data = {}) => {
  const result = await sendPushNotification(uid, title, body, data);
  
  if (result.sent > 0) {
    await logNotificationSent(uid, 'custom', { title, body });
  }
  
  return result;
};

module.exports = {
  onNewLead: exports.onNewLead,
  onAppointmentReminder: exports.onAppointmentReminder,
  onFollowUpDue: exports.onFollowUpDue,
  onClaimStageChange: exports.onClaimStageChange,
  sendTeamNotification: exports.sendTeamNotification,
  sendStreakNotification: exports.sendStreakNotification,
  sendCustomNotification: exports.sendCustomNotification,
  sendPushNotification: exports.sendPushNotification,
  getUserFCMTokens: exports.getUserFCMTokens
};
