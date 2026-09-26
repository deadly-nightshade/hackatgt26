import { z } from "zod";
import { getSpeaker } from "@/lib/tts/speak";
import { HttpError, readJson, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";

// Only short follow-up questions go through here; cap length to protect TTS credits.
const Body = z.object({ text: z.string().trim().min(1).max(300) });

/** POST { text } → audio/mpeg, or 204 when TTS is unavailable (client shows text only). */
export const POST = withRoute("POST /api/tts", async (req) => {
  const body = Body.safeParse(await readJson(req));
  if (!body.success) throw new HttpError(400, "Expected { text } (max 300 chars)");
  let audio: Buffer | null = null;
  try {
    audio = await getSpeaker().speak(body.data.text);
  } catch (err) {
    console.warn(`[tts] ${(err as Error).message}`);
  }
  if (!audio) return new Response(null, { status: 204 });
  return new Response(new Uint8Array(audio), {
    headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
  });
});
