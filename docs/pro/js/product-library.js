/**
 * NBD Pro - Product Library v2
 * Full CRUD system consuming window.NBD_PRODUCTS / NBD_CATEGORIES from product-data.js
 * Stores user edits in localStorage under 'nbd_product_library'
 */

(function() {
  'use strict';

  const STORAGE_KEY = 'nbd_product_library';
  const DATA_VERSION = 2;

  // Pull from product-data.js globals
  const CATEGORIES = window.NBD_CATEGORIES || {};
  const UNITS = window.NBD_UNITS || {};
  const DEFAULT_PRODUCTS = window.NBD_PRODUCTS || [];

  const TIERS = ['good', 'better', 'best'];
  const TIER_LABELS = { good: 'Good', better: 'Better', best: 'Best' };
  const TIER_COLORS = { good: '#6b7280', better: '#3b82f6', best: '#e8720c' };

  // ============================================================================
  // STATE
  // ============================================================================

  let products = [];
  let editingProduct = null;
  let currentFilter = { search: '', category: null, tier: null };
  let collapsedCategories = {}; // track which categories are collapsed

  // ============================================================================
  // STORAGE
  // ============================================================================

  function loadProducts() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed._v === DATA_VERSION) {
          products = parsed.items || [];
        } else {
          seedDefaults();
        }
      } else {
        seedDefaults();
      }
    } catch (e) {
      console.error('Product library load error:', e);
      seedDefaults();
    }
    return products;
  }

  function seedDefaults() {
    const now = new Date().toISOString();
    products = DEFAULT_PRODUCTS.map(p => ({ ...p, createdAt: now, updatedAt: now }));
    saveAll();
  }

  function saveAll() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ _v: DATA_VERSION, items: products }));
    } catch (e) {
      console.error('Product library save error:', e);
      showToast('Error saving products', 'error');
    }
  }

  function saveProduct(product) {
    const now = new Date().toISOString();
    if (!product.id) {
      product.id = 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      product.createdAt = now;
    }
    product.updatedAt = now;
    const idx = products.findIndex(p => p.id === product.id);
    if (idx >= 0) products[idx] = product;
    else products.push(product);
    saveAll();
    return product;
  }

  function deleteProduct(id) {
    const idx = products.findIndex(p => p.id === id);
    if (idx >= 0) { products[idx].isActive = false; saveAll(); }
  }

  function hardDeleteProduct(id) {
    products = products.filter(p => p.id !== id);
    saveAll();
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatCurrency(n) {
    if (n == null) return '$0';
    if (n >= 1) return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    return '$' + Number(n).toFixed(2);
  }

  function margin(sell, cost) {
    if (!sell) return 0;
    return Math.round(((sell - cost) / sell) * 100);
  }

  // True gross margin: sell - material cost - labor cost
  function grossMargin(sell, matCost, laborCost) {
    if (!sell) return 0;
    return Math.round(((sell - matCost - laborCost) / sell) * 100);
  }

  function showToast(msg, type) {
    if (window._showToast) { window._showToast(msg, type); return; }
    const t = document.getElementById('product-toast');
    if (!t) return;
    t.textContent = msg;
    t.style.background = type === 'error' ? '#ef4444' : '#10b981';
    t.style.opacity = '1';
    setTimeout(() => { t.style.opacity = '0'; }, 2500);
  }

  function catLabel(catId) {
    return CATEGORIES[catId] ? CATEGORIES[catId].label : catId;
  }

  function catIcon(catId) {
    return CATEGORIES[catId] ? CATEGORIES[catId].icon : '📦';
  }

  function catColor(catId) {
    return CATEGORIES[catId] ? CATEGORIES[catId].color : '#6b7280';
  }

  function unitLabel(u) {
    return UNITS[u] ? UNITS[u].label : u;
  }

  // ============================================================================
  // SEARCH & FILTER
  // ============================================================================

  function getFilteredProducts() {
    let list = products.filter(p => p.isActive !== false);
    if (currentFilter.category) {
      list = list.filter(p => p.category === currentFilter.category);
    }
    if (currentFilter.search) {
      const q = currentFilter.search.toLowerCase();
      list = list.filter(p =>
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.manufacturer && p.manufacturer.toLowerCase().includes(q)) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.tags && p.tags.some(t => t.toLowerCase().includes(q)))
      );
    }
    return list;
  }

  function searchProducts(query) {
    currentFilter.search = query || '';
    return getFilteredProducts();
  }

  // ============================================================================
  // RENDER
  // ============================================================================

  function render() {
    const results = getFilteredProducts();
    const activeCount = products.filter(p => p.isActive !== false).length;
    const usedCats = [...new Set(products.filter(p => p.isActive !== false).map(p => p.category))];
    const categoryCount = usedCats.length;
    const marginTier = currentFilter.tier || 'better';
    const avgMargin = activeCount > 0 ? Math.round(
      products.filter(p => p.isActive !== false).reduce((s, p) => {
        return s + grossMargin(p.pricing?.[marginTier]?.sell || 0, p.pricing?.[marginTier]?.cost || 0, p.labor?.perUnit || 0);
      }, 0) / activeCount
    ) : 0;

    // Group results by category
    const grouped = {};
    results.forEach(p => {
      if (!grouped[p.category]) grouped[p.category] = [];
      grouped[p.category].push(p);
    });

    // Category filter pills
    const catPills = Object.entries(CATEGORIES).map(([id, cat]) => {
      const count = products.filter(p => p.isActive !== false && p.category === id).length;
      if (count === 0) return '';
      const isActive = currentFilter.category === id;
      return `<button onclick="window._productLib.setFilter('${id}')" style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;border:2px solid ${isActive ? cat.color : 'var(--br)'};background:${isActive ? cat.color + '18' : 'var(--s)'};color:${isActive ? cat.color : 'var(--t)'};cursor:pointer;font-size:12px;font-weight:${isActive?'600':'500'};white-space:nowrap;">${cat.icon} ${cat.label} <span style="background:${isActive ? cat.color : 'var(--br)'};color:${isActive?'#fff':'var(--m)'};border-radius:10px;padding:1px 7px;font-size:11px;">${count}</span></button>`;
    }).join('');

    // Product cards by category (collapsible accordion)
    let productsHtml = '';
    Object.keys(grouped).sort((a, b) => catLabel(a).localeCompare(catLabel(b))).forEach(catId => {
      const catProds = grouped[catId].sort((a, b) => (a.sortOrder || 99) - (b.sortOrder || 99));
      const isCollapsed = collapsedCategories[catId] === true;
      const chevron = isCollapsed ? '▸' : '▾';
      productsHtml += `
        <div style="margin-bottom:28px;">
          <div onclick="window._productLib.toggleCategory('${catId}')" style="display:flex;align-items:center;gap:8px;margin-bottom:${isCollapsed ? '0' : '12'}px;cursor:pointer;user-select:none;padding:8px 12px;background:var(--s);border-radius:8px;border:1px solid var(--br);transition:all .15s;" onmouseenter="this.style.background='var(--s2)'" onmouseleave="this.style.background='var(--s)'">
            <span style="font-size:14px;color:var(--m);font-weight:700;width:16px;text-align:center;">${chevron}</span>
            <span style="font-size:20px;">${catIcon(catId)}</span>
            <h3 style="margin:0;font-size:16px;font-weight:700;color:${catColor(catId)};flex:1;">${catLabel(catId)}</h3>
            <span style="font-size:12px;color:var(--m);font-weight:500;">${catProds.length} product${catProds.length !== 1 ? 's' : ''}</span>
          </div>
          <div style="display:${isCollapsed ? 'none' : 'grid'};grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;margin-top:${isCollapsed ? '0' : '12px'};">
      `;
      catProds.forEach(p => {
        const tierForMargin = currentFilter.tier || 'better';
        const laborCost = p.labor?.perUnit || 0;
        const matCost = p.pricing?.[tierForMargin]?.cost || 0;
        const sellPrice = p.pricing?.[tierForMargin]?.sell || 0;
        const myCost = matCost + laborCost;
        const m = grossMargin(sellPrice, matCost, laborCost);
        const colorCount = p.colors ? p.colors.length : 0;
        const hasLabor = p.labor && p.labor.perUnit > 0;
        productsHtml += `
          <div style="background:var(--s);border-radius:10px;padding:16px;border:1px solid var(--br);box-shadow:0 1px 3px rgba(0,0,0,.06);transition:box-shadow .15s;" onmouseenter="this.style.boxShadow='0 4px 12px rgba(0,0,0,.1)'" onmouseleave="this.style.boxShadow='0 1px 3px rgba(0,0,0,.06)'">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
              <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:14px;color:var(--t);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div>
                <div style="font-size:11px;color:var(--m);margin-top:2px;">${escapeHtml(p.manufacturer || '')} ${p.sku ? '• ' + escapeHtml(p.sku) : ''}</div>
              </div>
              <span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px;background:${catColor(p.category)}18;color:${catColor(p.category)};white-space:nowrap;">${escapeHtml(p.unit)}</span>
            </div>

            <div style="font-size:12px;color:var(--m);margin-bottom:10px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.4;">${escapeHtml(p.description)}</div>

            <!-- Tier Pricing -->
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:10px;">
              ${TIERS.map(t => {
                const isHighlighted = currentFilter.tier === t;
                return `<div style="background:${isHighlighted ? TIER_COLORS[t]+'20' : TIER_COLORS[t]+'0a'};border-radius:6px;padding:6px 8px;text-align:center;border:${isHighlighted ? '2px' : '1px'} solid ${isHighlighted ? TIER_COLORS[t] : TIER_COLORS[t]+'20'};${isHighlighted ? 'transform:scale(1.03);box-shadow:0 2px 8px '+TIER_COLORS[t]+'30;' : ''}">
                  <div style="font-size:10px;font-weight:600;color:${TIER_COLORS[t]};text-transform:uppercase;">${TIER_LABELS[t]}</div>
                  <div style="font-size:14px;font-weight:700;color:var(--t);">${formatCurrency(p.pricing?.[t]?.sell)}</div>
                  <div style="font-size:10px;color:var(--m);">Profit ${grossMargin(p.pricing?.[t]?.sell||0, p.pricing?.[t]?.cost||0, laborCost)}%</div>
                </div>`;
              }).join('')}
            </div>

            <!-- Cost Breakdown Row -->
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
              <span style="font-size:11px;padding:3px 10px;border-radius:10px;background:#1e293b;color:#f1f5f9;font-weight:700;">🏷️ My Cost: ${formatCurrency(myCost)}/${p.unit} <span style="opacity:.6;font-weight:400;">(${TIER_LABELS[tierForMargin]})</span></span>
              ${matCost ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:#dcfce7;color:#166534;">💲 Mat ${formatCurrency(matCost)}</span>` : ''}
              ${hasLabor ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:#fef3c7;color:#92400e;">⚒️ Lab ${formatCurrency(p.labor.perUnit)}</span>` : ''}
            </div>

            <!-- Meta Row -->
            <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
              ${colorCount > 0 ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:var(--s2);color:var(--t);">🎨 ${colorCount} colors</span>` : ''}
              ${p.warranty && p.warranty !== 'N/A' ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:#ecfdf5;color:#065f46;">🛡️ ${escapeHtml(p.warranty.length > 20 ? p.warranty.substring(0, 18) + '…' : p.warranty)}</span>` : ''}
              ${p.coverage ? `<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:#eff6ff;color:#1e40af;">📐 ${escapeHtml(typeof p.coverage === 'string' ? p.coverage : p.coverage.perUnit || '')}</span>` : ''}
            </div>

            <!-- Footer -->
            <div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:1px solid var(--br);">
              <div style="font-size:12px;color:var(--m);"><strong>Gross Profit <span style="font-weight:400;opacity:.7;">(${TIER_LABELS[tierForMargin]})</span>:</strong> <span style="color:${m >= 40 ? '#10b981' : m >= 25 ? '#f59e0b' : '#ef4444'};font-weight:700;">${formatCurrency(sellPrice - myCost)}/${p.unit} (${m}%)</span></div>
              <div style="display:flex;gap:6px;">
                <button onclick="window._productLib.editProduct('${p.id}')" style="padding:5px 12px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;">Edit</button>
                <button onclick="window._productLib.archiveProduct('${p.id}')" style="padding:5px 10px;background:#f3f4f6;color:#6b7280;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:500;">Archive</button>
              </div>
            </div>
          </div>
        `;
      });
      productsHtml += '</div></div>';
    });

    return `
      <div style="padding:20px;background:transparent;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">

        <!-- Header -->
        <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
          <div>
            <h1 style="margin:0;font-size:28px;font-weight:700;color:var(--t);">Product Library</h1>
            <p style="margin:6px 0 0;font-size:13px;color:var(--m);">Materials, labor, and pricing for your estimates — ${activeCount} products across ${categoryCount} categories</p>
          </div>
          <div style="display:flex;gap:8px;">
            <button onclick="window._productLib.addProduct()" style="padding:8px 16px;background:#e8720c;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:13px;">+ Add Product</button>
            <button onclick="window._productLib.exportCSV()" style="padding:8px 14px;background:#10b981;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:500;font-size:13px;">Export CSV</button>
            <button onclick="window._productLib.resetDefaults()" style="padding:8px 14px;background:#ef4444;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:500;font-size:13px;">Reset</button>
          </div>
        </div>

        <!-- Stats -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px;">
          <div style="background:var(--s);padding:14px;border-radius:8px;border-left:4px solid #3b82f6;">
            <div style="font-size:11px;color:var(--m);font-weight:500;">Total Products</div>
            <div style="font-size:22px;font-weight:700;color:var(--t);margin-top:2px;">${activeCount}</div>
          </div>
          <div style="background:var(--s);padding:14px;border-radius:8px;border-left:4px solid #10b981;">
            <div style="font-size:11px;color:var(--m);font-weight:500;">Categories</div>
            <div style="font-size:22px;font-weight:700;color:var(--t);margin-top:2px;">${categoryCount}</div>
          </div>
          <div style="background:var(--s);padding:14px;border-radius:8px;border-left:4px solid #f59e0b;">
            <div style="font-size:11px;color:var(--m);font-weight:500;">Avg Margin</div>
            <div style="font-size:22px;font-weight:700;color:var(--t);margin-top:2px;">${avgMargin}%</div>
          </div>
          <div style="background:var(--s);padding:14px;border-radius:8px;border-left:4px solid #8b5cf6;">
            <div style="font-size:11px;color:var(--m);font-weight:500;">Showing</div>
            <div style="font-size:22px;font-weight:700;color:var(--t);margin-top:2px;">${results.length}</div>
          </div>
        </div>

        <!-- Search & Filter -->
        <div style="background:var(--s);padding:14px;border-radius:8px;margin-bottom:16px;">
          <input type="text" id="product-search" placeholder="Search by name, brand, tag..." value="${escapeHtml(currentFilter.search)}"
            style="width:100%;padding:10px 14px;background:var(--s2);border:1px solid var(--br);border-radius:8px;font-size:14px;box-sizing:border-box;margin-bottom:12px;color:var(--t);"
            oninput="window._productLib.setFilter(undefined,this.value)">

          <!-- Tier Filter Buttons -->
          <div style="display:flex;gap:6px;margin-bottom:12px;">
            <button onclick="window._productLib.setTierFilter(null)" style="flex:1;padding:8px 12px;border-radius:8px;border:2px solid ${!currentFilter.tier ? '#e8720c' : 'var(--br)'};background:${!currentFilter.tier ? '#e8720c18' : 'var(--s)'};color:${!currentFilter.tier ? '#e8720c' : 'var(--m)'};cursor:pointer;font-size:12px;font-weight:600;">All Tiers</button>
            ${TIERS.map(t => {
              const isActive = currentFilter.tier === t;
              return `<button onclick="window._productLib.setTierFilter('${t}')" style="flex:1;padding:8px 12px;border-radius:8px;border:2px solid ${isActive ? TIER_COLORS[t] : 'var(--br)'};background:${isActive ? TIER_COLORS[t]+'18' : 'var(--s)'};color:${isActive ? TIER_COLORS[t] : 'var(--m)'};cursor:pointer;font-size:12px;font-weight:600;">${TIER_LABELS[t]}</button>`;
            }).join('')}
          </div>

          <!-- Category Filter Pills -->
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            <button onclick="window._productLib.setFilter(null)" style="padding:6px 12px;border-radius:20px;border:2px solid ${!currentFilter.category ? '#e8720c' : 'var(--br)'};background:${!currentFilter.category ? '#e8720c18' : 'var(--s)'};color:${!currentFilter.category ? '#e8720c' : 'var(--t)'};cursor:pointer;font-size:12px;font-weight:${!currentFilter.category?'600':'500'};">All (${activeCount})</button>
            ${catPills}
          </div>
        </div>

        <!-- Products -->
        ${productsHtml || '<div style="text-align:center;padding:60px 20px;color:var(--m);font-size:15px;">No products match your search</div>'}

        <!-- Toast -->
        <div id="product-toast" style="position:fixed;bottom:20px;right:20px;padding:12px 20px;background:#10b981;color:#fff;border-radius:8px;opacity:0;transition:opacity .3s;font-size:14px;font-weight:500;z-index:9999;"></div>
      </div>
    `;
  }

  // ============================================================================
  // MODAL — Edit / Add Product
  // ============================================================================

  function openModal(productId) {
    const p = productId ? products.find(x => x.id === productId) : null;
    editingProduct = p ? { ...p } : null;

    const catOptions = Object.entries(CATEGORIES).map(([id, c]) =>
      `<option value="${id}" ${(p && p.category === id) ? 'selected' : ''}>${c.icon} ${c.label}</option>`
    ).join('');

    const unitOptions = Object.entries(UNITS).map(([id, u]) =>
      `<option value="${id}" ${(p && p.unit === id) ? 'selected' : ''}>${u.abbr} — ${u.label}</option>`
    ).join('');

    const modal = document.createElement('div');
    modal.id = 'product-edit-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    modal.innerHTML = `
      <div style="background:var(--s);border-radius:12px;width:95%;max-width:680px;max-height:92vh;overflow-y:auto;padding:24px;box-shadow:0 20px 40px rgba(0,0,0,.2);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h2 style="margin:0;font-size:20px;font-weight:700;color:var(--t);">${p ? 'Edit Product' : 'Add Product'}</h2>
          <button onclick="window._productLib.closeModal()" style="background:none;border:none;font-size:24px;cursor:pointer;color:var(--m);padding:4px 8px;">×</button>
        </div>

        <div style="display:grid;gap:16px;">
          <!-- Row 1: Name, Manufacturer -->
          <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;">
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--m);margin-bottom:3px;">Product Name *</label>
              <input id="pm-name" type="text" value="${escapeHtml(p?.name || '')}" style="width:100%;padding:8px 10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;font-size:13px;box-sizing:border-box;color:var(--t);" required>
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--m);margin-bottom:3px;">Manufacturer</label>
              <input id="pm-manufacturer" type="text" value="${escapeHtml(p?.manufacturer || '')}" style="width:100%;padding:8px 10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;font-size:13px;box-sizing:border-box;color:var(--t);">
            </div>
          </div>

          <!-- Row 2: Category, Unit, SKU -->
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--m);margin-bottom:3px;">Category</label>
              <select id="pm-category" style="width:100%;padding:8px 10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;font-size:13px;box-sizing:border-box;color:var(--t);">${catOptions}</select>
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--m);margin-bottom:3px;">Unit</label>
              <select id="pm-unit" style="width:100%;padding:8px 10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;font-size:13px;box-sizing:border-box;color:var(--t);">${unitOptions}</select>
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--m);margin-bottom:3px;">SKU</label>
              <input id="pm-sku" type="text" value="${escapeHtml(p?.sku || '')}" style="width:100%;padding:8px 10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;font-size:13px;box-sizing:border-box;color:var(--t);">
            </div>
          </div>

          <!-- Description -->
          <div>
            <label style="display:block;font-size:11px;font-weight:600;color:var(--m);margin-bottom:3px;">Description</label>
            <textarea id="pm-description" rows="2" style="width:100%;padding:8px 10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;font-size:13px;box-sizing:border-box;resize:vertical;color:var(--t);">${escapeHtml(p?.description || '')}</textarea>
          </div>

          <!-- Tier Pricing -->
          <div>
            <label style="display:block;font-size:12px;font-weight:700;color:var(--t);margin-bottom:8px;">Pricing (Good / Better / Best)</label>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
              ${TIERS.map(t => `
                <div style="background:${TIER_COLORS[t]}08;border:1px solid ${TIER_COLORS[t]}30;border-radius:8px;padding:10px;">
                  <div style="font-size:11px;font-weight:600;color:${TIER_COLORS[t]};text-transform:uppercase;margin-bottom:6px;text-align:center;">${TIER_LABELS[t]}</div>
                  <div style="margin-bottom:6px;">
                    <label style="font-size:10px;color:var(--m);">Sell Price</label>
                    <input id="pm-sell-${t}" type="number" step="0.01" value="${p?.pricing?.[t]?.sell || 0}" oninput="window._productLib.recalcModalMargins()" style="width:100%;padding:6px;background:var(--s2);border:1px solid var(--br);border-radius:4px;font-size:13px;box-sizing:border-box;color:var(--t);">
                  </div>
                  <div>
                    <label style="font-size:10px;color:var(--m);">Material Cost</label>
                    <input id="pm-cost-${t}" type="number" step="0.01" value="${p?.pricing?.[t]?.cost || 0}" oninput="window._productLib.recalcModalMargins()" style="width:100%;padding:6px;background:var(--s2);border:1px solid var(--br);border-radius:4px;font-size:13px;box-sizing:border-box;color:var(--t);">
                  </div>
                  <div id="pm-margin-${t}" style="text-align:center;margin-top:6px;font-size:11px;font-weight:700;"></div>
                </div>
              `).join('')}
            </div>
            <div id="pm-margin-warnings" style="margin-top:8px;"></div>
          </div>

          <!-- Labor -->
          <div>
            <label style="display:block;font-size:12px;font-weight:700;color:var(--t);margin-bottom:8px;">Labor</label>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
              <div>
                <label style="font-size:10px;color:var(--m);">Per Unit Cost</label>
                <input id="pm-labor-perunit" type="number" step="0.01" value="${p?.labor?.perUnit || 0}" oninput="window._productLib.recalcModalMargins()" style="width:100%;padding:6px;background:var(--s2);border:1px solid var(--br);border-radius:4px;font-size:13px;box-sizing:border-box;color:var(--t);">
              </div>
              <div>
                <label style="font-size:10px;color:var(--m);">Rate / Man-Hour</label>
                <input id="pm-labor-rate" type="number" step="0.01" value="${p?.labor?.ratePerManHour || 0}" style="width:100%;padding:6px;background:var(--s2);border:1px solid var(--br);border-radius:4px;font-size:13px;box-sizing:border-box;color:var(--t);">
              </div>
              <div>
                <label style="font-size:10px;color:var(--m);">Crew Size</label>
                <input id="pm-labor-crew" type="number" step="1" value="${p?.labor?.crewSize || 0}" style="width:100%;padding:6px;background:var(--s2);border:1px solid var(--br);border-radius:4px;font-size:13px;box-sizing:border-box;color:var(--t);">
              </div>
              <div>
                <label style="font-size:10px;color:var(--m);">Hours / Unit</label>
                <input id="pm-labor-hours" type="number" step="0.01" value="${p?.labor?.hoursPerUnit || 0}" style="width:100%;padding:6px;background:var(--s2);border:1px solid var(--br);border-radius:4px;font-size:13px;box-sizing:border-box;color:var(--t);">
              </div>
              <div>
                <label style="font-size:10px;color:var(--m);">Overhead Mult.</label>
                <input id="pm-labor-overhead" type="number" step="0.01" value="${p?.labor?.overheadMultiplier || 1.35}" style="width:100%;padding:6px;background:var(--s2);border:1px solid var(--br);border-radius:4px;font-size:13px;box-sizing:border-box;color:var(--t);">
              </div>
              <div>
                <label style="font-size:10px;color:var(--m);">Profit Margin %</label>
                <input id="pm-labor-profit" type="number" step="1" value="${p?.labor?.profitMarginPct || 25}" style="width:100%;padding:6px;background:var(--s2);border:1px solid var(--br);border-radius:4px;font-size:13px;box-sizing:border-box;color:var(--t);">
              </div>
            </div>
          </div>

          <!-- Colors, Warranty, Tags -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--m);margin-bottom:3px;">Colors (comma-separated)</label>
              <input id="pm-colors" type="text" value="${escapeHtml((p?.colors || []).join(', '))}" style="width:100%;padding:8px 10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;font-size:13px;box-sizing:border-box;color:var(--t);" placeholder="Charcoal, Weathered Wood, ...">
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--m);margin-bottom:3px;">Warranty</label>
              <input id="pm-warranty" type="text" value="${escapeHtml(p?.warranty || '')}" style="width:100%;padding:8px 10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;font-size:13px;box-sizing:border-box;color:var(--t);">
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--m);margin-bottom:3px;">Tags (comma-separated)</label>
              <input id="pm-tags" type="text" value="${escapeHtml((p?.tags || []).join(', '))}" style="width:100%;padding:8px 10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;font-size:13px;box-sizing:border-box;color:var(--t);">
            </div>
            <div>
              <label style="display:block;font-size:11px;font-weight:600;color:var(--m);margin-bottom:3px;">Default Qty</label>
              <input id="pm-defaultqty" type="number" value="${p?.defaultQty || 1}" style="width:100%;padding:8px 10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;font-size:13px;box-sizing:border-box;color:var(--t);">
            </div>
          </div>

          <!-- Notes -->
          <div>
            <label style="display:block;font-size:11px;font-weight:600;color:var(--m);margin-bottom:3px;">Notes</label>
            <textarea id="pm-notes" rows="2" style="width:100%;padding:8px 10px;background:var(--s2);border:1px solid var(--br);border-radius:6px;font-size:13px;box-sizing:border-box;resize:vertical;color:var(--t);">${escapeHtml(p?.notes || '')}</textarea>
          </div>

          <!-- Actions -->
          <div style="display:flex;justify-content:space-between;padding-top:12px;border-top:1px solid var(--br);">
            ${p ? '<button onclick="window._productLib.deleteFromModal()" style="padding:8px 16px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">Delete</button>' : '<div></div>'}
            <div style="display:flex;gap:8px;">
              <button onclick="window._productLib.closeModal()" style="padding:8px 16px;background:var(--s2);color:var(--t);border:none;border-radius:6px;cursor:pointer;font-size:13px;">Cancel</button>
              <button onclick="window._productLib.saveFromModal()" style="padding:8px 20px;background:#e8720c;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;">${p ? 'Update' : 'Add Product'}</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    // Trigger initial margin calc
    setTimeout(recalcModalMargins, 0);
  }

  function closeModal() {
    const m = document.getElementById('product-edit-modal');
    if (m) m.remove();
    editingProduct = null;
  }

  function recalcModalMargins() {
    const labor = parseFloat(document.getElementById('pm-labor-perunit')?.value) || 0;
    const warnings = [];
    TIERS.forEach(t => {
      const sell = parseFloat(document.getElementById('pm-sell-' + t)?.value) || 0;
      const mat = parseFloat(document.getElementById('pm-cost-' + t)?.value) || 0;
      const myCost = mat + labor;
      const el = document.getElementById('pm-margin-' + t);
      if (!el) return;
      if (sell <= 0) { el.innerHTML = '<span style="color:var(--m);">—</span>'; return; }
      const m = Math.round(((sell - myCost) / sell) * 100);
      const profit = sell - myCost;
      const color = sell <= myCost ? '#ef4444' : m < 25 ? '#f59e0b' : '#10b981';
      el.innerHTML = '<span style="color:' + color + ';">' + m + '% ($' + profit.toFixed(2) + ')</span>';
      if (sell <= myCost) warnings.push(TIER_LABELS[t] + ' sell ($' + sell + ') is at or below cost ($' + myCost.toFixed(2) + ')');
    });
    const warnEl = document.getElementById('pm-margin-warnings');
    if (warnEl) {
      warnEl.innerHTML = warnings.map(w => '<div style="font-size:11px;color:#ef4444;padding:4px 8px;background:#ef444415;border-radius:4px;margin-bottom:4px;">⚠️ ' + w + '</div>').join('');
    }
  }

  function saveFromModal() {
    const name = document.getElementById('pm-name').value.trim();
    if (!name) { showToast('Product name is required', 'error'); return; }

    // Validate: no tier sells below cost
    const laborVal = parseFloat(document.getElementById('pm-labor-perunit')?.value) || 0;
    const belowCost = [];
    TIERS.forEach(t => {
      const sell = parseFloat(document.getElementById('pm-sell-' + t)?.value) || 0;
      const mat = parseFloat(document.getElementById('pm-cost-' + t)?.value) || 0;
      if (sell > 0 && sell <= mat + laborVal) belowCost.push(TIER_LABELS[t]);
    });
    if (belowCost.length && !confirm('Warning: ' + belowCost.join(', ') + ' tier(s) have sell price at or below cost. Save anyway?')) return;

    const product = editingProduct ? { ...editingProduct } : {};
    product.name = name;
    product.manufacturer = document.getElementById('pm-manufacturer').value.trim();
    product.category = document.getElementById('pm-category').value;
    product.unit = document.getElementById('pm-unit').value;
    product.sku = document.getElementById('pm-sku').value.trim();
    product.description = document.getElementById('pm-description').value.trim();
    product.warranty = document.getElementById('pm-warranty').value.trim();
    product.defaultQty = parseInt(document.getElementById('pm-defaultqty').value) || 1;
    product.notes = document.getElementById('pm-notes').value.trim();
    product.section = catLabel(product.category);
    product.isActive = true;

    // Colors & Tags
    const colorsRaw = document.getElementById('pm-colors').value;
    product.colors = colorsRaw ? colorsRaw.split(',').map(c => c.trim()).filter(Boolean) : [];
    const tagsRaw = document.getElementById('pm-tags').value;
    product.tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];

    // Pricing
    product.pricing = {};
    TIERS.forEach(t => {
      product.pricing[t] = {
        sell: parseFloat(document.getElementById(`pm-sell-${t}`).value) || 0,
        cost: parseFloat(document.getElementById(`pm-cost-${t}`).value) || 0
      };
    });

    // Labor
    product.labor = {
      perUnit: parseFloat(document.getElementById('pm-labor-perunit').value) || 0,
      ratePerManHour: parseFloat(document.getElementById('pm-labor-rate').value) || 0,
      crewSize: parseInt(document.getElementById('pm-labor-crew').value) || 0,
      hoursPerUnit: parseFloat(document.getElementById('pm-labor-hours').value) || 0,
      overheadMultiplier: parseFloat(document.getElementById('pm-labor-overhead').value) || 1.35,
      profitMarginPct: parseFloat(document.getElementById('pm-labor-profit').value) || 25
    };

    saveProduct(product);
    closeModal();
    showToast(editingProduct ? 'Product updated' : 'Product added', 'success');
    reRender();
  }

  function deleteFromModal() {
    if (editingProduct && confirm('Delete this product?')) {
      hardDeleteProduct(editingProduct.id);
      closeModal();
      showToast('Product deleted', 'success');
      reRender();
    }
  }

  // ============================================================================
  // ACTIONS
  // ============================================================================

  function archiveProductFromUI(id) {
    if (confirm('Archive this product?')) {
      deleteProduct(id);
      showToast('Product archived', 'success');
      reRender();
    }
  }

  function setFilter(category, search) {
    if (category !== undefined) currentFilter.category = category;
    if (search !== undefined) currentFilter.search = search;
    reRender();
  }

  function setTierFilter(tier) {
    currentFilter.tier = tier;
    reRender();
  }

  function toggleCategory(catId) {
    collapsedCategories[catId] = !collapsedCategories[catId];
    reRender();
  }

  function reRender() {
    const container = document.getElementById('product-library-container') || document.getElementById('productLibraryContainer');
    if (container) container.innerHTML = render();
  }

  function resetToDefaults() {
    if (confirm('Reset all products to defaults? Your customizations will be lost.')) {
      seedDefaults();
      showToast('Products reset to defaults', 'success');
      reRender();
    }
  }

  function exportProductsCSV() {
    const active = products.filter(p => p.isActive !== false);
    const rows = [['Name','Category','Unit','Good Sell','Good Cost','Better Sell','Better Cost','Best Sell','Best Cost','Labor/Unit','Manufacturer','Warranty','Colors','Tags']];
    active.forEach(p => {
      rows.push([
        p.name, catLabel(p.category), p.unit,
        p.pricing?.good?.sell, p.pricing?.good?.cost,
        p.pricing?.better?.sell, p.pricing?.better?.cost,
        p.pricing?.best?.sell, p.pricing?.best?.cost,
        p.labor?.perUnit || 0,
        p.manufacturer || '', p.warranty || '',
        (p.colors || []).join('; '), (p.tags || []).join('; ')
      ]);
    });
    const csv = rows.map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nbd_products_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    showToast('CSV exported', 'success');
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  window._productLib = {
    render,
    load: loadProducts,
    save: saveProduct,
    delete: deleteProduct,
    hardDelete: hardDeleteProduct,
    search: searchProducts,
    exportCSV: exportProductsCSV,
    resetDefaults: resetToDefaults,
    openModal,
    closeModal,
    recalcModalMargins,
    editProduct: openModal,
    addProduct: () => openModal(null),
    saveFromModal,
    deleteFromModal,
    archiveProduct: archiveProductFromUI,
    setFilter,
    setTierFilter,
    toggleCategory,
    getProducts: () => products.filter(p => p.isActive !== false),
    getStats: () => ({
      total: products.filter(p => p.isActive !== false).length,
      categories: new Set(products.filter(p => p.isActive !== false).map(p => p.category)).size,
      avgMargin: Math.round(
        products.filter(p => p.isActive !== false).reduce((s, p) => s + grossMargin(p.pricing?.better?.sell || 0, p.pricing?.better?.cost || 0, p.labor?.perUnit || 0), 0) /
        Math.max(products.filter(p => p.isActive !== false).length, 1)
      )
    })
  };

  window.renderProductLibrary = render;

  // Auto-load
  loadProducts();

})();
