import type { Profile } from "@/lib/profile/schema";
import { REC_MAX, REC_TEXT_MAX_WORDS } from "@/lib/recs/schema";

/**
 * The one recommendation call per user. The model only ever sees interests and
 * wantsToTry — no names, summaries, raw answers or traits (candidates are ids).
 */

export type RecView = { interests: { name: string; category?: string; tag: string }[]; wantsToTry: { name: string; tag: string }[] };

export const meView = (p: Profile): RecView => ({
  interests: p.interests.map(({ name, category, tag }) => ({ name, category, tag })),
  wantsToTry: p.wantsToTry.map(({ name, tag }) => ({ name, tag })),
});

export const candidateView = (p: Profile): RecView => ({
  interests: p.interests.map(({ name, tag }) => ({ name, tag })),
  wantsToTry: p.wantsToTry.map(({ name, tag }) => ({ name, tag })),
});

export const RECS_SYSTEM_PROMPT = `You suggest people a user might enjoy meeting IN PERSON. Friendly, like a classmate saying "oh you should talk to them" — never romantic or dating-like.

Input: ME (interests, wantsToTry) and CANDIDATES (id, interests, wantsToTry).
Return UP TO ${REC_MAX} candidates, best first. Return fewer — or none — if nobody shares something real. Never pad the list.

For each candidate:
- sharedInterests: real overlaps only (same / close / loose). Semantic matches are fine ("honkai-star-rail" ~ "gacha-games"). No stretches. aTag comes from ME's interests, bTag from the candidate's interests.
- bridges: where one person's wantsToTry matches the other's interest (either direction). fromUser "me" = I want to try it and they do it; "them" = they want to try it and I do it. label ≤ ${REC_TEXT_MAX_WORDS} words, second person, e.g. "They play Valorant — you've wanted to try it!"
- teaser: ONE line, ≤ ${REC_TEXT_MAX_WORDS} words, about a specific shared thing. Playful, concrete, may suggest a tiny opener. No names, no comments on personality or looks, no "perfect match", no "cozy" unless I said it, nothing about beds, dates or romance.

Every item must cite real tags from the correct person's profile (copy them exactly).

Good teasers:
- "Also does the daily Mini Cryptic — compare streaks?"
- "Another NYT games person. Brace for Connections debates."
- "Knows the good skewer stall. Ask them."
Bad teasers:
- "You two would be perfect together!" (dating-like)
- "A cozy soul who loves games!" (vibe word, personality comment)
- "Seems like a very kind person" (judges personality, nothing shared)

Return ONLY a JSON object matching the schema.`;

export function buildRecsUserPrompt(me: RecView, candidates: { candidateId: string; view: RecView }[]): string {
  return [
    `ME:\n${JSON.stringify(me)}`,
    `CANDIDATES:\n${candidates.map((c) => JSON.stringify({ id: c.candidateId, ...c.view })).join("\n")}`,
    `Pick up to ${REC_MAX}, best first. Fewer or none is fine.`,
  ].join("\n\n");
}

/**
 * Too many candidates for one prompt → keep the ones with the most tag/category overlap
 * with ME (a cheap prefilter; the model does the real matching).
 */
export function prefilterCandidates<T extends { profile: Profile }>(me: Profile, candidates: T[], max: number): T[] {
  if (candidates.length <= max) return candidates;
  const tags = new Set([...me.interests.map((i) => i.tag), ...me.wantsToTry.map((w) => w.tag)]);
  const cats = new Set(me.interests.map((i) => i.category));
  const overlap = (p: Profile) =>
    p.interests.reduce((n, i) => n + (tags.has(i.tag) ? 3 : 0) + (cats.has(i.category) ? 1 : 0), 0) +
    p.wantsToTry.reduce((n, w) => n + (tags.has(w.tag) ? 3 : 0), 0);
  return [...candidates].sort((x, y) => overlap(y.profile) - overlap(x.profile)).slice(0, max);
}
