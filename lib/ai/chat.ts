import type OpenAI from "openai";
import { getAIClient } from "@/lib/ai/client";
import { cacheKey, withCache } from "@/lib/ai/cache";
import { recordUsage } from "@/lib/ai/usage";
import { CHAT_MODEL } from "@/lib/config";

export type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** Muse Spark always reasons ("none" is rejected); reasoning tokens count toward maxTokens. */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/**
 * One structured-output chat call to Muse Spark. Returns the raw JSON string;
 * parsing/validation is the caller's job. Cached (dev) and usage-logged.
 */
export async function chatJson(opts: {
  route: string;
  messages: ChatMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  /** Caps reasoning + visible output combined. */
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
}): Promise<string> {
  const key = cacheKey(CHAT_MODEL, opts.schemaName, opts.schema, opts.messages, opts.temperature ?? null, opts.reasoningEffort ?? null);
  return withCache(key, opts.route, async () => {
    const start = Date.now();
    const res = await getAIClient().chat.completions.create({
      model: CHAT_MODEL,
      messages: opts.messages,
      max_tokens: opts.maxTokens,
      temperature: opts.temperature,
      reasoning_effort: opts.reasoningEffort,
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.schemaName, schema: opts.schema },
      },
    });
    recordUsage({
      route: opts.route,
      model: CHAT_MODEL,
      latencyMs: Date.now() - start,
      inputTokens: res.usage?.prompt_tokens,
      outputTokens: res.usage?.completion_tokens,
      reasoningTokens: res.usage?.completion_tokens_details?.reasoning_tokens,
    });
    const choice = res.choices[0];
    const text = choice?.message?.content;
    if (!text) throw new Error(`Empty completion (finish_reason=${choice?.finish_reason})`);
    return text;
  });
}
