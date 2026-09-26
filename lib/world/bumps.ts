import type { Analysis, BumpLine } from "@/lib/meet/schema";
import { hashString } from "@/lib/meet/templates";

/** Safe for client components. */

export const BUMP_MAX_WORDS = 4;
export const BUMP_LINES = { min: 5, max: 8 } as const;

/** Replies for template bump lines built from shared interests. */
export const FALLBACK_REPLIES = ["same!!", "yesss", "omg me too", "fin-tastic!"] as const;

/** Friend-to-friend bumps with no pair between them (they haven't met). */
export const GENERIC_BUBBLES = ["blub!", "hi hi", "👋", "nice fins", "sea you!"] as const;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);

function okBubble(s: string): boolean {
  const w = words(s);
  return w.length > 0 && w.length <= BUMP_MAX_WORDS && s.trim().length <= 32;
}

/** Keep only well-formed, distinct exchanges (each side ≤ 4 words), at most BUMP_LINES.max. */
export function tidyBumpLines(lines: { a: string; b: string }[] | undefined): BumpLine[] {
  const seen = new Set<string>();
  return (lines ?? [])
    .map((l) => ({ a: l.a.trim(), b: l.b.trim() }))
    .filter((l) => okBubble(l.a) && okBubble(l.b))
    .filter((l) => !seen.has(l.a.toLowerCase()) && !!seen.add(l.a.toLowerCase()))
    .slice(0, BUMP_LINES.max);
}

// Never end a shortened label on a joining word ("daily crossword and?").
const DANGLING = new Set(["and", "&", "with", "the", "of", "or", "meets", "a", "to", "for", "in", "on"]);

/** "Honkai: Star Rail & gacha games" → "honkai: star rail?" (≤ 3 words + "?"). */
export function shortLabel(label: string): string {
  const w = words(label.toLowerCase().replace(/[.!?]+$/, "")).slice(0, BUMP_MAX_WORDS - 1);
  while (w.length > 1 && DANGLING.has(w[w.length - 1])) w.pop();
  return w.join(" ");
}

/** Template bump lines from validated shared interests: a: "{label}?"  b: a cheerful reply. */
export function fallbackBumpLines(analysis: Analysis | undefined, pairKey: string): BumpLine[] {
  const labels = [...new Set((analysis?.sharedInterests ?? []).map((s) => shortLabel(s.label)).filter(Boolean))];
  return labels.slice(0, BUMP_LINES.max).map((label, i) => ({
    a: `${label}?`,
    b: FALLBACK_REPLIES[hashString(`${pairKey}#bump#${i}`) % FALLBACK_REPLIES.length],
  }));
}

/** The pair's own lines if it has any, else the template ones. */
export function bumpLinesForPair(pair: { pairKey: string; bumpLines?: BumpLine[]; analysis?: Analysis }): BumpLine[] {
  return pair.bumpLines?.length ? pair.bumpLines : fallbackBumpLines(pair.analysis, pair.pairKey);
}

/** Random generic exchanges for two fish with no pair between them. */
export function genericBumpLines(random: () => number, count = 3): BumpLine[] {
  const pick = () => GENERIC_BUBBLES[Math.floor(random() * GENERIC_BUBBLES.length)];
  return Array.from({ length: count }, () => ({ a: pick(), b: pick() }));
}
