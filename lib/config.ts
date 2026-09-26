/**
 * Central, lazily-read runtime config. Functions (not constants) so scripts can
 * load .env files before the first read.
 */

function flag(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

export type AIMode = "live" | "mock";
export type StorageKind = "console" | "mongo";

export const config = {
  aiMode(): AIMode {
    return process.env.AI_MODE === "live" ? "live" : "mock";
  },
  writableFs(): boolean {
    return flag("WRITABLE_FS");
  },
  /** Response cache only makes sense (and only works) with a writable FS. */
  aiCache(): boolean {
    return flag("AI_CACHE") && flag("WRITABLE_FS");
  },
  storage(): StorageKind {
    return process.env.STORAGE === "mongo" ? "mongo" : "console";
  },
  includeWantToTry(): boolean {
    return flag("ONBOARDING_WANT_TO_TRY", true);
  },
  modelApiKey(): string {
    return required("MODEL_API_KEY");
  },
  ffmpegPath(): string | undefined {
    return process.env.FFMPEG_PATH || undefined;
  },
  elevenLabsKey(): string {
    return required("ELEVENLABS_API_KEY");
  },
  elevenLabs() {
    return {
      apiKey: process.env.ELEVENLABS_API_KEY || "",
      voiceId: process.env.ELEVENLABS_VOICE_ID || "",
      modelId: process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2",
    };
  },
  mongo() {
    return { uri: required("MONGODB_URI"), db: required("MONGODB_DB") };
  },
};

export const META_BASE_URL = "https://api.meta.ai/v1";
export const CHAT_MODEL = "muse-spark-1.3";
export const LLM_TIMEOUT_MS = 30_000;
export const TRANSCRIBE_TIMEOUT_MS = 60_000;

// Speech-to-text is ElevenLabs Scribe (Muse Spark still does all the LLM work).
export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";
/** Live streaming from the browser. */
export const STT_REALTIME_MODEL = "scribe_v2_realtime";
/** Batch fallback for uploaded recordings. */
export const STT_BATCH_MODEL = "scribe_v2";
