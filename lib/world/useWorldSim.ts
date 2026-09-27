"use client";

import { useCallback, useEffect, useRef } from "react";
import type { BumpLine } from "@/lib/meet/schema";
import { ACTIVITIES, forceActivity } from "@/lib/world/activities";
import { genericBumpLines } from "@/lib/world/bumps";
import { FISH_SPRITE, WORLD } from "@/lib/world/config";
import { BLOCKED } from "@/lib/world/scene";
import { createSim, depthOf, stepSim, swimOver, type SimWorld, type Tuning } from "@/lib/world/sim";

type Painted = { facing: 1 | -1; walking: boolean; bubble: string | null; pose: string | null; z: number };

/** Draw order shared by fish and "sort" sprites: base (feet) y → z-index. */
export const zOf = (y: number) => 100 + Math.round(y * 10000);

/**
 * Runs the world: one requestAnimationFrame loop, positions kept in refs and
 * written straight to the DOM as transforms (no React state per frame).
 * Paused while the tab is hidden.
 */
export function useWorldSim(ids: string[], bumpLines: Record<string, BumpLine[]>, meId: string, opts: { demo?: boolean; debug?: boolean } = {}) {
  const worldRef = useRef<HTMLDivElement | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const tags = useRef(new Map<string, HTMLElement>());
  const items = useRef(new Map<string, HTMLElement>());
  const targets = useRef(new Map<string, SVGLineElement>());
  const sim = useRef<SimWorld | null>(null);
  const size = useRef(0);
  const painted = useRef(new Map<string, Painted>());
  const shown = useRef(new Map<string, boolean>());
  const lines = useRef(bumpLines);
  lines.current = bumpLines;

  const refIn = useCallback(
    <E extends Element>(map: Map<string, E>) =>
      (id: string) =>
      (el: E | null) => {
        if (el) map.set(id, el);
        else map.delete(id);
      },
    [],
  );
  const register = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) els.current.set(id, el);
      else {
        els.current.delete(id);
        painted.current.delete(id);
      }
    },
    [],
  );

  useEffect(() => {
    const el = worldRef.current;
    if (!el) return;
    size.current = el.clientWidth;
    const ro = new ResizeObserver(([entry]) => {
      size.current = entry.contentRect.width;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const idsKey = ids.join("|");
  const { demo = false, debug = false } = opts;
  useEffect(() => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const keyOf = (x: string, y: string) => (x < y ? `${x}__${y}` : `${y}__${x}`);
    // Stored lines are oriented to the pair's sorted ids ("a" = smaller id).
    const linesFor = (x: string, y: string): BumpLine[] => {
      const own = lines.current[keyOf(x, y)];
      if (!own?.length) return genericBumpLines(Math.random);
      return x < y ? own : own.map((l) => ({ a: l.b, b: l.a }));
    };
    const areFriends = (x: string, y: string) => !!lines.current[keyOf(x, y)];
    const world = createSim(
      idsKey ? idsKey.split("|") : [],
      { linesFor, areFriends, reducedMotion, blocked: BLOCKED, activities: ACTIVITIES, demo },
      Math.random,
      sim.current ?? undefined,
    );
    sim.current = world;
    if (debug) (window as unknown as { __world?: SimWorld }).__world = world; // inspect from devtools

    const [minScale, maxScale] = WORLD.DEPTH_SCALE;
    const paint = () => {
      const W = size.current;
      if (!W) return;
      const fw = WORLD.FISH_WIDTH * W;
      const fh = (fw * FISH_SPRITE.height) / FISH_SPRITE.width;
      for (const f of world.fish) {
        const el = els.current.get(f.id);
        if (!el) continue;
        const scale = minScale + depthOf(f.y, world.opts.area) * (maxScale - minScale);
        const left = f.x * W - fw / 2;
        el.style.transform = `translate3d(${left.toFixed(1)}px, ${(f.y * W - fh).toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
        // Name + bubble ride above every prop, at the (scaled) head.
        const tag = tags.current.get(f.id);
        if (tag) tag.style.transform = `translate3d(${(f.x * W).toFixed(1)}px, ${(f.y * W - fh * scale).toFixed(1)}px, 0)`;

        const z = zOf(f.zY ?? f.y);
        const walking = f.mode === "walk" || f.mode === "approach" || (f.mode === "task" && f.task?.stage === "going");
        const prev = painted.current.get(f.id);
        if (!prev || prev.z !== z) el.style.zIndex = String(z);
        if (!prev || prev.facing !== f.facing) el.dataset.facing = f.facing === 1 ? "right" : "left";
        if (!prev || prev.walking !== walking) el.classList.toggle("walking", walking);
        if (!prev || prev.pose !== f.pose) {
          if (f.pose) el.dataset.pose = f.pose;
          else delete el.dataset.pose;
        }
        if (tag && (!prev || prev.bubble !== f.bubble)) {
          const bubble = tag.querySelector<HTMLElement>(".wfish-bubble");
          if (bubble) {
            bubble.textContent = f.bubble ?? "";
            bubble.hidden = !f.bubble;
          }
        }
        if (!prev) {
          el.dataset.ready = "1";
          if (tag) tag.dataset.ready = "1";
        }
        painted.current.set(f.id, { facing: f.facing, walking, bubble: f.bubble, pose: f.pose, z });

        const line = targets.current.get(f.id);
        if (line) {
          line.setAttribute("x1", String(f.x));
          line.setAttribute("y1", String(f.y));
          const busy = f.mode === "walk" || f.mode === "task" || f.mode === "approach";
          line.setAttribute("x2", String(busy ? f.tx : f.x));
          line.setAttribute("y2", String(busy ? f.ty : f.y));
        }
      }
      // Items (fade + pop via CSS) and hopping sprites.
      for (const [id, el] of items.current) {
        const on = !!world.items[id] || (world.hops[id] ?? 0) > world.t;
        if (shown.current.get(id) === on) continue;
        shown.current.set(id, on);
        el.classList.toggle(el.dataset.hops ? "hop" : "on", on);
      }
    };

    let raf = 0;
    let last = 0;
    const frame = (now: number) => {
      stepSim(world, now - last);
      last = now;
      paint();
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      last = performance.now();
      paint();
      raf = requestAnimationFrame(frame);
    };
    const onVisibility = () => (document.hidden ? cancelAnimationFrame(raf) : start());
    document.addEventListener("visibilitychange", onVisibility);
    painted.current.clear();
    shown.current.clear();
    if (!document.hidden) start();
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [idsKey, demo, debug]);

  const swimTo = useCallback(
    (targetId: string) => {
      if (sim.current) swimOver(sim.current, meId, targetId);
    },
    [meId],
  );
  const force = useCallback((activityId: string) => (sim.current ? forceActivity(sim.current, activityId) : false), []);
  const tune = useCallback((t: Partial<Tuning>) => {
    if (sim.current) Object.assign(sim.current.tuning, t);
  }, []);
  const inspect = useCallback(() => sim.current, []);

  return {
    worldRef,
    register,
    registerTag: refIn(tags.current),
    registerItem: refIn(items.current),
    registerTarget: debug ? refIn(targets.current) : undefined,
    swimTo,
    force,
    tune,
    inspect,
  };
}
