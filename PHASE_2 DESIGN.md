# Feature: Fish Meet-Up Interaction (NFC tap → AI friendship cutscene)

## Context
Hackathon social website (Next.js + TS, MongoDB, Muse Spark via the OpenAI-compatible
SDK). Onboarding already exists and stores user profiles in MongoDB.
READ THE EXISTING CODE FIRST: profile schema (Zod), AI client, storage repository
pattern, AI_MODE mock/live, cache, usage logging, env conventions. Reuse them;
don't duplicate.

Each user is a fish resident at a seaside market. Each user has an NFC tag holding
a URL like https://<domain>/meet/<userId>. When A taps B's tag with their phone,
the browser opens that URL, A's id is read from localStorage, and a
Tomodachi-Life-style "friend-making cutscene" plays: the two fish chat about
what they have in common, then either become friends or "clam up" (random,
retryable).

Scope: mostly BACKEND. Frontend = barebones: two rectangles (one per fish) with
names above them, facing each other, and a dialogue box underneath that you
tap/click to advance. Must work on phone AND laptop widths. No art, no animation.

## Credit budget
Only ~$50 Meta credits total. Each pair costs 2 model calls ONCE (analysis +
dialogue), cached in Mongo. Retries and re-taps make ZERO model calls. Mock mode
(AI_MODE=mock) must cover this whole feature with zero API calls.

## Identity (plain website, no auth — hackathon)
- localStorage key `fishId`, set at the end of onboarding (add if missing).
- /meet/[targetId] with no fishId → redirect to /onboarding?returnTo=/meet/<targetId>;
  after onboarding completes, set fishId and redirect back to returnTo.
- fishId === targetId → "That's your own tag, silly fish!" screen.
- targetId not found → friendly not-found screen.
- Dev-only page /dev/whoami (disabled when NODE_ENV=production): list users,
  click to set localStorage identity, plus links to /meet/<id> for each other user.

## Data model
`pairs` collection:
{
  _id, pairKey,                    // `${minId}__${maxId}` — unique index
  userIds: [idA, idB],
  analysis: Analysis,              // validated
  similarity: number,              // 0..1
  dialogue: { friendsLines: DialogueLine[], clammedUpLines: DialogueLine[] },
  status: "strangers" | "friends",
  friendsSince?: Date,
  promptVersion, model, profilesUpdatedAt: [dateA, dateB], createdAt
}
`meetAttempts` collection:
{ _id, pairKey, initiatorId, outcome, pFail, roll, createdAt }   // index pairKey

- Cache validity: pairKey + promptVersion + both profiles' updatedAt. If any
  changed, regenerate analysis + dialogue (status/friendsSince are preserved).
- `?regenerate=1` allowed only in dev.
- Add Mongo + console implementations following the existing repository pattern.

DialogueLine = { speaker: "a" | "b" | "narrator", text: string,
                 mood: "neutral"|"happy"|"excited"|"shy"|"sad" }
(mood is for future sprite animation; the frontend ignores it for now.)

## Pipeline: POST /api/meet { initiatorId, targetId }
1. Load both profiles (404 if missing).
2. If pair status is "friends" → return the "already_friends" script (template
   only, no AI, no roll). Log an attempt.
3. Get or create the cached pair (steps 4–8 run only on a cache miss).
4. Build a TRIMMED view per user for the AI: displayName, interests (name,
   category, tag), wantsToTry, socialStyle, residentFlavor, summary.
   Do NOT send rawAnswers or trait scores (saves tokens, avoids judgmental dialogue).
5. AI call #1 — Analysis (structured output):
   {
     sharedInterests: [{ aTag, bTag, label,
                         strength: "same"|"close"|"loose"|"stretch", why }],
     bridges: [{ fromUser: "a"|"b", wantsToTryTag, matchedInterestTag, label }],
        // A wants to try X and B already does X (or vice versa)
     styleNotes: { energyMatch: boolean, note: string },
     spotlight: string            // the single best thing to talk about
   }
   Prompt rules:
   - Semantic matching is the point ("honkai-star-rail" ~ "gacha-games" = close).
   - MUST return at least one connection. If there is no real overlap, invent a
     playful but GROUNDED "stretch" linking one real item from A's profile to one
     real item from B's (e.g. "desserts-and-meat-skewers" + "gym-meal-prep" →
     "you both take food very seriously").
   - Every item cites real tags from the correct profile. No invented facts.
   - No sensitive topics.
6. VALIDATE in code (hallucination guard): drop any sharedInterest/bridge whose
   aTag/bTag/wantsToTryTag/matchedInterestTag doesn't exist in the correct user's
   profile. Log dropped items. If everything was dropped, retry once with the
   error fed back; if still empty, fall back (see Fallbacks).
7. SCORE (lib/meet/score.ts, pure function, unit-tested):
   points: same=3, close=2, loose=1, stretch=0.5 per shared interest
           (interest points capped at 9); bridge=+3 each (cap 6); energyMatch=+1.
   similarity = min(points / 10, 1).
8. AI call #2 — Dialogue middles, BOTH variants in one call (structured output):
   { friendsLines: DialogueLine[3–6], clammedUpLines: DialogueLine[3–6] }
   Input: names, validated overlaps, spotlight, bridges, residentFlavor catchphrases,
   pun bank.
   - friendsLines: the fish chat happily about their REAL overlaps.
   - clammedUpLines: shy/awkward, but still touching on the spotlight
     connection, ending hopeful.
   Rules: lines ≤ 90 chars, casual, each fish sounds a bit like their profile,
   at most 2 fish puns per variant, never mention scores, MBTI, traits, or
   anything negative about a person.
   Save the pair.
9. ROLL (lib/meet/roll.ts, pure + unit-tested; Math.random injectable for tests):
   pFail = clamp(BASE_FAIL + SIM_FAIL * (1 - similarity), MIN_FAIL, MAX_FAIL)
   pity:  pFail *= 0.5 ^ (failed attempts for this pair since last success)
   outcome = roll < pFail ? "clammed_up" : "friends"
   Defaults: BASE_FAIL=0.05, SIM_FAIL=0.35, MIN_FAIL=0.05, MAX_FAIL=0.40.
   All constants in one config file.
   Demo override: env FORCE_MEET_OUTCOME=friends|clammed_up, honored only when
   NODE_ENV !== production OR DEMO_MODE=true.
10. On "friends": set pair status = "friends", friendsSince = now.
    Log a meetAttempt either way.
11. ASSEMBLE the script from templates + cached dialogue (see Templates). Return.
    Log usage/cost like the existing routes.

Response:
{ pairKey, outcome: "friends"|"clammed_up"|"already_friends",
  script: DialogueLine[], similarity, attemptNumber,
  debug?: { pFail, roll, analysis } }   // debug only in dev

## Templates (lib/meet/templates.ts)
Several variants per beat, chosen deterministically from a hash of pairKey +
attemptNumber (so replays are stable but retries feel slightly different).
Placeholders: {a}, {b}, {spotlight}, {plan}.
- intro (narrator): "{a} swam over to {b}'s stall…",
  "{a} and {b} bumped fins at the market!"
- suspense (narrator): "…", "The tide goes quiet…"
- friends outcome: "Reel friends! 🐟", "Shell we be friends? …Yes!",
  "{a} and {b} are o-fish-ally friends!"
  + plan line from spotlight/bridge, e.g.
  "{b} knows the esports lounge — go play Valorant together?"
- clammed_up outcome: "Aw, they got too different interests! They got shy and
  clammed up." + "But they both {spotlight}… maybe next tide? 🌊"
- already_friends: "{a} and {b} wave fins — they're already reel friends!"
  + plan line.
Script order:
- friends:     intro → friendsLines → suspense → friends outcome → plan line
- clammed_up:  intro → clammedUpLines → suspense → clammed_up outcome
- already_friends: template lines only
Pun bank constant (for templates, also passed to the AI as allowed puns):
reel friends, shell we, clammed up, o-fish-ally, fin-tastic, water you up to,
sea you around, you're kraken me up, let minnow, cod you believe it, same school.

## Fallbacks (the cutscene must never hard-fail)
If either AI call fails after 1 retry: use exact tag matches only for scoring,
spotlight = first exact match or "love the seaside market", and template-only
middle lines (e.g. "{a}: So… water you up to?" / "{b}: Just blubbing about the
weather."). Do NOT cache fallback results as the pair's analysis; retry AI next time.

## Other routes
- GET /api/users/:id/public → { id, displayName } (for the pre-cutscene screen).
- GET /api/pairs?userId= → that user's pairs + status (for a future friends list; minimal).

## Frontend: /meet/[targetId]
1. Resolve identity (localStorage fishId → else redirect to onboarding w/ returnTo).
2. Show both fish immediately (names from /public); dialogue box shows
   "{a} is swimming over…" while POST /api/meet runs.
3. Layout (per sketch): names above two rectangles facing each other, dialogue
   box below spanning the width. Tap/click the dialogue box (or Space/Enter) →
   next line. Show the speaker's name in the box; highlight the speaking fish.
4. End screen: outcome text + buttons. clammed_up → "Try again" (re-POST, new roll).
   friends / already_friends → "Replay" and "Back to island".
Responsive: 360px phone to desktop; on wide screens constrain to a ~480px centered
column. Use 100dvh, safe-area insets, 16px+ text, big tap targets.

## Testing
- Seed script `npm run seed:fish`: inserts ~5 labeled seed users (isSeed: true)
  to test against the existing real profile:
  (1) strong overlap (gacha games + puzzles), (2) close-only overlap,
  (3) bridge-only (plays Valorant, nothing else shared), (4) zero overlap
  (outdoorsy gym rat → must still get a grounded stretch), (5) near-identical twin.
  Idempotent; `--clear` removes seeds (and their pairs/attempts).
- Unit tests: score.ts, roll.ts (inject RNG), hallucination guard, template
  determinism, pairKey ordering.
- Simulation test: 1000 rolls at similarity 0 → first-attempt failure ≈ MAX_FAIL,
  lower on later attempts (pity).
- CLI `npm run meet:pair -- <idA> <idB> [--attempts N]`: runs the pipeline and
  prints analysis, similarity, pFail, and script to the terminal (respects
  AI_MODE and cache).
- Mock mode: canned analysis + both dialogue variants so the UI works offline.

## Acceptance criteria
- [ ] /meet/<id> works at 360px and on a laptop; tap/click/keyboard advance.
- [ ] First meet of a pair = 2 model calls; every retry/re-tap = 0 model calls.
- [ ] Outcome can differ between attempts; pity makes success more likely.
- [ ] Once friends, always "already_friends" with no roll.
- [ ] Invented overlaps are dropped; zero-overlap pair still gets a grounded stretch.
- [ ] No identity → onboarding → returns to the meet page. Self-tap and unknown id handled.
- [ ] AI failure → template-only cutscene still plays.
- [ ] FORCE_MEET_OUTCOME works only in dev/demo mode; /dev routes off in production.
- [ ] Usage totals logged.

## Out of scope
Sprites/animation, friends list UI, notifications, real auth, home-screen PWA
install, NFC writing (tags are written manually with a phone app such as
NFC Tools, URL only).


## STRETCH: Hangouts + friendship levels (build AFTER the core meet flow works)

### Concept
A re-tap between friends means they're physically together again → it counts as a
"hangout", which levels up the friendship and plays a new scene. Mirrors
Tomodachi Life's relationships growing over time.

### Levels (config file)
level 1 "Friends"        (on first successful meet)
level 2 "Good Friends"   (after 1 hangout)
level 3 "Close Friends"  (after 3 hangouts)
level 4 "Best Fishes"    (after 6 hangouts) — max
Thresholds are hangout counts, configurable.

### Data model additions (on `pairs`)
{
  level: number, hangoutCount: number, lastHangoutAt?: Date,
  hangoutScenes: [{ id, topic, lines: DialogueLine[], usedAt?: Date }],
  sceneBatchesGenerated: number
}
meetAttempts.outcome gains: "hangout" | "cooldown".

### Cooldown
HANGOUT_COOLDOWN_MINUTES in config (default 60; demo mode may use 1).
Re-tap by friends:
- within cooldown → outcome "cooldown": template line only
  ("You two just hung out! Sea you later 🌊"), no level change, no AI.
- after cooldown → outcome "hangout": hangoutCount++, recompute level,
  lastHangoutAt = now, play the next unused scene.

### Scene generation (credit-capped)
- When a pair FIRST becomes friends: one AI call (structured output) generates
  3 hangout scenes, each 4–6 DialogueLines, each about a DIFFERENT validated
  shared interest, bridge, or the spotlight. Scenes should feel like the fish
  doing the thing together (e.g. at the esports lounge, solving the daily
  crossword), with ≤ 2 puns per scene and the same content rules as other dialogue.
  Generate this lazily on the first hangout if not already present, so a pair
  that never hangs out costs nothing.
- Scenes play in order; mark usedAt.
- When all scenes are used: generate 3 more ONLY if the level increased since the
  last batch (cap: sceneBatchesGenerated ≤ number of levels). Otherwise cycle
  through existing scenes.
- AI failure → template-only hangout lines ("{a} and {b} spent the afternoon
  {spotlight}!"). Still counts as a hangout.

### Script assembly
- hangout: intro ("{a} and {b} met up again!") → scene lines →
  if level increased: "✨ {a} and {b} are now {levelName}! ✨" → plan line.
- cooldown: single template line.
- The first successful meet ends with "Level 1: Friends".

### API
POST /api/meet response outcome adds "hangout" | "cooldown", plus
{ level, levelName, leveledUp: boolean, hangoutCount }.
GET /api/pairs?userId= includes level/levelName for a future friends list.

### Frontend
End screen shows the current level name; show a simple "Level up!" line when leveledUp.

### Tests / acceptance
- [ ] Re-tap within cooldown → "cooldown", zero model calls, no level change.
- [ ] Re-tap after cooldown → "hangout", level progresses per thresholds.
- [ ] First hangout triggers exactly 1 scene-generation call; next 2 hangouts = 0 calls.
- [ ] Scene batches never exceed the cap.
- [ ] CLI `meet:pair` supports `--hangouts N --ignore-cooldown` to simulate progression.
- [ ] Demo mode cooldown can be set short so levels can be shown in the video.
