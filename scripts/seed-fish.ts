/**
 * Insert ~5 labeled seed fish (isSeed: true) to test meet-ups against a real
 * profile. Idempotent: existing seeds are skipped. `--clear` removes the seeds
 * and every pair/attempt involving them.
 *
 * `--for <userId>` also builds that user a sample /world (PHASE_3): meets and
 * hangouts run through the real pipeline with the MOCK AI (zero model calls),
 * backdated a few days, so pairs, levels, bump lines and replayable scripts exist.
 *
 *   npm run seed:fish
 *   npm run seed:fish -- --for <yourId>
 *   npm run seed:fish -- --clear
 */
import "./loadEnv";
import { getAppearance } from "@/lib/fish/appearance";
import { MockMeetAI } from "@/lib/meet/ai";
import { runMeet, type MeetDeps } from "@/lib/meet/pipeline";
import { pairKeyOf } from "@/lib/meet/schema";
import { INTEREST_CATEGORIES, ProfileSchema, SCHEMA_VERSION, type Profile } from "@/lib/profile/schema";
import { getPairRepository, getProfileRepository } from "@/lib/storage";
import { closeMongo } from "@/lib/storage/mongoRepo";

type Category = (typeof INTEREST_CATEGORIES)[number];
type SeedSpec = {
  id: string;
  /** What this seed is for (printed, not stored). */
  scenario: string;
  displayName: string;
  summary: string;
  interests: [name: string, category: Category, tag: string][];
  wantsToTry?: [name: string, tag: string][];
  energy: Profile["socialStyle"]["energy"];
  stall: string;
  catchphrase: string;
  /** Head accessory id (lib/fish/appearance.ts). */
  head: string | null;
};

// Scenarios are relative to the real test profile (gacha games, crosswords,
// crochet, desserts & skewers, memes; wants to try Valorant at the esports lounge).
const SEEDS: SeedSpec[] = [
  {
    id: "seed-1-strong-overlap",
    scenario: "strong overlap (gacha games + puzzles)",
    displayName: "Mochi",
    summary: "You're a cozy gacha grinder who unwinds with logic puzzles and a warm drink.",
    interests: [
      ["gacha games", "games", "gacha-games"],
      ["Honkai: Star Rail", "games", "honkai-star-rail"],
      ["sudoku and logic puzzles", "games", "sudoku-and-logic-puzzles"],
      ["bubble tea", "food_drink", "bubble-tea"],
    ],
    energy: "homebody",
    stall: "a lantern-lit stall trading puzzle books for bubble tea",
    catchphrase: "One more pull, then one more puzzle!",
    head: "head-bow",
  },
  {
    id: "seed-2-close-only",
    scenario: "close-only overlap (no identical tags)",
    displayName: "Pip",
    summary: "You're a crafty homebody who loves knitting, baking and long anime RPGs.",
    interests: [
      ["knitting", "arts_crafts", "knitting"],
      ["baking cookies", "food_drink", "baking-cookies"],
      ["anime RPGs", "games", "anime-rpgs"],
      ["board game nights", "games", "board-game-nights"],
    ],
    energy: "balanced",
    stall: "a yarn-and-cookie stand with a board game corner",
    catchphrase: "Warm cookies, warmer scarves!",
    head: "head-bunny",
  },
  {
    id: "seed-3-bridge-only",
    scenario: "bridge only (plays Valorant, nothing else shared)",
    displayName: "Rex",
    summary: "You're a high-energy Valorant main who spends weekends at the esports lounge and dance studio.",
    interests: [
      ["Valorant", "games", "valorant"],
      ["hip-hop dance", "music", "hip-hop-dance"],
      ["car restoration", "tech", "car-restoration"],
    ],
    energy: "out_and_about",
    stall: "a neon esports booth with a tiny dance floor",
    catchphrase: "Clutch or kick — let's go!",
    head: "head-shades",
  },
  {
    id: "seed-4-zero-overlap",
    scenario: "zero overlap (outdoorsy gym rat → must still get a grounded stretch)",
    displayName: "Bruno",
    summary: "You're an outdoorsy early riser who lives for trail runs, lifting and prepping the perfect meal.",
    interests: [
      ["trail running", "outdoors", "trail-running"],
      ["gym meal prep", "fitness", "gym-meal-prep"],
      ["powerlifting", "fitness", "powerlifting"],
      ["camping", "outdoors", "camping"],
    ],
    energy: "out_and_about",
    stall: "a protein-shake shack next to the trailhead map",
    catchphrase: "Rise, run, refuel!",
    head: "head-headphones",
  },
  {
    id: "seed-5-twin",
    scenario: "near-identical twin",
    displayName: "Sienna's Twin",
    summary: "You turn a free Saturday into a cozy gaming marathon with puzzles, crafts and snacks.",
    interests: [
      ["Honkai: Star Rail", "games", "honkai-star-rail"],
      ["Genshin Impact", "games", "genshin-impact"],
      ["daily crossword puzzle games", "games", "daily-crossword-puzzle-games"],
      ["crochet and crafts", "arts_crafts", "crochet-and-crafts"],
      ["desserts and meat skewers", "food_drink", "desserts-and-meat-skewers"],
    ],
    wantsToTry: [["Valorant at the esports lounge", "valorant-at-esports-lounge"]],
    energy: "homebody",
    stall: "a blanket-fort stall with skewers and a daily puzzle board",
    catchphrase: "Skewer in one hand, controller in the other!",
    head: "head-karen",
  },
];

function buildSeedProfile(s: SeedSpec): Profile {
  const trait = { score: 3, confidence: 0.3, evidence: "" };
  return ProfileSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    displayName: s.displayName,
    summary: s.summary,
    interests: s.interests.map(([name, category, tag]) => ({ name, category, tag, evidence: "(seed profile)", confidence: 0.9 })),
    wantsToTry: (s.wantsToTry ?? []).map(([name, tag]) => ({ name, tag, evidence: "(seed profile)" })),
    socialStyle: { energy: s.energy, groupSize: "small_group", planning: "flexible", evidence: "(seed profile)" },
    traits: { openness: trait, conscientiousness: trait, extraversion: trait, agreeableness: trait, emotionalStability: trait },
    vibeType: { mbti: "ISFP", label: "Seed Fish", confidence: 0.1, disclaimer: "just for fun" },
    conversationStarters: ["What's your favorite thing at the market?", "What are you into lately?"],
    residentFlavor: { marketStall: s.stall, catchphrase: s.catchphrase },
    lowSignalAreas: [],
  });
}

async function main() {
  const profiles = getProfileRepository();
  const ids = SEEDS.map((s) => s.id);

  if (process.argv.includes("--clear")) {
    const pairs = await getPairRepository().deleteForUsers(ids);
    for (const id of ids) await profiles.delete(id);
    console.log(`Removed ${ids.length} seed fish and ${pairs} pair(s) involving them.`);
    return;
  }

  // Quiet the repositories' pretty-printing of every saved profile.
  const log = console.log;
  for (const s of SEEDS) {
    const appearance = getAppearance({ head: s.head });
    if (await profiles.get(s.id)) {
      // Appearance only (never touches updatedAt, so their pair AI caches stay valid).
      await profiles.setAppearance(s.id, appearance);
      log(`skip   ${s.id}  (already seeded; look → ${s.head ?? "plain"})`);
      continue;
    }
    console.log = () => {};
    try {
      await profiles.save({ id: s.id, profile: buildSeedProfile(s), rawAnswers: [], isSeed: true, appearance });
    } finally {
      console.log = log;
    }
    log(`seeded ${s.id}  ${s.displayName} — ${s.scenario}`);
  }
  const forId = process.argv[process.argv.indexOf("--for") + 1];
  if (process.argv.includes("--for") && forId) await seedWorld(forId);
  else log(`\nTry: npm run seed:fish -- --for <yourId>   (builds you a /world), or open /dev/whoami`);
}

type Tap = { from: string; to: string; force?: "friends" | "clammed_up"; hangout?: boolean };

/**
 * A mix for /world: levels 1–4, one stranger (two clammed-up tries), and one
 * pair between two residents (friend-to-friend bump lines).
 */
function worldPlan(me: string): Tap[] {
  const [mochi, pip, rex, bruno, twin] = SEEDS.map((s) => s.id);
  const hangouts = (from: string, to: string, n: number): Tap[] => Array.from({ length: n }, () => ({ from, to, hangout: true }));
  return [
    { from: me, to: twin, force: "friends" },
    ...hangouts(twin, me, 6), // → Best Fishes
    { from: me, to: mochi, force: "friends" },
    ...hangouts(me, mochi, 3), // → Close Friends
    { from: pip, to: me, force: "friends" },
    ...hangouts(me, pip, 1), // → Good Friends
    { from: me, to: bruno, force: "clammed_up" },
    { from: me, to: bruno, force: "friends" }, // Friends, after one clam-up
    { from: me, to: rex, force: "clammed_up" },
    { from: rex, to: me, force: "clammed_up" }, // stranger ("Just met")
    { from: mochi, to: pip, force: "friends" }, // resident ↔ resident
  ];
}

async function seedWorld(me: string) {
  const profiles = getProfileRepository();
  const pairs = getPairRepository();
  if (!(await profiles.get(me))) throw new Error(`No profile with id ${me} (run onboarding first, or pick one from npm run list:fish)`);

  // Pairs that already exist are left alone (idempotent re-runs, real meets untouched).
  const plan = worldPlan(me);
  const skip = new Set<string>();
  for (const { from, to } of plan) {
    const key = pairKeyOf(from, to);
    if (!skip.has(key) && (await pairs.getPair(key))) skip.add(key);
  }

  // Backdate: start 5 days ago, a few hours between taps.
  let clock = Date.now() - 5 * 24 * 3600_000;
  const log = console.log;
  let ran = 0;
  for (const tap of plan) {
    if (skip.has(pairKeyOf(tap.from, tap.to))) continue;
    clock += 3 * 3600_000 + Math.floor(Math.random() * 3600_000);
    const at = clock;
    const deps: MeetDeps = {
      profiles,
      pairs,
      ai: new MockMeetAI(),
      now: () => new Date(at),
      forcedOutcome: tap.force ?? null,
      hangoutsEnabled: true,
      cooldownMs: 0,
    };
    console.log = () => {}; // the pipeline logs every tap
    try {
      await runMeet({ initiatorId: tap.from, targetId: tap.to, ignoreCooldown: tap.hangout }, deps);
    } finally {
      console.log = log;
    }
    ran++;
  }
  log(`\nWorld for ${me}: ${ran} tap(s) simulated with the mock AI${skip.size ? `, ${skip.size} existing pair(s) left as they were` : ""}.`);
  log(`Open /dev/whoami → pick that fish → /world`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeMongo);
