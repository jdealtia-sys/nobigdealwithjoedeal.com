/**
 * Company Admin Module - Usage Examples
 * 
 * This file demonstrates how to use the CompanyAdmin module
 * in your NBD Pro CRM application.
 */

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE 1: Load and Apply Branding on Page Load
// ═══════════════════════════════════════════════════════════════════

firebase.auth().onAuthStateChanged(async (user) => {
  if (user) {
    console.log('✅ User authenticated:', user.email);
    
    // Load current company and apply branding
    const currentCompany = await CompanyAdmin.getCurrentCompany();
    
    if (currentCompany) {
      console.log(`📦 Company loaded: ${currentCompany.name}`);
      console.log(`   Owner: ${currentCompany.owner}`);
      console.log(`   Services: ${currentCompany.services.length}`);
    } else {
      console.warn('⚠️  Failed to load company config');
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE 2: Get Company ID for API Calls
// ═══════════════════════════════════════════════════════════════════

async function createNewLead(leadData) {
  const companyId = CompanyAdmin.getCompanyId();
  
  // Add company ID to lead data
  const leadWithCompany = {
    ...leadData,
    companyId: companyId
  };
  
  // Send to Cloud Function
  const createLead = firebase.functions().httpsCallable('createLead');
  const result = await createLead(leadWithCompany);
  
  console.log(`✅ Lead created for company: ${companyId}`);
  return result.data;
}

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE 3: Access Company Configuration
// ═══════════════════════════════════════════════════════════════════

async function displayCompanyInfo() {
  const companyId = CompanyAdmin.getCompanyId();
  const config = await CompanyAdmin.getCompanyConfig(companyId);
  
  if (config) {
    // Build UI with company info
    const html = `
      <div class="company-info">
        <h2>${config.name}</h2>
        <p><strong>Owner:</strong> ${config.owner}</p>
        <p><strong>Phone:</strong> ${config.phone}</p>
        <p><strong>Email:</strong> ${config.email}</p>
        <p><strong>Address:</strong> ${config.address}</p>
        
        <h3>Services Offered:</h3>
        <ul>
          ${config.services.map(service => `<li>${service}</li>`).join('')}
        </ul>
        
        <h3>Service Areas:</h3>
        <ul>
          ${config.serviceAreas.map(area => `<li>${area}</li>`).join('')}
        </ul>
        
        <p><strong>Warranty:</strong> ${config.warranty}</p>
      </div>
    `;
    
    document.getElementById('company-details').innerHTML = html;
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE 4: Populate Service Dropdown from Company Config
// ═══════════════════════════════════════════════════════════════════

async function populateServiceDropdown() {
  const companyId = CompanyAdmin.getCompanyId();
  const config = await CompanyAdmin.getCompanyConfig(companyId);
  
  const dropdown = document.getElementById('service-select');
  
  if (config && config.services) {
    dropdown.innerHTML = '<option value="">Select a service...</option>';
    
    config.services.forEach(service => {
      const option = document.createElement('option');
      option.value = service;
      option.textContent = service;
      dropdown.appendChild(option);
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE 5: Send Notification with Company Contact Info
// ═══════════════════════════════════════════════════════════════════

async function notifyNewLead(leadData) {
  const companyId = CompanyAdmin.getCompanyId();
  
  // Get company config to access owner contact
  const config = await CompanyAdmin.getCompanyConfig(companyId);
  
  if (config) {
    // Call notification function with company ID
    const notifyLead = firebase.functions().httpsCallable('notifyNewLead');
    
    const result = await notifyLead({
      ...leadData,
      companyId: companyId
    });
    
    console.log(`✅ Notification sent to ${config.owner} (${config.email})`);
    return result.data;
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE 6: Admin Function - Switch Company Context
// ═══════════════════════════════════════════════════════════════════

async function adminSwitchCompany(newCompanyId) {
  // This might be in an admin panel
  console.log(`🔄 Switching company context to: ${newCompanyId}`);
  
  await CompanyAdmin.setCurrentCompany(newCompanyId);
  
  // Reload relevant UI components
  location.reload(); // Or update specific sections
}

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE 7: Filter Data by Company
// ═══════════════════════════════════════════════════════════════════

async function loadCompanyLeads() {
  const companyId = CompanyAdmin.getCompanyId();
  
  try {
    const leadsRef = db.collection('leads');
    const query = leadsRef
      .where('companyId', '==', companyId)
      .where('status', '==', 'new')
      .orderBy('createdAt', 'desc')
      .limit(50);
    
    const snapshot = await query.get();
    const leads = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    console.log(`✅ Loaded ${leads.length} new leads for ${companyId}`);
    return leads;
  } catch (error) {
    console.error('❌ Error loading leads:', error);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE 8: Custom Branding Based on Company Colors
// ═══════════════════════════════════════════════════════════════════

async function applyCustomTheme() {
  const companyId = CompanyAdmin.getCompanyId();
  const config = await CompanyAdmin.getCompanyConfig(companyId);
  
  if (config && config.colors) {
    const root = document.documentElement;
    
    // Set CSS custom properties for company colors
    root.style.setProperty('--brand-primary', config.colors.primary);
    root.style.setProperty('--brand-accent', config.colors.accent);
    root.style.setProperty('--brand-nav-bg', config.colors.navBg);
    
    // Apply to specific elements
    const buttons = document.querySelectorAll('.btn-primary');
    buttons.forEach(btn => {
      btn.style.backgroundColor = config.colors.primary;
    });
    
    const nav = document.querySelector('nav');
    if (nav) {
      nav.style.backgroundColor = config.colors.navBg;
    }
    
    console.log(`✅ Applied theme colors for ${config.name}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE 9: Estimate Form Initialization
// ═══════════════════════════════════════════════════════════════════

class EstimateForm {
  constructor(formElementId) {
    this.form = document.getElementById(formElementId);
    this.companyId = CompanyAdmin.getCompanyId();
    this.init();
  }
  
  async init() {
    // Load company services
    const config = await CompanyAdmin.getCompanyConfig(this.companyId);
    
    if (config) {
      this.populateServices(config.services);
      this.setDefaultWarranty(config.warranty);
    }
    
    // Attach submit handler
    this.form.addEventListener('submit', (e) => this.handleSubmit(e));
  }
  
  populateServices(services) {
    const select = this.form.querySelector('select[name="service"]');
    select.innerHTML = '<option value="">Select service...</option>';
    
    services.forEach(service => {
      const option = document.createElement('option');
      option.value = service;
      option.textContent = service;
      select.appendChild(option);
    });
  }
  
  setDefaultWarranty(warranty) {
    const warrantyField = this.form.querySelector('input[name="warranty"]');
    if (warrantyField) {
      warrantyField.value = warranty;
    }
  }
  
  async handleSubmit(e) {
    e.preventDefault();
    
    const formData = new FormData(this.form);
    const estimate = {
      companyId: this.companyId,
      ...Object.fromEntries(formData)
    };
    
    console.log('📤 Submitting estimate:', estimate);
    // Send to backend
  }
}

// Usage:
// const estimateForm = new EstimateForm('new-estimate-form');

// ═══════════════════════════════════════════════════════════════════
// EXAMPLE 10: Dashboard Initialization
// ═══════════════════════════════════════════════════════════════════

class Dashboard {
  constructor() {
    this.companyId = null;
    this.companyConfig = null;
  }
  
  async init() {
    // 1. Get company ID
    this.companyId = CompanyAdmin.getCompanyId();
    console.log(`🏢 Initializing dashboard for company: ${this.companyId}`);
    
    // 2. Load company config
    this.companyConfig = await CompanyAdmin.getCompanyConfig(this.companyId);
    
    // 3. Apply branding
    if (this.companyConfig) {
      this.applyBranding();
    }
    
    // 4. Load company data
    await this.loadData();
    
    // 5. Setup event listeners
    this.setupEventListeners();
    
    console.log('✅ Dashboard initialized');
  }
  
  applyBranding() {
    document.title = `${this.companyConfig.name} - NBD Pro CRM`;
    
    const logo = document.querySelector('img.logo');
    if (logo && this.companyConfig.logo) {
      logo.src = this.companyConfig.logo;
    }
    
    const nav = document.querySelector('nav');
    if (nav && this.companyConfig.colors.navBg) {
      nav.style.backgroundColor = this.companyConfig.colors.navBg;
    }
  }
  
  async loadData() {
    const [leads, estimates, invoices] = await Promise.all([
      this.loadLeads(),
      this.loadEstimates(),
      this.loadInvoices()
    ]);
    
    this.renderLeads(leads);
    this.renderEstimates(estimates);
    this.renderInvoices(invoices);
  }
  
  async loadLeads() {
    // Query leads by company
    const query = db.collection('leads')
      .where('companyId', '==', this.companyId)
      .orderBy('createdAt', 'desc')
      .limit(20);
    
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
  
  async loadEstimates() {
    const query = db.collection('estimates')
      .where('companyId', '==', this.companyId)
      .orderBy('createdAt', 'desc')
      .limit(20);
    
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
  
  async loadInvoices() {
    const query = db.collection('invoices')
      .where('companyId', '==', this.companyId)
      .orderBy('createdAt', 'desc')
      .limit(20);
    
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
  
  renderLeads(leads) {
    // Render leads data
    console.log(`📊 Rendering ${leads.length} leads`);
  }
  
  renderEstimates(estimates) {
    console.log(`📊 Rendering ${estimates.length} estimates`);
  }
  
  renderInvoices(invoices) {
    console.log(`📊 Rendering ${invoices.length} invoices`);
  }
  
  setupEventListeners() {
    // Setup button handlers, etc.
  }
}

// Initialize on page load:
// document.addEventListener('DOMContentLoaded', () => {
//   const dashboard = new Dashboard();
//   dashboard.init();
// });
