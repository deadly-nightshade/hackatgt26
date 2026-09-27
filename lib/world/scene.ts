import type { Area } from "@/lib/world/config";

/**
 * Where everything sits in the seaside scene. All placements are normalized 0..1
 * of the (square) scene; sprite sizes come from the cropped art's native pixels.
 * See docs/world-assets.md for what each asset is and how it was cropped.
 * Safe for client components (pure data).
 */

/** Raw art canvas size (every file in public/art/world is 2048×2048). */
export const SCENE_PX = 2048;
/** Rows above the dock's top edge; painted sky so the page's sky block continues seamlessly. */
export const SCENE_SKY_ROWS = 137;
/** Rows from here down are always under the ocean (its lowest wave crest is at 1838). */
export const SCENE_SEA_FROM = 1845;

/** Seashells.png is lifted this many px when baked into the base, so the waves cover less of it. */
export const SHELLS_LIFT = 90;

/** Ice cream stand (`Ice cream.png`): its opaque bounds, and the counter front below the serving window (raw-canvas px). */
export const ICECREAM_ART = {
  bounds: { left: 89, top: 305, width: 786, height: 1031 },
  /** Ledge + body under the window → drawn IN FRONT of a fish standing in the window. */
  counter: { left: 89, top: 1188, width: 558, height: 147 },
  /** Serving window centre x. */
  windowX: 431,
} as const;

/**
 * Seagull eating fries (public/art/world/seagull_anim/Frame_1..9.png): full canvases,
 * cropped to their shared bounds into one horizontal strip by the build script.
 * The gull in the frames is Seagull.png's exact drawing, shifted by `offset` px.
 */
export const SEAGULL_ANIM_ART = {
  dir: "seagull_anim",
  frames: 9,
  crop: { left: 808, top: 943, width: 283, height: 219 },
  /** Frame-canvas px → Seagull.png-canvas px (so the swap doesn't jump). */
  offset: { x: 34, y: 3 },
  /** Seagull.png's own crop origin (its opaque bounds). */
  staticOrigin: { left: 843, top: 1015 },
  fps: 6,
} as const;
/** One play of the eating animation (last frame held a moment). */
export const SEAGULL_ANIM_MS = Math.round((SEAGULL_ANIM_ART.frames / SEAGULL_ANIM_ART.fps) * 1000) + 400;

export type Pt = { x: number; y: number };

/** Draw order: "back" under every fish, "front" over every fish, "sort" by its base (bottom edge) y. */
export type Layer = "back" | "sort" | "front";

export type SceneSprite = {
  id: string;
  label: string;
  /** Tried in order; if all fail (or none), a dashed placeholder with `label` is drawn. */
  src: string[];
  rect: Area;
  layer: Layer;
  /** Draw-order y for layer "sort" (default: rect.maxY). */
  baseY?: number;
  /** Spawnable items start hidden and are shown by activities. */
  item?: boolean;
  /** Decorations that do an idle/triggered hop (the seagull). */
  hops?: boolean;
  /** Idle sideways scuttle (the crab). */
  scuttles?: boolean;
  /** Hidden while this item is shown (the static seagull while its animation plays). */
  hideWhile?: string;
  /** `src` is a horizontal strip of this many frames, played once (at fps) each time the item shows. */
  frames?: { count: number; fps: number };
};

const S = (px: number) => px / SCENE_PX;

/** Place native-size art (w×h px after cropping) with its top-left at normalized (x, y). */
function place(x: number, y: number, w: number, h: number, scale = 1): Area {
  return { minX: x, minY: y, maxX: x + S(w * scale), maxY: y + S(h * scale) };
}

/** Area from raw-canvas pixels (for things that keep their painted position). */
const pxRect = (l: number, t: number, w: number, h: number): Area => ({ minX: S(l), minY: S(t), maxX: S(l + w), maxY: S(t + h) });


// Cropped art sizes (px) — printed by `npm run build:scene`.
const ART = {
  ocean: [2048, 349],
  booth1: [744, 433],
  booth2: [537, 459],
  picnic: [766, 568],
  bucket: [279, 180],
  sandcastle: [251, 151],
  booth1Items: [465, 103],
  booth2Items: [331, 119],
  crab: [113, 66],
  cone: { vanilla: [79, 128], chocolate: [79, 130], strawberry: [79, 123] },
  seagull: [199, 150],
} as const;

const DIR = "/world/scene";

/** Flattened sky band + sand + dock + seashells (full scene, no alpha). */
export const SCENE_BASE = { src: `${DIR}/base.jpg`, strip: `${DIR}/strip.jpg` } as const;

// ── static props ────────────────────────────────────────────────────────────

const BOOTH1_SCALE = 0.85;
export const BOOTH1 = place(0.674, 0.054, ...ART.booth1, BOOTH1_SCALE);
export const BOOTH2 = place(0.371, 0.02, ...ART.booth2);

/**
 * The stalls sit at the very back (behind every walking fish, so nobody gets cut off
 * between them). Only a fish working a stall goes behind its counter: each counter
 * (table top + front box, from `top` px of the cropped sprite down) is a thin overlay
 * drawn between the stall-worker (Z_STALL_WORKER) and everyone else.
 */
export const BOOTH_COUNTER = { booth1: { top: 230 }, booth2: { top: 251 } } as const;
/** Draw-order y: stall-worker fish < counter overlays < every normal fish/prop (all ≥ 0). */
export const Z_STALL_WORKER = -0.004;
export const Z_STALL_COUNTER = -0.003;
const counterRect = (booth: Area, [w, h]: readonly [number, number], top: number, scale = 1) =>
  place(booth.minX, booth.minY + S(top * scale), w, h - top, scale);
/** `Booth1 items.png` is drawn in place on the raw Booth 1 canvas: its bounds start this far into Booth1.png's (px). */
export const BOOTH1_ITEMS_OFFSET = { x: 1155 - 1027, y: 843 - 634 } as const;
export const BOOTH1_ITEMS = place(
  BOOTH1.minX + S(BOOTH1_ITEMS_OFFSET.x * BOOTH1_SCALE),
  BOOTH1.minY + S(BOOTH1_ITEMS_OFFSET.y * BOOTH1_SCALE),
  ...ART.booth1Items,
  BOOTH1_SCALE,
);
/** Same for `Booth2 Items.png` inside Booth2.png (scale 1). */
export const BOOTH2_ITEMS_OFFSET = { x: 1085 - 984, y: 631 - 434 } as const;
export const BOOTH2_ITEMS = place(BOOTH2.minX + S(BOOTH2_ITEMS_OFFSET.x), BOOTH2.minY + S(BOOTH2_ITEMS_OFFSET.y), ...ART.booth2Items);
export const BOOTH1_COUNTER = counterRect(BOOTH1, ART.booth1, BOOTH_COUNTER.booth1.top, BOOTH1_SCALE);
export const BOOTH2_COUNTER = counterRect(BOOTH2, ART.booth2, BOOTH_COUNTER.booth2.top);
/** Legs end on the dock's planks (its walkable top ends at y 1154 px; below is the dock's front edge). */
export const PICNIC = place(0.576, 0.281, ...ART.picnic);
export const BUCKET = place(0.708, 0.684, ...ART.bucket);
export const SANDCASTLE = place(0.552, 0.696, ...ART.sandcastle);
export const SEAGULL = place(0.161, 0.566, ...ART.seagull);
/** On open sand, clear of the seagull's fries and the fish that visits it. */
export const CRAB = place(0.33, 0.735, ...ART.crab);

/** Ice cream flavours (one random cone per seated fish at the picnic table). */
export const ICE_CREAM_FLAVOURS = ["vanilla", "chocolate", "strawberry"] as const;
/** Cone spots on the table top, in front of each bench (feet on the table's front lip). */
const CONE_SPOTS = { left: { x: 0.722, y: PICNIC.minY + 0.156 }, right: { x: 0.842, y: PICNIC.minY + 0.156 } } as const;
const cone = (spot: { x: number; y: number }, [w, h]: readonly [number, number]) => place(spot.x - S(w / 2), spot.y - S(h), w, h);
export const iceCreamId = (side: keyof typeof CONE_SPOTS, flavour: (typeof ICE_CREAM_FLAVOURS)[number]) => `icecream-${side}-${flavour}`;
const A = SEAGULL_ANIM_ART;
export const SEAGULL_ANIM = place(
  SEAGULL.minX + S(A.crop.left + A.offset.x - A.staticOrigin.left),
  SEAGULL.minY + S(A.crop.top + A.offset.y - A.staticOrigin.top),
  A.crop.width,
  A.crop.height,
);
const STORE_SCALE = 0.9;
export const STORE = place(0, 0.1, ICECREAM_ART.bounds.width, ICECREAM_ART.bounds.height, STORE_SCALE);
export const COUNTER = place(
  STORE.minX + S((ICECREAM_ART.counter.left - ICECREAM_ART.bounds.left) * STORE_SCALE),
  STORE.minY + S((ICECREAM_ART.counter.top - ICECREAM_ART.bounds.top) * STORE_SCALE),
  ICECREAM_ART.counter.width,
  ICECREAM_ART.counter.height,
  STORE_SCALE,
);
/** Where a fish stands in the serving window (feet hidden behind the counter front). */
export const STORE_WINDOW_X = STORE.minX + S((ICECREAM_ART.windowX - ICECREAM_ART.bounds.left) * STORE_SCALE);

export const SPRITES: SceneSprite[] = [
  { id: "ocean", label: "ocean", src: [`${DIR}/ocean.png`], rect: pxRect(0, 1699, ART.ocean[0], ART.ocean[1] + 8), layer: "back" },
  // The store body sits behind everyone; only its counter front covers a fish in the window.
  { id: "store", label: "ice cream stand", src: [`${DIR}/icecream-store.png`], rect: STORE, layer: "back" },
  { id: "counter-front", label: "counter front", src: [`${DIR}/counter-front.png`], rect: COUNTER, layer: "sort" },
  { id: "booth2", label: "booth 2", src: [`${DIR}/booth2.png`], rect: BOOTH2, layer: "back" },
  { id: "booth1", label: "booth 1", src: [`${DIR}/booth1.png`], rect: BOOTH1, layer: "back" },
  { id: "booth2-counter", label: "booth 2 counter", src: [`${DIR}/booth2-counter.png`], rect: BOOTH2_COUNTER, layer: "sort", baseY: Z_STALL_COUNTER },
  { id: "booth1-counter", label: "booth 1 counter", src: [`${DIR}/booth1-counter.png`], rect: BOOTH1_COUNTER, layer: "sort", baseY: Z_STALL_COUNTER },
  // Always under the fish (they walk around it; seated fish + ice cream draw on top).
  { id: "picnic", label: "picnic table", src: [`${DIR}/picnic-table.png`], rect: PICNIC, layer: "back" },
  { id: "bucket", label: "bucket & shovel", src: [`${DIR}/bucket-shovel.png`], rect: BUCKET, layer: "sort" },
  { id: "seagull", label: "seagull", src: [`${DIR}/seagull.png`], rect: SEAGULL, layer: "sort", hops: true, hideWhile: "seagull-anim" },

  // ── spawnable items (hidden until an activity shows them) ──
  { id: "sandcastle", label: "sandcastle", src: [`${DIR}/sandcastle.png`], rect: SANDCASTLE, layer: "sort", item: true },
  // Booth items sit on the counter top and must cover the fish standing behind it.
  { id: "booth1-items", label: "booth1 items", src: [`${DIR}/booth1-items.png`], rect: BOOTH1_ITEMS, layer: "sort", baseY: BOOTH1.maxY + 0.001, item: true },
  { id: "booth2-items", label: "booth2 items", src: [`${DIR}/booth2-items.png`], rect: BOOTH2_ITEMS, layer: "sort", baseY: BOOTH2.maxY + 0.001, item: true },
  // Above the seated fish (who are drawn over the table).
  // One random flavour per side (activities pick one id from each group).
  ...(["left", "right"] as const).flatMap((side) =>
    ICE_CREAM_FLAVOURS.map(
      (flavour): SceneSprite => ({
        id: iceCreamId(side, flavour),
        label: `${flavour} ice cream`,
        src: [`${DIR}/icecream-${flavour}.png`],
        rect: cone(CONE_SPOTS[side], ART.cone[flavour]),
        layer: "sort",
        baseY: PICNIC.maxY + 0.004, // over the seated fish
        item: true,
      }),
    ),
  ),
  { id: "crab", label: "crab", src: [`${DIR}/crab.png`], rect: CRAB, layer: "sort", scuttles: true },
  // Replaces the static gull while it plays (same feet line, so no jump).
  {
    id: "seagull-anim",
    label: "seagull eating fries",
    src: [`${DIR}/seagull-anim.png`],
    rect: SEAGULL_ANIM,
    layer: "sort",
    baseY: SEAGULL.maxY,
    item: true,
    frames: { count: SEAGULL_ANIM_ART.frames, fps: SEAGULL_ANIM_ART.fps },
  },
];

// ── walking ─────────────────────────────────────────────────────────────────

/**
 * Where fish may NOT stand or walk through (footprints, not whole images:
 * fish may pass behind a stall's awning, y-sorting hides them).
 */
export const BLOCKED: (Area & { id: string })[] = [
  { id: "store", minX: STORE.minX, minY: 0, maxX: COUNTER.maxX, maxY: STORE.maxY + 0.005 },
  { id: "booth2", minX: BOOTH2.minX, minY: BOOTH2.maxY - 0.06, maxX: BOOTH2.maxX, maxY: BOOTH2.maxY + 0.005 },
  { id: "booth1", minX: BOOTH1.minX, minY: BOOTH1.maxY - 0.06, maxX: BOOTH1.maxX, maxY: BOOTH1.maxY + 0.005 },
  // The whole table (not just its legs): nobody walks across the top or under it.
  // Pulled in a little on the right so there's still a lane between the table and the scene edge.
  { id: "picnic", minX: PICNIC.minX, minY: PICNIC.minY, maxX: PICNIC.maxX - 0.022, maxY: PICNIC.maxY + 0.005 },
  { id: "seagull", minX: SEAGULL.minX, minY: SEAGULL.maxY - 0.035, maxX: SEAGULL.maxX, maxY: SEAGULL.maxY + 0.005 },
  { id: "sandcastle", minX: SANDCASTLE.minX - 0.01, minY: 0.725, maxX: BUCKET.maxX + 0.005, maxY: 0.778 },
  { id: "crab", minX: CRAB.minX - 0.005, minY: CRAB.maxY - 0.02, maxX: CRAB.maxX + 0.005, maxY: CRAB.maxY + 0.004 },
];

/** Gap between the two stalls: the way in/out behind both counters. */
export const STALL_GAP: Pt = { x: (BOOTH2.maxX + BOOTH1.minX) / 2, y: 0.205 };
