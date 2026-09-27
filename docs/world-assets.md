# World assets (Phase 4)

Every raw file in `public/art/world/` is a **2048 × 2048 RGBA canvas**. They split into two kinds:

- **(a) pre-positioned layers**: already in place on the shared canvas, so they render at (0, 0) at the same scale as the scene.
- **(b) standalone props**: drawn at arbitrary spots. Stacking them as-is makes the booths overlap each other and the table, so each one is cropped to its opaque bounds and placed by `lib/world/scene.ts`.

`npm run build:scene` (`scripts/build-world-scene.ts`) turns the raw art into the sprites the page loads, in `public/world/scene/`. Re-run it after replacing any raw art. **All placements are in `lib/world/scene.ts`**, as normalized 0..1 coordinates of the square scene. Components don't hard-code any.

| Asset | Size / opaque bounds (px) | Type | Placement | Notes |
|---|---|---|---|---|
| `BackgroundTemp.png` | 2048², fully opaque | reference | not drawn in `/world` any more | The old flattened scene. Still used by the `/meet` cutscene stage. |
| `Sand.png` | 2048², fully opaque | a | base layer | Flat sand. |
| `DockUpdate.png` | 2048², bounds y 114–1266 (solid from y 137) | a | base layer | Boardwalk with straight vertical planks and the step at the bottom centre. Fish walk on it; it's the floor, not an obstacle. Replaces the perspective `Dock.png` (no longer used). |
| `Seashells.png` | 2048², bounds 218,1683 → 2009,1791 | a | base layer, lifted 90px (`SHELLS_LIFT`) | Two shells + a starfish; lifted so the waves don't cover them. Static, not interactive. |
| `Ocean.png` | 2048², bounds y 1699–2048 | a | `ocean` sprite at its painted position (slight bottom overhang) | Separate so it can drift. Bottom row is exactly rgb(93,135,191). Wave crest is between y 1702 and 1838. |
| `Booth2.png` (red/white) | 537 × 459 at 984,434 | b | top-left (0.371, 0.02), scale 1 | Where the old "FIH" stall was. Drawn at the very back; its counter (rows 251+) is a separate overlay (`booth2-counter.png`) that only covers the fish working the stall. |
| `Booth1.png` (blue/white, net) | 744 × 433 at 1027,634 | b | top-left (0.674, 0.054), scale 0.85 | Where the old shell stall was. Drawn at the very back; counter overlay `booth1-counter.png` (rows 230+) covers only the stall worker. |
| `Pincnic table.png` | 766 × 568 at 641,622 | b | top-left (0.576, 0.303), scale 1 | Where the old table was, on the dock. |
| `Bucket and shovel.png` | 279 × 180 at 752,536 | b | top-left (0.708, 0.684) | On the sand, as in the old background. |
| `Sandcastle.png` | 251 × 151 at 1085,553 | b | top-left (0.552, 0.696) | **Spawnable item**, left of the bucket. |
| `Seagull.png` | 199 × 150 at 843,1015 | b | top-left (0.161, 0.566) | Dock edge, in front of the store. Idle hops; hidden while its animation plays. |
| `seagull_anim/Frame_1..9.png` | 2048² each, shared bounds 283 × 219 at 808,943 | b (strip) | lined up with `Seagull.png` (same drawing, offset +34,+3 px) | Built into one 9-frame strip `seagull-anim.png`. The seagull activity swaps it in for one play at 6 fps, then the static gull returns. Includes its own fries box. |
| `Booth1 items.png` | 465 × 103 at 1155,843 | b (item) | lined up with Booth 1 (offset 128,209 px into Booth1.png, same 0.85 scale) | Headphones, shades, bow on the counter; shown while a fish works Booth 1. |
| `Booth2 Items.png` | 331 × 119 at 1085,631 | b (item) | lined up with Booth 2 (offset 101,197 px into Booth2.png, scale 1) | Fries, hot dog and drink on the counter; shown while a fish works Booth 2. |
| `Vanilla.png`, `Chocolate_.png`, `Strawberry.png` | 79 × 128 / 130 / 123 | b (items) | on the picnic table top, one spot in front of each bench | Picnic: each seated fish gets one random flavour. |
| `Crab.png` | 113 × 66 at 594,1242 | b | top-left (0.33, 0.735), on the sand | Moved from its painted spot (clashed with the seagull's fries). Idle sideways scuttle; small blocked footprint. |
| `Ice cream.png` (stand) | 786 × 1031 at 89,305 | b | top-left (0, 0.1), scale 0.9 | Scoop, cone, sign, serving window. Drawn *behind* every fish. |
| Counter front | 558 × 147 cut from `Ice cream.png` (y 1188–1335: ledge + body) | b | same offset/scale as the stand | Drawn *in front of* the fish standing in the serving window. |

`base.jpg` is the painted sky band (rows 0–136, exactly rgb(125,199,235)), plus sand, dock and seashells. It is solid sea from y 1845 down, so the drifting ocean never shows sand at the bottom edge. `strip.jpg` is base plus a horizontally flipped ocean at 1024². Unmirrored copies of it fill the sides on landscape screens: the straight planks tile, and the flipped ocean's edges meet the scene's wave line.

## Placeholder fallback

Every item now has real art. The fallback is still there for new ones: each sprite is `{ id, src, rect, label }` in `SPRITES`, and if its PNG is missing or fails to load, a dashed box with the label is drawn instead. Point `src` at where the art will go and it's picked up with no other code change.

## Depth

z-index = base (bottom-edge) y, the same scale for fish feet and props (`zOf` in `useWorldSim.ts`). An anchor can override a fish's draw order (`zY`): seated picnic fish draw over the table, and the fish in the ice cream window draws between the stand and its counter front. A fish whose feet are above a prop's base draws behind it. So a fish at a booth anchor, above the counter's base, shows only its top half. Layers `back` (the store, the ocean) and `front` bypass sorting. Fish names and bubbles sit on their own layer above everything, so they're never hidden behind a stall.

Blocked footprints (`BLOCKED`) cover the counters, the table, the store, the seagull and the sandcastle spot. They don't cover whole images, so fish can pass behind an awning. Walk paths go around them via the rects' corners.

## Composed scene

- `docs/world-scene-debug.png`: `/world?debug=1` with the walkable area (green), blocked rects (red), activity zones (blue), anchors (yellow) and entry routes (orange).
- `docs/world-scene.png`: the scene in action (a fish in the ice cream window, booth 2 with items, two fish at the picnic table with ice cream).
