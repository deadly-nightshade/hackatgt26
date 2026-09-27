"use client";

import { useEffect, useRef, useState } from "react";
import { currentOption, cycle, randomAppearance, slotIsEmpty, SLOTS, type Appearance, type SlotId } from "@/lib/fish/appearance";
import { FishArtPreloader, FishSprite } from "./FishSprite";

const SPRITE_SIZES = "(max-width: 600px) 60vw, 320px";

/**
 * The character creator: a big fish with arrows around it.
 * Top-left/top-right cycle HEAD, bottom-left/bottom-right cycle FEET (wrapping).
 * Keyboard: ←/→ head, Shift+←/→ feet. Controlled: the parent owns `appearance`.
 */
export function FishCreator({ appearance, onChange, name }: { appearance: Appearance; onChange: (a: Appearance) => void; name?: string }) {
  const [pop, setPop] = useState(0);
  // Rapid taps build on each other, even before the parent re-renders.
  const latest = useRef(appearance);
  latest.current = appearance;
  const change = (next: Appearance) => {
    latest.current = next;
    onChange(next);
    setPop((n) => n + 1);
  };
  const step = (slot: SlotId, dir: 1 | -1) => {
    if (!slotIsEmpty(slot)) change(cycle(latest.current, slot, dir));
  };
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      e.preventDefault();
      stepRef.current(e.shiftKey ? "feet" : "head", e.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="creator">
      <FishArtPreloader sizes={SPRITE_SIZES} />
      <SlotLabel appearance={appearance} slot="head" />
      <div className="creator-stage">
        <Arrow slot="head" dir={-1} onStep={step} className="tl" />
        <Arrow slot="head" dir={1} onStep={step} className="tr" />
        <span key={pop} className={`creator-fish${pop ? " pop" : ""}`}>
          <FishSprite appearance={appearance} sizes={SPRITE_SIZES} label={name ? `${name}'s fish` : "Your fish"} priority />
        </span>
        <Arrow slot="feet" dir={-1} onStep={step} className="bl" />
        <Arrow slot="feet" dir={1} onStep={step} className="br" />
      </div>
      <SlotLabel appearance={appearance} slot="feet" />
      <button type="button" className="secondary creator-random" onClick={() => change(randomAppearance())}>
        🎲 Randomize
      </button>
    </div>
  );
}

const WORD: Record<SlotId, string> = { head: "head", feet: "feet" };

function Arrow({ slot, dir, onStep, className }: { slot: SlotId; dir: 1 | -1; onStep: (slot: SlotId, dir: 1 | -1) => void; className: string }) {
  const empty = slotIsEmpty(slot);
  return (
    <button
      type="button"
      className={`creator-arrow ${className}`}
      onClick={() => onStep(slot, dir)}
      disabled={empty}
      aria-label={`${dir < 0 ? "Previous" : "Next"} ${WORD[slot]} accessory`}
    >
      {dir < 0 ? "‹" : "›"}
    </button>
  );
}

function SlotLabel({ appearance, slot }: { appearance: Appearance; slot: SlotId }) {
  const { option, index, count } = currentOption(appearance, slot);
  const label = SLOTS.find((s) => s.id === slot)!.label;
  return (
    <p className={`creator-label ${slot}`} aria-live="polite">
      <span className="muted">{label}</span> <strong>{option.label}</strong>{" "}
      {slotIsEmpty(slot) ? <span className="muted">· coming soon</span> : <span className="muted">{`${index}/${count}`}</span>}
    </p>
  );
}
