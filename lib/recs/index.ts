import { getRecsAI } from "@/lib/recs/ai";
import type { RecDeps } from "@/lib/recs/service";
import { getPairRepository, getProfileRepository, getRecommendationRepository } from "@/lib/storage";

/** Real dependencies for recommendations (env-selected storage + AI_MODE). */
export function defaultRecDeps(): RecDeps {
  return { profiles: getProfileRepository(), pairs: getPairRepository(), recs: getRecommendationRepository(), ai: getRecsAI() };
}
