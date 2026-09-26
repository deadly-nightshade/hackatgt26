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
  socialStyle: z.object({
    energy: z.enum(["homebody", "balanced", "out_and_about"]),
    groupSize: z.enum(["one_on_one", "small_group", "big_group", "flexible"]),
    planning: z.enum(["spontaneous", "flexible", "planner"]),
    evidence: z.string(),
  }),
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
