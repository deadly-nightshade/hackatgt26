import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MockMeetAI, type MeetAI } from "@/lib/meet/ai";
import { runMeet, type MeetDeps } from "@/lib/meet/pipeline";
import { pairKeyOf, type Analysis, type MeetAttempt } from "@/lib/meet/schema";
import { buildProfile, ExtractedProfileSchema, type Profile } from "@/lib/profile/schema";
import { bumpLinesForPair, fallbackBumpLines, FALLBACK_REPLIES, shortLabel, tidyBumpLines } from "@/lib/world/bumps";
import { WALKABLE, WORLD } from "@/lib/world/config";
import { getHistory, getReplay, getResidentsFor, getWorld } from "@/lib/world/server";
import { bumpDistance, createSim, findBumps, randomPointIn, stepSim, swimOver, type SimWorld } from "@/lib/world/sim";
import { MemoryPairs, MemoryProfiles } from "./helpers";

// ── helpers ────────────────────────────────────────────────────────────────

let base: Profile;
beforeEach(async () => {
  const raw = JSON.parse(await readFile(path.join(__dirname, "..", "fixtures", "mock", "profile.json"), "utf8"));
  base = buildProfile(ExtractedProfileSchema.parse(raw), "Base");
});

function fish(name: string, interests: string[]): Profile {
  return {
    ...base,
    displayName: name,
    interests: interests.map((tag) => ({ name: tag.replace(/-/g, " "), category: "games", tag, evidence: "e", confidence: 0.9 })),
    wantsToTry: [],
    residentFlavor: { marketStall: `${name}'s stall`, catchphrase: `${name} says hi!` },
  };
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** me, three fish I met (two friends + a stranger), and "zed" whom only my friend met. */
async function town() {
  const profiles = new MemoryProfiles();
  for (const [id, name] of [
    ["me", "Me"],
    ["ann", "Ann"],
    ["ben", "Ben"],
    ["cal", "Cal"],
    ["zed", "Zed"],
  ])
    profiles.add(id, fish(name, ["gacha-games", "crochet"]));
  const pairs = new MemoryPairs();
  let clock = new Date("2026-09-20T12:00:00Z").getTime();
  const tap = (from: string, to: string, forced: "friends" | "clammed_up" | null = null, ai: MeetAI = new MockMeetAI()) => {
    clock += 3600_000;
    const at = clock;
    const deps: MeetDeps = { profiles, pairs, ai, random: rng(3), now: () => new Date(at), forcedOutcome: forced, hangoutsEnabled: true, cooldownMs: 0 };
    return runMeet({ initiatorId: from, targetId: to, ignoreCooldown: true }, deps);
  };
  await tap("me", "ann", "friends");
  await tap("me", "ann"); // hangout
  await tap("ben", "me", "friends");
  await tap("me", "cal", "clammed_up");
  await tap("ann", "ben", "friends"); // resident ↔ resident
  await tap("ann", "zed", "friends"); // my friend's friend — never in my world
  return { profiles, pairs, deps: { profiles, pairs }, tap };
}

// ── resident rule ────────────────────────────────────────────────────────────

describe("getResidentsFor (who appears in my world)", () => {
  it("only fish I personally met: friends and strangers, never friends-of-friends", async () => {
    const t = await town();
    const { residents } = await getResidentsFor("me", t.deps);
    expect(residents.map((r) => r.id).sort()).toEqual(["ann", "ben", "cal"]);
    expect(residents.find((r) => r.id === "cal")).toMatchObject({ status: "strangers", levelName: null, level: 0 });
    expect(residents.find((r) => r.id === "ann")).toMatchObject({ status: "friends", level: 2, levelName: "Good Friends", hangoutCount: 1 });
  });

  it("a pair with only cooldown attempts doesn't count", async () => {
    const t = await town();
    const key = pairKeyOf("me", "zed");
    await t.pairs.savePair({ ...(await t.pairs.getPair(pairKeyOf("ann", "zed")))!, _id: key, pairKey: key, userIds: ["me", "zed"] });
    const cooldown: MeetAttempt = { _id: "c1", pairKey: key, initiatorId: "me", outcome: "cooldown", pFail: null, roll: null, createdAt: new Date() };
    await t.pairs.logAttempt(cooldown);
    expect((await getResidentsFor("me", t.deps)).residents.map((r) => r.id)).not.toContain("zed");
  });

  it("world bump lines cover my pairs and resident↔resident pairs only", async () => {
    const t = await town();
    const world = await getWorld("me", t.deps);
    expect(world.me).toEqual({ id: "me", displayName: "Me", catchphrase: "Me says hi!", appearance: { version: 1, head: null, feet: "feet-boots" } });
    const keys = Object.keys(world.bumpLines).sort();
    expect(keys).toEqual([pairKeyOf("me", "ann"), pairKeyOf("me", "ben"), pairKeyOf("me", "cal"), pairKeyOf("ann", "ben")].sort());
    expect(keys).not.toContain(pairKeyOf("ann", "zed"));
    for (const lines of Object.values(world.bumpLines)) expect(lines.length).toBeGreaterThan(0);
  });
});

// ── history + replay ─────────────────────────────────────────────────────────

describe("history and replay", () => {
  it("newest first, cooldowns hidden, level-ups labelled", async () => {
    const t = await town();
    const history = await getHistory(pairKeyOf("me", "ann"), "me", t.deps);
    expect(history.map((h) => h.kind)).toEqual(["hangout", "first_meet"]);
    expect(history[0]).toMatchObject({ leveledUp: true, levelNameAfter: "Good Friends", hasScript: true });
    expect(new Date(history[0].createdAt) > new Date(history[1].createdAt)).toBe(true);
  });

  it("old attempts without a script are listed as not replayable", async () => {
    const t = await town();
    const key = pairKeyOf("me", "cal");
    await t.pairs.logAttempt({ _id: "old", pairKey: key, initiatorId: "cal", outcome: "clammed_up", pFail: 0.3, roll: 0.1, createdAt: new Date("2026-01-01") });
    const old = (await getHistory(key, "me", t.deps)).find((h) => h.attemptId === "old")!;
    expect(old).toMatchObject({ kind: "clammed_up", hasScript: false });
    await expect(getReplay("old", "me", t.deps)).rejects.toMatchObject({ status: 404 });
  });

  it("403 for someone outside the pair, 404 for unknown pairs", async () => {
    const t = await town();
    await expect(getHistory(pairKeyOf("ann", "zed"), "me", t.deps)).rejects.toMatchObject({ status: 403 });
    await expect(getHistory("nope__nada", "me", t.deps)).rejects.toMatchObject({ status: 404 });
    const [attempt] = await t.pairs.listAttempts(pairKeyOf("ann", "zed"));
    await expect(getReplay(attempt._id, "me", t.deps)).rejects.toMatchObject({ status: 403 });
  });

  it("replay returns the exact saved script and changes nothing", async () => {
    const t = await town();
    const [first] = await t.pairs.listAttempts(pairKeyOf("me", "ann"));
    const before = JSON.stringify([...t.pairs.pairs.values(), t.pairs.attempts]);
    const replay = await getReplay(first._id, "me", t.deps);
    expect(replay.names).toEqual({ a: "Me", b: "Ann" });
    expect(replay.script).toEqual(first.script!.map(({ speaker, text, mood }) => ({ speaker, text, mood })));
    expect(JSON.stringify([...t.pairs.pairs.values(), t.pairs.attempts])).toBe(before);
  });
});

// ── pipeline additions ───────────────────────────────────────────────────────

describe("meet pipeline (PHASE_3 data)", () => {
  it("saves bumpLines from the dialogue call — no extra model call", async () => {
    let calls = 0;
    const inner = new MockMeetAI();
    const counting: MeetAI = {
      model: "test",
      analyze: (a, b) => (calls++, inner.analyze(a, b)),
      dialogue: (a, b, x) => (calls++, inner.dialogue(a, b, x)),
      scenes: (a, b, x, o) => (calls++, inner.scenes(a, b, x, o)),
    };
    const t = await town();
    await t.tap("me", "zed", "friends", counting);
    expect(calls).toBe(2);
    expect((await t.pairs.getPair(pairKeyOf("me", "zed")))!.bumpLines!.length).toBeGreaterThanOrEqual(5);
  });

  it("attempts record kind, level after, and the exact script", async () => {
    const t = await town();
    const [meet, hangout] = await t.pairs.listAttempts(pairKeyOf("me", "ann"));
    expect(meet).toMatchObject({ kind: "first_meet", levelAfter: 1, levelNameAfter: "Friends" });
    expect(hangout).toMatchObject({ kind: "hangout", levelAfter: 2, levelNameAfter: "Good Friends" });
    const [clam] = await t.pairs.listAttempts(pairKeyOf("me", "cal"));
    expect(clam).toMatchObject({ kind: "clammed_up", levelAfter: 0, levelNameAfter: "Just met" });
    expect(clam.script!.length).toBeGreaterThan(2);
  });

  it("a clammed-up first meet on the AI-fallback path still creates the pair", async () => {
    const t = await town();
    const failing: MeetAI = { model: "x", analyze: async () => Promise.reject(new Error("boom")), dialogue: async () => Promise.reject(new Error("boom")), scenes: async () => [] };
    await t.tap("zed", "me", "clammed_up", failing);
    const pair = await t.pairs.getPair(pairKeyOf("me", "zed"));
    expect(pair).toMatchObject({ status: "strangers" });
    expect(pair!.analysis).toBeUndefined(); // fallback content is never cached
    expect((await getResidentsFor("me", t.deps)).residents.map((r) => r.id)).toContain("zed");
  });
});

// ── bump lines ───────────────────────────────────────────────────────────────

describe("bump lines", () => {
  it("drops exchanges over 4 words and caps at 8", () => {
    const lines = tidyBumpLines([
      { a: "honkai star rail?", b: "gaming!!" },
      { a: "this one has way too many words", b: "ok" },
      ...Array.from({ length: 10 }, (_, i) => ({ a: `hi ${i}`, b: "yo" })),
    ]);
    expect(lines[0]).toEqual({ a: "honkai star rail?", b: "gaming!!" });
    expect(tidyBumpLines([{ a: "hi", b: "yo" }, { a: "Hi", b: "hey" }])).toHaveLength(1); // duplicates dropped
    expect(shortLabel("daily crossword and skewers")).toBe("daily crossword");
    expect(lines).toHaveLength(8);
    expect(lines.every((l) => l.a.split(" ").length <= 4 && l.b.split(" ").length <= 4)).toBe(true);
  });

  it("falls back to templates from shared-interest labels", () => {
    const analysis = { sharedInterests: [{ label: "Gacha Games", aTag: "x", bTag: "y", strength: "same", why: "" }] } as unknown as Analysis;
    const [line] = fallbackBumpLines(analysis, "a__b");
    expect(line.a).toBe("gacha games?");
    expect(FALLBACK_REPLIES).toContain(line.b);
    expect(bumpLinesForPair({ pairKey: "a__b", bumpLines: [{ a: "x?", b: "y!" }], analysis })).toEqual([{ a: "x?", b: "y!" }]);
    expect(bumpLinesForPair({ pairKey: "a__b" })).toEqual([]);
  });
});

// ── simulation ───────────────────────────────────────────────────────────────

const lines = () => [{ a: "hi?", b: "hello!" }];
const inside = (f: { x: number; y: number }) => f.x >= WALKABLE.minX && f.x <= WALKABLE.maxX && f.y >= WALKABLE.minY && f.y <= WALKABLE.maxY;

function place(w: SimWorld, id: string, x: number, y: number) {
  Object.assign(w.fish.find((f) => f.id === id)!, { x, y, tx: x, ty: y, mode: "pause", until: Infinity, cooldownUntil: 0 });
}

describe("world simulation", () => {
  it("wander targets and positions stay inside the walkable area", () => {
    const r = rng(7);
    for (let i = 0; i < 1000; i++) expect(inside(randomPointIn(WALKABLE, r))).toBe(true);
    const w = createSim(["a", "b", "c", "d", "e", "f"], { linesFor: lines }, rng(9));
    for (let i = 0; i < 5000; i++) {
      stepSim(w, 16);
      for (const f of w.fish) expect(inside(f)).toBe(true);
    }
    for (const reduced of [true]) {
      const rw = createSim(["a", "b"], { linesFor: lines, reducedMotion: reduced }, rng(4));
      for (let i = 0; i < 3000; i++) stepSim(rw, 16);
      for (const f of rw.fish) expect(inside(f)).toBe(true);
    }
  });

  it("bumps only free fish within BUMP_DISTANCE, respecting cooldowns", () => {
    const w = createSim(["a", "b", "c"], { linesFor: lines }, rng(1));
    place(w, "a", 0.3, 0.6);
    place(w, "b", 0.3 + WORLD.BUMP_DISTANCE * 0.5, 0.6);
    place(w, "c", 0.8, 0.6);
    expect(findBumps(w).map(([x, y]) => [x.id, y.id])).toEqual([["a", "b"]]);
    w.fish.find((f) => f.id === "b")!.cooldownUntil = w.t + 1000;
    expect(findBumps(w)).toEqual([]);
    expect(bumpDistance({ x: 0, y: 0 }, { x: 0, y: 0.1 })).toBeGreaterThan(0.1); // y weighted
  });

  it("a bump shows a's bubble, then b's, then both resume with a cooldown", () => {
    const w = createSim(["a", "b"], { linesFor: lines }, () => 0.99); // no second exchange
    place(w, "a", 0.3, 0.6);
    place(w, "b", 0.35, 0.6);
    stepSim(w, 16);
    const [a, b] = w.fish;
    expect([a.mode, b.mode]).toEqual(["bump", "bump"]);
    expect([a.facing, b.facing]).toEqual([1, -1]);
    expect([a.bubble, b.bubble]).toEqual(["hi?", null]);
    for (let t = 0; t < WORLD.BUBBLE_MS; t += 40) stepSim(w, 40);
    expect([a.bubble, b.bubble]).toEqual([null, "hello!"]);
    for (let t = 0; t < WORLD.BUBBLE_MS + 100; t += 40) stepSim(w, 40);
    expect([a.bubble, b.bubble, a.mode]).toEqual([null, null, "pause"]);
    expect(a.cooldownUntil).toBeGreaterThan(w.t + WORLD.BUMP_COOLDOWN_MS - 200);
  });

  it("never runs more than MAX_CONCURRENT_BUMPS random bumps at once", () => {
    const ids = ["a", "b", "c", "d", "e", "f"];
    const w = createSim(ids, { linesFor: lines }, rng(2));
    ids.forEach((id, i) => place(w, id, 0.2 + Math.floor(i / 2) * 0.3, 0.6 + (i % 2) * 0.01));
    stepSim(w, 16);
    expect(w.bumps).toHaveLength(WORLD.MAX_CONCURRENT_BUMPS);
  });

  it("swim over: target holds, my fish walks there and a bump starts despite cooldowns", () => {
    const w = createSim(["me", "ann"], { linesFor: lines }, rng(5));
    place(w, "me", 0.15, 0.8);
    place(w, "ann", 0.8, 0.45);
    for (const f of w.fish) f.cooldownUntil = Infinity;
    swimOver(w, "me", "ann");
    expect(w.fish.find((f) => f.id === "ann")!.mode).toBe("hold");
    for (let i = 0; i < 2000 && !w.bumps.length; i++) stepSim(w, 16);
    expect(w.bumps).toHaveLength(1);
    expect(w.bumps[0]).toMatchObject({ a: "me", b: "ann" });
  });
});
