// ============================================================
// NBD Pro — RoofIVent Premium Ventilation Catalog
//
// Source: shop.roofivent.com (scraped April 2026)
//         roofivent.com/download/ (datasheets + FL47016 evaluation reports)
//
// Pricing model:
//   sell = MSRP from shop.roofivent.com
//   cost = dealer contractor pricing (~55% of MSRP)
//   labor = $35/hr × install time per unit
//
// Joe is the exclusive NBD distributor — RoofIVent lives on the
// BEST tier system only (plus a la carte for supplements).
//
// 60-year lifetime warranty on every product.
// FL-approved (product approval FL47016) for hurricane zones.
//
// The catalog auto-loads into window.NBD_PRODUCTS when this
// script is included after product-data.js.
// ============================================================

(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  window.NBD_PRODUCTS = window.NBD_PRODUCTS || [];

  // ── Install profile variants (shared across most vent families) ──
  const INSTALL_VARIANTS = [
    { key: 'pg',    label: 'Shingle / Slate / Shake Installation',     sku: 'PG',       profile: 'shingle',       skuPrintable: 'PG',     colors: ['Black','Graphite','Light Gray','Brown','Clay','Weather Wood'] },
    { key: 'pi',    label: 'Metal Standing Seam or Snap Lock',         sku: 'PI',       profile: 'metal_ss',      skuPrintable: 'PI',     colors: ['Black','Graphite','Light Gray','Brown','Clay'] },
    { key: 'mb34',  label: 'Metal Exposed Fastener — 3/4" Rib Profile',sku: 'MB3-4',    profile: 'metal_rib34',   skuPrintable: 'MB3/4',  colors: ['Black','Graphite','Light Gray','Brown','Clay','Dark Brown'] },
    { key: 'mb114', label: 'Metal Exposed Fastener — 1 1/4" Rib Profile',sku:'MB1-1-4', profile: 'metal_rib114',  skuPrintable: 'MB1,1/4',colors: ['Black','Graphite','Light Gray','Brown','Clay','Dark Brown'] }
  ];

  // ── Shared default labor values ──
  const LABOR_DEFAULTS = {
    ratePerManHour: 35,
    crewSize: 1,
    overheadMultiplier: 1.35,
    profitMarginPct: 25
  };

  function makeLabor(hoursPerUnit) {
    const perUnit = Math.round(hoursPerUnit * LABOR_DEFAULTS.ratePerManHour);
    return Object.assign({ perUnit, hoursPerUnit }, LABOR_DEFAULTS);
  }

  function makePricing(sell) {
    // Contractor cost ≈ 55% of MSRP
    const cost = Math.round(sell * 0.55);
    return {
      good:   { sell, cost },
      better: { sell, cost },
      best:   { sell, cost }
    };
  }

  function makeEntry(family, variant, opts) {
    opts = opts || {};
    const id = `riv_${family.base}_${variant.key}${opts.idSuffix || ''}`;
    const name = `${family.brand} ${family.name} — ${variant.label}${opts.sizeSuffix || ''}`;
    const skuFull = `${family.skuPrefix}-${variant.sku}${opts.skuSuffix || ''}`;
    const hours = opts.hoursPerUnit || family.hoursPerUnit;
    const sell = opts.sell != null ? opts.sell : family.sell;
    return {
      id,
      name,
      description: family.description,
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      coverage: { perUnit: opts.coveragePerUnit || family.coverage || '1 vent per fixture' },
      defaultQty: family.defaultQty || 1,
      colors: variant.colors,
      styles: [family.style || 'Roof Vent'],
      sizes: opts.sizes || family.sizes || ['Standard'],
      pricing: makePricing(sell),
      labor: makeLabor(hours),
      manufacturer: 'RoofIVent',
      sku: skuFull,
      warranty: '60-year lifetime warranty (FL47016 Product Approval)',
      isActive: true,
      isDefault: false,
      sortOrder: family.sortOrder + (opts.sortBump || 0),
      tags: (family.tags || []).concat(['roofivent','premium','best-tier', variant.profile]),
      notes: family.notes || 'Premium ventilation — included on Best-tier systems.'
    };
  }

  // ═════════════════════════════════════════════════════════
  // PRODUCT FAMILIES
  // ═════════════════════════════════════════════════════════

  const FAMILIES = [
    // ── iVENT FLOW — Low-profile attic vent (static) ──
    {
      base: 'flow',
      brand: 'RoofIVent',
      name: 'iVENT FLOW',
      description: 'Low-profile attic exhaust vent. UV-stable pure polypropylene, hail-toughened. Can be used as exhaust or intake. Built-in condensation drain + bubble level.',
      skuPrefix: 'WP-2-10',
      sell: 38,
      hoursPerUnit: 0.5,
      style: 'Static Low-Profile Attic Vent',
      defaultQty: 6,
      sortOrder: 200,
      tags: ['vent','attic','low-profile','static'],
      notes: 'Recommended spacing: 1 vent per 300 SF of attic. Compatible with 4"/5"/6" systems.'
    },

    // ── iVENT ECO — Kitchen/Bath/Dryer exhaust (static) ──
    {
      base: 'eco',
      brand: 'RoofIVent',
      name: 'iVENT ECO',
      description: 'Natural airflow kitchen, bathroom and dryer roof exhaust vent. Aligns with roof slope for iFLEX pipe click-in connection. Built-in bubble level + condensation drain.',
      skuPrefix: 'EL',
      sell: 88,            // 4" and 5"
      sell6: 105,          // 6" variant
      hoursPerUnit: 0.6,
      style: 'Static Kitchen / Bath / Dryer Vent',
      sizes: ['4"','5"','6"'],
      defaultQty: 1,
      sortOrder: 210,
      tags: ['vent','kitchen','bathroom','dryer','static']
    },

    // ── iVENT ROTO ROUND (6") — Active kitchen/bath turbine ──
    {
      base: 'roto_round_6',
      brand: 'RoofIVent',
      name: 'iVENT ROTO ROUND 6"',
      description: 'Active wind-powered kitchen and bathroom roof exhaust. Round turbine with encapsulated dual-bearing system in oil for silent operation. Adjustable to slopes 1:12 – 12:12.',
      skuPrefix: 'RLK-6',
      sell: 135,
      hoursPerUnit: 0.75,
      style: 'Active Turbine Kitchen / Bath Vent',
      sizes: ['6"'],
      defaultQty: 1,
      sortOrder: 220,
      tags: ['vent','kitchen','bathroom','turbine','active','round']
    },

    // ── iVENT ROTO OBLONG (6") — Active kitchen/bath turbine, oblong ──
    {
      base: 'roto_oblong_6',
      brand: 'RoofIVent',
      name: 'iVENT ROTO OBLONG 6"',
      description: 'Active oblong-profile kitchen/bath turbine vent. Same encapsulated bearing system as round, lower visual profile for finicky adjusters. Adjustable 1:12 – 12:12.',
      skuPrefix: 'RLP-6',
      sell: 135,
      hoursPerUnit: 0.75,
      style: 'Active Turbine Kitchen / Bath Vent (Oblong)',
      sizes: ['6"'],
      defaultQty: 1,
      sortOrder: 230,
      tags: ['vent','kitchen','bathroom','turbine','active','oblong']
    },

    // ── iVENT ROTO 8" ROUND — Larger kitchen/bath turbine ──
    {
      base: 'roto_round_8',
      brand: 'RoofIVent',
      name: 'iVENT ROTO 8" ROUND',
      description: 'Heavy-duty 8" active turbine kitchen/bath exhaust for larger fixtures or long duct runs. Same bearing system with higher CFM throughput.',
      skuPrefix: 'RLK-8',
      sell: 212,
      hoursPerUnit: 0.85,
      style: 'Active Turbine 8" Kitchen / Bath Vent',
      sizes: ['8"'],
      defaultQty: 1,
      sortOrder: 240,
      tags: ['vent','kitchen','bathroom','turbine','active','8-inch','round']
    },

    // ── iVENT ROTO 8" OBLONG — Larger oblong turbine ──
    {
      base: 'roto_oblong_8',
      brand: 'RoofIVent',
      name: 'iVENT ROTO 8" OBLONG',
      description: 'Heavy-duty 8" active oblong kitchen/bath turbine exhaust for larger fixtures or commercial kitchens. Lower profile than round 8".',
      skuPrefix: 'RLP-8',
      sell: 212,
      hoursPerUnit: 0.85,
      style: 'Active Turbine 8" Kitchen / Bath Vent (Oblong)',
      sizes: ['8"'],
      defaultQty: 1,
      sortOrder: 250,
      tags: ['vent','kitchen','bathroom','turbine','active','8-inch','oblong']
    },

    // ── iVENT ROTO ATTIC ROUND — Active attic turbine ──
    {
      base: 'roto_attic_round',
      brand: 'RoofIVent',
      name: 'iVENT ROTO ATTIC ROUND',
      description: 'Active wind-powered ATTIC exhaust turbine — round profile. Encapsulated dual-bearing oil system, silent and hail-resistant. Adjustable 1:12 – 12:12.',
      skuPrefix: 'RLK-A',
      sell: 135,
      hoursPerUnit: 0.85,
      style: 'Active Attic Turbine (Round)',
      defaultQty: 2,
      sortOrder: 260,
      tags: ['vent','attic','turbine','active','round']
    },

    // ── iVENT ROTO ATTIC OBLONG — Active attic turbine, oblong ──
    {
      base: 'roto_attic_oblong',
      brand: 'RoofIVent',
      name: 'iVENT ROTO ATTIC OBLONG',
      description: 'Active wind-powered ATTIC exhaust turbine — oblong profile for lower visual impact. Adjustable 1:12 – 12:12. Ideal where HOAs limit turbine height.',
      skuPrefix: 'RLP-A',
      sell: 135,
      hoursPerUnit: 0.85,
      style: 'Active Attic Turbine (Oblong)',
      defaultQty: 2,
      sortOrder: 270,
      tags: ['vent','attic','turbine','active','oblong']
    },

    // ── iVENT ROTO ATTIC 8" ROUND — Larger attic turbine ──
    {
      base: 'roto_attic_round_8',
      brand: 'RoofIVent',
      name: 'iVENT ROTO ATTIC 8" ROUND',
      description: 'Heavy-duty 8" active attic turbine — larger CFM for bigger homes or steep roofs. Same hail-rated polypropylene + encapsulated bearings.',
      skuPrefix: 'RLK-A8',
      sell: 212,
      hoursPerUnit: 1.0,
      style: 'Active Attic Turbine 8" (Round)',
      sizes: ['8"'],
      defaultQty: 1,
      sortOrder: 280,
      tags: ['vent','attic','turbine','active','8-inch','round']
    },

    // ── iVENT ROTO ATTIC 8" OBLONG — Larger oblong attic turbine ──
    {
      base: 'roto_attic_oblong_8',
      brand: 'RoofIVent',
      name: 'iVENT ROTO ATTIC 8" OBLONG',
      description: 'Heavy-duty 8" active attic turbine with oblong profile. High-CFM exhaust for large attics while keeping curb appeal intact.',
      skuPrefix: 'RLP-A8',
      sell: 212,
      hoursPerUnit: 1.0,
      style: 'Active Attic Turbine 8" (Oblong)',
      sizes: ['8"'],
      defaultQty: 1,
      sortOrder: 290,
      tags: ['vent','attic','turbine','active','8-inch','oblong']
    },

    // ── Cable Roof Penetration ──
    {
      base: 'cable_pen',
      brand: 'RoofIVent',
      name: 'Cable Roof Penetration',
      description: 'Waterproof cable penetration flashing for solar, antenna, or service wires. UV-stable polypropylene boot with integrated drip edge.',
      skuPrefix: 'PS-2-01',
      sell: 69,
      hoursPerUnit: 0.5,
      style: 'Roof Penetration Flashing',
      defaultQty: 1,
      sortOrder: 300,
      tags: ['penetration','cable','flashing','solar','antenna']
    },

    // ── Vent Pipe Roof Flashing (PP-1 — standard size) ──
    {
      base: 'pipe_pen_1',
      brand: 'RoofIVent',
      name: 'Vent Pipe Roof Flashing',
      description: 'Waterproof vent pipe / plumbing flashing. Hail-resistant polypropylene body with pivoting collar for roof pitch alignment.',
      skuPrefix: 'PP-1',
      sell: 69,
      hoursPerUnit: 0.4,
      style: 'Pipe Penetration Flashing',
      defaultQty: 4,
      sortOrder: 310,
      tags: ['penetration','pipe','plumbing','flashing','boot']
    },

    // ── Vent Pipe Roof Flashing (PP-2 — oversize) ──
    {
      base: 'pipe_pen_2',
      brand: 'RoofIVent',
      name: 'Vent Pipe Roof Flashing — Oversize',
      description: 'Oversize vent pipe / plumbing flashing for 3-4" plumbing stacks and large ductwork. Same hail-rated polypropylene construction.',
      skuPrefix: 'PP-2',
      sell: 69,
      hoursPerUnit: 0.5,
      style: 'Pipe Penetration Flashing (Oversize)',
      defaultQty: 2,
      sortOrder: 320,
      tags: ['penetration','pipe','plumbing','flashing','oversize']
    }
  ];

  const RIV_CATALOG = [];

  // Expand each family into one entry per install variant
  FAMILIES.forEach(fam => {
    INSTALL_VARIANTS.forEach(variant => {
      RIV_CATALOG.push(makeEntry(fam, variant));
    });

    // Add 6" ECO variant at +$17 upcharge ($105 vs $88)
    if (fam.base === 'eco' && fam.sell6) {
      INSTALL_VARIANTS.forEach(variant => {
        RIV_CATALOG.push(makeEntry(fam, variant, {
          idSuffix: '_6in',
          sizeSuffix: ' · 6"',
          skuSuffix: '-6',
          sell: fam.sell6,
          sizes: ['6"'],
          sortBump: 1
        }));
      });
    }
  });

  // ═════════════════════════════════════════════════════════
  // STANDALONE PRODUCTS (no install variants)
  // ═════════════════════════════════════════════════════════

  const STANDALONE = [
    // ── iVENT TURBO High-Flow Oblong Turbine Cowl ──
    {
      id: 'riv_turbo_cowl',
      name: 'RoofIVent iVENT TURBO High-Flow Oblong Turbine Cowl',
      description: 'Add-on high-flow turbine cowl for kitchen/bath vents. Increases CFM throughput for long duct runs or commercial applications.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      coverage: { perUnit: 'Attaches to existing kitchen/bath vent' },
      defaultQty: 1,
      colors: ['Black','Graphite'],
      styles: ['Turbine Cowl Add-On'],
      sizes: ['Standard','6"'],
      pricing: makePricing(105),
      labor: makeLabor(0.3),
      manufacturer: 'RoofIVent',
      sku: 'IT-COWL-OBL',
      warranty: '60-year lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 400,
      tags: ['vent','turbine','cowl','add-on','high-flow','roofivent','premium'],
      notes: 'Performance upgrade for existing vents. Pairs with any ROTO vent.'
    },

    // ── iVENT TURBO Oblong 6" MF ──
    {
      id: 'riv_turbo_oblong_6_mf',
      name: 'RoofIVent iVENT TURBO Oblong 6" — Multi-Family',
      description: 'Commercial / multi-family grade 6" oblong turbine kitchen/bath exhaust. Heavy-duty build for continuous high-use applications.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      defaultQty: 1,
      colors: ['Black','Graphite','Light Gray','Brown'],
      styles: ['Multi-Family Turbine Vent'],
      sizes: ['6"'],
      pricing: makePricing(115),
      labor: makeLabor(0.85),
      manufacturer: 'RoofIVent',
      sku: 'IT-OBL-6-MF',
      warranty: '60-year lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 410,
      tags: ['vent','turbine','oblong','commercial','multi-family','roofivent','premium']
    },

    // ── iVENT TURBO Round 6" MF ──
    {
      id: 'riv_turbo_round_6_mf',
      name: 'RoofIVent iVENT TURBO Round 6" — Multi-Family',
      description: 'Commercial / multi-family grade 6" round turbine kitchen/bath exhaust. Heavy-duty build for continuous high-use applications.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      defaultQty: 1,
      colors: ['Black','Graphite','Light Gray','Brown'],
      styles: ['Multi-Family Turbine Vent'],
      sizes: ['6"'],
      pricing: makePricing(115),
      labor: makeLabor(0.85),
      manufacturer: 'RoofIVent',
      sku: 'IT-RND-6-MF',
      warranty: '60-year lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 420,
      tags: ['vent','turbine','round','commercial','multi-family','roofivent','premium']
    },

    // ── WALLVENT ROTO 4" — Wall-mounted alternative ──
    {
      id: 'riv_wallvent_4',
      name: 'RoofIVent WALLVENT ROTO 4"',
      description: 'Wall-mounted 4" turbine kitchen/bathroom exhaust for buildings where roof venting is not possible. Same bearing system as ROTO series.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      defaultQty: 1,
      colors: ['Black','Graphite','Light Gray','Brown','Clay'],
      styles: ['Wall-Mounted Turbine Vent'],
      sizes: ['4"'],
      pricing: makePricing(128),
      labor: makeLabor(1.0),
      manufacturer: 'RoofIVent',
      sku: 'WV-RLK-4',
      warranty: '60-year lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 430,
      tags: ['vent','wall-mount','turbine','kitchen','bathroom','roofivent','premium']
    },

    // ── Condensation Collector 5"/6" ──
    {
      id: 'riv_condensation_collector',
      name: 'RoofIVent Condensation Collector',
      description: 'In-line condensation collector that prevents moisture/frost buildup in duct runs. Required for kitchen/bath vents in cold climates per RoofIVent spec.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Duct Accessory'],
      sizes: ['5"','6"'],
      pricing: makePricing(66),
      labor: makeLabor(0.3),
      manufacturer: 'RoofIVent',
      sku: 'SKR',
      warranty: '60-year lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 500,
      tags: ['duct','condensation','moisture','accessory','roofivent','premium'],
      notes: 'Ships as SKR-5 (5") or SKR-6 (6"). Recommended for all bath/kitchen vent installs in Cincinnati market.'
    },

    // ── Construction Wedges (box) ──
    {
      id: 'riv_construction_wedges',
      name: 'RoofIVent Construction Wedges (Box)',
      description: 'Installation wedges for squaring and leveling vents on pitched roofs. Box quantities: Orange 46pcs / White 100pcs / Gray 200pcs / Blue 250pcs / Mixed.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'BX',
      unitOptions: ['BX','PC'],
      coverage: { perUnit: '46-250 wedges per box (varies by color)' },
      defaultQty: 1,
      colors: ['Orange (46)','White (100)','Gray (200)','Blue (250)','Mixed'],
      styles: ['Installation Accessory'],
      sizes: ['Box'],
      pricing: makePricing(73),   // Midpoint of $58-$88 range
      labor: makeLabor(0),        // No direct install labor
      manufacturer: 'RoofIVent',
      sku: 'LW-1',
      warranty: 'N/A',
      isActive: true,
      isDefault: false,
      sortOrder: 510,
      tags: ['accessory','wedge','installation','roofivent'],
      notes: 'Price range $58-$88 by box size. SKU LW-1-L family. Carry at least 1 mixed box per truck.'
    },

    // ── IFLEX Duct 5" ──
    {
      id: 'riv_iflex_duct_5',
      name: 'RoofIVent iFLEX Duct 5" — Reduction to 4"/3"',
      description: 'Flexible 5" duct with built-in 4" and 3" reduction. Click-in connection to iVENT ECO/ROTO. Lengths: 20" or 40".',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA','LF'],
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Flex Duct with Reducer'],
      sizes: ['20"','40"'],
      pricing: makePricing(34),   // Midpoint $32-$36
      labor: makeLabor(0.2),
      manufacturer: 'RoofIVent',
      sku: 'KFP-5',
      warranty: '60-year lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 520,
      tags: ['duct','flex','reducer','iflex','roofivent'],
      notes: 'KFP-5-20 ($32) or KFP-5-40 ($36). Click-connect to iVENT ECO/ROTO series.'
    },

    // ── IFLEX Duct 6" ──
    {
      id: 'riv_iflex_duct_6',
      name: 'RoofIVent iFLEX Duct 6" — Reduction to 5"',
      description: 'Flexible 6" duct with built-in 5" reduction. Click-in connection to iVENT series. Lengths: 20" or 40".',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA','LF'],
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Flex Duct with Reducer'],
      sizes: ['20"','40"'],
      pricing: makePricing(42),   // Midpoint $40-$45
      labor: makeLabor(0.2),
      manufacturer: 'RoofIVent',
      sku: 'KFP-6',
      warranty: '60-year lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 530,
      tags: ['duct','flex','reducer','iflex','roofivent'],
      notes: 'KFP-6-20 ($40) or KFP-6-40 ($45). Standard for 6" ECO/ROTO installs.'
    },

    // ── Shim (50 pcs) ──
    {
      id: 'riv_shim_50pc',
      name: 'RoofIVent Shim — 50 Pieces',
      description: 'Installation shims for squaring vents on irregular decking. Pack of 50.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'BX',
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Installation Accessory'],
      sizes: ['50 pcs'],
      pricing: makePricing(9),
      labor: makeLabor(0),
      manufacturer: 'RoofIVent',
      sku: 'SH-50',
      warranty: 'N/A',
      isActive: true,
      isDefault: false,
      sortOrder: 540,
      tags: ['accessory','shim','installation','roofivent']
    },

    // ── Shims (box) ──
    {
      id: 'riv_shims_box',
      name: 'RoofIVent Shims — Box',
      description: 'Bulk box of installation shims for crew / truck stock.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'BX',
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Installation Accessory'],
      sizes: ['Box'],
      pricing: makePricing(34),
      labor: makeLabor(0),
      manufacturer: 'RoofIVent',
      sku: 'SH-BX',
      warranty: 'N/A',
      isActive: true,
      isDefault: false,
      sortOrder: 541,
      tags: ['accessory','shim','installation','bulk','roofivent']
    },

    // ── Lifetime Warranty Certificate (info / non-product tracker) ──
    {
      id: 'riv_warranty_cert',
      name: 'RoofIVent 60-Year Lifetime Warranty Registration',
      description: 'Warranty registration line item — tracked per install. No direct cost. Confirms RoofIVent product approval FL47016 certificate is filed with the customer.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'JOB',
      defaultQty: 1,
      colors: [],
      styles: ['Warranty Service'],
      sizes: ['Per Install'],
      pricing: makePricing(0),
      labor: makeLabor(0.25),
      manufacturer: 'RoofIVent',
      sku: 'RIV-WARR',
      warranty: '60-year lifetime warranty (FL47016)',
      isActive: true,
      isDefault: false,
      sortOrder: 999,
      tags: ['warranty','certificate','documentation','roofivent'],
      notes: 'Always file with customer record. Required to activate the 60yr transferable warranty.'
    }
  ];

  // ═════════════════════════════════════════════════════════
  // Register everything into the product library
  // ═════════════════════════════════════════════════════════

  const all = RIV_CATALOG.concat(STANDALONE);

  // Deduplicate by id so re-load is idempotent
  const existingIds = new Set((window.NBD_PRODUCTS || []).map(p => p.id));
  const toAdd = all.filter(p => !existingIds.has(p.id));
  window.NBD_PRODUCTS.push.apply(window.NBD_PRODUCTS, toAdd);

  // Expose a handle for debugging / direct access
  window.ROOFIVENT_CATALOG = {
    families: FAMILIES,
    variants: INSTALL_VARIANTS,
    products: all,
    count: all.length
  };

  console.log(`[RoofIVent] Loaded ${all.length} products into NBD_PRODUCTS (${toAdd.length} new).`);
})();
