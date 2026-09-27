"use client";

import { useEffect, useState } from "react";

const FRAMES = [".", "..", "..."];

/**
 * Typing-style dots ". → .. → ..." for "still working" text (e.g. while the AI
 * writes a cutscene). A fixed-width box keeps the sentence from jiggling.
 * Reduced motion: a static "…".
 */
export function LoadingDots({ intervalMs = 400 }: { intervalMs?: number }) {
  const [i, setI] = useState(0);
  const [still, setStill] = useState(false);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return setStill(true);
    const t = setInterval(() => setI((n) => (n + 1) % FRAMES.length), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return (
    <span className="loading-dots" aria-hidden>
      {still ? "…" : FRAMES[i]}
    </span>
  );
}
