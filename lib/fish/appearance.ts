import { z } from "zod";

/**
 * Fish customization registry, shared by client and server.
 *
 * Every accessory PNG has exactly the base's pixel size and is already
 * positioned, so it's a pure overlay: stack at (0,0) in the same box.
 * Adding an option = drop the file in public/art/fish/<slot>/ + one line below.
 * Option ids are stable (they're stored on profiles); labels can change freely.
 */

/** The plain fish (native art faces LEFT). */
export const FISH_BASE = { src: "/art/fish/fih_base.PNG", width: 2048, height: 2330 } as const;

export type SlotId = "head" | "feet";
export type FishOption = { id: string; label: string; src?: string };
export type FishSlot = {
  id: SlotId;
  label: string;
  options: FishOption[];
  /** What a fish wears here when nothing (or something unknown) is stored: null = nothing. */
  defaultId: string | null;
};

/** "Wear nothing here" (first in slots that allow it). */
export const NONE: FishOption = { id: "none", label: "None" };

export const SLOTS: FishSlot[] = [
  {
    id: "head",
    label: "Head",
    options: [
      NONE,
      { id: "head-bow", label: "Red Bow", src: "/art/fish/head/fih_bow.PNG" },
      { id: "head-bunny", label: "Bunny Ears", src: "/art/fish/head/fih_bunny.PNG" },
      { id: "head-shades", label: "Cool Shades", src: "/art/fish/head/fih_glasses.PNG" },
      { id: "head-headphones", label: "Shell Headphones", src: "/art/fish/head/fih_headphones.PNG" },
      { id: "head-karen", label: "“Karen” Bob", src: "/art/fish/head/fih_karen.PNG" },
    ],
    defaultId: null,
  },
  {
    id: "feet",
    label: "Feet",
    // The base sprite has no feet of its own, so there's no "None" here: boots by default
    // (what every fish wore before feet were customizable).
    options: [
      { id: "feet-boots", label: "Cozy Boots", src: "/art/fish/feet/fih_boots.PNG" },
      { id: "feet-bare", label: "Bare Feet", src: "/art/fish/feet/fih_feet.PNG" },
      { id: "feet-flipflops", label: "Flip-Flops", src: "/art/fish/feet/fih_flipflops.PNG" },
      { id: "feet-heels", label: "Red Heels", src: "/art/fish/feet/fih_heels.PNG" },
      { id: "feet-skates", label: "Roller Skates", src: "/art/fish/feet/fih_skates.PNG" },
    ],
    defaultId: "feet-boots",
  },
];

/** Bottom → top. Move "feet" before "base" if feet art should sit under the body. */
export const LAYER_ORDER: ("base" | SlotId)[] = ["base", "feet", "head"];

export type Appearance = { version: 1; head: string | null; feet: string | null };

export const DEFAULT_APPEARANCE: Appearance = { version: 1, head: null, feet: "feet-boots" };

const slotOf = (id: SlotId) => SLOTS.find((s) => s.id === id)!;
const findOption = (slot: SlotId, id: string | null | undefined) => (id ? slotOf(slot).options.find((o) => o.id === id && o.src) : undefined);

/**
 * THE read-time default + validation: a missing/partial/unknown slot gets that slot's
 * default (head: nothing, feet: boots). Old profiles without `appearance` render as
 * the fish everyone had before customization.
 */
export function getAppearance(raw: unknown): Appearance {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const pick = (slot: SlotId) => {
    const v = r[slot];
    return typeof v === "string" && findOption(slot, v) ? v : slotOf(slot).defaultId;
  };
  return { version: 1, head: pick("head"), feet: pick("feet") };
}

/** What clients may send (ids are validated by getAppearance; unknown → the slot's default). */
export const AppearanceInput = z
  .object({ head: z.string().max(64).nullable().optional(), feet: z.string().max(64).nullable().optional() })
  .passthrough();

/** Image sources to stack, bottom → top (base always first unless LAYER_ORDER says otherwise). */
export type FishLayer = { layer: "base" | SlotId; src: string };

export function layersFor(appearance: Appearance): FishLayer[] {
  return LAYER_ORDER.flatMap((layer): FishLayer[] => {
    if (layer === "base") return [{ layer, src: FISH_BASE.src }];
    const src = findOption(layer, appearance[layer])?.src;
    return src ? [{ layer, src }] : [];
  });
}

/** The option currently chosen in a slot ("none" when empty) and its 1-based position. */
export function currentOption(appearance: Appearance, slot: SlotId): { option: FishOption; index: number; count: number } {
  const options = slotOf(slot).options;
  const i = Math.max(0, options.findIndex((o) => o.id === (appearance[slot] ?? NONE.id)));
  return { option: options[i], index: i + 1, count: options.length };
}

/** Next/previous option in a slot, wrapping around. */
export function cycle(appearance: Appearance, slot: SlotId, dir: 1 | -1): Appearance {
  const options = slotOf(slot).options;
  const { index } = currentOption(appearance, slot);
  const next = options[(index - 1 + dir + options.length) % options.length];
  return { ...appearance, [slot]: next.src ? next.id : null };
}

export function randomAppearance(random: () => number = Math.random): Appearance {
  const pick = (slot: SlotId) => {
    const o = slotOf(slot).options[Math.floor(random() * slotOf(slot).options.length)];
    return o.src ? o.id : null;
  };
  return { version: 1, head: pick("head"), feet: pick("feet") };
}

export const sameAppearance = (a: Appearance, b: Appearance) => a.head === b.head && a.feet === b.feet;

/** A slot with nothing but "none" (arrows disabled, "coming soon"). */
export const slotIsEmpty = (slot: SlotId) => slotOf(slot).options.length <= 1;

/** Every image a fish can use (for preloading). */
export const ALL_FISH_SRCS: string[] = [FISH_BASE.src, ...SLOTS.flatMap((s) => s.options.flatMap((o) => (o.src ? [o.src] : [])))];
