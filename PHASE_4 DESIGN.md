# Feature: Living Seaside World (props, layering, ambient interactions)

## Context
Builds on the existing /world (wandering fish, bumps, popup card, history).
READ THE EXISTING CODE FIRST (lib/world/*, world page, config).
New art assets are in the repo (find them, likely under /public):
booth1, booth2, bucket-and-shovel, dock, ocean, picnic table, sand, sandcastle,
seashells, seagull — plus the existing background and fish sprite.
No AI calls in anything here. All client-side, data-driven, config-tuned.

## Step 0 — Inspect assets BEFORE writing code (required)
- Open/view EVERY image. For each, record: file path, pixel size, transparency,
  what it depicts.
- Determine how they compose with the background:
  a) If an asset has the SAME dimensions as the background and is mostly transparent,
     it's a pre-positioned layer → render at (0,0), same scale as the background.
  b) Otherwise it's a standalone prop → choose a position/scale that fits the scene
     (on the sand, correct perspective, sensible size relative to the fish).
  Check whether sand/ocean are separate layers that make up the background.
- Check whether an ice cream store is painted into the background, and whether
  a separate counter-front image exists (needed for interaction 6).
- Write findings to docs/world-assets.md (table: asset, size, type a/b,
  placement, notes) and put all placements in lib/world/scene.ts, in normalized
  0..1 coordinates of the background image. Nothing hard-coded in components.
- Commit a screenshot or describe the composed scene so I can check placement.

## Layout / mobile framing
- The background keeps its aspect ratio and fits the viewport WIDTH.
- Space ABOVE the image = solid sky rgb(125, 199, 235).
  Space BELOW the image = solid ocean rgb(93, 135, 191).
  (Two full-width blocks, or a container background split exactly at the image
  edges.) No gaps or seams on any phone size; test 360×640, 390×844, 430×932,
  and a laptop.
- Vertical placement: center the image, but make sure the sky block is never
  taller than the ocean block looks natural (tune; configurable).
- Note: if fish become smaller than ~40px wide on phones, report it (we may
  switch to fit-height + horizontal pan later). Don't do that now.

## Rendering & depth
- Everything (fish + props) lives in the world layer in normalized coordinates.
- Y-sorting: z-index = bottom edge y (feet/base). A fish whose feet are above a
  prop's base draws behind it; below → in front. This handles "behind the stall"
  automatically when the stall's anchor point is behind its counter.
- Props that fish must never overlap in front of (e.g. a counter front) can be
  flagged `alwaysFront: true`.
- Blocked areas (stalls, dock, table, sandcastle spot, store): rects in scene.ts.
  Wander targets can't be inside blocked areas, and a path is rejected if its
  straight line crosses one (sample points along it); pick another target.
- Keep the existing walkable area; tune it to the sand. The ocean is not walkable.

## Placeholder props (so art can be made in parallel)
Each spawnable item in scene.ts: { id, src?: string, rect (normalized), label }.
If `src` is missing or fails to load → render a dashed rounded rectangle with the
label text (e.g. "booth1 items", "ice cream", "fries"). Adding a PNG at the
configured path must replace it with NO code changes. Suggested paths:
/public/world/props/booth1-items.png, booth2-items.png, icecream.png, fries.png.

## Activity system (lib/world/activities.ts)
Generic, data-driven. Each activity:
{
  id, zone (normalized rect where it triggers),
  anchors: points where fish stand (1 or 2),
  fishRequired: 1 | 2,
  dwellMs: [min, max]   // how long a fish stays
  triggerAfterMs         // how long before the effect appears
  effect: { itemIds: string[], mode: "whileOccupied" | "persistAfter", persistMs? },
  cooldownMs, weight     // chance a free fish chooses this activity
}
Wander behavior update: when choosing a new target, a free fish picks an available
activity with probability ACTIVITY_CHANCE (weighted), otherwise a random point.
Fish walks to the anchor → faces the right way → waits → effect → leaves.
An activity is "available" if not on cooldown and has free anchors.
Items appear/disappear with a short fade + pop (scale 0.8→1).
"Swim over" and bumps from the existing plan interrupt activities cleanly
(clean up any whileOccupied items).

## Interactions (priority order)
1. PRIORITY — Sandcastle (two-fish build):
   - A free fish chooses the sandcastle activity and walks to anchor A next to the
     bucket & shovel.
   - On arrival it "summons" a helper: shows a short bubble (e.g. "help me build! 🏖️"
     or "sandcastle time?") and picks the nearest FREE fish (prefer a fish it's
     friends with, if any). The helper shows a reply bubble ("coming!" / "on it 🐟"),
     drops what it was doing (cleanly, like "Swim over") and walks to anchor B.
   - If no free fish exists, or the helper hasn't arrived within ~8s, fish A shows
     "aw…" and leaves (no sandcastle, short cooldown).
   - Once both are at their anchors: both do a small "digging" wiggle, facing the
     bucket; after triggerAfterMs (~3s) the sandcastle asset pops in.
   - Both stay a moment, then leave. The sandcastle stays for 8 seconds after BOTH
     fish have left (persistMs = 8000, config), then fades out. Activity cooldown
     starts after the fade.
   - Summoned helpers are reserved (can't be grabbed by bumps or other activities
     until the build ends). "Swim over" by the user still interrupts: cancel the
     build, clear reservations, no sandcastle.
   - Debug panel: "Force sandcastle" button sends a free fish to anchor A,
     which then summons as normal.
   - Generalize: implement "summon a helper" as a reusable activity option
     (`summonHelper: true`) so the picnic table can use it later if wanted.
2. Booth 1: fish goes behind the stall (anchor behind the counter so y-sort hides
   its lower body); items appear on the desk (placeholder "booth1 items").
   mode whileOccupied: items vanish when the fish leaves.
3. Booth 2: same as booth 1 with booth2 and "booth2 items".
4. Picnic table: needs TWO fish at the two anchors, both staying still. When one
   fish is waiting there, raise the weight for other free fish to join. If nobody
   joins within ~8s, the waiting fish leaves. When both are present for
   triggerAfterMs → "ice cream" item appears on the table (placeholder). Do NOT
   use or reference the ice cream store for this. Items vanish shortly after both leave.
   Nice-to-have: prefer pairing fish that are friends with each other, and show a
   bump exchange from their bumpLines while seated.
5. Seagull: a fish stands near the seagull; after triggerAfterMs the seagull gets
   fries ("fries" placeholder near its beak/feet). Seagull does a small hop.
   Fries vanish after a few seconds or when the fish leaves.
6. Ice cream store counter: a fish goes behind the counter.
   Needs a counter-front overlay drawn ABOVE the fish:
   - If a separate counter-front asset exists → use it with alwaysFront.
   - Otherwise crop the counter-front region from the background into an overlay
     (canvas crop at runtime or a generated PNG) and flag it
     "TEMP — replace with clean art at /public/world/props/counter-front.png".
   Do this one LAST.

## Ambient polish (only if time allows)
- Ocean: gentle horizontal drift/bob of the ocean layer (CSS, 2–4px).
- Seagull: occasional idle hop/flip.
- Seashells are static decorations (not interactive) unless trivial.

## Debug & demo tools
- /world?debug=1: draw walkable area, blocked rects, activity zones, anchors,
  and each fish's current target; show a small panel with buttons to force each
  activity (sends the nearest free fish, or two fish for the picnic table), plus
  live controls for ACTIVITY_CHANCE and a global time multiplier.
- DEMO_MODE: shorter dwell/trigger times so every interaction shows up within
  ~30s of opening the world (for recording the video).

## Performance
Same rAF loop, positions in refs, no per-frame React state. ~10 fish + ~12 props
must stay smooth on a mid-range phone. Pause when the tab is hidden.
prefers-reduced-motion: activities still happen, walking is slower.

## Acceptance criteria
- [ ] docs/world-assets.md exists; props are placed sensibly on the background.
- [ ] Sky/ocean color extensions are seamless on all tested sizes.
- [ ] Fish correctly appear behind stalls/props via y-sorting; nobody walks
      through blocked props.
- [ ] Sandcastle interaction works end-to-end (PRIORITY).
- [ ] Booth 1 and 2 show placeholder items only while occupied.
- [ ] Picnic table needs two fish; ice cream placeholder appears.
- [ ] Seagull gets fries placeholder.
- [ ] Counter interaction works with a real or TEMP overlay.
- [ ] Dropping a PNG at a placeholder path swaps it in with no code change.
- [ ] Debug overlay + force buttons work; DEMO_MODE shows all interactions quickly.