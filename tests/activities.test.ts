import { describe, expect, it } from "vitest";
import { ACTIVITIES, assign, forceActivity, runOf } from "@/lib/world/activities";
import { WALKABLE, WORLD } from "@/lib/world/config";
import { inBlocked, planPath, segmentClear } from "@/lib/world/paths";
import { BLOCKED, SEAGULL_ANIM_MS, SPRITES } from "@/lib/world/scene";
import { createSim, findBumps, stepSim, swimOver, type SimFish, type SimWorld } from "@/lib/world/sim";

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lines = () => [{ a: "hi?", b: "hello!" }];

/** A scene world with activities that only start when forced. */
function world(ids: string[], seed = 1, friends: [string, string][] = []): SimWorld {
  const areFriends = (x: string, y: string) => friends.some(([a, b]) => (a === x && b === y) || (a === y && b === x));
  const w = createSim(ids, { linesFor: lines, areFriends, blocked: BLOCKED, activities: ACTIVITIES }, rng(seed));
  w.tuning.activityChance = 0;
  return w;
}

const fish = (w: SimWorld, id: string) => w.fish.find((f) => f.id === id)!;

function place(w: SimWorld, id: string, x: number, y: number) {
  Object.assign(fish(w, id), { x, y, tx: x, ty: y, path: [], mode: "pause", until: Infinity, cooldownUntil: Infinity });
}

/** Step until `done` (or give up after `maxMs` of sim time). */
function until(w: SimWorld, done: () => boolean, maxMs = 60000, dt = 20) {
  const end = w.t + maxMs;
  while (!done() && w.t < end) stepSim(w, dt);
  return done();
}

const run = (w: SimWorld, id: string) => runOf(w, id)!;
const def = (id: string) => ACTIVITIES.find((a) => a.id === id)!;
const atAnchor = (f: SimFish) => f.task?.stage === "there";
const cones = (w: SimWorld) => Object.keys(w.items).filter((id) => id.startsWith("icecream-") && w.items[id]);

describe("paths and blocked props", () => {
  it("planned paths go around blocked rects", () => {
    // Straight across the picnic table.
    const from = { x: 0.5, y: 0.52 };
    const to = { x: 0.96, y: 0.52 };
    expect(segmentClear(from, to, BLOCKED)).toBe(false);
    const path = planPath(from, to, WALKABLE, BLOCKED);
    expect(path.length).toBeGreaterThan(1);
    expect(path[path.length - 1]).toEqual(to);
    [from, ...path].slice(1).forEach((p, i) => expect(segmentClear([from, ...path][i], p, BLOCKED)).toBe(true));
  });

  it("wandering fish never stand in or walk through a blocked prop", () => {
    const w = world(["a", "b", "c", "d", "e", "f", "g", "h"], 11);
    for (let i = 0; i < 15000; i++) {
      stepSim(w, 16);
      for (const f of w.fish) if (f.mode === "walk" || f.mode === "pause") expect(inBlocked(f, BLOCKED)).toBe(false);
    }
  });

  it("every spawnable item has a label (placeholder) and a configured path", () => {
    const items = SPRITES.filter((s) => s.item);
    expect(items.map((s) => s.id).filter((id) => !id.startsWith("icecream-")).sort()).toEqual(["booth1-items", "booth2-items", "sandcastle", "seagull-anim"]);
    expect(items.filter((s) => s.id.startsWith("icecream-"))).toHaveLength(6); // 3 flavours × 2 sides
    for (const s of items) expect(s.label && s.src.length).toBeTruthy();
    // Activities only reference sprites that exist.
    for (const a of ACTIVITIES)
      for (const id of [...a.effect.itemIds, ...(a.effect.oneOf ?? []).flat(), ...(a.effect.hop ?? [])]) expect(SPRITES.some((s) => s.id === id)).toBe(true);
  });
});

describe("sandcastle (two-fish build)", () => {
  it("summons the nearest free fish, both dig, the castle pops in and outlasts them by persistMs", () => {
    const w = world(["a", "b", "c"]);
    const A = def("sandcastle").anchors[0];
    place(w, "a", A.x - 0.1, 0.8);
    place(w, "b", 0.45, 0.8); // nearest to anchor B
    place(w, "c", 0.2, 0.35);
    forceActivity(w, "sandcastle");
    const r = run(w, "sandcastle");
    expect(r.slots).toEqual(["a", null]);

    expect(until(w, () => atAnchor(fish(w, "a")))).toBe(true);
    stepSim(w, 20);
    expect(fish(w, "a").bubble).toMatch(/help me build|sandcastle time/);
    expect(r.slots).toEqual(["a", "b"]); // helper picked + reserved
    expect(fish(w, "b").task).toMatchObject({ act: "sandcastle", hurry: true });
    until(w, () => !!fish(w, "b").bubble, 2000);
    expect(fish(w, "b").bubble).toMatch(/coming|on it/);

    expect(until(w, () => r.phase === "active")).toBe(true);
    expect([fish(w, "a").pose, fish(w, "b").pose]).toEqual(["dig", "dig"]);
    expect([fish(w, "a").facing, fish(w, "b").facing]).toEqual([-1, 1]); // both face the bucket/castle
    expect(w.items.sandcastle).toBeFalsy();
    until(w, () => !!w.items.sandcastle, def("sandcastle").triggerAfterMs + 100);
    expect(w.items.sandcastle).toBe(true);

    expect(until(w, () => r.phase === "after")).toBe(true);
    const leftAt = w.t;
    expect(fish(w, "a").task).toBeNull();
    until(w, () => !w.items.sandcastle, 20000);
    expect(w.t - leftAt).toBeGreaterThanOrEqual(def("sandcastle").effect.persistMs! - 40);
    expect(w.t - leftAt).toBeLessThan(def("sandcastle").effect.persistMs! + 100);
    expect(r.phase).toBe("cooldown");
    expect(r.cooldownUntil).toBeGreaterThan(w.t + def("sandcastle").cooldownMs);
  });

  it("prefers a friend as helper when not much further away", () => {
    const w = world(["a", "b", "c"], 1, [["a", "c"]]);
    const B = def("sandcastle").anchors[1];
    place(w, "a", def("sandcastle").anchors[0].x, 0.8);
    place(w, "b", B.x, 0.6);
    place(w, "c", B.x, 0.52); // a bit further, but a friend
    forceActivity(w, "sandcastle");
    until(w, () => run(w, "sandcastle").slots[1] !== null);
    expect(run(w, "sandcastle").slots[1]).toBe("c");
  });

  it("no free fish → 'aw…', no sandcastle, short cooldown", () => {
    const w = world(["a"]);
    forceActivity(w, "sandcastle");
    const r = run(w, "sandcastle");
    expect(until(w, () => r.phase === "idle" && r.cooldownUntil > 0)).toBe(true);
    expect(fish(w, "a").bubble).toBe("aw…");
    expect(w.items.sandcastle).toBeFalsy();
    expect(r.done).toBe(0);
    expect(r.cooldownUntil - w.t).toBeLessThanOrEqual(def("sandcastle").failCooldownMs!);
  });

  it("helper that doesn't arrive in ~8s → 'aw…' and both are freed", () => {
    const w = world(["a", "b"]);
    place(w, "a", def("sandcastle").anchors[0].x, 0.8);
    place(w, "b", 0.1, 0.8);
    fish(w, "b").speed = 0.0001; // stuck in the sand
    forceActivity(w, "sandcastle");
    const r = run(w, "sandcastle");
    until(w, () => r.slots[1] === "b");
    const summonedAt = w.t;
    expect(until(w, () => r.phase === "idle")).toBe(true);
    expect(w.t - summonedAt).toBeGreaterThanOrEqual(def("sandcastle").waitMs! - 40);
    expect(fish(w, "a").bubble).toBe("aw…");
    expect([fish(w, "a").task, fish(w, "b").task]).toEqual([null, null]);
    expect(w.items.sandcastle).toBeFalsy();
  });

  it("reserved helpers can't be grabbed by bumps", () => {
    const w = world(["a", "b", "c"]);
    place(w, "a", def("sandcastle").anchors[0].x, 0.8);
    forceActivity(w, "sandcastle");
    until(w, () => run(w, "sandcastle").slots[1] !== null);
    const helper = fish(w, run(w, "sandcastle").slots[1]!);
    const other = w.fish.find((f) => f !== helper && f.id !== "a")!;
    Object.assign(other, { x: helper.x + 0.01, y: helper.y, cooldownUntil: 0, mode: "pause", until: Infinity });
    helper.cooldownUntil = 0;
    expect(findBumps(w)).toEqual([]);
  });

  it("'Swim over' cancels the build: reservations cleared, no sandcastle", () => {
    const w = world(["me", "b"]);
    place(w, "me", def("sandcastle").anchors[0].x, 0.8);
    place(w, "b", def("sandcastle").anchors[1].x, 0.8);
    forceActivity(w, "sandcastle");
    const r = run(w, "sandcastle");
    until(w, () => r.phase === "active");
    until(w, () => !!w.items.sandcastle);
    swimOver(w, "me", "b");
    stepSim(w, 20);
    expect(r.phase).toBe("idle");
    expect(r.slots).toEqual([null, null]);
    expect(w.items.sandcastle).toBeFalsy();
    expect(fish(w, "b").mode).toBe("hold");
    expect(until(w, () => w.bumps.length > 0)).toBe(true);
  });
});

describe("other activities", () => {
  it("booth items show only while the fish is behind the counter", () => {
    const w = world(["a"]);
    forceActivity(w, "booth1");
    const r = run(w, "booth1");
    expect(until(w, () => r.phase === "active")).toBe(true);
    expect(fish(w, "a").y).toBeLessThan(0.25); // behind the stall's base → drawn behind it
    until(w, () => !!w.items["booth1-items"]);
    expect(until(w, () => r.phase !== "active")).toBe(true);
    expect(w.items["booth1-items"]).toBeFalsy();
    // Walks back out through the gap before wandering again.
    expect(fish(w, "a").mode).toBe("walk");
  });

  it("picnic table needs two fish: one alone gives up, two get ice cream (and chat)", () => {
    const w = world(["a", "b"]);
    const r = run(w, "picnic");
    assign(w, r, fish(w, "a"), 0);
    expect(until(w, () => atAnchor(fish(w, "a")))).toBe(true);
    expect(until(w, () => r.phase === "idle")).toBe(true); // nobody joined within waitMs
    expect(cones(w)).toEqual([]);

    r.cooldownUntil = 0;
    forceActivity(w, "picnic");
    expect(until(w, () => r.phase === "active")).toBe(true);
    let chatted = false;
    until(w, () => ((chatted ||= w.fish.some((f) => f.bubble === "hi?" || f.bubble === "hello!")), cones(w).length > 0));
    // Exactly one random-flavour cone per side.
    expect(cones(w).map((id) => id.split("-")[1]).sort()).toEqual(["left", "right"]);
    expect(chatted).toBe(true);
  });

  it("a waiting picnic fish makes others more likely to join", () => {
    const w = world(["a", "b"]);
    const r = run(w, "picnic");
    assign(w, r, fish(w, "a"), 0);
    until(w, () => atAnchor(fish(w, "a")));
    w.tuning.activityChance = 1;
    Object.assign(fish(w, "b"), { mode: "pause", until: w.t });
    stepSim(w, 20);
    // Every other activity is available too; the join boost makes the picnic win almost always.
    expect(fish(w, "b").task?.act).toBe("picnic");
  });

  it("seagull plays its fries animation once, then the static gull is back", () => {
    const w = world(["a"]);
    forceActivity(w, "seagull");
    const r = run(w, "seagull");
    until(w, () => !!w.items["seagull-anim"]);
    const on = w.t;
    until(w, () => !w.items["seagull-anim"]);
    expect(w.t - on).toBeGreaterThanOrEqual(SEAGULL_ANIM_MS - 40);
    expect(w.t - on).toBeLessThanOrEqual(SEAGULL_ANIM_MS + 40);
    expect(r.phase).toBe("active"); // fish still there, animation done
    // The static gull hides exactly while the animation shows.
    expect(SPRITES.find((s) => s.id === "seagull")!.hideWhile).toBe("seagull-anim");
  });

  it("ice cream counter: the fish is drawn between the store and its counter front", () => {
    const w = world(["a"]);
    forceActivity(w, "store");
    until(w, () => atAnchor(fish(w, "a")));
    const counter = SPRITES.find((s) => s.id === "counter-front")!;
    expect(fish(w, "a").zY).toBeLessThan(counter.rect.maxY);
    until(w, () => run(w, "store").phase !== "active");
    until(w, () => fish(w, "a").mode === "pause");
    expect(fish(w, "a").zY).toBeNull();
  });

  it("free fish pick activities on their own and nothing gets stuck", () => {
    const w = createSim(["a", "b", "c", "d", "e", "f"], { linesFor: lines, blocked: BLOCKED, activities: ACTIVITIES, demo: true }, rng(21));
    for (let i = 0; i < 40000; i++) stepSim(w, 16); // ~10 min
    for (const r of w.activities) expect(r.done).toBeGreaterThan(0);
    for (const f of w.fish) if (f.task) expect(w.t - f.task.since).toBeLessThan(WORLD.ARRIVE_TIMEOUT_MS + 30000);
  });
});
