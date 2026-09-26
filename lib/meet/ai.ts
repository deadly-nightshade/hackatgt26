import type { z } from "zod";
import { chatJson, type ChatMessage } from "@/lib/ai/chat";
import { CHAT_MODEL, config } from "@/lib/config";
import { MIDDLE_LINES, SCENE_LINES, SCENES_PER_BATCH } from "@/lib/meet/config";
import { guardAnalysis, hasConnection } from "@/lib/meet/guard";
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
  buildDialogueUserPrompt,
  buildScenesUserPrompt,
  DIALOGUE_SYSTEM_PROMPT,
  SCENES_SYSTEM_PROMPT,
  trimProfile,
} from "@/lib/meet/prompt";
import {
  AnalysisSchema,
  DialogueSchema,
  SceneBatchSchema,
  toJsonSchema,
  type Analysis,
  type Dialogue,
  type DialogueLine,
  type SceneBatch,
} from "@/lib/meet/schema";
import { formatZodError } from "@/lib/profile/extract";
import type { Profile } from "@/lib/profile/schema";
import { log } from "@/lib/util/log";

export type Scene = SceneBatch["scenes"][number];

/**
 * The model-backed steps of a meet-up. "a"/"b" are the pair's sorted order.
 * Every method either returns validated output or throws (the pipeline falls back).
 */
export interface MeetAI {
  readonly model: string;
  analyze(a: Profile, b: Profile): Promise<Analysis>;
  dialogue(a: Profile, b: Profile, analysis: Analysis): Promise<Dialogue>;
  scenes(a: Profile, b: Profile, analysis: Analysis, opts: { levelName: string; usedTopics: string[] }): Promise<Scene[]>;
}

type Check<T> = { ok: true; value: T } | { ok: false; error: string };

function parseWith<T>(schema: z.ZodType<T>, raw: string): Check<T> {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, error: `Output was not valid JSON: ${(e as Error).message}` };
  }
  const r = schema.safeParse(json);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: formatZodError(r.error) };
}

/** One structured call + at most one retry with the problem fed back. Throws if both fail. */
async function callWithRetry<T>(opts: {
  route: string;
  messages: ChatMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  temperature: number;
  check: (raw: string) => Check<T>;
}): Promise<T> {
  const call = (messages: ChatMessage[], route: string) =>
    chatJson({
      route,
      messages,
      schemaName: opts.schemaName,
      schema: opts.schema,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      reasoningEffort: "low",
    });

  let raw1: string;
  try {
    raw1 = await call(opts.messages, opts.route);
  } catch (err) {
    log("meet-ai", `${opts.route} call failed, retrying once: ${(err as Error).message}`);
    const retried = opts.check(await call(opts.messages, `${opts.route}-retry`));
    if (retried.ok) return retried.value;
    throw new Error(`${opts.route} failed after retry:\n${retried.error}`);
  }
  const first = opts.check(raw1);
  if (first.ok) return first.value;

  log("meet-ai", `${opts.route} invalid, retrying once`, { error: first.error, raw: raw1.slice(0, 1500) });
  const raw2 = await call(
    [
      ...opts.messages,
      { role: "assistant", content: raw1 },
      { role: "user", content: `Your previous output had problems:\n${first.error}\n\nReturn the corrected JSON object only, matching the schema exactly.` },
    ],
    `${opts.route}-retry`,
  );
  const second = opts.check(raw2);
  if (second.ok) return second.value;
  log("meet-ai", `${opts.route} invalid after retry`, { error: second.error, raw: raw2.slice(0, 1500) });
  throw new Error(`${opts.route} failed validation after retry:\n${second.error}`);
}

const analysisJsonSchema = toJsonSchema(AnalysisSchema);
const dialogueJsonSchema = toJsonSchema(DialogueSchema);
const scenesJsonSchema = toJsonSchema(SceneBatchSchema);

function tidyLines(lines: DialogueLine[], bounds: { min: number; max: number }, what: string): Check<DialogueLine[]> {
  const out = lines.slice(0, bounds.max);
  return out.length >= bounds.min ? { ok: true, value: out } : { ok: false, error: `- ${what}: need at least ${bounds.min} lines, got ${out.length}` };
}

export class MuseMeetAI implements MeetAI {
  readonly model = CHAT_MODEL;

  async analyze(a: Profile, b: Profile): Promise<Analysis> {
    return callWithRetry({
      route: "meet-analysis",
      messages: [
        { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content: buildAnalysisUserPrompt(trimProfile(a), trimProfile(b)) },
      ],
      schemaName: "meet_analysis",
      schema: analysisJsonSchema,
      maxTokens: 6000, // includes reasoning tokens
      temperature: 0.4,
      check: (raw) => {
        const parsed = parseWith(AnalysisSchema, raw);
        if (!parsed.ok) return parsed;
        const { analysis, dropped } = guardAnalysis(parsed.value, a, b);
        if (dropped.length) log("meet-guard", `dropped ${dropped.length} invented item(s)`, { dropped });
        if (hasConnection(analysis)) return { ok: true, value: analysis };
        return {
          ok: false,
          error:
            (dropped.length ? `These items cited tags that don't exist in the right profile and were discarded:\n${dropped.map((d) => `- ${d}`).join("\n")}\n` : "") +
            `You must return at least one sharedInterest or bridge using EXACT tags. If nothing really overlaps, add one grounded "stretch".\n` +
            `A interest tags: ${a.interests.map((i) => i.tag).join(", ")}\nB interest tags: ${b.interests.map((i) => i.tag).join(", ")}`,
        };
      },
    });
  }

  async dialogue(a: Profile, b: Profile, analysis: Analysis): Promise<Dialogue> {
    return callWithRetry({
      route: "meet-dialogue",
      messages: [
        { role: "system", content: DIALOGUE_SYSTEM_PROMPT },
        { role: "user", content: buildDialogueUserPrompt(trimProfile(a), trimProfile(b), analysis) },
      ],
      schemaName: "meet_dialogue",
      schema: dialogueJsonSchema,
      maxTokens: 6000,
      temperature: 0.8,
      check: (raw) => {
        const parsed = parseWith(DialogueSchema, raw);
        if (!parsed.ok) return parsed;
        const friends = tidyLines(parsed.value.friendsLines, MIDDLE_LINES, "friendsLines");
        const clammed = tidyLines(parsed.value.clammedUpLines, MIDDLE_LINES, "clammedUpLines");
        if (!friends.ok || !clammed.ok) return { ok: false, error: [friends, clammed].flatMap((c) => (c.ok ? [] : [c.error])).join("\n") };
        return { ok: true, value: { friendsLines: friends.value, clammedUpLines: clammed.value } };
      },
    });
  }

  async scenes(a: Profile, b: Profile, analysis: Analysis, opts: { levelName: string; usedTopics: string[] }): Promise<Scene[]> {
    return callWithRetry({
      route: "meet-scenes",
      messages: [
        { role: "system", content: SCENES_SYSTEM_PROMPT },
        { role: "user", content: buildScenesUserPrompt(trimProfile(a), trimProfile(b), analysis, opts) },
      ],
      schemaName: "hangout_scenes",
      schema: scenesJsonSchema,
      maxTokens: 8000,
      temperature: 0.8,
      check: (raw) => {
        const parsed = parseWith(SceneBatchSchema, raw);
        if (!parsed.ok) return parsed;
        const scenes: Scene[] = [];
        for (const s of parsed.value.scenes.slice(0, SCENES_PER_BATCH)) {
          const lines = tidyLines(s.lines, SCENE_LINES, `scene "${s.topic}"`);
          if (!lines.ok) return lines;
          scenes.push({ topic: s.topic, lines: lines.value });
        }
        return { ok: true, value: scenes };
      },
    });
  }
}

// ── Mock (AI_MODE=mock): deterministic, zero API calls ─────────────────────

const tokens = (tag: string) => tag.split("-").filter((t) => t.length >= 4 && !["and", "with", "games"].includes(t));
const shareToken = (x: string, y: string) => tokens(x).some((t) => tokens(y).includes(t));

/**
 * Exact tag matches (+ exact bridges). This is also the live-failure fallback
 * ("exact tag matches only"); with `fuzzy`, the mock adds word-overlap
 * "close" matches, same-category "loose" ones, and a stretch if still empty.
 */
export function heuristicAnalysis(a: Profile, b: Profile, opts: { fuzzy: boolean }): Analysis {
  const sharedInterests: Analysis["sharedInterests"] = [];
  const used = new Set<string>();
  const add = (ai: Profile["interests"][number], bi: Profile["interests"][number], strength: Analysis["sharedInterests"][number]["strength"], label: string, why: string) => {
    if (used.has(ai.tag) || used.has(`b:${bi.tag}`)) return;
    used.add(ai.tag);
    used.add(`b:${bi.tag}`);
    sharedInterests.push({ aTag: ai.tag, bTag: bi.tag, label, strength, why });
  };

  for (const ai of a.interests) for (const bi of b.interests) if (ai.tag === bi.tag) add(ai, bi, "same", ai.name, "They both listed it.");
  if (opts.fuzzy) {
    for (const ai of a.interests) for (const bi of b.interests) if (shareToken(ai.tag, bi.tag)) add(ai, bi, "close", `${ai.name} & ${bi.name}`, "Very similar interests.");
    for (const ai of a.interests)
      for (const bi of b.interests) if (ai.category === bi.category && ai.category !== "other") add(ai, bi, "loose", ai.category.replace(/_/g, " "), "Same kind of hobby.");
  }

  const bridges: Analysis["bridges"] = [];
  const bridge = (from: "a" | "b", wanter: Profile, knower: Profile) => {
    for (const w of wanter.wantsToTry)
      for (const k of knower.interests)
        if (w.tag === k.tag || (opts.fuzzy && shareToken(w.tag, k.tag))) {
          if (!bridges.some((x) => x.fromUser === from && x.wantsToTryTag === w.tag)) bridges.push({ fromUser: from, wantsToTryTag: w.tag, matchedInterestTag: k.tag, label: w.name });
        }
  };
  bridge("a", a, b);
  bridge("b", b, a);

  if (opts.fuzzy && !sharedInterests.length && !bridges.length && a.interests[0] && b.interests[0]) {
    add(a.interests[0], b.interests[0], "stretch", `${a.interests[0].name} meets ${b.interests[0].name}`, "Different hobbies, same enthusiasm.");
  }

  const top = sharedInterests.find((s) => s.strength !== "stretch");
  const spotlight = top
    ? `love ${top.label}`
    : opts.fuzzy && bridges[0]
      ? `are curious about ${bridges[0].label}`
      : opts.fuzzy && sharedInterests[0]
        ? "throw themselves into their hobbies"
        : "love the seaside market";
  const energyMatch = a.socialStyle.energy === b.socialStyle.energy || [a.socialStyle.energy, b.socialStyle.energy].includes("balanced");
  return {
    sharedInterests: sharedInterests.slice(0, 5),
    bridges: bridges.slice(0, 3),
    styleNotes: { energyMatch, note: energyMatch ? "Their energy fits together nicely." : "One likes to go out, one likes to stay in." },
    spotlight,
  };
}

export class MockMeetAI implements MeetAI {
  readonly model = "mock";

  async analyze(a: Profile, b: Profile): Promise<Analysis> {
    return heuristicAnalysis(a, b, { fuzzy: true });
  }

  async dialogue(a: Profile, b: Profile, analysis: Analysis): Promise<Dialogue> {
    const [A, B] = [a.displayName, b.displayName];
    const topic = analysis.sharedInterests[0]?.label ?? analysis.bridges[0]?.label ?? "the market";
    return {
      friendsLines: [
        { speaker: "a", text: `Hey ${B}! Water you up to?`, mood: "happy" },
        { speaker: "b", text: `Oh hi ${A}! Just thinking about ${topic}.`, mood: "happy" },
        { speaker: "a", text: `No way — me too! We must be from the same school.`, mood: "excited" },
        { speaker: "b", text: `We should totally do that together sometime!`, mood: "excited" },
      ],
      clammedUpLines: [
        { speaker: "a", text: `Um… hi ${B}.`, mood: "shy" },
        { speaker: "b", text: `Oh! Hi… nice weather, huh?`, mood: "shy" },
        { speaker: "a", text: `I heard you're into ${topic}…?`, mood: "shy" },
        { speaker: "b", text: `Yeah… maybe we could talk about it more next time.`, mood: "neutral" },
      ],
    };
  }

  async scenes(a: Profile, b: Profile, analysis: Analysis, opts: { usedTopics: string[] }): Promise<Scene[]> {
    const topics = [...analysis.sharedInterests.map((s) => s.label), ...analysis.bridges.map((br) => br.label), analysis.spotlight];
    const batch = opts.usedTopics.length;
    return Array.from({ length: SCENES_PER_BATCH }, (_, i) => {
      const topic = topics[(batch + i) % topics.length];
      return {
        topic: batch ? `${topic} (round ${Math.floor(batch / SCENES_PER_BATCH) + 1})` : topic,
        lines: [
          { speaker: "narrator", text: `${a.displayName} and ${b.displayName} spent the afternoon on ${topic}.`, mood: "happy" },
          { speaker: "a", text: `This is fin-tastic, ${b.displayName}!`, mood: "excited" },
          { speaker: "b", text: `Told you! Same time next tide?`, mood: "happy" },
          { speaker: "a", text: `Obviously.`, mood: "happy" },
        ],
      } satisfies Scene;
    });
  }
}

export function getMeetAI(): MeetAI {
  return config.aiMode() === "live" ? new MuseMeetAI() : new MockMeetAI();
}
