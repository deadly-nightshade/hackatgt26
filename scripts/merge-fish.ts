/**
 * Copy one fish's profile (interests, summary, answers…) and look ONTO another fish,
 * in place. For when someone accidentally onboarded twice: keep the old fish (which
 * has the friendships) and give it the new answers.
 *
 *   npm run merge:fish -- --from <newId> --into <oldId>
 *
 * - The `--into` fish keeps its id, createdAt, pairs, friendships, levels and history.
 *   Only its profile content, raw answers and look change (updatedAt bumps, so the pair
 *   AI refreshes on the next meet; status and level survive).
 * - Nothing is deleted. A backup of the `--into` fish is written to data/backups/ first.
 *   Remove the leftover `--from` fish afterwards with `npm run remove:fish -- <newId>` if you want.
 */
import "./loadEnv";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "@/lib/config";
import type { Answer } from "@/lib/profile/schema";
import { getPairRepository, getProfileRepository } from "@/lib/storage";
import { closeMongo, getMongoDb } from "@/lib/storage/mongoRepo";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** The stored document as-is (for rawAnswers + the backup). */
async function rawDoc(id: string): Promise<Record<string, unknown> | null> {
  if (config.storage() === "mongo") return (await (await getMongoDb()).collection("profiles").findOne({ _id: id as never })) as Record<string, unknown> | null;
  return readFile(path.join(process.cwd(), "data", "profiles", `${id}.json`), "utf8").then(JSON.parse, () => null);
}

async function main() {
  const from = arg("from");
  const into = arg("into");
  if (!from || !into || from === into) {
    console.log("Usage: npm run merge:fish -- --from <newId> --into <oldId>   (ids from npm run list:fish)");
    process.exitCode = 1;
    return;
  }
  const profiles = getProfileRepository();
  const pairs = getPairRepository();
  const [src, dst] = await Promise.all([profiles.get(from), profiles.get(into)]);
  if (!src || !dst) throw new Error(`No fish with id ${!src ? from : into}`);
  const [srcDoc, dstDoc] = await Promise.all([rawDoc(from), rawDoc(into)]);
  const before = await pairs.listPairsForUser(into);

  const backupDir = path.join(process.cwd(), "data", "backups");
  await mkdir(backupDir, { recursive: true });
  const backup = path.join(backupDir, `${into}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(backup, JSON.stringify(dstDoc, null, 2));
  console.log(`backup  ${path.relative(process.cwd(), backup)}`);

  const log = console.log;
  console.log = () => {}; // quiet the repository's pretty-print
  try {
    await profiles.update(into, {
      profile: src.profile,
      rawAnswers: (srcDoc?.rawAnswers as Answer[] | undefined) ?? [],
      appearance: src.appearance,
    });
  } finally {
    console.log = log;
  }

  const after = await pairs.listPairsForUser(into);
  const kept = after.length === before.length && before.every((p) => after.some((q) => q.pairKey === p.pairKey && q.status === p.status && q.level === p.level));
  console.log(`merged  ${src.profile.displayName} (${from}) → ${dst.profile.displayName} (${into})`);
  console.log(`        interests now: ${src.profile.interests.map((i) => i.name).join(", ")}`);
  console.log(`        friendships: ${after.length} (${kept ? "all kept, same status and levels" : "CHANGED — check!"})`);
  console.log(`        ${from} was left as-is. Point your browser back at ${into} (/dev/whoami or "Already made your fish?").`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
