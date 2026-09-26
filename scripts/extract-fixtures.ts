/**
 * Run extractProfile on fixture answer sets and print the results, so the
 * prompt can be iterated on without recording audio.
 *
 *   npm run extract:fixtures                 # all fixtures
 *   npm run extract:fixtures -- --only rich  # one fixture (saves credits)
 */
import "./loadEnv";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getUsageTotals } from "@/lib/ai/usage";
import { config } from "@/lib/config";
import { extractProfile } from "@/lib/profile/extract";
import { ProfileSchema, type Answer, type Profile } from "@/lib/profile/schema";

type Fixture = { description?: string; displayName: string; answers: Answer[]; mustNotContain?: string[] };

const FIXTURE_DIR = path.join(process.cwd(), "fixtures", "answers");

function parseArgs() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--only");
  const only = i >= 0 ? args[i + 1]?.split(",").map((s) => s.replace(/\.json$/, "")) : undefined;
  if (i >= 0 && !only?.length) throw new Error("--only needs a fixture name, e.g. --only rich");
  return { only };
}

/** Checks from the acceptance criteria. Returns a list of problems. */
function checkProfile(profile: Profile, fixture: Fixture): string[] {
  const problems: string[] = [];
  const parsed = ProfileSchema.safeParse(profile);
  if (!parsed.success) problems.push(`schema invalid: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  for (const i of profile.interests) if (!i.evidence.trim()) problems.push(`interest "${i.name}" has no evidence`);
  for (const w of profile.wantsToTry) if (!w.evidence.trim()) problems.push(`wantsToTry "${w.name}" has no evidence`);
  const haystack = JSON.stringify(profile).toLowerCase();
  for (const term of fixture.mustNotContain ?? []) {
    if (haystack.includes(term.toLowerCase())) problems.push(`contains sensitive term "${term}"`);
  }
  return problems;
}

async function main() {
  const { only } = parseArgs();
  const files = (await readdir(FIXTURE_DIR)).filter((f) => f.endsWith(".json")).sort();
  const selected = only ? files.filter((f) => only.includes(f.replace(/\.json$/, ""))) : files;
  if (!selected.length) throw new Error(`No fixtures matched. Available: ${files.join(", ")}`);

  console.log(`AI_MODE=${config.aiMode()}  AI_CACHE=${config.aiCache()}  fixtures: ${selected.join(", ")}`);
  if (config.aiMode() === "mock") {
    console.log("⚠  AI_MODE=mock returns the canned profile. Run with AI_MODE=live to exercise Muse Spark.");
  }

  let failures = 0;
  for (const file of selected) {
    const fixture = JSON.parse(await readFile(path.join(FIXTURE_DIR, file), "utf8")) as Fixture;
    console.log(`\n${"─".repeat(72)}\n▶ ${file}  ${fixture.description ?? ""}\n${"─".repeat(72)}`);
    const start = Date.now();
    try {
      const profile = await extractProfile({ displayName: fixture.displayName, answers: fixture.answers });
      console.log(JSON.stringify(profile, null, 2));
      const problems = checkProfile(profile, fixture);
      if (problems.length) {
        failures++;
        console.log(`✗ FAIL (${Date.now() - start}ms)\n  - ${problems.join("\n  - ")}`);
      } else {
        console.log(`✓ PASS (${Date.now() - start}ms) — ${profile.interests.length} interests, ${profile.wantsToTry.length} wantsToTry`);
      }
    } catch (err) {
      failures++;
      console.log(`✗ ERROR: ${(err as Error).message}`);
    }
  }

  const u = getUsageTotals();
  console.log(`\nUsage this run: ${u.calls} live calls, ${u.inputTokens} in / ${u.outputTokens} out tokens`);
  console.log(failures ? `\n${failures} fixture(s) failed` : "\nAll fixtures passed");
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
