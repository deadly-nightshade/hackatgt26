import OpenAI from "openai";
import { config, LLM_TIMEOUT_MS, META_BASE_URL } from "@/lib/config";

let client: OpenAI | null = null;

/** The single OpenAI-SDK instance pointed at the Meta Model API. */
export function getAIClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: config.modelApiKey(),
      baseURL: META_BASE_URL,
      timeout: LLM_TIMEOUT_MS,
      maxRetries: 1, // credits are precious; extractProfile has its own retry for bad JSON
    });
  }
  return client;
}
