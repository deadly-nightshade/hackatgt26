import { createHash } from "node:crypto";
import type { Profile } from "@/lib/profile/schema";
import { exactOverlapRecs, type RecCandidate, type RecsAI } from "@/lib/recs/ai";
import { prefilterCandidates } from "@/lib/recs/prompt";
import {
  REC_MAX,
  REC_PROMPT_VERSION,
  recsConfig,
  type RecFish,
  type RecommendationDoc,
  type RecommendationsResponse,
  type StoredRec,
} from "@/lib/recs/schema";
import { validateRecs } from "@/lib/recs/validate";
import type { PairRepository } from "@/lib/storage/pairRepo";
import type { ProfileRepository, StoredProfile } from "@/lib/storage/profileRepo";
import type { RecommendationRepository } from "@/lib/storage/recRepo";
import { HttpError, log } from "@/lib/util/log";
import { getResidentsFor } from "@/lib/world/server";

export type RecDeps = {
  profiles: ProfileRepository;
  pairs: PairRepository;
  recs: RecommendationRepository;
  ai: RecsAI;
  now?: () => Date;
};

export type RecRunInfo = { fromCache: boolean; aiCalled: boolean; source: RecommendationDoc["source"] | "none"; reason: string; poolSize: number };

/**
 * THE candidate rule: discoverable, not me, and not met yet (no pair with a
 * non-cooldown attempt — the same "met" rule the island uses). No seed logic.
 */
export async function getCandidates(me: StoredProfile, deps: Pick<RecDeps, "profiles" | "pairs">): Promise<StoredProfile[]> {
  const [list, { residents }] = await Promise.all([deps.profiles.list(), getResidentsFor(me.id, deps)]);
  const met = new Set(residents.map((r) => r.id));
  const ids = list.filter((u) => u.discoverable && u.id !== me.id && !met.has(u.id)).map((u) => u.id);
  const profiles = await Promise.all(ids.map((id) => deps.profiles.get(id)));
  return profiles.filter((p): p is StoredProfile => !!p && p.discoverable);
}

/** Changes when someone joins/leaves the pool or edits their matching fields. */
export function poolHash(pool: StoredProfile[]): string {
  const key = pool
    .map((p) => `${p.id}@${p.contentUpdatedAt.toISOString()}`)
    .sort()
    .join("|");
  return createHash("sha1").update(key).digest("hex");
}

const today = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Recommendations for `userId` (max 3). Reciprocal: only discoverable users see any.
 * Recomputes (1 AI call) only when the pool or the user's own interests changed AND the last
 * run is older than the refresh window, within the daily budget. Otherwise serves the cache,
 * dropping anyone met since / no longer discoverable. `force` skips the refresh window (CLI).
 */
export async function getRecommendations(
  userId: string,
  deps: RecDeps,
  opts: { force?: boolean } = {},
): Promise<{ response: RecommendationsResponse; info: RecRunInfo }> {
  const now = (deps.now ?? (() => new Date()))();
  const me = await deps.profiles.get(userId);
  if (!me) throw new HttpError(404, "No fish with that id");
  if (!me.discoverable) {
    return { response: { enabled: false, fish: [] }, info: { fromCache: false, aiCalled: false, source: "none", reason: "not discoverable", poolSize: 0 } };
  }

  const pool = await getCandidates(me, deps);
  const byId = new Map(pool.map((p) => [p.id, p]));
  const hash = poolHash(pool);
  const cached = await deps.recs.get(userId);

  const changed =
    !cached ||
    cached.promptVersion !== REC_PROMPT_VERSION ||
    cached.candidatePoolHash !== hash ||
    cached.userContentUpdatedAt !== me.contentUpdatedAt.toISOString();
  const windowPassed = !cached || now.getTime() - new Date(cached.createdAt).getTime() >= recsConfig.minRefreshMs();
  // The refresh window only protects AI spend: if the last run made no AI call (empty pool,
  // fallback, mock), pick up changes right away — e.g. someone just opted in.
  const lastRunWasFree = !!cached && cached.source !== "ai";
  const callsToday = cached?.calls.day === today(now) ? cached.calls.count : 0;
  const budgetLeft = callsToday < recsConfig.callsPerUserPerDay();

  if (cached && !(changed && (windowPassed || lastRunWasFree || opts.force))) {
    const reason = !changed ? "nothing changed" : "changed, but inside the refresh window";
    return { response: toResponse(cached.results, byId), info: { fromCache: true, aiCalled: false, source: cached.source, reason, poolSize: pool.length } };
  }

  // Compute. Nobody to suggest → no AI call at all.
  let results: StoredRec[] = [];
  // "fallback" also covers "nobody to suggest" (no AI call) — see lastRunWasFree.
  let source: RecommendationDoc["source"] = "fallback";
  let aiCalled = false;
  const candidates: RecCandidate[] = prefilterCandidates(
    me.profile,
    pool.map((p) => ({ candidateId: p.id, profile: p.profile })),
    recsConfig.maxCandidatesInPrompt(),
  );
  const poolProfiles = new Map<string, Profile>(candidates.map((c) => [c.candidateId, c.profile]));
  if (candidates.length) {
    let output = null;
    if (budgetLeft) {
      aiCalled = deps.ai.model !== "mock";
      try {
        output = await deps.ai.recommend(me.profile, candidates);
        source = deps.ai.model === "mock" ? "mock" : "ai";
      } catch (err) {
        log("recs", `AI failed for ${userId}, exact-overlap fallback: ${(err as Error).message}`);
      }
    } else {
      log("recs", `daily budget reached for ${userId} (${callsToday}), exact-overlap fallback`);
    }
    const validated = validateRecs(output ?? exactOverlapRecs(me.profile, candidates), me.profile, poolProfiles);
    if (validated.dropped.length) log("recs", `dropped ${validated.dropped.length} item(s)`, { dropped: validated.dropped });
    results = validated.recs;
  }

  await deps.recs.save({
    userId,
    results,
    candidatePoolHash: hash,
    promptVersion: REC_PROMPT_VERSION,
    userContentUpdatedAt: me.contentUpdatedAt.toISOString(),
    createdAt: now.toISOString(),
    calls: { day: today(now), count: callsToday + (aiCalled ? 1 : 0) },
    source,
  });
  log("recs", `${userId}: ${results.length} suggestion(s) from ${pool.length} candidate(s)`, { source, aiCalled });
  return {
    response: toResponse(results, byId),
    info: { fromCache: false, aiCalled, source, reason: cached ? "recomputed" : "first run", poolSize: pool.length },
  };
}

/** Client shape: names/looks fresh from the pool, ONLY what's shared, never the score. */
function toResponse(results: StoredRec[], pool: Map<string, StoredProfile>): RecommendationsResponse {
  const fish: RecFish[] = results
    .filter((r) => pool.has(r.candidateId)) // met since, or no longer discoverable
    .slice(0, REC_MAX)
    .map((r) => {
      const p = pool.get(r.candidateId)!;
      return {
        id: p.id,
        displayName: p.profile.displayName,
        appearance: p.appearance,
        sharedInterests: r.sharedInterests.map(({ label }) => ({ label })),
        bridges: r.bridges.map(({ label }) => ({ label })),
        teaser: r.teaser,
      };
    });
  return { enabled: true, fish };
}
