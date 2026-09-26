/**
 * Pre-generate ElevenLabs TTS for every onboarding question into
 * public/audio/questions/<id>.mp3 (commit the results; no TTS at page load).
 *
 *   npm run audio:questions             # skip files that already exist
 *   npm run audio:questions -- --force  # regenerate all
 */
import "./loadEnv";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import { QUESTIONS } from "@/lib/onboarding/questions";
import { ElevenLabsSpeaker } from "@/lib/tts/speak";

async function exists(p: string) {
  return access(p).then(
    () => true,
    () => false,
  );
}

async function main() {
  const force = process.argv.includes("--force");
  const { apiKey, voiceId, modelId } = config.elevenLabs();
  if (!apiKey || !voiceId) throw new Error("Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID");
  const speaker = new ElevenLabsSpeaker(apiKey, voiceId, modelId, 60_000);

  const outDir = path.join(process.cwd(), "public", "audio", "questions");
  await mkdir(outDir, { recursive: true });

  // All questions, including flag-gated ones, so toggling a flag never needs a regen.
  for (const q of QUESTIONS) {
    const file = path.join(outDir, `${q.id}.mp3`);
    if (!force && (await exists(file))) {
      console.log(`skip  ${q.id} (exists)`);
      continue;
    }
    const audio = await speaker.speak(q.prompt);
    await writeFile(file, audio);
    console.log(`wrote ${path.relative(process.cwd(), file)} (${(audio.length / 1024).toFixed(0)} KB)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
