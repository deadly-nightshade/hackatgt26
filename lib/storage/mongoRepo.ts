import { MongoClient, type Collection, type Db } from "mongodb";
import { config } from "@/lib/config";
import { DEFAULT_APPEARANCE, getAppearance, type Appearance } from "@/lib/fish/appearance";
import type { Answer, Profile } from "@/lib/profile/schema";
import {
  isValidProfileId,
  newProfileId,
  printProfile,
  toStoredProfile,
  type ProfileListItem,
  type ProfileRecord,
  type UpdateOptions,
  type UpdateRecord,
  type ProfileRepository,
  type StoredProfile,
} from "@/lib/storage/profileRepo";

export type ProfileDocument = Profile & {
  _id: string;
  createdAt: Date;
  updatedAt: Date;
  rawAnswers: Answer[];
  isSeed?: boolean;
  /** Pair AI cache key (missing on older docs → updatedAt). */
  contentUpdatedAt?: Date;
  onboardingMode?: "quick" | "full";
  discoverable?: boolean;
  discoverableUpdatedAt?: Date;
  /** Missing on profiles from before customization (read as the plain fish). */
  appearance?: Appearance;
  appearanceUpdatedAt?: Date;
};

// Reuse one client across hot reloads / warm serverless invocations.
const g = globalThis as unknown as {
  __mongo?: Promise<MongoClient>;
  __mongoIndexes?: Map<string, Promise<unknown>>;
};

function getClient(uri: string): Promise<MongoClient> {
  g.__mongo ??= new MongoClient(uri, { appName: "seaside-onboarding" }).connect().catch((err) => {
    g.__mongo = undefined; // allow a retry on the next request
    throw err;
  });
  return g.__mongo;
}

/** The shared database handle (one client per process). */
export async function getMongoDb(): Promise<Db> {
  const { uri, db } = config.mongo();
  return (await getClient(uri)).db(db);
}

/** Create a collection's indexes once per process (retried if creation fails). */
export async function ensureIndexes(key: string, create: () => Promise<unknown>): Promise<void> {
  g.__mongoIndexes ??= new Map();
  let p = g.__mongoIndexes.get(key);
  if (!p) {
    p = create().catch((err) => {
      g.__mongoIndexes?.delete(key);
      throw err;
    });
    g.__mongoIndexes.set(key, p);
  }
  await p;
}

/** Pretty-prints (like console mode), then inserts into `profiles`. */
export class MongoProfileRepository implements ProfileRepository {
  private async collection(): Promise<Collection<ProfileDocument>> {
    const col = (await getMongoDb()).collection<ProfileDocument>("profiles");
    // Tag indexes for future overlap queries between residents.
    await ensureIndexes("profiles", () =>
      col.createIndexes([{ key: { "interests.tag": 1 } }, { key: { "wantsToTry.tag": 1 } }]),
    );
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
      contentUpdatedAt: now,
      ...(record.onboardingMode ? { onboardingMode: record.onboardingMode } : {}),
      discoverable: record.discoverable === true,
      discoverableUpdatedAt: now,
      rawAnswers: record.rawAnswers,
      appearance: getAppearance(record.appearance ?? DEFAULT_APPEARANCE),
      appearanceUpdatedAt: now,
      ...(record.isSeed ? { isSeed: true } : {}),
    });
    return { id };
  }

  async get(id: string): Promise<StoredProfile | null> {
    if (!isValidProfileId(id)) return null;
    const doc = await (await this.collection()).findOne({ _id: id });
    return doc ? toStoredProfile(doc as unknown as Record<string, unknown> & { _id: string }) : null;
  }

  async list(): Promise<ProfileListItem[]> {
    const docs = await (await this.collection())
      .find({}, { projection: { displayName: 1, isSeed: 1, updatedAt: 1, discoverable: 1 } })
      .sort({ createdAt: 1 })
      .toArray();
    return docs.map((d) => ({ id: d._id, displayName: d.displayName, isSeed: d.isSeed === true, updatedAt: d.updatedAt, discoverable: d.discoverable === true }));
  }

  async delete(id: string): Promise<void> {
    await (await this.collection()).deleteOne({ _id: id });
  }

  async update(id: string, record: UpdateRecord, { contentChanged = true }: UpdateOptions = {}): Promise<boolean> {
    if (!isValidProfileId(id)) return false;
    const col = await this.collection();
    const old = await col.findOne({ _id: id });
    if (!old) return false;
    printProfile(id, { rawAnswers: [], ...record, id });
    const mode = record.onboardingMode ?? old.onboardingMode;
    const now = new Date();
    // Replace (not $set) so fields dropped from the schema don't linger; identity + timestamps carried over.
    await col.replaceOne(
      { _id: id },
      {
        ...record.profile,
        createdAt: old.createdAt ?? now,
        updatedAt: now,
        contentUpdatedAt: contentChanged ? now : (old.contentUpdatedAt ?? old.updatedAt ?? now),
        ...(mode ? { onboardingMode: mode } : {}),
        discoverable: record.discoverable ?? old.discoverable === true,
        discoverableUpdatedAt: record.discoverable !== undefined ? now : old.discoverableUpdatedAt ?? now,
        rawAnswers: record.rawAnswers ?? old.rawAnswers ?? [],
        appearance: getAppearance(record.appearance ?? old.appearance),
        appearanceUpdatedAt: record.appearance ? now : old.appearanceUpdatedAt ?? now,
        ...(old.isSeed ? { isSeed: true } : {}),
      },
    );
    return true;
  }

  async setDiscoverable(id: string, discoverable: boolean): Promise<boolean> {
    if (!isValidProfileId(id)) return false;
    // Consent only: never updatedAt / contentUpdatedAt (no pair AI cache reset).
    const res = await (await this.collection()).updateOne({ _id: id }, { $set: { discoverable, discoverableUpdatedAt: new Date() } });
    return res.matchedCount > 0;
  }

  async setAppearance(id: string, appearance: Appearance): Promise<boolean> {
    if (!isValidProfileId(id)) return false;
    // Deliberately NOT updatedAt: the pair AI cache keys on it and must only reset on content changes.
    const res = await (await this.collection()).updateOne(
      { _id: id },
      { $set: { appearance: getAppearance(appearance), appearanceUpdatedAt: new Date() } },
    );
    return res.matchedCount > 0;
  }
}

/** Close the shared client (for scripts; the server keeps it open). */
export async function closeMongo() {
  const client = await g.__mongo?.catch(() => undefined);
  g.__mongo = undefined;
  g.__mongoIndexes = undefined;
  await client?.close();
}
