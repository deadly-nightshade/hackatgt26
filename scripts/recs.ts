/**
 * Print a fish's "Find fish" suggestions + AI usage (respects STORAGE and AI_MODE).
 *
 *   npm run recs -- <userId>            # uses the cache like the app does
 *   npm run recs -- <userId> --force    # skip the refresh window (still counts toward the daily budget)
 */
import "./loadEnv";
import { getUsageTotals } from "@/lib/ai/usage";
import { defaultRecDeps } from "@/lib/recs";
import { getRecommendations } from "@/lib/recs/service";
import { closeMongo } from "@/lib/storage/mongoRepo";

async function main() {
  const userId = process.argv.slice(2).find((a) => !a.startsWith("-"));
  if (!userId) {
    console.log("Usage: npm run recs -- <userId> [--force]   (ids from npm run list:fish)");
    process.exitCode = 1;
    return;
  }
  const before = { ...getUsageTotals() };
  const { response, info } = await getRecommendations(userId, defaultRecDeps(), { force: process.argv.includes("--force") });
  const after = getUsageTotals();

  console.log(`\nSuggestions for ${userId}: ${info.reason}${info.fromCache ? " (served from cache)" : ""}`);
  console.log(`  candidates in pool: ${info.poolSize} · source: ${info.source} · AI called: ${info.aiCalled ? "yes" : "no"}`);
  if (!response.enabled) console.log("  (this fish isn't discoverable, so it sees no suggestions — turn it on in /me or /dev/whoami)");
  else if (!info.poolSize)
    console.log(
      "  No candidates: nobody else is opted in that this fish hasn't already met (fish you've met never show up).\n" +
        '  Opt in someone they haven\'t met yet — /dev/whoami → "Shown in suggestions".',
    );
  else if (!response.fish.length) console.log("  No new fish to suggest right now (candidates exist, but nobody shares something real).");
  response.fish.forEach((f, i) => {
    console.log(`\n  ${i + 1}. ${f.displayName}  (${f.id})`);
    if (f.sharedInterests.length) console.log(`     You both like: ${f.sharedInterests.map((s) => s.label).join(", ")}`);
    for (const b of f.bridges) console.log(`     ✨ ${b.label}`);
    console.log(`     “${f.teaser}”`);
  });
  console.log(`\n  usage this run: ${after.calls - before.calls} call(s)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeMongo());
