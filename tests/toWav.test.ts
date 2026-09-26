import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveFfmpegPath, toWav } from "@/lib/audio/toWav";
import { assertTranscribableWav, audioLevel, parseWav } from "@/lib/audio/wavInfo";

const dir = mkdtempSync(path.join(os.tmpdir(), "towav-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Synthesize a 2s stereo 48kHz tone in the given container, like a browser recording. */
function synth(file: string, codecArgs: string[]): Buffer {
  const out = path.join(dir, file);
  execFileSync(resolveFfmpegPath(), [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=48000",
    "-ac", "2", ...codecArgs, out,
  ]);
  return readFileSync(out);
}

describe("toWav", () => {
  it.each([
    ["webm/opus (Chrome)", "in.webm", ["-c:a", "libopus"]],
    ["mp4/aac (Safari)", "in.m4a", ["-c:a", "aac"]],
  ])("converts %s to 16kHz mono s16 PCM WAV", async (_name, file, codec) => {
    const wav = await toWav(synth(file, codec));
    const info = parseWav(wav);
    expect(info).toMatchObject({ audioFormat: 1, channels: 1, sampleRate: 16000, bitsPerSample: 16 });
    expect(info.durationMs).toBeGreaterThan(1800);
    expect(info.durationMs).toBeLessThan(2300);
    expect(() => assertTranscribableWav(wav)).not.toThrow();
  });

  it("rejects garbage input", async () => {
    await expect(toWav(Buffer.from("definitely not audio"))).rejects.toThrow(/ffmpeg/);
  });
});

describe("audioLevel", () => {
  it("distinguishes a silent recording from speech-level audio", async () => {
    const silent = path.join(dir, "silent.webm");
    execFileSync(resolveFfmpegPath(), [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "2", "-c:a", "libopus", silent,
    ]);
    expect(audioLevel(await toWav(readFileSync(silent))).peak).toBeLessThan(0.002);
    expect(audioLevel(await toWav(synth("tone.webm", ["-c:a", "libopus"]))).peak).toBeGreaterThan(0.05);
  });
});

describe("assertTranscribableWav", () => {
  it("rejects stereo 44.1kHz", () => {
    const out = path.join(dir, "bad.wav");
    execFileSync(resolveFfmpegPath(), [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "sine=duration=1:sample_rate=44100", "-ac", "2", "-c:a", "pcm_s16le", out,
    ]);
    expect(() => assertTranscribableWav(readFileSync(out))).toThrow(/mono|16k/);
  });
});
