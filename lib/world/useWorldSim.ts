"use client";

import { useCallback, useEffect, useRef } from "react";
import type { BumpLine } from "@/lib/meet/schema";
import { genericBumpLines } from "@/lib/world/bumps";
import { FISH_SPRITE, WORLD } from "@/lib/world/config";
import { createSim, depthOf, stepSim, swimOver, type SimWorld } from "@/lib/world/sim";

type Painted = { facing: 1 | -1; walking: boolean; bubble: string | null };

/**
 * Runs the world: one requestAnimationFrame loop, positions kept in refs and
 * written straight to the DOM as transforms (no React state per frame).
 * Paused while the tab is hidden.
 */
export function useWorldSim(ids: string[], bumpLines: Record<string, BumpLine[]>, meId: string) {
  const worldRef = useRef<HTMLDivElement | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const sim = useRef<SimWorld | null>(null);
  const size = useRef(0);
  const painted = useRef(new Map<string, Painted>());
  const lines = useRef(bumpLines);
  lines.current = bumpLines;

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
  useEffect(() => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // Stored lines are oriented to the pair's sorted ids ("a" = smaller id).
    const linesFor = (x: string, y: string): BumpLine[] => {
      const key = x < y ? `${x}__${y}` : `${y}__${x}`;
      const own = lines.current[key];
      if (!own?.length) return genericBumpLines(Math.random);
      return x < y ? own : own.map((l) => ({ a: l.b, b: l.a }));
    };
    const world = createSim(idsKey ? idsKey.split("|") : [], { linesFor, reducedMotion }, Math.random, sim.current ?? undefined);
    sim.current = world;

    const [minScale, maxScale] = WORLD.DEPTH_SCALE;
    const paint = () => {
      const W = size.current;
      if (!W) return;
      const fw = WORLD.FISH_WIDTH * W;
      const fh = (fw * FISH_SPRITE.height) / FISH_SPRITE.width;
      for (const f of world.fish) {
        const el = els.current.get(f.id);
        if (!el) continue;
        const d = depthOf(f.y, world.opts.area);
        const scale = minScale + d * (maxScale - minScale);
        el.style.transform = `translate3d(${(f.x * W - fw / 2).toFixed(1)}px, ${(f.y * W - fh).toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
        el.style.zIndex = String((f.bubble ? 2000 : 10) + Math.round(d * 1000));

        const walking = f.mode === "walk" || f.mode === "approach";
        const prev = painted.current.get(f.id);
        if (!prev || prev.facing !== f.facing) el.dataset.facing = f.facing === 1 ? "right" : "left";
        if (!prev || prev.walking !== walking) el.classList.toggle("walking", walking);
        if (!prev || prev.bubble !== f.bubble) {
          const bubble = el.querySelector<HTMLElement>(".wfish-bubble");
          if (bubble) {
            bubble.textContent = f.bubble ?? "";
            bubble.hidden = !f.bubble;
          }
        }
        if (!prev) el.dataset.ready = "1";
        painted.current.set(f.id, { facing: f.facing, walking, bubble: f.bubble });
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
    if (!document.hidden) start();
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [idsKey]);

  const swimTo = useCallback((targetId: string) => {
    if (sim.current) swimOver(sim.current, meId, targetId);
  }, [meId]);

  return { worldRef, register, swimTo };
}
