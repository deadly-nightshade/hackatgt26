import type { Collection } from "mongodb";
import type { MeetAttempt, Pair } from "@/lib/meet/schema";
import { ensureIndexes, getMongoDb } from "@/lib/storage/mongoRepo";
import type { PairRepository } from "@/lib/storage/pairRepo";

/** Collections `pairs` (unique pairKey) and `meetAttempts` (indexed by pairKey). */
export class MongoPairRepository implements PairRepository {
  private async pairs(): Promise<Collection<Pair>> {
    const col = (await getMongoDb()).collection<Pair>("pairs");
    await ensureIndexes("pairs", () => col.createIndexes([{ key: { pairKey: 1 }, unique: true }, { key: { userIds: 1 } }]));
    return col;
  }

  private async attempts(): Promise<Collection<MeetAttempt>> {
    const col = (await getMongoDb()).collection<MeetAttempt>("meetAttempts");
    await ensureIndexes("meetAttempts", () => col.createIndexes([{ key: { pairKey: 1, createdAt: 1 } }]));
    return col;
  }

  async getPair(pairKey: string): Promise<Pair | null> {
    return (await this.pairs()).findOne({ _id: pairKey });
  }

  async savePair(pair: Pair): Promise<void> {
    await (await this.pairs()).replaceOne({ _id: pair._id }, pair, { upsert: true });
  }

  async listPairsForUser(userId: string): Promise<Pair[]> {
    return (await this.pairs()).find({ userIds: userId }).sort({ createdAt: 1 }).toArray();
  }

  async listPairsAmong(userIds: string[]): Promise<Pair[]> {
    return (await this.pairs()).find({ "userIds.0": { $in: userIds }, "userIds.1": { $in: userIds } }).toArray();
  }

  async listAttemptsForPairs(pairKeys: string[]): Promise<MeetAttempt[]> {
    if (!pairKeys.length) return [];
    return (await this.attempts()).find({ pairKey: { $in: pairKeys } }).sort({ createdAt: 1 }).toArray();
  }

  async getAttempt(attemptId: string): Promise<MeetAttempt | null> {
    return (await this.attempts()).findOne({ _id: attemptId });
  }

  async logAttempt(attempt: MeetAttempt): Promise<void> {
    await (await this.attempts()).insertOne(attempt);
  }

  async listAttempts(pairKey: string): Promise<MeetAttempt[]> {
    return (await this.attempts()).find({ pairKey }).sort({ createdAt: 1 }).toArray();
  }

  async deleteForUsers(userIds: string[]): Promise<number> {
    const pairs = await this.pairs();
    const keys = (await pairs.find({ userIds: { $in: userIds } }, { projection: { _id: 1 } }).toArray()).map((p) => p._id);
    if (!keys.length) return 0;
    await pairs.deleteMany({ _id: { $in: keys } });
    await (await this.attempts()).deleteMany({ pairKey: { $in: keys } });
    return keys.length;
  }

  async deletePair(pairKey: string): Promise<void> {
    await (await this.pairs()).deleteOne({ _id: pairKey });
    await (await this.attempts()).deleteMany({ pairKey });
  }
}
