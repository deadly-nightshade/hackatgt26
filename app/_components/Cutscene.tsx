"use client";

import Image from "next/image";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Appearance } from "@/lib/fish/appearance";
import type { DialogueLine } from "@/lib/meet/schema";
import { WORLD_BG } from "@/lib/world/config";
import { FishSprite } from "./FishSprite";

/** Shared by /meet and the /world replay modal. "a" stands on the left, "b" on the right. */

export type CutsceneNames = { a: string; b: string };
/** Looks of the two fish (same orientation as names); missing → plain fish. */
export type CutsceneAppearances = { a?: Appearance | null; b?: Appearance | null };

/** Two fish facing each other on the beach; the speaking one is highlighted. */
export function CutsceneStage({
  names,
  appearances = {},
  speaking,
}: {
  names: CutsceneNames;
  appearances?: CutsceneAppearances;
  speaking: DialogueLine["speaker"] | null;
}) {
  return (
    <div className="stage">
      <Image className="stage-bg" src={WORLD_BG.src} alt="" fill sizes="(max-width: 520px) 100vw, 480px" priority />
      <StageFish name={names.a} appearance={appearances.a} side="left" active={speaking === "a"} />
      <StageFish name={names.b} appearance={appearances.b} side="right" active={speaking === "b"} />
    </div>
  );
}

function StageFish({ name, appearance, side, active }: { name: string; appearance?: Appearance | null; side: "left" | "right"; active: boolean }) {
  return (
    <div className={`fish ${side}${active ? " active" : ""}`}>
      <div className="fish-name">{name}</div>
      {/* The art faces left: the left fish flips to face its partner. */}
      <FishSprite appearance={appearance} flip={side === "left"} sizes="(max-width: 520px) 40vw, 190px" priority />
    </div>
  );
}

/** Plays a script line by line (tap / click / Space / Enter), then shows `renderEnd`. */
export function CutscenePlayer({
  script,
  names,
  appearances,
  renderEnd,
}: {
  script: DialogueLine[];
  names: CutsceneNames;
  appearances?: CutsceneAppearances;
  renderEnd: (replay: () => void) => ReactNode;
}) {
  const [index, setIndex] = useState(0);
  const ended = index >= script.length;
  const advance = useCallback(() => setIndex((i) => Math.min(i + 1, script.length)), [script.length]);

  useEffect(() => {
    if (ended) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        advance();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ended, advance]);

  const line = ended ? null : script[index];
  return (
    <>
      <CutsceneStage names={names} appearances={appearances} speaking={line?.speaker ?? null} />
      {line ? (
        <button type="button" className="dialogue" onClick={advance} aria-live="polite">
          {line.speaker !== "narrator" && <span className="speaker">{line.speaker === "a" ? names.a : names.b}</span>}
          <span className={line.speaker === "narrator" ? "text narrator" : "text"}>{line.text}</span>
          <span className="next" aria-hidden>
            ▼
          </span>
        </button>
      ) : (
        renderEnd(() => setIndex(0))
      )}
    </>
  );
}
