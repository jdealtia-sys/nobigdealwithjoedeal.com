/**
 * NBD Auth Enhancement - Company ID Integration
 * This code should be integrated into nbd-auth.js
 * Adds multi-tenant company ID support to the authentication system
 */

// After the main NBDAuth module is initialized, add these enhancements:

const NBDAuthCompanyExtension = (() => {
  let _companyId = null;

  /**
   * Initialize company ID after user authentication
   * Called after firebase.auth().currentUser is resolved
   * @returns {Promise<string>} The company ID for the authenticated user
   */
  const initializeCompanyId = async () => {
    try {
      const user = firebase.auth().currentUser;
      
      if (!user) {
        console.log('⚠️  No authenticated user for company ID initialization');
        _companyId = 'nbd'; // Default to NBD
        window._companyId = _companyId;
        return _companyId;
      }

      // Fetch user document from Firestore to get companyId
      const userRef = db.collection('users').doc(user.uid);
      const userSnapshot = await userRef.get();

      if (userSnapshot.exists) {
        const userData = userSnapshot.data();
        _companyId = userData.companyId || 'nbd';
        console.log(`✅ Company ID loaded for user ${user.email}: ${_companyId}`);
      } else {
        console.warn(`⚠️  User document not found for ${user.uid}, defaulting to 'nbd'`);
        _companyId = 'nbd';
      }

      // Store globally for other modules to access
      window._companyId = _companyId;
      
      return _companyId;
    } catch (error) {
      console.error('❌ Error initializing company ID:', error);
      _companyId = 'nbd'; // Default on error
      window._companyId = _companyId;
      return _companyId;
    }
  };

  /**
   * Get the current user's company ID
   * @returns {string} Company ID
   */
  const getCompanyId = () => {
    return _companyId || window._companyId || 'nbd';
  };

  /**
   * Set the company ID (for testing or manual assignment)
   * @param {string} companyId - Company ID to set
   * @returns {void}
   */
  const setCompanyId = (companyId) => {
    _companyId = companyId;
    window._companyId = companyId;
    console.log(`✅ Company ID set to: ${companyId}`);
  };

  // Public API
  return {
    initializeCompanyId,
    getCompanyId,
    setCompanyId
  };
})();

// Merge company extension into NBDAuth
if (typeof NBDAuth !== 'undefined' && NBDAuth) {
  NBDAuth.initializeCompanyId = NBDAuthCompanyExtension.initializeCompanyId;
  NBDAuth.getCompanyId = NBDAuthCompanyExtension.getCompanyId;
  NBDAuth.setCompanyId = NBDAuthCompanyExtension.setCompanyId;
  console.log('✅ Company ID extension integrated into NBDAuth');
}

// Alternative: If NBDAuth needs to be called after auth state changes
if (typeof firebase !== 'undefined') {
  firebase.auth().onAuthStateChanged(async (user) => {
    if (user && typeof NBDAuthCompanyExtension !== 'undefined') {
      await NBDAuthCompanyExtension.initializeCompanyId();
    }
  });
}
