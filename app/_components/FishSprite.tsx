"use client";

import Image from "next/image";
import { ALL_FISH_SRCS, DEFAULT_APPEARANCE, layersFor, type Appearance } from "@/lib/fish/appearance";

/**
 * A fish with its accessories: base + overlays (LAYER_ORDER) stacked in one box
 * with the art's aspect ratio. The whole stack flips together (the art faces
 * left; `flip` faces right), and animations go on this wrapper.
 * `sizes` is the usual responsive-image hint; every layer shares it.
 */
export function FishSprite({
  appearance,
  sizes,
  flip = false,
  label,
  priority,
  className = "",
}: {
  appearance?: Appearance | null;
  sizes: string;
  flip?: boolean;
  /** Accessible name; decorative when omitted. */
  label?: string;
  priority?: boolean;
  className?: string;
}) {
  const layers = layersFor(appearance ?? DEFAULT_APPEARANCE);
  return (
    <span
      className={`fish-sprite${flip ? " flip" : ""}${className ? ` ${className}` : ""}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {layers.map((l) => (
        <Image key={l.layer} data-layer={l.layer} src={l.src} alt="" fill sizes={sizes} priority={priority} draggable={false} />
      ))}
    </span>
  );
}

/**
 * Loads every base/accessory image once at the given `sizes` (same responsive
 * candidate as the visible sprites), so switching looks or new fish never flash.
 */
export function FishArtPreloader({ sizes }: { sizes: string }) {
  return (
    <span className="fish-preload" aria-hidden>
      {ALL_FISH_SRCS.map((src) => (
        <Image key={src} src={src} alt="" fill sizes={sizes} loading="eager" />
      ))}
    </span>
  );
}
