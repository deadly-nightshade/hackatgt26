/**
 * Copy profiles saved by ConsoleFileRepository (data/profiles/*.json) into
 * MongoDB, keeping their ids. Validates each with ProfileSchema and skips ids
 * already in the collection, so it's safe to re-run.
 *
 *   npm run import:profiles
 */
import "./loadEnv";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";
import { config } from "@/lib/config";
import { formatZodError } from "@/lib/profile/extract";
import { AnswerSchema, ProfileSchema } from "@/lib/profile/schema";
import { closeMongo, MongoProfileRepository } from "@/lib/storage/mongoRepo";

const DIR = path.join(process.cwd(), "data", "profiles");

async function main() {
  const files = (await readdir(DIR).catch(() => [])).filter((f) => f.endsWith(".json"));
  if (!files.length) return console.log(`No profiles in ${DIR}`);

  const { uri, db } = config.mongo();
  const probe = await new MongoClient(uri).connect();
  const existing = new Set(
    (await probe.db(db).collection<{ _id: string }>("profiles").find({}, { projection: { _id: 1 } }).toArray()).map((d) => d._id),
  );
  await probe.close();

  const repo = new MongoProfileRepository();
  let imported = 0;
  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(DIR, file), "utf8"));
    const id = String(raw._id ?? path.basename(file, ".json"));
    if (existing.has(id)) {
      console.log(`skip   ${id} (already in MongoDB)`);
      continue;
    }
    const profile = ProfileSchema.safeParse(raw); // strips _id/createdAt/rawAnswers
    if (!profile.success) {
      console.log(`INVALID ${file}:\n${formatZodError(profile.error)}`);
      continue;
    }
    const rawAnswers = AnswerSchema.array().catch([]).parse(raw.rawAnswers);
    await repo.save({
      profile: profile.data,
      rawAnswers,
      id,
      createdAt: raw.createdAt ? new Date(raw.createdAt) : undefined,
    });
    console.log(`import ${id} (${profile.data.displayName})`);
    imported++;
  }
  console.log(`\nImported ${imported} of ${files.length} profile(s) into ${db}.profiles`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(closeMongo);
