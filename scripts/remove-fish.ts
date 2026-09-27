/**
 * Remove fish (profiles) by id, plus every pair + meet attempt involving them
 * (respects STORAGE, like the app). Get ids from `npm run list:fish`.
 *
 *   npm run remove:fish -- <id> [<id> ...]
 */
import "./loadEnv";
import { getPairRepository, getProfileRepository } from "@/lib/storage";
import { closeMongo } from "@/lib/storage/mongoRepo";

async function main() {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (!ids.length) {
    console.log("Usage: npm run remove:fish -- <id> [<id> ...]   (ids from npm run list:fish)");
    process.exitCode = 1;
    return;
  }
  const profiles = getProfileRepository();
  for (const id of ids) {
    const fish = await profiles.get(id);
    if (!fish) {
      console.log(`skip    ${id}  (no such fish)`);
      continue;
    }
    const pairs = await getPairRepository().deleteForUsers([id]);
    await profiles.delete(id);
    console.log(`removed ${id}  ${fish.profile.displayName}  (+ ${pairs} pair(s) and their meet history)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
