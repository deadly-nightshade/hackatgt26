import { saysCozy, toneProblem } from "@/lib/ai/tone";
import { guardAnalysis } from "@/lib/meet/guard";
import type { Analysis } from "@/lib/meet/schema";
import { energyMatches, scoreAnalysis } from "@/lib/meet/score";
import type { Profile } from "@/lib/profile/schema";
import { REC_MAX, REC_TEXT_MAX_WORDS, type RecOutput, type StoredRec } from "@/lib/recs/schema";
import { shortLabel } from "@/lib/world/bumps";

/**
 * Model (or fallback/mock) suggestions → safe, ranked StoredRecs:
 * 1. hallucination guard (same as meets): drop items citing tags the right person doesn't have;
 *    drop candidates with nothing left,
 * 2. text checks: labels/teasers over 12 words or with banned words → templates,
 * 3. rank with score.ts (order only), keep REC_MAX.
 */

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const PERFECT_MATCH = /\bperfect\s+(match|pair|couple)\b/i;

/** "cozy" is only OK if the user themself said it (their evidence quotes are near-verbatim answers). */
export function userSaysCozy(me: Profile): boolean {
  return saysCozy([
    ...me.interests.map((i) => i.evidence),
    ...me.wantsToTry.map((w) => w.evidence),
    me.socialStyle.energyEvidence,
    me.socialStyle.groupSizeEvidence,
    me.socialStyle.planningEvidence,
  ]);
}

/** A label/teaser is OK if short and free of banned words. */
export function recTextOk(text: string, allowCozy: boolean): boolean {
  const t = text.trim();
  return !!t && words(t) <= REC_TEXT_MAX_WORDS && !PERFECT_MATCH.test(t) && !toneProblem(t, { allowCozy });
}

const nameOf = (p: Profile, tag: string) =>
  p.interests.find((i) => i.tag === tag)?.name ?? p.wantsToTry.find((w) => w.tag === tag)?.name ?? tag.replace(/-/g, " ");

export const templateTeaser = (label: string) => `You both like ${shortLabel(label)}!`;

export function validateRecs(
  output: RecOutput,
  me: Profile,
  pool: Map<string, Profile>,
): { recs: StoredRec[]; dropped: string[] } {
  const allowCozy = userSaysCozy(me);
  const dropped: string[] = [];
  const seen = new Set<string>();
  const recs: StoredRec[] = [];

  for (const s of output.suggestions) {
    const them = pool.get(s.candidateId);
    if (!them || seen.has(s.candidateId)) {
      dropped.push(`candidate ${s.candidateId} (${them ? "duplicate" : "not in the pool"})`);
      continue;
    }
    seen.add(s.candidateId);

    // Reuse the meet guard: me = a, them = b.
    const analysis: Analysis = {
      sharedInterests: s.sharedInterests.map((x) => ({ ...x, why: "" })),
      bridges: s.bridges.map((b) => ({ ...b, fromUser: b.fromUser === "me" ? ("a" as const) : ("b" as const) })),
      styleNotes: { energyMatch: energyMatches(me.socialStyle, them.socialStyle), note: "" },
      spotlight: "",
    };
    const guarded = guardAnalysis(analysis, me, them);
    dropped.push(...guarded.dropped.map((d) => `${s.candidateId}: ${d}`));
    const shared = guarded.analysis.sharedInterests.filter((x) => x.strength !== "stretch");
    const bridges = guarded.analysis.bridges;
    if (!shared.length && !bridges.length) {
      dropped.push(`candidate ${s.candidateId}: nothing real in common`);
      continue;
    }

    const sharedOut = shared.map((x) => ({
      label: recTextOk(x.label, allowCozy) ? x.label.trim() : nameOf(me, x.aTag),
      aTag: x.aTag,
      bTag: x.bTag,
      strength: x.strength as "same" | "close" | "loose",
    }));
    const bridgesOut = bridges.map((b) => {
      const fromUser = b.fromUser === "a" ? ("me" as const) : ("them" as const);
      const fallback =
        fromUser === "me"
          ? `They do ${nameOf(them, b.matchedInterestTag)} — you've wanted to try it!`
          : `They want to try ${nameOf(them, b.wantsToTryTag)} — you already do it!`;
      return {
        label: recTextOk(b.label, allowCozy) ? b.label.trim() : fallback,
        fromUser,
        wantsToTryTag: b.wantsToTryTag,
        matchedInterestTag: b.matchedInterestTag,
      };
    });
    const firstLabel = sharedOut[0]?.label ?? nameOf(them, bridgesOut[0].matchedInterestTag);
    const teaser = recTextOk(s.teaser, allowCozy) ? s.teaser.trim() : templateTeaser(firstLabel);
    const score = scoreAnalysis({ sharedInterests: shared, bridges, styleNotes: analysis.styleNotes });
    recs.push({ candidateId: s.candidateId, sharedInterests: sharedOut, bridges: bridgesOut, teaser, score });
  }

  recs.sort((x, y) => y.score - x.score);
  return { recs: recs.slice(0, REC_MAX), dropped };
}
