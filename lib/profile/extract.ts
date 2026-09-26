import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ZodError } from "zod";
import { chatJson, type ChatMessage } from "@/lib/ai/chat";
import { config } from "@/lib/config";
import { buildExtractionUserPrompt, EXTRACTION_SYSTEM_PROMPT } from "@/lib/profile/prompt";
import {
  buildProfile,
  ExtractedProfileSchema,
  extractedProfileJsonSchema,
  type Answer,
  type ExtractedProfile,
  type Profile,
} from "@/lib/profile/schema";
import { log } from "@/lib/util/log";

export class ExtractionError extends Error {
  constructor(
    message: string,
    public rawOutput?: string,
  ) {
    super(message);
  }
}

type ParseResult = { ok: true; value: ExtractedProfile } | { ok: false; error: string };

function parseAndValidate(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `Output was not valid JSON: ${(e as Error).message}` };
  }
  const result = ExtractedProfileSchema.safeParse(json);
  return result.success ? { ok: true, value: result.data } : { ok: false, error: formatZodError(result.error) };
}

export function formatZodError(err: ZodError): string {
  return err.issues
    .slice(0, 15)
    .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
}

/**
 * Answers → validated Profile.
 * LLM call → JSON.parse → Zod validate → on failure retry once with the
 * validation error fed back → otherwise throw ExtractionError.
 */
export async function extractProfile(input: { displayName: string; answers: Answer[] }): Promise<Profile> {
  if (config.aiMode() === "mock") return mockProfile(input.displayName);

  const messages: ChatMessage[] = [
    { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
    { role: "user", content: buildExtractionUserPrompt(input.answers) },
  ];
  const call = (msgs: ChatMessage[], route: string) =>
    chatJson({
      route,
      messages: msgs,
      schemaName: "resident_profile",
      schema: extractedProfileJsonSchema,
      maxTokens: 8000, // includes reasoning tokens; the visible JSON is ~1.5k
      temperature: 0.4,
      reasoningEffort: "low",
    });

  const raw1 = await call(messages, "extract");
  const first = parseAndValidate(raw1);
  if (first.ok) return buildProfile(first.value, input.displayName);

  log("extract", "validation failed, retrying once", { error: first.error, raw: raw1.slice(0, 2000) });
  const raw2 = await call(
    [
      ...messages,
      { role: "assistant", content: raw1 },
      {
        role: "user",
        content: `Your previous output failed validation:\n${first.error}\n\nReturn the corrected JSON object only, matching the schema exactly.`,
      },
    ],
    "extract-retry",
  );
  const second = parseAndValidate(raw2);
  if (second.ok) return buildProfile(second.value, input.displayName);

  log("extract", "validation failed after retry", { error: second.error, raw: raw2.slice(0, 4000) });
  throw new ExtractionError(`Profile extraction failed validation:\n${second.error}`, raw2);
}

async function mockProfile(displayName: string): Promise<Profile> {
  const file = path.join(process.cwd(), "fixtures", "mock", "profile.json");
  const extracted = ExtractedProfileSchema.parse(JSON.parse(await readFile(file, "utf8")));
  return buildProfile(extracted, displayName);
}
