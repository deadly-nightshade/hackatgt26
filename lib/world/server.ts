import { levelName } from "@/lib/meet/config";
import { kindOf, type AttemptKind, type MeetAttempt, type Pair } from "@/lib/meet/schema";
import type { PairRepository } from "@/lib/storage/pairRepo";
import type { ProfileRepository } from "@/lib/storage/profileRepo";
import { HttpError } from "@/lib/util/log";
import { bumpLinesForPair } from "@/lib/world/bumps";
import type { HistoryItem, ReplayResponse, Resident, WorldResponse } from "@/lib/world/types";

export type WorldDeps = { profiles: ProfileRepository; pairs: PairRepository };

const kind = (a: MeetAttempt): AttemptKind => a.kind ?? kindOf(a.outcome);
const counts = (a: MeetAttempt) => kind(a) !== "cooldown";

/**
 * THE rule for who appears in someone's world: only fish they have personally
 * met via an NFC tap — a pair containing them with at least one non-cooldown
 * attempt. Friends and clammed-up strangers alike; never friends-of-friends.
 */
export async function getResidentsFor(userId: string, deps: WorldDeps): Promise<{ residents: Resident[]; pairs: Pair[] }> {
  const pairs = await deps.pairs.listPairsForUser(userId);
  const attempts = await deps.pairs.listAttemptsForPairs(pairs.map((p) => p.pairKey));
  const lastMet = new Map<string, Date>();
  for (const a of attempts) if (counts(a)) lastMet.set(a.pairKey, a.createdAt); // oldest first → ends on the latest

  const met = pairs.filter((p) => lastMet.has(p.pairKey));
  const residents = await Promise.all(
    met.map(async (p): Promise<Resident | null> => {
      const otherId = p.userIds[0] === userId ? p.userIds[1] : p.userIds[0];
      const other = await deps.profiles.get(otherId);
      if (!other) return null; // deleted profile
      const friends = p.status === "friends";
      return {
        id: otherId,
        displayName: other.profile.displayName,
        pairKey: p.pairKey,
        status: p.status,
        level: friends ? p.level : 0,
        levelName: friends ? levelName(p.level) : null,
        hangoutCount: p.hangoutCount ?? 0,
        friendsSince: friends && p.friendsSince ? p.friendsSince.toISOString() : null,
        lastMetAt: lastMet.get(p.pairKey)!.toISOString(),
      };
    }),
  );
  const found = residents.filter((r): r is Resident => r !== null);
  const keep = new Set(found.map((r) => r.pairKey));
  return { residents: found, pairs: met.filter((p) => keep.has(p.pairKey)) };
}

/** GET /api/world: me + my residents + bump lines for pairs entirely inside that set. No AI. */
export async function getWorld(userId: string, deps: WorldDeps): Promise<WorldResponse> {
  const me = await deps.profiles.get(userId);
  if (!me) throw new HttpError(404, "No fish with that id");
  const { residents, pairs } = await getResidentsFor(userId, deps);

  const bumpLines: WorldResponse["bumpLines"] = {};
  for (const p of pairs) bumpLines[p.pairKey] = bumpLinesForPair(p);
  if (residents.length > 1) {
    // Friend-to-friend: only pairs where BOTH fish are already in my world.
    for (const p of await deps.pairs.listPairsAmong(residents.map((r) => r.id))) bumpLines[p.pairKey] = bumpLinesForPair(p);
  }

  return {
    me: { id: userId, displayName: me.profile.displayName, catchphrase: me.profile.residentFlavor.catchphrase },
    residents,
    bumpLines,
  };
}

async function pairFor(pairKey: string, userId: string, deps: WorldDeps): Promise<Pair> {
  const pair = await deps.pairs.getPair(pairKey);
  if (!pair) throw new HttpError(404, "No such pair");
  if (!pair.userIds.includes(userId)) throw new HttpError(403, "Not your pair");
  return pair;
}

/** GET /api/pairs/:pairKey/history: newest first, cooldowns hidden. */
export async function getHistory(pairKey: string, userId: string, deps: WorldDeps): Promise<HistoryItem[]> {
  await pairFor(pairKey, userId, deps);
  const attempts = await deps.pairs.listAttempts(pairKey);
  return attempts
    .filter(counts)
    .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
    .map((a) => ({
      attemptId: a._id,
      kind: kind(a),
      createdAt: a.createdAt.toISOString(),
      levelNameAfter: a.levelNameAfter ?? null,
      leveledUp: a.leveledUp ?? false,
      hasScript: !!a.script?.length,
    }));
}

/** GET /api/attempts/:id: the exact saved script. Read-only — never rolls, never calls the AI. */
export async function getReplay(attemptId: string, userId: string, deps: WorldDeps): Promise<ReplayResponse> {
  const attempt = await deps.pairs.getAttempt(attemptId);
  if (!attempt) throw new HttpError(404, "No such cutscene");
  const pair = await pairFor(attempt.pairKey, userId, deps);
  if (!attempt.script?.length) throw new HttpError(404, "Replay unavailable for this one");

  const targetId = attempt.targetId ?? (pair.userIds[0] === attempt.initiatorId ? pair.userIds[1] : pair.userIds[0]);
  const nameOf = async (id: string, saved?: string) => saved ?? (await deps.profiles.get(id))?.profile.displayName ?? "???";
  return {
    kind: kind(attempt),
    createdAt: attempt.createdAt.toISOString(),
    names: { a: await nameOf(attempt.initiatorId, attempt.initiatorName), b: await nameOf(targetId, attempt.targetName) },
    script: attempt.script.map(({ speaker, text, mood }) => ({ speaker, text, mood })),
  };
}
