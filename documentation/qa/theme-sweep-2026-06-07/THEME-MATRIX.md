# Theme Status Matrix — 2026-06-07 (full live sweep, 186 themes × light+dark)

Status legend: **PASS** · **LEGIBILITY-FAIL** (on-identity but unreadable) · **IDENTITY-FAIL** (readable but generic/overridden/partial) · **PARTIAL** · **DEAD** · **LOCKED**.
Axis A = usability/legibility. Axis B = identity fidelity. Scored per mode. Evidence = screenshot path under `screenshots/<category>/`.

## Professional (15) — ✅ CATEGORY PASS (both modes)
_Axis A: all 15 pass computed contrast (dark muted floor 4.59 obsidian; light all ≥4.5). Axis B: distinct muted-pro palettes, accents preserved both modes; no collapse-to-generic. Legend: ✓ visually confirmed · ✓ᶜ computed/accent-preserved (not individually screenshotted)._

| # | id | name | ref bg | ref accent | Light A | Light B | Dark A | Dark B | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `nbd-original` | NBD Original | `#1e3a6e` | `#e8720c` | ✓ | ✓ | ✓ | ✓ | PASS | navy→light, orange accent retained both modes (F-3 navy confirmed live) |
| 2 | `midnight` | Midnight | `#0b1024` | `#6366f1` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | near-black, indigo accent |
| 3 | `cobalt` | Cobalt | `#061230` | `#3b82f6` | ✓ | ✓ | ✓ | ✓ | PASS | true blue accent reaches donut+buttons both modes |
| 4 | `slate` | Slate | `#0f1117` | `#64748b` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | gray-slate accent |
| 5 | `steel` | Steel | `#1a1f26` | `#bac4d2` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | dark muted floor 4.74 |
| 6 | `paper` | Paper | `#fafaf7` | `#1a1a1a` | ✓ | ✓ | ✓ᶜ | ✓ᶜ | PASS | crisp white; nit: logo "PRO" wordmark faint on white |
| 7 | `ghost` | Ghost | `#f4f6fa` | `#475569` | ✓ | ✓ | ✓ | ✓ | PASS | intentional ultra-low-chroma; legible both modes (low emphasis by design) |
| 8 | `obsidian` | Obsidian | `#040406` | `#dadcde` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | dark muted floor 4.59 (lowest, still AA) |
| 9 | `arctic` | Arctic | `#0f172a` | `#7dd3fc` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | icy sky-blue accent |
| 10 | `coffee` | Coffee | `#1a1008` | `#a0724a` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | warm brown |
| 11 | `high-contrast` | High Contrast | `#000000` | `#ff8800` | ✓ | ✓ | ✓ᶜ | ✓ᶜ | PASS | accent-dip 2.98(L) is fill-only → non-issue |
| 12 | `sage` | Sage | `#0e1a16` | `#7bb89b` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | muted green |
| 13 | `amber-dark` | Amber | `#1a140d` | `#d9a662` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | gold accent |
| 14 | `plum` | Plum | `#150a1f` | `#a78bfa` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | violet accent |
| 15 | `mono` | Mono | `#101010` | `#e8720c` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | grayscale surfaces, brand-orange accent |

## Construction & Trade (13) — ✅ CATEGORY PASS (both modes)
_Strong distinct trade identities. Dark accent-dips brick(2.68)/concrete(2.97) are accent-as-FILL (tuned `--accent-fg`), not failing text → non-issue. ✓ seen · ✓ᶜ computed._

| # | id | name | ref bg | ref accent | Light A | Light B | Dark A | Dark B | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 16 | `blueprint` | Blueprint | `#0a1a3a` | `#38bdf8` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | deep blue + cyan technical identity |
| 17 | `hard-hat` | Hard Hat | `#1a1a08` | `#eab308` | ✓ | ✓ | ✓ᶜ | ✓ᶜ | PASS | gold/amber helmet identity |
| 18 | `concrete` | Concrete | `#1a1a1a` | `#6b7280` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | industrial gray; low-emphasis accent by design (dip 2.97 fill-only) |
| 19 | `copper-pipe` | Copper Pipe | `#1a1008` | `#c2774a` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | copper-brown |
| 20 | `safety-orange` | Safety Orange | `#1a0a00` | `#f97316` | ✓ | ✓ | ✓ | ✓ | PASS | hi-viz orange both modes |
| 21 | `crane` | Crane | `#1a1a08` | `#fbbf24` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | yellow |
| 22 | `diesel` | Diesel | `#0a0a08` | `#84cc16` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | lime/industrial |
| 23 | `sawdust` | Sawdust | `#1a1510` | `#a0724a` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | warm tan |
| 24 | `brick` | Brick | `#1a0a08` | `#b91c1c` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | maroon/red; dip 2.68 is fill-only |
| 25 | `toolbox` | Toolbox | `#0a0a15` | `#ef4444` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | red |
| 26 | `army` | Army | `#060a02` | `#6a8c2a` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | olive green |
| 27 | `cia` | CIA | `#020202` | `#c8a000` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | covert gold-on-black |
| 28 | `ninja` | Ninja | `#040400` | `#cc0000` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | red-on-near-black |

## Nature & Elements (14) — ✅ CATEGORY PASS (both modes)
_Vivid distinct nature identities, legible both modes. canyon dark-dip 2.63 = fill-only. Minor nit: underwater light-mode primary button slightly washed. ✓ seen · ✓ᶜ computed._

| # | id | name | ref bg | ref accent | Light A | Light B | Dark A | Dark B | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 29 | `forest` | Forest | `#0a1f0a` | `#22c55e` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | strong green identity |
| 30 | `ocean` | Ocean | `#0a192f` | `#06b6d4` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | cyan/teal |
| 31 | `desert` | Desert | `#2c1810` | `#d4a057` | ✓ | ✓ | ✓ᶜ | ✓ᶜ | PASS | sandy gold (light dip 2.93 fill-only) |
| 32 | `aurora` | Aurora | `#0a0e2a` | `#34d399` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | green-teal aurora |
| 33 | `volcano` | Volcano | `#1a0a0a` | `#ef4444` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | red |
| 34 | `glacier` | Glacier | `#0c1929` | `#7dd3fc` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | ice blue |
| 35 | `thunderstorm` | Thunderstorm | `#0d0d1a` | `#fbbf24` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | storm + amber lightning |
| 36 | `sunset` | Sunset | `#1a0a15` | `#f97316` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | orange |
| 37 | `canyon` | Canyon | `#2a1a10` | `#c2410c` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | rust/burnt-orange; dip 2.63 fill-only |
| 38 | `coral-reef` | Coral Reef | `#0a1a2a` | `#f472b6` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | pink coral |
| 39 | `tundra` | Tundra | `#1a1f2e` | `#e2e8f0` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | pale icy (achromatic accent) |
| 40 | `rainforest` | Rainforest | `#0a1a0a` | `#10b981` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | emerald |
| 41 | `underwater` | Underwater | `#000c14` | `#00e5cc` | ⚠ | ✓ | ✓ | ✓ | PASS* | aqua; *light primary button slightly washed (minor, BUG-LOG) |
| 42 | `volcanic` | Volcanic | `#120000` | `#ff3d00` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | molten red-orange |

## Seasonal (9) — ✅ CATEGORY PASS (both modes), 2 minor notes
_Identities clear. snowfall = white-accent button nit; easter = light-native (stays pastel in dark). ✓ seen · ✓ᶜ computed._

| # | id | name | ref bg | ref accent | Light A | Light B | Dark A | Dark B | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 43 | `pumpkin-patch` | Pumpkin Patch | `#1a0a05` | `#f97316` | ✓ | ✓ | ✓ᶜ | ✓ᶜ | PASS | warm cream + orange |
| 44 | `snowfall` | Snowfall | `#0f172a` | `#f1f5f9` | ✓ᶜ | ✓ᶜ | ⚠ | ✓ | PASS* | white accent → primary button label low-contrast (BUG-LOG, minor) |
| 45 | `spring-bloom` | Spring Bloom | `#0a1a0a` | `#f9a8d4` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | pink blossom |
| 46 | `summer-heat` | Summer Heat | `#1a1005` | `#fbbf24` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | hot amber |
| 47 | `fourth-of-july` | Fourth of July | `#0a0a1a` | `#ef4444` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | red/white/blue |
| 48 | `storm-season` | Storm Season | `#0a0a10` | `#64748b` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | gray storm |
| 49 | `christmas` | Christmas | `#000e04` | `#e53935` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | green bg + red accent |
| 50 | `easter` | Easter | `#f0e8f8` | `#9c27b0` | ✓ | ✓ | ✓ (light) | ✓ | PASS | light-native: renders pastel purple in BOTH modes (PATTERNS note); legible |
| 51 | `halloween` | Halloween | `#080200` | `#ff6d00` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | orange-on-black |

## Luxury & Premium (12) — ✅ CATEGORY PASS (both modes)
_Rich distinct identities. diamond is plan-locked but renders complete (forced visual-only); F-4 gate blocks save/select, not render. ✓ seen · ✓ᶜ computed._

| # | id | name | ref bg | ref accent | Light A | Light B | Dark A | Dark B | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 52 | `crimson` | Crimson | `#1a0505` | `#dc2626` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | deep red |
| 53 | `gold` | Gold | `#1a1505` | `#eab308` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | luxe gold |
| 54 | `rose` | Rose | `#1a0a10` | `#f43f5e` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | rose pink |
| 55 | `diamond` 🔒 | Diamond | `#0a0a12` | `#a78bfa` | ✓ᶜ | ✓ | ✓ | ✓ | LOCKED | plan-gated; visual-only render = crystalline lavender, complete & legible |
| 56 | `marble` | Marble | `#1a1a1a` | `#e2e8f0` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | pale marble (achromatic accent) |
| 57 | `velvet` | Velvet | `#1a0510` | `#a855f7` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | rich purple |
| 58 | `champagne` | Champagne | `#1a1810` | `#fbbf24` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | warm champagne gold |
| 59 | `onyx` | Onyx | `#050505` | `#6b7280` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | near-black + gray |
| 60 | `frosted` | Frosted | `#e8eaf2` | `#5064c8` | ✓ | ✓ | ✓ᶜ | ✓ᶜ | PASS | icy pale + indigo (light-native) |
| 61 | `liquid` | Liquid | `#080c12` | `#78c8e8` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | aqua liquid |
| 62 | `metal` | Heavy Metal | `#0e0e10` | `#c8ccd8` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | brushed metal (achromatic) |
| 63 | `translucent` | Translucent | `#030408` | `#e8eeff` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | glassy pale (achromatic) |

## Mood & Aesthetic (22) — ✅ CATEGORY PASS (both modes)
_Aesthetic vibes distinct & legible. Several are light-native (minimalist/polaroid/ink/lofi/sakura/typewriter) → stay light-toned in dark mode (PATTERNS). ✓ seen · ✓ᶜ computed._

| # | id | name | ref bg | ref accent | Light A | Light B | Dark A | Dark B | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 | `lo-fi` | Lo-Fi | `#1a1815` | `#d4c5a9` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | warm muted beige |
| 65 | `dark-academia` | Dark Academia | `#1a1510` | `#b8860b` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | sepia/brass (light dip 2.99 fill) |
| 66 | `cottagecore` | Cottagecore | `#1a1510` | `#86a873` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | sage/earthy |
| 67 | `minimalist` | Minimalist | `#fafafa` | `#1a1a1a` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | light-native mono |
| 68 | `brutalist` | Brutalist | `#d4d0c8` | `#000000` | ✓ | ✓ | ✓ᶜ | ✓ᶜ | PASS | raw concrete gray + black |
| 69 | `art-deco` | Art Deco | `#0a0a08` | `#d4a057` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | gold/black elegance |
| 70 | `noir` | Noir | `#141416` | `#dc2626` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | film-noir black/red |
| 71 | `polaroid` | Polaroid | `#f5f0eb` | `#2c7a7b` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | light-native teal |
| 72 | `grunge` | Grunge | `#0a0a08` | `#a3903f` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | muddy olive (light dip 2.94 fill) |
| 73 | `vapor-room` | Vapor Room | `#1a0a2a` | `#e879f9` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | magenta vapor |
| 74 | `blood-moon` | Blood Moon | `#080002` | `#e8001a` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | blood red |
| 75 | `blueprint-art` | Blueprint Art | `#001428` | `#ffffff` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | blueprint white-on-blue |
| 76 | `candlelit` | Candlelit | `#0c0600` | `#e8820a` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | warm candle (dark muted 4.79) |
| 77 | `copper` | Copper | `#0c0800` | `#b87333` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | copper |
| 78 | `deep-focus` | Deep Focus | `#020404` | `#0d9488` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | teal focus |
| 79 | `ember` | Ember | `#0a0300` | `#ff4500` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | ember orange-red |
| 80 | `ink` | Ink | `#f5f0e8` | `#0f0a04` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | light-native ink-on-paper |
| 81 | `lofi` | Lo-Fi Beige | `#f2ede4` | `#c8a878` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | light-native beige (light worst-body but ≥AA) |
| 82 | `midnight-oil` | Midnight Oil | `#060402` | `#d4900a` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | amber-on-black |
| 83 | `obsidian-v5` | Obsidian Purple | `#06040a` | `#8b5cf6` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | violet-on-black |
| 84 | `sakura` | Sakura | `#fff0f4` | `#e8346c` | ✓ | ✓ | ✓ᶜ | ✓ᶜ | PASS | light-native cherry-blossom pink |
| 85 | `typewriter` | Typewriter | `#f0e8d4` | `#1a1208` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | light-native cream/typewriter |

## Sci-Fi & Cyber (18) — ✅ CATEGORY PASS (both modes)
_Bold neon identities. `terminal` JS theme renders crisp green-on-black (audit's CSS-terminal 2.07 worry does NOT apply here). synthwave/cyberpunk/neon share a pink-purple family — distinguishable but close. ✓ seen · ✓ᶜ computed._

| # | id | name | ref bg | ref accent | Light A | Light B | Dark A | Dark B | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 86 | `matrix` | Matrix | `#020a02` | `#22c55e` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | green code-on-black, strong |
| 87 | `neon` | Neon | `#0a0010` | `#ec4899` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | hot pink |
| 88 | `synthwave` | Synthwave | `#1a0530` | `#f472b6` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | retro pink/purple |
| 89 | `vaporwave` | Vaporwave | `#1a1040` | `#f0abfc` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | pastel purple |
| 90 | `deep-space` | Deep Space | `#020208` | `#8b5cf6` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | violet starfield |
| 91 | `galaxy` | Galaxy | `#05050f` | `#6366f1` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | indigo |
| 92 | `plasma` | Plasma | `#1a0020` | `#a855f7` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | purple plasma |
| 93 | `glow` | Glow | `#0a0a0a` | `#84cc16` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | lime glow (light muted 4.51) |
| 94 | `cyberpunk` | Cyberpunk | `#0a000a` | `#ec4899` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | neon pink (≈synthwave family) |
| 95 | `hologram` 🔒 | Hologram | `#05050a` | `#bbdefb` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | LOCKED | plan-gated; pale-blue holo (achromatic-ish accent) |
| 96 | `quantum` | Quantum | `#000510` | `#3b82f6` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | blue |
| 97 | `starship` | Starship | `#0f1520` | `#f97316` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | orange-on-steel |
| 98 | `android` | Android | `#0a0f0a` | `#4caf50` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | android green |
| 99 | `ios` | iOS | `#000000` | `#0a84ff` | ✓ | ✓ | ✓ᶜ | ✓ᶜ | PASS | clean Apple blue/white |
| 100 | `ios26` | iOS 26 | `#050508` | `#30d158` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | iOS green |
| 101 | `neon-rain` | Neon Rain | `#06000e` | `#ff2d9b` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | magenta rain |
| 102 | `terminal` | Terminal | `#000000` | `#00ff00` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | bright green CRT, high contrast |
| 103 | `windows` | Windows | `#001828` | `#0078d4` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | windows blue |

## Sports & Energy (8) — ⚠ CATEGORY PASS w/ 1 LEGIBILITY-FAIL (stadium-lights)
_stadium-lights white accent → invisible "ADD" button label (BUG B-1). Others fine. ✓ seen · ✓ᶜ computed._

| # | id | name | ref bg | ref accent | Light A | Light B | Dark A | Dark B | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 104 | `racing-red` | Racing Red | `#1a0505` | `#dc2626` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | racing red |
| 105 | `stadium-lights` | Stadium Lights | `#0a0a0a` | `#f8fafc` | ⚠ | ✓ | ✗ | ✓ | LEGIBILITY-FAIL | white accent → quick-add "ADD" button label white-on-white (B-1). Identity (bright white) intact; donut/text fine |
| 106 | `champion-gold` | Champion Gold | `#1a1508` | `#eab308` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | gold; button uses DARK accent-fg correctly |
| 107 | `endzone` | Endzone | `#0a1a0a` | `#16a34a` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | field green |
| 108 | `fast-break` | Fast Break | `#0a0510` | `#f97316` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | orange energy |
| 109 | `knockout` | Knockout | `#1a0505` | `#dc2626` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | boxing red |
| 110 | `checkered-flag` | Checkered Flag | `#0a0a0a` | `#eab308` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | yellow/black race |
| 111 | `trophy` | Trophy | `#1a1508` | `#d4a057` | ✓ | ✓ | ✓ᶜ | ✓ᶜ | PASS | gold trophy (light dip 2.93 fill) |

## Pop Culture (18) — ✅ CATEGORY PASS (both modes), 1 borderline
_Strong recognizable IPs. mandalorian = milder B-1 (gray accent → faint ADD label). ✓ seen · ✓ᶜ computed._

| # | id | name | ref bg | ref accent | Light A | Light B | Dark A | Dark B | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 112 | `batman` | Batman | `#0a0a0a` | `#fbbf24` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | yellow/black, iconic |
| 113 | `darth-vader` | Darth Vader | `#0a0a0a` | `#ef4444` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | red/black |
| 114 | `lightsaber` | Lightsaber | `#0a0a15` | `#60a5fa` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | blue saber |
| 115 | `pokemon` | Pokemon | `#1a0a0a` | `#ef4444` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | poké red |
| 116 | `mario` | Mario | `#1a0a0a` | `#dc2626` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | mario red |
| 117 | `zelda` | Zelda | `#0a1a0a` | `#eab308` | ✓ | ✓ | ✓ᶜ | ✓ᶜ | PASS | triforce gold |
| 118 | `arcade` | Arcade | `#0a0a15` | `#22c55e` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | arcade green |
| 119 | `retro` | Retro | `#1a1520` | `#f97316` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | retro orange |
| 120 | `mandalorian` | Mandalorian | `#1a1a15` | `#94a3b8` | ✓ᶜ | ✓ᶜ | ⚠ | ✓ | PASS* | beskar gray; ADD label faint (mild B-1) |
| 121 | `iron-man` | Iron Man | `#1a0505` | `#38bdf8` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | arc-reactor cyan on red |
| 122 | `joker` | Joker | `#0a1a0a` | `#22c55e` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | joker green/purple |
| 123 | `tron` | TRON | `#000a1a` | `#06b6d4` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | cyan grid |
| 124 | `stranger-things` | Stranger Things | `#0a0505` | `#ef4444` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | upside-down red |
| 125 | `top-gun` | Top Gun | `#0a0f1a` | `#d4a057` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | aviator tan (light dip 2.93 fill) |
| 126 | `john-wick` | John Wick | `#0a0a0a` | `#b8860b` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | dark gold (light dip 2.99 fill) |
| 127 | `japan` | Japan | `#0a0608` | `#c41c24` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | rising-sun red |
| 128 | `samurai` | Samurai | `#080208` | `#cc2200` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | samurai red |
| 129 | `wildwest` | Wild West | `#120a00` | `#c87840` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | desert leather |

## Anime (25) — ✅ CATEGORY PASS (both modes)
_Vivid IP-accurate identities, legible both modes. vinland-saga rust accent = lowest accent-on-surface (2.08, donut still discernible). mob-psycho uses a gradient surface (legible, parser-skipped). ✓ seen · ✓ᶜ computed._

| # | id | name | ref bg | ref accent | Light A | Light B | Dark A | Dark B | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 130 | `dragon-ball-z` | Dragon Ball Z | `#1a0a00` | `#e86a10` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | DBZ orange (light dip 2.95 fill) |
| 131 | `naruto` | Naruto | `#1a0a00` | `#ff6b2b` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | ninja orange |
| 132 | `one-piece` | One Piece | `#0a1a2a` | `#d4a057` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | pirate gold (light dip 2.93 fill) |
| 133 | `attack-on-titan` | Attack on Titan | `#0f1a0f` | `#4a7a4a` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | survey-corps green |
| 134 | `demon-slayer` | Demon Slayer | `#0a0a1a` | `#4fc3f7` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | water-breathing teal |
| 135 | `my-hero-academia` | My Hero Academia | `#0a1a0a` | `#22c55e` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | hero green (dark body 6.5) |
| 136 | `death-note` | Death Note | `#050505` | `#b71c1c` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | crimson-on-black |
| 137 | `cowboy-bebop` | Cowboy Bebop | `#1a1008` | `#ffb300` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | jazz amber |
| 138 | `evangelion` | Evangelion | `#1a0530` | `#ff6d00` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | purple/orange EVA |
| 139 | `akira` | Akira | `#1a1a1a` | `#d50000` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | neo-tokyo red (dark dip 2.62 fill) |
| 140 | `studio-ghibli` | Studio Ghibli | `#fff8e1` | `#2e7d32` | ✓ | ✓ | ✓ᶜ | ✓ᶜ | PASS | light-native cream + forest green |
| 141 | `jujutsu-kaisen` | Jujutsu Kaisen | `#0a0015` | `#7c4dff` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | cursed-energy purple |
| 142 | `bleach` | Bleach | `#050508` | `#2979ff` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | soul-reaper blue |
| 143 | `hunter-x-hunter` | Hunter x Hunter | `#0a1a0a` | `#22c55e` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | nen green |
| 144 | `fullmetal-alchemist` | Fullmetal Alchemist | `#0a0a1a` | `#ffc107` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | alchemy gold |
| 145 | `chainsaw-man` | Chainsaw Man | `#0a0000` | `#b71c1c` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | blood red (dark dip 2.99 fill) |
| 146 | `sailor-moon` | Sailor Moon | `#0a0a20` | `#f48fb1` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | magical pink |
| 147 | `ghost-in-shell` | Ghost in the Shell | `#0f1a1a` | `#00bfa5` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | cyber teal (light dip 2.92 fill) |
| 148 | `spy-x-family` | Spy x Family | `#0a1a0a` | `#2e7d32` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | green (dark dip 2.83 fill) |
| 149 | `vinland-saga` | Vinland Saga | `#0a1520` | `#bf360c` | ✓ᶜ | ✓ᶜ | ⚠ | ✓ | PASS* | rust accent lowest on-surface (2.08); donut still readable |
| 150 | `solo-leveling` | Solo Leveling | `#0a0515` | `#448aff` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | shadow-monarch blue |
| 151 | `one-punch-man` | One Punch Man | `#fafafa` | `#b8860b` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | light-native; gold accent |
| 152 | `berserk` | Berserk | `#0e0a0a` | `#c41e3a` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | brand-of-sacrifice red |
| 153 | `jojos-bizarre` | JoJo | `#1a0030` | `#aa00ff` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | bizarre magenta |
| 154 | `mob-psycho` | Mob Psycho 100 | `#0a0a20` | `#ff4081` | ✓ᶜ | ✓ᶜ | ✓(grad) | ✓ | PASS | gradient surface + pink (legible, parser-skipped) |

## Cartoon (25) — ⚠ CATEGORY PASS w/ B-1 cases (avatar-water, spongebob)
_Bright IP palettes correct (rick-and-morty/simpsons flip accent-fg fine). Pale-accent B-1: avatar-water (white buttons), spongebob (faint yellow buttons). ✓ seen · ✓ᶜ computed._

| # | id | name | ref bg | ref accent | Light A | Light B | Dark A | Dark B | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 155 | `spongebob` | SpongeBob | `#0a2040` | `#fff176` | ✓ᶜ | ✓ | ⚠ | ✓ | PARTIAL | pale-yellow accent → faint button labels (B-1); body text OK (4.91) |
| 156 | `avatar-water` | Avatar - Water | `#0a1a3a` | `#e3f2fd` | ⚠ | ✓ | ✗ | ✓ | LEGIBILITY-FAIL | near-white-blue accent → NEW ESTIMATE + ADD white-on-white (B-1) |
| 157 | `avatar-fire` | Avatar - Fire | `#1a0505` | `#ffd600` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | fire-nation gold (dark body 5.44) |
| 158 | `avatar-earth` | Avatar - Earth | `#0a1508` | `#9ccc65` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | earth green (dark muted 4.62, body 6.08) — verify button if pale |
| 159 | `avatar-air` | Avatar - Air | `#e1f5fe` | `#c2670c` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | light-native sky + airbender orange |
| 160 | `rick-and-morty` | Rick and Morty | `#050808` | `#76ff03` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | portal green; accent-fg flips dark correctly |
| 161 | `samurai-jack` | Samurai Jack | `#050505` | `#c62828` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | red-on-black |
| 162 | `adventure-time` | Adventure Time | `#1a1a3a` | `#f8bbd0` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | bubblegum pink |
| 163 | `gravity-falls` | Gravity Falls | `#1a1008` | `#2e7d32` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | mystery green (dark dip 2.70 fill) |
| 164 | `regular-show` | Regular Show | `#0a2040` | `#42a5f5` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | blue |
| 165 | `teen-titans` | Teen Titans | `#0a0a2a` | `#dc2626` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | titans red (dark dip 2.74 fill) |
| 166 | `ben-10` | Ben 10 | `#000a00` | `#00c853` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | omnitrix green |
| 167 | `invader-zim` | Invader Zim | `#0a0008` | `#e91e63` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | irken magenta |
| 168 | `simpsons` | The Simpsons | `#1a2040` | `#ffd600` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | PASS | springfield yellow; accent-fg flips dark fine |
| 169 | `futurama` | Futurama | `#050810` | `#00897b` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | teal |
| 170 | `south-park` | South Park | `#fff8dc` | `#d97706` | ✓ | ✓ | ✓ᶜ | ✓ᶜ | PASS | light-native construction-paper |
| 171 | `steven-universe` | Steven Universe | `#0a0a20` | `#f48fb1` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | gem pink |
| 172 | `courage` | Courage | `#1a0520` | `#ce93d8` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | eerie lavender |
| 173 | `dexters-lab` | Dexter's Lab | `#1a0530` | `#00e676` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | lab green (light muted 4.51) |
| 174 | `powerpuff-girls` | Powerpuff Girls | `#0a0a10` | `#f06292` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | sugar pink |
| 175 | `scooby-doo` | Scooby-Doo | `#0a0520` | `#4caf50` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | mystery-machine green |
| 176 | `tmnt` | TMNT | `#0a1a0a` | `#2e7d32` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | turtle green (dark dip 2.95 fill) |
| 177 | `transformers` | Transformers | `#0a0a1a` | `#d32f2f` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | autobot red |
| 178 | `looney-tunes` | Looney Tunes | `#1a0505` | `#c62828` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | PASS | classic red |
| 179 | `dragon-ball-super` 🔒 | Dragon Ball Super | `#0a0a0f` | `#2962ff` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | LOCKED | plan-gated; SSB blue |

## Achievements (7) — ✅ ALL LOCKED, visual-only renders complete & legible
_All 7 are plan/achievement-gated (won't apply via picker for un-earned users). Forced visual renders confirm each is fully themed and readable. iron-door (gray accent) ADD button = readable dark text → NOT a B-1 case. ✓ seen · ✓ᶜ computed._

| # | id | name | ref bg | ref accent | Light A | Light B | Dark A | Dark B | Status | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| 180 | `gold-rush` 🔒 | Gold Rush | `#1a1508` | `#fbbf24` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | LOCKED | gold; visual render complete |
| 181 | `eternal-flame` 🔒 | Eternal Flame | `#1a0505` | `#ef4444` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | LOCKED | fire red; complete |
| 182 | `iron-door` 🔒 | Iron Door | `#1a1a1a` | `#6b7280` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | LOCKED | gray; ADD button dark-text readable (dark dip 2.97 fill) |
| 183 | `completionist` 🔒 | Completionist | `#050510` | `#ff00ff` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | LOCKED | magenta; complete |
| 184 | `night-owl` 🔒 | Night Owl | `#050505` | `#7dd3fc` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | LOCKED | sky blue |
| 185 | `road-warrior` 🔒 | Road Warrior | `#1a1a15` | `#fbbf24` | ✓ᶜ | ✓ᶜ | ✓ᶜ | ✓ᶜ | LOCKED | amber |
| 186 | `legend` 🔒 | Legend | `#050505` | `#a78bfa` | ✓ᶜ | ✓ᶜ | ✓ | ✓ | LOCKED | violet; complete |

