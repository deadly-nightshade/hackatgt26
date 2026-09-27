import { FISH_BASE } from "@/lib/fish/appearance";

/** Every tunable for /world. Coordinates are normalized 0..1 in the (square) background image. */

export const WORLD_BG = { src: "/art/world/BackgroundTemp.png", width: 2048, height: 2048 } as const;
/** Fish sprite box (native art faces LEFT); accessories overlay it 1:1 (lib/fish/appearance.ts). */
export const FISH_SPRITE = FISH_BASE;

/** Exact colors at the scene's top/bottom edges (rgb(125,199,235) / rgb(93,135,191)), for the blocks above/below it. */
export const WORLD_COLORS = { sky: "#7dc7eb", sea: "#5d87bf" } as const;

export type Area = { minX: number; maxX: number; minY: number; maxY: number };

/** Where a fish's FEET may wander: the boardwalk in front of the stalls down to the waterline (props are cut out by scene BLOCKED). */
export const WALKABLE: Area = { minX: 0.04, maxX: 0.96, minY: 0.27, maxY: 0.83 };

/**
 * Page framing: the scene fits the viewport width (or height on landscape screens);
 * of the leftover height, this share goes to the sky block above, the rest to the ocean below.
 */
export const FRAMING = { SKY_SHARE: 0.38 } as const;

export const WORLD = {
  /** Fish sprite width as a fraction of the world width. */
  FISH_WIDTH: 0.12,
  /** Fish further back (smaller y) are drawn a bit smaller. */
  DEPTH_SCALE: [0.85, 1.1] as [number, number],
  /** World widths per second. */
  WALK_SPEED: 0.07,
  /** ± fraction of WALK_SPEED per fish. */
  SPEED_JITTER: 0.25,
  SWIM_OVER_SPEED_FACTOR: 1.8,
  PAUSE_MS: [1000, 3000] as [number, number],
  /** Stagger at spawn so fish don't all bump the instant the page loads. */
  SPAWN_COOLDOWN_MS: [1500, 5000] as [number, number],
  /** Just over a body width (FISH_WIDTH), so bumping fish stand side by side instead of overlapping. */
  BUMP_DISTANCE: 0.13,
  /** Vertical distance counts more (fish on different "rows" shouldn't bump). */
  BUMP_Y_WEIGHT: 1.6,
  BUMP_COOLDOWN_MS: 8000,
  MAX_CONCURRENT_BUMPS: 2,
  BUBBLE_MS: 1200,
  SECOND_EXCHANGE_CHANCE: 0.5,
  BUMP_END_PAUSE_MS: 600,
  /** Clamp frame gaps (tab switches, jank) so fish never teleport. */
  MAX_DT_MS: 50,
  REDUCED_MOTION: { PAUSE_MS: [6000, 14000] as [number, number], WANDER_RADIUS: 0.05, SPEED_FACTOR: 0.5 },

  // ── activities (lib/world/activities.ts) ──
  /** Chance a fish picks an activity (weighted) instead of a random spot when it moves on. */
  ACTIVITY_CHANCE: 0.3,
  /** Show/hide animation for activity items (fade + pop). */
  ITEM_FADE_MS: 350,
  /** A fish that can't reach its anchor in this long gives up. */
  ARRIVE_TIMEOUT_MS: 15000,
  /** How long activity bubbles ("help me build!") stay up. */
  SAY_MS: 1600,
  /** No random bumps right after leaving an activity. */
  AFTER_ACTIVITY_COOLDOWN_MS: 3000,
  /** A summoned helper hurries over (× its walk speed). */
  HELPER_SPEED_FACTOR: 1.6,
  /** Helper choice: a friend's distance counts × this (prefer friends, but not ones across the map). */
  FRIEND_DISTANCE_FACTOR: 0.6,
  /** Cooldown after a user "Swim over" interrupts an activity. */
  INTERRUPT_COOLDOWN_MS: 4000,
} as const;

/**
 * DEMO_MODE (?demo=1 or NEXT_PUBLIC_WORLD_DEMO=1): everything happens sooner, so every
 * interaction shows up within ~30s of opening the world (for recording).
 */
export const DEMO = {
  ACTIVITY_CHANCE: 0.75,
  PAUSE_MS: [400, 1200] as [number, number],
  /** Multipliers on each activity's dwell/trigger/cooldown times. */
  DWELL: 0.6,
  TRIGGER: 0.6,
  COOLDOWN: 0.25,
  PERSIST_MS: 3000,
  /** Weight multiplier for activities that haven't happened yet. */
  UNTRIED_BOOST: 10,
} as const;
