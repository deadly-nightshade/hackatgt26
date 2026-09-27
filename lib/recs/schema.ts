import { z } from "zod";
import type { Appearance } from "@/lib/fish/appearance";

/** "Find fish" recommendations — shared types. The API types are safe for client components. */

export const REC_MAX = 3;
/** Teasers and labels: at most this many words (longer → template). */
export const REC_TEXT_MAX_WORDS = 12;
/** Bump when the recommendation prompt/validation changes (cached results recompute lazily). */
export const REC_PROMPT_VERSION = "recs-1";

export const recsConfig = {
  maxCandidatesInPrompt: () => num("MAX_CANDIDATES_IN_PROMPT", 150),
  minRefreshMs: () => num("REC_MIN_REFRESH_MINUTES", 30) * 60_000,
  callsPerUserPerDay: () => num("REC_CALLS_PER_USER_PER_DAY", 5),
};
function num(env: string, fallback: number): number {
  const raw = Number(process.env[env]);
  return process.env[env] && Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

// ── model output (structured) ───────────────────────────────────────────────

export const RecOutputSchema = z.object({
  suggestions: z
    .array(
      z.object({
        candidateId: z.string(),
        sharedInterests: z.array(
          z.object({ aTag: z.string(), bTag: z.string(), label: z.string(), strength: z.enum(["same", "close", "loose"]) }),
        ),
        bridges: z.array(
          z.object({ fromUser: z.enum(["me", "them"]), wantsToTryTag: z.string(), matchedInterestTag: z.string(), label: z.string() }),
        ),
        teaser: z.string(),
      }),
    )
    .describe(`up to ${REC_MAX} suggestions, best first; fewer or none if nobody shares something real`),
});
export type RecOutput = z.infer<typeof RecOutputSchema>;

// ── stored (server only; includes the ranking score) ────────────────────────

export type StoredRec = {
  candidateId: string;
  sharedInterests: { label: string; aTag: string; bTag: string; strength: "same" | "close" | "loose" }[];
  bridges: { label: string; fromUser: "me" | "them"; wantsToTryTag: string; matchedInterestTag: string }[];
  teaser: string;
  /** Ordering only — NEVER sent to the client. */
  score: number;
};

export type RecommendationDoc = {
  userId: string;
  results: StoredRec[];
  candidatePoolHash: string;
  promptVersion: string;
  /** The user's contentUpdatedAt when computed (their interests changed → recompute). */
  userContentUpdatedAt: string;
  createdAt: string;
  /** Daily AI budget. */
  calls: { day: string; count: number };
  /** "ai" | "fallback" (exact overlap, template teasers) | "mock". */
  source: "ai" | "fallback" | "mock";
};

// ── API (client-safe) ───────────────────────────────────────────────────────

export type RecFish = {
  id: string;
  displayName: string;
  appearance: Appearance;
  sharedInterests: { label: string }[];
  bridges: { label: string }[];
  teaser: string;
};

export type RecommendationsResponse = { enabled: boolean; fish: RecFish[] };
