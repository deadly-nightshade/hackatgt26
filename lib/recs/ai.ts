import { chatJson } from "@/lib/ai/chat";
import { config, CHAT_MODEL } from "@/lib/config";
import { heuristicAnalysis } from "@/lib/meet/ai";
import { toJsonSchema } from "@/lib/meet/schema";
import type { Profile } from "@/lib/profile/schema";
import { buildRecsUserPrompt, candidateView, meView, RECS_SYSTEM_PROMPT } from "@/lib/recs/prompt";
import { RecOutputSchema, type RecOutput } from "@/lib/recs/schema";
import { templateTeaser } from "@/lib/recs/validate";
import { log } from "@/lib/util/log";

export type RecCandidate = { candidateId: string; profile: Profile };

/** The model step of recommendations. Output is validated/ranked by validateRecs afterwards. */
export interface RecsAI {
  readonly model: string;
  recommend(me: Profile, candidates: RecCandidate[]): Promise<RecOutput>;
}

const recJsonSchema = toJsonSchema(RecOutputSchema);

/** One Muse Spark call (+ one retry if the JSON doesn't parse). Throws on failure → the service falls back. */
export class MuseRecsAI implements RecsAI {
  readonly model = CHAT_MODEL;

  async recommend(me: Profile, candidates: RecCandidate[]): Promise<RecOutput> {
    const messages = [
      { role: "system" as const, content: RECS_SYSTEM_PROMPT },
      { role: "user" as const, content: buildRecsUserPrompt(meView(me), candidates.map((c) => ({ candidateId: c.candidateId, view: candidateView(c.profile) }))) },
    ];
    const call = (route: string) =>
      chatJson({ route, messages, schemaName: "fish_recommendations", schema: recJsonSchema, maxTokens: 6000, temperature: 0.5, reasoningEffort: "low" });
    for (const route of ["recs", "recs-retry"]) {
      try {
        return RecOutputSchema.parse(JSON.parse(await call(route)));
      } catch (err) {
        log("recs", `${route} failed: ${(err as Error).message}`);
      }
    }
    throw new Error("recommendation call failed after retry");
  }
}

/** Exact tag overlap only (+ exact bridges), template teasers. The AI-failure fallback; zero AI calls. */
export function exactOverlapRecs(me: Profile, candidates: RecCandidate[]): RecOutput {
  return overlapRecs(me, candidates, false);
}

function overlapRecs(me: Profile, candidates: RecCandidate[], fuzzy: boolean): RecOutput {
  const suggestions = candidates.flatMap((c) => {
    const a = heuristicAnalysis(me, c.profile, { fuzzy });
    const shared = a.sharedInterests.filter((s) => s.strength !== "stretch");
    if (!shared.length && !a.bridges.length) return [];
    return [
      {
        candidateId: c.candidateId,
        sharedInterests: shared.map((s) => ({ aTag: s.aTag, bTag: s.bTag, label: s.label, strength: s.strength as "same" | "close" | "loose" })),
        bridges: a.bridges.map((b) => ({
          fromUser: b.fromUser === "a" ? ("me" as const) : ("them" as const),
          wantsToTryTag: b.wantsToTryTag,
          matchedInterestTag: b.matchedInterestTag,
          label: "",
        })),
        teaser: templateTeaser(shared[0]?.label ?? a.bridges[0].label),
      },
    ];
  });
  return { suggestions };
}

/**
 * AI_MODE=mock: canned suggestions from word/category overlap with the real candidate pool
 * (template teasers). Zero AI calls; returns none when nobody overlaps (the empty state).
 */
export class MockRecsAI implements RecsAI {
  readonly model = "mock";
  async recommend(me: Profile, candidates: RecCandidate[]): Promise<RecOutput> {
    const canned = ["Ask what they're playing lately.", "Compare notes next time you're at the market.", "Swap recommendations — they'll have opinions."];
    const out = overlapRecs(me, candidates, true);
    return { suggestions: out.suggestions.map((s, i) => ({ ...s, teaser: canned[i % canned.length] })) };
  }
}

export function getRecsAI(): RecsAI {
  return config.aiMode() === "live" ? new MuseRecsAI() : new MockRecsAI();
}
