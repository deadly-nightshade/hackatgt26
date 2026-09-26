# hackatgt26: Seaside Market onboarding

This is the onboarding pipeline from [DESIGN.md](DESIGN.md). The user answers 3–4 prompts by voice or by typing. Speech is transcribed live with ElevenLabs Scribe, so words appear as you talk. Muse Spark then extracts a structured profile, and the user reviews and edits it. The confirmed profile is logged to the terminal and saved (to a JSON file or MongoDB).

## Run it

```bash
npm install            # npm 11+: ffmpeg-static + esbuild install scripts are allow-listed in package.json
cp .env.example .env   # then fill in keys (see below)
npm run dev            # http://localhost:3000/onboarding
```

With the default `AI_MODE=mock`, the whole flow runs with **zero API calls**: transcripts and the profile come from `fixtures/mock/`. Set `AI_MODE=live` to call Muse.

> The mic needs a secure context. `localhost` works. To test on a phone, use an HTTPS tunnel or the Caddy setup below.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm test` | Vitest: the Zod schema rejects malformed output; toWav → 16 kHz mono s16 (parses the WAV header) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run extract:fixtures [-- --only rich,messy]` | Runs `extractProfile` on `fixtures/answers/*.json` and checks each result: schema valid, every interest has evidence, and none of the fixture's `mustNotContain` sensitive terms appear. Needs `AI_MODE=live` for real output |
| `npm run audio:questions [-- --force]` | Generates ElevenLabs TTS for every question into `public/audio/questions/` (skips existing files). Commit the MP3s |

## Environment

See [.env.example](.env.example). Summary:

| Var | Purpose |
| --- | --- |
| `MODEL_API_KEY` | Meta Model API key (Muse Spark: extraction + follow-up questions) |
| `AI_MODE` | `mock` (default) or `live` |
| `AI_CACHE` | Cache identical live responses in `data/cache/`. Only active when `WRITABLE_FS=true` |
| `ELEVENLABS_API_KEY` | Speech-to-text (live + batch) and TTS. Server-side only; the browser only gets single-use tokens |
| `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` | TTS voice for follow-up questions and `audio:questions` |
| `STORAGE` | `console` (terminal + `data/profiles/<id>.json`) or `mongo` (terminal + insert) |
| `MONGODB_URI`, `MONGODB_DB` | For `STORAGE=mongo` |
| `WRITABLE_FS` | `true` locally or on a VPS. Unset on Vercel, which disables the cache and requires `STORAGE=mongo` |
| `FFMPEG_PATH` | Optional system ffmpeg. Falls back to `ffmpeg-static` |
| `ONBOARDING_WANT_TO_TRY` | Include the optional 4th question (default `true`) |

## Layout

```
lib/
  config.ts                 env access (lazy) + model ids/timeouts
  ai/client.ts              the one OpenAI-SDK instance (Meta base URL)
  ai/chat.ts                structured-output call: cache + usage logging + reasoning_effort
  ai/transcribe.ts          createRealtimeSttToken; Transcriber (batch fallback): ElevenLabsTranscriber, MockTranscriber
  ai/usage.ts, ai/cache.ts  running token/audio totals; dev response cache
  audio/toWav.ts            any recording → 16 kHz mono s16 WAV (ffmpeg)
  audio/wavInfo.ts          WAV header parser + Muse format assertion
  onboarding/questions.ts   question config: add/remove/reorder here only
  profile/schema.ts         Zod ProfileSchema (source of truth) → JSON Schema
  profile/prompt.ts         extraction system prompt + Q&A formatter
  profile/extract.ts        LLM → parse → validate → 1 retry with error feedback
  profile/answerQuality.ts  thin-answer check → one follow-up (never blocks)
  storage/profileRepo.ts    ProfileRepository + ConsoleFileRepository
  storage/mongoRepo.ts      MongoProfileRepository (indexes on interests.tag, wantsToTry.tag)
  storage/index.ts          ← the one line that picks the repository
  tts/speak.ts              Speaker interface, ElevenLabsSpeaker, NoopSpeaker
app/api/…                   thin routes: stt-token, transcribe, onboarding/{check,extract,confirm}, tts
app/onboarding/             barebones UI (record/type → follow-up → review → confirm)
```

### Notes

- **Transcription.** When you press Record, the browser gets a single-use token from `/api/stt-token` and streams the mic straight to ElevenLabs `scribe_v2_realtime` (`app/onboarding/useLiveTranscription.ts`). Pressing Stop commits and returns the final text. If the live connection fails, it falls back to MediaRecorder → `/api/transcribe` → ffmpeg → ElevenLabs `scribe_v2` batch. In mock mode, `/api/stt-token` returns 204 and the upload path returns canned text.

- **Muse Spark always reasons.** Its reasoning tokens count against `max_tokens`, and `reasoning_effort: "none"` is rejected. Extraction uses `low` with an 8k cap, and the answer check uses `minimal` with an 800 cap. A cap that's too low gives an empty completion with `finish_reason=length`. The usage log shows reasoning tokens separately.
- The terminal prints each live call and a running session total (`[ai-usage] session total: …`).
- The answer check is skipped for transcripts over 40 words, and the client calls it at most once per question.

## Deploy

- **Vercel:** live transcription works as-is, because the browser connects straight to ElevenLabs. Set `STORAGE=mongo` and leave `WRITABLE_FS` unset. All routes use the Node runtime, and the ffmpeg-static binary is traced into `/api/transcribe` through `outputFileTracingIncludes`. Check that transcription works in a preview deploy early.
- **VPS:** `DOMAIN=example.com docker compose up -d --build` runs the Next standalone server with system ffmpeg behind Caddy, which handles HTTPS automatically.
