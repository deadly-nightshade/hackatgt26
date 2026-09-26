import { MongoClient, type Collection } from "mongodb";
import { config } from "@/lib/config";
import type { Answer, Profile } from "@/lib/profile/schema";
import { newProfileId, printProfile, type ProfileRecord, type ProfileRepository } from "@/lib/storage/profileRepo";

export type ProfileDocument = Profile & {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  rawAnswers: Answer[];
};

// Reuse one client across hot reloads / warm serverless invocations.
const g = globalThis as unknown as { __mongo?: Promise<MongoClient>; __mongoIndexes?: Promise<unknown> };

function getClient(uri: string): Promise<MongoClient> {
  g.__mongo ??= new MongoClient(uri, { appName: "seaside-onboarding" }).connect().catch((err) => {
    g.__mongo = undefined; // allow a retry on the next request
    throw err;
  });
  return g.__mongo;
}

/** Pretty-prints (like console mode), then inserts into `profiles`. */
export class MongoProfileRepository implements ProfileRepository {
  private async collection(): Promise<Collection<ProfileDocument>> {
    const { uri, db } = config.mongo();
    const col = (await getClient(uri)).db(db).collection<ProfileDocument>("profiles");
    // Tag indexes for future overlap queries between residents.
    g.__mongoIndexes ??= col
      .createIndexes([{ key: { "interests.tag": 1 } }, { key: { "wantsToTry.tag": 1 } }])
      .catch((err) => {
        g.__mongoIndexes = undefined;
        throw err;
      });
    await g.__mongoIndexes;
    return col;
  }

  async save(record: ProfileRecord): Promise<{ id: string }> {
    const id = record.id ?? newProfileId();
    printProfile(id, record);
    const now = new Date();
    const col = await this.collection();
    await col.insertOne({
      ...record.profile,
      _id: id,
      createdAt: record.createdAt ?? now,
      updatedAt: now,
      rawAnswers: record.rawAnswers,
    });
    return { id };
  }
}

/** Close the shared client (for scripts; the server keeps it open). */
export async function closeMongo() {
  const client = await g.__mongo?.catch(() => undefined);
  g.__mongo = undefined;
  g.__mongoIndexes = undefined;
  await client?.close();
}
