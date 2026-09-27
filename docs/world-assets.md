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
| `Booth2.png` (red/white) | 537 × 459 at 984,434 | b | top-left (0.371, 0.02), scale 1 | Where the old "FIH" stall was. Empty counter; items are a placeholder. |
| `Booth1.png` (blue/white, net) | 744 × 433 at 1027,634 | b | top-left (0.674, 0.054), scale 0.85 | Where the old shell stall was. Scaled down so there's a walk-through gap between the stalls. |
| `Pincnic table.png` | 766 × 568 at 641,622 | b | top-left (0.576, 0.303), scale 1 | Where the old table was, on the dock. |
| `Bucket and shovel.png` | 279 × 180 at 752,536 | b | top-left (0.708, 0.684) | On the sand, as in the old background. |
| `Sandcastle.png` | 251 × 151 at 1085,553 | b | top-left (0.552, 0.696) | **Spawnable item**, left of the bucket. |
| `Seagull.png` | 199 × 150 at 843,1015 | b | top-left (0.161, 0.566) | Dock edge, in front of the store. Hops. |
| `Ice cream.png` (stand) | 786 × 1031 at 89,305 | b | top-left (0, 0.1), scale 0.9 | Scoop, cone, sign, serving window. Drawn *behind* every fish. |
| Counter front | 558 × 147 cut from `Ice cream.png` (y 1188–1335: ledge + body) | b | same offset/scale as the stand | Drawn *in front of* the fish standing in the serving window. |

`base.jpg` is the painted sky band (rows 0–136, exactly rgb(125,199,235)), plus sand, dock and seashells. It is solid sea from y 1845 down, so the drifting ocean never shows sand at the bottom edge. `strip.jpg` is base plus a horizontally flipped ocean at 1024². Unmirrored copies of it fill the sides on landscape screens: the straight planks tile, and the flipped ocean's edges meet the scene's wave line.

## Placeholder items

Each is `{ id, src, rect, label }` in `SPRITES`. If the PNG is missing or fails to load, a dashed box with the label is drawn instead. Drop a PNG at the path below and it's used, with no code change:

| Item | Path | Shown by |
|---|---|---|
| booth1 items | `/public/world/props/booth1-items.png` | Booth 1, while occupied |
| booth2 items | `/public/world/props/booth2-items.png` | Booth 2, while occupied |
| ice cream | `/public/world/props/icecream.png` | Picnic table (two fish) |
| fries | `/public/world/props/fries.png` | Seagull |

The item rects are sized for the placeholders. Nudge `rect` in `scene.ts` once real art lands.

## Depth

z-index = base (bottom-edge) y, the same scale for fish feet and props (`zOf` in `useWorldSim.ts`). An anchor can override a fish's draw order (`zY`): seated picnic fish draw over the table, and the fish in the ice cream window draws between the stand and its counter front. A fish whose feet are above a prop's base draws behind it. So a fish at a booth anchor, above the counter's base, shows only its top half. Layers `back` (the store, the ocean) and `front` bypass sorting. Fish names and bubbles sit on their own layer above everything, so they're never hidden behind a stall.

Blocked footprints (`BLOCKED`) cover the counters, the table, the store, the seagull and the sandcastle spot. They don't cover whole images, so fish can pass behind an awning. Walk paths go around them via the rects' corners.

## Composed scene

- `docs/world-scene-debug.png`: `/world?debug=1` with the walkable area (green), blocked rects (red), activity zones (blue), anchors (yellow) and entry routes (orange).
- `docs/world-scene.png`: the scene in action (a fish in the ice cream window, booth 2 with items, two fish at the picnic table with ice cream).
