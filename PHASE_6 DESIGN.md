# Feature: AI Fish Recommendations ("fish you might vibe with")

## Context
READ THE EXISTING CODE FIRST: profile schema/repo, pairs/meetAttempts, the meet
analysis prompt + hallucination guard + score.ts, fish creator (onboarding + /me),
/world layout (sky/ocean extensions), FishSprite, AI_MODE mock, usage logging.
Goal: suggest people you haven't met who share interests, so you go find them
IN PERSON and tap their NFC tag. No messaging, no waves, no anonymity, and NO
percentage or numeric match score anywhere in the UI (it reads like dating).

## Consent (opt-in)
- Add to profile: discoverable: boolean (default false), discoverableUpdatedAt.
- Onboarding fish-creator page (while the profile is generating): an UNCHECKED
  checkbox:
  "🐟 Suggest me to other fish — they'll see my name and the interests we share."
  Saved with /api/onboarding/confirm. Not required to continue.
- /me: same toggle, editable anytime (PATCH /api/users/:id/discoverable).
  Changing it must NOT change the profile field used in the pair AI cache key.
- Missing field (existing users) = false.
- Reciprocal: you only SEE suggestions if you are discoverable yourself. If not,
  the world shows a small prompt: "Turn on suggestions in your profile to see
  fish you might vibe with."

## Candidate rules (lib/recs/candidates.ts, unit-tested)
Candidates for user U = all users where:
- discoverable === true, not U,
- no pair doc with U that has a non-cooldown meetAttempt (i.e. not met yet),
- (seed users allowed only when not in production OR DEMO_MODE).

## Recommendation call (1 AI call per user, cached)
- Input: U's trimmed profile (interests name/category/tag, wantsToTry,
  socialStyle) + for each candidate: { candidateId, interests (name, tag),
  wantsToTry } — NO names, summaries, or raw answers.
  If there are more than MAX_CANDIDATES_IN_PROMPT (default 150), prefilter by
  category/tag overlap first.
- Output (structured): top N (default 5):
  [{ candidateId, sharedInterests: [{ aTag, bTag, label,
       strength: "same"|"close"|"loose" }],
     bridges: [{ fromUser: "me"|"them", wantsToTryTag, matchedInterestTag, label }],
     teaser: string }]   // one short friendly line, e.g.
                         // "Also has strong opinions about gacha pulls 🎮"
  Rules: real overlaps only (no "stretch" here), semantic matching allowed,
  no sensitive topics, teaser must be about shared interests, never about
  looks, dating, or personality judgments.
- Validate with the SAME hallucination guard as the meet analysis; drop invalid
  items; drop candidates left with zero shared items.
- Rank internally with score.ts (same weights). The score is used for ordering
  only and is NEVER sent to the client.
- Cache in collection `recommendations`:
  { userId, results, candidatePoolHash, promptVersion, createdAt }
  Recompute only if (poolHash changed OR U's profile content changed) AND the last
  run was > REC_MIN_REFRESH_MINUTES (default 30) ago. Otherwise serve the cache,
  filtering out anyone met since or no longer discoverable (no AI call).
- Budget guard: max REC_CALLS_PER_USER_PER_DAY (default 5). Log usage like other routes.
- Fallback on AI failure: exact tag overlap only, teaser from template
  ("You both like {label}!").
- Nice-to-have: when two recommended users later meet, pass the cached
  sharedInterests into the meet analysis prompt as a hint.

## API
GET /api/recommendations?userId=<me>
→ { enabled: boolean,                  // false if I'm not discoverable
    fish: [{ id, displayName, appearance, sharedInterests: [{label}],
             bridges: [{label}], teaser }] }   // sorted, no scores
Only SHARED interests are returned, never the other person's full profile.

## UI (/world)
- Recommended fish swim in the OCEAN band below the island (the extended ocean
  area on phones; a thinner band on laptop): their FishSprite, slightly greyed and
  semi-transparent, name above the head, gentle bob + slow drift, staying in the water.
- Tap → bottom sheet (mobile) / card (desktop), same style as the friend popup:
  name, fish sprite, "You both like: [chips]", bridge line if any
  ("They play Valorant — you wanted to try it!"), teaser, and
  "Find {name} and tap their tag to bring them to your island 🌊".
  No numbers, no percentages, no buttons that contact them.
- A "🐠 Fish you might vibe with (5)" button at the bottom of the ocean opens the
  same cards as a list (easier than tapping moving fish; good for the demo video).
- After an in-person meet with a recommended fish: remove them from the ocean and
  play the existing "new friend swims in" entrance onto the sand.
- Not discoverable → no ocean fish, show the prompt instead.
- Responsive: 360px → desktop; tap targets ≥ 44px.

## /me additions
- Friend count under the fish: "🐟 {friends} fish friends · {strangers} just met"
  (own profile only, never shown to others).
- Discoverable toggle (see Consent).

## Testing
- Seed: all seed users discoverable; enough variety that the real user gets 3–5
  suggestions with different overlaps (incl. one bridge-only).
- Unit: candidate rules (met/non-discoverable/self excluded), reciprocity,
  hallucination guard on rec output, cache reuse + filtering, score never
  appears in the API response.
- CLI: `npm run recs -- <userId> [--force]` prints suggestions + usage.
- Mock mode: canned suggestions.

## Acceptance criteria
- [ ] Consent checkbox on the creator page is unchecked by default and saved;
      toggle on /me works; existing users are not discoverable until they opt in.
- [ ] Ocean shows up to 5 named, greyed fish; tap → card with shared interests only.
- [ ] No percentages or scores anywhere in UI or API responses.
- [ ] Opening /world repeatedly doesn't trigger new AI calls within the refresh window.
- [ ] Meeting a recommended fish in person moves them from ocean to island.
- [ ] Friend count shows on /me only.