/**
 * NBD Verify Functions - Company Multi-Tenant Enhancement
 * 
 * This enhancement adds companyId support to the notifyNewLead function
 * in verify-functions.js
 * 
 * INTEGRATION INSTRUCTIONS:
 * 1. In verify-functions.js, find the notifyNewLead function (starts around line 210)
 * 2. In the destructuring assignment, add: companyId
 *    OLD: const { name, phone, email, address, service, timeline, verified, requestType } = request.data || {};
 *    NEW: const { name, phone, email, address, service, timeline, verified, requestType, companyId } = request.data || {};
 * 
 * 3. After the input validation (around line 220), add the company lookup code below
 */

// ═══════════════════════════════════════════════════════════════════
// COMPANY-AWARE NOTIFICATION LOGIC
// Add this code after input validation in notifyNewLead
// ═══════════════════════════════════════════════════════════════════

// Helper function: Get company config for notifications
const getCompanyForNotification = async (db, companyId) => {
  try {
    if (!companyId) {
      console.log('⚠️  No companyId provided, using default Joe contact info');
      return null;
    }

    const docRef = db.collection('companies').doc(companyId);
    const docSnapshot = await docRef.get();

    if (!docSnapshot.exists) {
      console.warn(`⚠️  Company not found: ${companyId}, using default Joe contact info`);
      return null;
    }

    const companyData = docSnapshot.data();
    console.log(`✅ Company config loaded for notifications: ${companyData.name}`);
    
    return {
      name: companyData.name,
      owner: companyData.owner,
      phone: companyData.phone,
      email: companyData.email
    };
  } catch (error) {
    console.error(`❌ Error loading company config: ${error.message}`);
    return null;
  }
};

// ═══════════════════════════════════════════════════════════════════
// INTEGRATION POINT IN notifyNewLead:
// After "if (!name || !phone) { ... }" block, add this:
// ═══════════════════════════════════════════════════════════════════

/*
  // Get company config for notifications
  let notificationPhone = JOE_PHONE.value();
  let notificationEmail = JOE_EMAIL.value();
  let companyName = 'No Big Deal Home Solutions'; // default
  
  if (companyId) {
    const companyConfig = await getCompanyForNotification(db, companyId);
    if (companyConfig) {
      notificationPhone = companyConfig.phone;
      notificationEmail = companyConfig.email;
      companyName = companyConfig.name;
    }
  }

  // Now use notificationPhone and notificationEmail instead of hardcoded values
  // Replace:
  //   from: TWILIO_PHONE_NUMBER.value(),
  //   to: JOE_PHONE.value(),
  // With:
  //   from: TWILIO_PHONE_NUMBER.value(),
  //   to: notificationPhone,
  //
  // And replace:
  //   to: JOE_EMAIL
  // With:
  //   to: notificationEmail
*/

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE: Updated notifyNewLead function signature
// ═══════════════════════════════════════════════════════════════════

/*
exports.notifyNewLead = functions.https.onCall(
  {
    secrets: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'RESEND_API_KEY', 'EMAIL_FROM'],
    maxInstances: 10,
    timeoutSeconds: 30,
    memory: '256MiB',
  },
  async (request) => {
    // Extract companyId from request
    const { 
      name, phone, email, address, service, timeline, verified, requestType, companyId 
    } = request.data || {};

    // ... existing input validation ...

    // NEW: Get company config for notifications
    let notificationPhone = JOE_PHONE.value();
    let notificationEmail = JOE_EMAIL.value();
    let notifyingCompany = 'No Big Deal Home Solutions';
    
    if (companyId) {
      const companyConfig = await getCompanyForNotification(db, companyId);
      if (companyConfig) {
        notificationPhone = companyConfig.phone;
        notificationEmail = companyConfig.email;
        notifyingCompany = companyConfig.name;
      }
    }

    // ... rest of function, using notificationPhone and notificationEmail ...
  }
);
*/

module.exports = {
  getCompanyForNotification
};
