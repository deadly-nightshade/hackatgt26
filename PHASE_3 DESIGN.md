# Feature: My Fish World (home screen with wandering friend fish)

## Context
Existing app: Next.js + TS, MongoDB, Muse Spark. Onboarding and the /meet cutscene
(pairs, meetAttempts, levels, hangouts) already exist. READ THE EXISTING CODE FIRST:
data models, repositories, the /meet cutscene component, level config, AI_MODE mock.
Fish sprite art and the seaside background are ALREADY IN THE REPO — find and use
them (check /public). Every fish uses the default fish sprite for now.

This feature adds NO new per-view AI calls. Everything in the world is read from
data that already exists (or is generated inside the existing meet dialogue call).

## What the user sees (/world — becomes the home screen)
- The seaside background with MY fish plus every fish I've met.
- Each fish has its displayName above its head and wanders around randomly.
- When two fish bump into each other they stop, face each other, and exchange
  2–3 very short speech bubbles (≤ 4 words each), then carry on.
- Tapping another fish opens a cute popup card: name, friendship level, and a
  history list of past cutscenes, each replayable. It also has a "Swim over" button:
  my fish walks to that fish and they do a bump exchange (for the demo).
- Tapping my own fish shows a small card with my name and my resident catchphrase.

## Who appears (STRICT)
- ONLY me + fish I have personally met via an NFC meet: users with a `pairs` doc
  where userIds includes me AND at least one non-cooldown meetAttempt exists.
  Includes friends AND clammed-up strangers ("Just met", slightly transparent).
- NEVER show other users, including my friends' friends. /api/world must not
  return anyone outside this set; friend-to-friend bumpLines are only returned
  for pairs where BOTH fish are already in my set.
- Put this rule in one function (getResidentsFor(userId)) with a unit test.

## Popup card — add:
- No "try again" / "meet" button anywhere in the world. Meets and retries happen
  ONLY by tapping the person's NFC tag in person. For strangers, show the hint:
  "Tap their tag next time you see them to try again 🌊".

## Data changes
1. meetAttempts: add
   { kind: "first_meet"|"hangout"|"clammed_up"|"cooldown",
     script: DialogueLine[],   // EXACT lines shown, snapshot at play time
     levelAfter: number, levelNameAfter: string }
   Update POST /api/meet to save these. Old attempts without `script` show as
   "replay unavailable" in history (no backfill needed).
   Cooldown attempts are saved but hidden from history.
2. pairs: add `bumpLines: [{ a: string, b: string }]` (5–8 exchanges, each side ≤ 4
   words, e.g. { a: "honkai star rail?", b: "gaming!!" }, { a: "skewers later?",
   b: "always 🍢" }). Generate them INSIDE the existing dialogue AI call #2 (extend
   its schema). Same content rules as other dialogue. No extra model call.
   Fallback when missing (older pairs, AI failure): build from validated
   sharedInterests labels via templates:
   a: "{label}?"  b: one of ["same!!", "yesss", "omg me too", "fin-tastic!"].
3. Friend-to-friend bumps (two of MY friends who may not have met each other):
   if a pair doc exists between them, use their bumpLines; otherwise use generic
   bubbles: ["blub!", "hi hi", "👋", "nice fins", "sea you!"].
   This never triggers a real meet or any AI call.

## API
- GET /api/world?userId=<me>
  → { me: { id, displayName, catchphrase },
      residents: [{ id, displayName, status, level, levelName, lastMetAt }],
      bumpLines: { [pairKey]: {a,b}[] } }   // me↔resident and resident↔resident
                                            // pairs that exist, fallback applied
  One or two Mongo queries (pairs where userIds includes me; then pairs where
  both ids are in the resident set). No AI.
- GET /api/pairs/:pairKey/history?userId=<me>
  → [{ attemptId, kind, createdAt, levelNameAfter, hasScript }]  newest first.
  403 if userId is not in the pair.
- GET /api/attempts/:attemptId?userId=<me> → { script, kind, createdAt, names }
  403 if requester not in the pair.
- Mock mode: canned world with ~5 residents, history, and scripts.

## World simulation (client, lib/world/)
- Coordinates are normalized (0..1) in a fixed virtual world; convert to pixels
  from the rendered background size. Check the background image's aspect ratio
  and keep it (no stretching); fit to the viewport and center it.
- Walkable area: a rectangle (or simple polygon) in config, in normalized coords,
  tuned to the sand/boardwalk region of the background.
- Rendering: absolutely-positioned DOM elements with CSS transforms (easy clicking,
  fine for ≤ 20 fish). One requestAnimationFrame loop in a hook; positions kept in
  refs, NOT React state per frame. Flip the sprite horizontally based on direction.
  Add a small bob (CSS animation) while walking.
- Wander behavior per fish: pick a random target in the walkable area → move at a
  constant speed (small random variation per fish) → pause 1–3s → repeat.
- Bump: when two fish are within BUMP_DISTANCE and both are free (not in an
  exchange, not in cooldown) → both stop, face each other, show bubbles:
  pick one bumpLines entry at random; a's bubble 1.2s, then b's bubble 1.2s,
  optionally a second exchange (50% chance). Then each fish gets a
  BUMP_COOLDOWN (~8s) and resumes wandering. Max MAX_CONCURRENT_BUMPS (2) at once.
- "Swim over": my fish gets that fish as its target (the target fish pauses);
  on arrival force a bump exchange immediately, ignoring cooldowns.
- Pause the loop when the tab is hidden. prefers-reduced-motion → fish stay mostly
  still with occasional small moves; bumps still work via "Swim over".
- All tuning constants in lib/world/config.ts.
- Names: small readable label above each fish (≥ 12px, text shadow/outline for
  contrast on the background). My fish's label is highlighted ("You").

## Popup card (tap a fish)
- Bottom sheet on mobile, centered card on desktop. Close via X, tap outside, or Esc.
- Shows: name, level name + level indicator (e.g. 🐚🐚⚪⚪ for level 2 of 4),
  hangout count, "Friends since {date}" (or "Just met" for strangers).
- Buttons: "Swim over 🐟" (closes the card, my fish swims over).
- History: list of past cutscenes (kind icon + label + relative date, e.g.
  "✨ First meet · 2 days ago", "🎮 Hangout · Level up to Reel Friends").
  Tap an item → replay in a modal using the SAME cutscene player component as
  /meet (refactor it into a shared component if needed). Replays only read the
  saved script. They never call /api/meet, never roll, never change levels.
  hasScript=false → item disabled with "replay unavailable".

## Responsiveness
- 360px phone to desktop. Background fits the viewport; the world scales with it.
- Tap targets ≥ 44px (add an invisible hit area around small fish).
- 100dvh, safe-area insets, no horizontal scroll.

## Testing
- Seed: extend `npm run seed:fish` so the real user has ~5 residents with a mix of
  levels, one stranger, several attempts with saved scripts, and one pair between
  two residents (to test friend-to-friend bumpLines).
- Unit tests: wander target stays inside the walkable area; bump detection;
  resident selection rule; history ordering; 403 checks.
- Manual: /dev/whoami → pick user → /world.

## Acceptance criteria
- [ ] /world shows me + all met fish, wandering, with names above heads.
- [ ] Bumps show ≤ 4-word bubbles from bumpLines (or fallback), then fish resume.
- [ ] Tap fish → card with name, level, history; "Swim over" triggers an exchange.
- [ ] Replays show the exact saved script and change nothing in the DB.
- [ ] Opening /world makes zero AI calls; the meet flow makes no extra AI calls
      (bumpLines come from the existing dialogue call).
- [ ] Smooth on a mid-range phone with ~10 fish; works on laptop.
- [ ] After a meet, "Back to island" → /world with the new friend swimming in.

## Out of scope
Custom fish appearances, fish-specific idle animations beyond walk/bob, chat,
notifications, triggering real meets from the world (meets only happen via NFC tap).