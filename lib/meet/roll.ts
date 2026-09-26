import { ROLL } from "@/lib/meet/config";

export type RollResult = { outcome: "friends" | "clammed_up"; pFail: number; roll: number };

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

/**
 * Chance the fish clam up: lower similarity → higher, capped at MAX_FAIL.
 * Pity halves it for every failed attempt since the pair's last success.
 */
export function failChance(similarity: number, failsSinceSuccess: number): number {
  const base = clamp(ROLL.BASE_FAIL + ROLL.SIM_FAIL * (1 - clamp(similarity, 0, 1)), ROLL.MIN_FAIL, ROLL.MAX_FAIL);
  return base * ROLL.PITY_FACTOR ** Math.max(0, failsSinceSuccess);
}

/** Pure given `random` (inject a seeded RNG in tests). */
export function rollMeet(opts: {
  similarity: number;
  failsSinceSuccess: number;
  random?: () => number;
  forced?: "friends" | "clammed_up" | null;
}): RollResult {
  const pFail = failChance(opts.similarity, opts.failsSinceSuccess);
  const roll = (opts.random ?? Math.random)();
  const outcome = opts.forced ?? (roll < pFail ? "clammed_up" : "friends");
  return { outcome, pFail, roll };
}
