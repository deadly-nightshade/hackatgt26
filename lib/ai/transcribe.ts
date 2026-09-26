import { readFile } from "node:fs/promises";
import path from "node:path";
import { cacheKey, withCache } from "@/lib/ai/cache";
import { recordUsage } from "@/lib/ai/usage";
import { assertTranscribableWav, parseWav } from "@/lib/audio/wavInfo";
import { config, ELEVENLABS_BASE_URL, STT_BATCH_MODEL, TRANSCRIBE_TIMEOUT_MS } from "@/lib/config";
import { log } from "@/lib/util/log";

export type Transcription = { text: string; durationMs: number };

/**
 * Batch transcription of a finished recording. The primary path is live
 * streaming straight from the browser to ElevenLabs (see createRealtimeSttToken);
 * this is the fallback when the live connection fails.
 */
export interface Transcriber {
  /** `hint.questionId` is only used by the mock to pick a canned transcript. */
  transcribe(wav: Buffer, hint?: { questionId?: string }): Promise<Transcription>;
}

/**
 * ElevenLabs Scribe batch STT.
 * Docs: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 *   POST /v1/speech-to-text  multipart: model_id + file, header xi-api-key
 */
export class ElevenLabsTranscriber implements Transcriber {
  constructor(
    private apiKey: string,
    private timeoutMs = TRANSCRIBE_TIMEOUT_MS,
  ) {}

  async transcribe(wav: Buffer): Promise<Transcription> {
    const info = parseWav(wav);
    return withCache(
      cacheKey(STT_BATCH_MODEL, wav),
      "transcribe",
      async () => {
        const form = new FormData();
        form.append("model_id", STT_BATCH_MODEL);
        form.append("tag_audio_events", "false");
        form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "answer.wav");

        const start = Date.now();
        const res = await fetch(`${ELEVENLABS_BASE_URL}/v1/speech-to-text`, {
          method: "POST",
          headers: { "xi-api-key": this.apiKey },
          body: form,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Transcription failed (${res.status}): ${body.slice(0, 300)}`);
        }
        const json = (await res.json()) as { text?: string };
        recordUsage({ route: "transcribe", model: STT_BATCH_MODEL, latencyMs: Date.now() - start, audioMs: info.durationMs });
        const text = (json.text ?? "").trim();
        if (!text) log("transcribe", "empty transcript from ElevenLabs", { raw: JSON.stringify(json).slice(0, 500) });
        return { text, durationMs: info.durationMs };
      },
      (r) => r.text.length > 0, // never cache empty results
    );
  }
}

/** Returns canned transcripts from fixtures/mock/transcripts.json. Zero API calls. */
export class MockTranscriber implements Transcriber {
  async transcribe(wav: Buffer, hint?: { questionId?: string }): Promise<Transcription> {
    const file = path.join(process.cwd(), "fixtures", "mock", "transcripts.json");
    const canned = JSON.parse(await readFile(file, "utf8")) as Record<string, string>;
    const text = (hint?.questionId && canned[hint.questionId]) || canned.default;
    let durationMs = 0;
    try {
      durationMs = assertTranscribableWav(wav).durationMs;
    } catch {
      // mock accepts anything
    }
    return { text, durationMs };
  }
}

export function getTranscriber(): Transcriber {
  return config.aiMode() === "live" ? new ElevenLabsTranscriber(config.elevenLabsKey()) : new MockTranscriber();
}

/**
 * Mint a single-use token (15 min, consumed on use) so the browser can stream
 * mic audio directly to ElevenLabs realtime STT without seeing our API key.
 * Docs: https://elevenlabs.io/docs/api-reference/tokens/create
 */
export async function createRealtimeSttToken(): Promise<string> {
  const res = await fetch(`${ELEVENLABS_BASE_URL}/v1/single-use-token/realtime_scribe`, {
    method: "POST",
    headers: { "xi-api-key": config.elevenLabsKey() },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Couldn't create STT token (${res.status}): ${body.slice(0, 300)}`);
  }
  const { token } = (await res.json()) as { token?: string };
  if (!token) throw new Error("STT token response had no token");
  log("stt", "minted realtime_scribe token");
  return token;
}
