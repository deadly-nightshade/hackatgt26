# hackatgt26: Seaside Market

Phase 1 is the onboarding pipeline from [PHASE_1DESIGN.md](PHASE_1DESIGN.md). Phase 2 is the NFC fish meet-up cutscene from [PHASE_2 DESIGN.md](PHASE_2%20DESIGN.md) (see [Meet-ups](#meet-ups-phase-2)).

Onboarding: The user answers 3–4 prompts by voice or by typing. Speech is transcribed live with ElevenLabs Scribe, so words appear as you talk. Muse Spark then extracts a structured profile, and the user reviews and edits it. The confirmed profile is logged to the terminal and saved (to a JSON file or MongoDB).

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
| `npm run build:scene` | Crops the raw art in `public/art/world/` into the `/world` scene sprites (`public/world/scene/`) and crops the ice cream stand + its counter front. Re-run after replacing art |
| `npm run seed:fish [-- --for <userId>] [-- --clear]` | Inserts 5 labeled seed fish (`isSeed: true`, ids `seed-1-…` to `seed-5-…`) covering strong overlap, close-only overlap, a bridge only, zero overlap and a near-twin. Idempotent. `--for <userId>` also builds that user a sample `/world`: meets and hangouts at levels 1–4, one stranger, one pair between two residents, all run through the real pipeline with the mock AI (0 model calls). Existing pairs are left alone. `--clear` removes the seeds and their pairs/attempts |
| `npm run meet:pair -- <idA> <idB> [--attempts N] [--hangouts N] [--ignore-cooldown] [--reset] [--regenerate] [--force friends\|clammed_up]` | Runs the meet pipeline from the terminal and prints the analysis, similarity, pFail/roll and script. Writes to storage like a real tap. `--reset` deletes the pair first |
| `npm run list:fish [-- <baseUrl>]` | Lists every fish with its id and NFC tag URL (`<baseUrl>/meet/<id>`). Base URL defaults to `PUBLIC_BASE_URL`, then `http://localhost:3000` |
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
| `FORCE_MEET_OUTCOME` | `friends` or `clammed_up` forces the roll. Ignored in production unless `DEMO_MODE=true` |
| `DEMO_MODE` | Allows `FORCE_MEET_OUTCOME` in production |
| `ENABLE_WHOAMI` | Turns on `/dev/whoami` in production (lists every fish and lets anyone switch identity). Always on in dev |
| `MEET_HANGOUTS` | Re-taps between friends become hangouts that level up (default `true`). `false` → always "already friends" |
| `HANGOUT_COOLDOWN_MINUTES` | Minimum time between hangouts (default 60; use 1 for a demo) |

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
  meet/config.ts            every meet tunable: roll/score constants, levels, cooldown, PROMPT_VERSION
  meet/pipeline.ts          runMeet(): load → cache → analysis → guard → score → dialogue → roll → script
  meet/ai.ts                MeetAI interface: MuseMeetAI (live), MockMeetAI, heuristic/fallback analysis
  meet/prompt.ts            trimmed profile view + analysis/dialogue/scene prompts
  meet/guard.ts, score.ts, roll.ts, templates.ts   pure + unit-tested
  storage/pairRepo.ts       PairRepository + FilePairRepository (data/pairs, data/meet-attempts)
  storage/mongoPairRepo.ts  MongoPairRepository (`pairs`, `meetAttempts`)
  world/config.ts           every /world tunable: art paths, walkable area, framing, speeds, bump/activity timing, DEMO
  world/scene.ts            where every prop/item sits (normalized coords), blocked footprints (see docs/world-assets.md)
  world/activities.ts       data-driven ambient activities (sandcastle, booths, picnic, seagull, ice cream counter)
  world/paths.ts            walking around blocked props (shortest route via rect corners)
  world/sim.ts              pure wander/bump/swim-over/activity simulation (unit-tested)
  world/useWorldSim.ts      the rAF loop: positions in refs, written to the DOM as transforms
  world/server.ts           getResidentsFor() (who appears), world payload, history, replays
  world/bumps.ts            bump-line tidy/fallback/generic bubbles
app/api/…                   thin routes: stt-token, transcribe, onboarding/{check,extract,confirm}, tts, meet, pairs, pairs/[pairKey]/history, attempts/[id], world, users/[id]/{public,profile}
app/onboarding/             barebones UI (record/type → follow-up → review → confirm); sets localStorage fishId
app/_components/Cutscene.tsx  the cutscene player (fish sprites + tap-to-advance dialogue), shared by /meet and /world replays
app/meet/[targetId]/        the NFC meet page
app/world/                  the island (home screen)
app/dev/whoami/             dev-only identity switcher (404 in production)
```

### Notes

- **Transcription.** When you press Record, the browser gets a single-use token from `/api/stt-token` and streams the mic straight to ElevenLabs `scribe_v2_realtime` (`app/onboarding/useLiveTranscription.ts`). Pressing Stop commits and returns the final text. If the live connection fails, it falls back to MediaRecorder → `/api/transcribe` → ffmpeg → ElevenLabs `scribe_v2` batch. In mock mode, `/api/stt-token` returns 204 and the upload path returns canned text.

- **Muse Spark always reasons.** Its reasoning tokens count against `max_tokens`, and `reasoning_effort: "none"` is rejected. Extraction uses `low` with an 8k cap, and the answer check uses `minimal` with an 800 cap. A cap that's too low gives an empty completion with `finish_reason=length`. The usage log shows reasoning tokens separately.
- The terminal prints each live call and a running session total (`[ai-usage] session total: …`).
- The answer check is skipped for transcripts over 40 words, and the client calls it at most once per question.

## Meet-ups (Phase 2)

Each fish's NFC tag holds `https://<domain>/meet/<userId>`. Tapping a tag opens the page, which reads your id from `localStorage.fishId`. With no id, it sends you through onboarding and brings you back afterwards. The page then plays the cutscene from `POST /api/meet`.

- **Credits:** the first meet of a pair makes 2 model calls (analysis + both dialogue variants), and the result is cached on the `pairs` document. Retries and re-taps make 0. The cache is invalidated by `PROMPT_VERSION`, by the model (so mock output never passes as live), or when either profile's `updatedAt` changes. A friendship's status and level survive regeneration. `?regenerate=1` forces it, dev only.
- **Hallucination guard:** shared interests and bridges that cite tags missing from the right profile are dropped and logged. If nothing is left, the AI gets one retry with the error. If either call still fails, the cutscene uses exact tag matches and template lines, and that fallback isn't cached.
- **Roll:** `pFail = clamp(0.05 + 0.35·(1 − similarity), 0.05, 0.40) × 0.5^(fails since last success)`.
- **Hangouts (stretch):** a re-tap between friends outside the cooldown is a hangout. Levels are Friends → Good Friends (1 hangout) → Close Friends (3) → Best Fishes (6). Scenes are generated lazily, 3 per AI call, on the first hangout. A new batch is generated only after a level-up, capped at one batch per level.
- **Try it locally:** `npm run seed:fish`, then open `/dev/whoami`, pick who you are, and click **Meet →**.

## My Fish World (Phase 3)

`/world` is the home screen: your fish plus every fish you've met, wandering the seaside market. It makes **no AI calls**; everything comes from stored data.

- **Who appears:** only fish you've personally met with an NFC tap (a pair with at least one non-cooldown attempt), friends and "just met" strangers alike. Never friends-of-friends. The rule lives in `getResidentsFor()` in `lib/world/server.ts`.
- **Bumps:** when two fish meet they swap tiny speech bubbles (≤ 4 words). These `bumpLines` are generated inside the existing dialogue call, so there's no extra model call. Older pairs and AI fallbacks use template lines built from their shared interests. Two of your friends with no pair between them say generic things ("blub!", "nice fins").
- **Cards + history:** tap a fish for its level, friendship date, and the list of past cutscenes. Every attempt now saves the exact script it played, so replays just read it back: they never call `/api/meet`, roll, or change levels. Attempts from before this change say "replay unavailable". There's no meet or retry button here; those only happen by tapping someone's NFC tag.
- **Try it locally:** `npm run seed:fish -- --for <yourId>`, then `/dev/whoami` → pick yourself → `/world`.

## Living seaside world (Phase 4)

The market is now built from separate layers and props (asset notes and placements: `docs/world-assets.md`), and fish do things there. None of it makes AI calls; it all runs client-side from config.

- **Framing:** the square scene fits the screen width (height on landscape screens, with copies of the base at the sides). Sky blue fills the space above and ocean blue the space below, pixel-matched to the art's edges. `FRAMING.SKY_SHARE` sets how the leftover height splits.
- **Depth:** fish and props are y-sorted by their base, so fish pass behind stalls and the table. Fish never walk through the blocked footprints in `scene.ts`.
- **Activities** (`lib/world/activities.ts`): now and then a free fish picks one (`WORLD.ACTIVITY_CHANCE`, weighted), walks to its anchor, and something happens:
  - **Sandcastle:** the fish calls the nearest free fish (friends preferred). Both dig and a castle appears. It stays 4s after they leave. If nobody comes within 8s, the fish says "aw…".
  - **Booths 1/2:** a fish stands behind the counter and items show while it's there.
  - **Picnic table:** needs two fish. The one waiting draws others in. When both sit (drawn over the table), they swap bump lines and each gets a random-flavour cone (vanilla, chocolate or strawberry).
  - **Seagull:** the gull swaps to its fries-eating animation (`seagull_anim/`, 9 frames), plays it once, then the idle hopping gull comes back.
  - **Ice cream counter:** a fish stands in the serving window, behind the stand's counter front.

  "Swim over" cancels whatever the two fish were doing.
- **Placeholders:** items without art are drawn as dashed boxes. Dropping a PNG at `public/world/props/<item>.png` replaces one, no code change.
- **`/world?debug=1`** draws the walkable area, blocked rects, zones, anchors and each fish's target. The panel sits behind a tiny ‹ in the bottom-right corner: force any activity, tune the activity chance and time speed, toggle the overlay. **`?demo=1`** (or `NEXT_PUBLIC_WORLD_DEMO=1`) shortens every timing so all interactions show up within about 30s, for recording; with `?debug=1&demo=1` the overlay starts hidden.

## Fish customization (Phase 5)

- **Registry:** `lib/fish/appearance.ts` (shared by client and server) lists the slots and their options. Every accessory PNG is the base's exact size (2048×2330) and already positioned, so a fish is the base plus overlays stacked 1:1 (`LAYER_ORDER`: base → feet → head). To add an option, drop the file in `public/art/fish/<slot>/` and add one config line. Head has "None" + 5 hats; feet has 5 options and no "None", because the base sprite has no feet of its own, so it defaults to Cozy Boots. A slot with a single option shows its arrows disabled with "coming soon".
- **One sprite everywhere:** `<FishSprite appearance …>` (`app/_components/FishSprite.tsx`) renders every fish: the world, popup cards, `/meet`, replays, the creator and `/me`.
- **Onboarding:** after the last answer, profile extraction starts in the background and the creator shows right away. Arrows around the fish cycle head (top) and feet (bottom); ←/→ and Shift+←/→ work on desktop. **Next** unlocks when the profile is ready, and a failure shows **Retry** without losing the look. The look is kept in sessionStorage and saved with the profile at confirm. In mock mode, extraction waits ~4s so the waiting state can be seen.
- **`/me`:** the same creator at the top; **Save** calls `PATCH /api/users/:id/appearance`. Owner-only (hackathon level): the request carries the caller's fishId, which must match `:id`.
- **Pair AI cache is safe:** appearance lives in `appearance` / `appearanceUpdatedAt` and never touches the profile's `updatedAt` (the pair cache key). This is covered by a test.
- **Existing users:** no migration. A missing, partial or unknown slot reads as that slot's default (no hat, boots) via `getAppearance()`, so they look as before.
- `npm run seed:fish` gives each seed fish a different head accessory. Existing seeds get only their look updated.

### Identity across browsers

Your fish id lives in the browser, in localStorage plus a long-lived cookie backup. An NFC tap opens the phone's default browser (Safari on iPhone), which may not be where you onboarded: an in-app browser, another browser, the home-screen app, or a different address. When there's no id, the onboarding page now has **"Already made your fish?"**. Type your fish's name, tap it, and you continue to the tag you scanned (`GET /api/users/find?name=`, exact name match, not seeds).

## Deploy

- **Vercel:** live transcription works as-is, because the browser connects straight to ElevenLabs. Set `STORAGE=mongo` and leave `WRITABLE_FS` unset. All routes use the Node runtime, and the ffmpeg-static binary is traced into `/api/transcribe` through `outputFileTracingIncludes`. Check that transcription works in a preview deploy early.
- **VPS:** `DOMAIN=example.com docker compose up -d --build` runs the Next standalone server with system ffmpeg behind Caddy, which handles HTTPS automatically.
