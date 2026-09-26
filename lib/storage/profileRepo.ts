import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Answer, Profile } from "@/lib/profile/schema";

export type ProfileRecord = {
  profile: Profile;
  /** Kept so profiles can be re-extracted if the prompt/schema changes. */
  rawAnswers: Answer[];
  /** Only set when importing an existing profile (keeps its original id / timestamp). */
  id?: string;
  createdAt?: Date;
};

export interface ProfileRepository {
  save(record: ProfileRecord): Promise<{ id: string }>;
}

export function newProfileId(): string {
  return randomUUID();
}

/** Pretty-prints the confirmed profile to the server terminal. */
export function printProfile(id: string, record: ProfileRecord) {
  const bar = "=".repeat(72);
  console.log(`\n${bar}\n  CONFIRMED PROFILE  ${id}  (${record.profile.displayName})\n${bar}`);
  console.log(JSON.stringify(record.profile, null, 2));
  console.log(`${bar}\n`);
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
        { _id: id, createdAt, updatedAt: now, ...record.profile, rawAnswers: record.rawAnswers },
        null,
        2,
      ),
    );
    return { id };
  }
}
