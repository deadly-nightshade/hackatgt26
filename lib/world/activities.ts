import { DEMO, WORLD, type Area } from "@/lib/world/config";
import { planPath } from "@/lib/world/paths";
import { BOOTH1, BOOTH2, BUCKET, COUNTER, PICNIC, SANDCASTLE, SEAGULL, SEAGULL_ANIM, SEAGULL_ANIM_MS, STALL_GAP, STORE, STORE_WINDOW_X, type Pt } from "@/lib/world/scene";
import type { SimFish, SimWorld } from "@/lib/world/sim";

/**
 * Data-driven ambient activities: a free fish walks to an anchor, faces the right
 * way, waits, an effect (items popping in) happens, then it leaves.
 * Pure: the sim calls these; nothing here touches the DOM.
 */

export type Pose = "dig" | "sit" | "shop" | "stand";

export type Anchor = Pt & {
  facing: 1 | -1;
  /** Fixed route from outside (via[0] is reached by normal path planning; later legs may enter blocked rects). */
  via?: Pt[];
  /** Draw-order y while on the via route / at the anchor (e.g. between the store and its counter front). */
  zY?: number;
};

export type ActivityDef = {
  id: string;
  label: string;
  /** Where it happens (debug overlay). */
  zone: Area;
  anchors: Anchor[];
  fishRequired: 1 | 2;
  dwellMs: [number, number];
  triggerAfterMs: number;
  effect: {
    itemIds: string[];
    mode: "whileOccupied" | "persistAfter";
    /** persistAfter: items stay this long after the fish leave. */
    persistMs?: number;
    /** whileOccupied: items vanish this long after the fish leave (0 = at once). */
    lingerMs?: number;
    /** Items vanish after this long even if the fish is still there. */
    maxOnMs?: number;
    /** Sprites that hop when the effect fires. */
    hop?: string[];
  };
  cooldownMs: number;
  weight: number;
  pose: Pose;
  /** First fish calls the nearest free fish (friends first) to the second anchor. */
  summonHelper?: boolean;
  /** How long to wait for the second fish (summoned or joining) before giving up. */
  waitMs?: number;
  /** Cooldown after giving up. */
  failCooldownMs?: number;
  /** While one fish waits, free fish are this much more likely to join. */
  joinBoost?: number;
  /** Two seated fish swap bump lines. */
  chat?: boolean;
  lines?: { call: string[]; reply: string[]; giveUp: string[] };
};

const rect = (minX: number, minY: number, maxX: number, maxY: number): Area => ({ minX, minY, maxX, maxY });
const midX = (a: Area) => (a.minX + a.maxX) / 2;

/** Behind a stall's counter, reached through the gap between the stalls. */
const behindStall = (booth: Area): Anchor => ({
  x: midX(booth),
  y: STALL_GAP.y,
  facing: -1,
  via: [{ x: STALL_GAP.x, y: 0.3 }, STALL_GAP],
});

export const ACTIVITIES: ActivityDef[] = [
  {
    id: "sandcastle",
    label: "Sandcastle",
    zone: rect(SANDCASTLE.minX - 0.07, 0.68, BUCKET.maxX + 0.07, 0.8),
    anchors: [
      { x: BUCKET.maxX + 0.053, y: 0.762, facing: -1 }, // A: beside the bucket & shovel
      { x: SANDCASTLE.minX - 0.054, y: 0.767, facing: 1 }, // B: other side of the castle spot
    ],
    fishRequired: 2,
    summonHelper: true,
    waitMs: 8000,
    failCooldownMs: 6000,
    dwellMs: [5000, 6500],
    triggerAfterMs: 3000,
    effect: { itemIds: ["sandcastle"], mode: "persistAfter", persistMs: 4000 },
    cooldownMs: 15000,
    weight: 3,
    pose: "dig",
    lines: {
      call: ["help me build! 🏖️", "sandcastle time?"],
      reply: ["coming!", "on it 🐟"],
      giveUp: ["aw…"],
    },
  },
  {
    id: "booth1",
    label: "Booth 1",
    zone: rect(BOOTH1.minX, BOOTH1.minY, BOOTH1.maxX, BOOTH1.maxY),
    anchors: [behindStall(BOOTH1)],
    fishRequired: 1,
    dwellMs: [5000, 8000],
    triggerAfterMs: 1000,
    effect: { itemIds: ["booth1-items"], mode: "whileOccupied" },
    cooldownMs: 8000,
    weight: 2,
    pose: "shop",
  },
  {
    id: "booth2",
    label: "Booth 2",
    zone: rect(BOOTH2.minX, BOOTH2.minY, BOOTH2.maxX, BOOTH2.maxY),
    anchors: [behindStall(BOOTH2)],
    fishRequired: 1,
    dwellMs: [5000, 8000],
    triggerAfterMs: 1000,
    effect: { itemIds: ["booth2-items"], mode: "whileOccupied" },
    cooldownMs: 8000,
    weight: 2,
    pose: "shop",
  },
  {
    id: "picnic",
    label: "Picnic table",
    zone: rect(PICNIC.minX, PICNIC.minY, PICNIC.maxX, PICNIC.maxY),
    anchors: [
      // Seated fish are drawn over the table (zY), so they're fully visible.
      { x: 0.61, y: 0.488, facing: 1, via: [{ x: 0.53, y: 0.5 }], zY: PICNIC.maxY + 0.002 },
      { x: 0.925, y: 0.488, facing: -1, via: [{ x: 0.975, y: 0.5 }], zY: PICNIC.maxY + 0.002 },
    ],
    fishRequired: 2,
    waitMs: 8000,
    failCooldownMs: 4000,
    joinBoost: 6,
    chat: true,
    dwellMs: [7000, 9000],
    triggerAfterMs: 2500,
    effect: { itemIds: ["icecream"], mode: "whileOccupied", lingerMs: 1200 },
    cooldownMs: 12000,
    weight: 2,
    pose: "sit",
  },
  {
    id: "seagull",
    label: "Seagull",
    zone: rect(SEAGULL_ANIM.minX - 0.02, SEAGULL_ANIM.minY, SEAGULL_ANIM.maxX + 0.1, SEAGULL.maxY + 0.03),
    // Just right of the fries box in the animation.
    anchors: [{ x: SEAGULL_ANIM.maxX + 0.064, y: 0.654, facing: -1 }],
    fishRequired: 1,
    dwellMs: [4500, 6000],
    triggerAfterMs: 1500,
    // The gull swaps to its eating animation for one play, then the hopping gull comes back.
    effect: { itemIds: ["seagull-anim"], mode: "whileOccupied", maxOnMs: SEAGULL_ANIM_MS },
    cooldownMs: 10000,
    weight: 1.5,
    pose: "stand",
  },
  {
    // In the serving window: the counter front covers the fish's lower body.
    id: "store",
    label: "Ice cream counter",
    zone: rect(STORE.minX, COUNTER.minY - 0.12, COUNTER.maxX, COUNTER.maxY + 0.04),
    anchors: [{ x: STORE_WINDOW_X, y: COUNTER.maxY - 0.03, facing: 1, via: [{ x: STORE_WINDOW_X, y: COUNTER.maxY + 0.035 }], zY: COUNTER.maxY - 0.0006 }],
    fishRequired: 1,
    dwellMs: [5000, 7000],
    triggerAfterMs: 0,
    effect: { itemIds: [], mode: "whileOccupied" },
    cooldownMs: 9000,
    weight: 1.5,
    pose: "shop",
  },
];

// ── runtime ─────────────────────────────────────────────────────────────────

export type ActivityPhase = "idle" | "gathering" | "active" | "after" | "cooldown";

export type ActivityRun = {
  def: ActivityDef;
  phase: ActivityPhase;
  /** Fish id per anchor (null = free). */
  slots: (string | null)[];
  arrived: boolean[];
  /** gathering: give up at. */
  deadline: number;
  summoned: boolean;
  effectAt: number;
  leaveAt: number;
  itemsOn: boolean;
  itemsOffAt: number;
  cooldownUntil: number;
  /** Completed runs (demo mode boosts untried ones). */
  done: number;
};

export function createRuns(defs: ActivityDef[]): ActivityRun[] {
  return defs.map((def) => ({
    def,
    phase: "idle",
    slots: def.anchors.map(() => null),
    arrived: def.anchors.map(() => false),
    deadline: 0,
    summoned: false,
    effectAt: 0,
    leaveAt: 0,
    itemsOn: false,
    itemsOffAt: 0,
    cooldownUntil: 0,
    done: 0,
  }));
}

const between = (rng: () => number, [lo, hi]: readonly [number, number]) => lo + rng() * (hi - lo);
const pick = <T,>(rng: () => number, xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
const byId = (w: SimWorld, id: string | null) => (id ? w.fish.find((f) => f.id === id) : undefined);
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

// Demo mode scales the per-activity timings.
const dwellOf = (w: SimWorld, d: ActivityDef) => between(w.rng, d.dwellMs) * (w.tuning.demo ? DEMO.DWELL : 1);
const triggerOf = (w: SimWorld, d: ActivityDef) => d.triggerAfterMs * (w.tuning.demo ? DEMO.TRIGGER : 1);
const cooldownOf = (w: SimWorld, ms: number) => ms * (w.tuning.demo ? DEMO.COOLDOWN : 1);
const persistOf = (w: SimWorld, d: ActivityDef) => Math.min(d.effect.persistMs ?? 0, w.tuning.demo ? DEMO.PERSIST_MS : Infinity);

export const runOf = (w: SimWorld, id: string) => w.activities.find((r) => r.def.id === id);
const assigned = (r: ActivityRun) => r.slots.filter(Boolean).length;
const freeSlot = (r: ActivityRun) => r.slots.findIndex((s) => s === null);

/** Anchor for a fish joining: slot 0 for summoners (the caller's spot), else the nearest free one. */
export function freeSlotOf(r: ActivityRun, f: Pt): number {
  if (r.def.summonHelper) return freeSlot(r);
  let best = -1;
  r.slots.forEach((s, i) => {
    if (s === null && (best < 0 || dist(f, r.def.anchors[i]) < dist(f, r.def.anchors[best]))) best = i;
  });
  return best;
}

/** A fish that isn't busy (bumps, swim-over, activities) — bump cooldowns don't matter here. */
export const isIdle = (f: SimFish) => (f.mode === "walk" || f.mode === "pause") && !f.task;

/** Can a free fish start or join this activity right now? */
export function available(w: SimWorld, r: ActivityRun): boolean {
  if (r.phase === "idle") return w.t >= r.cooldownUntil;
  // Only open (non-summon) multi-fish activities take walk-ins.
  return r.phase === "gathering" && !r.def.summonHelper && freeSlot(r) >= 0;
}

function weightFor(w: SimWorld, r: ActivityRun, f: SimFish): number {
  let weight = r.def.weight;
  if (r.phase === "gathering") {
    const waiting = byId(w, r.slots.find(Boolean) ?? null);
    weight *= (r.def.joinBoost ?? 1) * (waiting && w.opts.areFriends(waiting.id, f.id) ? 2 : 1);
  }
  if (w.tuning.demo && r.done === 0) weight *= DEMO.UNTRIED_BOOST;
  return weight;
}

/** Weighted pick among available activities (null if none). */
export function chooseActivity(w: SimWorld, f: SimFish): ActivityRun | null {
  const open = w.activities.filter((r) => available(w, r));
  const weights = open.map((r) => weightFor(w, r, f));
  let roll = w.rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < open.length; i++) if ((roll -= weights[i]) <= 0) return open[i];
  return open[open.length - 1] ?? null;
}

/** Send `f` to anchor `slot` of `r` (route: planned path to via[0], then the fixed via legs, then the anchor). */
export function assign(w: SimWorld, r: ActivityRun, f: SimFish, slot: number, hurry = false) {
  const a = r.def.anchors[slot];
  r.slots[slot] = f.id;
  r.arrived[slot] = false;
  if (r.phase === "idle") {
    r.phase = "gathering";
    r.summoned = false;
    r.deadline = w.t + WORLD.ARRIVE_TIMEOUT_MS;
  }
  const [first, ...rest] = [...(a.via ?? []), { x: a.x, y: a.y }];
  f.mode = "task";
  f.task = { act: r.def.id, slot, stage: "going", since: w.t, hurry };
  f.path = [...planPath(f, first, w.opts.area, w.opts.blocked), ...rest];
  f.zY = null;
  f.pose = null;
}

/** Walk away: back out along the via route (keeping its draw order), then free. */
function release(w: SimWorld, f: SimFish, pauseMs = 400) {
  const task = f.task;
  f.task = null;
  f.pose = null;
  f.bubble = null;
  f.bubbleUntil = 0;
  f.cooldownUntil = Math.max(f.cooldownUntil, w.t + WORLD.AFTER_ACTIVITY_COOLDOWN_MS);
  const a = task ? runOf(w, task.act)?.def.anchors[task.slot] : undefined;
  if (a?.via?.length && task?.stage === "there") {
    f.mode = "walk";
    f.path = [...a.via].reverse(); // keeps zY until the route is walked (sim clears it)
    return;
  }
  f.zY = null;
  f.mode = "pause";
  f.path = [];
  f.until = w.t + pauseMs;
}

function releaseAll(w: SimWorld, r: ActivityRun) {
  r.slots.forEach((id, i) => {
    const f = byId(w, id);
    if (f?.task?.act === r.def.id) release(w, f);
    r.slots[i] = null;
    r.arrived[i] = false;
  });
}

function say(w: SimWorld, f: SimFish | undefined, text: string, delay = 0) {
  if (!f) return;
  w.speech.push({ who: f.id, text, at: w.t + delay, ms: WORLD.SAY_MS });
}

/** Give up (no helper / partner): short cooldown, no effect. */
function fail(w: SimWorld, r: ActivityRun) {
  const first = byId(w, r.slots[0]) ?? byId(w, r.slots.find(Boolean) ?? null);
  if (r.def.lines?.giveUp && first?.task?.stage === "there") say(w, first, pick(w.rng, r.def.lines.giveUp));
  releaseAll(w, r);
  r.phase = "idle";
  r.cooldownUntil = w.t + cooldownOf(w, r.def.failCooldownMs ?? r.def.cooldownMs);
}

/** "Swim over" (or a forced restart) cuts the activity short: no effect, items gone, fish freed. */
export function cancelActivity(w: SimWorld, r: ActivityRun, cooldownMs: number = WORLD.INTERRUPT_COOLDOWN_MS) {
  releaseAll(w, r);
  r.itemsOn = false;
  r.phase = "idle";
  r.cooldownUntil = w.t + cooldownMs;
  w.speech = w.speech.filter((s) => s.at <= w.t || !byId(w, s.who)?.task);
}

/** Nearest idle fish; a friend of `caller` wins unless much further away (it has to arrive in time). */
function findHelper(w: SimWorld, caller: SimFish, near: Pt): SimFish | null {
  const score = (f: SimFish) => dist(f, near) * (w.opts.areFriends(caller.id, f.id) ? WORLD.FRIEND_DISTANCE_FACTOR : 1);
  const idle = w.fish.filter((f) => f !== caller && isIdle(f)).sort((a, b) => score(a) - score(b));
  return idle[0] ?? null;
}

function arrive(w: SimWorld, r: ActivityRun, f: SimFish, slot: number) {
  const a = r.def.anchors[slot];
  r.arrived[slot] = true;
  f.facing = a.facing;
  f.task = { ...f.task!, stage: "there", since: w.t };
  f.pose = "wait";

  if (r.arrived.filter(Boolean).length >= r.def.fishRequired) return start(w, r);

  if (r.def.summonHelper && !r.summoned) {
    r.summoned = true;
    const lines = r.def.lines;
    if (lines) say(w, f, pick(w.rng, lines.call));
    const target = r.def.anchors[freeSlot(r)];
    const helper = target ? findHelper(w, f, target) : null;
    if (!helper) {
      r.deadline = w.t + 1200; // say the call, then "aw…"
      return;
    }
    if (lines) say(w, helper, pick(w.rng, lines.reply), 700);
    assign(w, r, helper, freeSlot(r), true);
    r.deadline = w.t + (r.def.waitMs ?? WORLD.ARRIVE_TIMEOUT_MS);
    return;
  }
  if (assigned(r) < r.def.fishRequired) r.deadline = w.t + (r.def.waitMs ?? WORLD.ARRIVE_TIMEOUT_MS);
}

function start(w: SimWorld, r: ActivityRun) {
  r.phase = "active";
  r.effectAt = w.t + triggerOf(w, r.def);
  r.leaveAt = r.effectAt + Math.max(1500, dwellOf(w, r.def) - triggerOf(w, r.def));
  const fish = r.slots.map((id) => byId(w, id)).filter((f): f is SimFish => !!f);
  for (const f of fish) f.pose = r.def.pose;
  if (r.def.chat && fish.length === 2) {
    const [a, b] = fish;
    const lines = w.opts.linesFor(a.id, b.id);
    const l = lines.length ? pick(w.rng, lines) : null;
    if (l) {
      say(w, a, l.a, 800);
      say(w, b, l.b, 800 + WORLD.BUBBLE_MS + 200);
    }
  }
}

/** Draw-order override for a fish on its anchor's via route (past via[0]) or at the anchor. */
export function routeZ(w: SimWorld, f: SimFish): number | null {
  if (!f.task) return null;
  const a = runOf(w, f.task.act)?.def.anchors[f.task.slot];
  // Route = [planned…, via[0], via[1…], anchor]: once via[0] is reached, `via.length` legs remain.
  return a?.via && a.zY !== undefined && f.path.length <= a.via.length ? a.zY : null;
}

/** Advance every activity's state machine (called once per sim step, after fish move). */
export function stepActivities(w: SimWorld) {
  // Fish reaching their anchors.
  for (const f of w.fish) {
    if (f.mode !== "task" || f.task?.stage !== "going" || f.path.length) continue;
    const r = runOf(w, f.task.act);
    if (r) arrive(w, r, f, f.task.slot);
  }

  for (const r of w.activities) {
    // Anyone who got pulled away (a user swim-over) ends the whole activity.
    if ((r.phase === "gathering" || r.phase === "active") && r.slots.some((id) => id && byId(w, id)?.task?.act !== r.def.id)) {
      cancelActivity(w, r);
      continue;
    }
    if (r.phase === "gathering" && w.t >= r.deadline) fail(w, r);
    else if (r.phase === "active") {
      if (!r.itemsOn && r.effectAt <= w.t && r.itemsOffAt < r.effectAt) {
        r.itemsOn = true;
        r.itemsOffAt = r.def.effect.maxOnMs ? w.t + r.def.effect.maxOnMs : Infinity;
        for (const id of r.def.effect.hop ?? []) w.hops[id] = w.t + 700;
      }
      if (r.itemsOn && w.t >= r.itemsOffAt) r.itemsOn = false;
      if (w.t >= r.leaveAt) {
        releaseAll(w, r);
        r.done += 1;
        r.phase = "after";
        const e = r.def.effect;
        if (!r.itemsOn) r.itemsOffAt = w.t;
        else r.itemsOffAt = w.t + (e.mode === "persistAfter" ? persistOf(w, r.def) : e.lingerMs ?? 0);
      }
    }
    if (r.phase === "after" && w.t >= r.itemsOffAt) {
      r.itemsOn = false;
      r.phase = "cooldown";
      // Cooldown starts once the items have faded out.
      r.cooldownUntil = w.t + WORLD.ITEM_FADE_MS + cooldownOf(w, r.def.cooldownMs);
    }
    if (r.phase === "cooldown" && w.t >= r.cooldownUntil) r.phase = "idle";
  }

  // Timed bubbles.
  for (const s of w.speech) {
    if (s.at > w.t) continue;
    const f = byId(w, s.who);
    if (f && (f.mode === "task" || f.mode === "walk" || f.mode === "pause")) {
      f.bubble = s.text;
      f.bubbleUntil = w.t + s.ms;
    }
  }
  w.speech = w.speech.filter((s) => s.at > w.t);

  w.items = {};
  for (const r of w.activities) if (r.itemsOn) for (const id of r.def.effect.itemIds) w.items[id] = true;
}

/**
 * Debug/demo: start an activity now with the nearest idle fish (two for open
 * multi-fish activities; summoners call their own helper). Returns false if no fish is idle.
 */
export function forceActivity(w: SimWorld, id: string): boolean {
  const r = runOf(w, id);
  if (!r) return false;
  if (r.phase !== "idle") cancelActivity(w, r, 0);
  r.cooldownUntil = 0;
  r.itemsOn = false;
  const count = r.def.summonHelper ? 1 : r.def.fishRequired;
  for (let slot = 0; slot < count; slot++) {
    const a = r.def.anchors[slot];
    const f = w.fish.filter(isIdle).sort((p, q) => dist(p, a) - dist(q, a))[0];
    if (!f) return slot > 0;
    assign(w, r, f, slot);
  }
  return true;
}
