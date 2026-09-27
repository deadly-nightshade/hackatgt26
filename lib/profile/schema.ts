import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export const SCHEMA_VERSION = "1" as const;

export const INTEREST_CATEGORIES = [
  "outdoors",
  "fitness",
  "arts_crafts",
  "music",
  "games",
  "food_drink",
  "media_entertainment",
  "tech",
  "learning",
  "social_nightlife",
  "wellness",
  "fashion_beauty",
  "travel",
  "other",
] as const;

const confidence = z.number().min(0).max(1);
const tag = z
  .string()
  .min(1)
  .describe("normalized lowercase kebab-case, e.g. 'k-pop-dance-covers'");

export const ENERGY = ["homebody", "balanced", "out_and_about"] as const;
export const GROUP_SIZE = ["one_on_one", "small_group", "big_group", "flexible"] as const;
export const PLANNING = ["spontaneous", "flexible", "planner"] as const;

/** null = unknown. Only set a value when the answers clearly support it (no defaulting to the middle option). */
const styleValue = <T extends readonly [string, ...string[]]>(values: T, what: string) =>
  z.enum(values).nullable().describe(`${what}; null unless the answers clearly show it`);
const styleEvidence = z.string().nullable().describe("short quote supporting the value, or null");

/** What the extractor must return: every key present (nullable). */
const SocialStyleExtracted = z.object({
  energy: styleValue(ENERGY, "homebody vs going out"),
  energyEvidence: styleEvidence,
  groupSize: styleValue(GROUP_SIZE, "preferred group size"),
  groupSizeEvidence: styleEvidence,
  planning: styleValue(PLANNING, "spontaneous vs planner"),
  planningEvidence: styleEvidence,
});

/**
 * As stored. Older profiles have non-null values and one shared `evidence` string —
 * still valid (no migration): missing per-field evidence reads as null, the old field is dropped.
 */
export const SocialStyleSchema = z.object({
  energy: z.enum(ENERGY).nullable(),
  energyEvidence: z.string().nullable().default(null),
  groupSize: z.enum(GROUP_SIZE).nullable(),
  groupSizeEvidence: z.string().nullable().default(null),
  planning: z.enum(PLANNING).nullable(),
  planningEvidence: z.string().nullable().default(null),
});
export type SocialStyle = z.infer<typeof SocialStyleSchema>;

const Trait = z.object({
  score: z.number().min(1).max(5).describe("1 = very low, 5 = very high"),
  confidence,
  evidence: z.string().describe("short quote from the answers, or '' if none"),
});

/** What the LLM produces. displayName / schemaVersion / disclaimer are added server-side. */
export const ExtractedProfileSchema = z.object({
  summary: z.string().min(1).describe("1-2 warm sentences, second person"),
  interests: z.array(
    z.object({
      name: z.string().min(1).describe("specific, e.g. 'bouldering' not 'sports'"),
      category: z.enum(INTEREST_CATEGORIES),
      tag,
      evidence: z.string().min(1).describe("short quote from the user's answer"),
      confidence,
    }),
  ),
  wantsToTry: z.array(
    z.object({
      name: z.string().min(1),
      tag,
      evidence: z.string().min(1),
    }),
  ),
  socialStyle: SocialStyleExtracted,
  traits: z.object({
    openness: Trait,
    conscientiousness: Trait,
    extraversion: Trait,
    agreeableness: Trait,
    emotionalStability: Trait,
  }),
  vibeType: z.object({
    mbti: z.string().regex(/^[EI][NS][TF][JP]$/, "4-letter MBTI code, uppercase"),
    label: z.string().min(1).describe("playful nickname"),
    confidence,
  }),
  conversationStarters: z.array(z.string().min(1)).min(2).max(4),
  residentFlavor: z.object({
    marketStall: z.string().min(1).describe("the stall they'd run at the seaside market"),
    catchphrase: z.string().min(1),
  }),
  lowSignalAreas: z.array(z.string()),
});

export type ExtractedProfile = z.infer<typeof ExtractedProfileSchema>;

/** The full, stored profile. */
export const ProfileSchema = ExtractedProfileSchema.extend({
  socialStyle: SocialStyleSchema,
  schemaVersion: z.literal(SCHEMA_VERSION),
  displayName: z.string().trim().min(1).max(60),
  vibeType: ExtractedProfileSchema.shape.vibeType.extend({
    disclaimer: z.literal("just for fun"),
  }),
});

export type Profile = z.infer<typeof ProfileSchema>;

export const AnswerSchema = z.object({
  questionId: z.string().min(1),
  transcript: z.string(),
});
export type Answer = z.infer<typeof AnswerSchema>;

/** JSON Schema for `response_format`, generated from the Zod schema (one source of truth). */
export const extractedProfileJsonSchema = (() => {
  const { $schema: _ignored, ...schema } = zodToJsonSchema(ExtractedProfileSchema, {
    $refStrategy: "none", // no $ref / recursion
    target: "jsonSchema7",
  }) as Record<string, unknown>;
  return schema;
})();

/**
 * Social style for display: only real, non-hedging values. "balanced"/"flexible" are hidden
 * everywhere (can't tell a real answer from AI hedging on older profiles); null = unknown.
 */
export const STYLE_CHIPS: Record<string, string> = {
  homebody: "🏠 Homebody",
  out_and_about: "🌆 Out and about",
  one_on_one: "👥 One-on-one",
  small_group: "🐟 Small groups",
  big_group: "🎉 Big groups",
  spontaneous: "⚡ Spontaneous",
  planner: "📅 Planner",
};
export function styleChips(s: Pick<SocialStyle, "energy" | "groupSize" | "planning">): string[] {
  return [s.energy, s.groupSize, s.planning].flatMap((v) => (v && STYLE_CHIPS[v] ? [STYLE_CHIPS[v]] : []));
}

/**
 * What the browser gets: everything except the personality traits. Traits stay internal
 * (stored, never shown or sent to the client — not on the review screen, not on /me).
 */
export type ProfileView = Omit<Profile, "traits">;
export function withoutTraits(p: Profile): ProfileView {
  const { traits: _hidden, ...rest } = p;
  return rest;
}

/** Assemble the stored profile from LLM output + server-owned fields. */
export function buildProfile(extracted: ExtractedProfile, displayName: string): Profile {
  return normalizeProfile({
    ...extracted,
    schemaVersion: SCHEMA_VERSION,
    displayName,
    vibeType: { ...extracted.vibeType, disclaimer: "just for fun" },
  });
}

/** Deterministic cleanups so matching later can rely on tags. */
export function normalizeProfile(p: Profile): Profile {
  return {
    ...p,
    interests: dedupeByTag(p.interests.map((i) => ({ ...i, tag: toTag(i.tag || i.name) }))),
    wantsToTry: dedupeByTag(p.wantsToTry.map((w) => ({ ...w, tag: toTag(w.tag || w.name) }))),
    vibeType: { ...p.vibeType, mbti: p.vibeType.mbti.toUpperCase() },
  };
}

export function toTag(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function dedupeByTag<T extends { tag: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((i) => i.tag && !seen.has(i.tag) && seen.add(i.tag));
}
