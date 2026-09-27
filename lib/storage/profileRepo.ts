import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_APPEARANCE, getAppearance, type Appearance } from "@/lib/fish/appearance";
import { ProfileSchema, type Answer, type Profile } from "@/lib/profile/schema";
import { log } from "@/lib/util/log";

export type ProfileRecord = {
  profile: Profile;
  /** Kept so profiles can be re-extracted if the prompt/schema changes. */
  rawAnswers: Answer[];
  /** Only set when importing an existing profile (keeps its original id / timestamp). */
  id?: string;
  createdAt?: Date;
  /** Test residents from `npm run seed:fish`. */
  isSeed?: boolean;
  /** Chosen in the onboarding creator (default: plain fish). */
  appearance?: Appearance;
  /** How they onboarded (analytics/debug only). */
  onboardingMode?: OnboardingMode;
  /** Opted in to being suggested to other fish ("Find fish"). Default false. */
  discoverable?: boolean;
};

export type OnboardingMode = "quick" | "full";

/** update() options: cosmetic edits (name, summary, catchphrase…) don't touch the pair AI cache key. */
export type UpdateOptions = { contentChanged?: boolean };

/** A saved profile as read back (for meet-ups and dev tools). */
export type StoredProfile = {
  id: string;
  profile: Profile;
  createdAt: Date;
  /** Any profile edit (not appearance). */
  updatedAt: Date;
  /**
   * THE pair AI cache key: bumps only when matching fields change (interests, wantsToTry,
   * socialStyle — or a full redo). Cosmetic edits and appearance never touch it.
   * Older docs without it fall back to updatedAt (so existing caches stay valid).
   */
  contentUpdatedAt: Date;
  isSeed: boolean;
  onboardingMode: OnboardingMode | null;
  /** Opted in to recommendations (missing on older docs → false). */
  discoverable: boolean;
  /** Always complete: missing/partial/unknown slots read as "none" (getAppearance). */
  appearance: Appearance;
};

export type ProfileListItem = { id: string; displayName: string; isSeed: boolean; updatedAt: Date; discoverable: boolean };

export interface ProfileRepository {
  save(record: ProfileRecord): Promise<{ id: string }>;
  get(id: string): Promise<StoredProfile | null>;
  list(): Promise<ProfileListItem[]>;
  delete(id: string): Promise<void>;
  /** Saves appearance + appearanceUpdatedAt only (NOT updatedAt). False if the profile doesn't exist. */
  setAppearance(id: string, appearance: Appearance): Promise<boolean>;
  /**
   * Replace an existing fish's profile IN PLACE (redo onboarding, profile edits) — same id, so
   * pairs/friendships/history stay. rawAnswers/appearance/onboardingMode are kept when omitted.
   * Bumps updatedAt; bumps contentUpdatedAt (the pair AI cache key) unless `contentChanged: false`.
   * Keeps createdAt/isSeed. False if the profile doesn't exist.
   */
  update(id: string, record: UpdateRecord, opts?: UpdateOptions): Promise<boolean>;
  /** Consent toggle: discoverable + discoverableUpdatedAt only (never updatedAt/contentUpdatedAt). */
  setDiscoverable(id: string, discoverable: boolean): Promise<boolean>;
}

export type UpdateRecord = Pick<ProfileRecord, "profile"> & Partial<Pick<ProfileRecord, "rawAnswers" | "appearance" | "onboardingMode" | "discoverable">>;

export function newProfileId(): string {
  return randomUUID();
}

/** Ids come from URLs (NFC tags) — only allow safe characters. */
export function isValidProfileId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

/** Pretty-prints the confirmed profile to the server terminal. */
export function printProfile(id: string, record: ProfileRecord) {
  const bar = "=".repeat(72);
  console.log(`\n${bar}\n  CONFIRMED PROFILE  ${id}  (${record.profile.displayName})\n${bar}`);
  console.log(JSON.stringify(record.profile, null, 2));
  console.log(`${bar}\n`);
}

/** Stored document (file or Mongo) → StoredProfile. Invalid profiles are logged and treated as missing. */
export function toStoredProfile(doc: Record<string, unknown> & { _id: string }): StoredProfile | null {
  const parsed = ProfileSchema.safeParse(doc); // strips _id / timestamps / rawAnswers
  if (!parsed.success) {
    log("profiles", `profile ${doc._id} failed validation, ignoring`, { issues: parsed.error.issues.length });
    return null;
  }
  const date = (v: unknown) => (v ? new Date(v as string) : new Date(0));
  return {
    id: doc._id,
    profile: parsed.data,
    createdAt: date(doc.createdAt),
    updatedAt: date(doc.updatedAt),
    contentUpdatedAt: date(doc.contentUpdatedAt ?? doc.updatedAt),
    isSeed: doc.isSeed === true,
    appearance: getAppearance(doc.appearance),
    onboardingMode: doc.onboardingMode === "quick" || doc.onboardingMode === "full" ? doc.onboardingMode : null,
    discoverable: doc.discoverable === true,
  };
}

/** Terminal + ./data/profiles/<id>.json. Requires WRITABLE_FS=true. */
export class ConsoleFileRepository implements ProfileRepository {
  constructor(private dir = path.join(process.cwd(), "data", "profiles")) {}

  async save(record: ProfileRecord): Promise<{ id: string }> {
    const id = record.id ?? newProfileId();
    printProfile(id, record);
    const now = new Date().toISOString();
    const createdAt = record.createdAt?.toISOString() ?? now;
    await mkdir(this.dir, { recursive: true });
    await writeFile(
      path.join(this.dir, `${id}.json`),
      JSON.stringify(
        {
          _id: id,
          createdAt,
          updatedAt: now,
          contentUpdatedAt: now,
          ...(record.isSeed ? { isSeed: true } : {}),
          ...(record.onboardingMode ? { onboardingMode: record.onboardingMode } : {}),
          discoverable: record.discoverable === true,
          discoverableUpdatedAt: now,
          ...record.profile,
          appearance: getAppearance(record.appearance ?? DEFAULT_APPEARANCE),
          appearanceUpdatedAt: now,
          rawAnswers: record.rawAnswers,
        },
        null,
        2,
      ),
    );
    return { id };
  }

  async get(id: string): Promise<StoredProfile | null> {
    if (!isValidProfileId(id)) return null;
    try {
      const doc = JSON.parse(await readFile(path.join(this.dir, `${id}.json`), "utf8"));
      return toStoredProfile({ ...doc, _id: id });
    } catch {
      return null;
    }
  }

  async list(): Promise<ProfileListItem[]> {
    const files = (await readdir(this.dir).catch(() => [])).filter((f) => f.endsWith(".json"));
    const items = await Promise.all(files.map((f) => this.get(path.basename(f, ".json"))));
    return items
      .filter((p): p is StoredProfile => p !== null)
      .map((p) => ({ id: p.id, displayName: p.profile.displayName, isSeed: p.isSeed, updatedAt: p.updatedAt, discoverable: p.discoverable }));
  }

  async delete(id: string): Promise<void> {
    if (!isValidProfileId(id)) return;
    await rm(path.join(this.dir, `${id}.json`), { force: true });
  }

  async update(id: string, record: UpdateRecord, { contentChanged = true }: UpdateOptions = {}): Promise<boolean> {
    if (!isValidProfileId(id)) return false;
    const file = path.join(this.dir, `${id}.json`);
    const old = await readFile(file, "utf8").then(JSON.parse, () => null);
    if (!old) return false;
    printProfile(id, { rawAnswers: [], ...record, id });
    const now = new Date().toISOString();
    await writeFile(
      file,
      JSON.stringify(
        {
          _id: id,
          createdAt: old.createdAt ?? now,
          updatedAt: now,
          contentUpdatedAt: contentChanged ? now : (old.contentUpdatedAt ?? old.updatedAt ?? now),
          ...(old.isSeed ? { isSeed: true } : {}),
          ...((record.onboardingMode ?? old.onboardingMode) ? { onboardingMode: record.onboardingMode ?? old.onboardingMode } : {}),
          discoverable: record.discoverable ?? old.discoverable === true,
          discoverableUpdatedAt: record.discoverable !== undefined ? now : old.discoverableUpdatedAt ?? now,
          ...record.profile,
          appearance: getAppearance(record.appearance ?? old.appearance),
          appearanceUpdatedAt: record.appearance ? now : old.appearanceUpdatedAt ?? now,
          rawAnswers: record.rawAnswers ?? old.rawAnswers ?? [],
        },
        null,
        2,
      ),
    );
    return true;
  }

  async setDiscoverable(id: string, discoverable: boolean): Promise<boolean> {
    if (!isValidProfileId(id)) return false;
    const file = path.join(this.dir, `${id}.json`);
    const doc = await readFile(file, "utf8").then(JSON.parse, () => null);
    if (!doc) return false;
    await writeFile(file, JSON.stringify({ ...doc, discoverable, discoverableUpdatedAt: new Date().toISOString() }, null, 2));
    return true;
  }

  async setAppearance(id: string, appearance: Appearance): Promise<boolean> {
    if (!isValidProfileId(id)) return false;
    const file = path.join(this.dir, `${id}.json`);
    const doc = await readFile(file, "utf8").then(JSON.parse, () => null);
    if (!doc) return false;
    await writeFile(file, JSON.stringify({ ...doc, appearance: getAppearance(appearance), appearanceUpdatedAt: new Date().toISOString() }, null, 2));
    return true;
  }
}
