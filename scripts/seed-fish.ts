/**
 * Insert ~5 labeled seed fish (isSeed: true) to test meet-ups against a real
 * profile. Idempotent: existing seeds are skipped. `--clear` removes the seeds
 * and every pair/attempt involving them.
 *
 *   npm run seed:fish
 *   npm run seed:fish -- --clear
 */
import "./loadEnv";
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
    if (await profiles.get(s.id)) {
      log(`skip   ${s.id}  (already seeded)`);
      continue;
    }
    console.log = () => {};
    try {
      await profiles.save({ id: s.id, profile: buildSeedProfile(s), rawAnswers: [], isSeed: true });
    } finally {
      console.log = log;
    }
    log(`seeded ${s.id}  ${s.displayName} — ${s.scenario}`);
  }
  log(`\nTry: npm run meet:pair -- <yourId> ${ids[0]}   or open /dev/whoami`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeMongo);
