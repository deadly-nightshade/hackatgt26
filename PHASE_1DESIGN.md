# Feature: Onboarding Voice-Answer → Profile Extraction Pipeline

## Context
We're building a social app for a 36h hackathon (Meta track, must use Muse Spark).
Concept: a cozy "seaside market island" where each friend is a resident; AI finds
common ground between real friends and nudges them to hang out IRL.
THIS TASK: only the onboarding pipeline. User answers 3–4 prompts by voice →
transcribe → Muse Spark extracts a structured profile → user reviews it → final
profile is logged to the server terminal (and written to a local JSON file).
No DB yet, but design so a DB (likely Supabase) slots in later without rewrites.
Theming does not matter; focus on backend correctness and clean module boundaries.

## Decisions (already made)
- Next.js (App Router) + TypeScript, single repo. API routes = backend.
- LLM: Muse Spark via the OpenAI SDK (OpenAI-compatible).
  - Base URL: https://api.meta.ai/v1   Model: muse-spark-1.3
  - Env var: MODEL_API_KEY (Bearer auth)
  - Structured output: chat.completions with
    response_format: { type: "json_schema", json_schema: { name, schema } }
    (limits: max nesting 10, no recursive schemas)
- Transcription: Muse Voice Transcribe (model muse-voice-transcribe-1.0)
  - POST https://api.meta.ai/v1/asr/transcribe, multipart/form-data with parts
    `request` (JSON settings) and `audio` (WAV file)
  - Audio MUST be RIFF/WAVE, mono, 16-bit PCM, 16kHz or 24kHz. Max 10 min / 32MB.
  - Response: { sessionId, transcript, audioDurationMs, turns[] }
  - VERIFY exact `request` JSON fields in https://dev.meta.ai/docs/api-reference/voice
    and https://dev.meta.ai/docs/speech-to-text before implementing.
- Browser records with MediaRecorder (webm/opus). Server converts to
  16kHz mono s16 WAV with ffmpeg (use `ffmpeg-static` npm package) before sending.
- Validation: Zod. Generate JSON Schema for response_format from the Zod schema
  (zod-to-json-schema) so there's one source of truth.
- Personality: store Big Five-style trait estimates (with evidence + confidence)
  as the "real" data; MBTI only as a playful low-confidence `vibeType` label.

## Onboarding questions (config-driven — store in lib/onboarding/questions.ts)
Each question: { id, prompt, purpose, followUpHint }.
1. id "free_day": "It's a totally free Saturday — no work, no plans, nobody
   needs you. Walk me through your perfect day, from waking up to crashing."
   purpose: hobbies, energy level, homebody vs going out, solo vs social.
2. id "feed": "Open whatever app you scroll most. What's actually on your feed
   right now? Be honest — the 2am stuff counts."
   purpose: current interests, niche obsessions, humor/aesthetic.
3. id "market_scenario": "You arrive at the seaside market with a free
   afternoon. There's a fortune teller's tent, a packed food stall with live
   music, a quiet secondhand bookstall, and a little boat about to leave for an
   island nobody's explored. Where do you go first — and who, if anyone, are
   you dragging along?"
   purpose: openness, extraversion, spontaneity, social preference.
4. (optional, include behind a flag) id "want_to_try": "What's something
   you've been wanting to try but haven't, because you've got no one to do it
   with?"  purpose: direct matching signal for IRL plans.
Questions must be easy to add/remove/reorder without code changes elsewhere.

## Architecture (module boundaries matter more than UI)
/lib
  /ai/client.ts          – OpenAI SDK instance w/ Meta base URL + key; single place
  /ai/transcribe.ts      – interface Transcriber { transcribe(wav: Buffer): Promise<{text, durationMs}> }
                           + MuseTranscriber implementation
  /audio/toWav.ts        – webm/any → 16kHz mono s16 WAV via ffmpeg-static
  /onboarding/questions.ts
  /profile/schema.ts     – Zod ProfileSchema + exported JSON Schema; include schemaVersion
  /profile/prompt.ts     – system prompt + builder that formats Q&A pairs
  /profile/extract.ts    – extractProfile(answers): Promise<Profile>
                           (call LLM → JSON.parse → Zod validate → on failure retry
                           once, feeding the validation error back; then throw)
  /profile/answerQuality.ts – checkAnswer(question, transcript) → { ok, followUp? }
  /storage/profileRepo.ts – interface ProfileRepository { save(profile): Promise<{id}> }
                           + ConsoleFileRepository: pretty-prints to terminal AND writes
                           ./data/profiles/<id>.json (gitignored). Later: SupabaseRepository.
/app
  /api/transcribe/route.ts          – POST audio blob → { transcript }
  /api/onboarding/check/route.ts    – POST {questionId, transcript} → { ok, followUp? }
  /api/onboarding/extract/route.ts  – POST { answers[] } → { profile }
  /api/onboarding/confirm/route.ts  – POST { profile (user-edited) } → validate → repo.save
  /onboarding/page.tsx              – barebones UI
/scripts/extract-fixtures.ts – runs extractProfile on fixtures, prints results
/fixtures/answers/*.json     – sample answer sets (see Testing)

Rules: API routes are thin (parse → call lib → respond). No Muse calls from the
client. All AI/IO behind interfaces so they can be swapped/mocked.

## Profile schema (Zod) — fields
- schemaVersion: "1"
- displayName: string (entered in UI, not AI-generated)
- summary: 1–2 sentence friendly description, second person
- interests: array of {
    name: string            // specific, e.g. "bouldering", not "sports"
    category: enum [outdoors, fitness, arts_crafts, music, games, food_drink,
               media_entertainment, tech, learning, social_nightlife, wellness,
               fashion_beauty, travel, other]
    tag: string             // normalized lowercase kebab-case, for matching later
    evidence: string        // short quote from the user's answer
    confidence: number 0–1
  }
- wantsToTry: array of { name, tag, evidence }
- socialStyle: {
    energy: enum [homebody, balanced, out_and_about]
    groupSize: enum [one_on_one, small_group, big_group, flexible]
    planning: enum [spontaneous, flexible, planner]
    evidence: string
  }
- traits (Big Five-style, each { score: 1–5, confidence: 0–1, evidence }):
    openness, conscientiousness, extraversion, agreeableness, emotionalStability
- vibeType: { mbti: string (4 letters), label: string (playful nickname),
              confidence: number 0–1, disclaimer: "just for fun" }
- conversationStarters: string[] (2–4, grounded in their answers)
- residentFlavor: { marketStall: string, catchphrase: string }  // seaside theme hook
- lowSignalAreas: string[]   // what we couldn't infer, so later features can ask

## Extraction prompt requirements (lib/profile/prompt.ts)
- Input is transcribed speech: expect filler ("um", "like", "idk"), run-ons,
  self-corrections. Interpret generously, but DO NOT invent facts.
- Every interest/trait must be supported by an `evidence` quote from the answers;
  if there's no evidence, omit it (for interests) or give low confidence (for traits).
- Prefer specific over generic ("K-pop dance covers" > "music").
- Never infer sensitive attributes: health, religion, politics, sexuality,
  ethnicity, finances. Ignore them even if mentioned.
- Tone of summary/labels: warm, playful, never judgmental.
- Return only JSON matching the schema.

## Answer-quality follow-up (lib/profile/answerQuality.ts)
After each transcript, a cheap Muse Spark call decides if the answer is too thin
(e.g. "idk like night in? night out, sleeping time?"). If thin, return ONE short,
friendly follow-up question (e.g. "Ooh night in — what's the ideal night-in
setup? Movie, games, cooking, something else?"). The user may answer it (the
answer is appended to that question's transcript) or skip. Max 1 follow-up per
question. This must never block progress.

## Frontend (/onboarding) — barebones, functional
1. Enter display name.
2. For each question: show prompt → Record / Stop button (MediaRecorder) →
   upload → show transcript in an EDITABLE textarea (users fix mis-hearings) →
   optional follow-up question if returned → Next.
   Also allow "type instead" for every question (fallback if mic/transcription fails).
3. "Build my resident" → call extract → show loading.
4. Review screen (consent step): render the profile as readable cards. User can
   delete any interest / wantsToTry item, and edit summary. Show vibeType with
   its "just for fun" disclaimer. Button "Looks like me → Confirm".
5. Confirm → /api/onboarding/confirm → server logs the final profile to the
   terminal (pretty-printed) and writes the JSON file. Show "saved" + profile id.

## Error handling
- Mic permission denied → switch to typing for that question.
- Transcription failure/timeout → show error, keep the audio blob for retry, offer typing.
- Extraction: Zod fail → 1 retry with error feedback → else 502 with message; log raw output.
- Timeouts: 30s on LLM calls, 60s on transcription.
- Log per request: route, latency, token usage if returned (useful for demo/debug).

## Testing
- fixtures/answers/: at least 4 sets —
  (a) rich, detailed answers; (b) low-effort ("idk like night in? night out,
  sleeping time?"); (c) messy transcript with filler/self-corrections;
  (d) one that mentions a sensitive topic (must NOT appear in profile).
- `npm run extract:fixtures` runs extractProfile on each and prints the profiles,
  so we can iterate on the prompt without recording audio.
- Unit test: Zod schema rejects malformed output; toWav produces 16kHz mono s16
  (check with ffprobe or header parse).

## Acceptance criteria
- [ ] Record an answer in Chrome and Safari → transcript appears within ~5s for a 30s clip.
- [ ] Typing fallback works for every question.
- [ ] Thin answer triggers exactly one follow-up; skipping works.
- [ ] Extraction returns a schema-valid profile for all fixtures; every interest has evidence.
- [ ] Sensitive-topic fixture produces no sensitive fields.
- [ ] Confirmed profile prints to the terminal and is written to ./data/profiles/.
- [ ] Swapping ConsoleFileRepository for another repo requires changing one line.
- [ ] .env.example documents MODEL_API_KEY; README says how to run.

## Out of scope (do NOT build yet)
DB/auth, matching between users, island simulation, avatars/art, NFC, theming.

## Setup notes
- `.env.local`: MODEL_API_KEY=...
- deps: openai, zod, zod-to-json-schema, ffmpeg-static (+ types)
- Add data/ and .env.local to .gitignore.



## ADDENDUM (overrides earlier plan where it conflicts)

### Credit budget: $50 Meta Model API credits total — protect them
- Add env `AI_MODE=live|mock` (default mock in dev). Mock mode returns canned
  transcripts/profiles from /fixtures so the UI can be built without API calls.
- Cache: hash(model + prompt + input) → store response in ./data/cache/*.json;
  reuse on identical requests (dev only, env `AI_CACHE=true`).
- Log every live call: route, model, input/output tokens (from `usage`), latency.
  Keep a running total per server session and print it to the terminal.
- `npm run extract:fixtures` should support `--only <fixture>` so prompt
  iteration doesn't rerun every fixture.
- Keep the answer-quality check prompt short, and skip it when the transcript is
  above ~40 words (clearly not thin).

### ElevenLabs text-to-speech for questions
- Env: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID.
- `scripts/generate-question-audio.ts`: for each question in questions.ts, call
  ElevenLabs text-to-speech and save to /public/audio/questions/<id>.mp3.
  Skip if the file exists unless `--force`. Run once and commit the mp3s.
  Verify the endpoint, headers, and model id in the ElevenLabs docs before writing it.
- Add optional `audioSrc` to the question config; the UI auto-plays the prompt
  audio (with a replay button) and always shows the text too.
- Follow-up questions: `lib/tts/speak.ts` behind interface `Speaker`
  (ElevenLabsSpeaker + NoopSpeaker). New route POST /api/tts → audio/mpeg.
  If TTS fails, just show the text.
- ElevenLabs keys stay server-side only.

### Storage: MongoDB (sponsor track)
- Keep the ProfileRepository interface. Add `MongoProfileRepository`
  (official `mongodb` driver, Atlas free tier). Env: MONGODB_URI, MONGODB_DB.
- Select via env `STORAGE=console|mongo` (default console). Console mode still
  pretty-prints to the terminal; mongo mode ALSO prints, then inserts.
- Collection `profiles`: store the validated Profile plus
  { _id, createdAt, updatedAt, schemaVersion, rawAnswers: [{questionId, transcript}] }.
  Keep rawAnswers so profiles can be re-extracted later if the prompt changes.
- Indexes: `interests.tag`, `wantsToTry.tag` (future overlap queries).
- Keep the profile document flat and tag-normalized; later we may add embeddings +
  Atlas Vector Search for matching (NOT in this task).

### Updated .env.example
MODEL_API_KEY=
AI_MODE=mock
AI_CACHE=true
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
STORAGE=console
MONGODB_URI=
MONGODB_DB=

### Extra acceptance criteria
- [ ] With AI_MODE=mock, the whole flow works end-to-end with zero API calls.
- [ ] Terminal shows the running token/usage total for live calls.
- [ ] Question audio plays from static files; no TTS calls at page load.
- [ ] STORAGE=mongo inserts a document visible in Atlas; switching back to
      console needs only the env change.



### PWA / deployment (host-agnostic: Vercel first, maybe Vultr later)
- Target: mobile web PWA. No native app. CORS disabled (same origin).
- Must run unchanged via BOTH `vercel deploy` AND `next build && next start`
  on a plain Linux server. No Vercel-only APIs (no @vercel/kv, blob, edge runtime);
  all API routes use the Node.js runtime.
- ffmpeg path: use env FFMPEG_PATH if set (system ffmpeg on a VPS), else ffmpeg-static.
  Verify ffmpeg-static works in a Vercel preview deploy EARLY.
- Set explicit `maxDuration` on /api/transcribe and /api/onboarding/extract
  (ignored on a VPS, needed on Vercel).
- Filesystem use (cache, ConsoleFileRepository) is enabled only when env
  WRITABLE_FS=true (local dev / VPS). Otherwise AI_CACHE is off and STORAGE must be mongo.
- All config via env vars; document every one in .env.example.
- Add a Dockerfile (node LTS + ffmpeg) so a VPS deploy is `docker compose up`
  behind Caddy for HTTPS. Low priority — do it last.