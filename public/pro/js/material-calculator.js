/**
 * NBD Pro Roofing Material Calculator
 * Calculates exact material quantities, pricing, and exports for roofing estimates
 * Supports: shingle replacement, full tear-off, flat roof, metal roof, gutters
 */

(function() {
  'use strict';

  const MaterialCalculator = {
    // Default pricing per unit (loads from window._productLibrary if available)
    defaultPrices: {
      'shingle_3tab_bundle': 32,
      'shingle_arch_bundle': 42,
      'underlayment_roll': 28,
      'ice_water_shield_roll': 55,
      'drip_edge_10ft': 8,
      'ridge_cap_bundle': 48,
      'starter_strip': 18,
      'flashing_kit': 35,
      'pipe_boot': 12,
      'nails_box': 45,
      'ridge_vent_4ft': 16,
      'gutter_10ft': 14,
      'downspout_10ft': 10
    },

    // Wastage factors by complexity level
    wastageFactors: {
      simple: 0.10,
      moderate: 0.15,
      complex: 0.20,
      extreme: 0.25
    },

    // Material specs per square (100 sq ft)
    materialSpecs: {
      shingles_per_square: 3,
      underlayment_squares: 4,
      pipe_boots_minimum: 2,
      nails_per_10_squares: 1
    },

    /**
     * Get current pricing - merges defaults with window library if available
     */
    getPricing: function() {
      let prices = Object.assign({}, this.defaultPrices);

      if (window._productLibrary && typeof window._productLibrary === 'object') {
        Object.assign(prices, window._productLibrary);
      } else if (window._supplierPrices && typeof window._supplierPrices === 'object') {
        Object.assign(prices, window._supplierPrices);
      }

      return prices;
    },

    /**
     * Calculate linear feet estimate from squares
     * Assumes roughly square roof: perimeter = 4 * sqrt(squares * 100)
     */
    estimateLinearFeet: function(squares) {
      return Math.ceil(Math.sqrt(squares * 100) * 4);
    },

    /**
     * Main calculation engine
     * @param {Object} config - { squares, pitch, jobType, complexity, shingleType }
     * @returns {Object} { materials[], subtotal, tax, total, wastageApplied }
     */
    calculateMaterials: function(config) {
      const {
        squares = 10,
        pitch = '6/12',
        jobType = 'shingle_replacement',
        complexity = 'moderate',
        shingleType = 'shingle_3tab_bundle'
      } = config;

      const prices = this.getPricing();
      const wastage = this.wastageFactors[complexity] || this.wastageFactors.moderate;
      const materials = [];
      let subtotal = 0;

      // Pitch factor: higher pitch = more material needed (affects shingles primarily)
      const pitchFactor = this.calculatePitchFactor(pitch);

      // ===== SHINGLES/BUNDLES =====
      let shingleQuantity = Math.ceil(
        squares * this.materialSpecs.shingles_per_square * pitchFactor
      );
      shingleQuantity = Math.ceil(shingleQuantity * (1 + wastage));

      materials.push({
        category: 'Shingles',
        name: shingleType === 'shingle_3tab_bundle' ? '3-Tab Shingle Bundles' : 'Architectural Shingle Bundles',
        sku: shingleType,
        unit: 'bundles',
        quantity: shingleQuantity,
        unitPrice: prices[shingleType],
        lineTotal: shingleQuantity * prices[shingleType]
      });
      subtotal += materials[materials.length - 1].lineTotal;

      // ===== UNDERLAYMENT =====
      if (['shingle_replacement', 'full_tearoff', 'metal_roof'].includes(jobType)) {
        let underlaymentQuantity = Math.ceil(squares / this.materialSpecs.underlayment_squares);
        underlaymentQuantity = Math.ceil(underlaymentQuantity * (1 + wastage));

        materials.push({
          category: 'Underlayment',
          name: 'Underlayment Roll',
          sku: 'underlayment_roll',
          unit: 'rolls',
          quantity: underlaymentQuantity,
          unitPrice: prices['underlayment_roll'],
          lineTotal: underlaymentQuantity * prices['underlayment_roll']
        });
        subtotal += materials[materials.length - 1].lineTotal;
      }

      // ===== ICE & WATER SHIELD =====
      if (['shingle_replacement', 'full_tearoff'].includes(jobType)) {
        const linearFeet = this.estimateLinearFeet(squares);
        // 1 roll per 10 linear feet of eaves
        let iceWaterQuantity = Math.ceil(linearFeet / 10);
        iceWaterQuantity = Math.ceil(iceWaterQuantity * (1 + wastage * 0.5)); // Less wastage on ice shield

        materials.push({
          category: 'Ice & Water Protection',
          name: 'Ice & Water Shield Roll',
          sku: 'ice_water_shield_roll',
          unit: 'rolls',
          quantity: iceWaterQuantity,
          unitPrice: prices['ice_water_shield_roll'],
          lineTotal: iceWaterQuantity * prices['ice_water_shield_roll']
        });
        subtotal += materials[materials.length - 1].lineTotal;
      }

      // ===== DRIP EDGE =====
      if (['shingle_replacement', 'full_tearoff', 'metal_roof'].includes(jobType)) {
        const linearFeet = this.estimateLinearFeet(squares);
        let dripEdgeQuantity = Math.ceil(linearFeet / 10); // 10ft per unit
        dripEdgeQuantity = Math.ceil(dripEdgeQuantity * (1 + wastage));

        materials.push({
          category: 'Edging & Trim',
          name: 'Drip Edge (10ft)',
          sku: 'drip_edge_10ft',
          unit: 'units',
          quantity: dripEdgeQuantity,
          unitPrice: prices['drip_edge_10ft'],
          lineTotal: dripEdgeQuantity * prices['drip_edge_10ft']
        });
        subtotal += materials[materials.length - 1].lineTotal;
      }

      // ===== RIDGE CAP =====
      if (['shingle_replacement', 'full_tearoff'].includes(jobType)) {
        const linearFeet = this.estimateLinearFeet(squares);
        // 1 bundle per 33 linear feet of ridge
        let ridgeCapQuantity = Math.ceil(linearFeet / 33);
        ridgeCapQuantity = Math.ceil(ridgeCapQuantity * (1 + wastage));

        materials.push({
          category: 'Ridge & Hip',
          name: 'Ridge Cap Bundle',
          sku: 'ridge_cap_bundle',
          unit: 'bundles',
          quantity: ridgeCapQuantity,
          unitPrice: prices['ridge_cap_bundle'],
          lineTotal: ridgeCapQuantity * prices['ridge_cap_bundle']
        });
        subtotal += materials[materials.length - 1].lineTotal;
      }

      // ===== STARTER STRIP =====
      if (['shingle_replacement', 'full_tearoff', 'metal_roof'].includes(jobType)) {
        const linearFeet = this.estimateLinearFeet(squares);
        let starterQuantity = Math.ceil(linearFeet / 10);
        starterQuantity = Math.ceil(starterQuantity * (1 + wastage));

        materials.push({
          category: 'Starter & Trim',
          name: 'Starter Strip',
          sku: 'starter_strip',
          unit: 'units',
          quantity: starterQuantity,
          unitPrice: prices['starter_strip'],
          lineTotal: starterQuantity * prices['starter_strip']
        });
        subtotal += materials[materials.length - 1].lineTotal;
      }

      // ===== FLASHING =====
      if (['shingle_replacement', 'full_tearoff', 'metal_roof'].includes(jobType)) {
        materials.push({
          category: 'Flashing & Penetrations',
          name: 'Flashing Kit',
          sku: 'flashing_kit',
          unit: 'kits',
          quantity: 1,
          unitPrice: prices['flashing_kit'],
          lineTotal: prices['flashing_kit']
        });
        subtotal += materials[materials.length - 1].lineTotal;
      }

      // ===== PIPE BOOTS =====
      if (['shingle_replacement', 'full_tearoff', 'metal_roof'].includes(jobType)) {
        let bootQuantity = Math.max(this.materialSpecs.pipe_boots_minimum, Math.ceil(squares / 20));

        materials.push({
          category: 'Flashing & Penetrations',
          name: 'Pipe Boot',
          sku: 'pipe_boot',
          unit: 'units',
          quantity: bootQuantity,
          unitPrice: prices['pipe_boot'],
          lineTotal: bootQuantity * prices['pipe_boot']
        });
        subtotal += materials[materials.length - 1].lineTotal;
      }

      // ===== NAILS =====
      let nailsQuantity = Math.ceil(squares / 10 * this.materialSpecs.nails_per_10_squares);
      if (complexity !== 'simple') {
        nailsQuantity = Math.ceil(nailsQuantity * 1.3); // Extra nails for complex jobs
      }

      materials.push({
        category: 'Fasteners',
        name: 'Nails (Box)',
        sku: 'nails_box',
        unit: 'boxes',
        quantity: nailsQuantity,
        unitPrice: prices['nails_box'],
        lineTotal: nailsQuantity * prices['nails_box']
      });
      subtotal += materials[materials.length - 1].lineTotal;

      // ===== RIDGE VENT =====
      if (['shingle_replacement', 'full_tearoff'].includes(jobType)) {
        const linearFeet = this.estimateLinearFeet(squares);
        let ventQuantity = Math.ceil(linearFeet / 4 / 4); // 4ft sections

        materials.push({
          category: 'Ventilation',
          name: 'Ridge Vent (4ft)',
          sku: 'ridge_vent_4ft',
          unit: 'units',
          quantity: ventQuantity,
          unitPrice: prices['ridge_vent_4ft'],
          lineTotal: ventQuantity * prices['ridge_vent_4ft']
        });
        subtotal += materials[materials.length - 1].lineTotal;
      }

      // ===== GUTTERS =====
      if (['shingle_replacement', 'full_tearoff', 'gutters'].includes(jobType)) {
        const linearFeet = this.estimateLinearFeet(squares);
        let gutterQuantity = Math.ceil(linearFeet / 10);

        materials.push({
          category: 'Gutters & Drainage',
          name: 'Gutter (10ft)',
          sku: 'gutter_10ft',
          unit: 'sections',
          quantity: gutterQuantity,
          unitPrice: prices['gutter_10ft'],
          lineTotal: gutterQuantity * prices['gutter_10ft']
        });
        subtotal += materials[materials.length - 1].lineTotal;
      }

      // ===== DOWNSPOUTS =====
      if (['shingle_replacement', 'full_tearoff', 'gutters'].includes(jobType)) {
        let downspoutQuantity = Math.max(2, Math.ceil(this.estimateLinearFeet(squares) / 30));

        materials.push({
          category: 'Gutters & Drainage',
          name: 'Downspout (10ft)',
          sku: 'downspout_10ft',
          unit: 'sections',
          quantity: downspoutQuantity,
          unitPrice: prices['downspout_10ft'],
          lineTotal: downspoutQuantity * prices['downspout_10ft']
        });
        subtotal += materials[materials.length - 1].lineTotal;
      }

      // Tax calculation (simple 7% default, can vary by region)
      const taxRate = 0.07;
      const tax = Math.round(subtotal * taxRate * 100) / 100;
      const total = Math.round((subtotal + tax) * 100) / 100;

      return {
        materials,
        subtotal: Math.round(subtotal * 100) / 100,
        tax,
        total,
        wastageApplied: (wastage * 100).toFixed(0),
        config: { squares, pitch, jobType, complexity, shingleType }
      };
    },

    /**
     * Pitch factor for material adjustment
     * Steeper pitch = more surface area
     */
    calculatePitchFactor: function(pitch) {
      const pitchMap = {
        '3/12': 1.05,
        '4/12': 1.10,
        '5/12': 1.15,
        '6/12': 1.20,
        '7/12': 1.25,
        '8/12': 1.30,
        '9/12': 1.35,
        '10/12': 1.42,
        '12/12': 1.50
      };
      return pitchMap[pitch] || 1.20;
    },

    /**
     * Render interactive calculator UI
     */
    renderCalculatorPanel: function(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return console.error('Container not found:', containerId);

      container.innerHTML = `
        <div style="
          background: var(--s, #1a1a2e);
          border: 1px solid var(--br, rgba(255,255,255,.08));
          border-radius: 8px;
          padding: 24px;
          color: var(--m, #9ca3af);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        ">
          <h2 style="
            color: white;
            margin: 0 0 20px 0;
            font-size: 18px;
            font-weight: 600;
          ">Roofing Material Calculator</h2>

          <form id="calcForm" style="display: grid; gap: 16px;">
            <!-- Roof Squares -->
            <div>
              <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500;">
                Roof Squares (100 sq ft each)
              </label>
              <input type="number" id="squares" name="squares" value="10" min="1" max="500"
                style="
                  width: 100%;
                  padding: 10px;
                  background: rgba(255,255,255,.05);
                  border: 1px solid var(--br, rgba(255,255,255,.08));
                  border-radius: 4px;
                  color: white;
                  font-size: 14px;
                  box-sizing: border-box;
                " />
            </div>

            <!-- Roof Pitch -->
            <div>
              <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500;">
                Roof Pitch
              </label>
              <select id="pitch" name="pitch"
                style="
                  width: 100%;
                  padding: 10px;
                  background: rgba(255,255,255,.05);
                  border: 1px solid var(--br, rgba(255,255,255,.08));
                  border-radius: 4px;
                  color: white;
                  font-size: 14px;
                  box-sizing: border-box;
                ">
                <option value="3/12">3/12 (Low)</option>
                <option value="4/12">4/12</option>
                <option value="5/12">5/12</option>
                <option value="6/12" selected>6/12 (Standard)</option>
                <option value="7/12">7/12</option>
                <option value="8/12">8/12</option>
                <option value="9/12">9/12</option>
                <option value="10/12">10/12</option>
                <option value="12/12">12/12 (Steep)</option>
              </select>
            </div>

            <!-- Job Type -->
            <div>
              <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500;">
                Job Type
              </label>
              <select id="jobType" name="jobType"
                style="
                  width: 100%;
                  padding: 10px;
                  background: rgba(255,255,255,.05);
                  border: 1px solid var(--br, rgba(255,255,255,.08));
                  border-radius: 4px;
                  color: white;
                  font-size: 14px;
                  box-sizing: border-box;
                ">
                <option value="shingle_replacement" selected>Shingle Replacement</option>
                <option value="full_tearoff">Full Tear-Off</option>
                <option value="flat_roof">Flat Roof</option>
                <option value="metal_roof">Metal Roof</option>
                <option value="gutters">Gutters Only</option>
              </select>
            </div>

            <!-- Complexity -->
            <div>
              <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500;">
                Roof Complexity
              </label>
              <select id="complexity" name="complexity"
                style="
                  width: 100%;
                  padding: 10px;
                  background: rgba(255,255,255,.05);
                  border: 1px solid var(--br, rgba(255,255,255,.08));
                  border-radius: 4px;
                  color: white;
                  font-size: 14px;
                  box-sizing: border-box;
                ">
                <option value="simple">Simple (10% wastage)</option>
                <option value="moderate" selected>Moderate (15% wastage)</option>
                <option value="complex">Complex (20% wastage)</option>
                <option value="extreme">Extreme (25% wastage)</option>
              </select>
            </div>

            <!-- Shingle Type -->
            <div>
              <label style="display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500;">
                Shingle Type
              </label>
              <select id="shingleType" name="shingleType"
                style="
                  width: 100%;
                  padding: 10px;
                  background: rgba(255,255,255,.05);
                  border: 1px solid var(--br, rgba(255,255,255,.08));
                  border-radius: 4px;
                  color: white;
                  font-size: 14px;
                  box-sizing: border-box;
                ">
                <option value="shingle_3tab_bundle" selected>3-Tab Shingle ($32/bundle)</option>
                <option value="shingle_arch_bundle">Architectural ($42/bundle)</option>
              </select>
            </div>

            <!-- Calculate Button -->
            <button type="button" id="calcBtn" style="
              background: #C8541A;
              color: white;
              border: none;
              padding: 12px;
              border-radius: 4px;
              font-size: 14px;
              font-weight: 600;
              cursor: pointer;
              margin-top: 10px;
              transition: background 200ms;
            ">
              Calculate Materials
            </button>
          </form>

          <div id="resultsContainer"></div>
        </div>
      `;

      document.getElementById('calcBtn').addEventListener('click', (e) => {
        e.preventDefault();
        const config = {
          squares: parseFloat(document.getElementById('squares').value) || 10,
          pitch: document.getElementById('pitch').value,
          jobType: document.getElementById('jobType').value,
          complexity: document.getElementById('complexity').value,
          shingleType: document.getElementById('shingleType').value
        };

        const result = MaterialCalculator.calculateMaterials(config);
        MaterialCalculator.renderResults(result, 'resultsContainer');
      });
    },

    /**
     * Render detailed material breakdown
     */
    renderResults: function(result, containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;

      let html = `
        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid var(--br, rgba(255,255,255,.08));">
          <h3 style="color: white; margin: 0 0 16px 0; font-size: 16px;">Material Breakdown</h3>
          <table style="
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
          ">
            <thead>
              <tr style="border-bottom: 1px solid var(--br, rgba(255,255,255,.08));">
                <th style="text-align: left; padding: 10px; color: white; font-weight: 600;">Item</th>
                <th style="text-align: center; padding: 10px; color: white; font-weight: 600;">Qty</th>
                <th style="text-align: right; padding: 10px; color: white; font-weight: 600;">Unit Price</th>
                <th style="text-align: right; padding: 10px; color: white; font-weight: 600;">Total</th>
              </tr>
            </thead>
            <tbody>
      `;

      let currentCategory = null;
      result.materials.forEach(mat => {
        if (mat.category !== currentCategory) {
          currentCategory = mat.category;
          html += `
            <tr>
              <td colspan="4" style="
                padding: 12px 10px 8px 10px;
                color: #C8541A;
                font-weight: 600;
                font-size: 12px;
              ">${currentCategory}</td>
            </tr>
          `;
        }

        html += `
          <tr style="border-bottom: 1px solid var(--br, rgba(255,255,255,.08));">
            <td style="padding: 10px; color: var(--m, #9ca3af);">${mat.name}</td>
            <td style="text-align: center; padding: 10px; color: white; font-weight: 500;">${mat.quantity}</td>
            <td style="text-align: right; padding: 10px; color: var(--m, #9ca3af);">$${mat.unitPrice.toFixed(2)}</td>
            <td style="text-align: right; padding: 10px; color: white; font-weight: 500;">$${mat.lineTotal.toFixed(2)}</td>
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>

          <div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--br, rgba(255,255,255,.08));">
            <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
              <span style="color: var(--m, #9ca3af);">Subtotal:</span>
              <span style="color: white; font-weight: 500;">$${result.subtotal.toFixed(2)}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 12px;">
              <span style="color: var(--m, #9ca3af);">Tax (7%):</span>
              <span style="color: white; font-weight: 500;">$${result.tax.toFixed(2)}</span>
            </div>
            <div style="
              display: flex;
              justify-content: space-between;
              padding: 12px;
              background: rgba(200, 84, 26, 0.1);
              border-radius: 4px;
              border: 1px solid rgba(200, 84, 26, 0.3);
            ">
              <span style="color: #C8541A; font-weight: 600;">Estimated Total:</span>
              <span style="color: #C8541A; font-weight: 700; font-size: 16px;">$${result.total.toFixed(2)}</span>
            </div>
            <p style="
              margin-top: 12px;
              font-size: 12px;
              color: var(--m, #9ca3af);
              text-align: center;
            ">
              Wastage Factor: ${result.wastageApplied}% | Pitch: ${result.config.pitch}
            </p>
          </div>
        </div>
      `;

      container.innerHTML = html;
    },

    /**
     * Export material list for estimate creation
     */
    exportMaterialList: function(config) {
      const result = this.calculateMaterials(config);

      return {
        estimateData: {
          materials: result.materials.map(m => ({
            name: m.name,
            category: m.category,
            sku: m.sku,
            quantity: m.quantity,
            unit: m.unit,
            unitPrice: m.unitPrice,
            lineTotal: m.lineTotal
          })),
          pricing: {
            subtotal: result.subtotal,
            tax: result.tax,
            total: result.total,
            taxRate: 0.07
          },
          jobDetails: result.config
        },
        // CSV-ready format
        csvLines: [
          'Item,Category,SKU,Quantity,Unit,Unit Price,Line Total',
          ...result.materials.map(m =>
            `"${m.name}","${m.category}","${m.sku}",${m.quantity},${m.unit},$${m.unitPrice.toFixed(2)},$${m.lineTotal.toFixed(2)}`
          ),
          '',
          `SUBTOTAL,,,,,,$${result.subtotal.toFixed(2)}`,
          `TAX (7%),,,,,,$${result.tax.toFixed(2)}`,
          `TOTAL,,,,,,$${result.total.toFixed(2)}`
        ].join('\n')
      };
    }
  };

  // Expose globally
  window.MaterialCalculator = MaterialCalculator;

})();
