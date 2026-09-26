import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MeetAttempt, Pair } from "@/lib/meet/schema";

/** Pairs of fish (cached AI content + friendship status) and the log of meet attempts. */
export interface PairRepository {
  getPair(pairKey: string): Promise<Pair | null>;
  /** Insert or replace the whole pair document. */
  savePair(pair: Pair): Promise<void>;
  listPairsForUser(userId: string): Promise<Pair[]>;
  /** Pairs whose BOTH fish are in `userIds` (the world's friend-to-friend bumps). */
  listPairsAmong(userIds: string[]): Promise<Pair[]>;
  logAttempt(attempt: MeetAttempt): Promise<void>;
  /** Oldest first. */
  listAttempts(pairKey: string): Promise<MeetAttempt[]>;
  /** Oldest first, across several pairs. */
  listAttemptsForPairs(pairKeys: string[]): Promise<MeetAttempt[]>;
  getAttempt(attemptId: string): Promise<MeetAttempt | null>;
  /** Removes pairs and attempts involving any of these users (seed cleanup). */
  deleteForUsers(userIds: string[]): Promise<number>;
  /** Removes one pair and its attempts (CLI --reset). */
  deletePair(pairKey: string): Promise<void>;
}

// Dates round-trip through JSON as strings; revive the known date fields.
const DATE_KEYS = new Set(["friendsSince", "createdAt", "lastHangoutAt", "usedAt"]);
function revive(_key: string, value: unknown) {
  return typeof value === "string" && DATE_KEYS.has(_key) ? new Date(value) : value;
}
function revivePair(p: Pair): Pair {
  if (p.profilesUpdatedAt) p.profilesUpdatedAt = p.profilesUpdatedAt.map((d) => new Date(d)) as [Date, Date];
  return p;
}

/** ./data/pairs/<pairKey>.json + ./data/meet-attempts/<pairKey>.json. Requires WRITABLE_FS=true. */
export class FilePairRepository implements PairRepository {
  constructor(private root = path.join(process.cwd(), "data")) {}

  private pairFile = (k: string) => path.join(this.root, "pairs", `${k}.json`);
  private attemptsFile = (k: string) => path.join(this.root, "meet-attempts", `${k}.json`);

  async getPair(pairKey: string): Promise<Pair | null> {
    try {
      return revivePair(JSON.parse(await readFile(this.pairFile(pairKey), "utf8"), revive));
    } catch {
      return null;
    }
  }

  async savePair(pair: Pair): Promise<void> {
    await mkdir(path.dirname(this.pairFile(pair.pairKey)), { recursive: true });
    await writeFile(this.pairFile(pair.pairKey), JSON.stringify(pair, null, 2));
  }

  async listPairsForUser(userId: string): Promise<Pair[]> {
    return (await this.allPairs()).filter((p) => p.userIds.includes(userId));
  }

  async listPairsAmong(userIds: string[]): Promise<Pair[]> {
    const set = new Set(userIds);
    return (await this.allPairs()).filter((p) => set.has(p.userIds[0]) && set.has(p.userIds[1]));
  }

  private async allPairs(): Promise<Pair[]> {
    const dir = path.join(this.root, "pairs");
    const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json"));
    return (await Promise.all(files.map((f) => this.getPair(path.basename(f, ".json"))))).filter((p): p is Pair => !!p);
  }

  async listAttemptsForPairs(pairKeys: string[]): Promise<MeetAttempt[]> {
    const all = (await Promise.all(pairKeys.map((k) => this.listAttempts(k)))).flat();
    return all.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
  }

  async getAttempt(attemptId: string): Promise<MeetAttempt | null> {
    const pairs = await this.allPairs();
    for (const a of await this.listAttemptsForPairs(pairs.map((p) => p.pairKey))) if (a._id === attemptId) return a;
    return null;
  }

  async logAttempt(attempt: MeetAttempt): Promise<void> {
    const all = await this.listAttempts(attempt.pairKey);
    all.push(attempt);
    await mkdir(path.dirname(this.attemptsFile(attempt.pairKey)), { recursive: true });
    await writeFile(this.attemptsFile(attempt.pairKey), JSON.stringify(all, null, 2));
  }

  async listAttempts(pairKey: string): Promise<MeetAttempt[]> {
    try {
      return JSON.parse(await readFile(this.attemptsFile(pairKey), "utf8"), revive);
    } catch {
      return [];
    }
  }

  async deleteForUsers(userIds: string[]): Promise<number> {
    const dir = path.join(this.root, "pairs");
    const files = (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json"));
    let n = 0;
    for (const f of files) {
      const key = path.basename(f, ".json");
      if (key.split("__").some((id) => userIds.includes(id))) {
        await this.deletePair(key);
        n++;
      }
    }
    return n;
  }

  async deletePair(pairKey: string): Promise<void> {
    await rm(this.pairFile(pairKey), { force: true });
    await rm(this.attemptsFile(pairKey), { force: true });
  }
}
