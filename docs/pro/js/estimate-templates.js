/**
 * NBD Pro — Estimate Templates v1
 * Pre-built job templates with product selections for common contracting jobs.
 * Each template = { id, name, category, icon, description, difficulty, items: [{productId, qty, tier}] }
 * Used by the "From Template" estimate builder to pre-populate line items.
 */

window.ESTIMATE_TEMPLATES = [

// ═══════════════════════════════════════════════════════
// ROOFING — RESIDENTIAL (15)
// ═══════════════════════════════════════════════════════
{id:'t001',name:'Standard Re-Roof (25 SQ)',category:'Roofing',icon:'🏠',description:'Complete tear-off and re-roof for average single-story home. Includes underlayment, drip edge, starter, ridge cap, ice & water, pipe boots, and cleanup.',difficulty:'Standard',items:[
  {productId:'shingle_001',qty:25,tier:'better'},{productId:'under_001',qty:3,tier:'good'},{productId:'under_006',qty:4,tier:'good'},
  {productId:'flash_003',qty:200,tier:'good'},{productId:'flash_008',qty:3,tier:'good'},{productId:'flash_007',qty:5,tier:'good'},
  {productId:'flash_002',qty:6,tier:'better'},{productId:'flash_006',qty:30,tier:'good'},{productId:'flash_005',qty:12,tier:'good'},
  {productId:'acc_006',qty:40,tier:'better'},{productId:'acc_020',qty:1,tier:'better'},{productId:'acc_021',qty:25,tier:'better'},
  {productId:'acc_023',qty:1,tier:'good'}
]},
{id:'t002',name:'Premium Re-Roof (25 SQ)',category:'Roofing',icon:'⭐',description:'Upgraded re-roof with premium shingles, synthetic underlayment, lifetime pipe boots, and full ice & water shield at eaves and valleys.',difficulty:'Premium',items:[
  {productId:'shingle_001',qty:25,tier:'best'},{productId:'under_002',qty:3,tier:'good'},{productId:'under_006',qty:6,tier:'good'},
  {productId:'flash_003',qty:200,tier:'good'},{productId:'flash_008',qty:3,tier:'good'},{productId:'flash_007',qty:6,tier:'best'},
  {productId:'acc_009',qty:6,tier:'best'},{productId:'flash_006',qty:30,tier:'good'},{productId:'flash_005',qty:12,tier:'good'},
  {productId:'acc_006',qty:40,tier:'best'},{productId:'acc_016',qty:200,tier:'better'},{productId:'acc_020',qty:1,tier:'best'},
  {productId:'acc_021',qty:25,tier:'best'},{productId:'acc_023',qty:1,tier:'good'}
]},
{id:'t003',name:'Small Re-Roof (15 SQ)',category:'Roofing',icon:'🏡',description:'Complete re-roof for smaller home, townhome, or ranch. Standard materials and cleanup.',difficulty:'Standard',items:[
  {productId:'shingle_001',qty:15,tier:'better'},{productId:'under_001',qty:2,tier:'good'},{productId:'under_006',qty:3,tier:'good'},
  {productId:'flash_003',qty:140,tier:'good'},{productId:'flash_008',qty:2,tier:'good'},{productId:'flash_007',qty:3,tier:'good'},
  {productId:'flash_002',qty:4,tier:'better'},{productId:'flash_006',qty:20,tier:'good'},{productId:'flash_005',qty:8,tier:'good'},
  {productId:'acc_006',qty:30,tier:'better'},{productId:'acc_020',qty:1,tier:'good'},{productId:'acc_021',qty:15,tier:'better'}
]},
{id:'t004',name:'Large Re-Roof (40 SQ)',category:'Roofing',icon:'🏰',description:'Full re-roof for large two-story home. Double dumpster, extended crew, and full accessory package.',difficulty:'Complex',items:[
  {productId:'shingle_001',qty:40,tier:'better'},{productId:'under_001',qty:5,tier:'good'},{productId:'under_006',qty:8,tier:'good'},
  {productId:'flash_003',qty:300,tier:'good'},{productId:'flash_008',qty:4,tier:'good'},{productId:'flash_007',qty:8,tier:'good'},
  {productId:'flash_002',qty:10,tier:'better'},{productId:'flash_006',qty:40,tier:'good'},{productId:'flash_005',qty:16,tier:'good'},
  {productId:'acc_006',qty:60,tier:'better'},{productId:'acc_020',qty:2,tier:'better'},{productId:'acc_021',qty:40,tier:'better'},
  {productId:'acc_023',qty:1,tier:'good'},{productId:'acc_004',qty:3,tier:'better'}
]},
{id:'t005',name:'Roof Repair — Leak Fix',category:'Roofing',icon:'🔧',description:'Targeted roof repair for active leak. Includes pipe boot replacement, flashing repair, sealant, and shingle patching.',difficulty:'Repair',items:[
  {productId:'shingle_001',qty:2,tier:'better'},{productId:'flash_002',qty:2,tier:'best'},{productId:'acc_002',qty:4,tier:'better'},
  {productId:'flash_005',qty:6,tier:'good'},{productId:'acc_018',qty:1,tier:'better'},{productId:'acc_019',qty:1,tier:'good'}
]},
{id:'t006',name:'Roof Repair — Storm Damage Patch',category:'Roofing',icon:'⛈️',description:'Patch repair for localized storm damage. Shingle replacement, flashing check, and re-seal.',difficulty:'Repair',items:[
  {productId:'shingle_001',qty:3,tier:'better'},{productId:'flash_005',qty:8,tier:'good'},{productId:'acc_002',qty:3,tier:'better'},
  {productId:'flash_007',qty:1,tier:'good'},{productId:'acc_018',qty:1,tier:'good'}
]},
{id:'t007',name:'Re-Roof with Chimney Flashing',category:'Roofing',icon:'🧱',description:'Standard re-roof plus complete chimney flashing replacement with step, counter, and apron.',difficulty:'Standard',items:[
  {productId:'shingle_001',qty:25,tier:'better'},{productId:'under_001',qty:3,tier:'good'},{productId:'under_006',qty:4,tier:'good'},
  {productId:'flash_003',qty:200,tier:'good'},{productId:'flash_008',qty:3,tier:'good'},{productId:'flash_007',qty:5,tier:'good'},
  {productId:'flash_002',qty:6,tier:'better'},{productId:'acc_001',qty:1,tier:'better'},{productId:'flash_005',qty:12,tier:'good'},
  {productId:'acc_006',qty:40,tier:'better'},{productId:'acc_020',qty:1,tier:'better'},{productId:'acc_021',qty:25,tier:'better'}
]},
{id:'t008',name:'Re-Roof with Skylight',category:'Roofing',icon:'🪟',description:'Standard re-roof including skylight replacement or re-flash of existing skylight.',difficulty:'Standard',items:[
  {productId:'shingle_001',qty:25,tier:'better'},{productId:'under_001',qty:3,tier:'good'},{productId:'under_006',qty:4,tier:'good'},
  {productId:'flash_003',qty:200,tier:'good'},{productId:'flash_008',qty:3,tier:'good'},{productId:'flash_007',qty:5,tier:'good'},
  {productId:'spec_001',qty:1,tier:'better'},{productId:'acc_024',qty:1,tier:'better'},{productId:'flash_005',qty:12,tier:'good'},
  {productId:'acc_006',qty:40,tier:'better'},{productId:'acc_020',qty:1,tier:'better'},{productId:'acc_021',qty:25,tier:'better'}
]},
{id:'t009',name:'Insurance Roof Replacement',category:'Roofing',icon:'🛡️',description:'Insurance scope-matched re-roof with all line items typically approved by adjusters. Includes code upgrades.',difficulty:'Standard',items:[
  {productId:'shingle_001',qty:25,tier:'better'},{productId:'under_001',qty:3,tier:'good'},{productId:'under_006',qty:6,tier:'good'},
  {productId:'flash_003',qty:200,tier:'good'},{productId:'flash_008',qty:3,tier:'good'},{productId:'flash_007',qty:6,tier:'good'},
  {productId:'flash_002',qty:6,tier:'better'},{productId:'flash_006',qty:30,tier:'good'},{productId:'flash_005',qty:12,tier:'good'},
  {productId:'acc_006',qty:40,tier:'better'},{productId:'acc_020',qty:1,tier:'better'},{productId:'acc_021',qty:25,tier:'better'},
  {productId:'acc_023',qty:1,tier:'good'},{productId:'acc_022',qty:1,tier:'good'},{productId:'acc_004',qty:3,tier:'better'},
  {productId:'acc_015',qty:16,tier:'good'}
]},
{id:'t010',name:'Roof Overlay (No Tear-Off)',category:'Roofing',icon:'📋',description:'Second-layer shingle install over existing roof. No tear-off required. Budget-friendly option.',difficulty:'Budget',items:[
  {productId:'shingle_001',qty:25,tier:'good'},{productId:'flash_003',qty:200,tier:'good'},{productId:'flash_008',qty:3,tier:'good'},
  {productId:'flash_007',qty:5,tier:'good'},{productId:'flash_002',qty:6,tier:'good'},{productId:'flash_005',qty:8,tier:'good'},
  {productId:'acc_006',qty:40,tier:'good'}
]},
{id:'t011',name:'3-Tab to Architectural Upgrade',category:'Roofing',icon:'📈',description:'Upgrade from 3-tab to architectural shingles. Full tear-off with premium materials.',difficulty:'Standard',items:[
  {productId:'shingle_001',qty:25,tier:'better'},{productId:'under_002',qty:3,tier:'good'},{productId:'under_006',qty:4,tier:'good'},
  {productId:'flash_003',qty:200,tier:'good'},{productId:'flash_008',qty:3,tier:'good'},{productId:'flash_007',qty:5,tier:'better'},
  {productId:'flash_002',qty:6,tier:'better'},{productId:'acc_006',qty:40,tier:'better'},{productId:'acc_020',qty:1,tier:'better'},
  {productId:'acc_021',qty:25,tier:'better'},{productId:'acc_023',qty:1,tier:'good'}
]},
{id:'t012',name:'Ventilation Upgrade Package',category:'Roofing',icon:'💨',description:'Add balanced ventilation to existing roof. Ridge vent, soffit intake, and power vent options.',difficulty:'Add-On',items:[
  {productId:'acc_006',qty:40,tier:'better'},{productId:'acc_007',qty:8,tier:'better'},{productId:'acc_005',qty:2,tier:'better'}
]},
{id:'t013',name:'Flat Roof Repair (Modified Bitumen)',category:'Roofing',icon:'🏢',description:'Low-slope / flat roof repair with modified bitumen membrane and adhesive.',difficulty:'Repair',items:[
  {productId:'under_006',qty:2,tier:'good'},{productId:'acc_014',qty:2,tier:'better'},{productId:'acc_002',qty:6,tier:'best'},
  {productId:'acc_018',qty:2,tier:'best'},{productId:'acc_019',qty:1,tier:'good'}
]},
{id:'t014',name:'Emergency Tarp & Board-Up',category:'Roofing',icon:'🚨',description:'Emergency storm damage response. Tarping, board-up, and temporary weatherproofing.',difficulty:'Emergency',items:[
  {productId:'spec_005',qty:1,tier:'better'},{productId:'acc_002',qty:4,tier:'good'},{productId:'acc_018',qty:1,tier:'good'}
]},
{id:'t015',name:'Decking Replacement + Re-Roof',category:'Roofing',icon:'🪵',description:'Re-roof with extensive plywood decking replacement (10+ sheets). For severely damaged decks.',difficulty:'Complex',items:[
  {productId:'shingle_001',qty:25,tier:'better'},{productId:'acc_004',qty:12,tier:'better'},{productId:'under_001',qty:3,tier:'good'},
  {productId:'under_006',qty:6,tier:'good'},{productId:'flash_003',qty:200,tier:'good'},{productId:'flash_008',qty:3,tier:'good'},
  {productId:'flash_007',qty:5,tier:'good'},{productId:'flash_002',qty:6,tier:'better'},{productId:'acc_006',qty:40,tier:'better'},
  {productId:'acc_020',qty:2,tier:'better'},{productId:'acc_021',qty:25,tier:'best'}
]},

// ═══════════════════════════════════════════════════════
// GUTTERS (8)
// ═══════════════════════════════════════════════════════
{id:'t016',name:'Full Gutter Replacement (5")',category:'Gutters',icon:'🌧️',description:'Complete gutter system replacement with seamless aluminum gutters, downspouts, and hangers.',difficulty:'Standard',items:[
  {productId:'gutter_001',qty:150,tier:'better'},{productId:'gutter_002',qty:6,tier:'better'},{productId:'gutter_003',qty:150,tier:'good'},
  {productId:'acc_011',qty:4,tier:'good'},{productId:'acc_013',qty:6,tier:'better'}
]},
{id:'t017',name:'Gutter Replacement (6" Oversized)',category:'Gutters',icon:'🌧️',description:'Oversized 6" gutter system for steep roofs or heavy rainfall areas.',difficulty:'Premium',items:[
  {productId:'gutter_001',qty:150,tier:'best'},{productId:'gutter_002',qty:6,tier:'best'},{productId:'gutter_003',qty:150,tier:'better'},
  {productId:'acc_011',qty:6,tier:'better'},{productId:'acc_013',qty:6,tier:'best'}
]},
{id:'t018',name:'Gutter Guard Installation',category:'Gutters',icon:'🍂',description:'Gutter guard/leaf screen system for existing gutters. Prevents debris clogging.',difficulty:'Add-On',items:[
  {productId:'acc_012',qty:150,tier:'better'}
]},
{id:'t019',name:'Gutter Repair — Sections',category:'Gutters',icon:'🔧',description:'Partial gutter repair. Replace damaged sections, re-slope, and re-seal.',difficulty:'Repair',items:[
  {productId:'gutter_001',qty:30,tier:'better'},{productId:'gutter_003',qty:30,tier:'good'},{productId:'acc_002',qty:2,tier:'better'},
  {productId:'acc_011',qty:2,tier:'good'}
]},
{id:'t020',name:'Downspout Reroute & Extension',category:'Gutters',icon:'💧',description:'Extend and reroute downspouts away from foundation. Includes underground drainage option.',difficulty:'Add-On',items:[
  {productId:'gutter_002',qty:4,tier:'better'},{productId:'acc_013',qty:8,tier:'best'}
]},
{id:'t021',name:'Roof + Gutters Combo',category:'Gutters',icon:'🏠',description:'Complete re-roof with full gutter replacement. Most common insurance combo.',difficulty:'Standard',items:[
  {productId:'shingle_001',qty:25,tier:'better'},{productId:'under_001',qty:3,tier:'good'},{productId:'under_006',qty:4,tier:'good'},
  {productId:'flash_003',qty:200,tier:'good'},{productId:'flash_008',qty:3,tier:'good'},{productId:'flash_007',qty:5,tier:'good'},
  {productId:'flash_002',qty:6,tier:'better'},{productId:'acc_006',qty:40,tier:'better'},{productId:'acc_020',qty:1,tier:'better'},
  {productId:'acc_021',qty:25,tier:'better'},{productId:'gutter_001',qty:150,tier:'better'},{productId:'gutter_002',qty:6,tier:'better'},
  {productId:'gutter_003',qty:150,tier:'good'}
]},
{id:'t022',name:'Ice Dam Prevention Package',category:'Gutters',icon:'❄️',description:'Heat cable installation along gutters and eaves to prevent ice damming.',difficulty:'Add-On',items:[
  {productId:'spec_004',qty:100,tier:'better'},{productId:'acc_002',qty:3,tier:'good'}
]},
{id:'t023',name:'Gutter + Guard Combo',category:'Gutters',icon:'🛡️',description:'New gutters with integrated gutter guard system. Zero-maintenance package.',difficulty:'Premium',items:[
  {productId:'gutter_001',qty:150,tier:'best'},{productId:'gutter_002',qty:6,tier:'best'},{productId:'gutter_003',qty:150,tier:'better'},
  {productId:'acc_012',qty:150,tier:'best'},{productId:'acc_013',qty:6,tier:'best'}
]},

// ═══════════════════════════════════════════════════════
// SIDING (6)
// ═══════════════════════════════════════════════════════
{id:'t024',name:'Full Siding Replacement (Vinyl)',category:'Siding',icon:'🧱',description:'Complete house re-side with vinyl siding, house wrap, J-channel, and trim.',difficulty:'Standard',items:[
  {productId:'siding_001',qty:1500,tier:'better'},{productId:'siding_005',qty:1500,tier:'good'},{productId:'siding_004',qty:120,tier:'better'}
]},
{id:'t025',name:'Siding Replacement (James Hardie)',category:'Siding',icon:'⭐',description:'Premium fiber cement siding installation. Includes house wrap, trim, and painting.',difficulty:'Premium',items:[
  {productId:'siding_002',qty:1500,tier:'best'},{productId:'siding_005',qty:1500,tier:'better'},{productId:'siding_004',qty:120,tier:'best'},
  {productId:'paint_006',qty:1500,tier:'better'}
]},
{id:'t026',name:'Siding Repair — Sections',category:'Siding',icon:'🔧',description:'Partial siding repair. Replace damaged sections, re-flash, and color match.',difficulty:'Repair',items:[
  {productId:'siding_001',qty:200,tier:'better'},{productId:'siding_005',qty:200,tier:'good'},{productId:'acc_002',qty:4,tier:'better'}
]},
{id:'t027',name:'Soffit & Fascia Replacement',category:'Siding',icon:'🏗️',description:'Replace rotted or damaged soffit and fascia boards. Includes ventilation check.',difficulty:'Standard',items:[
  {productId:'acc_015',qty:100,tier:'better'},{productId:'acc_007',qty:6,tier:'better'},{productId:'paint_005',qty:10,tier:'good'}
]},
{id:'t028',name:'Roof + Siding Combo',category:'Siding',icon:'🏠',description:'Full exterior package: re-roof + siding replacement. Major insurance restoration.',difficulty:'Complex',items:[
  {productId:'shingle_001',qty:25,tier:'better'},{productId:'under_001',qty:3,tier:'good'},{productId:'under_006',qty:4,tier:'good'},
  {productId:'flash_003',qty:200,tier:'good'},{productId:'flash_008',qty:3,tier:'good'},{productId:'flash_007',qty:5,tier:'good'},
  {productId:'acc_006',qty:40,tier:'better'},{productId:'acc_020',qty:2,tier:'best'},{productId:'acc_021',qty:25,tier:'better'},
  {productId:'siding_001',qty:1500,tier:'better'},{productId:'siding_005',qty:1500,tier:'good'},{productId:'siding_004',qty:120,tier:'better'}
]},
{id:'t029',name:'Board & Batten Accent Wall',category:'Siding',icon:'🎨',description:'Decorative board & batten siding accent on front elevation. Curb appeal upgrade.',difficulty:'Add-On',items:[
  {productId:'siding_002',qty:300,tier:'best'},{productId:'siding_004',qty:40,tier:'best'},{productId:'paint_006',qty:300,tier:'better'}
]},

// ═══════════════════════════════════════════════════════
// WINDOWS & DOORS (5)
// ═══════════════════════════════════════════════════════
{id:'t030',name:'Window Replacement — Single',category:'Windows',icon:'🪟',description:'Single window replacement with vinyl or fiberglass insert. Includes trim and caulk.',difficulty:'Standard',items:[
  {productId:'window_001',qty:1,tier:'better'},{productId:'paint_005',qty:4,tier:'better'}
]},
{id:'t031',name:'Window Replacement — Full House (10)',category:'Windows',icon:'🪟',description:'Whole-house window replacement package. 10 standard-size windows with trim.',difficulty:'Premium',items:[
  {productId:'window_001',qty:10,tier:'better'},{productId:'paint_005',qty:30,tier:'better'}
]},
{id:'t032',name:'Entry Door Replacement',category:'Windows',icon:'🚪',description:'Front entry door replacement with frame, threshold, and hardware.',difficulty:'Standard',items:[
  {productId:'door_001',qty:1,tier:'better'},{productId:'paint_005',qty:6,tier:'better'}
]},
{id:'t033',name:'Sliding Patio Door Replacement',category:'Windows',icon:'🚪',description:'Sliding glass patio door replacement with frame and screen.',difficulty:'Standard',items:[
  {productId:'door_001',qty:1,tier:'best'},{productId:'paint_005',qty:6,tier:'better'}
]},
{id:'t034',name:'Storm Window Package',category:'Windows',icon:'⛈️',description:'Storm window installation for energy efficiency. Interior or exterior mount.',difficulty:'Add-On',items:[
  {productId:'window_001',qty:8,tier:'good'}
]},

// ═══════════════════════════════════════════════════════
// PAINTING & EXTERIOR (5)
// ═══════════════════════════════════════════════════════
{id:'t035',name:'Full Exterior Repaint',category:'Painting',icon:'🖌️',description:'Complete exterior house painting. Power wash, scrape, prime, 2 coats. Body + trim.',difficulty:'Standard',items:[
  {productId:'paint_004',qty:2000,tier:'better'},{productId:'paint_001',qty:15,tier:'better'},{productId:'paint_002',qty:5,tier:'better'},
  {productId:'paint_005',qty:20,tier:'better'},{productId:'paint_006',qty:2000,tier:'better'}
]},
{id:'t036',name:'Deck Staining / Sealing',category:'Painting',icon:'🪑',description:'Power wash and re-stain/seal existing wood deck. Includes railing and stairs.',difficulty:'Standard',items:[
  {productId:'paint_004',qty:400,tier:'good'},{productId:'paint_003',qty:4,tier:'better'}
]},
{id:'t037',name:'Trim & Accent Painting',category:'Painting',icon:'🎨',description:'Exterior trim, doors, and shutters painting only. Touch-up and refresh.',difficulty:'Budget',items:[
  {productId:'paint_001',qty:3,tier:'better'},{productId:'paint_002',qty:1,tier:'good'},{productId:'paint_005',qty:8,tier:'better'},
  {productId:'paint_006',qty:400,tier:'good'}
]},
{id:'t038',name:'Fence Staining',category:'Painting',icon:'🏡',description:'Power wash and stain wood fence. Semi-transparent or solid stain.',difficulty:'Standard',items:[
  {productId:'paint_004',qty:800,tier:'good'},{productId:'paint_003',qty:6,tier:'better'}
]},
{id:'t039',name:'Power Wash Only',category:'Painting',icon:'💦',description:'Full property power wash. House, driveway, sidewalk, patio.',difficulty:'Budget',items:[
  {productId:'paint_004',qty:3000,tier:'best'}
]},

// ═══════════════════════════════════════════════════════
// CONCRETE & MASONRY (5)
// ═══════════════════════════════════════════════════════
{id:'t040',name:'Driveway Replacement',category:'Concrete',icon:'🚗',description:'Tear out and pour new concrete driveway. 5-6 inch thick with fiber reinforcement.',difficulty:'Standard',items:[
  {productId:'concrete_002',qty:600,tier:'better'}
]},
{id:'t041',name:'Patio / Sidewalk Pour',category:'Concrete',icon:'🧱',description:'New concrete patio or sidewalk. 4 inch thick with broom or stamped finish.',difficulty:'Standard',items:[
  {productId:'concrete_001',qty:200,tier:'better'},{productId:'concrete_005',qty:200,tier:'good'}
]},
{id:'t042',name:'Chimney Repair & Repoint',category:'Concrete',icon:'🧱',description:'Complete chimney tuckpointing and crown rebuild with new cap.',difficulty:'Standard',items:[
  {productId:'concrete_003',qty:60,tier:'better'},{productId:'concrete_004',qty:1,tier:'better'}
]},
{id:'t043',name:'Retaining Wall — Small',category:'Concrete',icon:'🏗️',description:'Small decorative retaining wall (under 4 ft height). Block system with drainage.',difficulty:'Standard',items:[
  {productId:'concrete_006',qty:60,tier:'better'}
]},
{id:'t044',name:'Concrete Sealing & Repair',category:'Concrete',icon:'🔧',description:'Patch cracks, fill joints, and apply concrete sealer to existing flatwork.',difficulty:'Repair',items:[
  {productId:'concrete_005',qty:600,tier:'better'},{productId:'paint_005',qty:6,tier:'better'}
]},

// ═══════════════════════════════════════════════════════
// DECKING (4)
// ═══════════════════════════════════════════════════════
{id:'t045',name:'New Deck Build (300 SF)',category:'Decking',icon:'🪑',description:'Ground-up deck build with framing, decking, railing, and stairs. Pressure-treated or composite.',difficulty:'Standard',items:[
  {productId:'deck_001',qty:300,tier:'better'},{productId:'deck_004',qty:60,tier:'better'},{productId:'deck_005',qty:12,tier:'better'},
  {productId:'deck_006',qty:8,tier:'better'},{productId:'acc_022',qty:1,tier:'better'}
]},
{id:'t046',name:'Composite Deck Build (Trex)',category:'Decking',icon:'⭐',description:'Premium composite deck build with Trex decking, composite railing, and hidden fasteners.',difficulty:'Premium',items:[
  {productId:'deck_002',qty:300,tier:'best'},{productId:'deck_004',qty:60,tier:'best'},{productId:'deck_005',qty:12,tier:'best'},
  {productId:'deck_006',qty:8,tier:'best'},{productId:'acc_022',qty:1,tier:'better'}
]},
{id:'t047',name:'Deck Repair & Board Replacement',category:'Decking',icon:'🔧',description:'Replace damaged deck boards, tighten hardware, and refinish. Structural check included.',difficulty:'Repair',items:[
  {productId:'deck_001',qty:50,tier:'better'},{productId:'deck_005',qty:4,tier:'good'},{productId:'paint_003',qty:3,tier:'better'}
]},
{id:'t048',name:'Deck Railing Replacement',category:'Decking',icon:'🛡️',description:'Replace existing deck railing system. Options from aluminum to glass panel.',difficulty:'Add-On',items:[
  {productId:'deck_004',qty:40,tier:'better'}
]},

// ═══════════════════════════════════════════════════════
// INSULATION & SPECIALTY (7)
// ═══════════════════════════════════════════════════════
{id:'t049',name:'Attic Insulation Upgrade',category:'Insulation',icon:'🧊',description:'Blow additional insulation into attic to reach R-49. Includes baffles and air sealing.',difficulty:'Standard',items:[
  {productId:'insul_001',qty:1200,tier:'best'}
]},
{id:'t050',name:'Spray Foam — Rim Joist',category:'Insulation',icon:'🧊',description:'Closed-cell spray foam on exposed rim joists in basement or crawlspace.',difficulty:'Standard',items:[
  {productId:'insul_003',qty:200,tier:'better'}
]},
{id:'t051',name:'Skylight Installation',category:'Specialty',icon:'🌤️',description:'New skylight installation with framing, flashing, and interior trim.',difficulty:'Premium',items:[
  {productId:'spec_001',qty:1,tier:'better'},{productId:'acc_024',qty:1,tier:'better'},{productId:'acc_004',qty:1,tier:'better'}
]},
{id:'t052',name:'Solar Attic Fan Installation',category:'Specialty',icon:'☀️',description:'Install solar-powered attic ventilation fan. No electrical required.',difficulty:'Add-On',items:[
  {productId:'spec_002',qty:1,tier:'better'}
]},
{id:'t053',name:'Satellite Dish Removal + Patch',category:'Specialty',icon:'📡',description:'Remove old satellite dish, patch penetrations, and re-seal roof.',difficulty:'Add-On',items:[
  {productId:'spec_003',qty:1,tier:'better'},{productId:'acc_002',qty:2,tier:'better'}
]},
{id:'t054',name:'Full Exterior Restoration',category:'Specialty',icon:'🏠',description:'The whole package: roof, gutters, siding, windows, and paint. Major insurance or renovation project.',difficulty:'Complex',items:[
  {productId:'shingle_001',qty:25,tier:'better'},{productId:'under_001',qty:3,tier:'good'},{productId:'under_006',qty:4,tier:'good'},
  {productId:'flash_003',qty:200,tier:'good'},{productId:'flash_008',qty:3,tier:'good'},{productId:'flash_007',qty:5,tier:'good'},
  {productId:'flash_002',qty:6,tier:'better'},{productId:'acc_006',qty:40,tier:'better'},{productId:'acc_020',qty:2,tier:'best'},
  {productId:'acc_021',qty:25,tier:'better'},{productId:'gutter_001',qty:150,tier:'better'},{productId:'gutter_002',qty:6,tier:'better'},
  {productId:'siding_001',qty:1500,tier:'better'},{productId:'siding_005',qty:1500,tier:'good'},{productId:'siding_004',qty:120,tier:'better'},
  {productId:'window_001',qty:10,tier:'better'},{productId:'paint_001',qty:5,tier:'better'},{productId:'paint_006',qty:1500,tier:'better'}
]},
{id:'t055',name:'Fencing — Wood Privacy (100 LF)',category:'Fencing',icon:'🏡',description:'New wood privacy fence. 6ft cedar or pressure-treated with posts and gate.',difficulty:'Standard',items:[
  {productId:'fence_001',qty:100,tier:'better'},{productId:'fence_002',qty:1,tier:'better'}
]}
];

// ── TEMPLATE SELECTOR UI ──────────────────────────────────────
window.showEstimateTemplateSelector = function() {
  const templates = window.ESTIMATE_TEMPLATES || [];
  const categories = [...new Set(templates.map(t => t.category))];

  const modal = document.createElement('div');
  modal.id = 'templateSelectorModal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center;z-index:10001;';

  const catButtons = categories.map(c => `<button class="tpl-cat-btn" onclick="filterTemplates('${c}',this)" style="padding:4px 12px;border-radius:12px;border:1px solid var(--br);background:none;color:var(--m);font-size:11px;cursor:pointer;transition:all .15s;">${c}</button>`).join('');

  const cards = templates.map(t => {
    const itemCount = t.items.length;
    const diffColors = {Standard:'#3b82f6',Premium:'#e8720c',Complex:'#8b5cf6',Repair:'#f59e0b',Budget:'#10b981','Add-On':'#06b6d4',Emergency:'#ef4444'};
    const dc = diffColors[t.difficulty] || '#6b7280';
    return `<div class="tpl-card" data-cat="${t.category}" onclick="loadEstimateTemplate('${t.id}')" style="background:var(--s2);border:1px solid var(--br);border-radius:8px;padding:14px;cursor:pointer;transition:all .15s;" onmouseenter="this.style.borderColor='var(--orange)';this.style.transform='translateY(-2px)'" onmouseleave="this.style.borderColor='var(--br)';this.style.transform='none'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;">
        <span style="font-size:24px;">${t.icon}</span>
        <span style="font-size:9px;padding:2px 6px;border-radius:4px;background:${dc}18;color:${dc};font-weight:600;">${t.difficulty}</span>
      </div>
      <div style="font-weight:700;font-size:13px;color:var(--t);margin-bottom:4px;">${t.name}</div>
      <div style="font-size:11px;color:var(--m);line-height:1.4;margin-bottom:8px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${t.description}</div>
      <div style="font-size:10px;color:var(--m);">${itemCount} line items</div>
    </div>`;
  }).join('');

  modal.innerHTML = `<div style="background:var(--s);border-radius:12px;max-width:900px;width:95%;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
    <div style="padding:24px 24px 16px;border-bottom:1px solid var(--br);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h2 style="margin:0;font-size:22px;color:var(--t);">📋 Start from Template</h2>
        <button onclick="document.getElementById('templateSelectorModal').remove()" style="background:none;border:none;color:var(--m);font-size:20px;cursor:pointer;">✕</button>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="tpl-cat-btn tpl-cat-active" onclick="filterTemplates('all',this)" style="padding:4px 12px;border-radius:12px;border:1px solid var(--orange);background:var(--orange);color:#fff;font-size:11px;cursor:pointer;font-weight:600;">All (${templates.length})</button>
        ${catButtons}
      </div>
    </div>
    <div id="tplGrid" style="padding:16px 24px 24px;overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;">
      ${cards}
    </div>
  </div>`;

  document.body.appendChild(modal);
};

window.filterTemplates = function(cat, btn) {
  document.querySelectorAll('.tpl-cat-btn').forEach(b => {
    b.style.background = 'none';
    b.style.color = 'var(--m)';
    b.style.borderColor = 'var(--br)';
    b.classList.remove('tpl-cat-active');
  });
  btn.style.background = 'var(--orange)';
  btn.style.color = '#fff';
  btn.style.borderColor = 'var(--orange)';

  document.querySelectorAll('.tpl-card').forEach(card => {
    card.style.display = (cat === 'all' || card.dataset.cat === cat) ? '' : 'none';
  });
};

window.loadEstimateTemplate = function(templateId) {
  const template = (window.ESTIMATE_TEMPLATES || []).find(t => t.id === templateId);
  if (!template) return;

  // Close template selector
  const modal = document.getElementById('templateSelectorModal');
  if (modal) modal.remove();

  // Also close the type selector if open
  const typeModal = document.getElementById('estimateTypeSelectorModal');
  if (typeModal) typeModal.remove();

  // Open Advanced Builder with pre-loaded items
  if (typeof openAdvancedBuilder === 'function') {
    openAdvancedBuilder();
    // Slight delay to let the builder render, then load items
    setTimeout(() => {
      if (typeof window._advancedBuilder_loadTemplate === 'function') {
        window._advancedBuilder_loadTemplate(template);
      } else {
        // Fallback: show toast with info
        if (typeof showToast === 'function') {
          showToast('Template loaded: ' + template.name + ' (' + template.items.length + ' items)');
        }
      }
    }, 300);
  }
};
