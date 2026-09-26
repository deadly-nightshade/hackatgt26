import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { config } from "@/lib/config";

export function resolveFfmpegPath(): string {
  const p = config.ffmpegPath() ?? (ffmpegStatic as unknown as string | null);
  if (!p) throw new Error("No ffmpeg binary: set FFMPEG_PATH or install ffmpeg-static");
  return p;
}

/**
 * Convert any browser recording (webm/opus, Safari mp4/aac, ...) to a
 * 16kHz mono signed-16-bit PCM WAV (normalized input for STT + the silence check).
 *
 * Uses temp files in the OS temp dir (writable on Vercel and VPS alike) rather
 * than pipes: mp4 input needs a seekable file, and WAV output needs a seekable
 * file for ffmpeg to write correct RIFF sizes.
 */
export async function toWav(input: Buffer, timeoutMs = 30_000): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "towav-"));
  const inFile = path.join(dir, `${randomUUID()}.in`);
  const outFile = path.join(dir, `${randomUUID()}.wav`);
  try {
    await writeFile(inFile, input);
    await runFfmpeg(
      ["-hide_banner", "-loglevel", "error", "-y", "-i", inFile, "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", "-map_metadata", "-1", "-f", "wav", outFile],
      timeoutMs,
    );
    return await readFile(outFile);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolveFfmpegPath(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(0, 500)}`));
    });
  });
}
