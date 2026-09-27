import { randomUUID } from "node:crypto";
import { getUsageTotals } from "@/lib/ai/usage";
import { heuristicAnalysis, type MeetAI } from "@/lib/meet/ai";
import { LEVELS, levelFor, levelName, meetConfig, PROMPT_VERSION, type ForcedOutcome } from "@/lib/meet/config";
import { rollMeet } from "@/lib/meet/roll";
import {
  kindOf,
  pairKeyOf,
  sortIds,
  type Analysis,
  type BumpLine,
  type DialogueLine,
  type MeetAttempt,
  type MeetOutcome,
  type MeetResponse,
  type Pair,
} from "@/lib/meet/schema";
import { energyMatches, scoreAnalysis } from "@/lib/meet/score";
import {
  alreadyFriendsScript,
  clammedUpScript,
  cooldownScript,
  fallbackHangoutLines,
  fallbackMiddle,
  fill,
  friendsScript,
  hangoutScript,
  planText,
  type ScriptInput,
} from "@/lib/meet/templates";
import type { PairRepository } from "@/lib/storage/pairRepo";
import type { ProfileRepository, StoredProfile } from "@/lib/storage/profileRepo";
import { HttpError, log } from "@/lib/util/log";

export type MeetDeps = {
  profiles: ProfileRepository;
  pairs: PairRepository;
  ai: MeetAI;
  random?: () => number;
  now?: () => Date;
  forcedOutcome?: ForcedOutcome | null;
  hangoutsEnabled?: boolean;
  cooldownMs?: number;
};

export type MeetInput = {
  initiatorId: string;
  targetId: string;
  /** Dev only: ignore the cached analysis/dialogue. */
  regenerate?: boolean;
  /** CLI only: skip the hangout cooldown. */
  ignoreCooldown?: boolean;
  includeDebug?: boolean;
};

/** Cached AI content for a pair, or the non-cached fallback. */
type Content = {
  analysis: Analysis;
  similarity: number;
  dialogue: { friendsLines: DialogueLine[]; clammedUpLines: DialogueLine[] };
  bumpLines: BumpLine[];
  usedFallback: boolean;
};

// Concurrent first taps of the same pair share one generation (no double spend).
const g = globalThis as unknown as { __meetInflight?: Map<string, Promise<Content>> };
const inflight = (g.__meetInflight ??= new Map());

const swap = (s: DialogueLine["speaker"]): DialogueLine["speaker"] => (s === "a" ? "b" : s === "b" ? "a" : s);

export function newPair(pairKey: string, userIds: [string, string], now: Date): Pair {
  return { _id: pairKey, pairKey, userIds, status: "strangers", createdAt: now, level: 0, hangoutCount: 0, hangoutScenes: [], sceneBatchesGenerated: 0 };
}

export function isCacheValid(pair: Pair | null, model: string, a: StoredProfile, b: StoredProfile): boolean {
  return !!(
    pair?.analysis &&
    pair.dialogue &&
    pair.similarity !== undefined &&
    pair.promptVersion === PROMPT_VERSION &&
    pair.model === model &&
    pair.profilesUpdatedAt?.[0]?.getTime() === a.contentUpdatedAt.getTime() &&
    pair.profilesUpdatedAt?.[1]?.getTime() === b.contentUpdatedAt.getTime()
  );
}

/** Failed attempts since the last success (drives the pity multiplier). */
export function failsSinceSuccess(attempts: MeetAttempt[]): number {
  let n = 0;
  for (let i = attempts.length - 1; i >= 0; i--) {
    if (attempts[i].outcome === "clammed_up") n++;
    else if (attempts[i].outcome === "friends") break;
  }
  return n;
}

/** Steps 4–8: analysis → guard → score → dialogue. Never throws: falls back to templates. */
async function generateContent(ai: MeetAI, a: StoredProfile, b: StoredProfile, pairKey: string): Promise<Content> {
  let analysis: Analysis;
  try {
    analysis = await ai.analyze(a.profile, b.profile);
  } catch (err) {
    log("meet", `analysis failed for ${pairKey}, using template fallback: ${(err as Error).message}`);
    return fallbackContent(a, b);
  }
  // Energy match is decided in code, never by the model (nulls / "balanced" never match).
  analysis = { ...analysis, styleNotes: { ...analysis.styleNotes, energyMatch: energyMatches(a.profile.socialStyle, b.profile.socialStyle) } };
  const similarity = scoreAnalysis(analysis);
  try {
    const { bumpLines, ...dialogue } = await ai.dialogue(a.profile, b.profile, analysis);
    return { analysis, similarity, dialogue, bumpLines, usedFallback: false };
  } catch (err) {
    log("meet", `dialogue failed for ${pairKey}, using template lines: ${(err as Error).message}`);
    return { analysis, similarity, dialogue: { friendsLines: [], clammedUpLines: [] }, bumpLines: [], usedFallback: true };
  }
}

/** Exact tag matches only; template-only middle lines (filled at assembly). */
function fallbackContent(a: StoredProfile, b: StoredProfile): Content {
  const analysis = heuristicAnalysis(a.profile, b.profile, { fuzzy: false });
  return { analysis, similarity: scoreAnalysis(analysis), dialogue: { friendsLines: [], clammedUpLines: [] }, bumpLines: [], usedFallback: true };
}

async function loadProfile(deps: MeetDeps, id: string): Promise<StoredProfile> {
  const p = await deps.profiles.get(id);
  if (!p) throw new HttpError(404, `No fish with id ${id}`);
  return p;
}

/** POST /api/meet pipeline (see PHASE_2 DESIGN.md). */
export async function runMeet(input: MeetInput, deps: MeetDeps): Promise<MeetResponse> {
  const { initiatorId, targetId } = input;
  if (initiatorId === targetId) throw new HttpError(400, "That's your own tag, silly fish!");
  const now = (deps.now ?? (() => new Date()))();
  const callsBefore = getUsageTotals().calls;

  // 1. Load both profiles, in pair order (a = smaller id).
  const [initiator, target] = await Promise.all([loadProfile(deps, initiatorId), loadProfile(deps, targetId)]);
  const userIds = sortIds(initiatorId, targetId);
  const pairKey = pairKeyOf(initiatorId, targetId);
  const initiatorIsA = userIds[0] === initiatorId;
  const [A, B] = initiatorIsA ? [initiator, target] : [target, initiator];

  const [existing, attempts] = await Promise.all([deps.pairs.getPair(pairKey), deps.pairs.listAttempts(pairKey)]);
  const attemptNumber = attempts.length + 1;
  const pair = existing ?? newPair(pairKey, userIds, now);

  const names = { a: initiator.profile.displayName, b: target.profile.displayName };
  const orient = (lines: DialogueLine[]) => (initiatorIsA ? lines : lines.map((l) => ({ ...l, speaker: swap(l.speaker) })));
  const pairNames = { a: A.profile.displayName, b: B.profile.displayName };
  const scriptInput = (analysis: Analysis, middle: DialogueLine[]): ScriptInput => ({
    pairKey,
    attemptNumber,
    names,
    spotlight: analysis.spotlight,
    plan: planText(analysis, { a: A.profile.displayName, b: B.profile.displayName }, pairKey, attemptNumber),
    // Generated lines say {a}/{b} (pair order); fill current names, then orient to the initiator.
    middle: orient(middle.map((l) => ({ ...l, text: fill(l.text, pairNames) }))),
  });

  /** Logs the attempt (with the exact script that played) and builds the response. Called once per request. */
  const respond = async (r: {
    outcome: MeetOutcome;
    script: DialogueLine[];
    similarity: number;
    analysis: Analysis;
    pFail?: number | null;
    roll?: number | null;
    usedFallback?: boolean;
    leveledUp?: boolean;
  }): Promise<MeetResponse> => {
    const modelCalls = getUsageTotals().calls - callsBefore;
    await deps.pairs.logAttempt({
      _id: randomUUID(),
      pairKey,
      initiatorId,
      targetId,
      initiatorName: names.a,
      targetName: names.b,
      outcome: r.outcome,
      pFail: r.pFail ?? null,
      roll: r.roll ?? null,
      attemptNumber,
      level: pair.level,
      leveledUp: r.leveledUp ?? false,
      usedFallback: r.usedFallback ?? false,
      modelCalls,
      kind: kindOf(r.outcome),
      levelAfter: pair.level,
      levelNameAfter: pair.status === "friends" ? levelName(pair.level) : "Just met",
      script: r.script.map((l) => ({ ...l, speakerName: l.speaker === "narrator" ? null : names[l.speaker] })),
      createdAt: now,
    });
    log("meet", `${pairKey} → ${r.outcome}`, {
      attemptNumber,
      similarity: round(r.similarity),
      pFail: r.pFail == null ? null : round(r.pFail),
      roll: r.roll == null ? null : round(r.roll),
      level: pair.level,
      fallback: r.usedFallback ?? false,
      modelCalls,
    });
    return {
      pairKey,
      outcome: r.outcome,
      script: r.script,
      similarity: r.similarity,
      attemptNumber,
      fish: {
        a: { id: initiatorId, displayName: initiator.profile.displayName, appearance: initiator.appearance },
        b: { id: targetId, displayName: target.profile.displayName, appearance: target.appearance },
      },
      level: pair.level,
      levelName: pair.status === "friends" ? levelName(pair.level) : null,
      leveledUp: r.leveledUp ?? false,
      hangoutCount: pair.hangoutCount,
      ...(input.includeDebug
        ? { debug: { pFail: r.pFail ?? null, roll: r.roll ?? null, analysis: r.analysis, usedFallback: r.usedFallback ?? false, modelCalls } }
        : {}),
    };
  };

  /** Steps 3–8: the cached analysis/dialogue/bump lines, regenerated (once, shared by concurrent taps) when stale. */
  const getContent = async (): Promise<{ content: Content; refreshed: boolean }> => {
    if (!input.regenerate && isCacheValid(existing, deps.ai.model, A, B)) {
      return {
        content: { analysis: pair.analysis!, similarity: pair.similarity!, dialogue: pair.dialogue!, bumpLines: pair.bumpLines ?? [], usedFallback: false },
        refreshed: false,
      };
    }
    if (existing?.analysis && existing.promptVersion !== PROMPT_VERSION) {
      log("meet", `${pairKey}: regenerating for prompt ${existing.promptVersion ?? "?"} → ${PROMPT_VERSION}`);
    }
    let job = inflight.get(pairKey);
    if (!job) {
      job = generateContent(deps.ai, A, B, pairKey).finally(() => inflight.delete(pairKey));
      inflight.set(pairKey, job);
    }
    const content = await job;
    if (!content.usedFallback) {
      Object.assign(pair, {
        analysis: content.analysis,
        similarity: content.similarity,
        dialogue: content.dialogue,
        bumpLines: content.bumpLines,
        promptVersion: PROMPT_VERSION,
        model: deps.ai.model,
        profilesUpdatedAt: [A.contentUpdatedAt, B.contentUpdatedAt],
      } satisfies Partial<Pair>);
      await deps.pairs.savePair(pair);
    }
    return { content, refreshed: !content.usedFallback };
  };

  // 2. Already friends → no roll. (A hangout refreshes stale content first — see runHangout.)
  if (pair.status === "friends") {
    const analysis = pair.analysis ?? fallbackContent(A, B).analysis;
    const similarity = pair.similarity ?? scoreAnalysis(analysis);
    if (!(deps.hangoutsEnabled ?? meetConfig.hangoutsEnabled())) {
      return respond({ outcome: "already_friends", script: alreadyFriendsScript(scriptInput(analysis, [])), similarity, analysis });
    }
    return runHangout({ deps, input, pair, A, B, analysis, similarity, now, scriptInput, respond, getContent });
  }

  // 3–8. Get or create the cached content.
  const { content } = await getContent();

  // 9. Roll.
  // Clammed up last time → the next tap (or visit to their link) always makes them friends.
  // An explicit force (FORCE_MEET_OUTCOME / tests) still wins.
  const configured = deps.forcedOutcome === undefined ? meetConfig.forcedOutcome() : deps.forcedOutcome;
  const secondChance = failsSinceSuccess(attempts) > 0;
  const forced = configured ?? (secondChance ? "friends" : null);
  const { outcome, pFail, roll } = rollMeet({
    similarity: content.similarity,
    failsSinceSuccess: failsSinceSuccess(attempts),
    random: deps.random,
    forced,
  });

  // 10. Persist the result.
  const hangouts = deps.hangoutsEnabled ?? meetConfig.hangoutsEnabled();
  if (outcome === "friends") {
    Object.assign(pair, { status: "friends", friendsSince: now, level: LEVELS[0].level, hangoutCount: 0 } satisfies Partial<Pair>);
    await deps.pairs.savePair(pair);
  } else if (!existing && content.usedFallback) {
    // A clammed-up first meet on the fallback path must still exist as a pair (the world shows "just met" fish).
    await deps.pairs.savePair(pair);
  }

  // 11. Assemble.
  const lines = outcome === "friends" ? content.dialogue.friendsLines : content.dialogue.clammedUpLines;
  const base = scriptInput(content.analysis, lines);
  if (!lines.length) base.middle = fallbackMiddle(base);
  const script = outcome === "friends" ? friendsScript(base, hangouts) : clammedUpScript(base);
  return respond({
    outcome,
    script,
    similarity: content.similarity,
    analysis: content.analysis,
    pFail,
    roll,
    usedFallback: content.usedFallback,
    leveledUp: outcome === "friends" && hangouts,
  });
}

/** Stretch: a re-tap between friends = a hangout (or a cooldown line). */
async function runHangout(ctx: {
  deps: MeetDeps;
  input: MeetInput;
  pair: Pair;
  A: StoredProfile;
  B: StoredProfile;
  analysis: Analysis;
  similarity: number;
  now: Date;
  scriptInput: (analysis: Analysis, middle: DialogueLine[]) => ScriptInput;
  respond: (r: { outcome: MeetOutcome; script: DialogueLine[]; similarity: number; analysis: Analysis; usedFallback?: boolean; leveledUp?: boolean }) => Promise<MeetResponse>;
  getContent: () => Promise<{ content: Content; refreshed: boolean }>;
}): Promise<MeetResponse> {
  const { deps, pair, now } = ctx;
  let { analysis, similarity } = ctx;
  const cooldownMs = deps.cooldownMs ?? meetConfig.hangoutCooldownMs();
  const lastTogether = Math.max(pair.lastHangoutAt?.getTime() ?? 0, pair.friendsSince?.getTime() ?? 0);

  if (!ctx.input.ignoreCooldown && now.getTime() - lastTogether < cooldownMs) {
    return ctx.respond({ outcome: "cooldown", script: cooldownScript(ctx.scriptInput(analysis, [])), similarity, analysis });
  }

  // Stale content (new prompt version, or someone's interests changed) → refresh it now, lazily.
  // Status and level stay; unused old scenes are dropped so the next ones use the fresh content.
  const { content, refreshed } = await ctx.getContent();
  let freshScenesNeeded = false;
  if (refreshed) {
    analysis = content.analysis;
    similarity = content.similarity;
    pair.hangoutScenes = pair.hangoutScenes.filter((s) => s.usedAt);
    freshScenesNeeded = true;
  }

  const previousLevel = pair.level;
  pair.hangoutCount += 1;
  pair.level = Math.max(pair.level, levelFor(pair.hangoutCount));
  pair.lastHangoutAt = now;
  const leveledUp = pair.level > previousLevel;

  let scene = pair.hangoutScenes.find((s) => !s.usedAt);
  let usedFallback = false;
  if (!scene) {
    const firstBatch = pair.hangoutScenes.length === 0;
    const levelRose = pair.level > (pair.sceneBatchLevel ?? 0);
    if (firstBatch || freshScenesNeeded || (levelRose && pair.sceneBatchesGenerated < LEVELS.length)) {
      try {
        const scenes = await deps.ai.scenes(ctx.A.profile, ctx.B.profile, analysis, {
          levelName: levelName(pair.level),
          usedTopics: pair.hangoutScenes.map((s) => s.topic),
        });
        const fresh = scenes.map((s) => ({ id: randomUUID(), topic: s.topic, lines: s.lines }));
        pair.hangoutScenes.push(...fresh);
        pair.sceneBatchesGenerated += 1;
        pair.sceneBatchLevel = pair.level;
        scene = fresh[0];
      } catch (err) {
        log("meet", `scene generation failed for ${pair.pairKey}, template hangout: ${(err as Error).message}`);
        usedFallback = true;
      }
    } else {
      // Nothing new to unlock: cycle through the least recently used scene.
      scene = [...pair.hangoutScenes].sort((x, y) => (x.usedAt?.getTime() ?? 0) - (y.usedAt?.getTime() ?? 0))[0];
    }
  }
  if (scene) scene.usedAt = now;

  await deps.pairs.savePair(pair);

  const base = ctx.scriptInput(analysis, scene?.lines ?? []);
  if (!scene) base.middle = fallbackHangoutLines(base);
  base.level = pair.level;
  base.leveledUp = leveledUp;
  return ctx.respond({ outcome: "hangout", script: hangoutScript(base), similarity, analysis, usedFallback, leveledUp });
}

const round = (x: number) => Math.round(x * 1000) / 1000;
