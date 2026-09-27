import { SCORE } from "@/lib/meet/config";
import type { Analysis } from "@/lib/meet/schema";
import type { SocialStyle } from "@/lib/profile/schema";

/**
 * Energy "matches" only when BOTH are known, equal, and not the hedging middle ("balanced").
 * Nulls never match. This (not the model) decides styleNotes.energyMatch.
 */
export function energyMatches(a: Pick<SocialStyle, "energy">, b: Pick<SocialStyle, "energy">): boolean {
  return !!a.energy && a.energy === b.energy && a.energy !== "balanced";
}

/**
 * Validated analysis → similarity in [0, 1].
 * same=3, close=2, loose=1, stretch=0.5 per shared interest (capped at 9),
 * +3 per bridge (capped at 6), +1 if energy matches; divided by 10.
 */
export function scoreAnalysis(analysis: Pick<Analysis, "sharedInterests" | "bridges" | "styleNotes">): number {
  const interestPoints = Math.min(
    analysis.sharedInterests.reduce((sum, s) => sum + SCORE.STRENGTH_POINTS[s.strength], 0),
    SCORE.INTEREST_CAP,
  );
  const bridgePoints = Math.min(analysis.bridges.length * SCORE.BRIDGE_POINTS, SCORE.BRIDGE_CAP);
  const energyPoints = analysis.styleNotes.energyMatch ? SCORE.ENERGY_MATCH : 0;
  return Math.min((interestPoints + bridgePoints + energyPoints) / SCORE.DIVISOR, 1);
}
