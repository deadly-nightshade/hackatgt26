import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getTranscriber } from "@/lib/ai/transcribe";
import { toWav } from "@/lib/audio/toWav";
import { audioLevel } from "@/lib/audio/wavInfo";
import { config } from "@/lib/config";
import { HttpError, log, withRoute } from "@/lib/util/log";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Peak below ~-54 dBFS = effectively silent (muted / wrong input device). Skips the API call. */
const SILENCE_PEAK = 0.002;
const DEBUG_DIR = path.join(process.cwd(), "data", "debug");

/** POST multipart { audio: Blob, questionId?: string } → { transcript, durationMs } */
export const POST = withRoute("POST /api/transcribe", async (req) => {
  const form = await req.formData().catch(() => {
    throw new HttpError(400, "Expected multipart/form-data");
  });
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) throw new HttpError(400, "Missing `audio` file");
  if (audio.size > MAX_UPLOAD_BYTES) throw new HttpError(413, "Recording too large");
  const questionId = typeof form.get("questionId") === "string" ? (form.get("questionId") as string) : undefined;

  let wav: Buffer;
  try {
    wav = await toWav(Buffer.from(await audio.arrayBuffer()));
  } catch (err) {
    console.warn(`[transcribe] audio conversion failed: ${(err as Error).message}`);
    throw new HttpError(422, "Couldn't read that recording — try again or type your answer.");
  }
  const level = audioLevel(wav);
  log("transcribe", "audio in", {
    type: audio.type,
    bytes: audio.size,
    peak: +level.peak.toFixed(4),
    rms: +level.rms.toFixed(4),
  });
  if (config.writableFs()) {
    // Overwritten each request — open data/debug/last.wav to hear what the server received.
    await mkdir(DEBUG_DIR, { recursive: true });
    await writeFile(path.join(DEBUG_DIR, "last.wav"), wav);
  }
  if (level.peak < SILENCE_PEAK) {
    throw new HttpError(422, "We didn't pick up any sound — check that the right mic is selected and not muted.");
  }

  try {
    const { text, durationMs } = await getTranscriber().transcribe(wav, { questionId });
    return NextResponse.json({ transcript: text, durationMs });
  } catch (err) {
    throw new HttpError(502, (err as Error).message);
  }
});
