import type { BumpLine } from "@/lib/meet/schema";
import { cancelActivity, chooseActivity, createRuns, assign, freeSlotOf, routeZ, runOf, stepActivities, type ActivityDef, type ActivityRun, type Pose } from "@/lib/world/activities";
import { DEMO, WALKABLE, WORLD, type Area } from "@/lib/world/config";
import { planPath, randomFreePoint, segmentClear } from "@/lib/world/paths";
import type { Pt } from "@/lib/world/scene";

/**
 * Pure wander + bump + activity simulation for /world (no DOM, injectable RNG, sim clock in ms).
 * The React hook owns one SimWorld, calls stepSim every frame and paints the result.
 */

export type FishMode = "walk" | "pause" | "bump" | "approach" | "hold" | "task";

export type SimFish = {
  id: string;
  x: number;
  y: number;
  /** Final destination of the current walk (debug overlay). */
  tx: number;
  ty: number;
  /** Remaining waypoints (walk / task). */
  path: Pt[];
  /** World widths per second. */
  speed: number;
  /** 1 = facing right, -1 = facing left. */
  facing: 1 | -1;
  mode: FishMode;
  /** When a pause ends (sim ms). */
  until: number;
  /** No random bumps before this (sim ms). */
  cooldownUntil: number;
  bubble: string | null;
  /** Timed (activity) bubbles clear themselves at this time; 0 = managed by a bump. */
  bubbleUntil: number;
  /** Doing an activity: which, which anchor, walking there or at it. */
  task: { act: string; slot: number; stage: "going" | "there"; since: number; hurry?: boolean } | null;
  /** Visual pose ("wait" = at an anchor, waiting for the activity to start). */
  pose: Pose | "wait" | null;
  /** Draw-order y override (behind a counter front); null = feet y. */
  zY: number | null;
};

export type SimBump = {
  a: string;
  b: string;
  queue: { who: string; text: string }[];
  step: number;
  nextAt: number;
};

export type SimOptions = {
  area: Area;
  /** Footprints fish never stand in or walk through. */
  blocked: readonly Area[];
  activities: readonly ActivityDef[];
  reducedMotion: boolean;
  /** Exchanges for two fish, oriented so `.a` is spoken by the first id. */
  linesFor: (x: string, y: string) => BumpLine[];
  /** Have these two met (a pair exists)? Used to prefer friends as helpers/partners. */
  areFriends: (x: string, y: string) => boolean;
};

export type Tuning = {
  activityChance: number;
  /** Global sim-speed multiplier (debug). */
  timeScale: number;
  demo: boolean;
};

export type SimWorld = {
  t: number;
  fish: SimFish[];
  bumps: SimBump[];
  /** "Swim over": my fish is heading to `target`, which holds still. */
  approach: { me: string; target: string } | null;
  activities: ActivityRun[];
  /** Queued timed bubbles. */
  speech: { who: string; text: string; at: number; ms: number }[];
  /** Activity items currently shown. */
  items: Record<string, boolean>;
  /** Sprite id → hop until (sim ms). */
  hops: Record<string, number>;
  tuning: Tuning;
  rng: () => number;
  opts: SimOptions;
};

const between = (rng: () => number, [lo, hi]: readonly [number, number]) => lo + rng() * (hi - lo);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function randomPointIn(area: Area, rng: () => number): { x: number; y: number } {
  return { x: between(rng, [area.minX, area.maxX]), y: between(rng, [area.minY, area.maxY]) };
}

export function clampToArea(p: { x: number; y: number }, area: Area) {
  return { x: clamp(p.x, area.minX, area.maxX), y: clamp(p.y, area.minY, area.maxY) };
}

/**
 * Next wander target: a free spot the fish can walk to in a straight line
 * (reduced motion: a small hop nearby). Null if nothing works (stay put).
 */
export function wanderTarget(f: Pick<SimFish, "x" | "y">, w: Pick<SimWorld, "rng" | "opts">): Pt | null {
  const { area, blocked } = w.opts;
  for (let i = 0; i < 12; i++) {
    let p: Pt | null;
    if (w.opts.reducedMotion) {
      const r = WORLD.REDUCED_MOTION.WANDER_RADIUS;
      p = clampToArea({ x: f.x + between(w.rng, [-r, r]), y: f.y + between(w.rng, [-r, r]) }, area);
      if (blocked.some((b) => p!.x >= b.minX && p!.x <= b.maxX && p!.y >= b.minY && p!.y <= b.maxY)) p = null;
    } else p = randomFreePoint(area, blocked, w.rng);
    if (p && segmentClear(f, p, blocked)) return p;
  }
  return null;
}

const pauseRange = (w: SimWorld) =>
  w.opts.reducedMotion ? WORLD.REDUCED_MOTION.PAUSE_MS : w.tuning.demo ? DEMO.PAUSE_MS : WORLD.PAUSE_MS;

type CreateOpts = Partial<Omit<SimOptions, "linesFor">> & Pick<SimOptions, "linesFor"> & { demo?: boolean };

/** New world; fish already in `prev` keep their position (e.g. when the resident list refreshes). */
export function createSim(ids: string[], opts: CreateOpts, rng: () => number = Math.random, prev?: SimWorld): SimWorld {
  const { demo = false, ...rest } = opts;
  const full: SimOptions = { area: WALKABLE, blocked: [], activities: [], reducedMotion: false, areFriends: () => false, ...rest };
  const w: SimWorld = {
    t: prev?.t ?? 0,
    fish: [],
    bumps: [],
    approach: null,
    activities: createRuns([...full.activities]),
    speech: [],
    items: {},
    hops: {},
    tuning: prev?.tuning ?? { activityChance: demo ? DEMO.ACTIVITY_CHANCE : WORLD.ACTIVITY_CHANCE, timeScale: 1, demo },
    rng,
    opts: full,
  };
  const speedFactor = full.reducedMotion ? WORLD.REDUCED_MOTION.SPEED_FACTOR : 1;
  for (const id of ids) {
    const old = prev?.fish.find((f) => f.id === id);
    if (old) {
      w.fish.push({ ...old, mode: "pause", until: w.t, path: [], task: null, pose: null, zY: null, bubble: null, bubbleUntil: 0 });
      continue;
    }
    const p = randomFreePoint(full.area, full.blocked, rng) ?? randomPointIn(full.area, rng);
    w.fish.push({
      id,
      ...p,
      tx: p.x,
      ty: p.y,
      path: [],
      speed: WORLD.WALK_SPEED * speedFactor * (1 + between(rng, [-WORLD.SPEED_JITTER, WORLD.SPEED_JITTER])),
      facing: rng() < 0.5 ? -1 : 1,
      mode: "pause",
      until: w.t + between(rng, [0, 1500]),
      cooldownUntil: w.t + between(rng, WORLD.SPAWN_COOLDOWN_MS),
      bubble: null,
      bubbleUntil: 0,
      task: null,
      pose: null,
      zY: null,
    });
  }
  return w;
}

const byId = (w: SimWorld, id: string) => w.fish.find((f) => f.id === id);

export function bumpDistance(a: Pick<SimFish, "x" | "y">, b: Pick<SimFish, "x" | "y">): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) * WORLD.BUMP_Y_WEIGHT);
}

const isFree = (f: SimFish, t: number) => (f.mode === "walk" || f.mode === "pause") && !f.task && f.zY === null && t >= f.cooldownUntil;

/** Pairs of free fish close enough to bump, up to the concurrency cap. */
export function findBumps(w: SimWorld): [SimFish, SimFish][] {
  const slots = WORLD.MAX_CONCURRENT_BUMPS - w.bumps.length;
  const out: [SimFish, SimFish][] = [];
  const taken = new Set<string>();
  for (let i = 0; i < w.fish.length && out.length < slots; i++) {
    const a = w.fish[i];
    if (taken.has(a.id) || !isFree(a, w.t)) continue;
    for (let j = i + 1; j < w.fish.length; j++) {
      const b = w.fish[j];
      if (taken.has(b.id) || !isFree(b, w.t)) continue;
      if (bumpDistance(a, b) < WORLD.BUMP_DISTANCE) {
        out.push([a, b]);
        taken.add(a.id).add(b.id);
        break;
      }
    }
  }
  return out;
}

/** Stop both fish, face each other, queue 1–2 exchanges of bubbles. */
export function startBump(w: SimWorld, a: SimFish, b: SimFish): SimBump {
  const lines = w.opts.linesFor(a.id, b.id);
  const first = Math.floor(w.rng() * lines.length);
  const picks = lines.length ? [lines[first]] : [];
  if (lines.length > 1 && w.rng() < WORLD.SECOND_EXCHANGE_CHANCE) picks.push(lines[(first + 1 + Math.floor(w.rng() * (lines.length - 1))) % lines.length]);

  for (const f of [a, b]) {
    f.mode = "bump";
    f.bubble = null;
    f.bubbleUntil = 0;
    f.path = [];
  }
  a.facing = b.x >= a.x ? 1 : -1;
  b.facing = a.x > b.x ? 1 : -1;
  const bump: SimBump = {
    a: a.id,
    b: b.id,
    queue: picks.flatMap((l) => [
      { who: a.id, text: l.a },
      { who: b.id, text: l.b },
    ]),
    step: 0,
    nextAt: w.t,
  };
  w.bumps.push(bump);
  return bump;
}

function endBump(w: SimWorld, bump: SimBump) {
  w.bumps = w.bumps.filter((x) => x !== bump);
  for (const id of [bump.a, bump.b]) {
    const f = byId(w, id);
    if (!f || f.mode !== "bump") continue;
    f.bubble = null;
    f.mode = "pause";
    f.until = w.t + WORLD.BUMP_END_PAUSE_MS;
    f.cooldownUntil = w.t + WORLD.BUMP_COOLDOWN_MS;
  }
}

/** Cancel any bump involving this fish (a "Swim over" interrupts it). */
function cancelBumpsOf(w: SimWorld, id: string) {
  for (const bump of [...w.bumps]) if (bump.a === id || bump.b === id) endBump(w, bump);
}

/** Cancel the activity this fish is part of (cleanly: items gone, everyone in it freed). */
function cancelTaskOf(w: SimWorld, f: SimFish) {
  const r = f.task && runOf(w, f.task.act);
  if (r) cancelActivity(w, r);
}

/** My fish swims to `targetId`, which stops and waits; on arrival they always bump. Interrupts activities. */
export function swimOver(w: SimWorld, meId: string, targetId: string) {
  const me = byId(w, meId);
  const target = byId(w, targetId);
  if (!me || !target || meId === targetId) return;
  if (w.approach) {
    const held = byId(w, w.approach.target);
    if (held && held.mode === "hold") Object.assign(held, { mode: "pause", until: w.t });
  }
  for (const f of [me, target]) {
    cancelBumpsOf(w, f.id);
    cancelTaskOf(w, f);
    f.bubble = null;
    f.bubbleUntil = 0;
    f.path = [];
    f.pose = null;
    f.zY = null;
  }
  target.mode = "hold";
  me.mode = "approach";
  w.approach = { me: meId, target: targetId };
}

function moveToward(f: SimFish, tx: number, ty: number, speed: number, dt: number): boolean {
  const dx = tx - f.x;
  const dy = ty - f.y;
  const dist = Math.hypot(dx, dy);
  const stepLen = (speed * dt) / 1000;
  if (Math.abs(dx) > 0.002) f.facing = dx > 0 ? 1 : -1;
  if (dist <= stepLen || dist < 1e-6) {
    f.x = tx;
    f.y = ty;
    return true;
  }
  f.x += (dx / dist) * stepLen;
  f.y += (dy / dist) * stepLen;
  return false;
}

/** Walk the waypoint list; true once it's empty. */
function followPath(f: SimFish, dt: number, speed = f.speed): boolean {
  let left = dt;
  while (f.path.length && left > 0) {
    const [p] = f.path;
    const d = Math.hypot(p.x - f.x, p.y - f.y);
    const ms = (d / speed) * 1000;
    if (moveToward(f, p.x, p.y, speed, left)) {
      f.path.shift();
      // Leaving an anchor: back to normal draw order once out from behind the counter.
      if (f.mode === "walk") f.zY = null;
      left -= ms;
    } else left = 0;
  }
  return f.path.length === 0;
}

/** A pause ended: maybe an activity, else wander somewhere reachable. */
function moveOn(w: SimWorld, f: SimFish) {
  if (w.activities.length && w.rng() < w.tuning.activityChance) {
    const r = chooseActivity(w, f);
    if (r) {
      assign(w, r, f, freeSlotOf(r, f));
      return;
    }
  }
  const next = wanderTarget(f, w);
  if (!next) {
    f.until = w.t + between(w.rng, pauseRange(w));
    return;
  }
  f.path = planPath(f, next, w.opts.area, w.opts.blocked);
  f.mode = "walk";
}

/** Advance the world by dtMs (clamped per frame, then scaled by tuning.timeScale). */
export function stepSim(w: SimWorld, dtMs: number) {
  const dt = Math.min(Math.max(dtMs, 0), WORLD.MAX_DT_MS) * w.tuning.timeScale;
  w.t += dt;

  for (const f of w.fish) {
    if (f.bubbleUntil && w.t >= f.bubbleUntil) {
      f.bubble = null;
      f.bubbleUntil = 0;
    }
    if (f.mode === "walk") {
      if (followPath(f, dt)) {
        f.mode = "pause";
        f.zY = null; // walked out of a counter / stall route
        f.until = w.t + between(w.rng, pauseRange(w));
      }
    } else if (f.mode === "pause" && w.t >= f.until) {
      moveOn(w, f);
    } else if (f.mode === "task") {
      if (f.task?.stage === "going") {
        followPath(f, dt, f.task.hurry ? f.speed * WORLD.HELPER_SPEED_FACTOR : f.speed);
        // Stuck (e.g. unreachable): give up the whole activity.
        if (w.t - f.task.since > WORLD.ARRIVE_TIMEOUT_MS) cancelTaskOf(w, f);
      }
      f.zY = routeZ(w, f);
    }
    const last = f.path[f.path.length - 1];
    if (last) {
      f.tx = last.x;
      f.ty = last.y;
    }
  }

  // Swim over: stand beside the target on my side, then force an exchange (ignores cooldowns + cap).
  if (w.approach) {
    const me = byId(w, w.approach.me);
    const target = byId(w, w.approach.target);
    if (!me || !target || me.mode !== "approach") {
      w.approach = null;
    } else {
      const side = me.x <= target.x ? -1 : 1;
      const spot = clampToArea({ x: target.x + side * WORLD.FISH_WIDTH, y: target.y }, w.opts.area);
      me.tx = spot.x;
      me.ty = spot.y;
      if (moveToward(me, spot.x, spot.y, WORLD.WALK_SPEED * WORLD.SWIM_OVER_SPEED_FACTOR, dt)) {
        w.approach = null;
        startBump(w, me, target);
      }
    }
  }

  stepActivities(w);

  for (const [a, b] of findBumps(w)) startBump(w, a, b);

  for (const bump of [...w.bumps]) {
    if (w.t < bump.nextAt) continue;
    for (const id of [bump.a, bump.b]) {
      const f = byId(w, id);
      if (f) f.bubble = null;
    }
    const line = bump.queue[bump.step];
    if (!line) {
      endBump(w, bump);
      continue;
    }
    const speaker = byId(w, line.who);
    if (speaker) speaker.bubble = line.text;
    bump.step += 1;
    bump.nextAt = w.t + WORLD.BUBBLE_MS;
  }
}

/** 0..1 depth for scale (1 = nearest the viewer). */
export function depthOf(y: number, area: Area = WALKABLE): number {
  return clamp((y - area.minY) / (area.maxY - area.minY), 0, 1);
}
