import { config } from "@/lib/config";
import { log } from "@/lib/util/log";

export interface Speaker {
  /** MP3 audio for `text`, or null if TTS is unavailable (caller shows text only). */
  speak(text: string): Promise<Buffer | null>;
}

/**
 * ElevenLabs text-to-speech.
 * Docs: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
 *   POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128, header xi-api-key
 */
export class ElevenLabsSpeaker implements Speaker {
  constructor(
    private apiKey: string,
    private voiceId: string,
    private modelId = "eleven_multilingual_v2",
    private timeoutMs = 20_000,
  ) {}

  async speak(text: string): Promise<Buffer> {
    const start = Date.now();
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(this.voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: this.modelId }),
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    log("tts", "LIVE elevenlabs", { chars: text.length, latencyMs: Date.now() - start, bytes: buf.length });
    return buf;
  }
}

export class NoopSpeaker implements Speaker {
  async speak(): Promise<null> {
    return null;
  }
}

/** Noop in AI_MODE=mock (zero API calls) or when ElevenLabs isn't configured. */
export function getSpeaker(): Speaker {
  const { apiKey, voiceId, modelId } = config.elevenLabs();
  if (config.aiMode() === "mock" || !apiKey || !voiceId) return new NoopSpeaker();
  return new ElevenLabsSpeaker(apiKey, voiceId, modelId);
}
