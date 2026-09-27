"use client";

import { useEffect, useState } from "react";
import { ACTIVITIES } from "@/lib/world/activities";
import { WALKABLE } from "@/lib/world/config";
import { BLOCKED } from "@/lib/world/scene";
import type { useWorldSim } from "@/lib/world/useWorldSim";

type Sim = ReturnType<typeof useWorldSim>;

/** /world?debug=1: walkable area, blocked rects, activity zones + anchors, each fish's target. */
export function DebugOverlay({ ids, registerTarget }: { ids: string[]; registerTarget: Sim["registerTarget"] }) {
  const box = (a: { minX: number; minY: number; maxX: number; maxY: number }) => ({ x: a.minX, y: a.minY, width: a.maxX - a.minX, height: a.maxY - a.minY });
  return (
    <svg className="world-debug" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
      <rect {...box(WALKABLE)} className="dbg-walk" />
      {BLOCKED.map((b) => (
        <rect key={b.id} {...box(b)} className="dbg-blocked" />
      ))}
      {ACTIVITIES.map((a) => (
        <g key={a.id}>
          <rect {...box(a.zone)} className="dbg-zone" />
          <text x={a.zone.minX + 0.005} y={a.zone.minY + 0.022} className="dbg-label">
            {a.label}
          </text>
          {a.anchors.map((p, i) => (
            <g key={i}>
              {p.via && <polyline points={[...p.via, p].map((q) => `${q.x},${q.y}`).join(" ")} className="dbg-via" />}
              <circle cx={p.x} cy={p.y} r={0.008} className="dbg-anchor" />
            </g>
          ))}
        </g>
      ))}
      {registerTarget && ids.map((id) => <line key={id} ref={registerTarget(id)} className="dbg-target" />)}
    </svg>
  );
}

/**
 * Force buttons, live tuning, and each activity's phase. Collapsed to a tiny
 * translucent ‹ in the corner (so it stays out of demo recordings).
 */
export function DebugPanel({ sim, geometry, onGeometry }: { sim: Sim; geometry: boolean; onGeometry: (on: boolean) => void }) {
  const [, tick] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => tick((n) => n + 1), 400);
    return () => clearInterval(t);
  }, [open]);
  const w = sim.inspect();
  return (
    <div className="debug-dock">
      {open && w && (
        <div className="debug-panel">
          <div className="debug-grid">
            {w.activities.map((r) => (
              <button key={r.def.id} type="button" onClick={() => sim.force(r.def.id)} title={`Force ${r.def.label}`}>
                {r.def.label}
                <small>
                  {r.phase}
                  {r.done ? ` ·${r.done}` : ""}
                </small>
              </button>
            ))}
          </div>
          <label>
            activity chance {w.tuning.activityChance.toFixed(2)}
            <input type="range" min={0} max={1} step={0.05} value={w.tuning.activityChance} onChange={(e) => (sim.tune({ activityChance: Number(e.target.value) }), tick((n) => n + 1))} />
          </label>
          <label>
            time ×{w.tuning.timeScale}
            <input type="range" min={0.25} max={4} step={0.25} value={w.tuning.timeScale} onChange={(e) => (sim.tune({ timeScale: Number(e.target.value) }), tick((n) => n + 1))} />
          </label>
          <label className="debug-check">
            <input type="checkbox" checked={geometry} onChange={(e) => onGeometry(e.target.checked)} /> show walk/zone overlay
            {w.tuning.demo && <span> · demo</span>}
          </label>
        </div>
      )}
      <button type="button" className="debug-toggle" onClick={() => setOpen((o) => !o)} aria-label={open ? "Hide debug panel" : "Show debug panel"}>
        {open ? "›" : "‹"}
      </button>
    </div>
  );
}
