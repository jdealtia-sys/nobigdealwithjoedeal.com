/**
 * NBD Pro - Product Library
 * Complete CRUD system for roofing/exterior contracting materials & labor
 * Stores in localStorage under 'nbd_product_library'
 */

(function() {
  'use strict';

  // ============================================================================
  // CONSTANTS & CONFIGURATION
  // ============================================================================

  const STORAGE_KEY = 'nbd_product_library';
  const DEMO_VERSION = 1;

  const CATEGORIES = {
    roofing_materials: { label: 'Roofing Materials', icon: '🏠', color: '#C8541A' },
    roofing_labor: { label: 'Roofing Labor', icon: '👷', color: '#e67e22' },
    gutters: { label: 'Gutters', icon: '🌧️', color: '#0ea5e9' },
    siding: { label: 'Siding', icon: '🧱', color: '#10b981' },
    windows_doors: { label: 'Windows & Doors', icon: '🪟', color: '#7c3aed' },
    interior: { label: 'Interior', icon: '🎨', color: '#ec4899' },
    specialty: { label: 'Specialty', icon: '⚡', color: '#f59e0b' }
  };

  const UNITS = ['SQ', 'LF', 'EA', 'SF', 'HR', 'RM', 'JOB', 'DAY'];

  const TIERS = ['good', 'better', 'best'];

  // ============================================================================
  // DEMO PRODUCTS (60+ items)
  // ============================================================================

  const DEMO_PRODUCTS = [
    // Roofing Materials (16)
    { id: 'prod_001', name: 'Architectural Shingles (GAF Timberline HDZ)', description: 'Premium architectural shingles with lifetime warranty. Highest-rated for durability and aesthetics.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'SQ', pricing: { good: { sell: 135, cost: 78 }, better: { sell: 165, cost: 95 }, best: { sell: 210, cost: 125 } }, laborCost: 0, manufacturer: 'GAF', sku: 'TIMBERLINE-HDZ', isActive: true, isDefault: true, sortOrder: 1 },
    { id: 'prod_002', name: '3-Tab Shingles (25-year)', description: 'Standard 3-tab shingles with 25-year warranty. Great value option for residential applications.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'SQ', pricing: { good: { sell: 95, cost: 55 }, better: { sell: 110, cost: 65 }, best: { sell: 130, cost: 75 } }, laborCost: 0, manufacturer: 'GAF', sku: '3TAB-25YR', isActive: true, isDefault: true, sortOrder: 2 },
    { id: 'prod_003', name: 'Designer Shingles (GAF Grand Canyon)', description: 'Premium designer shingles with multi-colored blend. Superior curb appeal for high-end homes.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'SQ', pricing: { good: { sell: 195, cost: 115 }, better: { sell: 235, cost: 140 }, best: { sell: 280, cost: 165 } }, laborCost: 0, manufacturer: 'GAF', sku: 'GRAND-CANYON', isActive: true, isDefault: true, sortOrder: 3 },
    { id: 'prod_004', name: 'Synthetic Underlayment', description: 'Breathable synthetic underlayment. Superior tear resistance and breathability vs felt.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'SQ', pricing: { good: { sell: 38, cost: 18 }, better: { sell: 45, cost: 22 }, best: { sell: 55, cost: 28 } }, laborCost: 0, manufacturer: 'Atlas', sku: 'SYNTH-UL', isActive: true, isDefault: true, sortOrder: 4 },
    { id: 'prod_005', name: 'Felt Underlayment (#30)', description: 'Traditional #30 felt underlayment. Budget-friendly, reliable option for most applications.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'SQ', pricing: { good: { sell: 20, cost: 10 }, better: { sell: 25, cost: 12 }, best: { sell: 30, cost: 15 } }, laborCost: 0, manufacturer: 'Standard', sku: 'FELT-30', isActive: true, isDefault: true, sortOrder: 5 },
    { id: 'prod_006', name: 'Ice & Water Shield', description: 'Premium ice dam protection. Self-adhering for eaves, valleys, and vulnerable areas.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'SQ', pricing: { good: { sell: 55, cost: 28 }, better: { sell: 65, cost: 32 }, best: { sell: 78, cost: 40 } }, laborCost: 0, manufacturer: 'Grace', sku: 'ICE-WATER', isActive: true, isDefault: true, sortOrder: 6 },
    { id: 'prod_007', name: 'Ridge Vent (Cobra)', description: 'Cobra ridge vent system. Ideal for continuous attic ventilation.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'LF', pricing: { good: { sell: 3.50, cost: 1.75 }, better: { sell: 4.50, cost: 2.25 }, best: { sell: 6.00, cost: 3.00 } }, laborCost: 0, manufacturer: 'GAF', sku: 'COBRA-RV', isActive: true, isDefault: true, sortOrder: 7 },
    { id: 'prod_008', name: 'Ridge Cap Shingles', description: 'Ridge cap shingles for ridge line finish. Matches architectural shingle colors.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'LF', pricing: { good: { sell: 4.00, cost: 2.00 }, better: { sell: 5.50, cost: 2.75 }, best: { sell: 7.00, cost: 3.50 } }, laborCost: 0, manufacturer: 'GAF', sku: 'RIDGE-CAP', isActive: true, isDefault: true, sortOrder: 8 },
    { id: 'prod_009', name: 'Drip Edge (Aluminum)', description: 'Aluminum drip edge. Prevents water infiltration at fascia and eaves.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'LF', pricing: { good: { sell: 2.25, cost: 1.15 }, better: { sell: 2.75, cost: 1.40 }, best: { sell: 3.50, cost: 1.75 } }, laborCost: 0, manufacturer: 'Standard', sku: 'DRIP-EDGE', isActive: true, isDefault: true, sortOrder: 9 },
    { id: 'prod_010', name: 'Valley Flashing (W-type)', description: 'W-type valley flashing. Directs water flow in roof valleys safely.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'LF', pricing: { good: { sell: 6.50, cost: 3.25 }, better: { sell: 8.50, cost: 4.25 }, best: { sell: 11.00, cost: 5.50 } }, laborCost: 0, manufacturer: 'Standard', sku: 'VALLEY-FLASH', isActive: true, isDefault: true, sortOrder: 10 },
    { id: 'prod_011', name: 'Pipe Boot Flashing', description: 'Rubber pipe boot flashing. Seals plumbing penetrations on roof.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'EA', pricing: { good: { sell: 14, cost: 6 }, better: { sell: 18, cost: 8 }, best: { sell: 25, cost: 12 } }, laborCost: 0, manufacturer: 'Standard', sku: 'PIPE-BOOT', isActive: true, isDefault: true, sortOrder: 11 },
    { id: 'prod_012', name: 'Chimney Flashing Kit', description: 'Complete chimney flashing kit. Step, counter, and cap flashing included.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'EA', pricing: { good: { sell: 95, cost: 48 }, better: { sell: 120, cost: 60 }, best: { sell: 165, cost: 82 } }, laborCost: 0, manufacturer: 'Standard', sku: 'CHIMNEY-KIT', isActive: true, isDefault: true, sortOrder: 12 },
    { id: 'prod_013', name: 'Step Flashing (5x7)', description: 'Step flashing for walls and chimneys. Prevents water infiltration at intersections.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'EA', pricing: { good: { sell: 1.50, cost: 0.75 }, better: { sell: 2.00, cost: 1.00 }, best: { sell: 2.50, cost: 1.25 } }, laborCost: 0, manufacturer: 'Standard', sku: 'STEP-FLASH', isActive: true, isDefault: true, sortOrder: 13 },
    { id: 'prod_014', name: 'Starter Strip Shingles', description: 'Starter strip shingles. Essential for proper shingle application at eaves.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'LF', pricing: { good: { sell: 1.75, cost: 0.88 }, better: { sell: 2.25, cost: 1.13 }, best: { sell: 3.00, cost: 1.50 } }, laborCost: 0, manufacturer: 'GAF', sku: 'STARTER-STRIP', isActive: true, isDefault: true, sortOrder: 14 },
    { id: 'prod_015', name: 'OSB Decking (7/16")', description: 'Oriented strand board decking 7/16". Standard roof decking substrate.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'SQ', pricing: { good: { sell: 42, cost: 22 }, better: { sell: 48, cost: 25 }, best: { sell: 55, cost: 30 } }, laborCost: 0, manufacturer: 'Standard', sku: 'OSB-716', isActive: true, isDefault: true, sortOrder: 15 },
    { id: 'prod_016', name: 'Plywood Decking (1/2" CDX)', description: 'CDX plywood decking 1/2". Premium decking option for superior strength.', category: 'roofing_materials', section: 'Roofing Materials', unit: 'SQ', pricing: { good: { sell: 55, cost: 30 }, better: { sell: 62, cost: 35 }, best: { sell: 72, cost: 40 } }, laborCost: 0, manufacturer: 'Standard', sku: 'PLY-CDX-12', isActive: true, isDefault: true, sortOrder: 16 },

    // Roofing Labor (8)
    { id: 'prod_017', name: 'Tear-off (1 Layer)', description: 'Complete tear-off of one layer of roofing material and disposal.', category: 'roofing_labor', section: 'Roofing Labor', unit: 'SQ', pricing: { good: { sell: 55, cost: 0 }, better: { sell: 65, cost: 0 }, best: { sell: 80, cost: 0 } }, laborCost: 35, manufacturer: '', sku: 'TEAROFF-1', isActive: true, isDefault: true, sortOrder: 1 },
    { id: 'prod_018', name: 'Tear-off (2 Layers)', description: 'Complete tear-off of two layers of roofing and debris removal.', category: 'roofing_labor', section: 'Roofing Labor', unit: 'SQ', pricing: { good: { sell: 80, cost: 0 }, better: { sell: 95, cost: 0 }, best: { sell: 115, cost: 0 } }, laborCost: 50, manufacturer: '', sku: 'TEAROFF-2', isActive: true, isDefault: true, sortOrder: 2 },
    { id: 'prod_019', name: 'Install Shingles', description: 'Professional shingle installation including nailing and sealing.', category: 'roofing_labor', section: 'Roofing Labor', unit: 'SQ', pricing: { good: { sell: 70, cost: 0 }, better: { sell: 85, cost: 0 }, best: { sell: 105, cost: 0 } }, laborCost: 40, manufacturer: '', sku: 'INSTALL-SHNG', isActive: true, isDefault: true, sortOrder: 3 },
    { id: 'prod_020', name: 'Install Underlayment', description: 'Installation of roofing underlayment and proper fastening.', category: 'roofing_labor', section: 'Roofing Labor', unit: 'SQ', pricing: { good: { sell: 18, cost: 0 }, better: { sell: 22, cost: 0 }, best: { sell: 28, cost: 0 } }, laborCost: 12, manufacturer: '', sku: 'INSTALL-UL', isActive: true, isDefault: true, sortOrder: 4 },
    { id: 'prod_021', name: 'OSB Decking Replacement', description: 'Removal of damaged decking, replacement, and fastening.', category: 'roofing_labor', section: 'Roofing Labor', unit: 'SQ', pricing: { good: { sell: 110, cost: 40 }, better: { sell: 125, cost: 45 }, best: { sell: 145, cost: 52 } }, laborCost: 38, manufacturer: '', sku: 'REPLACE-OSB', isActive: true, isDefault: true, sortOrder: 5 },
    { id: 'prod_022', name: 'Dumpster Rental (30-yard)', description: '30-yard dumpster rental for debris removal and disposal.', category: 'roofing_labor', section: 'Roofing Labor', unit: 'EA', pricing: { good: { sell: 375, cost: 250 }, better: { sell: 450, cost: 275 }, best: { sell: 525, cost: 325 } }, laborCost: 0, manufacturer: 'Waste Management', sku: 'DUMPSTER-30', isActive: true, isDefault: true, sortOrder: 6 },
    { id: 'prod_023', name: 'Permits & Inspection', description: 'Building permits, inspections, and compliance documentation.', category: 'roofing_labor', section: 'Roofing Labor', unit: 'EA', pricing: { good: { sell: 150, cost: 85 }, better: { sell: 200, cost: 120 }, best: { sell: 275, cost: 165 } }, laborCost: 0, manufacturer: '', sku: 'PERMITS-INS', isActive: true, isDefault: true, sortOrder: 7 },
    { id: 'prod_024', name: 'Roof Wash / Cleaning', description: 'Professional roof cleaning and algae removal with soft wash.', category: 'roofing_labor', section: 'Roofing Labor', unit: 'SQ', pricing: { good: { sell: 3.50, cost: 0 }, better: { sell: 4.50, cost: 0 }, best: { sell: 6.00, cost: 0 } }, laborCost: 2.25, manufacturer: '', sku: 'ROOF-WASH', isActive: true, isDefault: true, sortOrder: 8 },

    // Gutters (7)
    { id: 'prod_025', name: 'Seamless Gutters (5")', description: '5-inch seamless aluminum gutters. Standard residential gutter size.', category: 'gutters', section: 'Gutters', unit: 'LF', pricing: { good: { sell: 9, cost: 4 }, better: { sell: 12, cost: 5.50 }, best: { sell: 15, cost: 7 } }, laborCost: 0, manufacturer: 'Standard', sku: 'GUTTER-5', isActive: true, isDefault: true, sortOrder: 1 },
    { id: 'prod_026', name: 'Seamless Gutters (6")', description: '6-inch seamless aluminum gutters. Ideal for high-volume areas.', category: 'gutters', section: 'Gutters', unit: 'LF', pricing: { good: { sell: 11, cost: 5 }, better: { sell: 14, cost: 6.50 }, best: { sell: 18, cost: 8.50 } }, laborCost: 0, manufacturer: 'Standard', sku: 'GUTTER-6', isActive: true, isDefault: true, sortOrder: 2 },
    { id: 'prod_027', name: 'Downspouts (2x3)', description: '2x3 inch aluminum downspouts. Standard downspout size.', category: 'gutters', section: 'Gutters', unit: 'LF', pricing: { good: { sell: 6, cost: 2.75 }, better: { sell: 8, cost: 3.50 }, best: { sell: 10, cost: 4.50 } }, laborCost: 0, manufacturer: 'Standard', sku: 'DOWNSPOUT-2x3', isActive: true, isDefault: true, sortOrder: 3 },
    { id: 'prod_028', name: 'Downspouts (3x4)', description: '3x4 inch aluminum downspouts. Heavy-duty option for large roofs.', category: 'gutters', section: 'Gutters', unit: 'LF', pricing: { good: { sell: 7.50, cost: 3.50 }, better: { sell: 9.50, cost: 4.50 }, best: { sell: 12, cost: 5.75 } }, laborCost: 0, manufacturer: 'Standard', sku: 'DOWNSPOUT-3x4', isActive: true, isDefault: true, sortOrder: 4 },
    { id: 'prod_029', name: 'Gutter Guards (Mesh)', description: 'Mesh gutter guards. Prevents debris buildup while allowing water flow.', category: 'gutters', section: 'Gutters', unit: 'LF', pricing: { good: { sell: 6.50, cost: 3 }, better: { sell: 9, cost: 4.50 }, best: { sell: 12, cost: 6 } }, laborCost: 0, manufacturer: 'Standard', sku: 'GUARD-MESH', isActive: true, isDefault: true, sortOrder: 5 },
    { id: 'prod_030', name: 'Gutter Guards (Solid Cover)', description: 'Solid cover gutter guards. Premium protection with minimal maintenance.', category: 'gutters', section: 'Gutters', unit: 'LF', pricing: { good: { sell: 10, cost: 5 }, better: { sell: 14, cost: 7 }, best: { sell: 19, cost: 9.50 } }, laborCost: 0, manufacturer: 'Standard', sku: 'GUARD-SOLID', isActive: true, isDefault: true, sortOrder: 6 },
    { id: 'prod_031', name: 'Splash Blocks', description: 'Concrete splash blocks for downspout discharge. Directs water away from foundation.', category: 'gutters', section: 'Gutters', unit: 'EA', pricing: { good: { sell: 12, cost: 5 }, better: { sell: 18, cost: 8 }, best: { sell: 25, cost: 12 } }, laborCost: 0, manufacturer: 'Standard', sku: 'SPLASH-BLOCK', isActive: true, isDefault: true, sortOrder: 7 },

    // Siding (8)
    { id: 'prod_032', name: 'Vinyl Siding', description: 'Durable vinyl siding with fade and impact resistance. Wide color selection.', category: 'siding', section: 'Siding', unit: 'SQ', pricing: { good: { sell: 155, cost: 78 }, better: { sell: 185, cost: 95 }, best: { sell: 225, cost: 115 } }, laborCost: 0, manufacturer: 'Standard', sku: 'VINYL-SIDE', isActive: true, isDefault: true, sortOrder: 1 },
    { id: 'prod_033', name: 'Fiber Cement (HardiePlank)', description: 'Premium fiber cement siding by James Hardie. Fire and weather resistant.', category: 'siding', section: 'Siding', unit: 'SQ', pricing: { good: { sell: 350, cost: 185 }, better: { sell: 425, cost: 225 }, best: { sell: 520, cost: 275 } }, laborCost: 0, manufacturer: 'James Hardie', sku: 'HARDIEPLANK', isActive: true, isDefault: true, sortOrder: 2 },
    { id: 'prod_034', name: 'LP SmartSide', description: 'LP SmartSide engineered wood siding. Authentic wood appearance with better durability.', category: 'siding', section: 'Siding', unit: 'SQ', pricing: { good: { sell: 285, cost: 150 }, better: { sell: 340, cost: 180 }, best: { sell: 410, cost: 215 } }, laborCost: 0, manufacturer: 'LP Building', sku: 'LP-SMARTSIDE', isActive: true, isDefault: true, sortOrder: 3 },
    { id: 'prod_035', name: 'Board & Batten Siding', description: 'Classic board and batten siding. Provides traditional architectural style.', category: 'siding', section: 'Siding', unit: 'SQ', pricing: { good: { sell: 275, cost: 140 }, better: { sell: 335, cost: 170 }, best: { sell: 400, cost: 200 } }, laborCost: 0, manufacturer: 'Standard', sku: 'BD-BATTEN', isActive: true, isDefault: true, sortOrder: 4 },
    { id: 'prod_036', name: 'Vinyl Soffit', description: 'Vented vinyl soffit. Allows attic ventilation while protecting rafters.', category: 'siding', section: 'Siding', unit: 'SQ', pricing: { good: { sell: 75, cost: 35 }, better: { sell: 95, cost: 45 }, best: { sell: 120, cost: 58 } }, laborCost: 0, manufacturer: 'Standard', sku: 'VINYL-SOFFIT', isActive: true, isDefault: true, sortOrder: 5 },
    { id: 'prod_037', name: 'Aluminum Soffit (Vented)', description: 'Vented aluminum soffit with superior ventilation. Durable and low-maintenance.', category: 'siding', section: 'Siding', unit: 'SQ', pricing: { good: { sell: 95, cost: 48 }, better: { sell: 115, cost: 58 }, best: { sell: 140, cost: 70 } }, laborCost: 0, manufacturer: 'Standard', sku: 'ALUM-SOFFIT', isActive: true, isDefault: true, sortOrder: 6 },
    { id: 'prod_038', name: 'Aluminum Fascia', description: 'Aluminum fascia board. Protects rafter tails and adds finished appearance.', category: 'siding', section: 'Siding', unit: 'LF', pricing: { good: { sell: 8, cost: 4 }, better: { sell: 11, cost: 5.50 }, best: { sell: 14, cost: 7 } }, laborCost: 0, manufacturer: 'Standard', sku: 'ALUM-FASCIA', isActive: true, isDefault: true, sortOrder: 7 },
    { id: 'prod_039', name: 'J-Channel', description: 'Vinyl J-channel trim for siding edges and openings.', category: 'siding', section: 'Siding', unit: 'LF', pricing: { good: { sell: 1.50, cost: 0.75 }, better: { sell: 2.00, cost: 1.00 }, best: { sell: 2.75, cost: 1.38 } }, laborCost: 0, manufacturer: 'Standard', sku: 'J-CHANNEL', isActive: true, isDefault: true, sortOrder: 8 },

    // Windows & Doors (6)
    { id: 'prod_040', name: 'Double-Hung Window (Vinyl)', description: 'Vinyl double-hung window with energy efficiency ratings. Easy operation.', category: 'windows_doors', section: 'Windows & Doors', unit: 'EA', pricing: { good: { sell: 325, cost: 165 }, better: { sell: 425, cost: 215 }, best: { sell: 575, cost: 290 } }, laborCost: 0, manufacturer: 'Standard', sku: 'WIN-DHUNG', isActive: true, isDefault: true, sortOrder: 1 },
    { id: 'prod_041', name: 'Sliding Window', description: 'Horizontal sliding window with tempered glass. Minimal profile.', category: 'windows_doors', section: 'Windows & Doors', unit: 'EA', pricing: { good: { sell: 285, cost: 145 }, better: { sell: 375, cost: 190 }, best: { sell: 495, cost: 250 } }, laborCost: 0, manufacturer: 'Standard', sku: 'WIN-SLIDE', isActive: true, isDefault: true, sortOrder: 2 },
    { id: 'prod_042', name: 'Picture Window', description: 'Fixed picture window with low-E glass. Maximizes natural light.', category: 'windows_doors', section: 'Windows & Doors', unit: 'EA', pricing: { good: { sell: 375, cost: 190 }, better: { sell: 485, cost: 245 }, best: { sell: 625, cost: 315 } }, laborCost: 0, manufacturer: 'Standard', sku: 'WIN-PICTURE', isActive: true, isDefault: true, sortOrder: 3 },
    { id: 'prod_043', name: 'Entry Door (Steel)', description: 'Insulated steel entry door with weatherstripping. Secure and durable.', category: 'windows_doors', section: 'Windows & Doors', unit: 'EA', pricing: { good: { sell: 650, cost: 325 }, better: { sell: 850, cost: 425 }, best: { sell: 1100, cost: 550 } }, laborCost: 0, manufacturer: 'Standard', sku: 'DOOR-STEEL', isActive: true, isDefault: true, sortOrder: 4 },
    { id: 'prod_044', name: 'Storm Door', description: 'Aluminum storm door with self-closing mechanism. Protects entry doors.', category: 'windows_doors', section: 'Windows & Doors', unit: 'EA', pricing: { good: { sell: 275, cost: 140 }, better: { sell: 375, cost: 190 }, best: { sell: 495, cost: 250 } }, laborCost: 0, manufacturer: 'Standard', sku: 'DOOR-STORM', isActive: true, isDefault: true, sortOrder: 5 },
    { id: 'prod_045', name: 'Patio Door (Sliding)', description: 'Sliding patio door with low-E glass. Opens onto deck or patio.', category: 'windows_doors', section: 'Windows & Doors', unit: 'EA', pricing: { good: { sell: 875, cost: 440 }, better: { sell: 1150, cost: 575 }, best: { sell: 1500, cost: 750 } }, laborCost: 0, manufacturer: 'Standard', sku: 'DOOR-PATIO', isActive: true, isDefault: true, sortOrder: 6 },

    // Interior (6)
    { id: 'prod_046', name: 'Interior Paint (per room)', description: 'Professional interior painting including prep, primer, and two coats.', category: 'interior', section: 'Interior', unit: 'RM', pricing: { good: { sell: 225, cost: 65 }, better: { sell: 325, cost: 95 }, best: { sell: 450, cost: 135 } }, laborCost: 0, manufacturer: 'Premium Paint', sku: 'PAINT-INT', isActive: true, isDefault: true, sortOrder: 1 },
    { id: 'prod_047', name: 'Drywall Repair (per sheet)', description: 'Drywall repair, mudding, sanding, and finish. Single sheet service.', category: 'interior', section: 'Interior', unit: 'EA', pricing: { good: { sell: 85, cost: 22 }, better: { sell: 110, cost: 30 }, best: { sell: 145, cost: 40 } }, laborCost: 0, manufacturer: '', sku: 'DRYWALL-REP', isActive: true, isDefault: true, sortOrder: 2 },
    { id: 'prod_048', name: 'Ceiling Repair', description: 'Popcorn ceiling removal, repair, and refinish with smooth finish.', category: 'interior', section: 'Interior', unit: 'SF', pricing: { good: { sell: 8, cost: 2.50 }, better: { sell: 11, cost: 3.50 }, best: { sell: 15, cost: 5 } }, laborCost: 0, manufacturer: '', sku: 'CEIL-REP', isActive: true, isDefault: true, sortOrder: 3 },
    { id: 'prod_049', name: 'Flooring - LVP', description: 'Luxury vinyl plank flooring installation. Waterproof and durable.', category: 'interior', section: 'Interior', unit: 'SF', pricing: { good: { sell: 4.50, cost: 2.25 }, better: { sell: 6.50, cost: 3.25 }, best: { sell: 9, cost: 4.50 } }, laborCost: 0, manufacturer: 'Standard', sku: 'FLOOR-LVP', isActive: true, isDefault: true, sortOrder: 4 },
    { id: 'prod_050', name: 'Trim / Baseboard', description: 'Installation of trim and baseboard molding. Includes caulk and paint.', category: 'interior', section: 'Interior', unit: 'LF', pricing: { good: { sell: 4, cost: 2 }, better: { sell: 6, cost: 3 }, best: { sell: 8.50, cost: 4.25 } }, laborCost: 0, manufacturer: '', sku: 'TRIM-BASE', isActive: true, isDefault: true, sortOrder: 5 },
    { id: 'prod_051', name: 'Crown Molding', description: 'Installation of crown molding with seamless joints. Professional finish.', category: 'interior', section: 'Interior', unit: 'LF', pricing: { good: { sell: 7, cost: 3.50 }, better: { sell: 10, cost: 5 }, best: { sell: 14, cost: 7 } }, laborCost: 0, manufacturer: '', sku: 'CROWN-MOLD', isActive: true, isDefault: true, sortOrder: 6 },

    // Specialty (7)
    { id: 'prod_052', name: 'Skylight Installation', description: 'Complete skylight installation including flashing, sealing, and drywall trim.', category: 'specialty', section: 'Specialty', unit: 'EA', pricing: { good: { sell: 650, cost: 325 }, better: { sell: 850, cost: 425 }, best: { sell: 1100, cost: 550 } }, laborCost: 175, manufacturer: 'Standard', sku: 'SKYLIGHT-INST', isActive: true, isDefault: true, sortOrder: 1 },
    { id: 'prod_053', name: 'Solar Attic Fan', description: 'Solar-powered attic fan installation with thermostat control.', category: 'specialty', section: 'Specialty', unit: 'EA', pricing: { good: { sell: 375, cost: 188 }, better: { sell: 475, cost: 238 }, best: { sell: 600, cost: 300 } }, laborCost: 85, manufacturer: 'SolarFan', sku: 'SOLAR-FAN', isActive: true, isDefault: true, sortOrder: 2 },
    { id: 'prod_054', name: 'Turbine Vent', description: 'Turbine vent installation with flashing and sealing.', category: 'specialty', section: 'Specialty', unit: 'EA', pricing: { good: { sell: 145, cost: 58 }, better: { sell: 185, cost: 75 }, best: { sell: 235, cost: 95 } }, laborCost: 40, manufacturer: 'Standard', sku: 'TURBINE-VENT', isActive: true, isDefault: true, sortOrder: 3 },
    { id: 'prod_055', name: 'Box Vent (Static)', description: 'Static box vent installation for passive attic ventilation.', category: 'specialty', section: 'Specialty', unit: 'EA', pricing: { good: { sell: 48, cost: 20 }, better: { sell: 65, cost: 25 }, best: { sell: 85, cost: 35 } }, laborCost: 15, manufacturer: 'Standard', sku: 'BOX-VENT', isActive: true, isDefault: true, sortOrder: 4 },
    { id: 'prod_056', name: 'Power Ventilator', description: 'Electric powered ventilator installation with thermostat and humidistat.', category: 'specialty', section: 'Specialty', unit: 'EA', pricing: { good: { sell: 225, cost: 112 }, better: { sell: 295, cost: 148 }, best: { sell: 385, cost: 192 } }, laborCost: 55, manufacturer: 'AirFlow', sku: 'POWER-VENT', isActive: true, isDefault: true, sortOrder: 5 },
    { id: 'prod_057', name: 'Chimney Cap (Stainless)', description: 'Stainless steel chimney cap installation. Prevents water and animal entry.', category: 'specialty', section: 'Specialty', unit: 'EA', pricing: { good: { sell: 175, cost: 88 }, better: { sell: 235, cost: 118 }, best: { sell: 310, cost: 155 } }, laborCost: 45, manufacturer: 'Standard', sku: 'CHIMNEY-CAP', isActive: true, isDefault: true, sortOrder: 6 },
    { id: 'prod_058', name: 'Satellite Dish Removal', description: 'Satellite dish removal with flashing installation and cleanup.', category: 'specialty', section: 'Specialty', unit: 'EA', pricing: { good: { sell: 75, cost: 0 }, better: { sell: 95, cost: 0 }, best: { sell: 125, cost: 0 } }, laborCost: 50, manufacturer: '', sku: 'SATELITE-REM', isActive: true, isDefault: true, sortOrder: 7 }
  ];

  // ============================================================================
  // STATE & LOCAL STORAGE
  // ============================================================================

  let products = [];
  let editingProduct = null;
  let currentFilter = { search: '', category: null };
  let toastMessage = '';

  /**
   * Load products from localStorage, seed with demos if empty
   */
  function loadProducts() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        products = JSON.parse(stored);
      } else {
        seedDemoProducts();
      }
      return products;
    } catch (e) {
      console.error('Error loading products:', e);
      seedDemoProducts();
      return products;
    }
  }

  /**
   * Seed with demo products
   */
  function seedDemoProducts() {
    const now = new Date().toISOString();
    products = DEMO_PRODUCTS.map(p => ({
      ...p,
      createdAt: now,
      updatedAt: now
    }));
    saveProducts();
  }

  /**
   * Save products to localStorage
   */
  function saveProducts() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
      return true;
    } catch (e) {
      console.error('Error saving products:', e);
      showToast('Error saving products', 'error');
      return false;
    }
  }

  /**
   * Add or update a product
   */
  function saveProduct(product) {
    const now = new Date().toISOString();
    if (!product.id) {
      product.id = 'prod_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      product.createdAt = now;
    }
    product.updatedAt = now;

    const idx = products.findIndex(p => p.id === product.id);
    if (idx >= 0) {
      products[idx] = product;
    } else {
      products.push(product);
    }
    saveProducts();
    return product;
  }

  /**
   * Soft delete: mark product inactive
   */
  function deleteProduct(id) {
    const product = products.find(p => p.id === id);
    if (product) {
      product.isActive = false;
      product.updatedAt = new Date().toISOString();
      saveProducts();
      return true;
    }
    return false;
  }

  /**
   * Hard delete: remove entirely
   */
  function hardDeleteProduct(id) {
    const idx = products.findIndex(p => p.id === id);
    if (idx >= 0) {
      products.splice(idx, 1);
      saveProducts();
      return true;
    }
    return false;
  }

  /**
   * Search & filter products
   */
  function searchProducts(query = '', category = null) {
    let results = products.filter(p => p.isActive);

    if (category) {
      results = results.filter(p => p.category === category);
    }

    if (query && query.trim()) {
      const q = query.toLowerCase();
      results = results.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.manufacturer.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q)
      );
    }

    return results;
  }

  /**
   * Reset to defaults with confirmation
   */
  function resetToDefaults() {
    if (confirm('Are you sure? This will replace all products with demo data and cannot be undone.')) {
      seedDemoProducts();
      editingProduct = null;
      currentFilter = { search: '', category: null };
      showToast('Products reset to defaults', 'success');
      return true;
    }
    return false;
  }

  /**
   * Calculate margin percentage
   */
  function calculateMargin(sell, cost) {
    if (!cost || cost === 0) return 0;
    return Math.round(((sell - cost) / sell) * 100);
  }

  /**
   * Show toast notification
   */
  function showToast(msg, type = 'info') {
    toastMessage = msg;
    const elem = document.getElementById('product-toast');
    if (elem) {
      elem.textContent = msg;
      elem.className = 'product-toast product-toast-' + type;
      elem.style.opacity = '1';
      setTimeout(() => {
        elem.style.opacity = '0';
      }, 3000);
    }
  }

  // ============================================================================
  // EXPORT FUNCTION
  // ============================================================================

  /**
   * Export products to CSV
   */
  function exportProductsCSV() {
    const headers = ['ID', 'Name', 'Description', 'Category', 'Unit', 'Good Sell', 'Good Cost', 'Better Sell', 'Better Cost', 'Best Sell', 'Best Cost', 'Labor Cost', 'Manufacturer', 'SKU', 'Active'];
    const rows = products.filter(p => p.isActive).map(p => [
      p.id,
      p.name,
      p.description,
      p.category,
      p.unit,
      p.pricing.good.sell,
      p.pricing.good.cost,
      p.pricing.better.sell,
      p.pricing.better.cost,
      p.pricing.best.sell,
      p.pricing.best.cost,
      p.laborCost,
      p.manufacturer,
      p.sku,
      'Yes'
    ]);

    let csv = headers.join(',') + '\n';
    rows.forEach(row => {
      csv += row.map(cell => '"' + (cell || '').toString().replace(/"/g, '""') + '"').join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nbd-products-' + new Date().toISOString().split('T')[0] + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Products exported to CSV', 'success');
  }

  // ============================================================================
  // UI RENDERING
  // ============================================================================

  /**
   * Main render function - returns complete HTML
   */
  function render() {
    loadProducts();

    const results = searchProducts(currentFilter.search, currentFilter.category);
    const activeCount = products.filter(p => p.isActive).length;
    const categoryCount = new Set(products.filter(p => p.isActive).map(p => p.category)).size;
    const avgMargin = Math.round(
      products.filter(p => p.isActive).reduce((sum, p) => {
        const m = calculateMargin(p.pricing.better.sell, p.pricing.better.cost);
        return sum + m;
      }, 0) / Math.max(activeCount, 1)
    );

    const groupedByCategory = {};
    results.forEach(product => {
      if (!groupedByCategory[product.category]) {
        groupedByCategory[product.category] = [];
      }
      groupedByCategory[product.category].push(product);
    });

    let categoriesHtml = '';
    Object.keys(CATEGORIES).forEach(catKey => {
      const isActive = currentFilter.category === catKey;
      categoriesHtml += `
        <button class="product-filter-pill" style="background-color: ${isActive ? CATEGORIES[catKey].color : '#f3f4f6'}; color: ${isActive ? '#fff' : '#000'}; border: 2px solid ${CATEGORIES[catKey].color}; cursor: pointer;"
          onclick="window._productLib.setFilter('${catKey}')">
          ${CATEGORIES[catKey].icon} ${CATEGORIES[catKey].label}
        </button>
      `;
    });

    let productsHtml = '';
    Object.keys(CATEGORIES).forEach(catKey => {
      if (groupedByCategory[catKey] && groupedByCategory[catKey].length > 0) {
        productsHtml += `
          <div class="product-section" style="margin-bottom: 40px;">
            <h3 style="margin: 0 0 20px 0; font-size: 18px; font-weight: 600; color: #1f2937; display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 20px;">${CATEGORIES[catKey].icon}</span>
              ${CATEGORIES[catKey].label}
            </h3>
            <div class="product-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px;">
        `;

        groupedByCategory[catKey].forEach(product => {
          const marginGood = calculateMargin(product.pricing.good.sell, product.pricing.good.cost);
          const marginBetter = calculateMargin(product.pricing.better.sell, product.pricing.better.cost);
          const marginBest = calculateMargin(product.pricing.best.sell, product.pricing.best.cost);

          productsHtml += `
            <div class="product-card" style="border: 1px solid #ddd; border-radius: 12px; padding: 16px; background: white; transition: all 0.2s; cursor: pointer;"
              onmouseover="this.style.borderColor='${CATEGORIES[catKey].color}'; this.style.backgroundColor='#f9fafb';"
              onmouseout="this.style.borderColor='#ddd'; this.style.backgroundColor='white';">
              <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                <div>
                  <h4 style="margin: 0; font-size: 15px; font-weight: 600; color: #1f2937;">${escapeHtml(product.name)}</h4>
                  <p style="margin: 4px 0 0 0; font-size: 12px; color: #6b7280;">${escapeHtml(product.manufacturer || 'Standard')}</p>
                </div>
              </div>
              <p style="margin: 0 0 12px 0; font-size: 13px; color: #6b7280; line-height: 1.4;">${escapeHtml(product.description.substring(0, 60))}...</p>

              <div style="margin: 12px 0; padding: 12px; background: #f3f4f6; border-radius: 8px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 12px;">
                  <div>
                    <div style="font-weight: 600; color: #1f2937;">Good</div>
                    <div style="color: #059669; font-weight: 600;">$${product.pricing.good.sell}/${product.unit}</div>
                    <div style="color: #6b7280; font-size: 11px;">Cost: $${product.pricing.good.cost}</div>
                  </div>
                  <div>
                    <div style="font-weight: 600; color: #1f2937;">Better</div>
                    <div style="color: #059669; font-weight: 600;">$${product.pricing.better.sell}/${product.unit}</div>
                    <div style="color: #6b7280; font-size: 11px;">Cost: $${product.pricing.better.cost}</div>
                  </div>
                  <div>
                    <div style="font-weight: 600; color: #1f2937;">Best</div>
                    <div style="color: #059669; font-weight: 600;">$${product.pricing.best.sell}/${product.unit}</div>
                    <div style="color: #6b7280; font-size: 11px;">Cost: $${product.pricing.best.cost}</div>
                  </div>
                </div>
              </div>

              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
                <div style="font-size: 12px; color: #6b7280;">
                  <strong>Margin:</strong> ${marginBetter}%
                </div>
                <div style="display: flex; gap: 6px;">
                  <button onclick="window._productLib.editProduct('${product.id}')" style="padding: 6px 12px; background: #3b82f6; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500;">Edit</button>
                  <button onclick="window._productLib.archiveProduct('${product.id}')" style="padding: 6px 12px; background: #f59e0b; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500;">Archive</button>
                </div>
              </div>
            </div>
          `;
        });

        productsHtml += `
            </div>
          </div>
        `;
      }
    });

    const html = `
      <div class="product-library" style="padding: 20px; background: #f9fafb; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">

        <!-- Header -->
        <div style="margin-bottom: 24px;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: #1f2937;">Product Library</h1>
          <p style="margin: 8px 0 0 0; font-size: 14px; color: #6b7280;">Manage your materials, labor & pricing</p>
        </div>

        <!-- Stats -->
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 24px;">
          <div style="background: white; padding: 16px; border-radius: 8px; border-left: 4px solid #3b82f6;">
            <div style="font-size: 12px; color: #6b7280; font-weight: 500;">Total Products</div>
            <div style="font-size: 24px; font-weight: 700; color: #1f2937; margin-top: 4px;">${activeCount}</div>
          </div>
          <div style="background: white; padding: 16px; border-radius: 8px; border-left: 4px solid #10b981;">
            <div style="font-size: 12px; color: #6b7280; font-weight: 500;">Categories</div>
            <div style="font-size: 24px; font-weight: 700; color: #1f2937; margin-top: 4px;">${categoryCount}</div>
          </div>
          <div style="background: white; padding: 16px; border-radius: 8px; border-left: 4px solid #f59e0b;">
            <div style="font-size: 12px; color: #6b7280; font-weight: 500;">Avg Margin %</div>
            <div style="font-size: 24px; font-weight: 700; color: #1f2937; margin-top: 4px;">${avgMargin}%</div>
          </div>
          <div style="background: white; padding: 16px; border-radius: 8px; border-left: 4px solid #8b5cf6;">
            <div style="font-size: 12px; color: #6b7280; font-weight: 500;">Active Items</div>
            <div style="font-size: 24px; font-weight: 700; color: #1f2937; margin-top: 4px;">${results.length}</div>
          </div>
        </div>

        <!-- Action Bar -->
        <div style="background: white; padding: 16px; border-radius: 8px; margin-bottom: 24px; display: flex; gap: 12px; flex-wrap: wrap; align-items: center;">
          <input type="text" id="product-search" placeholder="Search products..." value="${escapeHtml(currentFilter.search)}"
            style="padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; flex: 1; min-width: 200px;"
            onkeyup="window._productLib.setFilter(null, this.value)">

          <button onclick="window._productLib.addProduct()" style="padding: 8px 16px; background: #C8541A; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">+ Add Product</button>
          <button onclick="window._productLib.exportCSV()" style="padding: 8px 16px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">📊 Export CSV</button>
          <button onclick="window._productLib.resetDefaults()" style="padding: 8px 16px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500;">Reset Defaults</button>
        </div>

        <!-- Category Filters -->
        <div style="background: white; padding: 16px; border-radius: 8px; margin-bottom: 24px; display: flex; flex-wrap: wrap; gap: 8px;">
          <button class="product-filter-pill" style="background-color: ${!currentFilter.category ? '#f3f4f6' : '#f3f4f6'}; color: #000; border: 2px solid #ddd; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-weight: 500;"
            onclick="window._productLib.setFilter(null)">
            ✓ All Categories
          </button>
          ${categoriesHtml}
        </div>

        <!-- Products Grid -->
        <div style="margin-bottom: 24px;">
          ${productsHtml || '<div style="text-align: center; padding: 40px; color: #6b7280;">No products found</div>'}
        </div>

        <!-- Toast -->
        <div id="product-toast" class="product-toast" style="position: fixed; bottom: 20px; right: 20px; padding: 12px 16px; background: #10b981; color: white; border-radius: 6px; opacity: 0; transition: opacity 0.3s; font-size: 14px; font-weight: 500;"></div>

        <!-- Modal Overlay -->
        <div id="product-modal-overlay" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000;"></div>

        <!-- Edit Modal -->
        <div id="product-modal" style="display: none; position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border-radius: 12px; box-shadow: 0 20px 25px rgba(0,0,0,0.15); width: 90%; max-width: 600px; max-height: 90vh; overflow-y: auto; z-index: 1001; padding: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 id="modal-title" style="margin: 0; font-size: 20px; font-weight: 700; color: #1f2937;">Edit Product</h2>
            <button onclick="window._productLib.closeModal()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #6b7280;">×</button>
          </div>

          <form id="product-form" style="display: grid; gap: 16px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div>
                <label style="display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px;">Product Name *</label>
                <input id="modal-name" type="text" style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box;" required>
              </div>
              <div>
                <label style="display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px;">Manufacturer</label>
                <input id="modal-manufacturer" type="text" style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box;">
              </div>
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px;">Description</label>
              <textarea id="modal-description" style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box; font-family: inherit; resize: vertical; min-height: 60px;"></textarea>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
              <div>
                <label style="display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px;">Category *</label>
                <select id="modal-category" style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box;" required>
                  ${Object.keys(CATEGORIES).map(k => `<option value="${k}">${CATEGORIES[k].label}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px;">Unit *</label>
                <select id="modal-unit" style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box;" required>
                  ${UNITS.map(u => `<option value="${u}">${u}</option>`).join('')}
                </select>
              </div>
              <div>
                <label style="display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px;">SKU</label>
                <input id="modal-sku" type="text" style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box;">
              </div>
            </div>

            <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px;">
              <h4 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 600; color: #1f2937;">Pricing</h4>
              <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; font-size: 12px;">
                ${['good', 'better', 'best'].map(tier => `
                  <div>
                    <div style="font-weight: 600; color: #1f2937; margin-bottom: 8px; text-transform: capitalize;">${tier}</div>
                    <div style="display: flex; gap: 4px; margin-bottom: 4px;">
                      <div style="flex: 1;">
                        <label style="display: block; font-size: 11px; color: #6b7280; margin-bottom: 2px;">Sell</label>
                        <input id="modal-price-${tier}-sell" type="number" step="0.01" style="width: 100%; padding: 4px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                      </div>
                      <div style="flex: 1;">
                        <label style="display: block; font-size: 11px; color: #6b7280; margin-bottom: 2px;">Cost</label>
                        <input id="modal-price-${tier}-cost" type="number" step="0.01" style="width: 100%; padding: 4px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px; box-sizing: border-box;">
                      </div>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>

            <div>
              <label style="display: block; font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px;">Labor Cost (optional)</label>
              <input id="modal-labor-cost" type="number" step="0.01" style="width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box;">
            </div>

            <div style="display: flex; gap: 12px;">
              <button type="button" onclick="window._productLib.saveProduct()" style="flex: 1; padding: 10px; background: #C8541A; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Save Product</button>
              <button type="button" id="modal-delete-btn" onclick="window._productLib.deleteProduct()" style="padding: 10px 16px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Delete</button>
              <button type="button" onclick="window._productLib.closeModal()" style="flex: 1; padding: 10px; background: #6b7280; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">Cancel</button>
            </div>
          </form>
        </div>

      </div>
    `;

    return html;
  }

  /**
   * Escape HTML entities
   */
  function escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }

  // ============================================================================
  // MODAL INTERACTIONS
  // ============================================================================

  function openModal(productId = null) {
    editingProduct = productId ? products.find(p => p.id === productId) : null;

    const modal = document.getElementById('product-modal');
    const overlay = document.getElementById('product-modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const deleteBtn = document.getElementById('modal-delete-btn');

    if (editingProduct) {
      titleEl.textContent = 'Edit Product';
      deleteBtn.style.display = 'block';

      document.getElementById('modal-name').value = editingProduct.name;
      document.getElementById('modal-description').value = editingProduct.description;
      document.getElementById('modal-category').value = editingProduct.category;
      document.getElementById('modal-unit').value = editingProduct.unit;
      document.getElementById('modal-manufacturer').value = editingProduct.manufacturer;
      document.getElementById('modal-sku').value = editingProduct.sku;
      document.getElementById('modal-labor-cost').value = editingProduct.laborCost || 0;

      TIERS.forEach(tier => {
        document.getElementById(`modal-price-${tier}-sell`).value = editingProduct.pricing[tier].sell;
        document.getElementById(`modal-price-${tier}-cost`).value = editingProduct.pricing[tier].cost;
      });
    } else {
      titleEl.textContent = 'Add New Product';
      deleteBtn.style.display = 'none';

      document.getElementById('modal-name').value = '';
      document.getElementById('modal-description').value = '';
      document.getElementById('modal-category').value = 'roofing_materials';
      document.getElementById('modal-unit').value = 'SQ';
      document.getElementById('modal-manufacturer').value = '';
      document.getElementById('modal-sku').value = '';
      document.getElementById('modal-labor-cost').value = 0;

      TIERS.forEach(tier => {
        document.getElementById(`modal-price-${tier}-sell`).value = 0;
        document.getElementById(`modal-price-${tier}-cost`).value = 0;
      });
    }

    modal.style.display = 'block';
    overlay.style.display = 'block';
  }

  function closeModal() {
    document.getElementById('product-modal').style.display = 'none';
    document.getElementById('product-modal-overlay').style.display = 'none';
    editingProduct = null;
  }

  function saveProductFromModal() {
    const product = editingProduct || {};

    product.name = document.getElementById('modal-name').value.trim();
    product.description = document.getElementById('modal-description').value.trim();
    product.category = document.getElementById('modal-category').value;
    product.unit = document.getElementById('modal-unit').value;
    product.manufacturer = document.getElementById('modal-manufacturer').value.trim();
    product.sku = document.getElementById('modal-sku').value.trim();
    product.laborCost = parseFloat(document.getElementById('modal-labor-cost').value) || 0;

    if (!product.name) {
      showToast('Product name is required', 'error');
      return;
    }

    product.section = CATEGORIES[product.category].label;
    product.pricing = {};

    TIERS.forEach(tier => {
      product.pricing[tier] = {
        sell: parseFloat(document.getElementById(`modal-price-${tier}-sell`).value) || 0,
        cost: parseFloat(document.getElementById(`modal-price-${tier}-cost`).value) || 0
      };
    });

    product.isActive = true;
    product.isDefault = true;

    saveProduct(product);
    closeModal();
    showToast(editingProduct ? 'Product updated' : 'Product added', 'success');

    // Re-render
    const container = document.getElementById('product-library-container');
    if (container) {
      container.innerHTML = render();
    }
  }

  function deleteProductFromModal() {
    if (editingProduct && confirm('Archive this product? It can be recovered.')) {
      deleteProduct(editingProduct.id);
      closeModal();
      showToast('Product archived', 'success');

      const container = document.getElementById('product-library-container');
      if (container) {
        container.innerHTML = render();
      }
    }
  }

  function archiveProductFromUI(id) {
    if (confirm('Archive this product?')) {
      deleteProduct(id);
      showToast('Product archived', 'success');

      const container = document.getElementById('product-library-container');
      if (container) {
        container.innerHTML = render();
      }
    }
  }

  function setFilter(category = null, search = null) {
    if (category !== null || category !== undefined) {
      currentFilter.category = category;
    }
    if (search !== null && search !== undefined) {
      currentFilter.search = search;
    }

    const container = document.getElementById('product-library-container');
    if (container) {
      container.innerHTML = render();
    }
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  window._productLib = {
    render: render,
    load: loadProducts,
    save: saveProduct,
    delete: deleteProduct,
    hardDelete: hardDeleteProduct,
    search: searchProducts,
    exportCSV: exportProductsCSV,
    resetDefaults: resetToDefaults,
    openModal: openModal,
    closeModal: closeModal,
    editProduct: openModal,
    addProduct: () => openModal(null),
    saveProduct: saveProductFromModal,
    deleteProduct: deleteProductFromModal,
    archiveProduct: archiveProductFromUI,
    setFilter: setFilter,
    getStats: () => ({
      total: products.filter(p => p.isActive).length,
      categories: new Set(products.filter(p => p.isActive).map(p => p.category)).size,
      avgMargin: Math.round(
        products.filter(p => p.isActive).reduce((sum, p) => {
          const m = calculateMargin(p.pricing.better.sell, p.pricing.better.cost);
          return sum + m;
        }, 0) / Math.max(products.filter(p => p.isActive).length, 1)
      )
    })
  };

  // Alias for backward compatibility
  window.renderProductLibrary = window._productLib.render;

  // Auto-load on script load
  loadProducts();

})();
