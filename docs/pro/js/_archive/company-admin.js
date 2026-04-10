/**
 * NBD Pro CRM - Company Admin Module
 * Handles multi-tenant company management, branding, and configuration
 */

const CompanyAdmin = (() => {
  // Internal cache for company configs
  let _companyCache = {};
  let _currentCompanyId = null;

  /**
   * Retrieves company configuration from Firestore
   * @param {string} companyId - The company ID
   * @returns {Promise<Object>} Company configuration object
   */
  const getCompanyConfig = async (companyId) => {
    // Check cache first
    if (_companyCache[companyId]) {
      console.log(`📦 Company config loaded from cache: ${companyId}`);
      return _companyCache[companyId];
    }

    try {
      // Query Firestore for company document
      const docRef = db.collection('companies').doc(companyId);
      const docSnapshot = await docRef.get();

      if (!docSnapshot.exists) {
        console.warn(`⚠️  Company not found: ${companyId}`);
        return null;
      }

      const config = docSnapshot.data();
      _companyCache[companyId] = config;
      
      console.log(`✅ Company config loaded from Firestore: ${config.name}`);
      return config;
    } catch (error) {
      console.error(`❌ Error loading company config for ${companyId}:`, error);
      return null;
    }
  };

  /**
   * Applies company branding to the CRM dashboard
   * @param {Object} config - Company configuration object
   * @returns {void}
   */
  const applyBranding = (config) => {
    if (!config) {
      console.warn('⚠️  No company config provided for branding');
      return;
    }

    try {
      // Store current company globally
      _currentCompanyId = config.id;
      window._companyId = config.id;
      window._companyConfig = config;

      // Apply company name to page title and header
      if (config.name) {
        const titleElement = document.querySelector('title');
        if (titleElement) {
          titleElement.textContent = `${config.name} - NBD Pro CRM`;
        }
        
        // Update company name in nav/header if it exists
        const companyNameElements = document.querySelectorAll('[data-company-name]');
        companyNameElements.forEach(el => {
          el.textContent = config.name;
        });
      }

      // Apply company colors
      if (config.colors) {
        const root = document.documentElement;
        
        if (config.colors.primary) {
          root.style.setProperty('--company-primary', config.colors.primary);
          // Update specific color targets
          const primaryElements = document.querySelectorAll('[data-color-primary]');
          primaryElements.forEach(el => {
            el.style.color = config.colors.primary;
          });
        }

        if (config.colors.accent) {
          root.style.setProperty('--company-accent', config.colors.accent);
          const accentElements = document.querySelectorAll('[data-color-accent]');
          accentElements.forEach(el => {
            el.style.color = config.colors.accent;
          });
        }

        if (config.colors.navBg) {
          root.style.setProperty('--company-nav-bg', config.colors.navBg);
          const nav = document.querySelector('nav, [data-nav]');
          if (nav) {
            nav.style.backgroundColor = config.colors.navBg;
          }
        }
      }

      // Apply company logo
      if (config.logo) {
        const logoElements = document.querySelectorAll('[data-company-logo]');
        logoElements.forEach(el => {
          if (el.tagName === 'IMG') {
            el.src = config.logo;
          } else {
            el.style.backgroundImage = `url(${config.logo})`;
          }
        });
      }

      console.log(`✅ Branding applied for ${config.name}`);
    } catch (error) {
      console.error('❌ Error applying branding:', error);
    }
  };

  /**
   * Gets the current user's company information
   * Reads from the authenticated user's document
   * @returns {Promise<Object>} Current company config
   */
  const getCurrentCompany = async () => {
    try {
      // Get current user
      const user = firebase.auth().currentUser;
      if (!user) {
        console.warn('⚠️  No authenticated user');
        return null;
      }

      // Read user document to get companyId
      const userRef = db.collection('users').doc(user.uid);
      const userSnapshot = await userRef.get();

      if (!userSnapshot.exists) {
        console.warn(`⚠️  User document not found: ${user.uid}`);
        return null;
      }

      const userData = userSnapshot.data();
      const companyId = userData.companyId || 'nbd';

      // Load and apply company config
      const companyConfig = await getCompanyConfig(companyId);
      if (companyConfig) {
        applyBranding(companyConfig);
      }

      console.log(`✅ Current company loaded: ${companyId}`);
      return companyConfig;
    } catch (error) {
      console.error('❌ Error getting current company:', error);
      return null;
    }
  };

  /**
   * Gets the currently active company ID
   * @returns {string} Company ID
   */
  const getCompanyId = () => {
    return _currentCompanyId || window._companyId || 'nbd';
  };

  /**
   * Sets the company branding context globally
   * @param {string} companyId - Company ID to set as current
   * @returns {Promise<void>}
   */
  const setCurrentCompany = async (companyId) => {
    const config = await getCompanyConfig(companyId);
    if (config) {
      applyBranding(config);
    }
  };

  // Public API
  return {
    getCompanyConfig,
    applyBranding,
    getCurrentCompany,
    getCompanyId,
    setCurrentCompany
  };
})();

// Ensure module is loaded
console.log('✅ Company Admin module loaded');
