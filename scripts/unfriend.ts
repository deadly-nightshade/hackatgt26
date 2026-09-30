/**
 * Delete the friendship (pair + its whole meet history) between fish, so they're
 * strangers who've never met again: gone from each other's beach, next tap = a fresh
 * first meet. Respects STORAGE. Get ids from `npm run list:fish`.
 *
 *   npm run unfriend -- <idA> <idB>
 *   npm run unfriend -- <idA> <idB> <idC> <idD>     # several pairs: A–B and C–D
 */
import "./loadEnv";
import { pairKeyOf } from "@/lib/meet/schema";
import { getPairRepository, getProfileRepository } from "@/lib/storage";
import { closeMongo } from "@/lib/storage/mongoRepo";

async function main() {
  const ids = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  if (ids.length < 2 || ids.length % 2) {
    console.log("Usage: npm run unfriend -- <idA> <idB> [<idC> <idD> ...]   (ids from npm run list:fish)");
    process.exitCode = 1;
    return;
  }
  const pairs = getPairRepository();
  const profiles = getProfileRepository();
  const name = async (id: string) => (await profiles.get(id))?.profile.displayName ?? "(no such fish)";
  for (let i = 0; i < ids.length; i += 2) {
    const [a, b] = [ids[i], ids[i + 1]];
    const key = pairKeyOf(a, b);
    const pair = await pairs.getPair(key);
    const label = `${await name(a)} ↔ ${await name(b)}`;
    if (!pair) {
      console.log(`skip     ${label}  (they have no pair — never met)`);
      continue;
    }
    const attempts = (await pairs.listAttempts(key)).length;
    await pairs.deletePair(key);
    console.log(`removed  ${label}  (was ${pair.status}, level ${pair.level}; ${attempts} meet(s) deleted)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
