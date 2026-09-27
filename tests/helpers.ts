import { DEFAULT_APPEARANCE, getAppearance, type Appearance } from "@/lib/fish/appearance";
import type { MeetAttempt, Pair } from "@/lib/meet/schema";
import type { Profile } from "@/lib/profile/schema";
import type { PairRepository } from "@/lib/storage/pairRepo";
import type { ProfileRepository, StoredProfile } from "@/lib/storage/profileRepo";

/** In-memory repositories shared by the test files. */

export class MemoryProfiles implements ProfileRepository {
  constructor(public map = new Map<string, StoredProfile>()) {}
  add(id: string, profile: Profile, updatedAt = new Date("2026-01-01")) {
    this.map.set(id, { id, profile, createdAt: updatedAt, updatedAt, isSeed: false, appearance: DEFAULT_APPEARANCE });
  }
  async setAppearance(id: string, appearance: Appearance) {
    const p = this.map.get(id);
    if (!p) return false;
    this.map.set(id, { ...p, appearance: getAppearance(appearance) });
    return true;
  }
  async save(): Promise<{ id: string }> {
    throw new Error("unused");
  }
  async get(id: string) {
    return this.map.get(id) ?? null;
  }
  async list() {
    return [...this.map.values()].map((p) => ({ id: p.id, displayName: p.profile.displayName, isSeed: false, updatedAt: p.updatedAt }));
  }
  async delete(id: string) {
    this.map.delete(id);
  }
}

export class MemoryPairs implements PairRepository {
  pairs = new Map<string, Pair>();
  attempts: MeetAttempt[] = [];
  async getPair(k: string) {
    const p = this.pairs.get(k);
    return p ? structuredClone(p) : null;
  }
  async savePair(p: Pair) {
    this.pairs.set(p.pairKey, structuredClone(p));
  }
  async listPairsForUser(u: string) {
    return [...this.pairs.values()].filter((p) => p.userIds.includes(u));
  }
  async logAttempt(a: MeetAttempt) {
    this.attempts.push(a);
  }
  async listPairsAmong(ids: string[]) {
    return [...this.pairs.values()].filter((p) => ids.includes(p.userIds[0]) && ids.includes(p.userIds[1]));
  }
  async listAttempts(k: string) {
    return this.attempts.filter((a) => a.pairKey === k);
  }
  async listAttemptsForPairs(keys: string[]) {
    return this.attempts.filter((a) => keys.includes(a.pairKey));
  }
  async getAttempt(id: string) {
    return this.attempts.find((a) => a._id === id) ?? null;
  }
  async deleteForUsers() {
    return 0;
  }
  async deletePair(k: string) {
    this.pairs.delete(k);
  }
}
