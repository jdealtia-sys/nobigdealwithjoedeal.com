// ============================================================
// NBD Pro — Estimate Logic Engine
//
// The heart of the 3-catalog linked model. Takes measurements
// from the drawing tool (or direct entry), a list of line items
// from the Xactimate catalog, and resolves each line to:
//
//   1. Live quantity   (via formula evaluator against measurements)
//   2. Live material cost (via NBD_PRODUCTS lookup)
//   3. Live labor cost    (via NBD_LABOR lookup)
//   4. Line subtotal      (qty × (matCost + labCost))
//   5. Ordering quantity  (in the vendor's packaging unit)
//
// If Joe updates a product cost in NBD_PRODUCTS or a crew rate
// in NBD_LABOR, every line item that references it recalculates
// automatically.
//
// Exposes window.EstimateLogic with these functions:
//
//   calcQuantity(formula, context)
//   resolveMaterial(materialId)
//   resolveLabor(laborId, measurements)
//   resolveLineItem(item, measurements, opts)
//   resolveEstimate(lineItems, measurements, settings)
//   inferLaborId(item)
//   convertToOrderingUnit(item, quantity)
//
// Safe formula evaluator — only whitelisted variables and Math
// functions are allowed. Formulas come from catalog data, not
// user input, so the risk surface is limited.
// ============================================================

(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  // ═════════════════════════════════════════════════════════
  // 1. Measurement context — whitelisted variables for formulas
  // ═════════════════════════════════════════════════════════

  const MEASUREMENT_VARS = [
    // Roof geometry
    'rawSqft',          // Actual roof area (pitch applied)
    'sq',               // Adjusted squares (rawSqft × waste ÷ 100)
    'adjustedSqft',     // rawSqft × waste
    'pitchRatio',       // Rise/run (e.g., 8/12 = 0.667)
    'pitch',            // Numeric pitch rise (e.g., 8)
    'waste',            // Waste factor multiplier
    'stories',          // Number of stories
    'cutUpRoof',        // Boolean → 1 or 0
    // Linear dimensions
    'ridgeLf',
    'eaveLf',
    'rakeLf',
    'hipLf',
    'valleyLf',
    'wallLf',           // Roof-to-wall LF (headwall + sidewall combined)
    // Counts
    'pipes',
    'chimneys',
    'skylights',
    'structures',       // Number of roof structures (main house + garage)
    // Construction details
    'tearOffLayers',
    'deckReplacePct'    // Default 0.15 (15%)
  ];

  /**
   * Build a safe measurement context from raw inputs. Ensures
   * every variable exists with a numeric value, never undefined.
   */
  function buildContext(input) {
    input = input || {};
    const rawSqft = Number(input.rawSqft) || 0;
    const waste = Number(input.waste) || 1.17;
    const adjustedSqft = rawSqft * waste;
    const sq = adjustedSqft / 100;

    return {
      rawSqft:         rawSqft,
      sq:              sq,
      adjustedSqft:    adjustedSqft,
      pitchRatio:      Number(input.pitchRatio) || 0.667,
      pitch:           Number(input.pitch) || 8,
      waste:           waste,
      stories:         Number(input.stories) || 1,
      cutUpRoof:       input.cutUpRoof ? 1 : 0,
      ridgeLf:         Number(input.ridgeLf) || 0,
      eaveLf:          Number(input.eaveLf) || 0,
      rakeLf:          Number(input.rakeLf) || 0,
      hipLf:           Number(input.hipLf) || 0,
      valleyLf:        Number(input.valleyLf) || 0,
      wallLf:          Number(input.wallLf) || 0,
      pipes:           Number(input.pipes) || 0,
      chimneys:        Number(input.chimneys) || 0,
      skylights:       Number(input.skylights) || 0,
      structures:      Number(input.structures) || 1,
      tearOffLayers:   Number(input.tearOffLayers) || 1,
      deckReplacePct:  Number(input.deckReplacePct != null ? input.deckReplacePct : 0.15)
    };
  }

  // ═════════════════════════════════════════════════════════
  // 2. Safe formula evaluator (TWO-LAYER SANDBOX)
  //
  // Layer 1: Strict character/token whitelist. The formula
  //   source is validated against a regex of allowed tokens
  //   BEFORE being passed to new Function(). Anything the
  //   whitelist doesn't recognize is rejected up-front. This
  //   blocks 'process.exit', 'window.x', 'require("fs")',
  //   'document.cookie', 'fetch(...)', 'eval()', etc.
  //
  // Layer 2: new Function() creates the function in a
  //   restricted parameter scope with Math + math helpers +
  //   the whitelisted measurement vars. Any runtime error is
  //   caught and returns 0.
  //
  // Formulas come from the NBD_XACT_CATALOG data file. This
  // is the same trust boundary as any other code Joe ships,
  // but the two-layer check means a corrupted catalog or a
  // malicious user-entered override can't escape the sandbox.
  // ═════════════════════════════════════════════════════════

  // Allowed identifiers = measurement vars + math helpers
  const FORMULA_ALLOWED_IDENTIFIERS = new Set([
    // Math helpers exposed to formulas
    'Math', 'max', 'min', 'ceil', 'floor', 'round', 'abs', 'pow', 'sqrt',
    // Literal keywords allowed in expressions
    'true', 'false'
  ]);
  MEASUREMENT_VARS.forEach(v => FORMULA_ALLOWED_IDENTIFIERS.add(v));

  /**
   * Validates a formula against the strict whitelist.
   * Returns null if safe, or a string describing the violation.
   */
  function validateFormula(formula) {
    if (typeof formula !== 'string') return 'not a string';

    // Reject known attack tokens up-front for clearer error messages
    const dangerous = ['process', 'require', 'import', 'globalThis',
                       'window', 'document', 'self', 'top', 'parent',
                       'fetch', 'XMLHttpRequest', 'eval', 'Function',
                       'localStorage', 'sessionStorage', 'cookie',
                       'constructor', '__proto__', 'prototype'];
    for (const bad of dangerous) {
      // Match the token as a whole word (not a substring inside a var name)
      const re = new RegExp('(^|[^a-zA-Z0-9_])' + bad + '($|[^a-zA-Z0-9_])');
      if (re.test(formula)) {
        return 'blocked token: ' + bad;
      }
    }

    // Tokenize and check every identifier is in the whitelist.
    // Allowed characters outside of identifiers:
    //   digits, + - * / % ( ) , . ? :  < > = ! & |  and whitespace
    // (ternary ?, comparisons <, >, <=, >=, ==, !=, &&, || are all
    // fine because they operate on numbers only, never on objects)
    const tokenRegex = /[a-zA-Z_$][a-zA-Z0-9_$]*/g;
    let m;
    while ((m = tokenRegex.exec(formula)) !== null) {
      const token = m[0];
      if (!FORMULA_ALLOWED_IDENTIFIERS.has(token)) {
        return 'unknown identifier: ' + token;
      }
    }

    // Reject any remaining suspicious characters outside the operator set
    // (block: [ ] { } ; \ ` " ' backtick which could open up object/string literals)
    if (/[\[\]{};\\`"']/.test(formula)) {
      return 'forbidden character';
    }

    return null;  // safe
  }

  const FORMULA_CACHE = {};
  const FORMULA_BLOCKED = new Set();

  function calcQuantity(formula, context) {
    if (formula == null) return 0;
    if (typeof formula === 'number') return formula;
    if (typeof formula !== 'string') return 0;

    const trimmed = formula.trim();
    if (!trimmed) return 0;

    // Shortcut: plain variable lookup
    if (/^[a-zA-Z_]\w*$/.test(trimmed) && MEASUREMENT_VARS.includes(trimmed)) {
      return Number(context[trimmed]) || 0;
    }
    // Shortcut: numeric literal
    const asNumber = Number(trimmed);
    if (!isNaN(asNumber)) return asNumber;

    // Layer 1: strict whitelist check
    if (FORMULA_BLOCKED.has(trimmed)) return 0;
    const violation = validateFormula(trimmed);
    if (violation) {
      console.warn('[EstimateLogic] Formula rejected (' + violation + '):', trimmed);
      FORMULA_BLOCKED.add(trimmed);
      return 0;
    }

    // Layer 2: compile once, cache
    if (!FORMULA_CACHE[trimmed]) {
      try {
        // Expose whitelisted vars + Math + math helpers
        FORMULA_CACHE[trimmed] = new Function(
          'Math', 'max', 'min', 'ceil', 'floor', 'round', 'abs', 'pow', 'sqrt',
          ...MEASUREMENT_VARS,
          `"use strict"; return (${trimmed});`
        );
      } catch (e) {
        console.warn('[EstimateLogic] Formula compile error:', trimmed, e.message);
        FORMULA_CACHE[trimmed] = null;
      }
    }
    const fn = FORMULA_CACHE[trimmed];
    if (!fn) return 0;

    try {
      const args = MEASUREMENT_VARS.map(v => Number(context[v]) || 0);
      const result = fn(
        Math,
        Math.max, Math.min, Math.ceil, Math.floor, Math.round, Math.abs, Math.pow, Math.sqrt,
        ...args
      );
      return Number(result) || 0;
    } catch (e) {
      console.warn('[EstimateLogic] Formula runtime error:', trimmed, e.message);
      return 0;
    }
  }

  // ═════════════════════════════════════════════════════════
  // 3. Material & Labor resolvers
  // ═════════════════════════════════════════════════════════

  /**
   * Resolve a material ID against NBD_PRODUCTS.
   * Returns { id, name, cost, unit, pricing, source } or null.
   */
  function resolveMaterial(materialId, tier) {
    if (!materialId) return null;
    tier = tier || 'better';
    const products = window.NBD_PRODUCTS || [];
    const product = products.find(p => p.id === materialId);
    if (!product) {
      console.warn('[EstimateLogic] Material not found:', materialId);
      return null;
    }
    const tierPricing = product.pricing && product.pricing[tier];
    return {
      id: product.id,
      name: product.name,
      unit: product.unit,
      cost: tierPricing ? Number(tierPricing.cost) : 0,
      sell: tierPricing ? Number(tierPricing.sell) : 0,
      manufacturer: product.manufacturer,
      sku: product.sku,
      category: product.category,
      source: 'NBD_PRODUCTS'
    };
  }

  /**
   * Resolve a labor ID against NBD_LABOR.
   * Returns { id, name, rate, unit, source } or null.
   */
  function resolveLabor(laborId) {
    if (!laborId) return null;
    const labor = window.NBD_LABOR;
    if (!labor) return null;
    const entry = labor.get(laborId);
    if (!entry) {
      console.warn('[EstimateLogic] Labor not found:', laborId);
      return null;
    }
    return {
      id: entry.id,
      name: entry.name,
      unit: entry.unit,
      rate: Number(entry.rate),
      crewSize: entry.crewSize,
      hoursPerUnit: entry.hoursPerUnit,
      category: entry.category,
      requiresSafety: entry.requiresSafety,
      source: 'NBD_LABOR'
    };
  }

  // ═════════════════════════════════════════════════════════
  // 4. Labor inference — map line item subcategory/code to a
  //    default labor action. Explicit laborId on the item always
  //    wins; this is the fallback.
  // ═════════════════════════════════════════════════════════

  const LABOR_BY_SUB = {
    // Shingles & membrane
    'shingles-3tab':     'LAB INST-SH',
    'shingles-arch':     'LAB INST-SH',
    'shingles-designer': 'LAB INST-SH',
    'shingles-impact':   'LAB INST-SH',
    'shingles-cool':     'LAB INST-SH',
    'metal':             'LAB INST-MT',
    'wood':              'LAB INST-WD',
    'tile':              'LAB INST-TL',
    'slate':             'LAB INST-TL',   // Same productivity as tile
    'low-slope':         'LAB INST-MB',

    // Underlayment
    'underlayment':      'LAB INST-UDL',

    // Accessories
    'starter':           'LAB INST-STR',
    'ridge':             'LAB INST-RC',
    'hip':               'LAB INST-RC',
    'drip-edge':         'LAB INST-DE',
    'rake':              'LAB INST-DE',
    'gutter-apron':      'LAB INST-DE',
    'transition':        'LAB INST-FL',

    // Flashing
    'flashing':          'LAB INST-FL',
    'valley':            'LAB INST-VM',

    // Ventilation
    'ventilation':       'LAB INST-BV',   // Overridden per-code for power/turbine

    // Decking
    'decking':           'LAB INST-OSB',  // Overridden per-code for plywood

    // Fasteners — no labor (included in install)
    'fasteners':         null,

    // Gutters
    'gutters':           'LAB INST-GTR5', // Overridden for 6"
    'downspout':         'LAB INST-DSP',
    'guards':            'LAB INST-GG',
    'drainage':          'LAB INST-DSP',

    // Fascia / soffit
    'fascia':            'LAB INST-FSC',
    'soffit':            'LAB INST-SFT',
    'trim':              'LAB INST-FSC',
    'repair':            'LAB CARP-HR',

    // Labor categories are the labor catalog themselves
    'labor-teardown':    null,  // Item IS the labor
    'labor-install':     null,
    'labor-detail':      null,
    'labor-overhead':    null,
    'labor-adder':       null,
    'labor-carpentry':   null,
    'labor-cleanup':     null,
    'labor-documentation':null,
    'labor-supervision': null,
    'labor-emergency':   null,
    'labor-qc':          null,

    // Disposal, permits, warranty — no labor
    'disposal':          null,
    'permits':           null,
    'warranty':          null,

    // Interior
    'interior-drywall':  'LAB DW-PATCH',
    'interior-ceiling':  'LAB CLG-TX',
    'interior-paint':    'LAB PNT-RM',
    'interior-texture':  'LAB CLG-TX',
    'interior-flooring': 'LAB FLR-RPR',

    // Landscape / emergency / equipment — mostly no labor or
    // self-contained
    'landscape-protection':null,
    'emergency':         null,
    'equipment':         null,
    'code-upgrade':      'LAB INST-FL',  // Generic install
    'specialty':         'LAB DTL-HR'
  };

  // Per-code overrides for items where the subcategory default
  // doesn't fit. Highest priority.
  const LABOR_BY_CODE = {
    'RFG PIPE-STD':    'LAB INST-PB',
    'RFG PIPE-LD':     'LAB INST-PB',
    'RFG PIPE-RTR':    'LAB INST-PB',
    'RFG CHIM-STD':    'LAB INST-CHM',
    'RFG CHIM-SAD':    'LAB INST-CHM',
    'RFG SKY-STD':     'LAB INST-SKY',
    'RFG SKY-CUS':     'LAB INST-SKY',
    'RFG KICK':        'LAB INST-KICK',
    'RFG STPF-AL':     'LAB INST-STP',
    'RFG STPF-CU':     'LAB INST-STP',
    'RFG CNTR':        'LAB INST-CTR',
    'RFG HDWL':        'LAB INST-CTR',
    'RFG SDWL':        'LAB INST-CTR',
    'RFG RIDG-VNT':    'LAB INST-RV',
    'RFG RIDG-VNT-PL': 'LAB INST-RV',
    'RFG RIDG-VNT-PR': 'LAB INST-RV',
    'RFG BFL':         'LAB INST-RV',
    'RFG BOX-STD':     'LAB INST-BV',
    'RFG BOX-PRE':     'LAB INST-BV',
    'RFG PWR':         'LAB INST-PWR',
    'RFG SOLAR':       'LAB INST-PWR',
    'RFG TURB':        'LAB INST-TRB',
    'RFG TURB14':      'LAB INST-TRB',
    'RFG GBL':         'LAB INST-GBL',
    'RFG GBL-OCT':     'LAB INST-GBL',
    'RFG GBL-RND':     'LAB INST-GBL',
    'RFG HIP-VNT':     'LAB INST-RV',
    'RFG SFT-C':       'LAB INST-SFTC',
    'RFG SFT-I':       'LAB INST-SFTC',
    'RFG SMT':         'LAB INST-SMT',
    'RFG IWS':         'LAB INST-IWS',
    'RFG IWS-HT':      'LAB INST-IWS',
    'RFG IWS-FC':      'LAB INST-IWS',
    'RFG RNB-MEM':     'LAB INST-IWS',
    'RFG VB-SYN':      'LAB INST-UDL',
    'RFG PLY12':       'LAB INST-PLY',
    'RFG PLY58':       'LAB INST-PLY',
    'RFG PLY34':       'LAB INST-PLY',
    'RFG TG34':        'LAB INST-PLY',
    'RFG BRD':         'LAB CARP-HR',
    'RFG STRUCT':      'LAB STR-HR',
    'RFG ROTR':        'LAB CARP-HR',
    'RFG CLIPS':       'LAB INST-CLIPS',
    'RFG FBLK':        'LAB CARP-HR',
    'GTR 5K-AL':       'LAB INST-GTR5',
    'GTR 5K-ST':       'LAB INST-GTR5',
    'GTR 5K-CU':       'LAB INST-GTR5',
    'GTR 6K-AL':       'LAB INST-GTR6',
    'GTR 6K-ST':       'LAB INST-GTR6',
    'GTR 6K-CU':       'LAB INST-GTR6',
    'GTR HR-AL':       'LAB INST-GTR5',
    'GTR HR-CU':       'LAB INST-GTR5',
    'GTR BOX-AL':      'LAB INST-GTR6',
    'CUP IWS-E':       'LAB INST-IWS',
    'CUP DRPE':        'LAB INST-DE',
    'CUP KICK':        'LAB INST-KICK',
    'CUP HC':          'LAB CARP-HR',
    'SPC CRK':         'LAB INST-CHM',
    'SPC DRM':         'LAB DTL-HR',
    'SPC CUP-I':       'LAB DTL-HR',
    'SPC CHM-C':       'LAB INST-CHM',
    'SPC CHM-CR':      'LAB INST-CHM'
  };

  function inferLaborId(item) {
    if (!item) return null;
    // Explicit field on the item always wins
    if (item.laborId) return item.laborId;
    // Per-code override
    if (LABOR_BY_CODE[item.code]) return LABOR_BY_CODE[item.code];
    // Subcategory default
    if (item.sub && LABOR_BY_SUB[item.sub] !== undefined) return LABOR_BY_SUB[item.sub];
    // Category default
    if (item.category && LABOR_BY_SUB[item.category] !== undefined) return LABOR_BY_SUB[item.category];
    // Fallback: no linked labor
    return null;
  }

  // ═════════════════════════════════════════════════════════
  // 5. Quantity formula inference
  //
  // Most items follow a predictable pattern based on their unit
  // and subcategory. Explicit qtyFormula on the item always wins.
  // ═════════════════════════════════════════════════════════

  const QTY_BY_SUB = {
    'shingles-3tab':     'sq',
    'shingles-arch':     'sq',
    'shingles-designer': 'sq',
    'shingles-impact':   'sq',
    'shingles-cool':     'sq',
    'metal':             'sq',
    'wood':              'sq',
    'tile':              'sq',
    'slate':             'sq',
    'low-slope':         'sq',
    'underlayment':      'sq',
    'starter':           'eaveLf',
    'ridge':             'ridgeLf',
    'hip':               'hipLf',
    'drip-edge':         'eaveLf + rakeLf',
    'rake':              'rakeLf',
    'gutter-apron':      'eaveLf',
    'valley':            'valleyLf',
    'flashing':          'wallLf',            // Generic wall-linear flashing
    'ventilation':       'max(1, Math.ceil(adjustedSqft / 300))',
    'decking':           'adjustedSqft * deckReplacePct',
    'fasteners':         'sq',
    'gutters':           'eaveLf',
    'downspout':         'stories * 10',      // ~10 LF per story
    'guards':            'eaveLf',
    'fascia':            'eaveLf + rakeLf',
    'soffit':            'eaveLf',
    'labor-teardown':    'sq',
    'labor-install':     'sq',
    'labor-overhead':    '1',
    'labor-adder':       'sq',
    'disposal':          '1',
    'permits':           '1',
    'warranty':          '1',
    'code-upgrade':      'sq',
    'landscape-protection':'1',
    'emergency':         '1',
    'equipment':         '1'
  };

  const QTY_BY_CODE = {
    // Ridge vents follow ridge length, not per-300-SF rule
    'RFG RIDG-VNT':    'ridgeLf',
    'RFG RIDG-VNT-PL': 'ridgeLf',
    'RFG RIDG-VNT-PR': 'ridgeLf',
    'RFG HIP-VNT':     'hipLf',
    'RFG BFL':         'ridgeLf',
    'RFG SFT-C':       'eaveLf',
    'RFG SFT-I':       'max(1, Math.ceil(eaveLf / 4))',
    'RFG SMT':         'eaveLf',
    // Flashing & penetrations by count
    // Step flashing runs along wall-to-roof intersections. Using
    // ridgeLf + hipLf was a regression — ridge seams use ridge cap
    // and hip seams use hip cap, neither needs step flashing. If
    // wallLf is 0 the line correctly resolves to 0 (no walls, no
    // step flashing). User can still override via the pencil.
    'RFG STPF-AL':     'wallLf',
    'RFG STPF-CU':     'wallLf',
    'RFG CHIM-STD':    'chimneys',
    'RFG CHIM-SAD':    'chimneys',
    'RFG SKY-STD':     'skylights',
    'RFG SKY-CUS':     'skylights',
    'RFG PIPE-STD':    'pipes',
    'RFG PIPE-LD':     'pipes',
    'RFG PIPE-RTR':    'pipes',
    'RFG KICK':        'max(1, structures)',
    // Ventilation rules
    'RFG BOX-STD':     'max(1, Math.ceil(adjustedSqft / 300))',
    'RFG BOX-PRE':     'max(1, Math.ceil(adjustedSqft / 300))',
    'RFG PWR':         '1',
    'RFG SOLAR':       '1',
    'RFG TURB':        'max(1, Math.ceil(adjustedSqft / 600))',
    'RFG TURB14':      'max(1, Math.ceil(adjustedSqft / 800))',
    'RFG GBL':         '2',
    'RFG GBL-OCT':     '2',
    'RFG GBL-RND':     '2',
    'RFG CUP':         '1',
    // Underlayment specifics
    'RFG IWS':         'max(sq * 0.10, eaveLf * 3 / 100)', // 10% of sq OR 3ft band at eaves
    'RFG IWS-FC':      'sq',                                // full coverage
    // Decking replacement
    'RFG OSB716':      'adjustedSqft * deckReplacePct',
    'RFG OSB12':       'adjustedSqft * deckReplacePct',
    'RFG OSB58':       'adjustedSqft * deckReplacePct',
    'RFG PLY12':       'adjustedSqft * deckReplacePct',
    'RFG PLY58':       'adjustedSqft * deckReplacePct',
    'RFG PLY34':       'adjustedSqft * deckReplacePct',
    // H-clips — ~2 per linear foot of eave (typical spacing)
    'RFG CLIPS':       'eaveLf * 2',
    // Structural — manual entry
    'RFG STRUCT':      '0',
    'RFG ROTR':        '0',
    // Hurricane clips — ~1 per rafter, roughly eaveLf / 1.5
    'CUP HC':          'Math.max(10, Math.ceil(eaveLf / 1.5))',
    'CUP IWS-E':       'eaveLf',
    'CUP DRPE':        'eaveLf + rakeLf',
    'CUP KICK':        'max(1, structures)',
    'CUP VNT-R':       '1',
    'CUP FNR':         'sq',
    'CUP DCK-R':       'adjustedSqft',
    'CUP RB':          'adjustedSqft',
    // Tear-off labor lines (scale by layers)
    'LAB TO1':         'sq',
    'LAB TO2':         'sq',
    'LAB TO3':         'sq',
    'LAB TO-TL':       'sq',
    'LAB TO-MT':       'sq',
    'LAB TO-WD':       'sq',
    'LAB TO-SL':       'sq',
    // Adders apply per SQ
    'LAB ADR-2S':      'stories > 1 ? sq : 0',
    'LAB ADR-SS':      'pitch >= 8 ? sq : 0',
    'LAB ADR-VS':      'pitch >= 12 ? sq : 0',
    'LAB ADR-CU':      'cutUpRoof ? sq : 0',
    'LAB ADR-WK':      '0',        // Manual toggle
    'LAB ADR-OT':      '0',        // Manual hours
    // Overhead / docs — 1 per job
    'LAB MOB':         '1',
    'LAB DEMOB':       '1',
    'LAB JSP':         '1',
    'LAB CLN-M':       '1',
    'LAB PHOTO':       '1',
    'LAB WALK':        '1',
    'LAB SUP':         '1',
    // Emergency — manual
    'LAB WATR-D':      '0',
    'LAB TREE-R':      '0',
    // Detail hourly — manual
    'LAB DTL-HR':      '0',
    'LAB CARP':        '0',
    'LAB STR':         '0',
    'LAB BND-M':       '0',
    'LAB INST-SH':     'sq',
    'LAB INST-MT':     'sq',
    'LAB INST-MB':     'sq',
    'LAB INST-IWS':    'sq * 0.10',
    'LAB INST-FL':     'wallLf',
    'LAB INST-RC':     'ridgeLf + hipLf',
    'LAB INST-DE':     'eaveLf + rakeLf',
    // Disposal — based on job size
    'DSP 10YD':        'sq <= 15 ? 1 : 0',
    'DSP 20YD':        'sq > 15 && sq <= 25 ? 1 : 0',
    'DSP 30YD':        'sq > 25 && sq <= 40 ? 1 : 0',
    'DSP 40YD':        'sq > 40 ? 1 : 0',
    'DSP HAUL':        '0',
    'DSP DBR-H':       '0',
    'DSP TARP':        '0',
    'DSP OVER':        '0',
    // Fasteners
    'RFG NAIL-C':      'sq',
    'RFG NAIL-CAP':    'sq',
    'RFG NAIL-R':      'sq',
    'RFG NAIL-LUMA':   'sq',
    'RFG NAIL-SS':     'sq',
    'RFG SCRW-M':      'sq * 80',   // ~80 screws per SQ for metal
    'RFG CAP-P':       'sq * 40'    // ~40 cap nails per SQ for IWS
  };

  function inferQtyFormula(item) {
    if (!item) return '0';
    if (item.qtyFormula) return item.qtyFormula;
    if (QTY_BY_CODE[item.code]) return QTY_BY_CODE[item.code];
    if (item.sub && QTY_BY_SUB[item.sub]) return QTY_BY_SUB[item.sub];
    if (item.category && QTY_BY_SUB[item.category]) return QTY_BY_SUB[item.category];
    // Default by unit
    if (item.unit === 'SQ') return 'sq';
    if (item.unit === 'LF') return 'eaveLf';
    if (item.unit === 'SF') return 'adjustedSqft';
    if (item.unit === 'EA') return '1';
    if (item.unit === 'JOB') return '1';
    if (item.unit === 'DAY') return '1';
    if (item.unit === 'HR') return '0';
    return '0';
  }

  // ═════════════════════════════════════════════════════════
  // 6. Line item resolver — takes a catalog item + measurements
  //    and returns a fully-resolved line ready for rollup.
  // ═════════════════════════════════════════════════════════

  function resolveLineItem(item, measurements, opts) {
    opts = opts || {};
    const context = measurements && measurements.__resolved ? measurements : buildContext(measurements);
    const tier = opts.tier || 'better';

    // 1. Quantity — per-line override wins over formula. This is how
    //    the V2 Builder supports "Edit qty" on each scope item, and
    //    how presets that carry baked-in quantities (e.g. a tiny
    //    patch) can bypass the measurement-based formulas entirely.
    //    Override must be a finite non-negative number; anything else
    //    falls back to the formula path so we never silently NaN.
    const formula = item.qtyFormula || inferQtyFormula(item);
    let quantity;
    const rawOverride = (item._qtyOverride != null ? item._qtyOverride : item.qtyOverride);
    const numOverride = Number(rawOverride);
    if (rawOverride !== undefined && rawOverride !== null && rawOverride !== '' && Number.isFinite(numOverride) && numOverride >= 0) {
      quantity = numOverride;
    } else {
      quantity = calcQuantity(formula, context);
    }

    // 2. Material cost — explicit cost wins, otherwise lookup via materialId
    let matCostPerUnit;
    let matSource = null;
    if (item.materialCost != null) {
      matCostPerUnit = Number(item.materialCost);
      matSource = 'explicit';
    } else if (item.materialId) {
      const mat = resolveMaterial(item.materialId, tier);
      if (mat) {
        matCostPerUnit = mat.cost;
        matSource = 'NBD_PRODUCTS:' + item.materialId;
      } else {
        matCostPerUnit = 0;
      }
    } else {
      matCostPerUnit = 0;
    }

    // 3. Labor cost — explicit cost wins, otherwise lookup via laborId
    let labCostPerUnit;
    let labSource = null;
    const laborId = item.laborId || inferLaborId(item);
    if (item.laborCost != null) {
      labCostPerUnit = Number(item.laborCost);
      labSource = 'explicit';
    } else if (laborId) {
      const lab = resolveLabor(laborId);
      if (lab) {
        labCostPerUnit = lab.rate;
        labSource = 'NBD_LABOR:' + laborId;
      } else {
        labCostPerUnit = 0;
      }
    } else {
      labCostPerUnit = 0;
    }

    // 4. Roll up
    const materialTotal = quantity * matCostPerUnit;
    const laborTotal    = quantity * labCostPerUnit;
    const lineTotal     = materialTotal + laborTotal;

    return {
      code:           item.code,
      name:           item.name,
      description:    item.description || item.desc || '',
      category:       item.category,
      subcategory:    item.sub,
      unit:           item.unit,
      quantity:       quantity,
      qtyFormula:     formula,
      qtyOverridden:  (rawOverride !== undefined && rawOverride !== null && rawOverride !== '' && Number.isFinite(numOverride) && numOverride >= 0),
      materialCostPerUnit: matCostPerUnit,
      laborCostPerUnit:    labCostPerUnit,
      unitCost:       matCostPerUnit + labCostPerUnit,
      materialTotal:  materialTotal,
      laborTotal:     laborTotal,
      lineTotal:      lineTotal,
      laborId:        laborId,
      materialId:     item.materialId || null,
      matSource:      matSource,
      labSource:      labSource,
      tier:           item.tier || tier,
      codeRefs:       item.codeRefs || {},
      reason:         item.reason || '',
      insuranceDefault: !!item.insuranceDefault,
      requiresPhoto:    !!item.requiresPhoto,
      tags:           item.tags || []
    };
  }

  // ═════════════════════════════════════════════════════════
  // 7. Full estimate rollup — takes a list of line items +
  //    measurements + settings (OH&P, tax, minimum job) and
  //    returns the complete breakdown.
  // ═════════════════════════════════════════════════════════

  function resolveEstimate(lineItems, measurements, settings) {
    settings = settings || {};
    const context = buildContext(measurements);
    context.__resolved = true;

    const tier = settings.tier || 'better';
    const mode = settings.mode || 'cash';
    const overheadPct = Number(settings.overheadPct != null ? settings.overheadPct : 0.10);
    const profitPct   = Number(settings.profitPct != null ? settings.profitPct : 0.10);
    const materialMarkupPct = Number(settings.materialMarkupPct != null ? settings.materialMarkupPct : 0.25);
    const minJobCharge = Number(settings.minJobCharge != null ? settings.minJobCharge : 2500);
    const roundTo      = Number(settings.roundTo || 25);

    // Resolve each line
    const resolved = (lineItems || []).map(item => resolveLineItem(item, context, { tier, mode }));

    // Roll up totals
    let materialCost = 0;
    let laborCost = 0;
    resolved.forEach(line => {
      materialCost += line.materialTotal;
      laborCost    += line.laborTotal;
    });

    const materialRetail = materialCost * (1 + materialMarkupPct);
    const hardCost       = materialCost + laborCost;
    const retailBeforeOHP = materialRetail + laborCost;

    const overhead = retailBeforeOHP * overheadPct;
    const profit   = retailBeforeOHP * profitPct;
    const subtotal = retailBeforeOHP + overhead + profit;

    // Tax (insurance hides tax).
    // Tax rates come from (in priority order):
    //   1. settings.countyTax — explicitly passed by caller
    //   2. EstimateBuilderV2 live settings — fallback for UI flows
    //      that don't pass countyTax through
    //   3. settings.fallbackTaxRate or 7% — last resort
    const countyTaxMap = (settings.countyTax && typeof settings.countyTax === 'object')
      ? settings.countyTax
      : (window.EstimateBuilderV2
          ? (window.EstimateBuilderV2.loadSettings().countyTax || {})
          : {});
    const taxRate = (mode === 'insurance')
      ? 0
      : (countyTaxMap[settings.county || ''] != null
          ? Number(countyTaxMap[settings.county])
          : Number(settings.fallbackTaxRate || 0.07));
    const tax = subtotal * taxRate;

    let total = subtotal + tax;
    total = Math.round(total / roundTo) * roundTo;

    let minJobApplied = false;
    if (total < minJobCharge) {
      total = minJobCharge;
      minJobApplied = true;
    }

    const margin = total - hardCost;
    const marginPct = total > 0 ? (margin / total) * 100 : 0;

    return {
      method: 'line-item',
      context,
      tier,
      mode,
      lines: resolved,
      lineCount: resolved.length,
      materialCost,
      materialRetail,
      laborCost,
      hardCost,
      retailBeforeOHP,
      overhead,
      overheadPct,
      profit,
      profitPct,
      materialMarkupPct,
      subtotal,
      taxRate,
      tax,
      total,
      minJobApplied,
      internal: {
        materialCost,
        laborCost,
        hardCost,
        margin,
        marginPct
      }
    };
  }

  // ═════════════════════════════════════════════════════════
  // 8. Packaging / ordering unit converter
  //
  // When Joe needs to place an order, each line item's selling
  // unit (SQ, LF, EA) converts to the vendor's packaging unit
  // (Box, Bundle, Roll, etc.) so the purchase order is in the
  // quantities suppliers actually ship.
  // ═════════════════════════════════════════════════════════

  function convertToOrderingUnit(item, quantity, materialInfo) {
    // Try to pull packaging from the item itself first
    const pack = (item && item.packaging) || (materialInfo && materialInfo.packaging);
    if (!pack) {
      return { qty: quantity, unit: item.unit, converted: false };
    }

    const coverage = Number(pack.coverage);
    if (!coverage || coverage <= 0) {
      return { qty: quantity, unit: item.unit, converted: false };
    }

    const boxes = Math.ceil(quantity / coverage);
    return {
      qty: boxes,
      unit: pack.unit || 'Box',
      converted: true,
      perUnit: coverage,
      costPerUnit: pack.costPerBox || null,
      totalCost: pack.costPerBox ? boxes * pack.costPerBox : null
    };
  }

  // ═════════════════════════════════════════════════════════
  // Public API
  // ═════════════════════════════════════════════════════════
  window.EstimateLogic = {
    MEASUREMENT_VARS,
    LABOR_BY_SUB,
    LABOR_BY_CODE,
    QTY_BY_SUB,
    QTY_BY_CODE,

    buildContext,
    calcQuantity,
    resolveMaterial,
    resolveLabor,
    inferLaborId,
    inferQtyFormula,
    resolveLineItem,
    resolveEstimate,
    convertToOrderingUnit
  };

  console.log('[EstimateLogic] 3-catalog linked engine ready.');
})();
