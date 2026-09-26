import type { BumpLine } from "@/lib/meet/schema";
import { WALKABLE, WORLD, type Area } from "@/lib/world/config";

/**
 * Pure wander + bump simulation for /world (no DOM, injectable RNG, sim clock in ms).
 * The React hook owns one SimWorld, calls stepSim every frame and paints the result.
 */

export type FishMode = "walk" | "pause" | "bump" | "approach" | "hold";

export type SimFish = {
  id: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
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
  reducedMotion: boolean;
  /** Exchanges for two fish, oriented so `.a` is spoken by the first id. */
  linesFor: (x: string, y: string) => BumpLine[];
};

export type SimWorld = {
  t: number;
  fish: SimFish[];
  bumps: SimBump[];
  /** "Swim over": my fish is heading to `target`, which holds still. */
  approach: { me: string; target: string } | null;
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

/** Next wander target: anywhere, or (reduced motion) a small hop nearby. */
export function wanderTarget(f: Pick<SimFish, "x" | "y">, w: Pick<SimWorld, "rng" | "opts">) {
  if (!w.opts.reducedMotion) return randomPointIn(w.opts.area, w.rng);
  const r = WORLD.REDUCED_MOTION.WANDER_RADIUS;
  return clampToArea({ x: f.x + between(w.rng, [-r, r]), y: f.y + between(w.rng, [-r, r]) }, w.opts.area);
}

const pauseRange = (w: SimWorld) => (w.opts.reducedMotion ? WORLD.REDUCED_MOTION.PAUSE_MS : WORLD.PAUSE_MS);

/** New world; fish already in `prev` keep their state (e.g. when the resident list refreshes). */
export function createSim(ids: string[], opts: Partial<SimOptions> & Pick<SimOptions, "linesFor">, rng: () => number = Math.random, prev?: SimWorld): SimWorld {
  const full: SimOptions = { area: WALKABLE, reducedMotion: false, ...opts };
  const w: SimWorld = { t: prev?.t ?? 0, fish: [], bumps: [], approach: null, rng, opts: full };
  const speedFactor = full.reducedMotion ? WORLD.REDUCED_MOTION.SPEED_FACTOR : 1;
  for (const id of ids) {
    const old = prev?.fish.find((f) => f.id === id);
    if (old) {
      w.fish.push({ ...old, mode: old.mode === "bump" || old.mode === "hold" || old.mode === "approach" ? "pause" : old.mode, bubble: null });
      continue;
    }
    const p = randomPointIn(full.area, rng);
    w.fish.push({
      id,
      ...p,
      tx: p.x,
      ty: p.y,
      speed: WORLD.WALK_SPEED * speedFactor * (1 + between(rng, [-WORLD.SPEED_JITTER, WORLD.SPEED_JITTER])),
      facing: rng() < 0.5 ? -1 : 1,
      mode: "pause",
      until: w.t + between(rng, [0, 1500]),
      cooldownUntil: w.t + between(rng, WORLD.SPAWN_COOLDOWN_MS),
      bubble: null,
    });
  }
  return w;
}

const byId = (w: SimWorld, id: string) => w.fish.find((f) => f.id === id);

export function bumpDistance(a: Pick<SimFish, "x" | "y">, b: Pick<SimFish, "x" | "y">): number {
  return Math.hypot(a.x - b.x, (a.y - b.y) * WORLD.BUMP_Y_WEIGHT);
}

const isFree = (f: SimFish, t: number) => (f.mode === "walk" || f.mode === "pause") && t >= f.cooldownUntil;

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

/** My fish swims to `targetId`, which stops and waits; on arrival they always bump. */
export function swimOver(w: SimWorld, meId: string, targetId: string) {
  const me = byId(w, meId);
  const target = byId(w, targetId);
  if (!me || !target || meId === targetId) return;
  if (w.approach) {
    const held = byId(w, w.approach.target);
    if (held && held.mode === "hold") Object.assign(held, { mode: "pause", until: w.t });
  }
  cancelBumpsOf(w, meId);
  cancelBumpsOf(w, targetId);
  target.mode = "hold";
  target.bubble = null;
  me.mode = "approach";
  me.bubble = null;
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

/** Advance the world by dtMs (clamped). */
export function stepSim(w: SimWorld, dtMs: number) {
  const dt = Math.min(Math.max(dtMs, 0), WORLD.MAX_DT_MS);
  w.t += dt;

  for (const f of w.fish) {
    if (f.mode === "walk") {
      if (moveToward(f, f.tx, f.ty, f.speed, dt)) {
        f.mode = "pause";
        f.until = w.t + between(w.rng, pauseRange(w));
      }
    } else if (f.mode === "pause" && w.t >= f.until) {
      const next = wanderTarget(f, w);
      f.tx = next.x;
      f.ty = next.y;
      f.mode = "walk";
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
      if (moveToward(me, spot.x, spot.y, WORLD.WALK_SPEED * WORLD.SWIM_OVER_SPEED_FACTOR, dt)) {
        w.approach = null;
        startBump(w, me, target);
      }
    }
  }

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

/** 0..1 depth for drawing order and scale (1 = nearest the viewer). */
export function depthOf(y: number, area: Area = WALKABLE): number {
  return clamp((y - area.minY) / (area.maxY - area.minY), 0, 1);
}
