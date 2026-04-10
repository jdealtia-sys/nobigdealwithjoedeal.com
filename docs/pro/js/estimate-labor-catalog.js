// ============================================================
// NBD Pro — Labor Catalog (NBD_LABOR)
//
// Single source of truth for all labor actions. Part of the
// 3-catalog linked model:
//
//   1. NBD_PRODUCTS (material library — shingles, underlayment,
//      flashing, RoofIVent, etc.)
//   2. NBD_LABOR    (this file — install actions + crew rates)
//   3. NBD_XACT_CATALOG (line items that link a material to a
//      labor action via materialId + laborId + qtyFormula)
//
// When Joe updates a labor rate here, every line item in the
// 270-item Xactimate catalog that references it recalculates
// automatically. Same goes for material costs in NBD_PRODUCTS.
//
// Each labor entry defines:
//   id              — Unique action code
//   name            — Human-readable label
//   category        — tear-off | install | detail | overhead |
//                     carpentry | adder | emergency | cleanup
//   unit            — Billing unit (SQ, LF, EA, HR, JOB, DAY, SF)
//   rate            — Dollar rate per unit
//   crewSize        — Number of crew members for this action
//   hoursPerUnit    — Productivity metric (time per unit)
//   tags            — Filter/search metadata
//   requiresSafety  — Triggers steep-slope/fall-protection gear
// ============================================================

(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const CREW = 4;                // Default crew size for roofing
  const RATE_PER_MH = 35;        // Default $/man-hour

  // Helper: create labor entry with shared defaults
  function L(o) {
    return Object.assign({
      category: 'install',
      crewSize: CREW,
      ratePerManHour: RATE_PER_MH,
      tags: [],
      requiresSafety: false,
      isActive: true
    }, o);
  }

  // ═════════════════════════════════════════════════════════
  // LABOR ACTIONS — 60 total
  // ═════════════════════════════════════════════════════════

  const LABOR = {

    // ── TEAR-OFF (7) ──
    'LAB TO1':  L({ id:'LAB TO1',  name:'Tear Off 1 Layer Comp Shingles', category:'tear-off', unit:'SQ', rate:65,  hoursPerUnit:0.4, tags:['tear-off','1-layer','shingles'] }),
    'LAB TO2':  L({ id:'LAB TO2',  name:'Tear Off 2 Layer Comp Shingles', category:'tear-off', unit:'SQ', rate:115, hoursPerUnit:0.7, tags:['tear-off','2-layer','shingles'] }),
    'LAB TO3':  L({ id:'LAB TO3',  name:'Tear Off 3 Layer Comp Shingles', category:'tear-off', unit:'SQ', rate:165, hoursPerUnit:1.0, tags:['tear-off','3-layer','shingles'] }),
    'LAB TO-TL':L({ id:'LAB TO-TL',name:'Tear Off Tile Roof',             category:'tear-off', unit:'SQ', rate:185, hoursPerUnit:1.2, tags:['tear-off','tile'] }),
    'LAB TO-MT':L({ id:'LAB TO-MT',name:'Tear Off Metal Roof',            category:'tear-off', unit:'SQ', rate:125, hoursPerUnit:0.8, tags:['tear-off','metal'] }),
    'LAB TO-WD':L({ id:'LAB TO-WD',name:'Tear Off Wood Shake',            category:'tear-off', unit:'SQ', rate:145, hoursPerUnit:0.9, tags:['tear-off','wood-shake'] }),
    'LAB TO-SL':L({ id:'LAB TO-SL',name:'Tear Off Slate Roof',            category:'tear-off', unit:'SQ', rate:285, hoursPerUnit:1.8, tags:['tear-off','slate','specialty'] }),

    // ── INSTALL — PRIMARY MATERIAL (6) ──
    'LAB INST-SH':  L({ id:'LAB INST-SH',  name:'Install Comp Shingles',      category:'install', unit:'SQ', rate:65,  hoursPerUnit:0.45, tags:['install','shingles'] }),
    'LAB INST-MT':  L({ id:'LAB INST-MT',  name:'Install Metal Roofing',      category:'install', unit:'SQ', rate:225, hoursPerUnit:1.6,  tags:['install','metal'] }),
    'LAB INST-MB':  L({ id:'LAB INST-MB',  name:'Install Modified Bitumen',   category:'install', unit:'SQ', rate:185, hoursPerUnit:1.3,  tags:['install','modified-bitumen'] }),
    'LAB INST-TPO': L({ id:'LAB INST-TPO', name:'Install TPO/EPDM Membrane',  category:'install', unit:'SQ', rate:165, hoursPerUnit:1.1,  tags:['install','tpo','epdm','low-slope'] }),
    'LAB INST-TL':  L({ id:'LAB INST-TL',  name:'Install Tile Roofing',       category:'install', unit:'SQ', rate:325, hoursPerUnit:2.3,  tags:['install','tile'] }),
    'LAB INST-WD':  L({ id:'LAB INST-WD',  name:'Install Wood Shake',         category:'install', unit:'SQ', rate:225, hoursPerUnit:1.6,  tags:['install','wood-shake'] }),

    // ── INSTALL — ACCESSORIES (8) ──
    'LAB INST-IWS': L({ id:'LAB INST-IWS', name:'Install Ice & Water Shield', category:'install', unit:'SQ', rate:22, hoursPerUnit:0.15, tags:['install','ice-water','underlayment'] }),
    'LAB INST-UDL': L({ id:'LAB INST-UDL', name:'Install Underlayment',       category:'install', unit:'SQ', rate:12, hoursPerUnit:0.08, tags:['install','underlayment'] }),
    'LAB INST-DE':  L({ id:'LAB INST-DE',  name:'Install Drip Edge',          category:'install', unit:'LF', rate:0.65, hoursPerUnit:0.02, tags:['install','drip-edge'] }),
    'LAB INST-STR': L({ id:'LAB INST-STR', name:'Install Starter Strip',      category:'install', unit:'LF', rate:0.80, hoursPerUnit:0.025, tags:['install','starter'] }),
    'LAB INST-RC':  L({ id:'LAB INST-RC',  name:'Install Ridge/Hip Cap',      category:'install', unit:'LF', rate:1.85, hoursPerUnit:0.05, tags:['install','ridge','hip','cap'] }),
    'LAB INST-RV':  L({ id:'LAB INST-RV',  name:'Install Ridge Vent',         category:'install', unit:'LF', rate:1.50, hoursPerUnit:0.05, tags:['install','ridge-vent','ventilation'] }),
    'LAB INST-VM':  L({ id:'LAB INST-VM',  name:'Install Valley Metal',       category:'install', unit:'LF', rate:4.65, hoursPerUnit:0.13, tags:['install','valley','flashing'] }),
    'LAB INST-SFTC':L({ id:'LAB INST-SFTC',name:'Install Continuous Soffit Vent',category:'install',unit:'LF',rate:1.85,hoursPerUnit:0.05, tags:['install','soffit','ventilation'] }),

    // ── INSTALL — FLASHING / PENETRATIONS (7) ──
    'LAB INST-FL':  L({ id:'LAB INST-FL',  name:'Install Flashing (Generic LF)',category:'install',unit:'LF', rate:4.65, hoursPerUnit:0.13, tags:['install','flashing'] }),
    'LAB INST-STP': L({ id:'LAB INST-STP', name:'Install Step Flashing',     category:'install', unit:'EA', rate:1.25, hoursPerUnit:0.04, tags:['install','step-flashing'] }),
    'LAB INST-CTR': L({ id:'LAB INST-CTR', name:'Install Counter Flashing',  category:'install', unit:'LF', rate:4.65, hoursPerUnit:0.13, tags:['install','counter-flashing','masonry'] }),
    'LAB INST-PB':  L({ id:'LAB INST-PB',  name:'Install Pipe Boot',         category:'install', unit:'EA', rate:28,   hoursPerUnit:0.8,  tags:['install','pipe-boot','flashing'] }),
    'LAB INST-CHM': L({ id:'LAB INST-CHM', name:'Install Chimney Flashing (Full Kit)',category:'install',unit:'EA',rate:160,hoursPerUnit:4.5,tags:['install','chimney','flashing','detail'] }),
    'LAB INST-SKY': L({ id:'LAB INST-SKY', name:'Install Skylight Flashing', category:'install', unit:'EA', rate:185,  hoursPerUnit:5.3,  tags:['install','skylight','flashing','detail'] }),
    'LAB INST-KICK':L({ id:'LAB INST-KICK',name:'Install Kickout Flashing',  category:'install', unit:'EA', rate:28,   hoursPerUnit:0.8,  tags:['install','kickout','flashing','code-required'] }),

    // ── INSTALL — DECKING (3) ──
    'LAB INST-OSB': L({ id:'LAB INST-OSB', name:'Install OSB Decking',       category:'install', unit:'SF', rate:0.85, hoursPerUnit:0.025, tags:['install','decking','osb'] }),
    'LAB INST-PLY': L({ id:'LAB INST-PLY', name:'Install Plywood Decking',   category:'install', unit:'SF', rate:0.95, hoursPerUnit:0.028, tags:['install','decking','plywood'] }),
    'LAB INST-CLIPS':L({id:'LAB INST-CLIPS',name:'Install H-Clips',          category:'install', unit:'EA', rate:0.05, hoursPerUnit:0.002, tags:['install','clips','decking'] }),

    // ── INSTALL — GUTTERS & FASCIA (6) ──
    'LAB INST-GTR5':L({ id:'LAB INST-GTR5',name:'Install 5" Seamless Gutter',category:'install', unit:'LF', rate:3.65, hoursPerUnit:0.10, tags:['install','gutter','5-inch'] }),
    'LAB INST-GTR6':L({ id:'LAB INST-GTR6',name:'Install 6" Seamless Gutter',category:'install', unit:'LF', rate:4.05, hoursPerUnit:0.12, tags:['install','gutter','6-inch'] }),
    'LAB INST-DSP': L({ id:'LAB INST-DSP', name:'Install Downspout',         category:'install', unit:'LF', rate:2.15, hoursPerUnit:0.06, tags:['install','downspout','gutters'] }),
    'LAB INST-GG':  L({ id:'LAB INST-GG',  name:'Install Gutter Guard',      category:'install', unit:'LF', rate:2.85, hoursPerUnit:0.08, tags:['install','gutter-guard'] }),
    'LAB INST-FSC': L({ id:'LAB INST-FSC', name:'Install Fascia Wrap',       category:'install', unit:'LF', rate:3.25, hoursPerUnit:0.09, tags:['install','fascia'] }),
    'LAB INST-SFT': L({ id:'LAB INST-SFT', name:'Install Soffit Panel',      category:'install', unit:'LF', rate:2.85, hoursPerUnit:0.08, tags:['install','soffit'] }),

    // ── INSTALL — VENTILATION (5) ──
    'LAB INST-BV':  L({ id:'LAB INST-BV',  name:'Install Box/Turtle Vent',   category:'install', unit:'EA', rate:25,   hoursPerUnit:0.7,  tags:['install','box-vent','ventilation'] }),
    'LAB INST-PWR': L({ id:'LAB INST-PWR', name:'Install Power Attic Vent',  category:'install', unit:'EA', rate:125,  hoursPerUnit:3.5,  tags:['install','power-vent','ventilation','electrical'] }),
    'LAB INST-TRB': L({ id:'LAB INST-TRB', name:'Install Turbine Vent',      category:'install', unit:'EA', rate:45,   hoursPerUnit:1.3,  tags:['install','turbine','ventilation'] }),
    'LAB INST-GBL': L({ id:'LAB INST-GBL', name:'Install Gable Vent',        category:'install', unit:'EA', rate:45,   hoursPerUnit:1.3,  tags:['install','gable','ventilation'] }),
    'LAB INST-SMT': L({ id:'LAB INST-SMT', name:'Install SmartVent/EdgeVent Intake',category:'install',unit:'LF',rate:2.25,hoursPerUnit:0.07,tags:['install','smartvent','intake'] }),

    // ── DETAIL / CARPENTRY (4) ──
    'LAB DTL-HR':  L({ id:'LAB DTL-HR',  name:'Detail Work (Per Hour)',      category:'detail',    unit:'HR', rate:85, hoursPerUnit:1, tags:['detail','hourly','custom'] }),
    'LAB CARP-HR': L({ id:'LAB CARP-HR', name:'Carpentry Repair (Per Hour)', category:'carpentry', unit:'HR', rate:65, hoursPerUnit:1, tags:['carpentry','repair','hourly'] }),
    'LAB STR-HR':  L({ id:'LAB STR-HR',  name:'Structural Repair (Per Hour)',category:'carpentry', unit:'HR', rate:95, hoursPerUnit:1, tags:['structural','framing','hourly'], requiresSafety:true }),
    'LAB BND-HR':  L({ id:'LAB BND-HR',  name:'Custom Metal Bending On-Site',category:'detail',    unit:'HR', rate:95, hoursPerUnit:1, tags:['metal','bending','custom','hourly'] }),

    // ── ADDERS (6) ──
    'LAB ADR-2S':  L({ id:'LAB ADR-2S',  name:'Two-Story Adder',               category:'adder', unit:'SQ', rate:12, hoursPerUnit:0.08, tags:['adder','two-story'] }),
    'LAB ADR-SS':  L({ id:'LAB ADR-SS',  name:'Steep Slope Adder (8/12+)',     category:'adder', unit:'SQ', rate:25, hoursPerUnit:0.15, tags:['adder','steep-slope','safety'], requiresSafety:true }),
    'LAB ADR-VS':  L({ id:'LAB ADR-VS',  name:'Very Steep Slope Adder (12/12+)',category:'adder',unit:'SQ', rate:45, hoursPerUnit:0.28, tags:['adder','very-steep','safety'], requiresSafety:true }),
    'LAB ADR-CU':  L({ id:'LAB ADR-CU',  name:'Cut-Up Roof Adder',             category:'adder', unit:'SQ', rate:15, hoursPerUnit:0.1,  tags:['adder','cut-up','complex'] }),
    'LAB ADR-WK':  L({ id:'LAB ADR-WK',  name:'Weekend / Emergency Adder',     category:'adder', unit:'SQ', rate:25, hoursPerUnit:0.15, tags:['adder','weekend','emergency'] }),
    'LAB ADR-OT':  L({ id:'LAB ADR-OT',  name:'Overtime Rate Adder',           category:'adder', unit:'HR', rate:50, hoursPerUnit:1,    tags:['adder','overtime'] }),

    // ── OVERHEAD / CLEANUP / DOCS (7) ──
    'LAB MOB':    L({ id:'LAB MOB',    name:'Mobilization / Setup',               category:'overhead', unit:'JOB', rate:250, hoursPerUnit:7.0, tags:['mobilization','overhead'] }),
    'LAB DEMOB':  L({ id:'LAB DEMOB',  name:'Demobilization / Cleanup',           category:'overhead', unit:'JOB', rate:185, hoursPerUnit:5.3, tags:['demobilization','cleanup'] }),
    'LAB JSP':    L({ id:'LAB JSP',    name:'Jobsite Protection Setup',           category:'overhead', unit:'JOB', rate:125, hoursPerUnit:3.5, tags:['protection','tarps','overhead'] }),
    'LAB CLN-M':  L({ id:'LAB CLN-M',  name:'Magnetic Nail Sweep',                category:'cleanup',  unit:'JOB', rate:125, hoursPerUnit:3.5, tags:['cleanup','magnetic-sweep'] }),
    'LAB PHOTO':  L({ id:'LAB PHOTO',  name:'Photo Documentation (Insurance)',    category:'overhead', unit:'JOB', rate:125, hoursPerUnit:3.5, tags:['documentation','photos','insurance'] }),
    'LAB WALK':   L({ id:'LAB WALK',   name:'Final Walk-Through & QC',            category:'overhead', unit:'JOB', rate:125, hoursPerUnit:3.5, tags:['walk-through','qc'] }),
    'LAB SUP':    L({ id:'LAB SUP',    name:'Site Supervision (Per Day)',         category:'overhead', unit:'DAY', rate:285, hoursPerUnit:8,   tags:['supervision','foreman'] }),

    // ── EMERGENCY (2) ──
    'LAB WATR-D': L({ id:'LAB WATR-D', name:'Emergency Tarp / Dry-In',            category:'emergency', unit:'JOB', rate:350, hoursPerUnit:10, tags:['emergency','tarp','dry-in'] }),
    'LAB TREE-R': L({ id:'LAB TREE-R', name:'Tree Removal from Roof',             category:'emergency', unit:'JOB', rate:850, hoursPerUnit:24, tags:['emergency','tree','removal','chainsaw'] }),

    // ── INTERIOR (5) ──
    'LAB DW-PATCH': L({ id:'LAB DW-PATCH', name:'Drywall Patch Labor',             category:'install', unit:'SF', rate:12.50, hoursPerUnit:0.35, tags:['interior','drywall','patch'] }),
    'LAB CLG-TX':   L({ id:'LAB CLG-TX',   name:'Ceiling Texture Match',           category:'detail',  unit:'EA', rate:195,   hoursPerUnit:5.5,  tags:['interior','ceiling','texture'] }),
    'LAB PNT-RM':   L({ id:'LAB PNT-RM',   name:'Paint Room (Labor Only)',         category:'install', unit:'RM', rate:425,   hoursPerUnit:12,   tags:['interior','paint','room'] }),
    'LAB PNT-CLG':  L({ id:'LAB PNT-CLG',  name:'Paint Ceiling (Labor Only)',      category:'install', unit:'SF', rate:1.25,  hoursPerUnit:0.035,tags:['interior','paint','ceiling'] }),
    'LAB FLR-RPR':  L({ id:'LAB FLR-RPR',  name:'Flooring Spot Repair (Hourly)',   category:'carpentry', unit:'HR', rate:65,  hoursPerUnit:1,    tags:['interior','flooring','repair'] })
  };

  // ═════════════════════════════════════════════════════════
  // Public API
  // ═════════════════════════════════════════════════════════

  window.NBD_LABOR = {
    items: LABOR,
    count: Object.keys(LABOR).length,

    get: function(id) {
      return LABOR[id] || null;
    },

    find: function(id) {
      return LABOR[id] || null;
    },

    byCategory: function(category) {
      return Object.values(LABOR).filter(l => l.category === category);
    },

    search: function(q) {
      q = (q || '').toLowerCase();
      if (!q) return Object.values(LABOR);
      return Object.values(LABOR).filter(l =>
        (l.name || '').toLowerCase().includes(q) ||
        (l.id || '').toLowerCase().includes(q) ||
        (l.tags || []).some(t => t.toLowerCase().includes(q))
      );
    },

    // Update a labor rate at runtime (persisted to localStorage)
    updateRate: function(id, newRate) {
      if (!LABOR[id]) return false;
      LABOR[id].rate = Number(newRate);
      try {
        const overrides = JSON.parse(localStorage.getItem('nbd_labor_overrides') || '{}');
        overrides[id] = { rate: LABOR[id].rate, updatedAt: new Date().toISOString() };
        localStorage.setItem('nbd_labor_overrides', JSON.stringify(overrides));
      } catch (e) {}
      return true;
    },

    // Reset all labor rates to defaults
    resetRates: function() {
      try { localStorage.removeItem('nbd_labor_overrides'); } catch (e) {}
      // Caller must reload the page to get fresh defaults
    }
  };

  // Apply any persisted rate overrides from localStorage
  try {
    const overrides = JSON.parse(localStorage.getItem('nbd_labor_overrides') || '{}');
    Object.keys(overrides).forEach(id => {
      if (LABOR[id]) LABOR[id].rate = Number(overrides[id].rate);
    });
  } catch (e) {}

  console.log(`[NBD Labor] Loaded ${Object.keys(LABOR).length} labor actions.`);
})();
