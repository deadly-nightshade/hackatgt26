import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { heuristicAnalysis, MockMeetAI, type MeetAI } from "@/lib/meet/ai";
import { LEVELS, levelFor, ROLL } from "@/lib/meet/config";
import { guardAnalysis } from "@/lib/meet/guard";
import { failsSinceSuccess, runMeet, type MeetDeps } from "@/lib/meet/pipeline";
import { failChance, rollMeet } from "@/lib/meet/roll";
import { pairKeyOf, sortIds, type Analysis, type MeetAttempt, type Pair } from "@/lib/meet/schema";
import { scoreAnalysis } from "@/lib/meet/score";
import { friendsScript, pick, type ScriptInput } from "@/lib/meet/templates";
import { buildProfile, ExtractedProfileSchema, type Profile } from "@/lib/profile/schema";
import { MemoryPairs, MemoryProfiles } from "./helpers";

// ── helpers ────────────────────────────────────────────────────────────────

let base: Profile;
beforeEach(async () => {
  const raw = JSON.parse(await readFile(path.join(__dirname, "..", "fixtures", "mock", "profile.json"), "utf8"));
  base = buildProfile(ExtractedProfileSchema.parse(raw), "Base");
});

function fish(name: string, interests: string[], wants: string[] = [], energy: Profile["socialStyle"]["energy"] = "balanced"): Profile {
  return {
    ...base,
    displayName: name,
    interests: interests.map((tag) => ({ name: tag.replace(/-/g, " "), category: "games", tag, evidence: "e", confidence: 0.9 })),
    wantsToTry: wants.map((tag) => ({ name: tag.replace(/-/g, " "), tag, evidence: "e" })),
    socialStyle: { ...base.socialStyle, energy },
  };
}

/** Seedable RNG (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Wraps an AI and counts model calls per method. */
class CountingAI implements MeetAI {
  readonly model = "test";
  calls = { analyze: 0, dialogue: 0, scenes: 0 };
  constructor(
    private inner: MeetAI = new MockMeetAI(),
    private fail: Partial<Record<"analyze" | "dialogue" | "scenes", boolean>> = {},
  ) {}
  get total() {
    return this.calls.analyze + this.calls.dialogue + this.calls.scenes;
  }
  async analyze(a: Profile, b: Profile) {
    this.calls.analyze++;
    if (this.fail.analyze) throw new Error("boom");
    return this.inner.analyze(a, b);
  }
  async dialogue(a: Profile, b: Profile, x: Analysis) {
    this.calls.dialogue++;
    if (this.fail.dialogue) throw new Error("boom");
    return this.inner.dialogue(a, b, x);
  }
  async scenes(a: Profile, b: Profile, x: Analysis, o: { levelName: string; usedTopics: string[] }) {
    this.calls.scenes++;
    if (this.fail.scenes) throw new Error("boom");
    return this.inner.scenes(a, b, x, o);
  }
}

function setup(opts: { ai?: CountingAI; forced?: "friends" | "clammed_up" | null; hangouts?: boolean; cooldownMs?: number } = {}) {
  const profiles = new MemoryProfiles();
  profiles.add("alice", fish("Alice", ["gacha-games", "crochet"], ["valorant"], "homebody"));
  profiles.add("bob", fish("Bob", ["gacha-games", "valorant"], [], "homebody"));
  const pairs = new MemoryPairs();
  const ai = opts.ai ?? new CountingAI();
  let clock = new Date("2026-09-26T12:00:00Z").getTime();
  const deps: MeetDeps = {
    profiles,
    pairs,
    ai,
    random: rng(1),
    now: () => new Date(clock),
    forcedOutcome: opts.forced === undefined ? null : opts.forced,
    hangoutsEnabled: opts.hangouts ?? false,
    cooldownMs: opts.cooldownMs ?? 60 * 60_000,
  };
  const tick = (ms: number) => (clock += ms);
  const tap = (from = "alice", to = "bob", extra: { ignoreCooldown?: boolean } = {}) =>
    runMeet({ initiatorId: from, targetId: to, includeDebug: true, ...extra }, deps);
  return { profiles, pairs, ai, deps, tap, tick };
}

// ── pure functions ─────────────────────────────────────────────────────────

describe("pairKey", () => {
  it("is order-independent and sorted", () => {
    expect(pairKeyOf("b", "a")).toBe("a__b");
    expect(pairKeyOf("a", "b")).toBe("a__b");
    expect(sortIds("seed-2", "seed-10")).toEqual(["seed-10", "seed-2"]);
  });
});

describe("scoreAnalysis", () => {
  const s = (strength: Analysis["sharedInterests"][number]["strength"]) => ({ aTag: "x", bTag: "y", label: "l", strength, why: "" });
  const br = { fromUser: "a" as const, wantsToTryTag: "w", matchedInterestTag: "m", label: "l" };
  const off = { energyMatch: false, note: "" };

  it("weights strengths", () => {
    expect(scoreAnalysis({ sharedInterests: [s("same")], bridges: [], styleNotes: off })).toBeCloseTo(0.3);
    expect(scoreAnalysis({ sharedInterests: [s("close"), s("loose"), s("stretch")], bridges: [], styleNotes: off })).toBeCloseTo(0.35);
  });
  it("caps interest points at 9 and bridges at 6", () => {
    expect(scoreAnalysis({ sharedInterests: [s("same"), s("same"), s("same"), s("same")], bridges: [], styleNotes: off })).toBeCloseTo(0.9);
    expect(scoreAnalysis({ sharedInterests: [], bridges: [br, br, br], styleNotes: off })).toBeCloseTo(0.6);
  });
  it("adds energy match and clamps to 1", () => {
    expect(scoreAnalysis({ sharedInterests: [], bridges: [], styleNotes: { energyMatch: true, note: "" } })).toBeCloseTo(0.1);
    expect(scoreAnalysis({ sharedInterests: [s("same"), s("same"), s("same")], bridges: [br, br], styleNotes: { energyMatch: true, note: "" } })).toBe(1);
  });
});

describe("roll", () => {
  it("maps similarity to a clamped fail chance", () => {
    expect(failChance(0, 0)).toBeCloseTo(ROLL.MAX_FAIL);
    expect(failChance(1, 0)).toBeCloseTo(ROLL.MIN_FAIL);
    expect(failChance(0.5, 0)).toBeCloseTo(0.225);
  });
  it("halves the fail chance per failure since the last success (pity)", () => {
    expect(failChance(0, 1)).toBeCloseTo(0.2);
    expect(failChance(0, 2)).toBeCloseTo(0.1);
  });
  it("uses the injected RNG", () => {
    expect(rollMeet({ similarity: 0, failsSinceSuccess: 0, random: () => 0.39 }).outcome).toBe("clammed_up");
    expect(rollMeet({ similarity: 0, failsSinceSuccess: 0, random: () => 0.41 }).outcome).toBe("friends");
    expect(rollMeet({ similarity: 0, failsSinceSuccess: 0, random: () => 0.0, forced: "friends" }).outcome).toBe("friends");
  });
  it("simulation: 1000 rolls at similarity 0 → ~MAX_FAIL, lower with pity", () => {
    const r = rng(42);
    const rate = (fails: number) => {
      let n = 0;
      for (let i = 0; i < 1000; i++) if (rollMeet({ similarity: 0, failsSinceSuccess: fails, random: r }).outcome === "clammed_up") n++;
      return n / 1000;
    };
    const first = rate(0);
    const second = rate(1);
    const third = rate(2);
    expect(Math.abs(first - ROLL.MAX_FAIL)).toBeLessThan(0.05);
    expect(second).toBeLessThan(first);
    expect(third).toBeLessThan(second);
  });
  it("counts trailing failures only", () => {
    const a = (outcome: MeetAttempt["outcome"]) => ({ outcome }) as MeetAttempt;
    expect(failsSinceSuccess([a("clammed_up"), a("friends"), a("clammed_up"), a("clammed_up")])).toBe(2);
    expect(failsSinceSuccess([])).toBe(0);
  });
});

describe("hallucination guard", () => {
  it("drops items citing tags that aren't in the right profile", () => {
    const a = fish("A", ["gacha-games", "crochet"], ["valorant"]);
    const b = fish("B", ["honkai-star-rail", "valorant"]);
    const analysis: Analysis = {
      sharedInterests: [
        { aTag: "gacha-games", bTag: "honkai-star-rail", label: "gacha", strength: "close", why: "" },
        { aTag: "Gacha Games", bTag: "honkai-star-rail", label: "dupe after normalizing", strength: "close", why: "" },
        { aTag: "knitting", bTag: "honkai-star-rail", label: "invented", strength: "loose", why: "" },
        { aTag: "honkai-star-rail", bTag: "gacha-games", label: "swapped sides", strength: "close", why: "" },
      ],
      bridges: [
        { fromUser: "a", wantsToTryTag: "valorant", matchedInterestTag: "valorant", label: "ok" },
        { fromUser: "b", wantsToTryTag: "valorant", matchedInterestTag: "valorant", label: "wrong direction" },
      ],
      styleNotes: { energyMatch: true, note: "" },
      spotlight: "love gacha games",
    };
    const { analysis: out, dropped } = guardAnalysis(analysis, a, b);
    expect(out.sharedInterests.map((s) => s.label)).toEqual(["gacha"]);
    expect(out.bridges.map((x) => x.label)).toEqual(["ok"]);
    expect(dropped).toHaveLength(3);
  });

  it("heuristic analysis always finds a grounded stretch for zero overlap", () => {
    const a = fish("A", ["desserts-and-meat-skewers"]);
    const b = fish("B", ["gym-meal-prep"]);
    a.interests[0].category = "food_drink";
    b.interests[0].category = "fitness";
    const x = heuristicAnalysis(a, b, { fuzzy: true });
    expect(x.sharedInterests).toHaveLength(1);
    expect(x.sharedInterests[0]).toMatchObject({ aTag: "desserts-and-meat-skewers", bTag: "gym-meal-prep", strength: "stretch" });
    expect(guardAnalysis(x, a, b).dropped).toHaveLength(0);
  });
});

describe("templates", () => {
  const input = (attemptNumber: number): ScriptInput => ({
    pairKey: "a__b",
    attemptNumber,
    names: { a: "Ann", b: "Ben" },
    spotlight: "love puzzles",
    plan: "Plan!",
    middle: [{ speaker: "a", text: "hi", mood: "happy" }],
  });
  it("are deterministic per pairKey + attempt", () => {
    expect(friendsScript(input(1), true)).toEqual(friendsScript(input(1), true));
    expect(pick(["x", "y", "z"], "a__b", 3, "intro")).toBe(pick(["x", "y", "z"], "a__b", 3, "intro"));
  });
  it("vary across attempts", () => {
    const intros = new Set(Array.from({ length: 12 }, (_, i) => friendsScript(input(i + 1), false)[0].text));
    expect(intros.size).toBeGreaterThan(1);
  });
  it("fills placeholders and follows the script order", () => {
    const s = friendsScript(input(1), true);
    expect(s.map((l) => l.text).join(" ")).not.toMatch(/\{\w+\}/);
    expect(s[1].text).toBe("hi");
    expect(s.at(-2)!.text).toBe("Plan!");
    expect(s.at(-1)!.text).toBe("Level 1: Friends");
  });
});

// ── pipeline ───────────────────────────────────────────────────────────────

describe("runMeet", () => {
  it("first meet = 2 model calls; every retry/re-tap = 0", async () => {
    const t = setup({ forced: "clammed_up" });
    const r1 = await t.tap();
    expect(r1.outcome).toBe("clammed_up");
    expect(t.ai.total).toBe(2);
    await t.tap();
    await t.tap("bob", "alice");
    expect(t.ai.total).toBe(2);
    expect(t.pairs.attempts).toHaveLength(3);
  });

  it("orients speakers to the initiator", async () => {
    const t = setup({ forced: "friends" });
    const r = await t.tap("bob", "alice");
    expect(r.fish.a.displayName).toBe("Bob");
    const firstA = r.script.find((l) => l.speaker === "a")!;
    // Mock dialogue: pair-order "a" (alice) opens with "Hey Bob!" — from Bob's side that's speaker "b".
    expect(firstA.text).not.toMatch(/^Hey Bob/);
    expect(r.script.find((l) => l.speaker === "b")!.text).toMatch(/^Hey Bob/);
  });

  it("once friends, always already_friends with no roll and no AI", async () => {
    const t = setup({ forced: "friends" });
    expect((await t.tap()).outcome).toBe("friends");
    t.deps.forcedOutcome = "clammed_up";
    const r = await t.tap();
    expect(r.outcome).toBe("already_friends");
    expect(r.debug?.roll).toBeNull();
    expect(t.ai.total).toBe(2);
    expect(t.pairs.pairs.get("alice__bob")!.status).toBe("friends");
  });

  it("outcome can differ between attempts (real RNG path)", async () => {
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 40 && outcomes.size < 2; seed++) {
      const t = setup();
      t.deps.random = rng(seed);
      // Make similarity low so failures are likely.
      t.profiles.add("carl", fish("Carl", ["powerlifting"], [], "out_and_about"));
      outcomes.add((await t.tap("alice", "carl")).outcome);
    }
    expect(outcomes).toEqual(new Set(["friends", "clammed_up"]));
  });

  it("regenerates when a profile changes, keeping status", async () => {
    const t = setup({ forced: "clammed_up" });
    await t.tap();
    t.profiles.add("bob", fish("Bob", ["crochet"]), new Date("2026-02-02"));
    await t.tap();
    expect(t.ai.total).toBe(4);
  });

  it("AI failure → template-only cutscene, not cached, retried next time", async () => {
    const ai = new CountingAI(new MockMeetAI(), { analyze: true });
    const t = setup({ ai, forced: "clammed_up" });
    const r = await t.tap();
    expect(r.debug?.usedFallback).toBe(true);
    expect(r.script.some((l) => l.text.includes("water you up to"))).toBe(true);
    expect(t.pairs.pairs.get("alice__bob")?.analysis).toBeUndefined();
    await t.tap();
    expect(ai.calls.analyze).toBe(2);
  });

  it("404s for an unknown fish and 400s for yourself", async () => {
    const t = setup();
    await expect(t.tap("alice", "nobody")).rejects.toMatchObject({ status: 404 });
    await expect(t.tap("alice", "alice")).rejects.toMatchObject({ status: 400 });
  });
});

describe("hangouts (stretch)", () => {
  it("cooldown → no change; after cooldown → hangout with level progression", async () => {
    const t = setup({ forced: "friends", hangouts: true });
    const first = await t.tap();
    expect(first).toMatchObject({ outcome: "friends", level: 1, levelName: "Friends", leveledUp: true });
    expect(first.script.at(-1)!.text).toBe("Level 1: Friends");

    const cd = await t.tap();
    expect(cd).toMatchObject({ outcome: "cooldown", level: 1, hangoutCount: 0 });
    expect(t.ai.total).toBe(2);

    t.tick(61 * 60_000);
    const h1 = await t.tap();
    expect(h1).toMatchObject({ outcome: "hangout", hangoutCount: 1, level: 2, levelName: "Good Friends", leveledUp: true });
    expect(h1.script.some((l) => l.text.includes("now Good Friends"))).toBe(true);
    expect(t.ai.calls.scenes).toBe(1);

    for (const expectedLevel of [2, 3]) {
      t.tick(61 * 60_000);
      expect((await t.tap()).level).toBe(expectedLevel);
    }
    expect(t.ai.calls.scenes).toBe(1); // hangouts 2 and 3 reuse the first batch
  });

  it("level thresholds", () => {
    expect([0, 1, 2, 3, 5, 6, 50].map(levelFor)).toEqual([1, 2, 2, 3, 3, 4, 4]);
  });

  it("scene batches never exceed the cap", async () => {
    const t = setup({ forced: "friends", hangouts: true });
    await t.tap();
    for (let i = 0; i < 40; i++) await t.tap("alice", "bob", { ignoreCooldown: true });
    const pair = t.pairs.pairs.get("alice__bob")!;
    expect(pair.sceneBatchesGenerated).toBeLessThanOrEqual(LEVELS.length);
    expect(t.ai.calls.scenes).toBe(pair.sceneBatchesGenerated);
    expect(pair.level).toBe(4);
  });

  it("scene failure → template hangout that still counts", async () => {
    const ai = new CountingAI(new MockMeetAI(), { scenes: true });
    const t = setup({ ai, forced: "friends", hangouts: true });
    await t.tap();
    const h = await t.tap("alice", "bob", { ignoreCooldown: true });
    expect(h).toMatchObject({ outcome: "hangout", hangoutCount: 1 });
    expect(h.script.some((l) => l.text.includes("spent the afternoon together"))).toBe(true);
  });
});
