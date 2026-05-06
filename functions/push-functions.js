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
const { logger } = require('firebase-functions/v2');
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
    logger.error('[Push] Error checking notification preference:', err);
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
    logger.error('[Push] Error getting FCM tokens:', err);
    return { tokens: [], invalidTokens: [] };
  }
}

/**
 * Send push notification to a user via all their FCM tokens
 * Handles token cleanup for invalid tokens
 */
async function sendPushNotification(uid, title, body, data = {}) {
  if (!uid || !title || !body) {
    logger.warn('[Push] Missing required parameters');
    return { sent: 0, failed: 0, errors: [] };
  }
  
  try {
    const { tokens } = await getUserFCMTokens(uid);
    
    if (tokens.length === 0) {
      logger.info('[Push] No FCM tokens for user:', uid);
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
    logger.info('[Push] Sent:', response.successCount, 'Failed:', response.failureCount);
    
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
            .catch(err => logger.error('push_delete_token_failed', { err: err.message }));
        }
      }
    });
    
    return {
      sent: response.successCount,
      failed: response.failureCount,
      errors: failureErrors
    };
  } catch (err) {
    logger.error('[Push] Error sending notification:', err);
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
    logger.error('[Push] Error logging notification:', err);
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
    logger.info('[Push] No assigned rep for lead:', leadId);
    return;
  }
  
  const uid = leadData.assignedTo;
  
  // Check if notifications enabled
  const enabled = await isNotificationEnabled(uid, 'newLead');
  if (!enabled) {
    logger.info('[Push] New lead notifications disabled for user:', uid);
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
    // Wave 104: business is in Cincinnati / Greater Cincinnati area
    // (America/New_York). The schedule fires at the wall-clock time
    // for THIS timezone — Central Time was a wrong default that
    // shifted every reminder by 1 hour. Note: timeZone here only
    // controls when the function fires, NOT what `new Date()` returns
    // inside the handler — that's still UTC server time. The offset
    // math we do below uses absolute timestamps so it's TZ-agnostic.
    timeZone: 'America/New_York'
  },
  async (context) => {
    const now = new Date();
    const in30min = new Date(now.getTime() + 30 * 60 * 1000);

    logger.info('[Push] Checking for appointments between', now, 'and', in30min);

    try {
      // Wave 104: previously did an unbounded leads collection scan
      // every 15 minutes. With 500+ leads that burns Firestore read
      // quota. Now: only fetch leads that have an `appointments`
      // field at all. The ! null filter narrows by orders of
      // magnitude in typical accounts. Inequality filter on a
      // potentially-array field requires Firestore composite index;
      // if the index doesn't exist, this falls back to the full
      // scan with a warning logged.
      const leadsRef = db.collection('leads');
      let leadsSnap;
      try {
        leadsSnap = await leadsRef.where('appointments', '!=', null).get();
      } catch (idxErr) {
        logger.warn('[Push] appointments index missing; fall back to full scan', { msg: idxErr.message });
        leadsSnap = await leadsRef.get();
      }

      const sendPromises = [];
      // Wave 104: idempotency window — if we already sent the same
      // appointment reminder to this user within the last 20 minutes,
      // skip the second send. The notification log was being
      // *written* but never *read* before sending. With a 15-min
      // schedule + 30-min lookahead, a single appointment overlaps
      // multiple ticks and would fire 2-3 times without this check.
      const idempotencyWindowMs = 20 * 60 * 1000;
      const recentlySentSet = new Set(); // (uid|leadId|apptKey) keys

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

                  const apptKey = appt.id || appt.title || appt.startTime;
                  const dedupeKey = `${uid}|${leadId}|${apptKey}`;
                  if (recentlySentSet.has(dedupeKey)) return;

                  // W104: read the notification log to see if we
                  // already sent this same reminder recently.
                  try {
                    const recentLog = await db
                      .collection('users').doc(uid)
                      .collection('notificationLogs')
                      .where('type', '==', 'appointmentReminder')
                      .where('details.leadId', '==', leadId)
                      .where('sentAt', '>',
                        admin.firestore.Timestamp.fromDate(
                          new Date(now.getTime() - idempotencyWindowMs)))
                      .limit(1).get();
                    if (!recentLog.empty) {
                      logger.info('[Push] skip duplicate appt reminder', { uid, leadId });
                      return;
                    }
                  } catch (logErr) {
                    // Index missing or query failed — fall through
                    // to send. Better to risk a duplicate than miss
                    // the reminder entirely.
                    logger.warn('[Push] appt log lookup failed', { msg: logErr.message });
                  }
                  recentlySentSet.add(dedupeKey);

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

      await Promise.allSettled(sendPromises);
      logger.info('[Push] Appointment reminder check complete');

    } catch (err) {
      logger.error('[Push] Error checking appointments:', err);
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
    // W104: Cincinnati = Eastern, not Central. Was scheduling
    // 8 AM Central = 9 AM Eastern, which made the daily reminder
    // fire an hour later than reps expected.
    timeZone: 'America/New_York'
  },
  async (context) => {
    // W104: compute "today" in Eastern Time so the date comparison
    // matches the user's wall-clock view of "today". The handler
    // runs on UTC servers, so `new Date(); setHours(0,0,0,0)`
    // returns UTC midnight — not Eastern midnight. A lead with
    // autoFollowUp = '2026-05-06' (Eastern date) would be missed
    // when the function runs at 08:00 ET = 12:00 UTC because
    // setHours(0) would make 'today' = 2026-05-06T00:00:00 UTC =
    // 2026-05-05 20:00 Eastern. Use Intl.DateTimeFormat to get the
    // Eastern y/m/d, then construct the Eastern midnight from it.
    function easternMidnight() {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric', month: '2-digit', day: '2-digit',
      });
      // 'en-CA' returns 'YYYY-MM-DD' which is what we want.
      const ymd = fmt.format(new Date()); // e.g., '2026-05-06'
      // Construct local-time midnight at server. The exact UTC
      // offset doesn't matter for date-comparison since both
      // sides use the same transform.
      return new Date(ymd + 'T00:00:00');
    }
    const today = easternMidnight();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    logger.info('[Push] Checking for follow-ups due (Eastern) on:', today.toDateString());

    try {
      const leadsRef = db.collection('leads');
      // W104: scope query to leads with d2dKnocks set, narrowing
      // the read footprint. Falls back to full scan if the field
      // index isn't present (typical for new accounts).
      let leadsSnap;
      try {
        leadsSnap = await leadsRef.where('d2dKnocks', '!=', null).get();
      } catch (idxErr) {
        logger.warn('[Push] d2dKnocks index missing; full scan', { msg: idxErr.message });
        leadsSnap = await leadsRef.get();
      }
      
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
      
      await Promise.allSettled(sendPromises);
      logger.info('[Push] Follow-up reminder check complete');
      
    } catch (err) {
      logger.error('[Push] Error checking follow-ups:', err);
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
    logger.info('[Push] Claim update notifications disabled for user:', uid);
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
      logger.warn('[Push] Team not found:', teamId);
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
    
    return await Promise.allSettled(sendPromises);
  } catch (err) {
    logger.error('[Push] Error sending team notification:', err);
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
