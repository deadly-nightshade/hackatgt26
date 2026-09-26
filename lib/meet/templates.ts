import { levelName } from "@/lib/meet/config";
import type { Analysis, DialogueLine } from "@/lib/meet/schema";

/** Allowed fish puns: used by templates and passed to the AI. */
export const PUN_BANK = [
  "reel friends",
  "shell we",
  "clammed up",
  "o-fish-ally",
  "fin-tastic",
  "water you up to",
  "sea you around",
  "you're kraken me up",
  "let minnow",
  "cod you believe it",
  "same school",
] as const;

export const TEMPLATES = {
  intro: ["{a} swam over to {b}'s stall…", "{a} and {b} bumped fins at the market!", "{a} drifted past {b}'s stall and waved a fin."],
  suspense: ["…", "The tide goes quiet…", "Bubbles float up between them…"],
  friends: ["Reel friends! 🐟", "Shell we be friends? …Yes!", "{a} and {b} are o-fish-ally friends!"],
  clammedUp: [
    "Aw, their interests drifted too far apart! They got shy and clammed up.",
    "Oh no — they got shy and clammed up! 🐚",
  ],
  clammedUpHope: ["But they both {spotlight}… maybe next tide? 🌊", "Still… they both {spotlight}. Sea you next tide? 🌊"],
  alreadyFriends: ["{a} and {b} wave fins — they're already reel friends!", "{a} and {b} swim a happy loop — same school, same friends!"],
  firstLevel: ["Level 1: {levelName}"],
  hangoutIntro: ["{a} and {b} met up again!", "{a} found {b} by the pier again!", "{a} and {b} bumped into each other at the market!"],
  levelUp: ["✨ {a} and {b} are now {levelName}! ✨"],
  cooldown: ["You two just hung out! Sea you later 🌊", "{a} and {b} just hung out — let minnow and come back later! 🌊"],
  fallbackHangout: ["{a} and {b} spent the afternoon together — they both {spotlight}!"],
  planBridge: ["{knower} knows {label} — {wanter} should tag along sometime!", "{wanter} wants to try {label} and {knower} can show them the ropes!"],
  planShared: ["Next tide: {label} together? 🐚", "Maybe {label} together sometime? 🐚"],
  planGeneric: ["Maybe grab a snack at the market together next tide?"],
  // Template-only middle lines (AI fallback)
  fallbackMiddle: [
    [
      { speaker: "a", text: "So… water you up to?", mood: "happy" },
      { speaker: "b", text: "Just blubbing about the weather.", mood: "neutral" },
      { speaker: "a", text: "Same! Wait — do you {spotlight} too?", mood: "excited" },
    ],
  ] as DialogueLine[][],
} as const;

/** FNV-1a: tiny stable string hash so template picks are deterministic. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Same pairKey + attempt + beat → same variant; retries shift the variants a little. */
export function pick<T>(variants: readonly T[], pairKey: string, attemptNumber: number, beat: string): T {
  return variants[hashString(`${pairKey}#${attemptNumber}#${beat}`) % variants.length];
}

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

export type Names = { a: string; b: string };

/**
 * The "let's hang out" line, from the best bridge, else the best shared
 * interest. `names` is in the analysis orientation (pair's a/b).
 */
export function planText(analysis: Analysis, names: Names, pairKey: string, attemptNumber: number): string {
  const bridge = analysis.bridges[0];
  if (bridge) {
    const wanter = names[bridge.fromUser];
    const knower = names[bridge.fromUser === "a" ? "b" : "a"];
    return fill(pick(TEMPLATES.planBridge, pairKey, attemptNumber, "plan"), { wanter, knower, label: bridge.label });
  }
  const shared = analysis.sharedInterests.find((s) => s.strength !== "stretch") ?? null;
  if (shared) return fill(pick(TEMPLATES.planShared, pairKey, attemptNumber, "plan"), { label: shared.label });
  return pick(TEMPLATES.planGeneric, pairKey, attemptNumber, "plan");
}

const narrator = (text: string, mood: DialogueLine["mood"] = "neutral"): DialogueLine => ({ speaker: "narrator", text, mood });

export type ScriptInput = {
  pairKey: string;
  attemptNumber: number;
  /** {a} = initiator, {b} = target. */
  names: Names;
  spotlight: string;
  plan: string;
  /** Already oriented so "a" = initiator. */
  middle: DialogueLine[];
  level?: number;
  leveledUp?: boolean;
};

function beat(key: keyof typeof TEMPLATES, input: ScriptInput, extra: Record<string, string> = {}): string {
  const variants = TEMPLATES[key] as readonly string[];
  return fill(pick(variants, input.pairKey, input.attemptNumber, key), {
    a: input.names.a,
    b: input.names.b,
    spotlight: input.spotlight,
    plan: input.plan,
    ...extra,
  });
}

/** Fill {a}/{b}/{spotlight} inside template-only middle lines. */
export function fillLines(lines: DialogueLine[], input: Pick<ScriptInput, "names" | "spotlight">): DialogueLine[] {
  return lines.map((l) => ({ ...l, text: fill(l.text, { a: input.names.a, b: input.names.b, spotlight: input.spotlight }) }));
}

/** intro → friendsLines → suspense → friends outcome → plan line → "Level 1: Friends" */
export function friendsScript(input: ScriptInput, withLevel: boolean): DialogueLine[] {
  return [
    narrator(beat("intro", input)),
    ...input.middle,
    narrator(beat("suspense", input)),
    narrator(beat("friends", input), "excited"),
    narrator(input.plan, "happy"),
    ...(withLevel ? [narrator(beat("firstLevel", input, { levelName: levelName(1) }), "happy")] : []),
  ];
}

/** intro → clammedUpLines → suspense → clammed_up outcome (+ hopeful line) */
export function clammedUpScript(input: ScriptInput): DialogueLine[] {
  return [
    narrator(beat("intro", input)),
    ...input.middle,
    narrator(beat("suspense", input)),
    narrator(beat("clammedUp", input), "shy"),
    narrator(beat("clammedUpHope", input), "happy"),
  ];
}

export function alreadyFriendsScript(input: ScriptInput): DialogueLine[] {
  return [narrator(beat("alreadyFriends", input), "happy"), narrator(input.plan, "happy")];
}

/** intro → scene lines → (level-up line) → plan line */
export function hangoutScript(input: ScriptInput): DialogueLine[] {
  const lines = [narrator(beat("hangoutIntro", input), "happy"), ...input.middle];
  if (input.leveledUp && input.level) lines.push(narrator(beat("levelUp", input, { levelName: levelName(input.level) }), "excited"));
  lines.push(narrator(input.plan, "happy"));
  return lines;
}

export function cooldownScript(input: ScriptInput): DialogueLine[] {
  return [narrator(beat("cooldown", input), "happy")];
}

export function fallbackMiddle(input: ScriptInput): DialogueLine[] {
  return fillLines(pick(TEMPLATES.fallbackMiddle, input.pairKey, input.attemptNumber, "fallbackMiddle"), input);
}

export function fallbackHangoutLines(input: ScriptInput): DialogueLine[] {
  return [narrator(beat("fallbackHangout", input), "happy")];
}
