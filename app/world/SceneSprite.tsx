"use client";

import { useState, type Ref } from "react";
import type { SceneSprite as Sprite } from "@/lib/world/scene";
import { zOf } from "@/lib/world/useWorldSim";

/** Above every fish (tags/bubbles and the debug overlay sit higher still). */
const FRONT_Z = 30000;
const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

/**
 * One prop/item of the scene, positioned in normalized coords. Tries each `src`
 * in turn; if none load (or there are none) it draws a dashed placeholder with
 * the label — so dropping a PNG at the configured path swaps it in, no code change.
 */
export function SceneSprite({ sprite: s, ref }: { sprite: Sprite; ref?: Ref<HTMLDivElement> }) {
  const [attempt, setAttempt] = useState(0);
  const src = s.src[attempt];
  const z = s.layer === "back" ? 1 : s.layer === "front" ? FRONT_Z : zOf(s.baseY ?? s.rect.maxY);
  return (
    <div
      ref={ref}
      className={`wsprite${s.item ? " witem" : ""}${s.frames ? " wstrip" : ""}`}
      data-id={s.id}
      data-hops={s.hops ? "1" : undefined}
      data-hide-while={s.hideWhile}
      style={{ left: pct(s.rect.minX), top: pct(s.rect.minY), width: pct(s.rect.maxX - s.rect.minX), height: pct(s.rect.maxY - s.rect.minY), zIndex: z }}
    >
      {src && s.frames ? (
        // Frame strip: CSS steps through it once each time the item turns on.
        <div
          className="wsheet"
          style={{
            backgroundImage: `url(${src})`,
            backgroundSize: `${s.frames.count * 100}% 100%`,
            animationDuration: `${s.frames.count / s.frames.fps}s`,
            // jump-none: `count` positions from the first to the last frame.
            animationTimingFunction: `steps(${s.frames.count}, jump-none)`,
          }}
        />
      ) : src ? (
        // Plain <img>: per-file fallbacks via onError; the art is small pre-cropped PNGs.
        // eslint-disable-next-line @next/next/no-img-element
        <img key={src} src={src} alt="" draggable={false} decoding="async" onError={() => setAttempt((a) => a + 1)} />
      ) : (
        <span className="wplaceholder">{s.label}</span>
      )}
    </div>
  );
}
