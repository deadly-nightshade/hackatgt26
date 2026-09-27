import type { Area } from "@/lib/world/config";
import type { Pt } from "@/lib/world/scene";

/** Straight-line walking around blocked rects (pure). */

const TRIES = 24;
/** Detour corners sit this far outside each blocked rect. */
const CORNER_MARGIN = 0.012;

export const inRect = (p: Pt, r: Area) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;
export const inBlocked = (p: Pt, blocked: readonly Area[]) => blocked.some((r) => inRect(p, r));

/** Does segment a→b touch rect r? (Liang–Barsky clipping.) */
function segmentHits(a: Pt, b: Pt, r: Area): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - r.minX],
    [dx, r.maxX - a.x],
    [-dy, a.y - r.minY],
    [dy, r.maxY - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/**
 * True if the straight line a→b never touches a blocked rect.
 * Rects containing an endpoint are ignored, so a fish can always walk out of one.
 */
export function segmentClear(a: Pt, b: Pt, blocked: readonly Area[]): boolean {
  return blocked.every((r) => inRect(a, r) || inRect(b, r) || !segmentHits(a, b, r));
}

export function randomFreePoint(area: Area, blocked: readonly Area[], rng: () => number): Pt | null {
  for (let i = 0; i < TRIES; i++) {
    const p = { x: area.minX + rng() * (area.maxX - area.minX), y: area.minY + rng() * (area.maxY - area.minY) };
    if (!inBlocked(p, blocked)) return p;
  }
  return null;
}

const len = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Waypoints from `from` to `to` (excluding `from`): direct if clear, else the shortest
 * route through the blocked rects' corners (a tiny visibility graph); direct as a last resort.
 */
export function planPath(from: Pt, to: Pt, area: Area, blocked: readonly Area[]): Pt[] {
  if (segmentClear(from, to, blocked)) return [to];
  const corners: Pt[] = [];
  for (const r of blocked)
    for (const x of [r.minX - CORNER_MARGIN, r.maxX + CORNER_MARGIN])
      for (const y of [r.minY - CORNER_MARGIN, r.maxY + CORNER_MARGIN]) {
        const p = { x, y };
        if (inRect(p, area) && !inBlocked(p, blocked)) corners.push(p);
      }
  const nodes = [from, to, ...corners];
  const dist = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (let v = 0; v < nodes.length; v++) {
      if (done[v]) continue;
      const d = dist[u] + len(nodes[u], nodes[v]);
      if (d < dist[v] && segmentClear(nodes[u], nodes[v], blocked)) {
        dist[v] = d;
        prev[v] = u;
      }
    }
  }
  if (prev[1] < 0) return [to];
  const path: Pt[] = [];
  for (let i = 1; i > 0; i = prev[i]) path.unshift(nodes[i]);
  return path;
}
