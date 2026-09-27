# Feature: Fish Customization (character creator + profile editing)

## Context
READ THE EXISTING CODE FIRST: onboarding flow (questions → extract → review →
confirm), profile schema/repository, /world rendering, /meet cutscene, AI cache
keys, AI_MODE mock.
Art is in the repo (find it, likely /public): one fish BASE image and 5 HEAD
accessory images. Every accessory PNG is the SAME pixel size as the base and
already positioned, so it's a pure overlay: stack at (0,0), same box.
FEET accessories don't exist yet — build the slot fully so dropping files in
later just works.

## Step 0 — asset check
- List the base + head files; verify every overlay has exactly the base's
  dimensions and transparency. Report any mismatch.
- Create lib/fish/appearance.ts (shared by client AND server):
  SLOTS = [
    { id: "head", label: "Head", options: [ none, ...5 head items ] },
    { id: "feet", label: "Feet", options: [ none ] }   // no art yet
  ]
  option = { id, label, src }  ("none" has no src). IDs are stable strings
  (e.g. "head-sunhat"); labels are cute display names I can edit later.
  LAYER_ORDER = ["base", "feet", "head"]  (configurable; feet may need to go
  under the base — easy to change).
- Suggested folders: /public/fish/base.png, /public/fish/head/*.png,
  /public/fish/feet/*.png. Adding a feet option = add a file + one config line.

## Data model
User profile gains:
  appearance: { version: 1, head: string | null, feet: string | null }
  appearanceUpdatedAt: Date
- Default for users without it: { head: null, feet: null } (plain base fish).
- IMPORTANT: changing appearance must NOT change the profile's `updatedAt` (or
  whatever field the pair AI cache key uses). The pair cache must only reset when
  profile CONTENT changes. Add a test for this.
- Server validates option IDs against the shared registry; unknown IDs → null.

### Existing users (already onboarded)
- No migration or backfill script. If `appearance` is missing or partial, treat
  every missing slot as "none" everywhere (read-time default in one helper,
  e.g. getAppearance(profile)), so they render as the plain base fish.
- "none" is the FIRST option in every slot and is shown with the label "None".
  Users can pick it deliberately.
- Existing users never see the onboarding creator again. They customize from
  /me ("Edit my fish"), which saves via PATCH /api/users/:id/appearance.
- Acceptance: a profile created before this feature loads in /world and /meet
  as the plain fish with no errors, and can be customized on /me.

## Shared component: <FishSprite appearance size flip? label? />
- Stacks base + overlays per LAYER_ORDER, absolutely positioned in one box.
- The whole stack flips together (walk direction), and bob animations apply to
  the wrapper.
- Preload all option images once (on the world page and in the creator).
- Replace EVERY existing fish render with this: /world, world popup card,
  /meet cutscene rectangles (use sprites now), history replays, profile.

## Onboarding flow change
Old: answers → extract (loading) → review → confirm
New: answers → [extract starts in background] → CREATOR → review → confirm
- On submitting the last answer, fire POST /api/onboarding/extract immediately
  (don't await it in the UI) and show the creator.
- Creator screen:
  - Big FishSprite in the center.
  - Four arrow buttons around the fish: top-left / top-right cycle HEAD
    (prev/next); bottom-left / bottom-right cycle FEET (prev/next).
    Options wrap around. Show the current option label + "2/6" near each pair.
    If a slot has only "none", its arrows are disabled with a small "coming soon".
  - Optional "🎲 Randomize" button.
  - Status line: "Your fish is getting to know you… 🫧" while extraction runs →
    "Ready!" when done.
  - "Next" button DISABLED until extraction succeeds. If extraction fails: show
    "Retry" (re-runs extract with the same answers) and keep the chosen appearance.
- Appearance lives in client state (+ sessionStorage so a refresh doesn't lose
  it) and is sent with POST /api/onboarding/confirm, saved with the profile.
- Mock mode: fake extraction delay (~4s) so the waiting state can be tested.

## Profile page (/me)
- Reached from the world: tapping MY fish's card → "Edit my fish" button, plus a
  small profile button in a corner of /world.
- Top: the same creator component (arrows around the fish), editable.
  "Save" → PATCH /api/users/:id/appearance { head, feet } (only enabled when
  changed). Only allowed when :id matches the localStorage fishId (hackathon-level
  check).
- Below: displayName, summary, interests, catchphrase (read-only for now).
- After saving, going back to /world shows the new look immediately.

## API changes
- PATCH /api/users/:id/appearance → validated appearance.
- GET /api/users/:id/public, GET /api/world, and the /meet response include
  `appearance` for every fish returned.
- Confirm endpoint accepts and validates `appearance`.

## UI / responsiveness
- Creator works 360px → desktop; fish ~60% of the viewport width on phones,
  capped on desktop. Arrows are ≥ 44px tap targets with aria-labels
  ("Previous head accessory", etc.). Left/Right keys cycle head,
  Shift+Left/Right cycle feet on desktop.
- Arrow tap gives a tiny pop animation on the fish.

## Testing
- Unit: registry validation (unknown IDs → null); layer order; appearance update
  doesn't change the pair-cache key.
- Seed script: give seed users varied head accessories.
- Add a temporary test feet PNG locally (not committed) to check the feet slot
  works end-to-end, then remove it.

## Acceptance criteria
- [ ] Creator appears right after the last answer while extraction runs; Next is
      locked until the profile is ready; failure → retry without losing the look.
- [ ] Head arrows cycle none + 5 options; feet slot works with zero options now
      and with new files later (config line only).
- [ ] Appearance saved at confirm; editable on /me; persists across reloads.
- [ ] Every fish everywhere (world, popup, meet, replays, profile) shows its
      saved accessories.
- [ ] Changing appearance never triggers pair AI regeneration.