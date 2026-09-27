# Feature: AI Fish Recommendations ("Find fish")

## Context
READ THE EXISTING CODE FIRST: profile schema/repo (incl. contentUpdatedAt),
pairs/meetAttempts, the meet analysis prompt + hallucination guard + score.ts,
fish creator (onboarding + /me), /world layout (sky/ocean extensions, the
"tap a fish to see your story together" hint), FishSprite, AI_MODE mock,
usage logging.

Goal: suggest up to 3 people you haven't met who share interests, so you go
find them IN PERSON and tap their NFC tag. Names are shown (not anonymous).
NO messaging, NO waves, NO percentages or numeric scores anywhere (reads like
dating), NO recommended fish rendered in the world, NO entrance animations.

## Consent (opt-in)
- Profile fields: discoverable: boolean (default false), discoverableUpdatedAt.
- Onboarding fish-creator page (both quick and full mode, shown while the
  profile generates): an UNCHECKED checkbox:
  "🐟 Suggest me to other fish — they'll see my name and the interests we share."
  Saved via /api/onboarding/confirm. Not required to continue.
- /me: same toggle, editable anytime (PATCH /api/users/:id/discoverable).
  Must NOT change contentUpdatedAt (no pair AI cache reset).
- Missing field (existing users) = false.
- Reciprocal: you only SEE suggestions if you are discoverable yourself.

## Candidate rules — replace
Candidates for user U = all users where:
- discoverable === true, and not U,
- no pair doc with U that has a non-cooldown meetAttempt (not met yet).
(No seed-user logic. Do not add or rely on seed users anywhere.)

## Testing — replace
- NO seed script and no seed users in the database.
- Unit tests use in-memory fixture profiles only (never written to Mongo):
  a strong-overlap profile, a bridge-only profile, and a nothing-in-common
  profile (must NOT be suggested). Cover candidate rules, reciprocity,
  hallucination guard, text checks, REC_MAX, cache reuse, no score in response.
- Mock mode (AI_MODE=mock): canned suggestions, including a 0-result case,
  so the UI works without real users or AI calls.
- Manual testing: create 2–3 real test accounts via Quick setup onboarding
  (opt in to suggestions), then check "Find fish" from each.
- CLI: `npm run recs -- <userId> [--force]` prints suggestions + usage.

## Recommendation call (1 Muse Spark call per user, cached)
Input: U's trimmed profile (interests name/category/tag, wantsToTry) + for each
candidate { candidateId, interests (name, tag), wantsToTry }. NO names,
summaries, raw answers, or traits. If more than MAX_CANDIDATES_IN_PROMPT
(default 150), prefilter by category/tag overlap first.

Prompt (include good/bad examples):
"""
You suggest people a user might enjoy meeting IN PERSON. Friendly, like a
classmate saying "oh you should talk to them" — never romantic or dating-like.

Input: ME (interests, wantsToTry) and CANDIDATES (id, interests, wantsToTry).
Return UP TO 3 candidates, best first. Return fewer — or none — if nobody
shares something real. Never pad the list.

For each candidate:
- sharedInterests: real overlaps only (same / close / loose). Semantic matches
  are fine ("honkai-star-rail" ~ "gacha-games"). No stretches.
- bridges: where one person's wantsToTry matches the other's interest
  (either direction). label ≤ 12 words, second person, e.g.
  "They play Valorant — you've wanted to try it!"
- teaser: ONE line, ≤ 12 words, about a specific shared thing. Playful,
  concrete, may suggest a tiny opener. No names, no comments on personality
  or looks, no "perfect match", no "cozy" unless the user said it, nothing
  about beds, dates or romance.

Every item must cite real tags from the correct person's profile.
"""
Good teasers: "Also does the daily Mini Cryptic — compare streaks?",
"Another NYT games person. Brace for Connections debates.",
"Knows the good skewer stall. Ask them."
Bad: "You two would be perfect together!", "A cozy soul who loves games!",
"Seems like a very kind person".

Output schema (structured):
[{ candidateId,
   sharedInterests: [{ aTag, bTag, label, strength: "same"|"close"|"loose" }],
   bridges: [{ fromUser: "me"|"them", wantsToTryTag, matchedInterestTag, label }],
   teaser }]

## Validation & ranking
- Same hallucination guard as meets: drop items whose tags don't exist in the
  correct profile; drop candidates with no remaining shared interest or bridge.
- Text checks: drop teasers/labels over 12 words or containing banned words
  (date, perfect match, soulmate, bed, cozy — unless "cozy" appears in the
  user's own text); replace with template "You both like {label}!".
- Rank with score.ts (same weights as meets). REC_MAX = 3; 0–3 results is fine.
  The score is for ordering only and is NEVER sent to the client.

## Caching & budget
- Collection `recommendations`:
  { userId, results, candidatePoolHash, promptVersion, createdAt }
- Recompute only if (poolHash changed OR U's contentUpdatedAt changed) AND the
  last run was > REC_MIN_REFRESH_MINUTES (default 30) ago. Otherwise serve the
  cache, filtering out anyone met since or no longer discoverable (no AI call).
- Max REC_CALLS_PER_USER_PER_DAY (default 5). Log usage like other routes.
- AI failure fallback: exact tag overlap only, template teaser.
- Nice-to-have: when two recommended users later meet, pass cached
  sharedInterests into the meet analysis prompt as a hint.

## API
GET /api/recommendations?userId=<me>
→ { enabled: boolean,              // false if I'm not discoverable
    fish: [{ id, displayName, appearance,
             sharedInterests: [{ label }], bridges: [{ label }], teaser }] }
Sorted, max 3, no scores. Only SHARED interests are returned — never the other
person's full profile.

## UI (/world) — "Find fish" button
- NO recommended fish rendered in the ocean or on the island.
- One button: icon = the plain base fish sprite, greyed out (grayscale +
  ~60% opacity); label "Find fish"; small count badge (1–3) when there are
  suggestions.
  - Tall ocean (typical phones): place it in the ocean area ABOVE the
    "tap a fish to see your story together" hint.
  - Short ocean (typical laptops): place it BESIDE that hint on the same row.
  - Decide by available ocean height, not viewport width alone.
  - Tap target ≥ 44px.
- Tap → bottom sheet (mobile) / centered card (desktop), same style as the
  friend popup, with up to 3 cards:
  FishSprite (with their accessories), name, "You both like: [chips]",
  bridge line if any, teaser, and "Find {name} and tap their tag 🌊".
  No numbers, no percentages, no contact buttons.
- Empty state (0 recs): "No new fish to suggest right now — check back later 🐟".
- Not discoverable: "Turn on suggestions in your profile to see fish to meet"
  + link to /me.
- After an in-person meet, that person is removed from recs and appears on the
  island like any other resident. NO special animation.

## Remove: new-friend entrance animation (world)
- Delete the "new friend swims in from the screen edge" entrance entirely.
- /meet's "Back to island" links to plain /world (drop ?new=<id> and any code
  reading it). New fish spawn at a random point in the walkable area like
  everyone else. Remove related code/config/tests if already implemented.

## /me additions
- Friend count under the fish: "🐟 {friends} fish friends · {strangers} just met"
  (own profile only, never shown to others).
- Discoverable toggle (see Consent).

## Testing
- Seed: all seed users discoverable; variety so the real user gets 0–3
  suggestions incl. one bridge-only match and one user with nothing in common
  (must NOT be suggested).
- Unit: candidate rules (met / non-discoverable / self excluded), reciprocity,
  hallucination guard, text checks (length + banned words), REC_MAX, cache
  reuse + filtering, score never in API response.
- CLI: `npm run recs -- <userId> [--force]` prints suggestions + usage.
- Mock mode: canned suggestions (incl. a 0-result case).

## Acceptance criteria
- [ ] Consent checkbox unchecked by default and saved; /me toggle works;
      existing users are not discoverable until they opt in.
- [ ] At most 3 suggestions; fewer or none when there's no real overlap.
- [ ] Teasers are short, specific, friendly; none contain banned words.
- [ ] "Find fish" button sits above the hint on tall oceans and beside it on
      short ones; opens the sheet/card with correct empty/disabled states.
- [ ] No percentages or scores anywhere in UI or API responses.
- [ ] Repeated /world visits don't trigger AI calls within the refresh window.
- [ ] Meeting a suggested fish removes them from suggestions; they appear on
      the island with no special animation. No ?new param anywhere.
- [ ] Friend count shows on /me only.