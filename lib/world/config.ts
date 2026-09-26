/** Every tunable for /world. Coordinates are normalized 0..1 in the (square) background image. */

export const WORLD_BG = { src: "/art/world/BackgroundTemp.png", width: 2048, height: 2048 } as const;
/** Default fish sprite (native art faces LEFT). */
export const FISH_SPRITE = { src: "/art/fish/fih_base.PNG", width: 2048, height: 2330 } as const;

/** Colors at the image's top/bottom edges, for letterboxing around the fitted world. */
export const WORLD_COLORS = { sky: "#7dc7eb", sea: "#5d87bf" } as const;

export type Area = { minX: number; maxX: number; minY: number; maxY: number };

/** Where a fish's FEET may be: the boardwalk below the stalls down to the waterline. */
export const WALKABLE: Area = { minX: 0.08, maxX: 0.92, minY: 0.4, maxY: 0.83 };

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
} as const;
