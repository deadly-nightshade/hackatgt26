import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MockMeetAI } from "@/lib/meet/ai";
import { runMeet } from "@/lib/meet/pipeline";
import { buildProfile, ExtractedProfileSchema, type Profile } from "@/lib/profile/schema";
import { MockRecsAI, type RecCandidate, type RecsAI } from "@/lib/recs/ai";
import { REC_MAX, type RecommendationDoc, type RecOutput } from "@/lib/recs/schema";
import { getCandidates, getRecommendations, type RecDeps } from "@/lib/recs/service";
import { recTextOk, validateRecs } from "@/lib/recs/validate";
import { ConsoleFileRepository } from "@/lib/storage/profileRepo";
import type { RecommendationRepository } from "@/lib/storage/recRepo";
import { MemoryPairs, MemoryProfiles } from "./helpers";

// ── in-memory fixtures (never written to Mongo) ──────────────────────────────

let base: Profile;
beforeEach(async () => {
  const raw = JSON.parse(await readFile(path.join(__dirname, "..", "fixtures", "mock", "profile.json"), "utf8"));
  base = buildProfile(ExtractedProfileSchema.parse(raw), "Base");
});

type Cat = Profile["interests"][number]["category"];
const fish = (name: string, interests: [string, Cat][], wants: string[] = [], evidence = "said it"): Profile => ({
  ...base,
  displayName: name,
  interests: interests.map(([n, category]) => ({ name: n, category, tag: n.toLowerCase().replace(/\s+/g, "-"), evidence, confidence: 0.9 })),
  wantsToTry: wants.map((n) => ({ name: n, tag: n.toLowerCase().replace(/\s+/g, "-"), evidence })),
});

class MemoryRecs implements RecommendationRepository {
  docs = new Map<string, RecommendationDoc>();
  async get(id: string) {
    return this.docs.get(id) ?? null;
  }
  async save(doc: RecommendationDoc) {
    this.docs.set(doc.userId, structuredClone(doc));
  }
}

/** Returns what you give it (or the mock's overlap answer), counting calls. */
class FakeAI implements RecsAI {
  readonly model = "test";
  calls = 0;
  constructor(public answer?: (me: Profile, cands: RecCandidate[]) => RecOutput) {}
  async recommend(me: Profile, cands: RecCandidate[]): Promise<RecOutput> {
    this.calls++;
    return this.answer ? this.answer(me, cands) : new MockRecsAI().recommend(me, cands);
  }
}

function setup(ai = new FakeAI()) {
  const profiles = new MemoryProfiles();
  profiles.add("me", fish("Me", [["gacha games", "games"], ["crossword", "games"]], ["valorant"]));
  profiles.add("strong", fish("Strong", [["gacha games", "games"], ["crossword", "games"]]));
  profiles.add("bridge", fish("Bridge", [["valorant", "tech"]]));
  profiles.add("nothing", fish("Nothing", [["trail running", "outdoors"]]));
  profiles.add("hidden", fish("Hidden", [["gacha games", "games"]])); // not discoverable
  for (const id of ["me", "strong", "bridge", "nothing"]) void profiles.setDiscoverable(id, true);
  const pairs = new MemoryPairs();
  const recs = new MemoryRecs();
  let clock = new Date("2026-09-27T12:00:00Z").getTime();
  const deps: RecDeps = { profiles, pairs, recs, ai, now: () => new Date(clock) };
  const tick = (ms: number) => (clock += ms);
  const meet = (a: string, b: string) =>
    runMeet({ initiatorId: a, targetId: b, ignoreCooldown: true }, { profiles, pairs, ai: new MockMeetAI(), random: () => 0.99, now: () => new Date(clock), forcedOutcome: "friends" });
  return { profiles, pairs, recs, deps, ai, tick, meet };
}
const ids = (r: { response: { fish: { id: string }[] } }) => r.response.fish.map((f) => f.id);

describe("candidates", () => {
  it("discoverable, not me, not met — hidden users and met fish are excluded", async () => {
    const t = setup();
    const me = (await t.profiles.get("me"))!;
    expect((await getCandidates(me, t.deps)).map((p) => p.id).sort()).toEqual(["bridge", "nothing", "strong"]);
    await t.meet("me", "strong");
    expect((await getCandidates(me, t.deps)).map((p) => p.id).sort()).toEqual(["bridge", "nothing"]);
  });

  it("reciprocal: if I'm not discoverable I see nothing, and no AI call is made", async () => {
    const t = setup();
    await t.profiles.setDiscoverable("me", false);
    const r = await getRecommendations("me", t.deps);
    expect(r.response).toEqual({ enabled: false, fish: [] });
    expect(t.ai.calls).toBe(0);
  });
});

describe("suggestions", () => {
  it("strong overlap + bridge-only are suggested, nothing-in-common never is", async () => {
    const t = setup();
    const r = await getRecommendations("me", t.deps);
    expect(ids(r)).toContain("strong");
    expect(ids(r)).toContain("bridge");
    expect(ids(r)).not.toContain("nothing");
    expect(ids(r)).not.toContain("hidden");
    const bridge = r.response.fish.find((f) => f.id === "bridge")!;
    expect(bridge.sharedInterests).toEqual([]);
    expect(bridge.bridges[0].label).toMatch(/you've wanted to try it/);
  });

  it("hallucination guard: invented tags are dropped; a candidate with nothing left is dropped", async () => {
    const t = setup(
      new FakeAI(() => ({
        suggestions: [
          { candidateId: "strong", sharedInterests: [{ aTag: "gacha-games", bTag: "gacha-games", label: "gacha games", strength: "same" }, { aTag: "k-pop", bTag: "k-pop", label: "k-pop", strength: "same" }], bridges: [], teaser: "Compare your pity counters?" },
          { candidateId: "nothing", sharedInterests: [{ aTag: "crossword", bTag: "made-up-tag", label: "puzzles", strength: "close" }], bridges: [], teaser: "Puzzle pals?" },
          { candidateId: "ghost", sharedInterests: [{ aTag: "crossword", bTag: "crossword", label: "x", strength: "same" }], bridges: [], teaser: "hi" },
        ],
      })),
    );
    const r = await getRecommendations("me", t.deps);
    expect(ids(r)).toEqual(["strong"]);
    expect(r.response.fish[0].sharedInterests).toEqual([{ label: "gacha games" }]);
  });

  it("text checks: long / dating / bed / cozy teasers and labels → templates", () => {
    const me = fish("Me", [["gacha games", "games"]]);
    const pool = new Map([["a", fish("A", [["gacha games", "games"]])]]);
    const bad = ["You two would be the perfect match honestly!", "Cozy soul!", "Bed rotting buddies?", "A date at the arcade?", "This teaser is definitely way too long to fit in twelve words at all"];
    for (const teaser of bad) {
      const { recs } = validateRecs({ suggestions: [{ candidateId: "a", sharedInterests: [{ aTag: "gacha-games", bTag: "gacha-games", label: teaser, strength: "same" }], bridges: [], teaser }] }, me, pool);
      expect(recs[0].teaser).toBe("You both like gacha games!");
      expect(recs[0].sharedInterests[0].label).toBe("gacha games");
    }
    expect(recTextOk("Also does the daily Mini Cryptic — compare streaks?", false)).toBe(true);
    // "cozy" is fine if the user said it themselves.
    const cozyMe = fish("Me", [["gacha games", "games"]], [], "cozy nights gaming");
    const ok = validateRecs({ suggestions: [{ candidateId: "a", sharedInterests: [{ aTag: "gacha-games", bTag: "gacha-games", label: "gacha", strength: "same" }], bridges: [], teaser: "Cozy gacha nights?" }] }, cozyMe, pool);
    expect(ok.recs[0].teaser).toBe("Cozy gacha nights?");
  });

  it(`at most REC_MAX (${REC_MAX}), best first`, async () => {
    const t = setup(
      new FakeAI((_me, cands) => ({
        suggestions: cands.map((c) => ({ candidateId: c.candidateId, sharedInterests: [], bridges: [], teaser: "hi" })),
      })),
    );
    for (let i = 0; i < 5; i++) {
      t.profiles.add(`x${i}`, fish(`X${i}`, [["gacha games", "games"], ...(i % 2 ? ([["crossword", "games"]] as [string, Cat][]) : [])]));
      await t.profiles.setDiscoverable(`x${i}`, true);
    }
    t.ai.answer = (_me, cands) => ({
      suggestions: cands.map((c) => ({
        candidateId: c.candidateId,
        sharedInterests: c.profile.interests.filter((i) => ["gacha-games", "crossword"].includes(i.tag)).map((i) => ({ aTag: i.tag, bTag: i.tag, label: i.name, strength: "same" as const })),
        bridges: [],
        teaser: "Compare notes?",
      })),
    });
    const r = await getRecommendations("me", t.deps);
    expect(r.response.fish).toHaveLength(REC_MAX);
    // Two shared interests rank above one.
    expect(r.response.fish[0].sharedInterests.length).toBe(2);
  });

  it("the API response never contains a score or percentage", async () => {
    const t = setup();
    const r = await getRecommendations("me", t.deps);
    const json = JSON.stringify(r.response);
    expect(json).not.toMatch(/score|similarity|%/i);
    expect((await t.recs.get("me"))!.results[0].score).toBeGreaterThan(0); // kept server-side for ordering only
  });
});

describe("caching and budget", () => {
  it("reuses the cache (no AI) until something changes AND the refresh window passes", async () => {
    const t = setup();
    await getRecommendations("me", t.deps);
    expect(t.ai.calls).toBe(1);
    await getRecommendations("me", t.deps);
    expect(t.ai.calls).toBe(1); // nothing changed

    t.profiles.add("newbie", fish("Newbie", [["crossword", "games"]]));
    await t.profiles.setDiscoverable("newbie", true);
    t.tick(5 * 60_000);
    await getRecommendations("me", t.deps);
    expect(t.ai.calls).toBe(1); // pool changed, but inside the 30-minute window

    t.tick(31 * 60_000);
    const r = await getRecommendations("me", t.deps);
    expect(t.ai.calls).toBe(2);
    expect(ids(r)).toContain("newbie");
  });

  it("an empty result (no AI spent) doesn't make a newly opted-in fish wait for the refresh window", async () => {
    const t = setup();
    for (const id of ["strong", "bridge", "nothing"]) await t.profiles.setDiscoverable(id, false);
    const empty = await getRecommendations("me", t.deps);
    expect(empty.response.fish).toEqual([]);
    expect(t.ai.calls).toBe(0);
    await t.profiles.setDiscoverable("strong", true); // a friend opts in a minute later
    t.tick(60_000);
    const r = await getRecommendations("me", t.deps);
    expect(ids(r)).toEqual(["strong"]);
    expect(t.ai.calls).toBe(1);
  });

  it("↻ refresh (force): no AI if nothing changed; recomputes right away if something did", async () => {
    const t = setup();
    await getRecommendations("me", t.deps);
    expect(t.ai.calls).toBe(1);
    await getRecommendations("me", t.deps, { force: true });
    expect(t.ai.calls).toBe(1); // nothing changed → cache
    t.profiles.add("newbie", fish("Newbie", [["crossword", "games"]]));
    await t.profiles.setDiscoverable("newbie", true);
    t.tick(60_000); // well inside the 30-minute window
    const r = await getRecommendations("me", t.deps, { force: true });
    expect(t.ai.calls).toBe(2);
    expect(ids(r)).toContain("newbie");
  });

  it("serving from cache drops anyone met since or no longer discoverable (no AI)", async () => {
    const t = setup();
    const first = await getRecommendations("me", t.deps);
    expect(ids(first)).toEqual(expect.arrayContaining(["strong", "bridge"]));
    await t.meet("me", "strong");
    await t.profiles.setDiscoverable("bridge", false);
    const r = await getRecommendations("me", t.deps);
    expect(t.ai.calls).toBe(1);
    expect(ids(r)).not.toContain("strong");
    expect(ids(r)).not.toContain("bridge");
  });

  it("daily budget: after REC_CALLS_PER_USER_PER_DAY calls, falls back to exact overlap (no AI)", async () => {
    const t = setup();
    for (let i = 0; i < 7; i++) {
      t.profiles.add(`n${i}`, fish(`N${i}`, [["crossword", "games"]]));
      await t.profiles.setDiscoverable(`n${i}`, true); // pool changes every time
      t.tick(31 * 60_000);
      await getRecommendations("me", t.deps);
    }
    expect(t.ai.calls).toBe(5);
    expect((await t.recs.get("me"))!.source).toBe("fallback");
  });

  it("AI failure → exact tag overlap with template teasers", async () => {
    const t = setup(
      new FakeAI(() => {
        throw new Error("model down");
      }),
    );
    const r = await getRecommendations("me", t.deps);
    // Exact tags only: "strong" (same tags) and "bridge" (exact valorant bridge), never "nothing".
    expect(ids(r).sort()).toEqual(["bridge", "strong"]);
    expect(r.response.fish.find((f) => f.id === "strong")!.teaser).toMatch(/^You both like /);
    expect((await t.recs.get("me"))!.source).toBe("fallback");
  });
});

describe("mock mode", () => {
  it("canned suggestions from overlap, and a 0-result case when nobody overlaps", async () => {
    const ai = new MockRecsAI();
    const me = fish("Me", [["gacha games", "games"]]);
    const some = await ai.recommend(me, [{ candidateId: "s", profile: fish("S", [["gacha games", "games"]]) }]);
    expect(some.suggestions).toHaveLength(1);
    const none = await ai.recommend(me, [{ candidateId: "n", profile: fish("N", [["trail running", "outdoors"]]) }]);
    expect(none.suggestions).toEqual([]);
  });
});

describe("consent", () => {
  it("toggling discoverable never touches contentUpdatedAt (no pair AI reset); default is off", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fish-"));
    const repo = new ConsoleFileRepository(dir);
    const log = console.log;
    console.log = () => {};
    try {
      const { id } = await repo.save({ profile: base, rawAnswers: [] });
      const before = (await repo.get(id))!;
      expect(before.discoverable).toBe(false);
      await new Promise((r) => setTimeout(r, 5));
      await repo.setDiscoverable(id, true);
      const after = (await repo.get(id))!;
      expect(after.discoverable).toBe(true);
      expect(after.contentUpdatedAt.getTime()).toBe(before.contentUpdatedAt.getTime());
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    } finally {
      console.log = log;
    }
  });
});
