// ============================================================
// NBD Pro — RoofIVent Premium Ventilation Catalog
//
// Source: 2026 Contractor Price List (v1.3) — delivered
//         directly from Keith Boivin, National Sales Director
//         (keith.boivin@roofivent.com) to Joe Deal via email
//         March 18, 2026. Valid through May 01, 2027.
//
// Pricing model:
//   cost = Roofivent contractor price (Joe's actual buy)
//   sell = MSRP (suggested retail on the price sheet)
//
// Volume rebate (annual, post-performance):
//   250-499 units  → 2%
//   500-999 units  → 3%
//   1,000+ units   → 5%
//
// Joe is the exclusive NBD distributor. RoofIVent products
// live on the BEST-tier system by default; individual SKUs
// can be added to any estimate as a la carte line items.
//
// Lifetime warranty on every product.
// FL47016 Florida Product Approval (hurricane zones).
//
// The catalog auto-loads into window.NBD_PRODUCTS when this
// script is included after product-data.js.
// ============================================================

(function () {
  'use strict';

  if (typeof window === 'undefined') return;
  window.NBD_PRODUCTS = window.NBD_PRODUCTS || [];

  // ═════════════════════════════════════════════════════════
  // Color code map (suffix → display name)
  // ═════════════════════════════════════════════════════════
  const COLOR_CODE = {
    '01': 'Brown',
    '02': 'Black',
    '06': 'Clay',
    '09': 'Graphite',
    '10': 'Light Grey',
    '27': 'Weatherwood'
  };

  // Standard color sets per install variant. Some ATTIC SKUs
  // include Clay on metal rib profiles — noted in per-family
  // overrides where applicable.
  const COLORS_PG    = ['Brown','Black','Clay','Graphite','Light Grey','Weatherwood'];
  const COLORS_PI    = ['Brown','Black','Clay','Graphite','Light Grey'];
  const COLORS_RIB   = ['Brown','Black','Graphite','Light Grey'];
  const COLORS_TURBO = ['Brown','Black','Graphite','Light Grey'];
  const COLORS_WALL  = ['Brown','Black','Graphite','Light Grey'];

  // ═════════════════════════════════════════════════════════
  // Install variants (profile → SKU suffix + install label)
  // ═════════════════════════════════════════════════════════
  const INSTALL_VARIANTS = {
    pg:    { key: 'pg',    label: 'Shingle / Slate / Shake',        skuSuffix: 'PG',      idSuffix: 'pg',    colors: COLORS_PG, profile: 'shingle' },
    pi:    { key: 'pi',    label: 'Metal Standing Seam / Snap Lock',skuSuffix: 'PI',      idSuffix: 'pi',    colors: COLORS_PI, profile: 'metal_ss' },
    mb34:  { key: 'mb34',  label: 'Metal Exposed Fastener · 3/4" Rib',skuSuffix: 'MB3/4', idSuffix: 'mb34',  colors: COLORS_RIB, profile: 'metal_rib34' },
    mb114: { key: 'mb114', label: 'Metal Exposed Fastener · 1,1/4" Rib',skuSuffix:'MB1,1/4',idSuffix:'mb114',colors: COLORS_RIB, profile: 'metal_rib114' }
  };

  // ═════════════════════════════════════════════════════════
  // Shared labor defaults
  // ═════════════════════════════════════════════════════════
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

  function makePricing(contractor, msrp) {
    // Roofivent products are uniform contractor pricing regardless
    // of the system tier they appear in. Joe's tier-level markup
    // happens in the Estimate Builder, not at the catalog level.
    return {
      good:   { sell: msrp, cost: contractor },
      better: { sell: msrp, cost: contractor },
      best:   { sell: msrp, cost: contractor }
    };
  }

  // ═════════════════════════════════════════════════════════
  // Entry factory
  //
  // family: the family definition
  // size:   size key ('4', '5', '6', '8', or '-' for no-size)
  // sizeInfo: { contractor, msrp, installs? }
  // variantKey: 'pg' | 'pi' | 'mb34' | 'mb114'
  // ═════════════════════════════════════════════════════════
  function makeEntry(family, size, sizeInfo, variantKey) {
    const variant = INSTALL_VARIANTS[variantKey];
    const sizeLabel = size && size !== '-' ? `${size}"` : '';

    // SKU pattern: {skuPrefix}-{sizeSuffix}-{colorCode}-{installSuffix}
    // Example: EL-4-01-PG (iVENT ECO 4" Brown Shingle)
    const sizeSku = family.sizeInSku === false ? '' : (size && size !== '-' ? `-${size}` : '');
    const baseSku = `${family.skuPrefix}${sizeSku}-{COLOR}-${variant.skuSuffix}`;

    const id = `riv_${family.base}${size && size !== '-' ? '_' + size : ''}_${variant.idSuffix}`;
    const name = `RoofIVent ${family.name}${sizeLabel ? ' ' + sizeLabel : ''} — ${variant.label}`;

    return {
      id,
      name,
      description: family.description,
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      coverage: { perUnit: family.coverage || '1 vent per fixture' },
      defaultQty: family.defaultQty || 1,
      colors: variant.colors,
      styles: [family.style || 'Roof Vent'],
      sizes: sizeLabel ? [sizeLabel] : (family.sizes || ['Standard']),
      pricing: makePricing(sizeInfo.contractor, sizeInfo.msrp),
      labor: makeLabor(family.hoursPerUnit || 0.5),
      manufacturer: 'RoofIVent',
      sku: baseSku.replace('{COLOR}', '{XX}'),   // shows {XX} as color placeholder
      skuPattern: baseSku,                        // machine-readable pattern
      skuColorMap: Object.assign({}, COLOR_CODE), // 01=Brown, 02=Black, etc.
      warranty: 'Lifetime warranty · FL47016 Florida Product Approval',
      isActive: true,
      isDefault: false,
      sortOrder: family.sortOrder + (family.sizeOrder?.[size] || 0) + (variant.key === 'pg' ? 0 : variant.key === 'pi' ? 1 : variant.key === 'mb34' ? 2 : 3),
      tags: (family.tags || []).concat(['roofivent','premium','best-tier', variant.profile]),
      notes: family.notes || 'Premium ventilation. RoofIVent contractor price list v1.3 (2026-03-18).'
    };
  }

  // ═════════════════════════════════════════════════════════
  // PRODUCT FAMILIES (with install variants)
  // ═════════════════════════════════════════════════════════

  const FAMILIES = [
    // ── iVENT ECO — Static Kitchen/Bath/Dryer Exhaust ──
    {
      base: 'eco',
      name: 'iVENT ECO',
      description: 'Static natural-airflow kitchen / bathroom / dryer roof exhaust. Vent inlet pipe aligns with roof slope for click-in iFLEX pipe connection. Built-in bubble level + condensation drain.',
      skuPrefix: 'EL',
      hoursPerUnit: 0.6,
      style: 'Static Kitchen / Bath / Dryer Vent',
      defaultQty: 1,
      sortOrder: 2100,
      tags: ['vent','kitchen','bathroom','dryer','static','passive'],
      sizes: {
        '4': { contractor: 76,  msrp: 95,  installs: ['pg','pi','mb34','mb114'] },
        '5': { contractor: 76,  msrp: 95,  installs: ['pg','pi','mb34','mb114'] },
        '6': { contractor: 90,  msrp: 112, installs: ['pg','pi','mb34','mb114'] }
      },
      sizeOrder: { '4': 0, '5': 10, '6': 20 }
    },

    // ── iVENT ROTO OBLONG — Active Kitchen/Bath Turbine (Oblong) ──
    {
      base: 'roto_oblong',
      name: 'iVENT ROTO OBLONG',
      description: 'Active wind-powered oblong kitchen / bathroom turbine exhaust. Encapsulated dual-bearing oil system for silent operation. Adjustable to any roof slope 1:12 – 12:12.',
      skuPrefix: 'RLP',
      hoursPerUnit: 0.75,
      style: 'Active Kitchen / Bath Turbine (Oblong)',
      defaultQty: 1,
      sortOrder: 2200,
      tags: ['vent','kitchen','bathroom','turbine','active','oblong'],
      sizes: {
        '4': { contractor: 114, msrp: 143, installs: ['pg','pi','mb34','mb114'] },
        '5': { contractor: 114, msrp: 143, installs: ['pg','pi','mb34','mb114'] },
        '6': { contractor: 114, msrp: 143, installs: ['pg','pi','mb34','mb114'] },
        '8': { contractor: 178, msrp: 223, installs: ['pg','pi'] }
      },
      sizeOrder: { '4': 0, '5': 10, '6': 20, '8': 30 }
    },

    // ── iVENT ROTO ROUND — Active Kitchen/Bath Turbine (Round) ──
    {
      base: 'roto_round',
      name: 'iVENT ROTO ROUND',
      description: 'Active wind-powered round kitchen / bathroom turbine exhaust. Encapsulated dual-bearing oil system for silent operation. Adjustable 1:12 – 12:12.',
      skuPrefix: 'RLK',
      hoursPerUnit: 0.75,
      style: 'Active Kitchen / Bath Turbine (Round)',
      defaultQty: 1,
      sortOrder: 2300,
      tags: ['vent','kitchen','bathroom','turbine','active','round'],
      sizes: {
        '4': { contractor: 114, msrp: 143, installs: ['pg','pi','mb34','mb114'] },
        '5': { contractor: 114, msrp: 143, installs: ['pg','pi','mb34','mb114'] },
        '6': { contractor: 114, msrp: 143, installs: ['pg','pi','mb34','mb114'] },
        '8': { contractor: 178, msrp: 223, installs: ['pg','pi'] }
      },
      sizeOrder: { '4': 0, '5': 10, '6': 20, '8': 30 }
    },

    // ── iVENT ROTO ATTIC OBLONG — Active Attic Turbine (Oblong) ──
    {
      base: 'roto_attic_oblong',
      name: 'iVENT ROTO ATTIC OBLONG',
      description: 'Active wind-powered ATTIC exhaust turbine with oblong profile for lower visual impact. Ideal where HOAs or historic districts restrict vent height. Adjustable 1:12 – 12:12.',
      skuPrefix: 'RLP-A',
      sizeInSku: false,   // SKU is RLP-A-xx-PG (no size digit for 6"), RLP-A8-xx-PG for 8"
      hoursPerUnit: 0.85,
      style: 'Active Attic Turbine (Oblong)',
      defaultQty: 2,
      sortOrder: 2400,
      tags: ['vent','attic','turbine','active','oblong','exhaust'],
      sizes: {
        // 6" uses RLP-A prefix, 8" uses RLP-A8 prefix (different skuPrefix per size)
        '6': { contractor: 114, msrp: 143, installs: ['pg','pi','mb34','mb114'], skuPrefix: 'RLP-A' },
        '8': { contractor: 178, msrp: 223, installs: ['pg','pi'],                skuPrefix: 'RLP-A8' }
      },
      sizeOrder: { '6': 0, '8': 10 }
    },

    // ── iVENT ROTO ATTIC ROUND — Active Attic Turbine (Round) ──
    {
      base: 'roto_attic_round',
      name: 'iVENT ROTO ATTIC ROUND',
      description: 'Active wind-powered ATTIC exhaust turbine with round profile. High-CFM throughput for larger attic volumes. Adjustable 1:12 – 12:12.',
      skuPrefix: 'RLK-A',
      sizeInSku: false,
      hoursPerUnit: 0.85,
      style: 'Active Attic Turbine (Round)',
      defaultQty: 2,
      sortOrder: 2500,
      tags: ['vent','attic','turbine','active','round','exhaust'],
      sizes: {
        '6': { contractor: 114, msrp: 143, installs: ['pg','pi','mb34','mb114'], skuPrefix: 'RLK-A' },
        '8': { contractor: 178, msrp: 223, installs: ['pg','pi'],                skuPrefix: 'RLK-A8' }
      },
      sizeOrder: { '6': 0, '8': 10 }
    },

    // ── iVENT FLOW — Passive Low-Profile Attic Vent ──
    // Note: install-specific pricing (PG $32/$40, metal all $35/$44)
    {
      base: 'flow',
      name: 'iVENT FLOW',
      description: 'Passive low-profile attic vent. UV-stable pure polypropylene, hail-toughened. Can be used as exhaust or intake. NFA 53 sq.in. (0.37 sq.ft.) per vent. Recommended spacing: 1 vent per 300 SF of attic.',
      skuPrefix: 'WP-2',
      sizeInSku: false,
      hoursPerUnit: 0.4,
      style: 'Passive Low-Profile Attic Vent',
      defaultQty: 8,
      sortOrder: 2000,
      tags: ['vent','attic','passive','static','low-profile'],
      coverage: 'NFA 53 sq.in. / 0.37 sq.ft. per vent — 1 per 300 SF',
      sizes: {
        '-': { contractor: 32, msrp: 40, installs: ['pg','pi','mb34','mb114'],
               installPricing: {
                 pg:    { contractor: 32, msrp: 40 },
                 pi:    { contractor: 35, msrp: 44 },
                 mb34:  { contractor: 35, msrp: 44 },
                 mb114: { contractor: 35, msrp: 44 }
               }
        }
      }
    },

    // ── Cable Roof Penetration ──
    {
      base: 'cable_pen',
      name: 'Cable Roof Penetration',
      description: 'Waterproof cable penetration flashing for solar, antenna, or service wires. Max cable diameter 1,3/8". UV-stable polypropylene with integrated drip edge.',
      skuPrefix: 'PS-2',
      sizeInSku: false,
      hoursPerUnit: 0.5,
      style: 'Cable Penetration Flashing',
      defaultQty: 1,
      sortOrder: 2600,
      coverage: 'Max cable diameter 1,3/8"',
      tags: ['penetration','cable','flashing','solar','antenna'],
      sizes: {
        '-': { contractor: 60, msrp: 75, installs: ['pg','pi','mb34','mb114'] }
      }
    },

    // ── Vent Pipe Flashing PP-1 (1"-3" pipe) ──
    {
      base: 'pipe_pen_1',
      name: 'Vent Pipe Flashing 1"-3"',
      description: 'Waterproof vent pipe / plumbing flashing for 1"-3" pipe diameters. Hail-resistant polypropylene body with pivoting collar for roof pitch alignment.',
      skuPrefix: 'PP-1',
      sizeInSku: false,
      hoursPerUnit: 0.4,
      style: 'Pipe Penetration Flashing (1"-3")',
      defaultQty: 4,
      sortOrder: 2700,
      coverage: 'Pipe diameter 1" - 3"',
      tags: ['penetration','pipe','plumbing','flashing','boot'],
      sizes: {
        '-': { contractor: 58, msrp: 73, installs: ['pg','pi','mb34','mb114'] }
      }
    },

    // ── Vent Pipe Flashing PP-2 (2"-5" / 4"-5" pipe) ──
    {
      base: 'pipe_pen_2',
      name: 'Vent Pipe Flashing 2"-5"',
      description: 'Oversize vent pipe / plumbing flashing for 4"-5" pipe diameters. For large plumbing stacks and ductwork.',
      skuPrefix: 'PP-2',
      sizeInSku: false,
      hoursPerUnit: 0.5,
      style: 'Pipe Penetration Flashing (2"-5")',
      defaultQty: 2,
      sortOrder: 2800,
      coverage: 'Pipe diameter 4" - 5"',
      tags: ['penetration','pipe','plumbing','flashing','oversize'],
      sizes: {
        '-': { contractor: 61, msrp: 76, installs: ['pg','pi','mb34','mb114'] }
      }
    }
  ];

  // ═════════════════════════════════════════════════════════
  // Expand FAMILIES into individual product entries
  // ═════════════════════════════════════════════════════════

  const RIV_CATALOG = [];

  FAMILIES.forEach(family => {
    Object.keys(family.sizes).forEach(sizeKey => {
      const sizeInfo = family.sizes[sizeKey];
      const installs = sizeInfo.installs || ['pg','pi','mb34','mb114'];

      // Some sizes override the skuPrefix (e.g. attic 8" → RLP-A8)
      const effectiveFamily = sizeInfo.skuPrefix
        ? Object.assign({}, family, { skuPrefix: sizeInfo.skuPrefix, sizeInSku: false })
        : family;

      installs.forEach(installKey => {
        // Per-install pricing override (for iVENT FLOW)
        const effectivePrice = sizeInfo.installPricing && sizeInfo.installPricing[installKey]
          ? sizeInfo.installPricing[installKey]
          : { contractor: sizeInfo.contractor, msrp: sizeInfo.msrp };

        const entry = makeEntry(
          effectiveFamily,
          sizeKey,
          effectivePrice,
          installKey
        );
        RIV_CATALOG.push(entry);
      });
    });
  });

  // ═════════════════════════════════════════════════════════
  // STANDALONE PRODUCTS (no install variants generated)
  // ═════════════════════════════════════════════════════════

  const STANDALONE = [
    // ── iVENT TURBO Round 6" — Upgrade Turbine Head ──
    {
      id: 'riv_turbo_round_6',
      name: 'RoofIVent iVENT TURBO Round 6" — Turbine Head',
      description: 'Premium wind-powered 6" round turbine head upgrade. Installs over existing vent for increased CFM. Encapsulated bearing system, silent operation.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      defaultQty: 1,
      colors: COLORS_TURBO,
      styles: ['Turbine Head Upgrade'],
      sizes: ['6"'],
      pricing: makePricing(84, 105),
      labor: makeLabor(0.5),
      manufacturer: 'RoofIVent',
      sku: 'NRK-6-{XX}',
      skuPattern: 'NRK-6-{COLOR}',
      skuColorMap: COLOR_CODE,
      warranty: 'Lifetime warranty · FL47016 Florida Product Approval',
      isActive: true,
      isDefault: false,
      sortOrder: 2900,
      tags: ['vent','turbine','round','head','upgrade','roofivent','premium','best-tier']
    },

    // ── iVENT TURBO Oblong 6" ──
    {
      id: 'riv_turbo_oblong_6',
      name: 'RoofIVent iVENT TURBO Oblong 6" — Turbine Head',
      description: 'Premium wind-powered 6" oblong turbine head upgrade. Lower visual profile than round for HOA-sensitive installs.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      defaultQty: 1,
      colors: COLORS_TURBO,
      styles: ['Turbine Head Upgrade'],
      sizes: ['6"'],
      pricing: makePricing(84, 105),
      labor: makeLabor(0.5),
      manufacturer: 'RoofIVent',
      sku: 'NRP-6-{XX}',
      skuPattern: 'NRP-6-{COLOR}',
      skuColorMap: COLOR_CODE,
      warranty: 'Lifetime warranty · FL47016 Florida Product Approval',
      isActive: true,
      isDefault: false,
      sortOrder: 2910,
      tags: ['vent','turbine','oblong','head','upgrade','roofivent','premium','best-tier']
    },

    // ── iVENT TURBO Round 8" ──
    {
      id: 'riv_turbo_round_8',
      name: 'RoofIVent iVENT TURBO Round 8" — Turbine Head',
      description: 'Heavy-duty 8" round turbine head. Higher CFM throughput for commercial or large residential applications.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      defaultQty: 1,
      colors: COLORS_TURBO,
      styles: ['Turbine Head Upgrade'],
      sizes: ['8"'],
      pricing: makePricing(108, 135),
      labor: makeLabor(0.6),
      manufacturer: 'RoofIVent',
      sku: 'NRK-8-{XX}',
      skuPattern: 'NRK-8-{COLOR}',
      skuColorMap: COLOR_CODE,
      warranty: 'Lifetime warranty · FL47016 Florida Product Approval',
      isActive: true,
      isDefault: false,
      sortOrder: 2920,
      tags: ['vent','turbine','round','head','8-inch','commercial','roofivent','premium']
    },

    // ── iVENT TURBO Oblong 8" ──
    {
      id: 'riv_turbo_oblong_8',
      name: 'RoofIVent iVENT TURBO Oblong 8" — Turbine Head',
      description: 'Heavy-duty 8" oblong turbine head. Higher CFM with lower visual profile than round.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      defaultQty: 1,
      colors: COLORS_TURBO,
      styles: ['Turbine Head Upgrade'],
      sizes: ['8"'],
      pricing: makePricing(108, 135),
      labor: makeLabor(0.6),
      manufacturer: 'RoofIVent',
      sku: 'NRP-8-{XX}',
      skuPattern: 'NRP-8-{COLOR}',
      skuColorMap: COLOR_CODE,
      warranty: 'Lifetime warranty · FL47016 Florida Product Approval',
      isActive: true,
      isDefault: false,
      sortOrder: 2930,
      tags: ['vent','turbine','oblong','head','8-inch','commercial','roofivent','premium']
    },

    // ── iVENT TURBO Oblong 6" MF (with condensation drainage) ──
    {
      id: 'riv_turbo_oblong_6_mf',
      name: 'RoofIVent iVENT TURBO Oblong 6" MF — With Condensation Drainage',
      description: 'Multi-family grade 6" oblong turbine head with integrated condensation drainage system. Prevents moisture/frost buildup in cold climates and long duct runs.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      defaultQty: 1,
      colors: COLORS_TURBO,
      styles: ['Turbine Head with Drainage'],
      sizes: ['6"'],
      pricing: makePricing(92, 115),
      labor: makeLabor(0.6),
      manufacturer: 'RoofIVent',
      sku: 'NRP-6-{XX}-MF',
      skuPattern: 'NRP-6-{COLOR}-MF',
      skuColorMap: COLOR_CODE,
      warranty: 'Lifetime warranty · FL47016 Florida Product Approval',
      isActive: true,
      isDefault: false,
      sortOrder: 2940,
      tags: ['vent','turbine','oblong','head','multi-family','condensation-drain','roofivent','premium']
    },

    // ── iVENT TURBO Round 6" MF ──
    {
      id: 'riv_turbo_round_6_mf',
      name: 'RoofIVent iVENT TURBO Round 6" MF — With Condensation Drainage',
      description: 'Multi-family grade 6" round turbine head with integrated condensation drainage system. Cold-climate and long-duct-run ready.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      defaultQty: 1,
      colors: COLORS_TURBO,
      styles: ['Turbine Head with Drainage'],
      sizes: ['6"'],
      pricing: makePricing(92, 115),
      labor: makeLabor(0.6),
      manufacturer: 'RoofIVent',
      sku: 'NRK-6-{XX}-MF',
      skuPattern: 'NRK-6-{COLOR}-MF',
      skuColorMap: COLOR_CODE,
      warranty: 'Lifetime warranty · FL47016 Florida Product Approval',
      isActive: true,
      isDefault: false,
      sortOrder: 2950,
      tags: ['vent','turbine','round','head','multi-family','condensation-drain','roofivent','premium']
    },

    // ── WALLVENT ECO (Passive Wall-Mount) ──
    {
      id: 'riv_wallvent_eco_4',
      name: 'RoofIVent WALLVENT ECO 4" — Passive Wall Mount',
      description: 'Passive wall-mounted 4" bathroom or kitchen exhaust solution for buildings where roof venting is not possible. Natural airflow design.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      defaultQty: 1,
      colors: COLORS_WALL,
      styles: ['Wall-Mount Passive Vent'],
      sizes: ['4"'],
      pricing: makePricing(90, 112),
      labor: makeLabor(0.75),
      manufacturer: 'RoofIVent',
      sku: 'WV-NKO-4-{XX}',
      skuPattern: 'WV-NKO-4-{COLOR}',
      skuColorMap: COLOR_CODE,
      warranty: 'Lifetime warranty · FL47016 Florida Product Approval',
      isActive: true,
      isDefault: false,
      sortOrder: 3000,
      tags: ['vent','wall-mount','passive','kitchen','bathroom','roofivent','premium']
    },

    // ── WALLVENT ROTO (Active Wall-Mount) ──
    {
      id: 'riv_wallvent_roto_4',
      name: 'RoofIVent WALLVENT ROTO 4" — Active Wall Mount',
      description: 'Active wind-powered wall-mounted 4" bathroom/kitchen exhaust. Same encapsulated bearing system as ROTO roof series. For buildings where roof venting is not possible.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      unitOptions: ['EA'],
      defaultQty: 1,
      colors: COLORS_WALL,
      styles: ['Wall-Mount Active Turbine'],
      sizes: ['4"'],
      pricing: makePricing(109, 136),
      labor: makeLabor(1.0),
      manufacturer: 'RoofIVent',
      sku: 'WV-NRP-4-{XX}',
      skuPattern: 'WV-NRP-4-{COLOR}',
      skuColorMap: COLOR_CODE,
      warranty: 'Lifetime warranty · FL47016 Florida Product Approval',
      isActive: true,
      isDefault: false,
      sortOrder: 3010,
      tags: ['vent','wall-mount','active','turbine','kitchen','bathroom','roofivent','premium']
    },

    // ═════════════════════════════════════════════════════════
    // iFLEX Duct (standard, no backdraft damper)
    // ═════════════════════════════════════════════════════════
    {
      id: 'riv_iflex_5_20',
      name: 'RoofIVent iFLEX Duct 5" × 20" — with 4"/3" Reduction',
      description: 'Durable flexible 5" duct with built-in reduction to 4" and 3". 20" length. Fire resistance class M1.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Flex Duct with Reducer'],
      sizes: ['5" × 20"'],
      pricing: makePricing(26, 32),
      labor: makeLabor(0.2),
      manufacturer: 'RoofIVent',
      sku: 'KFP-5-20',
      warranty: 'Lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 3100,
      tags: ['duct','flex','iflex','reducer','m1','roofivent']
    },
    {
      id: 'riv_iflex_5_40',
      name: 'RoofIVent iFLEX Duct 5" × 40" — with 4"/3" Reduction',
      description: 'Durable flexible 5" duct with built-in reduction to 4" and 3". 40" length. Fire resistance class M1.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Flex Duct with Reducer'],
      sizes: ['5" × 40"'],
      pricing: makePricing(29, 36),
      labor: makeLabor(0.25),
      manufacturer: 'RoofIVent',
      sku: 'KFP-5-40',
      warranty: 'Lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 3110,
      tags: ['duct','flex','iflex','reducer','m1','roofivent']
    },
    {
      id: 'riv_iflex_6_20',
      name: 'RoofIVent iFLEX Duct 6" × 20" — with 5" Reduction',
      description: 'Durable flexible 6" duct with built-in reduction to 5". 20" length. Fire resistance class M1.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Flex Duct with Reducer'],
      sizes: ['6" × 20"'],
      pricing: makePricing(32, 40),
      labor: makeLabor(0.2),
      manufacturer: 'RoofIVent',
      sku: 'KFP-6-20',
      warranty: 'Lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 3120,
      tags: ['duct','flex','iflex','reducer','m1','roofivent']
    },
    {
      id: 'riv_iflex_6_40',
      name: 'RoofIVent iFLEX Duct 6" × 40" — with 5" Reduction',
      description: 'Durable flexible 6" duct with built-in reduction to 5". 40" length. Fire resistance class M1.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Flex Duct with Reducer'],
      sizes: ['6" × 40"'],
      pricing: makePricing(35, 44),
      labor: makeLabor(0.25),
      manufacturer: 'RoofIVent',
      sku: 'KFP-6-40',
      warranty: 'Lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 3130,
      tags: ['duct','flex','iflex','reducer','m1','roofivent']
    },

    // ═════════════════════════════════════════════════════════
    // iFLEX Duct with BACKDRAFT DAMPER (KFPZ series)
    // ═════════════════════════════════════════════════════════
    {
      id: 'riv_iflex_damper_5_20',
      name: 'RoofIVent iFLEX Duct 5" × 20" + Backdraft Damper',
      description: 'Flexible 5" duct with integrated backdraft damper and 4"/3" reduction. Fire class M1. 20" length. Backdraft prevents cold-air backflow.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Flex Duct with Backdraft Damper'],
      sizes: ['5" × 20"'],
      pricing: makePricing(33, 41),
      labor: makeLabor(0.25),
      manufacturer: 'RoofIVent',
      sku: 'KFPZ-5-20',
      warranty: 'Lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 3200,
      tags: ['duct','flex','iflex','backdraft','damper','reducer','m1','roofivent']
    },
    {
      id: 'riv_iflex_damper_5_40',
      name: 'RoofIVent iFLEX Duct 5" × 40" + Backdraft Damper',
      description: 'Flexible 5" duct with integrated backdraft damper and 4"/3" reduction. Fire class M1. 40" length.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Flex Duct with Backdraft Damper'],
      sizes: ['5" × 40"'],
      pricing: makePricing(36, 45),
      labor: makeLabor(0.3),
      manufacturer: 'RoofIVent',
      sku: 'KFPZ-5-40',
      warranty: 'Lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 3210,
      tags: ['duct','flex','iflex','backdraft','damper','reducer','m1','roofivent']
    },
    {
      id: 'riv_iflex_damper_6_20',
      name: 'RoofIVent iFLEX Duct 6" × 20" + Backdraft Damper',
      description: 'Flexible 6" duct with integrated backdraft damper and 5" reduction. Fire class M1. 20" length.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Flex Duct with Backdraft Damper'],
      sizes: ['6" × 20"'],
      pricing: makePricing(39, 49),
      labor: makeLabor(0.25),
      manufacturer: 'RoofIVent',
      sku: 'KFPZ-6-20',
      warranty: 'Lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 3220,
      tags: ['duct','flex','iflex','backdraft','damper','reducer','m1','roofivent']
    },
    {
      id: 'riv_iflex_damper_6_40',
      name: 'RoofIVent iFLEX Duct 6" × 40" + Backdraft Damper',
      description: 'Flexible 6" duct with integrated backdraft damper and 5" reduction. Fire class M1. 40" length.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Flex Duct with Backdraft Damper'],
      sizes: ['6" × 40"'],
      pricing: makePricing(42, 53),
      labor: makeLabor(0.3),
      manufacturer: 'RoofIVent',
      sku: 'KFPZ-6-40',
      warranty: 'Lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 3230,
      tags: ['duct','flex','iflex','backdraft','damper','reducer','m1','roofivent']
    },

    // ═════════════════════════════════════════════════════════
    // SYSTEM ACCESSORIES
    // ═════════════════════════════════════════════════════════

    // Condensation Collector 5"
    {
      id: 'riv_condensation_5',
      name: 'RoofIVent Condensation Collector 5"',
      description: 'In-line 5" condensation collector. Prevents moisture and frost buildup in duct runs. Required for bath/kitchen vents in cold-climate installs.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Duct Accessory'],
      sizes: ['5"'],
      pricing: makePricing(40, 50),
      labor: makeLabor(0.25),
      manufacturer: 'RoofIVent',
      sku: 'SKR-5',
      warranty: 'Lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 3300,
      tags: ['duct','condensation','moisture','accessory','roofivent']
    },

    // Condensation Collector 6"
    {
      id: 'riv_condensation_6',
      name: 'RoofIVent Condensation Collector 6"',
      description: 'In-line 6" condensation collector. Prevents moisture and frost buildup in duct runs.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Duct Accessory'],
      sizes: ['6"'],
      pricing: makePricing(48, 60),
      labor: makeLabor(0.25),
      manufacturer: 'RoofIVent',
      sku: 'SKR-6',
      warranty: 'Lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 3310,
      tags: ['duct','condensation','moisture','accessory','roofivent']
    },

    // Diameter Reducer R-4 (6" → 5" → 4")
    {
      id: 'riv_reducer_r4',
      name: 'RoofIVent Diameter Reducer 6" → 5" → 4"',
      description: 'Step-down duct diameter reducer. Converts 6" to 5" to 4" for mixed-size duct runs. Lightweight, press-fit installation.',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'EA',
      defaultQty: 1,
      colors: ['Gray'],
      styles: ['Duct Accessory'],
      sizes: ['6"→5"→4"'],
      pricing: makePricing(5, 6),
      labor: makeLabor(0.1),
      manufacturer: 'RoofIVent',
      sku: 'R-4',
      warranty: 'Lifetime warranty',
      isActive: true,
      isDefault: false,
      sortOrder: 3320,
      tags: ['duct','reducer','accessory','roofivent']
    },

    // Warranty Registration (info / tracking line)
    {
      id: 'riv_warranty_cert',
      name: 'RoofIVent Lifetime Warranty Registration',
      description: 'Warranty registration line-item — tracked per install. No product cost. Required to activate the transferable lifetime warranty (FL47016 Florida Product Approval).',
      category: 'roofing_ventilation',
      section: 'RoofIVent',
      unit: 'JOB',
      defaultQty: 1,
      colors: [],
      styles: ['Warranty Service'],
      sizes: ['Per Install'],
      pricing: makePricing(0, 0),
      labor: makeLabor(0.25),
      manufacturer: 'RoofIVent',
      sku: 'RIV-WARR',
      warranty: 'Lifetime warranty · FL47016 Florida Product Approval',
      isActive: true,
      isDefault: false,
      sortOrder: 3999,
      tags: ['warranty','certificate','documentation','roofivent'],
      notes: 'Always file with the customer record. Required to activate the lifetime transferable warranty.'
    }
  ];

  // ═════════════════════════════════════════════════════════
  // Volume rebate metadata (for reporting / margin tracking)
  // ═════════════════════════════════════════════════════════
  const VOLUME_REBATE = {
    program: 'RoofIVent Contractor Volume Rebate 2026',
    paymentTerms: 'ACH or Check — payable to ROOFIVENT LLC',
    contractValidThrough: '2027-05-01',
    shipping: 'FOB Roofivent warehouse · Naperville IL · 3 business days',
    tiers: [
      { minUnits: 250,  maxUnits: 499,  rebatePct: 0.02 },
      { minUnits: 500,  maxUnits: 999,  rebatePct: 0.03 },
      { minUnits: 1000, maxUnits: null, rebatePct: 0.05 }
    ],
    notes: 'Rebates are annual post-performance, not reflected on invoices. Requires account compliance (payment status + channel rules). Roofivent may modify with prior notice.',
    salesDirector: {
      name: 'Keith Boivin',
      title: 'National Sales Director',
      email: 'keith.boivin@roofivent.com',
      phone: '+1 (682) 351-3934'
    },
    orders: {
      email: 'office@roofivent.com',
      phone: '+1 (847) 636-2137',
      address: 'ROOFIVENT LLC · Frontenac Rd, Unit B · Naperville IL 60563'
    }
  };

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
    installVariants: INSTALL_VARIANTS,
    colorCodes: COLOR_CODE,
    products: all,
    count: all.length,
    volumeRebate: VOLUME_REBATE,
    sourceDocument: '2026 Contractor Price List v1.3 (emailed 2026-03-18 by Keith Boivin)'
  };

  console.log(`[RoofIVent] Loaded ${all.length} products into NBD_PRODUCTS (${toAdd.length} new).`);
})();
