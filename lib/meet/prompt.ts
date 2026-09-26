import type { Analysis } from "@/lib/meet/schema";
import { MIDDLE_LINES, SCENE_LINES, SCENES_PER_BATCH } from "@/lib/meet/config";
import { PUN_BANK } from "@/lib/meet/templates";
import { BUMP_LINES, BUMP_MAX_WORDS } from "@/lib/world/bumps";
import type { Profile } from "@/lib/profile/schema";

/**
 * What the AI sees of a fish. Deliberately excludes rawAnswers, traits and
 * vibeType: saves tokens and keeps dialogue from judging anyone.
 */
export type FishView = {
  displayName: string;
  summary: string;
  interests: { name: string; category: string; tag: string }[];
  wantsToTry: { name: string; tag: string }[];
  socialStyle: { energy: string; groupSize: string; planning: string };
  residentFlavor: { marketStall: string; catchphrase: string };
};

export function trimProfile(p: Profile): FishView {
  return {
    displayName: p.displayName,
    summary: p.summary,
    interests: p.interests.map(({ name, category, tag }) => ({ name, category, tag })),
    wantsToTry: p.wantsToTry.map(({ name, tag }) => ({ name, tag })),
    socialStyle: { energy: p.socialStyle.energy, groupSize: p.socialStyle.groupSize, planning: p.socialStyle.planning },
    residentFlavor: p.residentFlavor,
  };
}

const CONTENT_RULES = `Content rules:
- Never mention scores, similarity, MBTI, personality traits, or anything negative about either person.
- No sensitive topics: health, religion, politics, sexuality, ethnicity, money.
- Only use facts from the profiles. Never invent hobbies, places, or history.`;

export const ANALYSIS_SYSTEM_PROMPT = `You find common ground between two residents ("fish") of a cozy seaside-market social app, so they can have a cute friend-making cutscene and hang out in real life.

You get two profiles, A and B. Find what connects them:
- sharedInterests: pairs of one interest from A and one interest from B that relate. Semantic matching is the point:
  "same" = the same thing (e.g. "valorant" ~ "valorant-ranked"),
  "close" = clearly the same kind of thing (e.g. "honkai-star-rail" ~ "gacha-games"),
  "loose" = same broad area (e.g. "bouldering" ~ "trail-running"),
  "stretch" = a playful but GROUNDED link (see below).
- bridges: A wants to try something (A.wantsToTry) that B already does (B.interests), or vice versa. fromUser is the fish who WANTS to try it.
- styleNotes.energyMatch: true if their socialStyle energy levels fit together; note: one short, kind sentence.
- spotlight: the single best thing for them to talk about, written as a short verb phrase that completes "They both ___" (e.g. "love gacha games", "take food very seriously"). Lowercase, no trailing period.

Hard rules:
- Every aTag / bTag / wantsToTryTag / matchedInterestTag MUST be copied EXACTLY from the correct fish's tag list. aTag comes from A.interests, bTag from B.interests. For a bridge, wantsToTryTag comes from fromUser's wantsToTry and matchedInterestTag from the OTHER fish's interests. Items citing any other tag are discarded.
- Return AT LEAST ONE sharedInterest or bridge. If there is no real overlap, invent one playful but grounded "stretch" linking one real interest of A to one real interest of B (e.g. "desserts-and-meat-skewers" + "gym-meal-prep" → label "taking food very seriously").
- Prefer quality over quantity: at most 5 sharedInterests and 3 bridges.
- label: a short friendly phrase (2-6 words), e.g. "gacha games", "Valorant at the esports lounge".
${CONTENT_RULES}

Return ONLY a JSON object matching the schema.`;

export function buildAnalysisUserPrompt(a: FishView, b: FishView): string {
  const tags = (v: FishView) =>
    `  interest tags: ${v.interests.map((i) => i.tag).join(", ") || "(none)"}\n  wantsToTry tags: ${v.wantsToTry.map((w) => w.tag).join(", ") || "(none)"}`;
  return [
    `Fish A:\n${JSON.stringify(a, null, 1)}`,
    `Fish B:\n${JSON.stringify(b, null, 1)}`,
    `Allowed tags (copy exactly):\nA\n${tags(a)}\nB\n${tags(b)}`,
    `Find their common ground.`,
  ].join("\n\n");
}

const DIALOGUE_STYLE = `Style:
- Every line ≤ 90 characters. Casual, warm, a little silly, like Tomodachi Life.
- Each fish sounds a bit like their profile (their market stall and catchphrase are hints, don't just repeat the catchphrase).
- At most 2 fish puns per variant, only from this list: ${PUN_BANK.join(", ")}.
- speaker is "a" or "b" (use "narrator" sparingly or not at all). mood is one of neutral, happy, excited, shy, sad.
${CONTENT_RULES}`;

export const DIALOGUE_SYSTEM_PROMPT = `You write the middle of a short friend-making cutscene between two fish at a seaside market. The intro, suspense beat and ending are added separately — write ONLY the conversation.

Write TWO variants:
- friendsLines (${MIDDLE_LINES.min}-${MIDDLE_LINES.max} lines): they chat happily about their REAL overlaps (use the connections given, especially the spotlight and any bridge).
- clammedUpLines (${MIDDLE_LINES.min}-${MIDDLE_LINES.max} lines): shy and awkward, a few near-misses, but still touching on the spotlight connection, ending on a hopeful note.
Use the fish's names naturally in the text where it helps.

Also write bumpLines (${BUMP_LINES.min}-${BUMP_LINES.max} items): tiny speech-bubble exchanges for when these two fish bump into each other while wandering the island. a = fish a's bubble, b = fish b's reply. Each side AT MOST ${BUMP_MAX_WORDS} WORDS, lowercase-casual, about their real overlaps, one emoji allowed. Examples: { "a": "honkai star rail?", "b": "gaming!!" }, { "a": "skewers later?", "b": "always 🍢" }.

${DIALOGUE_STYLE}

Return ONLY a JSON object matching the schema.`;

type Names = { a: string; b: string };

function connectionsBlock(analysis: Analysis, names: Names): string {
  const shared = analysis.sharedInterests.map((s) => `- ${s.label} (${s.strength}): ${names.a} → ${s.aTag}, ${names.b} → ${s.bTag}. ${s.why}`);
  const bridges = analysis.bridges.map((br) => {
    const wanter = names[br.fromUser];
    const knower = names[br.fromUser === "a" ? "b" : "a"];
    return `- ${wanter} wants to try ${br.wantsToTryTag}; ${knower} already does ${br.matchedInterestTag} (${br.label})`;
  });
  return [
    `Spotlight: they both ${analysis.spotlight}`,
    `Shared interests:\n${shared.join("\n") || "- (none)"}`,
    `Bridges:\n${bridges.join("\n") || "- (none)"}`,
    `Energy: ${analysis.styleNotes.note}`,
  ].join("\n");
}

function fishBlock(label: string, v: FishView): string {
  return `Fish ${label} = ${v.displayName}. Stall: ${v.residentFlavor.marketStall}. Catchphrase: "${v.residentFlavor.catchphrase}". Vibe: ${v.summary}`;
}

export function buildDialogueUserPrompt(a: FishView, b: FishView, analysis: Analysis): string {
  return [fishBlock("a", a), fishBlock("b", b), connectionsBlock(analysis, { a: a.displayName, b: b.displayName }), "Write both variants."].join(
    "\n\n",
  );
}

export const SCENES_SYSTEM_PROMPT = `Two fish at a seaside market are already friends and keep hanging out in real life. Write ${SCENES_PER_BATCH} short hangout scenes for them.

- Each scene is about a DIFFERENT connection from the list given (a shared interest, a bridge, or the spotlight), and shows them DOING the thing together (e.g. at the esports lounge, solving the daily crossword over skewers).
- Each scene: ${SCENE_LINES.min}-${SCENE_LINES.max} lines. topic = a short name for what they're doing.
- Avoid topics that were already used (listed below, if any).
- At most 2 fish puns per scene.

${DIALOGUE_STYLE}

Return ONLY a JSON object matching the schema.`;

export function buildScenesUserPrompt(a: FishView, b: FishView, analysis: Analysis, opts: { levelName: string; usedTopics: string[] }): string {
  return [
    fishBlock("a", a),
    fishBlock("b", b),
    connectionsBlock(analysis, { a: a.displayName, b: b.displayName }),
    `Friendship level: ${opts.levelName}`,
    `Already-used topics: ${opts.usedTopics.join("; ") || "(none)"}`,
    `Write ${SCENES_PER_BATCH} scenes.`,
  ].join("\n\n");
}
