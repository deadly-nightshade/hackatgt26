import { z } from "zod";
import type { Appearance } from "@/lib/fish/appearance";
import { zodToJsonSchema } from "zod-to-json-schema";

/** Safe for client components (no server-only deps). */

export const MOODS = ["neutral", "happy", "excited", "shy", "sad"] as const;

export const DialogueLineSchema = z.object({
  speaker: z.enum(["a", "b", "narrator"]),
  // Prompt asks for ≤ 90 chars; this is only the hard guard against runaway output.
  text: z.string().trim().min(1).max(160),
  mood: z.enum(MOODS).describe("for future sprite animation"),
});
export type DialogueLine = z.infer<typeof DialogueLineSchema>;

export const STRENGTHS = ["same", "close", "loose", "stretch"] as const;
export type Strength = (typeof STRENGTHS)[number];

/** AI call #1 output. "a"/"b" are always the pair's sorted userIds[0]/[1]. */
export const AnalysisSchema = z.object({
  sharedInterests: z.array(
    z.object({
      aTag: z.string().describe("an interest tag from fish A's profile, copied exactly"),
      bTag: z.string().describe("an interest tag from fish B's profile, copied exactly"),
      label: z.string().min(1).describe("short friendly name for the connection, e.g. 'gacha games'"),
      strength: z.enum(STRENGTHS),
      why: z.string(),
    }),
  ),
  bridges: z.array(
    z.object({
      fromUser: z.enum(["a", "b"]).describe("the fish who WANTS to try it"),
      wantsToTryTag: z.string().describe("a wantsToTry tag from fromUser's profile, copied exactly"),
      matchedInterestTag: z.string().describe("an interest tag from the OTHER fish's profile, copied exactly"),
      label: z.string().min(1),
    }),
  ),
  styleNotes: z.object({ energyMatch: z.boolean(), note: z.string() }),
  spotlight: z
    .string()
    .min(1)
    .describe("the single best thing to talk about, as a verb phrase completing 'They both ___', e.g. 'love gacha games'"),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

/** A tiny world-map speech-bubble exchange ("a" = pair's userIds[0]). Each side ≤ 4 words. */
export const BumpLineSchema = z.object({
  a: z.string().describe("fish a's bubble, at most 4 words"),
  b: z.string().describe("fish b's reply bubble, at most 4 words"),
});
export type BumpLine = z.infer<typeof BumpLineSchema>;

/** AI call #2 output. Array bounds are lenient here; extra lines are trimmed in code. */
export const DialogueSchema = z.object({
  friendsLines: z.array(DialogueLineSchema).min(2).max(10),
  clammedUpLines: z.array(DialogueLineSchema).min(2).max(10),
  bumpLines: z.array(BumpLineSchema).max(12).describe("5-8 tiny exchanges for when they bump into each other on the beach"),
});
/** Parsing is lenient on bumpLines: bad or missing ones fall back to templates instead of costing a retry. */
export const DialogueParseSchema = DialogueSchema.extend({
  bumpLines: z.array(z.object({ a: z.string(), b: z.string() })).catch([]),
});
export type Dialogue = {
  friendsLines: DialogueLine[];
  clammedUpLines: DialogueLine[];
  bumpLines: BumpLine[];
};

/** Stretch: hangout scene batch (one AI call → 3 scenes). */
export const SceneBatchSchema = z.object({
  scenes: z
    .array(
      z.object({
        topic: z.string().min(1).describe("the shared interest / bridge / spotlight this scene is about"),
        lines: z.array(DialogueLineSchema).min(2).max(10),
      }),
    )
    .min(1)
    .max(5),
});
export type SceneBatch = z.infer<typeof SceneBatchSchema>;

export type HangoutScene = { id: string; topic: string; lines: DialogueLine[]; usedAt?: Date };

export type PairStatus = "strangers" | "friends";

export type Pair = {
  _id: string; // = pairKey
  pairKey: string;
  userIds: [string, string];
  /** Cached AI content. Absent when the last run used the fallback (so the AI is retried next time). */
  analysis?: Analysis;
  similarity?: number;
  dialogue?: { friendsLines: DialogueLine[]; clammedUpLines: DialogueLine[] };
  /** World-map bump bubbles from the dialogue call. Absent on older pairs (templates fill in). */
  bumpLines?: BumpLine[];
  status: PairStatus;
  friendsSince?: Date;
  promptVersion?: string;
  model?: string;
  profilesUpdatedAt?: [Date, Date];
  createdAt: Date;
  // Stretch: hangouts + levels
  level: number;
  hangoutCount: number;
  lastHangoutAt?: Date;
  hangoutScenes: HangoutScene[];
  sceneBatchesGenerated: number;
  /** Level at the time the last scene batch was generated. */
  sceneBatchLevel?: number;
};

export type MeetOutcome = "friends" | "clammed_up" | "already_friends" | "hangout" | "cooldown";

/** What a history entry was (the world's cutscene history). */
export type AttemptKind = "first_meet" | "hangout" | "clammed_up" | "cooldown" | "already_friends";

export function kindOf(outcome: MeetOutcome): AttemptKind {
  return outcome === "friends" ? "first_meet" : outcome;
}

export type MeetAttempt = {
  _id: string;
  pairKey: string;
  initiatorId: string;
  outcome: MeetOutcome;
  pFail: number | null;
  roll: number | null;
  createdAt: Date;
  // Full record of what played (optional: attempts logged before this was added lack them).
  targetId?: string;
  initiatorName?: string;
  targetName?: string;
  attemptNumber?: number;
  level?: number;
  leveledUp?: boolean;
  usedFallback?: boolean;
  modelCalls?: number;
  kind?: AttemptKind;
  levelAfter?: number;
  levelNameAfter?: string;
  /** The exact cutscene shown, speaker resolved to a display name (null = narrator). */
  script?: (DialogueLine & { speakerName: string | null })[];
};

export type MeetResponse = {
  pairKey: string;
  outcome: MeetOutcome;
  /** Speakers are relative to this request: "a" = initiator, "b" = target. */
  script: DialogueLine[];
  similarity: number;
  attemptNumber: number;
  fish: { a: { id: string; displayName: string; appearance: Appearance }; b: { id: string; displayName: string; appearance: Appearance } };
  level: number;
  levelName: string | null;
  leveledUp: boolean;
  hangoutCount: number;
  debug?: { pFail: number | null; roll: number | null; analysis: Analysis; usedFallback: boolean; modelCalls: number };
};

/** Order-independent pair id: `${minId}__${maxId}`. */
export function pairKeyOf(idA: string, idB: string): string {
  const [x, y] = sortIds(idA, idB);
  return `${x}__${y}`;
}

export function sortIds(idA: string, idB: string): [string, string] {
  return idA < idB ? [idA, idB] : [idB, idA];
}

export function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = zodToJsonSchema(schema, {
    $refStrategy: "none",
    target: "jsonSchema7",
  }) as Record<string, unknown>;
  return rest;
}
