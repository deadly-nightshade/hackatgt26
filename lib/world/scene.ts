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
};

const S = (px: number) => px / SCENE_PX;

/** Place native-size art (w×h px after cropping) with its top-left at normalized (x, y). */
function place(x: number, y: number, w: number, h: number, scale = 1): Area {
  return { minX: x, minY: y, maxX: x + S(w * scale), maxY: y + S(h * scale) };
}

/** Area from raw-canvas pixels (for things that keep their painted position). */
const pxRect = (l: number, t: number, w: number, h: number): Area => ({ minX: S(l), minY: S(t), maxX: S(l + w), maxY: S(t + h) });

/** Normalized rect from centre + size in raw-canvas px. */
const around = (cx: number, cy: number, w: number, h: number): Area => ({
  minX: cx - S(w / 2),
  minY: cy - S(h / 2),
  maxX: cx + S(w / 2),
  maxY: cy + S(h / 2),
});

// Cropped art sizes (px) — printed by `npm run build:scene`.
const ART = {
  ocean: [2048, 349],
  booth1: [744, 433],
  booth2: [537, 459],
  picnic: [766, 568],
  bucket: [279, 180],
  sandcastle: [251, 151],
  seagull: [199, 150],
} as const;

const DIR = "/world/scene";
const PROPS_DIR = "/world/props";

/** Flattened sky band + sand + dock + seashells (full scene, no alpha). */
export const SCENE_BASE = { src: `${DIR}/base.jpg`, strip: `${DIR}/strip.jpg` } as const;

// ── static props ────────────────────────────────────────────────────────────

const BOOTH1_SCALE = 0.85;
export const BOOTH1 = place(0.674, 0.054, ...ART.booth1, BOOTH1_SCALE);
export const BOOTH2 = place(0.371, 0.02, ...ART.booth2);
export const PICNIC = place(0.576, 0.303, ...ART.picnic);
export const BUCKET = place(0.708, 0.684, ...ART.bucket);
export const SANDCASTLE = place(0.552, 0.696, ...ART.sandcastle);
export const SEAGULL = place(0.161, 0.566, ...ART.seagull);
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
  { id: "booth2", label: "booth 2", src: [`${DIR}/booth2.png`], rect: BOOTH2, layer: "sort" },
  { id: "booth1", label: "booth 1", src: [`${DIR}/booth1.png`], rect: BOOTH1, layer: "sort" },
  { id: "picnic", label: "picnic table", src: [`${DIR}/picnic-table.png`], rect: PICNIC, layer: "sort" },
  { id: "bucket", label: "bucket & shovel", src: [`${DIR}/bucket-shovel.png`], rect: BUCKET, layer: "sort" },
  { id: "seagull", label: "seagull", src: [`${DIR}/seagull.png`], rect: SEAGULL, layer: "sort", hops: true },

  // ── spawnable items (hidden until an activity shows them) ──
  { id: "sandcastle", label: "sandcastle", src: [`${DIR}/sandcastle.png`], rect: SANDCASTLE, layer: "sort", item: true },
  // Booth items sit on the counter top and must cover the fish standing behind it.
  { id: "booth1-items", label: "booth1 items", src: [`${PROPS_DIR}/booth1-items.png`], rect: around(0.828, 0.17, 360, 60), layer: "sort", baseY: BOOTH1.maxY + 0.001, item: true },
  { id: "booth2-items", label: "booth2 items", src: [`${PROPS_DIR}/booth2-items.png`], rect: around(0.502, 0.165, 330, 60), layer: "sort", baseY: BOOTH2.maxY + 0.001, item: true },
  // Above the seated fish (who are drawn over the table).
  { id: "icecream", label: "ice cream", src: [`${PROPS_DIR}/icecream.png`], rect: around(0.78, 0.4, 180, 110), layer: "sort", baseY: PICNIC.maxY + 0.004, item: true },
  { id: "fries", label: "fries", src: [`${PROPS_DIR}/fries.png`], rect: around(0.274, 0.622, 90, 80), layer: "sort", item: true },
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
  { id: "picnic", minX: PICNIC.minX + 0.01, minY: 0.45, maxX: PICNIC.maxX - 0.01, maxY: PICNIC.maxY + 0.005 },
  { id: "seagull", minX: SEAGULL.minX, minY: SEAGULL.maxY - 0.035, maxX: SEAGULL.maxX, maxY: SEAGULL.maxY + 0.005 },
  { id: "sandcastle", minX: SANDCASTLE.minX - 0.01, minY: 0.725, maxX: BUCKET.maxX + 0.005, maxY: 0.778 },
];

/** Gap between the two stalls: the way in/out behind both counters. */
export const STALL_GAP: Pt = { x: (BOOTH2.maxX + BOOTH1.minX) / 2, y: 0.205 };
