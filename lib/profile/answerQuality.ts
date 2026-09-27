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
const SYSTEM = `You check onboarding answers for a friendly social app. An answer is "thin" only if it's genuinely vague or gives almost no concrete detail. If it's not thin, followUp is "".

If thin, write ONE follow-up question that:
- builds on something they ACTUALLY said and asks about ONE concrete thing,
- can be answered in one sentence, is at most 20 words and ends with "?",
- does NOT repeat or rephrase the original question, and does NOT assume facts or add a vibe they didn't state.
Never ask about health, religion, politics, sexuality, ethnicity or money.

Examples:
Answer: "idk like night in? night out, sleeping time?"
  GOOD: "Night in or night out — which wins, and what are you usually doing?"
  BAD:  "What does your perfect cozy night look like?" (assumes things, adds a vibe)
Answer: "games mostly"
  GOOD: "Which games are you playing right now?"
  BAD:  "What's your favorite hobby?" (ignores the answer)

Return JSON only.`;

export const FOLLOW_UP_MAX_WORDS = 20;

/**
 * Code-side rules for a follow-up: ≤ 20 words, ends with "?", and not a rephrase of
 * the original question. Anything else is dropped (the user just moves on).
 */
export function validFollowUp(followUp: string, questionPrompt: string): boolean {
  const f = followUp.trim();
  if (!f.endsWith("?") || wordCount(f) > FOLLOW_UP_MAX_WORDS) return false;
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z']+/g)?.filter((w) => w.length > 3) ?? []);
  const fw = words(f);
  const qw = words(questionPrompt);
  if (!fw.size) return false;
  const shared = [...fw].filter((w) => qw.has(w)).length;
  return shared / fw.size < 0.6; // mostly the question's own words → a rephrase
}

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
    if (!parsed.thin || !followUp) return { ok: true };
    if (!validFollowUp(followUp, question.prompt)) {
      log("answer-check", "dropped follow-up that broke the rules", { followUp });
      return { ok: true };
    }
    return { ok: false, followUp };
  } catch (err) {
    log("answer-check", `failed, letting answer through: ${(err as Error).message}`);
    return { ok: true };
  }
}
