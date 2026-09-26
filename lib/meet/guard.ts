import type { Analysis } from "@/lib/meet/schema";
import type { Profile } from "@/lib/profile/schema";
import { toTag } from "@/lib/profile/schema";

export type GuardResult = { analysis: Analysis; dropped: string[] };

const interestTags = (p: Profile) => new Set(p.interests.map((i) => i.tag));
const wantTags = (p: Profile) => new Set(p.wantsToTry.map((w) => w.tag));

/**
 * Hallucination guard: drop every shared interest / bridge that cites a tag
 * which doesn't exist in the correct fish's profile. Tags are re-normalized
 * first so harmless formatting drift ("Honkai Star Rail") still matches.
 */
export function guardAnalysis(analysis: Analysis, a: Profile, b: Profile): GuardResult {
  const dropped: string[] = [];
  const aInt = interestTags(a);
  const bInt = interestTags(b);
  const want = { a: wantTags(a), b: wantTags(b) };
  const other = { a: bInt, b: aInt };

  const sharedInterests = analysis.sharedInterests
    .map((s) => ({ ...s, aTag: toTag(s.aTag), bTag: toTag(s.bTag) }))
    .filter((s) => {
      const ok = aInt.has(s.aTag) && bInt.has(s.bTag);
      if (!ok) dropped.push(`sharedInterest "${s.label}" (aTag=${s.aTag}, bTag=${s.bTag})`);
      return ok;
    });

  const bridges = analysis.bridges
    .map((br) => ({ ...br, wantsToTryTag: toTag(br.wantsToTryTag), matchedInterestTag: toTag(br.matchedInterestTag) }))
    .filter((br) => {
      const ok = want[br.fromUser].has(br.wantsToTryTag) && other[br.fromUser].has(br.matchedInterestTag);
      if (!ok) dropped.push(`bridge "${br.label}" (from=${br.fromUser}, want=${br.wantsToTryTag}, match=${br.matchedInterestTag})`);
      return ok;
    });

  return { analysis: { ...analysis, sharedInterests: dedupe(sharedInterests), bridges }, dropped };
}

function dedupe<T extends { aTag: string; bTag: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = `${i.aTag}|${i.bTag}`;
    return !seen.has(k) && !!seen.add(k);
  });
}

export const hasConnection = (a: Pick<Analysis, "sharedInterests" | "bridges">) =>
  a.sharedInterests.length + a.bridges.length > 0;
