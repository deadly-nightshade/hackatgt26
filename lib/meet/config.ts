/** Every tunable for meet-ups lives here. Env reads are functions so scripts can load .env first. */

/** Bump when the analysis/dialogue prompts change: invalidates every cached pair. */
export const PROMPT_VERSION = "meet-1";

// ── Roll (lib/meet/roll.ts) ──────────────────────────────────────────────
export const ROLL = {
  BASE_FAIL: 0.05,
  SIM_FAIL: 0.35,
  MIN_FAIL: 0.05,
  MAX_FAIL: 0.4,
  /** pFail is multiplied by this per failed attempt since the last success. */
  PITY_FACTOR: 0.5,
} as const;

// ── Score (lib/meet/score.ts) ────────────────────────────────────────────
export const SCORE = {
  STRENGTH_POINTS: { same: 3, close: 2, loose: 1, stretch: 0.5 },
  INTEREST_CAP: 9,
  BRIDGE_POINTS: 3,
  BRIDGE_CAP: 6,
  ENERGY_MATCH: 1,
  DIVISOR: 10,
} as const;

// ── Dialogue ─────────────────────────────────────────────────────────────
export const MIDDLE_LINES = { min: 3, max: 6 } as const;
export const SCENE_LINES = { min: 4, max: 6 } as const;
export const SCENES_PER_BATCH = 3;

// ── Stretch: hangouts + friendship levels ────────────────────────────────
/** `hangouts` = hangout count needed to reach that level. */
export const LEVELS = [
  { level: 1, name: "Friends", hangouts: 0 },
  { level: 2, name: "Good Friends", hangouts: 1 },
  { level: 3, name: "Close Friends", hangouts: 3 },
  { level: 4, name: "Best Fishes", hangouts: 6 },
] as const;

export function levelFor(hangoutCount: number): number {
  let level: number = LEVELS[0].level;
  for (const l of LEVELS) if (hangoutCount >= l.hangouts) level = l.level;
  return level;
}

export function levelName(level: number): string {
  return LEVELS.find((l) => l.level === level)?.name ?? LEVELS[0].name;
}

export type ForcedOutcome = "friends" | "clammed_up";

export const meetConfig = {
  isProduction(): boolean {
    return process.env.NODE_ENV === "production";
  },
  demoMode(): boolean {
    return ["1", "true", "yes", "on"].includes((process.env.DEMO_MODE ?? "").toLowerCase());
  },
  /** Dev-only tools: ?regenerate=1, response debug, /dev pages. */
  devTools(): boolean {
    return !meetConfig.isProduction();
  },
  /** /dev/whoami: always in dev; in production only with ENABLE_WHOAMI=true (lists every fish + lets you switch identity). */
  whoamiEnabled(): boolean {
    return meetConfig.devTools() || ["1", "true", "yes", "on"].includes((process.env.ENABLE_WHOAMI ?? "").toLowerCase());
  },
  /** FORCE_MEET_OUTCOME, honored only outside production or with DEMO_MODE=true. */
  forcedOutcome(): ForcedOutcome | null {
    const v = process.env.FORCE_MEET_OUTCOME;
    if (v !== "friends" && v !== "clammed_up") return null;
    return !meetConfig.isProduction() || meetConfig.demoMode() ? v : null;
  },
  /** Re-taps between friends count as hangouts (stretch). Off → always "already_friends". */
  hangoutsEnabled(): boolean {
    const v = (process.env.MEET_HANGOUTS ?? "true").toLowerCase();
    return !["0", "false", "no", "off"].includes(v);
  },
  hangoutCooldownMs(): number {
    const raw = Number(process.env.HANGOUT_COOLDOWN_MINUTES);
    const minutes = Number.isFinite(raw) && raw >= 0 && process.env.HANGOUT_COOLDOWN_MINUTES ? raw : 60;
    return minutes * 60_000;
  },
};
