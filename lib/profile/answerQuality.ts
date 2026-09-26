import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { chatJson } from "@/lib/ai/chat";
import { config } from "@/lib/config";
import type { OnboardingQuestion } from "@/lib/onboarding/questions";
import { log } from "@/lib/util/log";

export type AnswerCheck = { ok: boolean; followUp?: string };

/** Answers longer than this are clearly not thin — skip the LLM call. */
export const THIN_WORD_LIMIT = 40;

const CheckSchema = z.object({
  thin: z.boolean(),
  followUp: z.string(),
});
const { $schema: _ignored, ...checkJsonSchema } = zodToJsonSchema(CheckSchema, {
  $refStrategy: "none",
}) as Record<string, unknown>;

// Deliberately short: this runs after every answer.
const SYSTEM = `You check onboarding answers for a friendly social app. An answer is "thin" if it's vague, very short, or gives little concrete detail about the person (e.g. "idk like night in? night out, sleeping time?"). If thin, write ONE short, warm, casual follow-up question (max 20 words) that builds on what they said. If not thin, followUp is "". Never ask about health, religion, politics, sexuality, ethnicity or money. Return JSON only.`;

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Decide if an answer needs a follow-up. Never throws — any failure means
 * "ok, move on" so it can't block onboarding.
 */
export async function checkAnswer(question: OnboardingQuestion, transcript: string): Promise<AnswerCheck> {
  const words = wordCount(transcript);
  if (words > THIN_WORD_LIMIT) return { ok: true };

  if (config.aiMode() === "mock") {
    return words < 12
      ? { ok: false, followUp: "Ooh, tell me a bit more — what does that actually look like for you?" }
      : { ok: true };
  }

  try {
    const raw = await chatJson({
      route: "answer-check",
      messages: [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: `Question: ${question.prompt}\nFollow-up tip: ${question.followUpHint}\nAnswer: """${transcript.trim() || "(empty)"}"""`,
        },
      ],
      schemaName: "answer_check",
      schema: checkJsonSchema,
      maxTokens: 800, // includes reasoning tokens
      temperature: 0.7,
      reasoningEffort: "minimal",
    });
    const parsed = CheckSchema.parse(JSON.parse(raw));
    const followUp = parsed.followUp.trim();
    return parsed.thin && followUp ? { ok: false, followUp } : { ok: true };
  } catch (err) {
    log("answer-check", `failed, letting answer through: ${(err as Error).message}`);
    return { ok: true };
  }
}
