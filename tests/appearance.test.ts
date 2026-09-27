import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ALL_FISH_SRCS,
  currentOption,
  cycle,
  DEFAULT_APPEARANCE,
  FISH_BASE,
  getAppearance,
  layersFor,
  LAYER_ORDER,
  randomAppearance,
  slotIsEmpty,
  SLOTS,
} from "@/lib/fish/appearance";
import { MockMeetAI, type MeetAI } from "@/lib/meet/ai";
import { runMeet, type MeetDeps } from "@/lib/meet/pipeline";
import { buildProfile, ExtractedProfileSchema, type Profile } from "@/lib/profile/schema";
import { ConsoleFileRepository } from "@/lib/storage/profileRepo";
import { getReplay, getWorld } from "@/lib/world/server";
import { MemoryPairs, MemoryProfiles } from "./helpers";

const PUBLIC = path.join(__dirname, "..", "public");

/** PNG width/height from the IHDR chunk. */
async function pngSize(src: string) {
  const buf = await readFile(path.join(PUBLIC, src));
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

let base: Profile;
beforeEach(async () => {
  const raw = JSON.parse(await readFile(path.join(__dirname, "..", "fixtures", "mock", "profile.json"), "utf8"));
  base = buildProfile(ExtractedProfileSchema.parse(raw), "Base");
});

describe("appearance registry", () => {
  it("unknown / missing / partial ids read as the slot default (no hat, boots)", () => {
    expect(DEFAULT_APPEARANCE).toEqual({ version: 1, head: null, feet: "feet-boots" });
    // Profiles saved before feet existed stored feet: null → boots, not bare stumps.
    expect(getAppearance({ head: "head-bow", feet: null })).toEqual({ version: 1, head: "head-bow", feet: "feet-boots" });
    expect(getAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
    expect(getAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(getAppearance("nope")).toEqual(DEFAULT_APPEARANCE);
    expect(getAppearance({ head: "head-bow" })).toEqual({ version: 1, head: "head-bow", feet: "feet-boots" });
    expect(getAppearance({ head: "head-crown", feet: "feet-rollerskates" })).toEqual(DEFAULT_APPEARANCE);
    expect(getAppearance({ head: "none", feet: 42 })).toEqual(DEFAULT_APPEARANCE);
    expect(getAppearance({ head: "head-bunny", extra: "ignored" })).toEqual({ version: 1, head: "head-bunny", feet: "feet-boots" });
  });

  it("head starts with 'None'; feet has no 'None' (the base has no feet) and defaults to boots", () => {
    const head = SLOTS.find((s) => s.id === "head")!;
    const feetSlot = SLOTS.find((s) => s.id === "feet")!;
    expect(head.options[0]).toMatchObject({ id: "none", label: "None" });
    expect(feetSlot.options.some((o) => o.id === "none")).toBe(false);
    expect(feetSlot.options[0].id).toBe(feetSlot.defaultId);
    expect(SLOTS.find((s) => s.id === "head")!.options).toHaveLength(6);
    expect(SLOTS.find((s) => s.id === "feet")!.options).toHaveLength(5);
    expect(slotIsEmpty("feet")).toBe(false);
    const ids = SLOTS.flatMap((s) => s.options.map((o) => o.id)).filter((id) => id !== "none");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("layers stack base → feet → head", () => {
    expect(LAYER_ORDER).toEqual(["base", "feet", "head"]);
    expect(layersFor(DEFAULT_APPEARANCE).map((l) => l.src)).toEqual([FISH_BASE.src, expect.stringMatching(/fih_boots/)]);
    const layers = layersFor({ version: 1, head: "head-shades", feet: "feet-heels" });
    expect(layers.map((l) => l.layer)).toEqual(["base", "feet", "head"]);
    expect(layers[1].src).toMatch(/fih_heels/);
    expect(layers[2].src).toMatch(/fih_glasses/);
  });

  it("arrows cycle and wrap; counters are 1-based", () => {
    let a = DEFAULT_APPEARANCE;
    expect(currentOption(a, "head")).toMatchObject({ index: 1, count: 6, option: { label: "None" } });
    a = cycle(a, "head", -1); // wraps to the last one
    expect(currentOption(a, "head").index).toBe(6);
    a = cycle(a, "head", 1); // back to none
    expect(a.head).toBeNull();
    for (let i = 0; i < 6; i++) a = cycle(a, "head", 1);
    expect(a.head).toBeNull(); // full loop
    // Feet wraps through its 5 options (no "None"): boots → bare feet, and boots ← skates.
    expect(currentOption(DEFAULT_APPEARANCE, "feet")).toMatchObject({ index: 1, count: 5, option: { label: "Cozy Boots" } });
    expect(cycle(DEFAULT_APPEARANCE, "feet", 1).feet).toBe("feet-bare");
    expect(cycle(DEFAULT_APPEARANCE, "feet", -1).feet).toBe("feet-skates");
  });

  it("randomize always produces a valid look", () => {
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 50; i++) {
      const a = randomAppearance(rng);
      expect(getAppearance(a)).toEqual(a);
    }
  });

  it("every overlay is a transparent PNG with exactly the base's pixel size", async () => {
    const baseSize = await pngSize(FISH_BASE.src);
    expect(baseSize).toMatchObject({ width: FISH_BASE.width, height: FISH_BASE.height });
    for (const src of ALL_FISH_SRCS) {
      const size = await pngSize(src);
      expect({ src, ...size }).toEqual({ src, width: FISH_BASE.width, height: FISH_BASE.height, colorType: 6 }); // 6 = RGBA
    }
  });
});

describe("storing appearance", () => {
  it("changing appearance never changes updatedAt (the pair AI cache key)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fish-"));
    const repo = new ConsoleFileRepository(dir);
    const log = console.log;
    console.log = () => {};
    const { id } = await repo.save({ profile: base, rawAnswers: [], appearance: { version: 1, head: "head-bow", feet: "feet-boots" } }).finally(() => (console.log = log));
    const before = (await repo.get(id))!;
    expect(before.appearance.head).toBe("head-bow");
    await new Promise((r) => setTimeout(r, 5));
    expect(await repo.setAppearance(id, { version: 1, head: "head-karen", feet: "feet-bogus" })).toBe(true);
    const after = (await repo.get(id))!;
    expect(after.appearance).toEqual({ version: 1, head: "head-karen", feet: "feet-boots" });
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(after.profile).toEqual(before.profile);
    expect(await repo.setAppearance("missing-fish", DEFAULT_APPEARANCE)).toBe(false);
  });

  it("a profile saved before this feature (no appearance field) loads as the plain fish", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "fish-"));
    await writeFile(path.join(dir, "old-fish.json"), JSON.stringify({ _id: "old-fish", createdAt: "2026-01-01", updatedAt: "2026-01-01", ...base }));
    const stored = await new ConsoleFileRepository(dir).get("old-fish");
    expect(stored?.appearance).toEqual(DEFAULT_APPEARANCE);
  });

  it("a new look doesn't trigger pair AI regeneration on the next meet", async () => {
    const profiles = new MemoryProfiles();
    profiles.add("ann", { ...base, displayName: "Ann" });
    profiles.add("ben", { ...base, displayName: "Ben" });
    const pairs = new MemoryPairs();
    // Count every AI call (analysis / dialogue / scenes) the pipeline makes.
    let aiCalls = 0;
    const mock = new MockMeetAI();
    const ai: MeetAI = {
      model: mock.model,
      analyze: (...a) => (aiCalls++, mock.analyze(...a)),
      dialogue: (...a) => (aiCalls++, mock.dialogue(...a)),
      scenes: (...a) => (aiCalls++, mock.scenes(...a)),
    };
    let clock = new Date("2026-09-20T12:00:00Z").getTime();
    const tap = () => {
      clock += 3600_000;
      const at = clock;
      // hangouts off: a re-tap is then a plain "already friends" that only reuses the cached pair.
      const deps: MeetDeps = { profiles, pairs, ai, random: () => 0.99, now: () => new Date(at), forcedOutcome: "friends", hangoutsEnabled: false, cooldownMs: 0 };
      return runMeet({ initiatorId: "ann", targetId: "ben", ignoreCooldown: true }, deps);
    };
    await tap();
    const afterFirst = aiCalls;
    expect(afterFirst).toBeGreaterThan(0);
    const cacheKey = (await pairs.getPair("ann__ben"))!.profilesUpdatedAt;
    await profiles.setAppearance("ann", { version: 1, head: "head-bunny", feet: "feet-boots" });
    const second = await tap();
    expect(aiCalls).toBe(afterFirst); // no regeneration
    expect((await pairs.getPair("ann__ben"))!.profilesUpdatedAt).toEqual(cacheKey);
    expect(second.fish.a.appearance.head).toBe("head-bunny"); // the meet response carries looks
  });
});

describe("appearance in API payloads", () => {
  it("world + replay include every fish's look (old profiles → plain)", async () => {
    const profiles = new MemoryProfiles();
    profiles.add("me", { ...base, displayName: "Me" });
    profiles.add("ann", { ...base, displayName: "Ann" });
    await profiles.setAppearance("ann", { version: 1, head: "head-shades", feet: "feet-boots" });
    const pairs = new MemoryPairs();
    const deps: MeetDeps = { profiles, pairs, ai: new MockMeetAI(), random: () => 0.99, now: () => new Date("2026-09-20T12:00:00Z"), forcedOutcome: "friends", hangoutsEnabled: true, cooldownMs: 0 };
    await runMeet({ initiatorId: "me", targetId: "ann", ignoreCooldown: true }, deps);

    const world = await getWorld("me", { profiles, pairs });
    expect(world.me.appearance).toEqual(DEFAULT_APPEARANCE);
    expect(world.residents[0].appearance.head).toBe("head-shades");

    const replay = await getReplay(pairs.attempts[0]._id, "me", { profiles, pairs });
    expect(replay.appearances).toEqual({ a: DEFAULT_APPEARANCE, b: { version: 1, head: "head-shades", feet: "feet-boots" } });
  });
});

describe("clammed up → no instant retry", () => {
  it("a re-tap within the wait gets a 'still shy' scene (no roll, no AI); after it, a real roll", async () => {
    const profiles = new MemoryProfiles();
    profiles.add("ann", { ...base, displayName: "Ann" });
    profiles.add("ben", { ...base, displayName: "Ben" });
    const pairs = new MemoryPairs();
    let aiCalls = 0;
    const mock = new MockMeetAI();
    const ai: MeetAI = {
      model: mock.model,
      analyze: (...a) => (aiCalls++, mock.analyze(...a)),
      dialogue: (...a) => (aiCalls++, mock.dialogue(...a)),
      scenes: (...a) => (aiCalls++, mock.scenes(...a)),
    };
    const WAIT = 5 * 60_000;
    let clock = new Date("2026-09-20T12:00:00Z").getTime();
    const tap = (forced: "friends" | "clammed_up") => {
      const deps: MeetDeps = { profiles, pairs, ai, random: () => 0.5, now: () => new Date(clock), forcedOutcome: forced, strangerRetryMs: WAIT };
      return runMeet({ initiatorId: "ann", targetId: "ben" }, deps);
    };

    expect((await tap("clammed_up")).outcome).toBe("clammed_up");
    const calls = aiCalls;
    clock += 60_000; // 1 minute later: too soon, even if it would succeed
    const soon = await tap("friends");
    expect(soon.outcome).toBe("cooldown");
    expect(soon.script[0].text).toMatch(/still feeling a little shy/);
    expect(aiCalls).toBe(calls);
    expect((await pairs.getPair("ann__ben"))!.status).toBe("strangers");

    clock += WAIT; // after the wait: a real roll
    expect((await tap("friends")).outcome).toBe("friends");
    expect((await pairs.getPair("ann__ben"))!.status).toBe("friends");
  });
});
