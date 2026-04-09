(function() {
  'use strict';

  // Default roofing material catalog across all suppliers
  const DEFAULT_PRODUCTS = [
    // Shingles
    { sku: 'SHIN-3TAB-BLK-001', name: 'Asphalt Shingles 3-Tab Black', category: 'Shingles', supplier: 'abc_supply', price: 45.99, unit: 'bundle', productUrl: 'https://abcsupply.com' },
    { sku: 'SHIN-3TAB-BLK-002', name: 'Asphalt Shingles 3-Tab Black', category: 'Shingles', supplier: 'lowes', price: 48.50, unit: 'bundle', productUrl: 'https://lowes.com' },
    { sku: 'SHIN-3TAB-BLK-003', name: 'Asphalt Shingles 3-Tab Black', category: 'Shingles', supplier: 'home_depot', price: 52.00, unit: 'bundle', productUrl: 'https://homedepot.com' },
    { sku: 'SHIN-ARCH-GRY-001', name: 'Architectural Shingles Gray', category: 'Shingles', supplier: 'abc_supply', price: 67.50, unit: 'bundle', productUrl: 'https://abcsupply.com' },
    { sku: 'SHIN-ARCH-GRY-002', name: 'Architectural Shingles Gray', category: 'Shingles', supplier: 'lowes', price: 72.99, unit: 'bundle', productUrl: 'https://lowes.com' },
    { sku: 'SHIN-ARCH-GRY-003', name: 'Architectural Shingles Gray', category: 'Shingles', supplier: 'home_depot', price: 75.50, unit: 'bundle', productUrl: 'https://homedepot.com' },
    { sku: 'SHIN-DSGN-BRN-001', name: 'Designer Shingles Brown', category: 'Shingles', supplier: 'abc_supply', price: 89.99, unit: 'bundle', productUrl: 'https://abcsupply.com' },
    { sku: 'SHIN-DSGN-BRN-002', name: 'Designer Shingles Brown', category: 'Shingles', supplier: 'lowes', price: 94.50, unit: 'bundle', productUrl: 'https://lowes.com' },
    { sku: 'SHIN-DSGN-BRN-003', name: 'Designer Shingles Brown', category: 'Shingles', supplier: 'home_depot', price: 98.75, unit: 'bundle', productUrl: 'https://homedepot.com' },

    // Underlayment & Water Shield
    { sku: 'UNDER-30-001', name: 'Underlayment 30lb', category: 'Underlayment', supplier: 'abc_supply', price: 28.50, unit: 'roll', productUrl: 'https://abcsupply.com' },
    { sku: 'UNDER-30-002', name: 'Underlayment 30lb', category: 'Underlayment', supplier: 'lowes', price: 31.99, unit: 'roll', productUrl: 'https://lowes.com' },
    { sku: 'UNDER-30-003', name: 'Underlayment 30lb', category: 'Underlayment', supplier: 'home_depot', price: 34.50, unit: 'roll', productUrl: 'https://homedepot.com' },
    { sku: 'ICE-WATER-001', name: 'Ice & Water Shield', category: 'Underlayment', supplier: 'abc_supply', price: 52.00, unit: 'roll', productUrl: 'https://abcsupply.com' },
    { sku: 'ICE-WATER-002', name: 'Ice & Water Shield', category: 'Underlayment', supplier: 'lowes', price: 56.75, unit: 'roll', productUrl: 'https://lowes.com' },
    { sku: 'ICE-WATER-003', name: 'Ice & Water Shield', category: 'Underlayment', supplier: 'home_depot', price: 59.99, unit: 'roll', productUrl: 'https://homedepot.com' },

    // Flashing & Trim
    { sku: 'DRIP-AL-001', name: 'Drip Edge Aluminum', category: 'Flashing', supplier: 'abc_supply', price: 0.85, unit: 'ft', productUrl: 'https://abcsupply.com' },
    { sku: 'DRIP-AL-002', name: 'Drip Edge Aluminum', category: 'Flashing', supplier: 'lowes', price: 0.95, unit: 'ft', productUrl: 'https://lowes.com' },
    { sku: 'DRIP-AL-003', name: 'Drip Edge Aluminum', category: 'Flashing', supplier: 'home_depot', price: 1.05, unit: 'ft', productUrl: 'https://homedepot.com' },
    { sku: 'FLASH-STL-001', name: 'Step Flashing Steel', category: 'Flashing', supplier: 'abc_supply', price: 1.45, unit: 'piece', productUrl: 'https://abcsupply.com' },
    { sku: 'FLASH-STL-002', name: 'Step Flashing Steel', category: 'Flashing', supplier: 'lowes', price: 1.75, unit: 'piece', productUrl: 'https://lowes.com' },
    { sku: 'FLASH-STL-003', name: 'Step Flashing Steel', category: 'Flashing', supplier: 'home_depot', price: 1.99, unit: 'piece', productUrl: 'https://homedepot.com' },
    { sku: 'PIPE-BOOT-001', name: 'Pipe Boot Rubber', category: 'Flashing', supplier: 'abc_supply', price: 12.50, unit: 'each', productUrl: 'https://abcsupply.com' },
    { sku: 'PIPE-BOOT-002', name: 'Pipe Boot Rubber', category: 'Flashing', supplier: 'lowes', price: 14.99, unit: 'each', productUrl: 'https://lowes.com' },
    { sku: 'PIPE-BOOT-003', name: 'Pipe Boot Rubber', category: 'Flashing', supplier: 'home_depot', price: 16.50, unit: 'each', productUrl: 'https://homedepot.com' },

    // Ridge & Starter
    { sku: 'RIDGE-CAP-001', name: 'Ridge Cap Shingles', category: 'Ridge Cap', supplier: 'abc_supply', price: 32.00, unit: 'bundle', productUrl: 'https://abcsupply.com' },
    { sku: 'RIDGE-CAP-002', name: 'Ridge Cap Shingles', category: 'Ridge Cap', supplier: 'lowes', price: 36.50, unit: 'bundle', productUrl: 'https://lowes.com' },
    { sku: 'RIDGE-CAP-003', name: 'Ridge Cap Shingles', category: 'Ridge Cap', supplier: 'home_depot', price: 39.99, unit: 'bundle', productUrl: 'https://homedepot.com' },
    { sku: 'START-STRIP-001', name: 'Starter Strip', category: 'Ridge Cap', supplier: 'abc_supply', price: 24.50, unit: 'bundle', productUrl: 'https://abcsupply.com' },
    { sku: 'START-STRIP-002', name: 'Starter Strip', category: 'Ridge Cap', supplier: 'lowes', price: 27.99, unit: 'bundle', productUrl: 'https://lowes.com' },
    { sku: 'START-STRIP-003', name: 'Starter Strip', category: 'Ridge Cap', supplier: 'home_depot', price: 30.50, unit: 'bundle', productUrl: 'https://homedepot.com' },

    // Fasteners
    { sku: 'NAIL-GAL-001', name: 'Roofing Nails Galvanized 1.5in', category: 'Fasteners', supplier: 'abc_supply', price: 8.99, unit: 'lb', productUrl: 'https://abcsupply.com' },
    { sku: 'NAIL-GAL-002', name: 'Roofing Nails Galvanized 1.5in', category: 'Fasteners', supplier: 'lowes', price: 10.50, unit: 'lb', productUrl: 'https://lowes.com' },
    { sku: 'NAIL-GAL-003', name: 'Roofing Nails Galvanized 1.5in', category: 'Fasteners', supplier: 'home_depot', price: 11.75, unit: 'lb', productUrl: 'https://homedepot.com' },
    { sku: 'SCREW-DECK-001', name: 'Deck Screws #8x1.5in', category: 'Fasteners', supplier: 'abc_supply', price: 19.50, unit: 'box', productUrl: 'https://abcsupply.com' },
    { sku: 'SCREW-DECK-002', name: 'Deck Screws #8x1.5in', category: 'Fasteners', supplier: 'lowes', price: 22.99, unit: 'box', productUrl: 'https://lowes.com' },
    { sku: 'SCREW-DECK-003', name: 'Deck Screws #8x1.5in', category: 'Fasteners', supplier: 'home_depot', price: 25.00, unit: 'box', productUrl: 'https://homedepot.com' },

    // Ventilation
    { sku: 'VENT-RIDGE-001', name: 'Ridge Vent Linear', category: 'Ventilation', supplier: 'abc_supply', price: 2.50, unit: 'ft', productUrl: 'https://abcsupply.com' },
    { sku: 'VENT-RIDGE-002', name: 'Ridge Vent Linear', category: 'Ventilation', supplier: 'lowes', price: 2.99, unit: 'ft', productUrl: 'https://lowes.com' },
    { sku: 'VENT-RIDGE-003', name: 'Ridge Vent Linear', category: 'Ventilation', supplier: 'home_depot', price: 3.25, unit: 'ft', productUrl: 'https://homedepot.com' },
    { sku: 'VENT-BOX-001', name: 'Box Vent 12x12', category: 'Ventilation', supplier: 'abc_supply', price: 35.00, unit: 'each', productUrl: 'https://abcsupply.com' },
    { sku: 'VENT-BOX-002', name: 'Box Vent 12x12', category: 'Ventilation', supplier: 'lowes', price: 39.99, unit: 'each', productUrl: 'https://lowes.com' },
    { sku: 'VENT-BOX-003', name: 'Box Vent 12x12', category: 'Ventilation', supplier: 'home_depot', price: 42.50, unit: 'each', productUrl: 'https://homedepot.com' },
    { sku: 'VENT-TURB-001', name: 'Turbine Vent 12in', category: 'Ventilation', supplier: 'abc_supply', price: 48.00, unit: 'each', productUrl: 'https://abcsupply.com' },
    { sku: 'VENT-TURB-002', name: 'Turbine Vent 12in', category: 'Ventilation', supplier: 'lowes', price: 54.99, unit: 'each', productUrl: 'https://lowes.com' },
    { sku: 'VENT-TURB-003', name: 'Turbine Vent 12in', category: 'Ventilation', supplier: 'home_depot', price: 59.75, unit: 'each', productUrl: 'https://homedepot.com' },

    // Gutters & Downspouts
    { sku: 'GUTTER-ALU-001', name: 'Aluminum Gutter 5in', category: 'Gutters', supplier: 'abc_supply', price: 1.35, unit: 'ft', productUrl: 'https://abcsupply.com' },
    { sku: 'GUTTER-ALU-002', name: 'Aluminum Gutter 5in', category: 'Gutters', supplier: 'lowes', price: 1.65, unit: 'ft', productUrl: 'https://lowes.com' },
    { sku: 'GUTTER-ALU-003', name: 'Aluminum Gutter 5in', category: 'Gutters', supplier: 'home_depot', price: 1.85, unit: 'ft', productUrl: 'https://homedepot.com' },
    { sku: 'DOWN-ALU-001', name: 'Downspout Aluminum 2x3in', category: 'Gutters', supplier: 'abc_supply', price: 0.95, unit: 'ft', productUrl: 'https://abcsupply.com' },
    { sku: 'DOWN-ALU-002', name: 'Downspout Aluminum 2x3in', category: 'Gutters', supplier: 'lowes', price: 1.25, unit: 'ft', productUrl: 'https://lowes.com' },
    { sku: 'DOWN-ALU-003', name: 'Downspout Aluminum 2x3in', category: 'Gutters', supplier: 'home_depot', price: 1.45, unit: 'ft', productUrl: 'https://homedepot.com' }
  ];

  const SUPPLIER_COLORS = {
    abc_supply: '#cc0000',
    lowes: '#004990',
    home_depot: '#f96302'
  };

  const SUPPLIER_NAMES = {
    abc_supply: 'ABC Supply',
    lowes: 'Lowe\'s',
    home_depot: 'Home Depot'
  };

  // State management
  let priceData = [];
  let companyId = null;

  // Initialize price database from Firestore or defaults
  async function initPriceDB(cId) {
    companyId = cId;
    try {
      // Attempt to load from Firestore (integration point)
      if (window.firebase && window.firebase.firestore) {
        const db = window.firebase.firestore();
        const snapshot = await db.collection('companies')
          .doc(companyId)
          .collection('supplier_prices')
          .get();

        if (!snapshot.empty) {
          priceData = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            priceHistory: doc.data().priceHistory || []
          }));
          return;
        }
      }
    } catch (err) {
      console.warn('Firestore load failed, using defaults:', err.message);
    }

    // Fall back to defaults
    priceData = DEFAULT_PRODUCTS.map((product, idx) => ({
      id: `${product.sku}-${idx}`,
      ...product,
      lastUpdated: new Date().toISOString(),
      lastCheckedBy: 'system',
      priceHistory: [{ price: product.price, date: new Date().toISOString() }],
      notes: ''
    }));

    // Save defaults to Firestore if available
    if (window.firebase && window.firebase.firestore) {
      try {
        const db = window.firebase.firestore();
        const batch = db.batch();
        const colRef = db.collection('companies').doc(companyId).collection('supplier_prices');
        priceData.forEach(item => {
          batch.set(colRef.doc(item.id), item);
        });
        await batch.commit();
      } catch (err) {
        console.warn('Failed to save defaults to Firestore:', err.message);
      }
    }
  }

  // Update single price
  async function updatePrice(sku, newPrice, supplier, userId) {
    const item = priceData.find(p => p.sku === sku && p.supplier === supplier);
    if (!item) return null;

    const oldPrice = item.price;
    item.price = newPrice;
    item.lastUpdated = new Date().toISOString();
    item.lastCheckedBy = userId || 'manual';
    item.priceHistory = item.priceHistory || [];
    item.priceHistory.push({ price: oldPrice, date: item.lastUpdated });

    // Persist to Firestore
    if (window.firebase && window.firebase.firestore) {
      try {
        const db = window.firebase.firestore();
        await db.collection('companies').doc(companyId)
          .collection('supplier_prices').doc(item.id).update(item);
      } catch (err) {
        console.error('Failed to update Firestore:', err);
      }
    }

    window._supplierPrices = priceData;
    return item;
  }

  // Bulk update prices
  async function bulkUpdatePrices(updates) {
    const results = [];
    for (const update of updates) {
      const result = await updatePrice(update.sku, update.price, update.supplier, update.userId);
      results.push(result);
    }
    return results;
  }

  // Get price comparison for a product across suppliers
  function getPriceComparison(category) {
    const filtered = priceData.filter(p => p.category === category);
    const grouped = {};

    filtered.forEach(item => {
      if (!grouped[item.name]) {
        grouped[item.name] = {
          name: item.name,
          category: item.category,
          unit: item.unit,
          suppliers: {},
          cheapest: null
        };
      }
      grouped[item.name].suppliers[item.supplier] = {
        price: item.price,
        sku: item.sku,
        lastUpdated: item.lastUpdated
      };
    });

    // Identify cheapest option
    Object.values(grouped).forEach(product => {
      const prices = Object.entries(product.suppliers)
        .map(([supplier, data]) => ({ supplier, ...data }))
        .sort((a, b) => a.price - b.price);
      if (prices.length > 0) {
        product.cheapest = prices[0].supplier;
        product.savings = prices[prices.length - 1].price - prices[0].price;
      }
    });

    return Object.values(grouped);
  }

  // Get stale products
  function getStaleProducts(daysSince = 14) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysSince);
    return priceData.filter(p => new Date(p.lastUpdated) < cutoffDate);
  }

  // Schedule reminder notification
  function scheduleAutoReminder() {
    if (!window.firebase || !window.firebase.firestore) {
      console.warn('Firebase not available for reminders');
      return;
    }

    const db = window.firebase.firestore();
    const nextReminder = new Date();
    nextReminder.setDate(nextReminder.getDate() + 7);

    db.collection('companies').doc(companyId)
      .collection('notifications').add({
        type: 'price_check_reminder',
        title: 'Check Supplier Prices',
        message: 'Time to verify current pricing on roofing materials',
        dueDate: nextReminder.toISOString(),
        dismissed: false,
        createdAt: new Date().toISOString()
      }).catch(err => console.error('Notification creation failed:', err));
  }

  // Format relative time
  function getRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} min ago`;
    return 'just now';
  }

  // Render main price tracker UI
  function renderPriceTracker(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    let selectedSupplier = 'all';
    let selectedCategory = 'all';
    let selectedSort = 'name';

    const html = `
      <div style="background: var(--s,#1a1a2e); color: var(--m,#9ca3af); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px; border-radius: 8px; border: 1px solid var(--br,rgba(255,255,255,.08));">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid var(--br,rgba(255,255,255,.08)); padding-bottom: 15px;">
          <div>
            <h2 style="color: var(--h,#fff); margin: 0 0 5px 0; font-size: 22px;">Supplier Price Tracker</h2>
            <p style="margin: 0; font-size: 13px; color: #666;">
              <span id="sp-total-products">0</span> products tracked •
              Avg staleness: <span id="sp-avg-staleness">0</span> days •
              <span id="sp-savings">$0</span> savings potential
            </p>
          </div>
          <div style="display: flex; gap: 8px;">
            <button id="sp-refresh-all" style="background: #C8541A; color: white; border: none; padding: 8px 14px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">Refresh All</button>
            <button id="sp-add-product" style="background: #C8541A; color: white; border: none; padding: 8px 14px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">+ Add Product</button>
          </div>
        </div>

        <div style="display: flex; gap: 15px; margin-bottom: 15px; border-bottom: 1px solid var(--br,rgba(255,255,255,.08)); padding-bottom: 15px;">
          <div>
            <label style="display: block; font-size: 11px; color: #666; margin-bottom: 6px; font-weight: 600; text-transform: uppercase;">Supplier</label>
            <div style="display: flex; gap: 8px;">
              <button class="sp-supplier-btn" data-supplier="all" style="background: #C8541A; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600;">All</button>
              <button class="sp-supplier-btn" data-supplier="abc_supply" style="background: #cc0000; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600; opacity: 0.6;">ABC</button>
              <button class="sp-supplier-btn" data-supplier="lowes" style="background: #004990; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600; opacity: 0.6;">Lowe's</button>
              <button class="sp-supplier-btn" data-supplier="home_depot" style="background: #f96302; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600; opacity: 0.6;">Home Depot</button>
            </div>
          </div>
          <div>
            <label style="display: block; font-size: 11px; color: #666; margin-bottom: 6px; font-weight: 600; text-transform: uppercase;">Category</label>
            <select id="sp-category-filter" style="background: var(--s,#1a1a2e); color: var(--m,#9ca3af); border: 1px solid var(--br,rgba(255,255,255,.08)); padding: 6px 10px; border-radius: 4px; font-size: 12px; cursor: pointer;">
              <option value="all">All Categories</option>
              <option value="Shingles">Shingles</option>
              <option value="Underlayment">Underlayment</option>
              <option value="Flashing">Flashing</option>
              <option value="Ridge Cap">Ridge Cap</option>
              <option value="Fasteners">Fasteners</option>
              <option value="Ventilation">Ventilation</option>
              <option value="Gutters">Gutters</option>
            </select>
          </div>
        </div>

        <div style="overflow-x: auto; margin-bottom: 15px;">
          <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            <thead>
              <tr style="border-bottom: 2px solid var(--br,rgba(255,255,255,.08));">
                <th style="text-align: left; padding: 10px; color: var(--h,#fff); font-weight: 600; cursor: pointer;" data-sort="name">Item Name</th>
                <th style="text-align: left; padding: 10px; color: var(--h,#fff); font-weight: 600;">SKU</th>
                <th style="text-align: left; padding: 10px; color: var(--h,#fff); font-weight: 600;">Supplier</th>
                <th style="text-align: right; padding: 10px; color: var(--h,#fff); font-weight: 600; cursor: pointer;" data-sort="price">Price</th>
                <th style="text-align: left; padding: 10px; color: var(--h,#fff); font-weight: 600;">Unit</th>
                <th style="text-align: left; padding: 10px; color: var(--h,#fff); font-weight: 600;">Last Updated</th>
                <th style="text-align: center; padding: 10px; color: var(--h,#fff); font-weight: 600;">Actions</th>
              </tr>
            </thead>
            <tbody id="sp-table-body">
            </tbody>
          </table>
        </div>
      </div>
    `;

    container.innerHTML = html;
    renderTableRows();

    // Event listeners
    document.querySelectorAll('.sp-supplier-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.sp-supplier-btn').forEach(b => b.style.opacity = '0.6');
        e.target.style.opacity = '1';
        selectedSupplier = e.target.dataset.supplier;
        renderTableRows();
      });
    });

    document.getElementById('sp-category-filter')?.addEventListener('change', (e) => {
      selectedCategory = e.target.value;
      renderTableRows();
    });

    document.getElementById('sp-refresh-all')?.addEventListener('click', () => {
      const stale = getStaleProducts(0);
      scheduleAutoReminder();
      alert(`Refresh reminder created. ${stale.length} products need price verification.`);
    });

    document.getElementById('sp-add-product')?.addEventListener('click', () => {
      const name = prompt('Product name:');
      const sku = prompt('SKU:');
      const supplier = prompt('Supplier (abc_supply/lowes/home_depot):');
      const price = parseFloat(prompt('Price:'));
      const category = prompt('Category:');
      const unit = prompt('Unit (bundle/roll/ft/each/lb/box):');

      if (name && sku && supplier && !isNaN(price) && category && unit) {
        const newItem = {
          id: `${sku}-custom-${Date.now()}`,
          sku, name, supplier, category, unit, price,
          lastUpdated: new Date().toISOString(),
          lastCheckedBy: 'manual',
          priceHistory: [{ price, date: new Date().toISOString() }],
          notes: '',
          productUrl: ''
        };
        priceData.push(newItem);
        renderTableRows();
        updateSummaryStats();
      }
    });

    updateSummaryStats();
  }

  // Render table rows with filtering/sorting
  function renderTableRows() {
    const tbody = document.getElementById('sp-table-body');
    if (!tbody) return;

    let filtered = priceData;
    if (selectedSupplier !== 'all') {
      filtered = filtered.filter(p => p.supplier === selectedSupplier);
    }
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(p => p.category === selectedCategory);
    }

    tbody.innerHTML = filtered.map(item => {
      const isStale = getStaleProducts(14).some(s => s.id === item.id);
      const staleColor = isStale ? 'color: #ff6b6b;' : '';

      return `
        <tr style="border-bottom: 1px solid var(--br,rgba(255,255,255,.08)); hover {background: rgba(255,255,255,.02);}">
          <td style="padding: 10px;">${item.name}</td>
          <td style="padding: 10px; font-size: 11px; color: #666; font-family: monospace;">${item.sku}</td>
          <td style="padding: 10px;">
            <span style="background: ${SUPPLIER_COLORS[item.supplier] || '#666'}; color: white; padding: 3px 8px; border-radius: 3px; font-size: 11px; font-weight: 600;">
              ${SUPPLIER_NAMES[item.supplier] || item.supplier}
            </span>
          </td>
          <td style="padding: 10px; text-align: right; font-weight: 600; color: var(--h,#fff);">$${item.price.toFixed(2)}</td>
          <td style="padding: 10px; font-size: 12px;">${item.unit}</td>
          <td style="padding: 10px; font-size: 12px; ${staleColor}">${getRelativeTime(item.lastUpdated)}</td>
          <td style="padding: 10px; text-align: center;">
            <button class="sp-edit-price" data-id="${item.id}" style="background: #C8541A; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; margin-right: 4px;">Edit</button>
            <button class="sp-view-history" data-sku="${item.sku}" style="background: #666; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; margin-right: 4px;">History</button>
            <a href="${item.productUrl}" target="_blank" style="color: #C8541A; text-decoration: none; font-size: 11px; font-weight: 600;">Link</a>
          </td>
        </tr>
      `;
    }).join('');

    // Edit price listeners
    document.querySelectorAll('.sp-edit-price').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const item = priceData.find(p => p.id === e.target.dataset.id);
        const newPrice = parseFloat(prompt(`Edit price for ${item.name}:`, item.price));
        if (!isNaN(newPrice) && newPrice > 0) {
          updatePrice(item.sku, newPrice, item.supplier, 'manual');
          renderTableRows();
          updateSummaryStats();
        }
      });
    });

    // View history listeners
    document.querySelectorAll('.sp-view-history').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sku = e.target.dataset.sku;
        const item = priceData.find(p => p.sku === sku);
        if (item && item.priceHistory) {
          const historyText = item.priceHistory
            .map(h => `${new Date(h.date).toLocaleDateString()}: $${h.price.toFixed(2)}`)
            .join('\n');
          alert(`Price History for ${item.name}:\n\n${historyText}`);
        }
      });
    });
  }

  // Update summary statistics
  function updateSummaryStats() {
    document.getElementById('sp-total-products').textContent = priceData.length;

    const stale = getStaleProducts(14);
    const avgStaleness = stale.length > 0
      ? Math.round(stale.reduce((sum, p) => sum + ((new Date() - new Date(p.lastUpdated)) / 86400000), 0) / stale.length)
      : 0;
    document.getElementById('sp-avg-staleness').textContent = avgStaleness;

    const comparisons = getPriceComparison(selectedCategory === 'all' ? undefined : selectedCategory);
    const totalSavings = comparisons.reduce((sum, p) => sum + (p.savings || 0), 0);
    document.getElementById('sp-savings').textContent = `$${totalSavings.toFixed(2)}`;
  }

  // Render price history chart
  function renderPriceHistory(containerId, sku) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const item = priceData.find(p => p.sku === sku);
    if (!item) return;

    const history = item.priceHistory || [];
    const dates = history.map(h => new Date(h.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const prices = history.map(h => h.price);

    const html = `
      <div style="background: var(--s,#1a1a2e); color: var(--m,#9ca3af); padding: 15px; border-radius: 8px; border: 1px solid var(--br,rgba(255,255,255,.08));">
        <h3 style="color: var(--h,#fff); margin-top: 0;">${item.name}</h3>
        <div style="font-size: 12px; margin-bottom: 15px;">
          <p><strong>Current Price:</strong> $${item.price.toFixed(2)}</p>
          <p><strong>High:</strong> $${Math.max(...prices).toFixed(2)}</p>
          <p><strong>Low:</strong> $${Math.min(...prices).toFixed(2)}</p>
          <p><strong>Avg:</strong> $${(prices.reduce((a, b) => a + b) / prices.length).toFixed(2)}</p>
        </div>
        <div style="background: rgba(200, 84, 26, 0.1); padding: 10px; border-radius: 4px; font-size: 11px; font-family: monospace;">
          ${history.map(h => `${new Date(h.date).toLocaleString()}: $${h.price.toFixed(2)}`).join('<br/>')}
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  // Lookup function for integration
  function getSupplierPriceForProduct(productName, supplier) {
    const item = priceData.find(p => p.name.toLowerCase().includes(productName.toLowerCase()) && p.supplier === supplier);
    return item ? { price: item.price, sku: item.sku, lastUpdated: item.lastUpdated } : null;
  }

  // Public API
  window.SupplierPricing = {
    init: initPriceDB,
    updatePrice,
    bulkUpdatePrices,
    getPriceComparison,
    getStaleProducts,
    scheduleAutoReminder,
    render: renderPriceTracker,
    renderHistory: renderPriceHistory,
    getPrice: getSupplierPriceForProduct,
    getData: () => priceData
  };

  // Expose data for other modules
  window._supplierPrices = priceData;
})();
